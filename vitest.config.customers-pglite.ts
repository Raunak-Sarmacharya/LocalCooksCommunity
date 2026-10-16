import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Runs the Customers queries against in-memory Postgres (PGlite). No network, no shared database.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/services/manager-customers.pglite.check.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    env: { DATABASE_URL: 'postgres://dummy:dummy@localhost:5432/dummy' },
  },
  resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } },
});
