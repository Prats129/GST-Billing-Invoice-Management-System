import { z } from 'zod';
import type { EntitlementInfo } from './entitlements.js';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('gst-api'),
  apiVersion: z.literal('1'),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export const readinessResponseSchema = z.object({
  status: z.literal('ready'),
  database: z.literal('up'),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export const permissionKeys = [
  'organization.read',
  'organization.manage',
  'members.read',
  'members.manage',
  'roles.read',
  'roles.manage',
  'audit.read',
  'customers.read',
  'customers.manage',
  'catalog.read',
  'catalog.manage',
  'catalog.tax.verify',
  'invoices.read',
  'invoices.manage',
  'invoices.finalize',
  'invoices.correct',
  'invoices.cancel',
  'price.override',
  'tax.override',
  'place_of_supply.override',
] as const;
export const permissionSchema = z.enum(permissionKeys);
export type Permission = z.infer<typeof permissionSchema>;
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(15)
  .max(128)
  .refine(
    (value) => !value.startsWith('REPLACE_WITH_'),
    'Choose a private password instead of the documentation placeholder',
  );
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
    code: z.string().trim().min(6).max(64).optional(),
  })
  .strict();
export const roleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    permissions: z.array(permissionSchema).max(permissionKeys.length),
    delegable: z.array(permissionSchema).max(permissionKeys.length).default([]),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.permissions).size === v.permissions.length &&
      new Set(v.delegable).size === v.delegable.length &&
      v.delegable.every((p) => v.permissions.includes(p)),
    'Delegation must be a subset of unique permissions',
  );
export const memberInputSchema = z
  .object({
    email: emailSchema,
    name: z.string().trim().min(1).max(120),
    temporaryPassword: passwordSchema.optional(),
    roleIds: z.array(z.string().uuid()).max(20).default([]),
  })
  .strict();
export const memberUpdateSchema = z
  .object({
    status: z.enum(['active', 'suspended']).optional(),
    roleIds: z.array(z.string().uuid()).max(20).optional(),
  })
  .strict();
export const ownerUpdateSchema = z.object({ isOwner: z.boolean() }).strict();
export const resetPasswordSchema = z
  .object({ temporaryPassword: passwordSchema })
  .strict();
export const mfaCodeSchema = z
  .object({
    code: z.string().trim().min(6).max(64),
    rememberDevice: z.boolean().default(false),
  })
  .strict();
export type RoleInput = z.infer<typeof roleInputSchema>;
export type MemberInput = z.infer<typeof memberInputSchema>;
export type MemberUpdate = z.infer<typeof memberUpdateSchema>;
export const appearanceSchema = z
  .object({
    mode: z.enum(['system', 'light', 'dark']),
    accent: z.enum(['teal', 'blue', 'violet']),
  })
  .strict();
export type Appearance = z.infer<typeof appearanceSchema>;
export const defaultAppearance: Appearance = { mode: 'system', accent: 'teal' };
export const sessionInfoSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string(),
    name: z.string(),
  }),
  csrfToken: z.string().length(64),
  mustChangePassword: z.boolean(),
  mfaEnabled: z.boolean(),
  mfaMandatory: z.boolean(),
  mfaRequired: z.boolean(),
  recoveryCodes: z.array(z.string()).optional(),
  appearance: appearanceSchema.default(defaultAppearance),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;
export const organizationListSchema = z.array(
  z.object({ id: z.string().uuid(), name: z.string(), isOwner: z.boolean() }),
);
export type OrganizationSummary = z.infer<
  typeof organizationListSchema
>[number];
export interface OrganizationAccess {
  entitlement?: EntitlementInfo;
  organization: { id: string; name: string };
  access: {
    isOwner: boolean;
    membershipId: string;
    permissions: Permission[];
    delegable: Permission[];
  };
  permissionCatalog: Permission[];
}
export interface RoleView {
  id: string;
  name: string;
  system: boolean;
  permissions: Permission[];
  delegable: Permission[];
}
export interface MemberView {
  id: string;
  userId: string;
  email: string;
  name: string;
  status: 'active' | 'suspended' | 'invited';
  isOwner: boolean;
  roleIds: string[];
  acceptedAt: string | null;
  effectivePermissions: Permission[];
}
export * from './business.js';
export * from './billing.js';
export * from './invoicing.js';
export * from './logo.js';
export * from './entitlements.js';
export * from './setup.js';
export * from './backup.js';
