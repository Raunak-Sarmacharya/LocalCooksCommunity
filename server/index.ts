import 'dotenv/config';
import express, { NextFunction, type Request, Response } from "express";
import { initializeFirebaseAdmin } from "./firebase-setup.js";
import { registerFirebaseRoutes } from "./firebase-routes.js";
import { registerRoutes } from "./routes.js";
import { log, serveStatic, setupVite } from "./vite.js";
import { registerSecurityMiddleware } from "./security.js";

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

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

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
      // Always log full error server-side
      console.error(`[Error ${status}]`, err);
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
    console.error('Failed to register routes:', error);
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
