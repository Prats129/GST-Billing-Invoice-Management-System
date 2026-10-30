import { createHash, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { EntitlementTrust } from '../licensing/entitlement.js';

export class ReleaseError extends Error {
  constructor() {
    super('Release verification failed. Do not install this package.');
  }
}
export interface ReleaseFile {
  path: string;
  bytes: number;
  sha256: string;
}
export interface ReleaseManifest {
  format: 1;
  version: string;
  minimumInstalledVersion: string;
  fromSchemaDigest: string;
  toSchemaDigest: string;
  nodeMajor: 24;
  postgresMajor: 18;
  files: ReleaseFile[];
}
const versionPattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const hashPattern = /^[a-f0-9]{64}$/;
function compare(a: string, b: string) {
  if (!versionPattern.test(a) || !versionPattern.test(b))
    throw new ReleaseError();
  const left = a.split('.').map(Number),
    right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i]! < right[i]! ? -1 : 1;
  return 0;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ReleaseError();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).sort().join(',') !== allowed.sort().join(','))
    throw new ReleaseError();
}
function safePath(path: string) {
  return (
    path.length <= 240 &&
    path
      .split('/')
      .every(
        (part) =>
          /^[a-zA-Z0-9@_.][a-zA-Z0-9@._+-]*$/.test(part) &&
          !['.', '..', '.git', '.local', '.cache'].includes(
            part.toLowerCase(),
          ) &&
          !part.endsWith('.') &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) &&
          !/^\.env(?:\.|$)/i.test(part) &&
          !/\.(key|pem|pfx|p12|dump|gstbackup)$/i.test(part),
      )
  );
}
export function parseReleaseManifest(value: unknown): ReleaseManifest {
  const m = object(value);
  keys(m, [
    'format',
    'version',
    'minimumInstalledVersion',
    'fromSchemaDigest',
    'toSchemaDigest',
    'nodeMajor',
    'postgresMajor',
    'files',
  ]);
  if (
    m.format !== 1 ||
    m.nodeMajor !== 24 ||
    m.postgresMajor !== 18 ||
    typeof m.version !== 'string' ||
    !versionPattern.test(m.version) ||
    typeof m.minimumInstalledVersion !== 'string' ||
    !versionPattern.test(m.minimumInstalledVersion) ||
    typeof m.fromSchemaDigest !== 'string' ||
    !hashPattern.test(m.fromSchemaDigest) ||
    typeof m.toSchemaDigest !== 'string' ||
    !hashPattern.test(m.toSchemaDigest) ||
    !Array.isArray(m.files) ||
    !m.files.length ||
    m.files.length > 10000
  )
    throw new ReleaseError();
  const names = new Set<string>();
  for (const file of m.files) {
    const f = object(file);
    keys(f, ['path', 'bytes', 'sha256']);
    if (
      typeof f.path !== 'string' ||
      f.path.toLowerCase() === 'release.json' ||
      !safePath(f.path) ||
      names.has(f.path.toLowerCase()) ||
      typeof f.bytes !== 'number' ||
      !Number.isSafeInteger(f.bytes) ||
      f.bytes < 0 ||
      f.bytes > 1024 ** 4 ||
      typeof f.sha256 !== 'string' ||
      !hashPattern.test(f.sha256)
    )
      throw new ReleaseError();
    names.add(f.path.toLowerCase());
  }
  return value as ReleaseManifest;
}
export function assertReleaseCompatibility(
  manifest: ReleaseManifest,
  installed: { version: string; schemaDigest: string },
) {
  if (
    compare(manifest.version, installed.version) <= 0 ||
    compare(installed.version, manifest.minimumInstalledVersion) < 0 ||
    manifest.fromSchemaDigest !== installed.schemaDigest
  )
    throw new ReleaseError();
}

// Shared by publisher and customer verification. Include directory names in
// collision checks so a tree accepted on Linux is also safe on Windows.
export async function inspectReleaseFiles(
  root: string,
  expected?: ReadonlyMap<string, ReleaseFile>,
): Promise<ReleaseFile[]> {
  root = resolve(root);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new ReleaseError();
  const files: ReleaseFile[] = [];
  const names = new Set<string>();
  let visited = 0;
  async function walk(relative: string) {
    for (const name of await readdir(join(root, relative))) {
      if (++visited > 20000) throw new ReleaseError();
      const path = relative ? `${relative}/${name}` : name;
      if (path === 'release.json') continue;
      if (
        !safePath(path) ||
        path.toLowerCase() === 'release.json' ||
        names.has(path.toLowerCase())
      )
        throw new ReleaseError();
      names.add(path.toLowerCase());
      const candidate = resolve(root, ...path.split('/'));
      if (!candidate.startsWith(root + sep)) throw new ReleaseError();
      const info = await lstat(candidate);
      if (info.isSymbolicLink()) throw new ReleaseError();
      if (info.isDirectory()) await walk(path);
      else if (info.isFile()) {
        if (files.length >= 10000 || info.size > 1024 ** 4)
          throw new ReleaseError();
        if (expected && expected.get(path)?.bytes !== info.size)
          throw new ReleaseError();
        const hash = createHash('sha256');
        for await (const data of createReadStream(candidate)) hash.update(data);
        files.push({ path, bytes: info.size, sha256: hash.digest('hex') });
      } else throw new ReleaseError();
    }
  }
  await walk('');
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
export async function verifyReleasePackage(
  root: string,
  trust: EntitlementTrust,
  installed: { version: string; schemaDigest: string },
): Promise<ReleaseManifest> {
  try {
    root = resolve(root);
    if (
      !(await lstat(root)).isDirectory() ||
      (await lstat(root)).isSymbolicLink()
    )
      throw new ReleaseError();
    const envelopePath = join(root, 'release.json');
    const info = await lstat(envelopePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024)
      throw new ReleaseError();
    const envelope = object(JSON.parse(await readFile(envelopePath, 'utf8')));
    keys(envelope, ['keyId', 'payload', 'signature']);
    if (
      typeof envelope.keyId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(envelope.keyId) ||
      typeof envelope.payload !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/.test(envelope.payload) ||
      typeof envelope.signature !== 'string' ||
      !/^[a-zA-Z0-9_-]{86}$/.test(envelope.signature)
    )
      throw new ReleaseError();
    const key = trust.get(envelope.keyId),
      payload = Buffer.from(envelope.payload, 'base64url'),
      signature = Buffer.from(envelope.signature, 'base64url');
    if (
      !key ||
      payload.toString('base64url') !== envelope.payload ||
      signature.toString('base64url') !== envelope.signature ||
      !verify(
        null,
        Buffer.from(`GST-RELEASE-V1\n${envelope.keyId}\n${envelope.payload}`),
        key,
        signature,
      )
    )
      throw new ReleaseError();
    const manifest = parseReleaseManifest(JSON.parse(payload.toString('utf8')));
    assertReleaseCompatibility(manifest, installed);
    const expected = new Map(manifest.files.map((file) => [file.path, file]));
    const found = new Map(
      (await inspectReleaseFiles(root, expected)).map((file) => [
        file.path,
        file,
      ]),
    );
    if (found.size !== manifest.files.length) throw new ReleaseError();
    for (const file of manifest.files) {
      const actual = found.get(file.path);
      if (
        !actual ||
        actual.bytes !== file.bytes ||
        actual.sha256 !== file.sha256
      )
        throw new ReleaseError();
    }
    return manifest;
  } catch {
    throw new ReleaseError();
  }
}
