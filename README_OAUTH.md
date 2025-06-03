# OAuth Configuration for Local Cooks

This document explains how to set up and configure Google and Facebook OAuth authentication for the Local Cooks application.

## 📋 Prerequisites

Your OAuth credentials have been configured:

### Google OAuth
- **Client ID**: `<YOUR_GOOGLE_CLIENT_ID>`
- **Client Secret**: `<YOUR_GOOGLE_CLIENT_SECRET>`

### Facebook OAuth
- **Client ID**: `<YOUR_FACEBOOK_CLIENT_ID>`
- **Client Secret**: `<YOUR_FACEBOOK_CLIENT_SECRET>`

## 🔧 Configuration Setup

### Environment Variables

The OAuth credentials are automatically configured in your environment files:

#### Development (.env)
```bash
# Google OAuth
GOOGLE_CLIENT_ID=<YOUR_GOOGLE_CLIENT_ID>
GOOGLE_CLIENT_SECRET=<YOUR_GOOGLE_CLIENT_SECRET>
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback

# Facebook OAuth
FACEBOOK_CLIENT_ID=<YOUR_FACEBOOK_CLIENT_ID>
FACEBOOK_CLIENT_SECRET=<YOUR_FACEBOOK_CLIENT_SECRET>
FACEBOOK_CALLBACK_URL=http://localhost:5000/api/auth/facebook/callback
```

#### Production (.env.production)
```bash
# Google OAuth
GOOGLE_CLIENT_ID=<YOUR_GOOGLE_CLIENT_ID>
GOOGLE_CLIENT_SECRET=<YOUR_GOOGLE_CLIENT_SECRET>
GOOGLE_CALLBACK_URL=https://your-domain.com/api/auth/google/callback

# Facebook OAuth
FACEBOOK_CLIENT_ID=<YOUR_FACEBOOK_CLIENT_ID>
FACEBOOK_CLIENT_SECRET=<YOUR_FACEBOOK_CLIENT_SECRET>
FACEBOOK_CALLBACK_URL=https://your-domain.com/api/auth/facebook/callback
```

## 🔗 OAuth Provider Setup

### Google Cloud Console Setup

1. **Go to Google Cloud Console**: https://console.cloud.google.com/
2. **Create or select a project**
3. **Enable Google+ API**
4. **Create OAuth 2.0 credentials**
5. **Configure authorized redirect URIs**:
   - Development: `http://localhost:5000/api/auth/google/callback`
   - Production: `https://your-domain.com/api/auth/google/callback`

### Facebook Developer Setup

1. **Go to Facebook Developers**: https://developers.facebook.com/
2. **Create or select an app**
3. **Add Facebook Login product**
4. **Configure OAuth redirect URIs**:
   - Development: `http://localhost:5000/api/auth/facebook/callback`
   - Production: `https://your-domain.com/api/auth/facebook/callback`

## 🚀 How It Works

### Authentication Flow

1. **User clicks OAuth button** on `/auth` page
2. **Redirected to provider** (Google or Facebook)
3. **User grants permissions**
4. **Provider redirects back** to callback URL
5. **Server creates/retrieves user** account
6. **User is logged in** and redirected to dashboard

### User Account Creation

When a user logs in with OAuth for the first time:
- A new user account is automatically created
- Username is set to their email (or provider_id if no email)
- Role is set to "applicant" by default
- OAuth provider ID is stored for future logins

### Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/auth/google` | Initiate Google OAuth |
| GET | `/api/auth/google/callback` | Google OAuth callback |
| GET | `/api/auth/facebook` | Initiate Facebook OAuth |
| GET | `/api/auth/facebook/callback` | Facebook OAuth callback |

## 🎨 Frontend Integration

The OAuth buttons are available on the authentication page at `/auth`:

```tsx
{/* Google OAuth Button */}
<Button asChild variant="outline" className="w-full border-[#4285F4] text-[#4285F4] hover:bg-[#4285F4]/10">
  <a href="/api/auth/google">
    <GoogleIcon />
    Continue with Google
  </a>
</Button>

{/* Facebook OAuth Button */}
<Button asChild variant="outline" className="w-full border-[#1877F3] text-[#1877F3] hover:bg-[#1877F3]/10">
  <a href="/api/auth/facebook">
    <FacebookIcon />
    Continue with Facebook
  </a>
</Button>
```

## 🛠️ Development Testing

1. **Start the development server**:
   ```bash
   npm run dev
   ```

2. **Visit the auth page**: http://localhost:5000/auth

3. **Test OAuth flows**:
   - Click "Continue with Google"
   - Click "Continue with Facebook"

## 🔐 Security Features

- **State parameter** for CSRF protection
- **Secure session cookies** in production
- **Error handling** for failed authentications
- **User data validation** before account creation

## 🐛 Troubleshooting

### Common Issues

1. **"OAuth not configured" error**:
   - Check environment variables are loaded
   - Verify client IDs and secrets are correct

2. **Callback URL mismatch**:
   - Ensure redirect URIs match in provider settings
   - Check development vs production URLs

3. **User creation fails**:
   - Check database connection
   - Verify user schema matches requirements

### Debugging

Enable detailed logging by checking server console for:
- OAuth strategy configuration messages
- Authentication success/failure logs
- User creation/retrieval logs

## 📝 Production Deployment

Before deploying to production:

1. **Update callback URLs** in `.env.production`
2. **Configure provider settings** with production URLs
3. **Set secure session settings**
4. **Test OAuth flows** in production environment

## 🔗 Related Files

- `server/auth.ts` - OAuth strategy configuration
- `server/routes.ts` - OAuth route handlers
- `client/src/pages/auth-page.tsx` - Frontend OAuth buttons
- `server/storage.ts` - User creation/retrieval logic 