# Vercel Production Environment Setup

## 🚨 IMMEDIATE VERCEL DEPLOYMENT FIXES

### 1. **Set Environment Variables in Vercel Dashboard**

Go to your Vercel project → Settings → Environment Variables and add:

#### Critical Email Configuration (REQUIRED)
```
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-app@gmail.com
EMAIL_PASS=your-16-character-app-password
EMAIL_FROM=Local Cooks Community <your-app@gmail.com>
```

#### Required Base URLs
```
BASE_URL=https://local-cooks-community.vercel.app
API_BASE_URL=https://local-cooks-community.vercel.app/api
NODE_ENV=production
```

#### Database (Already configured)
```
DATABASE_URL=postgresql://neondb_owner:npg_0iWHQMCtAmB8@ep-dry-bird-a4idwge9-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require
```

#### Session Security
```
SESSION_SECRET=your-secure-production-session-secret-32-chars-min
```

### 2. **Run Database Migration in Production**

Connect to your Neon database and run:

```sql
-- Add required tables for password reset and email verification
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_email ON email_verification_tokens(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token);
```

### 3. **Deploy Updated Code**

After setting environment variables:

```bash
# Commit all changes
git add .
git commit -m "Add production email and auth fixes"
git push

# Vercel will automatically deploy
```

## 🧪 TESTING PRODUCTION ENVIRONMENT

### Test Email Configuration
1. Go to `https://local-cooks-community.vercel.app/admin`
2. Use "Status Email Test" component
3. Enter a test email and send
4. Check if you receive the email

### Test Registration Email Verification
1. Try registering a new account on production
2. You should receive a verification email

### Test Password Reset
1. Go to production login page
2. Enter your email
3. Click "Forgot your password?"
4. Check your email for reset link

### Test Application Submission Emails
1. Submit a new application on production
2. Check if you receive the "In Review" email

## 🎥 PRODUCTION VIDEO NAVIGATION

The video navigation fix has been applied to the frontend code, which will work automatically once deployed.

## 📧 PRODUCTION EMAIL SETUP STEPS

### Option A: Gmail Setup (Recommended)
1. **Create a dedicated Gmail account** for your app (e.g., `localcooks.noreply@gmail.com`)
2. **Enable 2-Factor Authentication**
3. **Generate App Password:**
   - Google Account → Security
   - App passwords → Generate new app password for "Mail"
   - Use the 16-character code as `EMAIL_PASS`

### Option B: Professional Email Service
For better deliverability, consider:
- **SendGrid** (Free tier: 100 emails/day)
- **Mailgun** (Free tier: 5,000 emails/month)
- **Amazon SES** (Pay per use)

## 🔧 VERCEL DEPLOYMENT CHECKLIST

### Pre-Deployment
- [ ] All environment variables set in Vercel dashboard
- [ ] Database migration completed
- [ ] Email credentials tested locally

### Post-Deployment  
- [ ] Test email functionality on production
- [ ] Test registration email verification
- [ ] Test password reset
- [ ] Test application submission emails
- [ ] Test video navigation
- [ ] Check Vercel function logs for errors

## 🚨 COMMON PRODUCTION ISSUES

### 1. Emails Not Sending
**Symptoms**: No emails received, server logs show email errors
**Solutions**:
- Verify environment variables are set in Vercel
- Check email credentials are correct
- Ensure EMAIL_FROM matches EMAIL_USER domain
- Check Vercel function logs for SMTP errors

### 2. Video Navigation Not Working
**Symptoms**: Cannot proceed to video 2 after completing video 1
**Solutions**:
- Check browser console for JavaScript errors
- Verify user progress is being saved to database
- Redeploy if frontend code wasn't updated

### 3. Database Connection Issues
**Symptoms**: Authentication errors, cannot save data
**Solutions**:
- Verify DATABASE_URL is correct in Vercel
- Check Neon database is active
- Run database migration if tables are missing

### 4. Session Issues
**Symptoms**: Users get logged out, auth state not persistent
**Solutions**:
- Verify SESSION_SECRET is set in Vercel
- Check session table exists in database
- Ensure cookies are working (HTTPS required in production)

## 🔍 DEBUGGING PRODUCTION

### Check Vercel Function Logs
1. Go to Vercel Dashboard → Your Project → Functions
2. Click on `api/index.js` function
3. View real-time logs to see errors

### Test Endpoints Directly
```bash
# Test forgot password
curl -X POST https://local-cooks-community.vercel.app/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# Test email verification
curl -X POST https://local-cooks-community.vercel.app/api/auth/send-verification-email \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","fullName":"Test User"}'
```

## 📞 IMMEDIATE ACTIONS REQUIRED

1. **Set environment variables in Vercel** ← CRITICAL
2. **Run database migration on Neon**
3. **Deploy updated code**
4. **Test all email functionality**

Without step 1, no emails will work in production!

## 🎯 PRODUCTION FEATURES NOW AVAILABLE

✅ **Application Submission Emails** - Users receive "In Review" emails
✅ **Email Verification** - Registration sends verification emails  
✅ **Password Reset** - Forgot password functionality works
✅ **Video Navigation** - Can proceed to video 2 after completing video 1
✅ **Document Verification Emails** - Admin document approvals send emails

All functionality will work once environment variables are properly configured! 