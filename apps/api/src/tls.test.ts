import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { generateKeyPairSync, X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { request } from 'node:https';
import { certificateStatus, loadServerTls, monitorServerTls } from './tls.js';
import { createApp } from './app.js';
import { parseConfig } from './config.js';

const day = 86400000;
const openssl =
  process.env.TEST_OPENSSL_PATH ??
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'
    : 'openssl');
let directory: string;
let keyPath: string;
let otherKeyPath: string;
let publicCertificate: Buffer;
let validity: { startsAt: number; expiresAt: number };
const files: Record<string, string> = {};
const run = (args: string[]) =>
  promisify(execFile)(openssl, args, { timeout: 20000, windowsHide: true });
const config = (name = 'server', origin = 'https://localhost:3443') => ({
  TLS_KEY_PATH: keyPath,
  TLS_CERT_PATH: files[name]!,
  APP_ORIGIN: origin,
});
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gst-tls-fixture-'));
  await mkdir(join(directory, 'public'));
  keyPath = join(directory, 'server.key.pem');
  otherKeyPath = join(directory, 'other.key.pem');
  for (const path of [keyPath, otherKeyPath]) {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await writeFile(path, privateKey.export({ format: 'pem', type: 'pkcs8' }), {
      mode: 0o600,
      flag: 'wx',
    });
  }
  for (const name of ['server', 'client', 'cn_only', 'ca', 'partial']) {
    files[name] = join(directory, name + '.cert.pem');
    const args = [
      'req',
      '-new',
      '-x509',
      '-key',
      name === 'ca' ? otherKeyPath : keyPath,
      '-out',
      files[name]!,
      '-days',
      name === 'ca' ? '5' : '90',
      '-subj',
      name === 'ca' ? '/CN=GST fixture root' : '/CN=localhost',
      '-addext',
      'basicConstraints=critical,CA:' + (name === 'ca' ? 'TRUE' : 'FALSE'),
    ];
    if (name !== 'ca')
      args.push(
        '-addext',
        'extendedKeyUsage=' + (name === 'client' ? 'clientAuth' : 'serverAuth'),
      );
    if (name === 'partial')
      args.push('-addext', 'subjectAltName=DNS:loc*alhost');
    else if (name !== 'cn_only' && name !== 'ca')
      args.push('-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1');
    await run(args);
  }
  const csr = join(directory, 'server.csr');
  const extension = join(directory, 'server.ext');
  const signed = join(directory, 'signed.cert.pem');
  await writeFile(
    extension,
    'basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n',
  );
  await run([
    'req',
    '-new',
    '-key',
    keyPath,
    '-subj',
    '/CN=localhost',
    '-out',
    csr,
  ]);
  await run([
    'x509',
    '-req',
    '-in',
    csr,
    '-CA',
    files.ca!,
    '-CAkey',
    otherKeyPath,
    '-set_serial',
    '1',
    '-days',
    '90',
    '-extfile',
    extension,
    '-out',
    signed,
  ]);
  files.chain = join(directory, 'chain.cert.pem');
  await writeFile(
    files.chain,
    Buffer.concat([await readFile(signed), await readFile(files.ca!)]),
  );
  files.detached = join(directory, 'detached.cert.pem');
  publicCertificate = await readFile(files.server!);
  await writeFile(
    files.detached,
    Buffer.concat([publicCertificate, await readFile(files.ca!)]),
  );
  const certificate = new X509Certificate(publicCertificate);
  validity = {
    startsAt: Date.parse(certificate.validFrom),
    expiresAt: Date.parse(certificate.validTo),
  };
}, 120000);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  if (directory) {
    const parent = resolve(tmpdir()) + sep;
    const target = resolve(directory);
    if (
      !target.startsWith(parent) ||
      !target.split(sep).at(-1)?.startsWith('gst-tls-fixture-')
    )
      throw new Error('Unexpected TLS fixture cleanup target');
    await rm(target, { recursive: true, force: true });
  }
});
test('HTTP development requires no certificates or timer', () => {
  expect(
    loadServerTls({ APP_ORIGIN: 'http://localhost:5173' }),
  ).toBeUndefined();
});

test('rejects a TLS private key stored under the public frontend root', () => {
  const unsafe = { ...config(), WEB_ROOT: directory };
  expect(() => loadServerTls(unsafe)).toThrow(
    expect.objectContaining({ code: 'private_key_in_web_root' }),
  );
});

test('allows a private key outside the separate public frontend directory', () => {
  const safe = { ...config(), WEB_ROOT: join(directory, 'public') };
  expect(loadServerTls(safe)?.httpsOptions.minVersion).toBe('TLSv1.2');
});
test.each([
  'https://localhost:3443',
  'https://127.0.0.1:3443',
  'https://[::1]:3443',
])('valid server certificate matches DNS/IP origin %s', (origin) => {
  expect(loadServerTls(config('server', origin))?.httpsOptions.minVersion).toBe(
    'TLSv1.2',
  );
});
test.each([
  ['client', 'invalid_server_usage'],
  ['ca', 'ca_used_as_leaf'],
  ['cn_only', 'hostname_mismatch'],
  ['partial', 'hostname_mismatch'],
  ['detached', 'invalid_certificate'],
])('rejects %s certificate configuration', (name, code) => {
  expect(() => loadServerTls(config(name))).toThrow(
    expect.objectContaining({ code }),
  );
});
test('rejects wrong hostname, key mismatch, expiry and future validity without secret error content', () => {
  expect(() =>
    loadServerTls(config('server', 'https://other.example:3443')),
  ).toThrow(expect.objectContaining({ code: 'hostname_mismatch' }));
  expect(() =>
    loadServerTls({ ...config(), TLS_KEY_PATH: otherKeyPath }),
  ).toThrow(expect.objectContaining({ code: 'invalid_key_pair' }));
  expect(() => loadServerTls(config(), validity.expiresAt)).toThrow(
    expect.objectContaining({ code: 'expired' }),
  );
  expect(() => loadServerTls(config(), validity.startsAt - 1)).toThrow(
    expect.objectContaining({ code: 'not_yet_valid' }),
  );
  try {
    loadServerTls({
      ...config(),
      TLS_KEY_PATH: join(directory, 'private-missing-key'),
    });
  } catch (error) {
    expect(String(error)).not.toContain(directory);
  }
});
test('checks every supplied chain certificate and warns about the earliest expiry', () => {
  const tls = loadServerTls(config('chain'))!;
  expect(tls.certificates).toHaveLength(2);
  expect(certificateStatus(tls.certificates)).toMatchObject({
    status: 'expiring',
    daysRemaining: 5,
  });
});
test('malformed or oversized PEM inputs fail closed', async () => {
  const invalid = join(directory, 'invalid.pem');
  await writeFile(invalid, 'PRIVATE_TEST_VALUE');
  expect(() => loadServerTls({ ...config(), TLS_CERT_PATH: invalid })).toThrow(
    expect.objectContaining({ code: 'invalid_certificate' }),
  );
  await writeFile(invalid, Buffer.alloc(262145));
  expect(() => loadServerTls({ ...config(), TLS_CERT_PATH: invalid })).toThrow(
    expect.objectContaining({ code: 'unreadable_files' }),
  );
});
test('expiry warning boundaries are exact and current validity begins inclusively', () => {
  const now = Date.parse('2026-11-02T00:00:00Z');
  expect(
    certificateStatus([{ startsAt: now, expiresAt: now + 30 * day + 1 }], now)
      .status,
  ).toBe('valid');
  expect(
    certificateStatus([{ startsAt: now, expiresAt: now + 30 * day }], now),
  ).toEqual({ status: 'expiring', daysRemaining: 30 });
});
test('hourly monitor warns on loaded certificates, deduplicates daily, reports expiry and stops', () => {
  vi.useFakeTimers();
  const now = new Date('2026-11-02T00:00:00Z');
  vi.setSystemTime(now);
  const emit = vi.fn();
  const loaded = [
    { startsAt: now.getTime() - day, expiresAt: now.getTime() + 31 * day },
  ];
  const stop = monitorServerTls(loaded, emit);
  expect(emit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(day);
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenLastCalledWith({
    level: 'warn',
    event: 'tls_certificate_status',
    status: 'expiring',
    daysRemaining: 30,
  });
  vi.advanceTimersByTime(3600000);
  expect(emit).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(23 * 3600000);
  expect(emit).toHaveBeenCalledTimes(2);
  expect(emit).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: 'expiring', daysRemaining: 29 }),
  );
  vi.setSystemTime(loaded[0]!.expiresAt);
  vi.advanceTimersByTime(3600000);
  expect(emit).toHaveBeenLastCalledWith(
    expect.objectContaining({ level: 'error', status: 'expired' }),
  );
  stop();
  const count = emit.mock.calls.length;
  vi.advanceTimersByTime(day);
  expect(emit).toHaveBeenCalledTimes(count);
  expect(vi.getTimerCount()).toBe(0);
});

test('invalid certificate timing metadata fails closed', () => {
  expect(() => certificateStatus([])).toThrow();
  expect(() =>
    certificateStatus([{ startsAt: 0, expiresAt: Number.NaN }]),
  ).toThrow();
});

test('default expiry reports contain only fixed public status metadata', () => {
  vi.useFakeTimers();
  const now = Date.parse('2026-11-02T00:00:00Z');
  vi.setSystemTime(now);
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const stop = monitorServerTls([
    { startsAt: now - day, expiresAt: now + day },
  ]);
  expect(JSON.parse(String(stdout.mock.calls[0]![0]))).toEqual({
    level: 'warn',
    event: 'tls_certificate_status',
    status: 'expiring',
    daysRemaining: 1,
  });
  vi.advanceTimersByTime(day);
  expect(JSON.parse(String(stderr.mock.calls[0]![0]))).toEqual({
    level: 'error',
    event: 'tls_certificate_status',
    status: 'expired',
    daysRemaining: 0,
  });
  stop();
});
test('Nest serves real HTTPS using explicit test-only trust and stops its certificate monitor on shutdown', async () => {
  const tlsConfig = parseConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://fixture:fixture@127.0.0.1/unused',
    ...config(),
    ALLOWED_HOSTS: 'localhost:3443',
  });
  const close = vi.fn().mockResolvedValue(undefined);
  const app = await createApp(tlsConfig, {
    ready: vi.fn().mockResolvedValue(undefined),
    close,
  });
  const timers = vi.spyOn(globalThis, 'setInterval');
  const cleared = vi.spyOn(globalThis, 'clearInterval');
  let closed = false;
  try {
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as { port: number }).port;
    const read = (servername: string) =>
      new Promise<{ status: number | undefined; body: string }>(
        (accept, reject) => {
          const req = request(
            {
              hostname: '127.0.0.1',
              port,
              servername,
              path: '/api/v1/health',
              headers: { Host: 'localhost:3443' },
              ca: publicCertificate,
              rejectUnauthorized: true,
            },
            (res) => {
              let body = '';
              res.on('data', (part) => {
                body += part.toString();
              });
              res.on('end', () => accept({ status: res.statusCode, body }));
            },
          );
          req.on('error', reject);
          req.setTimeout(5000, () =>
            req.destroy(new Error('TLS fixture request timed out')),
          );
          req.end();
        },
      );
    expect(await read('localhost')).toEqual({
      status: 200,
      body: JSON.stringify({
        status: 'ok',
        service: 'gst-api',
        apiVersion: '1',
      }),
    });
    await expect(read('wrong.example')).rejects.toThrow();
    expect(timers).toHaveBeenCalledWith(expect.any(Function), 3600000);
    const timer = timers.mock.results[0]!.value;
    await app.close();
    closed = true;
    expect(cleared).toHaveBeenCalledWith(timer);
    expect(close).toHaveBeenCalledOnce();
  } finally {
    if (!closed) await app.close();
  }
});
