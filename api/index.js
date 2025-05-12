// This file is used as the serverless entry point for Vercel
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import express from 'express';
import session from 'express-session';
import { setupAuth } from '../dist/auth.js';
import { registerRoutes } from '../dist/routes.js';
import { serveStatic } from '../dist/vite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

// Session configuration
const sessionSecret = process.env.SESSION_SECRET || 'local-cooks-session-secret';
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
  }
}));

// Set up authentication
setupAuth(app);

// Register API routes
const server = await registerRoutes(app);

// Serve static files
if (process.env.NODE_ENV === 'production') {
  const distPath = resolve(__dirname, '../dist/client');
  app.use(express.static(distPath));
  
  // For SPA routing, serve index.html for any unmatched routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(resolve(distPath, 'index.html'));
    }
  });
}

// Start the server
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Export for serverless use
export default app;