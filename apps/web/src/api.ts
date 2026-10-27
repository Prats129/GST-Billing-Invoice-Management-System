import { healthResponseSchema, readinessResponseSchema } from '@gst/contracts';

export async function fetchHealth(signal: AbortSignal) {
  const response = await fetch('/api/v1/health', {
    signal,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('API unavailable');
  return healthResponseSchema.parse(await response.json());
}
export async function fetchReadiness(signal: AbortSignal) {
  const response = await fetch('/api/v1/health/ready', {
    signal,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok)
    throw new Error('Database unavailable or migration pending');
  return readinessResponseSchema.parse(await response.json());
}
