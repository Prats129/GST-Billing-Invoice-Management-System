import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createIsolatedTestDatabase } from '../../packages/database/src/testing.js';
import { IdentityService } from '../../apps/api/src/security/identity.service.js';
import { OrganizationsService } from '../../apps/api/src/security/organizations.service.js';
import { createTotp } from '../../apps/api/src/security/crypto.js';
import { parseConfig } from '../../apps/api/src/config.js';

test.describe.configure({ mode: 'serial' });
let isolated: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
let server: ReturnType<typeof spawn>;
let origin: string;
let organizationId: string;
const ownerEmail = 'browser-owner@example.test';
const ownerPassword = `Browser owner ${randomBytes(20).toString('hex')}`;
const employeeEmail = 'browser-employee@example.test';
const temporaryPassword = `Temporary ${randomBytes(20).toString('hex')}`;
const employeePassword = `Employee ${randomBytes(20).toString('hex')}`;

test.beforeAll(async () => {
  test.setTimeout(90000);
  if (!process.env.TEST_DATABASE_ADMIN_URL)
    throw new Error(
      'TEST_DATABASE_ADMIN_URL required; browser tests create only disposable random databases',
    );
  isolated = await createIsolatedTestDatabase(
    process.env.TEST_DATABASE_ADMIN_URL,
  );
  const config = parseConfig({
    DATABASE_URL: isolated.connectionString,
    AUTH_DATA_KEY: 'ab'.repeat(32),
  });
  const service = new OrganizationsService(
    new IdentityService(isolated.database, config),
  );
  organizationId = (
    await service.provisionOwner({
      email: ownerEmail,
      name: 'Browser owner',
      password: ownerPassword,
      organizationName: 'Browser security organization',
    })
  ).organizationId;
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  if (!address || typeof address === 'string')
    throw new Error('Port reservation failed');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DEPLOYMENT_EDITION: 'offline',
    DATABASE_URL: isolated.connectionString,
    AUTH_DATA_KEY: config.AUTH_DATA_KEY!,
    HOST: '127.0.0.1',
    PORT: String(port),
    APP_ORIGIN: origin,
    ALLOWED_HOSTS: `127.0.0.1:${port}`,
    WEB_ROOT: fileURLToPath(new URL('../../apps/web/dist', import.meta.url)),
  };
  delete (env as NodeJS.ProcessEnv).TLS_KEY_PATH;
  delete (env as NodeJS.ProcessEnv).TLS_CERT_PATH;
  server = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let listening = false;
  const startupEvents: string[] = [];
  server.stdout?.on('data', (chunk: Buffer) => {
    if (chunk.toString().includes('"event":"api_started"')) listening = true;
  });
  server.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      try {
        const record: unknown = JSON.parse(line);
        if (
          record &&
          typeof record === 'object' &&
          'event' in record &&
          typeof record.event === 'string'
        )
          startupEvents.push(record.event);
      } catch {
        /* Never echo raw stderr or credentials. */
      }
    }
  });
  let started = false;
  let lastStatus: number | undefined;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error('Browser API exited during startup');
    try {
      const response = await fetch(`${origin}/api/v1/health/ready`, {
        signal: AbortSignal.timeout(1000),
      });
      lastStatus = response.status;
      if (response.ok) {
        started = true;
        break;
      }
    } catch {
      /* bounded startup polling */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!started)
    throw new Error(
      `Browser API readiness timeout (listening=${listening}, status=${lastStatus ?? 'no response'}, events=${startupEvents.join(',')})`,
    );
});
test.afterAll(async () => {
  if (server?.exitCode === null) {
    const exit = once(server, 'exit');
    server.kill('SIGTERM');
    await exit;
  }
  await isolated?.cleanup();
});
async function signIn(page: Page, email: string, password: string) {
  await page.goto(origin);
  await page
    .getByRole('heading', { name: 'Sign in to your workspace', exact: true })
    .waitFor();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith('/api/v1/auth/login') &&
      result.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await response).status()).toBe(201);
}
test('owner manages roles and employees; employee changes password; suspension revokes access', async ({
  page,
  browser,
}) => {
  await signIn(page, ownerEmail, ownerPassword);
  await expect(
    page.getByRole('link', { name: 'Account security', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Organization', { exact: true })
    .selectOption(organizationId);
  await page
    .getByRole('heading', { name: 'Workspace overview', exact: true })
    .waitFor();
  await page
    .getByRole('heading', {
      name: 'Browser security organization',
      exact: true,
    })
    .waitFor();
  await page.screenshot({
    path: 'test-results/ui-overview-desktop.png',
    fullPage: true,
  });
  await page
    .getByRole('link', { name: 'Roles & permissions', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Team directory' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  const roleForm = page.getByRole('dialog');
  await roleForm
    .getByLabel('Role name', { exact: true })
    .fill('Read-only colleague');
  await roleForm.getByRole('checkbox', { name: /^View organization/ }).check();
  await roleForm
    .getByRole('button', { name: 'Save role', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/ui-roles-desktop.png',
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Members', exact: true }).click();
  await page.getByRole('button', { name: 'Add member', exact: true }).click();
  const memberForm = page.getByRole('dialog');
  await expect(memberForm.getByLabel('Name', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Add member', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Add member', exact: true }).click();
  await memberForm.getByLabel('Read-only colleague', { exact: true }).waitFor();
  await memberForm.getByLabel('Name', { exact: true }).fill('Browser employee');
  await memberForm.getByLabel('Email', { exact: true }).fill(employeeEmail);
  await memberForm
    .getByLabel('Temporary password (new account only)', { exact: true })
    .fill(temporaryPassword);
  await memberForm.getByLabel('Read-only colleague', { exact: true }).check();
  await memberForm
    .getByRole('button', { name: 'Add member', exact: true })
    .click();
  await expect(page.getByText(employeeEmail, { exact: false })).toBeVisible();
  await page.screenshot({
    path: 'test-results/ui-members-desktop.png',
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/ui-members-mobile.png',
    fullPage: true,
  });
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter(
        (node) =>
          node.getBoundingClientRect().right > window.innerWidth &&
          getComputedStyle(node).position !== 'fixed',
      )
      .map((node) => ({
        tag: node.tagName,
        class: node.className,
        width: node.getBoundingClientRect().width,
      }))
      .slice(0, 12),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    JSON.stringify(overflowing),
  ).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('dialog')
    .getByRole('link', { name: 'Overview', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Workspace overview' }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/ui-overview-mobile.png',
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('dialog')
    .getByRole('link', { name: 'Members', exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const context = await browser.newContext();
  const employee = await context.newPage();
  try {
    await signIn(employee, employeeEmail, temporaryPassword);
    await expect(
      employee.getByRole('heading', { name: 'Change your temporary password' }),
    ).toBeVisible();
    await employee
      .getByLabel('Current password', { exact: true })
      .fill(temporaryPassword);
    await employee
      .getByLabel('New password', { exact: true })
      .fill(employeePassword);
    await employee
      .getByRole('button', { name: 'Change password', exact: true })
      .click();
    await employee
      .getByLabel('Organization', { exact: true })
      .selectOption(organizationId);
    await expect(
      employee.getByRole('heading', {
        name: 'Browser security organization',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      employee.getByRole('heading', { name: 'Members', exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await employee.request.get(
          `${origin}/api/v1/organizations/${organizationId}/roles`,
        )
      ).status(),
    ).toBe(403);
    const cookies = await context.cookies();
    expect(
      cookies.find((cookie) => cookie.name === 'gst_dev_session')?.httpOnly,
    ).toBe(true);
    expect(await employee.evaluate(() => document.cookie)).not.toContain(
      'gst_dev_session',
    );
    const memberRow = page.getByRole('row').filter({ hasText: employeeEmail });
    await memberRow
      .getByRole('button', { name: 'Manage', exact: true })
      .click();
    const editor = page.getByRole('dialog', {
      name: 'Manage Browser employee',
      exact: true,
    });
    await expect(editor).toBeVisible();
    await editor
      .getByLabel('Status', { exact: true })
      .selectOption('suspended');
    await editor
      .getByRole('button', { name: 'Save membership', exact: true })
      .click();
    await expect(memberRow).toContainText('Suspended');
    await employee
      .getByRole('button', { name: 'Refresh access', exact: true })
      .click();
    await expect(
      employee.getByText(
        'You have no active organization memberships. Contact your organization owner.',
      ),
    ).toBeVisible();
    expect(
      (
        await employee.request.get(
          `${origin}/api/v1/organizations/${organizationId}`,
        )
      ).status(),
    ).toBe(403);
  } finally {
    await context.close();
  }
});
test('business setup, customer archive/restore and catalog classification review work on desktop and mobile', async ({
  page,
}) => {
  await signIn(page, ownerEmail, ownerPassword);
  await page.getByRole('link', { name: 'Business setup', exact: true }).click();
  await page
    .getByLabel('Legal business name', { exact: true })
    .fill('Browser trading business');
  await page
    .getByLabel('Address line 1', { exact: true })
    .fill('12 Market Road');
  await page.getByLabel('City', { exact: true }).fill('Mumbai');
  await page
    .getByLabel('State / territory', { exact: true })
    .selectOption('27');
  await page.getByLabel('PIN code', { exact: true }).fill('400001');
  await page.getByLabel('GSTIN', { exact: true }).fill('27AAPFU0939F1ZV');
  await page
    .getByRole('checkbox', { name: /I have checked the registration status/ })
    .check();
  await page
    .getByRole('button', { name: 'Save business details', exact: true })
    .click();
  await expect(
    page.getByText('Business details saved.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByLabel('Legal business name', { exact: true }),
  ).toHaveValue('Browser trading business');
  await page.screenshot({
    path: 'test-results/ui-phase3-business-desktop.png',
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  await page.getByRole('button', { name: 'Add customer', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor
    .getByLabel('Customer name', { exact: true })
    .fill('Browser customer');
  await editor.getByLabel('Customer code', { exact: true }).fill('CUST-001');
  await editor
    .getByLabel('Address line 1', { exact: true })
    .fill('35 Buyer Street');
  await editor.getByLabel('City', { exact: true }).fill('Mumbai');
  await editor
    .getByLabel('State / territory', { exact: true })
    .selectOption('27');
  await editor.getByLabel('PIN code', { exact: true }).fill('400002');
  await editor
    .getByRole('button', { name: 'Create customer', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Edit customer', exact: true })
    .click();
  page.once('dialog', (dialog) => void dialog.accept());
  await editor
    .getByRole('button', { name: 'Archive customer', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByLabel('Record status', { exact: true })
    .selectOption('archived');
  await page
    .getByRole('button', { name: 'View customer', exact: true })
    .click();
  await editor
    .getByRole('button', { name: 'Restore customer', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByLabel('Record status', { exact: true })
    .selectOption('active');
  await expect(
    page.getByText('Browser customer', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Catalog', exact: true }).click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await editor.getByLabel('Item name', { exact: true }).fill('Browser product');
  await editor.getByLabel('Item code', { exact: true }).fill('PROD-001');
  await editor.getByLabel('Unit', { exact: true }).selectOption('KGS');
  await editor
    .getByLabel('Unit price (INR)', { exact: true })
    .fill('1234.5678');
  await editor.getByLabel('HSN / SAC', { exact: true }).fill('100630');
  await editor.getByLabel('GST rate (%)', { exact: true }).fill('5');
  await editor.getByLabel('Effective from', { exact: true }).fill('2026-10-28');
  await editor
    .getByRole('button', { name: 'Create item', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('₹1,234.5678', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit item', exact: true }).click();
  await editor
    .getByLabel('Review reference', { exact: true })
    .fill('Browser-only classification test source');
  await editor
    .getByRole('button', { name: 'Confirm classification review', exact: true })
    .click();
  await expect(editor.getByText('Reviewed', { exact: true })).toBeVisible();
  await editor
    .getByRole('button', { name: 'View classification history' })
    .click();
  await expect(editor.getByText(/Revision 1 · 100630/)).toBeVisible();
  await editor
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await page.getByRole('button', { name: 'Edit item', exact: true }).click();
  await editor.getByLabel('GST rate (%)', { exact: true }).fill('12');
  await expect(
    editor.getByRole('button', {
      name: 'Confirm classification review',
      exact: true,
    }),
  ).toHaveCount(0);
  await editor.getByRole('button', { name: 'Save item', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Needs review', { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/ui-phase3-catalog-desktop.png',
    fullPage: true,
  });
  const catalogRoute = `**/api/v1/organizations/${organizationId}/catalog?*`;
  await page.route(catalogRoute, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Service unavailable' } }),
    }),
  );
  await page
    .getByRole('button', { name: 'Refresh catalog', exact: true })
    .click();
  await expect(
    page.getByText(
      'Could not load these records. Refresh the list or your workspace access.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText('Browser product', { exact: true })).toHaveCount(
    0,
  );
  await page.unroute(catalogRoute);
  await page
    .getByRole('button', { name: 'Refresh catalog', exact: true })
    .click();
  await expect(
    page.getByText('Browser product', { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/ui-phase3-catalog-mobile.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Edit item', exact: true }).click();
  await expect(editor).toBeVisible();
  expect(
    await editor.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('dialog')
    .getByRole('link', { name: 'Business setup', exact: true })
    .click();
  await expect(
    page.getByLabel('Legal business name', { exact: true }),
  ).toHaveValue('Browser trading business');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('authenticator enrollment, recovery-code display and MFA challenge work in browser', async ({
  page,
}) => {
  await signIn(page, ownerEmail, ownerPassword);
  await page
    .getByRole('link', { name: 'Account security', exact: true })
    .click();
  const form = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Start setup', exact: true }),
  });
  await form.getByLabel('Password', { exact: true }).fill(ownerPassword);
  await form.getByRole('button', { name: 'Start setup', exact: true }).click();
  const secret = await page.locator('.secret').textContent();
  expect(secret).toBeTruthy();
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(createTotp(secret!).generate());
  await page
    .getByRole('button', { name: 'Verify and enable', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Save your recovery codes',
      exact: true,
    }),
  ).toBeVisible();
  const recoveryCode = (await page
    .locator('.recovery pre')
    .textContent())!.split('\n')[0]!;
  await page
    .getByRole('button', { name: 'I have saved these codes', exact: true })
    .click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, ownerEmail, ownerPassword);
  await expect(
    page.getByRole('heading', { name: 'Two-step verification', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Authenticator or recovery code', { exact: true })
    .fill(recoveryCode);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByLabel('Organization', { exact: true })).toBeVisible();
});
