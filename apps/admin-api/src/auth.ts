import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  token,
  digest,
  csrfToken,
  secureEqual,
  hashPassword,
  verifyPassword,
  newTotpSecret,
  createTotp,
  encryptSecret,
  decryptSecret,
  totpCounter,
} from '@gst/security';
import type { PlatformConfig } from './config.js';
import { rows, transaction, audit } from './store.js';
import type { Tx } from './store.js';
import { fail } from './errors.js';
interface Owner {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  mfa_secret: string | null;
  last_counter: string;
  recovery_hash: string;
}
export interface AdminSession {
  token_hash: string;
  owner_id: string;
  mfa_verified: boolean;
  pending_secret: string | null;
  fresh_at: Date | null;
  csrf_hash: string;
  expires_at: Date;
  last_seen_at: Date;
}
// Use the same owner -> session lock order as MFA/recovery. Sensitive changes
// must check live authority inside the transaction, after any password hashing.
export async function lockPlatformSession(
  tx: Tx,
  session: AdminSession,
  recent = false,
) {
  const [owner] = await rows<{ mfa_secret: string | null }>(
    tx,
    'SELECT mfa_secret FROM platform_owner WHERE id=$1 FOR UPDATE',
    [session.owner_id],
  );
  const [live] = await rows<AdminSession>(
    tx,
    "SELECT * FROM platform_sessions WHERE token_hash=$1 AND owner_id=$2 AND expires_at>now() AND last_seen_at>now()-interval '30 minutes' FOR UPDATE",
    [session.token_hash, session.owner_id],
  );
  if (!owner || !live) fail('UNAUTHENTICATED', 401);
  if (!owner.mfa_secret || !live.mfa_verified) fail('MFA_REQUIRED', 403);
  if (
    recent &&
    (!live.fresh_at || Date.now() - live.fresh_at.getTime() > 300000)
  )
    fail('REAUTH_REQUIRED', 403);
  return live;
}
export class PlatformAuth {
  private nextCleanup = 0;
  private readonly dummy = hashPassword(token());
  constructor(
    readonly db: Pool,
    readonly config: PlatformConfig,
  ) {}
  async owner(tx: Pool | Tx = this.db) {
    const [owner] = await rows<Owner>(tx, 'SELECT * FROM platform_owner');
    if (!owner) fail('OWNER_UNAVAILABLE', 503);
    return owner;
  }
  async throttle(key: string, max = 10) {
    if (Date.now() > this.nextCleanup) {
      this.nextCleanup = Date.now() + 60000;
      await this.db.query(
        "DELETE FROM platform_throttle WHERE key IN (SELECT key FROM platform_throttle WHERE started_at<now()-interval '24 hours' LIMIT 1000)",
      );
      await this.db.query(
        "DELETE FROM platform_sessions WHERE token_hash IN (SELECT token_hash FROM platform_sessions WHERE expires_at<now()-interval '1 day' LIMIT 1000)",
      );
    }
    const [row] = await rows<{ count: number }>(
      this.db,
      `INSERT INTO platform_throttle VALUES($1,1,now()) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN platform_throttle.started_at<now()-interval '15 minutes' THEN 1 ELSE platform_throttle.count+1 END,started_at=CASE WHEN platform_throttle.started_at<now()-interval '15 minutes' THEN now() ELSE platform_throttle.started_at END RETURNING count`,
      [digest(key)],
    );
    if (!row || row.count > max)
      fail('RATE_LIMITED', 429, 'Too many attempts. Try again later.');
  }
  async login(email: string, password: string, ip: string) {
    await this.throttle('login-ip:' + ip, 30);
    await this.throttle('login:' + email);
    const [owner] = await rows<Owner>(
      this.db,
      'SELECT * FROM platform_owner WHERE email=$1',
      [email],
    );
    if (
      !(await verifyPassword(
        owner?.password_hash ?? (await this.dummy),
        password,
      )) ||
      !owner
    )
      fail('INVALID_CREDENTIALS', 401, 'Invalid credentials.');
    return transaction(this.db, async (tx) => {
      await tx.query('SELECT id FROM platform_owner FOR UPDATE');
      const locked = await this.owner(tx);
      if (locked.password_hash !== owner.password_hash)
        fail('INVALID_CREDENTIALS', 401);
      const raw = token();
      await tx.query(
        "INSERT INTO platform_sessions(token_hash,owner_id,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
        [digest(raw), owner.id, digest(csrfToken(raw))],
      );
      await audit(tx, owner.id, 'owner.login');
      return raw;
    });
  }
  async session(
    raw: string | undefined,
    csrf?: string,
    mutate = false,
  ): Promise<AdminSession> {
    if (!raw || !/^[-_a-zA-Z0-9]{43}$/.test(raw))
      fail('UNAUTHENTICATED', 401, 'Sign in to Platform Admin.');
    const [s] = await rows<AdminSession>(
      this.db,
      `UPDATE platform_sessions SET last_seen_at=now() WHERE token_hash=$1 AND expires_at>now() AND last_seen_at>now()-interval '30 minutes' RETURNING *`,
      [digest(raw)],
    );
    if (!s) fail('UNAUTHENTICATED', 401, 'Sign in to Platform Admin.');
    if (mutate && (!csrf || !secureEqual(s.csrf_hash, digest(csrf))))
      fail('CSRF_INVALID', 403);
    if (mutate) await this.throttle('mutation:' + s.owner_id, 240);
    return s;
  }
  async full(s: AdminSession) {
    const o = await this.owner();
    if (!o.mfa_secret || !s.mfa_verified)
      fail('MFA_REQUIRED', 403, 'Complete two-step verification.');
  }
  async info(s: AdminSession, raw: string) {
    const o = await this.owner();
    return {
      user: { id: o.id, name: o.name, email: o.email },
      mfaEnabled: Boolean(o.mfa_secret),
      mfaVerified: s.mfa_verified,
      csrfToken: csrfToken(raw),
    };
  }
  async setup(s: AdminSession) {
    return transaction(this.db, async (tx) => {
      const o = await this.owner(tx);
      if (o.mfa_secret) fail('MFA_ALREADY_CONFIGURED');
      const secret = newTotpSecret();
      await tx.query(
        'UPDATE platform_sessions SET pending_secret=$2 WHERE token_hash=$1',
        [
          s.token_hash,
          encryptSecret(secret, this.config.PLATFORM_AUTH_KEY, o.id),
        ],
      );
      return {
        secret,
        uri: createTotp(secret, 'Platform Admin: ' + o.email).toString(),
      };
    });
  }
  async verify(s: AdminSession, code: string, enroll = false) {
    await this.throttle('mfa:' + s.owner_id);
    return transaction(this.db, async (tx) => {
      const [o] = await rows<Owner>(
        tx,
        'SELECT * FROM platform_owner FOR UPDATE',
      );
      if (!o) fail('UNAUTHENTICATED', 401);
      const [live] = await rows<AdminSession>(
        tx,
        'SELECT * FROM platform_sessions WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',
        [s.token_hash],
      );
      if (!live) fail('UNAUTHENTICATED', 401);
      if (enroll && o.mfa_secret) fail('MFA_ALREADY_CONFIGURED');
      const encrypted = enroll ? live.pending_secret : o.mfa_secret;
      let valid = false;
      if (encrypted && /^\d{6}$/.test(code)) {
        const counter = totpCounter(
          decryptSecret(encrypted, this.config.PLATFORM_AUTH_KEY, o.id),
          code,
          Number(o.last_counter),
        );
        if (counter !== null) {
          await tx.query(
            'UPDATE platform_owner SET last_counter=$1,mfa_secret=$2',
            [counter, encrypted],
          );
          valid = true;
        }
      } else if (!enroll) {
        const deleted = await tx.query(
          'DELETE FROM platform_recovery_codes WHERE owner_id=$1 AND hash=$2 RETURNING hash',
          [o.id, digest(code)],
        );
        valid = deleted.rowCount === 1;
      }
      if (!valid)
        fail('INVALID_MFA', 403, 'Verification code was not accepted.');
      const raw = token();
      await tx.query(
        'UPDATE platform_sessions SET token_hash=$2,csrf_hash=$3,mfa_verified=true,pending_secret=NULL,fresh_at=NULL WHERE token_hash=$1',
        [s.token_hash, digest(raw), digest(csrfToken(raw))],
      );
      let codes: string[] = [];
      if (enroll) {
        codes = Array.from({ length: 10 }, () => token());
        for (const c of codes)
          await tx.query('INSERT INTO platform_recovery_codes VALUES($1,$2)', [
            digest(c),
            o.id,
          ]);
      }
      await audit(
        tx,
        o.id,
        enroll ? 'owner.mfa_enrolled' : 'owner.mfa_verified',
      );
      return { recoveryCodes: codes, raw };
    });
  }
  async reauthenticate(s: AdminSession, password: string, code: string) {
    await this.full(s);
    await this.throttle('proof:' + s.owner_id);
    if (!(await verifyPassword((await this.owner()).password_hash, password)))
      fail('INVALID_CREDENTIALS', 401);
    const result = await this.verify(s, code);
    await this.db.query(
      'UPDATE platform_sessions SET fresh_at=now() WHERE token_hash=$1',
      [digest(result.raw)],
    );
    return result;
  }
  async recent(s: AdminSession) {
    await this.full(s);
    if (!s.fresh_at || Date.now() - s.fresh_at.getTime() > 300000)
      fail(
        'REAUTH_REQUIRED',
        403,
        'Confirm your password and a fresh verification code first.',
      );
  }
  async changePassword(s: AdminSession, password: string) {
    await this.recent(s);
    const hash = await hashPassword(password);
    await transaction(this.db, async (tx) => {
      await lockPlatformSession(tx, s, true);
      await tx.query(
        'UPDATE platform_owner SET password_hash=$1,version=version+1',
        [hash],
      );
      await tx.query('DELETE FROM platform_sessions');
      await audit(tx, s.owner_id, 'owner.password_changed');
    });
  }
  async bootstrap(email: string, name: string, password: string) {
    const id = randomUUID(),
      recovery = token(),
      hash = await hashPassword(password);
    await transaction(this.db, async (tx) => {
      await tx.query(
        'INSERT INTO platform_owner(singleton,id,email,name,password_hash,recovery_hash) VALUES(true,$1,$2,$3,$4,$5)',
        [id, email, name, hash, digest(recovery)],
      );
      await audit(tx, id, 'owner.bootstrapped');
    });
    return recovery;
  }
  async recover(proof: string, password: string, replacement: string) {
    const hash = await hashPassword(password);
    await transaction(this.db, async (tx) => {
      const [o] = await rows<Owner>(
        tx,
        'SELECT * FROM platform_owner FOR UPDATE',
      );
      if (!o || !secureEqual(digest(proof), o.recovery_hash))
        fail('INVALID_RECOVERY', 403);
      await tx.query(
        'UPDATE platform_owner SET password_hash=$1,mfa_secret=NULL,last_counter=-1,recovery_hash=$2,version=version+1',
        [hash, digest(replacement)],
      );
      await tx.query('DELETE FROM platform_sessions');
      await tx.query('DELETE FROM platform_recovery_codes');
      await audit(tx, o.id, 'owner.host_recovered');
    });
  }
}
