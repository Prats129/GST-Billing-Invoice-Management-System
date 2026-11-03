import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { expect, test } from 'vitest';
import type { EntitlementClaims } from '@gst/contracts';
import {
  entitlementStatus,
  loadEntitlementTrust,
} from '../licensing/entitlement.js';
import { assertUpdateEligibility } from './update-eligibility.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const trust = loadEntitlementTrust({
  test: publicKey.export({ type: 'spki', format: 'pem' }),
});
const installationId = randomUUID();
const now = new Date('2026-11-02T12:00:00Z');
function fixture(overrides: Partial<EntitlementClaims> = {}) {
  const claims = {
    version: 1,
    entitlementId: randomUUID(),
    organizationId: randomUUID(),
    installationId,
    sequence: 2,
    issuedAt: '2026-10-01T00:00:00Z',
    startsAt: '2026-10-01T00:00:00Z',
    expiresAt: null,
    maintenanceUntil: '2026-11-03T00:00:00Z',
    kind: 'perpetual',
    edition: 'offline',
    ...overrides,
  } as EntitlementClaims;
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const row = {
    id: claims.organizationId,
    edition: claims.edition,
    entitlement: {
      signedGrant: {
        keyId: 'test',
        payload,
        signature: sign(
          null,
          Buffer.from(`GST-ENTITLEMENT-V1\ntest\n${payload}`),
          privateKey,
        ).toString('base64url'),
      },
      highestSequence: 2,
      lastObservedAt: new Date('2026-11-01T00:00:00Z'),
    },
  };
  return { row, claims };
}
const check = (
  rows: Parameters<typeof assertUpdateEligibility>[0],
  time = now,
) => assertUpdateEligibility(rows, trust, installationId, time);

test('all organizations must have current signed maintenance', () => {
  expect(() => check([fixture().row, fixture().row])).not.toThrow();
  expect(() =>
    check([fixture().row, fixture({ maintenanceUntil: null }).row]),
  ).toThrow();
  expect(() => check([])).toThrow();
  expect(() => check([{ ...fixture().row, entitlement: null }])).toThrow();
  const row = fixture().row;
  expect(() => check([row, row])).toThrow();
});

test('installation time governs eligibility at the exact expiry boundary', () => {
  const { row, claims } = fixture({ maintenanceUntil: now.toISOString() });
  expect(() => check([row], new Date(now.getTime() - 1))).not.toThrow();
  expect(() => check([row])).toThrow();
  expect(
    entitlementStatus(claims, {
      organizationId: row.id,
      edition: 'offline',
      installationId,
      now,
      highestSequence: 2,
      lastObservedAt: row.entitlement.lastObservedAt,
    }),
  ).toBe('active');
});

test.each([
  { installationId: randomUUID() },
  {
    edition: 'saas',
    installationId: null,
    kind: 'subscription',
    expiresAt: '2026-12-01T00:00:00Z',
  },
  { startsAt: '2026-11-04T00:00:00Z' },
  { kind: 'subscription', expiresAt: now.toISOString() },
  {
    kind: 'trial',
    startsAt: '2026-10-01T00:00:00Z',
    expiresAt: '2026-10-15T00:00:00Z',
  },
  { sequence: 1 },
  { sequence: 3 },
] as Partial<EntitlementClaims>[])(
  'rejects invalid entitlement context %j',
  (overrides) => {
    expect(() => check([fixture(overrides).row])).toThrow();
  },
);

test('rejects signature tampering, wrong organization, invalid clock and rollback', () => {
  const { row } = fixture();
  expect(() => check([{ ...row, id: randomUUID() }])).toThrow();
  expect(() =>
    check([
      {
        ...row,
        entitlement: {
          ...row.entitlement,
          signedGrant: { ...row.entitlement.signedGrant, keyId: 'unknown' },
        },
      },
    ]),
  ).toThrow();
  expect(() => check([row], new Date(NaN))).toThrow();
  expect(() =>
    check([
      {
        ...row,
        entitlement: {
          ...row.entitlement,
          lastObservedAt: new Date(now.getTime() + 1),
        },
      },
    ]),
  ).toThrow();
  expect(() =>
    check([
      { ...row, entitlement: { ...row.entitlement, highestSequence: NaN } },
    ]),
  ).toThrow();
});
