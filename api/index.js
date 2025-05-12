// This file is used as the serverless entry point for Vercel
import express from 'express';
import session from 'express-session';
import { createServer } from 'http';

// In Vercel Serverless Functions, we need to directly import from the source files
// since they are bundled together during deployment
import { MemStorage } from '../server/storage.js';
import { setupAuth } from '../server/auth.js';
import { registerRoutes } from '../server/routes.js';

// Create a storage instance directly here for the serverless function
const storage = new MemStorage();

// Initialize Express app
const app = express();

// Body parser middleware
app.use(express.json());

// Session configuration
const sessionSecret = process.env.SESSION_SECRET || 'local-cooks-session-secret';
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: storage.sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
  }
}));

// Set up authentication
setupAuth(app);

// Register API routes
const httpServer = await registerRoutes(app);

// Export the Express app for Vercel serverless functions
export default app;