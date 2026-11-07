import { expect, test } from 'vitest';
import {
  newProfile,
  resources,
  profileEnvironments,
} from '../../../scripts/setup/workflow.js';
import { runtimeEnvironment } from '../../../scripts/setup/runner.js';

const input = {
  edition: 'saas' as const,
  slug: 'example',
  host: '127.0.0.1' as const,
  port: 5432,
  cluster: '123',
  email: 'Owner@Example.test',
  name: 'Owner',
  organizationName: 'Example',
};
test('new profiles isolate runtime, migration and operator credentials and preserve explicit edition', () => {
  const profile = newProfile(input),
    env = profileEnvironments(profile);
  expect(profile.email).toBe('owner@example.test');
  expect(new Set(Object.values(profile.credentials)).size).toBe(5);
  expect(env.billingEnv.DEPLOYMENT_EDITION).toBe('saas');
  expect(env.billingEnv).not.toHaveProperty('MIGRATION_DATABASE_URL');
  expect(env.platformEnv).not.toHaveProperty('PLATFORM_MIGRATION_DATABASE_URL');
  expect(new URL(env.platformEnv.SAAS_OPERATOR_DATABASE_URL!).username).toBe(
    'example_operator',
  );
  expect(new URL(env.operatorEnv.SAAS_MIGRATION_DATABASE_URL!).username).toBe(
    'example_billing_migrator',
  );
  expect(Object.values(env.billingEnv)).not.toContain(profile.recovery);
  expect(Object.values(env.platformEnv)).not.toContain(profile.recovery);
});
test('offline profiles use independent installation IDs and do not create platform roles', () => {
  const p = newProfile({ ...input, edition: 'offline' }),
    env = profileEnvironments(p);
  expect(resources(p).databases).toEqual(['example_billing']);
  expect(resources(p).roles).toHaveLength(2);
  expect(env.platformEnv).toEqual({});
  expect(env.billingEnv.OFFLINE_INSTALLATION_ID).toBe(p.installationId);
  expect(newProfile({ ...input, edition: 'offline' }).installationId).not.toBe(
    p.installationId,
  );
});
test.each([
  '../other',
  'Bad-Name',
  'x";drop database postgres;',
  'a'.repeat(21),
])('unsafe resource name is rejected before SQL: %s', (slug) => {
  expect(() => newProfile({ ...input, slug })).toThrow();
});
test('runtime launches strip inherited operator credentials and unrelated deployment configuration', () => {
  const env = runtimeEnvironment(
    { DATABASE_URL: 'selected', ENV_FILE: 'private/billing.env' },
    {
      PATH: 'system-tools',
      PGPASSWORD: 'secret',
      PLATFORM_AUTH_KEY: 'secret',
      SAAS_MIGRATION_DATABASE_URL: 'secret',
      MIGRATION_DATABASE_URL: 'secret',
      DATABASE_URL: 'wrong',
      POSTGRES_PASSWORD: 'secret',
      AUTH_DATA_KEY: 'old',
      DEPLOYMENT_EDITION: 'wrong',
    },
  );
  expect(env).toEqual({
    PATH: 'system-tools',
    DATABASE_URL: 'selected',
    ENV_FILE: 'private/billing.env',
  });
});
