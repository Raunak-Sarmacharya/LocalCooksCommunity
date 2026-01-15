# Unified Entry Point Architecture

## Overview

This project now uses a **single unified entry point** for all API requests, consolidating from multiple separate API files to a single, maintainable architecture.

## Entry Point

**Single Entry Point:** `api/index.js`
- **Source:** `server/index.ts`
- **Build Process:** Bundled by esbuild during `npm run build:production`
- **Location:** Generated in `/api/index.js` for Vercel deployment

## Architecture

```
server/index.ts (source)
    ↓
dist/server/index.js (compiled TypeScript)
    ↓
api/index.js (bundled for Vercel) ← SINGLE ENTRY POINT
```

## Route Registration

All routes are registered in:
- `server/routes.ts` - Main route definitions
- `server/firebase-routes.ts` - Firebase authentication routes

These are imported and registered by `server/index.ts`, which exports the Express app as the default export for Vercel serverless functions.

## Deprecated Files

The following files in `/api/` are **deprecated** and marked for removal:

- `api/unsubscribe.js` → Now in `server/routes.ts` (POST `/api/unsubscribe`)
- `api/process-payouts.js` → Now in `server/routes.ts` (POST `/api/process-payouts`)
- `api/get-users.js` → Now in `server/routes.ts` (GET `/api/get-users`)
- `api/user-exists.js` → Now in `server/routes.ts` (GET `/api/user-exists`)

These files are kept temporarily for backward compatibility but should not be used. All functionality has been moved to the unified routes.

## Vercel Configuration

`vercel.json` routes all API requests through the unified entry point:

```json
{
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/api/index.js"
    }
  ],
  "functions": {
    "api/index.js": {
      "memory": 1024,
      "maxDuration": 30
    }
  }
}
```

## Build Process

The build process (`vercel-build.mjs`) ensures only one entry point is created:

1. **Frontend:** Vite builds client to `dist/client/`
2. **Server:** TypeScript compiles server code to `dist/server/`
3. **Bundle:** esbuild bundles `dist/server/index.js` → `api/index.js`
4. **Result:** Single `api/index.js` file handles all API requests

## Benefits

✅ **Single Source of Truth:** All routes defined in one place (`server/routes.ts`)
✅ **Easier Maintenance:** No duplicate route definitions
✅ **Better Type Safety:** TypeScript throughout the server codebase
✅ **Simplified Deployment:** One entry point to manage
✅ **Consistent Behavior:** All routes use the same middleware and error handling

## Migration Notes

- All API routes now go through `server/routes.ts`
- No need to create separate files in `/api/` directory
- Vercel cron jobs (like `/api/process-payouts`) work through the unified entry point
- The build process automatically creates `api/index.js` from `server/index.ts`

## Future Cleanup

Once confirmed working in production, the deprecated files in `/api/` can be safely removed:
- `api/unsubscribe.js`
- `api/process-payouts.js`
- `api/get-users.js`
- `api/user-exists.js`

Note: `api/certificateGenerator.js` and `api/check-users.js` are utility scripts, not API endpoints, and can remain.
