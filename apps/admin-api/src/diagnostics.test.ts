import { expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
import { platformDiagnostics } from '@gst/contracts/platform';
import { diagnosePlatform } from './diagnostics.js';
import { config } from './config.js';

const settings = config({
  PLATFORM_DATABASE_URL: 'postgresql://example/platform',
  PLATFORM_AUTH_KEY: 'ab'.repeat(32),
  SAAS_APP_ORIGIN: 'http://127.0.0.1:5173',
  SAAS_EXPECTED_DATABASE_NAME: 'expected_saas',
});
const platform = () => ({
  query: vi.fn().mockResolvedValue({ rows: [{ operations_enabled: true }] }),
});
const good = {
  target_matches: true,
  routines_present: true,
  permitted: true,
  restricted: true,
};
async function probe(
  row: Partial<Omit<typeof good, 'target_matches'>> & {
    target_matches?: boolean | null;
  } = {},
) {
  const query = vi.fn().mockResolvedValue({ rows: [{ ...good, ...row }] });
  const result = await diagnosePlatform(
    platform(),
    {
      config: settings,
      operator: { query } as unknown as Pool,
    },
    true,
  );
  expect(platformDiagnostics.safeParse(result).success).toBe(true);
  expect(query).toHaveBeenCalledOnce();
  expect(query.mock.calls[0]![0]).not.toMatch(
    /SELECT\s+platform_operator\.execute/i,
  );
  expect(query.mock.calls[0]![1]).toEqual(['expected_saas']);
  return result.checks.map((c) => c.code);
}
test('checks prerequisites without executing business operations', async () => {
  expect(await probe()).toContain('SAAS_OPERATOR_READY');
});
test.each([
  [{ routines_present: false }, 'SAAS_MIGRATIONS_REQUIRED'],
  [{ permitted: false }, 'SAAS_PERMISSIONS_REQUIRED'],
  [{ restricted: false }, 'SAAS_ROLE_UNSAFE'],
  [{ target_matches: false }, 'SAAS_TARGET_MISMATCH'],
  [{ target_matches: null }, 'SAAS_TARGET_UNCONFIRMED'],
] as const)(
  'distinguishes unsafe and incomplete configuration: %s',
  async (row, code) => {
    expect(await probe(row)).toContain(code);
  },
);
test('reports missing configuration and disabled worker without an operator connection', async () => {
  const db = platform();
  db.query.mockResolvedValue({ rows: [{ operations_enabled: false }] });
  const result = await diagnosePlatform(
    db,
    {
      operator: undefined,
      config: { ...settings, SAAS_APP_ORIGIN: undefined },
    },
    false,
  );
  expect(result.checks.map((c) => c.code)).toEqual([
    'WORKER_DISABLED',
    'SAAS_NOT_CONFIGURED',
    'SAAS_ORIGIN_MISSING',
    'TRUST_MISSING',
  ]);
});
test('sanitizes database failures and preserves independent results', async () => {
  const db = platform();
  db.query.mockRejectedValue(new Error('postgresql://user:secret@private/db'));
  const result = await diagnosePlatform(
    db,
    {
      operator: {
        query: vi.fn().mockRejectedValue(new Error('password secret')),
      } as unknown as Pool,
      config: settings,
    },
    true,
  );
  expect(result.checks.map((c) => c.code)).toContain('SAAS_PROBE_FAILED');
  expect(result.checks.map((c) => c.code)).toContain(
    'PLATFORM_CONTROL_UNAVAILABLE',
  );
  expect(JSON.stringify(result)).not.toMatch(/secret|private|postgresql/);
  expect(result.checks.at(-1)?.code).toBe('TRUST_CONFIGURED');
});

test('a missing control record is unavailable rather than a deliberate worker pause', async () => {
  const db = platform();
  db.query.mockResolvedValue({ rows: [] });
  const result = await diagnosePlatform(
    db,
    { operator: undefined, config: settings },
    true,
  );
  expect(result.checks[0]).toEqual({
    code: 'PLATFORM_CONTROL_UNAVAILABLE',
    state: 'blocked',
  });
});
