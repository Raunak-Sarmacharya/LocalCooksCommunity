# Multi-day CP6: independent money review (Oct 17, 2026)

Scope: `git diff d25645d8 e325ca75` (commits 60a8f36c, 2a1d1a13, e325ca75). Done by reading the code only: no tests, tsc, Stripe
or migrations were run. Line numbers refer to e325ca75. Read against the spec (rows 7, 8, 10, "Consistency with single-day
bookings"), test plan "Multi-day bookings" items 8–11, and the CP4/CP5 reviews.

## Verdict

- **No single-day regression found.** Every changed single-day path computes the same amounts as before (details in §1).
- The multi-day engine follows the spec for the worked example: one deadline, the existing percent × (paid − fee share)
  arithmetic, the kitchen-cancel split, the drop-rest offer, debits limited to that day, and payouts held while a refund is pending.
- **4 Medium, 7 Low.** Nothing is High: multi-day creation is gated off, so none of these can reach a live booking yet.
  M1, M2 and M4 should be fixed before multi-day is switched on. M3 is an older single-day issue that CP6 now also reaches through day refunds.

## Ranked findings

### M1 (Medium): when the kitchen cancels a day, money the chef already lost on an item removed late that day isn't returned
`server/services/dated-booking-cancellation.ts:128` (`selected.push(...rows.filter(row => ... && !refunded(row)))`) and `:158`.
- Scenario: Mon/Wed/Fri booking with an oven on Wednesday (paid $24.40 = $20 + $3 HST + $1.40 fee, card-fee share f). After the
  deadline the chef removes Wednesday's oven at 50%, getting 50% × (2440 − f). The kitchen then cancels Wednesday. The day
  engine skips the oven row because it already has `evidence.refund`, so the chef gets only the kitchen-time line ($219.60).
  The rest of the oven payment (≈ $12) stays split between the kitchen (≈ $11 of it) and Local Cooks, for a day the kitchen didn't host.
- Spec row 10 says "That day: full refund incl. card fee". A single-day kitchen cancellation refunds `amount − refundAmount`, i.e.
  everything still held (`booking-cancellation-refund.ts`, `commitKitchenCancellation`, `expectedCents`).
- Fix: in `kitchen` mode, also select a dropped day's rows that a chef-mode operation already refunded, and price each one as a
  top-up: customer = paid − prior.customerCents, kitchen = (gross − share) − prior.kitchenCents,
  platform = svc − prior.platformCents, absorbed = share. Write the extra amount into the same allocation's `evidence.refund` (keep it
  as an array, or a separate `kitchenTopUp` field), and add the kitchen top-up to `managerDebitedCents` when the installment is unsent.

### M2 (Medium, latent): a multi-day request captured after it was declined or withdrawn has no refund path
`booking-support.ts:235,443` → `booking-cancellation-refund.ts:82–88` → `dated-booking-cancellation.ts:103–105`.
- Scenario: a multi-day request is declined or withdrawn while the capture races it. `reconcileBookingDecision` records
  `deadEnd: captured_before_release`. Booking `pending`, `paymentStatus: 'paid'`, money captured. Support's only remedy,
  "Refund the charge and close the request", goes to `cancelKitchenCausedBooking`. That now hands off to `cancelDatedDays`,
  whose `price()` refuses because the status isn't `confirmed`, or earlier with "A verified captured payment is needed" when the per-day
  source/allocations were never written. Goodwill isn't offered either (`!recovering`). The chef's money is stuck and the case has no next action.
  (Before CP6 the guard refused the same way. CP6 says the refusals are gone, but this one is still there.)
- Fix: in `cancelKitchenCausedBooking`, send a dated booking to the day engine only when `status === 'confirmed'`. For the
  captured-race case use the existing whole-charge plan (nothing was transferred, so no day is debited) and pass
  `allocatedRefund`/skip `assertLegacyBookingRefund` for that one refund, the same way goodwill does.

### M3 (Medium, older single-day issue, now also reachable through day refunds): support "Retry refund" can send a second refund while the first attempt is still running
`booking-cancellation-refund.ts:1043`, `stripe-service.ts:971` and `:1102`.
- A support retry always uses a new refund key (`${op.id}-refund-${supportKey}`). The guard at `:971` only blocks it when a
  previous attempt already shows up at Stripe. While an operation is `pending` (the chef's or kitchen's own call is still between
  "list refunds = none" and `refunds.create` under `${op.id}-refund`), support sees "Retry refund" (`automaticRefundOperations`
  includes `pending`). Both calls list zero refunds and both create one, so the chef is refunded twice. Afterwards reconciliation
  stops on "Conflicting refund receipts". CP6 now runs every day drop and kitchen day cancellation through this path, and the worker sweep now picks up dated operations too.
  The sweep is safe because it uses the same key after 2 minutes.
- Fix (small, in shared code): use the new support key only when Stripe already shows a terminal failed/canceled attempt for the
  operation. Otherwise use the original `${idempotencyKey}-refund`, so Stripe's idempotency merges the concurrent call.
  Alternatively, hide `retry_refund` for an operation accepted less than ~2 minutes ago (the sweep's age rule).

### M4 (Medium): no path for "the kitchen may refund more" (spec row 7) once a day has started
`dated-booking-refund-guard.ts` (manager direct refund `manager.ts:1195/1463`, admin `admin.ts:3649` refuse);
`dated-booking-cancellation.ts:127,135` (a started day or its equipment is refused).
- Scenario: the chef checks in on Wednesday and the kitchen's oven is broken, or the kitchen wants to give back $30 for that day.
  The kitchen can't refund an item on a started day, the manager's amount refund is refused, and a full-refund request is refused.
  Only Local Cooks goodwill is left, which Local Cooks pays and which is capped at $25 without an exception. Spec row 7 explicitly
  allows the kitchen to refund more. On single-day bookings this works through `additionalCancellationRefund`.
- Fix: add a kitchen-funded extra refund scoped to a day: `{visitId, amountCents}` with amount ≤ that day's remaining kitchen share
  (gross − fee − debited). It debits that day's unsent installment (`managerDebitedCents`) or reverses exactly that day's transfer,
  through the same reservation and `retryCancellationRefund` path (mode `kitchen_extra`, `platformCents: 0`).

### L1 (Low): dropping days one at a time can refund up to 1¢ more per extra operation than dropping them together
`dated-booking-cancellation.ts:144–148` passes the other rows as settled at $0, so `cancellation-policy.ts:97–99` rounds each
operation on its own.
- Worked example (test plan C, 50%): each day's pool is 21960 − 647 = 21313, and 50% = 10656.5. Dropping Wednesday and then Friday
  refunds 10657 + 10657 = **21314**. Dropping both together refunds round(21313) = **21313**. Dropping all three separately gives 31971
  against 31970 together. The kitchen and Local Cooks pay the extra cent. This breaks "never refunds more in total". Single-day
  add-on-then-cancel has the same behaviour, so the money engine is consistent across both, but the total isn't bounded.
- Fix: for chef-mode operations, round cumulatively across operations. Target = round(Σ numerators of every chef-mode-refunded row
  plus the selected rows) − Σ prior chef-mode refunds on those rows, and spread the cents over the selected rows only.

### L2 (Low): a support "kitchen can't host" action on a multi-day booking is checked against the wrong refund key
`booking-support.ts:564` uses `planKey ?? input.operationKey`. A day refund's `refund_operation_id` is
`kitchen-day-refund:{booking}:{key}:{source}` (`dated-booking-cancellation.ts:43`), never the bare key. If dispatch throws after
`commit` (for example a DB error in `readDatedOperation`), the action becomes `recovery_required`. Ten minutes later
`judgeMoneyAttempt` finds no receipt and closes it as "No refund was created… Nothing was sent", even though the days were
cancelled and the refund was reserved or already sent. The reservation itself is still retried by the sweep, so the wrong part is the support record.
Fix: for a dated booking, set `planKey = datedOperationId(id, input.operationKey, source.id)`.

### L3 (Low): support can't cancel a multi-day booking's remaining days for the kitchen after day 1 was used
`booking-support.ts:230–231`: `cancel_kitchen_caused` still needs `!priorGoodwill`, `payments.length === 1` and no `completed`
equipment. These single-day whole-refund conditions hide the action once Monday's oven is `completed` or after any goodwill,
even though the day engine prices only the remaining days. The kitchen can still do it itself, but support acting for the kitchen can't.
Fix: skip those three conditions when `scheduleRevision > 0`. The engine already refuses started days and over-funding.

### L4 (Low): a refund made outside the app holds every day's payout with no release path
`kitchen-day-payouts.ts:84–103`: a Stripe-dashboard refund, or any receipt that isn't a succeeded day operation or Local Cooks-only,
keeps `refundsAllocated` false forever. `release_payout` isn't offered (`booking-support.ts:263` needs `reported_issue`/`lastError`),
and even a release would still be held by `refundPending`. Erring on the safe side is correct, but support has no tool to assign
that refund to a day or to Local Cooks. Fix: give support an "assign this refund" action that writes a Local Cooks-funded or day-debit receipt.

### L5 (Low, consistency): goodwill is added on top of a later day refund on multi-day, but counted towards it on single-day
Single-day: `chefRefundCents = target − refunded` (`cancellation-policy.ts:113`, `alreadyRefundedCents: facts.refunded` at
`booking-cancellation-refund.ts:423`), so earlier goodwill counts towards the cancellation refund, and the kitchen's debit falls with it.
Multi-day: goodwill touches no day, and a later drop pays its full policy amount on top. A large goodwill can also make a later
drop fail with "The remaining payment cannot fund this refund" (`dated-booking-cancellation.ts:168`), so those days can't be
cancelled at all. The multi-day behaviour arguably reads better. **Owner decision**: record it in `policy-facts-booking.md` either way.

### L6 (Low, item 6): readers that still use the parent's first-day date
After day 1 is dropped, `booking_date`/`start_time` still point at the cancelled day, and on any multi-day booking they always point at day 1.
- `booking-lifecycle-delivery.ts:313` `visitWhen()` feeds the date in the `addon_removed` and `cancellationNotice` notices
  (and the admin `when` at :328). A Friday oven removal is shown as "Mon, … 9:00 a.m.".
- The Today board (`manager.ts:4027`) keeps a booking only while `bookingDate ≥ yesterday`, so a booking drops off once its day 1
  has passed. `readKitchenBookingVisits` (`kitchen-booking-visits.ts:68`) doesn't filter, so cancelled days still appear as visits
  with check-in status `not_checked_in`.
- The claims "recent bookings" list (`manager.ts:7251–7252`) uses the parent date as "past".
- Checked and correct (they read active visits): reminders (`reminderVisitTimes` with visits → `currentVisitSnapshot` →
  `isCurrentVisit` needs `active`), arrival details (`bookingInstructionRelease`), closeout and the historical queue, per-day
  payout eligibility (`context()` reads the cancelled visit's own clock with `scheduleRevision: 0`), the response deadline (pending only),
  check-in/attendance (`requireCurrentVisit`), occupancy (`selected_slots` rebuilt), and arrival codes (revoked).
- Fix: notices should pass the day's own date (`quoted.days[0].startAt`), and Today should filter `isCurrentVisit` and select by visit
  date. Neither involves money, so this can go to CP8.

### L7 (Low, reporting): reversing a day that was already paid out doesn't update that day's `reversedCents`
`stripe-service.ts:1029–1031,1118–1119` reverse the transfer and record payout evidence, but `kitchen_booking_day_payouts.evidence.reversedCents` is
never updated. `dayPaidSql` (`revenue-service-v2.ts:13`) and `booking.repository.ts:202` keep reporting the full transfer as paid.
This path should be rare for future days.

## Per-area results

1. **Single-day regressions: none.**
   - `quoteCancellation`: tiers change only when `deadlineBasis === 'booking_first_day'`. Single-day snapshots never get it (only `dated-booking-checkout.ts:50` sets it), and `firstStart` comes from session times that are already validated, so it can't throw.
   - Storage still quotes its own one-session snapshot.
   - `context()` refuses exactly the old single-day condition (no per-day source).
   - Retry loop: a single-day operation takes the old branch. The `platform_processing_cost_cents` metadata is added only when `operation.platformProcessingCost` is set, which only dated operations write, so a single-day retry sends the same parameters under its old idempotency key.
   - `reverseTransferShare`: same retrieve/list/limit/create sequence, keys, metadata and error text as the code it replaced. The only change is an extra `transferId` on the error.
   - Goodwill skips the dated guard only through `allocatedRefund`.
   - Support: `release_payout` and `amountCents` are unchanged for single-day.
   - `occupiedOperatingDates`: undated slots still land on `bookingDate`.
   - Notices: `reportKitchenDebt` amount is the same (`kitchenDebtCents === managerRefund` on single-day).
2. **One deadline: correct.** Tier from `min(snapshot.sessions)`, which is never rewritten on a drop. Started is per day (`checkedIn`/`checkinStatus`/start time). Arithmetic is percent × (paid − fee share), and the fee split must match the stored share. Rounding: see L1.
3. **Kitchen cancels a day: correct** for an untouched day (chef 21960, kitchen −20053, Local Cooks 1260 + 647 absorbed; receipt
   adds up with `platform_processing_cost_cents`). Gap in M1. Offer: `expiresAt` = earliest eligible start, checked against both the
   decision time and the clock at commit. A replay returns early without moving the expiry. The offer is a 100% tier, so no late charge, and it is debited from those days' kitchen share.
4. **Installments: correct.**
   - An unsent day is reduced through `managerDebitedCents` (`dayEntitlement`); a day reduced to $0 ends `noEntitlement`.
   - A day already paid out is reversed by exactly that day's kitchen debit, using a stable key `{op}:{transfer}`. If the reversal falls short, the debt is recorded before the refund, one transfer per pass, capped by the number of reversals.
   - No other day is ever touched.
   - Payouts are held while an operation is pending. A frozen pending installment refuses the drop, and an unstarted reservation is cleared.
   - Double submit: the same key replays; a second key finds the day no longer active.
   - Races: drop vs payout sweep is serialized by the CP5 lock order. Support retry: M3.
5. **Refusals and support dead ends:** M2 (captured race), M4 (kitchen extra refund), L3 (support acting for the kitchen), L4 (unallocated refund).
   `finish_kitchen_refund` can't fire for dated bookings: it needs `kitchenCancellationRefund`, which dated bookings never write.
6. **Parent first-day date:** L6. Every reader that affects money or timing (deadline, payout, reminders, codes, occupancy) uses the visits.
