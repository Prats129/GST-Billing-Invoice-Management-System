import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rmdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { UpdateHost, UpdateRecord } from './assisted-update.js';
import { secureDirectory } from './release-staging.js';

export const recordSchema = z
  .object({
    operationId: z.string().uuid(),
    installationId: z.string().uuid(),
    version: z
      .string()
      .regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/),
    phase: z.enum([
      'acquired',
      'validated',
      'stopping',
      'stopped',
      'backing_up',
      'preparing',
      'ready_to_switch',
      'switching',
      'starting',
      'validating',
      'completed',
      'recovery_required',
    ]),
  })
  .strict();

export class UpdateJournalError extends Error {
  constructor() {
    super(
      'Update journal unavailable. Inspect the protected operation and lock before retrying.',
    );
  }
}

/**
 * Use ONE protected journal parent per installation, selected by the trusted
 * host configuration, never by package contents or tenant input. Incomplete
 * operations retain their lock for explicit operator reconciliation.
 */
export async function acquireUpdateJournal(
  parent: string,
  installationId: string,
  operationId: string,
  operationKind?: 'certificate' | 'uninstall' | 'repair',
): Promise<
  Pick<UpdateHost, 'record'> & { release(): Promise<void>; directory: string }
> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    z.string().uuid().parse(installationId);
    z.string().uuid().parse(operationId);
    parent = resolve(parent);
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
    const lock = join(parent, 'gst-update.lock');
    // mkdir is exclusive. Never reuse/remove an existing lock, even after reboot.
    await mkdir(lock, { mode: 0o700 });
    await secureDirectory(lock);
    const ownerPath = join(lock, 'owner.json');
    const owner = JSON.stringify({
      installationId,
      operationId,
      nonce: randomUUID(),
    });
    const ownerFile = await open(ownerPath, 'wx', 0o600);
    try {
      await ownerFile.writeFile(owner);
      await ownerFile.sync();
    } finally {
      await ownerFile.close();
    }
    const directory = join(parent, `gst-update-${operationId}`);
    await mkdir(directory, { mode: 0o700 });
    await secureDirectory(directory);
    file = await open(join(directory, 'events.jsonl'), 'wx', 0o600);
    await file.writeFile(
      JSON.stringify({
        event: 'update_journal_created',
        installationId,
        operationId,
        recordedAt: new Date().toISOString(),
        ...(operationKind ? { operationKind } : {}),
      }) + '\n',
    );
    await file.sync();
    const events = file;
    let closed = false;
    let poisoned = false;
    let last: UpdateRecord | undefined;
    // Serialize writes; never append behind a failed fsync or partial write.
    let pending: Promise<void> = Promise.resolve();
    const record = (value: UpdateRecord): Promise<void> => {
      let parsed: UpdateRecord;
      try {
        parsed = recordSchema.parse(value);
        if (
          closed ||
          parsed.operationId !== operationId ||
          parsed.installationId !== installationId
        )
          throw new Error();
      } catch {
        return Promise.reject(new UpdateJournalError());
      }
      const next = pending.then(async () => {
        if (poisoned) throw new UpdateJournalError();
        try {
          await events.writeFile(
            JSON.stringify({
              ...parsed,
              recordedAt: new Date().toISOString(),
            }) + '\n',
          );
          await events.sync();
          last = parsed;
        } catch {
          poisoned = true;
          throw new UpdateJournalError();
        }
      });
      pending = next;
      return next;
    };
    const release = async () => {
      if (closed) throw new UpdateJournalError();
      closed = true;
      try {
        try {
          await pending;
        } finally {
          await events.close();
        }
        // Preserve unfinished/failed lock and every recovery record. No stale-
        // lock timeout, automatic resume, recursive cleanup or data deletion.
        if (poisoned || (last && last.phase !== 'completed')) return;
        const ownerInfo = await lstat(ownerPath);
        if (
          !ownerInfo.isFile() ||
          ownerInfo.isSymbolicLink() ||
          ownerInfo.size > 1024 ||
          (await readFile(ownerPath, 'utf8')) !== owner
        )
          throw new Error();
        await unlink(ownerPath);
        await rmdir(lock); // Unknown extra files cause failure, never recursive delete.
      } catch {
        throw new UpdateJournalError();
      }
    };
    file = undefined; // Returned lease owns the handle now.
    return { directory, record, release };
  } catch {
    try {
      await file?.close();
    } catch {
      /* Preserve lock on all storage failures. */
    }
    // A partially created lock is deliberately retained for operator inspection.
    throw new UpdateJournalError();
  }
}
