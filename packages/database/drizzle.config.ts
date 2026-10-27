import { defineConfig } from 'drizzle-kit';

// Generation is offline and does not need database credentials. No push command.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
});
