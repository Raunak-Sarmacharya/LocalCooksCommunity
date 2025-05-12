# Vercel Deployment Troubleshooting Guide

If you encounter issues with your Vercel deployment of Local Cooks, this guide will help you diagnose and fix common problems.

## Issue: Seeing Raw JavaScript Code Instead of Application

If you're seeing raw JavaScript code (e.g., `var __defProp = Object.defineProperty;`) instead of your application, the issue is related to how Vercel is serving your files.

### Solution:

1. **Check your vercel.json configuration**:
   Make sure your configuration properly directs traffic to the right places:

   ```json
   {
     "version": 2,
     "buildCommand": "./vercel-build.sh",
     "outputDirectory": "dist/client",
     "rewrites": [
       {
         "source": "/api/(.*)",
         "destination": "/api/index.js"
       },
       {
         "source": "/(.*)",
         "destination": "/"
       }
     ],
     "functions": {
       "api/index.js": {
         "memory": 1024,
         "maxDuration": 10
       }
     }
   }
   ```

2. **Verify build outputs**:
   In your Vercel deployment logs, check that both client and server files are being built correctly.

3. **Inspect output directory**:
   Vercel should be serving static files from `dist/client` and API routes from `api/index.js`.

## Issue: Database Connection Problems

If the application loads but can't connect to the database:

### Solution:

1. **Double-check environment variables**:
   Make sure `DATABASE_URL` is correctly set in your Vercel project settings.

2. **Verify database connectivity**:
   - Make sure your database (e.g., Neon) allows connections from Vercel's IP ranges
   - Check that the database is running and accessible

3. **Enable debug logs**:
   Add a temporary debug route to your API to test database connectivity:

   ```javascript
   app.get('/api/debug/db', async (req, res) => {
     try {
       const result = await db.execute(sql`SELECT 1 as test`);
       res.json({ success: true, result });
     } catch (error) {
       res.status(500).json({ success: false, error: error.message });
     }
   });
   ```

## Issue: Authentication Not Working

If users cannot log in or register:

### Solution:

1. **Session secret**:
   Ensure `SESSION_SECRET` environment variable is set in Vercel.

2. **Check cookie settings**:
   For production, cookies should be set with appropriate security settings:

   ```javascript
   cookie: {
     secure: process.env.NODE_ENV === 'production',
     sameSite: 'lax',
     maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
   }
   ```

3. **Verify OAuth configuration** (if using Google/Facebook login):
   Make sure the redirect URIs in your OAuth provider settings match your production URL.

## Issue: API Routes Return 404

If your API endpoints are not found:

### Solution:

1. **Check API rewrite rules**:
   Ensure your vercel.json has proper rewrites for API routes:

   ```json
   "rewrites": [
     {
       "source": "/api/(.*)",
       "destination": "/api/index.js"
     }
   ]
   ```

2. **Verify server-side code**:
   Make sure your API routes are correctly defined in your server code.

3. **Check API function path**:
   Ensure the `api/index.js` path is correct and the file exists.

## Debugging Tips

### Enable Vercel Debug Mode

Add a `DEBUG` environment variable set to `true` in your Vercel project settings.

### Examine Function Logs

In the Vercel dashboard:
1. Go to your project
2. Click on "Functions"
3. Find your API function
4. View the execution logs to see errors

### Test Locally with Vercel CLI

```bash
npm install -g vercel
vercel dev
```

This will run your project locally using Vercel's development environment.

## Resolving Common Error Messages

### "Cannot find module '...'"
- Check that all dependencies are installed in your package.json
- Verify that the import paths match the file structure

### "Error connecting to database"
- Confirm DATABASE_URL is correct
- Check network access to your database
- Verify database credentials

### "No such file or directory"
- Check that file paths are correct for your deployment environment
- Verify that the build process is creating all necessary files

## After Making Changes

After fixing issues:

1. Commit your changes to Git
2. Redeploy to Vercel with:
   ```bash
   vercel --prod
   ```

Or trigger a new deployment from the Vercel dashboard.