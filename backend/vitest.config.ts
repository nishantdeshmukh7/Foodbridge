import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    root: dirname,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: [path.resolve(dirname, 'src/test/setup.ts')],
    testTimeout: 20000,
    hookTimeout: 20000,
    // These tests share one Postgres test database - keep them from
    // running concurrently against it.
    fileParallelism: false,
  },
});
