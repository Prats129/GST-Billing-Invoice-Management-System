import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inspectReleaseFiles } from '../../apps/api/src/operations/release-package.js';
import { assertPrivateDirectory } from '../../apps/api/src/operations/release-staging.js';

export async function smokeWindowsBundle(
  outputDirectory: string,
  databaseUrl?: string,
) {
  const output = resolve(outputDirectory),
    app = join(output, 'bundle', 'app');
  await assertPrivateDirectory(output);
  const report = JSON.parse(
    await readFile(join(output, 'build-report.json'), 'utf8'),
  );
  const inventory = await inspectReleaseFiles(app);
  if (
    createHash('sha256').update(JSON.stringify(inventory)).digest('hex') !==
    report.applicationInventorySha256
  )
    throw new Error('Locally built runtime changed; do not execute it.');
  // Block ALL module resolution outside the assembled runtime, including CJS
  // requires. Otherwise a candidate below the checkout could silently use the
  // developer node_modules and make an incomplete package look self-contained.
  const loader = `import{registerHooks}from'node:module';import{fileURLToPath}from'node:url';import{relative,isAbsolute,sep}from'node:path';const root=process.env.GST_BUNDLE_ROOT;registerHooks({resolve(specifier,context,next){const r=next(specifier,context);if(r.url.startsWith('file:')){const p=relative(root,fileURLToPath(r.url));if(isAbsolute(p)||p==='..'||p.startsWith('..'+sep))throw new Error('Packaged dependency escaped runtime');}return r;}});`;
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error();
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  const origin = 'http://127.0.0.1:' + port,
    system = process.env.SystemRoot ?? 'C:\\Windows';
  const child = spawn(
    process.execPath,
    [
      '--import',
      'data:text/javascript,' + encodeURIComponent(loader),
      join(app, 'apps', 'api', 'dist', 'main.js'),
    ],
    {
      cwd: app,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      env: {
        SystemRoot: system,
        WINDIR: system,
        PATH: join(system, 'System32'),
        GST_BUNDLE_ROOT: app,
        NODE_ENV: 'development',
        DEPLOYMENT_EDITION: 'offline',
        HOST: '127.0.0.1',
        PORT: String(port),
        APP_ORIGIN: origin,
        ALLOWED_HOSTS: '127.0.0.1:' + port,
        WEB_ROOT: join(app, 'apps', 'web', 'dist'),
        ENV_FILE: join(output, 'no-environment-file'),
        DATABASE_URL:
          databaseUrl ?? 'postgresql://probe:unused@127.0.0.1:1/probe',
      },
    },
  );
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  let error: Error | undefined;
  child.once('error', (e) => {
    error = e;
  });
  try {
    let live = false;
    for (let attempt = 0; attempt < 300; attempt++) {
      if (error || exited) throw new Error('Packaged API failed to start.');
      try {
        const response = await fetch(origin + '/api/v1/health', {
          signal: AbortSignal.timeout(1000),
        });
        if (response.status === 200) {
          const v = await response.json();
          if (v.status === 'ok' && v.service === 'gst-api') {
            live = true;
            break;
          }
        }
      } catch {
        // The temporary server may still be starting; retry within the bound.
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!live) throw new Error('Packaged API startup timed out.');
    const front = await fetch(origin),
      html = await front.text();
    if (front.status !== 200 || !html.includes('id="root"'))
      throw new Error('Packaged frontend missing.');
    const asset = html.match(/src="([^"]+\.js)"/)?.[1];
    if (!asset || (await fetch(origin + asset)).status !== 200)
      throw new Error('Packaged frontend asset missing.');
    const ready = await fetch(origin + '/api/v1/health/ready');
    if (ready.status !== (databaseUrl ? 200 : 503))
      throw new Error('Unexpected packaged database readiness.');
    if (
      (
        await fetch(origin + '/api/v1/health', {
          headers: { Origin: 'https://untrusted.example' },
        })
      ).status !== 403
    )
      throw new Error('Packaged Origin guard failed.');
    return {
      api: true,
      frontend: true,
      assets: true,
      dependencyIsolation: true,
      nativeAddonLoaded: true,
      database: databaseUrl ? 'ready' : 'unavailable-as-expected',
    };
  } finally {
    if (!exited && child.pid) {
      const closed = once(child, 'exit');
      child.kill();
      await closed;
    }
  }
}
