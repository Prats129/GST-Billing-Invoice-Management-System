import { afterAll, beforeAll, expect, test } from 'vitest';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createIsolatedTestDatabase } from '@gst/database/testing';
import {
  eq,
  memberships,
  users,
  organizationEntitlements,
  organizations,
} from '@gst/database';
import { loadEntitlementTrust } from '../licensing/entitlement.js';
import { checkOfflineUpdateEligibility } from './update-eligibility.js';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('TEST_DATABASE_ADMIN_URL required');
let isolated: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const trust = loadEntitlementTrust({
  test: publicKey.export({ type: 'spki', format: 'pem' }),
});
const installationId = randomUUID();
beforeAll(async () => {
  isolated = await createIsolatedTestDatabase(adminUrl);
});
afterAll(async () => {
  await isolated?.cleanup();
});

test('database preflight includes archived/suspended organizations and never changes grants', async () => {
  const db = isolated.database.db;
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  await db.transaction(async (tx) => {
    await tx.insert(organizations).values(
      ids.map((id, index) => ({
        id,
        name: 'Maintenance integration fixture',
        edition: 'offline',
        status: ['active', 'archived', 'suspended'][index]!,
      })),
    );
    const ownerId = randomUUID();
    await tx.insert(users).values({
      id: ownerId,
      edition: 'offline',
      email: 'maintenance-fixture@example.test',
      name: 'Fixture owner',
      passwordHash: 'not-a-login-hash',
    });
    await tx.insert(memberships).values({
      organizationId: ids[0]!,
      userId: ownerId,
      edition: 'offline',
      isOwner: true,
    });
  });
  const observedAt = new Date(Date.now() - 1000);
  for (const id of ids) {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        entitlementId: randomUUID(),
        organizationId: id,
        installationId,
        sequence: 1,
        kind: 'perpetual',
        edition: 'offline',
        issuedAt: observedAt.toISOString(),
        startsAt: observedAt.toISOString(),
        expiresAt: null,
        maintenanceUntil: new Date(Date.now() + 86400000).toISOString(),
      }),
    ).toString('base64url');
    await db.insert(organizationEntitlements).values({
      organizationId: id,
      highestSequence: 1,
      lastObservedAt: observedAt,
      signedGrant: {
        keyId: 'test',
        payload,
        signature: sign(
          null,
          Buffer.from(`GST-ENTITLEMENT-V1\ntest\n${payload}`),
          privateKey,
        ).toString('base64url'),
      },
    });
  }
  const before = await db.select().from(organizationEntitlements);
  expect(
    await checkOfflineUpdateEligibility(
      isolated.database,
      trust,
      installationId,
    ),
  ).toMatchObject({ organizations: 3 });
  expect(await db.select().from(organizationEntitlements)).toEqual(before);
  await db
    .delete(organizationEntitlements)
    .where(eq(organizationEntitlements.organizationId, ids[1]!));
  await expect(
    checkOfflineUpdateEligibility(isolated.database, trust, installationId),
  ).rejects.toThrow('current maintenance');
});
