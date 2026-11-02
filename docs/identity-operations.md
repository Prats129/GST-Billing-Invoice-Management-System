# Identity setup and recovery

Run `pnpm setup:env`, `pnpm db:up`, then `pnpm db:migrate`. setup:env adds a
missing AUTH_DATA_KEY without replacing existing DB credentials or encryption
keys. Back up that key separately from PostgreSQL backups: changing/losing it
makes existing encrypted TOTP secrets unreadable.

Commercial API connections require a dedicated unprivileged database role,
separate from host recovery/migration credentials. For a quarantined recovery
copy, follow [runtime database access](runtime-database-access.md).

## First owner (no default account)

Use a host terminal and a private input file. Passwords/recovery credentials must
never be process arguments, git-tracked files or shared logs. On Windows restrict
NTFS ACLs to the operator; POSIX inputs must have mode0600. The examples assume a
protected, ignored .local directory (create it if needed).

Create `.local/owner-provision.json`, replacing every example value:

```json
{
  "organizationName": "Your business name",
  "email": "your-own-email@example.com",
  "name": "Your name",
  "password": "REPLACE_WITH_A_UNIQUE_PRIVATE_PASSWORD"
}
```

Passwords must contain 15–128 characters. From the repository root:

```powershell
pnpm identity:host provision .local/owner-provision.json .local/owner-result.jsonl
```

The output file must not already exist. The CLI reserves a private file, flushes
recovery material before the DB transaction, then appends a `state: committed`
JSON line on completion. It never prints credentials. Save the committed recovery
credential privately/off-device and securely remove the password input file.
Prepared-only output does not prove success: inspect operator/audit state before
retrying with a new output path. Its flushed credential permits controlled
recovery if I/O fails after commit. Existing owners keep their original recovery
credential when provisioned into another organization; the committed record omits
a replacement, so the unused prepared candidate in that case must be ignored.

Run `pnpm dev`, open http://localhost:5173 and sign in. No public setup endpoint or
default account exists. Owner permissions are protected; Administrator and Staff
starter roles are created. Administrator has no implicit delegation authority.

The CLI uses MIGRATION_DATABASE_URL as a trusted operator connection. Production
API credentials must not own tables or have DDL/trigger-disable privileges. Grant
only required operations on identity tables; audit_events needs SELECT/INSERT,
permissions SELECT only. Migrations remain a separate operator workflow.

Manually created Phase 1 ownerless organizations are retained, never assigned an
owner automatically. To explicitly adopt one with no memberships, include its UUID
as `organizationId` in the input. Existing name/ID/status are preserved; suspended
organizations are not silently activated. Ownerless legacy records cannot be
accessed by tenant APIs until adopted. Newly created/changed active organizations
must satisfy deferred owner checks in the same transaction.

## Memberships and delegation

Create new employee accounts using a temporary password and appropriate roles;
share it privately. Employees must change it before organization data access.
Reset revokes all sessions and is forbidden for protected owners, yourself, and
accounts shared with another organization. Shared users change their own password
with current credentials and completed MFA where enabled.
Only an accepted membership can authorize a password reset. Pending invitations
neither grant reset authority nor block the user's existing tenant from resetting
an otherwise single-organization employee account.

For an existing user, omit the temporary password. That user must sign in and
accept the invitation. Admins cannot bypass acceptance by suspending/reactivating
an invitation. Remove/reinvite to replace a cancelled invitation. Membership
changes never modify another tenant's membership or global credentials.

Multiple roles union their permissions. Only owners grant delegation; each role's
delegable permissions must be a subset of its permissions. Role-admin authority
alone is insufficient. Starter roles are immutable. Promote a second active owner
before removing the first: the DB rejects last-owner demotion/suspension/deletion
or global account disable. Removing a membership retains the account and audits.

## Sessions and MFA

Initial configurable defaults: 30-minute idle / 12-hour absolute sessions. Tokens
are 256-bit opaque values, hashed at rest. Deployment cookies are Secure, HttpOnly,
SameSite=Strict with __Host- prefix. Loopback HTTP development uses a separately
named non-Secure cookie; never expose that mode to LAN. Mutations require exact
Origin and a session-bound CSRF header. No credentials enter localStorage.

SaaS owners, organization/member/role/customer/catalog managers, tax reviewers and audit readers must complete
TOTP before tenant access. Anyone with MFA enabled completes a challenge at login.
Account security provides authenticator enrollment and ten single-use recovery
codes. Save them offline. TOTP codes cannot be replayed. Replacing recovery codes
or disabling optional MFA requires current password plus a fresh authenticator/
recovery code, rotates the current session and revokes the others. Mandatory SaaS
MFA cannot be disabled. Password reset never clears MFA.

Login/MFA have persistent account/IP throttles; authenticated mutations allow 240
attempts per 15 minutes per identity (unrelated to subscriptions). Argon2 work is
bounded to four concurrent operations per process. Activity prunes old throttle
rows (>24h) and expired sessions (>30d) in bounded batches; audits are never pruned
by the app. These are reversible initial operational defaults. Trust-proxy stays
disabled: review client-IP handling/HTTPS before adding a reverse proxy.

## Offline protected-owner recovery

Host CLI only; requires the saved high-entropy one-time credential. Create a
private `.local/owner-recovery.json`:

```json
{
  "email": "your-own-email@example.com",
  "recoveryCredential": "YOUR_SAVED_ONE_TIME_RECOVERY_CREDENTIAL",
  "newPassword": "REPLACE_WITH_ANOTHER_UNIQUE_PRIVATE_PASSWORD"
}
```

```powershell
pnpm identity:host recover-owner .local/owner-recovery.json .local/recovered-owner.jsonl
```

Recovery atomically changes the password, clears lost TOTP/codes, revokes sessions,
consumes the old proof and audits each owned organization. Save its replacement;
the old proof cannot be reused. No recovery HTTP endpoint, universal password or
SaaS host override exists. SaaS uses authenticator/recovery codes; loss of all
factors needs a separately reviewed platform procedure before commercial launch.
No tenant-admin employee MFA-clear endpoint is provided; recovery codes are the
normal fallback. Native Windows service/ACL/LAN tests remain a separate deployment
matrix; local HTTP/browser tests do not verify that deployment behavior.
