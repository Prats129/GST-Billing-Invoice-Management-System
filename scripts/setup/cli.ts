import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { passwordSchema } from '../../packages/contracts/dist/index.js';
import { Client } from '../../apps/admin-api/src/store.js';
import {
  assertPrivateDirectory,
  secureDirectory,
} from '../../apps/api/src/operations/release-staging.js';
import {
  SetupError,
  newProfile,
  resources,
  createProfile,
  loadProfile,
  clusterIdentity,
  profileEnvironments,
} from './workflow.js';
import type { SetupProfile } from './workflow.js';

let muted = false;
const output = new Writable({
  write(chunk: Buffer, _encoding, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  },
});
const terminal = createInterface({
  input: process.stdin,
  output,
  terminal: true,
  historySize: 0,
});
const abort = new AbortController();
terminal.on('SIGINT', () => abort.abort());
async function ask(label: string, fallback = '', secret = false) {
  const answer = terminal.question(
    `${label}${fallback ? ` [${fallback}]` : ''}: `,
    { signal: abort.signal },
  );
  muted = secret;
  try {
    const value = await answer;
    if (secret) return value;
    if (
      Array.from(value).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new SetupError('INVALID_INPUT');
    return value.trim() || fallback;
  } finally {
    muted = false;
    if (secret) process.stdout.write('\n');
  }
}
let client: Client | undefined;
try {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new SetupError('INTERACTIVE_TERMINAL_REQUIRED');
  const { hashPassword, verifyPassword } =
    await import('../../packages/security/dist/index.js').catch(() => {
      throw new SetupError('NATIVE_CRYPTO_UNAVAILABLE');
    });
  const { runSetup, runtimeEnvironment, enableInitialOperations } =
    await import('./runner.js');
  if (
    !(await verifyPassword(
      await hashPassword('Temporary native module check'),
      'Temporary native module check',
    ))
  )
    throw new SetupError('NATIVE_CRYPTO_UNAVAILABLE');
  if (process.argv.slice(2).some((argument) => argument !== '--launch'))
    throw new SetupError('INVALID_ARGUMENTS');
  let selected: SetupProfile;
  let selectedDirectory: string;
  if (process.argv.includes('--launch')) {
    selectedDirectory = resolve(
      await ask('Protected profile folder to launch'),
    );
    selected = await loadProfile(selectedDirectory);
    if (
      (await readFile(join(selectedDirectory, 'complete.json'), 'utf8')) !==
      JSON.stringify({ id: selected.id, cluster: selected.cluster }) + '\n'
    )
      throw new SetupError('SETUP_INCOMPLETE');
    console.log(
      'Launch only: no administrator credentials, migrations or account changes. Normal runtime readiness checks still apply.',
    );
  } else {
    console.log(
      'Guided LOCAL development setup. No production hosting, signing or Windows services are configured.',
    );
    console.log(
      'Existing root .env files are preserved. New settings and recovery material stay in a protected profile directory.',
    );
    const resume = await ask(
      'Create a new profile or resume an existing one? (new/resume)',
      'new',
    );
    if (!['new', 'resume'].includes(resume))
      throw new SetupError('INVALID_SELECTION');
    const slug =
      resume === 'new'
        ? await ask(
            'New profile name (lowercase letters, digits and underscores; max 20)',
            'gst_local',
          )
        : '';
    const directory =
      resume === 'resume'
        ? resolve(await ask('Existing protected profile folder'))
        : join(
            process.platform === 'win32'
              ? (process.env.LOCALAPPDATA ?? homedir())
              : homedir(),
            '.gst-development',
            slug,
          );
    const saved =
      resume === 'resume' ? await loadProfile(directory) : undefined;
    const edition =
      saved?.edition ??
      (await ask(
        'Edition: offline or saas (saas includes Platform Admin)',
        'saas',
      ));
    if (edition !== 'offline' && edition !== 'saas')
      throw new SetupError('INVALID_EDITION');
    const host =
      saved?.host ?? (await ask('Local PostgreSQL host', '127.0.0.1'));
    const port = saved?.port ?? Number(await ask('PostgreSQL port', '5432'));
    if (
      !['127.0.0.1', 'localhost', '::1'].includes(host) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      throw new SetupError('LOCAL_POSTGRES_REQUIRED');
    const user = await ask('PostgreSQL administrator login', 'postgres');
    const administratorPassword = await ask(
      'PostgreSQL administrator password (hidden; not saved)',
      '',
      true,
    );
    client = new Client({
      host,
      port,
      user,
      password: administratorPassword,
      database: 'postgres',
      connectionTimeoutMillis: 3000,
      statement_timeout: 10000,
    });
    client.on('error', () => {});
    try {
      await client.connect();
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      throw new SetupError(
        code === '28P01'
          ? 'POSTGRES_LOGIN_REJECTED'
          : code === 'ECONNREFUSED'
            ? 'POSTGRES_NOT_RUNNING'
            : 'POSTGRES_CONNECTION_FAILED',
      );
    }
    const cluster = await clusterIdentity(client);
    const profile =
      saved ??
      newProfile({
        edition,
        slug,
        host: host as '127.0.0.1' | 'localhost' | '::1',
        port,
        cluster,
        email: await ask(
          edition === 'saas' ? 'Platform owner email' : 'Billing owner email',
        ),
        name: await ask('Owner name'),
        organizationName:
          edition === 'offline'
            ? await ask('Business name', 'My business')
            : 'Platform administration',
      });
    if (profile.cluster !== cluster)
      throw new SetupError('DATABASE_CLUSTER_MISMATCH');
    console.log(
      `Edition: ${profile.edition}. Databases: ${resources(profile).databases.join(', ')}.`,
    );
    console.log(`Roles: ${resources(profile).roles.join(', ')}.`);
    console.log(`Protected settings/recovery folder: ${directory}`);
    console.log(
      'This creates new resources or resumes only resources marked for this profile. It never adopts unrelated accounts or databases.',
    );
    if ((await ask(`Type ${profile.slug} to confirm`)) !== profile.slug)
      throw new SetupError('CANCELLED');
    const ownerPassword = await ask(
      'Initial owner password (15+ characters, hidden; existing owners are preserved)',
      '',
      true,
    );
    if (!ownerPassword && !saved)
      throw new SetupError('OWNER_PASSWORD_INVALID');
    // Empty is allowed on a completed/reconciled rerun; a new owner still requires validation.
    if (ownerPassword) {
      if (!passwordSchema.safeParse(ownerPassword).success)
        throw new SetupError('OWNER_PASSWORD_INVALID');
      if (
        ownerPassword !==
        (await ask('Repeat initial owner password (hidden)', '', true))
      )
        throw new SetupError('PASSWORDS_DIFFER');
    }
    if (!saved) {
      const parent = join(
        process.platform === 'win32'
          ? (process.env.LOCALAPPDATA ?? homedir())
          : homedir(),
        '.gst-development',
      );
      try {
        await mkdir(parent, { mode: 0o700 });
        await secureDirectory(parent);
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'EEXIST'
        )
          await assertPrivateDirectory(parent);
        else throw error;
      }
      await createProfile(directory, profile);
    }
    await runSetup(client, profile, directory, ownerPassword, console.log);
    if (
      profile.edition === 'saas' &&
      (await ask(
        'Enable online processing for this verified NEW empty installation? Existing/restored history requires full reconciliation (yes/no)',
        'no',
      )) === 'yes'
    ) {
      const result = await enableInitialOperations(client, profile, directory);
      console.log(
        result === 'enabled'
          ? 'Initial processing is enabled for the verified empty installation.'
          : 'Initial approval was already recorded. Current processing state was preserved; check Operations in Platform Admin.',
      );
    }
    await client.end();
    client = undefined;
    console.log(
      'Setup completed. Protect and back up this folder: profile.json contains the prepared host recovery proof, encryption keys and database credentials. Owner passwords are not saved.',
    );
    console.log(
      'Complete authenticator enrollment in Platform Admin. SaaS processing remains disabled unless explicitly verified and enabled above; signed licenses and billing setup remain separate.',
    );
    if (profile.edition === 'saas')
      console.log(
        'Create customer organizations and owner setup links in Platform Admin after signing in. This setup creates the platform owner, not a customer billing account.',
      );
    console.log(
      'To resume incomplete setup, run pnpm setup:guided. For daily startup, use pnpm setup:launch; it needs no database administrator password.',
    );
    selected = profile;
    selectedDirectory = directory;
  }
  const launch = await ask(
    selected.edition === 'saas'
      ? 'Start billing, admin or neither? (billing/admin/no)'
      : 'Start billing now? (billing/no)',
    'no',
  );
  if (
    !['billing', 'admin', 'no'].includes(launch) ||
    (selected.edition !== 'saas' && launch === 'admin')
  )
    throw new SetupError('INVALID_SELECTION');
  if (launch !== 'no') {
    const manager = process.env.npm_execpath;
    if (!manager) throw new SetupError('LAUNCH_THROUGH_PNPM');
    const env = profileEnvironments(selected);
    const values =
      launch === 'admin'
        ? {
            ...env.platformEnv,
            PLATFORM_ENV_FILE: join(selectedDirectory, 'admin.env'),
          }
        : {
            ...env.billingEnv,
            ENV_FILE: join(selectedDirectory, 'billing.env'),
          };
    terminal.close();
    const child = spawn(
      process.execPath,
      [manager, 'run', launch === 'admin' ? 'dev:admin' : 'dev'],
      { stdio: 'inherit', windowsHide: true, env: runtimeEnvironment(values) },
    );
    await new Promise<void>((yes, no) => {
      child.once('error', () => no(new SetupError('LAUNCH_FAILED')));
      child.once('exit', (code) => {
        process.exitCode = code ?? 1;
        yes();
      });
    });
  }
} catch (error) {
  const code =
    error instanceof SetupError
      ? error.code
      : error instanceof Error && error.name === 'AbortError'
        ? 'CANCELLED'
        : 'SETUP_STEP_FAILED';
  if (code === 'CANCELLED') {
    console.log(
      'Cancelled. Any completed steps and recovery material were preserved.',
    );
  } else {
    console.error(
      `${code}: Setup stopped. Existing resources and recovery evidence were preserved. ${
        (
          {
            POSTGRES_NOT_RUNNING:
              'Start the intended local PostgreSQL server (or Docker and its existing database container), then retry. Do not delete volumes.',
            POSTGRES_LOGIN_REJECTED:
              'Check the existing PostgreSQL administrator login and password; the owner password is a different account.',
            LOCAL_DATABASE_ADMIN_REQUIRED:
              'Use a local host database administrator for creating NEW roles/databases. It is never saved or used by the web apps.',
            OWNER_PASSWORD_INVALID:
              'Use an owner password of at least 15 characters within the configured password limit.',
            PASSWORDS_DIFFER:
              'The two owner passwords did not match. Repeat them; they are not saved to disk.',
            EXISTING_RESOURCE_CONFLICT:
              'A requested role/database already exists without matching setup evidence. Choose a different NEW profile name or have the host operator inspect it; never reset or adopt it by name.',
            DATABASE_IDENTITY_MISMATCH:
              'The database was removed, replaced or does not match saved evidence. Stop and use the recovery runbook; setup cannot repair or recreate it.',
            DATABASE_CLUSTER_MISMATCH:
              'The server does not match the saved PostgreSQL cluster. Check the host/port; do not continue against a replacement server.',
            FULL_RECONCILIATION_REQUIRED:
              'Existing organization/license/operation history requires the host reconciliation procedure in docs/platform-admin.md. Initial setup cannot authorize it.',
            SETUP_BUSY:
              'Another setup session owns this profile. Wait for that process to finish. No age-based lock removal is allowed.',
            INTERACTIVE_TERMINAL_REQUIRED:
              'Run pnpm setup:guided or setup:launch from an interactive terminal. Passwords must not be piped or passed in command arguments.',
            NATIVE_CRYPTO_UNAVAILABLE:
              'Select the pinned Node/pnpm toolchain, then reinstall locked dependencies using Setup-Project.ps1. No accounts were changed.',
          } as Record<string, string>
        )[code] ??
        'Check the last displayed step and docs/guided-setup.md, including PostgreSQL availability and protected folder permissions, before choosing resume.'
      } Never delete a database, profile, key or journal to clear an error. Private errors/credentials are not printed.`,
    );
    process.exitCode = 1;
  }
} finally {
  terminal.close();
  await client?.end();
}
