# 🚨 URGENT: Email Authentication Fix Required

## **Issue Summary:**
Gmail is blocking your emails with error:
```
550-5.7.26 Your email has been blocked because the sender is unauthenticated.
550-5.7.26 DKIM = did not pass 
550-5.7.26 SPF [localcook.shop] with ip: [23.83.212.18] = did not pass
```

**Root Cause:** Your emails are routing through MailChannels but your SPF record doesn't authorize them.

---

## **IMMEDIATE ACTION REQUIRED:**

### **Current SPF Record (INCORRECT):**
```
v=spf1 include:_spf.hostinger.com ~all
```

### **Updated SPF Record (CORRECT):**
```
v=spf1 include:_spf.hostinger.com include:relay.mailchannels.net ~all
```

---

## **Step-by-Step Fix:**

### **1. Access Your DNS Provider**
Go to wherever you manage DNS for `localcook.shop` (likely Cloudflare, Hostinger, or your domain registrar)

### **2. Find Your SPF Record**
- Look for a **TXT record** for your root domain (`@` or `localcook.shop`)
- It will contain: `v=spf1 include:_spf.hostinger.com ~all`

### **3. Update the SPF Record**
Change the value from:
```
v=spf1 include:_spf.hostinger.com ~all
```

To:
```
v=spf1 include:_spf.hostinger.com include:relay.mailchannels.net ~all
```

### **4. Save Changes**
- Save the DNS record
- Changes may take 5-30 minutes to propagate

---

## **If Using Cloudflare:**

1. Log into Cloudflare Dashboard
2. Select `localcook.shop` domain
3. Go to **DNS** > **Records**
4. Find the **TXT** record with SPF
5. Click **Edit**
6. Update the value to: `v=spf1 include:_spf.hostinger.com include:relay.mailchannels.net ~all`
7. Click **Save**

---

## **If Using Hostinger:**

1. Log into Hostinger account
2. Go to **Domains** > **DNS Zone**
3. Find the **TXT** record with SPF
4. Click **Edit**
5. Update the value to: `v=spf1 include:_spf.hostinger.com include:relay.mailchannels.net ~all`
6. Click **Save**

---

## **Verification:**

After making the change, you can verify it worked by:

1. **Wait 10-15 minutes** for DNS propagation
2. **Test sending an email** from your application
3. **Run the diagnostic script:**
   ```bash
   node scripts/check-email-auth.js
   ```

---

## **Why This Fixes the Issue:**

- **MailChannels IPs:** Your emails route through MailChannels servers (23.83.212.0/20 range)
- **SPF Authorization:** Adding `include:relay.mailchannels.net` tells Gmail that MailChannels is authorized to send emails for your domain
- **Gmail Requirements:** Gmail now requires either SPF OR DKIM to pass for authentication

---

## **URGENT: Make This Change Now**

This is a **critical** issue preventing email delivery to Gmail, Yahoo, and other major providers. The fix takes less than 5 minutes but is essential for your application to function properly.

**Time to Fix:** 2-5 minutes  
**Time to Take Effect:** 10-30 minutes  
**Impact:** Restores email delivery to all major providers 