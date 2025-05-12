# Vercel Deployment Guide for Local Cooks

This guide provides step-by-step instructions for deploying your Local Cooks application to Vercel.

## Prerequisites

1. A Vercel account
2. PostgreSQL database (we recommend Neon.tech for serverless compatibility)
3. Local Cooks codebase properly configured for deployment

## Environment Variables

You must set up the following environment variables in your Vercel project settings:

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | Connection string for your PostgreSQL database | Yes |
| `SESSION_SECRET` | Secret key for session encryption (generate a secure random string) | Yes |
| `NODE_ENV` | Set to "production" for deployment | Yes |
| `GOOGLE_CLIENT_ID` | For Google OAuth authentication | Optional |
| `GOOGLE_CLIENT_SECRET` | For Google OAuth authentication | Optional |
| `FACEBOOK_APP_ID` | For Facebook OAuth authentication | Optional |
| `FACEBOOK_APP_SECRET` | For Facebook OAuth authentication | Optional |

## Deployment Steps

1. **Create a New Project in Vercel**
   - From the Vercel dashboard, click "Add New" > "Project"
   - Import your GitHub repository

2. **Configure Environment Variables**
   - Go to "Settings" > "Environment Variables"
   - Add all required environment variables listed above

3. **Deploy the Project**
   - Vercel will automatically build and deploy your project
   - Build process is defined in `vercel-build.mjs`
   - API functionality is handled by `/api/index.js`

4. **Verify Deployment**
   - Check the deployment logs for any errors
   - Test authentication and user functionality
   - Test application submission forms

## Database Setup

Before deploying, make sure your database is properly set up:

1. **Create Database Tables**: 
   - See the [Neon Database Setup Guide](./neon-database-setup.md) for detailed instructions
   - You can either run SQL statements directly in Neon.tech's SQL editor
   - Or use Drizzle migrations locally with `npm run db:push`

2. **Environment Variables**:
   - Set your `DATABASE_URL` in Vercel's environment variables
   - Format: `postgres://username:password@hostname:port/database?sslmode=require`
   - For Neon.tech: Use the connection string provided in their dashboard
   - Set `SESSION_SECRET` to a secure random string

## Troubleshooting

### Issue: API Routes Return 404
- Make sure your `vercel.json` file has correct rewrites configuration
- Check that `/api/index.js` exists and is properly formatted

### Issue: Database Connection Errors
- Verify your `DATABASE_URL` is correct
- Make sure your IP is whitelisted in your database provider
- Check that the database schema has been created
- Running into "FUNCTION_INVOCATION_FAILED" errors? Make sure your database tables are initialized

### Issue: Authentication Problems
- Ensure `SESSION_SECRET` is properly set
- Check that cookies are being stored properly
- Verify OAuth credentials if using social login

### Issue: Build Failures
- Review build logs for specific errors
- Make sure dependencies are properly installed
- Ensure your code adheres to TypeScript standards

## Regular Maintenance

- Monitor database connection pooling and serverless function usage
- Update dependencies regularly
- Keep backup of production database