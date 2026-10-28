import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const template = readFileSync(
  new URL('../.env.example', import.meta.url),
  'utf8',
);
const password = randomBytes(32).toString('hex');
try {
  writeFileSync(
    new URL('../.env', import.meta.url),
    template.replaceAll('REPLACE_WITH_RANDOM_LOCAL_PASSWORD', password) +
      `\nAUTH_DATA_KEY=${randomBytes(32).toString('hex')}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    'Created .env with a random local-development password. Keep this file private.',
  );
} catch (error) {
  if (error.code === 'EEXIST') {
    const existing = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    if (!/^(?:export\s+)?AUTH_DATA_KEY\s*=/m.test(existing)) {
      appendFileSync(
        new URL('../.env', import.meta.url),
        `\nAUTH_DATA_KEY=${randomBytes(32).toString('hex')}\n`,
      );
      console.log(
        'Added a new MFA encryption key to .env; existing settings preserved.',
      );
    } else console.log('.env already configured; preserved without changes.');
  } else throw error;
}
