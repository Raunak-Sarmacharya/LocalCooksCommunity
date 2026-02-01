import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Vitest config for integration tests
 * Uses REAL database connection - no mocks
 */
export default defineConfig({
    test: {
        name: 'integration',
        environment: 'node',
        globals: true,
        include: ['server/**/*.integration.test.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        // NO setupFiles - we want real database connection
        testTimeout: 30000, // 30 seconds for DB operations
    },
    resolve: {
        alias: {
            '@shared': path.resolve(__dirname, './shared'),
        },
    },
})
