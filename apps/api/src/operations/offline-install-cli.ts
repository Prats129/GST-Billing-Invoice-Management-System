// Explicit elevated operator command. No automatic .env loading or elevation.
import { parseArgs } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { readCertificateOperationFile } from './certificate-replacement.js';
import { certificateHash } from './certificate-probe.js';
import { assertPrivateDirectory } from './release-staging.js';
import { prepareOfflineInstallation } from './offline-installer.js';
import { retainedBinding, prepareOfflineRepair } from './offline-repair.js';
import { createOfflineNativeHost, installOffline } from './offline-native.js';
import {
  runOfflineMaintenance,
  inspectOfflineMaintenance,
  recoverOfflineMaintenance,
  readOfflineMaintenanceContext,
} from './offline-maintenance.js';
try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      configuration: { type: 'string' },
      root: { type: 'string' },
      'confirm-installation': { type: 'string' },
      maintenance: { type: 'boolean' },
      'operation-id': { type: 'string' },
      'operator-stopped': { type: 'boolean' },
      'expected-inspection-sha256': { type: 'string' },
    },
  });
  const action = positionals[0];
  if (
    process.platform !== 'win32' ||
    positionals.length !== 1 ||
    !['install', 'uninstall', 'repair', 'inspect', 'recover'].includes(action!)
  )
    throw new Error();
  const readConfiguration = async (path: string) => {
    await assertPrivateDirectory(dirname(resolve(path)));
    return JSON.parse(
      (await readCertificateOperationFile(path, 32768)).toString('utf8'),
    ) as unknown;
  };
  if (action === 'install') {
    if (
      !values.configuration ||
      values.root ||
      values.maintenance ||
      values['operation-id'] ||
      values['operator-stopped'] ||
      values['expected-inspection-sha256']
    )
      throw new Error();
    const plan = await prepareOfflineInstallation(
      await readConfiguration(values.configuration),
    );
    if (values['confirm-installation'] !== plan.config.installationId)
      throw new Error();
    await installOffline(plan);
    process.stdout.write(
      JSON.stringify({
        event: 'offline_installed',
        installationId: plan.config.installationId,
      }) + '\n',
    );
  } else {
    if (!values.root) throw new Error();
    const retained = await retainedBinding(values.root),
      { plan, state } = retained;
    if (values['confirm-installation'] !== plan.config.installationId)
      throw new Error();
    let configuration: unknown;
    if (action === 'repair') {
      if (
        !values.configuration ||
        !values.maintenance ||
        values['operation-id'] ||
        values['operator-stopped'] ||
        values['expected-inspection-sha256']
      )
        throw new Error();
      configuration = await readConfiguration(values.configuration);
    } else {
      if (values.configuration) throw new Error();
      if (action === 'inspect' || action === 'recover') {
        if (!values['operation-id']) throw new Error();
        const context = await readOfflineMaintenanceContext(
          join(values.root, 'operations'),
          values['operation-id'],
        );
        configuration = context.configuration;
        if (
          action === 'recover' &&
          (!values.maintenance ||
            !values['operator-stopped'] ||
            !values['expected-inspection-sha256'])
        )
          throw new Error();
        if (
          action === 'inspect' &&
          (values.maintenance ||
            values['operator-stopped'] ||
            values['expected-inspection-sha256'])
        )
          throw new Error();
      } else if (
        !values.maintenance ||
        values['operation-id'] ||
        values['operator-stopped'] ||
        values['expected-inspection-sha256']
      )
        throw new Error();
    }
    const repair =
      configuration === undefined
        ? undefined
        : await prepareOfflineRepair(values.root, configuration);
    if ((await retainedBinding(values.root)).binding !== retained.binding)
      throw new Error();
    const options = {
      parent: join(values.root, 'operations'),
      installationId: plan.config.installationId,
      version: state.version,
      binding: certificateHash(
        Buffer.from(JSON.stringify({ retained: retained.binding, repair })),
      ),
      repairConfiguration: repair?.config,
    };
    const host = await createOfflineNativeHost(
      plan,
      retained.fingerprints,
      repair,
    );
    let result: unknown;
    if (action === 'inspect')
      result = await inspectOfflineMaintenance(
        options,
        values['operation-id']!,
        host,
      );
    else if (action === 'recover')
      result = await recoverOfflineMaintenance(
        options,
        values['operation-id']!,
        host,
        {
          installationId: values['confirm-installation']!,
          operatorStopped: values['operator-stopped'] === true,
          expectedFingerprint: values['expected-inspection-sha256']!,
        },
      );
    else
      result = await runOfflineMaintenance(
        options,
        action === 'repair' ? 'repair' : 'uninstall',
        host,
      );
    process.stdout.write(
      JSON.stringify({
        event: 'offline_' + action + '_completed',
        installationId: plan.config.installationId,
        result,
      }) + '\n',
    );
  }
} catch {
  process.stderr.write(
    '{"event":"offline_lifecycle_failed","message":"Check protected configuration and exact installation/inspection confirmation. Retain all data and operation evidence; stop the previous operator before explicit recovery."}\n',
  );
  process.exitCode = 1;
}
