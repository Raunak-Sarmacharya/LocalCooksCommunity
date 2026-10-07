import { defineConfig } from 'vitest/config';

// Opt-in isolated PostgreSQL checks; no dotenv or normal mocked server setup.
export default defineConfig({ test: {
  environment: 'node',
  include: ['server/services/tour-request-decisions.postgres.check.ts'],
  testTimeout: 30_000,
  hookTimeout: 120_000,
  fileParallelism: false,
} });
