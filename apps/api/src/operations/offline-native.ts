import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import { readCertificateOperationFile } from './certificate-replacement.js';
import { certificateHash } from './certificate-probe.js';
import { assertPrivateDirectory } from './release-staging.js';
import type { OfflineMaintenanceHost } from './offline-maintenance.js';
import type { OfflinePlan, OfflineRepair } from './offline-repair.js';

export async function createOfflineNativeHost(
  plan: OfflinePlan,
  protectedFiles: Record<string, string>,
  repair?: OfflineRepair,
): Promise<OfflineMaintenanceHost> {
  const directory = fileURLToPath(
    new URL('../../../windows-installer/scripts/', import.meta.url),
  );
  await assertPrivateDirectory(directory);
  const contents: string[] = [];
  for (const name of [
    'Common.ps1',
    'DeploymentChecks.ps1',
    'OfflineInstaller.ps1',
    'OfflineRepair.ps1',
  ])
    contents.push(
      (
        await readCertificateOperationFile(join(directory, name), 131072)
      ).toString('utf8'),
    );
  const helpers = [];
  for (const name of [
    'Start-OfflinePostgres.ps1',
    'Common.ps1',
    'BackupInstallation.ps1',
    'Invoke-BackupJob.ps1',
  ]) {
    const source = join(directory, name),
      bytes = await readCertificateOperationFile(source, 131072);
    helpers.push({
      source,
      destination: join(plan.config.root, 'payload', 'installer', name),
      sha256: certificateHash(bytes),
    });
  }
  const verifier = fileURLToPath(
    new URL(
      '../../../../packages/database/dist/verify-retained-cli.js',
      import.meta.url,
    ),
  );
  await assertPrivateDirectory(
    fileURLToPath(
      new URL('../../../../packages/database/dist/', import.meta.url),
    ),
  );
  const verifierHash = certificateHash(
    await readCertificateOperationFile(verifier, 131072),
  );
  const readyVerifier = fileURLToPath(
    new URL(
      '../../dist/operations/offline-repair-ready-cli.js',
      import.meta.url,
    ),
  );
  const readyVerifierSha256 = certificateHash(
    await readCertificateOperationFile(readyVerifier, 131072),
  );
  const appVerifier = fileURLToPath(
    new URL(
      '../../dist/operations/offline-repair-tree-cli.js',
      import.meta.url,
    ),
  );
  const appVerifierSha256 = certificateHash(
    await readCertificateOperationFile(appVerifier, 131072),
  );
  const nodeHash = createHash('sha256');
  for await (const chunk of createReadStream(process.execPath))
    nodeHash.update(chunk);
  const tools = {
    helpers,
    node: process.execPath,
    nodeSha256: nodeHash.digest('hex'),
    verifier,
    verifierSha256: verifierHash,
    readyVerifier,
    readyVerifierSha256,
    appVerifier,
    appVerifierSha256,
  };
  const execute = async (request: object) => {
    if (process.platform !== 'win32')
      throw new Error('Windows operator required.');
    const script =
      contents.join('\n') +
      "\ntry { $request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" +
      Buffer.from(
        JSON.stringify({ ...request, plan, protectedFiles, repair, tools }),
      ).toString('base64') +
      "'))|ConvertFrom-Json; $value=Invoke-OfflineMaintenance $request; [Console]::Out.WriteLine(($value|ConvertTo-Json -Compress)) } catch {[Console]::Error.WriteLine('Offline maintenance failed; retain protected evidence.');exit 1}";
    return launch(script);
  };
  return {
    async inspect(operationId) {
      return z
        .object({
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          actorAlive: z.boolean(),
        })
        .strict()
        .parse(JSON.parse(await execute({ action: 'Inspect', operationId })));
    },
    async run(request) {
      if (
        JSON.stringify(
          JSON.parse(await execute({ action: 'Run', ...request })),
        ) !== '{"ok":true}'
      )
        throw new Error('Invalid maintenance result.');
    },
  };
}

async function launch(script: string) {
  const system = process.env.SystemRoot ?? 'C:\\Windows';
  const bootstrap = Buffer.from(
    "$ErrorActionPreference='Stop'; & ([scriptblock]::Create([Console]::In.ReadToEnd()))",
    'utf16le',
  ).toString('base64');
  return new Promise<string>((resolve, reject) => {
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
        },
      },
      (error, stdout) =>
        error
          ? reject(new Error('Native offline maintenance failed.'))
          : resolve(stdout),
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(script);
  });
}

export async function installOffline(plan: OfflinePlan) {
  const scripts: string[] = [];
  for (const name of [
    'Common.ps1',
    'DeploymentChecks.ps1',
    'OfflineInstaller.ps1',
  ]) {
    const bytes = await readCertificateOperationFile(
      join(plan.config.bundleRoot, 'installer', name),
      131072,
    );
    if (
      plan.files.find((file) => file.path === 'installer/' + name)?.sha256 !==
      certificateHash(bytes)
    )
      throw new Error('Signed installer helper changed.');
    scripts.push(bytes.toString('utf8'));
  }
  scripts.push(
    "try { $plan=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" +
      Buffer.from(JSON.stringify(plan)).toString('base64') +
      "'))|ConvertFrom-Json; Invoke-OfflineInstallation $plan; [Console]::Out.WriteLine('{\"ok\":true}') } catch {[Console]::Error.WriteLine('Initial installation failed; retain evidence.');exit 1}",
  );
  if (
    JSON.stringify(JSON.parse(await launch(scripts.join('\n')))) !==
    '{"ok":true}'
  )
    throw new Error('Invalid initial installer result.');
}
