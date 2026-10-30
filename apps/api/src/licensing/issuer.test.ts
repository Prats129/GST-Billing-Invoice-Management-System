import { expect, test } from 'vitest';
import { createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  issueEntitlement,
  loadIssuerKey,
} from '../../../../scripts/issuer/entitlement.js';
import { loadEntitlementTrust, verifyEntitlement } from './entitlement.js';

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const trust = {
    publisher: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
  const claims = {
    version: 1,
    entitlementId: randomUUID(),
    organizationId: randomUUID(),
    sequence: 1,
    issuedAt: '2026-10-30T00:00:00Z',
    startsAt: '2026-10-30T00:00:00Z',
    expiresAt: '2026-11-13T00:00:00Z',
    maintenanceUntil: null,
    kind: 'trial',
    edition: 'offline',
    installationId: randomUUID(),
  };
  return { privateKey, trust, claims, keyId: 'publisher' };
}
test('publisher-signed trial is accepted by the actual consumer verifier', () => {
  const f = fixture();
  expect(
    verifyEntitlement(issueEntitlement(f), loadEntitlementTrust(f.trust)),
  ).toEqual(f.claims);
});
test('renewal and approved host replacement require the next sequence and preserve the organization', () => {
  const f = fixture();
  const previousGrant = issueEntitlement(f);
  const claims = {
    ...f.claims,
    kind: 'perpetual',
    expiresAt: null,
    sequence: 2,
    entitlementId: randomUUID(),
    installationId: randomUUID(),
  };
  const renewal = issueEntitlement({ ...f, claims, previousGrant });
  expect(verifyEntitlement(renewal, loadEntitlementTrust(f.trust))).toEqual(
    claims,
  );
  for (const invalid of [
    { ...claims, sequence: 1 },
    { ...claims, sequence: 3 },
    { ...claims, organizationId: randomUUID() },
    { ...claims, entitlementId: f.claims.entitlementId },
    { ...f.claims, sequence: 2, entitlementId: randomUUID() },
  ])
    expect(() =>
      issueEntitlement({ ...f, claims: invalid, previousGrant }),
    ).toThrow();
});
test('unknown or mismatched keys and malformed previous grants cannot authorize issuance', () => {
  const f = fixture();
  expect(() => issueEntitlement({ ...f, keyId: 'unapproved' })).toThrow();
  expect(() =>
    issueEntitlement({
      ...f,
      privateKey: generateKeyPairSync('ed25519').privateKey,
    }),
  ).toThrow();
  expect(() =>
    issueEntitlement({ ...f, privateKey: createPublicKey(f.privateKey) }),
  ).toThrow();
  expect(() =>
    issueEntitlement({
      ...f,
      previousGrant: { ...issueEntitlement(f), signature: 'a'.repeat(86) },
    }),
  ).toThrow();
  expect(() =>
    issueEntitlement({ ...f, claims: { ...f.claims, sequence: 2 } }),
  ).toThrow();
});
test('a 14-day SaaS trial has no host binding and unsupported or extended claims are rejected', () => {
  const f = fixture();
  const claims = { ...f.claims, edition: 'saas', installationId: null };
  expect(
    verifyEntitlement(
      issueEntitlement({ ...f, claims }),
      loadEntitlementTrust(f.trust),
    ),
  ).toEqual(claims);
  for (const invalid of [
    { ...claims, installationId: randomUUID() },
    { ...claims, expiresAt: '2026-11-14T00:00:00Z' },
    { ...claims, seatLimit: 100 },
  ])
    expect(() => issueEntitlement({ ...f, claims: invalid })).toThrow();
});
test('issuer keys require encrypted Ed25519 PKCS8 and the correct passphrase', () => {
  const f = fixture();
  const passphrase = Buffer.from('ephemeral-test-passphrase-only');
  const pem = Buffer.from(
    f.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase,
    }),
  );
  expect(loadIssuerKey(pem, passphrase).asymmetricKeyType).toBe('ed25519');
  expect(() => loadIssuerKey(pem, Buffer.from('wrong'))).toThrow();
  expect(() => loadIssuerKey(pem, Buffer.alloc(0))).toThrow();
  expect(() =>
    loadIssuerKey(
      Buffer.from(f.privateKey.export({ type: 'pkcs8', format: 'pem' })),
      passphrase,
    ),
  ).toThrow();
});

test('publisher CLI writes a consumable grant, refuses overwrite and sanitizes failures', async () => {
  const f = fixture();
  const directory = await mkdtemp(join(tmpdir(), 'gst-issuer-cli-'));
  try {
    const claims = join(directory, 'claims.json');
    const trust = join(directory, 'trust.json');
    const key = join(directory, 'ephemeral.key');
    const output = join(directory, 'signed.json');
    const passphrase = 'ephemeral-cli-passphrase-only';
    await writeFile(claims, JSON.stringify(f.claims));
    await writeFile(trust, JSON.stringify(f.trust));
    await writeFile(
      key,
      f.privateKey.export({
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase,
      }),
      { mode: 0o600 },
    );
    const args = [
      '--import',
      'tsx',
      resolve('scripts/issuer/entitlement-cli.ts'),
      '--claims',
      claims,
      '--trust',
      trust,
      '--key-file',
      key,
      '--key-id',
      f.keyId,
      '--output',
      output,
      '--new-organization',
    ];
    const invoke = (password = passphrase) =>
      promisify(execFile)(process.execPath, args, {
        env: { ...process.env, ISSUER_KEY_PASSPHRASE: password },
        timeout: 15000,
      });
    expect((await invoke()).stdout.trim()).toBe(
      '{"event":"entitlement_issued"}',
    );
    const bytes = await readFile(output, 'utf8');
    expect(
      verifyEntitlement(JSON.parse(bytes), loadEntitlementTrust(f.trust)),
    ).toEqual(f.claims);
    await expect(invoke()).rejects.toMatchObject({ code: 1 });
    expect(await readFile(output, 'utf8')).toBe(bytes);
    await rm(output);
    try {
      await invoke('deliberately-wrong-secret');
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toMatchObject({ code: 1, stdout: '' });
      const failure = error as { stderr: string };
      expect(failure.stderr).toContain('entitlement_issue_failed');
      expect(failure.stderr).not.toContain('deliberately-wrong-secret');
      expect(failure.stderr).not.toContain(directory);
    }
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
