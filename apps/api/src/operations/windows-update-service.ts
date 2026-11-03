import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import { z } from 'zod';
import { parse } from 'dotenv';
import type { UpdateService } from './database-update-host.js';
import type { UpdateRecoveryService } from './update-recovery.js';

const path = z
  .string()
  .max(240)
  .regex(/^[a-zA-Z]:\\[^"%\r\n]+$/)
  .refine(
    (value) => win32.normalize(value) === value,
    'Canonical local path required.',
  );
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const serviceSchema = z
  .object({
    operationId: z.string().uuid(),
    serviceRoot: path,
    nodePath: path,
    nodeSha256: hash,
    wrapperSha256: hash,
    installedRoot: path,
    stagedRoot: path,
    environmentFile: path,
    environmentSha256: hash,
    journalDirectory: path,
    origin: z
      .string()
      .url()
      .refine((v) => {
        const u = new URL(v);
        return (
          u.protocol === 'https:' &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          u.pathname === '/' &&
          u.origin === v
        );
      }),
    port: z.number().int().min(1024).max(65535),
    backupTaskName: z
      .string()
      .regex(/^GSTBilling-Backup-[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)
      .nullable(),
  })
  .strict();
export const windowsUpdateServiceSchema = serviceSchema.superRefine(
  (value, context) => {
    const within = (a: string, b: string) => {
      const difference = win32.relative(a, b);
      return (
        difference === '' ||
        (!difference.startsWith('..\\') &&
          difference !== '..' &&
          !win32.isAbsolute(difference))
      );
    };
    if (
      within(value.installedRoot, value.stagedRoot) ||
      within(value.stagedRoot, value.installedRoot) ||
      within(value.installedRoot, value.journalDirectory) ||
      within(value.stagedRoot, value.journalDirectory)
    )
      context.addIssue({
        code: 'custom',
        message:
          'Installed/staged releases must be separate and journals outside both.',
      });
  },
);

export const windowsCertificateServiceSchema = serviceSchema
  .extend({
    certificateKeyPath: path,
    certificateCertPath: path,
  })
  .refine((value) => {
    const relative = win32.relative(
      value.installedRoot,
      value.journalDirectory,
    );
    return (
      value.installedRoot === value.stagedRoot &&
      (relative === '..' ||
        relative.startsWith('..\\') ||
        win32.isAbsolute(relative))
    );
  }, 'Certificate maintenance keeps the same application; journals must be outside it.');

// Script digests must come from the separately protected trusted operator release,
// never from the candidate package or user-entered tenant configuration.
function nativeService(
  config: z.infer<typeof serviceSchema> & {
    certificateKeyPath?: string;
    certificateCertPath?: string;
  },
  scripts: {
    directory: string;
    hashes: {
      'Invoke-UpdateService.ps1': string;
      'UpdateService.ps1': string;
      'Common.ps1': string;
      'DeploymentChecks.ps1': string;
    };
  },
  expected: { runtimeConnectionString: string; installationId: string },
) {
  if (new URL(config.origin).port !== String(config.port))
    throw new Error('Explicit matching HTTPS port required.');
  const execute = async (action: string) => {
    if (process.platform !== 'win32')
      throw new Error('Windows operator host required.');
    const contents: Record<string, string> = {};
    for (const name of [
      'Invoke-UpdateService.ps1',
      'UpdateService.ps1',
      'Common.ps1',
      'DeploymentChecks.ps1',
    ] as const) {
      const digest = scripts.hashes[name];
      hash.parse(digest);
      const file = join(scripts.directory, name);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 131072)
        throw new Error('Trusted update scripts changed.');
      const bytes = await readFile(file);
      if (createHash('sha256').update(bytes).digest('hex') !== digest)
        throw new Error('Trusted update scripts changed.');
      contents[name] = bytes.toString('utf8');
    }
    const environmentInfo = await lstat(config.environmentFile);
    if (
      !environmentInfo.isFile() ||
      environmentInfo.isSymbolicLink() ||
      environmentInfo.size > 32768
    )
      throw new Error('Invalid runtime environment.');
    const environmentBytes = await readFile(config.environmentFile);
    if (
      createHash('sha256').update(environmentBytes).digest('hex') !==
      config.environmentSha256
    )
      throw new Error('Runtime environment changed.');
    const environment = parse(environmentBytes);
    if (
      environment.NODE_ENV !== 'production' ||
      environment.DEPLOYMENT_EDITION !== 'offline' ||
      environment.DATABASE_URL !== expected.runtimeConnectionString ||
      environment.OFFLINE_INSTALLATION_ID !== expected.installationId ||
      environment.MIGRATION_DATABASE_URL !== undefined ||
      (config.certificateKeyPath !== undefined &&
        (environment.TLS_KEY_PATH !== config.certificateKeyPath ||
          environment.TLS_CERT_PATH !== config.certificateCertPath ||
          environment.APP_ORIGIN !== config.origin ||
          (environment.WEB_ROOT !== undefined &&
            environment.WEB_ROOT !==
              win32.join(config.installedRoot, 'apps', 'web', 'dist'))))
    )
      throw new Error('Runtime binding mismatch.');
    const system = process.env.SystemRoot ?? 'C:\\Windows';
    // Execute the exact hashed bytes over stdin, not paths that could change
    // between verification and execution. The small bootstrap avoids Windows'
    // command-line length limit; no configuration or credentials enter arguments.
    const script = [
      contents['Common.ps1'],
      contents['DeploymentChecks.ps1'],
      contents['UpdateService.ps1']!.replace(
        /^\. "\$PSScriptRoot\/(?:Common|DeploymentChecks)\.ps1"\r?\n/gm,
        '',
      ),
      '& {\n' +
        contents['Invoke-UpdateService.ps1']!.replace(
          /^ {4}\. "\$PSScriptRoot\/UpdateService\.ps1"\r?\n/gm,
          '',
        ) +
        '\n} -Action $env:GST_UPDATE_ACTION\n',
    ].join('\n');
    const bootstrap = Buffer.from(
      "$ErrorActionPreference='Stop'; & ([scriptblock]::Create([Console]::In.ReadToEnd()))",
      'utf16le',
    ).toString('base64');
    const result = await new Promise<{ stdout: string }>((resolve, reject) => {
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
          env: {
            SystemRoot: system,
            WINDIR: system,
            GST_UPDATE_SERVICE: JSON.stringify(config),
            GST_UPDATE_ACTION: action,
          },
          windowsHide: true,
          timeout: 120000,
          maxBuffer: 16384,
        },
        (error, stdout) =>
          error
            ? reject(new Error('Native update action failed.'))
            : resolve({ stdout }),
      );
      child.stdin?.on('error', () => {});
      child.stdin?.end(script);
    });
    if (JSON.stringify(JSON.parse(result.stdout.trim())) !== '{"ok":true}')
      throw new Error('Unexpected native update result.');
  };
  return {
    stop: () => execute('Stop'),
    selectRelease: () => execute('Select'),
    startPrivate: () => execute('Start'),
    assertReady: () => execute('Ready'),
    admit: () => execute('Admit'),
    restoreOriginal: () => execute('Restore'),
    startOriginal: () => execute('StartOriginal'),
    assertOriginalReady: () => execute('ReadyOriginal'),
    admitOriginal: () => execute('AdmitOriginal'),
    auditCertificates: () => execute('TlsInspect'),
  };
}

type Scripts = Parameters<typeof nativeService>[1];
type Binding = Parameters<typeof nativeService>[2];
export function createWindowsUpdateService(
  configuration: unknown,
  scripts: Scripts,
  expected: Binding,
): UpdateService & UpdateRecoveryService {
  return nativeService(
    windowsUpdateServiceSchema.parse(configuration),
    scripts,
    expected,
  );
}
export function createWindowsCertificateService(
  configuration: unknown,
  scripts: Scripts,
  expected: Binding,
) {
  const service = nativeService(
    windowsCertificateServiceSchema.parse(configuration),
    scripts,
    expected,
  );
  return {
    audit: service.auditCertificates,
    stop: service.stop,
    startPrivate: service.startOriginal,
    assertReady: service.assertOriginalReady,
    admit: service.admitOriginal,
  };
}
