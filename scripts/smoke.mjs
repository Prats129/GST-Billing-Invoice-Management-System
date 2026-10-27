import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Run only against a migrated development database; never changes business rows.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve())),
);
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: String(port),
  APP_ORIGIN: origin,
  ALLOWED_HOSTS: `127.0.0.1:${port}`,
  WEB_ROOT: fileURLToPath(new URL('../apps/web/dist', import.meta.url)),
};
delete env.TLS_KEY_PATH;
delete env.TLS_CERT_PATH;
const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
  env,
  stdio: 'ignore',
  windowsHide: true,
});
let exited = false;
let spawnError;
child.once('exit', () => {
  exited = true;
});
child.once('error', (error) => {
  spawnError = error;
});
try {
  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError) throw spawnError;
    if (exited) throw new Error('Compiled API exited before becoming live');
    try {
      health = await fetch(`${origin}/api/v1/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (health.ok) break;
    } catch {
      /* Retry bounded startup; no raw connection error logging. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(health?.status, 200, 'compiled API liveness');
  assert.deepEqual(await health.json(), {
    status: 'ok',
    service: 'gst-api',
    apiVersion: '1',
  });
  const ready = await fetch(`${origin}/api/v1/health/ready`);
  assert.equal(ready.status, 200, 'migrated database readiness');
  const html = await fetch(origin);
  assert.equal(html.status, 200, 'built frontend served');
  const markup = await html.text();
  const asset = markup.match(/src="([^"]+\.js)"/)[1];
  const javascript = await fetch(`${origin}${asset}`);
  assert.equal(javascript.status, 200, 'frontend JavaScript asset');
  assert.match(await javascript.text(), /\/api\/v1\/health/);
  const openapi = await fetch(`${origin}/api/openapi.json`);
  assert.ok((await openapi.json()).paths['/api/v1/health']);
  const forbidden = await fetch(`${origin}/api/v1/health`, {
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.equal(forbidden.status, 403);
  console.log(
    'PASS: compiled frontend/assets, live API, real database readiness, OpenAPI and Origin rejection.',
  );
  if (process.env.BROWSER_PATH) {
    const profile = fileURLToPath(
      new URL(`../.local/browser-smoke-${randomUUID()}`, import.meta.url),
    );
    const { stdout } = await promisify(execFile)(
      process.env.BROWSER_PATH,
      [
        '--headless',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-component-update',
        `--user-data-dir=${profile}`,
        '--dump-dom',
        '--virtual-time-budget=10000',
        origin,
      ],
      { windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
    );
    assert.match(stdout, /<dd>Connected<\/dd>/, 'browser frontend reaches API');
    assert.match(
      stdout,
      /<dd>Ready<\/dd>/,
      'browser frontend reaches migrated database',
    );
    console.log(
      'PASS: headless browser rendered API Connected and PostgreSQL Ready.',
    );
  }
} finally {
  if (!exited && child.pid) {
    const closed = once(child, 'exit');
    child.kill('SIGTERM');
    await closed;
  }
}
