// CRITICAL: Sentry must be imported BEFORE all other modules for auto-instrumentation
import './instrument.js';
import 'dotenv/config';
import { logger } from './logger.js';
import express, { NextFunction, type Request, Response } from "express";
import * as Sentry from '@sentry/node';
import { initializeFirebaseAdmin } from "./firebase-setup.js";
import { registerFirebaseRoutes } from "./firebase-routes.js";
import { registerRoutes } from "./routes.js";
import { log, serveStatic, setupVite } from "./vite.js";
import { registerSecurityMiddleware } from "./security.js";
import { pinoInstance } from "./logger.js";
import pinoHttp from 'pino-http';

const app = express();
// Set environment explicitly to match NODE_ENV
app.set('env', process.env.NODE_ENV || 'development');

// CRITICAL: Stripe webhooks require raw body for signature verification
// Must be registered BEFORE express.json() middleware
// Only apply to the exact webhook endpoint, not sub-routes like /manual-process-session
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }));

// JSON parsing for all other routes
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ limit: '12mb', extended: true }));

// Security middleware: Helmet (CSP, headers), CORS, Rate Limiting
registerSecurityMiddleware(app);

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();

// Structured request logging via pino-http
// Replaces the old manual request logger with structured JSON output
// Only logs /api/* requests (skips static assets and Vite HMR)
const isLocalDev = process.env.NODE_ENV === 'development' && !process.env.VERCEL;
app.use(pinoHttp({
  logger: pinoInstance,
  // Only log API requests, skip static assets
  autoLogging: {
    ignore: (req) => !req.url?.startsWith('/api'),
  },
  // Custom log level based on response status code
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Attach useful request metadata to each log line
  customProps: (req) => ({
    userAgent: req.headers['user-agent'],
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress,
  }),
  // Redact sensitive headers from logs
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      // Do NOT log authorization or cookie headers
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  // Use quiet mode in local dev (pino-pretty handles formatting)
  // In production, let pino-http output standard structured logs
  quietReqLogger: isLocalDev,
}));

// Track if routes have been initialized
let routesInitialized = false;

// Initialize routes immediately (top-level await)
const initPromise = (async () => {
  if (routesInitialized) return;

  try {
    log('[INIT] Starting route registration...');

    // Register traditional routes FIRST (includes admin PUT routes that must come before any catch-all)
    await registerRoutes(app);

    // ✅ FIREBASE AUTH ONLY - Modern JWT-based authentication (registered after specific routes)
    registerFirebaseRoutes(app);

    // Sentry error handler — MUST be before our custom error handler
    // Captures all Express errors and sends them to Sentry with full context
    Sentry.setupExpressErrorHandler(app);

    // Error handling middleware — MED-5: Sanitize error messages in production
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

      // In production, hide internal error details for 5xx errors
      const safeMessage = isProduction && status >= 500
        ? 'An unexpected error occurred. Please try again later.'
        : message;

      res.status(status).json({ message: safeMessage });
      // Structured error logging via Pino (replaces console.error)
      pinoInstance.error({ err, statusCode: status, path: _req.path }, `Express error handler [${status}]`);
    });

    routesInitialized = true;
    log('[ROUTES] All routes registered successfully');

    // Environment detection at runtime
    if (process.env.VERCEL) {
      // Serverless: Vercel expects default export
      log('[SERVERLESS] Running on Vercel - routes registered');
    } else {
      // Local development: start HTTP server
      const { createServer } = await import('http');
      const server = createServer(app);
      const port = process.env.PORT || (app.get("env") === "development" ? 5001 : 5000);

      // Setup Vite for hot reloading in development
      if (app.get("env") === "development") {
        await setupVite(app, server);
      } else {
        serveStatic(app);
      }

      server.listen(port, () => {
        log(`[LOCAL] Server running on http://localhost:${port}`);
      });
    }
  } catch (error) {
    logger.error('Failed to register routes:', error);
    throw error;
  }
})();

// Ensure routes are initialized before handling any requests
app.use(async (req, res, next) => {
  if (!routesInitialized) {
    await initPromise;
  }
  next();
});

// Export app for Vercel serverless (will be bundled by esbuild)
export default app;
