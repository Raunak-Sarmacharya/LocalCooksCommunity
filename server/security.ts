/**
 * Security Middleware Configuration
 * 
 * Centralizes all security middleware: Helmet, CORS, Rate Limiting.
 * Rate limits are admin-configurable via platform_settings table.
 * 
 * Development defaults are intentionally lower to catch issues early.
 * Production values should be tuned via the admin dashboard.
 */

import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import type { Express } from 'express';
import { db } from './db';
import { sql } from 'drizzle-orm';

// ===================================
// TYPES
// ===================================

interface RateLimitConfig {
  globalWindowMs: number;       // Global rate limit window in ms
  globalMaxRequests: number;    // Max requests per window (global)
  authWindowMs: number;         // Auth endpoint window in ms
  authMaxRequests: number;      // Max auth requests per window
  apiWindowMs: number;          // API endpoint window in ms
  apiMaxRequests: number;       // Max API requests per window
  webhookWindowMs: number;      // Webhook endpoint window in ms
  webhookMaxRequests: number;   // Max webhook requests per window
}

// Development-friendly defaults (lower limits to catch issues)
const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  globalWindowMs: 15 * 60 * 1000,    // 15 minutes
  globalMaxRequests: 300,              // 300 requests per 15 min (dev-friendly)
  authWindowMs: 15 * 60 * 1000,       // 15 minutes
  authMaxRequests: 15,                 // 15 auth attempts per 15 min
  apiWindowMs: 1 * 60 * 1000,         // 1 minute
  apiMaxRequests: 60,                  // 60 API calls per minute
  webhookWindowMs: 1 * 60 * 1000,     // 1 minute
  webhookMaxRequests: 100,             // 100 webhook calls per minute (Stripe bursts)
};

// In-memory cache for rate limit config (refreshed periodically)
let cachedConfig: RateLimitConfig = { ...DEFAULT_RATE_LIMITS };
let lastConfigFetch = 0;
const CONFIG_CACHE_TTL = 60_000; // Refresh config every 60 seconds

// ===================================
// CONFIG LOADER
// ===================================

/**
 * Load rate limit configuration from platform_settings table.
 * Falls back to defaults if settings don't exist yet.
 */
async function loadRateLimitConfig(): Promise<RateLimitConfig> {
  const now = Date.now();
  if (now - lastConfigFetch < CONFIG_CACHE_TTL) {
    return cachedConfig;
  }

  try {
    const result = await db.execute(sql`
      SELECT key, value FROM platform_settings 
      WHERE key LIKE 'rate_limit_%'
    `);

    const settings: Record<string, string> = {};
    for (const row of result.rows as Array<{ key: string; value: string }>) {
      settings[row.key] = row.value;
    }

    cachedConfig = {
      globalWindowMs: parseInt(settings['rate_limit_global_window_ms'] || '') || DEFAULT_RATE_LIMITS.globalWindowMs,
      globalMaxRequests: parseInt(settings['rate_limit_global_max'] || '') || DEFAULT_RATE_LIMITS.globalMaxRequests,
      authWindowMs: parseInt(settings['rate_limit_auth_window_ms'] || '') || DEFAULT_RATE_LIMITS.authWindowMs,
      authMaxRequests: parseInt(settings['rate_limit_auth_max'] || '') || DEFAULT_RATE_LIMITS.authMaxRequests,
      apiWindowMs: parseInt(settings['rate_limit_api_window_ms'] || '') || DEFAULT_RATE_LIMITS.apiWindowMs,
      apiMaxRequests: parseInt(settings['rate_limit_api_max'] || '') || DEFAULT_RATE_LIMITS.apiMaxRequests,
      webhookWindowMs: parseInt(settings['rate_limit_webhook_window_ms'] || '') || DEFAULT_RATE_LIMITS.webhookWindowMs,
      webhookMaxRequests: parseInt(settings['rate_limit_webhook_max'] || '') || DEFAULT_RATE_LIMITS.webhookMaxRequests,
    };

    lastConfigFetch = now;
  } catch (error) {
    // DB not ready yet (startup) or settings table doesn't have these keys — use defaults
    console.log('[Security] Using default rate limits (DB config not available)');
  }

  return cachedConfig;
}

/** Force refresh of cached config (called by admin update endpoint) */
export function invalidateRateLimitCache(): void {
  lastConfigFetch = 0;
}

/** Get current rate limit config (for admin GET endpoint) */
export async function getRateLimitConfig(): Promise<RateLimitConfig> {
  return loadRateLimitConfig();
}

/** Get defaults (for admin UI reference) */
export function getDefaultRateLimits(): RateLimitConfig {
  return { ...DEFAULT_RATE_LIMITS };
}

// ===================================
// CORS CONFIGURATION
// ===================================

function getCorsOrigins(): (string | RegExp)[] {
  const origins: (string | RegExp)[] = [
    'https://localcooks.ca',
    'https://www.localcooks.ca',
    'https://chef.localcooks.ca',
    'https://kitchen.localcooks.ca',
    'https://admin.localcooks.ca',
    // Dev environment subdomains (Vercel Preview deployment)
    'https://dev.localcooks.ca',
    'https://dev-chef.localcooks.ca',
    'https://dev-kitchen.localcooks.ca',
    'https://dev-admin.localcooks.ca',
    // Vercel preview deployments
    /^https:\/\/local-cooks-community.*\.vercel\.app$/,
  ];

  // Development origins
  if (process.env.NODE_ENV === 'development' || !process.env.VERCEL) {
    origins.push('http://localhost:5001');
    origins.push('http://localhost:5173');
    origins.push('http://localhost:3000');
    origins.push(/^http:\/\/localhost:\d+$/);
    // Subdomain-based dev origins (kitchen.localhost, chef.localhost, admin.localhost)
    origins.push(/^http:\/\/[a-z]+\.localhost:\d+$/);
  }

  // Custom origins from env (comma-separated)
  const customOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (customOrigins) {
    customOrigins.split(',').map(o => o.trim()).filter(Boolean).forEach(o => origins.push(o));
  }

  return origins;
}

// ===================================
// HTML SANITIZATION UTILITY
// ===================================

/**
 * Escape HTML special characters to prevent XSS in email templates
 * and error messages that may be rendered in HTML context.
 */
export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Sanitize error messages for client responses.
 * In production, strip internal details. In dev, pass through.
 */
export function sanitizeErrorForClient(error: unknown, fallbackMessage: string): string {
  if (process.env.NODE_ENV === 'development') {
    return error instanceof Error ? error.message : fallbackMessage;
  }
  // Production: never leak internal error details
  return fallbackMessage;
}

// ===================================
// MIDDLEWARE REGISTRATION
// ===================================

export function registerSecurityMiddleware(app: Express): void {
  const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

  // ─── HELMET (Security Headers) ───
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",  // Required for Vite HMR in dev
          "'unsafe-eval'",    // Required for Vite HMR in dev
          "https://js.stripe.com",
          "https://code.tidio.co",
          "https://widget-v4.tidiochat.com",
          "https://maps.googleapis.com",
          "https://apis.google.com",
          "https://accounts.google.com",
          "https://www.gstatic.com",
          ...(isProduction ? [] : ["http://localhost:*"]),
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
        connectSrc: [
          "'self'",
          "https://api.stripe.com",
          "https://*.firebaseio.com",
          "https://*.googleapis.com",
          "https://*.cloudfunctions.net",
          "https://code.tidio.co",
          "https://widget-v4.tidiochat.com",
          "wss://*.tidiochat.com",
          "https://files.localcooks.ca",
          ...(isProduction ? ["https://*.localcooks.ca"] : ["http://localhost:*", "ws://localhost:*"]),
        ],
        frameSrc: [
          "'self'",
          "https://js.stripe.com",
          "https://hooks.stripe.com",
          "https://widget-v4.tidiochat.com",
          "https://accounts.google.com",
          "https://*.firebaseapp.com",
        ],
        mediaSrc: [
          "'self'",
          "https://pub-dc8137b10b784e3e9f6c75b8d78ca468.r2.dev",
          "blob:",
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,  // Required for Stripe/Tidio iframes
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // Required for OAuth popups
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin images
  }));

  // ─── CORS ───
  app.use(cors({
    origin: getCorsOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400, // Cache preflight for 24 hours
  }));

  // ─── RATE LIMITING ───

  // Global rate limit (applies to all routes)
  const globalLimiter = rateLimit({
    windowMs: DEFAULT_RATE_LIMITS.globalWindowMs,
    max: async () => {
      const config = await loadRateLimitConfig();
      return config.globalMaxRequests;
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
    skip: (req) => {
      // Skip rate limiting for Stripe webhooks (they have their own signature verification)
      if (req.path === '/api/webhooks/stripe') return true;
      // In development, only rate-limit /api/ routes — skip Vite asset requests
      // (/@fs/, /src/, /node_modules/, static files, HMR, etc.)
      if (!isProduction && !req.path.startsWith('/api/')) return true;
      return false;
    },
    // In production (behind Vercel proxy), use X-Forwarded-For; in dev, use default
    ...(isProduction ? {
      keyGenerator: (req: any) => {
        return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
      },
    } : {}),
    validate: false,
  });
  app.use(globalLimiter);

  // Strict rate limit for authentication endpoints
  const authLimiter = rateLimit({
    windowMs: DEFAULT_RATE_LIMITS.authWindowMs,
    max: async () => {
      const config = await loadRateLimitConfig();
      return config.authMaxRequests;
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please wait before trying again.' },
    ...(isProduction ? {
      keyGenerator: (req: any) => {
        return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
      },
    } : {}),
    validate: false,
  });

  // Apply strict limiter to auth-sensitive endpoints
  app.use('/api/portal-login', authLimiter);
  app.use('/api/firebase-register-user', authLimiter);
  app.use('/api/firebase-sync-user', authLimiter);
  app.use('/api/user-exists', authLimiter);

  // Webhook-specific rate limit (higher ceiling for Stripe event bursts)
  const webhookLimiter = rateLimit({
    windowMs: DEFAULT_RATE_LIMITS.webhookWindowMs,
    max: async () => {
      const config = await loadRateLimitConfig();
      return config.webhookMaxRequests;
    },
    standardHeaders: true,
    legacyHeaders: false,
    ...(isProduction ? {
      keyGenerator: (req: any) => {
        return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
      },
    } : {}),
    validate: false,
  });
  app.use('/api/webhooks', webhookLimiter);

  console.log(`[Security] Helmet, CORS, and Rate Limiting configured (env: ${isProduction ? 'production' : 'development'})`);
}
