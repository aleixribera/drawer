import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The process runs in UTC and the owner lives in Madrid, so code that leans on the machine's own zone shows up.
    env: { TZ: 'UTC', DRAWER_TIME_ZONE: 'Europe/Madrid' },
  },
});
