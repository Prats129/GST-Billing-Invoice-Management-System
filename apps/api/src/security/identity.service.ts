import {
  and,
  auditEvents,
  authThrottle,
  desc,
  eq,
  gt,
  isNull,
  memberships,
  mfaCredentials,
  organizations,
  ownerRecovery,
  recoveryCodes,
  sessions,
  sql,
  users,
} from '@gst/database';
import type { Database, DatabaseTransaction } from '@gst/database';
import type { Config } from '../config.js';
import type { IdentitySession, Store } from './types.js';
import {
  csrfToken,
  createTotp,
  decryptSecret,
  digest,
  encryptSecret,
  hashPassword,
  newTotpSecret,
  secureEqual,
  token,
  totpCounter,
  verifyPassword,
} from './crypto.js';
import { deny } from './errors.js';

export class IdentityService {
  private nextCleanup = 0;
  private readonly dummyHash = hashPassword(token());
  constructor(
    readonly database: Database,
    readonly config: Config,
  ) {}
  get db(): Database['db'] {
    return this.database.db;
  }
  async audit(
    db: Store,
    actorId: string | null,
    action: string,
    targetId: string | null = null,
    organizationId: string | null = null,
    metadata: Record<string, string | boolean | string[]> = {},
  ) {
    await db
      .insert(auditEvents)
      .values({ actorId, action, targetId, organizationId, metadata });
  }
  async throttle(key: string, maximum: number, windowMinutes = 15) {
    if (Date.now() > this.nextCleanup) {
      this.nextCleanup = Date.now() + 60000;
      await this.db.execute(
        sql`delete from auth_throttle where key in (select key from auth_throttle where window_started_at < now() - interval '24 hours' order by window_started_at limit 1000)`,
      );
      await this.db.execute(
        sql`delete from sessions where token_hash in (select token_hash from sessions where expires_at < now() - interval '30 days' order by expires_at limit 1000)`,
      );
    }
    const now = new Date();
    const cutoff = new Date(now.getTime() - windowMinutes * 60000);
    const [row] = await this.db
      .insert(authThrottle)
      .values({
        key: digest(`${this.config.DEPLOYMENT_EDITION}:${key}`),
        count: 1,
        windowStartedAt: now,
      })
      .onConflictDoUpdate({
        target: authThrottle.key,
        set: {
          count: sql`case when ${authThrottle.windowStartedAt} < ${cutoff} then 1 else ${authThrottle.count} + 1 end`,
          windowStartedAt: sql`case when ${authThrottle.windowStartedAt} < ${cutoff} then ${now} else ${authThrottle.windowStartedAt} end`,
        },
      })
      .returning();
    if (!row || row.count > maximum) deny('RATE_LIMITED');
  }
  async issue(db: Store, userId: string, mfaVerified = false) {
    const raw = token();
    const hash = digest(raw);
    const csrf = csrfToken(raw);
    const [session] = await db
      .insert(sessions)
      .values({
        userId,
        tokenHash: hash,
        csrfHash: digest(csrf),
        edition: this.config.DEPLOYMENT_EDITION,
        expiresAt: new Date(
          Date.now() + this.config.SESSION_ABSOLUTE_MINUTES * 60000,
        ),
        mfaVerified,
      })
      .returning();
    if (!session) throw new Error('Session creation failed');
    return {
      token: raw,
      hash,
      csrfToken: csrf,
      id: session.id,
      userId,
      mfaVerified,
    };
  }
  async login(email: string, password: string, ip: string, oldToken?: string) {
    await this.throttle(`login-ip:${ip}`, 30);
    await this.throttle(`login-account:${email}`, 10);
    const [user] = await this.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.edition, this.config.DEPLOYMENT_EDITION),
          eq(users.email, email),
        ),
      );
    const valid = await verifyPassword(
      user?.passwordHash ?? (await this.dummyHash),
      password,
    );
    if (!user || user.status !== 'active' || !valid) {
      await this.audit(this.db, null, 'identity.login_failed');
      deny('INVALID_CREDENTIALS');
    }
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .for('update');
      if (
        !locked ||
        locked.status !== 'active' ||
        locked.passwordHash !== user.passwordHash
      )
        deny('INVALID_CREDENTIALS');
      if (oldToken)
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.tokenHash, digest(oldToken)));
      const session = await this.issue(tx, user.id);
      await this.audit(tx, user.id, 'identity.login');
      return session;
    });
  }
  async authenticate(raw: string | undefined): Promise<IdentitySession> {
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) deny('UNAUTHENTICATED');
    const hash = digest(raw);
    const [session] = await this.db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          eq(sessions.tokenHash, hash),
          eq(sessions.edition, this.config.DEPLOYMENT_EDITION),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          gt(
            sessions.lastSeenAt,
            new Date(Date.now() - this.config.SESSION_IDLE_MINUTES * 60000),
          ),
        ),
      )
      .returning();
    if (!session) deny('UNAUTHENTICATED');
    const result = {
      token: raw,
      hash,
      id: session.id,
      userId: session.userId,
      mfaVerified: session.mfaVerified,
    };
    await this.current(result, this.db);
    return result;
  }
  async current(session: IdentitySession, db: Store, lock = false) {
    const query = db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, session.hash),
          eq(users.id, session.userId),
          eq(users.status, 'active'),
          eq(users.edition, this.config.DEPLOYMENT_EDITION),
          eq(sessions.edition, this.config.DEPLOYMENT_EDITION),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          gt(
            sessions.lastSeenAt,
            new Date(Date.now() - this.config.SESSION_IDLE_MINUTES * 60000),
          ),
        ),
      );
    const [row] = await (lock ? query.for('update', { of: sessions }) : query);
    if (!row) deny('UNAUTHENTICATED');
    return row;
  }
  async mfaState(userId: string, db: Store) {
    const [credential] = await db
      .select()
      .from(mfaCredentials)
      .where(eq(mfaCredentials.userId, userId));
    const privileged = await db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, 'active'),
          eq(organizations.status, 'active'),
          eq(organizations.edition, this.config.DEPLOYMENT_EDITION),
          sql`(${memberships.isOwner} or exists (select 1 from membership_roles mr join role_permissions rp on rp.organization_id=mr.organization_id and rp.role_id=mr.role_id where mr.organization_id=${memberships.organizationId} and mr.membership_id=${memberships.id} and rp.permission_key in ('members.manage','roles.manage','audit.read','organization.manage','customers.manage','catalog.manage','catalog.tax.verify','invoices.read','invoices.manage','invoices.finalize','invoices.correct','invoices.cancel','price.override','tax.override','place_of_supply.override')))`,
        ),
      )
      .limit(1);
    const mandatory =
      this.config.DEPLOYMENT_EDITION === 'saas' && privileged.length > 0;
    return {
      enabled: Boolean(credential?.secret),
      mandatory,
      required: Boolean(credential?.secret) || mandatory,
    };
  }
  async full(session: IdentitySession, db: Store, lock = false) {
    const current = await this.current(session, db, lock);
    if (current.user.mustChangePassword) deny('PASSWORD_CHANGE_REQUIRED');
    const mfa = await this.mfaState(session.userId, db);
    if (mfa.required && !current.session.mfaVerified) deny('MFA_REQUIRED');
    return current;
  }
  async sessionInfo(session: IdentitySession) {
    const { user, session: record } = await this.current(session, this.db);
    const mfa = await this.mfaState(user.id, this.db);
    return {
      user: { id: user.id, email: user.email, name: user.name },
      csrfToken: csrfToken(session.token),
      mustChangePassword: user.mustChangePassword,
      mfaEnabled: mfa.enabled,
      mfaMandatory: mfa.mandatory,
      mfaRequired: mfa.required && !record.mfaVerified,
    };
  }
  verifyCsrf(session: IdentitySession, supplied: string | undefined) {
    if (!supplied || !secureEqual(csrfToken(session.token), supplied))
      deny('CSRF_INVALID');
  }
  async revoke(session: IdentitySession, all = false, sessionId?: string) {
    return this.db.transaction(async (tx) => {
      await this.current(session, tx, true);
      if (sessionId) await this.full(session, tx);
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.userId, session.userId),
            ...(all
              ? []
              : [
                  sessionId
                    ? eq(sessions.id, sessionId)
                    : eq(sessions.tokenHash, session.hash),
                ]),
          ),
        );
      await this.audit(tx, session.userId, 'identity.sessions_revoked');
    });
  }
  async listSessions(session: IdentitySession) {
    await this.full(session, this.db);
    return this.db
      .select({
        id: sessions.id,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, session.userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          gt(
            sessions.lastSeenAt,
            new Date(Date.now() - this.config.SESSION_IDLE_MINUTES * 60000),
          ),
        ),
      )
      .orderBy(desc(sessions.createdAt))
      .limit(50);
  }
  async changePassword(
    session: IdentitySession,
    currentPassword: string,
    newPassword: string,
  ) {
    await this.throttle(`password:${session.userId}`, 10);
    const { user } = await this.current(session, this.db);
    if ((await this.mfaState(user.id, this.db)).enabled && !session.mfaVerified)
      deny('MFA_REQUIRED');
    if (!(await verifyPassword(user.passwordHash, currentPassword)))
      deny('INVALID_CREDENTIALS');
    const passwordHash = await hashPassword(newPassword);
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .for('update');
      if (!locked || locked.passwordHash !== user.passwordHash)
        deny('CONFLICT');
      const current = await this.current(session, tx, true);
      await tx
        .update(users)
        .set({ passwordHash, mustChangePassword: false })
        .where(eq(users.id, user.id));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.userId, user.id));
      const fresh = await this.issue(tx, user.id, current.session.mfaVerified);
      await this.audit(tx, user.id, 'identity.password_changed');
      return fresh;
    });
  }
  encryptionKey() {
    return this.config.AUTH_DATA_KEY ?? deny('SECURITY_UNAVAILABLE');
  }
  async enrollMfa(session: IdentitySession, password: string) {
    await this.throttle(`mfa-enroll:${session.userId}`, 10);
    const { user } = await this.current(session, this.db);
    if (user.mustChangePassword) deny('PASSWORD_CHANGE_REQUIRED');
    if (!(await verifyPassword(user.passwordHash, password)))
      deny('INVALID_CREDENTIALS');
    const key = this.encryptionKey();
    const secret = newTotpSecret();
    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .for('update');
      if (!locked || locked.passwordHash !== user.passwordHash)
        deny('CONFLICT');
      await this.current(session, tx, true);
      const [existing] = await tx
        .select()
        .from(mfaCredentials)
        .where(eq(mfaCredentials.userId, user.id));
      if (existing?.secret) deny('CONFLICT');
      await tx
        .insert(mfaCredentials)
        .values({
          userId: user.id,
          pendingSecret: encryptSecret(secret, key, user.id),
          pendingExpiresAt: new Date(Date.now() + 10 * 60000),
        })
        .onConflictDoUpdate({
          target: mfaCredentials.userId,
          set: {
            pendingSecret: encryptSecret(secret, key, user.id),
            pendingExpiresAt: new Date(Date.now() + 10 * 60000),
          },
        });
      await this.audit(tx, user.id, 'identity.mfa_enrollment_started');
    });
    return { secret, uri: createTotp(secret, user.email).toString() };
  }
  async checkMfa(
    tx: DatabaseTransaction,
    userId: string,
    code: string,
    pending = false,
  ) {
    const [credential] = await tx
      .select()
      .from(mfaCredentials)
      .where(eq(mfaCredentials.userId, userId))
      .for('update');
    const encrypted = pending ? credential?.pendingSecret : credential?.secret;
    if (
      !credential ||
      !encrypted ||
      (pending &&
        (!credential.pendingExpiresAt ||
          credential.pendingExpiresAt <= new Date() ||
          credential.secret))
    )
      deny('INVALID_CREDENTIALS');
    const secret = decryptSecret(encrypted, this.encryptionKey(), userId);
    const counter = totpCounter(secret, code, credential.lastCounter);
    if (counter !== null) {
      await tx
        .update(mfaCredentials)
        .set({ lastCounter: counter })
        .where(eq(mfaCredentials.userId, userId));
    } else if (!pending) {
      const used = await tx
        .delete(recoveryCodes)
        .where(
          and(
            eq(recoveryCodes.userId, userId),
            eq(recoveryCodes.codeHash, digest(code)),
          ),
        )
        .returning();
      if (used.length !== 1) deny('INVALID_CREDENTIALS');
    } else deny('INVALID_CREDENTIALS');
    return { encrypted, secret };
  }
  async newRecoveryCodes(tx: DatabaseTransaction, userId: string) {
    const codes = Array.from({ length: 10 }, () => token());
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx
      .insert(recoveryCodes)
      .values(codes.map((code) => ({ userId, codeHash: digest(code) })));
    return codes;
  }
  async verifyMfa(session: IdentitySession, code: string, confirm = false) {
    await this.throttle(`mfa:${session.userId}`, 10, 5);
    return this.db.transaction(async (tx) => {
      await tx
        .select()
        .from(users)
        .where(eq(users.id, session.userId))
        .for('update');
      await this.current(session, tx, true);
      const { encrypted } = await this.checkMfa(
        tx,
        session.userId,
        code,
        confirm,
      );
      let codes: string[] | undefined;
      if (confirm) {
        await tx
          .update(mfaCredentials)
          .set({
            secret: encrypted,
            pendingSecret: null,
            pendingExpiresAt: null,
          })
          .where(eq(mfaCredentials.userId, session.userId));
        codes = await this.newRecoveryCodes(tx, session.userId);
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.userId, session.userId));
      } else
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.tokenHash, session.hash));
      const fresh = await this.issue(tx, session.userId, true);
      await this.audit(
        tx,
        session.userId,
        confirm ? 'identity.mfa_enabled' : 'identity.mfa_verified',
      );
      return { session: fresh, recoveryCodes: codes };
    });
  }
  async manageMfa(
    session: IdentitySession,
    password: string,
    code: string,
    disable: boolean,
  ) {
    await this.throttle(`mfa:${session.userId}`, 10, 5);
    const { user } = await this.full(session, this.db);
    if (!(await verifyPassword(user.passwordHash, password)))
      deny('INVALID_CREDENTIALS');
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .for('update');
      if (!locked || locked.passwordHash !== user.passwordHash)
        deny('CONFLICT');
      await this.full(session, tx, true);
      if (disable && (await this.mfaState(user.id, tx)).mandatory)
        deny('FORBIDDEN');
      await this.checkMfa(tx, user.id, code);
      let codes: string[] | undefined;
      if (disable) {
        await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
        await tx
          .delete(mfaCredentials)
          .where(eq(mfaCredentials.userId, user.id));
      } else codes = await this.newRecoveryCodes(tx, user.id);
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.userId, user.id));
      const fresh = await this.issue(tx, user.id, !disable);
      await this.audit(
        tx,
        user.id,
        disable ? 'identity.mfa_disabled' : 'identity.mfa_recovery_rotated',
      );
      return { session: fresh, recoveryCodes: codes };
    });
  }
  async recoverOwner(
    email: string,
    credential: string,
    password: string,
    replacement = token(),
  ) {
    if (this.config.DEPLOYMENT_EDITION !== 'offline') deny('FORBIDDEN');
    const passwordHash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(users)
        .where(and(eq(users.edition, 'offline'), eq(users.email, email)))
        .for('update');
      if (!user) deny('INVALID_CREDENTIALS');
      const owned = await tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, user.id),
            eq(memberships.isOwner, true),
            eq(memberships.status, 'active'),
          ),
        );
      if (!owned.length) deny('FORBIDDEN');
      const [proof] = await tx
        .select()
        .from(ownerRecovery)
        .where(eq(ownerRecovery.userId, user.id))
        .for('update');
      if (!proof || !secureEqual(proof.tokenHash, digest(credential)))
        deny('INVALID_CREDENTIALS');
      await tx
        .update(users)
        .set({ passwordHash, mustChangePassword: false })
        .where(eq(users.id, user.id));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
      await tx.delete(mfaCredentials).where(eq(mfaCredentials.userId, user.id));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.userId, user.id));
      await tx
        .update(ownerRecovery)
        .set({ tokenHash: digest(replacement), createdAt: new Date() })
        .where(eq(ownerRecovery.userId, user.id));
      for (const membership of owned)
        await this.audit(
          tx,
          user.id,
          'identity.owner_recovered',
          user.id,
          membership.organizationId,
        );
      return replacement;
    });
  }
}
