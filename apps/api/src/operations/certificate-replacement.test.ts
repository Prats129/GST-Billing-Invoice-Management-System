import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer } from 'node:https';
import type { Server } from 'node:https';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  lstat,
} from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { secureDirectory, assertPrivateDirectory } from './release-staging.js';
import { initializeInstallationState } from './installation-state.js';
import {
  certificateHash,
  certificateLeafHash,
  probeCertificateReadiness,
} from './certificate-probe.js';
import {
  replaceCertificate,
  inspectCertificateReplacement,
  recoverCertificateReplacement,
} from './certificate-replacement.js';
import { inspectFailedUpdate } from './update-recovery.js';
import { acquireUpdateJournal } from './update-journal.js';

const parent =
  process.platform === 'win32'
    ? (process.env.LOCALAPPDATA ?? tmpdir())
    : tmpdir();
const openssl =
  process.env.TEST_OPENSSL_PATH ??
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'
    : 'openssl');
const run = (args: string[]) =>
  promisify(execFile)(openssl, args, { timeout: 20000, windowsHide: true });
const roots: string[] = [];
const close: (() => Promise<void>)[] = [];
let materialRoot: string;
async function cleanup(root: string) {
  if (
    dirname(resolve(root)) !== resolve(parent) ||
    !basename(root).startsWith('gst-cert-test-')
  )
    throw new Error('Unsafe fixture cleanup.');
  await rm(root, { recursive: true, force: true });
}
beforeAll(async () => {
  materialRoot = await mkdtemp(join(parent, 'gst-cert-test-'));
  await secureDirectory(materialRoot);
  const rootKey = join(materialRoot, 'ca.key'),
    ca = join(materialRoot, 'ca.pem');
  for (const name of ['ca', 'previous', 'replacement', 'wrong']) {
    const path = name === 'ca' ? rootKey : join(materialRoot, name + '.key');
    await writeFile(
      path,
      generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }),
      { mode: 0o600 },
    );
  }
  await run([
    'req',
    '-new',
    '-x509',
    '-key',
    rootKey,
    '-out',
    ca,
    '-days',
    '90',
    '-subj',
    '/CN=Ephemeral certificate test CA',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
  ]);
  for (const [index, name] of ['previous', 'replacement', 'wrong'].entries()) {
    const csr = join(materialRoot, name + '.csr'),
      extension = join(materialRoot, name + '.ext');
    await writeFile(
      extension,
      'basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=' +
        (name === 'wrong'
          ? 'DNS:wrong.invalid'
          : 'DNS:localhost,IP:127.0.0.1') +
        '\n',
    );
    await run([
      'req',
      '-new',
      '-key',
      join(materialRoot, name + '.key'),
      '-out',
      csr,
      '-subj',
      '/CN=Certificate test',
    ]);
    await run([
      'x509',
      '-req',
      '-in',
      csr,
      '-CA',
      ca,
      '-CAkey',
      rootKey,
      '-set_serial',
      String(index + 1),
      '-days',
      name === 'previous' ? '1' : '90',
      '-extfile',
      extension,
      '-out',
      join(materialRoot, name + '.pem'),
    ]);
  }
}, 120000);
afterEach(async () => {
  vi.restoreAllMocks();
  for (const stop of close.splice(0)) await stop();
  for (const root of roots.splice(0)) await cleanup(root);
});
afterAll(async () => {
  if (materialRoot) await cleanup(materialRoot);
});

async function fixture() {
  const root = await mkdtemp(join(parent, 'gst-cert-test-'));
  roots.push(root);
  await secureDirectory(root);
  const journals = join(root, 'journals'),
    appRoot = join(root, 'app');
  const webRoot = join(appRoot, 'apps', 'web', 'dist');
  const activeRoot = join(root, 'active');
  await mkdir(webRoot, { recursive: true });
  await mkdir(journals);
  await secureDirectory(journals);
  await mkdir(activeRoot);
  await secureDirectory(activeRoot);
  const keyPath = join(activeRoot, 'key.pem'),
    certPath = join(activeRoot, 'cert.pem');
  await writeFile(keyPath, await readFile(join(materialRoot, 'previous.key')), {
    mode: 0o600,
  });
  await writeFile(
    certPath,
    await readFile(join(materialRoot, 'previous.pem')),
    { mode: 0o600 },
  );
  const installationId = randomUUID(),
    operationId = randomUUID();
  await initializeInstallationState(journals, {
    format: 1,
    installationId,
    version: '1.0.0',
    schemaDigest: 'a'.repeat(64),
    appRoot,
    operationId: null,
  });
  let server: Server | undefined;
  let port = 0;
  const stop = async () => {
    if (!server) return;
    const current = server;
    server = undefined;
    current.closeAllConnections();
    await new Promise<void>((resolve) => current.close(() => resolve()));
  };
  close.push(stop);
  const start = async () => {
    server = createServer(
      { key: await readFile(keyPath), cert: await readFile(certPath) },
      (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'ready', database: 'up' }));
      },
    );
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(port, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error();
    port = address.port;
  };
  await start();
  const service = {
    audit: vi.fn(() => assertPrivateDirectory(activeRoot)),
    stop: vi.fn(stop),
    startPrivate: vi.fn(start),
    assertReady: vi.fn(async () => {}),
    admit: vi.fn(async () => {}),
  };
  const ca = await readFile(join(materialRoot, 'ca.pem'));
  const options = {
    installationId,
    operationId,
    journalParent: journals,
    keyPath,
    certPath,
    webRoot,
    origin: 'https://127.0.0.1:' + port,
    trustFile: join(materialRoot, 'ca.pem'),
    trustSha256: certificateHash(ca),
  };
  const source = {
    keyPath: join(materialRoot, 'replacement.key'),
    certPath: join(materialRoot, 'replacement.pem'),
  };
  const confirmation = { installationId, maintenance: true };
  return { root, options, source, service, ca, confirmation };
}

test('replacement validates trusted TLS, preserves file identity and original pair, then admits the new live certificate', async () => {
  const f = await fixture();
  const inode = (await lstat(f.options.keyPath)).ino;
  await expect(
    replaceCertificate(f.options, f.source, f.service, f.confirmation),
  ).resolves.toMatchObject({ state: 'replaced' });
  expect((await lstat(f.options.keyPath)).ino).toBe(inode);
  expect(await readFile(f.options.certPath)).toEqual(
    await readFile(f.source.certPath),
  );
  const directory = join(
    f.options.journalParent,
    'gst-update-' + f.options.operationId,
  );
  expect(await readFile(join(directory, 'previous', 'cert.pem'))).toEqual(
    await readFile(join(materialRoot, 'previous.pem')),
  );
  expect(f.service.admit).toHaveBeenCalledOnce();
  await probeCertificateReadiness(
    f.options.origin,
    f.ca,
    certificateLeafHash(await readFile(f.source.certPath)),
  );
  await expect(
    lstat(join(f.options.journalParent, 'gst-update.lock')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
}, 120000);

test('wrong hostname, wrong approved trust and missing confirmation fail before stopping a running service', async () => {
  const f = await fixture();
  await expect(
    replaceCertificate(f.options, f.source, f.service, {
      ...f.confirmation,
      maintenance: false,
    }),
  ).rejects.toThrow();
  await expect(
    replaceCertificate(
      f.options,
      {
        keyPath: join(materialRoot, 'wrong.key'),
        certPath: join(materialRoot, 'wrong.pem'),
      },
      f.service,
      f.confirmation,
    ),
  ).rejects.toThrow();
  await expect(
    replaceCertificate(
      {
        ...f.options,
        trustFile: join(materialRoot, 'wrong.pem'),
        trustSha256: certificateHash(
          await readFile(join(materialRoot, 'wrong.pem')),
        ),
      },
      f.source,
      f.service,
      f.confirmation,
    ),
  ).rejects.toThrow();
  expect(f.service.stop).not.toHaveBeenCalled();
  expect(f.service.admit).not.toHaveBeenCalled();
}, 120000);

test('failed admission remains stopped and explicitly restores the retained pair; the application updater refuses the certificate journal', async () => {
  const f = await fixture();
  f.service.admit.mockRejectedValueOnce(
    new Error('Injected admission failure'),
  );
  await expect(
    replaceCertificate(f.options, f.source, f.service, f.confirmation),
  ).rejects.toThrow();
  const inspected = await inspectCertificateReplacement(f.options, f.service);
  expect(inspected.active).toEqual(inspected.replacement);
  await expect(
    inspectFailedUpdate({
      operationId: f.options.operationId,
      installationId: f.options.installationId,
      journalParent: f.options.journalParent,
      installedRoot: join(f.root, 'app'),
      stagedRoot: join(f.root, 'other'),
      installed: { version: '1.0.0', schemaDigest: 'a'.repeat(64) },
      connectionString: 'postgresql://op:fixture@127.0.0.1/gst_fixture',
      runtimeConnectionString:
        'postgresql://runtime:fixture@127.0.0.1/gst_fixture',
      releaseTrust: new Map(),
    }),
  ).rejects.toThrow();
  await expect(
    recoverCertificateReplacement(
      f.options,
      'previous',
      inspected.active,
      f.service,
      { ...f.confirmation, operatorStopped: true },
    ),
  ).resolves.toMatchObject({ state: 'recovered', selection: 'previous' });
  expect(await readFile(f.options.certPath)).toEqual(
    await readFile(join(materialRoot, 'previous.pem')),
  );
  await expect(
    probeCertificateReadiness(
      f.options.origin,
      f.ca,
      certificateLeafHash(await readFile(f.source.certPath)),
    ),
  ).rejects.toThrow();
}, 120000);

test('an interrupted partial pair is inspected and repaired explicitly; stale inspection hashes cannot silently overwrite it', async () => {
  const f = await fixture();
  f.service.startPrivate.mockRejectedValueOnce(
    new Error('Injected startup failure'),
  );
  await expect(
    replaceCertificate(f.options, f.source, f.service, f.confirmation),
  ).rejects.toThrow();
  const inspected = await inspectCertificateReplacement(f.options, f.service);
  await writeFile(f.options.keyPath, 'partial interrupted key');
  await expect(
    recoverCertificateReplacement(
      f.options,
      'replacement',
      inspected.active,
      f.service,
      { ...f.confirmation, operatorStopped: true },
    ),
  ).rejects.toThrow();
  expect(f.service.admit).not.toHaveBeenCalled();
  // Stale inspection did not claim recovery. A fresh explicit inspection can
  // repair the partial pair while the original update lock is still held.
  await expect(
    recoverCertificateReplacement(
      f.options,
      'replacement',
      (await inspectCertificateReplacement(f.options, f.service)).active,
      f.service,
      { ...f.confirmation, operatorStopped: true },
    ),
  ).resolves.toMatchObject({ state: 'recovered', selection: 'replacement' });
}, 120000);

test('an unresolved application update lock excludes certificate maintenance before any stop', async () => {
  const f = await fixture();
  const operationId = randomUUID();
  const journal = await acquireUpdateJournal(
    f.options.journalParent,
    f.options.installationId,
    operationId,
  );
  await journal.record({
    operationId,
    installationId: f.options.installationId,
    version: '1.0.0',
    phase: 'validated',
  });
  await journal.release();
  await expect(
    replaceCertificate(f.options, f.source, f.service, f.confirmation),
  ).rejects.toThrow();
  expect(f.service.stop).not.toHaveBeenCalled();
}, 120000);

test('an expired retained certificate cannot be recovered; the validated replacement can restore service instead', async () => {
  const f = await fixture();
  f.service.admit.mockRejectedValueOnce(new Error('Injected failure'));
  await expect(
    replaceCertificate(f.options, f.source, f.service, f.confirmation),
  ).rejects.toThrow();
  const inspected = await inspectCertificateReplacement(f.options, f.service);
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 2 * 86400000);
  await expect(
    recoverCertificateReplacement(
      f.options,
      'previous',
      inspected.active,
      f.service,
      { ...f.confirmation, operatorStopped: true },
    ),
  ).rejects.toThrow();
  expect(f.service.startPrivate).toHaveBeenCalledTimes(1);
  await expect(
    recoverCertificateReplacement(
      f.options,
      'replacement',
      inspected.active,
      f.service,
      { ...f.confirmation, operatorStopped: true },
    ),
  ).resolves.toMatchObject({ state: 'recovered' });
}, 120000);
