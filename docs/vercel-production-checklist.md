# Vercel Production Checklist - Full Verification Email

## Environment Variables Required

Make sure these environment variables are set in your Vercel dashboard:

### Email Configuration (Required)
```bash
EMAIL_HOST=smtp.hostinger.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@yourdomain.com
EMAIL_PASS=your-email-password
EMAIL_FROM=Local Cooks <your-email@yourdomain.com>
```

### Vendor Platform Configuration (Optional - has defaults)
```bash
VENDOR_DASHBOARD_URL=https://localcook.shop/app/shop/login.php
VENDOR_SUPPORT_EMAIL=support@localcooks.shop
```

### Database Configuration (Required if using)
```bash
DATABASE_URL=your-postgres-connection-string
```

## Vercel Dashboard Setup

1. **Go to Vercel Dashboard** → Your Project → Settings → Environment Variables

2. **Add each environment variable:**
   - Name: `EMAIL_HOST`
   - Value: `smtp.hostinger.com`
   - Environment: `Production` (and Preview if needed)

3. **Critical Variables to Set:**
   - `EMAIL_HOST`
   - `EMAIL_PORT`
   - `EMAIL_USER` (your SMTP username)
   - `EMAIL_PASS` (your SMTP password)
   - `EMAIL_FROM` (sender display name and email)

## Testing Full Verification Email in Production

### 1. Admin Test Endpoint
- URL: `https://your-domain.vercel.app/admin` (or wherever admin panel is)
- Use the "Test Full Verification Email" component
- Send test email to verify configuration

### 2. Full Workflow Test
1. Create a test user application
2. Admin approves the application
3. User uploads documents (Food Safety License)
4. Admin approves the documents
5. Verify email is sent automatically
6. Test vendor login with generated credentials
7. Verify Stripe onboarding flow works correctly

### 3. Manual API Test
```bash
# Test endpoint (admin auth required)
curl -X POST https://your-domain.vercel.app/api/test-verification-email \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Test User",
    "email": "test@example.com", 
    "phone": "5551234567"
  }'
```

## Production Deployment Steps

### 1. Deploy to Vercel
```bash
npm run build
vercel --prod
```

### 2. Verify Environment Variables
- Check Vercel dashboard that all EMAIL_* variables are set
- Verify no sensitive data is in public environment variables

### 3. Test Email Functionality
- Use admin panel to send test verification email
- Check server logs in Vercel dashboard for any errors
- Verify email delivery to test address

### 4. Monitor First Real Usage
- Watch Vercel function logs during first document approval
- Ensure emails are being sent successfully
- Monitor for any timeout or memory issues

## Common Production Issues & Solutions

### Issue: Email Not Sending
**Symptoms:** No email received, no errors in logs
**Solution:**
- Verify EMAIL_* environment variables are set in Vercel
- Check SMTP credentials are correct
- Ensure firewall allows SMTP connections from Vercel

### Issue: Import Errors in Production
**Symptoms:** "Cannot resolve module" errors
**Solution:**
- Verify all imports use `.js` extension for dynamic imports
- Check that email.ts is being built and included in deployment

### Issue: Function Timeout
**Symptoms:** 504 timeout errors during document approval
**Solution:**
- Increase maxDuration in vercel.json (currently 10s)
- Make email sending asynchronous and non-blocking

### Issue: Environment Variables Not Found
**Symptoms:** Using default values instead of set values
**Solution:**
- Verify variables are set for "Production" environment
- Redeploy after setting environment variables
- Check variable names match exactly (case-sensitive)

## Performance Monitoring

### Metrics to Watch
- **Email send success rate** (check logs)
- **Function execution time** (should be under 5-8 seconds)
- **Memory usage** (currently allocated 1024MB)
- **Error rates** in verification workflow

### Logs to Monitor
```bash
# Success logs to look for:
"Full verification email sent to user@example.com for user 123"
"Vendor credentials generated: username=5551234567"

# Warning logs to investigate:
"Cannot send full verification email: Missing user data"

# Error logs to fix:
"Error sending full verification email:"
```

## Security Considerations

### Email Security
- Never log passwords or sensitive credentials
- Use environment variables for all email configuration
- Verify SMTP connection is encrypted (TLS/SSL)

### Credential Generation
- Ensure phone numbers are properly sanitized
- Validate user input before credential generation
- Log credential generation (username only, never password)

## Backup Plans

### If Email Service Fails
1. **Manual Process:** Admin can manually send credentials
2. **Alternative SMTP:** Switch to backup email service
3. **Queue System:** Implement retry mechanism for failed sends

### If Function Times Out
1. **Increase Timeout:** Update vercel.json maxDuration
2. **Async Processing:** Make email sending non-blocking
3. **Split Functions:** Separate email sending into dedicated function

## Success Checklist

- [ ] All environment variables set in Vercel dashboard
- [ ] Test email sends successfully from admin panel
- [ ] Full document approval workflow triggers email
- [ ] Email template renders correctly in major email clients
- [ ] Vendor login URL links to correct shop login page
- [ ] Support email address is correct in email footer
- [ ] Server logs show successful email sends
- [ ] No function timeouts or memory issues
- [ ] Credentials generated correctly (username = phone, password = name+phone)

## Post-Deployment Monitoring

### First 24 Hours
- Monitor all document approvals for email sends
- Check error rates in Vercel dashboard
- Verify users receive and can use credentials

### Ongoing Monitoring
- Weekly check of email delivery rates
- Monthly review of function performance
- Quarterly review of email template effectiveness

## Support Contacts

- **Vercel Issues:** Vercel support or community
- **Email Delivery:** Your SMTP provider support
- **Application Issues:** Check server logs and debug locally first 