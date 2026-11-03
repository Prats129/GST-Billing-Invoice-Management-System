// Explicit elevated operator command. Never auto-elevates or loads a .env file.
import { parseArgs } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { acquireUpdateJournal } from './update-journal.js';
import { readCertificateOperationFile } from './certificate-replacement.js';
import { certificateHash } from './certificate-probe.js';
import { assertPrivateDirectory } from './release-staging.js';
import {
  offlineInstallSchema,
  prepareOfflineInstallation,
} from './offline-installer.js';

let lease: Awaited<ReturnType<typeof acquireUpdateJournal>> | undefined;
try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      configuration: { type: 'string' },
      root: { type: 'string' },
      'confirm-installation': { type: 'string' },
      maintenance: { type: 'boolean' },
    },
  });
  const action = positionals[0];
  if (
    process.platform !== 'win32' ||
    positionals.length !== 1 ||
    !['install', 'uninstall'].includes(action!)
  )
    throw new Error();
  let plan: Awaited<ReturnType<typeof prepareOfflineInstallation>>;
  let scripts: string;
  if (action === 'install') {
    if (!values.configuration || values.root || values.maintenance)
      throw new Error();
    await assertPrivateDirectory(dirname(resolve(values.configuration)));
    plan = await prepareOfflineInstallation(
      JSON.parse(
        (
          await readCertificateOperationFile(values.configuration, 32768)
        ).toString('utf8'),
      ),
    );
    scripts = join(plan.config.bundleRoot, 'installer');
  } else {
    if (!values.root || values.configuration || !values.maintenance)
      throw new Error();
    await assertPrivateDirectory(join(values.root, 'operator'));
    plan = JSON.parse(
      (
        await readCertificateOperationFile(
          join(values.root, 'operator', 'native-installation.json'),
          16 * 1024 * 1024,
        )
      ).toString('utf8'),
    );
    const config = offlineInstallSchema.parse(plan.config);
    if (config.root !== values.root) throw new Error();
    // Uninstall uses the separately trusted operator tools, never vendor data or
    // mutable PostgreSQL files as elevated executable instructions.
    scripts = fileURLToPath(
      new URL('../../../windows-installer/scripts/', import.meta.url),
    );
    await assertPrivateDirectory(scripts);
  }
  if (values['confirm-installation'] !== plan.config.installationId)
    throw new Error();
  const operationId = randomUUID();
  const contents: string[] = [];
  for (const name of [
    'Common.ps1',
    'DeploymentChecks.ps1',
    'OfflineInstaller.ps1',
  ]) {
    const bytes = await readCertificateOperationFile(
      join(scripts, name),
      131072,
    );
    if (
      action === 'install' &&
      plan.files.find((f) => f.path === 'installer/' + name)?.sha256 !==
        certificateHash(bytes)
    )
      throw new Error();
    contents.push(bytes.toString('utf8'));
  }
  if (action === 'uninstall') {
    const parent = join(plan.config.root, 'operations');
    await assertPrivateDirectory(parent);
    lease = await acquireUpdateJournal(
      parent,
      plan.config.installationId,
      operationId,
      'uninstall',
    );
    await lease.record({
      operationId,
      installationId: plan.config.installationId,
      version: plan.version,
      phase: 'stopping',
    });
  }
  contents.push(
    "$plan=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" +
      Buffer.from(JSON.stringify(plan)).toString('base64') +
      "'))|ConvertFrom-Json; try { if($env:GST_INSTALL_ACTION -eq 'install'){Invoke-OfflineInstallation $plan}else{Invoke-OfflineUninstall $plan $env:GST_INSTALL_CONFIRM $env:GST_INSTALL_OPERATION}; [Console]::Out.WriteLine('{\"ok\":true}') } catch { [Console]::Error.WriteLine('Offline lifecycle failed. Retain private evidence and all data.'); exit 1 }",
  );
  const system = process.env.SystemRoot ?? 'C:\\Windows';
  // Exact checked bytes over stdin; no secret-bearing command line, shell or
  // inherited NODE_OPTIONS, PostgreSQL variables or developer environment.
  const bootstrap = Buffer.from(
    "$ErrorActionPreference='Stop'; & ([scriptblock]::Create([Console]::In.ReadToEnd()))",
    'utf16le',
  ).toString('base64');
  const result = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        bootstrap,
      ],
      {
        windowsHide: true,
        timeout: 600000,
        maxBuffer: 16384,
        env: {
          SystemRoot: system,
          WINDIR: system,
          PATH: join(system, 'System32'),
          GST_INSTALL_ACTION: action,
          GST_INSTALL_CONFIRM: values['confirm-installation'],
          GST_INSTALL_OPERATION: operationId,
        },
      },
      (error, stdout) => (error ? reject(new Error()) : resolve(stdout)),
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(contents.join('\n'));
  });
  if (JSON.stringify(JSON.parse(result.trim())) !== '{"ok":true}')
    throw new Error();
  if (lease)
    await lease.record({
      operationId,
      installationId: plan.config.installationId,
      version: plan.version,
      phase: 'completed',
    });
  process.stdout.write(
    JSON.stringify({
      event:
        action === 'install'
          ? 'offline_installed'
          : 'offline_uninstalled_data_retained',
      installationId: plan.config.installationId,
    }) + '\n',
  );
} catch {
  process.stderr.write(
    '{"event":"offline_lifecycle_failed","message":"Check private configuration, exact installation confirmation, signed artifacts and retained operator evidence. Do not delete data or retry initial installation over an existing root."}\n',
  );
  process.exitCode = 1;
} finally {
  try {
    await lease?.release();
  } catch {
    process.stderr.write(
      '{"event":"offline_lifecycle_lock_requires_inspection"}\n',
    );
    process.exitCode = 1;
  }
}
