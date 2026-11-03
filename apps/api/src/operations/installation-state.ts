import { open, lstat, readFile, rename } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assertPrivateDirectory } from './release-staging.js';

const schema = z
  .object({
    format: z.literal(1),
    installationId: z.string().uuid(),
    version: z
      .string()
      .regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/),
    schemaDigest: z.string().regex(/^[a-f0-9]{64}$/),
    appRoot: z.string().max(1024).refine(isAbsolute),
    operationId: z.string().uuid().nullable(),
  })
  .strict();
export type InstallationState = z.infer<typeof schema>;
export async function readInstallationState(
  parent: string,
): Promise<InstallationState> {
  await assertPrivateDirectory(parent);
  const path = join(parent, 'installation.json');
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16384)
    throw new Error('Invalid protected installation state.');
  const bytes = await readFile(path);
  if (bytes.length > 16384)
    throw new Error('Invalid protected installation state.');
  return schema.parse(JSON.parse(bytes.toString('utf8')));
}
async function write(path: string, state: InstallationState) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(schema.parse(state)) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
}
// Initial installer only, after protecting a NEW parent and validating the host.
// Existing installation records are never silently adopted or overwritten.
export async function initializeInstallationState(
  parent: string,
  state: InstallationState,
) {
  await assertPrivateDirectory(parent);
  await write(join(parent, 'installation.json'), state);
}
// Caller must hold the installation's update or explicit recovery lock.
export async function replaceInstallationState(
  parent: string,
  expected: InstallationState,
  replacement: InstallationState,
) {
  if (
    expected.installationId !== replacement.installationId ||
    JSON.stringify(await readInstallationState(parent)) !==
      JSON.stringify(schema.parse(expected))
  )
    throw new Error('Installation state changed.');
  const temporary = join(parent, 'installation-' + randomUUID() + '.json.tmp');
  await write(temporary, replacement);
  // Same-directory atomic replacement. Preserve uncertain temporary records on
  // filesystem failure for operator inspection, rather than guessing rollback.
  await rename(temporary, join(parent, 'installation.json'));
}
