import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';
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
async function openBusiness(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Workspace navigation', exact: true })
    .getByRole('link', { name: 'Business settings', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Business settings sections' })
    .getByRole('link', { name, exact: true })
    .click();
}
async function openAccount(page: Page) {
  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await page
    .getByRole('menuitem', { name: 'Account settings', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Manage two-step verification', exact: true })
    .click();
}
test('account appearance persists across logins, follows system mode and preserves unsaved invoices', async ({
  page,
}, testInfo) => {
  const service = new OrganizationsService(
    new IdentityService(
      isolated.database,
      parseConfig({
        DATABASE_URL: isolated.connectionString,
        AUTH_DATA_KEY: 'ab'.repeat(32),
      }),
    ),
  );
  const email = `theme-${randomUUID()}@example.test`,
    otherEmail = `theme-${randomUUID()}@example.test`;
  for (const account of [email, otherEmail])
    await service.provisionOwner({
      email: account,
      name: 'Appearance user',
      password: ownerPassword,
      organizationName: 'Appearance workspace',
    });
  await page.emulateMedia({ colorScheme: 'light' });
  await signIn(page, email, ownerPassword);
  await expect(page.locator('.overview-intro')).toBeVisible();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  const openAppearance = async () => {
    await page.getByRole('button', { name: /^Account menu for/ }).click();
    await page
      .getByRole('menuitem', { name: 'Account settings', exact: true })
      .click();
    await settings
      .getByRole('tab', { name: 'Appearance', exact: true })
      .click();
  };
  await openAppearance();
  await settings.getByRole('radio', { name: 'Dark', exact: true }).check();
  await settings.getByRole('radio', { name: 'Blue', exact: true }).check();
  await settings
    .getByRole('button', { name: 'Save appearance', exact: true })
    .click();
  await expect(
    settings.getByText('Appearance saved.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue');
  await page.screenshot({
    path: testInfo.outputPath('appearance-dark-blue.png'),
  });
  await page.keyboard.press('Escape');
  await page
    .getByRole('navigation', { name: 'Workspace navigation', exact: true })
    .getByRole('link', { name: 'Invoices', exact: true })
    .click();
  await page.getByRole('button', { name: 'New invoice', exact: true }).click();
  await page
    .getByLabel('Notes', { exact: true })
    .fill('Preserve my draft when changing colors');
  await openAppearance();
  await settings.getByRole('radio', { name: 'Violet', exact: true }).check();
  // Failed saves keep the currently applied preference and allow a retry.
  await page.route('**/api/v1/auth/appearance', (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: 'UNAVAILABLE',
          message: 'Appearance temporarily unavailable.',
        },
      },
    }),
  );
  await settings
    .getByRole('button', { name: 'Save appearance', exact: true })
    .click();
  await expect(
    settings.getByRole('alert').locator('.gst-notification-content'),
  ).toHaveText('Appearance temporarily unavailable.');
  await expect(settings.getByRole('alert')).toBeVisible();
  const appearanceErrorBounds = await settings.getByRole('alert').boundingBox();
  expect(appearanceErrorBounds!.y).toBeGreaterThanOrEqual(0);
  expect(
    appearanceErrorBounds!.y + appearanceErrorBounds!.height,
  ).toBeLessThanOrEqual((await page.evaluate(() => innerHeight)) + 1);
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue');
  await page.unroute('**/api/v1/auth/appearance');
  await settings
    .getByRole('button', { name: 'Save appearance', exact: true })
    .click();
  await expect(
    settings.getByText('Appearance saved.', { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
    'Preserve my draft when changing colors',
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await page.reload();
  await expect(
    page.getByRole('button', { name: /^Account menu for/ }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
  await openAppearance();
  await settings
    .getByRole('radio', { name: 'Follow system', exact: true })
    .check();
  await settings
    .getByRole('button', { name: 'Save appearance', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(
    settings.getByText('Appearance saved.', { exact: true }),
  ).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('appearance-dark-mobile.png'),
  });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Sign in to your workspace',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');
  await page.screenshot({ path: testInfo.outputPath('sign-in-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await signIn(page, otherEmail, ownerPassword);
  await expect(page.locator('.overview-intro')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');
  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Sign in to your workspace',
      exact: true,
    }),
  ).toBeVisible();
  await signIn(page, email, ownerPassword);
  await expect(page.locator('.overview-intro')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
});
test('owner manages roles and employees; employee changes password; suspension revokes access', async ({
  page,
  browser,
}) => {
  await signIn(page, ownerEmail, ownerPassword);
  await expect(
    page.getByRole('button', { name: /^Account menu for/ }),
  ).toBeVisible();
  await page
    .getByLabel('Organization', { exact: true })
    .selectOption(organizationId);
  await page
    .getByRole('heading', { name: 'Workspace overview', exact: true })
    .waitFor();
  await expect(page.getByLabel('Organization', { exact: true })).toHaveValue(
    organizationId,
  );
  await expect(page.locator('.overview-intro')).toBeVisible();
  await page.screenshot({
    path: 'test-results/ui-overview-desktop.png',
    fullPage: true,
  });
  await openBusiness(page, 'Roles & permissions');
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
  await openBusiness(page, 'Members');
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
    .getByRole('navigation', { name: 'Workspace navigation', exact: true })
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
  await openBusiness(page, 'Members');
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
      employee.getByLabel('Organization', { exact: true }),
    ).toHaveValue(organizationId);
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
  await openBusiness(page, 'Business setup');
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
  const logo = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#13796d';
    ctx.fillRect(0, 0, 32, 32);
    return c.toDataURL('image/png');
  });
  await page.getByLabel('Business logo (PNG)', { exact: true }).setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(logo.split(',')[1]!, 'base64'),
  });
  await expect(
    page.getByRole('img', { name: 'Business logo preview' }),
  ).toBeVisible();
  await page
    .getByRole('checkbox', { name: /I have checked the registration status/ })
    .check();
  // This synthetic business is explicitly assessed as outside e-invoicing.
  await page
    .getByLabel('E-invoice applicability', { exact: true })
    .selectOption('not_required');
  await page.route(
    '**/api/v1/organizations/*/business-profile',
    (route) =>
      route.fulfill({
        status: 403,
        json: { error: { code: 'FORBIDDEN', message: 'Access denied' } },
      }),
    { times: 1 },
  );
  await page
    .getByRole('button', { name: 'Save business details', exact: true })
    .click();
  const errorPopup = page
    .locator('.gst-notification[data-kind="error"]')
    .filter({ hasText: 'Your account does not have permission' });
  await expect(errorPopup).toBeVisible();
  const errorBounds = await errorPopup.boundingBox();
  expect(errorBounds!.y).toBeGreaterThanOrEqual(0);
  expect(errorBounds!.y + errorBounds!.height).toBeLessThanOrEqual(
    (await page.evaluate(() => innerHeight)) + 1,
  );
  expect(
    await errorPopup
      .locator('..')
      .evaluate((node) => getComputedStyle(node).position),
  ).toBe('fixed');
  await errorPopup
    .getByRole('button', { name: 'Dismiss notification', exact: true })
    .click();
  await expect(
    page.getByLabel('Legal business name', { exact: true }),
  ).toHaveValue('Browser trading business');
  await page
    .getByRole('button', { name: 'Save business details', exact: true })
    .click();
  await expect(
    page.getByText('Business details saved.', { exact: true }),
  ).toBeVisible();
  await page
    .locator('.gst-notification[data-kind="success"]')
    .filter({ hasText: 'Business details saved.' })
    .getByRole('button', { name: 'Dismiss notification', exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByLabel('Legal business name', { exact: true }),
  ).toHaveValue('Browser trading business');
  await page.screenshot({
    path: 'test-results/ui-phase3-business-desktop.png',
    fullPage: true,
  });
  await page
    .getByRole('navigation', { name: 'Workspace navigation', exact: true })
    .getByRole('link', { name: 'Customers', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add customer', exact: true }).click();
  const editor = page.locator('.record-page');
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
  await expect(editor).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Edit customer', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/customers\/[0-9a-f-]{36}$/);
  const customerUrl = page.url();
  await page.reload();
  await expect(editor.getByLabel('Customer name', { exact: true })).toHaveValue(
    'Browser customer',
  );
  await editor
    .getByLabel('Customer name', { exact: true })
    .fill('Unsaved change');
  page.once('dialog', (dialog) => void dialog.dismiss());
  await editor
    .getByRole('button', { name: 'Back to list', exact: true })
    .click();
  await expect(page).toHaveURL(customerUrl);
  await expect(editor.getByLabel('Customer name', { exact: true })).toHaveValue(
    'Unsaved change',
  );
  page.once('dialog', (dialog) => void dialog.accept());
  await editor
    .getByRole('button', { name: 'Back to list', exact: true })
    .click();
  await page.goBack();
  await expect(editor.getByLabel('Customer name', { exact: true })).toHaveValue(
    'Browser customer',
  );
  await page.goForward();
  await expect(editor).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Edit customer', exact: true })
    .click();
  page.once('dialog', (dialog) => void dialog.accept());
  await editor
    .getByRole('button', { name: 'Archive customer', exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await page
    .getByLabel('Record status', { exact: true })
    .selectOption('archived');
  await page
    .getByRole('button', { name: 'View customer', exact: true })
    .click();
  await editor
    .getByRole('button', { name: 'Restore customer', exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await page
    .getByLabel('Record status', { exact: true })
    .selectOption('active');
  await expect(
    page.getByText('Browser customer', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Workspace navigation', exact: true })
    .getByRole('link', { name: 'Catalog', exact: true })
    .click();
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
  await expect(editor).toHaveCount(0);
  await expect(page.getByText('₹1,234.5678', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit item', exact: true }).click();
  await expect(page).toHaveURL(/#\/catalog\/[0-9a-f-]{36}$/);
  await page.reload();
  await expect(editor.getByLabel('Item name', { exact: true })).toHaveValue(
    'Browser product',
  );

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
    .getByRole('button', { name: 'Back to list', exact: true })
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
  await expect(editor).toHaveCount(0);
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
  await editor
    .getByRole('button', { name: 'Back to list', exact: true })
    .click();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await openBusiness(page, 'Business setup');
  await expect(
    page.getByLabel('Legal business name', { exact: true }),
  ).toHaveValue('Browser trading business');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('invoice builder saves drafts, calculates discounts and GST, and prints a marked preview on desktop and mobile', async ({
  page,
}) => {
  await signIn(page, ownerEmail, ownerPassword);
  const session = await (
    await page.request.get(`${origin}/api/v1/auth/session`)
  ).json();
  const base = `${origin}/api/v1/organizations/${organizationId}`;
  const headers = {
    Origin: origin,
    'x-csrf-token': session.csrfToken as string,
  };
  const address = {
    line1: '22 Buyer Road',
    line2: '',
    city: 'Mumbai',
    stateCode: '27',
    postalCode: '400001',
  };
  const customer = await page.request.post(`${base}/customers`, {
    headers,
    data: {
      version: 0,
      code: 'BILL-C1',
      name: 'Invoice browser buyer',
      address,
    },
  });
  expect(customer.status()).toBe(201);
  const item = await page.request.post(`${base}/catalog`, {
    headers,
    data: {
      version: 0,
      code: 'BILL-P1',
      name: 'Invoice browser product',
      kind: 'goods',
      unitCode: 'KGS',
      price: '100',
      priceIncludesGst: false,
      tax: {
        hsnSac: '100630',
        category: 'taxable',
        gstPercent: '18',
        effectiveFrom: '2026-10-29',
      },
    },
  });
  expect(item.status()).toBe(201);
  const savedItem = await item.json();
  expect(
    (
      await page.request.post(`${base}/catalog/${savedItem.id}/tax-review`, {
        headers,
        data: {
          version: savedItem.version,
          reference: 'Browser synthetic calculation fixture only',
        },
      })
    ).status(),
  ).toBe(201);
  await page
    .getByRole('navigation', { name: 'Workspace navigation', exact: true })
    .getByRole('link', { name: 'Invoices', exact: true })
    .click();
  await page.getByRole('button', { name: 'New invoice', exact: true }).click();
  await page
    .getByRole('button', { name: 'Choose customer', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Select Invoice browser buyer', exact: true })
    .click();
  await page.getByLabel('Issue date', { exact: true }).fill('2026-10-29');
  await page.getByLabel('Supply date', { exact: true }).fill('2026-10-29');
  await page
    .getByRole('checkbox', { name: /I confirm ordinary domestic/ })
    .check();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', {
      name: 'Select Invoice browser product',
      exact: true,
    })
    .click();
  await page.getByLabel('Quantity 1', { exact: true }).fill('2.5');
  await page
    .getByLabel('Line 1 discount', { exact: true })
    .selectOption('percent');
  await page.getByLabel('Line 1 discount value', { exact: true }).fill('10');
  await page
    .getByLabel('Invoice discount', { exact: true })
    .selectOption('amount');
  await page.getByLabel('Invoice discount value', { exact: true }).fill('5');
  await page
    .getByLabel('Notes', { exact: true })
    .fill('Browser draft <script> is plain text');
  // Recovery opens over the editor, saves separately, and never replaces its inputs.
  await page.route(
    '**/api/v1/organizations/*/invoices/preview',
    (route) =>
      route.fulfill({
        status: 409,
        json: {
          error: { code: 'BILLING_SETUP_REQUIRED', message: 'Setup required' },
        },
      }),
    { times: 1 },
  );
  await page
    .getByRole('button', { name: 'Calculate & preview', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Open business setup', exact: true })
    .first()
    .click();
  const setup = page.getByRole('dialog', {
    name: 'Business setup',
    exact: true,
  });
  await setup.getByLabel('Trade name', { exact: true }).fill('Recovery trade');
  page.once('dialog', (prompt) => void prompt.dismiss());
  await page.keyboard.press('Escape');
  await expect(setup).toBeVisible();
  await setup.locator('input[name="registrationConfirmed"]').check();
  await setup
    .getByRole('button', { name: 'Save business details', exact: true })
    .click();
  await expect(
    setup.getByText('Business details saved.', { exact: true }),
  ).toBeVisible();
  await setup
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
    'Browser draft <script> is plain text',
  );
  await expect(page.getByLabel('Quantity 1', { exact: true })).toHaveValue(
    '2.5',
  );
  await page.route(
    '**/api/v1/organizations/*/invoices/preview',
    (route) =>
      route.fulfill({
        status: 401,
        json: {
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid code' },
        },
      }),
    { times: 1 },
  );
  await page
    .getByRole('button', { name: 'Calculate & preview', exact: true })
    .click();
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
    'Browser draft <script> is plain text',
  );
  await expect(
    page.getByRole('button', { name: /^Account menu for/ }),
  ).toBeVisible();
  await page.route(
    '**/api/v1/organizations/*/invoices/preview',
    (route) =>
      route.fulfill({
        status: 400,
        json: { error: { code: 'TAX_NOT_REVIEWED', message: 'Needs review' } },
      }),
    { times: 1 },
  );
  await page
    .getByRole('button', { name: 'Calculate & preview', exact: true })
    .click();
  await expect(
    page
      .getByRole('link', { name: 'Open catalog in a new tab', exact: true })
      .first(),
  ).toHaveAttribute('target', '_blank');
  await page
    .getByRole('button', { name: 'Calculate & preview', exact: true })
    .click();
  await expect(page.locator('.invoice-grand-total')).toContainText('₹259.60');
  const frame = page.frameLocator('iframe[title="Invoice A4 preview"]');
  await expect(
    frame.getByRole('img', { name: 'Business logo', exact: true }),
  ).toBeVisible();
  expect(
    await frame
      .getByRole('img', { name: 'Business logo', exact: true })
      .evaluate((node) => (node as HTMLImageElement).naturalWidth),
  ).toBe(32);
  await expect(
    frame.getByRole('heading', {
      name: 'DRAFT — NOT A TAX INVOICE',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    frame.getByText('Browser draft <script> is plain text', { exact: true }),
  ).toBeVisible();
  expect(
    await frame
      .locator('thead')
      .evaluate((node) => getComputedStyle(node).display),
  ).toBe('table-header-group');
  await page.screenshot({
    path: 'test-results/ui-phase5-invoice-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole('button', { name: 'Calculate & preview', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Finalize invoice', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Print draft', exact: true }),
  ).toBeEnabled();
  await frame.locator('body').evaluate(() => {
    window.print = () => {
      document.body.dataset.printRequested = 'yes';
    };
  });
  await page.getByRole('button', { name: 'Print draft', exact: true }).click();
  await expect(frame.locator('body')).toHaveAttribute(
    'data-print-requested',
    'yes',
  );
  // Use Chromium's test-only PDF capture to verify actual A4 pagination. The
  // application still uses browser printing and has no PDF-generation service.
  const printTab = await page.context().newPage();
  try {
    await printTab.goto(origin);
    const html = await frame.locator('html').evaluate((node) => node.outerHTML);
    await printTab.setContent(`<!doctype html>${html}`);
    await printTab.locator('tbody').evaluate((body) => {
      const row = body.querySelector('tr')!;
      for (let i = 1; i < 100; i++) body.append(row.cloneNode(true));
    });
    await printTab.emulateMedia({ media: 'print' });
    const pdf = await printTab.pdf({
      format: 'A4',
      preferCSSPageSize: true,
      printBackground: true,
      path: 'test-results/ui-phase5-a4-pagination.pdf',
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(
      [...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length,
    ).toBeGreaterThan(1);
    expect(
      await printTab
        .locator('thead')
        .evaluate((node) => getComputedStyle(node).display),
    ).toBe('table-header-group');
  } finally {
    await printTab.close();
  }
  const documentUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(documentUrl);
  await expect(page.getByLabel('Quantity 1', { exact: true })).toHaveValue(
    '2.500000',
  );
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
    'Browser draft <script> is plain text',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('button', { name: 'Calculate & preview', exact: true })
    .click();
  await expect(page.locator('.invoice-grand-total')).toContainText('₹259.60');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/ui-phase5-invoice-mobile.png',
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Discard draft', exact: true })
    .click();
  const cancellation = page.getByRole('dialog', {
    name: 'Discard draft',
    exact: true,
  });
  await cancellation
    .getByLabel('Cancellation reason', { exact: true })
    .fill('     ');
  await cancellation
    .getByRole('checkbox', { name: 'No supply occurred under this document.' })
    .check();
  await cancellation
    .getByRole('checkbox', {
      name: 'This document has not been reported or registered with an IRP.',
    })
    .check();
  const discardRequests: string[] = [];
  const trackDiscard = (request: Request) => {
    if (request.method() === 'POST' && request.url().endsWith('/cancel'))
      discardRequests.push(request.url());
  };
  page.on('request', trackDiscard);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await cancellation
        .getByRole('button', { name: 'Discard draft', exact: true })
        .click();
      const validation = cancellation.locator(
        '.gst-notification[data-kind="error"]',
      );
      await expect(validation).toContainText('Reason:');
      await validation
        .getByRole('button', { name: 'Dismiss notification', exact: true })
        .click();
    }
    expect(discardRequests).toHaveLength(0);
    await expect(cancellation.getByLabel('Cancellation reason')).toHaveValue(
      '     ',
    );
  } finally {
    page.off('request', trackDiscard);
  }
  await cancellation
    .getByLabel('Cancellation reason', { exact: true })
    .fill('Duplicate draft created by mistake');
  await cancellation
    .getByRole('button', { name: 'Discard draft', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Cancelled: Duplicate draft created by mistake/),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save draft', exact: true }),
  ).toHaveCount(0);
  // A separate fixture preserves draft-discard coverage while exercising real
  // ordinary issuance through the UI, without a release spy or mocked API.
  const listed = await (await page.request.get(`${base}/invoices`)).json();
  const discarded = await (
    await page.request.get(
      `${base}/invoices/${listed.items.find((record: { customerName: string }) => record.customerName === 'Invoice browser buyer').id}`,
    )
  ).json();
  const fresh = await page.request.post(`${base}/invoices`, {
    headers,
    data: { ...discarded.draft, version: 0, requestKey: randomUUID() },
  });
  expect(fresh.status()).toBe(201);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'All invoices' }).click();
  await expect(
    page.getByRole('heading', { name: 'Invoices', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('row')
    .filter({ has: page.getByText('Draft', { exact: true }) })
    .getByRole('button', { name: 'Open document', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Finalize invoice', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Calculate & preview', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Finalize invoice', exact: true }),
  ).toBeEnabled();
  page.once('dialog', (dialog) => void dialog.accept());
  const issuedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/finalize') &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Finalize invoice', exact: true })
    .click();
  const issued = await issuedResponse;
  expect(issued.status()).toBe(201);
  const issuedRecord = await issued.json();
  expect(issuedRecord.number).toBe('INV/2627/000001');
  await expect(
    page.getByRole('button', { name: 'Finalize invoice', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Save draft', exact: true }),
  ).toHaveCount(0);
  const issuedFrame = page.frameLocator('iframe[title="Invoice A4 preview"]');
  await expect(issuedFrame.locator('.document-heading')).toContainText(
    issuedRecord.number,
  );
  await expect(
    issuedFrame.getByRole('heading', { name: 'Tax invoice', exact: true }),
  ).toBeVisible();
  await expect(
    issuedFrame.getByRole('heading', {
      name: 'DRAFT — NOT A TAX INVOICE',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(
    new RegExp('#/invoices/' + issuedRecord.id + '$'),
  );
  await page.reload();
  await expect(
    page
      .frameLocator('iframe[title="Invoice A4 preview"]')
      .locator('.document-heading'),
  ).toContainText(issuedRecord.number);
});

test('correction dialogs submit and edit versioned original-line value adjustments', async ({
  page,
}) => {
  await signIn(page, ownerEmail, ownerPassword);
  const session = await (
    await page.request.get(`${origin}/api/v1/auth/session`)
  ).json();
  const base = `${origin}/api/v1/organizations/${organizationId}/invoices`;
  const headers = {
    Origin: origin,
    'x-csrf-token': session.csrfToken as string,
  };
  const list = await (await page.request.get(base)).json();
  const previous = await (
    await page.request.get(`${base}/${list.items[0].id}`)
  ).json();
  const created = await page.request.post(base, {
    headers,
    data: { ...previous.draft, version: 0, requestKey: randomUUID() },
  });
  expect(created.status()).toBe(201);
  const draft = await created.json();
  const calculated = await (
    await page.request.post(`${base}/${draft.id}/preview`, { headers })
  ).json();
  // Read-only browser fixture makes issued-document controls reachable without
  // issuing anything or introducing an application release-gate bypass. The real
  // API transaction/race behavior is covered by isolated integration tests.
  const issued = {
    ...draft,
    status: 'finalized',
    version: 2,
    number: 'INV/2627/999999',
    snapshot: { ...calculated.print, number: 'INV/2627/999999' },
  };
  await page.route(`${base}?*`, (route) =>
    route.fulfill({ json: { items: [issued], hasMore: false } }),
  );
  await page.route(`${base}/${draft.id}`, (route) =>
    route.fulfill({ json: issued }),
  );
  const correctionId = randomUUID();
  let correction: typeof issued | undefined;
  await page.route(`${base}/${draft.id}/corrections`, async (route) => {
    const body = route.request().postDataJSON();
    expect(body.documentType).toBe('debit_note');
    expect(body.lines[0].supplyValue).toBe('10.00');
    correction = {
      ...draft,
      id: correctionId,
      status: 'draft',
      version: 1,
      documentType: 'debit_note',
      number: null,
      snapshot: null,
      originalId: draft.id,
      correctionReason: body.reason,
      correction: body,
    };
    await route.fulfill({ status: 201, json: correction });
  });
  await page.route(`${base}/${correctionId}`, async (route) => {
    await route.fulfill({ json: correction });
  });
  await page.route(`${base}/${correctionId}/correction`, async (route) => {
    const body = route.request().postDataJSON();
    expect(body.version).toBe(1);
    expect(body.lines[0].supplyValue).toBe('15.00');
    correction = {
      ...correction!,
      version: 2,
      correction: body,
      correctionReason: body.reason,
    };
    await route.fulfill({ json: correction });
  });
  await page
    .getByRole('navigation', { name: 'Workspace navigation', exact: true })
    .getByRole('link', { name: 'Invoices', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Open document', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Create credit / debit note', exact: true })
    .click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Document type', { exact: true })
    .selectOption('debit_note');
  await dialog
    .getByLabel('Correction reason', { exact: true })
    .fill('Additional value agreed with buyer');
  await dialog.getByLabel('Adjustment amount 1', { exact: true }).fill('10');
  await dialog
    .getByRole('button', { name: 'Create correction draft', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Debit note', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Edit correction draft', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Adjustment amount 1', { exact: true }).fill('15');
  await dialog
    .getByRole('button', { name: 'Save correction draft', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('₹15.00', { exact: true })).toBeVisible();
});

test('expired entitlement notice preserves the workspace and authorized reads after a rejected write', async ({
  page,
}) => {
  const base = `${origin}/api/v1/organizations/${organizationId}`;
  let entitlementState = 'expired';
  await page.route(base, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        entitlement: {
          status: entitlementState,
          kind: 'trial',
          expiresAt: '2026-01-01T00:00:00Z',
        },
      },
    });
  });
  await page.route(`${base}/business-profile`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    await route.fulfill({
      status: 403,
      json: {
        error: {
          code: 'ENTITLEMENT_READ_ONLY',
          message: 'Your trial has expired. Existing records remain available.',
        },
      },
    });
  });
  await signIn(page, ownerEmail, ownerPassword);
  await page
    .getByLabel('Organization', { exact: true })
    .selectOption(organizationId);
  await expect(
    page.getByText('This organization is read-only.', { exact: true }),
  ).toBeVisible();
  await openBusiness(page, 'Business setup');
  await expect(
    page.getByLabel('Legal business name', { exact: true }),
  ).toHaveValue('Browser trading business');
  await expect(
    page.getByLabel('Legal business name', { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Save business details', exact: true }),
  ).toHaveCount(0);
  // Simulate a renewal followed by a later server-side expiry. A stale writable
  // screen must handle rejection without losing authorized historical access.
  entitlementState = 'active';
  await page
    .getByRole('button', { name: 'Refresh access', exact: true })
    .click();
  await expect(
    page.getByLabel('Legal business name', { exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Save business details', exact: true })
    .click();
  await expect(
    page
      .getByRole('alert')
      .filter({
        hasText: 'Your trial has expired. Existing records remain available.',
      })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Your trial has expired.' })
      .first(),
  ).toContainText('Contact your provider');
  await expect(page.getByLabel('Organization', { exact: true })).toHaveValue(
    organizationId,
  );
  await page
    .getByRole('navigation', { name: 'Workspace navigation', exact: true })
    .getByRole('link', { name: 'Invoices', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Invoices', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Sign in to your workspace',
      exact: true,
    }),
  ).toHaveCount(0);
});

test('authenticator enrollment, recovery-code display and MFA challenge work in browser', async ({
  page,
}) => {
  await signIn(page, ownerEmail, ownerPassword);
  await openAccount(page);
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
  await page
    .getByRole('dialog', { name: 'Settings', exact: true })
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await signIn(page, ownerEmail, ownerPassword);
  await expect(
    page.getByRole('heading', { name: 'Two-step verification', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Authenticator or recovery code', { exact: true })
    .fill(recoveryCode);
  await page
    .getByLabel('Remember this device for 30 days', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByLabel('Organization', { exact: true })).toBeVisible();
  const remembered = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'gst_dev_trusted_device',
  );
  expect(remembered?.httpOnly).toBe(true);
  expect(remembered?.sameSite).toBe('Strict');
  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await signIn(page, ownerEmail, ownerPassword);
  await expect(page.getByLabel('Organization', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Organization', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await page
    .getByRole('menuitem', { name: 'Account settings', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Review active sessions', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Remembered devices', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Forget device', exact: true })
    .click();
  await expect(
    page.getByText('No remembered devices.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Settings', exact: true })
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click();
  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await signIn(page, ownerEmail, ownerPassword);
  await expect(
    page.getByRole('heading', { name: 'Two-step verification', exact: true }),
  ).toBeVisible();
});
