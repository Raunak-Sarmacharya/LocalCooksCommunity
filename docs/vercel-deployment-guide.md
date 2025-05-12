# Vercel Deployment Guide for Local Cooks

This guide will help you deploy your Local Cooks application to Vercel successfully.

## Pre-Deployment Checklist

Before deploying to Vercel, ensure:

1. You have a Neon PostgreSQL database set up (see `docs/neon-database-setup.md`)
2. All necessary database tables are created (use the SQL script in the database setup guide)
3. All code changes are committed to your GitHub repository
4. You have Vercel account with access to deploy the application

## Environment Variables

Set these environment variables in your Vercel project settings:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Your Neon database connection string | `postgresql://user:password@host/database` |
| `SESSION_SECRET` | A strong random string used to secure sessions | `random-string-at-least-32-characters` |
| `NODE_ENV` | The application environment | `production` |

## Deployment Steps

1. **Connect Your Repository**
   - Go to Vercel dashboard and click "New Project"
   - Import your GitHub repository
   - Configure project settings

2. **Configure Build Settings**
   - Framework Preset: Other
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`

3. **Add Environment Variables**
   - Add the variables listed above in the Environment Variables section
   - You can set different values for Production, Preview, and Development environments

4. **Deploy**
   - Click "Deploy" to start the deployment process
   - Vercel will build and deploy your application

## Post-Deployment

After successful deployment:

1. **Verify API Endpoints**
   - Test `/api/health` to verify database connectivity
   - Test `/api/user` to verify authentication system

2. **Monitor Logs**
   - Check Vercel logs for any errors
   - Pay attention to serverless function logs for API issues

3. **Setting Up Custom Domain (Optional)**
   - In your Vercel project dashboard, go to "Domains"
   - Add your custom domain and follow Vercel's instructions to set up DNS

## Troubleshooting Common Issues

If you encounter issues with your deployment:

1. **Database Connection Problems**
   - Ensure your DATABASE_URL is correct
   - Check that your Neon database is active and accessible
   - Verify IP restrictions if applicable

2. **Authentication Issues**
   - Make sure SESSION_SECRET is properly set
   - Check that cookies are being set correctly

3. **Function Timeouts or Memory Errors**
   - See `vercel.json` settings for function configuration
   - Optimize database queries for better performance

For more detailed troubleshooting, see `docs/vercel-troubleshooting.md`.

## Automating Deployments

For continuous deployment:

1. Configure GitHub integration in Vercel
2. Vercel will automatically deploy when you push to your main branch
3. You can set up preview deployments for pull requests

## Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Neon Serverless Documentation](https://neon.tech/docs/serverless)
- [Troubleshooting Vercel Deployments](docs/vercel-troubleshooting.md)
- [Neon Database Setup](docs/neon-database-setup.md)