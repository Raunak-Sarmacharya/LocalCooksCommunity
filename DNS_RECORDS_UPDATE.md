# 🚨 URGENT DNS UPDATE REQUIRED

## **Current Issue**
Your SPF record doesn't authorize MailChannels, but your emails are being sent through MailChannels (IP: 23.83.212.18).

## **Current SPF Record (INCORRECT):**
```
v=spf1 include:_spf.hostinger.com ~all
```

## **Updated SPF Record (CORRECT):**
```
v=spf1 include:_spf.hostinger.com include:relay.mailchannels.net ~all
```

---

## **IMMEDIATE ACTION: Update Your DNS**

### Go to your DNS provider (where localcook.shop is registered) and:

1. **Find the existing TXT record for "@" or your root domain**
2. **Update the SPF record value to:**
   ```
   v=spf1 include:_spf.hostinger.com include:relay.mailchannels.net ~all
   ```

### Step-by-Step Instructions:

#### If using Cloudflare:
1. Go to Cloudflare Dashboard
2. Select `localcook.shop` domain
3. Go to DNS → Records
4. Find the TXT record with `v=spf1`
5. Edit the record and change the value to:
   ```
   v=spf1 include:_spf.hostinger.com include:relay.mailchannels.net ~all
   ```
6. Save the record

#### If using GoDaddy/Namecheap/Other:
1. Login to your domain registrar
2. Find DNS Management / Zone Editor
3. Locate the TXT record with `v=spf1`
4. Edit it and update the value to:
   ```
   v=spf1 include:_spf.hostinger.com include:relay.mailchannels.net ~all
   ```
5. Save changes

---

## **Why This Fixes the Problem**

- Your emails are being routed through MailChannels relay servers
- MailChannels IP `23.83.212.18` was NOT authorized in your SPF record
- Gmail rejected emails because the sending IP wasn't authorized
- Adding `include:relay.mailchannels.net` authorizes all MailChannels IPs

---

## **Timeline**

- **DNS Update**: 5 minutes
- **Propagation**: 1-24 hours (usually within 1-2 hours)
- **Email delivery restoration**: Within 2-4 hours after propagation

---

## **Verification**

After updating, verify the fix:

```bash
# Check if SPF record is updated (wait 1-2 hours after DNS change)
node scripts/check-email-auth.js

# Send a test email through your app
# Check if it arrives in inbox (not spam)
```

---

## **Other Records (Already Correct - No Changes Needed)**

✅ **DKIM Record**: Already properly configured  
✅ **DMARC Record**: Already exists  
✅ **Hostinger Authorization**: Already included in SPF  

**Only the SPF record needs updating to include MailChannels.** 