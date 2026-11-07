import { expect, test } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkSetup } from '../../../scripts/setup-check.js';

test('setup inspection distinguishes missing files, wrong tools and edition without writing secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gst-setup-check-'));
  const url = pathToFileURL(root + '/');
  try {
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@10.34.9' }),
    );
    await writeFile(join(root, '.nvmrc'), '24.22.1');
    const missing = await checkSetup(
      url,
      { npm_config_user_agent: 'pnpm/9.15.4' },
      '22.13.0',
    );
    expect(missing.filter((c) => !c.ready).map((c) => c.code)).toEqual([
      'NODE_VERSION',
      'PNPM_VERSION',
      'BILLING_ENV_UNAVAILABLE',
      'ADMIN_ENV_UNAVAILABLE',
    ]);
    const secret = 'private-test-value';
    await writeFile(join(root, '.env'), 'DATABASE_URL=' + secret);
    await writeFile(join(root, '.env.admin'), 'PLATFORM_AUTH_KEY=' + secret);
    const invalid = await checkSetup(
      url,
      { npm_config_user_agent: 'pnpm/10.34.9' },
      '24.22.1',
    );
    expect(invalid.filter((c) => !c.ready).map((c) => c.code)).toEqual([
      'BILLING_CONFIG_INVALID',
      'ADMIN_CONFIG_INVALID',
    ]);
    expect(JSON.stringify(invalid)).not.toContain(secret);
    const wrongEdition = await checkSetup(
      url,
      { DEPLOYMENT_EDITION: 'invalid' },
      '24.22.1',
    );
    expect(wrongEdition.map((c) => c.code)).not.toContain(
      'BILLING_OFFLINE_EDITION',
    );
    expect(
      invalid.find((c) => c.code === 'BILLING_CONFIG_INVALID')?.guidance,
    ).toContain('DATABASE_URL');
    expect(
      invalid.find((c) => c.code === 'ADMIN_CONFIG_INVALID')?.guidance,
    ).toContain('PLATFORM_AUTH_KEY');
    expect(await readFile(join(root, '.env'), 'utf8')).toBe(
      'DATABASE_URL=' + secret,
    );
    await writeFile(
      join(root, '.env'),
      'DATABASE_URL=postgresql://test/local\nDEPLOYMENT_EDITION=saas\nAUTH_DATA_KEY=' +
        'ab'.repeat(32),
    );
    await writeFile(
      join(root, '.env.admin'),
      'PLATFORM_DATABASE_URL=postgresql://test/platform\nPLATFORM_AUTH_KEY=' +
        'cd'.repeat(32),
    );
    const valid = await checkSetup(
      url,
      { npm_config_user_agent: 'pnpm/10.34.9' },
      '24.23.0',
    );
    expect(valid.every((c) => c.ready)).toBe(true);
    expect(valid.map((c) => c.code)).not.toContain('BILLING_OFFLINE_EDITION');
    const selected = await checkSetup(
      url,
      { npm_config_user_agent: 'pnpm/10.34.9', ENV_FILE: join(root, '.env') },
      '24.22.1',
      'billing',
    );
    expect(selected.every((c) => c.ready)).toBe(true);
    expect(selected.map((c) => c.code)).not.toContain('ADMIN_CONFIG_VALID');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
