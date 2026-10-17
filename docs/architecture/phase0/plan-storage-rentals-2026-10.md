# Standalone storage rentals — implementation plan (Oct 16, 2026)

Applies the owner's final decisions (end of `research-storage-lifecycle-2026-10.md`, "Owner decisions" + "round 2"). Reuses the existing money engine (separate charges and transfers, refund receipts, transfer reversals, kitchen debt, money guard, outbox). Core: one rental row, one unit, a `paid_through` date, one paid-term row per payment. The only new money primitive is a third payout timing, `storage_term`. Owner answers to §6 questions are recorded in §7 when given.

## 0. Findings that shape the plan (verified in code)

1. **Storage payment rows would be transferred to the kitchen immediately unless gated.** The transfer engine only defers rows marked `after_closeout` (`server/services/stripe-transfer-service.ts:243`, via `releasedPayoutStillEligible(bookingId)` keyed to kitchen bookings, `kitchen-payout-service.ts:212`). A storage row with NULL timing is transferred by the capture webhook right away. → new timing `storage_term` + its own gate branch, shipped before/with the first storage capture.
2. **Legacy storage extension checkout reads the wrong record**: `createCheckoutSession(bookingId = storage id)` (`server/routes/bookings.ts:1079-1084`) looks up `kitchenBookings` by the same number (`stripe-checkout-service.ts:526-531`). New code never calls `createCheckoutSession` for storage; legacy path deleted in ST12.
3. **Kitchen-booking-only keys**: `booking_lifecycle_events.booking_id` (NOT NULL FK, `schema.ts:1589`), `support_actions` (`:2769`), `booking_flags` (`:2784`), `commitment_problems` (`:2728`), damage claims v2 (`damage-claims-v2.ts:36-54, 76, 89`), support console (`booking-support.ts:76`). Storage notices use the `emailLogs` `lifecycle_outcome` outbox (as damage-claim notices / problem reports do, `outcome-delivery.ts:54-63`); flags, actions, problems get nullable `storage_booking_id`.
4. **Holdover charges reuse overstay records with two fixes**: chef pays on-session via `createPenaltyPaymentCheckout` (`overstay-penalty-service.ts:1739`); its daily-terms check (`:1785`) must accept new terms. `chargeApprovedPenalty` charges off-session (`:759`, `:979`) — forbidden — must refuse storage rentals.
5. **Refund receipts already reduce payouts**: transfer engine subtracts `managerDebited` when `metadata.refunds` receipts exist (`stripe-transfer-service.ts:287-305, 445`); `reconcilePaymentRefundReceipts(intentId)` (`payment-refund-reconciliation.ts:11`) → `finalizeCancellationRefund` (`booking-cancellation-refund.ts:705`). Storage refunds write the same reservation shape (`cancellationRefundOperation`) + `storageRentalId`, with a storage branch in finalize.
6. **Extensions are gated by unpaid penalties today** (`requireNoUnpaidPenalties`, `server/routes/middleware.ts:70`; `bookings.ts:821, 940`). Design: unpaid holdover blocks new rentals only, never paying or moving out → new extend endpoint does not use that middleware.
7. **`booking_documents.booking_id` has no FK** (`migrations/0086_booking_documents.sql:8`) → a `booking_type` column suffices.

## 1. Data model

### 0093_storage_rentals.sql (additive; deploy-safe before any code)

```sql
INSERT INTO platform_settings (key, value, description) VALUES
 ('storage_max_term_days','30','Longest storage term a chef can pay for at once (1-30)'),
 ('storage_kitchen_disposal_enabled','false','Kitchens may record disposal of abandoned items (enable after NL counsel review)')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE storage_listings
  ADD COLUMN unit_count integer NOT NULL DEFAULT 1 CHECK (unit_count BETWEEN 1 AND 200),
  ADD COLUMN max_term_days integer CHECK (max_term_days BETWEEN 1 AND 30);  -- NULL = platform max
-- base_price = DAILY price in cents for storage-v1 (pricing_model forced to 'daily' by the API).

ALTER TABLE storage_bookings
  ADD COLUMN rental_state text CHECK (rental_state IN ('requested','declined','expired','withdrawn',
     'reserved','active','move_out_requested','removal_review','ended')),
  ADD COLUMN end_reason text CHECK (end_reason IN ('cleared','auto_cleared','claim','cancelled',
     'kitchen_reclaim','admin_ended','unit_released','legacy')),
  ADD COLUMN unit_index integer,
  ADD COLUMN term_start date,          -- kitchen-local
  ADD COLUMN paid_through date,        -- last paid day, inclusive, kitchen-local
  ADD COLUMN timezone text,
  ADD COLUMN rental_terms jsonb,       -- frozen {version:'storage-v1', dailyPriceCents, taxRatePercent, graceDays:5,
                                       --  removalReviewAfterDays:15, maxTermDays, acceptedAt, disclosureVersion}
  ADD COLUMN response_deadline timestamptz,
  ADD COLUMN approved_at timestamptz, ADD COLUMN decided_by integer REFERENCES users(id),
  ADD COLUMN decline_reason text,
  ADD COLUMN handover_photo_urls jsonb NOT NULL DEFAULT '[]', ADD COLUMN handover_at timestamptz,
  ADD COLUMN reclaim_end_on date,
  ADD COLUMN reclaim jsonb,            -- {servedAt, endOn, by:'kitchen'|'local_cooks', actorId, reason, refundCents}
  ADD COLUMN removal_review jsonb,     -- {openedAt, finalNoticeAt, perishablesAfter, othersAfter, items[], photos[], actions[]}
  ADD COLUMN released_on date,
  ADD COLUMN needs_cleaning boolean NOT NULL DEFAULT false,
  ADD COLUMN occupancy daterange,
  ADD COLUMN reopened_from timestamptz;

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- verify availability on dev AND prod first
ALTER TABLE storage_bookings ADD CONSTRAINT storage_unit_no_overlap
  EXCLUDE USING gist (storage_listing_id WITH =, unit_index WITH =, occupancy WITH &&)
  WHERE (rental_state IN ('requested','reserved','active','move_out_requested','removal_review') OR needs_cleaning);

CREATE TABLE storage_rental_terms (
  id serial PRIMARY KEY,
  rental_id integer NOT NULL REFERENCES storage_bookings(id) ON DELETE RESTRICT,
  seq integer NOT NULL, kind text NOT NULL CHECK (kind IN ('first','extension')),
  starts_on date NOT NULL, ends_on date NOT NULL, days integer NOT NULL CHECK (days BETWEEN 1 AND 30),
  daily_price_cents integer NOT NULL, subtotal_cents integer NOT NULL, tax_cents integer NOT NULL,
  service_fee_cents integer NOT NULL, total_cents integer NOT NULL,
  status text NOT NULL CHECK (status IN ('awaiting_payment','authorized','paid','failed','cancelled')),
  request_key text NOT NULL UNIQUE,
  operation jsonb,                     -- {key, attemptKey, action:'authorize'|'pay', state, checkout, returnUrl}
  checkout_session_id text, payment_intent_id text UNIQUE,
  payment_transaction_id integer REFERENCES payment_transactions(id),
  paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rental_id, seq));
CREATE UNIQUE INDEX storage_terms_one_open ON storage_rental_terms (rental_id) WHERE status IN ('awaiting_payment','authorized');

CREATE INDEX payment_transactions_storage_payout_due ON payment_transactions (payout_eligible_at, id)
  WHERE payout_timing = 'storage_term' AND transfer_id IS NULL;

ALTER TABLE commitment_problems ADD COLUMN storage_booking_id integer REFERENCES storage_bookings(id);
ALTER TABLE booking_flags ALTER COLUMN booking_id DROP NOT NULL,
  ADD COLUMN storage_booking_id integer REFERENCES storage_bookings(id),
  ADD CONSTRAINT booking_flags_one_parent CHECK (num_nonnulls(booking_id, storage_booking_id) = 1);
CREATE UNIQUE INDEX booking_flags_storage_provider_unique ON booking_flags (storage_booking_id, kind, provider_ref)
  WHERE provider_ref IS NOT NULL AND storage_booking_id IS NOT NULL;
ALTER TABLE support_actions ALTER COLUMN booking_id DROP NOT NULL,
  ADD COLUMN storage_booking_id integer REFERENCES storage_bookings(id),
  ADD CONSTRAINT support_actions_one_parent CHECK (num_nonnulls(booking_id, storage_booking_id) = 1);
ALTER TABLE booking_documents ADD COLUMN booking_type text NOT NULL DEFAULT 'kitchen' CHECK (booking_type IN ('kitchen','storage'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage_bookings WHERE status NOT IN ('cancelled','completed')) THEN
    RAISE EXCEPTION 'Open legacy storage rows exist; end them before the storage cutover'; END IF; END $$;
UPDATE storage_bookings SET rental_state = 'ended', end_reason = 'legacy' WHERE rental_state IS NULL;
```

Check first: `damage_claims.kitchen_booking_id` nullable? (v1 storage claims insert NULL, `damage-claim-service.ts:350`); if NOT NULL add `DROP NOT NULL`. On dev, cancel open legacy rows first with a guarded harness script (synthetic users only).

### 0094_storage_cleanup.sql (only after ST12 removes readers)

```sql
DROP TABLE pending_storage_extensions;
DROP TABLE storage_overstay_quotes;
ALTER TABLE storage_bookings DROP COLUMN overstay_terms,
  ALTER COLUMN rental_state SET NOT NULL,
  ADD CONSTRAINT storage_rentals_standalone CHECK (kitchen_booking_id IS NULL OR end_reason = 'legacy');
ALTER TABLE storage_listings DROP COLUMN price_per_cubic_foot, DROP COLUMN availability_calendar,
  DROP COLUMN overstay_grace_period_days, DROP COLUMN overstay_penalty_rate, DROP COLUMN overstay_max_penalty_days;
```

Kept: `storage_bookings.status` synced coarsely (requested=pending; reserved..removal_review=confirmed; ended=completed; declined/expired/withdrawn/cancelled=cancelled) for legacy readers (deletion guard, claims v1, reminders); `start_date`/`end_date` written as local-midnight instants of `term_start` and `paid_through+1`. `kitchen_bookings.storage_items` stays (historical), no longer written. Schema mirror: `shared/schema.ts:1370` (listings), `:1606` (rentals + new `storageRentalTerms`), `:2724`, `:2767`, `:2783`; fix stale comment `:1585-1587`.

## 2. State machine

Stored `rental_state`; **phase** computed from dates by a pure function (never stored). All dates kitchen-local; today = `localDate(now, tz)`.

```
phase(r, today): for reserved|active:
  effectiveEnd = min(paid_through, reclaim_end_on ?? ∞)
  today <= effectiveEnd - 7 -> 'current'
  today <= effectiveEnd     -> 'ending_soon'
  today <= effectiveEnd + 5 -> 'grace'   (extend at normal price, no charge)
  else -> 'holdover', holdoverDays = today - (effectiveEnd + 5), accrued = holdoverDays × daily (+tax)
  (reclaim_end_on < paid_through: refund already covered after that date; accrual starts after reclaim_end_on + 5)
```

| From → to | Guard | Actor / endpoint / worker | Money |
|---|---|---|---|
| new → requested | approved at location (`getApplicationStatusForBooking`); no claim hold (`readClaimBookingHold`, `damage-claims-v2.ts:220`); no unpaid holdover (`hasChefUnpaidPenalties`, `overstay-penalty-service.ts:2083`); listing active; start in [today, today+14]; 1 ≤ days ≤ min(platform, listing max); free unit for [start, start+days-1+5]; Checkout completes | Chef `POST /api/chef/storage-rentals` → Checkout (manual capture) → webhook `type=storage_rental` | Card hold |
| requested → reserved | before `response_deadline`; unit still free (re-check under listing lock); capture ok | Kitchen `POST /api/manager/storage-rentals/:id/approve {unitIndex?}`; admin `approve_for_kitchen` | Capture; payment row `payout_timing='storage_term'` |
| requested → declined | — | Kitchen `.../decline {reason}`; admin | Cancel intent |
| requested → expired | now ≥ response_deadline (created + 24 h) | Worker + exact timer `storage_request` | Cancel intent |
| requested → withdrawn | — | Chef `POST .../withdraw` | Cancel intent |
| reserved → active | today ≥ term_start; chef move-in (checklist + photos) or kitchen handover photo | Chef `POST .../move-in` (wraps `requestStorageCheckin`, `storage-checkout-service.ts:287`); kitchen `POST .../handover` | First term payout eligible now |
| reserved → ended(cancelled) | before start (§6 OQ1 rule) | Chef `POST .../cancel` | Refund per OQ1 |
| reserved → ended(unit_released) | today ≥ start + 7, no move-in, no handover | Kitchen `POST .../release-unit` | No refund default (OQ4); kitchen may refund |
| reserved/active → same, paid_through += n | 1..max days; paid_through − today ≤ 14 (OQ2); new end ≤ reclaim_end_on; no future reservation on unit overlapping new range + grace; no open term | Chef `POST .../extend` (saved card on-session, or Checkout) | Immediate capture; new payment row |
| reserved/active → move_out_requested | today ≥ term_start; move-out photos | Chef `POST .../move-out` (wraps `requestStorageCheckout`, `:137`) | — |
| move_out_requested → ended(cleared) | kitchen clears (opt. needs cleaning) | Kitchen `POST .../clear-move-out {needsCleaning}` (wraps `processCheckoutClear`, `:794`) | Holdover stops at released_on |
| move_out_requested → ended(auto_cleared) | review window elapsed | `processExpiredCheckoutReviews` (`:1089`) + lazy `autoCleanExpiredCheckout` (`:1038`) | — |
| move_out_requested/ended(cleared, auto) → ended(claim) | within 72 h of move-out request; one claim per move-out | Kitchen files v2 claim with `storageRentalId` | Claim flow; pauses that term's unreleased payout |
| ended(cleared/auto) → active (reopen) | within 7 days of release; unit not re-let; kitchen photo | Kitchen `POST .../items-still-here` | Holdover resumes from original date |
| active (holdover ≥ 15) → removal_review | | Worker; admin can open early | Accrual frozen at 15 days (OQ6) |
| removal_review → active | chef extends to cover through today | Chef extend | Pays the days |
| removal_review → ended(cleared) | moved out + cleared, or kitchen records removal after final-notice deadlines (perishables +48 h, others +7 d) and `storage_kitchen_disposal_enabled` | Kitchen `POST .../removal/record`; admin `POST .../final-notice` | — |
| reserved/active → reclaim_end_on set | byDate ≥ paid_through: nudge (blocks extending past it). byDate < paid_through: paid span > 7 days and byDate ≥ today + min(7, paid_through − today) | Kitchen `POST .../move-out-by {byDate, reason}`; admin `emergency_end` (no minimum) | Unused days after byDate refunded in full, kitchen-funded |
| any non-ended → ended(admin_ended) | reason required | Admin `end_rental {refund:'unused'|'none'|cents, fundedBy}` | Per action |

**Occupancy** (maintained in the same transaction as every transition): requested/reserved/active/move_out_requested `[term_start, paid_through+5+1)`; ended `[term_start, released_on)`, or `[term_start, ∞)` while `needs_cleaning` until "Mark ready"; removal_review `[term_start, ∞)`. Exclusion constraint is the backstop; service locks the `storage_listings` row `FOR UPDATE` and picks the lowest free index (`pickFreeUnit`).

## 3. Work packages

Conventions: vitest next to each file; `*.postgres.check.ts` for SQL behaviour; explicit staging only; tsc clean; suites at baseline; migrations to dev only (prod with owner go-ahead). **Strong** = money/state (Opus/Codex + review); **Cheap** = mechanical.

### WP-ST1 — Migration 0093, schema, shared rules (Strong; first, alone)
- `migrations/0093_storage_rentals.sql`, `shared/schema.ts`, new `shared/storage-rental.ts` (pure, no I/O):
  - constants `GRACE_DAYS=5, REMOVAL_REVIEW_DAYS=15, MAX_LEAD_DAYS=14, EXTEND_WINDOW_DAYS=14, RECLAIM_MIN_SPAN_DAYS=7, RECLAIM_NOTICE_DAYS=7, RESPONSE_HOURS=24, NO_MOVE_IN_RELEASE_DAYS=7, PAYOUT_FALLBACK_HOURS=48, PAYOUT_HOLD_ALERT_DAYS=30, DISPOSAL_PERISHABLE_HOURS=48, DISPOSAL_OTHER_DAYS=7`
  - `localToday(now, tz)`, `addDays(date, n)` (pure YYYY-MM-DD arithmetic)
  - `termPrice({days, dailyPriceCents, taxRatePercent, serviceFee(subtotal)})` (fee fn injected; reuses `calculateCheckoutFeesAsync` as `bookings.ts:1038-1042`)
  - `rentalPhase(r, today)` → `{phase, effectiveEnd, graceEndsOn, holdoverDays, accruedCents}`
  - `occupancyRange(r)`, `pickFreeUnit(unitCount, occupied[], range)`, `availabilityPhrase(...)` → `'now'|{from}|'full'`
  - `extensionLimit(r, today, blocks)` → `{maxDays, reason:'max_term'|'reservation'|'reclaim'|'window'}`
  - `reclaimRule(r, today, byDate)` → `{allowed, minDate, unusedDays, mode:'nudge'|'reclaim'}`
  - `unusedRefundSplit(terms[], fromDate)` → per term `{customer, managerDebited, platformServiceFeeReturned}`; latest first; partial term pro-rata by days; rounding remainder to managerDebited
  - `beforeStartRefund(...)` per OQ1 via `cancellationSourceQuote` (`shared/cancellation-refund.ts`)
  - `termPayoutEligibleAt(term, rental)`: first = min(movedInAt ?? handoverAt, startInstant + 48 h); extension = startInstant (OQ5), never before paid_at
  - `responseDeadline(createdAt)` = +24 h; approval after term_start shifts the term to the approval day, same days, copy says so
- Tests: DST (St. John's Nov 1 / Mar 8, 2026), month/year boundaries, all phase edges (0/7/5/15), overlap in all states, reclaim ≤7 and >7, refund split sums equal charge, extension blocked by reservation and reclaim.
- Live: apply 0093 on dev; old app still runs.

### WP-ST2 — Capacity, listing form, settings, availability (Cheap; ∥ ST3)
- `server/routes/storage-listings.ts` `:87` POST / `:149` PUT accept `unitCount` (1–200), `dailyPriceCents` (→ basePrice), `maxTermDays` (1..platformMax or null); force `pricingModel='daily'`. `:232`, `:267` chef/public lists: replace `!listing.awaitingRemoval` (`:251`, `:282`) with `availability`.
- New `server/services/storage-settings.ts` (model `cancellation-policy-settings.ts:8-29`): `storageSettings`, `saveStorageSettings({maxTermDays}, actorId)` audited to `cancellationPolicyAudit`.
- `GET/PUT /api/admin/storage-settings` → `{maxTermDays:30, kitchenDisposalEnabled:false}`; `GET /api/chef/kitchens/:kitchenId/storage-availability` → `[{listingId, name, storageType, dailyPriceCents, maxTermDays, availability:{state, from?}}]`.
- Client: `StorageListingManagement.tsx` ("How many of these do you have?", "Price per day", "Longest a chef can pay for at once (days, up to {max})"; drop per-cubic-foot/hourly/monthly); `PlatformSettingsSection.tsx` Storage card (max days; disposal toggle "Turn on after counsel review").
- Tests: validation; availability 0/1/N units incl. removal-review unit; clamp (listing 45 rejected; platform lowered to 20 → listing 30 reads 20).

### WP-ST3 — Storage notice module + i18n (Cheap; ∥ ST2)
- New `server/services/storage-rental-notices.ts` → `queueStorageRentalNotice(tx, rentalId, event, facts)`: recipients chef, location manager, admins if in `ADMIN_STORAGE_KINDS`; in-app via `notificationService.create`, per-reader `tLocale(locale, key, {ns:'storage'})`; chefs see kitchen name, kitchens chef name; CAD amounts; dates `dateStyle:'medium'` in rental tz; no Stripe ids. Email via `emailLogs` (`category:'lifecycle_outcome'`, `status:'queued'`, `trackingId:'storage-rental:{rentalId}:{event}:{eventKey}:{userId}'`, `renderTransactionalEmail`). Gates: participants `operationalEmailAllowed`; admins only with `adminEmailNotifications` (as `damage-claim-notices.ts:61`, `commitment-problems.ts:135`). Paths: chef `/storage/{id}`, kitchen `/manager/storage/{id}`, admin `/admin?section=storage-rentals&rental={id}`.
- `outcome-delivery.ts` `:63` add `OR trackingId LIKE 'storage-rental:%'`; branch before `:147` re-checks recipient membership, sends stored html with no "Recorded outcome notice" prefix (`:151`).
- `admin-booking-notice.ts`: `ADMIN_STORAGE_KINDS` + `adminStorageNotice`: storage_requested, storage_expired, storage_confirmed, storage_extension_paid, storage_refund_issued, storage_payout_released, storage_payout_on_hold, storage_holdover_raised, storage_holdover_waived, storage_holdover_disputed, storage_reclaim_served, storage_removal_review, storage_kitchen_debt, storage_payment_recovery.
- Locales: new `storage.json` ×3; register namespace wherever `booking` is.
- Events (C chef / K kitchen / A admin): requested (C "Request sent · card hold $X · {kitchen} answers by {time}"; K "{chef} wants {listing} {start}–{end} · answer by {time}"; A); approved (C "Approved · {listing}, shelf {n} · starts {date} · charged $X"; A confirmed); declined/expired (C "Not approved · hold released"; K expired; A expired); move_in_due d1/d3 (C); moved_in (K + photos); ending 14/7/2/0 (C "Paid through {date} · Extend {n} days · $X"; K weekly digest); extended (C "Paid through {date} · charged $X"; K "{chef} extended to {date}"; A); grace_started +1/+3/+5 (C; K "In grace until {date}"); holdover_started (C "$X/day may be charged by {kitchen}"; K "raise a charge or waive"); holdover_charge (C "Pay $X for {n} days, or dispute by {time}"; A raised); reclaim (C "{kitchen} asks you to move out by {date} · refund $X"; K; A); move_out_requested/cleared/reopened (C, K); removal_review/final_notice (C dated notice + deadlines + photos; K "you may act after {dates}"; A); refund_issued (C "Refund $X on its way"; K "Payout −$X"; A); payout_released/on_hold (K "You've been paid $X for {chef}'s storage {start}–{end}"; A); kitchen_debt (K "Refund of $X couldn't be taken back from your Stripe balance; you owe Local Cooks $X"; A).
- Tests: per-reader snapshot 3 locales; admin email only with toggle; skip recipient no longer on rental; regex: no `pi_|ch_|tr_`.

### WP-ST4 — Request, checkout, approval, decline, expiry (Strong; after ST1; ST3 stubbable)
- New `server/services/storage-rentals.ts`: `quoteRental`; `createRentalCheckout` (Checkout `mode:'payment'`, `capture_method:'manual'`, `setup_future_usage:'on_session'` as `session-extensions.ts:634-641`, `customer_creation:'always'`, card, `expires_at` +32 min; line items "{listing} · {kitchen} · {start}–{end} ({n} days)", HST, Service fee; metadata `{type:'storage_rental', chef_id, listing_id, start_on, days, quote_total_cents, terms_version, request_key}`; idempotency `storage-rental:{chefId}:{requestKey}`; inserts nothing). `fulfillRentalCheckout(session)` one tx: lock listing; re-validate; `pickFreeUnit` (none → cancel intent + `kitchen_checkout_incidents` recovery); insert rental `requested` with frozen terms, term seq 1 `authorized`, payment row (`bookingType:'storage'`, bookingId=rental, `authorized`, `payoutTiming:'storage_term'`, `metadata:{storageTermId}`); save customer/payment method; notice `requested`; `scheduleDeadlineTimer('storage_request', id, response_deadline)`. `decideRental` (pattern `booking-payment-decision.ts:62-206`: persist op, then capture/cancel with key, then commit state/notices/payment row; capture failure incl. lapsed auth → `expired`, chef "The card hold had lapsed; nothing was charged", admin recovery). `expireRental` idempotent; `withdrawRental`.
- `deadline-timer.ts:15-16` kind `storage_request`, `:60` dispatch. `webhooks.ts` `type==='storage_rental'` branch; `payment_intent.canceled` → expire if requested.
- **`stripe-transfer-service.ts:243` gate** (ships here): if `storage_term` and no transfer → require `payoutReleasedAt`, no hold reason, `storageTermStillEligible` (returns false until ST6).
- `kitchen-payout-service.ts:343` `recoverCaptureTransfers` already kitchen/bundle only — add a test.
- Routes (new `server/routes/storage-rentals.ts`): `POST /api/chef/storage-rentals/quote`, `POST /api/chef/storage-rentals {listingId,startOn,days,requestKey,expectedTotalCents,acceptedTermsVersion}` → `{checkoutUrl}` (409 price_changed/full; 403 claim_hold/unpaid_holdover), `POST .../:id/withdraw`, `GET` list/detail DTO `{id, ref, kitchen, listing, unitLabel, state, phase, startOn, paidThrough, graceEndsOn, holdoverDays, accruedCents, terms[], actions[], evidence, responseDeadline}` (actions computed server-side). Manager: `GET /api/manager/storage-rentals/:id`, `POST .../approve`, `POST .../decline`.
- Tests: tamper 409; last-unit race (postgres check vs exclusion); approve after deadline 409; expiry idempotent; capture webhook before decision commit → no transfer; late approval shifts dates; webhook replay → one rental.

### WP-ST5 — Extensions (Strong; after ST4)
- New `server/services/storage-extensions.ts` (port of session-extension operation pattern): `quoteExtension` → `{days, maxDays, limitReason, newPaidThrough, subtotal, tax, fee, total, card}`; `payExtension` (lock rental; re-check limit/occupancy; `assertBookingMoneyWritable` storage-aware; insert term `awaiting_payment` with op key `storage-term:{termId}`; widen occupancy provisionally; then `paymentIntents.create({customer, payment_method, confirm:true, off_session:false, use_stripe_sdk:true, capture_method:'automatic', metadata:{type:'storage_term', …}}, {idempotencyKey})` as `session-extensions.ts:569-583`; `reconcileStorageTerm` → paid / failed (occupancy restored)); `checkoutExtension` fallback (`session-extensions.ts:595-646`); `findTermIntent`; `recoverStorageTerms(stripe, 3)` for ops > 15 min. Webhook `type='storage_term'` → reconcile.
- Routes: `POST .../:id/extend/quote {days}`, `POST .../:id/extend {days,expectedTotalCents,requestKey,useSavedCard}` → `{paid,rental}|{requiresAction,clientSecret}|{cardFailed}|{checkoutUrl}`, `POST .../:id/extend/:termId/sync`. No `requireNoUnpaidPenalties`. Allowed in reserved/active/removal_review, phases grace and holdover (term starts paid_through+1, so holdover days are paid at normal price).
- Tests: double tap → one charge; lost response found; decline leaves state; 3DS then sync; blocked by reservation (clipped) and by reclaim; holdover paid back to current; removal_review → active; recovery finishes committed payment.

### WP-ST6 — Payouts, refunds, kitchen debt, money guard, flags, documents (Strong; after ST4; ∥ ST5, ST7)
- New `storage-payouts.ts`: `storageTermPayoutFacts` (open storage problem by chef, open v2 claim, open storage flag); `scheduleStorageTermPayout` (pattern `kitchen-payout-service.ts:66-84`); `releaseStorageTermPayout` (copy `releaseKitchenPayoutInTick` `:91-147` → `transferToManagerForBooking({paymentTransactionId, paymentIntentId, chargeAmountCents, actualStripeFeeCents, chargeId, transferGroup, existingMetadata})`; notice payout_released K, A); `storageTermStillEligible`; `releaseDueStoragePayouts(3)` (cursor `storagePayouts`); admin alert once if unreleased > 30 days after paid_at.
- `stripe-transfer-service.ts:174, 209` call `recordReleasedPayout` for `storage_term` too.
- New `storage-rental-money.ts` `refundRentalUnused(rentalId, {fromDate, cause:'kitchen'|'local_cooks'|'goodwill_kitchen'|'goodwill_lc'|'before_start', actorId, operationKey})`: per payment row latest first, reserve `metadata.cancellationRefundOperation` (+storageRentalId), refuse if one pending; provider call as `booking-cancellation-refund.ts:967-993` (`reverseTransferAndRefund` reservedOperation, reversal only if transfer sent); `kitchenFundingShortfall` (`:726`) → persist platformFunding + kitchenDebtCents + kitchenRefundDebts before sending; not transferred → receipt's managerDebited lowers later transfer; then `reconcilePaymentRefundReceipts`. `finalizeCancellationRefund` `:705` first line storage branch → `finalizeStorageRefund` (refund_issued C/K/A; kitchen_debt K/A). `payment-refund-reconciliation.ts:16-19` storage docs.
- Money guard `booking-money-guard.ts:12-36`: add `linked_storage` CTE + flags/support_actions by `storage_booking_id`; drop `s.kitchen_booking_id` mapping `:16`. Flags `booking-support-flags.ts:43-52` → `{kitchen, storage}`; `changeStorageFlag`; dispute handler `:55-63` flags rentals (chargebacks pause storage money).
- Documents `booking-documents.ts`: `loadStorageMoneyRows`, `ensureStorageDocuments` reusing `planBookingDocuments` (`:260`), `booking_type='storage'`, label "Storage · {listing} · {start}–{end} ({n} days)", sourceKey `storage:`; routes chef/manager `.../documents` with existing PDF renderer.
- Tests: eligibility cases; problem holds / resolve releases; transfer = subtotal + tax − card fee − managerDebited; refund before payout lowers transfer, after payout reverses, insufficient balance → debt + notice; dispute flags rental & guard blocks; two sweeps → one transfer; 30-day alert once.

### WP-ST7 — Lifecycle worker, reminders, holdover, removal review (Strong; after ST4; ∥ ST5, ST6)
- New `storage-rental-lifecycle.ts` `sweepStorageRentals(3)` (cursor `storageRentals`): notices once each keyed `{event}:{date}` — ending 14/7/2/0, grace +1/+3/+5, holdover_started, move_in_due d1/d3, kitchen "not moved in" d7; holdover ≥ 15 → removal_review (occupancy ∞, notices A/K); `expireRental` backstop.
- Holdover: `raiseHoldoverCharge(rentalId, managerId, {amountCents ≤ accrued, note})` inserts `storage_overstay_records` `penalty_approved` (daysOverdue, dailyRateCents, penaltyRate '0', calculated/final, chefDisputeDeadline +72 h, idempotencyKey `holdover:{rentalId}:{effectiveEnd}:{daysCovered}`), notice holdover_charge; refuse overlapping unpaid request. `waiveHoldover` via `processManagerDecision` (`:612`).
- `overstay-penalty-service.ts`: `:759` `chargeApprovedPenalty` refuses storage-v1 (no off-session); `:1785` accept storage-v1 terms; `:120` `detectOverstays` skips `rental_state IS NOT NULL`. Chef pay/dispute reuse existing routes + `PendingOverstayPenalties` (relabel "Holdover").
- Removal review: admin `sendFinalNotice(rentalId, adminId, {photos, items[{name, qty, perishable}]})` → finalNoticeAt, perishablesAfter +48 h, othersAfter +7 d, notices C/K, chef email always (legal notice). Kitchen `recordRemoval(...)` only after the matching deadline and with the platform toggle on (or admin); "all removed" → ended(cleared).
- `recurring-worker.ts:120-150` (this WP owns all worker edits): `storageRentals`, `storagePayouts` (`releaseDueStoragePayouts(3)`), `storageTermRecovery`.
- Tests: once-only notices incl. DST night; accrual frozen at 15; raise > accrued 400; chargeApprovedPenalty refuses; disposal refused early / toggle off; extension in removal review → active.
- Live harness: new `shift-storage.mjs` (synthetic users only) shifting term_start/paid_through/occupancy.

### WP-ST8 — Move-in/out, reopen, problems, damage claims (Strong for claims; after ST4)
- `storage-checkout-service.ts`: `requestStorageCheckin` (`:287`) requires reserved → active, schedules term-1 payout, notice via `queueStorageRentalNotice('moved_in')` (replace English `queueStorageVisitAction` `:387`); `requestStorageCheckout` (`:137`) from reserved/active/removal_review → move_out_requested; missing move-in allowed and marked `noBaseline` (`:211` rule changes); `processCheckoutClear` (`:794`) → ended(cleared), released_on, needs_cleaning, occupancy; drop `detectOverstays` call `:853`; `autoCleanExpiredCheckout` (`:1038`) → auto_cleared; delete `processCheckoutStartClaim` (`:871`) and its route (`manager.ts` ~`:8026`).
- Kitchen endpoints: `POST /api/manager/storage-rentals/:id/handover {photoUrls[], note}`, `.../clear-move-out {needsCleaning}`, `.../items-still-here {photoUrls[], note}` (≤ 7 days, not re-let), `.../mark-ready`.
- `commitment-problems.ts`: `:26` `problemContext(tx, 'booking'|'tour'|'storage', id)`; `:107-108, 157-158, 169, 213` storage kind + `storage_booking_id`; `shared/commitment-problems.ts` `problemDestination('storage', …)`; open problem holds payout; resolve releases.
- `damage-claims-v2.ts` storage branch: `fileDamageClaim(managerId, {storageRentalId, …})`, window 72 h from `checkoutRequestedAt` (or released_on for reopen), one per move-out; evidence before = move-in + handover photos, after = move-out photos; `noBaseline` note "No move-in photos were taken." shown to LC and chef; $250 cap, review-first, privacy unchanged; `publicClaim` (`:126`) + storageRentalId; `readClaimBookingHold` (`:220`) storage join; `claimBelongsTo(claim, {kind,id})` helper replacing `kitchenBookingId !== bookingId` checks; admin routes `storage-rentals/:id/claims/...`; `damage-claim-notices.ts:55-56` paths; check `damage-claim-money.ts` (lock rental, not kitchen booking); ended(claim) holds that term's payout.
- Tests: move-in activates + schedules; move-out w/o move-in flagged; reopen after 8 days 409 / re-let 409; storage problem holds payout; claim 73 h refused, second 409, privacy, noBaseline shown.

### WP-ST9 — Kitchen and admin tools (Strong; after ST6, ST7)
- New `storage-rental-actions.ts` (lock rental, re-check occupancy, `assistanceHistory` entry): change unit `POST /api/manager/storage-rentals/:id/change-unit {unitIndex, reason}`; ask to move out by `GET .../move-out-by/preview?date=`, `POST .../move-out-by {byDate, reason}` (`reclaimRule`; refund `unusedRefundSplit(fromDate=byDate+1)`, cause kitchen, full incl. fee share); offer extension `POST .../offer-extension {days}` (notice only "{kitchen} offers {n} more days · $X · Extend"); release unit; refund `GET .../refund/preview`, `POST .../refund {amountCents, reason}` (≤ remaining kitchen net; goodwill_kitchen); holdover charge/waive; removal record.
- Admin `server/routes/admin-storage.ts`: `GET /api/admin/storage-rentals?state=&kitchenId=&q=&needsAttention=1`; `GET .../:id` → DTO + payments[] (amount, refunded, payout status, hold reason, transfer sent y/n; no ids) + flags + support_actions + problems + claims + holdover requests + notices log; `POST .../:id/actions {type, reason, …}` each writing `support_actions` (storage_booking_id, unique operationKey, fundedBy): approve_for_kitchen, decline_for_kitchen, end_rental {refund, fundedBy, emergency}, relocate, open_removal_review, send_final_notice, record_removal_for_kitchen, waive_holdover, goodwill_refund (LC-funded: managerDebited 0), release_payout (override problem hold, never a flag), open_flag/resolve_flag, retry_refund/mark_refunded.
- Tests: guards; reclaim 30-day rental on day 10 with 7 days notice = 13 unused days (exact cents fixture); ≤7-day span refused for kitchen, allowed for admin emergency; relocate conflict 409; all admin actions audited; LC goodwill leaves transfer untouched.

### WP-ST10 — Chef UI (Cheap/medium; after ST4/ST5 contracts; ∥ ST11)
- Routes `App.tsx` (~`:276-295`): `/storage`, `/storage/new`, `/storage/:id` (chef `ProtectedRoute`); nav "My storage".
- `ChefStoragePage.tsx`: cards (kitchen, listing, shelf, one ≤20-word status sentence, one primary action); empty state with approved kitchens' availability.
- `ChefStorageRentalPage.tsx`: header + timeline; Money (terms, refunds, receipts); Extend sheet (chips 7/14/30 clipped to maxDays + stepper; "New end date {date} · Total $X"; "Pay $X with Visa •••• 4242" + "Pay with another card"; disabled reason from limitReason); Move in (reuse `StorageCheckinDialog.tsx`), Move out (reuse `StorageCheckoutDialog.tsx`), Report a problem (`CommitmentProblems`, commitment storage), Holdover pay/dispute (`PendingOverstayPenalties.tsx`), Withdraw/Cancel.
- `ChefStorageRequestPage.tsx` (`/storage/new?kitchenId&listingId`): start picker (today..+14), days stepper (1..max), quote, disclosure: "No automatic charges. Your card is held until {kitchen} answers (within 24 hours). You pay only for the days you choose. To keep your shelf longer, extend before {end}; you have 5 extra days to extend at the same price. After that, the kitchen may charge ${daily}/day. Ending early isn't refunded." → Checkout. Kitchen page: "Rent storage" link per listing with availability phrase.
- Replace legacy chef storage UI in `ChefBookingsView.tsx:20` with a "My storage" link (files deleted in ST12). Tests: Extend sheet clipping/saved-card/fallback/3DS, disclosure, actions only from `actions[]`, 390 px.

### WP-ST11 — Kitchen board + detail, admin list (Cheap/medium; ∥ ST10)
- Rewrite `ManagerStorageBookingsPage.tsx` → Storage board: summary strip "Occupied 6/8 · 2 requests · 1 in grace · 1 holdover"; Requests first (chef, dates, total, "Answer by {time}", Approve/Decline); units by listing, one row per unit with chip Free/Reserved/Occupied/Ending soon/Grace/Holdover/Move-out due/Needs cleaning/Removal review, occupant, the one date that matters, one primary button; filter All · Needs action · Free; cards at 390 px; sidebar label "Storage" (`app-sidebar.tsx:49`).
- `ManagerStorageRentalPage.tsx` (`/manager/storage/:id`): evidence gallery, money per term (payout "Paid $X on {date}" / "On hold: problem open"), "⋯ More" menu with ST9 tools, each previewing amounts before confirm.
- Replace `StorageExtensionApprovals.tsx`, `PendingStorageCheckouts.tsx`, `PendingStorageCheckins.tsx` mounts. Admin: `Admin.tsx:954` case `storage-rentals` → `AdminStorageRentalsSection.tsx` (table + drawer + action forms requiring a reason) + nav.
- Tests: `unitRows(rentals, listings)` mapping; previews show amounts; reason required.

### WP-ST12 — Cutover cleanup + 0094 (Cheap but wide; last; full test run)
- Server deletions: legacy storage routes `bookings.ts:283, 311, 353, 411, 794, 821, 940, 1140, 1202, 1309`; `manager.ts:1139, 3813, 6765, 6854, 7096, 8026, 8091, 8318`; webhook `storage_extension` branch; `auth-expiry-service.ts:117`; overstay detection + `'overstays'` worker task (`recurring-worker.ts:123`); storage selection in kitchen checkout (`stripe-checkout-service.ts:337-367, 530-540`, `booking-checkout-fulfillment.ts:64-80`, `booking-payment-decision.ts` storage branches `:83, 104, 115-152, 275-290`, `booking-lifecycle-delivery.ts:191-204, 227`, `booking-linked-cancellation.ts:13`, `booking-item-cancellation.ts` storage branch, `storage-overstay-terms-service.ts`).
- Client deletions: `BookingStorageSelector.tsx` + storage step in `KitchenBookingFlow.tsx`, `StorageSelection.tsx`, `ChefStorageBookings.tsx`, `StorageExtensionDialog(.test).tsx`, `PendingStorageExtensions.tsx`, `ExpiringStorageNotification.tsx`, `StorageExtensionApprovals.tsx`, `PendingStorageCheckins.tsx`, `PendingStorageCheckouts.tsx` (if unused), `AdminOverstayPenalties`/`EscalatedPenalties`/`OverstayPenaltySettings`.
- `deletion-guard.ts:79, 145`: block kitchen/location/account deletion while a rental is requested/reserved/active/move_out_requested/removal_review or has an unreleased storage_term payment. Migration 0094.
- Tests: full suites at baseline; grep shows no `pending_storage_extensions|overstayTerms|selected_storage`; kitchen booking without storage still books, confirms, pays out.

### WP-ST13 — Policy facts + live rehearsal (lead)
- `policy-facts-booking.md` new section 7 Storage (`built` → `verified`). Rehearse on dev sandbox: approve, decline, expire, extend (saved card, 3DS, decline → Checkout), grace → holdover → charge → pay / dispute → LC decision, removal review → final notice → kitchen record, reclaim (nudge + refund), early move-out + kitchen refund, claim, problem holds payout, chargeback flag, kitchen closes (admin end per rental). Log in PHASE0_LOG.

### Ordering and parallelism

```
ST1 ─┬─ ST2 (cheap) ─────────────────────────────┐
     └─ ST3 (cheap) ─┐                            │
                     ST4 (strong) ─┬─ ST5 (strong)│
                                   ├─ ST6 (strong)┼─ ST9 (strong) ─┐
                                   ├─ ST7 (strong)┘                ├─ ST12 (cheap, wide) ─ ST13
                                   ├─ ST8 (strong)                 │
                                   ├─ ST10 (cheap/medium) ─────────┤
                                   └─ ST11 (cheap/medium) ─────────┘
```
Worktree ownership: ST5 owns `storage-extensions.ts` + storage_term webhook branch; ST6 owns `storage-payouts.ts`, `storage-rental-money.ts`, `stripe-transfer-service.ts`, money guard, flags, documents; ST7 owns `storage-rental-lifecycle.ts`, `overstay-penalty-service.ts`, all `recurring-worker.ts` edits; ST8 alone touches `damage-claims-v2.ts`; ST10/ST11 disjoint client files; `routes/storage-rentals.ts` gets additive blocks.

## 4. Reuse map

| Need | Call / extend | Where |
|---|---|---|
| Hold, capture on approve, cancel | manual-capture Checkout params; `capturePaymentIntent`, `cancelPaymentIntent` | `stripe-checkout-service.ts:386-398`, `stripe-service`, `booking-payment-decision.ts:62-206` |
| Exact 24 h expiry | `scheduleDeadlineTimer` + new kind | `deadline-timer.ts:15,25,60` |
| One-tap extend, 3DS, decline fallback, lost responses | op key / attempt key / findIntent / Checkout fallback / reconcile | `session-extensions.ts:569-657, 687` |
| Fee + HST | `calculateCheckoutFeesAsync`, kitchen `taxRatePercent` | `bookings.ts:1032-1042` |
| Payout timing + release | copy `releaseKitchenPayoutInTick`; `transferToManagerForBooking`; `recordReleasedPayout` | `kitchen-payout-service.ts:91-162`, `stripe-transfer-service.ts:153-178, 476-502` |
| Refunds | `reverseTransferAndRefund` (reserved op); `reconcilePaymentRefundReceipts`; finalize storage branch; `cancellationSourceQuote` | `stripe-service.ts:862`, `payment-refund-reconciliation.ts:11-83`, `booking-cancellation-refund.ts:705, 967-993` |
| Kitchen debt after payout | `kitchenFundingShortfall` → platformFunding + kitchenRefundDebts + notice | `booking-cancellation-refund.ts:726-731, 982-992` |
| Chargeback freeze | dispute branch → storage flag; guard extended | `booking-support-flags.ts:54-63`, `booking-money-guard.ts:9-38` |
| Holdover request/pay/dispute/decision | `storage_overstay_records`, `createPenaltyPaymentCheckout`, `disputeOverstayPenalty`, `reviewOverstayDispute`, `processManagerDecision`, `hasChefUnpaidPenalties` | `overstay-penalty-service.ts:612, 1391, 1416, 1739, 2083` |
| Move-in/out, auto-clear | `requestStorageCheckin`, `requestStorageCheckout`, `processCheckoutClear`, `autoCleanExpiredCheckout`, `processExpiredCheckoutReviews`, `storageDuties`, `storeCheckinPhotosAsEvidence` | `storage-checkout-service.ts:137, 287, 794, 1038, 1089` |
| Damage claims | v2 file/public/decide/pay + storage branch; booking hold | `damage-claims-v2.ts:55-260`, `damage-claim-notices.ts` |
| Problems holding payout | `createProblem`/`reportProblem`/`updateProblem` storage kind | `commitment-problems.ts:26, 144, 163, 175` |
| Durable notices | `notificationService.create` + `emailLogs` + `deliverOutcomeEmails`; admin wording | `damage-claim-notices.ts:57-64`, `outcome-delivery.ts:54-177`, `admin-booking-notice.ts:6` |
| Receipts | `planBookingDocuments`, `drizzleDocumentStore`, PDF renderer | `booking-documents.ts:260, 316, 465` |
| Admin setting | `cancellationSettings`/`saveCancellationSettings` + audit | `cancellation-policy-settings.ts:8-29` |
| Deletion safety | `deletion-guard.ts` | `:79, 145` |
| Paid-but-no-rental recovery | `kitchen-checkout-incidents.ts` | WP-D |

## 5. Risks and mitigations
1. Early transfer at capture → `storage_term` set in the same tx as the payment row; gate ships in ST4 before any storage capture; test "capture webhook before decision → no transfer".
2. Double charge on extension → client requestKey unique; Stripe key `storage-term:{termId}`; one open term (partial unique); `findTermIntent`; webhook ledger.
3. Two chefs one shelf → listing `FOR UPDATE` + btree_gist exclusion (fallback `pg_advisory_xact_lock(hashtext('storage-listing:'||id))` if btree_gist unavailable on prod — verify before ST1 merges).
4. Extension vs approval vs reclaim races → lock order rental row then payment rows (documented header comment); reclaim refunds paid terms under lock; extension blocked by reclaim_end_on.
5. TZ/DST → local `date` columns, `localToday`, instants via `createBookingDateTime` (`shared/timezone-utils.ts:43`); tests Nov 1 / Mar 8, 2026 St. John's.
6. 7-day auth expiry → 24 h response window; capture failure = expired, chef told, no charge.
7. 90-day hold / RPAA → start ≤ 14 days ahead, extend only ≤ 14 days before term start → normal hold ≤ 16 days; 30-day admin alert; `source_transaction`; no manual payouts / delay_days.
8. Refund after payout, insufficient balance → record debt + notify before provider call; netting manual.
9. Chargebacks → storage flag freezes refunds and payouts; admin decides; evidence = rental documents + photos.
10. Fake move-out to escape holdover → "Items still here" reopen ≤ 7 days.
11. Abandoned goods legal → kitchen disposal behind `storage_kitchen_disposal_enabled` (off) until NL counsel approves; never sold; photos + item list.
12. English legacy notices → all new transitions via `queueStorageRentalNotice`.
13. Worker budget → ≤ 3 rentals per tick with cursors.
14. Partial cutover → 0093 additive and refuses open legacy rows; 0094 only after ST12 merged and live-verified.

## 6. Owner questions (with recommendation)
- OQ1 Chef cancels after approval, before start: A ≥ 48 h before start refund minus actual card fee, later none (rec.); B never refundable; C always full.
- OQ2 Lead time / extend window: A start within 14 days, extend only when ≤ 14 days paid remain (rec.; keeps holds ≤ 16 days); B 30 each; C no limit.
- OQ3 Pricing: A daily only; B daily + optional cheaper 30-day price set by the kitchen, N days cost min(N × daily, 30-day price) (rec. if kitchens price monthly).
- OQ4 Approved but never moved in: A kitchen may release 7 days after start, no refund (rec.); B release with refund of unused days.
- OQ5 Extension payout: A on the day the paid days start (rec.); B at payment; C at end of those days.
- OQ6 Holdover during removal review: A frozen at 15 days (rec.); B keeps accruing.
- OQ7 Admin in-app notice for every paid extension: A yes (rec., money event); B no.
- OQ8 Kitchen disposal at launch: A build with toggle off until counsel signs, admin records meanwhile (rec.); B on at launch.

## 7. Owner answers (Oct 16, 2026) — these OVERRIDE the plan above where they differ

1. **Max term:** platform max 30 days (admin setting); each kitchen may set a lower max (e.g. 7). Not 7 everywhere (card-fee drag + friction; no peer sells weekly storage).
2. **Cancellation before start:** REUSE the kitchen's existing booking cancellation policy (notice 24/48/72 h + late charge 50/100%), measured from the rental's start, refund minus the actual card fee. A request not yet approved is always free to withdraw. The kitchen's policy settings screen must say plainly that the policy applies to kitchen sessions AND storage rentals (only when the kitchen has a storage listing). Replaces §6 OQ1.
3. **Pricing:** DAILY PRICE ONLY for launch (no 30-day price, no length discounts). Replaces §6 OQ3.
4. **Not-approved chefs:** same as kitchen booking: they can see the storage listing (size, type, price, access hours, temperature, what's allowed, cancellation line, "no automatic charges") and get "Apply to this kitchen first" into the existing application flow; after approval they can rent. The kitchen preview page and the checkout stepper must reflect storage intuitively (Storage tab on the kitchen page, "Rent storage" button, standalone storage stepper, "Add storage" after a session booking).
5. **Lead time / extend window:** start within 14 days; extend only when 14 days or fewer of paid time remain (§6 OQ2 option A).
6. **Approved but never moved in:** like a session no-show: after the start the kitchen confirms "didn't move in" (allowed 7 days after start); the chef is notified, no refund, the unit is freed. The chef can dispute through the existing problem report ("I was there"). (§6 OQ4 A.)
7. **KITCHEN PAYOUT = END OF EACH PAID TERM** (Neighbor/Stashbee pattern), or earlier when the chef moves out and the kitchen clears the unit (after the claim window if a claim is possible — see WP-ST6). Paused while a problem/claim/flag is open. The kitchen screen always shows "You'll be paid $X on {date}". Extensions: each paid term pays out at its own end. This REPLACES "earlier of move-in or start+48h" everywhere (WP-ST1 `termPayoutEligibleAt`, WP-ST6, §5 risk 7): eligibleAt = start of the day after `ends_on` (kitchen-local) or the move-out clear time, whichever is first; refunds before payout reduce the transfer (no reversal needed in the normal case). Max hold ≈ 14 (lead) + 30 (term) = 44 days < Stripe's 90-day limit for Canada (verified docs.stripe.com/connect/account-balances#holding-funds); admin alert if any payout is unreleased 10 days after its eligible date.
8. **Holdover during removal review:** frozen at 15 days (§6 OQ6 A). **Admin in-app notice for each paid extension:** yes, it's a money event (§6 OQ7 A). **Kitchen disposal:** built behind a toggle, off until counsel signs the wording (§6 OQ8 A).
9. **No deposit. Abandoned items:** after Local Cooks' final notice, kitchen may discard perishables after 48 h, other items 7 days later (photos + item list; never sold). **Reclaim:** rentals ≤ 7 days not reclaimable (emergencies via Local Cooks); longer ones get 7 days' notice or the time left; unused days refunded, kitchen-funded. **Early move-out by chef:** no refund (kitchen may refund more). **Refund/chargeback after payout:** kitchen owes (reversal, else recorded debt).
10. **Vercel Hobby CPU:** no new cron. Storage sweeps ride the existing 30-minute tick (≤ 3 rentals per task per tick, cheap indexed queries); exact deadlines use the Inngest `deadline-timer` (sleep, no compute); notices delivered by debounced events like booking/invitation notices.

11. **Simplified listing form (owner, Oct 16)** — like The Food Corridor (name, type, count, price) + Neighbor (size, access, photos, description): kind (dry/cooler/freezer), name, how many, price per day, photos, size (free text, new `size_label`, migration 0095), access (during kitchen hours / anytime / by arrangement), temperature (cooler/freezer only), notes for chefs, "More options" longest stay. Removed: minimum stay, cubic feet, the overstay penalty section (platform rules apply and are explained to chefs), "other" access text.
12. **Unit out of service (lead, Oct 17, owner raised tracking/control):** the kitchen board shows every unit (free ones included) with its status; "full" is computed from unit count vs rentals. WP-ST9 adds a per-unit "Take out of service / Put back" action (e.g. a broken freezer) that blocks new rentals on that unit only; existing renter keeps it until moved via "Change unit". Pausing a listing stays the way to stop all new requests.
