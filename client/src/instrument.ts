/**
 * Sentry Instrumentation — Client-Side (React)
 * 
 * CRITICAL: This file MUST be imported before ANY other modules in main.tsx.
 * Sentry hooks into the browser's error handling to capture unhandled exceptions,
 * promise rejections, and performance data.
 * 
 * Features:
 *   - Automatic error capture (unhandled exceptions + promise rejections)
 *   - Browser performance tracing (page loads, navigations, web vitals)
 *   - Session replay on errors (100% of error sessions recorded)
 *   - Trace propagation to backend API for distributed tracing
 * 
 * @see https://docs.sentry.io/platforms/javascript/guides/react/
 */

import * as Sentry from '@sentry/react';

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
const isProduction = import.meta.env.PROD;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,

    // Environment tagging — matches server-side
    environment: import.meta.env.VITE_VERCEL_ENV || (isProduction ? 'production' : 'development'),

    // Release tracking — Vite injects this at build time
    release: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || undefined,

    integrations: [
      // Browser performance tracing (page loads, navigations, web vitals)
      Sentry.browserTracingIntegration(),

      // Session replay — records DOM mutations for error sessions
      // 0% of normal sessions, 100% of sessions with errors
      Sentry.replayIntegration({
        // Mask all text and block all media by default for privacy
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],

    // Performance sampling — FREE TIER BUDGET: 10K transactions/month (shared with server)
    // Client page loads + navigations generate ~1 transaction per page view
    // 5% production keeps us well within budget
    tracesSampleRate: isProduction ? 0.05 : 0.2,

    // Propagate traces to our API for distributed tracing (server ↔ client correlation)
    tracePropagationTargets: [
      /^\/api\//,                                    // Relative API calls
      /^https:\/\/(chef|kitchen|admin)\.localcooks\.ca\/api/,  // Production subdomains
      /^https:\/\/dev(-chef|-kitchen|-admin)?\.localcooks\.ca\/api/, // Dev subdomains
    ],

    // Session replay — FREE TIER: 50 replays/month
    // Only capture error sessions to maximize value from limited quota
    replaysSessionSampleRate: 0,     // Don't record normal sessions
    replaysOnErrorSampleRate: 1.0,   // Record 100% of sessions that have errors (max 50/month)

    // Scrub sensitive data
    beforeSend(event) {
      // Strip any accidentally captured auth tokens from breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map(breadcrumb => {
          if (breadcrumb.data?.url) {
            // Remove any token query params from URLs
            try {
              const url = new URL(breadcrumb.data.url, window.location.origin);
              url.searchParams.delete('token');
              url.searchParams.delete('oobCode');
              breadcrumb.data.url = url.toString();
            } catch {
              // Not a valid URL, skip
            }
          }
          return breadcrumb;
        });
      }
      return event;
    },

    // Filter out noisy, non-actionable errors
    ignoreErrors: [
      // Browser extensions injecting errors
      'ResizeObserver loop',
      'ResizeObserver loop limit exceeded',
      // Network errors from ad blockers
      'Failed to fetch',
      'NetworkError',
      'Load failed',
      // Chrome-specific noise
      'Non-Error promise rejection captured',
      // User navigation interrupts (expected behavior)
      'AbortError',
    ],

    // Don't capture errors from third-party scripts (Tidio, Stripe, Google Maps)
    denyUrls: [
      /code\.tidio\.co/,
      /widget-v4\.tidiochat\.com/,
      /js\.stripe\.com/,
      /maps\.googleapis\.com/,
      /extensions\//,
      /^chrome:\/\//,
      /^moz-extension:\/\//,
    ],
  });
}

export { Sentry };
