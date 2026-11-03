// Explicit host-only entry point. Never import into browser/tenant controllers.
export {
  createEncryptedBackup,
  verifyRestore,
  prepareRecovery,
  migrationDigest,
} from './backup-operator.js';
export type { BackupOperatorOptions } from './backup-operator.js';
export { provisionRecoveryRuntime } from './runtime-access.js';
export {
  switchRecovery,
  recoverySwitchStatus,
  assertRecoveryRuntimeReady,
} from './recovery-switch.js';
export {
  inspectUpdateDatabase,
  readUpdateOrganizations,
  updateConnections,
} from './update-inspection.js';
