import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { config as platformConfig } from '../apps/admin-api/src/config.js';
import { parseConfig } from '../apps/api/src/config.js';

const require = createRequire(
  new URL('../apps/api/package.json', import.meta.url),
);
const { parse } = require('dotenv') as {
  parse(input: string): Record<string, string>;
};
interface Check {
  code: string;
  ready: boolean;
  guidance: string;
}
// Local inspection only. No shell, network, database queries or file writes.
export async function checkSetup(
  root = new URL('../', import.meta.url),
  environment: NodeJS.ProcessEnv = process.env,
  nodeVersion = process.versions.node,
  scope: 'all' | 'billing' = 'all',
): Promise<Check[]> {
  const manifest = JSON.parse(
    await readFile(new URL('package.json', root), 'utf8'),
  ) as {
    packageManager: string;
  };
  const requiredNode = (await readFile(new URL('.nvmrc', root), 'utf8')).trim();
  const required = requiredNode.split('.').map(Number);
  const actual = nodeVersion.split('.').map(Number);
  const compatible =
    actual[0] === required[0] &&
    (actual[1]! > required[1]! ||
      (actual[1] === required[1] && actual[2]! >= required[2]!));
  const pnpmVersion =
    environment.npm_config_user_agent?.match(/^pnpm\/([^ ]+)/)?.[1];
  const checks: Check[] = [
    {
      code: 'NODE_VERSION',
      ready: compatible,
      guidance: `Use Node ${requiredNode} or a later patch/minor in the same major. In PowerShell run & ./scripts/Use-ProjectToolchain.ps1.`,
    },
    {
      code: 'PNPM_VERSION',
      ready: `pnpm@${pnpmVersion}` === manifest.packageManager,
      guidance: `Run this check through ${manifest.packageManager} after selecting the project toolchain.`,
    },
  ];
  for (const [file, label, validate] of [
    ['.env', 'BILLING', parseConfig],
    ['.env.admin', 'ADMIN', platformConfig],
  ] as const) {
    if (scope === 'billing' && label === 'ADMIN') continue;
    const selected =
      label === 'BILLING'
        ? environment.ENV_FILE
        : environment.PLATFORM_ENV_FILE;
    const displayFile = selected
      ? `the selected ${label.toLowerCase()} environment file`
      : file;
    let values: NodeJS.ProcessEnv;
    try {
      values = {
        ...parse(await readFile(selected ?? new URL(file, root), 'utf8')),
        ...environment,
      };
    } catch {
      checks.push({
        code: label + '_ENV_UNAVAILABLE',
        ready: false,
        guidance: `Prepare ${displayFile} using the local setup runbook. Existing files must be preserved.`,
      });
      continue;
    }
    try {
      validate(values);
      checks.push({
        code: label + '_CONFIG_VALID',
        ready: true,
        guidance: `Configuration syntax is valid. This does not verify credentials, database permissions, TLS files or deployment health.`,
      });
    } catch (error) {
      const fields =
        error instanceof Error
          ? error.message.match(
              /^Invalid (?:platform )?configuration fields: ([A-Z0-9_, .]+)$/,
            )?.[1]
          : undefined;
      checks.push({
        code: label + '_CONFIG_INVALID',
        ready: false,
        guidance: `${fields ? `Check fields: ${fields}. ` : ''}Review ${displayFile}: required values, placeholders, PostgreSQL URLs, encryption key, exact origins and HTTPS requirements. See docs/setup-operations.md. Private values are not printed.`,
      });
    }
    if (
      label === 'BILLING' &&
      (values.DEPLOYMENT_EDITION === undefined ||
        values.DEPLOYMENT_EDITION === 'offline')
    )
      checks.push({
        code: 'BILLING_OFFLINE_EDITION',
        ready: true,
        guidance:
          'Billing uses the offline edition by default. Online owner setup requires a separate SaaS deployment with DEPLOYMENT_EDITION=saas. Do not change an existing offline installation merely to dismiss this note.',
      });
  }
  return checks;
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    const args = process.argv.slice(2);
    if (
      args.length &&
      (args.length !== 2 || args[0] !== '--profile' || !args[1])
    )
      throw new Error('Invalid setup check arguments');
    let environment = process.env;
    let scope: 'all' | 'billing' = 'all';
    if (args[1]) {
      const directory = resolve(args[1]);
      const { loadProfile } = await import('./setup/workflow.js');
      const { runtimeEnvironment } = await import('./setup/runner.js');
      const profile = await loadProfile(directory);
      scope = profile.edition === 'offline' ? 'billing' : 'all';
      environment = runtimeEnvironment({
        ENV_FILE: join(directory, 'billing.env'),
        PLATFORM_ENV_FILE: join(directory, 'admin.env'),
      });
    }
    const checks = await checkSetup(undefined, environment, undefined, scope);
    for (const check of checks)
      console.log(
        `${check.ready ? 'PASS' : 'ACTION NEEDED'} [${check.code}] ${check.guidance}`,
      );
    if (checks.some((check) => !check.ready)) process.exitCode = 1;
  } catch {
    console.error(
      'SETUP_CHECK_UNAVAILABLE: run from an intact source checkout after selecting the project toolchain and installing locked dependencies. No files were changed.',
    );
    process.exitCode = 1;
  }
}
