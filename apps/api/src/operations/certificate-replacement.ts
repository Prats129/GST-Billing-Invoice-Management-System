import { lstat, open, mkdir, rename, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { loadServerTls } from '../tls.js';
import { acquireUpdateJournal } from './update-journal.js';
import type { UpdatePhase } from './assisted-update.js';
import { assertPrivateDirectory, secureDirectory } from './release-staging.js';
import { readInstallationState } from './installation-state.js';
import {
  certificateHash,
  verifyCertificateTrust,
  certificateLeafHash,
  probeCertificateReadiness,
} from './certificate-probe.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const absolute = z.string().max(1024).refine(isAbsolute);
export const certificateOptionsSchema = z
  .object({
    installationId: z.string().uuid(),
    operationId: z.string().uuid(),
    journalParent: absolute,
    keyPath: absolute,
    certPath: absolute,
    webRoot: absolute,
    origin: z
      .string()
      .url()
      .refine((v) => {
        const u = new URL(v);
        return (
          u.protocol === 'https:' &&
          u.origin === v &&
          !u.username &&
          !u.password
        );
      }),
    trustFile: absolute,
    trustSha256: hash,
  })
  .strict();
export type CertificateOptions = z.infer<typeof certificateOptionsSchema>;
export interface CertificateService {
  audit(): Promise<void>;
  stop(): Promise<void>;
  startPrivate(): Promise<void>;
  assertReady(): Promise<void>;
  admit(): Promise<void>;
}
const pairSchema = z.object({ key: hash, cert: hash }).strict();
const manifestSchema = z
  .object({
    format: z.literal(1),
    options: certificateOptionsSchema,
    installation: z.string().max(4096),
    owner: z.string().max(1024),
    previous: pairSchema,
    replacement: pairSchema,
  })
  .strict();
export class CertificateReplacementError extends Error {
  constructor() {
    super(
      'Certificate operation failed. Keep maintenance active after a stop attempt; inspect the protected certificate journal before explicit recovery.',
    );
  }
}
const contained = (root: string, file: string) => {
  const value = relative(resolve(root), resolve(file));
  return (
    value === '' ||
    (!isAbsolute(value) && value !== '..' && !value.startsWith('..' + sep))
  );
};
async function bytes(path: string, maximum: number) {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    relative(resolve(path), await realpath(path)) !== ''
  )
    throw new Error();
  const file = await open(path, 'r');
  try {
    const checked = await file.stat();
    if (
      checked.dev !== info.dev ||
      checked.ino !== info.ino ||
      checked.size > maximum
    )
      throw new Error();
    const result = Buffer.alloc(maximum + 1);
    let used = 0;
    while (used < result.length) {
      const { bytesRead } = await file.read(
        result,
        used,
        result.length - used,
        used,
      );
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > maximum) {
      result.fill(0);
      throw new Error();
    }
    return result.subarray(0, used);
  } finally {
    await file.close();
  }
}
export { bytes as readCertificateOperationFile };
async function save(path: string, value: Buffer | object) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(
      Buffer.isBuffer(value) ? value : JSON.stringify(value) + '\n',
    );
    await file.sync();
  } finally {
    await file.close();
  }
}
async function active(options: CertificateOptions) {
  const key = await bytes(options.keyPath, 65536);
  try {
    return {
      key: certificateHash(key),
      cert: certificateHash(await bytes(options.certPath, 262144)),
    };
  } finally {
    key.fill(0);
  }
}
async function trust(options: CertificateOptions) {
  const ca = await bytes(options.trustFile, 262144);
  if (certificateHash(ca) !== options.trustSha256) throw new Error();
  return ca;
}
async function validate(options: CertificateOptions) {
  certificateOptionsSchema.parse(options);
  await assertPrivateDirectory(options.journalParent);
  for (const path of [
    options.keyPath,
    options.certPath,
    options.journalParent,
  ]) {
    if (
      contained(options.webRoot, path) ||
      contained(await realpath(options.webRoot), await realpath(path))
    )
      throw new Error();
  }
  if (
    relative(
      await realpath(options.keyPath),
      await realpath(options.certPath),
    ) === ''
  )
    throw new Error();
  const keyInfo = await lstat(options.keyPath);
  const certInfo = await lstat(options.certPath);
  if (keyInfo.dev === certInfo.dev && keyInfo.ino === certInfo.ino)
    throw new Error();
  const installation = await readInstallationState(options.journalParent);
  if (
    [
      options.keyPath,
      options.certPath,
      options.journalParent,
      options.trustFile,
    ].some((path) => contained(installation.appRoot, path))
  )
    throw new Error();
  if (
    installation.installationId !== options.installationId ||
    relative(
      join(installation.appRoot, 'apps', 'web', 'dist'),
      options.webRoot,
    ) !== ''
  )
    throw new Error();
  return JSON.stringify(installation);
}
async function material(
  options: CertificateOptions,
  directory: string,
  expected: z.infer<typeof pairSchema>,
  ca: Buffer,
) {
  await assertPrivateDirectory(directory);
  const keyPath = join(directory, 'key.pem'),
    certPath = join(directory, 'cert.pem');
  const key = await bytes(keyPath, 65536);
  try {
    if (
      certificateHash(key) !== expected.key ||
      certificateHash(await bytes(certPath, 262144)) !== expected.cert
    )
      throw new Error();
  } finally {
    key.fill(0);
  }
  const loaded = loadServerTls({
    TLS_KEY_PATH: keyPath,
    TLS_CERT_PATH: certPath,
    APP_ORIGIN: options.origin,
    WEB_ROOT: options.webRoot,
  })!;
  try {
    await verifyCertificateTrust(loaded, options.origin, ca);
    return loaded;
  } catch (error) {
    loaded.httpsOptions.key.fill(0);
    throw error;
  }
}
async function writeActive(
  path: string,
  value: Buffer,
  expected: string,
  maximum: number,
) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error();
  const file = await open(path, 'r+');
  try {
    const info = await file.stat();
    if (
      info.ino !== before.ino ||
      info.dev !== before.dev ||
      info.size > maximum
    )
      throw new Error();
    const original = Buffer.alloc(maximum + 1);
    let used = 0;
    try {
      while (used < original.length) {
        const result = await file.read(
          original,
          used,
          original.length - used,
          used,
        );
        if (!result.bytesRead) break;
        used += result.bytesRead;
      }
      if (
        used > maximum ||
        certificateHash(original.subarray(0, used)) !== expected
      )
        throw new Error();
    } finally {
      original.fill(0);
    }
    // Preserve the provisioned file identity and service-read ACL. No process may
    // restart until BOTH writes and matching-pair validation have completed.
    await file.truncate(0);
    let written = 0;
    while (written < value.length) {
      const result = await file.write(
        value,
        written,
        value.length - written,
        written,
      );
      if (!result.bytesWritten) throw new Error();
      written += result.bytesWritten;
    }
    await file.truncate(value.length);
    await file.sync();
  } finally {
    await file.close();
  }
}
async function apply(
  options: CertificateOptions,
  selected: NonNullable<ReturnType<typeof loadServerTls>>,
  observed: z.infer<typeof pairSchema>,
  service: CertificateService,
  ca: Buffer,
) {
  await service.audit();
  if (JSON.stringify(await active(options)) !== JSON.stringify(observed))
    throw new Error();
  await writeActive(
    options.keyPath,
    selected.httpsOptions.key,
    observed.key,
    65536,
  );
  await writeActive(
    options.certPath,
    selected.httpsOptions.cert,
    observed.cert,
    262144,
  );
  const checked = loadServerTls({
    TLS_KEY_PATH: options.keyPath,
    TLS_CERT_PATH: options.certPath,
    APP_ORIGIN: options.origin,
    WEB_ROOT: options.webRoot,
  })!;
  try {
    if (
      certificateHash(checked.httpsOptions.key) !==
        certificateHash(selected.httpsOptions.key) ||
      certificateHash(checked.httpsOptions.cert) !==
        certificateHash(selected.httpsOptions.cert)
    )
      throw new Error();
    await service.startPrivate();
    await service.assertReady();
    await probeCertificateReadiness(
      options.origin,
      ca,
      certificateLeafHash(checked.httpsOptions.cert),
    );
    await service.admit();
  } finally {
    checked.httpsOptions.key.fill(0);
  }
}

export async function replaceCertificate(
  options: CertificateOptions,
  source: {
    keyPath: string;
    certPath: string;
    expected?: { key: string; certificate: string };
  },
  service: CertificateService,
  confirmation: { installationId: string; maintenance: boolean },
) {
  let journal: Awaited<ReturnType<typeof acquireUpdateJournal>> | undefined;
  let stopped = false;
  let loaded: NonNullable<ReturnType<typeof loadServerTls>> | undefined;
  let previousKey: Buffer | undefined;
  try {
    if (
      confirmation.installationId !== options.installationId ||
      !confirmation.maintenance
    )
      throw new Error();
    const installation = await validate(options);
    await service.audit();
    await assertPrivateDirectory(resolve(source.keyPath, '..'));
    await assertPrivateDirectory(resolve(source.certPath, '..'));
    loaded = loadServerTls({
      TLS_KEY_PATH: source.keyPath,
      TLS_CERT_PATH: source.certPath,
      APP_ORIGIN: options.origin,
      WEB_ROOT: options.webRoot,
    })!;
    const ca = await trust(options);
    await verifyCertificateTrust(loaded, options.origin, ca);
    previousKey = await bytes(options.keyPath, 65536);
    const previousCert = await bytes(options.certPath, 262144);
    const previous = {
      key: certificateHash(previousKey),
      cert: certificateHash(previousCert),
    };
    const replacement = {
      key: certificateHash(loaded.httpsOptions.key),
      cert: certificateHash(loaded.httpsOptions.cert),
    };
    if (
      source.expected &&
      (replacement.key !== source.expected.key ||
        replacement.cert !== source.expected.certificate)
    )
      throw new Error();
    journal = await acquireUpdateJournal(
      options.journalParent,
      options.installationId,
      options.operationId,
      'certificate',
    );
    const record = (phase: UpdatePhase) =>
      journal!.record({
        operationId: options.operationId,
        installationId: options.installationId,
        version: JSON.parse(installation).version,
        phase,
      });
    await record('acquired');
    if ((await validate(options)) !== installation) throw new Error();
    for (const name of ['previous', 'replacement']) {
      const path = join(journal.directory, name);
      await mkdir(path, { mode: 0o700 });
      await secureDirectory(path);
    }
    await save(join(journal.directory, 'previous', 'key.pem'), previousKey);
    await save(join(journal.directory, 'previous', 'cert.pem'), previousCert);
    await save(
      join(journal.directory, 'replacement', 'key.pem'),
      loaded.httpsOptions.key,
    );
    await save(
      join(journal.directory, 'replacement', 'cert.pem'),
      loaded.httpsOptions.cert,
    );
    const owner = (
      await bytes(
        join(options.journalParent, 'gst-update.lock', 'owner.json'),
        1024,
      )
    ).toString('utf8');
    await save(join(journal.directory, 'certificate.json'), {
      format: 1,
      options,
      installation,
      owner,
      previous,
      replacement,
    });
    await record('stopping');
    stopped = true;
    await service.stop();
    if ((await validate(options)) !== installation) throw new Error();
    await record('switching');
    await apply(options, loaded, previous, service, ca);
    await record('completed');
    await journal.release();
    journal = undefined;
    return { state: 'replaced' as const, operationId: options.operationId };
  } catch {
    if (stopped) {
      try {
        await service.stop();
      } catch {
        /* Never claim recovery. */
      }
    }
    if (journal) {
      try {
        await journal.record({
          operationId: options.operationId,
          installationId: options.installationId,
          version: (await readInstallationState(options.journalParent)).version,
          phase: 'recovery_required',
        });
      } catch {
        /* Retain partial evidence. */
      }
      try {
        await journal.release();
      } catch {
        /* Retain uncertain lock. */
      }
    }
    throw new CertificateReplacementError();
  } finally {
    loaded?.httpsOptions.key.fill(0);
    previousKey?.fill(0);
  }
}

async function evidence(options: CertificateOptions) {
  const installation = await validate(options);
  const directory = join(
    options.journalParent,
    'gst-update-' + options.operationId,
  );
  const lock = join(options.journalParent, 'gst-update.lock');
  await assertPrivateDirectory(directory);
  await assertPrivateDirectory(lock);
  const manifest = manifestSchema.parse(
    JSON.parse(
      (await bytes(join(directory, 'certificate.json'), 16384)).toString(
        'utf8',
      ),
    ),
  );
  if (
    JSON.stringify(manifest.options) !==
      JSON.stringify(certificateOptionsSchema.parse(options)) ||
    manifest.installation !== installation ||
    (await bytes(join(lock, 'owner.json'), 1024)).toString('utf8') !==
      manifest.owner
  )
    throw new Error();
  const owner = z
    .object({
      installationId: z.string().uuid(),
      operationId: z.string().uuid(),
      nonce: z.string().uuid(),
    })
    .strict()
    .parse(JSON.parse(manifest.owner));
  if (
    owner.installationId !== options.installationId ||
    owner.operationId !== options.operationId
  )
    throw new Error();
  const header = JSON.parse(
    (await bytes(join(directory, 'events.jsonl'), 1048576))
      .toString('utf8')
      .split('\n')[0]!,
  );
  if (
    header.operationKind !== 'certificate' ||
    header.operationId !== options.operationId ||
    header.installationId !== options.installationId
  )
    throw new Error();
  return { directory, lock, manifest };
}
export async function inspectCertificateReplacement(
  options: CertificateOptions,
  service: CertificateService,
) {
  try {
    await service.audit();
    const value = await evidence(options);
    return {
      operationId: options.operationId,
      active: await active(options),
      previous: value.manifest.previous,
      replacement: value.manifest.replacement,
    };
  } catch {
    throw new CertificateReplacementError();
  }
}
export async function recoverCertificateReplacement(
  options: CertificateOptions,
  selection: 'previous' | 'replacement',
  observed: z.infer<typeof pairSchema>,
  service: CertificateService,
  confirmation: {
    installationId: string;
    maintenance: boolean;
    operatorStopped: boolean;
  },
) {
  let selected: NonNullable<ReturnType<typeof loadServerTls>> | undefined;
  let claimed = false;
  try {
    if (
      !confirmation.operatorStopped ||
      !confirmation.maintenance ||
      confirmation.installationId !== options.installationId ||
      !['previous', 'replacement'].includes(selection)
    )
      throw new Error();
    pairSchema.parse(observed);
    await service.audit();
    const value = await evidence(options),
      ca = await trust(options);
    selected = await material(
      options,
      join(value.directory, selection),
      value.manifest[selection],
      ca,
    );
    // Stale inspection is a precondition failure, not a claimed recovery. The
    // caller may inspect again; a change after claiming still keeps the lock.
    if (JSON.stringify(await active(options)) !== JSON.stringify(observed))
      throw new Error();
    const claim = join(value.lock, 'certificate-recovery.lock');
    await mkdir(claim, { mode: 0o700 });
    await secureDirectory(claim);
    claimed = true;
    await save(join(claim, 'intent.json'), { selection, observed });
    await service.stop();
    if ((await validate(options)) !== value.manifest.installation)
      throw new Error();
    await apply(options, selected, observed, service, ca);
    await save(join(claim, 'completed.json'), {
      state: 'recovered',
      selection,
    });
    if (
      (await bytes(join(value.lock, 'owner.json'), 1024)).toString('utf8') !==
      value.manifest.owner
    )
      throw new Error();
    await rename(
      value.lock,
      join(value.directory, 'certificate-recovered-' + randomUUID()),
    );
    return { state: 'recovered' as const, selection };
  } catch {
    if (claimed) {
      try {
        await service.stop();
      } catch {
        /* Report no false success. */
      }
    }
    throw new CertificateReplacementError();
  } finally {
    selected?.httpsOptions.key.fill(0);
  }
}
