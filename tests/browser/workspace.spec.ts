// Frontend interaction tests use synthetic API responses and the real built UI.
// They do not connect to a configured workspace or modify a real database.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { permissionKeys } from '../../packages/contracts/src/index.js';
import type { Permission } from '../../packages/contracts/src/index.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
let server: ReturnType<typeof createServer>, origin: string;
test.beforeAll(async () => {
  const root = resolve('apps/web/dist');
  server = createServer(async (request, response) => {
    try {
      const path = resolve(
        root,
        '.' +
          decodeURIComponent(
            new URL(request.url ?? '/', 'http://localhost').pathname,
          ),
      );
      if (path !== root && !path.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
      }
      const asset = path === root ? resolve(root, 'index.html') : path;
      const content = await readFile(asset);
      response
        .writeHead(200, {
          'Content-Type': asset.endsWith('.js')
            ? 'text/javascript'
            : asset.endsWith('.css')
              ? 'text/css'
              : 'text/html',
        })
        .end(content);
    } catch {
      response.writeHead(404).end();
    }
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test server');
  origin = 'http://127.0.0.1:' + address.port;
});
test.afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>((done, reject) =>
    server?.close((error) => (error ? reject(error) : done())),
  );
});

test('all theme palettes keep normal text and active controls readable', async ({
  page,
}) => {
  await workspace(page);
  const results = await page.evaluate(() => {
    const root = document.documentElement;
    const previous = { theme: root.dataset.theme, accent: root.dataset.accent };
    const probe = document.createElement('section');
    probe.className = 'surface';
    probe.innerHTML =
      '<h2>Heading</h2><p class="muted">Supporting text</p><button class="button button-primary">Primary action</button><button class="secondary">Secondary action</button><input aria-label="Contrast probe" value="Input text"><p class="error">Error message</p><span class="badge badge-green">Success</span><span class="badge badge-amber">Warning</span><span class="badge badge-blue">Information</span>';
    document.body.append(probe);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const luminance = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const rgb = Array.from(context.getImageData(0, 0, 1, 1).data)
        .slice(0, 3)
        .map((channel) => {
          const v = channel / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
      return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
    };
    const values: {
      mode: string;
      accent: string;
      element: string;
      contrast: number;
    }[] = [];
    try {
      for (const mode of ['light', 'dark'])
        for (const accent of ['teal', 'blue', 'violet']) {
          root.dataset.theme = mode;
          root.dataset.accent = accent;
          const surface = getComputedStyle(probe).backgroundColor;
          for (const element of Array.from(probe.children)) {
            const style = getComputedStyle(element);
            const background =
              style.backgroundColor === 'rgba(0, 0, 0, 0)'
                ? surface
                : style.backgroundColor;
            const first = luminance(style.color),
              second = luminance(background);
            values.push({
              mode,
              accent,
              element: element.className || element.tagName,
              contrast:
                (Math.max(first, second) + 0.05) /
                (Math.min(first, second) + 0.05),
            });
          }
          const sidebar = document.querySelector('.sidebar')!;
          const navigationBackground =
            getComputedStyle(sidebar).backgroundColor;
          for (const element of sidebar.querySelectorAll(
            '.brand, .brand small, .primary-navigation a, .account-identity strong, .account-identity small',
          )) {
            const style = getComputedStyle(element);
            const background =
              style.backgroundColor === 'rgba(0, 0, 0, 0)'
                ? navigationBackground
                : style.backgroundColor;
            const first = luminance(style.color),
              second = luminance(background);
            values.push({
              mode,
              accent,
              element: 'Sidebar: ' + element.textContent?.trim(),
              contrast:
                (Math.max(first, second) + 0.05) /
                (Math.min(first, second) + 0.05),
            });
          }
        }
    } finally {
      probe.remove();
      if (previous.theme) root.dataset.theme = previous.theme;
      else delete root.dataset.theme;
      if (previous.accent) root.dataset.accent = previous.accent;
      else delete root.dataset.accent;
    }
    return values;
  });
  expect(results.filter((result) => result.contrast < 4.5)).toEqual([]);
});

async function workspace(
  page: Page,
  permissions: Permission[] = [...permissionKeys],
) {
  let saved: Record<string, unknown> | undefined;
  const unexpected: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace('/api/v1', '');
    let result: unknown;
    if (path === '/health')
      result = { status: 'ok', service: 'gst-api', apiVersion: '1' };
    else if (path === '/health/ready')
      result = { status: 'ready', database: 'up' };
    else if (path === '/auth/session')
      result = {
        user: { id: userId, name: 'Aarav Sharma', email: 'owner@example.test' },
        csrfToken: 'a'.repeat(64),
        mustChangePassword: false,
        mfaRequired: false,
        mfaMandatory: false,
        mfaEnabled: true,
      };
    else if (path === '/organizations')
      result = [
        { id: organizationId, name: 'Aster Trading Co.', isOwner: true },
      ];
    else if (
      path === '/organizations/invitations' ||
      path === '/auth/sessions' ||
      path === '/auth/trusted-devices'
    )
      result = [];
    else if (path === '/organizations/' + organizationId)
      result = {
        organization: { id: organizationId, name: 'Aster Trading Co.' },
        access: {
          isOwner: true,
          membershipId: userId,
          permissions,
          delegable: permissions,
        },
        permissionCatalog: permissionKeys,
      };
    else if (/\/(roles|members|audit)$/.test(path)) result = [];
    else if (path.endsWith('/business-profile')) {
      if (request.method() === 'PUT') {
        saved = request.postDataJSON() as Record<string, unknown>;
        result = {
          ...saved,
          version: 1,
          registrationId: organizationId,
          registrationConfirmedAt: null,
          updatedAt: new Date().toISOString(),
        };
      } else result = { profile: null };
    } else if (/\/(customers|catalog|invoices)$/.test(path))
      result = { items: [], hasMore: false };
    else {
      unexpected.push(path);
      await route.fulfill({
        status: 404,
        json: { error: { message: 'Unmocked request' } },
      });
      return;
    }
    await route.fulfill({ json: result });
  });
  await page.goto(origin);
  await expect(
    page.getByRole('heading', { name: 'Workspace overview', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.overview-intro')).toBeVisible();
  return { saved: () => saved, unexpected };
}

test('desktop uses compact navigation, a persistent icon rail and one page action area', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const fixture = await workspace(page);
  const nav = page.getByRole('navigation', {
    name: 'Workspace navigation',
    exact: true,
  });
  await expect(nav.getByRole('link')).toHaveText([
    'Overview',
    'Invoices',
    'Customers',
    'Catalog',
    'Business settings',
  ]);
  await expect(
    page.getByRole('link', { name: 'Account security', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'System status', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('workspace-desktop.png'),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({
    path: testInfo.outputPath('workspace-neutral-dark.png'),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page
    .getByRole('button', { name: 'Collapse sidebar', exact: true })
    .click();
  await expect(page.locator('.sidebar').first()).toHaveCSS('width', '72px');
  await nav.getByRole('link', { name: 'Customers', exact: true }).focus();
  await expect(
    page.getByRole('tooltip', { name: 'Customers', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('workspace-collapsed.png'),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({
    path: testInfo.outputPath('workspace-collapsed-dark.png'),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await nav.getByRole('link', { name: 'Invoices', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Invoices', exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('navigation', { name: 'Sales & billing sections' }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page).toHaveURL(/#\/invoices$/);
  await page.getByRole('button', { name: 'New invoice', exact: true }).click();
  const sections = page.getByRole('navigation', { name: 'Invoice sections' });
  await sections.getByRole('button', { name: 'Review & save' }).click();
  await expect(page.locator('#invoice-summary')).toBeFocused();
  await sections.getByRole('button', { name: 'Items & pricing' }).click();
  await expect(page.locator('#invoice-items')).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('invoice-editor-desktop.png'),
    fullPage: true,
  });
  await nav.getByRole('link', { name: 'Customers', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Customers', exact: true, level: 1 }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1680, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('customers-wide.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Invoices', exact: true, level: 1 }),
  ).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});

test('business settings preserve complete form submissions and protect unsaved changes', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await workspace(page);
  const nav = page.getByRole('navigation', {
    name: 'Workspace navigation',
    exact: true,
  });
  await nav
    .getByRole('link', { name: 'Business settings', exact: true })
    .click();
  await expect(
    page
      .getByRole('navigation', { name: 'Business settings sections' })
      .getByRole('link'),
  ).toHaveText([
    'Business setup',
    'Members',
    'Roles & permissions',
    'Activity log',
  ]);
  await page
    .getByLabel('Legal business name', { exact: true })
    .fill('Aster Trading Co.');
  page.once('dialog', (dialog) => void dialog.dismiss());
  await nav.getByRole('link', { name: 'Customers', exact: true }).click();
  await expect(
    page.getByLabel('Legal business name', { exact: true }),
  ).toHaveValue('Aster Trading Co.');
  await page
    .getByLabel('Address line 1', { exact: true })
    .fill('10 Market Road');
  await page.getByLabel('City', { exact: true }).fill('Pune');
  await page
    .getByLabel('State / territory', { exact: true })
    .selectOption('27');
  await page.getByLabel('PIN code', { exact: true }).fill('411001');
  await page.getByLabel('GSTIN', { exact: true }).fill('27AAPFU0939F1ZV');
  const jump = page
    .getByRole('navigation', { name: 'Business setup sections' })
    .getByRole('button', { name: 'GST registration' });
  await jump.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#business-tax')).toBeFocused();
  await page.getByText('Bank details (optional)', { exact: true }).click();
  await page.getByLabel('Bank name', { exact: true }).fill('Example Bank');
  await page
    .getByRole('button', { name: 'Save business details', exact: true })
    .click();
  await expect(
    page.getByText('Business details saved.', { exact: true }),
  ).toBeVisible();
  expect(fixture.saved()).toMatchObject({
    legalName: 'Aster Trading Co.',
    gstin: '27AAPFU0939F1ZV',
    bankName: 'Example Bank',
    address: { line1: '10 Market Road', city: 'Pune', stateCode: '27' },
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('business-setup-desktop.png'),
    fullPage: true,
  });
  expect(fixture.unexpected).toEqual([]);
});

test('account modal preserves the invoice editor and supports keyboard menu, tabs and dirty-input cancellation', async ({
  page,
}, testInfo) => {
  const fixture = await workspace(page);
  await page
    .getByRole('navigation', { name: 'Workspace navigation', exact: true })
    .getByRole('link', { name: 'Invoices', exact: true })
    .click();
  await page.getByRole('button', { name: 'New invoice', exact: true }).click();
  await page.getByLabel('Notes', { exact: true }).fill('Unsaved billing work');
  const trigger = page.getByRole('button', { name: /^Account menu for/ });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('menuitem', { name: 'Account settings', exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath('account-menu-desktop.png'),
    fullPage: false,
  });
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  const underlyingScroll = await page.evaluate(() => window.scrollY);
  await page.mouse.move(10, 10);
  await page.mouse.wheel(0, 500);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBe(underlyingScroll);

  await expect(
    dialog.getByRole('button', { name: 'Change password', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('account-settings-desktop.png'),
    fullPage: false,
  });
  await dialog
    .getByRole('tab', { name: 'Account security', exact: true })
    .focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    dialog.getByRole('tab', { name: 'System status', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    dialog.getByRole('heading', { name: 'Connection status' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
    'Unsaved billing work',
  );
  await trigger.click();
  await page
    .getByRole('menuitem', { name: 'Account settings', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Change password', exact: true })
    .click();
  await dialog
    .getByLabel('Current password', { exact: true })
    .fill('Unsaved secret');
  page.once('dialog', (prompt) => void prompt.dismiss());
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByLabel('Current password', { exact: true }),
  ).toHaveValue('Unsaved secret');
  page.once('dialog', (prompt) => void prompt.dismiss());
  await dialog.getByRole('tab', { name: 'System status', exact: true }).click();
  await expect(
    dialog.getByLabel('Current password', { exact: true }),
  ).toHaveValue('Unsaved secret');
  page.once('dialog', (prompt) => void prompt.accept());
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
    'Unsaved billing work',
  );
  expect(fixture.unexpected).toEqual([]);
});

test('mobile drawer retains labels and opens full-screen settings without nested dialogs', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('workspace-mobile.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Open navigation', exact: true })
    .click();
  const navigation = page.getByRole('dialog', {
    name: 'Navigation',
    exact: true,
  });
  await expect(
    navigation.getByRole('link', { name: 'Business settings', exact: true }),
  ).toBeVisible();
  await navigation.getByRole('button', { name: /^Account menu for/ }).click();
  await navigation
    .getByRole('menuitem', { name: 'System status', exact: true })
    .click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(navigation).toHaveCount(0);
  await expect(settings).toBeVisible();
  await expect(settings).toHaveCSS('width', '390px');
  await expect(settings).toHaveCSS('height', '844px');
  await page.screenshot({
    path: testInfo.outputPath('account-settings-mobile.png'),
    fullPage: false,
  });
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Open navigation', exact: true }),
  ).toBeFocused();
  await page
    .getByRole('button', { name: 'Open navigation', exact: true })
    .click();
  await navigation.getByRole('link', { name: 'Catalog', exact: true }).click();
  await expect(navigation).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Catalog', exact: true, level: 1 }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(page).toHaveURL(/#\/catalog\/new$/);
  await expect(page.locator('.record-page')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to list', exact: true }).click();
  await expect(page).toHaveURL(/#\/catalog$/);
});

test('restricted permissions filter settings tabs and legacy account hashes open the modal', async ({
  page,
}) => {
  await workspace(page, ['organization.read', 'customers.read']);
  const nav = page.getByRole('navigation', {
    name: 'Workspace navigation',
    exact: true,
  });
  await expect(nav.getByRole('link')).toHaveText([
    'Overview',
    'Customers',
    'Business settings',
  ]);
  await nav
    .getByRole('link', { name: 'Business settings', exact: true })
    .click();
  await expect(
    page
      .getByRole('navigation', { name: 'Business settings sections' })
      .getByRole('link'),
  ).toHaveText(['Business setup']);
  await page.goto(origin + '/#/roles');
  await expect(
    page.getByRole('heading', { name: 'Workspace overview', exact: true }),
  ).toBeVisible();
  await nav.getByRole('link', { name: 'Customers', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Add customer', exact: true }),
  ).toHaveCount(0);
  await page.goto(origin + '/#/system');
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(
    settings.getByRole('tab', { name: 'System status' }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('heading', { name: 'Customers', exact: true, level: 1 }),
  ).toBeVisible();
});

test('recent-document errors can be retried and unavailable preference storage does not break navigation', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Storage unavailable', 'SecurityError');
      },
    }),
  );
  let fail = true;
  await page.route('**/api/v1/organizations/*/invoices?offset=0', (route) =>
    route.fulfill(
      fail
        ? { status: 503, json: { error: { message: 'Temporary failure' } } }
        : { json: { items: [], hasMore: false } },
    ),
  );
  // Register the general fixture first, then override this one read.
  await workspace(page);
  await page.route('**/api/v1/organizations/*/invoices?offset=0', (route) =>
    route.fulfill(
      fail
        ? { status: 503, json: { error: { message: 'Temporary failure' } } }
        : { json: { items: [], hasMore: false } },
    ),
  );
  await page.reload();
  await expect(
    page.getByText('Recent documents could not be loaded.', { exact: true }),
  ).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Ready for your first document',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Collapse sidebar', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Expand sidebar', exact: true }),
  ).toBeVisible();
});

test('invalid and unavailable record links preserve their URL and offer recovery', async ({
  page,
}) => {
  const { unexpected } = await workspace(page);
  await page.goto(origin + '/#/customers/not-an-id');
  await expect(page.getByRole('alert')).toContainText('record link is invalid');
  await expect(page).toHaveURL(/#\/customers\/not-an-id$/);
  await page.getByRole('button', { name: 'Back to list', exact: true }).click();
  await expect(page).toHaveURL(/#\/customers$/);
  const id = '33333333-3333-4333-8333-333333333333';
  await page.route('**/api/v1/organizations/*/catalog/' + id, (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Not found' } },
    }),
  );
  await page.goto(origin + '/#/catalog/' + id);
  await expect(page.getByRole('alert')).toContainText(
    'record could not be loaded',
  );
  await expect(page).toHaveURL(new RegExp('#/catalog/' + id + '$'));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'record could not be loaded',
  );
  expect(unexpected).toEqual([]);
});
