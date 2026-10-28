import 'reflect-metadata';
import { open, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { emailSchema, passwordSchema } from '@gst/contracts';
import { createDatabase } from '@gst/database';
import { parseConfig } from '../config.js';
import { IdentityService } from './identity.service.js';
import { OrganizationsService } from './organizations.service.js';
import { token } from './crypto.js';

loadEnv({
  path:
    process.env.ENV_FILE ??
    fileURLToPath(new URL('../../../../.env', import.meta.url)),
  quiet: true,
});
const [command, inputPath, outputPath] = process.argv.slice(2);
const bootstrapSchema = z
  .object({
    organizationName: z.string().trim().min(1).max(200),
    organizationId: z.string().uuid().optional(),
    email: emailSchema,
    name: z.string().trim().min(1).max(120),
    password: passwordSchema,
  })
  .strict();
const recoverySchema = z
  .object({
    email: emailSchema,
    recoveryCredential: z.string().min(40).max(128),
    newPassword: passwordSchema,
  })
  .strict();
let database: ReturnType<typeof createDatabase> | undefined;
let output: Awaited<ReturnType<typeof open>> | undefined;
try {
  if (
    !['provision', 'recover-owner'].includes(command ?? '') ||
    !inputPath ||
    !outputPath
  )
    throw new Error('Arguments');
  const inputStat = await stat(inputPath);
  if (
    !inputStat.isFile() ||
    inputStat.size > 16384 ||
    (process.platform !== 'win32' && (inputStat.mode & 0o077) !== 0)
  )
    throw new Error('Private input file required');
  const body: unknown = JSON.parse(await readFile(inputPath, 'utf8'));
  // Reserve a new private output before making database changes, never replace a
  // recovery file. Operators must enforce NTFS ACLs on Windows parent directories.
  output = await open(outputPath, 'wx', 0o600);
  const config = parseConfig(process.env);
  const replacement = token();
  // Persist recovery material before commit. Even a later disk-write failure
  // cannot consume a one-time proof without leaving its replacement on disk.
  await output.writeFile(
    JSON.stringify({
      state: 'prepared',
      ...(config.DEPLOYMENT_EDITION === 'offline'
        ? { recoveryCredential: replacement }
        : {}),
    }) + '\n',
  );
  await output.sync();
  if (!process.env.MIGRATION_DATABASE_URL)
    throw new Error('Operator database connection required');
  database = createDatabase(process.env.MIGRATION_DATABASE_URL);
  const identity = new IdentityService(database, config);
  const organizations = new OrganizationsService(identity);
  let result: object;
  if (command === 'provision')
    result = await organizations.provisionOwner(
      bootstrapSchema.parse(body),
      replacement,
    );
  else {
    const data = recoverySchema.parse(body);
    result = {
      recoveryCredential: await identity.recoverOwner(
        data.email,
        data.recoveryCredential,
        data.newPassword,
        replacement,
      ),
    };
  }
  await output.writeFile(
    JSON.stringify({ state: 'committed', ...result }) + '\n',
  );
  await output.sync();
  process.stdout.write(
    'Host operation completed. Read the private output file and securely remove the password input file.\n',
  );
} catch {
  process.stderr.write(
    'Host operation failed. Check command, private input/output paths, credentials, configuration and migrated database. No universal recovery override exists.\n',
  );
  process.exitCode = 1;
} finally {
  await output?.close();
  await database?.close();
}
