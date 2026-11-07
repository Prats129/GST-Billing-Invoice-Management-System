import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PLATFORM_DATABASE_URL: z.string().url(),
  PLATFORM_AUTH_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  PLATFORM_ORIGIN: z.string().url().default('http://127.0.0.1:5174'),
  PLATFORM_HOST: z.enum(['127.0.0.1', '::1', '0.0.0.0']).default('127.0.0.1'),
  PLATFORM_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  PLATFORM_TLS_KEY: z.string().optional(),
  PLATFORM_TLS_CERT: z.string().optional(),
  PLATFORM_WEB_ROOT: z.string().optional(),
  PLATFORM_TRUST_FILE: z.string().optional(),
  SAAS_OPERATOR_DATABASE_URL: z.string().url().optional(),
  SAAS_APP_ORIGIN: z.string().url().optional(),
  SAAS_EXPECTED_DATABASE_NAME: z.string().min(1).max(63).optional(),
});
export type PlatformConfig = z.infer<typeof schema>;
export function config(env: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid platform configuration fields: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  const c = parsed.data;
  for (const value of [c.PLATFORM_ORIGIN, c.SAAS_APP_ORIGIN].filter(
    (v): v is string => Boolean(v),
  )) {
    const u = new URL(value);
    if (u.origin !== value || !['http:', 'https:'].includes(u.protocol))
      throw new Error('Exact platform origin required');
  }
  if (Boolean(c.PLATFORM_TLS_KEY) !== Boolean(c.PLATFORM_TLS_CERT))
    throw new Error('Both platform TLS files required');
  if (
    (c.NODE_ENV === 'production' || c.PLATFORM_HOST === '0.0.0.0') &&
    (!c.PLATFORM_TLS_KEY || !c.PLATFORM_ORIGIN.startsWith('https://'))
  )
    throw new Error('Platform HTTPS required');
  if (c.SAAS_OPERATOR_DATABASE_URL === c.PLATFORM_DATABASE_URL)
    throw new Error('Separate operator database required');
  return c;
}
