// Publisher-only portable runtime assembly. Never invokes npm/pnpm install or
// lifecycle scripts, and never copies the developer node_modules link forest.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  readFile,
  readdir,
  realpath,
  mkdir,
  copyFile,
  writeFile,
} from 'node:fs/promises';
import { join, relative, isAbsolute, resolve, sep } from 'node:path';

type Manifest = {
  name: string;
  version: string;
  type?: string;
  main?: string;
  exports?: unknown;
  license?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
type Package = {
  source: string;
  manifest: Manifest;
  manifestSha256: string;
  workspace: boolean;
  edges: Map<string, Package>;
};
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const inside = (root: string, path: string) => {
  const r = relative(root, path);
  return (
    r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep))
  );
};
export async function fileHash(path: string) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
async function manifest(path: string) {
  const stat = await lstat(join(path, 'package.json'));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144)
    throw new Error('Invalid package metadata.');
  const bytes = await readFile(join(path, 'package.json'));
  if (bytes.length > 262144) throw new Error('Oversized package metadata.');
  const value = JSON.parse(bytes.toString('utf8')) as Manifest;
  if (!packageName.test(value.name) || typeof value.version !== 'string')
    throw new Error('Invalid package identity.');
  return { value, sha256: createHash('sha256').update(bytes).digest('hex') };
}
async function resolveDependency(
  parent: string,
  name: string,
  repository: string,
) {
  if (!packageName.test(name)) throw new Error('Invalid dependency name.');
  for (const base of createRequire(join(parent, 'package.json')).resolve.paths(
    name,
  ) ?? []) {
    const path = join(base, ...name.split('/'));
    try {
      const found = await realpath(path);
      if (!inside(repository, found))
        throw new Error('Dependency escaped the reviewed repository.');
      return found;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return undefined;
}
const ignoredDirectories = new Set([
  'node_modules',
  '.git',
  '.github',
  '.cache',
  'coverage',
  'test',
  'tests',
  '__tests__',
  'examples',
  'benchmark',
  'benchmarks',
]);
function runtimeFile(path: string) {
  if (/(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|pfx|p12|dump|gstbackup)$/i.test(path))
    throw new Error('Private-looking data in a runtime package.');
  return !/\.(?:map|ts|mts|cts|tsx|cpp|c|h|hpp|gyp|sln|vcxproj)$/i.test(path);
}
async function copyTree(
  source: string,
  target: string,
  filter: (path: string) => boolean,
  prefix = '',
) {
  const info = await lstat(source);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Runtime source must be an ordinary directory.');
  await mkdir(target, { recursive: true });
  for (const name of (await readdir(source)).sort()) {
    const path = prefix ? prefix + '/' + name : name;
    if (ignoredDirectories.has(name) || !filter(path)) continue;
    const from = join(source, name),
      to = join(target, name),
      stat = await lstat(from);
    if (stat.isSymbolicLink())
      throw new Error('Unexpected link inside a package.');
    if (stat.isDirectory()) await copyTree(from, to, filter, path);
    else if (stat.isFile()) {
      if (!runtimeFile(path)) continue;
      const before = await fileHash(from);
      await copyFile(from, to, 1);
      if ((await fileHash(to)) !== before || (await fileHash(from)) !== before)
        throw new Error('Runtime input changed during assembly.');
    } else throw new Error('Unsupported runtime entry.');
  }
}
export async function assembleWindowsRuntime(
  repositoryRoot: string,
  output: string,
  version: string,
) {
  const repository = await realpath(repositoryRoot);
  if (
    inside(repository, output) &&
    !inside(join(repository, '.local'), resolve(output))
  )
    throw new Error('Use isolated output outside source files.');
  await mkdir(output); // No overwrite or reuse of a partial result.
  const nodes = new Map<string, Package>();
  const read = async (path: string): Promise<Package> => {
    path = await realpath(path);
    const old = nodes.get(path);
    if (old) return old;
    if (!inside(repository, path))
      throw new Error('Package source escaped repository.');
    const sourceManifest = await manifest(path);
    const item: Package = {
      source: path,
      manifest: sourceManifest.value,
      manifestSha256: sourceManifest.sha256,
      workspace:
        inside(join(repository, 'packages'), path) ||
        path === join(repository, 'apps', 'api'),
      edges: new Map(),
    };
    nodes.set(path, item);
    const specs = new Map<string, { optional: boolean }>();
    for (const name of Object.keys(item.manifest.dependencies ?? {}))
      specs.set(name, { optional: false });
    for (const name of Object.keys(item.manifest.optionalDependencies ?? {}))
      specs.set(name, { optional: true });
    for (const name of Object.keys(item.manifest.peerDependencies ?? {}))
      if (!specs.has(name))
        specs.set(name, {
          optional:
            item.manifest.peerDependenciesMeta?.[name]?.optional === true,
        });
    for (const [name, options] of [...specs].sort(([a], [b]) =>
      a.localeCompare(b, 'en'),
    )) {
      const root = await resolveDependency(path, name, repository);
      if (!root) {
        if (options.optional) continue;
        throw new Error('Missing production dependency: ' + name);
      }
      const child = await read(root);
      if (child.manifest.name !== name)
        throw new Error('Dependency alias needs explicit publisher review.');
      item.edges.set(name, child);
    }
    return item;
  };
  const api = await read(join(repository, 'apps', 'api'));
  const workspaces = [];
  for (const name of [
    'contracts',
    'database',
    'billing-engine',
    'invoice-renderer',
  ])
    workspaces.push(await read(join(repository, 'packages', name)));
  const globals = new Map<string, Package>();
  for (const node of nodes.values())
    if (node !== api && !globals.has(node.manifest.name))
      globals.set(node.manifest.name, node);
  const occurrences = new Map<string, Package>(),
    locations = new Map<string, string[]>();
  for (const [name, node] of globals)
    occurrences.set(join(output, 'node_modules', ...name.split('/')), node);
  occurrences.set(join(output, 'apps', 'api'), api);
  for (const node of workspaces)
    occurrences.set(
      join(output, 'packages', node.manifest.name.slice('@gst/'.length)),
      node,
    );
  const copied = new Set<string>();
  const copy = async (
    node: Package,
    destination: string,
    depth = 0,
  ): Promise<void> => {
    if (copied.has(destination)) return;
    if (depth > 20 || copied.size > 1000)
      throw new Error('Dependency layout exceeds reviewed bounds.');
    copied.add(destination);
    if (node.workspace) {
      await mkdir(destination, { recursive: true });
      await copyTree(
        join(node.source, 'dist'),
        join(destination, 'dist'),
        () => true,
      );
      if (node.manifest.name === '@gst/database')
        await copyTree(
          join(node.source, 'migrations'),
          join(destination, 'migrations'),
          () => true,
        );
      const {
        name,
        version,
        type,
        main,
        exports: exportsMap,
        dependencies,
        license,
      } = node.manifest;
      await writeFile(
        join(destination, 'package.json'),
        JSON.stringify({
          name,
          version,
          type,
          main,
          exports: exportsMap,
          dependencies,
          license,
        }) + '\n',
        { flag: 'wx' },
      );
    } else
      await copyTree(
        node.source,
        destination,
        (path) =>
          !path.startsWith('prebuilds/') ||
          path === 'prebuilds/win32-x64' ||
          path.startsWith('prebuilds/win32-x64/'),
      );
    const rows = locations.get(node.source) ?? [];
    rows.push(relative(output, destination).split(sep).join('/'));
    locations.set(node.source, rows);
    for (const [name, child] of node.edges) {
      let visible: Package | undefined;
      for (const base of createRequire(
        join(destination, 'package.json'),
      ).resolve.paths(name) ?? []) {
        const found = occurrences.get(join(base, ...name.split('/')));
        if (found) {
          visible = found;
          break;
        }
      }
      if (visible?.source === child.source) continue;
      const nested = join(destination, 'node_modules', ...name.split('/'));
      occurrences.set(nested, child);
      await copy(child, nested, depth + 1);
    }
  };
  for (const [path, node] of [...occurrences]) await copy(node, path);
  await mkdir(join(output, 'apps', 'web'), { recursive: true });
  await copyTree(
    join(repository, 'apps', 'web', 'dist'),
    join(output, 'apps', 'web', 'dist'),
    () => true,
  );
  // The browser bundle embeds packages which are absent from the API runtime.
  // Preserve their full license/NOTICE texts rather than relying on minified
  // banners or a package.json license identifier.
  const web = await read(join(repository, 'apps', 'web'));
  const visited = new Set<Package>();
  const visit = (node: Package) => {
    if (visited.has(node)) return;
    visited.add(node);
    for (const child of node.edges.values()) visit(child);
  };
  visit(web);
  const frontendNotices = [];
  for (const node of [...visited]
    .filter((n) => n !== web && !n.workspace)
    .sort(
      (a, b) =>
        a.manifest.name.localeCompare(b.manifest.name, 'en') ||
        a.manifest.version.localeCompare(b.manifest.version, 'en'),
    )) {
    const names = (await readdir(node.source)).filter((name) =>
      /^(?:licen[cs]e|copying|notice|copyright)(?:[.-].*)?$/i.test(name),
    );
    if (!names.length)
      throw new Error(
        'Frontend dependency license text missing: ' + node.manifest.name,
      );
    const directory = join(
      output,
      'notices',
      'frontend',
      'package-' + String(frontendNotices.length + 1).padStart(4, '0'),
    );
    await copyTree(node.source, directory, (path) => names.includes(path));
    const files = [];
    for (const name of names.sort()) {
      const target = join(directory, name);
      if (!(await lstat(target)).isFile())
        throw new Error('Frontend license must be an ordinary text file.');
      files.push({
        path: relative(output, target).split(sep).join('/'),
        sha256: await fileHash(target),
      });
    }
    frontendNotices.push({
      name: node.manifest.name,
      version: node.manifest.version,
      license: node.manifest.license ?? null,
      files,
    });
  }
  for (const node of visited)
    if (
      (await fileHash(join(node.source, 'package.json'))) !==
      node.manifestSha256
    )
      throw new Error('Frontend dependency metadata changed during assembly.');
  await writeFile(
    join(output, 'frontend-notices.json'),
    JSON.stringify({ format: 1, packages: frontendNotices }, null, 2) + '\n',
    { flag: 'wx' },
  );
  await writeFile(
    join(output, 'package.json'),
    JSON.stringify({
      name: 'gst-offline-runtime',
      version,
      private: true,
      type: 'module',
    }) + '\n',
    { flag: 'wx' },
  );
  const packages = [...nodes.values()]
    .filter((node) => locations.has(node.source))
    .map((node) => ({
      name: node.manifest.name,
      version: node.manifest.version,
      license: node.manifest.license ?? null,
      packageJsonSha256: undefined as string | undefined,
      locations: locations.get(node.source)!.sort(),
    }));
  for (const row of packages) {
    const node = [...nodes.values()].find(
      (p) =>
        p.manifest.name === row.name &&
        p.manifest.version === row.version &&
        locations.get(p.source)?.includes(row.locations[0]!),
    )!;
    row.packageJsonSha256 = await fileHash(join(node.source, 'package.json'));
    if (row.packageJsonSha256 !== node.manifestSha256)
      throw new Error('Package metadata changed during assembly.');
  }
  const report = {
    format: 1,
    target: 'win32-x64',
    lockSha256: await fileHash(join(repository, 'pnpm-lock.yaml')),
    packages,
  };
  await writeFile(
    join(output, 'runtime-packages.json'),
    JSON.stringify(report, null, 2) + '\n',
    { flag: 'wx' },
  );
  return report;
}
