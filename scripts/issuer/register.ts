// Publisher-only, single-authority local register. Never distribute this store
// or import this module in customer API/web code.
import { randomUUID } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { mkdir, open, readdir, lstat, link, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve, relative, dirname } from 'node:path';
import {
  entitlementClaimsSchema,
  signedEntitlementSchema,
} from '../../packages/contracts/dist/index.js';
import type {
  SignedEntitlement,
  EntitlementClaims,
} from '../../packages/contracts/dist/index.js';
import {
  assertPrivateDirectory,
  secureDirectory,
} from '../../apps/api/src/operations/release-staging.js';
import {
  loadEntitlementTrust,
  verifyEntitlement,
} from '../../apps/api/src/licensing/entitlement.js';
import { issueEntitlement, assertSuccessor } from './entitlement.js';
import { readBounded } from './inputs.js';

export class IssuanceRegisterError extends Error {
  constructor() {
    super(
      'Issuance register operation failed. Inspect the protected authoritative register; recover a committed grant by export rather than reissuing or resetting history.',
    );
  }
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fileName = (sequence: number) =>
  sequence.toString().padStart(10, '0') + '.json';
function localAbsolute(path: string) {
  return (
    isAbsolute(path) &&
    (process.platform !== 'win32' || /^[a-zA-Z]:[\\/]/.test(path))
  );
}
async function readJson(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new IssuanceRegisterError();
  return JSON.parse(
    (await readBounded(path, 16384)).toString('utf8'),
  ) as unknown;
}
async function writeExclusive(path: string, value: unknown) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
}
async function flushDirectory(path: string) {
  // Windows cannot fsync a directory through Node. File contents are flushed;
  // NTFS hard-link/power-loss durability still requires native acceptance.
  if (process.platform === 'win32') return;
  const file = await open(path, 'r');
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
export async function initializeIssuanceRegister(directory: string) {
  try {
    if (!localAbsolute(directory)) throw new IssuanceRegisterError();
    await assertPrivateDirectory(dirname(resolve(directory)));
    await mkdir(directory, { mode: 0o700 }); // Explicit NEW store; never adopt/reset.
    await secureDirectory(directory);
    const registerId = randomUUID();
    await writeExclusive(join(directory, 'register.json'), {
      format: 1,
      registerId,
    });
    await flushDirectory(directory);
    await flushDirectory(dirname(directory));
    return { registerId };
  } catch {
    throw new IssuanceRegisterError();
  }
}
async function store(
  options: { directory: string; registerId: string },
  organizationId: string,
  create: boolean,
) {
  if (
    !localAbsolute(options.directory) ||
    !uuid.test(options.registerId) ||
    !uuid.test(organizationId)
  )
    throw new IssuanceRegisterError();
  const root = resolve(options.directory);
  await assertPrivateDirectory(root); // Audit, never repair an existing store.
  const header = (await readJson(join(root, 'register.json'))) as Record<
    string,
    unknown
  >;
  if (
    !header ||
    Object.keys(header).sort().join(',') !== 'format,registerId' ||
    header.format !== 1 ||
    header.registerId !== options.registerId
  )
    throw new IssuanceRegisterError();
  const directory = join(root, organizationId.toLowerCase());
  if (create) {
    try {
      await mkdir(directory, { mode: 0o700 });
      await flushDirectory(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  await assertPrivateDirectory(directory);
  return directory;
}
async function history(
  directory: string,
  organizationId: string,
  trustValue: unknown,
) {
  const trust = loadEntitlementTrust(trustValue);
  const names = (await readdir(directory))
    .filter(
      (name) => !(name.startsWith('.pending-') && uuid.test(name.slice(9))),
    )
    .sort();
  const grants: SignedEntitlement[] = [];
  let previous: EntitlementClaims | undefined;
  for (const [index, name] of names.entries()) {
    if (name !== fileName(index + 1)) throw new IssuanceRegisterError();
    const envelope = signedEntitlementSchema.parse(
      await readJson(join(directory, name)),
    );
    const claims = verifyEntitlement(envelope, trust);
    if (
      claims.organizationId.toLowerCase() !== organizationId.toLowerCase() ||
      claims.sequence !== index + 1
    )
      throw new IssuanceRegisterError();
    if (previous) assertSuccessor(claims, previous);
    previous = claims;
    grants.push(envelope);
  }
  return grants;
}
export async function issueRegisteredEntitlement(options: {
  directory: string;
  registerId: string;
  claims: unknown;
  keyId: string;
  privateKey: KeyObject;
  trust: unknown;
  newOrganization: boolean;
  previousGrant?: unknown;
}) {
  try {
    const claims = entitlementClaimsSchema.parse(options.claims);
    const directory = await store(options, claims.organizationId, true);
    const grants = await history(
      directory,
      claims.organizationId,
      options.trust,
    );
    const previousGrant = grants.at(-1);
    if (
      options.newOrganization !== (previousGrant === undefined) ||
      (previousGrant === undefined && options.previousGrant !== undefined) ||
      (previousGrant !== undefined &&
        JSON.stringify(signedEntitlementSchema.parse(options.previousGrant)) !==
          JSON.stringify(previousGrant))
    )
      throw new IssuanceRegisterError();
    const envelope = issueEntitlement({
      ...options,
      ...(previousGrant ? { previousGrant } : {}),
    });
    const temporary = join(directory, '.pending-' + randomUUID());
    await writeExclusive(temporary, envelope);
    try {
      // Atomic no-replace commit: concurrent issuers for the same next sequence
      // cannot both win. No signed grant is returned before it is recorded.
      await link(temporary, join(directory, fileName(claims.sequence)));
      await flushDirectory(directory);
    } finally {
      await unlink(temporary);
    }
    return envelope;
  } catch {
    throw new IssuanceRegisterError();
  }
}
export async function exportRegisteredEntitlement(options: {
  directory: string;
  registerId: string;
  organizationId: string;
  sequence: number;
  trust: unknown;
}) {
  try {
    if (!Number.isSafeInteger(options.sequence) || options.sequence < 1)
      throw new IssuanceRegisterError();
    const directory = await store(options, options.organizationId, false);
    const grants = await history(
      directory,
      options.organizationId,
      options.trust,
    );
    const grant = grants[options.sequence - 1];
    if (!grant) throw new IssuanceRegisterError();
    return grant;
  } catch {
    throw new IssuanceRegisterError();
  }
}

export function assertGrantOutputPath(directory: string, output: string) {
  const difference = relative(resolve(directory), resolve(output));
  if (
    difference === '' ||
    (!difference.startsWith(
      '..' + (process.platform === 'win32' ? '\\' : '/'),
    ) &&
      difference !== '..' &&
      !isAbsolute(difference))
  )
    throw new IssuanceRegisterError();
}

export async function writeGrantOutput(path: string, grant: SignedEntitlement) {
  // Commit to the register first. An output error must never undo an issuance;
  // export that exact signed envelope to a new output path after inspection.
  await writeExclusive(path, grant);
}
