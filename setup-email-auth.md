# Email & Authentication Setup Guide

## 🚨 IMMEDIATE FIXES NEEDED

### 1. **Email Configuration** (CRITICAL - No emails will work without this)

**Current Issue**: Your `.env` file has placeholder email credentials.

**Fix**: Update your `.env` file with real email credentials:

#### Option A: Gmail (Recommended for testing)
```bash
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-app@gmail.com
EMAIL_PASS=your-16-character-app-password
EMAIL_FROM=Local Cooks Community <your-app@gmail.com>
```

**Gmail Setup Steps**:
1. Go to Google Account → Security
2. Enable 2-Factor Authentication
3. Go to App passwords → Generate new app password for "Mail"
4. Use the 16-character code as `EMAIL_PASS`

#### Option B: Your existing Hostinger setup
```bash
EMAIL_HOST=smtp.hostinger.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-real-email@yourdomain.com
EMAIL_PASS=your-actual-password
EMAIL_FROM=Local Cooks Community <your-real-email@yourdomain.com>
```

### 2. **Database Setup** (Required for password reset)

Run this SQL command in your database:

```sql
-- Add email_verified column to users table if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

-- Create password_reset_tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create email_verification_tokens table
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

### 3. **Restart Your Development Server**

After updating the `.env` file:
```bash
# Stop your server (Ctrl+C)
# Then restart:
npm run dev
```

## 🧪 TESTING YOUR SETUP

### Test Email Configuration
1. Go to `http://localhost:5000/admin`
2. Look for "Status Email Test" component
3. Enter a test email and send
4. Check if you receive the email

### Test Registration Email Verification
1. Try registering a new account
2. You should receive a verification email

### Test Password Reset
1. Go to login page
2. Enter your email
3. Click "Forgot your password?"
4. Check your email for reset link

## 🎥 VIDEO NAVIGATION FIX

**Issue**: Cannot proceed to video 2 after completing video 1.

**Fix Applied**: Updated the video navigation logic to properly track completion and allow progression.

**What changed**:
- Fixed progress tracking for completed videos
- Improved navigation buttons with clear status indicators
- Added proper completion detection

## 📧 EMAIL VERIFICATION FIX

**Issue**: Registration shows verification screen but doesn't send emails.

**Fix Applied**: 
- Added actual email verification functionality
- Registration now sends real verification emails
- Resend verification button now works

## 🔒 PASSWORD RESET FIX

**Issue**: "Forgot password" button didn't work.

**Fix Applied**: 
- Added complete password reset functionality
- Users can now request password reset via email
- Reset links expire after 1 hour for security

## 🚀 NEW FEATURES ADDED

1. **Password Reset System**
   - Request reset via email
   - Secure token-based reset
   - 1-hour expiration for security

2. **Email Verification System**
   - Welcome emails for new users
   - Verification links
   - Resend verification option

3. **Improved Video Navigation**
   - Clear progress indicators
   - Better completion tracking
   - Sequential unlocking

## ⚠️ TROUBLESHOOTING

### Emails not sending?
1. Check server logs for errors
2. Verify email credentials in `.env`
3. Test SMTP connection
4. Check spam/junk folders

### Video navigation not working?
1. Check browser console for errors
2. Verify user progress in database
3. Restart development server

### Database errors?
1. Run the migration SQL above
2. Check database connection
3. Verify table structure

## 📞 SUPPORT

If you're still having issues:
1. Check server console logs for detailed errors
2. Verify all environment variables are set
3. Test with a simple Gmail account first
4. Make sure firewall isn't blocking SMTP ports

## 🎯 IMMEDIATE ACTION REQUIRED

1. **Update `.env` with real email credentials** ← MOST IMPORTANT
2. **Run the database migration SQL**
3. **Restart your development server**
4. **Test email functionality**

Without step 1, no emails will be sent regardless of other fixes! 