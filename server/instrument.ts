/**
 * Sentry Instrumentation — Server-Side
 * 
 * CRITICAL: This file MUST be imported before ANY other modules in server/index.ts.
 * Sentry hooks into Node.js module loading to auto-instrument Express, pg, HTTP, etc.
 * If imported after other modules, auto-instrumentation will not work.
 * 
 * @see https://docs.sentry.io/platforms/javascript/guides/express/
 */

// Load .env BEFORE reading SENTRY_DSN — this file runs before dotenv/config in index.ts
// On Vercel, env vars are already set natively so this is a no-op
import 'dotenv/config';
import * as Sentry from '@sentry/node';

const isVercelProduction = process.env.VERCEL_ENV === 'production';
const isVercel = !!process.env.VERCEL;
const sentryDsn = process.env.SENTRY_DSN;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,

    // Environment tagging — maps to Sentry's environment filter
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',

    // Release tracking — Vercel sets VERCEL_GIT_COMMIT_SHA automatically
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,

    // Attach request headers + IP for user context
    sendDefaultPii: true,

    // Performance sampling — FREE TIER BUDGET: 10K transactions/month
    // At current traffic (~2K transactions/day), 5% production rate = ~3K/month (safe)
    // Use tracesSampler for intelligent sampling instead of flat rate
    tracesSampler(samplingContext) {
      // ALWAYS trace the Sentry test endpoint (for verification)
      if (samplingContext.name?.includes('sentry-test')) return 1.0;

      // ALWAYS trace errors and slow transactions
      if (samplingContext.parentSampled) return 1.0;

      // Higher rate for critical payment/booking/webhook routes
      if (samplingContext.name?.includes('/webhooks/')) return 0.5;
      if (samplingContext.name?.includes('/bookings/')) return 0.2;
      if (samplingContext.name?.includes('/payment')) return 0.2;

      // Lower rate for high-frequency read endpoints
      if (samplingContext.name?.includes('/api/')) {
        return isVercelProduction ? 0.05 : 0.2;
      }

      // Default: 5% production, 20% dev/preview
      return isVercelProduction ? 0.05 : 0.2;
    },

    // Profiling disabled on free tier (not included)
    profilesSampleRate: 0,

    // Scrub sensitive data from breadcrumbs and events
    beforeSend(event) {
      // Strip Authorization headers from request data
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
      }
      return event;
    },

    // Filter out noisy, non-actionable errors
    ignoreErrors: [
      // Network interruptions (not bugs)
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EPIPE',
      // Client disconnects mid-request (serverless cold starts, browser navigations)
      'aborted',
      // Rate limiter rejections (expected behavior, not errors)
      'Too many requests',
    ],

    // Tag every event with deployment metadata
    initialScope: {
      tags: {
        'vercel.env': process.env.VERCEL_ENV || 'local',
        'vercel.region': process.env.VERCEL_REGION || 'unknown',
      },
    },

    // ESM loader hooks — only wrap packages Sentry instruments (Express, pg, HTTP)
    // Prevents import-in-the-middle from wrapping every module (performance + stability)
    registerEsmLoaderHooks: true,

    // Serverless-optimized: flush events before function timeout
    // Vercel functions have 30s max duration
    ...(isVercel ? { 
      enableTracing: true,
    } : {}),
  });
}

export { Sentry };
