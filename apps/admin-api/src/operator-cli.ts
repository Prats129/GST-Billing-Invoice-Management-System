import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { readFile, open, lstat } from 'node:fs/promises';
import { z } from 'zod';
import { token } from '@gst/security';
import { emailSchema, passwordSchema } from '@gst/contracts';
import { config } from './config.js';
import { store, migratePlatform, transaction, audit, rows } from './store.js';
import { PlatformAuth } from './auth.js';
loadEnv({
  path: fileURLToPath(new URL('../../../.env.admin', import.meta.url)),
  quiet: true,
});
loadEnv({
  path:
    process.env.PLATFORM_ENV_FILE ??
    fileURLToPath(new URL('../../../.env.admin.operator', import.meta.url)),
  quiet: true,
  override: true,
});
const [command, inputPath, outputPath] = process.argv.slice(2);
let db: ReturnType<typeof store> | undefined;
let output: Awaited<ReturnType<typeof open>> | undefined;
try {
  const c = config(process.env);
  const url = process.env.PLATFORM_MIGRATION_DATABASE_URL;
  if (!url) throw new Error('Operator connection required');
  db = store(url);
  if (command === 'migrate') await migratePlatform(db);
  else {
    if (!inputPath) throw new Error('Private input required');
    const info = await lstat(inputPath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > 16384 ||
      (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
    )
      throw new Error('Private file required');
    const data: unknown = JSON.parse(await readFile(inputPath, 'utf8'));
    if (command === 'provision' || command === 'recover') {
      if (!outputPath) throw new Error('Private output required');
      output = await open(outputPath, 'wx', 0o600);
      const recovery = token();
      await output.writeFile(
        JSON.stringify({ state: 'prepared', recoveryCredential: recovery }) +
          '\n',
      );
      await output.sync();
      const auth = new PlatformAuth(db, c);
      if (command === 'provision') {
        const b = z
          .object({
            email: emailSchema,
            name: z.string().trim().min(1).max(120),
            password: passwordSchema,
          })
          .strict()
          .parse(data);
        // Keep the prepared recovery proof, including if the commit reply is lost.
        const { digest, hashPassword } = await import('@gst/security');
        const { randomUUID } = await import('node:crypto');
        await transaction(db, async (tx) => {
          const id = randomUUID();
          await tx.query(
            'INSERT INTO platform_owner(singleton,id,email,name,password_hash,recovery_hash) VALUES(true,$1,$2,$3,$4,$5)',
            [
              id,
              b.email,
              b.name,
              await hashPassword(b.password),
              digest(recovery),
            ],
          );
          await audit(tx, id, 'owner.bootstrapped');
        });
      } else {
        const b = z
          .object({
            recoveryCredential: z.string().min(40).max(128),
            password: passwordSchema,
          })
          .strict()
          .parse(data);
        await auth.recover(b.recoveryCredential, b.password, recovery);
      }
      await output.writeFile('{"state":"committed"}\n');
      await output.sync();
    } else if (command === 'enable-operations') {
      z.object({ acknowledgeReconciled: z.literal(true) })
        .strict()
        .parse(data);
      await transaction(db, async (tx) => {
        await tx.query('UPDATE platform_control SET operations_enabled=true');
        await audit(tx, null, 'operations.authority_enabled');
      });
    } else if (command === 'runtime-role' || command === 'saas-role') {
      const b = z
        .object({ role: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/) })
        .strict()
        .parse(data);
      const target =
        command === 'saas-role' ? process.env.SAAS_MIGRATION_DATABASE_URL : url;
      if (!target) throw new Error('Operator target required');
      const targetDb = store(target);
      try {
        await transaction(targetDb, async (tx) => {
          const [r] = await rows<{
            rolsuper: boolean;
            rolcreaterole: boolean;
            rolcreatedb: boolean;
            rolbypassrls: boolean;
          }>(tx, 'SELECT * FROM pg_roles WHERE rolname=$1', [b.role]);
          if (
            !r ||
            r.rolsuper ||
            r.rolcreaterole ||
            r.rolcreatedb ||
            r.rolbypassrls
          )
            throw new Error('Restricted role required');
          const [ownership] = await rows<{ unsafe: boolean }>(
            tx,
            `SELECT
            EXISTS(SELECT 1 FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname=$1)) OR
            EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname=$1)) OR
            EXISTS(SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=$1)) OR
            EXISTS(SELECT 1 FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname=$1)) OR
            EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=$1)) OR
            has_schema_privilege($1,'public','CREATE') AS unsafe`,
            [b.role],
          );
          if (ownership?.unsafe)
            throw new Error(
              'A non-owning independent runtime role is required',
            );
          const role = '"' + b.role + '"';
          const [databaseName] = await rows<{ name: string }>(
            tx,
            'SELECT current_database() AS name',
          );
          await tx.query(
            'GRANT CONNECT ON DATABASE "' +
              databaseName!.name.replaceAll('"', '""') +
              '" TO ' +
              role,
          );
          if (command === 'saas-role') {
            const [unsafe] = await rows<{ unsafe: boolean }>(
              tx,
              "SELECT has_table_privilege($1,'public.invoices','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege($1,'public.customers','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege($1,'public.catalog_items','SELECT,INSERT,UPDATE,DELETE') AS unsafe",
              [b.role],
            );
            if (unsafe?.unsafe)
              throw new Error('Operator role must not access financial tables');
            await tx.query(
              'GRANT USAGE ON SCHEMA platform_operator TO ' + role,
            );
            await tx.query(
              'GRANT EXECUTE ON FUNCTION platform_operator.lookup(uuid),platform_operator.execute(uuid,text,jsonb) TO ' +
                role,
            );
          } else {
            const [unsafe] = await rows<{ unsafe: boolean }>(
              tx,
              `SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($2::text[]) AND has_table_privilege($1,c.oid,'UPDATE,DELETE,TRUNCATE')) AS unsafe`,
              [
                b.role,
                [
                  'platform_audit',
                  'platform_receipts',
                  'platform_adjustments',
                  'platform_license_requests',
                  'platform_grants',
                  'platform_delivery',
                  'platform_mutations',
                  'platform_control',
                ],
              ],
            );
            if (unsafe?.unsafe)
              throw new Error(
                'Existing immutable-ledger privileges must be reviewed',
              );
            await tx.query('GRANT USAGE ON SCHEMA public TO ' + role);
            await tx.query(
              'GRANT SELECT ON ALL TABLES IN SCHEMA public TO ' + role,
            );
            await tx.query(
              'GRANT INSERT,UPDATE,DELETE ON platform_sessions,platform_throttle,platform_recovery_codes TO ' +
                role,
            );
            await tx.query(
              'GRANT UPDATE ON platform_owner,platform_organizations,platform_agreements,platform_operations,platform_observations TO ' +
                role,
            );
            await tx.query(
              'GRANT INSERT ON platform_organizations,platform_agreements,platform_receipts,platform_adjustments,platform_license_requests,platform_grants,platform_delivery,platform_operations,platform_mutations,platform_audit,platform_observations TO ' +
                role,
            );
            await tx.query(
              'GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ' + role,
            );
          }
        });
      } finally {
        await targetDb.end();
      }
    } else throw new Error('Unknown command');
  }
  process.stdout.write(
    'Platform operator action completed. Inspect protected output where applicable.\n',
  );
} catch {
  process.stderr.write(
    'Platform operator action failed. Inspect configuration, private input and committed state; do not reset history.\n',
  );
  process.exitCode = 1;
} finally {
  await output?.close();
  await db?.end();
}
