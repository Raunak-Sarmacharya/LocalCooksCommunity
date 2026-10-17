# CP4 independent money review (Oct 17, 2026)

Scope: `git diff cf756c9b 7feb7b18` (CP4 commits 4a6a0acd, 99b35143, d28361c8), checked against the Oct 17 spec, build plan §3–4
and `multiday-cp4-implementation.md`. Read-only review: nothing was edited, committed, migrated or sent to Stripe. The focused
vitest run could not start here because this worktree has no `node_modules` (`Cannot find package 'vitest'`). I did not run
`npm ci` and did not link `node_modules` from elsewhere, so every finding comes from reading the code. The one exception is the
rounding counterexample in M1, which comes from a standalone replica of `allocateCents`.

**Short answer for the dev deploy:** I found no regression in the legacy single-day money paths, and no path that can pay
out a `per_day` source. With `booking_multiday_enabled` off, no dated booking can be created, so none of the findings below
can be reached on dev today. H1, H2, M1, M2 and M3 must be fixed before the gate is turned on.

## Findings (most severe first)

### H1 (High, behind the gate): dated checkout takes HST from a different column than every other checkout
`server/services/dated-booking-checkout.ts:43` uses `Number(row.location.taxRatePercent ?? 0)`. Legacy checkout uses
`kitchenDetails.taxRatePercent` (`server/routes/bookings.ts:2283`), and the schema says checkout still reads the kitchen
column (`shared/schema.ts:525`). Migration 0101 copies the rate up to the location only when every kitchen there has the same
non-null rate. In every other case `locations.tax_rate_percent` stays NULL.
- **Scenario:** a location's kitchens have rates 15 and 13, or one kitchen's rate is NULL, so the location rate is NULL.
  A dated booking at the kitchen with 15% charges **0% HST**, while a single-day booking at the same kitchen charges 15%.
  The kitchen still has to remit the HST. Line items, receipts and revenue reports, which read the kitchen column, will not
  match what was actually captured.
- The CP4 test fixture sets tax only on the location (`dated-booking-cp4.test.ts:84`), so a legacy checkout of the same
  fixture would charge 0%. The tests cannot catch this.
- **Fix:** `Number(row.kitchen.taxRatePercent ?? 0)`. Add a test where the kitchen rate is 15 and the location rate is NULL.

### H2 (High, behind the gate): a captured dated booking can go through the legacy refund engine, which gives each day its own refund deadline
CP4 stores the dated policy with `deadlineBasis: 'booking_first_day'` and per-day `sessionIndex` allocations. Nothing in
`server/services/booking-cancellation-refund.ts` refuses `scheduleRevision > 0` or `payoutPartition = 'per_day'`. Two checks
that could have caught it both pass:
- `chefSnapshot` (`:351-356`) only compares `sessions[0]` with the parent's first day, which CP4 sets equal.
- The multi-session guard (`:381`) only requires `sessionIndex` to be present.

`quoteCancellation` then picks each component's refund tier from **its own** day's start
(`shared/cancellation-policy.ts:84-86`) and ignores `deadlineBasis`.
- **Scenario:** a Mon/Wed/Fri booking with a 24 h notice and 50% late charge. The chef cancels 12 h before Monday.
  - The spec charges 50% × (share − fee) on all three days.
  - The engine refunds Wednesday and Friday at 100% − fee. That over-refund comes out of the kitchen's share.
  - After Monday starts, the spec gives Monday 0 and Wednesday/Friday the late tier. The engine again refunds the later days in full.
- **Fix (smallest change for CP4):** in the chef and manager cancellation and refund entry points, refuse bookings with
  `scheduleRevision > 0` or a `per_day` source until CP6. If the arithmetic is kept instead, pick the tier from `sessions[0]`
  when `deadlineBasis === 'booking_first_day'`, while `started` stays per day. Either way, add a test that turns this exact
  scenario into a refusal or the spec amount.

### M1 (Medium): the ledger splits the service fee by subtotal, but the plan and the refund engine split it by manager gross
`server/services/dated-booking-quote.ts:108` calls `allocateCents(m.serviceFeeCents, components.map(item => item.subtotalCents))`.
- Build plan §4 says the service fee and Stripe fee are split by component manager gross (subtotal + allocated tax).
- The refund engine splits the platform share by `managerGrossCents` (`booking-cancellation-refund.ts:382`).
- The Stripe fee split (`:109`) already follows the plan.
- **Counterexample** (replica of `allocateCents`, 15% tax, 7% fee): day subtotals [11349, 12421], tax 3566, fee 1664.
  - Ledger split: [794, 870].
  - Engine split: [795, 869].

  Each total still adds up correctly. But the per-day `serviceFeeCents` in the ledger (authoritative for CP5/CP6) disagrees
  by one cent with what the refund engine returns for that day.
- **Fix:** `allocateCents(m.serviceFeeCents, tax.map(item => item.managerGrossCents))`. Add a test that compares the ledger
  against `sourceComponents` weights.

### M2 (Medium, behind the gate): extra time on any day of a dated booking is priced at the first day's rate
The fulfillment writes `hourlyRate: String(first.rateCents)` (`dated-booking-fulfillment.ts:66`). Extra-time pricing uses the
parent's `hourlyRate` (`session-extensions.ts:89`), and extensions are already allowed on dated visits (`:211`).
- **Scenario:** day 1 is a full day at 7003, day 3 is hourly at 1001/h. One extra hour on day 3 is quoted at 7003 plus
  tax and fee, about 7× the right price.
- Legacy daily bookings store the applied rate the same way, but only one day exists there, so this mismatch is new.
- **Fix:** for dated bookings, price from that visit's `priceSnapshot.rateCents` when the day is hourly and refuse when it is
  full-day. Or refuse dated extensions until their checkpoint.

### M3 (Medium/Low, behind the gate): dated recovery can stall the legacy checkout recovery
`recoverKitchenCheckouts` calls `recoverUnboundDatedCheckouts()` first, without a try/catch
(`kitchen-checkout-incidents.ts:184`).
- Any throw (a Stripe list error, a head whose quote fails `verifyDatedQuote`, or "Recovered checkout differs") aborts the
  whole tick. Legacy incident recovery then never runs.
- A head that keeps failing before binding is picked again first on every tick, since selection is the oldest three by
  `expiresAt`.
- The `has_more` or ambiguous case `continue`s and leaves the head in place (`:223`). Three such heads would block every
  newer head indefinitely and cost three provider list calls per tick.
- No dated heads exist while the gate is off.
- **Fix:** wrap each head in a try/catch. When a head is undecidable, archive it once as a `needs_support` incident and
  stop selecting it, for example by stamping it so the query skips it. Also wrap the call in `recoverKitchenCheckouts`.

### L1 (Low): legacy single-day checkout now accepts the dated disclosure version
`ACCEPTED_DISCLOSURE_VERSIONS` now includes `food-corridor-booking-first-day-v1` (`shared/cancellation-policy.ts:14`).
`checkoutCancellationSnapshot` and `cancellationSnapshotFromMetadata` are shared.
- A scalar legacy checkout that sends this version is recorded as having accepted the whole-booking disclosure, but without
  `deadlineBasis`.
- Single-day money does not change. The consent record would be inaccurate.
- **Fix:** refuse `DATED_DISCLOSURE_VERSION` on the legacy route, or keep the dated version out of the legacy list and accept
  it only through `verifyDatedQuote`.

### L2 (Low, not verified against Stripe): dated `charge.updated` throws when there is nothing to sync
`syncDatedPayment` (`dated-booking-allocations.ts:91-96`) throws in two cases:
- the source does not exist yet;
- the intent is not `succeeded` (`verifiedDatedCaptureEvidence:14`).

A `charge.updated` on an authorization that is never captured (declined, expired) would return 500 and be retried by Stripe
for days without ever succeeding. Legacy handling returns without error. No money moves either way.
- **Fix:** return early when the intent is not `succeeded`. Keep the throw only for a succeeded intent with no source.

### L3 (Info, for CP5): extra-time charges on dated bookings
`extensionPayoutDecision` (`session-extension-payout.ts:32-39`) waits for the parent's `transferId` or `payoutReleasedAt`.
A `per_day` parent never gets either, so after-closeout extension payouts on dated bookings wait indefinitely. At-capture
extension sources still transfer through the legacy path. This fails safe, but CP5 must take over these extension payouts as
part of the day's payout, as the plan says.

## Area verdicts and evidence

1. **Legacy single-day regressions: no defects found.**
   - Every new branch in `booking-payment-decision.ts` is keyed on `scheduleRevision > 0` (`:68, :102, :118, :132, :156, :166,
     :175-182`). With revision 0, legacy terms, item prices, partial capture, `kitchenPayoutTiming(env)` and the
     `original-tax-largest-remainder-v1` allocations are unchanged.
   - Webhook dated dispatch only triggers on `booking_contract`/`quote_hash` metadata. Legacy sessions never set these
     (`datedCheckoutMetadata` is the only writer).
   - The `days` own-property refusals cannot fire for current clients: neither `KitchenBookingFlow.tsx:1188` nor
     `BookingConfirmationPage.tsx:353` sends `days`.
   - `validateBookingDays`: the legacy caller passes `legacySingleDay: true` (`bookings.ts:2211`), so the new gate line and
     the reader both fall back to the old behaviour.
   - Payout SQL uses `IS DISTINCT FROM 'per_day'`, which keeps NULL rows.
   - `registerKitchenCheckout` only updates the quote when one is passed. Legacy holds have none.
   - `responseDeadlineForBooking`, `cancellationSnapshotMetadata` and `FromMetadata` behave as before when `deadlineBasis`
     is absent.
   - In `transferToManagerForBooking`, the source read moved above the claim branch. The only effect is one extra read.
2. **Transfer isolation: no defects found.**
   - The only `transfers.create` calls are the engine (`stripe-transfer-service.ts:380, :491`) and damage-claim money (claim
     funds, not the booking source).
   - Every booking-source caller (webhooks :999/:1550/:2503/:2801/:3066, manual sync `payment-transactions-service.ts:873`,
     closeout release, support override, capture recovery, change and extension payouts) goes through
     `transferToManagerForBooking`, which returns early for `per_day` (`:157`). The locked engine checks again (`:249`).
   - The schedule, release, due-sweep and capture-recovery paths all skip `per_day` sources.
   - Refund reversal needs a `transferId`, which `per_day` sources never have.
   - `payment_intent.succeeded` and `charge.updated` only sync evidence.
3. **Partial or different-amount capture: no defects found.**
   - Booking PIs have one capture call (`booking-payment-decision.ts:220`), for `decision.amount` with key
     `booking-decision:{id}`.
   - For dated bookings, the code requires every equipment row to be pending, the quote total to equal `intent.amount`, and
     `capture.amount === authorizedAmount`.
   - A wrong `amount_received` is marked as a dead end (`amount_mismatch`). Evidence also checks
     `amount_received === amount`.
4. **Quote integrity: no defects found except H1 and M1.**
   - Prices come from database rows only. The client payload supplies dates, modes, slots and equipment IDs, and those are
     validated.
   - The hash is canonical, and `verifyDatedQuote` recomputes every component, tax and fee (the fee formula matches
     `estimateManagerPayoutFeesCents`).
   - Session and intent metadata, amount, currency and capture mode are verified at fulfillment, decision and allocation.
   - Tax and service fee are computed once.
   - Conservation is asserted in `allocateDatedCapture`.
   - The Stripe fee comes only from a verified BalanceTransaction and is NULL/pending otherwise. Replays never downgrade it.
5. **Idempotency and races: no defects found.**
   - Fulfillment runs under the kitchen/day/equipment locks, with an existing-PI replay check.
   - The decision locks the source and then the booking, the same order as refunds. The replacement path reads the source
     without a lock, so there is no lock cycle.
   - The decision is saved once, before any capture.
   - Allocation rows are locked by source. A pending fee row is updated only once, and frozen rows are compared on replay.
   - Lost create and capture responses are recovered with stable keys (`kitchen-days-checkout:{headId}`,
     `booking-decision:{id}`).
   - The hold lasts 37 minutes and the session expires after 32. Expired heads are revalidated against the whole manifest.
6. **Gate: no defects found.**
   - `scheduleRevision: 1` is written in one place only (`dated-booking-fulfillment.ts:67`), and only for a quote saved by
     `checkoutDatedBooking`. That function calls `validateBookingDays` without either bypass, and the setting must be the
     exact string `'true'`.
   - Direct intent, direct create and portal refuse `days`. Invitations and rebooking use the scalar path.
7. **Policy snapshot: no defects found except H2 and L1.**
   - `deadlineBasis` and the dated disclosure are required by `verifyDatedQuote`.
   - The response deadline uses `sessions[0]`.
   - The 0098 trigger is unchanged and 0048 only fills NULL hours.
   - Legacy snapshots carry no discriminator.

## Test gaps on money paths
- Dated tax compared with legacy tax when the kitchen and location rates differ (H1).
- Legacy chef and manager cancellation of a captured dated booking (H2): no test refuses it or checks the first-day deadline.
- The per-day service-fee split in the ledger compared with the refund engine's `sourceComponents` (M1).
- Extra-time quotes on a dated booking with mixed modes or rates (M2).
- `recoverKitchenCheckouts` still running legacy recovery when a dated head throws or stays ambiguous (M3).
- Legacy webhooks for dated PIs: `payment_intent.canceled` without a decision, `charge.refunded`, dispute events, and
  `charge.updated` before capture (L2).
- A legacy route given `cancellationDisclosureVersion = DATED_DISCLOSURE_VERSION` (L1).
- I did not run vitest (no `node_modules` here). I did not re-run the full `tsc`; the implementation report says no zero-error
  full pass has been run since the ES5 fixes.
