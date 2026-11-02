# HTTPS certificate checks and expiry reporting

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

Preserve the previous protected files and reviewed configuration, arrange a
maintenance window, stage the matching pair with restricted access, then restart
the service using the approved deployment workflow. Verify trusted HTTPS, API
readiness and browser access on host/client afterward. Updating only one of the
key/certificate files or serving a CA key is not a recovery procedure. The code
does not perform this privileged installation/restart or prove its VM behavior.

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
