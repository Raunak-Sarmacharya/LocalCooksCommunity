# Vercel Deployment Guide for Local Cooks

**Updated on May 12, 2025**

This guide provides step-by-step instructions for deploying the Local Cooks application on Vercel.

## Prerequisites

Before deploying, ensure you have:

1. A GitHub account with your Local Cooks repository
2. A Vercel account (can be created for free at [vercel.com](https://vercel.com))
3. A PostgreSQL database (recommended: [Neon](https://neon.tech) - has a free tier)

## Step 1: Set Up a PostgreSQL Database

1. **Create a Neon account** at [neon.tech](https://neon.tech)
2. **Create a new project** in the Neon dashboard
3. **Create a database** within your project
4. **Get your connection string** from the dashboard - it will look like:
   ```
   postgresql://username:password@hostname:port/database
   ```

## Step 2: Deploy on Vercel

### Option A: Deploy from GitHub

1. **Log in to Vercel** and click "Add New Project" 
2. **Import your repository** from GitHub
3. **Configure project settings**:
   - Select "Vite" as your Framework Preset (this is critical)
   - Keep default settings for Build and Output directory
   - The repository already includes a `vercel.json` configuration file

### Option B: Deploy with Vercel CLI

If you prefer to deploy using the Vercel CLI:

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy from your local project directory**:
   ```bash
   vercel
   ```

4. **Follow the CLI prompts** to set up your project

4. **Add Environment Variables** (click "Environment Variables" and add):
   - `DATABASE_URL`: Your Neon PostgreSQL connection string
   - `SESSION_SECRET`: A long, random string (e.g., generate one at [1password.com/password-generator](https://1password.com/password-generator/))
   - `NODE_ENV`: `production`

5. **Deploy** by clicking the "Deploy" button

## Step 3: Verify Deployment

1. **Wait for the build to complete** - Vercel will build and deploy your application
2. **Visit your new site** at the provided URL (e.g., `your-project-name.vercel.app`)
3. **Check for any issues** in the Vercel deployment logs

## Step 4: Database Migration

After deployment, you need to set up your database schema and create an admin user.

1. **Run migrations** to set up the database schema:
   
   Two options:
   
   a. **Through Vercel CLI** (recommended):
   ```bash
   # Install Vercel CLI if you haven't already
   npm install -g vercel
   
   # Login to Vercel
   vercel login
   
   # Pull environment variables to your local machine
   vercel env pull .env.production.local
   
   # Run the migration locally (which will use your production DB)
   NODE_ENV=production npm run db:push
   ```
   
   b. **Through Vercel's Function Shell**:
   - Go to your project in the Vercel dashboard
   - Navigate to Functions tab
   - Find your main function and click on it
   - Click "Shell" to get a terminal
   - Run: `npm run db:push`

2. **Create an admin user**:
   
   Use the Vercel CLI approach above, but run:
   ```bash
   NODE_ENV=production npm run create-admin
   ```
   
   This will prompt you for admin credentials.

## Troubleshooting

### Database Connection Issues

If your application can't connect to the database:

1. **Check your `DATABASE_URL`** environment variable in Vercel
2. **Ensure your IP is allowed** in Neon's connection settings
3. **Verify the database exists** in your Neon project

### Build Failures

If your build fails:

1. **Check Vercel build logs** for specific error messages
2. **Verify all dependencies** are correctly installed
3. **Check for missing environment variables** required at build time

### API Routes Not Working

If your API routes return 404:

1. **Check the Network tab** in browser DevTools to see the actual requests
2. **Verify API routes format** (they should be in the format `/api/...`)
3. **Check Vercel Function logs** to see if there are errors

## Post-Deployment Tasks

After successful deployment:

1. **Set up a custom domain** (optional) in Vercel project settings
2. **Configure analytics** (optional) in Vercel project settings
3. **Set up monitoring** to be alerted of any issues

## Maintenance

To update your application:

1. **Push changes** to your GitHub repository
2. **Vercel will automatically deploy** the new version

## Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Neon PostgreSQL Documentation](https://neon.tech/docs/introduction)
- [Production Database Setup](./production-database-setup.md)