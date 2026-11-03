import { afterEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { secureDirectory } from './release-staging.js';
import {
  initializeInstallationState,
  readInstallationState,
  replaceInstallationState,
} from './installation-state.js';

const parent =
  process.platform === 'win32'
    ? (process.env.LOCALAPPDATA ?? tmpdir())
    : tmpdir();
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(parent) ||
      !basename(root).startsWith('gst-install-state-test-')
    )
      throw new Error('Unsafe fixture path.');
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(parent, 'gst-install-state-test-'));
  roots.push(root);
  await secureDirectory(root);
  const state = {
    format: 1 as const,
    installationId: randomUUID(),
    version: '1.0.0',
    schemaDigest: 'a'.repeat(64),
    appRoot: join(root, 'original'),
    operationId: null,
  };
  await initializeInstallationState(root, state);
  return { root, state };
}
test('installation identity is exclusive and stale replacements cannot overwrite newer state', async () => {
  const f = await fixture();
  await expect(initializeInstallationState(f.root, f.state)).rejects.toThrow();
  const selected = {
    ...f.state,
    version: '1.1.0',
    appRoot: join(f.root, 'next'),
    operationId: randomUUID(),
  };
  await replaceInstallationState(f.root, f.state, selected);
  await expect(
    replaceInstallationState(f.root, f.state, f.state),
  ).rejects.toThrow();
  expect(await readInstallationState(f.root)).toEqual(selected);
  await expect(
    replaceInstallationState(f.root, selected, {
      ...selected,
      installationId: randomUUID(),
    }),
  ).rejects.toThrow();
}, 30000);
test('malformed/oversized installation evidence is rejected rather than adopted', async () => {
  const f = await fixture();
  await writeFile(join(f.root, 'installation.json'), ' '.repeat(16385));
  await expect(readInstallationState(f.root)).rejects.toThrow();
}, 30000);

test.runIf(process.platform === 'win32')(
  'read-only audit rejects inheritable untrusted write permissions without repairing them',
  async () => {
    const f = await fixture();
    const command = async (script: string) =>
      promisify(execFile)(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        {
          env: { ...process.env, GST_INSTALL_TEST_ROOT: f.root },
          windowsHide: true,
        },
      );
    await promisify(execFile)(
      join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'),
      [f.root, '/grant', '*S-1-5-11:(OI)(CI)(IO)(W)'],
      { windowsHide: true },
    );
    const inspect =
      "$a=Get-Acl -LiteralPath $env:GST_INSTALL_TEST_ROOT; $a.GetSecurityDescriptorSddlForm('Access')";
    const before = (await command(inspect)).stdout;
    await expect(readInstallationState(f.root)).rejects.toThrow();
    expect((await command(inspect)).stdout).toBe(before);
  },
  30000,
);
