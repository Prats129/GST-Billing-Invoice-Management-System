import { z } from 'zod';
import { emailSchema, passwordSchema } from './index.js';
import {
  entitlementClaimsSchema,
  signedEntitlementSchema,
} from './entitlements.js';
export const platformLogin = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export const platformProof = z
  .object({
    password: z.string().min(1).max(128),
    code: z.string().min(6).max(64),
  })
  .strict();
export const platformPassword = z.object({ password: passwordSchema }).strict();
export const platformCode = z
  .object({ code: z.string().min(6).max(64) })
  .strict();
const text = z.string().trim().max(1000),
  date = z.string().datetime();
export const platformOrganization = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: emailSchema,
    contactName: text.max(120).default(''),
    phone: text.default(''),
    edition: z.enum(['saas', 'offline']),
    runtimeId: z.string().uuid().optional(),
    installationId: z.string().uuid().optional(),
    mode: z.enum(['create', 'link']).default('link'),
    requestKey: z.string().uuid(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.edition === 'offline' &&
      (!v.runtimeId || !v.installationId || v.mode !== 'link')
    )
      c.addIssue({
        code: 'custom',
        message: 'Offline organizations require existing host identifiers.',
      });
    if (v.mode === 'link' && !v.runtimeId)
      c.addIssue({
        code: 'custom',
        message: 'Runtime organization ID required.',
      });
    if (v.edition === 'saas' && v.installationId)
      c.addIssue({
        code: 'custom',
        message: 'SaaS cannot bind an installation.',
      });
  });
export const platformContact = z
  .object({
    version: z.number().int().min(1),
    name: z.string().trim().min(1).max(200),
    email: emailSchema,
    contactName: text,
    phone: text,
    state: z.enum(['registered', 'archived']),
    requestKey: z.string().uuid(),
  })
  .strict();
export const platformAgreement = z
  .object({
    kind: z.enum(['subscription', 'perpetual', 'maintenance']),
    startsAt: date,
    endsAt: date.nullable(),
    dueDate: z.string().date(),
    totalPaise: z.string().regex(/^(0|[1-9][0-9]{0,11})$/),
    reference: text,
    requestKey: z.string().uuid(),
  })
  .strict()
  .refine(
    (v) =>
      v.endsAt === null
        ? v.kind === 'perpetual'
        : Date.parse(v.endsAt) > Date.parse(v.startsAt),
    'Check agreement dates.',
  );
export const platformReceipt = z
  .object({
    agreementId: z.string().uuid(),
    amountPaise: z.string().regex(/^[1-9][0-9]{0,11}$/),
    receivedAt: date,
    reference: text.min(1),
    requestKey: z.string().uuid(),
  })
  .strict();
export const platformAdjustment = z
  .object({
    receiptId: z.string().uuid(),
    amountPaise: z.string().regex(/^[1-9][0-9]{0,11}$/),
    kind: z.enum(['refund', 'reversal']),
    reason: text.min(1),
    requestKey: z.string().uuid(),
  })
  .strict();
export const platformReason = z
  .object({
    reason: text.min(1),
    requestKey: z.string().uuid(),
    version: z.number().int().min(1).optional(),
  })
  .strict();
export const platformLicenseRequest = z
  .object({ claims: entitlementClaimsSchema, requestKey: z.string().uuid() })
  .strict();
export const platformGrantImport = z
  .object({
    requestId: z.string().uuid().nullable(),
    grants: z.array(signedEntitlementSchema).min(1).max(100),
    requestKey: z.string().uuid(),
  })
  .strict();
export const platformPause = z
  .object({
    paused: z.boolean(),
    reason: text.min(1),
    requestKey: z.string().uuid(),
  })
  .strict();
export const platformApply = z
  .object({ grantId: z.string().uuid(), requestKey: z.string().uuid() })
  .strict();
export const platformDelivery = z
  .object({
    grantId: z.string().uuid(),
    state: z.enum(['delivery_recorded', 'operator_confirmed']),
    note: text.min(1),
    requestKey: z.string().uuid(),
  })
  .strict();
export const platformKey = z.object({ requestKey: z.string().uuid() }).strict();
export interface PlatformOrganizationView {
  id: string;
  runtime_id: string;
  edition: 'saas' | 'offline';
  installation_id: string | null;
  name: string;
  email: string;
  contact_name: string;
  phone: string;
  state: string;
  version: number;
}
export const platformSession = z
  .object({
    user: z.object({
      id: z.string().uuid(),
      name: z.string(),
      email: emailSchema,
    }),
    mfaEnabled: z.boolean(),
    mfaVerified: z.boolean(),
    csrfToken: z.string(),
  })
  .strict();
export type PlatformSession = z.infer<typeof platformSession>;

const id = z.string().uuid(),
  stamp = z.string().datetime(),
  amount = z.string().regex(/^-?[0-9]+$/);
export const platformOrganizationView = z
  .object({
    id,
    runtime_id: id,
    edition: z.enum(['saas', 'offline']),
    installation_id: id.nullable(),
    name: z.string(),
    email: emailSchema,
    contact_name: z.string(),
    phone: z.string(),
    state: z.enum(['pending', 'registered', 'archived']),
    version: z.number().int().positive(),
    created_at: stamp,
  })
  .strict();
export const platformDirectory = z
  .object({
    items: z.array(platformOrganizationView).max(50),
    hasMore: z.boolean(),
  })
  .strict();
const agreementView = z
  .object({
    id,
    organization_id: id,
    kind: z.enum(['subscription', 'perpetual', 'maintenance']),
    starts_at: stamp,
    ends_at: stamp.nullable(),
    due_date: z.string(),
    total_paise: amount,
    reference: z.string(),
    version: z.number().int(),
    state: z.enum(['active', 'void']),
    created_at: stamp,
    paid_paise: amount,
  })
  .strict();
const receiptView = z
  .object({
    id,
    organization_id: id,
    agreement_id: id,
    amount_paise: amount,
    reference: z.string(),
    received_at: stamp,
    created_at: stamp,
  })
  .strict();
const adjustmentView = z
  .object({
    id,
    agreement_id: id,
    receipt_id: id,
    amount_paise: amount,
    kind: z.enum(['refund', 'reversal']),
    reason: z.string(),
    created_at: stamp,
  })
  .strict();
const grantView = z
  .object({
    id,
    organization_id: id,
    sequence: z.number().int().positive(),
    envelope: signedEntitlementSchema,
    claims: entitlementClaimsSchema,
    imported_at: stamp,
  })
  .strict();
const requestView = z
  .object({
    id,
    organization_id: id,
    claims: entitlementClaimsSchema,
    predecessor: signedEntitlementSchema.nullable(),
    created_at: stamp,
  })
  .strict();
const deliveryView = z
  .object({
    id,
    organization_id: id,
    grant_id: id,
    state: z.enum(['delivery_recorded', 'operator_confirmed']),
    note: z.string(),
    created_at: stamp,
  })
  .strict();
const auditView = z
  .object({
    id: z.string(),
    actor_id: id.nullable(),
    organization_id: id.nullable(),
    action: z.string(),
    target_id: id.nullable(),
    metadata: z.json(),
    created_at: stamp,
  })
  .strict();
export const platformOperationView = z
  .object({
    id,
    organization_id: id.optional(),
    kind: z.enum(['provision', 'setup_link', 'install_grant', 'pause']),
    state: z.enum(['pending', 'running', 'retryable', 'conflict', 'completed']),
    attempts: z.number().int().optional(),
    error_code: z.string().nullable(),
    result: z.json().optional(),
    created_at: stamp,
    completed_at: stamp.nullable().optional(),
  })
  .strict();
export const platformOperationQuery = z
  .object({
    q: z
      .string()
      .trim()
      .max(36)
      .regex(/^[a-f0-9-]*$/i)
      .default(''),
    state: platformOperationView.shape.state.or(z.literal('')).default(''),
    kind: platformOperationView.shape.kind.or(z.literal('')).default(''),
    organizationId: z.string().uuid().or(z.literal('')).default(''),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const platformOperationPage = z
  .object({
    items: z.array(platformOperationView).max(50),
    hasMore: z.boolean(),
  })
  .strict();
export const platformDetail = z
  .object({
    organization: platformOrganizationView,
    commercialSummary: z
      .object({
        agreementCount: z.number().int().nonnegative(),
        outstandingPaise: amount,
      })
      .strict()
      .optional(),
    agreements: z.array(agreementView),
    receipts: z.array(receiptView),
    adjustments: z.array(adjustmentView),
    grants: z.array(grantView),
    requests: z.array(requestView),
    delivery: z.array(deliveryView),
    activity: z.array(auditView),
    operations: z.array(platformOperationView),
    observation: z
      .object({ value: z.json(), observed_at: stamp })
      .strict()
      .nullable(),
  })
  .strict();
// Validate complete read responses at the HTTP boundary and in the admin client.
export const platformDiagnostics = z
  .object({
    checkedAt: stamp,
    checks: z
      .array(
        z
          .object({
            code: z.enum([
              'WORKER_ENABLED',
              'WORKER_DISABLED',
              'PLATFORM_CONTROL_UNAVAILABLE',
              'SAAS_NOT_CONFIGURED',
              'SAAS_REACHABLE',
              'SAAS_TARGET_UNCONFIRMED',
              'SAAS_TARGET_MATCHED',
              'SAAS_TARGET_MISMATCH',
              'SAAS_MIGRATIONS_REQUIRED',
              'SAAS_PERMISSIONS_REQUIRED',
              'SAAS_ROLE_UNSAFE',
              'SAAS_OPERATOR_READY',
              'SAAS_PROBE_FAILED',
              'SAAS_ORIGIN_CONFIGURED',
              'SAAS_ORIGIN_MISSING',
              'TRUST_CONFIGURED',
              'TRUST_MISSING',
            ]),
            state: z.enum(['ready', 'blocked']),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export type PlatformDiagnostics = z.infer<typeof platformDiagnostics>;
export function platformReadResponse(path: string, value: unknown): unknown {
  if (path === 'diagnostics') return platformDiagnostics.parse(value);
  if (path === 'auth/session') return platformSession.parse(value);
  if (path.split('?')[0] === 'organizations')
    return platformDirectory.parse(value);
  if (/^organizations\/[a-f0-9-]{36}$/.test(path))
    return platformDetail.parse(value);
  if (path === 'operations') return z.array(platformOperationView).parse(value);
  if (path.split('?')[0] === 'operations/search')
    return platformOperationPage.parse(value);
  if (/^operations\/[a-f0-9-]{36}$/i.test(path))
    return platformOperationView.parse(value);
  if (/^organizations\/[a-f0-9-]{36}\/grants\/[a-f0-9-]{36}$/.test(path))
    return signedEntitlementSchema.parse(value);
  return value;
}
