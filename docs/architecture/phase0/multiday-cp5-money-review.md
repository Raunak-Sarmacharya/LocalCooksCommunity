# Multi-day CP5 money review: daily payout installments (Oct 17, 2026)

**Reviewer:** independent money review (read-only).
**Scope:** `git diff 8e680446 e4f4bd7d` (merge `e4f4bd7d`; commits e94ec084, 583d8e7e, 71904ba9, 3baea8d9). Read against:
- `multiday-cp5-implementation.md`;
- spec #12 and the claims/chargeback rows;
- build plan §4;
- the CP4 review note L3.

**Method:** code reading only. I did not run tsc or tests, and made no Stripe or DB calls.

## Ranked findings

### H1 (High, single-day regression, live on dev): the payout-detail endpoint now fails with a SQL error for every manager
`server/routes/manager.ts:2108` (`GET /api/manager/revenue/payouts/:payoutId`)
- CP5 added `sql\`${paymentTransactions.payoutPartition} IS DISTINCT FROM 'per_day'\`` to the first `bookingRows` query.
- That query only joins `kitchen_bookings`, `kitchens`, `locations` and `users`. It never joins `payment_transactions` (the
  `/statement` route below it does, through a LEFT JOIN).
- Postgres rejects the query with `missing FROM-clause entry for table "payment_transactions"`, so the route returns 500 for
  every manager and every payout, single-day included.
- **Mitigating:** I found no client caller (`use-revenue-data.ts` only calls `/revenue/payouts` and `/:id/statement`), so the
  impact is limited to the API. It is still a regression of an existing endpoint.
- **Fix:** delete that one line. The route only lists booking rows, and dated bookings have `paymentStatus` and dates like any
  other booking. Alternatively, add the same LEFT JOIN the statement route uses.

### M1 (Medium, reporting): the dashboard "Pending payments" never goes down for a per-day source and deducts the card fee twice
`server/services/revenue-service-v2.ts:217-228`
- CP5 put `dayPendingSql` into `processing_payments`. That column is only logged (`:367`), never returned.
- The value shown to managers is `pending_payments` (`:378`, `KitchenDashboardOverview.tsx:422`). Its CASE has no `per_day` branch.
- A per-day source is `succeeded`, `after_closeout` and keeps `transfer_id IS NULL` forever, so it always takes the legacy branch:
  `manager_revenue - stripe_processing_fee - refunds`.
- For dated sources, `manager_revenue` is already net of the fee (`dated-booking-allocations.ts:86`: total − service − fee).
- **Scenario:** a 3-day booking captured at $330 with a $30 service fee and a $10 card fee has a net of $290.
  - The dashboard shows $280 pending.
  - After all three days are paid it still shows $280 pending, permanently.
- **Fix:** add `WHEN pt.payout_partition = 'per_day' THEN ${dayPendingSql}` as the first branch of `pending_payments`. Revert the
  `processing_payments` change, since a per-day source is not a processing payment.

### M2 (Medium, eligibility, gated): problems a kitchen raises, including automatic schedule problems, hold every day's payout. Single-day only holds for chef reports
`server/services/kitchen-day-payouts.ts:72-73`
- The day hold query counts any unresolved `commitment_problems` row.
- The legacy rule (`kitchen-payout-service.ts:47`) counts only `p.reported_by = kb.chef_id`, as documented in `PayoutHoldReason`
  ("an unresolved CHEF-reported kitchen problem").
- `queueScheduleProblems` (`commitment-problems.ts:263`) creates a booking-wide (`visit_id` NULL) `schedule` problem whenever a
  manager's closure or hours change touches a confirmed booking.
- **Scenario:** a 5-day booking where days 1-2 are delivered and inspected, then the kitchen closes day 4.
  - The schedule problem has `visit_id` NULL, so days 1-2 get `reported_issue` and stop paying until someone resolves a task
    about day 4.
  - A single-day booking is never held this way.
- The test at `kitchen-day-payouts.test.ts:94` asserts that manager-raised problems hold. Holding them is therefore a deliberate
  departure from single-day behaviour, but neither the spec nor the plan requires it ("problem reports on a day hold that day";
  "like a single booking").
- **Fix (smallest change):** add `AND p.reported_by = (SELECT chef_id FROM kitchen_bookings WHERE id = ${source.bookingId})` to
  match the legacy rule. If the owner does want kitchen-raised live reports to hold their own day, at least exclude
  `p.kind = 'schedule'`.

### M3 (Medium, support, gated): a per-day "release payout" with nothing due locks the support case; support cannot release over a reported issue
`server/services/booking-support.ts:256-257, 424-426, 551-554`
- For `per_day`, `release_payout` is offered whenever the case isn't busy, **even with an open non-chargeback flag**, because the
  per-day branch bypasses `ctx.flags.every(...)`.
- `releaseBookingDayPayouts` returns `success:false` whenever no installment transferred and some are still waiting. It never
  returns `overrideRecorded`.
- `executeBookingSupportAction` throws on `success === false` and marks the action `recovery_required` (`:571-574`).
- `release_payout` is not in `MONEY_ATTEMPT_TYPES`, so the `resolve_money_attempt` cleanup ignores it. Meanwhile
  `busy = some(recovery_required)` (`:187`) hides every other support action on the case.
- **Scenario:** day 2 is held by an open flag (or still before its inspection deadline). Support clicks "Release payout".
  - No money moves.
  - The case is now locked until a replay of the same operation key succeeds, which can only happen after the hold clears.
- Separately, the per-day path never applies the support override. Legacy support can release over a chef-reported issue;
  per-day support cannot, and must resolve the problem instead.
- **Fix:**
  - Offer per-day `release_payout` only when an unsent installment is failing or retryable (`lastError`, or a `holdReason` that is
    neither a flag nor `visit_not_closed`).
  - Treat `deferred` as a verified no-op: `verified = release.success || release.deferred`.
  - If the owner wants override parity, save a per-installment `supportReleased` and pass it to `dayEligibility` instead of the
    hard-coded `false`.

### L1 (Low): an unstarted reservation is never released, so it can freeze the whole booking's non-payout money actions
`server/services/kitchen-day-payouts.ts:106-108, 171-175, 195-199`, together with `booking-money-guard.ts:54-56`
- Once `prepare` commits `state:'pending'`, later runs reuse the frozen parameters without rechecking anything until
  `startAttempt`.
- If the charge check at `:197-199` keeps throwing, the row stays pending with no `startedAt`. The same happens if `startAttempt`
  finds a new hold. Examples of a persistent throw: a refund made directly at Stripe, or a supplemental source amount mismatch.
- The guard then refuses every non-payout money operation on the booking: damage-claim money, extension, overstay, document
  checks and refunds. This conflicts with "claims don't hold payout" in the opposite direction.
- **Safe fix:** when `startedAt` is absent, no provider create can have happened, because `startedAt` commits before `create`.
  - In the `startAttempt` hold branch, clear the reservation: unset `state`, `params` and `releasedAt`, and set
    `transferAmountCents = NULL`.
  - Run the charge check inside `startAttempt`'s unstarted path, or clear the reservation on that failure too.

### I1 (Info, single-day behaviour change, intended by plan §4): open chargebacks no longer block kitchen payouts
- `booking-money-guard.ts:32` now exempts `chargeback` for `payout:true`.
- Legacy after-closeout release, extension payouts and change-source payouts now pass `payout:true`.
- The support `release_payout` check changed from `!flags` to "all flags are chargebacks".
- Effect: a single-day after-closeout payout, an at-capture recovery or a support override with only an open chargeback flag
  will now **send**. Before, the guard blocked it and the sweep retried.
- This matches the pilot rule and the plan's "Current guard discrepancy to fix/test in CP5". Flagging it only because the brief
  says single-day must behave exactly as today. Lead should confirm it is accepted.

### I2 (Info)
- `flushDayPayoutNotices` "Remaining payouts" counts allocations whose fee is still pending as $0. It would also count superseded
  allocation revisions (none exist until CP7). This affects the copy only.
- `dayTransferKey` uses database ids. If two databases share one Stripe sandbox, the same key could collide with different
  parameters. Stripe would reject it (fails closed for up to 24 h), so a double transfer is not possible. Low; the plan prescribes
  this key.
- `refundPending` blocks every installment once `refundAmount > 0`. This fails closed until CP6 as documented. Dated refund entry
  points are refused anyway (`dated-booking-refund-guard.ts`, called from `stripe-service.ts:660/916`, the cancellation engine,
  item cancellation, support and the manager/admin routes).

## Area verdicts and evidence checked

1. **Single-day payout regressions:** H1 and I1 only.
   - The sweep, webhook, manual sync and capture-recovery paths all go through `transferToManagerForBooking`. It refuses
     `per_day` first (`stripe-transfer-service.ts:156`). `partitionDatedSupplement` returns false when `scheduleRevision` is 0, and
     no caller holds an open transaction on the source (checked `webhooks.ts`, `payment-transactions-service.ts:874`).
   - `releaseDuePayouts` and `recoverCaptureTransfers` exclude `per_day`.
   - The `releaseKitchenPayout` and `readKitchenPayout` branches only trigger for `per_day`.
   - The statement summarizer dedupe only applies to rows that carry `transferId`/`installmentId`, which legacy rows never select.
     `totalBookings` still counts distinct booking ids.
   - Revenue V1 and V2, the repository and `getTransactionHistory` use `CASE ... per_day`. For single-day rows they fall back to
     the old expression, with the numeric type preserved.
   - The extra `dayRows` query in `loadMoneyRows` returns nothing for single-day bookings.
2. **Double transfer: no defects.**
   - Locks are taken in order: sources ascending, then booking, visit, installment.
   - Parameters are frozen before provider I/O. `startedAt` commits before `create`, and `create` uses
     `idempotencyKey = operationKey`.
   - Discovery goes through `transfers.list` by group. It fails closed on `has_more`, matches on `operation_key` or
     `installment_id`, and errors on more than one match.
   - `verifyDayTransfer` checks amount, currency, destination, `source_transaction`, group, metadata and `amount_reversed === 0`.
   - The save under lock refuses a different `transferId` or changed parameters.
   - Concurrent runners converge on the same key, and after 24 h discovery reconciles. Parent `transfer_id` is never written.
   - A supplemental source is partitioned under its row lock before any legacy dispatch, on every path.
3. **Amount: no defects.**
   - `dayEntitlement` is Σ(subtotal + tax − actual fee − debit) for that source, visit and revision. This equals manager net
     because the service fee is added on top (`allocateDatedCapture` asserts Σ(sub+tax+svc) = captured and
     Σ(sub+tax−fee) = captured − svc − fee).
   - A NULL fee gives `waiting_fee` and is never estimated. Zero gives a durable `noEntitlement`.
   - Supplemental sources go through the same `allocateDatedCapture` conservation check, plus `baseAmount + serviceFee = captured`.
   - Refund debits are never applied in CP5: no writer of `managerDebitedCents` exists, and any refund blocks payout.
4. **Eligibility:** M2 (hold scope), M3 (no support override).
   - Per-visit inspection, claim-filed closure, auto-close at max(end, departure) + auto-close hours, and the cancelled-visit
     scheduled end + grace are all correct (`dayEligibility` with `reduceClockCloseout`).
   - Scoped and NULL flags and problems are handled correctly in both the context and the guard.
   - Chargebacks are exempt in both.
   - Claims don't hold: `issue_filed` counts as closed.
   - Superseded or revision-mismatched visits throw and fail closed.
5. **Extra time / WP-RS: no defects** (both still gated).
   - Extension sources resolve their persisted `visitId` and are checked against the booking, intent and `paidAt`.
   - A change source needs `dayComponents` or `visitId`; otherwise it throws and stays unpaid.
   - Separate installment rows use different source ids, so different keys. They cannot also pay through legacy (partitioned
     first; `releaseDuePayouts` excludes `per_day`).
6. **Reporting:** H1, M1. Everything else counts each source once and installments separately:
   - V2 `manager_revenue`, `deposited` and `completed_net` use `dayPaidSql`, and the by-date view adds one event per sent installment;
   - the repository and transaction history use sent installment net;
   - the upcoming list filters out per-day summaries and adds unpaid installments once;
   - documents issue one remittance per day transfer, and settlement waits for unsent days;
   - support retry is safe for money (holds are respected and it goes through the same engine); its case-state problem is M3.

## Lead disposition (Oct 17)
- #1 (High) fixed: removed the per_day filter from the payout-detail query that never joins payment_transactions (manager.ts).
- #2 fixed: per-day sources show only untransferred installments in "Pending payments"; processing_payments reverted.
- #3 fixed to match single-day (owner principle): only a chef-reported problem holds a day's payout; tests updated.
- #4 and #5 (multi-day only, creation gated off) -> carried into the CP6 brief.
- Chargeback note: not a new decision — the owner's Oct 16 pilot rule (Local Cooks absorbs; delivered sessions still pay) was already live for single-day payouts; CP5 aligned the shared money guard with it.
- Test fixture gap: storage-payouts PGlite schema lacked kitchen_booking_day_payouts (queried by the shared money guard); added.
