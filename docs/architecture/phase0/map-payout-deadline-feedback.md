# Map — payout-after-closeout, manager response deadline, private feedback

Read-only code map for three upcoming features. Every `file:line` below was verified by reading the file.
Repo: Express + Drizzle + Stripe Connect **Separate Charges & Transfers**, manual capture at manager confirmation.

> Terminology note: the chef booking detail route the brief calls `/api/bookings/:id` is actually
> `/api/chef/bookings/:id` (`server/routes/bookings.ts:1558`) and `/api/chef/bookings/:id/details`
> (`server/routes/bookings.ts:1595`). The manager detail route is `/api/manager/bookings/:id/details`
> (`server/routes/manager.ts:4313`). Mount points: `server/routes.ts:1280` (`/api` → bookings router),
> `server/routes.ts:1271` (`/api/bookings` → kitchen-booking-changes router).

---

## FEATURE 1 — PAYOUT AFTER CLOSEOUT

### 1a. Every place a transfer to the connected account is created

- `server/services/stripe-transfer-service.ts:150` — `transferToManagerForBooking(params)` is the single public entry point. Wraps everything in a DB transaction with a `FOR UPDATE` row lock on the payment_transaction (`:153-158`) and calls `assertBookingMoneyWritable` (`:156`). — **Implication:** any "pay at closeout" design must change this one function's *timing trigger*, not its body.
- `server/services/stripe-transfer-service.ts:161` — `transferLockedSource(params, connection)`: the actual state machine (skip reasons, idempotency, reconciliation).
- `server/services/stripe-transfer-service.ts:399` — `stripe.transfers.create({...})` — the real money movement. `:407` `source_transaction: params.chargeId`; `:408` `transfer_group`; `:423` idempotency key `transfer:${paymentIntentId}`. — **Implication:** the key is per-PaymentIntent, so a transfer can only ever be created once per charge; deferring requires a *new* key/state and an explicit "not yet transferred" state.
- `server/services/stripe-transfer-service.ts:233` — `stripe.transfers.retrieve(existing.transferId)` idempotent reconciliation; `:248` `stripe.transfers.list({transfer_group})`; `:275` `createReversal` (reverse an underpaid transfer); `:287` `transfers.create` (corrected replacement); `:386` list to *recover* a provider transfer whose ID write was lost. — **Implication:** the engine is built to assume "captured ⇒ transferred (or about to be)"; several recovery branches fire on `charge.updated`/sync and would immediately pay out a deferred booking.
- `server/services/stripe-transfer-service.ts:549` — `reverseTransferForRefund(transferId, refundCents, chargeCents, transferredCents)` prorates a reversal; `:576` `stripe.transfers.createReversal`.
- `server/services/stripe-transfer-service.ts:473-475` — re-exports `computeManagerGrossAndCommission` from `./manager-payout-math`.

Transfer call sites (all go through `transferToManagerForBooking`):
- `server/routes/webhooks.ts:1020` — `handleCheckoutSessionCompleted` (kitchen booking, **non**-manual-capture path).
- `server/routes/webhooks.ts:1609` — `handleStorageExtensionPaymentCompleted` (storage extension is its own charge/transfer).
- `server/routes/webhooks.ts:1929` — `handlePaymentIntentSucceeded` (`:1757`) — **the primary manual-capture path**: fires after the manager captures at confirmation.
- `server/routes/webhooks.ts:2891` — `handleOverstayPenaltyPaymentCompleted` (`:2711`).
- `server/routes/webhooks.ts:3186` — `handleDamageClaimPaymentCompleted` (`:3049`).
- `server/routes/webhooks.ts:3432` — `handleChargeUpdated` (`:3332`) — retry path; re-derives the split and creates/replaces the transfer.
- `server/services/payment-transactions-service.ts:836` — manual "sync Stripe amounts" also performs an idempotent payout-integrity pass (reverses/replaces an underpaid transfer).
- `server/services/overstay-penalty-service.ts:1089` and `server/services/damage-claim-service.ts:1441` — fallback transfer inside those services when the checkout-session webhook did not transfer.

### 1b. Capture path

- `server/services/booking-payment-decision.ts:32` — `decideAuthorizedBooking(bookingId, target, storageActions, equipmentActions, actorId)` is the manager confirm/cancel command.
  - `:38-43` — imports `AUTH_EXPIRY_HOURS` and enforces the response deadline inline (throws `BookingRequestExpired`).
  - `:109-122` — writes the PT split (`amount`, `baseAmount`, `taxAmount`, `serviceFee`, metadata `partialCapture/approvedSubtotal/approvedTax/platformCommission/bookingDecisionId/capturedComponentAllocations`) **before** capture. Comment at `:108`: *"The webhook needs this split before capture to calculate the manager transfer."*
  - `:156` — `capturePaymentIntent(decision.intentId, decision.amount, undefined, 'booking-decision:<id>')`.
  - `:190-227` — `reconcileBookingDecision` commits status/PT (`:217-219` PT → `succeeded`).
- `server/services/booking-checkout-fulfillment.ts:16` — `fulfillQuotedKitchenBooking` creates the booking + items + PT in one transaction; `:75-85` inserts the `paymentTransactions` row with `managerRevenue = subtotal+tax`, `serviceFee = commission`; `:95-97` cancels/refunds on inventory conflict.
- `server/routes/webhooks.ts:1757-1997` — `handlePaymentIntentSucceeded`; `:1946-1949` writes `serviceFee/managerRevenue/stripePlatformFee/stripeNetAmount` **only when `transferResult.transferred`**. — **Implication:** `manager_revenue` today is a *post-transfer* value; deferring the transfer leaves it 0 until closeout.

### 1c. How refunds/cancellations reverse transfers today

- `server/services/booking-cancellation-refund.ts:83` — `cancelKitchenCausedBooking` → `reverseTransferAndRefund(source.paymentIntentId, amount, …, { reverseTransferAmount: managerDebit })`. `:82` `verifyCancellationRefundFunding(source.paymentIntentId, source.transferId, managerDebit)`.
- `server/services/booking-cancellation-refund.ts:287` — `retryCancellationRefund` → `reverseTransferAndRefund(operation.intentId, operation.managerRefund, …, { reverseTransferAmount, refundApplicationFee:false })`; `:203` `verifyCancellationRefundFunding`.
- `server/services/booking-cancellation-refund.ts:47` — `refundSupportGoodwill` uses `createRefund` (no reversal; platform-funded).
- `server/services/stripe-service.ts:839` — `reverseTransferAndRefund` core; `:951` lists transfers by `transfer_group`; `:957-961` throws *"required manager refund exceeds verified unpaid entitlement"* when `reverseTransferAmount > available`; `:968-987` retrieves the transfer and calls `createReversal`; `:989-997` falls back to `reverseTransferForRefund` when a `transferId` exists and no explicit `reverseTransferAmount` was passed.
- `server/services/stripe-service.ts:602` — `createRefund` (with `:658-659` optional `reverse_transfer`).
- `server/routes/manager.ts:1503-1526` and `:7046-7137` — manager refund-review routes call `reverseTransferAndRefund`.
- `server/routes/admin.ts:3679-3690` — admin refund recovery calls `reverseTransferAndRefund`.
- `server/services/kitchen-booking-changes.ts:345` — reschedule/change refund calls `reverseTransferAndRefund`.
- **Key assumption:** `stripe-service.ts:957` and `:980-981` treat an existing transfer as the funding source for the manager's refund share. If no transfer exists yet, the "reverse" branch cannot run (but the `:989` pre-payout branch *does* already handle "refund before payout" by reducing unpaid entitlement — a useful precedent, see `server/services/stripe-refund-recovery.test.ts:74`).

### 1d. Closeout path and where a "closed" event fires

- `server/services/clock-closeout.ts:23` — `projectBookingCloseout` (HTTP projection only; never writes).
- `server/services/clock-closeout.ts:71` — `recordKitchenInspection` — manager **clears** the visit: sets `checkinStatus:'checked_out'`, `checkoutApprovedAt`, then `queueBookingLifecycleEvent(… 'checkout_cleared' …)` (`:85`), then `persistBookingCloseout` (`:88`).
- `server/services/clock-closeout.ts:96` — `persistBookingCloseout` computes the transition and **writes `kitchen_bookings.status`** (`:116-117`).
- `server/services/clock-closeout.ts:127` — fires `service_ended`; `:134` fires `inspection_auto_closed` (manager-only).
- `server/services/clock-closeout.ts:143` — `sweepClockCloseout(limit=3)` is the recurring worker task.
- `shared/clock-closeout.ts:109` — `reduceClockCloseout`; `:145` sets `status:'completed'` when `serviceEnd ≥ serviceEndedAt` and booking was `confirmed`; `:127` computes the inspection `deadline`.
- `server/services/kitchen-visit-lifecycle.ts:49` — `finishBookingIfAllVisitsDone` → `persistBookingCloseout`; called at `:78` (worker path) and `:246` (claim path).
- `server/services/kitchen-visit-lifecycle.ts:213-219` — files a checkout claim (`checkinStatus:'checkout_claim_filed'`, event `checkout_claim_filed`); `server/services/kitchen-checkout-service.ts:688,698,707` is the equivalent storage-checkout handoff.
- Attendance no-show: `server/services/booking-attendance-service.ts:104-125` — `report_no_show` sets `checkinStatus:'no_show'`, `noShowDetectedAt`, event metadata `{ policyTreatment:'cancellation_at_start', moneyEffectsApplied:false }`. **No transfer/refund is triggered by a no-show today** (money effects are explicitly not applied) — relevant if closeout gates payout.
- The **only** "booking closed / all visits done" signal is the status write in `persistBookingCloseout` (`server/services/clock-closeout.ts:116-117`) plus the `service_ended` outbox event (`:127`). — **Implication:** a closeout-triggered payout should hook `persistBookingCloseout` (transactional, under the booking lock) rather than the outbox, because the outbox delivery is best-effort/retried.

### 1e. payment_transactions columns relevant to transfer state

`shared/schema.ts:1856-1892`:
- `:1864` `baseAmount` (subtotal+tax, manager gross); `:1865` `serviceFee` (platform); `:1867` `stripeProcessingFee`; `:1868` `managerRevenue` (Connect transfer = base − stripe fee); `:1869` `refundAmount`; `:1870` `netAmount`; `:1873` `paymentIntentId`; `:1877` `transferId` (post-capture transfer to Connect); `:1879` `status`; `:1882` `metadata` (jsonb: `transfer`, `refunds`, `cancellationRefundOperation`, `refundRecovery`, `capturedComponentAllocations`, `partialCapture`).
- **Implication:** there is no `transferStatus`/`payoutEligibleAt` column; a deferred payout needs new state (e.g. `transferId IS NULL` + a reason, or a new column + migration; next free migration is **0075** per memory).

### 1f. Manager-facing payout display

- `server/services/payout-statement-service.ts:11` — `generatePayoutStatementPDF(managerId, name, email, payout, balanceTransactions, bookings)`. Derives from a **Stripe `payout`** + its balance transactions (`:15-16`, `:73-76`); summary lines at `:198-204`; manager revenue per booking at `:60-63,245`.
- `server/routes/manager.ts:2423` — `GET /revenue/payouts/:payoutId/statement`; `:2518-2521` calls `generatePayoutStatementPDF`.
- `server/routes/manager.ts:2281` `GET /revenue/payouts`; `:2302` `GET /revenue/payouts/:payoutId`; `:2160` `/revenue/sync-stripe`; `:2213` `/revenue/stripe-balance`.
- `client/src/pages/ManagerRevenueDashboard.tsx:126` `usePayouts`; `:272-381` Payout History list + `downloadPayoutStatement` (`:145-149,381`).
- `client/src/components/manager/revenue/revenue-calculations.ts:60,103` — `resolveDisplayedKitchenNetPayoutCents`, `managerRevenue`; `:90` `transactionToPayoutBreakdown`.
- `client/src/components/manager/revenue/components/RevenueMetricCards.tsx:19,24` — sums `day.managerRevenue` / `paidEarnings`.
- `server/domains/bookings/booking.repository.ts:267` `managerRevenue`; `:327` `netRevenue`; `:350-355` `managerAlreadyDebited` / `managerRemainingBalance`; `:314-325` pre-capture **estimated** Stripe fee so a held booking still shows an expected payout.
- `server/services/revenue-service.ts:1041` — `resolveDisplayedKitchenNetPayoutCents`.
- `shared/booking-pricing-breakdown.ts:87` — `resolveDisplayedKitchenNetPayoutCents`.
- `client/src/components/booking/BookingPricingBreakdown.tsx:119,134,197` — `KitchenPayoutStatementBreakdown`; `client/src/components/booking/ServiceFeeInfoPopover.tsx:7` — manager-facing info on the payout statement.
- `client/src/components/admin/sections/PlatformSettingsSection.tsx:388` — "How payouts work — Separate Charges and Transfers" copy.

### 1g. Chef receipt PDF generator

- `server/services/invoice-service.ts:19` — `generateInvoicePDF(booking, chef, kitchen, location, storageBookings, equipmentBookings, paymentIntentId, {viewer,locale})`; reads `managerRevenue` (`:36`), `payoutStatementTitle` (`:424`), `buildKitchenPayoutStatementBreakdown` (`:544`).
- `server/routes/bookings.ts:1911` — `GET /bookings/:id/invoice` (chef receipt); `:2023-2024` calls `generateInvoicePDF`.
- `server/routes/manager.ts:443-446` — manager-side invoice; also `:610,814,9158`; storage/overstay variants `:474,637`.
- `server/email.ts:3670` — confirmation email links `receiptUrl` labelled `bookingPayoutStatement` (staff) / `bookingReceipt` (chef).

### 1h. Storage / equipment add-ons — how their transfers are tied

- `server/services/booking-checkout-fulfillment.ts:48-74` — storage (`:58-64`) and equipment (`:69-72`) rows are inserted with the **same `paymentIntentId: intent.id`** as the parent kitchen booking; `:75-85` a **single** `paymentTransactions` row covers the whole bundle (metadata `storage_items`/`equipment_items` + `capturedComponentAllocations`).
- `server/services/booking-payment-decision.ts:111-122` — on confirm, the same PT is re-written with `capturedComponentAllocations` per component (kitchen/storage/equipment) and `partialCapture`.
- **Implication:** original storage/equipment add-ons ride on **one** transfer created from the kitchen charge. Their refund shares are handled inside the same reversal (`booking-cancellation-refund.ts:169-206`), not by separate transfers.
- Storage **extension** is a **separate charge** → its own transfer: `server/routes/webhooks.ts:1609` (`handleStorageExtensionPaymentCompleted`), PT created `:1560-1571`.
- Overstay penalty and damage claim are also **separate charges** → own transfers (`webhooks.ts:2891`, `:3186`).

### 1i. Risks of deferring the transfer to closeout

1. **Refunds assume a transfer exists.** `server/services/stripe-service.ts:957,980-981` fund the manager refund share from an existing transfer; the pre-payout branch (`:989`, proven by `server/services/stripe-refund-recovery.test.ts:74`) reduces unpaid entitlement instead. A deferred design must route *all* cancellation/refund paths through the pre-payout branch and audit `booking-cancellation-refund.ts:82-83,203,287`, `manager.ts:1503,7046`, `admin.ts:3679`, `kitchen-booking-changes.ts:345`.
2. **Revenue dashboards assume transferred.** `managerRevenue` is written only when `transferResult.transferred` (`webhooks.ts:1030-1035,1618-1643,1946-1949,2901-2905,3196-3200,3446-3449`; `payment-transactions-service.ts:846-850`). Until closeout, `manager_revenue` = 0 → `ManagerRevenueDashboard`, `RevenueMetricCards`, payout statement and `booking.repository.ts:327,350` all show $0/negative remaining balance.
3. **Payout statement is built from a Stripe `payout`** (`payout-statement-service.ts:15-16,73`). If nothing is transferred, there is no payout to reconcile against.
4. **Re-transfer sweeps would defeat a deferral.** `handleChargeUpdated` (`webhooks.ts:3432`), manual sync (`payment-transactions-service.ts:836`), and `handlePaymentIntentSucceeded` all re-create the transfer idempotently; a "defer" flag must be honoured inside `transferLockedSource` (`stripe-transfer-service.ts:161`) or these will pay out early.
5. **Idempotency is per-PaymentIntent** (`stripe-transfer-service.ts:423`). Moving the trigger to closeout needs a distinct key and a durable "eligible for payout at/after closeout" marker.
6. **Pre-capture estimated fees** shown to managers (`booking.repository.ts:314-325`) and the confirmation email payout line (`booking-lifecycle-delivery.ts:190`) present the payout as imminent.
7. **No-show / uninspected closeouts** currently have no money effect (`booking-attendance-service.ts:125`, `closeout-notice-email.ts:88` "not a finding about damage"). Gating payout on closeout changes the meaning of those outcomes.

### Suggested insertion points — Feature 1

- **Trigger:** `server/services/clock-closeout.ts:96` `persistBookingCloseout` (inside the `FOR UPDATE` lock, same tx as the `status:'completed'` write at `:116-117`). Enqueue payout only when the projection status becomes `completed` and all visits are `checked_out`/`checkout_claim_filed`.
- **Gate/engine:** add a `payoutEligibleAt` / `transferStatus` field on `payment_transactions` (`shared/schema.ts:1877` neighbourhood, migration 0075) and a new early-return branch in `transferLockedSource` (`server/services/stripe-transfer-service.ts:161`) that refuses while `closeout` is pending; honour it in the recovery paths (`:233,386`) and in the webhook/sync callers.
- **Refund safety:** extend the pre-payout branch precedent (`server/services/stripe-service.ts:989`) so a not-yet-transferred booking's refund reduces entitlement instead of throwing at `:957`.
- **Manager display:** add a "Payout pending closeout" state to `server/domains/bookings/booking.repository.ts:327` and `ManagerRevenueDashboard.tsx:272` so $0 does not read as "lost".
- **Closeout event hook:** the outbox kind `service_ended` (`server/services/clock-closeout.ts:127`) is the natural *notification* anchor, but the *money* anchor must be `persistBookingCloseout` (transactional).

---

## FEATURE 2 — MANAGER RESPONSE DEADLINE

### 2a. AUTH_EXPIRY_HOURS usage

- `server/services/auth-expiry-service.ts:42` — `export const AUTH_EXPIRY_HOURS = 24` (single source of the 24h rule).
- `server/services/auth-expiry-service.ts:54` — `expireKitchenAuthorization`; `:64` `lazyExpireKitchenBookingAuth`; `:77`/`:124`/`:196` cutoff `= now − AUTH_EXPIRY_HOURS`; `:194` `processExpiredAuthorizations` (cron sweep); `:397` `sendAuthExpiryNotification` with literal *"did not respond within 24 hours"* copy at `:434,457,464-465`.
- `server/services/auth-expiry-service.ts:301-306` — worker path verifies hold release before committing (pattern to reuse for a reminder worker).
- `server/services/booking-payment-decision.ts:38-43` — imports `AUTH_EXPIRY_HOURS`; the confirm command lazily releases an expired hold and throws `BookingRequestExpired` (`:24-29`).
- `server/email.ts:1` imports `AUTH_EXPIRY_HOURS`; `:3604-3606` `bookingResponseDeadline(createdAt) = createdAt + AUTH_EXPIRY_HOURS*3600000`. — **This is the canonical server-side deadline formula.** A "deadline = earlier of createdAt+24h or start − buffer" rule changes here.

### 2b. Every place the 24h deadline is computed or displayed

Server:
- `server/email.ts:3604` `bookingResponseDeadline`; `:3610` and `:3628` render it into the manager-notification and chef-request emails (`deadline` param).
- `server/routes/webhooks.ts:1105-1118` (manager notification) and `:1175-1179` (chef request).
- `server/routes/portal.ts:479-518`.
- `server/routes/bookings.ts:3591-3599` and `:3896-3909`.
- `server/services/booking-lifecycle-delivery.ts:216` — `request.responseDeadline = bookingResponseDeadline(row.booking.createdAt!)` for the `requested` event.

Client:
- `client/src/lib/booking-response-deadline.ts:2` — `BOOKING_RESPONSE_WINDOW_HOURS = 24` (mirrors server); `:9` `bookingResponseDeadline(booking)` derives from `createdAt`; `:18` `formatResponseDeadline`. Header comment (`:5-7`) notes the payload carries **no** deadline field and it is derived client-side. — **Implication:** adding a `responseDeadlineAt` field to the payload would let this stop guessing.

### 2c. Recurring worker that expires requests

- `server/services/recurring-worker.ts:121` — task `'authorizations'` → `processExpiredAuthorizations()`. (Other tasks listed `:114-127`; delivery tasks `:132-140`.)
- `server/lifecycle-inngest.ts:31-39` — `lifecycleTick` (Inngest cron); `:24-29` `recurringCronSchedule` (`*/15` prod, `*/30` staging); `:41-56` `bookingNoticeDelivery` event function; `:46` `debounce` per booking.
- `server/services/reminder-reconciliation.ts:8-20` — fixed `reminderSources` list + `currentSource` discovery SQL (a new reminder kind plugs in here).

### 2d. Minimum booking notice settings

- `shared/schema.ts:367` — `locations.minimumBookingWindowHours` (`minimum_booking_window_hours`, default 1); `:489` kitchen-level override.
- `shared/kitchen-booking-policies.ts:21` — `resolveKitchenBookingPolicies` (kitchen ?? location ?? 1).
- Enforcement: `server/routes/bookings.ts:2741`, `:3152`, `:3457`; `server/routes/portal.ts:452`.
- Settings UI: `client/src/components/manager/settings/BookingRulesSettings.tsx:116,199`; `client/src/components/manager/locations/LocationSettingsView.tsx:83`; `client/src/components/manager/LocationEditModal.tsx:58,240`.
- **Implication:** a "start − buffer" deadline term can reuse this setting (or a new sibling setting on `locations`/`platform_settings`).

### 2e. Existing reminder machinery (pattern to copy)

- `server/services/advance-reminders.ts:28` — `Reminder.kind` union: `'preparation' | 'arrival' | 'departure' | 'deadline' | 'checkin_open' | 'session_ending'`. A new `manager_decision` kind is added here.
- `server/services/advance-reminders.ts:113-137` — `visitReminders` computes each `due` (`:127-130`) and a content `revision` hash (`:132`). **This is where "12h and 2h before expiry" due-times would be computed.**
- `server/services/advance-reminders.ts:140` — `currentReminders` (per-source readers); `:285` `scheduleAdvanceReminders` (advisory-lock + email_logs upsert/supersede); `:429` `dispatchAdvanceReminders` (held-row-lock claim + send).
- `server/services/advance-reminders.ts:61` — `category = 'advance_reminder'`; `:65` `reminderKey(...)` = the outbox tracking id.
- `server/services/deadline-reminders.ts:21` — `currentDeadlineReminders` (sources `claim`/`penalty`/`storage_review`/`booking_review`/`cancellation_review`); `:15` `deadlineWarningDue`; `:88-106` builds a `kind:'deadline'` reminder with a "Respond by" line (`advance-reminders.ts:516`). **This is the closest precedent for a manager decision reminder.**
- `server/services/advance-reminders.ts:339-347` — `reminderEligibility` (future/due/expired/consolidated).
- Settings table: `server/services/lifecycle-settings.ts:5-22` — `preparationReminderHours` (`:16`, default 48), `arrivalReminderHours` (`:17`), `departureReminderMinutes` (`:18`), `responseWarningHours` (`:19`, default 6), `cancellationWarningHours` (`:20`), `inspectionWarningPercent` (`:21`). A new `managerDecisionReminderHours` / warning list goes here; admin UI `client/src/components/admin/LifecycleSettings.tsx:90-94`.
- Scheduling hooks: `server/services/booking-lifecycle-delivery.ts:253-266` calls `scheduleAdvanceReminders(tx, 'booking'|'booking_review'|'cancellation_review'|'storage_cancellation_review', id)` on the relevant lifecycle events. A `requested` event should schedule the new manager-decision reminder here.
- Outbox kinds: `emailLogs` (`shared/schema.ts:2519`), `bookingLifecycleEvents` (`shared/schema.ts` — `kind` column) with the event-driven delivery in `server/services/booking-lifecycle-delivery.ts:282` `deliverBookingLifecycleEvents`. Reminder rows are `email_logs` with `category='advance_reminder'`; booking notices are `booking_lifecycle_events`.

### 2f. Booking detail payloads (where `responseDeadlineAt` would be added)

- Chef: `server/routes/bookings.ts:1558` `GET /chef/bookings/:id` (payload `res.json` at `:1582`); `server/routes/bookings.ts:1595` `GET /chef/bookings/:id/details` (payload `res.json` at `:1878`). Neither returns a response deadline today.
- Manager: `server/routes/manager.ts:4282` `GET /bookings/:id` (payload `:4304`); `server/routes/manager.ts:4313` `GET /bookings/:id/details` (payload `res.json` at `:4620`). Neither returns a deadline today.
- The `requested` **email** already carries one (`booking-lifecycle-delivery.ts:216`); only the JSON payloads lack it.

### 2g. Where checkout shows the literal "48 hours" preparation text

- `client/src/components/booking/KitchenBookingFlow.tsx:1935` — literal `t("sheetWhatNextArrival", "Arrival details are sent 48 hours before your visit.")` in the checkout "what happens next" sheet.
- `client/src/components/booking/BookingPreparation.tsx:54-56` — the *dynamic* variant ("{hours} before your visit") computed from `instructionsReleaseAt`; the number comes from `preparationReminderHours` (default 48, `server/services/lifecycle-settings.ts:16`).
- **Implication:** the literal 48 is hard-coded in the checkout sheet; a settings-driven value should replace it to stay consistent if the preparation lead changes.

### Suggested insertion points — Feature 2

- **Deadline rule:** replace `createdAt + 24h` at `server/email.ts:3604` and `client/src/lib/booking-response-deadline.ts:9` with a shared `resolveResponseDeadline({createdAt, visitStartAt, bufferHours})` = `min(createdAt+24h, start − buffer)`; enforce the same in `server/services/auth-expiry-service.ts:77,124,196` and `server/services/booking-payment-decision.ts:39`.
- **Reminder kinds:** extend `Reminder.kind` (`advance-reminders.ts:28`) with `manager_decision`; compute 12h/2h-before-deadline `due` values in `visitReminders`/`currentDeadlineReminders`; add a `booking_review`-style source in `reminder-reconciliation.ts:8-20` and a schedule call at the `requested` producer in `booking-lifecycle-delivery.ts:205-218,253`.
- **Settings:** add `managerDecisionReminderHours` (and/or the 12h/2h pair) to `lifecycle-settings.ts:5-22` + admin UI `LifecycleSettings.tsx:90`.
- **Payload field:** add `responseDeadlineAt` to the four JSON payloads (`bookings.ts:1582,1878`; `manager.ts:4304,4620`) so `booking-response-deadline.ts` stops deriving it.
- **Checkout copy:** replace the literal at `KitchenBookingFlow.tsx:1935` with the configured lead.

---

## FEATURE 3 — PRIVATE FEEDBACK

### 3a. Tour feedback precedent (the model to copy)

- `shared/schema.ts:2483-2497` — `tourFeedbackResponses`: `viewingId`, `respondentId`, `respondentRole ('chef'|'manager')`, `scheduledAt`, `appointmentRevision`, `happened`, `rating` (1-5, nullable), `comments`, `suggestions`, `reason`; unique `(viewingId, appointmentRevision, respondentRole, respondentId)` (`:2496`). Comment `:2482`: *"Private participant reports are immutable facts, independent of the admin's final tour result."*
- `shared/schema.ts:2437-2438` — `kitchenViewings.feedbackRequestedAt` / `feedbackEscalatedAt` (prompt/escalation markers).
- `shared/tour-feedback.ts:9` — `tourFeedbackInputSchema` (rating only if `happened`; `reason` required when not, `:17-23`); `:27` `tourFeedbackClosed`; `:31` `tourFeedbackOpen` (confirmed + ended + not closed); `:36` `tourFeedbackMissingDue` (open + 24h); `:40` `tourFeedbackEventKey`.
- `server/services/tour-feedback-service.ts:14` — `readTourFeedbackStatus` (per-role submitted/conflict/missing); `:48` `getTourFeedback` (a participant sees **only their own** answers; conflict is admin-only, `:47,61`); `:66` `submitTourFeedback` (row-locked, revision-checked, immutable-once-submitted `:81-85`); `:93-97` queues `feedback_submitted` only when `bothReady || conflict`.
- `server/services/tour-outcome-service.ts:24` — `remindUnrecordedTourOutcomes`; `:123-138` queues `feedback_requested` then (after 24h) `feedback_missing`, setting `feedbackRequestedAt` / `feedbackEscalatedAt`.
- `server/services/tour-delivery-service.ts:30-33` — `TourEventKind` includes `feedback_requested | feedback_submitted | feedback_missing`; `:251` chef/manager `feedback_requested` notice; `:269-272` admin notices for missing/conflict/ready.
- `server/routes/viewings.ts:179` — `GET /api/viewings/:role/:id/feedback`; `:195` `POST` (participant only; admin read-only). Legacy arrival/departure recording is retired (`:213-220`, `:1686` return 410).
- Client: `client/src/components/tour/TourFeedbackPanel.tsx:22` (participant form + admin view); `client/src/components/admin/sections/AdminTourRequestsSection.tsx:3,288` (admin render); `client/src/components/tour/AdminTourVisitEvidence.tsx:10` (historical evidence read-only).

### 3b. Notification / email patterns for a post-visit prompt

- Outbox: `server/services/booking-lifecycle-delivery.ts:129` `queueBookingLifecycleEvent(tx, bookingId, kind, …)` → `booking_lifecycle_events`; delivery `:282` `deliverBookingLifecycleEvents` (lease, retry/backoff `:123-126`, admin recovery escalation `:434-444`).
- The natural post-visit prompt already exists for the **chef**: `server/services/closeout-notice-email.ts:37` `currentCloseoutEmail`; the chef "Your visit … is complete" email is built at `:96-107`, with a secondary "report a problem" link (`:106`). — **This is the cleanest anchor for a booking-feedback prompt.**
- Tour reminder delivery template: `advance-reminders.ts:401` `renderTourReminder`; booking reminder template `:371` `renderBookingVisitReminder`.
- Event-driven wakeup: `booking-lifecycle-delivery.ts:275` `wakeBookingNoticeDelivery`.

### 3c. Where a booking becomes "completed" (projection vs DB)

- Projection (never writes): `shared/clock-closeout.ts:109` `reduceClockCloseout`; status `'completed'` computed at `:145`.
- DB write: `server/services/clock-closeout.ts:96` `persistBookingCloseout`, writes `kitchen_bookings.status` at `:116-117`.
- Callers: `server/services/clock-closeout.ts:88` (inspection clear), `:158` (worker sweep `sweepClockCloseout`); `server/services/kitchen-visit-lifecycle.ts:49-53` `finishBookingIfAllVisitsDone` (called `:78` worker, `:246` claim).
- **Implication:** a "request feedback when the booking completes" hook must fire from `persistBookingCloseout` (the status transition), not from a read projection.

### 3d. Admin surfaces where feedback could be shown

- Admin section registry: `client/src/pages/Admin.tsx:97-103` (`validSections`, incl. `tour-requests`, `damage-claims`, `transactions`, `email-log`); section switch begins `:1139`.
- Existing tour feedback admin UI: `client/src/components/admin/sections/AdminTourRequestsSection.tsx:288`.
- Booking/transaction admin surfaces to mirror: `client/src/components/admin/sections/AdminTransactionHistory.tsx`, `ManagerRevenuesSection.tsx`, and the booking-support section (deep link built at `booking-lifecycle-delivery.ts:227` → `/admin?section=booking-support&booking=<id>`).
- **Implication:** there is **no** booking-feedback table/column today — `kitchen_bookings` has no rating/feedback field and there is no `bookingFeedbackResponses` table; only `tourFeedbackResponses` and the various `reviewFeedback`/`feedback` columns on application/claim tables (`shared/schema.ts:844,856,869,1735,1827`) exist. A private booking-feedback feature needs a new table + a new admin section (or a panel inside the existing booking-support section).

### Suggested insertion points — Feature 3

- **Data:** new `booking_feedback_responses` table modelled on `tourFeedbackResponses` (`shared/schema.ts:2483-2497`) keyed by `(kitchenBookingId, appointmentRevision|visitKey, respondentRole, respondentId)`; add a shared `shared/booking-feedback.ts` mirroring `shared/tour-feedback.ts:27-45` (open/closed/due/eventKey).
- **Service:** new `server/services/booking-feedback-service.ts` mirroring `tour-feedback-service.ts:14-99` (private per-respondent read, immutable submit, conflict admin-only).
- **Prompt:** schedule from `persistBookingCloseout` (`server/services/clock-closeout.ts:96`) when status becomes `completed`; render via the chef "visit complete" email path (`closeout-notice-email.ts:96-107`) and/or a new outbox kind delivered by `deliverBookingLifecycleEvents` (`booking-lifecycle-delivery.ts:282`). Add markers on `kitchen_bookings` analogous to `kitchenViewings.feedbackRequestedAt` (`shared/schema.ts:2437`).
- **Reminder/escalation:** reuse `tour-outcome-service.ts:123-138` pattern (requested → missing) via a `booking_review`-style source in `reminder-reconciliation.ts:8-20`.
- **Routes/UI:** participant GET/POST under the bookings router (mirror `viewings.ts:179,195`); panel mirroring `TourFeedbackPanel.tsx:22`; admin render mirroring `AdminTourRequestsSection.tsx:288`; register a new section in `Admin.tsx:97-103` or embed in `booking-support`.
