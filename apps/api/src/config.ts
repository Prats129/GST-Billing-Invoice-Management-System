import { isIP } from 'node:net';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => /^postgres(ql)?:/.test(v)),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  ALLOWED_HOSTS: z
    .string()
    .default('localhost:3000,127.0.0.1:3000,localhost:5173,127.0.0.1:5173'),
  TLS_KEY_PATH: z.string().min(1).optional(),
  TLS_CERT_PATH: z.string().min(1).optional(),
  WEB_ROOT: z.string().min(1).optional(),
  DEPLOYMENT_EDITION: z.enum(['offline', 'saas']).default('offline'),
});
export type Config = z.infer<typeof schema>;

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid configuration fields: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  const config = result.data;
  if (!isIP(config.HOST) && config.HOST !== 'localhost')
    throw new Error('HOST must be an explicit IP address or localhost');
  if (Boolean(config.TLS_KEY_PATH) !== Boolean(config.TLS_CERT_PATH))
    throw new Error('Both TLS paths are required');
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(config.HOST);
  if ((!loopback || config.NODE_ENV === 'production') && !config.TLS_KEY_PATH)
    throw new Error('TLS is required outside loopback development');
  const origin = new URL(config.APP_ORIGIN);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.origin !== config.APP_ORIGIN ||
    origin.username ||
    origin.password
  )
    throw new Error('APP_ORIGIN must be an exact origin');
  if (config.TLS_KEY_PATH && origin.protocol !== 'https:')
    throw new Error('TLS requires an HTTPS APP_ORIGIN');
  const hosts = config.ALLOWED_HOSTS.split(',').map((v) => v.trim());
  if (
    hosts.some(
      (v) => !v || /[\s/*\\@]/.test(v) || new URL(`http://${v}`).host !== v,
    )
  )
    throw new Error('ALLOWED_HOSTS must contain exact host authorities');
  return config;
}
