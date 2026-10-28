import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  date,
  numeric,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
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

export const businessProfiles = pgTable(
  'business_profiles',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id),
    legalName: varchar('legal_name', { length: 200 }).notNull(),
    tradeName: varchar('trade_name', { length: 200 }).notNull().default(''),
    address: jsonb('address')
      .$type<{
        line1: string;
        line2: string;
        city: string;
        stateCode: string;
        postalCode: string;
      }>()
      .notNull(),
    email: varchar('email', { length: 254 }).notNull().default(''),
    phone: varchar('phone', { length: 25 }).notNull().default(''),
    eInvoiceApplicability: varchar('e_invoice_applicability', { length: 16 })
      .notNull()
      .default('unknown'),
    bankName: varchar('bank_name', { length: 120 }).notNull().default(''),
    bankAccountName: varchar('bank_account_name', { length: 120 })
      .notNull()
      .default(''),
    bankAccountNumber: varchar('bank_account_number', { length: 34 })
      .notNull()
      .default(''),
    bankIfsc: varchar('bank_ifsc', { length: 11 }).notNull().default(''),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'business_profile_valid',
      sql`length(trim(${t.legalName})) > 0 and ${t.version} > 0 and jsonb_typeof(${t.address}) = 'object' and ${t.eInvoiceApplicability} in ('unknown','required','not_required')`,
    ),
  ],
);

export const gstRegistrations = pgTable(
  'gst_registrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    gstin: varchar('gstin', { length: 15 }).notNull(),
    stateCode: varchar('state_code', { length: 2 }).notNull(),
    taxpayerType: varchar('taxpayer_type', { length: 16 })
      .notNull()
      .default('regular'),
    active: boolean('active').notNull().default(true),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('gst_registrations_org_id_unique').on(t.organizationId, t.id),
    unique('gst_registrations_org_gstin_unique').on(t.organizationId, t.gstin),
    uniqueIndex('gst_registration_one_active')
      .on(t.organizationId)
      .where(sql`${t.active}`),
    check(
      'gst_registration_valid',
      sql`${t.taxpayerType} = 'regular' and ${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' and left(${t.gstin},2) = ${t.stateCode} and (${t.confirmedAt} is null) = (${t.confirmedBy} is null)`,
    ),
  ],
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    email: varchar('email', { length: 254 }).notNull().default(''),
    phone: varchar('phone', { length: 25 }).notNull().default(''),
    address: jsonb('address')
      .$type<{
        line1: string;
        line2: string;
        city: string;
        stateCode: string;
        postalCode: string;
      }>()
      .notNull(),
    gstin: varchar('gstin', { length: 15 }).notNull().default(''),
    notes: varchar('notes', { length: 1000 }).notNull().default(''),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('customers_org_id_unique').on(t.organizationId, t.id),
    unique('customers_org_code_unique').on(t.organizationId, t.code),
    index('customers_org_archive_name_idx').on(
      t.organizationId,
      t.archivedAt,
      t.name,
      t.id,
    ),
    check(
      'customers_valid',
      sql`${t.version} > 0 and length(trim(${t.name})) > 0 and ${t.code} ~ '^[A-Z0-9][A-Z0-9._/-]*$' and jsonb_typeof(${t.address}) = 'object' and (${t.gstin} = '' or ${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')`,
    ),
  ],
);

export const catalogItems = pgTable(
  'catalog_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: varchar('description', { length: 1000 }).notNull().default(''),
    kind: varchar('kind', { length: 8 }).notNull(),
    unitCode: varchar('unit_code', { length: 3 }).notNull(),
    price: numeric('price', { precision: 18, scale: 4 }).notNull(),
    priceIncludesGst: boolean('price_includes_gst').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('catalog_items_org_id_unique').on(t.organizationId, t.id),
    unique('catalog_items_org_code_unique').on(t.organizationId, t.code),
    index('catalog_items_org_archive_name_idx').on(
      t.organizationId,
      t.archivedAt,
      t.name,
      t.id,
    ),
    check(
      'catalog_items_valid',
      sql`${t.version} > 0 and length(trim(${t.name})) > 0 and ${t.code} ~ '^[A-Z0-9][A-Z0-9._/-]*$' and ${t.kind} in ('goods','service') and ${t.price} between 0 and 99999999999999.9999 and ${t.unitCode} in ('NOS','KGS','LTR','MTR','HRS','DAY','OTH')`,
    ),
  ],
);

export const catalogTaxRevisions = pgTable(
  'catalog_tax_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    itemId: uuid('item_id').notNull(),
    revision: integer('revision').notNull(),
    hsnSac: varchar('hsn_sac', { length: 8 }).notNull(),
    category: varchar('category', { length: 8 }).notNull(),
    gstPercent: numeric('gst_percent', { precision: 5, scale: 2 }).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('catalog_tax_org_id_unique').on(t.organizationId, t.id),
    unique('catalog_tax_org_item_revision_unique').on(
      t.organizationId,
      t.itemId,
      t.revision,
    ),
    foreignKey({
      columns: [t.organizationId, t.itemId],
      foreignColumns: [catalogItems.organizationId, catalogItems.id],
    }),
    check(
      'catalog_tax_valid',
      sql`${t.revision} > 0 and ${t.hsnSac} ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$' and ${t.gstPercent} between 0 and 100 and ((${t.category} = 'taxable' and ${t.gstPercent} > 0) or (${t.category} in ('nil','exempt') and ${t.gstPercent} = 0))`,
    ),
  ],
);

export const catalogTaxReviews = pgTable(
  'catalog_tax_reviews',
  {
    revisionId: uuid('revision_id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    verifiedBy: uuid('verified_by')
      .notNull()
      .references(() => users.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reference: varchar('reference', { length: 300 }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.revisionId],
      foreignColumns: [
        catalogTaxRevisions.organizationId,
        catalogTaxRevisions.id,
      ],
    }),
    check(
      'catalog_tax_review_reference_nonempty',
      sql`length(trim(${t.reference})) >= 5`,
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
