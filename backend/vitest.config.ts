import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/globalSetup.ts'],
    // All DB tests share one *_test database and TRUNCATE between tests, so files run serially.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
