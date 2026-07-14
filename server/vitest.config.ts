import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // API smoke tests hit the seeded Postgres, so allow a little headroom.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
