# DKIM Setup Guide for Local Cooks Community

## Overview

This guide will help you set up DKIM (DomainKeys Identified Mail) authentication using the configuration provided by Hostinger. DKIM helps prevent your emails from being marked as spam by verifying that emails are genuinely sent from your domain.

## Your Hostinger DKIM Configuration

**DKIM Host**: `hostingermail1._domainkey`
**DKIM Value**: `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzksTUDJ5tnkVYzHujmQ4pUZ9lHlJxh0UnmTJXH8rcn1j74lZClgxgAIn+aNxULISVLYLwsXDXxJxP3mYn1OOJAMXaOYEle0+liMxIShHw3u5IyxDh0IqcvQ5tGEUIVbTU84naUsadWlLUrwHNRvm3tLuxWrBzP+1AKOzX21+XykAn1y0bAX8/5eWu865CTjFI8mFKq7H06rPbUiPJP1jwSp+tsW3/UvK99ZuVspDEnKPA8ZswqUbeO23ZCX2LMI0QLvWoUc57DSLDaSSJ/+kCuQM2Xr5H2OnBdJf5goo3EuAP/uWmTGc+EUa7/vo5WoolWE6tG+vB5OSXnPSP3lnuQIDAQAB`

## Step 1: Add DKIM Record to Your Domain's DNS

### For Most Domain Registrars (GoDaddy, Namecheap, etc.)

1. **Login to your domain registrar's control panel**
2. **Navigate to DNS Management** (may be called "DNS Zone Editor", "DNS Records", or "Manage DNS")
3. **Add a new TXT record** with these exact values:

```
Record Type: TXT
Name/Host: hostingermail1._domainkey
Value: v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzksTUDJ5tnkVYzHujmQ4pUZ9lHlJxh0UnmTJXH8rcn1j74lZClgxgAIn+aNxULISVLYLwsXDXxJxP3mYn1OOJAMXaOYEle0+liMxIShHw3u5IyxDh0IqcvQ5tGEUIVbTU84naUsadWlLUrwHNRvm3tLuxWrBzP+1AKOzX21+XykAn1y0bAX8/5eWu865CTjFI8mFKq7H06rPbUiPJP1jwSp+tsW3/UvK99ZuVspDEnKPA8ZswqUbeO23ZCX2LMI0QLvWoUc57DSLDaSSJ/+kCuQM2Xr5H2OnBdJf5goo3EuAP/uWmTGc+EUa7/vo5WoolWE6tG+vB5OSXnPSP3lnuQIDAQAB
TTL: 3600 (or use default)
```

### For Cloudflare Users

1. **Login to Cloudflare Dashboard**
2. **Select your domain**
3. **Go to DNS Records**
4. **Click "Add record"**
5. **Set**:
   - Type: `TXT`
   - Name: `hostingermail1._domainkey`
   - Content: `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzksTUDJ5tnkVYzHujmQ4pUZ9lHlJxh0UnmTJXH8rcn1j74lZClgxgAIn+aNxULISVLYLwsXDXxJxP3mYn1OOJAMXaOYEle0+liMxIShHw3u5IyxDh0IqcvQ5tGEUIVbTU84naUsadWlLUrwHNRvm3tLuxWrBzP+1AKOzX21+XykAn1y0bAX8/5eWu865CTjFI8mFKq7H06rPbUiPJP1jwSp+tsW3/UvK99ZuVspDEnKPA8ZswqUbeO23ZCX2LMI0QLvWoUc57DSLDaSSJ/+kCuQM2Xr5H2OnBdJf5goo3EuAP/uWmTGc+EUa7/vo5WoolWE6tG+vB5OSXnPSP3lnuQIDAQAB`
   - TTL: `Auto` or `3600`

## Step 2: Update Your Application Configuration

Update your `.env` file with the correct domain-based email settings:

```bash
# Email Configuration for DKIM
EMAIL_HOST=smtp.hostinger.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=noreply@yourdomain.com  # Replace with your actual domain
EMAIL_PASS=your-hostinger-email-password
EMAIL_FROM=Local Cooks Community <noreply@yourdomain.com>
EMAIL_DOMAIN=yourdomain.com  # Replace with your actual domain

# Organization Information
EMAIL_ORGANIZATION=Local Cooks Community
EMAIL_UNSUBSCRIBE=unsubscribe@yourdomain.com
```

**Important**: Replace `yourdomain.com` with your actual domain name throughout.

## Step 3: Verify DKIM Setup

### Wait for DNS Propagation
- DNS changes can take **24-48 hours** to propagate worldwide
- Local DNS cache may need to be cleared

### Check DKIM Record

**Using Command Line**:
```bash
# Replace yourdomain.com with your actual domain
nslookup -type=TXT hostingermail1._domainkey.yourdomain.com

# Or using dig
dig TXT hostingermail1._domainkey.yourdomain.com
```

**Using Online Tools**:
- [MXToolbox DKIM Lookup](https://mxtoolbox.com/dkim.aspx)
- [Google Admin Toolbox](https://toolbox.googleapps.com/apps/checkmx/)
- [WhatMyName DNS Lookup](https://www.whatsmydns.net/)

### Test Email Authentication

1. **Send a test email** from your application
2. **Use Mail-Tester.com**:
   - Go to [Mail-Tester.com](https://www.mail-tester.com)
   - Send an email to the provided test address
   - Check your authentication score (should be 10/10 with proper DKIM)

## Step 4: Complete Email Authentication Setup

### Add SPF Record (if not already present)
```
Type: TXT
Name: @
Value: v=spf1 include:_spf.hostinger.com ~all
```

### Add DMARC Record (recommended)
```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com
```

## Troubleshooting

### DKIM Record Not Found
- **Wait longer**: DNS propagation can take up to 48 hours
- **Check exact spelling**: Ensure `hostingermail1._domainkey` is exact
- **Contact domain registrar**: Some registrars have specific formatting requirements

### Email Still Going to Spam
- **Verify all DNS records**: SPF, DKIM, and DMARC should all be present
- **Check email content**: Avoid spam trigger words
- **Warm up your domain**: Start with low email volume and gradually increase
- **Monitor bounce rates**: High bounce rates can hurt sender reputation

### DKIM Signature Validation Fails
- **Verify EMAIL_USER domain**: Must match the domain in DKIM record
- **Check Hostinger configuration**: Ensure your email account is properly set up in Hostinger
- **Test with different email providers**: Gmail, Outlook, Yahoo

## Testing Checklist

- [ ] DKIM record added to DNS
- [ ] DNS propagation completed (24-48 hours)
- [ ] DKIM record verified with online tools
- [ ] SPF record configured
- [ ] DMARC record configured (optional but recommended)
- [ ] Application `.env` updated with domain-based email
- [ ] Test email sent through Mail-Tester.com
- [ ] Authentication score 10/10 achieved
- [ ] Test emails received in inbox (not spam)

## Expected Results

Once properly configured, your emails should:
- ✅ Pass DKIM authentication
- ✅ Have improved sender reputation
- ✅ Land in inbox instead of spam folder
- ✅ Display sender verification in email clients
- ✅ Achieve high deliverability scores

## Support

If you encounter issues:
1. **Check DNS propagation**: Use online DNS checker tools
2. **Verify with Hostinger**: Contact Hostinger support for SMTP configuration
3. **Test incrementally**: Test each DNS record individually
4. **Monitor email metrics**: Track delivery and spam rates

---

**Next Steps**: After setting up DKIM, monitor your email deliverability for 7-14 days to see the improvement in spam scores and inbox placement. 