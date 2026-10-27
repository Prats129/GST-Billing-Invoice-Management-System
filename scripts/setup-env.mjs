import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const template = readFileSync(
  new URL('../.env.example', import.meta.url),
  'utf8',
);
const password = randomBytes(32).toString('hex');
try {
  writeFileSync(
    new URL('../.env', import.meta.url),
    template.replaceAll('REPLACE_WITH_RANDOM_LOCAL_PASSWORD', password),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    'Created .env with a random local-development password. Keep this file private.',
  );
} catch (error) {
  if (error.code === 'EEXIST')
    console.log('.env already exists; preserved without changes.');
  else throw error;
}
