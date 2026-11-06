import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import request from 'supertest';
import { Client } from 'pg';
import { createIsolatedTestDatabase } from '../../../packages/database/src/testing.js';
import { createTotp, digest } from '@gst/security';
import type { EntitlementClaims } from '@gst/contracts';
import { store, migratePlatform, rows } from './store.js';
import { PlatformAuth } from './auth.js';
import { PlatformService } from './service.js';
import { Operations } from './operations.js';
import { config } from './config.js';
import { createPlatformApp } from './app.js';
import { createApp } from '../../api/src/app.js';
import { parseConfig } from '../../api/src/config.js';
import { EntitlementsService } from '../../api/src/licensing/entitlements.service.js';
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
describe.skipIf(!adminUrl)(
  'platform administration with separate disposable databases',
  () => {
    let saas: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
      db: ReturnType<typeof store>,
      root: Client,
      name: string;
    let app: Awaited<ReturnType<typeof createPlatformApp>>['app'],
      customer: Awaited<ReturnType<typeof createApp>>,
      auth: PlatformAuth,
      service: PlatformService,
      operations: Operations;
    let cookie = '',
      csrf = '',
      secret = '',
      offlineId = '',
      onlineId = '',
      runtimeId = '';
    const key = generateKeyPairSync('ed25519'),
      password = 'Platform test password ' + randomUUID(),
      email = 'publisher@example.test';
    const headers = () => ({
      Host: '127.0.0.1:5174',
      Origin: 'http://127.0.0.1:5174',
      Cookie: cookie,
      'x-csrf-token': csrf,
    });
    const post = (path: string, body: unknown) =>
      request(app.getHttpServer())
        .post('/api/platform/v1/' + path)
        .set(headers())
        .send(body as object);
    const get = (path: string) =>
      request(app.getHttpServer())
        .get('/api/platform/v1/' + path)
        .set(headers());
    const grant = (claims: EntitlementClaims) => {
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return {
        keyId: 'test',
        payload,
        signature: sign(
          null,
          Buffer.from('GST-ENTITLEMENT-V1\ntest\n' + payload),
          key.privateKey,
        ).toString('base64url'),
      };
    };
    beforeAll(async () => {
      root = new Client({ connectionString: adminUrl });
      await root.connect();
      name = 'gst_platform_test_' + randomUUID().replaceAll('-', '');
      await root.query('CREATE DATABASE "' + name + '"');
      const url = new URL(adminUrl!);
      url.pathname = '/' + name;
      db = store(url.toString());
      await migratePlatform(db);
      await migratePlatform(db);
      saas = await createIsolatedTestDatabase(adminUrl!);
      const c = config({
        NODE_ENV: 'test',
        PLATFORM_DATABASE_URL: url.toString(),
        PLATFORM_AUTH_KEY: 'cd'.repeat(32),
        SAAS_OPERATOR_DATABASE_URL: saas.connectionString,
        SAAS_APP_ORIGIN: 'http://127.0.0.1:5173',
      });
      auth = new PlatformAuth(db, c);
      await auth.bootstrap(email, 'Publisher', password);
      service = new PlatformService(db, {
        test: key.publicKey.export({ format: 'pem', type: 'spki' }),
      });
      operations = new Operations(service, c);
      ({ app } = await createPlatformApp(c, { auth, service, operations }));
      await app.init();
      customer = await createApp(
        parseConfig({
          NODE_ENV: 'test',
          DATABASE_URL: saas.connectionString,
          DEPLOYMENT_EDITION: 'saas',
          AUTH_DATA_KEY: 'ab'.repeat(32),
          APP_ORIGIN: 'http://127.0.0.1:5173',
        }),
      );
      await customer.init();
      await db.query('UPDATE platform_control SET operations_enabled=true');
    }, 60000);
    afterAll(async () => {
      await customer?.close();
      await app?.close();
      await saas?.cleanup();
      if (root) {
        await root.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
        await root.end();
      }
    });
    it('requires isolated platform credentials and MFA before data access', async () => {
      expect((await get('organizations')).status).toBe(401);
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/platform/v1/organizations')
            .set('Host', '127.0.0.1:5174')
            .set('Cookie', 'gst_dev_session=customer-token')
        ).status,
      ).toBe(401);
      const login = await post('auth/login', { email, password });
      expect(login.status).toBe(201);
      cookie = String(login.headers['set-cookie']?.[0]).split(';')[0]!;
      csrf = login.body.csrfToken;
      expect((await get('organizations')).status).toBe(403);
      const setup = await post('auth/mfa/setup', {});
      secret = setup.body.secret;
      const enrolled = await post('auth/mfa/enroll', {
        code: createTotp(secret).generate(),
      });
      expect(enrolled.status).toBe(201);
      expect(enrolled.body.recoveryCodes).toHaveLength(10);
      const oldCookie = cookie;
      cookie = String(enrolled.headers['set-cookie']?.[0]).split(';')[0]!;
      csrf = enrolled.body.csrfToken;
      expect(cookie).not.toBe(oldCookie);
      const proof = await post('auth/confirm', {
        password,
        code: enrolled.body.recoveryCodes[0],
      });
      expect(proof.status).toBe(201);
      cookie = String(proof.headers['set-cookie']?.[0]).split(';')[0]!;
      csrf = proof.body.csrfToken;

      expect((await get('organizations')).status).toBe(200);
      expect(
        (
          await request(app.getHttpServer())
            .post('/api/platform/v1/auth/logout')
            .set('Host', '127.0.0.1:5174')
            .set('Cookie', cookie)
            .send({})
        ).status,
      ).toBe(403);
      expect(
        (
          await request(customer.getHttpServer())
            .get('/api/v1/auth/session')
            .set('Host', '127.0.0.1:5173')
            .set('Cookie', cookie)
        ).status,
      ).toBe(401);
    });
    it('records offline organizations once without adopting duplicate mappings', async () => {
      const input = {
        name: 'Offline customer',
        email: 'buyer@example.test',
        edition: 'offline',
        runtimeId: randomUUID(),
        installationId: randomUUID(),
        requestKey: randomUUID(),
      };
      const result = await post('organizations', input);
      expect(result.status).toBe(201);
      offlineId = result.body.id;
      expect((await post('organizations', input)).body.id).toBe(offlineId);
      expect(
        (await post('organizations', { ...input, name: 'Changed' })).status,
      ).toBe(409);
      expect(
        (await post('organizations', { ...input, requestKey: randomUUID() }))
          .status,
      ).not.toBe(201);
    });
    it('serializes partial receipts and adjustments without overpayment or deletion', async () => {
      const agreement = await post(`organizations/${offlineId}/agreements`, {
        kind: 'perpetual',
        startsAt: '2026-11-05T00:00:00.000Z',
        endsAt: null,
        dueDate: '2026-11-06',
        totalPaise: '10000',
        reference: 'Agreed price',
        requestKey: randomUUID(),
      });
      expect(agreement.status).toBe(201);
      const body = {
        agreementId: agreement.body.id,
        amountPaise: '6000',
        receivedAt: new Date().toISOString(),
        reference: 'Bank transfer',
        requestKey: randomUUID(),
      };
      const results = await Promise.all([
        post(`organizations/${offlineId}/receipts`, body),
        post(`organizations/${offlineId}/receipts`, {
          ...body,
          requestKey: randomUUID(),
        }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const receipt = results.find((r) => r.status === 201)!;
      expect(
        (await post(`organizations/${offlineId}/receipts`, body)).status,
      ).toBe(results[0]!.status);
      expect(
        (
          await post(`organizations/${offlineId}/adjustments`, {
            receiptId: receipt.body.id,
            amountPaise: '1000',
            kind: 'refund',
            reason: 'Refund completed externally',
            requestKey: randomUUID(),
          })
        ).status,
      ).toBe(201);
      const detail = await get('organizations/' + offlineId);
      expect(detail.body.agreements[0].paid_paise).toBe('5000');
      await expect(db.query('DELETE FROM platform_receipts')).rejects.toThrow();
    });
    it('matches externally signed grants, bindings, exact requests and complete history', async () => {
      const o = (await get('organizations/' + offlineId)).body.organization;
      const claims: EntitlementClaims = {
        version: 1,
        entitlementId: randomUUID(),
        organizationId: o.runtime_id,
        edition: 'offline',
        installationId: o.installation_id,
        sequence: 1,
        kind: 'perpetual',
        issuedAt: '2026-11-05T00:00:00.000Z',
        startsAt: '2026-11-05T00:00:00.000Z',
        expiresAt: null,
        maintenanceUntil: '2027-11-05T00:00:00.000Z',
      };
      const r = await post(`organizations/${offlineId}/license-requests`, {
        claims,
        requestKey: randomUUID(),
      });
      expect(r.status).toBe(201);
      const signed = grant(claims);
      expect(
        (
          await post(`organizations/${offlineId}/grants`, {
            requestId: r.body.id,
            grants: [signed],
            requestKey: randomUUID(),
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await post(`organizations/${offlineId}/grants`, {
            requestId: null,
            grants: [grant({ ...claims, entitlementId: randomUUID() })],
            requestKey: randomUUID(),
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await post(`organizations/${offlineId}/grants`, {
            requestId: null,
            grants: [
              grant({ ...claims, entitlementId: randomUUID(), sequence: 3 }),
            ],
            requestKey: randomUUID(),
          })
        ).status,
      ).toBe(409);
      expect(
        (await get(`organizations/${offlineId}/grants/${claims.entitlementId}`))
          .body,
      ).toEqual(signed);
    });
    it('provisions SaaS once and applies setup links without storing raw secrets', async () => {
      const created = await post('organizations', {
        name: 'Hosted customer',
        email: 'new-owner@example.test',
        edition: 'saas',
        mode: 'create',
        requestKey: randomUUID(),
      });
      expect(created.status).toBe(201);
      onlineId = created.body.id;
      await operations.tick();
      const detail = await get('organizations/' + onlineId);
      runtimeId = detail.body.organization.runtime_id;
      expect(detail.body.operations[0].state).toBe('completed');
      const operationId = detail.body.operations[0].id;
      await db.query(
        "UPDATE platform_operations SET state='retryable',next_attempt_at=now() WHERE id=$1",
        [operationId],
      );
      await operations.execute(operationId);
      const count = await saas.database.db.execute(
        'SELECT count(*) AS value FROM organizations',
      );
      expect(count.rows[0]?.value).toBe('1');
      const link = await post(`organizations/${onlineId}/setup-link`, {
        requestKey: randomUUID(),
      });
      expect(link.status).toBe(201);
      expect(link.body.url).toContain('/#/owner-setup/');
      const raw = link.body.url.split('/').at(-1),
        newPassword = 'New owner password ' + randomUUID();
      const setupHeaders = {
        Host: '127.0.0.1:5173',
        Origin: 'http://127.0.0.1:5173',
      };
      const complete = await request(customer.getHttpServer())
        .post('/api/v1/owner-setup/complete')
        .set(setupHeaders)
        .send({ token: raw, password: newPassword });
      expect(complete.status).toBe(201);
      expect(
        (
          await request(customer.getHttpServer())
            .post('/api/v1/owner-setup/complete')
            .set(setupHeaders)
            .send({ token: raw, password: newPassword })
        ).status,
      ).toBe(404);
      const [stored] = await rows<{ payload: object }>(
        db,
        "SELECT payload FROM platform_operations WHERE kind='setup_link'",
      );
      expect(JSON.stringify(stored)).not.toContain(raw);
      expect(JSON.stringify(stored)).toContain(digest(raw));
    });
    it('applies signed online grants and serializes write pause without changing organization visibility', async () => {
      const claims: EntitlementClaims = {
        version: 1,
        entitlementId: randomUUID(),
        organizationId: runtimeId,
        edition: 'saas',
        installationId: null,
        sequence: 1,
        kind: 'subscription',
        issuedAt: '2026-11-05T00:00:00.000Z',
        startsAt: '2026-11-05T00:00:00.000Z',
        expiresAt: '2027-11-05T00:00:00.000Z',
        maintenanceUntil: null,
      };
      const imported = await post(`organizations/${onlineId}/grants`, {
        requestId: null,
        grants: [grant(claims)],
        requestKey: randomUUID(),
      });
      expect(imported.status).toBe(201);
      const applied = await post(`organizations/${onlineId}/apply`, {
        grantId: claims.entitlementId,
        requestKey: randomUUID(),
      });
      expect(applied.status).toBe(201);
      await operations.tick();
      const paused = await post(`organizations/${onlineId}/pause`, {
        paused: true,
        reason: 'Manual support pause',
        requestKey: randomUUID(),
      });
      expect(paused.status).toBe(201);
      await operations.tick();
      const state = await operations.lookup(runtimeId);
      expect(state.paused).toBe(true);
      const [statusRow] = await rows<{ status: string }>(
        operations.operator!,
        'SELECT status FROM organizations WHERE id=$1',
        [runtimeId],
      );
      expect(statusRow?.status).toBe('active');
    });
    it('enforces pause inside business transactions and preserves expired access after resume', async () => {
      const entitlement = new EntitlementsService(
        parseConfig({
          NODE_ENV: 'test',
          DATABASE_URL: saas.connectionString,
          DEPLOYMENT_EDITION: 'saas',
          AUTH_DATA_KEY: 'ab'.repeat(32),
        }),
        service.trust,
      );
      expect(
        (await entitlement.describe(saas.database.db, runtimeId))
          .businessWritesPaused,
      ).toBe(true);
      await expect(
        saas.database.db.transaction((tx) =>
          entitlement.assertWritable(tx, runtimeId, 'invoices.manage'),
        ),
      ).rejects.toMatchObject({ code: 'ORGANIZATION_WRITE_PAUSED' });
      await expect(
        saas.database.db.transaction((tx) =>
          entitlement.assertWritable(tx, runtimeId, 'roles.manage'),
        ),
      ).resolves.toBeUndefined();
      await post(`organizations/${onlineId}/pause`, {
        paused: false,
        reason: 'Support issue resolved',
        requestKey: randomUUID(),
      });
      await operations.tick();
      const expired: EntitlementClaims = {
        version: 1,
        entitlementId: randomUUID(),
        organizationId: runtimeId,
        edition: 'saas',
        installationId: null,
        kind: 'subscription',
        sequence: 2,
        issuedAt: '2026-11-05T00:00:00.000Z',
        startsAt: '2026-11-05T00:00:00.000Z',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        maintenanceUntil: null,
      };
      // Preserve valid temporal ordering regardless of the machine's test date.
      expired.issuedAt = new Date(Date.now() - 3 * 86400000).toISOString();
      expired.startsAt = expired.issuedAt;
      const [previous] = await rows<{ claims: EntitlementClaims }>(
        db,
        'SELECT claims FROM platform_grants WHERE organization_id=$1 ORDER BY sequence DESC LIMIT 1',
        [onlineId],
      );
      if (
        Date.parse(expired.issuedAt) < Date.parse(previous!.claims.issuedAt)
      ) {
        expired.issuedAt = previous!.claims.issuedAt;
        expired.startsAt = expired.issuedAt;
      }
      const imported = await post(`organizations/${onlineId}/grants`, {
        requestId: null,
        grants: [grant(expired)],
        requestKey: randomUUID(),
      });
      expect(imported.status).toBe(201);
      await post(`organizations/${onlineId}/apply`, {
        grantId: expired.entitlementId,
        requestKey: randomUUID(),
      });
      await operations.tick();
      await expect(
        saas.database.db.transaction((tx) =>
          entitlement.assertWritable(tx, runtimeId, 'invoices.manage'),
        ),
      ).rejects.toMatchObject({ code: 'ENTITLEMENT_READ_ONLY' });
    });
    it('restricts operator routines without granting access to customer data or private receipts', async () => {
      const role = 'gst_operator_test_' + randomUUID().replaceAll('-', '');
      await root.query('CREATE ROLE "' + role + '" NOLOGIN');
      try {
        await operations.operator!.query(
          'GRANT USAGE ON SCHEMA platform_operator TO "' + role + '"',
        );
        await operations.operator!.query(
          'GRANT EXECUTE ON FUNCTION platform_operator.lookup(uuid),platform_operator.execute(uuid,text,jsonb) TO "' +
            role +
            '"',
        );
        const client = new Client({ connectionString: saas.connectionString });
        await client.connect();
        try {
          await client.query('SET ROLE "' + role + '"');
          expect(
            (
              await client.query('SELECT platform_operator.lookup($1)', [
                runtimeId,
              ])
            ).rowCount,
          ).toBe(1);
          for (const table of [
            'invoices',
            'customers',
            'catalog_items',
            'organization_entitlements',
            'platform_operator.receipts',
          ])
            await expect(
              client.query('SELECT * FROM ' + table),
            ).rejects.toMatchObject({ code: '42501' });
        } finally {
          await client.end();
        }
      } finally {
        await operations.operator!.query('DROP OWNED BY "' + role + '"');
        await root.query('DROP ROLE "' + role + '"');
      }
    });
    it('invalidates regenerated setup links and refuses takeover of an already established owner', async () => {
      const created = await post('organizations', {
        name: 'Second workspace',
        email: 'new-owner@example.test',
        edition: 'saas',
        mode: 'create',
        requestKey: randomUUID(),
      });
      expect(created.status).toBe(201);
      await operations.tick();
      const first = await post(`organizations/${created.body.id}/setup-link`, {
          requestKey: randomUUID(),
        }),
        second = await post(`organizations/${created.body.id}/setup-link`, {
          requestKey: randomUUID(),
        });
      expect(second.status).toBe(201);
      const h = { Host: '127.0.0.1:5173', Origin: 'http://127.0.0.1:5173' };
      expect(
        (
          await request(customer.getHttpServer())
            .post('/api/v1/owner-setup/check')
            .set(h)
            .send({ token: first.body.url.split('/').at(-1) })
        ).status,
      ).toBe(404);
      const check = await request(customer.getHttpServer())
        .post('/api/v1/owner-setup/check')
        .set(h)
        .send({ token: second.body.url.split('/').at(-1) });
      expect(check.body.newAccount).toBe(false);
      expect(
        (
          await request(customer.getHttpServer())
            .post('/api/v1/owner-setup/complete')
            .set(h)
            .send({
              token: second.body.url.split('/').at(-1),
              password: 'Attacker new password 12345',
            })
        ).status,
      ).toBe(401);
      const [o] = await rows<{ runtime_id: string }>(
        db,
        'SELECT runtime_id FROM platform_organizations WHERE id=$1',
        [created.body.id],
      );
      await saas.database.db.execute(
        `UPDATE owner_setup_tokens SET expires_at=now()-interval '1 second' WHERE organization_id='${o!.runtime_id}'`,
      );
      expect(
        (
          await request(customer.getHttpServer())
            .post('/api/v1/owner-setup/check')
            .set(h)
            .send({ token: second.body.url.split('/').at(-1) })
        ).status,
      ).toBe(404);
    });
    it('provisions only non-owning runtime roles and refuses existing ledger mutation privileges', async () => {
      const role = 'gst_platform_role_' + randomUUID().replaceAll('-', '');
      const directory = await mkdtemp(join(tmpdir(), 'gst-platform-role-'));
      if (
        dirname(resolve(directory)) !== resolve(tmpdir()) ||
        !basename(directory).startsWith('gst-platform-role-')
      )
        throw new Error('Unexpected role fixture path');
      const file = join(directory, 'role.json');
      await writeFile(file, JSON.stringify({ role }), { mode: 0o600 });
      await root.query('CREATE ROLE "' + role + '" NOLOGIN');
      const cli = () =>
        promisify(execFile)(
          process.execPath,
          ['apps/admin-api/dist/operator-cli.js', 'runtime-role', file],
          {
            windowsHide: true,
            timeout: 20000,
            env: {
              ...process.env,
              NODE_ENV: 'test',
              PLATFORM_DATABASE_URL: auth.config.PLATFORM_DATABASE_URL,
              PLATFORM_MIGRATION_DATABASE_URL:
                auth.config.PLATFORM_DATABASE_URL,
              PLATFORM_AUTH_KEY: auth.config.PLATFORM_AUTH_KEY,
              PLATFORM_ENV_FILE: join(directory, 'missing.env'),
            },
          },
        );
      try {
        await cli();
        const [rights] = await rows<{ read: boolean; alter: boolean }>(
          db,
          "SELECT has_table_privilege($1,'platform_receipts','SELECT') AS read,has_table_privilege($1,'platform_receipts','UPDATE,DELETE,TRUNCATE') AS alter",
          [role],
        );
        expect(rights).toEqual({ read: true, alter: false });
        await db.query('GRANT DELETE ON platform_audit TO "' + role + '"');
        await expect(cli()).rejects.toThrow();
        await db.query('REVOKE DELETE ON platform_audit FROM "' + role + '"');
        await db.query('CREATE TABLE platform_role_fixture(id integer)');
        await db.query(
          'ALTER TABLE platform_role_fixture OWNER TO "' + role + '"',
        );
        await expect(cli()).rejects.toThrow();
      } finally {
        await db.query('DROP OWNED BY "' + role + '"');
        await root.query('DROP ROLE "' + role + '"');
        await rm(directory, { recursive: true, force: true });
      }
    });
    it('blocks expired admin sessions, consumes recovery codes once and recovers the owner without a bypass', async () => {
      await db.query(
        "UPDATE platform_sessions SET last_seen_at=now()-interval '31 minutes'",
      );
      expect((await get('organizations')).status).toBe(401);
      const logged = await post('auth/login', { email, password });
      cookie = String(logged.headers['set-cookie']?.[0]).split(';')[0]!;
      csrf = logged.body.csrfToken;
      const [code] = await rows<{ hash: string }>(
        db,
        'SELECT hash FROM platform_recovery_codes LIMIT 1',
      );
      expect(code).toBeTruthy();
      // Host recovery needs its one-time credential, not access to a browser session.
      await expect(
        auth.recover(
          'wrong proof',
          'Replacement password ' + randomUUID(),
          'new-proof',
        ),
      ).rejects.toThrow();
      await db.query('UPDATE platform_owner SET recovery_hash=$1', [
        digest('private-test-recovery-proof'),
      ]);
      await auth.recover(
        'private-test-recovery-proof',
        'Replacement password ' + randomUUID(),
        'replacement-private-proof',
      );
      expect((await get('organizations')).status).toBe(401);
      await expect(
        auth.recover(
          'private-test-recovery-proof',
          'Another password ' + randomUUID(),
          'different-proof',
        ),
      ).rejects.toThrow();
      expect(
        (
          await rows<{ count: string }>(
            db,
            'SELECT count(*) FROM platform_owner',
          )
        )[0]?.count,
      ).toBe('1');
    });
  },
);
