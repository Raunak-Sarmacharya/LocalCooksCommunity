import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: './client/src/setupTests.ts',
        include: ['client/**/*.test.tsx', 'client/**/*.test.ts'],
        exclude: ['server/**', '**/node_modules/**', '**/dist/**'],
    },
    resolve: {
        alias: {
            '@': path.resolve(process.cwd(), './client/src'),
            '@shared': path.resolve(process.cwd(), './shared'),
            // `vite.config.ts` resolves this, so shipped components import from
            // `attached_assets/` freely (`components/ui/logo.tsx`,
            // `pages/TermsAcceptanceScreen.tsx`). Without it here, any test that
            // transitively imports one of those fails to even load — the whole suite
            // reports "0 test" and the component silently becomes untestable.
            '@assets': path.resolve(process.cwd(), './attached_assets'),
        },
    },
})

