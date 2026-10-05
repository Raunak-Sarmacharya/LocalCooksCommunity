import { defineConfig } from 'vitest/config';
import path from 'path';
export default defineConfig({ test: { environment: 'node', include: ['server/services/kitchen-booking-changes.postgres.check.ts'],
  testTimeout: 30000, hookTimeout: 60000, fileParallelism: false }, resolve: { alias: { '@shared': path.resolve(__dirname, './shared') } } });
