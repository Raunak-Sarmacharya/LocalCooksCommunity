# 🚀 Production Deployment Guide with Firebase Auth

## 🎯 **Overview**

This guide will help you deploy your Local Cooks Community app to production with Firebase Auth → Neon Database architecture.

## 📋 **Pre-Deployment Checklist**

### **1. Firebase Console Setup**
- [ ] Create production Firebase project
- [ ] Enable Authentication (Email/Password + Google)
- [ ] Add production domain to authorized domains
- [ ] Generate service account private key
- [ ] Copy frontend configuration

### **2. Vercel Setup**
- [ ] Install Vercel CLI: `npm i -g vercel`
- [ ] Login to Vercel: `vercel login`
- [ ] Link project: `vercel --confirm`

### **3. Environment Variables**
- [ ] Set all Firebase variables in Vercel Dashboard
- [ ] Configure Neon database URL
- [ ] Set Vercel Blob token

## 🔧 **Environment Variables Setup**

### **Step 1: Set Variables in Vercel Dashboard**

Go to your Vercel project → Settings → Environment Variables

#### **Firebase Frontend Variables**
```bash
VITE_FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef1234567890abcdef
```

#### **Firebase Backend Variables**
```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
```

#### **Database & Storage**
```bash
DATABASE_URL=postgresql://username:password@ep-xxx.us-east-1.aws.neon.tech/dbname?sslmode=require
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_your_production_token
```

#### **Production Settings**
```bash
NODE_ENV=production
VERCEL_ENV=production
```

### **Step 2: Firebase Authorized Domains**

In Firebase Console → Authentication → Settings → Authorized domains:
- Add your Vercel domain: `your-app.vercel.app`
- Add your custom domain if you have one

## 🚀 **Deployment Process**

### **Option 1: Safe Deployment (Recommended)**
```bash
# Test Firebase configuration locally first
npm run test:firebase

# Deploy with validation
npm run deploy:safe
```

### **Option 2: Manual Deployment**
```bash
# Test configuration
npm run test:firebase

# Build and deploy
npm run build
vercel --prod
```

### **Option 3: Preview Deployment**
```bash
# Deploy to preview URL first
npm run deploy:preview

# Verify preview works
npm run verify:production https://your-app-preview.vercel.app

# If all good, deploy to production
npm run deploy:production
```

## 🧪 **Testing Production Deployment**

### **Automated Tests**
```bash
# Test your deployed site
npm run verify:production https://your-app.vercel.app

# Or with environment variable
PRODUCTION_URL=https://your-app.vercel.app npm run verify:production
```

### **Manual Testing Checklist**

#### **1. Health Checks**
- [ ] Visit: `https://your-app.vercel.app/api/firebase-health`
- [ ] Should show: `{"status": "OK", "sessionFree": true}`

#### **2. Authentication Flow**
- [ ] Visit: `https://your-app.vercel.app/auth`
- [ ] Register new account with email/password
- [ ] Login with existing account
- [ ] Test Google Sign-In (if enabled)
- [ ] Check Firebase user appears in Firebase Console

#### **3. API Endpoints**
- [ ] Test protected routes return 401 without auth
- [ ] Test authenticated requests work with valid token
- [ ] Submit application while logged in
- [ ] Check data appears in Neon database

#### **4. Browser Console**
- [ ] No JavaScript errors
- [ ] Firebase initializes correctly
- [ ] API calls include proper Authorization headers

## 🔍 **Troubleshooting**

### **Common Issues**

#### **Firebase Configuration Errors**
```bash
# Check Firebase health endpoint
curl https://your-app.vercel.app/api/firebase-health

# Expected response:
{
  "status": "OK",
  "auth": {
    "firebaseConfigured": true,
    "neonConfigured": true,
    "sessionFree": true
  }
}
```

#### **Environment Variable Issues**
- **Problem**: `Firebase Admin not configured`
- **Solution**: Verify all FIREBASE_* variables are set in Vercel
- **Check**: Ensure FIREBASE_PRIVATE_KEY includes `\n` characters

#### **CORS Issues**
- **Problem**: Frontend can't connect to API
- **Solution**: Check CORS_ORIGINS environment variable
- **Verify**: Includes your production domain

#### **Database Connection Issues**
- **Problem**: `Database connection failed`
- **Solution**: Check DATABASE_URL format and credentials
- **Test**: Run database health check

### **Debugging Steps**

#### **1. Check Vercel Function Logs**
```bash
vercel logs --follow
```

#### **2. Test Individual Components**
```bash
# Test Firebase Admin SDK
node -e "
import('./server/firebase-admin.js').then(m => {
  const app = m.initializeFirebaseAdmin();
  console.log('Firebase Admin:', !!app);
});
"

# Test Database Connection
npm run test:db
```

#### **3. Verify Environment Variables**
In Vercel Dashboard → Settings → Environment Variables:
- Ensure all required variables are set
- Check for typos in variable names
- Verify FIREBASE_PRIVATE_KEY format

## 📊 **Monitoring Production**

### **Health Monitoring**
```bash
# Set up monitoring script
#!/bin/bash
while true; do
  curl -s https://your-app.vercel.app/api/firebase-health | jq .
  sleep 300  # Check every 5 minutes
done
```

### **Error Tracking**
- Monitor Vercel function logs
- Set up alerts for 5xx errors
- Track Firebase Auth errors in console

### **Performance Monitoring**
- Check Vercel Analytics
- Monitor database query performance
- Track Firebase Auth latency

## 🔄 **Deployment Workflow**

### **Recommended Workflow**
1. **Develop** → Test locally with `npm run dev`
2. **Test** → Run `npm run test:firebase`
3. **Preview** → Deploy with `npm run deploy:preview`
4. **Verify** → Test preview with `npm run verify:production`
5. **Production** → Deploy with `npm run deploy:safe`
6. **Monitor** → Check logs and health endpoints

### **Environment-Specific Configurations**

#### **Development**
- Uses localhost Firebase config
- Local database or development Neon instance
- Debug logging enabled

#### **Production**
- Production Firebase project
- Production Neon database
- Error monitoring enabled
- Performance optimizations

## 🎉 **Post-Deployment**

### **Success Indicators**
- [ ] Firebase health endpoint returns OK
- [ ] User registration works
- [ ] Authentication persists across page reloads
- [ ] Database operations work correctly
- [ ] No errors in Vercel logs

### **Next Steps**
1. Set up custom domain (optional)
2. Configure email notifications
3. Set up monitoring and alerts
4. Plan regular security updates
5. Monitor user feedback and performance

## 📞 **Support**

If you encounter issues:
1. Check this troubleshooting guide
2. Review Vercel function logs
3. Test Firebase configuration locally
4. Verify all environment variables
5. Check Firebase Console for auth errors

Your Firebase Auth → Neon Database architecture is now production-ready! 🚀 