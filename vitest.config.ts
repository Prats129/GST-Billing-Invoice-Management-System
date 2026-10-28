import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
          exclude: [
            '**/*.integration.test.ts',
            '**/node_modules/**',
            '**/dist/**',
          ],
        },
      },
      {
        test: {
          name: 'integration',
          include: [
            'packages/**/*.integration.test.ts',
            'apps/**/*.integration.test.ts',
          ],
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
  },
});
