# Firebase Password Reset Implementation

## 🔄 Migration from Session-Based to Firebase Authentication

This document explains the updated password reset system that now uses Firebase authentication instead of session-based authentication for user-side operations.

## 🎯 Problem Solved

**Original Issue:**
- `/api/auth/forgot-password` was using session-based authentication
- Database query looked for non-existent `email` column 
- Mixed authentication methods caused conflicts between user (Firebase) and admin (session) flows

**Solution:**
- Users now use Firebase's built-in password reset system
- Admin authentication remains session-based (no mixing)
- Proper database schema alignment with `username` field storing emails

## 🏗️ New Architecture

### Authentication Separation

| System | Authentication Method | Endpoints |
|--------|----------------------|-----------|
| **Users** | Firebase Auth | `/api/firebase/*` |
| **Admins** | Session-based | `/api/admin-*`, `/api/applications` |

### Password Reset Flow

#### 1. **Firebase Users (Email/Password)**
```
User clicks "Forgot Password" 
→ `/api/firebase/forgot-password`
→ Firebase generates secure reset link
→ User receives email with Firebase reset URL
→ User clicks link → `/password-reset?oobCode=...`
→ `/api/firebase/reset-password` (with oobCode)
→ Password updated in both Firebase and Neon DB
```

#### 2. **OAuth Users (Google)**
```
User tries "Forgot Password"
→ System detects OAuth account
→ Returns message: "Use 'Sign in with Google'"
```

## 📁 File Changes

### Backend Files

**1. `server/firebase-routes.ts`**
- ✅ Added `/api/firebase/forgot-password` - Firebase-based password reset
- ✅ Added `/api/firebase/reset-password` - Firebase reset confirmation
- ✅ Validates user type (email/password vs OAuth)
- ✅ Updates both Firebase and Neon DB password hashes

**2. `api/index.js`**
- ✅ Deprecated old `/api/auth/forgot-password` endpoint
- ✅ Returns helpful error message directing to new system

### Frontend Files

**1. `client/src/components/auth/ForgotPasswordForm.tsx`**
- ✅ Updated to use `/api/firebase/forgot-password`

**2. `client/src/components/auth/EnhancedLoginForm.tsx`**
- ✅ Updated forgot password link to use Firebase endpoint

**3. `client/src/components/auth/ResetPasswordForm.tsx`**
- ✅ Enhanced to handle Firebase `oobCode` parameter
- ✅ Backwards compatible with legacy token system
- ✅ Auto-detects Firebase vs legacy reset mode

**4. `client/src/pages/PasswordReset.tsx`**
- ✅ New page for handling Firebase password reset URLs
- ✅ Extracts `oobCode` from URL parameters
- ✅ Validates reset link before showing form

**5. `client/src/App.tsx`**
- ✅ Added `/password-reset` route for Firebase URLs

## 🔒 Security Features

### Firebase Authentication Benefits
- **Secure Token Generation**: Firebase handles cryptographically secure tokens
- **Automatic Expiration**: Firebase manages token lifecycle
- **Rate Limiting**: Built-in protection against abuse
- **Email Verification**: Trusted email delivery system

### Database Consistency
- Password hashes updated in both Firebase and Neon DB
- Prevents authentication drift between systems
- Maintains user data integrity

## 🛠️ Usage Examples

### Frontend: Request Password Reset
```javascript
const response = await fetch('/api/firebase/forgot-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com' })
});
```

### Frontend: Reset Password with Firebase Code
```javascript
const response = await fetch('/api/firebase/reset-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    oobCode: 'firebase-generated-code',
    newPassword: 'newSecurePassword123'
  })
});
```

## 📧 Email Flow

### Firebase Reset Email
Firebase automatically sends professional reset emails with:
- Secure reset link containing `oobCode`
- Automatic expiration (typically 1 hour)
- Direct link to `/password-reset?oobCode=...&mode=resetPassword`

### Custom Email (Optional)
You can optionally send custom emails by:
1. Using `admin.auth().generatePasswordResetLink()`
2. Creating custom email template
3. Including the generated link in your email

## 🧪 Testing

### Test Firebase Password Reset
1. Go to `/auth` page
2. Click "Forgot your password?"
3. Enter email address of Firebase user
4. Check email for reset link
5. Click link → should redirect to `/password-reset`
6. Enter new password
7. Submit → should redirect to login

### Test OAuth User Protection
1. Try forgot password with Google OAuth user email
2. Should receive message about using Google sign-in

## 🚨 Error Handling

### Common Error Scenarios

**Invalid Firebase Code:**
```json
{
  "message": "Invalid or expired reset code"
}
```

**OAuth User Attempt:**
```json
{
  "message": "This account uses Google/OAuth sign-in. Please use 'Sign in with Google'..."
}
```

**Weak Password:**
```json
{
  "message": "Password is too weak. Please choose a stronger password."
}
```

## 🔍 Debugging

### Logs to Monitor
```
🔥 Firebase password reset requested for: user@example.com
✅ Firebase user found: firebase-uid-here
✅ Firebase password reset link generated for: user@example.com
✅ Password reset confirmed for: user@example.com
✅ Password hash updated in Neon DB for user: 123
```

### Database Queries
```sql
-- Check user Firebase UID
SELECT id, username, firebase_uid, password FROM users WHERE username = 'user@example.com';

-- Verify password update
SELECT id, username, LENGTH(password) as password_length FROM users WHERE firebase_uid = 'firebase-uid';
```

## 📋 Migration Checklist

- ✅ Firebase Admin SDK properly configured
- ✅ Database schema has `firebase_uid` column
- ✅ Users table uses `username` field for emails
- ✅ Frontend components updated to use Firebase endpoints
- ✅ Password reset page handles Firebase oobCode
- ✅ Old session endpoint deprecated with helpful message
- ✅ Error handling for OAuth vs email/password users
- ✅ Database password hash synchronization

## 🔗 Related Documentation

- [Firebase Admin SDK Setup](./docs/firebase-architecture.md)
- [Authentication Architecture](./HYBRID_AUTH_GUIDE.md)
- [Database Schema](./docs/database-schema.md)
- [Email Configuration](./setup-email-auth.md) 