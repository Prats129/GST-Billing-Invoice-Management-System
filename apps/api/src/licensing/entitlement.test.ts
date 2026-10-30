import { expect, test } from 'vitest';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { entitlementClaimsSchema } from '@gst/contracts';
import type { EntitlementClaims } from '@gst/contracts';
import {
  entitlementStatus,
  loadEntitlementTrust,
  verifyEntitlement,
} from './entitlement.js';

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const trust = loadEntitlementTrust({
    current: publicKey.export({ type: 'spki', format: 'pem' }),
  });
  const claims: EntitlementClaims = {
    version: 1,
    entitlementId: randomUUID(),
    organizationId: randomUUID(),
    installationId: randomUUID(),
    sequence: 2,
    issuedAt: '2026-10-01T00:00:00Z',
    startsAt: '2026-10-01T00:00:00Z',
    expiresAt: '2026-10-15T00:00:00Z',
    maintenanceUntil: null,
    kind: 'trial',
    edition: 'offline',
  };
  const signed = (value: unknown = claims) => {
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
    return {
      keyId: 'current',
      payload,
      signature: sign(
        null,
        Buffer.from(`GST-ENTITLEMENT-V1\ncurrent\n${payload}`),
        privateKey,
      ).toString('base64url'),
    };
  };
  const context = {
    organizationId: claims.organizationId,
    edition: 'offline' as const,
    installationId: claims.installationId,
    now: new Date('2026-10-14T23:59:59.999Z'),
    highestSequence: 2,
    lastObservedAt: new Date('2026-10-01T00:00:00Z'),
  };
  return { trust, claims, signed, context };
}
test('Ed25519 grant authenticity, tampering and unknown-key rejection', () => {
  const f = fixture(),
    signed = f.signed();
  expect(verifyEntitlement(signed, f.trust)).toEqual(f.claims);
  expect(() =>
    verifyEntitlement(
      { ...signed, payload: f.signed({ ...f.claims, sequence: 3 }).payload },
      f.trust,
    ),
  ).toThrow();
  expect(() =>
    verifyEntitlement({ ...signed, keyId: 'unknown' }, f.trust),
  ).toThrow();
  expect(() =>
    verifyEntitlement({ ...signed, extra: true }, f.trust),
  ).toThrow();
});
test('immediate read-only at exact expiry; no trial extension or unbound offline grant', () => {
  const f = fixture();
  expect(entitlementStatus(f.claims, f.context)).toBe('active');
  expect(
    entitlementStatus(f.claims, {
      ...f.context,
      now: new Date('2026-10-15T00:00:00Z'),
    }),
  ).toBe('expired');
  expect(() =>
    verifyEntitlement(
      f.signed({ ...f.claims, expiresAt: '2026-10-16T00:00:00Z' }),
      f.trust,
    ),
  ).toThrow();
  expect(() =>
    verifyEntitlement(f.signed({ ...f.claims, installationId: null }), f.trust),
  ).toThrow();
});
test('host/organization/edition binding, grant rollback and clock rollback fail closed', () => {
  const f = fixture();
  expect(
    entitlementStatus(f.claims, { ...f.context, organizationId: randomUUID() }),
  ).toBe('wrong_binding');
  expect(
    entitlementStatus(f.claims, { ...f.context, installationId: randomUUID() }),
  ).toBe('wrong_binding');
  expect(entitlementStatus(f.claims, { ...f.context, edition: 'saas' })).toBe(
    'wrong_binding',
  );
  expect(
    entitlementStatus(f.claims, { ...f.context, highestSequence: 3 }),
  ).toBe('rollback');
  expect(
    entitlementStatus(f.claims, {
      ...f.context,
      lastObservedAt: new Date('2026-10-15T00:00:00Z'),
    }),
  ).toBe('clock_rollback');
  expect(
    entitlementStatus(f.claims, {
      ...f.context,
      now: new Date('2026-09-30T00:00:00Z'),
      lastObservedAt: new Date(0),
    }),
  ).toBe('not_started');
});
test('perpetual maintenance expiry does not disable billing; SaaS cannot be perpetual', () => {
  const f = fixture();
  const perpetual = entitlementClaimsSchema.parse({
    ...f.claims,
    kind: 'perpetual',
    expiresAt: null,
    maintenanceUntil: '2026-10-02T00:00:00Z',
  });
  expect(
    entitlementStatus(perpetual, {
      ...f.context,
      now: new Date('2036-01-01T00:00:00Z'),
    }),
  ).toBe('active');
  expect(() =>
    verifyEntitlement(
      f.signed({ ...perpetual, edition: 'saas', installationId: null }),
      f.trust,
    ),
  ).toThrow();
});
test('only bounded Ed25519 public keys can enter the trust store', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  expect(() =>
    loadEntitlementTrust({
      bad: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    }),
  ).toThrow();
  expect(() => loadEntitlementTrust({})).toThrow();
});

test('SaaS subscriptions bind the organization rather than an installation and expire immediately', () => {
  const f = fixture();
  const claims = verifyEntitlement(
    f.signed({
      ...f.claims,
      kind: 'subscription',
      edition: 'saas',
      installationId: null,
    }),
    f.trust,
  );
  const context = {
    ...f.context,
    edition: 'saas' as const,
    installationId: null,
  };
  expect(entitlementStatus(claims, context)).toBe('active');
  expect(
    entitlementStatus(claims, {
      ...context,
      now: new Date('2026-10-15T00:00:00Z'),
    }),
  ).toBe('expired');
  expect(
    entitlementStatus(claims, { ...context, organizationId: randomUUID() }),
  ).toBe('wrong_binding');
});
