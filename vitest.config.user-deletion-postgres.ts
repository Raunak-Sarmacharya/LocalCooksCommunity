import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(process.cwd(), 'shared') } },
  // In-memory Postgres only. The check builds its own schema and never opens DATABASE_URL.
  test: { environment: 'node', include: ['server/domains/users/user-deletion.postgres.check.ts'],
    testTimeout: 60000, hookTimeout: 120000, fileParallelism: false,
    env: { DATABASE_URL: 'postgres://dummy:dummy@127.0.0.1:1/dummy' } },
});
