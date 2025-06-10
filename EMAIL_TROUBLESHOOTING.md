# Email Notification Troubleshooting Guide

## Issue: "In Review" Application Emails Not Being Sent

### Root Causes
1. **Email configuration** in your `.env` file contains placeholder values instead of real email credentials
2. **Wrong email template** was being used for new applications in development mode (fixed)

### Current Problem
```bash
EMAIL_USER=your-email@yourdomain.com
EMAIL_PASS=your-email-password
```
These are **placeholder values**, not real credentials.

---

## Solution Steps

### 1. Update Email Configuration

Replace the placeholder values in your `.env` file with real email credentials:

#### For Gmail (Recommended for testing):
```bash
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-app@gmail.com
EMAIL_PASS=your-16-character-app-password
EMAIL_FROM=Local Cooks <your-app@gmail.com>
```

**Important**: For Gmail, you MUST use an "App Password", not your regular password:
1. Go to Google Account settings
2. Security → 2-Step Verification → App passwords
3. Generate a new app password for "Mail"
4. Use the 16-character code as EMAIL_PASS

#### For Hostinger:
```bash
EMAIL_HOST=smtp.hostinger.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=noreply@yourdomain.com
EMAIL_PASS=your-email-password
EMAIL_FROM=Local Cooks <noreply@yourdomain.com>
```

#### For Outlook/Hotmail:
```bash
EMAIL_HOST=smtp-mail.outlook.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@outlook.com
EMAIL_PASS=your-email-password
EMAIL_FROM=Local Cooks <your-email@outlook.com>
```

### 2. Test Email Configuration

After updating your `.env` file, test the email system:

#### Using the Status Email Test Component:
1. Start your development server: `npm run dev`
2. Go to `/admin` in your browser
3. Look for the "Status Email Test" component
4. Fill in test details and send a test email

#### Using the API Endpoint Directly:
```bash
curl -X POST http://localhost:5000/api/test-status-email \
  -H "Content-Type: application/json" \
  -d '{
    "status": "inReview",
    "email": "your-test-email@gmail.com",
    "fullName": "Test User"
  }'
```

### 3. Verify Email Sending

Check your server logs for:

#### Success Messages:
```
SMTP connection verified successfully
Status change email sent to user@example.com for application 123
Email sent successfully: <message-id>
```

#### Error Messages to Watch For:
```
Email configuration is missing. Please set EMAIL_USER and EMAIL_PASS
SMTP connection verification failed: Invalid login
Error sending email: getaddrinfo ENOTFOUND
```

---

## Where Emails Are Triggered

### 1. New Application Submissions ✅ FIXED
- **File**: `server/routes.ts` (line ~296) and `api/index.js`
- **Trigger**: When a new application is created
- **Status**: Automatically set to "inReview"
- **Email**: Now correctly uses `generateApplicationWithDocumentsEmail()` or `generateApplicationWithoutDocumentsEmail()` instead of status change email

### 2. Manual Status Changes
- **File**: `server/routes.ts` (line ~441) and `api/index.js` (line ~1580)
- **Trigger**: When admin changes application status
- **Email**: Sent to applicant notifying of status change

### 3. Document Updates
- **File**: Various locations when documents are verified
- **Trigger**: When document verification status changes
- **Email**: Additional notifications for document-related changes

---

## Common Issues and Solutions

### Issue: "SMTP connection verification failed"
**Solution**: Check your SMTP settings (host, port, credentials)

### Issue: "Authentication failed"
**Solution**: 
- For Gmail: Use App Password, not regular password
- For other providers: Verify credentials are correct

### Issue: "Connection timeout"
**Solution**: 
- Check if your hosting provider blocks SMTP ports
- Try different port (25, 465, 587)
- Verify EMAIL_SECURE setting

### Issue: Emails sent but not received
**Solution**:
- Check spam/junk folders
- Verify EMAIL_FROM address is valid
- Use a domain-based email address for better deliverability

---

## Production Considerations

### 1. Use Professional Email Service
- **Recommended**: SendGrid, Mailgun, Amazon SES
- **Avoid**: Free Gmail accounts for production

### 2. Environment Variables
Make sure to set the same email configuration in your production environment (Vercel, Heroku, etc.)

### 3. Email Deliverability
- Use a verified domain for the FROM address
- Set up SPF, DKIM, and DMARC records
- Monitor bounce rates and spam complaints

---

## Testing Checklist

- [ ] Updated `.env` file with real email credentials
- [ ] Restarted development server
- [ ] Tested email sending with test endpoint
- [ ] Checked server logs for errors
- [ ] Verified test email was received (check spam folder)
- [ ] Submitted a test application to verify new application email (no longer "status change")
- [ ] Tested actual status change email from admin panel

## Recent Fix Applied ✅

**Issue**: Development server (`server/routes.ts`) was incorrectly using `generateStatusChangeEmail()` for new applications, while production (`api/index.js`) was correctly using application-specific email templates.

**Fix**: Updated `server/routes.ts` to use the same logic as production:
- Applications with documents → `generateApplicationWithDocumentsEmail()`
- Applications without documents → `generateApplicationWithoutDocumentsEmail()`

This ensures consistency between development and production environments.

---

## Need Help?

1. Check server console logs for detailed error messages
2. Test with a simple Gmail account first
3. Verify your hosting provider allows SMTP connections
4. Check if firewall is blocking SMTP ports (25, 465, 587)

The email system is properly implemented - the only issue is the email configuration! 