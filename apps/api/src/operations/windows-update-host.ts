import { join } from 'node:path';
import { createDatabaseUpdateHost } from './database-update-host.js';
import { createWindowsUpdateService } from './windows-update-service.js';
import type { UpdateHost } from './assisted-update.js';

type DatabaseOptions = Parameters<typeof createDatabaseUpdateHost>[0];
type ScriptTrust = Parameters<typeof createWindowsUpdateService>[1];

// Host-operator library entrypoint. Initial installation and native acceptance
// remain separate; this never adopts a PoC/unknown service or downloads binaries.
export function createWindowsUpdateHost(
  options: Omit<DatabaseOptions, 'service'> & {
    service: {
      serviceRoot: string;
      nodePath: string;
      nodeSha256: string;
      wrapperSha256: string;
      environmentFile: string;
      environmentSha256: string;
      origin: string;
      port: number;
      backupTaskName: string | null;
      scripts: ScriptTrust;
    };
  },
): UpdateHost {
  const { scripts, ...configuration } = options.service;
  const service = createWindowsUpdateService(
    {
      ...configuration,
      operationId: options.operationId,
      installedRoot: options.installedRoot,
      stagedRoot: options.stagedRoot,
      journalDirectory: join(
        options.journalParent,
        'gst-update-' + options.operationId,
      ),
    },
    scripts,
    {
      runtimeConnectionString: options.runtimeConnectionString,
      installationId: options.installationId,
    },
  );
  return createDatabaseUpdateHost({ ...options, service });
}
