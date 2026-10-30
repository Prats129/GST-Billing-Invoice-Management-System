import { z } from 'zod';

const timestamp = z.string().datetime();
const common = {
  version: z.literal(1),
  entitlementId: z.string().uuid(),
  organizationId: z.string().uuid(),
  sequence: z.number().int().min(1).max(2147483646),
  issuedAt: timestamp,
  startsAt: timestamp,
  maintenanceUntil: timestamp.nullable(),
};
export const entitlementClaimsSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        ...common,
        kind: z.literal('perpetual'),
        edition: z.literal('offline'),
        installationId: z.string().uuid(),
        expiresAt: z.null(),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal('trial'),
        edition: z.enum(['offline', 'saas']),
        installationId: z.string().uuid().nullable(),
        expiresAt: timestamp,
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal('subscription'),
        edition: z.enum(['offline', 'saas']),
        installationId: z.string().uuid().nullable(),
        expiresAt: timestamp,
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if ((value.edition === 'offline') !== (value.installationId !== null))
      ctx.addIssue({
        code: 'custom',
        message:
          'Offline grants require installation binding; SaaS grants must not bind a host.',
      });
    if (Date.parse(value.issuedAt) > Date.parse(value.startsAt))
      ctx.addIssue({
        code: 'custom',
        message: 'Issue time must not follow start time.',
      });
    if (
      value.expiresAt &&
      Date.parse(value.expiresAt) <= Date.parse(value.startsAt)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Expiry must follow start time.',
      });
    if (
      value.kind === 'trial' &&
      Date.parse(value.expiresAt) - Date.parse(value.startsAt) !== 14 * 86400000
    )
      ctx.addIssue({ code: 'custom', message: 'Trials last exactly 14 days.' });
  });
export type EntitlementClaims = z.infer<typeof entitlementClaimsSchema>;
export const signedEntitlementSchema = z
  .object({
    keyId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/),
    payload: z
      .string()
      .min(1)
      .max(8192)
      .regex(/^[a-zA-Z0-9_-]+$/),
    signature: z
      .string()
      .length(86)
      .regex(/^[a-zA-Z0-9_-]+$/),
  })
  .strict();
export type SignedEntitlement = z.infer<typeof signedEntitlementSchema>;
export interface EntitlementInfo {
  status:
    | 'development'
    | 'missing'
    | 'invalid'
    | 'active'
    | 'expired'
    | 'not_started'
    | 'wrong_binding'
    | 'rollback'
    | 'clock_rollback';
  kind: 'perpetual' | 'trial' | 'subscription' | null;
  expiresAt: string | null;
}
