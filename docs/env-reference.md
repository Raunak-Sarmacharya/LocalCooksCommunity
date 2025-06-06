# 🔧 Environment Variables Reference

Complete reference for all environment variables used in Local Cooks Community across development and production environments.

## 🚀 Quick Setup

### Development (Minimal Required)
```bash
DATABASE_URL=sqlite://./local.db
SESSION_SECRET=your-local-development-secret-key-here
NODE_ENV=development
UPLOAD_DIR=./uploads
```

### Production (Vercel + Neon + Blob)
```bash
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/db?sslmode=require
SESSION_SECRET=your-super-secure-random-string-here
NODE_ENV=production
VERCEL_ENV=production
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_your_token_here
```

## 📊 Environment Variables

### **🗄️ Database Configuration**

| Variable | Required | Description | Example | Notes |
|----------|----------|-------------|---------|-------|
| `DATABASE_URL` | ✅ **Yes** | Database connection string | `postgresql://user:pass@host/db?sslmode=require` | Use Neon for production, SQLite for dev |

**Development Options:**
- SQLite: `sqlite://./local.db`
- Local PostgreSQL: `postgresql://user:pass@localhost:5432/localcooks`
- Neon: `postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/db?sslmode=require`

### **🔐 Security & Sessions**

| Variable | Required | Description | Example | Notes |
|----------|----------|-------------|---------|-------|
| `SESSION_SECRET` | ✅ **Yes** | Secret key for session encryption | `my-super-secure-random-key-here` | Use 32+ character random string |
| `NODE_ENV` | ✅ **Yes** | Environment mode | `development` or `production` | Controls various app behaviors |
| `VERCEL_ENV` | 🔵 **Production** | Vercel environment | `production` | Set automatically by Vercel |

### **📁 File Upload & Storage**

| Variable | Required | Description | Example | Notes |
|----------|----------|-------------|---------|-------|
| `BLOB_READ_WRITE_TOKEN` | 🔵 **Production** | Vercel Blob storage token | `vercel_blob_rw_WyDy5mPBD1u63A6T_...` | Get from Vercel Dashboard |
| `UPLOAD_DIR` | 🟡 **Development** | Local file upload directory | `./uploads` | Only used in development |

**File Upload Behavior:**
- **Development**: Files stored locally in `UPLOAD_DIR`
- **Production**: Files stored in Vercel Blob using `BLOB_READ_WRITE_TOKEN`

### **📧 Email Notifications (Optional)**

| Variable | Required | Description | Example | Notes |
|----------|----------|-------------|---------|-------|
| `EMAIL_HOST` | ⚪ Optional | SMTP server hostname | `smtp.hostinger.com` | Required for email features |
| `EMAIL_PORT` | ⚪ Optional | SMTP server port | `587` | Usually 587 for TLS |
| `EMAIL_USER` | ⚪ Optional | SMTP username | `noreply@yourdomain.com` | Email account username |
| `EMAIL_PASS` | ⚪ Optional | SMTP password | `your-email-password` | Email account password |
| `EMAIL_FROM` | ⚪ Optional | From address in emails | `Local Cooks <noreply@yourdomain.com>` | Display name and email |

**Email Providers:**
- **Hostinger**: `smtp.hostinger.com:587`
- **Gmail**: `smtp.gmail.com:587` (use app password)
- **SendGrid**: `smtp.sendgrid.net:587`

### **🔑 OAuth Authentication (Optional)**

| Variable | Required | Description | Example | Notes |
|----------|----------|-------------|---------|-------|
| `GOOGLE_CLIENT_ID` | ⚪ Optional | Google OAuth client ID | `123456789.apps.googleusercontent.com` | From Google Console |
| `GOOGLE_CLIENT_SECRET` | ⚪ Optional | Google OAuth client secret | `GOCSPX-your-secret-here` | From Google Console |
| `FACEBOOK_CLIENT_ID` | ⚪ Optional | Facebook OAuth app ID | `1234567890123456` | From Facebook Developers |
| `FACEBOOK_CLIENT_SECRET` | ⚪ Optional | Facebook OAuth app secret | `your-facebook-app-secret` | From Facebook Developers |

**OAuth Setup:**
- See [OAuth Setup Guide](./oauth-setup.md) for detailed configuration
- OAuth is completely optional - local authentication works without it
- Users can register/login without OAuth providers

## 🌍 Environment-Specific Configurations

### **Development Environment**
```bash
# Required
DATABASE_URL=sqlite://./local.db
SESSION_SECRET=local-dev-secret-key
NODE_ENV=development

# File uploads
UPLOAD_DIR=./uploads

# Optional (for testing)
EMAIL_HOST=
EMAIL_PORT=
EMAIL_USER=
EMAIL_PASS=
EMAIL_FROM=

# Optional OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=
```

### **Production Environment (Vercel)**
```bash
# Required
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/dbname?sslmode=require
SESSION_SECRET=super-secure-production-secret-32-chars-minimum
NODE_ENV=production
VERCEL_ENV=production
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_your_production_token

# Optional Email
EMAIL_HOST=smtp.hostinger.com
EMAIL_PORT=587
EMAIL_USER=noreply@yourdomain.com
EMAIL_PASS=your-secure-email-password
EMAIL_FROM=Local Cooks <noreply@yourdomain.com>

# Optional OAuth
GOOGLE_CLIENT_ID=your-production-google-client-id
GOOGLE_CLIENT_SECRET=your-production-google-secret
FACEBOOK_CLIENT_ID=your-production-facebook-id
FACEBOOK_CLIENT_SECRET=your-production-facebook-secret
```

## 🔍 Variable Validation

The application validates environment variables on startup:

### **Required Variables Check**
- `DATABASE_URL` - Must be present and valid
- `SESSION_SECRET` - Must be at least 16 characters
- `NODE_ENV` - Must be 'development' or 'production'

### **Conditional Validation**
- **Production**: `BLOB_READ_WRITE_TOKEN` required
- **Email Features**: All email variables required together
- **OAuth**: Client ID and secret required together

### **Startup Warnings**
The app will warn about:
- Missing optional features (email, OAuth)
- Weak session secrets in production
- Database connection issues

## 🛡️ Security Best Practices

### **Session Secrets**
- **Development**: Any secure string (16+ chars)
- **Production**: Cryptographically random (32+ chars)
- **Generation**: `openssl rand -base64 32`

### **Database URLs**
- Always use SSL in production (`?sslmode=require`)
- Use connection pooling for production databases
- Keep credentials secure and rotate regularly

### **API Keys & Tokens**
- Never commit real keys to version control
- Use environment-specific keys (dev vs prod)
- Rotate tokens regularly
- Use minimum required permissions

## 🔧 Setting Variables

### **Local Development**
1. Copy `.env.example` to `.env`
2. Fill in required variables
3. Leave optional variables blank if not needed

### **Vercel Production**
1. Go to Vercel Dashboard → Project Settings
2. Navigate to Environment Variables
3. Add each variable for "Production" environment
4. Redeploy to apply changes

### **Vercel CLI**
```bash
# Set a variable
vercel env add

# List variables
vercel env ls

# Remove a variable
vercel env rm
```

## 📋 Environment Files

### **.env.example** (Template)
Contains all possible variables with example values

### **.env** (Local Development)
Your local environment file (not committed to git)

### **.env.local** (Alternative)
Alternative local environment file (also not committed)

### **Vercel Dashboard** (Production)
Production environment variables stored securely

---

**Related Documentation:**
- [Quick Start Guide](./quick-start.md) - Setup instructions
- [Production Guide](./production-guide.md) - Production deployment
- [OAuth Setup Guide](./oauth-setup.md) - OAuth configuration
- [File Upload Guide](./file-upload-guide.md) - File storage setup 