# 🔑 OAuth Setup Guide

This guide explains how to set up **Google**, **Facebook**, and **Instagram** OAuth authentication for the Local Cooks application.

## 🎯 Overview

The application supports three OAuth providers:

1. **Google OAuth 2.0** - Most common, reliable
2. **Facebook OAuth** - Social login integration
3. **Instagram OAuth** - Currently experimental (API limitations)

## 🏗️ OAuth Flow

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│                 │    │                  │    │                 │
│   User clicks   │────│  Redirect to     │────│  OAuth Provider │
│  "Login with X" │    │  Provider Auth   │    │  (Google/FB)    │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│                 │    │                  │    │                 │
│   User logged   │◄───│  Create session  │◄───│ Authorization   │
│   in to app     │    │  in database     │    │     Code        │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🔧 1. Google OAuth Setup

### 1.1 Create Google Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project or select existing
3. Enable Google+ API and Google OAuth2 API

### 1.2 Configure OAuth Consent Screen

```bash
# In Google Cloud Console:
# 1. Go to "APIs & Services" → "OAuth consent screen"
# 2. Choose "External" (unless you have G Suite)
# 3. Fill in application details:

App name: Local Cooks Community
User support email: your-email@domain.com
Developer contact: your-email@domain.com
Authorized domains: your-domain.com (if using custom domain)
```

### 1.3 Create OAuth Credentials

```bash
# In Google Cloud Console:
# 1. Go to "APIs & Services" → "Credentials"
# 2. Click "Create Credentials" → "OAuth 2.0 Client IDs"
# 3. Application type: "Web application"
# 4. Name: "Local Cooks Web App"

# Authorized JavaScript origins:
http://localhost:5000  # Development
https://your-app.vercel.app  # Production

# Authorized redirect URIs:
http://localhost:5000/api/auth/google/callback  # Development
https://your-app.vercel.app/api/auth/google/callback  # Production
```

### 1.4 Get Credentials

```bash
# After creating, you'll get:
Client ID: 1234567890-abcdefghijklmnop.apps.googleusercontent.com
Client Secret: GOCSPX-your-secret-here

# Add to your .env file:
GOOGLE_CLIENT_ID=1234567890-abcdefghijklmnop.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret-here
```

## 📘 2. Facebook OAuth Setup

### 2.1 Create Facebook App

1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Click "Create App" → "Consumer" → Continue
3. Enter app details:
   - **App Name**: Local Cooks Community
   - **App Contact Email**: your-email@domain.com

### 2.2 Configure Facebook Login

```bash
# In Facebook App Dashboard:
# 1. Go to "Products" → Add "Facebook Login"
# 2. Choose "Web" platform
# 3. Set Site URL: https://your-app.vercel.app
```

### 2.3 Configure OAuth Redirect URIs

```bash
# In Facebook Login Settings:
# Valid OAuth Redirect URIs:
http://localhost:5000/api/auth/facebook/callback  # Development
https://your-app.vercel.app/api/auth/facebook/callback  # Production

# Valid OAuth Redirect URIs for desktop/mobile:
https://your-domain.com/  # If you have custom domain
```

### 2.4 Get App Credentials

```bash
# In App Dashboard → Settings → Basic:
App ID: 1234567890123456
App Secret: abcdef1234567890abcdef1234567890

# Add to your .env file:
FACEBOOK_CLIENT_ID=1234567890123456
FACEBOOK_CLIENT_SECRET=abcdef1234567890abcdef1234567890
```

### 2.5 Configure App Permissions

```bash
# In App Review → Permissions and Features:
# Request these permissions:
- email (to get user's email address)
- public_profile (to get basic profile info)

# Note: For production, you'll need Facebook app review
# For development, test users can be added without review
```

## 📸 3. Instagram OAuth Setup (Optional)

**⚠️ Warning**: Instagram Basic Display API has limitations and may be deprecated. Consider if you really need Instagram login.

### 3.1 Create Facebook App (Instagram uses Facebook)

Instagram OAuth requires a Facebook app with Instagram Basic Display product.

### 3.2 Add Instagram Basic Display

```bash
# In Facebook App Dashboard:
# 1. Go to "Products" → Add "Instagram Basic Display"
# 2. Create Instagram App
# 3. Configure redirect URIs
```

### 3.3 Configure Instagram Redirect URIs

```bash
# Valid OAuth Redirect URIs:
http://localhost:5000/api/auth/instagram/callback  # Development
https://your-app.vercel.app/api/auth/instagram/callback  # Production
```

### 3.4 Get Instagram Credentials

```bash
# Use same Facebook App credentials:
INSTAGRAM_CLIENT_ID=1234567890123456  # Same as Facebook App ID
INSTAGRAM_CLIENT_SECRET=abcdef1234567890abcdef1234567890  # Same as Facebook App Secret
```

## ⚙️ 4. Environment Configuration

### 4.1 Complete .env file

```bash
# Google OAuth
GOOGLE_CLIENT_ID=1234567890-abcdefghijklmnop.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret-here

# Facebook OAuth
FACEBOOK_CLIENT_ID=1234567890123456
FACEBOOK_CLIENT_SECRET=abcdef1234567890abcdef1234567890

# Instagram OAuth (optional)
INSTAGRAM_CLIENT_ID=1234567890123456
INSTAGRAM_CLIENT_SECRET=abcdef1234567890abcdef1234567890

# Session configuration (required for OAuth)
SESSION_SECRET=your-super-secure-random-string-here

# Database (required for storing OAuth users)
DATABASE_URL=postgresql://username:password@localhost:5432/localcooks
```

### 4.2 Production Environment Variables

In **Vercel Dashboard** → Project Settings → Environment Variables:

```bash
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
FACEBOOK_CLIENT_ID=your-facebook-client-id
FACEBOOK_CLIENT_SECRET=your-facebook-client-secret
INSTAGRAM_CLIENT_ID=your-instagram-client-id
INSTAGRAM_CLIENT_SECRET=your-instagram-client-secret
SESSION_SECRET=your-production-session-secret
```

## 🔧 5. Implementation Details

### 5.1 OAuth Strategy Configuration

The application uses Passport.js with platform-specific strategies:

```typescript
// Google Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackURL: "/api/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  // Find or create user in database
  const user = await findOrCreateOAuthUser({
    googleId: profile.id,
    username: profile.emails?.[0]?.value || profile.displayName,
    email: profile.emails?.[0]?.value
  });
  return done(null, user);
}));

// Facebook Strategy
passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_CLIENT_ID!,
  clientSecret: process.env.FACEBOOK_CLIENT_SECRET!,
  callbackURL: "/api/auth/facebook/callback",
  profileFields: ['id', 'emails', 'name']
}, async (accessToken, refreshToken, profile, done) => {
  // Find or create user in database
  const user = await findOrCreateOAuthUser({
    facebookId: profile.id,
    username: profile.emails?.[0]?.value || `${profile.name?.givenName} ${profile.name?.familyName}`,
    email: profile.emails?.[0]?.value
  });
  return done(null, user);
}));
```

### 5.2 OAuth Routes

```typescript
// Google OAuth routes
app.get("/api/auth/google", 
  passport.authenticate("google", { 
    scope: ["profile", "email"] 
  })
);

app.get("/api/auth/google/callback",
  passport.authenticate("google", { 
    failureRedirect: "/login?error=google_auth_failed" 
  }),
  (req, res) => {
    res.redirect("/"); // Success redirect
  }
);

// Facebook OAuth routes
app.get("/api/auth/facebook", 
  passport.authenticate("facebook", { 
    scope: ["email"] 
  })
);

app.get("/api/auth/facebook/callback",
  passport.authenticate("facebook", { 
    failureRedirect: "/login?error=facebook_auth_failed" 
  }),
  (req, res) => {
    res.redirect("/"); // Success redirect
  }
);
```

## 🔍 6. Frontend Integration

### 6.1 OAuth Login Buttons

```tsx
// OAuth login component
const OAuthButtons = () => {
  return (
    <div className="oauth-buttons">
      <a 
        href="/api/auth/google" 
        className="btn btn-google"
      >
        <GoogleIcon /> Continue with Google
      </a>
      
      <a 
        href="/api/auth/facebook" 
        className="btn btn-facebook"
      >
        <FacebookIcon /> Continue with Facebook
      </a>
      
      {/* Instagram login (if enabled) */}
      <a 
        href="/api/auth/instagram" 
        className="btn btn-instagram"
      >
        <InstagramIcon /> Continue with Instagram
      </a>
    </div>
  );
};
```

### 6.2 Handle OAuth Errors

```typescript
// Check for OAuth errors in URL params
const urlParams = new URLSearchParams(window.location.search);
const error = urlParams.get('error');

if (error) {
  switch (error) {
    case 'google_auth_failed':
      showError('Google authentication failed. Please try again.');
      break;
    case 'facebook_auth_failed':
      showError('Facebook authentication failed. Please try again.');
      break;
    case 'google_not_configured':
      showError('Google login is not configured.');
      break;
    default:
      showError('Authentication failed. Please try again.');
  }
}
```

## 🐛 7. Troubleshooting

### 7.1 Common Issues

#### **"OAuth credentials not configured"**
```bash
# Check environment variables are set
echo $GOOGLE_CLIENT_ID
echo $GOOGLE_CLIENT_SECRET

# For production, check Vercel dashboard environment variables
```

#### **"Redirect URI mismatch"**
```bash
# Error: redirect_uri_mismatch
# Solution: Ensure redirect URIs match exactly in OAuth provider settings

# Development:
http://localhost:5000/api/auth/google/callback

# Production:
https://your-app.vercel.app/api/auth/google/callback

# Note: NO trailing slash, exact URL match required
```

#### **"Access blocked: This app's request is invalid"**
```bash
# Google OAuth error
# Solution: Check OAuth consent screen is configured properly
# Ensure your domain is added to authorized domains
```

#### **"App Not Set Up: This app is still in development mode"**
```bash
# Facebook OAuth error
# Solution: Switch Facebook app to "Live" mode
# Or add test users in development mode
```

#### **"Error 400: invalid_client"**
```bash
# Check client ID and secret are correct
# Ensure there are no extra spaces or characters
# Client secret should be kept private and secure
```

### 7.2 Debug Mode

```typescript
// Add debug logging to OAuth strategies
passport.use(new GoogleStrategy({
  // ... config
}, async (accessToken, refreshToken, profile, done) => {
  console.log('Google OAuth Profile:', {
    id: profile.id,
    displayName: profile.displayName,
    emails: profile.emails,
    photos: profile.photos
  });
  
  // ... rest of strategy
}));
```

### 7.3 Testing OAuth Flow

```bash
# Test OAuth endpoints
curl -I http://localhost:5000/api/auth/google
# Should return 302 redirect to Google

curl -I http://localhost:5000/api/auth/facebook  
# Should return 302 redirect to Facebook

# Test callback endpoints (after OAuth flow)
# These will be called by the OAuth provider
```

## 📊 8. Production Considerations

### 8.1 Security Best Practices

1. **Keep secrets secure** - Never commit OAuth secrets to version control
2. **Use HTTPS in production** - OAuth providers require HTTPS for production
3. **Validate redirect URIs** - Ensure only your domains are authorized
4. **Monitor OAuth usage** - Track authentication patterns and failures

### 8.2 App Review Process

#### Google OAuth
- For apps with sensitive scopes, Google may require verification
- For basic profile/email access, usually no review needed
- Ensure privacy policy and terms of service are accessible

#### Facebook OAuth
- For production use, Facebook app review is required
- Submit app for review with detailed use case
- Provide test credentials for Facebook reviewers
- Process can take 3-7 business days

### 8.3 Rate Limits

```bash
# OAuth provider rate limits:
# Google: 100 requests/user/second, 10,000 requests/day
# Facebook: 200 calls/hour/user, 4,800 calls/hour/app
# Instagram: Limited by Facebook quotas

# Implement rate limiting in your app:
# - Cache user sessions
# - Avoid excessive profile API calls
# - Implement exponential backoff for errors
```

## 📈 9. Analytics & Monitoring

### 9.1 Track OAuth Usage

```typescript
// Log OAuth events
console.log('OAuth login attempt:', {
  provider: 'google',
  userId: profile.id,
  timestamp: new Date().toISOString(),
  success: true
});

// Track conversion rates
const oauthMetrics = {
  googleLogins: 0,
  facebookLogins: 0,
  instagramLogins: 0,
  totalOAuthLogins: 0,
  conversionRate: 0 // OAuth logins / total login attempts
};
```

### 9.2 Monitor OAuth Errors

```typescript
// Log OAuth errors for monitoring
app.get("/api/auth/google/callback",
  passport.authenticate("google", { 
    failureRedirect: "/login?error=google_auth_failed",
    failWithError: true
  }),
  (req, res) => res.redirect("/"),
  (err, req, res, next) => {
    console.error('Google OAuth error:', {
      error: err.message,
      timestamp: new Date().toISOString(),
      userAgent: req.get('User-Agent')
    });
    res.redirect("/login?error=internal_error");
  }
);
```

## ✅ 10. Quick Reference

### Test OAuth Setup:
```bash
# Development URLs:
http://localhost:5000/api/auth/google
http://localhost:5000/api/auth/facebook  
http://localhost:5000/api/auth/instagram

# Production URLs:
https://your-app.vercel.app/api/auth/google
https://your-app.vercel.app/api/auth/facebook
https://your-app.vercel.app/api/auth/instagram
```

### Required Environment Variables:
```bash
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
FACEBOOK_CLIENT_ID=your-facebook-client-id
FACEBOOK_CLIENT_SECRET=your-facebook-client-secret
SESSION_SECRET=your-session-secret
```

### OAuth Provider Dashboards:
- **Google**: https://console.cloud.google.com/
- **Facebook**: https://developers.facebook.com/
- **Instagram**: https://developers.facebook.com/ (same as Facebook)

---

## 🎉 You're Ready!

Your OAuth authentication is now configured! Users can sign in with:
- ✅ **Google** (most reliable)
- ✅ **Facebook** (social integration)  
- ✅ **Instagram** (optional, limited functionality)

The complete OAuth flow works seamlessly with session management and database integration! 🔐 