import { z } from 'zod';

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
