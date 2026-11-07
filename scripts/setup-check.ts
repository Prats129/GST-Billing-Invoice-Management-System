import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
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
    let values: NodeJS.ProcessEnv;
    try {
      values = {
        ...parse(await readFile(new URL(file, root), 'utf8')),
        ...environment,
      };
    } catch {
      checks.push({
        code: label + '_ENV_UNAVAILABLE',
        ready: false,
        guidance: `Prepare ${file} using the local setup runbook. Existing files must be preserved.`,
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
        guidance: `${fields ? `Check fields: ${fields}. ` : ''}Review ${file}: required values, placeholders, PostgreSQL URLs, encryption key, exact origins and HTTPS requirements. See docs/setup-operations.md. Private values are not printed.`,
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
    const checks = await checkSetup();
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
