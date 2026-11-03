// Publisher/operator tooling only. Not imported by the API or web application.
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import {
  entitlementClaimsSchema,
  signedEntitlementSchema,
} from '../../packages/contracts/dist/index.js';
import type {
  SignedEntitlement,
  EntitlementClaims,
} from '../../packages/contracts/dist/index.js';
import {
  loadEntitlementTrust,
  verifyEntitlement,
} from '../../apps/api/src/licensing/entitlement.js';

export class IssuerError extends Error {
  constructor() {
    super(
      'License issuance failed. Check approved claims, previous grant, encrypted issuer key and trusted public keys.',
    );
  }
}

export function loadIssuerKey(pem: Buffer, passphrase: Buffer): KeyObject {
  try {
    if (
      pem.length > 16384 ||
      !pem
        .toString('ascii')
        .startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----') ||
      !passphrase.length
    )
      throw new IssuerError();
    const key = createPrivateKey({ key: pem, format: 'pem', passphrase });
    if (key.asymmetricKeyType !== 'ed25519') throw new IssuerError();
    return key;
  } catch {
    throw new IssuerError();
  }
}

export function issueEntitlement(options: {
  claims: unknown;
  keyId: string;
  privateKey: KeyObject;
  trust: unknown;
  previousGrant?: unknown;
}): SignedEntitlement {
  try {
    const claims = entitlementClaimsSchema.parse(options.claims);
    const trust = approvedIssuerTrust(
      options.keyId,
      options.privateKey,
      options.trust,
    );
    if (options.previousGrant !== undefined) {
      const previous = verifyEntitlement(options.previousGrant, trust);
      assertSuccessor(claims, previous);
      // An installation transfer can change the binding only via this publisher
      // operation. Disconnected copies cannot be revoked immediately.
    } else if (claims.sequence !== 1) throw new IssuerError();
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const envelope = signedEntitlementSchema.parse({
      keyId: options.keyId,
      payload,
      signature: sign(
        null,
        Buffer.from(`GST-ENTITLEMENT-V1\n${options.keyId}\n${payload}`),
        options.privateKey,
      ).toString('base64url'),
    });
    // Exercise the customer's actual verifier before publishing any grant.
    verifyEntitlement(envelope, trust);
    return envelope;
  } catch {
    throw new IssuerError();
  }
}

export function assertSuccessor(
  claims: EntitlementClaims,
  previous: EntitlementClaims,
) {
  if (
    claims.organizationId !== previous.organizationId ||
    claims.edition !== previous.edition ||
    claims.sequence !== previous.sequence + 1 ||
    claims.entitlementId === previous.entitlementId ||
    Date.parse(claims.issuedAt) < Date.parse(previous.issuedAt) ||
    claims.kind === 'trial'
  )
    throw new IssuerError();
}

export function approvedIssuerTrust(
  keyId: string,
  privateKey: KeyObject,
  value: unknown,
) {
  const trust = loadEntitlementTrust(value);
  const approved = trust.get(keyId);
  if (
    !approved ||
    privateKey.type !== 'private' ||
    privateKey.asymmetricKeyType !== 'ed25519' ||
    !approved
      .export({ type: 'spki', format: 'der' })
      .equals(
        createPublicKey(privateKey).export({ type: 'spki', format: 'der' }),
      )
  )
    throw new IssuerError();
  return trust;
}
