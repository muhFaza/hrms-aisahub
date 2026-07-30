import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Points DATABASE_URL at a dedicated test database before any test file imports
    // src/config/prisma.ts, and creates/migrates that database once up front.
    setupFiles: ['src/__tests__/helpers/setupEnv.ts'],
    globalSetup: ['src/__tests__/helpers/globalSetup.ts'],
    // Every suite shares that one database and truncates between tests, so files
    // must not run concurrently.
    fileParallelism: false,
    // DB-backed tests plus a one-off `prisma migrate deploy` need headroom.
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
