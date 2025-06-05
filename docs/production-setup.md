# 🏭 Production Setup Guide

Complete guide for setting up the Local Cooks application in production, from initial deployment to go-live.

## 🎯 Overview

This guide covers the production setup process:
1. **Pre-deployment preparation**
2. **Production deployment**
3. **Initial configuration**
4. **Admin setup**
5. **Testing & verification**
6. **Go-live checklist**

---

## 📋 Pre-Deployment Checklist

### 1. Required Accounts & Services

- [ ] **Vercel Account** - For hosting and blob storage
- [ ] **Neon Account** - For PostgreSQL database
- [ ] **Domain** (optional) - For custom URL
- [ ] **Email Service** (optional) - For notifications (Hostinger, Gmail, etc.)
- [ ] **OAuth Apps** (optional) - Google, Facebook apps

### 2. Development Environment Ready

- [ ] Application works locally
- [ ] All features tested
- [ ] Environment variables documented
- [ ] Database schema verified
- [ ] File upload tested
- [ ] OAuth flows tested (if using)

---

## 🚀 Step 1: Production Deployment

Follow the [Production Deployment Guide](production-deployment.md) for the complete deployment process.

### Quick Summary:

```bash
# 1. Deploy to Vercel
vercel --prod

# 2. Set up Neon database
# (Create project in Neon dashboard)

# 3. Configure Vercel Blob
vercel blob create

# 4. Set environment variables in Vercel dashboard
# (See environment reference)
```

---

## ⚙️ Step 2: Initial Configuration

### 2.1 Verify Database Setup

Once deployed, verify the database is working:

```bash
# Check if tables are created
curl https://your-app.vercel.app/api/health

# Expected response:
{
  "status": "healthy",
  "database": "connected",
  "environment": "production"
}
```

### 2.2 Verify File Upload

Test file upload functionality:

```bash
# Test upload endpoint (requires authentication)
curl -X POST -F "file=@test.pdf" \
  -H "Cookie: connect.sid=your-session" \
  https://your-app.vercel.app/api/upload-file
```

### 2.3 Check Application Flow

1. **Visit your application**: `https://your-app.vercel.app`
2. **Register a test user**: Create an account
3. **Submit test application**: Fill out the form with test data
4. **Login as admin**: Use admin credentials
5. **Review test application**: Verify admin panel works

---

## 👤 Step 3: Admin Setup

### 3.1 Default Admin Account

The system creates a default admin account automatically:

```bash
Username: admin
Password: localcooks
```

**⚠️ IMPORTANT**: Change the default password immediately!

### 3.2 Change Admin Password

Currently, changing the admin password requires direct database access:

```sql
-- Generate new password hash
-- Use bcrypt with 10 rounds
-- Example: bcrypt('your-new-password', 10)

UPDATE users 
SET password = '$2b$10$your-new-hashed-password-here'
WHERE username = 'admin';
```

### 3.3 Create Additional Admin Users (Optional)

To create additional admin accounts:

```sql
INSERT INTO users (username, password, role, is_verified) VALUES 
('admin2@yourcompany.com', '$2b$10$hashed-password', 'admin', true);
```

### 3.4 Admin Panel Access

1. **Login**: Go to `/login` and use admin credentials
2. **Access admin panel**: Navigate to `/admin`
3. **Verify functionality**:
   - View applications list
   - Test application status updates
   - Test document verification
   - Test email notifications (if configured)

---

## 📧 Step 4: Email Configuration (Optional)

### 4.1 Set Up Email Service

Configure email for application status notifications:

```bash
# In Vercel environment variables:
EMAIL_HOST=smtp.hostinger.com
EMAIL_PORT=587
EMAIL_USER=your-email@yourdomain.com
EMAIL_PASS=your-email-password
EMAIL_FROM=Local Cooks <your-email@yourdomain.com>
```

### 4.2 Test Email Functionality

```bash
# Test email endpoint (admin only)
curl -X POST https://your-app.vercel.app/api/test-status-email \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=admin-session" \
  -d '{"applicationId": 1, "status": "approved"}'
```

### 4.3 Email Templates

The system uses built-in email templates for:
- **Application submitted** confirmation
- **Status change** notifications (approved, rejected)
- **Document verification** updates

---

## 🔐 Step 5: OAuth Setup (Optional)

### 5.1 Google OAuth

1. **Set up Google project**: Follow [OAuth Setup Guide](oauth-setup.md)
2. **Configure redirect URLs**:
   ```
   https://your-app.vercel.app/api/auth/google/callback
   ```
3. **Set environment variables**:
   ```bash
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   ```

### 5.2 Facebook OAuth

1. **Set up Facebook app**: Follow [OAuth Setup Guide](oauth-setup.md)
2. **Configure redirect URLs**:
   ```
   https://your-app.vercel.app/api/auth/facebook/callback
   ```
3. **Set environment variables**:
   ```bash
   FACEBOOK_CLIENT_ID=your-facebook-app-id
   FACEBOOK_CLIENT_SECRET=your-facebook-app-secret
   ```

### 5.3 Test OAuth Flows

1. **Test Google login**: Visit `/login` and click "Continue with Google"
2. **Test Facebook login**: Visit `/login` and click "Continue with Facebook"
3. **Verify user creation**: Check that OAuth users are created in database

---

## 🧪 Step 6: End-to-End Testing

### 6.1 User Registration & Login

- [ ] **Local account registration** works
- [ ] **Local account login** works
- [ ] **Google OAuth** works (if configured)
- [ ] **Facebook OAuth** works (if configured)
- [ ] **Session persistence** works across page refreshes

### 6.2 Application Submission

- [ ] **Form validation** works correctly
- [ ] **File upload** works for both document types
- [ ] **Application submission** creates database record
- [ ] **Email confirmation** sent (if configured)
- [ ] **User can view** their submitted application

### 6.3 Admin Workflow

- [ ] **Admin login** works
- [ ] **Applications list** displays submitted applications
- [ ] **Application details** page shows all information
- [ ] **Status updates** work and trigger emails
- [ ] **Document viewing** works for uploaded files
- [ ] **Document verification** updates work

### 6.4 File System

- [ ] **Document upload** stores files in Vercel Blob
- [ ] **File URLs** are accessible to admins
- [ ] **File cleanup** happens on upload errors
- [ ] **File size limits** are enforced
- [ ] **File type validation** works

---

## 🌐 Step 7: Custom Domain (Optional)

### 7.1 Add Domain to Vercel

1. **Vercel Dashboard** → Your Project → Settings → Domains
2. **Add domain**: Enter your custom domain
3. **Configure DNS**: Add CNAME record pointing to Vercel

### 7.2 Update OAuth Settings

Update OAuth redirect URLs to use your custom domain:

```bash
# Google OAuth
https://yourdomain.com/api/auth/google/callback

# Facebook OAuth  
https://yourdomain.com/api/auth/facebook/callback
```

### 7.3 SSL Certificate

- Vercel automatically provisions SSL certificates
- Your site will be available at `https://yourdomain.com`

---

## 📊 Step 8: Monitoring & Analytics Setup

### 8.1 Set Up Monitoring

1. **Vercel Analytics**: Enable in project settings
2. **Function Logs**: Monitor in Vercel dashboard
3. **Database Monitoring**: Use Neon dashboard
4. **Uptime Monitoring**: Consider external service

### 8.2 Error Tracking

```javascript
// Add error tracking to your application
// Example: Sentry, LogRocket, or similar service

// In production, monitor:
// - Function errors
// - Database connection issues
// - File upload failures
// - OAuth authentication failures
```

### 8.3 Performance Monitoring

Monitor key metrics:
- **Page load times**
- **API response times**
- **File upload speeds**
- **Database query performance**

---

## 🔒 Step 9: Security Hardening

### 9.1 Environment Variables Audit

- [ ] **All secrets** stored in Vercel environment variables
- [ ] **No secrets** in code repository
- [ ] **Session secret** is strong and unique
- [ ] **Database URL** uses SSL mode
- [ ] **OAuth secrets** are secure

### 9.2 Access Control Verification

- [ ] **Default admin password** changed
- [ ] **Admin access** restricted to authorized users
- [ ] **User data isolation** working (users see only their data)
- [ ] **File access** restricted to authenticated users
- [ ] **Document access** restricted to admins

### 9.3 Security Headers

Verify security headers are in place:
- HTTPS enforcement
- Secure cookies
- CORS configuration
- Content Security Policy (if needed)

---

## 📋 Step 10: Go-Live Checklist

### Pre-Launch

- [ ] **All testing** completed successfully
- [ ] **Admin accounts** configured and tested
- [ ] **Email notifications** working (if configured)
- [ ] **OAuth providers** approved for production (if using)
- [ ] **Custom domain** configured (if using)
- [ ] **Monitoring** set up
- [ ] **Backup strategy** in place

### Launch Day

- [ ] **Final deployment** completed
- [ ] **DNS propagation** complete (if using custom domain)
- [ ] **SSL certificate** active
- [ ] **All services** responding correctly
- [ ] **Admin access** verified
- [ ] **Test application** submitted and processed

### Post-Launch

- [ ] **Monitor logs** for first 24 hours
- [ ] **Test user registration** flow
- [ ] **Test application submission** flow
- [ ] **Test admin approval** flow
- [ ] **Monitor performance** metrics
- [ ] **Set up regular backups**

---

## 📚 Step 11: Documentation & Training

### 11.1 User Documentation

Create or customize user-facing documentation:
- **Application process** guide
- **Document requirements** list
- **Contact information** for support
- **FAQ** for common questions

### 11.2 Admin Training

Train admin users on:
- **Admin panel** navigation
- **Application review** process
- **Document verification** workflow
- **Status update** procedures
- **Email communication** with applicants

### 11.3 Technical Documentation

Maintain technical documentation:
- **Environment variables** reference
- **Deployment procedures**
- **Troubleshooting** guides
- **Backup and recovery** procedures

---

## 🎯 Step 12: Ongoing Maintenance

### 12.1 Regular Tasks

**Daily:**
- Monitor application logs
- Check for new applications
- Respond to user inquiries

**Weekly:**
- Review performance metrics
- Check storage usage
- Update application statuses

**Monthly:**
- Review security logs
- Update dependencies (if needed)
- Backup database
- Review user feedback

### 12.2 Scaling Considerations

Monitor and plan for:
- **Increased user volume**
- **Storage growth** (documents)
- **Database performance**
- **Function execution limits**

### 12.3 Feature Updates

Plan for future enhancements:
- Additional document types
- Enhanced admin features
- User self-service options
- Integration with external systems

---

## ✅ Production Setup Complete!

Your Local Cooks application is now live and ready for users! 🎉

### Key Points to Remember:

1. **Monitor regularly**: Keep an eye on logs and performance
2. **Backup data**: Regular database backups are crucial
3. **Update security**: Keep dependencies and secrets up to date
4. **User support**: Provide clear communication channels
5. **Continuous improvement**: Gather feedback and iterate

### Support Resources:

- **Documentation**: All docs in `/docs` folder
- **API Reference**: [API Reference](api-reference.md)
- **Troubleshooting**: [FAQ](faq.md)
- **Deployment Issues**: [Production Deployment Guide](production-deployment.md)

Your production environment is now ready to serve the Local Cooks community! 🍳👨‍🍳👩‍🍳 