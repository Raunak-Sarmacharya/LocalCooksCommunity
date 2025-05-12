# Vercel Deployment Troubleshooting Guide

This document addresses specific issues encountered when deploying the Local Cooks application to Vercel and provides solutions.

## TypeScript Errors in Authentication System

### Problem:
Typescript errors related to OAuth fields like `instagramId` and `twitterId` that were not defined in the schema.

### Solution:
1. We simplified the user schema to only include necessary fields:
   - Updated `shared/schema.ts` to use a more explicit Zod schema without fields that cause TypeScript errors
   - Removed references to unused OAuth providers (Twitter, Instagram)

2. For serverless deployment:
   - Created separate simplified versions of storage and authentication in `/api/storage.js`
   - Used plain JavaScript for the API functions to avoid TypeScript compilation issues

## Routing Configuration Errors

### Problem:
Vercel's routing system was conflicting with the application's routes, resulting in 404 errors.

### Solution:
1. Updated `vercel.json` to use `rewrites` instead of `routes`:
   ```json
   "rewrites": [
     {
       "source": "/api/(.*)",
       "destination": "/api/index.js"
     },
     {
       "source": "/(.*)",
       "destination": "/index.html"
     }
   ]
   ```

2. Made the API handler export as the default function for Vercel serverless:
   ```javascript
   export default app;
   ```

## Session Management in Serverless Environment

### Problem:
Vercel's serverless functions don't maintain state between invocations, causing session data to be lost.

### Solution:
1. Implemented a simplified in-memory session store for development purposes
2. For production:
   - Use database-backed session storage (`connect-pg-simple`)
   - Set proper cookie settings for secure environments
   - Ensure `SESSION_SECRET` environment variable is set

## Database Connectivity Issues

### Problem:
Connection pooling issues with PostgreSQL in serverless environments.

### Solution:
1. Used `@neondatabase/serverless` for better serverless compatibility
2. Configured the database client with proper connection pooling:
   ```javascript
   neonConfig.webSocketConstructor = ws;
   export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
   ```

3. Set appropriate timeouts and connection limits for serverless functions

## Build Process Customization

### Problem:
Vercel's default build process wasn't properly handling the application structure.

### Solution:
1. Created custom build scripts:
   - `vercel-build.mjs` for the client
   - `api-build.mjs` for the API functions

2. Modified the build output paths to match Vercel's expected structure

## OAuth Provider Configuration

### Problem:
OAuth providers were causing errors when environment variables weren't set.

### Solution:
1. Made OAuth configuration conditional:
   ```javascript
   if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
     // Configure Google OAuth
   } else {
     console.log("Google OAuth strategy not configured - missing environment variables");
   }
   ```

2. Added clear error messages when authentication fails due to missing OAuth configuration