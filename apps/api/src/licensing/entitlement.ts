import { createPublicKey, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import {
  entitlementClaimsSchema,
  signedEntitlementSchema,
} from '@gst/contracts';
import type { EntitlementClaims } from '@gst/contracts';

export class EntitlementError extends Error {
  constructor() {
    super(
      'Entitlement verification failed. Contact the host/platform operator.',
    );
  }
}
export type EntitlementTrust = ReadonlyMap<string, KeyObject>;
export function loadEntitlementTrust(value: unknown): EntitlementTrust {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EntitlementError();
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 10) throw new EntitlementError();
  const keys = new Map<string, KeyObject>();
  for (const [id, pem] of entries) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id) ||
      typeof pem !== 'string' ||
      pem.length > 2048 ||
      !pem.startsWith('-----BEGIN PUBLIC KEY-----')
    )
      throw new EntitlementError();
    try {
      const key = createPublicKey(pem);
      if (key.asymmetricKeyType !== 'ed25519') throw new EntitlementError();
      keys.set(id, key);
    } catch {
      throw new EntitlementError();
    }
  }
  return keys;
}
export function verifyEntitlement(
  value: unknown,
  trust: EntitlementTrust,
): EntitlementClaims {
  try {
    const grant = signedEntitlementSchema.parse(value);
    const key = trust.get(grant.keyId);
    const payload = Buffer.from(grant.payload, 'base64url');
    const signature = Buffer.from(grant.signature, 'base64url');
    if (
      !key ||
      payload.toString('base64url') !== grant.payload ||
      signature.toString('base64url') !== grant.signature ||
      !verify(
        null,
        Buffer.from(
          `GST-ENTITLEMENT-V1\n${grant.keyId}\n${grant.payload}`,
          'utf8',
        ),
        key,
        signature,
      )
    )
      throw new EntitlementError();
    return entitlementClaimsSchema.parse(JSON.parse(payload.toString('utf8')));
  } catch {
    throw new EntitlementError();
  }
}
export type EntitlementStatus =
  | 'active'
  | 'expired'
  | 'not_started'
  | 'wrong_binding'
  | 'rollback'
  | 'clock_rollback';
export function entitlementStatus(
  claims: EntitlementClaims,
  context: {
    organizationId: string;
    edition: 'offline' | 'saas';
    installationId: string | null;
    now: Date;
    highestSequence: number;
    lastObservedAt: Date;
  },
): EntitlementStatus {
  if (
    !Number.isFinite(context.now.getTime()) ||
    !Number.isFinite(context.lastObservedAt.getTime())
  )
    throw new EntitlementError();
  if (
    claims.organizationId !== context.organizationId ||
    claims.edition !== context.edition ||
    claims.installationId !== context.installationId
  )
    return 'wrong_binding';
  if (claims.sequence < context.highestSequence) return 'rollback';
  if (context.now < context.lastObservedAt) return 'clock_rollback';
  if (context.now.getTime() < Date.parse(claims.startsAt)) return 'not_started';
  if (claims.expiresAt && context.now.getTime() >= Date.parse(claims.expiresAt))
    return 'expired';
  // Maintenance expiry is deliberately independent of perpetual billing rights.
  return 'active';
}
