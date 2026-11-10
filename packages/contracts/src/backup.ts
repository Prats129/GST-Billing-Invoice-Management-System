import { z } from 'zod';
export const backupFailureSchema = z.enum([
  'TOOLS_FAILED',
  'ARCHIVE_REJECTED',
  'DATABASE_UNAVAILABLE',
  'STORAGE_FULL',
  'ACCESS_DENIED',
  'EXISTING_ARTIFACT',
  'VERIFICATION_FAILED',
]);
export const backupReportSchema = z
  .object({
    version: z.literal(1),
    checkedAt: z.string().datetime(),
    targets: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
            kind: z.enum(['billing', 'platform']),
            state: z.enum([
              'verified',
              'missing',
              'failed',
              'interrupted',
              'stale',
              'artifact_missing',
              'artifact_changed',
              'incompatible',
            ]),
            maximumAgeHours: z.number().int().min(1).max(8760),
            lastAttemptAt: z.string().datetime().nullable(),
            lastVerifiedAt: z.string().datetime().nullable(),
            lastErrorCode: backupFailureSchema.nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(2),
  })
  .strict();
export type BackupReport = z.infer<typeof backupReportSchema>;
export const backupStatusResponseSchema = z
  .object({
    state: z.enum(['not_configured', 'unavailable', 'reported']),
    report: backupReportSchema.nullable(),
  })
  .strict();
export type BackupStatusResponse = z.infer<typeof backupStatusResponseSchema>;
