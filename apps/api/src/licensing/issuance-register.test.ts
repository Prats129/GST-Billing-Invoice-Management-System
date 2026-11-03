import { afterEach, expect, test } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initializeIssuanceRegister,
  issueRegisteredEntitlement,
  exportRegisteredEntitlement,
  writeGrantOutput,
  assertGrantOutputPath,
} from '../../../../scripts/issuer/register.js';
import { secureDirectory } from '../operations/release-staging.js';
import { loadEntitlementTrust, verifyEntitlement } from './entitlement.js';

const parent =
  process.platform === 'win32'
    ? (process.env.LOCALAPPDATA ?? tmpdir())
    : tmpdir();
const roots: string[] = [];
afterEach(async () => {
  for (const path of roots.splice(0)) {
    if (
      dirname(resolve(path)) !== resolve(parent) ||
      !basename(path).startsWith('gst-register-test-')
    )
      throw new Error('Unsafe fixture cleanup.');
    await rm(path, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(parent, 'gst-register-test-'));
  roots.push(root);
  await secureDirectory(root);
  const directory = join(root, 'register');
  const { registerId } = await initializeIssuanceRegister(directory);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const trust = {
    test: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
  const claims = {
    version: 1,
    entitlementId: randomUUID(),
    organizationId: randomUUID(),
    installationId: randomUUID(),
    sequence: 1,
    kind: 'perpetual',
    edition: 'offline',
    issuedAt: '2026-11-03T00:00:00Z',
    startsAt: '2026-11-03T00:00:00Z',
    expiresAt: null,
    maintenanceUntil: null,
  };
  const options = {
    directory,
    registerId,
    privateKey,
    trust,
    keyId: 'test',
    claims,
    newOrganization: true,
  };
  const exported = (sequence: number) =>
    exportRegisteredEntitlement({
      directory,
      registerId,
      organizationId: claims.organizationId,
      sequence,
      trust,
    });
  return { root, options, exported };
}

test('the authoritative predecessor prevents duplicate first issuance, stale renewals and sequence gaps', async () => {
  const f = await fixture();
  const first = await issueRegisteredEntitlement(f.options);
  await expect(
    issueRegisteredEntitlement({
      ...f.options,
      claims: { ...f.options.claims, entitlementId: randomUUID() },
    }),
  ).rejects.toThrow();
  const renewal = {
    ...f.options,
    newOrganization: false,
    previousGrant: first,
    claims: { ...f.options.claims, entitlementId: randomUUID(), sequence: 2 },
  };
  const second = await issueRegisteredEntitlement(renewal);
  await expect(
    issueRegisteredEntitlement({
      ...renewal,
      claims: { ...renewal.claims, entitlementId: randomUUID() },
    }),
  ).rejects.toThrow();
  await expect(
    issueRegisteredEntitlement({
      ...renewal,
      previousGrant: second,
      claims: { ...renewal.claims, sequence: 4, entitlementId: randomUUID() },
    }),
  ).rejects.toThrow();
  expect(await f.exported(2)).toEqual(second);
}, 120000);

test('concurrent first issuances commit exactly one immutable sequence', async () => {
  const f = await fixture();
  const outcomes = await Promise.allSettled([
    issueRegisteredEntitlement(f.options),
    issueRegisteredEntitlement({
      ...f.options,
      claims: { ...f.options.claims, entitlementId: randomUUID() },
    }),
  ]);
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const winner = outcomes.find((r) => r.status === 'fulfilled');
  expect(await f.exported(1)).toEqual(winner!.value);
  expect(
    await readdir(join(f.options.directory, f.options.claims.organizationId)),
  ).toEqual(['0000000001.json']);
}, 60000);

test('failed publication recovers the exact registered envelope without a private key or another issuance', async () => {
  const f = await fixture();
  const envelope = await issueRegisteredEntitlement(f.options);
  const pending = join(
    f.options.directory,
    f.options.claims.organizationId,
    '.pending-' + randomUUID(),
  );
  await writeFile(pending, 'interrupted unpublished temporary file');
  expect(() =>
    assertGrantOutputPath(
      f.options.directory,
      join(f.options.directory, 'accidental-output.json'),
    ),
  ).toThrow();
  const output = join(f.root, 'existing.json');
  await writeFile(output, 'preserve');
  await expect(writeGrantOutput(output, envelope)).rejects.toThrow();
  expect(await readFile(output, 'utf8')).toBe('preserve');
  const recovered = await f.exported(1);
  expect(recovered).toEqual(envelope);
  expect(
    verifyEntitlement(recovered, loadEntitlementTrust(f.options.trust)),
  ).toEqual(f.options.claims);
  await writeGrantOutput(join(f.root, 'recovered.json'), recovered);
  await expect(issueRegisteredEntitlement(f.options)).rejects.toThrow();
}, 60000);

test('wrong register identity, corrupt signatures and missing history fail closed', async () => {
  const f = await fixture();
  await expect(
    issueRegisteredEntitlement({ ...f.options, registerId: randomUUID() }),
  ).rejects.toThrow();
  await issueRegisteredEntitlement(f.options);
  const path = join(
    f.options.directory,
    f.options.claims.organizationId,
    '0000000001.json',
  );
  const original = await readFile(path);
  await writeFile(
    path,
    JSON.stringify({
      ...JSON.parse(original.toString()),
      signature: 'x'.repeat(86),
    }),
  );
  await expect(f.exported(1)).rejects.toThrow();
  await writeFile(path, original);
  await writeFile(join(dirname(path), '0000000003.json'), original);
  await expect(f.exported(1)).rejects.toThrow();
  await expect(
    initializeIssuanceRegister(f.options.directory),
  ).rejects.toThrow();
}, 60000);

test('approved signing-key rotation and host replacement continue the same organization sequence', async () => {
  const f = await fixture();
  const previousGrant = await issueRegisteredEntitlement(f.options);
  const next = generateKeyPairSync('ed25519');
  const trust = {
    ...f.options.trust,
    rotated: next.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
  const claims = {
    ...f.options.claims,
    sequence: 2,
    entitlementId: randomUUID(),
    installationId: randomUUID(),
  };
  const envelope = await issueRegisteredEntitlement({
    ...f.options,
    claims,
    trust,
    privateKey: next.privateKey,
    keyId: 'rotated',
    newOrganization: false,
    previousGrant,
  });
  expect(verifyEntitlement(envelope, loadEntitlementTrust(trust))).toEqual(
    claims,
  );
  await expect(
    exportRegisteredEntitlement({
      ...f.options,
      organizationId: claims.organizationId,
      sequence: 2,
      trust: { rotated: trust.rotated },
    }),
  ).rejects.toThrow();
}, 60000);
