import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ resolve: { alias: { '@shared': path.resolve(process.cwd(), 'shared') } }, test: {
  environment: 'node', include: ['server/services/tour-request-access.postgres.check.ts'],
  testTimeout: 30000, hookTimeout: 120000, fileParallelism: false,
} });
