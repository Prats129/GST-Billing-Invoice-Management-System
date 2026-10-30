import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createIsolatedTestDatabase } from '@gst/database/testing';
import { eq, organizationEntitlements } from '@gst/database';
import type { EntitlementClaims } from '@gst/contracts';
import { parseConfig } from '../config.js';
import { createApp } from '../app.js';
import { IdentityService } from '../security/identity.service.js';
import { OrganizationsService } from '../security/organizations.service.js';
import { installEntitlement } from './install.js';
import { loadEntitlementTrust } from './entitlement.js';
import { EntitlementsService } from './entitlements.service.js';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminUrl)
  throw new Error(
    'TEST_DATABASE_ADMIN_URL required for isolated entitlement tests',
  );
let isolated: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
let app: INestApplication;
let directory: string;
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const trust = loadEntitlementTrust({ test: pem });
const installationId = randomUUID();
const headers = { Host: 'localhost:3000', Origin: 'http://localhost:5173' };
const http = () => request(app.getHttpServer());
let config: ReturnType<typeof parseConfig>;
beforeAll(async () => {
  isolated = await createIsolatedTestDatabase(adminUrl);
  directory = await mkdtemp(join(tmpdir(), 'gst-entitlement-test-'));
  const path = join(directory, 'public-keys.json');
  await writeFile(path, JSON.stringify({ test: pem }));
  config = parseConfig({
    NODE_ENV: 'test',
    DATABASE_URL: isolated.connectionString,
    ENTITLEMENT_TRUST_FILE: path,
    OFFLINE_INSTALLATION_ID: installationId,
  });
  app = await createApp(config, {
    ...isolated.database,
    close: async () => {},
  });
  await app.init();
});
afterAll(async () => {
  await app?.close();
  await isolated?.cleanup();
  if (directory) await rm(directory, { recursive: true, force: true });
});
function signed(claims: EntitlementClaims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return {
    keyId: 'test',
    payload,
    signature: sign(
      null,
      Buffer.from(`GST-ENTITLEMENT-V1\ntest\n${payload}`),
      privateKey,
    ).toString('base64url'),
  };
}
test('production without an entitlement trust store fails closed for business writes', async () => {
  const production = parseConfig({
    NODE_ENV: 'production',
    DATABASE_URL: isolated.connectionString,
    TLS_KEY_PATH: 'operator-provided-test-path.key',
    TLS_CERT_PATH: 'operator-provided-test-path.crt',
    APP_ORIGIN: 'https://localhost:5173',
  });
  // Policy-only production configuration; no TLS server or certificate is used.
  const policy = new EntitlementsService(production);
  await expect(
    policy.assertWritable(
      isolated.database.db,
      randomUUID(),
      'customers.manage',
    ),
  ).rejects.toMatchObject({ code: 'ENTITLEMENT_READ_ONLY' });
  await expect(
    policy.assertWritable(isolated.database.db, randomUUID(), 'invoices.read'),
  ).resolves.toBeUndefined();
});
test('signed grants gate business writes independently of RBAC and retain authorized reads after expiry', async () => {
  const orgs = new OrganizationsService(
    new IdentityService(isolated.database, config),
  );
  const password = 'Entitlement test fixture password!';
  const email = `${randomUUID()}@example.test`;
  const owner = await orgs.provisionOwner({
    organizationName: 'Entitlement fixture',
    name: 'Owner',
    email,
    password,
  });
  const login = await http()
    .post('/api/v1/auth/login')
    .set(headers)
    .send({ email, password })
    .expect(201);
  const auth = {
    ...headers,
    Cookie: (login.headers['set-cookie'] as unknown as string[])[0]!.split(
      ';',
    )[0]!,
    'x-csrf-token': login.body.csrfToken as string,
  };
  const base = `/api/v1/organizations/${owner.organizationId}`;
  const input = {
    version: 0,
    legalName: 'Entitlement fixture',
    address: {
      line1: '12 Test Street',
      line2: '',
      city: 'Mumbai',
      stateCode: '27',
      postalCode: '400001',
    },
    gstin: '27AAPFU0939F1ZV',
    taxpayerType: 'regular',
    registrationConfirmed: true,
    eInvoiceApplicability: 'not_required',
  };
  const rejected = await http()
    .put(`${base}/business-profile`)
    .set(auth)
    .send(input)
    .expect(403);
  expect(rejected.body.error.code).toBe('ENTITLEMENT_READ_ONLY');
  const claims: EntitlementClaims = {
    version: 1,
    entitlementId: randomUUID(),
    organizationId: owner.organizationId,
    installationId,
    sequence: 1,
    issuedAt: '2026-01-01T00:00:00Z',
    startsAt: '2026-01-01T00:00:00Z',
    kind: 'perpetual',
    edition: 'offline',
    expiresAt: null,
    maintenanceUntil: '2026-01-02T00:00:00Z',
  };
  const envelope = signed(claims);
  expect(
    (await installEntitlement(isolated.database, config, trust, envelope))
      .status,
  ).toBe('active');
  expect(
    (await installEntitlement(isolated.database, config, trust, envelope))
      .unchanged,
  ).toBe(true);
  const profile = await http()
    .put(`${base}/business-profile`)
    .set(auth)
    .send(input)
    .expect(200);
  const expired = signed({
    ...claims,
    kind: 'subscription',
    sequence: 2,
    expiresAt: '2026-01-03T00:00:00Z',
  });
  await installEntitlement(isolated.database, config, trust, expired);
  const response = await http()
    .put(`${base}/business-profile`)
    .set(auth)
    .send({
      ...input,
      version: profile.body.version,
      legalName: 'Must not save',
    })
    .expect(403);
  expect(response.body.error.code).toBe('ENTITLEMENT_READ_ONLY');
  expect(
    (await http().get(base).set(auth).expect(200)).body.entitlement.status,
  ).toBe('expired');
  expect(
    (await http().get(`${base}/business-profile`).set(auth).expect(200)).body
      .profile.legalName,
  ).toBe(input.legalName);
  await http().get(`${base}/invoices`).set(auth).expect(200);
  await expect(
    installEntitlement(isolated.database, config, trust, envelope),
  ).rejects.toThrow();
  await expect(
    installEntitlement(
      isolated.database,
      config,
      trust,
      signed({ ...claims, sequence: 3, installationId: randomUUID() }),
    ),
  ).rejects.toThrow();
  const [stored] = await isolated.database.db
    .select()
    .from(organizationEntitlements)
    .where(eq(organizationEntitlements.organizationId, owner.organizationId));
  expect(stored?.highestSequence).toBe(2);
});
