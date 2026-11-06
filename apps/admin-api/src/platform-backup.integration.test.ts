import { expect, test } from 'vitest';
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client, store, migratePlatform, rows } from './store.js';
// Real pg_dump/pg_restore drill, using only randomly named isolated databases.
test.skipIf(
  !process.env.TEST_DATABASE_ADMIN_URL ||
    !process.env.TEST_BACKUP_DOCKER_CONTAINER,
)(
  'platform backup restores history with operations explicitly quarantined',
  async () => {
    const authority = process.env.TEST_DATABASE_ADMIN_URL!,
      container = process.env.TEST_BACKUP_DOCKER_CONTAINER!;
    const source = 'gst_platform_backup_' + randomUUID().replaceAll('-', ''),
      target = 'gst_platform_restore_' + randomUUID().replaceAll('-', '');
    const root = new Client({ connectionString: authority });
    await root.connect();
    let sourceDb: ReturnType<typeof store> | undefined,
      targetDb: ReturnType<typeof store> | undefined;
    const run = (command: string, args: string[], input?: Buffer) =>
      new Promise<Buffer>((resolve, reject) => {
        const child = spawn(command, args, {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const output: Buffer[] = [];
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('Database drill timed out'));
        }, 30000);
        child.stdout.on('data', (b: Buffer) => output.push(b));
        child.stderr.on('data', () => {});
        child.once('error', () => {
          clearTimeout(timer);
          reject(new Error('Database drill process failed'));
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve(Buffer.concat(output));
          else reject(new Error('Database drill failed'));
        });
        child.stdin.end(input);
      });
    try {
      await root.query('CREATE DATABASE "' + source + '"');
      await root.query('CREATE DATABASE "' + target + '"');
      const url = new URL(authority),
        user = decodeURIComponent(url.username);
      url.pathname = '/' + source;
      sourceDb = store(url.toString());
      await migratePlatform(sourceDb);
      const org = randomUUID();
      await sourceDb.query(
        "INSERT INTO platform_organizations(id,runtime_id,edition,installation_id,name,email,state) VALUES($1,$2,'offline',$3,'Backup customer','backup@example.test','registered')",
        [org, randomUUID(), randomUUID()],
      );
      await sourceDb.query(
        "INSERT INTO platform_audit(action,organization_id) VALUES('backup.fixture',$1)",
        [org],
      );
      await sourceDb.query(
        'UPDATE platform_control SET operations_enabled=true',
      );
      const dump = await run('docker', [
        'exec',
        container,
        'pg_dump',
        '--username',
        user,
        '--format=custom',
        '--no-owner',
        '--dbname',
        source,
      ]);
      expect(dump.subarray(0, 5).toString()).toBe('PGDMP');
      const key = randomBytes(32),
        iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(source));
      const encrypted = Buffer.concat([cipher.update(dump), cipher.final()]),
        tag = cipher.getAuthTag();
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(source));
      decipher.setAuthTag(tag);
      const verified = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      await run(
        'docker',
        [
          'exec',
          '-i',
          container,
          'pg_restore',
          '--username',
          user,
          '--no-owner',
          '--no-privileges',
          '--exit-on-error',
          '--dbname',
          target,
        ],
        verified,
      );
      url.pathname = '/' + target;
      targetDb = store(url.toString());
      // Restore runbook must perform this before starting any worker; never enable automatically.
      await targetDb.query(
        'UPDATE platform_control SET operations_enabled=false',
      );
      expect(
        (
          await rows<{ count: string }>(
            targetDb,
            'SELECT count(*) FROM platform_organizations',
          )
        )[0]?.count,
      ).toBe('1');
      expect(
        (
          await rows<{ action: string }>(
            targetDb,
            'SELECT action FROM platform_audit',
          )
        )[0]?.action,
      ).toBe('backup.fixture');
      expect(
        (
          await rows<{ operations_enabled: boolean }>(
            targetDb,
            'SELECT operations_enabled FROM platform_control',
          )
        )[0]?.operations_enabled,
      ).toBe(false);
      await expect(
        targetDb.query('DELETE FROM platform_audit'),
      ).rejects.toThrow();
      key.fill(0);
      dump.fill(0);
      verified.fill(0);
    } finally {
      await sourceDb?.end();
      await targetDb?.end();
      await root.query('DROP DATABASE IF EXISTS "' + source + '" WITH(FORCE)');
      await root.query('DROP DATABASE IF EXISTS "' + target + '" WITH(FORCE)');
      await root.end();
    }
  },
  60000,
);
