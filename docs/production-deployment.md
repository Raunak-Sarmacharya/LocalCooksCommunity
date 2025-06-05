# 🚀 Production Deployment Guide

This guide walks you through deploying the Local Cooks application to production with **Neon Database** and **Vercel Blob Storage**.

## 📋 Prerequisites

1. **Vercel Account** - For hosting and blob storage
2. **Neon Database** - PostgreSQL database
3. **Domain** (optional) - For custom URLs

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

## 🗄️ Step 1: Set Up Neon Database

### 1.1 Create Neon Project
```bash
# Visit https://console.neon.tech/
# Create new project
# Copy the connection string
```

### 1.2 Configure Database Schema
The application will **automatically create tables** on first run, but you can verify:

```sql
-- Applications table (automatically created)
CREATE TABLE applications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  food_safety_license certification_status NOT NULL,
  food_establishment_cert certification_status NOT NULL,
  kitchen_preference kitchen_preference NOT NULL,
  feedback TEXT,
  status application_status DEFAULT 'new' NOT NULL,
  
  -- Document fields (automatically added)
  food_safety_license_url TEXT,
  food_establishment_cert_url TEXT,
  food_safety_license_status document_verification_status DEFAULT 'pending',
  food_establishment_cert_status document_verification_status DEFAULT 'pending',
  documents_admin_feedback TEXT,
  documents_reviewed_by INTEGER REFERENCES users(id),
  documents_reviewed_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
```

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
```bash
# In Vercel dashboard:
# 1. Go to Storage → Blob
# 2. Copy the "Read/Write Token"
# 3. It will look like: vercel_blob_rw_WyDy5mPBD1u63A6T_...
```

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

## ✅ Step 4: Verify Deployment

### 4.1 Check Application Health
```bash
# Visit your deployed URL
https://your-app.vercel.app

# Test API health endpoint
curl https://your-app.vercel.app/api/health
```

### 4.2 Test File Upload Flow

1. **Submit Application with Documents**
   - Go to `/apply`
   - Fill out form
   - Upload PDF/image files
   - Submit application

2. **Verify in Admin Panel**
   - Login as admin (`admin` / `localcooks`)
   - Check applications list
   - Approve application
   - Verify documents are visible and clickable

3. **Test Document Verification**
   - Documents should be stored in Vercel Blob
   - URLs should be accessible to admin
   - Status updates should work correctly

## 🔍 Step 5: Production Monitoring

### 5.1 Vercel Function Logs
```bash
# View function logs
vercel logs

# Monitor in real-time
vercel logs --follow
```

### 5.2 Neon Database Monitoring
- Monitor connection count in Neon dashboard
- Check query performance
- Monitor storage usage

### 5.3 Blob Storage Monitoring
- Check storage usage in Vercel dashboard
- Monitor bandwidth usage
- Review access patterns

## 🔧 Troubleshooting

### Database Connection Issues
```bash
# Test database connection
curl https://your-app.vercel.app/api/health

# Response should include:
{
  "status": "healthy",
  "database": "connected",
  "environment": "production"
}
```

### File Upload Issues
```bash
# Test file upload endpoint
curl -X POST -F "file=@test.pdf" \
  -H "Cookie: connect.sid=your-session-cookie" \
  https://your-app.vercel.app/api/upload-file

# Should return:
{
  "success": true,
  "url": "https://xxx.public.blob.vercel-storage.com/filename",
  "fileName": "filename.pdf",
  "size": 12345,
  "type": "application/pdf"
}
```

### Admin Panel Issues
1. **Documents not showing**: Check if applications table has document fields
2. **File access denied**: Verify Vercel Blob URLs are public
3. **Login issues**: Check session configuration

## 📊 Performance Considerations

### Database Optimization
- **Connection Pooling**: Neon handles this automatically
- **Query Optimization**: Monitor slow queries in Neon dashboard
- **Index Usage**: Primary keys and foreign keys are automatically indexed

### File Storage Optimization
- **File Size Limits**: 10MB per file (configurable)
- **Compression**: Consider compressing images before upload
- **CDN**: Vercel Blob provides global CDN automatically

### Caching Strategy
- **Static Assets**: Automatically cached by Vercel
- **API Responses**: Consider adding response caching for read-heavy endpoints
- **Database Queries**: Consider implementing query result caching

## 🔐 Security Checklist

- ✅ **Environment Variables**: All secrets stored in Vercel environment
- ✅ **Database SSL**: Enabled by default with Neon
- ✅ **File Access Control**: Only authenticated users can upload
- ✅ **Session Security**: Secure session configuration
- ✅ **Input Validation**: Zod schema validation on all endpoints
- ✅ **File Type Validation**: Only allow PDF, JPG, PNG, WebP
- ✅ **File Size Limits**: 10MB maximum per file

## 📈 Scaling Considerations

### Database Scaling
- **Neon Autoscaling**: Automatically scales compute up/down
- **Connection Limits**: Monitor connection usage
- **Read Replicas**: Consider for read-heavy workloads

### Application Scaling
- **Vercel Serverless**: Automatically scales functions
- **Memory Limits**: Monitor function memory usage
- **Cold Starts**: Optimize for faster cold start times

### Storage Scaling
- **Blob Storage**: Unlimited storage with pay-as-you-go
- **Bandwidth**: Monitor transfer costs
- **Global Distribution**: Built-in CDN for fast access

## 🎯 Post-Deployment Tasks

1. **Set up monitoring and alerts**
2. **Configure custom domain** (optional)
3. **Set up automated backups** for Neon database
4. **Monitor costs** for both Vercel and Neon
5. **Test disaster recovery** procedures

## 📞 Support Resources

- **Vercel Documentation**: https://vercel.com/docs
- **Neon Documentation**: https://neon.tech/docs
- **Application Issues**: Check function logs in Vercel dashboard

---

## 🎉 You're Live!

Your Local Cooks application is now running in production with:
- ✅ **Scalable database** (Neon)
- ✅ **Global file storage** (Vercel Blob)
- ✅ **Automatic deployments** (Vercel)
- ✅ **Admin document verification** (Full workflow)

The complete end-to-end flow works seamlessly in production! 