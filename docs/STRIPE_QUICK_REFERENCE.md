# Stripe Integration Quick Reference

## Environment Variables

```bash
# Backend
STRIPE_SECRET_KEY=sk_test_...          # or sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Frontend
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...  # or pk_live_...
```

## Key Files

| File | Purpose |
|------|---------|
| `server/services/stripe-service.ts` | PaymentIntent creation, confirmation, refunds |
| `server/services/stripe-connect-service.ts` | Connect account management |
| `server/services/payment-transactions-service.ts` | Database transaction records |
| `server/routes.ts` | API endpoints and webhook handlers |
| `client/src/components/payment/ACSSDebitPayment.tsx` | Payment form component |
| `client/src/components/manager/StripeConnectSetup.tsx` | Connect setup UI |

## Payment Flow

```
1. Chef → POST /api/payments/create-intent
   ↓
2. Backend creates PaymentIntent
   ↓
3. Frontend collects card via Stripe Elements
   ↓
4. Payment confirmed → automatically captured
   ↓
5. Webhook: payment_intent.succeeded
   ↓
6. Database updated with payment status
```

## Stripe Connect Flow

```
1. Manager → POST /api/manager/stripe-connect/create
   ↓
2. Stripe Connect account created
   ↓
3. GET /api/manager/stripe-connect/onboarding-link
   ↓
4. Manager completes Stripe onboarding
   ↓
5. GET /api/manager/stripe-connect/status
   ↓
6. Account ready → payments split automatically
```

## Payment Split (with Connect)

```
Customer pays: $100.00
├─ Platform fee (5%): $5.00
├─ Stripe processing: ~$2.90
└─ Manager receives: $92.10
```

## Webhook Events

| Event | Handler | Action |
|-------|---------|--------|
| `payment_intent.succeeded` | `handlePaymentIntentSucceeded()` | Update transaction status, sync amounts |
| `payment_intent.payment_failed` | `handlePaymentIntentFailed()` | Mark as failed, record reason |
| `payment_intent.canceled` | `handlePaymentIntentCanceled()` | Mark as canceled |
| `charge.refunded` | `handleChargeRefunded()` | Update refund amount |
| `checkout.session.completed` | `handleCheckoutSessionCompleted()` | Update Checkout transaction |

## Database Tables

### `payment_transactions`
- `payment_intent_id` - Stripe PaymentIntent ID
- `amount` - Total charged (cents)
- `base_amount` - Base before service fee (cents)
- `service_fee` - Platform fee (cents)
- `manager_revenue` - Manager earnings (cents)
- `status` - 'pending' | 'succeeded' | 'failed' | 'refunded'

### `users`
- `stripe_connect_account_id` - Connect account ID
- `stripe_connect_onboarding_status` - 'pending' | 'complete'

### Booking Tables
- `payment_intent_id` - Links to PaymentIntent
- `payment_status` - 'pending' | 'paid' | 'failed' | 'refunded'

## API Endpoints

### Payments
- `POST /api/payments/create-intent` - Create PaymentIntent
- `POST /api/payments/confirm` - Confirm payment (usually not needed)
- `GET /api/payments/intent/:id/status` - Get status

### Stripe Connect
- `POST /api/manager/stripe-connect/create` - Create account
- `GET /api/manager/stripe-connect/onboarding-link` - Get onboarding URL
- `GET /api/manager/stripe-connect/status` - Check status
- `GET /api/manager/stripe-connect/dashboard-link` - Get dashboard link

### Webhooks
- `POST /api/webhooks/stripe` - Webhook handler

## Key Functions

### `createPaymentIntent(params)`
Creates PaymentIntent with automatic capture.

### `getStripePaymentAmounts(paymentIntentId, managerConnectAccountId?)`
Fetches actual amounts from Stripe (for webhooks).

### `createRefund(paymentIntentId, amount?, reason?)`
Creates refund for captured payment.

### `createConnectAccount(params)`
Creates Stripe Connect Express account.

### `isAccountReady(accountId)`
Checks if Connect account can receive payments.

## Testing

### Test Cards
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- 3DS: `4000 0025 0000 3155`

### Stripe CLI
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger payment_intent.succeeded
```

## Common Issues

| Issue | Solution |
|-------|----------|
| PaymentIntent not found | Check `payment_intent_id` in database |
| Webhook not firing | Configure endpoint in Stripe Dashboard |
| Amount mismatch | Use `expectedAmountCents` from frontend |
| Connect not ready | Check onboarding status in database |

## Important Notes

- ✅ All amounts in **cents** (integers)
- ✅ Automatic capture (no manual capture step)
- ✅ Cards only (ACSS disabled)
- ✅ Webhooks sync actual Stripe amounts
- ✅ Connect splits payments automatically
- ⚠️ Webhook endpoint must be before `express.json()`
