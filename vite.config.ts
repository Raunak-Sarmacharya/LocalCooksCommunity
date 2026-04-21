import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
    // Sentry source map upload — only runs during Vercel builds when SENTRY_AUTH_TOKEN is set
    // Uploads source maps to Sentry for readable stack traces, then deletes them from the bundle
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: {
              name: process.env.VERCEL_GIT_COMMIT_SHA,
            },
            sourcemaps: {
              filesToDeleteAfterUpload: ['./dist/public/assets/*.map'],
            },
          }),
        ]
      : []),
  ],
  envDir: path.resolve(import.meta.dirname),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime'
    ]
  },
  // ENTERPRISE: Strip console.log/debug from all Vercel deploys (production + preview)
  // Local dev keeps all console output for debugging
  // console.warn and console.error are always preserved
  esbuild: {
    pure: process.env.VERCEL_ENV ? ['console.log', 'console.debug'] : [],
    // Prevent jsxDEV debug metadata (fileName, lineNumber) from leaking
    // source paths into production bundles
    jsxDev: false,
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Function-based manualChunks that avoids circular chunk dependencies.
        //
        // Why function-based (not object-based):
        //   The previous object form (`'react-vendor': ['react', 'react-dom']`)
        //   caused Rollup to create circular imports between chunks. Both
        //   `wouter` (router-vendor) and `@radix-ui/react-avatar` (ui-vendor)
        //   depend on `use-sync-external-store`. Rollup placed the shim in
        //   router-vendor and React inside ui-vendor, producing:
        //       router-vendor  ──import──▶  ui-vendor   (needs React)
        //       ui-vendor      ──import──▶  router-vendor (needs the shim)
        //   The resulting circular ESM import caused React's `o.Children = Dc`
        //   line to throw `Cannot set properties of undefined (setting 'Children')`
        //   at runtime because the namespace object was still undefined when
        //   evaluated in the cycle.
        //
        // Fix: group React core + its shims (use-sync-external-store, react-is,
        // scheduler) explicitly in `react-vendor`. Every consumer chunk then
        // has a one-way import into react-vendor — no cycles possible.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // React core ecosystem. Keep React + ALL its internal shims here so
          // no downstream chunk needs to import them from another vendor chunk.
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-is|use-sync-external-store)[\\/]/.test(id)) {
            return 'react-vendor';
          }

          // Radix UI + adjacent UI primitives (all consume React)
          if (/[\\/]node_modules[\\/](@radix-ui|lucide-react|cmdk|vaul|input-otp|sonner|react-resizable-panels|next-themes|embla-carousel-react|react-day-picker)[\\/]/.test(id)) {
            return 'ui-vendor';
          }

          // Routing
          if (/[\\/]node_modules[\\/]wouter[\\/]/.test(id)) {
            return 'router-vendor';
          }

          // Forms
          if (/[\\/]node_modules[\\/](react-hook-form|@hookform)[\\/]/.test(id)) {
            return 'forms-vendor';
          }

          // Data fetching
          if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) {
            return 'query-vendor';
          }

          // Charts
          if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-[^\\/]+)[\\/]/.test(id)) {
            return 'charts-vendor';
          }

          // Animation
          if (/[\\/]node_modules[\\/](framer-motion|motion)[\\/]/.test(id)) {
            return 'motion-vendor';
          }

          // Validation / date / generic utilities (no React dep)
          if (/[\\/]node_modules[\\/](zod|zod-validation-error|drizzle-zod|date-fns|@date-fns|clsx|tailwind-merge|class-variance-authority|tailwindcss-animate|tw-animate-css)[\\/]/.test(id)) {
            return 'utils-vendor';
          }

          // Stripe
          if (/[\\/]node_modules[\\/]@stripe[\\/]/.test(id)) {
            return 'stripe-vendor';
          }

          // Firebase
          if (/[\\/]node_modules[\\/](firebase|@firebase)[\\/]/.test(id)) {
            return 'firebase-vendor';
          }

          // Sentry
          if (/[\\/]node_modules[\\/]@sentry[\\/]/.test(id)) {
            return 'sentry-vendor';
          }

          // Video player (large, lazy-loaded by route, but keep vendor grouped)
          if (/[\\/]node_modules[\\/]@vidstack[\\/]/.test(id)) {
            return 'vidstack-vendor';
          }

          // SEO / Helmet
          if (/[\\/]node_modules[\\/](react-helmet-async|@dr\.pogodin)[\\/]/.test(id)) {
            return 'seo-vendor';
          }

          // Everything else in node_modules → let Vite auto-chunk
          return undefined;
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },
    chunkSizeWarningLimit: 1000,
    target: 'esnext',
    // Source maps: enabled when SENTRY_AUTH_TOKEN is present (Sentry uploads them then deletes)
    // Disabled otherwise to keep bundle size small
    sourcemap: !!process.env.SENTRY_AUTH_TOKEN
  },
});
