# 🚀 Production Guide

Complete guide for deploying and setting up the Local Cooks application in production with **Neon Database** and **Vercel Blob Storage**.

## 📋 Prerequisites

1. **Vercel Account** - For hosting and blob storage
2. **Neon Database** - PostgreSQL database
3. **Domain** (optional) - For custom URLs
4. **Email Service** (optional) - For notifications (Hostinger, Gmail, etc.)
5. **OAuth Apps** (optional) - Google, Facebook apps

## 🔧 Production Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│                 │    │                  │    │                 │
│   Vercel App    │────│  Neon Database   │    │  Vercel Blob    │
│   (Frontend +   │    │  (PostgreSQL)    │    │  (File Storage) │
│    Backend)     │    │                  │    │                 │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

**Data Flow:**
- **User Applications** → Neon Database
- **Document Uploads** → Vercel Blob Storage
- **File URLs** → Stored in Neon Database
- **Admin Access** → Both database and blob storage

---

## 🗄️ Step 1: Set Up Neon Database

### 1.1 Create Neon Project
1. Visit [https://console.neon.tech/](https://console.neon.tech/)
2. Create new project
3. Copy the connection string
4. Note down the credentials

### 1.2 Database Schema
The application will **automatically create tables** on first run. No manual schema setup required.

---

## 📁 Step 2: Set Up Vercel Blob Storage

### 2.1 Create Blob Store
```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Navigate to your project
cd your-project

# Link to Vercel project
vercel link

# Create blob store
vercel blob create
```

### 2.2 Get Blob Token
1. Go to **Vercel Dashboard** → Storage → Blob
2. Copy the **"Read/Write Token"**
3. It will look like: `vercel_blob_rw_WyDy5mPBD1u63A6T_...`

---

## 🚀 Step 3: Deploy to Vercel

### 3.1 Set Environment Variables

In your **Vercel Dashboard** → Project Settings → Environment Variables:

```bash
# Database
DATABASE_URL=postgresql://username:password@ep-xxx.us-east-1.aws.neon.tech/dbname?sslmode=require

# Session Security
SESSION_SECRET=your-super-secure-random-string-here

# Environment
NODE_ENV=production
VERCEL_ENV=production

# File Upload
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_your_token_here

# Email (Optional)
EMAIL_HOST=smtp.hostinger.com
EMAIL_PORT=587
EMAIL_USER=your-email@domain.com
EMAIL_PASS=your-email-password
EMAIL_FROM=Local Cooks <your-email@domain.com>

# OAuth (Optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
FACEBOOK_CLIENT_ID=your-facebook-client-id
FACEBOOK_CLIENT_SECRET=your-facebook-client-secret
```

### 3.2 Deploy
```bash
# Deploy to production
vercel --prod
```

---

## ✅ Step 4: Verify Deployment

### 4.1 Check Application Health
```bash
# Visit your deployed URL
https://your-app.vercel.app

# Test API health endpoint
curl https://your-app.vercel.app/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "database": "connected",
  "environment": "production"
}
```

### 4.2 Test Core Functionality

1. **Test User Registration**
   - Go to `/apply`
   - Create a test account
   - Submit an application

2. **Test File Upload**
   - Fill out application form
   - Upload PDF/image files
   - Verify submission works

3. **Test Admin Access**
   - Login with default admin: `admin` / `localcooks`
   - Access `/admin`
   - Review applications list

---

## 👤 Step 5: Admin Setup

### 5.1 Default Admin Account

The system creates a default admin account automatically:
```bash
Username: admin
Password: localcooks
```

**⚠️ IMPORTANT**: Change the default password immediately!

### 5.2 Change Admin Password

Currently requires direct database access:
```sql
-- Generate new password hash using bcrypt with 10 rounds
UPDATE users 
SET password = '$2b$10$your-new-hashed-password-here'
WHERE username = 'admin';
```

### 5.3 Admin Panel Testing

1. **Login**: Go to `/login` with admin credentials
2. **Access admin panel**: Navigate to `/admin`
3. **Test functionality**:
   - View applications list
   - Test status updates
   - Test document verification
   - Test email notifications (if configured)

---

## 📧 Step 6: Email Configuration (Optional)

### 6.1 Set Up Email Service

Add email configuration in Vercel environment variables:
```bash
EMAIL_HOST=smtp.hostinger.com
EMAIL_PORT=587
EMAIL_USER=your-email@yourdomain.com
EMAIL_PASS=your-email-password
EMAIL_FROM=Local Cooks <your-email@yourdomain.com>
```

### 6.2 Test Email Functionality

```bash
# Test email endpoint (admin only)
curl -X POST https://your-app.vercel.app/api/test-status-email \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=admin-session" \
  -d '{"applicationId": 1, "status": "approved"}'
```

---

## 🔐 Step 7: OAuth Setup (Optional)

### 7.1 Google OAuth

1. **Create Google Project**: Follow [OAuth Setup Guide](oauth-setup.md)
2. **Configure redirect URLs**:
   ```
   https://your-app.vercel.app/api/auth/google/callback
   ```
3. **Set environment variables** in Vercel dashboard

### 7.2 Facebook OAuth

1. **Create Facebook App**: Follow [OAuth Setup Guide](oauth-setup.md)
2. **Configure redirect URLs**:
   ```
   https://your-app.vercel.app/api/auth/facebook/callback
   ```

---

## 🔍 Step 8: Production Monitoring

### 8.1 Vercel Function Logs
```bash
# View function logs
vercel logs

# Monitor in real-time
vercel logs --follow
```

### 8.2 Database Monitoring
- Monitor connection count in Neon dashboard
- Check query performance
- Monitor storage usage

### 8.3 Blob Storage Monitoring
- Check storage usage in Vercel dashboard
- Monitor bandwidth usage
- Review access patterns

---

## 🔧 Troubleshooting

### Database Connection Issues
```bash
# Test database connection
curl https://your-app.vercel.app/api/health
```

### File Upload Issues
```bash
# Test file upload endpoint
curl -X POST -F "file=@test.pdf" \
  -H "Cookie: connect.sid=your-session-cookie" \
  https://your-app.vercel.app/api/upload-file
```

### Common Issues
- **Documents not showing**: Check application table structure
- **File access denied**: Verify Vercel Blob URLs are accessible
- **Login issues**: Check session configuration
- **404 errors**: Verify routes are synchronized (run `npm run fix-microlearning`)

---

## 📊 Performance & Security

### Security Checklist
- ✅ **Environment Variables**: All secrets in Vercel environment
- ✅ **Database SSL**: Enabled by default with Neon
- ✅ **File Access Control**: Authenticated uploads only
- ✅ **Input Validation**: Zod schema validation
- ✅ **File Type Validation**: PDF, JPG, PNG, WebP only
- ✅ **File Size Limits**: 10MB maximum per file

### Performance Considerations
- **Database**: Connection pooling handled by Neon
- **File Storage**: Global CDN via Vercel Blob
- **Caching**: Static assets cached automatically
- **Monitoring**: Use Vercel analytics and Neon monitoring

---

## 🎯 Go-Live Checklist

- [ ] **Database**: Neon project created and connected
- [ ] **Blob Storage**: Vercel Blob configured and tested
- [ ] **Environment Variables**: All required variables set
- [ ] **Admin Account**: Default password changed
- [ ] **Email**: Configuration tested (if using)
- [ ] **OAuth**: Apps configured (if using)
- [ ] **Core Features**: Registration, applications, admin panel tested
- [ ] **File Upload**: Document upload and verification tested
- [ ] **Monitoring**: Logs and analytics configured
- [ ] **Routes**: Microlearning routes verified (`npm run validate-sync`)

---

## 📄 Related Documentation

- [Quick Start Guide](quick-start.md)
- [OAuth Setup Guide](oauth-setup.md)
- [File Upload Guide](file-upload-guide.md)
- [API Reference](api-reference.md)
- [FAQ & Troubleshooting](faq.md) 