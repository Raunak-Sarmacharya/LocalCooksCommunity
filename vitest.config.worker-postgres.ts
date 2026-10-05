import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Explicitly opt-in isolated database check. No dotenv or normal mocked setup.
export default defineConfig({ test: { environment: 'node',
  include: ['server/services/recurring-worker.postgres.check.ts'], testTimeout: 30_000, hookTimeout: 120_000,
  fileParallelism: false }, resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } } });
