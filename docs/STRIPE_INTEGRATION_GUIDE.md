# Stripe Integration Guide for Kitchen Booking System

This document provides a comprehensive overview of how Stripe is set up, integrated, and used in the LocalCooks Community kitchen booking system. This guide is designed to help developers understand the complete payment flow and continue working on Stripe-related features.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Environment Setup](#environment-setup)
4. [Core Services](#core-services)
5. [Payment Flow](#payment-flow)
6. [Stripe Connect](#stripe-connect)
7. [Webhooks](#webhooks)
8. [Database Schema](#database-schema)
9. [API Endpoints](#api-endpoints)
10. [Frontend Components](#frontend-components)
11. [Common Tasks](#common-tasks)

---

## Overview

The system uses **Stripe** for processing payments for kitchen bookings. Key features:

- **Payment Methods**: Credit/debit cards (ACSS debit was previously supported but is now disabled)
- **Payment Capture**: Automatic capture (payments are immediately processed)
- **Stripe Connect**: Managers can connect their Stripe accounts to receive payments directly
- **Split Payments**: Platform service fee is automatically deducted when using Stripe Connect
- **Webhooks**: Real-time payment status updates via Stripe webhooks

### Payment Flow Summary

1. Chef creates a booking and initiates payment
2. Backend creates a Stripe PaymentIntent
3. Frontend collects payment method using Stripe Elements
4. Payment is confirmed and automatically captured
5. Funds are split between platform and manager (if Connect is set up)
6. Webhooks update payment status in the database

---

## Architecture

### Key Components

```
┌─────────────────┐
│   Frontend      │
│  (React/TSX)    │
│                 │
│ - Payment Form  │
│ - Connect Setup │
└────────┬────────┘
         │
         │ HTTP API
         │
┌────────▼─────────────────────────┐
│        Backend API                │
│  (Express/TypeScript)             │
│                                   │
│  ┌─────────────────────────────┐  │
│  │  Stripe Services            │  │
│  │  - stripe-service.ts        │  │
│  │  - stripe-connect-service.ts│  │
│  │  - stripe-checkout-service.ts│ │
│  └─────────────────────────────┘  │
│                                   │
│  ┌─────────────────────────────┐  │
│  │  Payment Services           │  │
│  │  - payment-transactions-    │  │
│  │    service.ts               │  │
│  │  - pricing-service.ts       │  │
│  └─────────────────────────────┘  │
└────────┬──────────────────────────┘
         │
         │ Stripe API
         │
┌────────▼────────┐
│  Stripe API     │
│  - PaymentIntents│
│  - Connect      │
│  - Webhooks     │
└─────────────────┘
```

---

## Environment Setup

### Required Environment Variables

#### Backend (Server)
```bash
# Stripe Secret Key (from Stripe Dashboard)
STRIPE_SECRET_KEY=sk_test_...  # or sk_live_... for production

# Stripe Webhook Secret (for webhook signature verification)
STRIPE_WEBHOOK_SECRET=whsec_...
```

#### Frontend (Client)
```bash
# Stripe Publishable Key (public, safe to expose)
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...  # or pk_live_... for production
```

### Getting Your Stripe Keys

1. **Stripe Dashboard**: https://dashboard.stripe.com
2. **API Keys**: Developers → API keys
3. **Webhooks**: Developers → Webhooks → Add endpoint → Copy signing secret

### Stripe API Version

The project uses Stripe API version: **`2025-12-15.clover`**

This is configured in all Stripe service files:
```typescript
const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2025-12-15.clover',
});
```

---

## Core Services

### 1. Stripe Service (`server/services/stripe-service.ts`)

**Purpose**: Core service for creating and managing PaymentIntents.

**Key Functions**:

#### `createPaymentIntent(params)`
Creates a Stripe PaymentIntent for a booking.

**Parameters**:
```typescript
{
  amount: number;              // Amount in cents
  currency?: string;            // Default: 'cad'
  chefId: number;               // Chef making the payment
  kitchenId: number;             // Kitchen being booked
  managerConnectAccountId?: string;  // Manager's Stripe Connect account (optional)
  applicationFeeAmount?: number;     // Platform service fee in cents (if Connect)
  enableACSS?: boolean;         // ACSS debit (default: false, disabled)
  enableCards?: boolean;        // Credit/debit cards (default: true)
  metadata?: Record<string, string>;  // Additional metadata
}
```

**Returns**:
```typescript
{
  id: string;              // PaymentIntent ID
  clientSecret: string;    // Client secret for frontend
  status: string;          // PaymentIntent status
  amount: number;          // Amount in cents
}
```

**Key Features**:
- **Automatic Capture**: Payments are immediately processed (no authorization holds)
- **Stripe Connect Support**: If `managerConnectAccountId` is provided, payment is split:
  - Platform receives `applicationFeeAmount`
  - Manager receives `amount - applicationFeeAmount - processingFee`
- **Payment Method Types**: Currently only cards are enabled (ACSS disabled)
- **Card Saving**: Cards are saved for future off-session payments

#### `getStripePaymentAmounts(paymentIntentId, managerConnectAccountId?)`
Retrieves actual payment amounts from Stripe (useful for webhooks).

**Returns**:
```typescript
{
  stripeAmount: number;        // Total charged (cents)
  stripeNetAmount: number;     // Net after fees (cents)
  stripeProcessingFee: number; // Stripe's processing fee (cents)
  stripePlatformFee: number;   // Platform fee (cents)
  chargeId: string | null;
}
```

#### `createRefund(paymentIntentId, amount?, reason?)`
Creates a refund for a captured payment.

#### `verifyPaymentIntentForBooking(paymentIntentId, chefId, expectedAmount)`
Verifies that a PaymentIntent belongs to the correct chef and has valid amount/status.

---

### 2. Stripe Connect Service (`server/services/stripe-connect-service.ts`)

**Purpose**: Manages Stripe Connect accounts for managers to receive payments directly.

**Key Functions**:

#### `createConnectAccount(params)`
Creates a Stripe Connect Express account for a manager.

**Parameters**:
```typescript
{
  managerId: number;
  email: string;
  country?: string;  // Default: 'CA'
}
```

**Returns**:
```typescript
{
  accountId: string;  // Stripe Connect account ID
}
```

#### `createAccountLink(accountId, refreshUrl, returnUrl)`
Creates a link for Stripe's hosted onboarding flow.

**Returns**:
```typescript
{
  url: string;  // URL to redirect manager to Stripe onboarding
}
```

#### `isAccountReady(accountId)`
Checks if a Connect account is ready to receive payments.

**Returns**: `boolean`

#### `getAccountStatus(accountId)`
Gets detailed account status.

**Returns**:
```typescript
{
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  isReady: boolean;
}
```

#### `createDashboardLoginLink(accountId)`
Creates a login link for the Stripe Express Dashboard.

---

### 3. Stripe Checkout Service (`server/services/stripe-checkout-service.ts`)

**Purpose**: Alternative payment flow using Stripe Checkout (hosted payment page).

**Note**: This is a separate payment flow from PaymentIntents. Currently, the main flow uses PaymentIntents.

**Key Functions**:

#### `createCheckoutSession(params)`
Creates a Stripe Checkout session with two line items:
1. Kitchen Session Booking (base price)
2. Platform Service Fee

**Parameters**:
```typescript
{
  bookingPriceInCents: number;
  platformFeeInCents: number;
  managerStripeAccountId: string;
  customerEmail: string;
  bookingId: number;
  successUrl: string;
  cancelUrl: string;
  currency?: string;  // Default: 'cad'
}
```

---

### 4. Payment Transactions Service (`server/services/payment-transactions-service.ts`)

**Purpose**: Manages payment transaction records in the database.

**Key Functions**:

#### `createPaymentTransaction(params, dbPool)`
Creates a payment transaction record.

**Parameters**:
```typescript
{
  bookingId: number;
  bookingType: 'kitchen' | 'storage' | 'equipment';
  chefId: number;
  managerId: number;
  amount: number;           // Total in cents
  baseAmount: number;       // Base before service fee
  serviceFee: number;       // Platform service fee
  managerRevenue: number;   // Manager earnings
  currency?: string;
  paymentIntentId?: string;
  paymentMethodId?: string;
  status?: 'pending' | 'succeeded' | 'failed' | 'refunded';
}
```

#### `updatePaymentTransaction(transactionId, params, dbPool)`
Updates a payment transaction (used by webhooks).

#### `findPaymentTransactionByIntentId(paymentIntentId, dbPool)`
Finds a transaction by Stripe PaymentIntent ID.

#### `syncStripeAmountsToBookings(paymentIntentId, stripeAmounts, dbPool)`
Syncs actual Stripe amounts to booking tables.

---

## Payment Flow

### Step-by-Step Payment Process

#### 1. Chef Initiates Booking Payment

**Frontend**: User clicks "Book Kitchen" and fills out booking form.

**API Call**: `POST /api/payments/create-intent`

**Request Body**:
```json
{
  "kitchenId": 123,
  "bookingDate": "2024-01-15",
  "startTime": "09:00",
  "endTime": "17:00",
  "selectedStorage": [...],
  "selectedEquipmentIds": [...],
  "expectedAmountCents": 15000
}
```

#### 2. Backend Creates PaymentIntent

**Location**: `server/routes.ts` (line ~7600)

**Process**:
1. Validates booking details
2. Calculates total price (kitchen + storage + equipment)
3. Calculates platform service fee (from `platform_settings` table)
4. Checks if manager has Stripe Connect account
5. Creates PaymentIntent via `stripe-service.ts`

**Response**:
```json
{
  "paymentIntentId": "pi_...",
  "clientSecret": "pi_..._secret_...",
  "amount": 15000,
  "currency": "CAD"
}
```

#### 3. Frontend Collects Payment Method

**Component**: `client/src/components/payment/ACSSDebitPayment.tsx`

**Process**:
1. Loads Stripe.js with publishable key
2. Creates Stripe Elements with `clientSecret`
3. Renders `PaymentElement` (card input)
4. User enters card details

#### 4. Payment Confirmation

**Process**:
1. User clicks "Confirm Payment"
2. Frontend calls `stripe.confirmPayment()` with `clientSecret`
3. Stripe processes payment (3DS if required)
4. Payment is **automatically captured** (no separate capture step)
5. On success, frontend calls `onSuccess(paymentIntentId, paymentMethodId)`

#### 5. Booking Creation

**API Call**: `POST /api/bookings/create` (or similar)

**Process**:
1. Creates booking record in database
2. Creates payment transaction record
3. Links booking to PaymentIntent ID

#### 6. Webhook Updates Status

**Webhook Event**: `payment_intent.succeeded`

**Process**:
1. Stripe sends webhook to `/api/webhooks/stripe`
2. Backend verifies webhook signature
3. Updates `payment_transactions` table with:
   - Status: `succeeded`
   - Actual Stripe amounts (from `getStripePaymentAmounts()`)
   - Charge ID
4. Updates booking tables (`kitchen_bookings`, etc.) with `payment_status = 'paid'`

---

## Stripe Connect

### Overview

Stripe Connect allows managers to receive payments directly to their bank accounts, with the platform service fee automatically deducted.

### Manager Onboarding Flow

#### 1. Manager Clicks "Connect Stripe Account"

**Component**: `client/src/components/manager/StripeConnectSetup.tsx`

**API Call**: `POST /api/manager/stripe-connect/create`

**Process**:
1. Backend creates Stripe Connect Express account
2. Stores `stripe_connect_account_id` in `users` table
3. Sets `stripe_connect_onboarding_status = 'pending'`

#### 2. Manager Completes Onboarding

**API Call**: `GET /api/manager/stripe-connect/onboarding-link`

**Process**:
1. Backend creates account link via `stripe-connect-service.ts`
2. Returns Stripe onboarding URL
3. Frontend opens URL in new tab
4. Manager completes Stripe's hosted onboarding:
   - Business information
   - Bank account details
   - Identity verification

#### 3. Onboarding Status Check

**API Call**: `GET /api/manager/stripe-connect/status`

**Process**:
1. Backend checks account status via `isAccountReady()`
2. Updates `stripe_connect_onboarding_status = 'complete'` if ready
3. Returns status to frontend

### Payment Split with Connect

When a manager has a connected account:

**Payment Flow**:
1. Customer pays $100.00
2. Platform service fee: $5.00 (5%)
3. Stripe processing fee: ~$2.90 (2.9% + $0.30)
4. Manager receives: $92.10

**Implementation**:
```typescript
// In createPaymentIntent()
if (managerConnectAccountId && applicationFeeAmount) {
  paymentIntentParams.application_fee_amount = applicationFeeAmount;  // $5.00
  paymentIntentParams.transfer_data = {
    destination: managerConnectAccountId,  // Manager's account
  };
}
```

**Result**:
- Platform account receives: `applicationFeeAmount` ($5.00)
- Manager's connected account receives: `amount - applicationFeeAmount - processingFee` ($92.10)
- Stripe automatically handles the split

### Manager Dashboard Access

**API Call**: `GET /api/manager/stripe-connect/dashboard-link`

**Process**:
1. Creates login link via `createDashboardLoginLink()`
2. Manager can access their Stripe Express Dashboard
3. View payments, payouts, and account settings

---

## Webhooks

### Webhook Endpoint

**URL**: `POST /api/webhooks/stripe`

**Location**: 
- `server/routes.ts` (line ~3921)
- `api/index.js` (line ~178)

**Important**: Webhook endpoint must be defined **BEFORE** `express.json()` middleware because Stripe requires raw body for signature verification.

### Webhook Verification

```typescript
const sig = req.headers['stripe-signature'];
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (webhookSecret && sig) {
  event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
} else {
  // Development: allow without verification
  event = req.body as Stripe.Event;
}
```

### Handled Events

#### 1. `checkout.session.completed`
**Handler**: `handleCheckoutSessionCompleted()`

**Process**:
- Updates `transactions` table (for Checkout flow)
- Extracts PaymentIntent and Charge IDs
- Sets status to `completed`

#### 2. `payment_intent.succeeded`
**Handler**: `handlePaymentIntentSucceeded()`

**Process**:
1. Finds payment transaction by PaymentIntent ID
2. Fetches actual Stripe amounts via `getStripePaymentAmounts()`
3. Updates transaction with:
   - Status: `succeeded`
   - Actual Stripe amounts (overrides calculated amounts)
   - Charge ID
   - Paid timestamp
4. Syncs amounts to booking tables
5. Updates booking payment status to `paid`

#### 3. `payment_intent.payment_failed`
**Handler**: `handlePaymentIntentFailed()`

**Process**:
- Updates transaction status to `failed`
- Records failure reason
- Updates booking payment status

#### 4. `payment_intent.canceled`
**Handler**: `handlePaymentIntentCanceled()`

**Process**:
- Updates transaction status to `canceled`
- Updates booking payment status

#### 5. `charge.refunded`
**Handler**: `handleChargeRefunded()`

**Process**:
- Updates transaction with refund amount
- Sets status to `refunded` (if full refund)
- Updates booking payment status

### Webhook Testing

**Stripe CLI**:
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Trigger test events
stripe trigger payment_intent.succeeded
```

---

## Database Schema

### Payment Transactions Table

**Table**: `payment_transactions`

**Schema** (from `shared/schema.ts`):
```typescript
{
  id: serial;
  bookingId: integer;           // References booking (kitchen/storage/equipment)
  bookingType: enum;             // 'kitchen' | 'storage' | 'equipment'
  chefId: integer;               // Chef who made payment
  managerId: integer;             // Manager who receives payment
  // Amounts (all in cents)
  amount: numeric;                // Total charged
  baseAmount: numeric;            // Base before service fee
  serviceFee: numeric;            // Platform service fee
  managerRevenue: numeric;        // Manager earnings
  refundAmount: numeric;          // Total refunded
  netAmount: numeric;             // Final amount after refunds
  currency: text;                 // Default: 'CAD'
  // Stripe IDs
  paymentIntentId: text;          // Stripe PaymentIntent ID
  chargeId: text;                 // Stripe Charge ID
  refundId: text;                 // Stripe Refund ID
  paymentMethodId: text;          // Stripe PaymentMethod ID
  // Status
  status: enum;                   // 'pending' | 'succeeded' | 'failed' | 'refunded'
  stripeStatus: text;             // Raw Stripe status
  // Metadata
  metadata: jsonb;                // Additional data
  webhookEventId: text;           // Last webhook event ID
  lastSyncedAt: timestamp;        // Last sync with Stripe
  createdAt: timestamp;
  updatedAt: timestamp;
}
```

### Users Table (Stripe Connect)

**Fields**:
```sql
stripe_connect_account_id TEXT        -- Stripe Connect account ID
stripe_connect_onboarding_status TEXT -- 'pending' | 'complete'
```

### Booking Tables

**Fields** (in `kitchen_bookings`, `storage_bookings`, `equipment_bookings`):
```sql
payment_intent_id TEXT           -- Stripe PaymentIntent ID
payment_status TEXT              -- 'pending' | 'paid' | 'failed' | 'refunded'
```

---

## API Endpoints

### Payment Endpoints

#### `POST /api/payments/create-intent`
Creates a PaymentIntent for a booking.

**Auth**: Requires `requireChef` middleware

**Request**:
```json
{
  "kitchenId": 123,
  "bookingDate": "2024-01-15",
  "startTime": "09:00",
  "endTime": "17:00",
  "selectedStorage": [...],
  "selectedEquipmentIds": [...],
  "expectedAmountCents": 15000
}
```

**Response**:
```json
{
  "paymentIntentId": "pi_...",
  "clientSecret": "pi_..._secret_...",
  "amount": 15000,
  "currency": "CAD"
}
```

#### `POST /api/payments/confirm`
Confirms a PaymentIntent (usually not needed - frontend handles this).

#### `GET /api/payments/intent/:id/status`
Gets PaymentIntent status.

### Stripe Connect Endpoints

#### `POST /api/manager/stripe-connect/create`
Creates a Stripe Connect account for a manager.

**Auth**: Requires `requireManager` middleware

**Response**:
```json
{
  "accountId": "acct_..."
}
```

#### `GET /api/manager/stripe-connect/onboarding-link`
Gets Stripe onboarding link.

**Response**:
```json
{
  "url": "https://connect.stripe.com/..."
}
```

#### `GET /api/manager/stripe-connect/status`
Checks onboarding status.

**Response**:
```json
{
  "accountId": "acct_...",
  "status": "complete",
  "chargesEnabled": true,
  "payoutsEnabled": true
}
```

#### `GET /api/manager/stripe-connect/dashboard-link`
Gets Stripe Dashboard login link.

**Response**:
```json
{
  "url": "https://connect.stripe.com/express/..."
}
```

### Webhook Endpoint

#### `POST /api/webhooks/stripe`
Handles Stripe webhook events.

**Auth**: None (verified via Stripe signature)

**Note**: Must be defined before `express.json()` middleware.

---

## Frontend Components

### Payment Form Component

**File**: `client/src/components/payment/ACSSDebitPayment.tsx`

**Purpose**: Collects payment method and confirms payment.

**Props**:
```typescript
{
  clientSecret: string;    // From PaymentIntent
  amount: number;           // In cents
  currency: string;
  onSuccess: (paymentIntentId: string, paymentMethodId: string) => void;
  onError: (error: string) => void;
}
```

**Features**:
- Uses Stripe Elements (`PaymentElement`)
- Handles card payments only (ACSS disabled)
- Automatic payment confirmation
- Card saving for future use

**Usage**:
```tsx
<ACSSDebitPayment
  clientSecret={paymentIntent.clientSecret}
  amount={15000}
  currency="CAD"
  onSuccess={(paymentIntentId, paymentMethodId) => {
    // Handle successful payment
  }}
  onError={(error) => {
    // Handle error
  }}
/>
```

### Stripe Connect Setup Component

**File**: `client/src/components/manager/StripeConnectSetup.tsx`

**Purpose**: Allows managers to set up Stripe Connect.

**Features**:
- Create Connect account
- Start onboarding flow
- Check onboarding status
- Access Stripe Dashboard

---

## Common Tasks

### Adding a New Payment Method

1. **Update `stripe-service.ts`**:
   - Add payment method type to `payment_method_types` array
   - Configure payment method options if needed

2. **Update frontend**:
   - `PaymentElement` automatically shows available methods based on PaymentIntent
   - No changes needed if using `PaymentElement`

### Changing Service Fee Calculation

**Location**: `server/services/pricing-service.ts`

**Function**: `calculatePlatformFeeDynamic()`

**Current Logic**:
- Reads fee rate from `platform_settings` table
- Calculates: `bookingPrice * feeRate`
- Returns fee in cents

### Handling Refunds

**Function**: `createRefund()` in `stripe-service.ts`

**Usage**:
```typescript
const refund = await createRefund(
  paymentIntentId,
  amountInCents,  // Optional: omit for full refund
  'requested_by_customer'
);
```

**Webhook**: `charge.refunded` automatically updates database.

### Testing Payments

**Stripe Test Mode**:
1. Use test API keys (`sk_test_...`, `pk_test_...`)
2. Use test card numbers:
   - Success: `4242 4242 4242 4242`
   - Decline: `4000 0000 0000 0002`
   - 3DS: `4000 0025 0000 3155`

**Stripe Dashboard**: https://dashboard.stripe.com/test/payments

### Debugging Payment Issues

1. **Check PaymentIntent Status**:
   ```typescript
   const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
   console.log(pi.status);
   ```

2. **Check Webhook Events**:
   - Stripe Dashboard → Developers → Events
   - Look for `payment_intent.succeeded` or `payment_intent.payment_failed`

3. **Check Database**:
   ```sql
   SELECT * FROM payment_transactions WHERE payment_intent_id = 'pi_...';
   SELECT * FROM kitchen_bookings WHERE payment_intent_id = 'pi_...';
   ```

4. **Check Logs**:
   - Backend logs show PaymentIntent creation and webhook processing
   - Look for `[Webhook]` prefixes

### Common Issues

#### Payment Intent Not Found
- **Cause**: PaymentIntent ID mismatch
- **Fix**: Verify `payment_intent_id` in database matches Stripe

#### Webhook Not Firing
- **Cause**: Webhook endpoint not configured in Stripe Dashboard
- **Fix**: Add webhook endpoint in Stripe Dashboard → Developers → Webhooks

#### Amount Mismatch
- **Cause**: Frontend/backend calculation differences
- **Fix**: Use `expectedAmountCents` from frontend (already handled in code)

#### Connect Account Not Ready
- **Cause**: Manager hasn't completed onboarding
- **Fix**: Check `stripe_connect_onboarding_status` in database

---

## Best Practices

1. **Always Use Cents**: Store all amounts as integers in cents to avoid floating-point errors
2. **Verify Webhooks**: Always verify webhook signatures in production
3. **Idempotency**: Stripe webhooks can be sent multiple times - use `webhookEventId` to prevent duplicate processing
4. **Error Handling**: Always handle payment failures gracefully
5. **Logging**: Log all payment operations for debugging
6. **Testing**: Test with Stripe test mode before going live

---

## Additional Resources

- **Stripe Documentation**: https://stripe.com/docs
- **Stripe Connect Guide**: https://stripe.com/docs/connect
- **Stripe API Reference**: https://stripe.com/docs/api
- **Stripe Testing**: https://stripe.com/docs/testing

---

## Summary

This kitchen booking system uses Stripe for:
- **Payment Processing**: PaymentIntents with automatic capture
- **Split Payments**: Stripe Connect for manager payouts
- **Real-time Updates**: Webhooks for payment status
- **Card Saving**: Saved payment methods for future bookings

The integration is modular with separate services for:
- PaymentIntent creation (`stripe-service.ts`)
- Connect account management (`stripe-connect-service.ts`)
- Transaction tracking (`payment-transactions-service.ts`)

All amounts are stored in **cents** (integers) to avoid precision issues, and the system automatically syncs actual Stripe amounts via webhooks to ensure accuracy.
