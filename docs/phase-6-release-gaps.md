# Phase 6 remaining release work

Repository review: 2026-11-03. This is a completion checklist, not a new phase or
an approval to release. Existing local tests do not certify production deployment.

Follow the [connected execution plan](phase-6-execution.md) without restarting
planning for each helper. Protected installed state and explicit supported forward-copy
recovery are now implemented locally; remaining native/artifact dependencies are
recorded in [artifact review](windows-artifact-review.md).

The [initial installation/preserving-uninstall workflow](windows-installation.md)
now has operator code and local regression coverage. This does not close the
installer row: approved vendor payloads, signing, actual native deployment,
retained-data repair/reinstallation and interrupted-uninstall reconciliation
remain outstanding.

| Remaining work                              | Current boundary                                                                                                                                                     | Required next input or work                                                                                                                                                                                                             | Completion evidence                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows installer and assisted updates      | Signed verification/staging and a supported forward-copy Windows/database update adapter exist; initial installer and native acceptance remain unfinished.           | Implement the installer lifecycle around approved redistributable binaries and protected service identities. Signing credentials and a disposable host/client are needed for release acceptance.                                        | Signed clean install, backup-before-update, compatible migration, readiness, failure recovery and data-preserving uninstall tested on disposable Windows machines. |
| Windows deployment acceptance               | Safe script tests exist; native service, ACL, trust, LAN and reboot tests are postponed by user decision.                                                            | Resume on suitable disposable hardware with a separate client. No changes to the current laptop are required.                                                                                                                           | Recorded host/client results for the existing [deployment checklist](windows-deployment-checks.md), including reboot and unattended backups.                       |
| Maintenance eligibility for offline updates | Preflight and the bound update adapter check active signed maintenance for every organization; perpetual billing remains independent.                                | Policy confirmed and bound for supported forward-copy updates. Validate native exclusion/activation on the disposable host; complete remaining installer lifecycle.                                                                     | Boundary tests prove eligible updates succeed, ineligible updates fail and perpetual billing remains available.                                                    |
| Commercial license operations               | Signed-file issuance/install/renewal and a protected publisher register exist; no deployed issuer authority, online activation or verified transfer workflow exists. | Deploy one protected register authority, reconcile any existing history and review register backups, operator identity checks and signing-key custody. Complete online/transfer operations without claiming instant offline revocation. | Reviewed key custody/rotation and issuance records; tested activation, renewal and authorized replacement with existing customer data retained.                    |
| SaaS launch                                 | Tenant isolation and provider-neutral entitlement state exist; hosting, self-service onboarding and provider provisioning/renewal automation remain unfinished.      | Select hosting and the subscription operating workflow. Confirm backup retention and real infrastructure costs before deployment.                                                                                                       | Deployed tenant/onboarding and renewal tests, expired-subscription read-only tests, monitored operations and a real provider backup/restore drill.                 |
| HTTPS certificate operations                | Startup checks, expiry warnings and controlled pair replacement/recovery exist; automatic renewal and client/CA trust deployment remain unfinished.                  | Select the deployment certificate issuer and renewal/trust process. Build and validate renewal against that process.                                                                                                                    | Replacement certificate loaded after controlled restart, trusted client access and recovery from failed renewal; CA replacement tested if applicable.              |
| Invoice compliance approval                 | Official issuance remains deliberately blocked by professional tax/IRP policy gates.                                                                                 | Obtain professional review of supported calculations, rounding, document requirements and e-invoice scope. Implement any required corrections before considering release.                                                               | Documented professional approval plus tests for the approved scope; a license or UI setting cannot bypass the gate.                                                |

## Next execution order

1. Offline update eligibility policy is confirmed and a bound adapter is
   implemented for supported forward-copy updates. Validate its maintenance/write
   stop; a previous check must never authorize a later installation.
2. Implement the remaining installer workflow and validate it on the postponed
   disposable environment when available. Integrity verification alone is not an
   installer, and a successful database drill is not a successful live update.
3. Complete issuer and SaaS operational workflows with the selected operator and
   provider configuration. Keep production keys outside customer distributions.
4. Collect deployment, restore and professional compliance evidence before release.

No payment tracking, inventory, synchronization, extra pricing/seat restrictions
or additional product phase is introduced by this checklist. Automatic certificate
renewal cannot be verified against an unspecified issuer, and production provider
or signing setup must not be represented as complete using test credentials.

For existing engineering evidence see [Phase 6](phase-6.md) and
[review coverage](review-coverage.md). Detailed operational boundaries remain in
[signed releases](signed-releases.md), [licensing](licensing-operations.md),
[HTTPS operations](https-operations.md) and [backup/recovery](backup-recovery.md).
