import { sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { approvedIssuerTrust } from './entitlement.js';
import {
  assertReleaseCompatibility,
  inspectReleaseFiles,
  parseReleaseManifest,
  ReleaseError,
  verifyReleasePackage,
} from '../../apps/api/src/operations/release-package.js';

export async function signReleasePackage(options: {
  root: string;
  metadata: unknown;
  keyId: string;
  privateKey: KeyObject;
  trust: unknown;
}) {
  const trust = approvedIssuerTrust(
    options.keyId,
    options.privateKey,
    options.trust,
  );
  if (
    !options.metadata ||
    typeof options.metadata !== 'object' ||
    Array.isArray(options.metadata) ||
    'files' in options.metadata
  )
    throw new ReleaseError();
  const manifest = parseReleaseManifest({
    ...options.metadata,
    files: await inspectReleaseFiles(options.root),
  });
  const baseline = {
    version: manifest.minimumInstalledVersion,
    schemaDigest: manifest.fromSchemaDigest,
  };
  assertReleaseCompatibility(manifest, baseline);
  const payload = Buffer.from(JSON.stringify(manifest)).toString('base64url');
  const envelope =
    JSON.stringify({
      keyId: options.keyId,
      payload,
      signature: sign(
        null,
        Buffer.from(`GST-RELEASE-V1\n${options.keyId}\n${payload}`),
        options.privateKey,
      ).toString('base64url'),
    }) + '\n';
  if (Buffer.byteLength(envelope) > 2 * 1024 * 1024) throw new ReleaseError();
  await writeFile(join(options.root, 'release.json'), envelope, {
    flag: 'wx',
    mode: 0o600,
  });
  // If final verification fails, quarantine the staging directory. Never execute
  // package contents or delete another publisher's files as an attempted repair.
  await verifyReleasePackage(options.root, trust, baseline);
  return manifest;
}
