import 'dotenv/config';
import express, { NextFunction, type Request, Response } from "express";
import { initializeFirebaseAdmin } from "./firebase-admin";
import { registerFirebaseRoutes } from "./firebase-routes";
import { registerRoutes } from "./routes";
import { log, serveStatic, setupVite } from "./vite";

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ limit: '12mb', extended: true }));

// Initialize Firebase Admin SDK
initializeFirebaseAdmin();

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

(async () => {
  // Register traditional routes FIRST (includes admin PUT routes that must come before any catch-all)
  await registerRoutes(app);
  
  // ✅ FIREBASE AUTH ONLY - Modern JWT-based authentication (registered after specific routes)
  registerFirebaseRoutes(app);
  
  // Create HTTP server for Firebase-only architecture
  const { createServer } = await import('http');
  const server = createServer(app);

  // Warm up vehicle data cache on server startup
  try {
    log('🚗 Warming up vehicle data cache on server startup...');
    const baseUrl = `http://localhost:5000`;
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

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen(port, () => {
    log(`serving on port ${port}`);
  });
})();
