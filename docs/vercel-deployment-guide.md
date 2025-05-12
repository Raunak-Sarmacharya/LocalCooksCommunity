# Vercel Deployment Guide for Local Cooks

This guide provides step-by-step instructions for deploying the Local Cooks application to Vercel.

## Prerequisites

1. A Vercel account
2. A GitHub repository with your Local Cooks code
3. A PostgreSQL database (we recommend Neon.tech)

## Step 1: Set Up Environment Variables

Before deploying, you'll need to set up the following environment variables in Vercel:

- `DATABASE_URL` - The connection string to your PostgreSQL database
- `SESSION_SECRET` - A secure random string to encrypt sessions
- `NODE_ENV` - Set to `production`

Optional OAuth variables (if you're using social login):
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `FACEBOOK_CLIENT_ID`
- `FACEBOOK_CLIENT_SECRET`

## Step 2: Configure the Vercel Project

1. From your Vercel dashboard, click "Add New..." and select "Project"
2. Import your GitHub repository
3. Configure the project with these settings:
   - **Framework Preset**: Other
   - **Build Command**: `./vercel-build.sh`
   - **Output Directory**: `dist/client`
   - **Install Command**: `npm install`

4. Add your environment variables in the "Environment Variables" section

## Step 3: Deploy

1. Click "Deploy"
2. Vercel will build and deploy your application
3. Once completed, you can access your application at the provided URL

## Step 4: Configure Custom Domain (Optional)

1. Go to your project settings in Vercel
2. Navigate to "Domains"
3. Add your custom domain and follow the verification instructions

## Troubleshooting

If you encounter any issues with your deployment, refer to the `vercel-troubleshooting.md` document which covers common problems and their solutions.

### Common Issues

#### Issue: Build fails with "Output Directory is empty"

1. Check that the `vercel-build.sh` script is executable (`chmod +x vercel-build.sh`)
2. Verify that the script is properly creating files in the output directory
3. Check build logs in Vercel for specific errors

#### Issue: API Routes Not Working

Ensure your vercel.json configuration is correctly routing API requests to the serverless function.

## Deployment Architecture

The Local Cooks application on Vercel uses:

1. **Serverless Function**: The `/api` routes are handled by a serverless function (api/index.js)
2. **Static Assets**: The React frontend is served as static files
3. **External Database**: Data is stored in a PostgreSQL database

## Updating Your Deployment

To update your application after making changes:

1. Commit and push your changes to GitHub
2. Vercel will automatically detect the changes and redeploy
3. Monitor the deployment logs for any issues

## Best Practices

1. **Environment Variables**: Never commit sensitive information. Always use environment variables.
2. **Database Migrations**: Run database migrations during the build process or manually before deployment.
3. **Session Security**: In production, ensure cookies are secure and use a strong session secret.
4. **Error Logging**: Consider adding error logging services for production monitoring.
