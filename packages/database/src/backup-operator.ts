import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Client } from 'pg';
import {
  BackupError,
  decryptBackup,
  encryptBackup,
} from './backup-artifact.js';
import type { BackupManifest } from './backup-artifact.js';
import { createDatabase } from './index.js';

export interface BackupOperatorOptions {
  connectionString: string;
  installationId: string;
  key: Buffer;
  // This directory must be on private local storage. NTFS ACLs are applied before
  // writing plaintext; POSIX permissions alone do not secure a Windows directory.
  workDirectory: string;
  pgBinDirectory?: string;
  dockerContainer?: string;
}
function connection(options: BackupOperatorOptions, database?: string) {
  const url = new URL(options.connectionString);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.search ||
    url.hash
  )
    throw new BackupError(
      'Offline backup requires a loopback PostgreSQL connection without URL options.',
    );
  if (database) url.pathname = `/${database}`;
  return url;
}
export async function migrationDigest(prefixLength?: number) {
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  const hash = createHash('sha256');
  for (const name of (await readdir(dir))
    .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))
    .sort()
    .slice(0, prefixLength)) {
    hash.update(name);
    hash.update(await readFile(join(dir, name)));
  }
  return hash.digest('hex');
}
async function assertMigrationHistory(db: Client) {
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  const expected: string[] = [];
  for (const name of (await readdir(dir))
    .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))
    .sort())
    expected.push(
      createHash('sha256')
        .update(await readFile(join(dir, name)))
        .digest('hex'),
    );
  const applied = await db.query<{ hash: string }>(
    'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id',
  );
  if (
    applied.rows.length < 5 ||
    applied.rows.length > expected.length ||
    JSON.stringify(applied.rows.map((row) => row.hash)) !==
      JSON.stringify(expected.slice(0, applied.rows.length))
  )
    throw new BackupError(
      'Database migration history is not a supported Phase 5-or-later prefix of this release. Use the matching release to back up or restore.',
    );
  return migrationDigest(applied.rows.length);
}
async function supportedMigrationDigests() {
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  const count = (await readdir(dir)).filter((n) =>
    /^\d{4}_[a-z0-9_]+\.sql$/.test(n),
  ).length;
  return Promise.all(
    Array.from({ length: Math.max(0, count - 4) }, (_, i) =>
      migrationDigest(i + 5),
    ),
  );
}
async function removeWorkDirectory(parent: string, path: string) {
  const absolute = resolve(path);
  if (
    dirname(absolute) !== resolve(parent) ||
    !basename(absolute).startsWith('gst-operation-')
  )
    throw new BackupError(
      'Refusing cleanup outside the generated backup workspace.',
    );
  await rm(absolute, { recursive: true, force: true });
}
async function execute(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  files: { input?: string; output?: string } = {},
): Promise<string> {
  const child = spawn(executable, args, {
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 600000,
  });
  let diagnostic = '';
  let output = '',
    failed = false;
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (/service|PGSERVICE/.test(text)) diagnostic = 'service configuration';
    else if (/snapshot/i.test(text)) diagnostic = 'snapshot access';
    else if (/password|authentication/i.test(text))
      diagnostic = 'authentication';
    else if (/connect|connection/i.test(text)) diagnostic = 'connection';
    // Emit only fixed categories, never credential-bearing driver messages.
  });
  if (!files.output)
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 1048576) {
        failed = true;
        child.kill();
      }
    });
  const completed = new Promise<void>((resolve, reject) => {
    child.once('error', () =>
      reject(
        new BackupError(
          'Backup tool could not start. Check approved PostgreSQL/Docker tools.',
        ),
      ),
    );
    child.once('close', (code) =>
      code === 0 && !failed
        ? resolve()
        : reject(
            new BackupError(
              `Backup tool failed (${executable === 'docker' ? args.find((a) => a === 'pg_dump' || a === 'pg_restore') : 'PostgreSQL tool'}, exit ${code}, ${diagnostic || 'tool execution'}). Check PostgreSQL access, version, disk space and tool configuration.`,
            ),
          ),
    );
  });
  const transfer = Promise.all([
    files.input
      ? pipeline(createReadStream(files.input), child.stdin)
      : Promise.resolve(child.stdin.end()),
    files.output
      ? pipeline(
          child.stdout,
          createWriteStream(files.output, { flags: 'wx', mode: 0o600 }),
        )
      : Promise.resolve(),
  ]);
  try {
    await Promise.all([completed, transfer]);
    return output;
  } catch (error) {
    child.kill();
    await Promise.allSettled([completed, transfer]);
    throw error;
  }
}
async function privateWorkDirectory(parent: string) {
  // Creating the caller's root is harmless; every plaintext operation gets a new
  // protected child and cleanup never recursively removes caller-selected paths.
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const path = await mkdtemp(join(parent, 'gst-operation-'));
  if (process.platform === 'win32') {
    const script = `$ErrorActionPreference='Stop'; $p=$env:GST_BACKUP_WORK; $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; foreach($s in @($sid,[Security.Principal.SecurityIdentifier]'S-1-5-18',[Security.Principal.SecurityIdentifier]'S-1-5-32-544')) { $r=New-Object Security.AccessControl.FileSystemAccessRule($s,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($r) }; Set-Acl -LiteralPath $p -AclObject $acl`;
    try {
      await execute(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { ...process.env, GST_BACKUP_WORK: path },
      );
    } catch {
      await rm(path);
      throw new BackupError(
        'Cannot secure the backup workspace NTFS ACL; no plaintext archive was written.',
      );
    }
  } else await chmod(path, 0o700);
  return path;
}
async function tool(
  options: BackupOperatorOptions,
  name: 'pg_dump' | 'pg_restore',
  args: string[],
  files: { input?: string; output?: string },
  database?: string,
) {
  const url = connection(options, database);
  const pgEnv = {
    PGHOST: url.hostname === '[::1]' ? '::1' : url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '5',
    PGSSLMODE: 'disable',
  };
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^PG/i.test(name)),
  );
  if (options.dockerContainer) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(options.dockerContainer))
      throw new BackupError('Invalid Docker container name.');
    // Only the explicitly selected local PostgreSQL container is supported.
    // Password values are inherited via environment names, never argv.
    pgEnv.PGPORT = '5432';
    pgEnv.PGHOST = '127.0.0.1';
    return execute(
      'docker',
      [
        'exec',
        '-i',
        ...Object.keys(pgEnv).flatMap((k) => ['-e', k]),
        options.dockerContainer,
        name,
        ...args,
      ],
      { ...baseEnv, ...pgEnv },
      files,
    );
  }
  if (!options.pgBinDirectory)
    throw new BackupError(
      'Supply an approved PostgreSQL 18 binary directory or local Docker container.',
    );
  const executable = join(
    options.pgBinDirectory,
    `${name}${process.platform === 'win32' ? '.exe' : ''}`,
  );
  return execute(executable, args, { ...baseEnv, ...pgEnv }, files);
}
async function checkTools(options: BackupOperatorOptions) {
  for (const name of ['pg_dump', 'pg_restore'] as const)
    if (
      !/\(PostgreSQL\) 18\./.test(await tool(options, name, ['--version'], {}))
    )
      throw new BackupError(
        'PostgreSQL 18 dump and restore tools are required.',
      );
}
async function counts(client: Client): Promise<Record<string, number>> {
  const tables = await client.query<{ schemaname: string; tablename: string }>(
    "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public','drizzle') ORDER BY schemaname, tablename",
  );
  if (tables.rows.length > 200)
    throw new BackupError('Unexpected database schema size.');
  const result: Record<string, number> = {};
  for (const { schemaname, tablename } of tables.rows) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(tablename))
      throw new BackupError('Unsupported table identifier.');
    const count = await client.query<{ count: string }>(
      `SELECT count(*) FROM "${schemaname}"."${tablename}"`,
    );
    const value = Number(count.rows[0]!.count);
    if (!Number.isSafeInteger(value)) throw new BackupError();
    result[`${schemaname}.${tablename}`] = value;
  }
  return result;
}
function client(options: BackupOperatorOptions, database?: string) {
  return new Client({
    connectionString: connection(options, database).toString(),
    connectionTimeoutMillis: 5000,
    statement_timeout: 60000,
  });
}
export async function createEncryptedBackup(
  options: BackupOperatorOptions,
  target: string,
): Promise<BackupManifest> {
  await checkTools(options);
  const db = client(options);
  await db.connect();
  let work: string | undefined;
  try {
    if (
      Number(
        (await db.query('SHOW server_version_num')).rows[0].server_version_num,
      ) < 180000 ||
      Number(
        (await db.query('SHOW server_version_num')).rows[0].server_version_num,
      ) >= 190000
    )
      throw new BackupError('PostgreSQL 18 server required.');
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const schemaDigest = await assertMigrationHistory(db);
    const snapshot = String(
      (await db.query('SELECT pg_export_snapshot() AS snapshot')).rows[0]
        .snapshot,
    );
    const rowCounts = await counts(db);
    work = await privateWorkDirectory(options.workDirectory);
    const dump = join(work, 'database.dump');
    await tool(
      options,
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--no-password',
        `--snapshot=${snapshot}`,
      ],
      { output: dump },
    );
    await db.query('COMMIT');
    await tool(options, 'pg_restore', ['--list'], { input: dump });
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    return await encryptBackup(dump, target, options.key, {
      installationId: options.installationId,
      schemaDigest,
      rowCounts,
    });
  } finally {
    try {
      await db.end();
    } finally {
      if (work) await removeWorkDirectory(options.workDirectory, work);
    }
  }
}
export async function verifyRestore(
  options: BackupOperatorOptions,
  artifact: string,
) {
  await checkTools(options);
  const work = await privateWorkDirectory(options.workDirectory);
  const targetName = `gst_restore_${randomUUID().replaceAll('-', '')}`;
  const admin = client(options);
  let created = false;
  try {
    const dump = join(work, 'restore.dump');
    const metadata = await decryptBackup(artifact, dump, options.key, {
      installationId: options.installationId,
      schemaDigest: await supportedMigrationDigests(),
    });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${targetName}" TEMPLATE template0`);
    created = true;
    await tool(
      options,
      'pg_restore',
      [
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-privileges',
        '--no-password',
        `--dbname=${targetName}`,
      ],
      { input: dump },
      targetName,
    );
    const restored = client(options, targetName);
    await restored.connect();
    try {
      if ((await assertMigrationHistory(restored)) !== metadata.schemaDigest)
        throw new BackupError(
          'Restored schema does not match the authenticated manifest.',
        );
      if (
        JSON.stringify(await counts(restored)) !==
        JSON.stringify(metadata.rowCounts)
      )
        throw new BackupError(
          'Restored table counts do not match the backup snapshot.',
        );
    } finally {
      await restored.end();
    }
    const currentReleaseCompatible =
      metadata.schemaDigest === (await migrationDigest());
    if (currentReleaseCompatible) {
      const db = createDatabase(connection(options, targetName).toString());
      try {
        await db.ready();
      } finally {
        await db.close();
      }
    }
    return {
      verified: true,
      tables: Object.keys(metadata.rowCounts).length,
      createdAt: metadata.createdAt,
      schemaDigest: metadata.schemaDigest,
      currentReleaseCompatible,
      verificationDatabase: targetName,
    };
  } finally {
    try {
      if (created)
        await admin.query(`DROP DATABASE "${targetName}" WITH (FORCE)`);
    } finally {
      await admin.end();
      await removeWorkDirectory(options.workDirectory, work);
    }
  }
}
