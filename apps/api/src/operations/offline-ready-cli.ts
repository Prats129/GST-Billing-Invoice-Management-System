// Called before initial LAN admission. No insecure fallback or trust import.
import { readCertificateOperationFile } from './certificate-replacement.js';
import {
  certificateHash,
  probeCertificateReadiness,
} from './certificate-probe.js';
import { offlineInstallSchema } from './offline-installer.js';
try {
  const [input, ...extra] = process.argv.slice(2);
  if (!input || extra.length) throw new Error();
  const value = JSON.parse(
    (await readCertificateOperationFile(input, 16 * 1024 * 1024)).toString(
      'utf8',
    ),
  );
  const config = offlineInstallSchema.parse(value.config);
  if (!/^[a-f0-9]{64}$/.test(value.leafSha256)) throw new Error();
  const ca = await readCertificateOperationFile(
    config.certificateTrustFile,
    262144,
  );
  if (certificateHash(ca) !== config.certificateTrustSha256) throw new Error();
  await probeCertificateReadiness(config.origin, ca, value.leafSha256);
  process.stdout.write('{"ok":true}\n');
} catch {
  process.stderr.write('{"event":"installer_https_probe_failed"}\n');
  process.exitCode = 1;
}
