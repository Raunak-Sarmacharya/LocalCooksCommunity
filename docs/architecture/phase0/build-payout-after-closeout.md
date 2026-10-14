# Build plan: pay the kitchen after closeout (lead-authored 2026-10-14)

**Goal:** move the kitchen manager's Stripe transfer from "at capture/confirmation" to "when the visit closes". It's on the owner-agreed roadmap ("payout after closeout with receipt vs final invoice"). Research basis:
- Turo starts the payout ~3 h after a trip ends;
- Airbnb ~24 h after check-in;
- Peerspace within 7 days after the event.

Holding until closeout means refunds, no-shows and issue reports are settled before the kitchen is paid. The money map with file:line refs is `map-payout-deadline-feedback.md` §1; verify each reference before editing.

## Decisions (lead, within the owner's delegated policy)
1. **Release moment** (per booking, all visits):
   - (a) the manager finishes the inspection with no issue (`recordKitchenInspection` clear), or
   - (b) the inspection window closes (auto-close, 24 h after the later of scheduled end and departure) with no issue reported.

   **Hold instead** while an issue/damage report is open on any visit, or while an open `booking_flags` row exists (the support freeze already exists). Release when support resolves it; add a support action `release_payout` (and use the existing `open_flag` manual hold to block).
2. **No-show / no taps:** the booking still closes on the clock. No-show = cancellation at start (R3, chef responsible, no refund), so the kitchen's share releases at (b). Attendance unknown also releases at (b).
3. **Cancelled after confirmation, before release:**
   - The refund comes from the platform; the kitchen's entitlement is reduced (the existing pre-payout branch, `stripe-service.ts` ~989); there is NO transfer reversal.
   - Kitchen-caused cancellation → entitlement 0, nothing is ever transferred.
   - Chef cancellation with a retained kitchen share → release that share at the booking's scheduled end + service grace (the same sweep), so every payout happens "after the slot".
4. **Goodwill** (Local Cooks-funded) never changes the entitlement. That's already true; keep it.
5. **Rollout safety:**
   - Snapshot `payout_timing` on the payment transaction at capture: `after_closeout` or `at_capture`.
   - The env `KITCHEN_PAYOUT_TIMING` sets the value for NEW captures: `after_closeout` on dev; **default `at_capture` everywhere else** until the owner approves production after a read-only live Stripe settings check.
   - Existing transactions (`at_capture`, already transferred) are untouched.
6. **Amount** = the same `computeManagerGrossAndCommission` split as today, minus the kitchen share of refunds made before release. Use the existing math; no new fee rules.

## Data (migration `migrations/0079_payout_after_closeout.sql`; do NOT apply)
Add to `payment_transactions`:
- `payout_timing text` (null = legacy at_capture);
- `payout_eligible_at timestamptz`;
- `payout_hold_reason text`;
- `payout_released_at timestamptz`.

Partial index for the due sweep: `WHERE payout_timing='after_closeout' AND transfer_id IS NULL AND payout_released_at IS NULL`. Drizzle schema to match.

## Server
1. **Gate in the transfer engine.** In `transferLockedSource` (`stripe-transfer-service.ts`), an `after_closeout` transaction without a release decision returns a `deferred` skip, so every caller is safe:
   - `handlePaymentIntentSucceeded`;
   - `handleChargeUpdated`;
   - manual sync in `payment-transactions-service.ts`;
   - the claim/overstay fallbacks.

   Separate charges (storage extension, overstay, damage claim) keep their current timing; only the kitchen booking charge is deferred.
2. **Release command** `releaseKitchenPayout(bookingId, reason)`:
   - lock; verify the eligibility rules above;
   - set `payout_eligible_at`/`payout_released_at`;
   - call the existing transfer function, which writes `transferId` + `managerRevenue` as today.

   Idempotent. Persist the decision before provider I/O; on provider failure use the existing transfer recovery.
3. **Triggers:**
   - **inline:** after `recordKitchenInspection` clear commits, attempt the release (queue an outbox kind, or call after commit; never hold the DB lock during Stripe I/O);
   - **sweep:** a recurring-worker task `releaseDuePayouts(limit 3)` on the partial index, early exit when nothing is due (Vercel Hobby CPU); it covers auto-close, cancellations' scheduled end, and retries.
4. **Refund paths** (audit all of them: cancellation accept/refund, kitchen-caused cancel, manager refund routes, admin recovery, reschedule refunds, support actions). When no transfer exists for an `after_closeout` transaction, use the pre-payout entitlement reduction, never a reversal attempt or an error.
5. **Notices** (outbox, notice shell, people-language):
   - **Manager at release:** "You've been paid {amount} for {chef}'s booking on {date}", with "It's on its way to your bank on your usual Stripe payout schedule." and a CTA "View payout statement" (the existing per-booking manager invoice/statement PDF).
   - **On hold:** "Your payout for KB-… is on hold while Local Cooks reviews the reported issue. We'll let you know when it's released."
   - **Chef:** at closeout, the existing "visit complete" email gets "Download your final invoice". This is the existing receipt generator titled "Final invoice" once the booking is completed, including any refunds/goodwill. Receipt (at capture) vs final invoice (at closeout) is the owner's idea.
6. **Payloads:** add `payout: { timing, status: 'scheduled'|'on_hold'|'sent'|'not_applicable', expectedAt, sentAt, amountCents }` to the manager booking details/list payloads. Admin support case: show the same, plus the `release_payout` action when held.

## Client
- **Manager booking page payment card:**
  - before release: "Your payout $27.32 · Sent after the visit closes (around {expectedAt})";
  - on hold: "On hold while Local Cooks reviews the reported issue";
  - sent: "Sent to your Stripe account on {date}".
  - Remove the "Payment collected from the chef." implication that the money is already the kitchen's.
- **Manager revenue dashboard:** an "Upcoming payouts" total/list (scheduled + on hold) separate from paid earnings, so $0 `managerRevenue` before release never reads as lost. Same for `RevenueMetricCards`.
- **Admin support:** the payout block + the "Release payout" action dialog, per the existing pattern.
- **Chef:** the "Download final invoice" label once completed. i18n in all 3 locales.

## Tests
- The gate: `after_closeout` capture → no transfer from the webhook, charge.updated or sync.
- Release on clear; release on auto-close; hold on an issue/flag; release_payout support action.
- Cancellation before release (chef and kitchen-caused) → refund without reversal, entitlement correct.
- Idempotent release under retry.
- `at_capture` legacy unchanged.
- The env default is `at_capture`.
- Notices; payload; the client cards.

Run the touched suites + `npx tsc --noEmit`. Baseline of pre-existing failures: `.phase0-harness/head-server-fails.txt` (server, 50 tests/15 files); client: BookingCancellationChooser, BookingPreparation, tour*, KitchenHero, ManagerGettingStarted, locales ICU, cancellation-policy-dialog. Report new versus pre-existing.

## Out of scope
Changing fees/commission math; Express payout schedules; storage subscriptions; the production rollout.

Output: `.phase0-harness/payout-after-closeout-checkpoint.md`. It must include a "production go-live checklist": the live Stripe read-only checks (platform balance coverage for pre-release refunds, the Connect payout schedule, `losses.payments`, debit_negative_balances), env changes, and owner approval.
