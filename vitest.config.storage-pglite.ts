import { defineConfig } from 'vitest/config';

// Runs migration 0093 against in-memory Postgres (PGlite + btree_gist). No network, no shared database.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['shared/storage-rental.pglite.check.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
