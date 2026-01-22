import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
    test: {
        name: 'server',
        environment: 'node',
        globals: true,
        include: ['server/**/*.test.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json'],
            include: ['server/domains/**/*.service.ts', 'server/services/**/*.ts'],
            exclude: ['**/*.test.ts', '**/*.types.ts'],
        },
    },
    resolve: {
        alias: {
            '@shared': path.resolve(__dirname, './shared'),
        },
    },
})
