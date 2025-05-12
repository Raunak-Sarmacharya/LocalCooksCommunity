// This file is used as the serverless entry point for Vercel
import express from 'express';
import session from 'express-session';
import { createServer } from 'http';
import { storage } from '../dist/storage.js';
import { setupAuth } from '../dist/auth.js';
import { registerRoutes } from '../dist/routes.js';

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