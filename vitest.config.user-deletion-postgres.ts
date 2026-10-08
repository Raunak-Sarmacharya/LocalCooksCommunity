import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(process.cwd(), 'shared') } },
  test: { environment: 'node', include: ['server/domains/users/user-deletion.postgres.check.ts'],
    testTimeout: 60000, hookTimeout: 120000, fileParallelism: false },
});
