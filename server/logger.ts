/**
 * Enterprise Structured Logger — Pino
 * 
 * Replaces the old console.* wrapper with Pino for structured JSON logging.
 * All output goes to stdout (which Vercel captures as runtime logs).
 * 
 * Environment behavior:
 *   - VERCEL_ENV='production': level=warn (only warn/error/fatal/operational)
 *   - VERCEL_ENV='preview': level=info (all except debug)
 *   - Local dev: level=debug (everything), pretty-printed via pino-pretty
 * 
 * API surface preserved for backward compatibility:
 *   logger.info(msg, data?)
 *   logger.warn(msg, data?)
 *   logger.error(msg, error?)
 *   logger.debug(msg, data?)
 *   logger.operational(msg, data?)  — ALWAYS logs, maps to pino level 45
 * 
 * New Pino-native capabilities (for new code):
 *   logger.child({ bookingId, chefId })  — request-scoped context
 *   logger.fatal(msg, data?)             — process-ending errors
 * 
 * @see https://getpino.io
 */

import pino from 'pino';
import * as Sentry from '@sentry/node';

const isVercelProduction = process.env.VERCEL_ENV === 'production';
const isVercelPreview = process.env.VERCEL_ENV === 'preview';
const isLocalDev = process.env.NODE_ENV === 'development' && !process.env.VERCEL;

// Custom log level for operational events that ALWAYS log regardless of environment
// Level 45 sits between warn (40) and error (50) — always above the production 'warn' threshold
const customLevels = { operational: 45 };

// Determine base log level by environment
function getLogLevel(): string {
  if (isVercelProduction) return 'warn';  // Only warn/error/fatal/operational in prod
  if (isVercelPreview) return 'info';      // Info and above in preview
  if (isLocalDev) return 'debug';          // Everything in local dev
  return 'info';                           // Safe default
}

// Build Pino transport configuration
// pino-pretty is used ONLY in local dev for human-readable output
// In Vercel (serverless), Pino outputs raw JSON to stdout — Vercel captures it
function getTransport(): pino.TransportSingleOptions | undefined {
  if (isLocalDev) {
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
        customLevels: 'operational:45',
        customColors: 'operational:bgCyan',
        useOnlyCustomProps: false,
      },
    };
  }
  return undefined;
}

// Pino logger type with custom levels
type CustomLevels = 'operational';

// Create the root Pino instance
const pinoLogger = pino<CustomLevels>({
  level: getLogLevel(),
  customLevels,
  // Ensure our custom level is included when filtering
  useOnlyCustomLevels: false,

  // In production/preview, use raw JSON (no transport = direct stdout)
  // In local dev, use pino-pretty for human-readable output
  transport: getTransport(),

  // Base fields attached to every log line
  base: {
    env: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    region: process.env.VERCEL_REGION || undefined,
  },

  // Format the level as a string label instead of a number
  formatters: {
    level(label: string) {
      return { level: label };
    },
  },

  // ISO timestamp for structured log aggregation
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Helper: call the runtime-generated operational() method on a Pino instance
// Pino creates this method at runtime from customLevels, but TS needs a nudge
function logOperational(instance: pino.Logger<CustomLevels>, msg: string, data?: object): void {
  if (data) {
    instance.operational(data, msg);
  } else {
    instance.operational(msg);
  }
}

/**
 * Backward-compatible logger facade
 * 
 * Wraps the Pino instance to maintain the existing API surface:
 *   logger.info(msg, data?)    — structured info log
 *   logger.warn(msg, data?)    — structured warning
 *   logger.error(msg, error?)  — structured error + Sentry breadcrumb
 *   logger.debug(msg, data?)   — structured debug (local dev only)
 *   logger.operational(msg, data?) — ALWAYS logs (custom level 45)
 *   logger.child(bindings)     — create child logger with bound context
 *   logger.fatal(msg, data?)   — process-ending error
 * 
 * Error handling: logger.error() accepts an Error object as the second arg
 * (matching the old API). Pino expects the error as the first arg in its
 * native API, so we normalize here.
 */
export const logger = {
  info(msg: string, ...args: unknown[]): void {
    if (args.length === 0) {
      pinoLogger.info(msg);
    } else if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !(args[0] instanceof Error)) {
      pinoLogger.info(args[0] as object, msg);
    } else {
      pinoLogger.info({ args }, msg);
    }
  },

  warn(msg: string, ...args: unknown[]): void {
    if (args.length === 0) {
      pinoLogger.warn(msg);
    } else if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !(args[0] instanceof Error)) {
      pinoLogger.warn(args[0] as object, msg);
    } else {
      pinoLogger.warn({ args }, msg);
    }
  },

  error(msg: string, error?: unknown): void {
    if (error instanceof Error) {
      pinoLogger.error({ err: error }, msg);
      Sentry.addBreadcrumb({
        category: 'logger',
        message: msg,
        level: 'error',
        data: { errorMessage: error.message },
      });
    } else if (error && typeof error === 'object') {
      pinoLogger.error(error as object, msg);
      Sentry.addBreadcrumb({
        category: 'logger',
        message: msg,
        level: 'error',
        data: { detail: JSON.stringify(error) },
      });
    } else if (error) {
      pinoLogger.error({ detail: String(error) }, msg);
      Sentry.addBreadcrumb({
        category: 'logger',
        message: msg,
        level: 'error',
        data: { detail: String(error) },
      });
    } else {
      pinoLogger.error(msg);
      Sentry.addBreadcrumb({
        category: 'logger',
        message: msg,
        level: 'error',
      });
    }
  },

  debug(msg: string, ...args: unknown[]): void {
    if (args.length === 0) {
      pinoLogger.debug(msg);
    } else if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !(args[0] instanceof Error)) {
      pinoLogger.debug(args[0] as object, msg);
    } else {
      pinoLogger.debug({ args }, msg);
    }
  },

  operational(msg: string, data?: object): void {
    // Level 45 sits between warn (40) and error (50)
    // Always passes production's 'warn' threshold — no bypass needed
    logOperational(pinoLogger, msg, data);
  },

  fatal(msg: string, data?: object): void {
    if (data) {
      pinoLogger.fatal(data, msg);
    } else {
      pinoLogger.fatal(msg);
    }
    // Fatal errors should always be captured by Sentry
    Sentry.captureMessage(msg, 'fatal');
  },

  /**
   * Create a child logger with bound context fields.
   * Every log from the child automatically includes these fields.
   * 
   * Usage:
   *   const reqLog = logger.child({ requestId, userId, bookingId });
   *   reqLog.info('Processing booking');
   *   // → {"level":"info","requestId":"abc","userId":42,"bookingId":183,"msg":"Processing booking"}
   */
  child(bindings: pino.Bindings) {
    const childPino = pinoLogger.child(bindings);
    // Return a facade with the same API over the child instance
    return {
      info: (msg: string, data?: object) => data ? childPino.info(data, msg) : childPino.info(msg),
      warn: (msg: string, data?: object) => data ? childPino.warn(data, msg) : childPino.warn(msg),
      error: (msg: string, error?: unknown) => {
        if (error instanceof Error) {
          childPino.error({ err: error }, msg);
          Sentry.addBreadcrumb({
            category: 'logger',
            message: msg,
            level: 'error',
            data: { errorMessage: error.message, ...bindings },
          });
        } else if (error && typeof error === 'object') {
          childPino.error(error as object, msg);
          Sentry.addBreadcrumb({
            category: 'logger',
            message: msg,
            level: 'error',
            data: { detail: JSON.stringify(error), ...bindings },
          });
        } else if (error) {
          childPino.error({ detail: String(error) }, msg);
          Sentry.addBreadcrumb({
            category: 'logger',
            message: msg,
            level: 'error',
            data: { detail: String(error), ...bindings },
          });
        } else {
          childPino.error(msg);
          Sentry.addBreadcrumb({
            category: 'logger',
            message: msg,
            level: 'error',
            data: { ...bindings },
          });
        }
      },
      debug: (msg: string, data?: object) => data ? childPino.debug(data, msg) : childPino.debug(msg),
      operational: (msg: string, data?: object) => {
        logOperational(childPino, msg, data);
      },
    };
  },
};

// Export the raw Pino instance for pino-http integration
export const pinoInstance = pinoLogger;
