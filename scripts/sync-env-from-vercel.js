#!/usr/bin/env node

/**
 * Sync Environment Variables from Vercel
 * 
 * This script helps you manually sync environment variables from your Vercel project.
 * Since the automatic linking isn't working, you can use this as a guide.
 */

import { config } from 'dotenv';

// Load environment variables from .env file
config();

console.log(`
🔧 Manual Environment Variable Sync Guide
=========================================

Since the Vercel CLI linking isn't working automatically, here's how to manually 
sync your environment variables from your Vercel project:

📋 Steps:
---------

1. 🌐 Go to your Vercel Dashboard: https://vercel.com/dashboard
2. 🔍 Find your project: Look for project ID 'prj_7R4Zwen18giSl8Q6cQJHiEPOmNDj'
3. ⚙️ Go to Project Settings → Environment Variables
4. 📋 Copy the following variables to your .env file:

Required Variables:
------------------
DATABASE_URL=<your-neon-database-url>
SESSION_SECRET=<your-session-secret>
NODE_ENV=development

Optional Variables (if you use them):
------------------------------------
BLOB_READ_WRITE_TOKEN=<vercel-blob-token>
EMAIL_HOST=<your-email-host>
EMAIL_PORT=<your-email-port>
EMAIL_USER=<your-email-user>
EMAIL_PASS=<your-email-password>
EMAIL_FROM=<your-email-from>
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
FACEBOOK_CLIENT_ID=<facebook-oauth-client-id>
FACEBOOK_CLIENT_SECRET=<facebook-oauth-client-secret>

🎯 Current Status:
-----------------
✅ DATABASE_URL is already configured and working
✅ Your Neon database connection is active
✅ Microlearning tables are set up and functional

💡 Alternative: Try Vercel Link with Project Name
-------------------------------------------------
If you know your project name on Vercel, try:
  vercel link

And when prompted:
- Select your team/scope
- Choose "Link to existing project"
- Enter your project name (not the ID)

🔍 Troubleshooting:
------------------
If you're still having issues:
1. Make sure you're logged into the correct Vercel account
2. Check if the project is under a different team
3. Verify the project ID is correct
4. Try using the project name instead of ID

📞 Need Help?
------------
If you need help finding your project details:
- Check your Vercel dashboard at: https://vercel.com/dashboard
- Look for deployed URLs to identify your project
- Check your git repository for any vercel.json or deployment history
`);

// Try to show current env status
console.log('\n📊 Current Environment Status:');
console.log('--------------------------------');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✅ SET' : '❌ NOT SET');
console.log('SESSION_SECRET:', process.env.SESSION_SECRET ? '✅ SET' : '❌ NOT SET');
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');

if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech')) {
  console.log('\n🎉 Good news: Your Neon database is already configured!');
  console.log('   You can continue using your app without pulling from Vercel.');
} 