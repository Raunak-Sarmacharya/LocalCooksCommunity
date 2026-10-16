import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Runs migration 0093 against in-memory Postgres (PGlite + btree_gist). No network, no shared database.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['shared/storage-rental.pglite.check.ts', 'server/services/storage-rentals.test.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
  },
  resolve: { alias: { '@shared': path.resolve(__dirname, './shared') } },
});
