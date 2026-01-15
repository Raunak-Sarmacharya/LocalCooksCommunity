import 'dotenv/config';
import express, { NextFunction, type Request, Response } from "express";
import { initializeFirebaseAdmin } from "./firebase-admin";
import { registerFirebaseRoutes } from "./firebase-routes";
import { registerRoutes } from "./routes";
import { log, serveStatic, setupVite } from "./vite";

const app = express();
// Set environment explicitly to match NODE_ENV
app.set('env', process.env.NODE_ENV || 'development');
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ limit: '12mb', extended: true }));

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

    // Error handling middleware
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      res.status(status).json({ message });
      console.error(err);
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
      
      // Warmup cache on startup (local only)
      try {
        log('🚗 Warming up vehicle data cache on server startup...');
        const baseUrl = `http://localhost:${port}`;
        const preloadResponse = await fetch(`${baseUrl}/api/vehicles/preload`);
        if (preloadResponse.ok) {
          const preloadData = await preloadResponse.json();
          log(`🚗 Vehicle data cache warmed up successfully: ${preloadData.makesCount} makes, ${preloadData.modelsCount} models`);
        } else {
          log('⚠️ Vehicle data cache warmup failed, will load on-demand');
        }
      } catch (error) {
        log('⚠️ Vehicle data cache warmup failed, will load on-demand:', String(error));
      }
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
