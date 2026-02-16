/**
 * Client-Side Structured Logger
 * 
 * Thin wrapper over console.* that:
 *   - Suppresses info/debug logs in production builds
 *   - Captures errors via Sentry when available
 *   - Provides the same API as the server-side Pino logger
 * 
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Page loaded', { route: '/dashboard' });
 *   logger.error('Failed to fetch', error);
 */

import * as Sentry from '@sentry/react';

const isProduction = import.meta.env.PROD;

export const logger = {
  info(msg: string, ...args: unknown[]): void {
    if (!isProduction) {
      console.log(msg, ...args);
    }
  },

  warn(msg: string, ...args: unknown[]): void {
    console.warn(msg, ...args);
  },

  error(msgOrError: string | Error | unknown, ...args: unknown[]): void {
    // Defensive: handle .catch(logger.error) where an Error lands as the first arg
    if (msgOrError instanceof Error) {
      console.error(msgOrError, ...args);
      Sentry.addBreadcrumb({
        category: 'logger',
        message: msgOrError.message,
        level: 'error',
        data: { stack: msgOrError.stack },
      });
      return;
    }

    const msg = typeof msgOrError === 'string' ? msgOrError : String(msgOrError);
    console.error(msg, ...args);

    // Send to Sentry as breadcrumb — check args for Error instances first
    const error = args.find(a => a instanceof Error);
    if (error instanceof Error) {
      Sentry.addBreadcrumb({
        category: 'logger',
        message: msg,
        level: 'error',
        data: { errorMessage: error.message, stack: error.stack },
      });
    } else if (args.length > 0) {
      // Non-Error objects (e.g., Firestore errors, plain objects) still get breadcrumbs
      Sentry.addBreadcrumb({
        category: 'logger',
        message: msg,
        level: 'error',
        data: { detail: args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') },
      });
    } else {
      Sentry.addBreadcrumb({
        category: 'logger',
        message: msg,
        level: 'error',
      });
    }
  },

  debug(msg: string, ...args: unknown[]): void {
    if (!isProduction) {
      console.debug(msg, ...args);
    }
  },
};
