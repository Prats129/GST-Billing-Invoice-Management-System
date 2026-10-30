import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, link, open, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const MAGIC = Buffer.from('GSTBKP01');
const MAX_HEADER = 32768;
const MAX_ARCHIVE = 1024 ** 4;
export interface BackupManifest {
  format: 1;
  installationId: string;
  createdAt: string;
  schemaDigest: string;
  archiveBytes: number;
  archiveSha256: string;
  postgresMajor: 18;
  rowCounts: Record<string, number>;
}
export class BackupError extends Error {
  constructor(
    message = 'Backup verification failed; check the key, installation identity and artifact integrity.',
  ) {
    super(message);
  }
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
function manifest(value: unknown): BackupManifest {
  if (!value || typeof value !== 'object') throw new BackupError();
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(',') !==
      'archiveBytes,archiveSha256,createdAt,format,installationId,postgresMajor,rowCounts,schemaDigest' ||
    v.format !== 1 ||
    v.postgresMajor !== 18 ||
    typeof v.installationId !== 'string' ||
    !uuid.test(v.installationId) ||
    typeof v.createdAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.createdAt) ||
    !Number.isFinite(Date.parse(v.createdAt)) ||
    typeof v.schemaDigest !== 'string' ||
    !digest.test(v.schemaDigest) ||
    typeof v.archiveSha256 !== 'string' ||
    !digest.test(v.archiveSha256) ||
    typeof v.archiveBytes !== 'number' ||
    !Number.isSafeInteger(v.archiveBytes) ||
    v.archiveBytes < 5 ||
    v.archiveBytes > MAX_ARCHIVE ||
    !v.rowCounts ||
    typeof v.rowCounts !== 'object' ||
    Array.isArray(v.rowCounts) ||
    Object.keys(v.rowCounts).length > 200 ||
    Object.entries(v.rowCounts).some(
      ([name, count]) =>
        !/^(public|drizzle)\.[a-z_][a-z0-9_]{0,62}$/.test(name) ||
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count < 0,
    )
  )
    throw new BackupError();
  return value as BackupManifest;
}
function validKey(key: Buffer) {
  if (key.length !== 32)
    throw new BackupError('Backup key must contain exactly 32 random bytes.');
}
async function describe(path: string) {
  const hash = createHash('sha256');
  let bytes = 0;
  let prefix = Buffer.alloc(0);
  for await (const chunk of createReadStream(path)) {
    const data = chunk as Buffer;
    bytes += data.length;
    if (bytes > MAX_ARCHIVE)
      throw new BackupError('Archive exceeds supported size.');
    if (prefix.length < 5)
      prefix = Buffer.concat([prefix, data]).subarray(0, 5);
    hash.update(data);
  }
  if (!prefix.equals(Buffer.from('PGDMP')))
    throw new BackupError('Expected a PostgreSQL custom-format archive.');
  return { archiveBytes: bytes, archiveSha256: hash.digest('hex') };
}
// Publish by hard-linking only after authentication succeeds. An existing target
// is never replaced; temporary files stay on the target's filesystem.
async function publish(temp: string, target: string) {
  const file = await open(temp, 'r+');
  try {
    await file.sync();
  } finally {
    await file.close();
  }
  await link(temp, target);
}
export async function encryptBackup(
  archive: string,
  target: string,
  key: Buffer,
  identity: Pick<BackupManifest, 'installationId' | 'schemaDigest'> & {
    rowCounts?: Record<string, number>;
  },
): Promise<BackupManifest> {
  validKey(key);
  const metadata = manifest({
    ...identity,
    rowCounts: identity.rowCounts ?? {},
    format: 1,
    postgresMajor: 18,
    createdAt: new Date().toISOString(),
    ...(await describe(archive)),
  });
  const json = Buffer.from(JSON.stringify(metadata));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  const nonce = randomBytes(12);
  const header = Buffer.concat([MAGIC, length, json, nonce]);
  const temp = `${target}.${randomUUID()}.partial`;
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(header);
  const hash = createHash('sha256');
  const checksum = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    const output = createWriteStream(temp, { flags: 'wx', mode: 0o600 });
    output.write(header);
    await pipeline(createReadStream(archive), checksum, cipher, output);
    if (hash.digest('hex') !== metadata.archiveSha256)
      throw new BackupError('Archive changed during encryption.');
    await appendFile(temp, cipher.getAuthTag());
    await publish(temp, target);
    return metadata;
  } finally {
    await unlink(temp).catch(() => {});
  }
}
export async function decryptBackup(
  artifact: string,
  target: string,
  key: Buffer,
  expected: {
    installationId: string;
    schemaDigest: string | readonly string[];
  },
): Promise<BackupManifest> {
  validKey(key);
  const input = await open(artifact, 'r');
  let header: Buffer;
  let metadata: BackupManifest;
  let tag: Buffer;
  let size: number;
  try {
    size = (await input.stat()).size;
    const prefix = Buffer.alloc(12);
    if (
      (await input.read(prefix, 0, 12, 0)).bytesRead !== 12 ||
      !prefix.subarray(0, 8).equals(MAGIC)
    )
      throw new BackupError();
    const length = prefix.readUInt32BE(8);
    if (
      length < 1 ||
      length > MAX_HEADER ||
      size > MAX_ARCHIVE + MAX_HEADER + 40
    )
      throw new BackupError();
    header = Buffer.alloc(12 + length + 12);
    if (
      (await input.read(header, 0, header.length, 0)).bytesRead !==
      header.length
    )
      throw new BackupError();
    try {
      metadata = manifest(
        JSON.parse(header.subarray(12, 12 + length).toString('utf8')),
      );
    } catch {
      throw new BackupError();
    }
    if (
      metadata.installationId !== expected.installationId ||
      !(typeof expected.schemaDigest === 'string'
        ? metadata.schemaDigest === expected.schemaDigest
        : expected.schemaDigest.includes(metadata.schemaDigest)) ||
      size !== header.length + metadata.archiveBytes + 16
    )
      throw new BackupError();
    tag = Buffer.alloc(16);
    if ((await input.read(tag, 0, 16, size - 16)).bytesRead !== 16)
      throw new BackupError();
  } finally {
    await input.close();
  }
  const temp = `${target}.${randomUUID()}.partial`;
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(-12));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const hash = createHash('sha256');
  const checksum = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      createReadStream(artifact, { start: header.length, end: size - 17 }),
      decipher,
      checksum,
      createWriteStream(temp, { flags: 'wx', mode: 0o600 }),
    );
    if (
      hash.digest('hex') !== metadata.archiveSha256 ||
      (await stat(temp)).size !== metadata.archiveBytes
    )
      throw new BackupError();
    await describe(temp);
    await publish(temp, target);
    return metadata;
  } catch {
    throw new BackupError();
  } finally {
    await unlink(temp).catch(() => {});
  }
}
