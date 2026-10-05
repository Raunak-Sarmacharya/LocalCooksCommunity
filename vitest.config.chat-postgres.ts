import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ test: { environment: 'node', include: ['server/services/chat-notices.postgres.check.ts'],
  testTimeout: 30000, hookTimeout: 120000, fileParallelism: false },
  resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } } });
