import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    edition: varchar('edition', { length: 8 }).notNull().default('offline'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('organizations_id_edition_unique').on(table.id, table.edition),
    check('organizations_name_nonempty', sql`length(trim(${table.name})) > 0`),
    check(
      'organizations_edition_valid',
      sql`${table.edition} in ('offline', 'saas')`,
    ),
    check(
      'organizations_status_valid',
      sql`${table.status} in ('active', 'suspended', 'archived')`,
    ),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    edition: varchar('edition', { length: 8 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    mustChangePassword: boolean('must_change_password')
      .notNull()
      .default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('users_id_edition_unique').on(t.id, t.edition),
    unique('users_edition_email_unique').on(t.edition, t.email),
    check('users_edition_valid', sql`${t.edition} in ('offline', 'saas')`),
    check('users_status_valid', sql`${t.status} in ('active', 'disabled')`),
    check(
      'users_email_normalized',
      sql`${t.email} = lower(trim(${t.email})) and length(${t.email}) > 3`,
    ),
    check('users_name_nonempty', sql`length(trim(${t.name})) > 0`),
  ],
);

export const memberships = pgTable(
  'organization_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    edition: varchar('edition', { length: 8 }).notNull().default('offline'),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    isOwner: boolean('is_owner').notNull().default(false),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('memberships_org_user_unique').on(t.organizationId, t.userId),
    unique('memberships_org_id_unique').on(t.organizationId, t.id),
    index('memberships_user_org_idx').on(t.userId, t.organizationId),
    check(
      'memberships_status_valid',
      sql`${t.status} in ('active', 'suspended', 'invited')`,
    ),
    check(
      'memberships_active_accepted',
      sql`${t.status} <> 'active' or ${t.acceptedAt} is not null`,
    ),
    foreignKey({
      name: 'memberships_org_edition_fk',
      columns: [t.organizationId, t.edition],
      foreignColumns: [organizations.id, organizations.edition],
    }),
    foreignKey({
      name: 'memberships_user_edition_fk',
      columns: [t.userId, t.edition],
      foreignColumns: [users.id, users.edition],
    }),
  ],
);

export const permissions = pgTable('permissions', {
  key: varchar('key', { length: 80 }).primaryKey(),
  description: text('description').notNull(),
});
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: varchar('name', { length: 80 }).notNull(),
    system: boolean('system').notNull().default(false),
  },
  (t) => [
    unique('roles_org_id_unique').on(t.organizationId, t.id),
    unique('roles_org_name_unique').on(t.organizationId, t.name),
    check('roles_name_nonempty', sql`length(trim(${t.name})) > 0`),
  ],
);
export const rolePermissions = pgTable(
  'role_permissions',
  {
    organizationId: uuid('organization_id').notNull(),
    roleId: uuid('role_id').notNull(),
    permissionKey: varchar('permission_key', { length: 80 })
      .notNull()
      .references(() => permissions.key),
    delegable: boolean('delegable').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.roleId, t.permissionKey] }),
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }),
  ],
);
export const membershipRoles = pgTable(
  'membership_roles',
  {
    organizationId: uuid('organization_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    roleId: uuid('role_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.membershipId, t.roleId] }),
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }),
  ],
);
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().notNull().unique(),
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    csrfHash: varchar('csrf_hash', { length: 64 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    edition: varchar('edition', { length: 8 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_expiry_idx').on(t.expiresAt),
    foreignKey({
      name: 'sessions_user_edition_fk',
      columns: [t.userId, t.edition],
      foreignColumns: [users.id, users.edition],
    }),
  ],
);
export const mfaCredentials = pgTable('mfa_credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  secret: text('secret'),
  pendingSecret: text('pending_secret'),
  pendingExpiresAt: timestamp('pending_expires_at', { withTimezone: true }),
  lastCounter: integer('last_counter').notNull().default(-1),
});
export const recoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.codeHash] })],
);
export const ownerRecovery = pgTable('owner_recovery', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const authThrottle = pgTable(
  'auth_throttle',
  {
    key: varchar('key', { length: 64 }).primaryKey(),
    count: integer('count').notNull(),
    windowStartedAt: timestamp('window_started_at', {
      withTimezone: true,
    }).notNull(),
  },
  (t) => [index('auth_throttle_window_idx').on(t.windowStartedAt)],
);
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    actorId: uuid('actor_id').references(() => users.id),
    action: varchar('action', { length: 80 }).notNull(),
    targetId: uuid('target_id'),
    metadata: jsonb('metadata')
      .$type<Record<string, string | boolean | string[]>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('audit_org_date_idx').on(t.organizationId, t.createdAt)],
);
