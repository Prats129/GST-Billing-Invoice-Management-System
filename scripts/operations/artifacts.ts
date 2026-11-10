import { createReadStream, constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, copyFile, open, link, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

export async function fileHash(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
// Only call with the digest from a just-completed authenticated restore drill.
// Publish encrypted data exclusively; partial files are never presented as ready.
export async function copyVerifiedArchive(
  source: string,
  destinationDirectory: string,
  expectedDigest: string,
) {
  const name = basename(source),
    sourceInfo = await lstat(source),
    destinationInfo = await lstat(destinationDirectory);
  if (
    !/^backup-[a-f0-9-]{36}\.(gstbackup|gstplatformbackup)$/.test(name) ||
    !/^[a-f0-9]{64}$/.test(expectedDigest) ||
    !sourceInfo.isFile() ||
    sourceInfo.isSymbolicLink() ||
    !destinationInfo.isDirectory() ||
    destinationInfo.isSymbolicLink()
  )
    throw new Error('EXPORT_INPUT_REJECTED');
  const temporary = join(destinationDirectory, '.export-' + randomUUID());
  try {
    if ((await fileHash(source)) !== expectedDigest)
      throw new Error('EXPORT_CHECKSUM_MISMATCH');
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    if (
      (await fileHash(temporary)) !== expectedDigest ||
      (await fileHash(source)) !== expectedDigest
    )
      throw new Error('EXPORT_CHECKSUM_MISMATCH');
    const handle = await open(temporary, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, join(destinationDirectory, name));
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
