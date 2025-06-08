import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import react from "@vitejs/plugin-react";
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
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Node modules
          if (id.includes('node_modules')) {
            // React ecosystem
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor-react';
            }
            // Radix UI components
            if (id.includes('@radix-ui')) {
              return 'vendor-ui';
            }
            // Animation library
            if (id.includes('framer-motion')) {
              return 'vendor-motion';
            }
            // Form libraries
            if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod')) {
              return 'vendor-forms';
            }
            // Utility libraries
            if (id.includes('clsx') || id.includes('tailwind-merge') || id.includes('date-fns') || id.includes('lucide-react')) {
              return 'vendor-utils';
            }
            // Charts
            if (id.includes('recharts')) {
              return 'vendor-charts';
            }
            // Auth libraries
            if (id.includes('passport') || id.includes('openid-client')) {
              return 'vendor-auth';
            }
            // Database libraries
            if (id.includes('drizzle-orm') || id.includes('@neondatabase')) {
              return 'vendor-db';
            }
            // All other node_modules
            return 'vendor-other';
          }
          
          // Application code
          if (id.includes('microlearning')) {
            return 'microlearning';
          }
          if (id.includes('auth') && !id.includes('node_modules')) {
            return 'auth';
          }
          if (id.includes('/ui/') && !id.includes('node_modules')) {
            return 'ui-components';
          }
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },
    chunkSizeWarningLimit: 1000, // Increase warning limit to 1MB
    target: 'esnext',
    sourcemap: false, // Disable source maps in production for smaller build
  },
});
