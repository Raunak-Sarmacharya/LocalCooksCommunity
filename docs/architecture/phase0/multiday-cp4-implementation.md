# CP4: aggregate authorization, capture and day allocations

Implemented against the Oct 17 owner spec and build plan sections 3, 4 (Authorization, capture and allocation) and 8 CP4.
Creation remains behind `booking_multiday_enabled`; no setting was enabled. CP5 payout release and CP6 day drops/refunds
are not implemented here. No new migration is required: this uses the applied 0099–0101 schema.

## Contract and money flow

- `POST /api/chef/bookings/checkout` dispatches payloads containing `days` to `checkoutDatedBooking`. Even a one-day dated
  payload requires the rollout gate; the scalar legacy payload keeps its existing path. Direct-intent, direct-create and
  portal APIs refuse dated payloads rather than discarding dates. Storage remains a separate rental.
- Server validation uses CP3 `validateBookingDays`. Per date, hourly pricing is the frozen hourly rate times selected
  hours; daily pricing is the frozen daily rate. Equipment is priced per selected date, including zero-cent included
  items. Duplicate, foreign and noninteger-priced equipment is refused. Location HST is rounded once on the aggregate
  subtotal. The existing `calculateCheckoutFeesAsync` computes the aggregate service fee once; its Stripe display
  estimate is never persisted as an actual fee.
- `dated-booking-quote.ts` defines `kitchen-days-v1`. A canonical SHA-256 digest covers the server-generated head ID,
  ownership, destination, timezone/buffer, complete ordered schedule/rates/equipment, aggregate cents, fee rate,
  accepted policy, notes and optional replaced request. Object keys are canonicalized independently of JSONB key order.
  The complete quote/hash is saved on the group head **before** Checkout creation, and copied into incident/payment
  evidence. Normal code never reprices or replaces that quote.
- Stripe Checkout uses a full-amount **manual-capture** card authorization, separate charges/transfers, and a stable
  `kitchen-days-checkout:{headId}` key with frozen provider expiry. Session and PI metadata contain only scalar contract,
  head, hash, chef/kitchen identity and aggregate cents; no day/equipment JSON. Fourteen dates remain below 500 characters
  per value (and the tested whole metadata JSON is below 500); line items are at most two per day plus tax/service fee.
- Fulfillment verifies session/PI identity, state, capture mode, CAD, full authorized amount, both metadata copies, quote
  hash, policy and every component/aggregate arithmetic check. Under CP3 kitchen/day/equipment locks, it revalidates all
  days, weekly quota, actual conflicts, group membership, ownership and first start. It uses the frozen quote after a
  listing edit or rollout shutdown. A held contract is not treated as a new request for the notice/horizon countdown.
- One transaction writes the parent (`schedule_revision=1`), N CP2-built visits with immutable daily price snapshots,
  per-day equipment rows/visit FKs and actual scheduled instants, one payment source, incident result, optional replacement
  withdrawal and outbox. Failure rolls these writes back together. A verified inventory/rule conflict uses the existing
  authorization-cancel/full-refund compensation service. Untrusted identity/hash evidence fails closed for support
  review; it cannot authorize a cancellation of an unrelated PI. Same-PI replay returns the same booking, including after
  acceptance/decline, and completes replacement recovery.
- The webhook dispatches dated contracts **before legacy ledger writes or single-date reconstruction**. Unknown contract
  versions stay in dated verification. `payment_intent.succeeded` and `charge.updated` synchronize allocation evidence
  only; they cannot transfer the full source.
- Kitchen acceptance retains the durable existing decision/reconciliation command and Stripe idempotency key. Dated
  decisions verify the entire saved visit/equipment set and require full capture. Rejecting any individual equipment
  item (including a free item) is refused. Declining releases the whole hold and cancels all equipment. Lost capture
  responses recover by reading the original PI, without another charge. Competing decisions keep one immutable decision.
- Response timing uses the existing 24-hour / one-hour-before-cutoff rule from the policy's first scheduled start.
  The dated disclosure is `food-corridor-booking-first-day-v1`, with `deadlineBasis: 'booking_first_day'` and all originally
  accepted starts in `sessions`. No refund arithmetic changed. The 0098 trigger is unchanged: all accepted terms, including
  the discriminator, stay immutable; only `sessions` can be remapped by later approved change work.

## Capture ledger and payout isolation

- The source is `payout_partition='per_day'` and `payout_timing='after_closeout'` before any capture, regardless of the
  legacy environment default. Unknown source processing fee is explicitly NULL, with `feeStatus='pending'`.
- `dated-booking-allocations.ts` derives ordered day/component identities from the frozen quote and actual visit/equipment
  rows. It reuses `capturedComponentAllocations` for aggregate tax and `allocateCents` for service fee and Stripe fee.
  Date/component order deterministically breaks ties, including zero-price components. Metadata retains visit IDs,
  session indexes, `managerGrossCents` and compatibility component evidence; the new ledger is authoritative.
- Capture finalization writes `kitchen_booking_day_allocations` in the same transaction as confirmed/paid state. Each row
  has subtotal, tax and service fee; actual Stripe fee remains NULL/pending until a verified BalanceTransaction exists.
  Provider evidence checks PI/charge ownership, paid/captured amount, balance source, CAD, amount/net/fee and fee details.
  Verified zero is supported. The balance ID/details are retained; replay cannot change a final fee or downgrade it to
  pending. Subsequent capture/charge webhooks fill pending fee shares transactionally.
- Assertions conserve each source: sum(subtotal + tax + service fee) = captured; sum(Stripe fee) = actual fee;
  sum(subtotal + tax - Stripe fee) = captured - service fee - actual fee. There is no new allocation/rounding algorithm.
- The common transfer dispatcher defers `per_day` **before** special change/claim dispatch, and checks again in the locked
  transfer engine. Legacy closeout scheduling/release (including support override), closeout sweeps and capture-transfer
  recovery also defer/exclude these sources. All existing webhook/manual-sync callers share the dispatcher. CP4 creates
  no daily payout rows or transfers; CP5 owns daily release.

## Crash and expiry recovery

Creation/binding failures retain the head instead of assuming Stripe failed. A verified completion that beats binding can
bind its own head under the inventory lock. Binding copies the quote into incident evidence; an earlier result read can
fill an initially NULL incident quote once, without overwriting an existing quote.

The existing bounded checkout recovery also discovers expired unbound dated heads. It lists the complete frozen provider
creation window, verifies head metadata, archives the quote and resumes completion; an expired/no-session outcome is
archived before group deletion. An incomplete provider page or ambiguous matches retain evidence for review. Signed
session-expiry handling also archives an unbound quote before releasing it. Deleted/expired holds can recover from the
incident manifest only after all dates revalidate. Compensation replays reconcile an already-released authorization.

## Verification

`npm ci` completed locally; no dependency manifests changed and no node_modules junction/symlink was created.
The implementation was committed as `4a6a0acd` before final checks. Final server verification: **289 passed, 26 files**,
including **37 CP4 PGlite/unit tests**, **8 signed dated-webhook tests**, and the new legacy dispatcher/release guard tests.
`git diff --check` passed. The one foreground `npx tsc --noEmit -p tsconfig.json` invocation completed with **3 TS2802
errors**, all in new code: two `days.entries()` loops and one Set spread were incompatible with this project's default
ES5 target. Each was changed to `Array.from(...)`, following the existing repository convention. The full compiler was
**not rerun**, respecting the explicit one-run limit; a verified zero-error full pass is therefore still outstanding.

```powershell
npx vitest run --config vitest.config.server.ts dated-booking booking-checkout-fulfillment booking-checkout-replacement booking-checkout-guards booking-payment-decision booking-invitation-decision consecutive-checkout-session checkout-metadata cancellation-policy-settings kitchen-checkout-incidents kitchen-checkout-holds kitchen-payout-service stripe-transfer-payout-gate stripe-transfer-recovery booking-days-validation booking-response-deadline captured-component-allocations cancellation-policy booking-capture-terms booking-pricing-breakdown kitchen-booking-rate webhook-payment-intent-integrity storage-rental-webhooks --maxWorkers=3
```

The CP4 PGlite suite executes the actual 0099 allocation table DDL (including FKs, CHECKs and uniqueness), the actual
0043 visit trigger body with its 0099 guard, and the actual 0098 policy protection function/trigger. This is SQL execution
inside an isolated Postgres instance, not text matching. No shared/development database or live provider was contacted.

Coverage includes mixed modes/rates/equipment, 14-day metadata bounds, aggregate/remainder conservation, full capture,
free-item partial rejection, decline-all, duplicate webhook races, acceptance/replacement races, outbox rollback,
changed rates, missing/expired holds, gate shutdown recovery, lost provider/capture responses, early webhook/expiry,
incomplete provider discovery, wrong identity/hash/currency/prices, actual fee pending/zero/verified/replay, the first-day
response deadline, 0098 immutability, legacy checkout and the legacy payout exclusion.

## Risks and remaining checkpoints

- Keep creation OFF until CP5–CP11 and independent money review/controlled acceptance are complete. CP4 deliberately
  withholds every per-day source from legacy transfers; it does not implement daily releases, day drops or dated refunds.
- PGlite executes real SQL/transactions, but serializes database work. Real multi-connection PostgreSQL contention,
  provider retention/discovery behavior and controlled Stripe sandbox acceptance still need CP11/lead verification.
- Provider discovery is bounded to three heads and one complete 100-session page per head. A busier creation window or
  ambiguous match keeps the expired, non-occupying head rather than guessing. No automatic repricing or second session is
  created. Actual fee evidence stays pending until a provider event/reconciliation supplies the BalanceTransaction.
- Chef/manager full day-list UI, localized disclosures/notices, receipts, per-day revenue/payout reports and whole-schedule
  changes remain their planned later checkpoints. The backend requires the dated disclosure version explicitly.
- No push, deployment, database migration application, live Stripe call, Vercel or Inngest action was performed.

## Files

New services: `dated-booking-quote.ts`, `dated-booking-checkout.ts`, `dated-booking-fulfillment.ts`,
`dated-booking-allocations.ts`. New tests: `dated-booking-cp4.test.ts`, `server/routes/dated-booking-webhooks.test.ts`.

Updated: `server/routes/{bookings,portal,webhooks}.ts`; `server/services/{booking-checkout-fulfillment,
booking-days-validation,booking-payment-decision,cancellation-policy-settings,kitchen-checkout-holds,
kitchen-checkout-incidents,kitchen-payout-service,stripe-checkout-fee-service,stripe-checkout-service,stripe-service,
stripe-transfer-service}.ts`; `kitchen-payout-service.test.ts`, `stripe-transfer-payout-gate.test.ts`;
`shared/{booking-response-deadline,cancellation-policy}.ts`; this report.
