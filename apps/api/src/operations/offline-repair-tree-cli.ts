import { readCertificateOperationFile } from './certificate-replacement.js';
import { certificateHash } from './certificate-probe.js';
import { loadEntitlementTrust } from '../licensing/entitlement.js';
import { verifyOfflineRelease } from './offline-installer.js';
try {
  const [root, trustFile, trustSha256, version, schemaDigest, ...extra] =
    process.argv.slice(2);
  if (
    !root ||
    !trustFile ||
    !trustSha256 ||
    !version ||
    !schemaDigest ||
    extra.length
  )
    throw new Error();
  const bytes = await readCertificateOperationFile(trustFile, 32768);
  if (certificateHash(bytes) !== trustSha256) throw new Error();
  const manifest = await verifyOfflineRelease(
    root,
    loadEntitlementTrust(JSON.parse(bytes.toString('utf8'))),
  );
  if (manifest.version !== version || manifest.toSchemaDigest !== schemaDigest)
    throw new Error();
  process.stdout.write('{"ok":true}\n');
} catch {
  process.stderr.write('{"event":"repair_tree_verification_failed"}\n');
  process.exitCode = 1;
}
