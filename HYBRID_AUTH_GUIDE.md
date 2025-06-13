# 🔐 Hybrid Authentication System Guide

## Overview
Your Local Cooks application now supports **multiple authentication methods** for both users and admins, providing maximum flexibility and compatibility.

## 🚀 Authentication Methods

### 1. Firebase Authentication (Enhanced)
- **URL**: `/auth` 
- **Features**: Modern UI, real-time validation, email verification, Google OAuth
- **Credentials**: Email + Password
- **Best For**: New users, enhanced experience

### 2. Legacy Email/Username Authentication  
- **URL**: `/auth`
- **Features**: Email-based login with Neon database lookup
- **Credentials**: Email or Username + Password
- **Best For**: Existing users with emails in applications table

### 3. Admin Panel Authentication
- **URL**: `/admin/login`
- **Features**: Direct admin access, session-based
- **Credentials**: Username: `admin`, Password: `localcooks`
- **Best For**: Admin users, quick access

## 👥 User Types & Login Options

### Regular Users
| Authentication Method | URL | Credentials | Features |
|---------------------|-----|-------------|----------|
| **Firebase Enhanced** | `/auth` | Email + Password | Real-time validation, Google OAuth, premium UX |
| **Email Login** | `/auth` | Email + Password | Searches applications table for email |
| **Username Login** | `/auth` | Username + Password | Traditional username/password |

### Admin Users  
| Authentication Method | URL | Credentials | Features |
|---------------------|-----|-------------|----------|
| **Admin Panel** | `/admin/login` | `admin` / `localcooks` | Direct admin access, auto-Firebase sync |
| **Firebase Admin** | `/auth` | `admin@localcooks.com` / `localcooks` | Enhanced admin experience |
| **Email/Username** | `/auth` | Admin email or username | Works with any admin account |

## 🔄 API Endpoints

### Legacy Endpoints (Session-based)
- `POST /api/login` - Email/username + password login
- `POST /api/admin-login` - Admin-specific login  
- `GET /api/user` - Get current user (session)

### Firebase Endpoints (JWT-based)
- `GET /api/user/profile` - Firebase user profile
- `POST /api/firebase/applications` - Submit application (Firebase auth)
- `GET /api/firebase/applications/my` - Get user applications

### Hybrid Endpoints (Both auth methods)
- `GET /api/hybrid/user/profile` - User profile (any auth method)
- `GET /api/hybrid/applications` - User applications (any auth method)  
- `GET /api/hybrid/admin/dashboard` - Admin dashboard (any auth method)

### Utility Endpoints
- `GET /api/auth-status` - Check all authentication methods
- `POST /api/find-login-info` - Find login credentials by email
- `POST /api/sync-admin-to-firebase` - Sync admin to Firebase

## 🛠 How It Works

### Hybrid Authentication Flow
1. **Check Firebase JWT** - If `Authorization: Bearer <token>` header present
2. **Fallback to Session** - If no Firebase token, check session/cookies
3. **Link Accounts** - Firebase users linked to Neon DB via `firebase_uid`

### Database Schema
```sql
-- Users table supports both auth methods
users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role user_role DEFAULT 'applicant',
  firebase_uid TEXT UNIQUE,  -- Links to Firebase
  is_verified BOOLEAN DEFAULT false
)
```

## 📊 Your Current Users

Based on your Neon database:

### Admin Users
- **ID 3**: Username: `admin`, Role: admin (works with `/admin/login`)

### Regular Users  
- **ID 2**: Username: `rsarmacharya`
- **ID 6**: Username: `Ronnie` 
- **ID 23**: Username: `Satyajit Debnath` (Firebase-enabled)
- **ID 24**: Username: `Raunak Sarmacharya` (Firebase-enabled)
- And more...

## 🎯 Quick Start

### For Admin Access
1. **Option A**: Go to `/admin/login`, use `admin` / `localcooks`
2. **Option B**: Go to `/auth`, use `admin@localcooks.com` / `localcooks` (if synced)

### For User Access
1. **With Email**: Go to `/auth`, enter your email + password
2. **With Username**: Go to `/auth`, enter your username + password  
3. **New Users**: Go to `/auth`, register with email + password

### Find Your Credentials
```bash
# POST to /api/find-login-info with your email
curl -X POST /api/find-login-info \
  -H "Content-Type: application/json" \
  -d '{"email": "your@email.com"}'
```

## 🔧 Advanced Features

### Auto-Sync
- Admin login automatically attempts Firebase sync
- Firebase users auto-sync to Neon database
- Seamless account linking

### Authentication Status
```bash
# Check all authentication methods
GET /api/auth-status
```

### Multiple Auth Support
- Users can login via Firebase OR session
- Same user, different auth methods
- Consistent user experience

## 🚀 Benefits

✅ **Backward Compatibility** - All existing logins still work  
✅ **Enhanced Experience** - New Firebase features available  
✅ **Flexible Access** - Multiple ways to authenticate  
✅ **Admin Support** - Both Firebase and session admin access  
✅ **Email Support** - Login with email even if stored as username  
✅ **Auto-Linking** - Accounts automatically sync between systems  

## 🛡 Security

- **JWT Tokens** for Firebase authentication
- **Session Cookies** for legacy authentication  
- **Password Hashing** with bcrypt
- **Role-Based Access** control
- **CSRF Protection** via session cookies

Your authentication system now provides enterprise-level flexibility while maintaining simplicity for end users! 🎉 