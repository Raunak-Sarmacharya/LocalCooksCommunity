# ❓ Frequently Asked Questions (FAQ)

Common questions and solutions for the Local Cooks application.

## 🚀 Getting Started

### Q: How do I set up the application locally?

**A:** Follow these steps:

1. **Clone the repository**
2. **Install dependencies**: `npm install`
3. **Set up environment variables**: Copy `.env.example` to `.env` and fill in the values
4. **Set up the database**: The app will create tables automatically on first run
5. **Start the application**: `npm run dev`

See the [Quick Start Guide](quick-start.md) for detailed instructions.

### Q: What environment variables do I need?

**A:** Required variables:

```bash
# Database (required)
DATABASE_URL=postgresql://...

# Session (required)
SESSION_SECRET=your-random-string

# File Upload (required for production)
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...

# OAuth (optional)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
FACEBOOK_CLIENT_ID=...
FACEBOOK_CLIENT_SECRET=...

# Email (optional)
EMAIL_HOST=smtp.hostinger.com
EMAIL_PORT=587
EMAIL_USER=...
EMAIL_PASS=...
```

See the [Environment Reference](env-reference.md) for complete details.

### Q: How do I access the admin panel?

**A:** 
1. **Login credentials**: Username: `admin`, Password: `localcooks`
2. **URL**: Go to `/admin` after logging in
3. **First time**: The admin account is created automatically when the database is set up

---

## 🔧 Technical Issues

### Q: "Cannot connect to database" error

**A:** Check these common issues:

1. **Database URL format**:
   ```bash
   # Correct format
   DATABASE_URL=postgresql://username:password@host:port/database?sslmode=require
   
   # For Neon (production)
   DATABASE_URL=postgresql://username:password@ep-xxx.us-east-1.aws.neon.tech/dbname?sslmode=require
   ```

2. **Network connectivity**: Ensure your database is accessible
3. **Firewall**: Check if your firewall blocks database connections
4. **SSL mode**: Add `?sslmode=require` for production databases

### Q: File upload not working

**A:** Common causes and solutions:

1. **Missing Blob Token**:
   ```bash
   # Add to .env
   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_your_token_here
   ```

2. **File too large**: Max file size is 10MB
   ```bash
   # Check file size
   ls -lh your-file.pdf
   ```

3. **Invalid file type**: Only PDF, JPG, PNG, WebP allowed
   ```javascript
   // Allowed types
   const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
   ```

4. **Not authenticated**: Make sure user is logged in before uploading

### Q: OAuth login not working

**A:** Check OAuth configuration:

1. **Google OAuth**:
   - Ensure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
   - Verify redirect URI in Google Console: `https://your-app.vercel.app/api/auth/google/callback`
   - Check OAuth consent screen is configured

2. **Facebook OAuth**:
   - Ensure `FACEBOOK_CLIENT_ID` and `FACEBOOK_CLIENT_SECRET` are set
   - Verify redirect URI in Facebook App: `https://your-app.vercel.app/api/auth/facebook/callback`
   - For production, Facebook app must be "Live" or user must be a test user

3. **Common errors**:
   ```bash
   # Error: "OAuth credentials not configured"
   # Solution: Set environment variables
   
   # Error: "redirect_uri_mismatch"
   # Solution: Ensure exact URL match in OAuth provider settings
   ```

### Q: "Session secret not set" error

**A:** Add a session secret to your environment:

```bash
# Generate a random string (32+ characters)
SESSION_SECRET=your-super-secure-random-string-here-make-it-long

# Or generate one:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Q: Applications not showing in admin panel

**A:** Check these issues:

1. **Admin role**: Ensure you're logged in as admin (username: `admin`)
2. **Database connection**: Verify database connection is working
3. **No applications**: Create a test application to verify the flow
4. **JavaScript errors**: Check browser console for errors

---

## 📝 Application Process

### Q: What documents can I upload?

**A:** Accepted file types:
- **PDF** (`.pdf`) - Recommended for certificates
- **Images**: JPG (`.jpg`, `.jpeg`), PNG (`.png`), WebP (`.webp`)
- **File size limit**: 10MB per file
- **Document types**: Food Safety License, Food Establishment Certificate

### Q: Can I update my application after submitting?

**A:** 
- **Application details**: No, you cannot edit application details after submission
- **Documents**: Yes, you can update/replace documents before admin approval
- **Cancellation**: You can cancel your application if it hasn't been approved yet

### Q: How long does application review take?

**A:** 
- **Initial review**: Typically 1-3 business days
- **Document verification**: 1-2 business days after document upload
- **Final approval**: 1-2 business days after document approval
- **Email notifications**: You'll receive updates at each stage

### Q: What are the application statuses?

**A:** Application goes through these statuses:

1. **New** - Just submitted, waiting for initial review
2. **In Review** - Being reviewed by admin
3. **Approved** - Application approved, welcome to Local Cooks!
4. **Rejected** - Application rejected (you'll receive feedback)
5. **Cancelled** - You cancelled the application

### Q: What are the document statuses?

**A:** Each document has its own status:

1. **Pending** - Document uploaded, waiting for admin review
2. **Approved** - Document verified and approved
3. **Rejected** - Document rejected, needs to be re-uploaded

---

## 🔒 Security & Privacy

### Q: Is my personal information secure?

**A:** Yes, we implement multiple security measures:

- **Password security**: Passwords are hashed with bcrypt
- **Session security**: Secure session management
- **Data encryption**: All data transmitted over HTTPS
- **Access control**: Role-based access (applicants can only see their own data)
- **File security**: Documents stored securely in Vercel Blob

### Q: Who can see my uploaded documents?

**A:** 
- **Applicants**: Only you can see your own documents
- **Admins**: Can view all documents for review purposes
- **Public**: Documents are not publicly accessible

### Q: Can I delete my account and data?

**A:** 
- **Account deletion**: Contact admin to delete your account
- **Data removal**: We can remove your personal data upon request
- **Document retention**: Documents may be retained for compliance purposes

---

## 🚀 Deployment

### Q: How do I deploy to production?

**A:** Follow the [Production Deployment Guide](production-deployment.md):

1. **Set up Neon database**
2. **Configure Vercel Blob storage**
3. **Set environment variables in Vercel**
4. **Deploy with `vercel --prod`**

### Q: Environment variables not working in production

**A:** Check Vercel dashboard:

1. Go to **Project Settings** → **Environment Variables**
2. Ensure all variables are set for **Production** environment
3. Redeploy after adding/updating variables
4. Check variable names match exactly (case-sensitive)

### Q: "Function timeout" errors

**A:** This can happen with large file uploads:

1. **Optimize file size**: Compress images/PDFs before upload
2. **Check file size limit**: Max 10MB per file
3. **Network issues**: Try uploading from different network
4. **Vercel limits**: Functions have execution time limits

---

## 🐛 Troubleshooting

### Q: Page won't load / 404 errors

**A:** Common solutions:

1. **Check URL**: Ensure you're using the correct URL
2. **Clear cache**: Clear browser cache and cookies
3. **Hard refresh**: Ctrl+F5 (Windows) or Cmd+Shift+R (Mac)
4. **Check deployment**: Verify app is deployed and running

### Q: "Internal Server Error" (500)

**A:** Check these issues:

1. **Environment variables**: Ensure all required variables are set
2. **Database connection**: Verify database is accessible
3. **Logs**: Check Vercel function logs for specific error
4. **Dependencies**: Ensure all npm packages are installed

### Q: CSS/styling not working

**A:** Common causes:

1. **Cache**: Clear browser cache
2. **CSS compilation**: Restart development server
3. **File path**: Check if CSS files are loading correctly
4. **Tailwind**: Ensure Tailwind CSS is properly configured

### Q: Forms not submitting

**A:** Check these issues:

1. **Authentication**: Ensure user is logged in
2. **JavaScript errors**: Check browser console
3. **Network**: Check network tab for failed requests
4. **Validation**: Ensure all required fields are filled correctly

---

## 📧 Contact & Support

### Q: How do I get help with issues not covered here?

**A:** Several options:

1. **Check the documentation**: Review all docs in the `/docs` folder
2. **Check the code**: Look at `server/routes.ts` for API details
3. **GitHub Issues**: Report bugs or request features
4. **Admin contact**: Email the admin team for application-specific issues

### Q: How do I report a bug?

**A:** To report a bug:

1. **Check if it's a known issue**: Review this FAQ and existing issues
2. **Gather information**:
   - What were you trying to do?
   - What happened instead?
   - Error messages (if any)
   - Browser and version
   - Steps to reproduce
3. **Create detailed report**: Include all information above

### Q: How do I request a new feature?

**A:** For feature requests:

1. **Check existing features**: Review the current functionality
2. **Describe the feature**: What would you like to see?
3. **Explain the use case**: Why would this be useful?
4. **Consider implementation**: How might it work?

---

## 💡 Tips & Best Practices

### Q: What are some tips for a successful application?

**A:** 

1. **Complete all fields**: Fill out every section thoroughly
2. **High-quality documents**: Upload clear, readable PDF files
3. **Correct information**: Double-check all contact information
4. **Professional tone**: Keep feedback/comments professional
5. **Follow up**: Check your email for status updates

### Q: Best practices for file uploads?

**A:** 

1. **Use PDF format**: PDFs work best for official documents
2. **Keep files small**: Under 5MB when possible
3. **Clear scans**: Ensure documents are legible
4. **Correct orientation**: Make sure documents are right-side up
5. **Valid documents**: Upload only current, valid certificates

### Q: How to optimize for mobile use?

**A:** The application is mobile-responsive, but for best experience:

1. **Use landscape mode**: For document review (admin)
2. **Good lighting**: When taking photos of documents
3. **Stable connection**: Ensure stable internet for uploads
4. **Latest browser**: Use updated mobile browsers

---

This FAQ covers the most common questions. For additional help, refer to the other documentation files or contact support! 🎯 