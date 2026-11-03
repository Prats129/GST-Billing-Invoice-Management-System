import { readCertificateOperationFile } from './certificate-replacement.js';
import {
  certificateHash,
  probeCertificateReadiness,
} from './certificate-probe.js';
try {
  const [origin, trust, trustHash, leaf, ...extra] = process.argv.slice(2);
  if (
    !origin ||
    !trust ||
    !trustHash ||
    !leaf ||
    extra.length ||
    !/^https:\/\//.test(origin) ||
    !(/^[a-f0-9]{64}$/.test(trustHash) && /^[a-f0-9]{64}$/.test(leaf))
  )
    throw new Error();
  const ca = await readCertificateOperationFile(trust, 262144);
  if (certificateHash(ca) !== trustHash) throw new Error();
  await probeCertificateReadiness(origin, ca, leaf);
  process.stdout.write('{"ok":true}\n');
} catch {
  process.stderr.write('{"event":"repair_https_probe_failed"}\n');
  process.exitCode = 1;
}
