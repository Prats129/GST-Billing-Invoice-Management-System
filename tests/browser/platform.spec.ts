import { test, expect } from '@playwright/test';
import { Client } from '../../apps/admin-api/src/store.js';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createTotp } from '../../packages/security/src/index.js';
import { PlatformAuth } from '../../apps/admin-api/src/auth.js';
import { store, migratePlatform } from '../../apps/admin-api/src/store.js';
import { config } from '../../apps/admin-api/src/config.js';
import type { EntitlementClaims } from '../../packages/contracts/src/index.js';
test.describe.configure({ mode: 'serial' });
let root: InstanceType<typeof Client>,
  db: ReturnType<typeof store>,
  name: string,
  origin: string,
  server: ReturnType<typeof spawn>,
  directory: string,
  organizationId: string;
let recoveryCodes: string[] = [];
const password = 'Platform browser ' + randomUUID(),
  email = 'publisher-browser@example.test',
  keys = generateKeyPairSync('ed25519');
test.beforeAll(async () => {
  test.setTimeout(90000);
  const admin = process.env.TEST_DATABASE_ADMIN_URL;
  if (!admin) throw new Error('Disposable test database authority required');
  root = new Client({ connectionString: admin });
  await root.connect();
  name = 'gst_platform_browser_' + randomUUID().replaceAll('-', '');
  await root.query('CREATE DATABASE "' + name + '"');
  const url = new URL(admin);
  url.pathname = '/' + name;
  db = store(url.toString());
  await migratePlatform(db);
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  if (!address || typeof address === 'string')
    throw new Error('No browser port');
  const port = address.port;
  await new Promise<void>((done) => reservation.close(() => done()));
  origin = 'http://127.0.0.1:' + port;
  const authKey = 'ce'.repeat(32);
  await new PlatformAuth(
    db,
    config({
      NODE_ENV: 'test',
      PLATFORM_DATABASE_URL: url.toString(),
      PLATFORM_AUTH_KEY: authKey,
      PLATFORM_ORIGIN: origin,
    }),
  ).bootstrap(email, 'Platform owner', password);
  directory = await mkdtemp(join(tmpdir(), 'gst-platform-browser-'));
  const trust = join(directory, 'public-trust.json');
  await writeFile(
    trust,
    JSON.stringify({
      test: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    }),
    { mode: 0o600 },
  );
  server = spawn(process.execPath, ['apps/admin-api/dist/main.js'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PLATFORM_DATABASE_URL: url.toString(),
      PLATFORM_AUTH_KEY: authKey,
      PLATFORM_ORIGIN: origin,
      PLATFORM_PORT: String(port),
      PLATFORM_WEB_ROOT: resolve('apps/admin/dist'),
      PLATFORM_TRUST_FILE: trust,
      PLATFORM_ENV_FILE: join(directory, 'no-environment-file'),
    },
  });
  let ready = false;
  server.stdout?.on('data', (b: Buffer) => {
    if (b.toString().includes('platform_started')) ready = true;
  });
  server.stderr?.on('data', () => {});
  for (let attempt = 0; !ready && attempt < 100; attempt++)
    await new Promise((done) => setTimeout(done, 100));
  if (!ready) throw new Error('Platform browser server did not start');
});
test.afterAll(async () => {
  if (server && server.exitCode === null && !server.killed) {
    server.kill();
    await once(server, 'exit').catch(() => {});
  }
  await db?.end();
  if (root) {
    await root.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await root.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
test('owner MFA, offline organization detail URLs, agreements and payments work in the real portal', async ({
  page,
}) => {
  await page.goto(origin);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  const secret = await page.locator('.card code').first().innerText();
  await page
    .getByLabel('Verification or recovery code')
    .fill(createTotp(secret.trim()).generate());
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Save your recovery codes now' }),
  ).toBeVisible();
  recoveryCodes = (await page.locator('.warning code').allTextContents()).map(
    (c) => c.trim(),
  );
  await page.getByRole('button', { name: 'I saved them' }).click();
  await page.getByRole('link', { name: 'Operations', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Setup & system checks' }),
  ).toBeVisible();
  await expect(
    page.getByText('SAAS_NOT_CONFIGURED', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('WORKER_DISABLED', { exact: false }),
  ).toBeVisible();
  await page.getByText('Backup & recovery status', { exact: true }).click();
  await expect(
    page.getByText('The host has not connected a backup status report.', {
      exact: false,
    }),
  ).toBeVisible();
  await page.route('**/api/platform/v1/backups/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'reported',
        report: {
          version: 1,
          checkedAt: new Date().toISOString(),
          targets: [
            {
              id: 'platform',
              kind: 'platform',
              state: 'interrupted',
              maximumAgeHours: 24,
              lastAttemptAt: new Date().toISOString(),
              lastVerifiedAt: null,
            },
          ],
        },
      }),
    }),
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(
    page.getByText('A job has no confirmed completion.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /restore|download backup|run backup/i }),
  ).toHaveCount(0);
  await page.unroute('**/api/platform/v1/backups/status');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Setup & system checks' }),
  ).toBeVisible();
  await page.route('**/api/platform/v1/diagnostics', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'REQUEST_FAILED', message: 'Checks unavailable' },
      }),
    }),
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Cross-database operations' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Setup & system checks' }),
  ).toHaveCount(0);
  await page.unroute('**/api/platform/v1/diagnostics');
  await page.getByRole('link', { name: 'Organizations', exact: true }).click();
  await page.getByRole('link', { name: 'Add organization' }).click();
  await page
    .getByLabel('Business name', { exact: true })
    .fill('Platform browser customer');
  await page
    .getByLabel('Owner/contact email')
    .fill('offline-buyer@example.test');
  await page.getByLabel('Edition', { exact: true }).selectOption('offline');
  await page.getByLabel('Registration method').selectOption('link');
  const descriptor = {
    format: 'gst-offline-registration',
    version: 1,
    organizationId: randomUUID(),
    installationId: randomUUID(),
    name: 'Platform browser customer',
  };
  await page
    .getByLabel('Import offline registration descriptor')
    .setInputFiles({
      name: 'registration.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(descriptor)),
    });
  await expect(
    page.getByLabel('Existing runtime organization UUID'),
  ).toHaveValue(descriptor.organizationId);
  await expect(page.getByLabel('Offline installation UUID')).toHaveValue(
    descriptor.installationId,
  );
  await page
    .getByRole('button', { name: 'Review organization', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Review organization' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit details' }).click();
  await expect(page.getByLabel('Owner/contact email')).toHaveValue(
    'offline-buyer@example.test',
  );
  await page
    .getByRole('button', { name: 'Review organization', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Register organization', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/organizations\/[a-f0-9-]{36}$/);
  organizationId = page.url().split('/').at(-1)!;
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Platform browser customer',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'subscription', exact: true }).click();
  const agreement = page
    .getByRole('heading', { name: 'Record agreed terms' })
    .locator('..');
  await agreement.getByLabel('Agreement type').selectOption('perpetual');
  await agreement
    .getByLabel('Starts at', { exact: true })
    .fill('2026-11-05T10:00');
  await agreement.getByLabel('Due date').fill('2026-11-10');
  await agreement.getByLabel('Agreed total (INR)').fill('1000.50');
  await agreement.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: '₹1,000.50', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('link', { name: 'payments', exact: true }).click();
  const receipt = page
    .getByRole('heading', { name: 'Record payment received' })
    .locator('..');
  await receipt
    .getByLabel('Agreement', { exact: true })
    .selectOption({ index: 1 });
  await receipt.getByLabel('Received amount (INR)').fill('400.25');
  await receipt.getByLabel('Received at').fill('2026-11-05T12:00');
  await receipt.getByLabel('Payment reference').fill('BANK-BROWSER-1');
  await receipt.getByLabel('Received amount (INR)').fill('not-an-amount');
  for (let attempt = 0; attempt < 2; attempt++) {
    await receipt.getByRole('button', { name: 'Save', exact: true }).click();
    const validation = page
      .locator('.gst-notification[data-kind="error"]')
      .filter({ hasText: 'Enter an INR amount' });
    await expect(validation).toBeVisible();
    await validation
      .getByRole('button', { name: 'Dismiss notification', exact: true })
      .click();
  }
  await receipt.getByLabel('Received amount (INR)').fill('400.25');
  await page.route(
    '**/api/platform/v1/organizations/*/receipts',
    (route) =>
      route.fulfill({
        status: 409,
        json: { error: { code: 'OVERPAYMENT', message: 'Balance exceeded' } },
      }),
    { times: 1 },
  );
  await receipt.getByRole('button', { name: 'Save', exact: true }).click();
  const popup = page
    .locator('.gst-notification[data-kind="error"]')
    .filter({ hasText: 'remaining balance' });
  await expect(popup).toBeVisible();
  const bounds = await popup.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    (await page.evaluate(() => innerHeight)) + 1,
  );
  expect(
    await popup
      .locator('..')
      .evaluate((node) => getComputedStyle(node).position),
  ).toBe('fixed');
  await expect(receipt.getByLabel('Received amount (INR)')).toHaveValue(
    '400.25',
  );
  await popup
    .getByRole('button', { name: 'Dismiss notification', exact: true })
    .click();
  await receipt.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: '₹400.25', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'subscription', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: '₹600.25', exact: true }),
  ).toBeVisible();
  await agreement.getByLabel('Agreed total (INR)').fill('20');
  page.once('dialog', (d) => void d.dismiss());
  await page.getByRole('link', { name: 'licenses', exact: true }).click();
  await expect(page).toHaveURL(/\/subscription$/);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('link', { name: 'licenses', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/platform-mobile.png',
    fullPage: true,
  });
});
test('immutable request export, signed import, offline handoff and history refresh work without signing keys in the server', async ({
  page,
}) => {
  await page.goto(origin + '/#/organizations/' + organizationId + '/licenses');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByLabel('Verification or recovery code')
    .fill(recoveryCodes[0]!);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  const form = page
    .getByRole('heading', { name: 'Prepare immutable signing request' })
    .locator('..');
  await form.getByLabel('Entitlement type').selectOption('perpetual');
  page.once('dialog', (dialog) => void dialog.dismiss());
  await form.getByRole('button', { name: 'Prepare request' }).click();
  await expect(form.getByLabel('Entitlement type')).toHaveValue('perpetual');
  let rejectedResponse = false;
  await page.route(
    '**/api/platform/v1/organizations/*/license-requests',
    async (route) => {
      if (!rejectedResponse) {
        rejectedResponse = true;
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'REQUEST_FAILED',
              message: 'Simulated lost response',
            },
          }),
        });
      } else await route.continue();
    },
  );
  page.once('dialog', (d) => void d.accept());
  await form.getByRole('button', { name: 'Prepare request' }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'server could not complete this request' }),
  ).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await form.getByRole('button', { name: 'Prepare request' }).click();
  await page.unroute('**/api/platform/v1/organizations/*/license-requests');
  await expect(
    page.getByRole('button', { name: 'Export claims for issuer CLI' }),
  ).toBeVisible();
  const response = await db.query<{ id: string; claims: EntitlementClaims }>(
    'SELECT id,claims FROM platform_license_requests WHERE organization_id=$1',
    [organizationId],
  );
  const r = response.rows[0]!;
  expect(response.rows).toHaveLength(1);
  const packageDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export signing handoff', exact: true })
    .click();
  const handoffFile = await packageDownload;
  const exported = JSON.parse(
    await readFile((await handoffFile.path())!, 'utf8'),
  );
  expect(exported).toMatchObject({
    format: 'gst-license-request',
    requestId: r.id,
    claims: r.claims,
    predecessor: null,
  });
  const payload = Buffer.from(JSON.stringify(r.claims)).toString('base64url');
  const envelope = {
    keyId: 'test',
    payload,
    signature: sign(
      null,
      Buffer.from('GST-ENTITLEMENT-V1\ntest\n' + payload),
      keys.privateKey,
    ).toString('base64url'),
  };
  const imported = page
    .getByRole('heading', { name: 'Import signed grant or reconcile history' })
    .locator('..');
  await imported.getByLabel('Request to match').selectOption(r.id);
  await imported.getByLabel('Signed grant file (JSON)').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not JSON'),
  });
  await expect(
    page.getByRole('alert').filter({ hasText: 'not valid JSON' }),
  ).toBeVisible();
  await imported.getByLabel('Signed grant file (JSON)').setInputFiles({
    name: 'signed.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(envelope)),
  });
  await expect(imported.getByRole('status')).toContainText('Unverified until');
  await imported.getByRole('button', { name: 'Verify and import' }).click();
  await expect(
    page.getByText('Sequence 1 · perpetual', { exact: true }),
  ).toBeVisible();
  const handoff = page
    .getByRole('heading', { name: 'Record offline handoff' })
    .locator('..');
  await handoff.getByLabel('Grant', { exact: true }).selectOption({ index: 1 });
  await handoff
    .getByLabel('Evidence or handoff note')
    .fill('Delivered by operator; installation not verified');
  await handoff.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'delivery_recorded', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Sequence 1 · perpetual', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/platform-desktop.png',
    fullPage: true,
  });
});

test('online onboarding tracks a durable operation and operation URLs preserve refresh and history', async ({
  page,
}) => {
  await page.goto(origin + '/#/organizations/new');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByLabel('Verification or recovery code')
    .fill(recoveryCodes[3]!);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await page
    .getByLabel('Business name', { exact: true })
    .fill('Online onboarding fixture');
  await page
    .getByLabel('Owner/contact email')
    .fill('online-owner@example.test');
  await expect(page.getByLabel('Offline installation UUID')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Review organization', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Register organization', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/organizations\/[a-f0-9-]{36}$/);
  const createdId = page.url().split('/').at(-1)!;
  await expect(
    page.getByRole('button', { name: 'Generate owner setup link' }),
  ).toBeDisabled();
  const operation = (
    await db.query<{ id: string }>(
      "SELECT id FROM platform_operations WHERE organization_id=$1 AND kind='provision'",
      [createdId],
    )
  ).rows[0]!;
  await page.getByRole('link', { name: 'View provisioning operation' }).click();
  await expect(page).toHaveURL(
    new RegExp('#/operations/' + operation.id + '$'),
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Operation details' }),
  ).toBeVisible();
  expect(await page.locator('main').innerText()).not.toMatch(
    /passwordHash|tokenHash/,
  );
  await page
    .getByRole('link', { name: 'All operations', exact: false })
    .click();
  await page
    .getByLabel('Operation ID', { exact: true })
    .fill(operation.id.slice(0, 8));
  await page.getByLabel('Operation state').selectOption('pending');
  await page.getByRole('button', { name: 'Search operations' }).click();
  await page.reload();
  await expect(page.getByLabel('Operation ID', { exact: true })).toHaveValue(
    operation.id.slice(0, 8),
  );
  await page
    .getByRole('link', { name: 'provision · ' + operation.id.slice(0, 8) })
    .click();
  await page.goBack();
  await expect(page.getByLabel('Operation state')).toHaveValue('pending');
  await page.goForward();
  await expect(
    page.getByRole('heading', { name: 'Operation details' }),
  ).toBeVisible();
});

test('sensitive actions verify in place, preserve the source form on cancel or wrong proof and commit once', async ({
  page,
}) => {
  await page.goto(origin + '/#/security');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByLabel('Verification or recovery code')
    .fill(recoveryCodes[1]!);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  const source = page
    .getByRole('heading', {
      name: 'Change password and sign out all sessions',
      exact: true,
    })
    .locator('..');
  const replacement = password + ' replacement';
  await source
    .getByLabel('New password (at least 15 characters)', { exact: true })
    .fill(replacement);
  await source.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Confirm your identity',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByLabel('Current password', { exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(
    source.getByLabel('New password (at least 15 characters)', { exact: true }),
  ).toHaveValue(replacement);
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "SELECT count(*)::int AS count FROM platform_audit WHERE action='owner.password_changed'",
          )
        ).rows[0].count,
    )
    .toBe(0);
  await source.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog
    .getByLabel('Current password', { exact: true })
    .fill('wrong password');
  await dialog
    .getByLabel('Fresh verification or recovery code', { exact: true })
    .fill(recoveryCodes[2]!);
  await dialog
    .getByRole('button', { name: 'Verify and continue', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    'password was not accepted',
  );
  expect(
    (await page.request.get(origin + '/api/platform/v1/auth/session')).status(),
  ).toBe(200);
  await dialog.getByLabel('Current password', { exact: true }).fill(password);
  await dialog
    .getByLabel('Fresh verification or recovery code', { exact: true })
    .fill(recoveryCodes[2]!);
  await dialog
    .getByRole('button', { name: 'Verify and continue', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Publisher sign in', exact: true }),
  ).toBeVisible();
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM platform_audit WHERE action='owner.password_changed'",
      )
    ).rows[0].count,
  ).toBe(1);
});
