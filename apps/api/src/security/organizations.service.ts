import { permissionKeys } from '@gst/contracts';
import type {
  MemberInput,
  MemberUpdate,
  Permission,
  RoleInput,
} from '@gst/contracts';
import {
  and,
  asc,
  auditEvents,
  desc,
  eq,
  inArray,
  memberships,
  membershipRoles,
  organizations,
  ownerRecovery,
  permissions,
  rolePermissions,
  roles,
  sessions,
  sql,
  users,
} from '@gst/database';
import type { Database, DatabaseTransaction } from '@gst/database';
import { hashPassword, digest, token, verifyPassword } from './crypto.js';
import { deny } from './errors.js';
import type { IdentityService } from './identity.service.js';
import type { IdentitySession, Store, TenantAccess } from './types.js';
import { EntitlementsService } from '../licensing/entitlements.service.js';

export class OrganizationsService {
  readonly entitlements: EntitlementsService;
  constructor(
    readonly identity: IdentityService,
    entitlements?: EntitlementsService,
  ) {
    this.entitlements =
      entitlements ?? new EntitlementsService(identity.config);
  }
  get db(): Database['db'] {
    return this.identity.db;
  }
  async access(
    session: IdentitySession,
    organizationId: string,
    permission: Permission,
    db: Store,
  ): Promise<TenantAccess> {
    await this.identity.full(session, db);
    const [membership] = await db
      .select({ membership: memberships })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, session.userId),
          eq(memberships.status, 'active'),
          eq(organizations.status, 'active'),
          eq(organizations.edition, this.identity.config.DEPLOYMENT_EDITION),
        ),
      );
    if (!membership) deny('FORBIDDEN');
    const grants = await db
      .select({
        key: rolePermissions.permissionKey,
        delegable: rolePermissions.delegable,
      })
      .from(membershipRoles)
      .innerJoin(
        rolePermissions,
        and(
          eq(rolePermissions.organizationId, membershipRoles.organizationId),
          eq(rolePermissions.roleId, membershipRoles.roleId),
        ),
      )
      .where(
        and(
          eq(membershipRoles.organizationId, organizationId),
          eq(membershipRoles.membershipId, membership.membership.id),
        ),
      );
    const effective = membership.membership.isOwner
      ? [...permissionKeys]
      : [...new Set(grants.map((g) => g.key as Permission))];
    const delegable = membership.membership.isOwner
      ? [...permissionKeys]
      : [
          ...new Set(
            grants.filter((g) => g.delegable).map((g) => g.key as Permission),
          ),
        ];
    if (!effective.includes(permission)) deny('FORBIDDEN');
    return {
      organizationId,
      membershipId: membership.membership.id,
      isOwner: membership.membership.isOwner,
      permissions: effective,
      delegable,
    };
  }
  async write<T>(
    session: IdentitySession,
    orgId: string,
    permission: Permission,
    action: (tx: DatabaseTransaction, access: TenantAccess) => Promise<T>,
  ) {
    return this.db.transaction(async (tx) => {
      // Every tenant mutation shares this lock: permission revocation and last-owner
      // checks serialize with role, membership and ownership mutations.
      const [organization] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .for('update');
      if (!organization) deny('FORBIDDEN');
      await this.identity.current(session, tx, true);
      const access = await this.access(session, orgId, permission, tx);
      await this.entitlements.assertWritable(tx, orgId, permission);
      return action(tx, access);
    });
  }
  async list(session: IdentitySession) {
    await this.identity.full(session, this.db);
    return this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        isOwner: memberships.isOwner,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(
        and(
          eq(memberships.userId, session.userId),
          eq(memberships.status, 'active'),
          eq(organizations.status, 'active'),
          eq(organizations.edition, this.identity.config.DEPLOYMENT_EDITION),
        ),
      )
      .orderBy(asc(organizations.id))
      .limit(100);
  }
  async invitations(session: IdentitySession) {
    await this.identity.full(session, this.db);
    return this.db
      .select({ id: memberships.id, organizationName: organizations.name })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(
        and(
          eq(memberships.userId, session.userId),
          eq(memberships.status, 'invited'),
          eq(organizations.status, 'active'),
          eq(organizations.edition, this.identity.config.DEPLOYMENT_EDITION),
        ),
      )
      .orderBy(asc(memberships.id))
      .limit(50);
  }
  async acceptInvitation(session: IdentitySession, memberId: string) {
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.id, memberId),
            eq(memberships.userId, session.userId),
            eq(memberships.status, 'invited'),
          ),
        );
      if (!member) deny('FORBIDDEN');
      const [org] = await tx
        .select()
        .from(organizations)
        .where(
          and(
            eq(organizations.id, member.organizationId),
            eq(organizations.status, 'active'),
            eq(organizations.edition, this.identity.config.DEPLOYMENT_EDITION),
          ),
        )
        .for('update');
      if (!org) deny('FORBIDDEN');
      await tx
        .select()
        .from(users)
        .where(eq(users.id, session.userId))
        .for('update');
      await this.identity.full(session, tx, true);
      const accepted = await tx
        .update(memberships)
        .set({ status: 'active', acceptedAt: new Date() })
        .where(
          and(
            eq(memberships.id, memberId),
            eq(memberships.userId, session.userId),
            eq(memberships.status, 'invited'),
          ),
        )
        .returning();
      if (accepted.length !== 1) deny('CONFLICT');
      await this.identity.audit(
        tx,
        session.userId,
        'members.invitation_accepted',
        memberId,
        org.id,
      );
      return { ok: true };
    });
  }
  async details(session: IdentitySession, orgId: string) {
    const access = await this.access(
      session,
      orgId,
      'organization.read',
      this.db,
    );
    const [organization] = await this.db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    return {
      organization,
      access,
      permissionCatalog: permissionKeys,
      entitlement: await this.entitlements.describe(this.db, orgId),
    };
  }
  async listRoles(session: IdentitySession, orgId: string, offset: number) {
    await this.access(session, orgId, 'roles.read', this.db);
    const page = await this.db
      .select()
      .from(roles)
      .where(eq(roles.organizationId, orgId))
      .orderBy(asc(roles.id))
      .limit(50)
      .offset(offset);
    const grants = page.length
      ? await this.db
          .select()
          .from(rolePermissions)
          .where(
            and(
              eq(rolePermissions.organizationId, orgId),
              inArray(
                rolePermissions.roleId,
                page.map((r) => r.id),
              ),
            ),
          )
      : [];
    return page.map((role) => ({
      ...role,
      permissions: grants
        .filter((g) => g.roleId === role.id)
        .map((g) => g.permissionKey),
      delegable: grants
        .filter((g) => g.roleId === role.id && g.delegable)
        .map((g) => g.permissionKey),
    }));
  }
  ensureDelegation(
    access: TenantAccess,
    grants: string[],
    delegable: string[] = [],
  ) {
    if (
      !access.isOwner &&
      (delegable.length ||
        grants.some((g) => !access.delegable.includes(g as Permission)))
    )
      deny('FORBIDDEN');
  }
  async roleGrants(tx: Store, orgId: string, roleIds: string[]) {
    if (new Set(roleIds).size !== roleIds.length) deny('INVALID_INPUT');
    if (!roleIds.length) return [];
    const found = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, orgId), inArray(roles.id, roleIds)));
    if (found.length !== roleIds.length) deny('FORBIDDEN');
    return tx
      .select()
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.organizationId, orgId),
          inArray(rolePermissions.roleId, roleIds),
        ),
      );
  }
  async saveRole(
    session: IdentitySession,
    orgId: string,
    input: RoleInput,
    roleId?: string,
  ) {
    return this.write(session, orgId, 'roles.manage', async (tx, access) => {
      this.ensureDelegation(access, input.permissions, input.delegable);
      if (
        ['owner', 'administrator', 'staff'].includes(input.name.toLowerCase())
      )
        deny('INVALID_INPUT');
      if (roleId) {
        const [old] = await tx
          .select()
          .from(roles)
          .where(and(eq(roles.organizationId, orgId), eq(roles.id, roleId)));
        if (!old || old.system) deny('FORBIDDEN');
        const grants = await this.roleGrants(tx, orgId, [roleId]);
        this.ensureDelegation(
          access,
          grants.map((g) => g.permissionKey),
          grants.filter((g) => g.delegable).map((g) => g.permissionKey),
        );
        await tx
          .update(roles)
          .set({ name: input.name })
          .where(and(eq(roles.organizationId, orgId), eq(roles.id, roleId)));
        await tx
          .delete(rolePermissions)
          .where(
            and(
              eq(rolePermissions.organizationId, orgId),
              eq(rolePermissions.roleId, roleId),
            ),
          );
      } else {
        const [role] = await tx
          .insert(roles)
          .values({ organizationId: orgId, name: input.name })
          .returning();
        roleId = role!.id;
      }
      if (input.permissions.length)
        await tx.insert(rolePermissions).values(
          input.permissions.map((p) => ({
            organizationId: orgId,
            roleId: roleId!,
            permissionKey: p,
            delegable: input.delegable.includes(p),
          })),
        );
      await this.identity.audit(
        tx,
        session.userId,
        'roles.saved',
        roleId,
        orgId,
        { permissions: input.permissions, delegable: input.delegable },
      );
      return { id: roleId };
    });
  }
  async deleteRole(session: IdentitySession, orgId: string, roleId: string) {
    return this.write(session, orgId, 'roles.manage', async (tx, access) => {
      const [role] = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.organizationId, orgId), eq(roles.id, roleId)));
      if (!role || role.system) deny('FORBIDDEN');
      const grants = await this.roleGrants(tx, orgId, [roleId]);
      this.ensureDelegation(
        access,
        grants.map((g) => g.permissionKey),
        grants.filter((g) => g.delegable).map((g) => g.permissionKey),
      );
      await tx
        .delete(membershipRoles)
        .where(
          and(
            eq(membershipRoles.organizationId, orgId),
            eq(membershipRoles.roleId, roleId),
          ),
        );
      await tx
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.organizationId, orgId),
            eq(rolePermissions.roleId, roleId),
          ),
        );
      await tx
        .delete(roles)
        .where(and(eq(roles.organizationId, orgId), eq(roles.id, roleId)));
      await this.identity.audit(
        tx,
        session.userId,
        'roles.deleted',
        roleId,
        orgId,
      );
      return { ok: true };
    });
  }
  async listMembers(session: IdentitySession, orgId: string, offset: number) {
    await this.access(session, orgId, 'members.read', this.db);
    const page = await this.db
      .select({
        id: memberships.id,
        userId: users.id,
        email: users.email,
        name: users.name,
        status: memberships.status,
        isOwner: memberships.isOwner,
        acceptedAt: memberships.acceptedAt,
        userStatus: users.status,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, orgId))
      .orderBy(asc(memberships.id))
      .limit(50)
      .offset(offset);
    const assignments = page.length
      ? await this.db
          .select()
          .from(membershipRoles)
          .where(
            and(
              eq(membershipRoles.organizationId, orgId),
              inArray(
                membershipRoles.membershipId,
                page.map((m) => m.id),
              ),
            ),
          )
      : [];
    const roleIds = [...new Set(assignments.map((a) => a.roleId))];
    const grants = roleIds.length
      ? await this.db
          .select()
          .from(rolePermissions)
          .where(
            and(
              eq(rolePermissions.organizationId, orgId),
              inArray(rolePermissions.roleId, roleIds),
            ),
          )
      : [];
    return page.map(({ userStatus, ...member }) => {
      const assigned = assignments
        .filter((a) => a.membershipId === member.id)
        .map((a) => a.roleId);
      const effectivePermissions =
        member.status === 'active' && userStatus === 'active'
          ? member.isOwner
            ? [...permissionKeys]
            : [
                ...new Set(
                  grants
                    .filter((g) => assigned.includes(g.roleId))
                    .map((g) => g.permissionKey),
                ),
              ]
          : [];
      return { ...member, roleIds: assigned, effectivePermissions };
    });
  }
  async addMember(session: IdentitySession, orgId: string, input: MemberInput) {
    await this.access(session, orgId, 'members.manage', this.db);
    // Hash before holding a tenant lock; no new credential is persisted for an
    // existing identity and an admin never receives its password hash.
    const passwordHash = input.temporaryPassword
      ? await hashPassword(input.temporaryPassword)
      : undefined;
    return this.write(session, orgId, 'members.manage', async (tx, access) => {
      const grants = await this.roleGrants(tx, orgId, input.roleIds);
      this.ensureDelegation(
        access,
        grants.map((g) => g.permissionKey),
        grants.filter((g) => g.delegable).map((g) => g.permissionKey),
      );
      let [user] = await tx
        .select()
        .from(users)
        .where(
          and(
            eq(users.edition, this.identity.config.DEPLOYMENT_EDITION),
            eq(users.email, input.email),
          ),
        )
        .for('update');
      const existingIdentity = Boolean(user);
      if (!user) {
        if (!passwordHash) deny('INVALID_INPUT');
        [user] = await tx
          .insert(users)
          .values({
            edition: this.identity.config.DEPLOYMENT_EDITION,
            email: input.email,
            name: input.name,
            passwordHash,
            mustChangePassword: true,
          })
          .returning();
      } else if (input.temporaryPassword) deny('CONFLICT');
      if (user!.status !== 'active') deny('FORBIDDEN');
      const [membership] = await tx
        .insert(memberships)
        .values({
          organizationId: orgId,
          userId: user!.id,
          edition: this.identity.config.DEPLOYMENT_EDITION,
          status: existingIdentity ? 'invited' : 'active',
          acceptedAt: existingIdentity ? null : new Date(),
        })
        .returning();
      if (input.roleIds.length)
        await tx.insert(membershipRoles).values(
          input.roleIds.map((roleId) => ({
            organizationId: orgId,
            membershipId: membership!.id,
            roleId,
          })),
        );
      await this.identity.audit(
        tx,
        session.userId,
        existingIdentity ? 'members.invited' : 'members.added',
        membership!.id,
        orgId,
      );
      return { id: membership!.id };
    });
  }
  async target(
    tx: Store,
    orgId: string,
    memberId: string,
    access: TenantAccess,
  ) {
    const [member] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, orgId),
          eq(memberships.id, memberId),
        ),
      );
    if (!member || (!access.isOwner && member.isOwner)) deny('FORBIDDEN');
    const assigned = await tx
      .select()
      .from(membershipRoles)
      .where(
        and(
          eq(membershipRoles.organizationId, orgId),
          eq(membershipRoles.membershipId, memberId),
        ),
      );
    const grants = await this.roleGrants(
      tx,
      orgId,
      assigned.map((a) => a.roleId),
    );
    this.ensureDelegation(
      access,
      grants.map((g) => g.permissionKey),
      grants.filter((g) => g.delegable).map((g) => g.permissionKey),
    );
    return member;
  }
  async updateMember(
    session: IdentitySession,
    orgId: string,
    memberId: string,
    input: MemberUpdate,
  ) {
    return this.write(session, orgId, 'members.manage', async (tx, access) => {
      const target = await this.target(tx, orgId, memberId, access);
      if (!target.acceptedAt && input.status === 'active') deny('FORBIDDEN');
      if (input.roleIds) {
        const grants = await this.roleGrants(tx, orgId, input.roleIds);
        this.ensureDelegation(
          access,
          grants.map((g) => g.permissionKey),
          grants.filter((g) => g.delegable).map((g) => g.permissionKey),
        );
        await tx
          .delete(membershipRoles)
          .where(
            and(
              eq(membershipRoles.organizationId, orgId),
              eq(membershipRoles.membershipId, memberId),
            ),
          );
        if (input.roleIds.length)
          await tx.insert(membershipRoles).values(
            input.roleIds.map((roleId) => ({
              organizationId: orgId,
              membershipId: memberId,
              roleId,
            })),
          );
      }
      if (input.status)
        await tx
          .update(memberships)
          .set({ status: input.status })
          .where(
            and(
              eq(memberships.organizationId, orgId),
              eq(memberships.id, memberId),
            ),
          );
      await this.identity.audit(
        tx,
        session.userId,
        'members.updated',
        memberId,
        orgId,
      );
      return { ok: true };
    });
  }
  async setOwner(
    session: IdentitySession,
    orgId: string,
    memberId: string,
    isOwner: boolean,
  ) {
    return this.write(session, orgId, 'members.manage', async (tx, access) => {
      if (!access.isOwner) deny('FORBIDDEN');
      const member = await this.target(tx, orgId, memberId, access);
      if (member.status !== 'active') deny('CONFLICT');
      await tx
        .update(memberships)
        .set({ isOwner })
        .where(
          and(
            eq(memberships.organizationId, orgId),
            eq(memberships.id, memberId),
          ),
        );
      await this.identity.audit(
        tx,
        session.userId,
        'members.ownership_changed',
        memberId,
        orgId,
        { isOwner },
      );
      return { ok: true };
    });
  }
  async resetPassword(
    session: IdentitySession,
    orgId: string,
    memberId: string,
    password: string,
  ) {
    await this.access(session, orgId, 'members.manage', this.db);
    const passwordHash = await hashPassword(password);
    return this.write(session, orgId, 'members.manage', async (tx, access) => {
      const member = await this.target(tx, orgId, memberId, access);
      if (
        !member.acceptedAt ||
        member.isOwner ||
        member.userId === session.userId
      )
        deny('FORBIDDEN');
      await tx
        .select()
        .from(users)
        .where(eq(users.id, member.userId))
        .for('update');
      // A tenant admin cannot reset a global credential belonging to another
      // organization: that would cross its authorization boundary. Pending
      // invitations convey no authority and must not let another tenant block
      // an otherwise authorized reset merely by inviting the user.
      const all = await tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, member.userId),
            sql`${memberships.acceptedAt} is not null`,
          ),
        );
      if (all.some((m) => m.organizationId !== orgId)) deny('FORBIDDEN');
      await tx
        .update(users)
        .set({ passwordHash, mustChangePassword: true })
        .where(eq(users.id, member.userId));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.userId, member.userId));
      await this.identity.audit(
        tx,
        session.userId,
        'members.password_reset',
        memberId,
        orgId,
      );
      return { ok: true };
    });
  }
  async removeMember(
    session: IdentitySession,
    orgId: string,
    memberId: string,
  ) {
    return this.write(session, orgId, 'members.manage', async (tx, access) => {
      await this.target(tx, orgId, memberId, access);
      await tx
        .delete(membershipRoles)
        .where(
          and(
            eq(membershipRoles.organizationId, orgId),
            eq(membershipRoles.membershipId, memberId),
          ),
        );
      await tx
        .delete(memberships)
        .where(
          and(
            eq(memberships.organizationId, orgId),
            eq(memberships.id, memberId),
          ),
        );
      await this.identity.audit(
        tx,
        session.userId,
        'members.removed',
        memberId,
        orgId,
      );
      return { ok: true };
    });
  }
  async auditLog(session: IdentitySession, orgId: string, offset: number) {
    await this.access(session, orgId, 'audit.read', this.db);
    return this.db
      .select({
        id: auditEvents.id,
        actorId: auditEvents.actorId,
        action: auditEvents.action,
        targetId: auditEvents.targetId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, orgId))
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(50)
      .offset(offset);
  }
  async provisionOwner(
    input: {
      organizationName: string;
      organizationId?: string | undefined;
      email: string;
      name: string;
      password: string;
    },
    suppliedRecovery?: string,
  ) {
    const passwordHash = await hashPassword(input.password);
    const recovery =
      this.identity.config.DEPLOYMENT_EDITION === 'offline'
        ? (suppliedRecovery ?? token())
        : undefined;
    return this.db.transaction(async (tx) => {
      await tx
        .insert(permissions)
        .values(permissionKeys.map((key) => ({ key, description: key })))
        .onConflictDoNothing();
      let [user] = await tx
        .select()
        .from(users)
        .where(
          and(
            eq(users.email, input.email),
            eq(users.edition, this.identity.config.DEPLOYMENT_EDITION),
          ),
        );
      if (user) {
        if (
          user.status !== 'active' ||
          !(await verifyPassword(user.passwordHash, input.password))
        )
          deny('INVALID_CREDENTIALS');
      } else
        [user] = await tx
          .insert(users)
          .values({
            edition: this.identity.config.DEPLOYMENT_EDITION,
            email: input.email,
            name: input.name,
            passwordHash,
          })
          .returning();
      let org: typeof organizations.$inferSelect | undefined;
      if (input.organizationId) {
        [org] = await tx
          .select()
          .from(organizations)
          .where(
            and(
              eq(organizations.id, input.organizationId),
              eq(
                organizations.edition,
                this.identity.config.DEPLOYMENT_EDITION,
              ),
            ),
          )
          .for('update');
        const existingMembers = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.organizationId, input.organizationId))
          .limit(1);
        if (!org || existingMembers.length) deny('CONFLICT');
      } else
        [org] = await tx
          .insert(organizations)
          .values({
            name: input.organizationName,
            edition: this.identity.config.DEPLOYMENT_EDITION,
          })
          .returning();
      const [membership] = await tx
        .insert(memberships)
        .values({
          organizationId: org!.id,
          userId: user!.id,
          isOwner: true,
          edition: this.identity.config.DEPLOYMENT_EDITION,
        })
        .returning();
      for (const [name, grants] of [
        ['Administrator', [...permissionKeys]],
        ['Staff', ['organization.read']],
      ] as const) {
        const [role] = await tx
          .insert(roles)
          .values({ organizationId: org!.id, name, system: true })
          .returning();
        await tx.insert(rolePermissions).values(
          grants.map((key) => ({
            organizationId: org!.id,
            roleId: role!.id,
            permissionKey: key,
            delegable: false,
          })),
        );
      }
      // Existing owners retain their recovery credential; provisioning an extra
      // organization must never silently rotate their host-recovery proof.
      let recoveryCredential: string | undefined;
      if (recovery) {
        const created = await tx
          .insert(ownerRecovery)
          .values({ userId: user!.id, tokenHash: digest(recovery) })
          .onConflictDoNothing()
          .returning();
        if (created.length) recoveryCredential = recovery;
      }
      await this.identity.audit(
        tx,
        user!.id,
        'organization.provisioned',
        org!.id,
        org!.id,
      );
      return {
        organizationId: org!.id,
        userId: user!.id,
        membershipId: membership!.id,
        recoveryCredential,
      };
    });
  }
}
