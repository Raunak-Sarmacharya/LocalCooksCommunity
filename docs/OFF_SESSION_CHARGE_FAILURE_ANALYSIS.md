# Off-Session Charge Failure Analysis

## Date: February 7, 2026

## Overview

This document analyzes what happens when automatic (off-session) charges fail for overstay penalties and damage claims, identifies gaps in our current implementation, and outlines the enterprise-grade fallback architecture used by Stripe, Turo, and Airbnb.

---

## Current State Audit

### Overstay Penalties — ✅ Mostly Covered

**File:** `server/services/overstay-penalty-service.ts`

The overstay penalty service has a solid fallback chain:

1. **Happy path**: Off-session charge succeeds → `charge_succeeded`
2. **3DS/SCA required** (`requires_action`): Creates a Stripe Checkout session via `createPenaltyPaymentCheckout()`, emails the chef a payment link → chef completes on-session
3. **Card declined / generic failure**: Sets `charge_failed`, logs reason
4. **No saved payment method**: Sets `charge_failed` immediately
5. **Escalation** (line ~1242): After 3 failed attempts (`MAX_CHARGE_ATTEMPTS_BEFORE_ESCALATION`) → `escalated` status, admin email notification for manual collection
6. **Booking block** (`server/routes/middleware.ts`): `hasChefUnpaidPenalties()` middleware blocks new bookings until resolved
7. **Manual checkout endpoint** (`server/routes/bookings.ts`): Chef can self-serve pay via `/chef/overstay/:id/pay`

### Damage Claims — ⚠️ SIGNIFICANT GAPS

**File:** `server/services/damage-claim-service.ts`

The damage claim service has critical missing fallbacks:

1. **Happy path**: Off-session charge succeeds → `charge_succeeded` ✅
2. **3DS/SCA required**: Sets `charge_failed` with message `"Payment requires action: requires_action"` — **❌ NO payment link sent, NO checkout session created, NO email to chef**
3. **Card declined**: Sets `charge_failed` — **❌ NO retry mechanism, NO escalation**
4. **No escalation function**: Unlike overstay which has `checkAndEscalateOverstay()` — **❌ damage claims have ZERO escalation logic**
5. **No retry counting**: No `countFailedChargeAttempts` equivalent — **❌ no way to know how many times we've tried**
6. **Booking block**: `hasChefUnpaidDamageClaims()` exists in middleware ✅ — but the claim just sits in `charge_failed` forever with no recovery path
7. **No chef self-serve pay endpoint**: Unlike overstay's `/chef/overstay/:id/pay` — **❌ chef has no way to manually pay a failed damage claim**

---

## What Stripe Recommends (Enterprise Standard)

Source: https://docs.stripe.com/payments/save-and-reuse-cards-only
Source: https://docs.stripe.com/payments/off-session-payments
Source: https://docs.stripe.com/billing/revenue-recovery

### The 3 Failure Scenarios

| Scenario | Stripe Error Code | Recovery |
|---|---|---|
| **Card declined** (insufficient funds, expired) | `card_declined` | Notify customer → bring back on-session with new payment method |
| **Authentication required** (3DS/SCA) | `authentication_required` | Notify customer → bring back on-session to complete 3DS challenge with SAME PaymentMethod |
| **Payment method missing** | No PM on file | Create Checkout/Invoice for customer to pay fresh |

### Stripe's Recommended Recovery Flow

1. **Attempt off-session charge** (`off_session: true, confirm: true`)
2. **On failure**, check `error.code`:
   - `authentication_required` → Reuse the existing PaymentIntent, send customer a link to complete 3DS on-session
   - `card_declined` → Create new PaymentIntent or Stripe Invoice, send payment link
3. **Use Stripe Invoices** for dunning — Stripe has built-in **Smart Retries** (AI-powered, retries at optimal times over 2 weeks), **automatic card updates**, and **failed payment emails**
4. **Stripe Hosted Invoice Page** — customer gets a link to pay with any method

### Key Stripe Feature: Smart Retries
- Uses AI to choose optimal retry times
- Default: 8 retries within 2 weeks
- Considers signals like device activity, time of day, card type
- Hard declines (stolen card, closed account) are NOT retried
- Soft declines (insufficient funds, temporary hold) ARE retried

### Key Stripe Feature: Off-Session Payments API (v2)
Stripe now offers a dedicated `v2/payments/off_session_payments` API with built-in retry strategy (`retry-details.retry-strategy=best_available`). This handles retries automatically without any custom code.

### Key Stripe Feature: Automatic Card Updates
When a customer's card is reissued (new number, new expiry), Stripe automatically updates the saved payment method. This prevents failures due to expired cards.

---

## Industry Standard (Turo / Airbnb Model)

### Turo's Damage Claim Collection Flow
1. **Auto-charge saved card** on file
2. **If declined** → Send email/push notification with payment link
3. **If still unpaid after X days** → Send to **third-party collections** (Turo uses external collection agencies)
4. **Account suspension** — guest cannot book until resolved
5. **Turo's protection plan** covers the host in the interim — host gets paid regardless

### Airbnb's AirCover Model
1. **Auto-charge saved card**
2. **If declined** → Airbnb's Resolution Center sends payment request to guest
3. **Guest has 24-72 hours** to respond/pay
4. **If guest refuses** → Airbnb mediates and may pay host from AirCover fund
5. **Persistent non-payment** → Account restriction + potential collections
6. **Host is made whole** by Airbnb's guarantee regardless of guest payment

### Common Enterprise Pattern
```
Auto-charge → 3DS Recovery → Payment Link (Invoice) →
Dunning Emails (3-5 over 2 weeks) → Account Suspension →
Admin Escalation → External Collections
```

---

## Gap Analysis Summary

| Feature | Overstay Penalties | Damage Claims |
|---|---|---|
| Off-session charge | ✅ | ✅ |
| 3DS/SCA → Payment link + email | ✅ | ❌ **MISSING** |
| Card declined → Payment link | ✅ (via checkout) | ❌ **MISSING** |
| Failed charge counting | ✅ | ❌ **MISSING** |
| Auto-escalation after N failures | ✅ (3 attempts) | ❌ **MISSING** |
| Admin notification on escalation | ✅ (email) | ❌ **MISSING** |
| Booking block middleware | ✅ | ✅ |
| Chef self-serve pay endpoint | ✅ | ❌ **MISSING** |
| Stripe Invoice with Smart Retries | ❌ Not used | ❌ Not used |
| Automated dunning emails | ❌ Manual only | ❌ None |
| Cron-based retry | ❌ Manual only | ❌ None |

---

## Recommended Implementation Tiers

### Tier 1: Parity Fix (Quick Win)

Bring damage claims to parity with overstay penalties. No Stripe API changes needed.

**Changes needed in `damage-claim-service.ts`:**

1. **3DS/SCA recovery**: When `paymentIntent.status === 'requires_action'`, create a Stripe Checkout session (like `createPenaltyPaymentCheckout()`) and email the chef a payment link
2. **`createDamageClaimPaymentCheckout()`**: New function to create a Checkout session for a damage claim
3. **`checkAndEscalateDamageClaim()`**: After 3 failed charge attempts → set status to `escalated`, email admin
4. **`countFailedDamageClaimChargeAttempts()`**: Count failed attempts from `damage_claim_history`
5. **Chef self-serve pay endpoint**: `POST /chef/damage-claims/:id/pay` in `bookings.ts` → creates Checkout session

**Estimated effort:** 2-3 hours (copy patterns from overstay service)

### Tier 2: Stripe Invoice-Based Dunning (Enterprise Upgrade)

Migrate both overstay penalties and damage claims to use **Stripe Invoices** instead of raw `paymentIntents.create({ off_session: true })`.

```typescript
// Instead of:
const paymentIntent = await stripe.paymentIntents.create({
  amount: chargeAmountCents,
  customer: stripeCustomerId,
  payment_method: paymentMethodId,
  off_session: true,
  confirm: true,
});

// Use:
const invoice = await stripe.invoices.create({
  customer: stripeCustomerId,
  collection_method: 'charge_automatically',
  auto_advance: true,
  metadata: { type: 'damage_claim', claim_id: claimId.toString() },
});

await stripe.invoiceItems.create({
  customer: stripeCustomerId,
  invoice: invoice.id,
  amount: chargeAmountCents,
  currency: 'cad',
  description: 'Damage Claim #123 - Kitchen XYZ',
});

await stripe.invoices.finalizeInvoice(invoice.id);
```

**Benefits:**
- **Smart Retries**: Stripe's AI retries at optimal times (up to 8 retries over 2 weeks)
- **Automatic card updates**: If card is reissued, Stripe auto-updates
- **Hosted Invoice Page**: Customer gets a branded payment page
- **Failed payment emails**: Stripe sends automatic dunning emails
- **Webhook events**: `invoice.payment_failed`, `invoice.paid` for tracking
- **No custom retry code needed** — Stripe handles it all

**Dashboard configuration required:**
- Enable Smart Retries: Dashboard > Billing > Revenue recovery > Retries
- Enable failed payment emails: Dashboard > Billing > Customer emails
- Enable hosted invoice page: Dashboard > Billing > Invoice settings

**Webhook handlers needed:**
- `invoice.paid` → Update claim/penalty status to `charge_succeeded`
- `invoice.payment_failed` → Update attempt count, check escalation
- `invoice.marked_uncollectible` → Escalate to admin

**Consideration for Connect (Destination Charges):**
Stripe Invoices on the platform account don't natively support `transfer_data.destination`. Options:
- Create invoice on platform, then manually transfer on `invoice.paid` webhook
- Use Stripe Connect's `on_behalf_of` parameter
- Keep raw PaymentIntent for Connect charges but wrap with invoice-like retry logic

**Estimated effort:** 1-2 days

### Tier 3: Full Enterprise Collection Pipeline

1. **Cron job for stale `charge_failed`**: Re-attempt charges after 24h, 72h, 7d
2. **SMS notifications** via Twilio for urgent payment requests
3. **Account standing system**: Good Standing / Warning / Restricted / Suspended
4. **External collections integration** for amounts > $X after Y days
5. **Manager guarantee fund**: Pay manager immediately, collect from chef async (Airbnb model)

**Estimated effort:** 1-2 weeks

---

## Priority Recommendation

**Start with Tier 1** — the damage claims gap is a real risk. If a chef's card requires 3DS for a damage claim, the charge silently fails and sits in `charge_failed` forever with no recovery path. The chef is blocked from booking but has no way to pay. The manager never gets their money.

Tier 2 (Stripe Invoices) is the proper enterprise solution but has Connect complexity. Consider it for a future sprint.

---

## Files Referenced

- `server/services/overstay-penalty-service.ts` — Overstay charge + escalation (reference implementation)
- `server/services/damage-claim-service.ts` — Damage claim charge (needs parity fixes)
- `server/routes/middleware.ts` — Booking block middleware
- `server/routes/bookings.ts` — Chef self-serve pay endpoint for overstay
- `server/routes/webhooks.ts` — Webhook handlers
- `server/services/notification.service.ts` — In-app notifications
