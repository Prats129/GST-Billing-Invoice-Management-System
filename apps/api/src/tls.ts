import { X509Certificate } from 'node:crypto';
import {
  openSync,
  fstatSync,
  readSync,
  closeSync,
  realpathSync,
} from 'node:fs';
import { isIP } from 'node:net';
import { isAbsolute, relative, sep } from 'node:path';
import { createSecureContext } from 'node:tls';
import type { Config } from './config.js';

const day = 86400000;
const warningDays = 30;
type TlsFailure =
  | 'unreadable_files'
  | 'invalid_certificate'
  | 'invalid_key_pair'
  | 'private_key_in_web_root'
  | 'ca_used_as_leaf'
  | 'invalid_server_usage'
  | 'hostname_mismatch'
  | 'not_yet_valid'
  | 'expired';
export class TlsConfigurationError extends Error {
  constructor(readonly code: TlsFailure) {
    super(
      'Invalid TLS configuration. Check protected files, certificate dates, hostname and matching server key.',
    );
  }
}
export interface CertificateValidity {
  startsAt: number;
  expiresAt: number;
}
export interface TlsCertificateStatus {
  status: 'valid' | 'expiring' | 'expired' | 'not_yet_valid';
  daysRemaining: number;
}
function readTlsFile(path: string, maximum: number): Buffer {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const info = fstatSync(fd);
    if (!info.isFile() || info.size <= 0 || info.size > maximum)
      throw new Error();
    const data = Buffer.alloc(maximum + 1);
    let used = 0;
    while (used < data.length) {
      const count = readSync(fd, data, used, data.length - used, null);
      if (!count) break;
      used += count;
    }
    if (used > maximum) throw new Error();
    return data.subarray(0, used);
  } catch {
    throw new TlsConfigurationError('unreadable_files');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export function certificateStatus(
  certificates: readonly CertificateValidity[],
  now = Date.now(),
): TlsCertificateStatus {
  if (
    !certificates.length ||
    !Number.isFinite(now) ||
    certificates.some(
      (cert) =>
        !Number.isFinite(cert.startsAt) ||
        !Number.isFinite(cert.expiresAt) ||
        cert.expiresAt <= cert.startsAt,
    )
  )
    throw new TlsConfigurationError('invalid_certificate');
  const earliest = Math.min(...certificates.map((cert) => cert.expiresAt));
  const daysRemaining = Math.max(0, Math.ceil((earliest - now) / day));
  if (now >= earliest) return { status: 'expired', daysRemaining: 0 };
  if (certificates.some((cert) => now < cert.startsAt))
    return { status: 'not_yet_valid', daysRemaining };
  return {
    status: earliest - now <= warningDays * day ? 'expiring' : 'valid',
    daysRemaining,
  };
}
export function loadServerTls(
  config: Pick<
    Config,
    'TLS_KEY_PATH' | 'TLS_CERT_PATH' | 'APP_ORIGIN' | 'WEB_ROOT'
  >,
  now = Date.now(),
) {
  if (!config.TLS_KEY_PATH && !config.TLS_CERT_PATH) return undefined;
  if (!config.TLS_KEY_PATH || !config.TLS_CERT_PATH)
    throw new TlsConfigurationError('unreadable_files');
  if (config.WEB_ROOT) {
    const inside = (root: string, file: string) => {
      const path = relative(root, file);
      return (
        path === '' ||
        (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep))
      );
    };
    try {
      // Check configured aliases as well as physical paths; a key symlink must
      // not make its publicly served pathname appear safe after resolution.
      if (
        inside(config.WEB_ROOT, config.TLS_KEY_PATH) ||
        inside(realpathSync(config.WEB_ROOT), realpathSync(config.TLS_KEY_PATH))
      )
        throw new TlsConfigurationError('private_key_in_web_root');
    } catch (error) {
      if (error instanceof TlsConfigurationError) throw error;
      throw new TlsConfigurationError('unreadable_files');
    }
  }
  const cert = readTlsFile(config.TLS_CERT_PATH, 262144);
  let chain: X509Certificate[];
  try {
    const blocks = cert
      .toString('utf8')
      .match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!blocks?.length || blocks.length > 16) throw new Error();
    chain = blocks.map((block) => new X509Certificate(block));
  } catch {
    throw new TlsConfigurationError('invalid_certificate');
  }
  for (let i = 0; i < chain.length - 1; i++) {
    const child = chain[i]!,
      issuer = chain[i + 1]!;
    if (
      !issuer.ca ||
      !child.checkIssued(issuer) ||
      !child.verify(issuer.publicKey)
    )
      throw new TlsConfigurationError('invalid_certificate');
  }
  const leaf = chain[0]!;
  if (leaf.ca) throw new TlsConfigurationError('ca_used_as_leaf');
  if (leaf.keyUsage && !leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1'))
    throw new TlsConfigurationError('invalid_server_usage');
  const hostname = new URL(config.APP_ORIGIN).hostname.replace(/^\[|\]$/g, '');
  if (
    isIP(hostname)
      ? !leaf.checkIP(hostname)
      : !leaf.checkHost(hostname, { subject: 'never', partialWildcards: false })
  )
    throw new TlsConfigurationError('hostname_mismatch');
  const certificates = chain.map((value) => ({
    startsAt: Date.parse(value.validFrom),
    expiresAt: Date.parse(value.validTo),
  }));
  const status = certificateStatus(certificates, now);
  if (status.status === 'expired' || status.status === 'not_yet_valid')
    throw new TlsConfigurationError(status.status);
  const key = readTlsFile(config.TLS_KEY_PATH, 65536);
  const httpsOptions = { key, cert, minVersion: 'TLSv1.2' as const };
  try {
    createSecureContext(httpsOptions);
  } catch {
    throw new TlsConfigurationError('invalid_key_pair');
  }
  return { httpsOptions, certificates };
}

type CertificateReport = TlsCertificateStatus & {
  level: 'warn' | 'error';
  event: 'tls_certificate_status';
};
export function monitorServerTls(
  certificates: readonly CertificateValidity[],
  emit: (event: CertificateReport) => void = (event) => {
    const output = event.level === 'error' ? process.stderr : process.stdout;
    output.write(JSON.stringify(event) + '\n');
  },
) {
  let reported: string | undefined;
  function observe() {
    const now = Date.now();
    const state = certificateStatus(certificates, now);
    if (state.status === 'valid') return;
    const key = state.status + ':' + new Date(now).toISOString().slice(0, 10);
    if (key === reported) return;
    reported = key;
    emit({
      level: state.status === 'expiring' ? 'warn' : 'error',
      event: 'tls_certificate_status',
      ...state,
    });
  }
  observe();
  const timer = setInterval(observe, 3600000);
  timer.unref();
  return () => clearInterval(timer);
}
