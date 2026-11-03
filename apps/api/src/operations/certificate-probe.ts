import { createHash, X509Certificate } from 'node:crypto';
import { createServer, connect, checkServerIdentity } from 'node:tls';
import type { TLSSocket } from 'node:tls';
import { get } from 'node:https';
import { isIP } from 'node:net';
import type { loadServerTls } from '../tls.js';

export const certificateHash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
export function certificateLeafHash(cert: Buffer) {
  return certificateHash(new X509Certificate(cert).raw);
}
export type CertificateMaterial = NonNullable<ReturnType<typeof loadServerTls>>;

// Exercise Node/OpenSSL's real path/usage/hostname/trust validation against an
// isolated loopback TLS listener. The candidate chain is never a trust anchor.
export async function verifyCertificateTrust(
  material: CertificateMaterial,
  origin: string,
  ca: Buffer,
) {
  const hostname = new URL(origin).hostname.replace(/^\[|\]$/g, '');
  const server = createServer(material.httpsOptions, (socket) => socket.end());
  server.on('tlsClientError', () => {});
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error();
    await new Promise<void>((resolve, reject) => {
      const socket = connect(
        {
          host: '127.0.0.1',
          port: address.port,
          servername: isIP(hostname) ? undefined : hostname,
          ca,
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
          checkServerIdentity: (_name, cert) =>
            checkServerIdentity(hostname, cert),
        },
        () => {
          const peer = socket.getPeerCertificate();
          const matches =
            peer.raw &&
            certificateHash(peer.raw) ===
              certificateLeafHash(material.httpsOptions.cert);
          socket.destroy();
          if (matches) resolve();
          else reject(new Error());
        },
      );
      socket.setTimeout(5000, () =>
        socket.destroy(new Error('TLS probe timeout')),
      );
      socket.once('error', reject);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// No redirects, insecure verification fallback or trust-store modifications.
export async function probeCertificateReadiness(
  origin: string,
  ca: Buffer,
  leafSha256: string,
) {
  await new Promise<void>((resolve, reject) => {
    const request = get(
      new URL('/api/v1/health/ready', origin),
      { ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false },
      (response) => {
        const peer = (response.socket as TLSSocket).getPeerCertificate();
        if (
          response.statusCode !== 200 ||
          !peer.raw ||
          certificateHash(peer.raw) !== leafSha256
        ) {
          response.destroy();
          reject(new Error());
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 16384) response.destroy(new Error());
          else chunks.push(chunk);
        });
        response.once('error', reject);
        response.once('end', () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (value.status !== 'ready' || value.database !== 'up')
              throw new Error();
            resolve();
          } catch {
            reject(new Error());
          }
        });
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error('HTTPS readiness timeout')),
      10000,
    );
    request.once('close', () => clearTimeout(timer));
    request.once('error', reject);
  });
}
