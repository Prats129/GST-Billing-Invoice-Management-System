import { z } from 'zod';
import {
  entitlementClaimsSchema,
  signedEntitlementSchema,
} from './entitlements.js';

export const offlineRegistrationSchema = z
  .object({
    format: z.literal('gst-offline-registration'),
    version: z.literal(1),
    organizationId: z.string().uuid(),
    installationId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
  })
  .strict();
export const licenseHandoffSchema = z
  .object({
    format: z.literal('gst-license-request'),
    version: z.literal(1),
    requestId: z.string().uuid(),
    claims: entitlementClaimsSchema,
    predecessor: signedEntitlementSchema.nullable(),
  })
  .strict();
export const workspaceSetupSchema = z
  .object({
    checkedAt: z.string().datetime(),
    businessConfigured: z.boolean(),
    registrationConfirmed: z.boolean(),
    eInvoiceApplicability: z.enum(['unknown', 'required', 'not_required']),
    issuanceBlockers: z.array(z.string()).max(10),
    customersPresent: z.boolean().nullable(),
    catalogPresent: z.boolean().nullable(),
    entitlement: z
      .object({
        status: z.enum([
          'development',
          'missing',
          'invalid',
          'active',
          'expired',
          'not_started',
          'wrong_binding',
          'rollback',
          'clock_rollback',
        ]),
        businessWritesPaused: z.boolean(),
      })
      .strict(),
    offlineRegistration: offlineRegistrationSchema.nullable(),
  })
  .strict();
export type WorkspaceSetup = z.infer<typeof workspaceSetupSchema>;
