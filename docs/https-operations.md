# HTTPS certificate checks, replacement and recovery

The API validates direct-HTTPS configuration before creating database or
authentication resources. HTTP loopback development is unchanged. This does not
configure a reverse proxy, obtain a certificate or install Windows trust.

`TLS_KEY_PATH` points to the protected, unencrypted server private key.
`TLS_CERT_PATH` contains the PEM leaf certificate first, followed by any required
intermediate certificates in issuer order. `APP_ORIGIN` supplies the browser's
exact HTTPS hostname/IP; DNS names must match a certificate SAN, without a
common-name-only fallback. IP origins require a matching IP SAN.
Keep the private key outside `WEB_ROOT`. Startup rejects a key inside the public
frontend directory, checking both configured and resolved paths. This guards the
known key path; protected immutable assets/ACLs are still required, and it is not
an audit of every file or unrelated alias under the web root.
When configured, `WEB_ROOT` must already exist for its physical path to be checked.

Startup rejects unreadable/oversized/malformed files, a CA certificate used as the
server leaf, incompatible extended key usage, unrelated/reordered chain
certificates, hostname mismatch, not-yet-valid/expired supplied certificates and
an unusable/mismatched key pair. Certificate input is bounded to 256 KiB/16
certificates; key input is bounded to 64 KiB. TLS 1.2 remains the minimum protocol.
Correct the certificate, key, origin or host clock; do not disable TLS validation.

The existing sanitized `startup_failed` event includes a fixed TLS `code` when
applicable: `unreadable_files`, `invalid_certificate`, `invalid_key_pair`,
`ca_used_as_leaf`, `invalid_server_usage`, `hostname_mismatch`, `not_yet_valid`
or `expired`. Paths, PEM contents, private keys and raw OpenSSL errors are omitted.
`private_key_in_web_root` indicates a private key placed under the served frontend
root; move it into protected storage before restarting.

## Running certificate monitor

At application bootstrap and hourly afterward, the API checks the certificates
**loaded into that running process**. The earliest expiry in the supplied chain
controls the warning. At 30 days or fewer remaining, it writes a sanitized event
to standard output, at most once per UTC day for the same status within that
running process (a restart can report again):

```json
{
  "level": "warn",
  "event": "tls_certificate_status",
  "status": "expiring",
  "daysRemaining": 30
}
```

If the loaded chain expires or the host clock moves before a validity period,
the status becomes `expired`/`not_yet_valid` and is reported as an error on standard
error. A status change can produce another event on the same day. The unreferenced
timer is cleared when the application shuts down. An already running application
is not abruptly stopped by the monitor; client TLS validation still applies.

Replacing a file on disk does not replace the certificate held by an existing
HTTPS server. The monitor deliberately keeps reporting the loaded certificate
until an explicit restart loads and validates the replacement. It does not
reload files, renew certificates, stop services or send email/notifications.
Connect these existing structured logs to the chosen deployment's operator
monitoring when that environment is available.

## Renewal remains an operator procedure

Before expiry, generate a replacement server key in protected operator storage
and obtain its matching leaf certificate from the approved issuer using a CSR;
never send the private key. Use the correct SAN and server usage. For the
private-CA prototype, renew through the
existing approved CA; do not create a different CA merely to replace an expired
leaf. Keep the CA private key outside the API account's access.

Use the controlled replacement workflow below for an already provisioned,
dedicated Windows service. It preserves the original pair, holds maintenance
through both file writes, restarts privately and checks trusted HTTPS before
admission. It does not obtain a certificate, rotate a CA, install client trust or
prove native deployment acceptance.

## Controlled replacement and recovery

`pnpm tls:certificate` is a host-operator command, not a customer endpoint or
development setup command. It requires the existing dedicated
`NT SERVICE\GSTBillingApi` deployment and protected installation record.
It never auto-loads the project's environment. No privileged invocation was run
on the development laptop; native service/file/firewall/task and reboot/power-loss
acceptance still belong on the postponed disposable host/client environment.

Prepare a protected operator JSON configuration with these exact sections:

- `format`: 1.
- `options`: `installationId`, a new `operationId`, the installation's existing
  `journalParent`, `keyPath`, `certPath`, `webRoot`, exact HTTPS `origin`,
  independently approved public `trustFile` and its `trustSha256`.
- `windows`: the existing Windows service adapter's `operationId`,
  `serviceRoot`, `nodePath`, `nodeSha256`, `wrapperSha256`,
  `installedRoot`, `stagedRoot`, `environmentFile`,
  `environmentSha256`, `journalDirectory`, `origin`, `port` and
  `backupTaskName` (null if absent), plus `certificateKeyPath` and
  `certificateCertPath`.
- `scripts`: `directory` for the independently trusted operator scripts and a
  strict `hashes` object containing approved SHA-256 hashes for
  `Invoke-UpdateService.ps1`, `UpdateService.ps1`, `Common.ps1` and
  `DeploymentChecks.ps1`. Do not derive expected trust from unverified downloads.

All paths are absolute. Keep the configuration and journal parent in operator-only
storage (for example, under `C:\GST-operator`), separately from the service-readable
active pair/runtime environment (for example, under `C:\GST-runtime`) and immutable
versioned application files. Use the SAME journal parent as application updates:
both operations exclusively acquire `gst-update.lock`. Do not create a second
independent lock location for certificate work.

The Windows `installedRoot` and `stagedRoot` must both equal the currently
installed application root; this operation never selects another app version.
`webRoot` must be that root's `apps\web\dist`. The operation directory is
`<journalParent>\gst-update-<operationId>`; its exact path must be the Windows
`journalDirectory`. Installation/operation IDs, origin, certificate paths and
environment binding must agree across sections. The configured port must be
explicit in the origin and match the existing service listener.

The active certificate/key paths must match the existing protected runtime
environment, remain outside the versioned application, and already have the
reviewed service-read/administrator-write ACLs. The controller writes those
existing files in place, preserving identity/ACLs, only after disabling service
restart/jobs and blocking ingress. Missing/reparse/changed files are refused.
Both files are revalidated together before private startup; an interrupted write
never authorizes automatic startup. Preserve the original runtime environment,
application selection, database credentials and keys.

Stage the replacement key and issuer-provided leaf/intermediate PEM in a private
operator directory. Preflight validates dates, SAN, usage, pair and ordered chain,
then exercises real TLS path/hostname/trust validation on an isolated loopback
listener against the independently pinned approved public trust file. The candidate
certificate chain is never automatically trusted as a root. The native readiness
probe must also succeed using the Windows host's existing approved trust.

```powershell
pnpm tls:certificate replace --configuration 'C:\GST-operator\certificate-operation.json' --source-key 'C:\GST-operator\incoming\server.key.pem' --source-cert 'C:\GST-operator\incoming\server-chain.pem' --confirm-installation <installation-UUID> --maintenance
```

Private original/replacement snapshots, fingerprints, installation state and
operation owner are retained under the protected operation journal. Successful
replacement checks the live HTTPS leaf fingerprint and database readiness before
admission and lock release. It never prints PEM, private keys, credentials or raw
TLS errors. The existing monitor starts reporting the newly loaded pair after
the controlled restart.

After any failed stop/write/start/admission, keep maintenance active and stop the
replacement operator process before recovery. No automatic retry or guessed
rollback is performed. Read-only inspection requires protected host access:

```powershell
pnpm tls:certificate inspect --configuration 'C:\GST-operator\certificate-operation.json'
pnpm tls:certificate recover --configuration 'C:\GST-operator\certificate-operation.json' --selection previous --expected-key-sha256 <inspected-active-key-hash> --expected-cert-sha256 <inspected-active-cert-hash> --confirm-installation <installation-UUID> --maintenance --operator-stopped
```

Choose `replacement` instead of `previous` to repair an interrupted pair with
the already staged validated replacement. Use freshly inspected active hashes;
stale observations are refused before claiming recovery and checked again after
stopping. Recovery verifies installation/owner evidence and retained file hashes,
and validates the chosen pair against the pinned trust and current time. An
expired original cannot be restored into service; a valid staged replacement can
be selected explicitly instead. No CA/root policy or hostname check is bypassed.

A successful recovery archives the exact operation lock and recovery receipts
under its journal. Failed claimed recovery, unknown/missing/contradictory evidence,
partial initialization or storage failures retain locks/copies for operator
inspection; there is no timeout-based lock stealing. Application-update recovery
rejects certificate journals. No database migration or down migration is involved.
Retained private pairs are not automatically pruned; manage their protection and
retention through the approved operator procedure.

Local tests cover actual NTFS private fixtures and in-place file identity, real
ephemeral CA/leaf certificates, trusted loopback HTTPS, wrong trust/hostname,
fingerprint mismatch, partial-pair recovery, stale observations and maintenance
exclusion. Windows service/task/firewall/identity decisions are mocked and
transports execute harmless verified wrappers. These do not certify real native
deployment, client trust or power-loss durability.

Server preflight verifies configured material, not client trust/revocation policy.
It cannot monitor a root certificate held only in a client's trust store and
absent from the server PEM. Private-CA custody/trust/renewal and complete browser
chain validation remain deployment responsibilities. Automated renewal and
Windows/LAN/reboot acceptance remain postponed or unfinished as recorded in
[Phase 6](phase-6.md).

## Local evidence

Tests create ephemeral certificates with an installed OpenSSL executable, check
DNS/IPv4/IPv6 matching, certificate/chain/key failures and warning boundaries,
and exercise deduplication, expiry logging and cleanup with controlled clocks.
A real Nest HTTPS listener runs on an isolated loopback port with explicit
test-only client trust and rejects the wrong client hostname. No machine root
store is modified, no verification bypass is used and no production key is used.
These checks do not validate actual Windows service installation or LAN trust.

References: [Node X509 certificate inspection](https://nodejs.org/docs/latest-v24.x/api/crypto.html#class-x509certificate),
[Node TLS secure contexts](https://nodejs.org/docs/latest-v24.x/api/tls.html#tlscreatesecurecontextoptions).
