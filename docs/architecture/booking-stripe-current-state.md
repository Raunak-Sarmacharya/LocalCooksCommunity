# Stripe objects, money and recovery — current state

2026-10-11. Evidence vocabulary and scope gate: [consolidated report](booking-current-state.md). All source references are R unless marked; mocked diagnostic results T do not prove card-network/provider behavior. No Stripe API call was made, no production account inspected, and no charge-model migration recommended.

## Integration identified

`server/services/stripe-connect-service.ts:60` creates **Express** connected accounts, Canada, with card payments/transfers requested. Existing account types, enabled capabilities, controller settings, negative-balance liability and connected-account test identities remain operational Q.

Modern integration is **separate charges and transfers**, not destination charges: platform-owned Checkout/PaymentIntent lacks `transfer_data`, `application_fee_amount` and `on_behalf_of`; later transfer explicitly names destination and source charge. Fee commission is retained by reducing transferred funds (`server/services/stripe-checkout-service.ts:338`; `server/services/stripe-transfer-service.ts:354`). Old comments naming other charge models are not effective arguments.

```text
chef card → platform Checkout Session → platform PaymentIntent
           manual authorization → manager decision → captured Charge
                                           ↓ BalanceTransaction actual fee
platform charge proceeds = subtotal + tax + chef-paid platform commission
manager transfer ≈ subtotal + tax − actual processing fee on the entire charge
           Transfer(source_transaction = charge; group = pi_<intent>)
                → connected-account balance → independent bank Payout
refund route: recover original receipt → reverse manager Transfer if required
                → platform Refund → verify receipt / record scoped allocations
platform service-fee return: separate manager request / administrator approval
```

The financial model in source matches Stripe's separate-charges/transfer distinction. Stripe's Connect refund documentation says the platform is debited for separate-charge/transfer refunds and must reverse transfers to recover connected-account funds. Contractual responsibility and liquidity still need owner/provider evidence. [Stripe Connect refunds](https://docs.stripe.com/refunds#refunds-through-a-connect-platform), [Express accounts](https://docs.stripe.com/connect/express-accounts). [E/Q]

## Object and state map

| Object / local record | Creation and association | Authority / caveat |
|---|---|---|
| Connect Account | Account creation service; manager/location references | Requested type is Express; current account mode/capabilities not retrieved |
| Checkout Session | `createPendingCheckoutSession`; owner/hold/quote metadata; 32 min expiry | Session completion is not manager acceptance |
| Customer / PaymentMethod | `customer_creation:always`, `setup_future_usage:off_session`; copied to booking at fulfillment | Saving credentials is not a blanket lawful consent to future charges; additional-charge disclosure and 3DS behavior need rendered/provider verification |
| PaymentIntent | Platform, manual capture for Checkout; metadata with kitchen, chef, manager, quote | `requires_capture` means authorized; `succeeded` and exact received amount required for modern confirmation |
| Charge / BalanceTransaction | PaymentIntent latest charge; actual processing fee expanded/reconciled | Actual fee replaces estimates; refunds/settlement are separate |
| `payment_transactions` | Original source ledger, status/amount/tax/fee/provider refs/metadata | Shared PI can fund kitchen, storage and equipment; aggregated state alone cannot establish per-item refund |
| `kitchen_bookings.paymentDecision` | Durable UUID/target/items/cents/provider outcome before external operation | Replay must preserve decision identity; uncertain provider result is not safe to replace |
| Refund | Provider receipt plus local history/operation metadata | API submission or aggregate `amount_refunded` is not universal finality |
| Transfer / reversal | Actual fee known, source charge linked, deterministic key | Transfer to connected balance is not bank payout; reversal liquidity/failure needs recovery |
| Payout | `payout.paid/failed` handling | Bank settlement timing is independent of booking status |

Exact modern financial terms are parsed by `shared/booking-capture-terms.ts`, frozen in Checkout/ledger metadata, with per-component tax allocation in `shared/captured-component-allocations.ts`. Unsupported/ambiguous old terms return review-required rather than guessing. Minimum unit is integer cents.

## Authorization, capture and expiry

Checkout uses card/manual capture, saved payment method, quote metadata and application timeout. Pending inventory hold lasts 37 min, Checkout 32 min, then pending booking reserves time until decision/expiry. `AUTH_EXPIRY_HOURS=24` is measured from booking creation; lazy reads and recurring tasks attempt release. No `capture_before` / `captureBefore` use was found in server/shared source. The manager decision path has no explicit session-start comparison in the inspected guard.

Stripe exposes the actual card authorization expiry on `Charge.payment_method_details.card.capture_before`; windows vary by network/transaction classification. Partial capture normally releases the remainder. These facts support checking the actual provider deadline, but do not select a product response threshold. [Stripe manual capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method). [E/Q]

`booking-payment-decision.ts:21,136` persists decision before Stripe, retrieves PI before moving money, captures with `booking-decision:<uuid>`, verifies `succeeded` and expected `amount_received`, and rechecks cancel terminal outcome. A capture/cancel race records actual captured money and requests review instead of claiming release. DB finalization can recover without a new capture [R/T:8 decision tests]. This stronger modern path must not be conflated with every legacy helper.

Legacy `stripe-service.ts` direct creation can use automatic capture. Direct/free booking paths and old webhook fulfillment remain mounted. Exact current usage and existing paid-pending records are Q; no production inventory or financial records were queried.

## Price, tax, commission and processing costs

Modern checkout sums kitchen and selected paid add-ons, calculates kitchen tax rate over that subtotal, then adds commission on subtotal excluding tax (`server/routes/bookings.ts:3192-3257`). No tax on platform fee is calculated there. Legal tax incidence, tax registration, invoice issuer and fee taxation are **unresolved**; code is not legal evidence.

`calculateCheckoutFeesAsync` in `stripe-checkout-fee-service.ts:308` reads platform settings. Code fallback commission is 0%; founder guideline's 7% is F, not proven actual runtime rate. Estimated Stripe fee defaults 2.9% + 30¢, while transfer uses actual balance-transaction fee. Manager economically bears fee on the entire chef charge, including platform commission portion. FeeConfig comments conflict with the actual chef-paid line item. Current commercial agreements/rates remain Q.

Cancellation quote normally preserves actual processing fee and platform service fee, plus used-item components, with separate service-fee review. Stripe's original processing fees are not returned on refunds; that does not determine what the customer is legally owed or who absorbs those costs. [Stripe refund costs](https://docs.stripe.com/refunds). [E/Q]

## Refunds, transfers and modifications

`booking-cancellation-refund.ts` locks original source, verifies captured amount/prior receipts and component allocations; used storage/equipment treatment is scoped. Accepting chef cancellation requires BOTH timely request and current time before saved cutoff. Cancellation acceptance, transfer reversal, provider refund and service-fee approval are distinct operations. `reverseTransferAndRefund` in `stripe-service.ts` records operation identity, uses deterministic reversal/refund keys, recovers existing receipts after lost replies, and requires refund `succeeded`. Processing/pending outcome does not permit a fresh competing refund [R/T:13 refund-recovery tests].

`stripe-transfer-service.ts` blocks unresolved refunds/races, resolves actual fees, links transfer to charge, and retries/reconciles existing transfers using source identity and provider metadata [R/T:8 transfer recovery tests]. Actual-fee ≤0 waits for later evidence: legitimate zero-fee behavior and operational alerts need verification. Current transfer/payout schedule, reserves and refund liquidity are Q.

Inventory-compensation path in `booking-checkout-fulfillment.ts:92` cancels authorized PI or submits a refund for captured funds, but does **not** subsequently verify terminal status. Plain errors for missing/moved add-on or accepted storage terms bypass this compensation [R/I]. No source booking may exist for the auth-expiry sweep to discover. Passing three normal fulfillment tests does not cover this orphan scenario [T/Q].

Confirmed booking modifications are closed for new requests/payment/application. Historical additional authorization/capture/refund/release state recovery remains. Existing state machine does not establish supported new repricing or policy replacement. Counteroffers/new policy thresholds are deferred.

## Webhooks, idempotency, ordering and observability

`server/index.ts:27` supplies raw body before JSON; `server/routes/webhooks.ts:34` verifies signatures. Eight actual mocked route signature tests passed, including malformed/tampered/missing secret and valid signed expiry. API version pin is `2026-02-25.clover`; webhook destination version is independently configurable and was not retrieved.

Switch includes Checkout completion/expiry, capturable updates, PI succeeded/failed/cancelled, charge refunded/updated, account updated and payout paid/failed. No `refund.created/updated/failed` or Stripe charge-dispute switch cases were found (application damage disputes are different). Event IDs are logged; financial recovery uses PI/object/operation identities. A universal durable received/applied webhook event inbox was not found. Nested catch/log behavior varies, so a 2xx cannot be assumed to mean all secondary effects reconciled.

Stripe does not guarantee delivery order; duplicate events and independently delivered object updates must be expected. Signature verification, durable handling and object-level reconciliation are different controls. [Stripe webhooks](https://docs.stripe.com/webhooks). [E]

Stripe supports pending/failed refund states and individual refund events. Aggregate charge refund totals alone do not establish every requested refund receipt's final status. Customer bank arrival is separate from provider success. [Stripe refunds](https://docs.stripe.com/refunds). [E]

Manual replay route uses production-conditioned `ADMIN_WEBHOOK_SECRET || STRIPE_WEBHOOK_SECRET` ordinary comparison (`webhooks.ts:194`); source risk accepted, actual deployment not inspected. No replay attempted. General contract fixture duplicate/order tests do not dispatch full business handlers; their passing assertions are not proof of end-to-end idempotency or arbitrary ordering safety.

Email ordering differs: modern requested notice follows atomic request commit and says authorized; modern confirmed notice requires verified paid booking and succeeded ledger. Legacy immediate request/booking email paths and generic late delivery need separate scrutiny. Neither captured status nor sent SMTP log establishes bank payout/inbox arrival.

## Unverified evidence needed before provider diagnostics or implementation [Q]

Test platform identity, every affected connected account test-mode identity, webhook registration/receiver DB, signing-version settings, synthetic chef/manager/admin recipients, account capabilities, live-vs-test isolation, actual rates and operating recovery owner. No test card or API mutation is safe merely because local key prefixes are test. Operational history and account/contract inspection must be explicitly scoped away from prohibited production Neon/live Stripe.
