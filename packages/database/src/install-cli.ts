// Installer-only private input; no dotenv fallback or secret-bearing arguments.
import { lstat, open } from 'node:fs/promises';
import { initializeOfflineDatabase } from './install-database.js';
let buffer: Buffer | undefined;
try {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error();
  const inputInfo = await lstat(input);
  if (
    !inputInfo.isFile() ||
    inputInfo.isSymbolicLink() ||
    inputInfo.size > 16384
  )
    throw new Error();
  const file = await open(input, 'r');
  try {
    if (!(await file.stat()).isFile()) throw new Error();
    buffer = Buffer.alloc(16385);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > 16384) throw new Error();
    const value = JSON.parse(buffer.subarray(0, length).toString('utf8'));
    const receipt = await open(output, 'wx', 0o600);
    try {
      // Reserve the receipt before any database mutation: an existing output
      // must fail without creating roles or a database.
      const result = await initializeOfflineDatabase(value);
      await receipt.writeFile(JSON.stringify(result) + '\n');
      await receipt.sync();
    } finally {
      await receipt.close();
    }
  } finally {
    await file.close();
  }
  process.stdout.write('{"event":"installer_database_ready"}\n');
} catch {
  process.stderr.write(
    '{"event":"installer_database_failed","message":"Keep services isolated; inspect private installer evidence. No existing data was adopted or deleted."}\n',
  );
  process.exitCode = 1;
} finally {
  buffer?.fill(0);
}
