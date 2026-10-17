# CP6: day drops, per-day equipment and kitchen interruption (Oct 17, 2026)

Built against the owner spec (rows 7, 8, 10, 11), build plan §4 "Refunds, drops, add-ons and kitchen interruption" and §8 CP6,
on `development` d25645d8 (CP1–CP5, reviews, partial acceptance; migrations through 0103 applied on dev). Multi-day creation stays
off. **No new migration**: CP6 uses columns 0099 already added (`kitchen_day_cancellation_offer`, visit `schedule_state` /
`cancellation_plan`, allocation and installment `evidence`).

## Money flow

- **One deadline.** `quoteCancellation` takes the tier from the first originally booked session when the snapshot says
  `deadlineBasis: 'booking_first_day'` (CP4 sets it at checkout); each day's own start still decides "started". Single-day
  snapshots have no basis and keep per-session tiers (regression test). Dropping day 1 never moves the deadline.
- **Pricing** (`server/services/dated-booking-cancellation.ts`, `price`). Components are the CP4 day allocations (kitchen time
  and each item per day, with its subtotal, tax, service fee and verified actual card-fee share). The existing engine prices only
  the selected components (all others are passed as settled at $0), so the arithmetic is unchanged: chef refund = percent ×
  (paid share − card-fee share), cumulative rounding once per operation, kitchen/platform split by `roundRatio`. The engine's fee
  split must equal each allocation's stored fee share or the quote refuses. A missing actual fee returns `quoteReady:false`
  (`processing_fee_pending`) and the command refuses (no deferred fee-pending drop, see Risks).
- **Kitchen-caused** lines are computed like today's kitchen cancellation: chef gets the full share (gross + service fee),
  kitchen is debited gross − card-fee share, Local Cooks returns the service fee and absorbs the card fee
  (`platform_processing_cost_cents` on the receipt).
- **#10 offer.** A kitchen day cancellation persists `kitchen_day_cancellation_offer` = {operation id, cancelled visits, eligible
  remaining not-started visits, createdAt, expiresAt = earliest eligible start}. While open (checked against both the decision
  time and the server clock at commit), a chef drop of eligible days is priced with a single 100% tier (refund minus fee share,
  no late charge, debited from those days' kitchen share). Replays of the kitchen operation return early, so expiry never
  extends; a quote confirmed after expiry fails the `expectedRefundCents` check. No remaining days → no offer.
- **Commit first** (one transaction, locks source → booking → visits → installments, the CP5 order; money guard with the
  caller's own support key exempt; one open refund operation per charge): dropped visits → `schedule_state='cancelled'` +
  `cancellation_plan`, their arrival codes revoked (`revokeForVisit`), their equipment rows cancelled, parent `selected_slots`
  rebuilt from the remaining active days (occupancy, buffers and the weekly quota read these), parent equipment JSON updated.
  If no active day remains the booking is cancelled with the existing `cancelLinkedBookingDates`. Each refunded allocation gets
  `evidence.refund` (exact cents, mode, funding) and, for an unsent installment, `managerDebitedCents` (CP5's `dayEntitlement`
  already subtracts it; a fully debited day ends `noEntitlement`). The reservation goes into the existing
  `cancellationRefundOperation` slot (`dated: true`, lines, reversals, customer/manager/platform/processing cents) with key
  `kitchen-day-refund:{bookingId}:{operationKey}:{sourceId}`, plus payment history and notices.
- **Provider second**, through the existing `retryCancellationRefund` → `reverseTransferAndRefund` → `reconcilePaymentRefundReceipts`
  → `finalizeCancellationRefund` path (so webhook, worker sweep, support retry/mark-refunded and receipt reconciliation all
  apply). `reverseTransferAndRefund` gained `installmentReversals`: for a per-day source it never discovers or prorates a source
  transfer; it reverses exactly each listed sent day transfer by that day's kitchen debit (recovered by operation id, key
  `{operation}:{transferId}`), then refunds. A shortfall names its transfer; the retry persists that day's kitchen debt
  (`platformFunding`, `kitchenDebtCents`, `kitchenRefundDebts` with visit/installment/transfer) **before** refunding, the WP-AO
  shortfall pattern, and admins get "A kitchen owes Local Cooks for a refunded day". The worker sweep now also retries dated ops.
- **Payout serialization.** `refundPending` keeps holding every installment while any operation is pending; once settled, a
  per-day source pays again only if every receipt is a succeeded day operation or entirely Local Cooks-funded (goodwill)
  (`refundsAllocated`). An unallocated refund still holds every day. The pre-transfer charge check now compares
  `amount_refunded` with the reconciled `refundAmount` instead of refusing any refund.

## Paths that used the CP4 guard (`dated-booking-refund-guard.ts`)

Real CP6 behaviour now, via a dispatch at each entry of `booking-cancellation-refund.ts`:
chef quote / cancel (all remaining days, or `visitIds`), support cancel for the chef (`details.visitIds`), chef add-on quote /
removal (that day's item), kitchen-caused cancellation (all remaining days or `visitIds`; support uses `details.visitIds` and its
message as the reason), kitchen-caused add-on refund (the day's item, removed and refunded in one step), refund retry and
receipt-only mark-refunded (dated ops), Local Cooks goodwill (`createRefund(..., allocatedRefund)`, debits no day). Support's
pre-reservation dated refusal is removed. Still refused, with a message pointing to the day commands: the single-session
request/accept flow (`quote`), Local Cooks-funded kitchen refund (`fundedByLocalCooks`, not needed: unpaid days are debited
from their pending payout and an unreversible paid day becomes debt automatically), unscoped refunds (manager direct refund,
full-refund request, admin full-refund decision, raw status changes, generic `createRefund` / `reverseTransferAndRefund`), and
equipment changes on a pending multi-day request (all-or-nothing). A per-day charge on a booking without a dated schedule
fails closed in the shared context.

## Endpoints

- Chef: `GET /chef/bookings/:id/cancellation-quote?days=<visitId,…>` (default every remaining day; `?scope=equipment:<id>`
  for one item) returns exact cents per day, the deadline, before/after, the offer; `POST /chef/bookings/:id/days/cancel`
  `{visitIds, operationKey, expectedRefundCents, reason}`; the existing cancel and equipment-removal routes dispatch.
- Kitchen: `GET /manager/bookings/:id/day-cancellation-quote?days=…`, `POST /manager/bookings/:id/days/cancel`
  `{visitIds, reason, operationKey}`; the existing whole cancellation and `addon-refund` dispatch.
- Support case: `dayCancellation` = each remaining day and all of them priced for the chef and by the kitchen (one provider read);
  the "cancel for the chef" / "kitchen can't host" previews show those exact cents.

## Notices

`day_cancelled` (new kind, added to Local Cooks' tracked list: in-app for every admin, email only for admins with the toggle on,
via the existing delivery) with chef/kitchen role text ("Your refund is $213.13; the $6.47 card processing fee is kept",
"Your payout for that day is $0.00", the offer line with its deadline in the kitchen's zone) and a factual admin message.
Item removals use `addon_removed`; dropping every day uses the existing `cancelled` notice (`cancellationNotice`).

## CP5 review carry-overs

- **#4** Support "Release payout" on a per-day booking is offered only when an unsent day actually failed (`lastError`) or is
  held by a chef-reported problem, and an open non-chargeback flag blocks it as for single-day. The release records
  `supportReleased` on those installments (as single-day's override) so a chef-reported problem no longer holds them; flags,
  inspection deadlines and refunds still do. "Nothing due yet" returns `overrideRecorded` and verifies as a no-op.
- **#5** An unstarted day reservation (no `startedAt`, so no provider create can have happened) is cleared when a hold appears
  at the attempt boundary or the charge check fails, so it can no longer freeze refunds/claims through the money guard.

Also: `occupiedOperatingDates` no longer adds the parent's first date on its own (a dropped day 1 is free for full-day bookings;
unchanged for one-day bookings, whose undated slots map to that date); the support case schedule reads a dated booking's visits.

## Tests

New `server/services/dated-booking-cp6.test.ts` (PGlite; executes the actual 0099 ledger DDL and 0102; provider/delivery in
memory), 23 tests, worked example of the team test plan C (Mon/Wed/Fri, $180/day, 15% HST, 7% fee, $19.41 actual fee):
cutoff before/at/after for all days (Friday is 50% after Sunday 9 a.m.); $100/$3 at 50% = $48.50 and single-day per-session
tiers unchanged; drop Wednesday early $213.13 (Mon+Fri $439.20 stay, code revoked, occupancy dates, ledger debit 20053); late
$106.57 with the kitchen keeping $100.26; dropping Monday keeps the Sunday deadline; started day refused and "cancel all" =
remaining days with one rounding (10657 + 10656); every day → booking cancelled; quote mismatch, replay, fee pending, open flag;
equipment: later item after an earlier check-in, started day refused, item → day → all conservation, free item, kitchen item
removal incl. fee; kitchen cancels Wednesday $219.60 (kitchen −$200.53, Local Cooks $12.60 + $6.47 absorbed), offer on Friday
until it starts, replay keeps the offer, Friday then $213.13 from its entitlement; offer ends at the next start (race refused,
then 50%); kitchen cancels all; sent day reversed exactly (never another day), unreversible → day debt then refund; lost refund
response holds payouts until the original receipt is recovered, then Monday pays 20053 and the dropped day ends noEntitlement;
unallocated refund holds, goodwill doesn't; #5 and #4; support previews; admin notice.
Also: 4 provider tests for `installmentReversals` (`stripe-refund-recovery.test.ts`); the CP4-era refusal tests now assert
dispatch to the day engine, the remaining refusals, goodwill and support day scopes (`booking-cancellation-refund.test.ts`,
`booking-support.test.ts`, `booking-item-cancellation.test.ts`, route/refund refusal message updates).

## Verification

`npm ci` installed this worktree's dependencies (no manifest change, no node_modules link). Implementation committed as
`60a8f36c` before the final checks.

- **Full server suite, once** (`npx vitest run --config vitest.config.server.ts --reporter=dot`): 308 files, **4021 passed,
  6 failed**, 1 expected fail, 12 skipped. Re-run of the 4 failing files with `--no-file-parallelism`: the same 6 fail.
  - 4 were expected CP6 behaviour changes in old tests: the manager status-change refusal now says "made per day"
    (`booking-access-guards`, 3 cases), and the chef quote route passes the day target (`consecutive-bookings`).
    Updated in `2a1d1a13` (with a small follow-up: a dated item removal returns its name and free/late flags).
  - 2 are **pre-existing on d25645d8**, confirmed by running them with this branch's `server/` and `shared/` reverted to the
    base commit: `booking-partial-acceptance-projection` (its PGlite fixture lacks a table the CP5 manager list query reads)
    and `stripe-webhook-contract > refuses live Stripe keys` (environment-dependent). Not touched here.
- **`npx tsc --noEmit -p tsconfig.json`, one foreground run** (~12 min): **3 errors**. Two were in the new engine
  (`engine.perComponent` on the fee-pending union variant), fixed with an explicit fee-pending return. One was pre-existing in
  `booking-payment-decision.ts:466` (from 7f308830, `proposal` possibly undefined although the same line's outcome check
  guarantees it), fixed with a non-null assertion (type-only). The compiler was **not re-run**, per the one-run rule, so a
  verified zero-error pass is still outstanding. Fixes committed after the run; the affected suites pass after them
  (CP6 + cancellation + support: 205; payment decision / partial acceptance: 70 + the pre-existing projection failure).

## Risks and limits

- No fee-pending deferred drop (single-day has one): a dated drop waits until the actual card fee is verified (normally seconds
  after capture). `shortcut:` none in code; if pilots hit it, add the deferred reservation.
- Sent-day reversal is built and tested but should not normally happen for a future day (installments pay after each day).
- Chef/kitchen UI (day pickers, quotes), per-day receipts/credit notes, revenue/CSV per-day refund lines and calendar updates are
  CP8/CP9. Documents are reissued on refund reconciliation as today.
- Extra time and WP-RS changes stay gated; a captured change charge makes day cancellation support-only until CP7.
- The parent's first-day projection (`booking_date`/`start_time`) stays on the original first day after it is dropped (the
  frozen deadline anchor); occupancy, reminders and codes read the active visits.
- No push, deploy, migration application, Stripe, Vercel or Inngest action was performed.

## Fix round (Oct 17, 2026)

Addresses the independent CP6 money review (which confirmed no single-day refund changed and the worked examples). Every
fix has a test that **fails on the previous code** (`e325ca75`): with the new tests kept and only the non-test source files
restored to `e325ca75`, all **23** new fix-round tests failed; with the fixes, all pass. Fixes committed as `00ab3116`.

**Ledger change (behind M1, M4, L1, L5).** Each allocation now keeps a list of refund records (`evidence.refunds`), and every
path sums them per funder (kitchen, Local Cooks service fee, absorbed card fee, goodwill counted against the part) instead of
treating an allocation as refunded once. Records are only appended, never rewritten. CP6 had not been used on dev (multi-day
creation is off), so no stored data is migrated.

| Item | Fix | Test |
|---|---|---|
| M1 | In kitchen mode a day selects every allocation with anything left and refunds the rest of its full share: kitchen = gross − card-fee share − already debited, Local Cooks returns the remaining service fee and absorbs the remaining card fee. An item the chef removed after the deadline is therefore topped up to its full price. | `dated-booking-cp6` › M1: the kitchen cancelling a day tops up an item the chef removed late… |
| M2 | `cancelKitchenCausedBooking` sends only a **confirmed** dated booking to the day engine. A request charged after it was declined or withdrawn goes through the existing whole-charge refund. For a per-day charge that refund passes `installmentReversals: []` (no day transfer can exist; it refuses if one does) and closes every installment as `noEntitlement`. | `dated-booking-cp6` › M2: a dated request charged after it was declined is refunded in full… |
| M3 | `reverseTransferAndRefund` uses a fresh Stripe key only when Stripe lists every earlier attempt of that operation as failed or canceled, and then the key is derived from the latest failed attempt (`{op}-refund-after-{refundId}`), so concurrent retries after the same failure share one key. Otherwise the original key is reused and Stripe returns the in-flight refund. This applies to single-day and day refunds alike (it is in the shared engine). | `stripe-refund-recovery` › M3 (single-day and day refund): the support retry reuses the original key…; only after Stripe shows the attempt failed… (4 tests) |
| M4 | `refundDatedDay` and `POST /manager/bookings/:id/days/:visitId/refund`: a kitchen-paid extra refund for one day, split over that day's allocations by their remaining kitchen share. It is never more than that share or what the charge has left, and no card or service fee comes back with it (the one-day kitchen-refund semantics). It goes through the same reservation, retry and reconcile path, plus a `refund_issued` notice. A later chef drop of that day counts it toward the policy refund (`max(0, policy − refunded)`, kitchen part first). | `dated-booking-cp6` › M4: the kitchen refunds more for one day…; M4: an extra refund counts toward a later drop… |
| L1 | Chef-policy refunds store their `percent × pool` numerator. A new drop rounds once over all chef-policy drops of the same charge (cumulative target minus the cents already refunded), with largest remainder within the drop. | `dated-booking-cp6` › L1 in both orders: 10657 + 10656 = 21313 |
| L2 | Support's "kitchen can't host" recovery checks the receipts under the day-refund key `kitchen-day-refund:{booking}:{key}:{source}`. | `booking-support` › L2 |
| L3 | On a dated booking, "kitchen can't host" is offered while any active day hasn't started; earlier used days, completed equipment and goodwill no longer remove it (it covers the remaining days only). | `booking-support` › L3 |
| L4 | `assignOutsideRefund` and the new support action `assign_outside_refund` (audited through `support_actions` plus payment history `outside_refund_assigned`). Support can debit one day's kitchen share (that day only; a paid day becomes recorded kitchen debt) or mark the refund Local Cooks-funded. Then the refund is reconciled, `refundsAllocated` accepts it and day payouts resume. The action is offered only while an unassigned refund holds the payouts. | `dated-booking-cp6` › L4 (both variants); `booking-support` › L4 |
| L5 | Unused Local Cooks goodwill (goodwill receipts minus goodwill already counted by earlier day operations) is counted toward the next day refund: Local Cooks' service-fee part first, then the absorbed fee, then the kitchen's part, never below $0 and never blocking a drop. The amount counted is saved on the operation. Policy register updated (lead decision). | `dated-booking-cp6` › L5 ($5 goodwill → $208.13; $300 goodwill → $0 then $126.26) |
| L6 | Day, item and extra-refund notices carry `noticeDay`. Delivery uses it for the chef/kitchen copy, the Local Cooks summary and the email facts. The Today board keeps a dated booking while a later active day remains and lists only current active days, each with its own date. Claims' recent bookings key on the latest active day that has ended (cancelled days excluded). Shared helpers are in `shared/dated-visits.ts`. | `booking-lifecycle-delivery` › CP6 L6; `dated-booking-cp6` › L6; `dated-booking-board` (4) |
| L7 | When a day refund's receipt is verified, each non-debt day reversal records `reversals[operation]` and `reversedCents` on that installment, once per operation; revenue already nets `reversedCents`. | `dated-booking-cp6` › L7 |

The routes' new SQL (Today board, claims) is covered through their shared helpers, not through a route-level test.

### Fix-round verification

- **Full server suite, once** (after `f624d70f`): 309 files, **4039 passed, 5 failed** (6 files), 1 expected fail, 18 skipped.
  Re-running those 6 files with `--no-file-parallelism`: **4 pass** (`booking-invitation-decision`, `chat-notices.module`,
  `kitchen-invitation-checkout`, `stripe-checkout-cancel`; these were load timeouts). The **2 pre-existing** failures remain:
  `booking-partial-acceptance-projection` and `stripe-webhook-contract > refuses live Stripe keys`, both confirmed failing on
  d25645d8 in the first round.
- Focused money suites before the commit: 24 files, 583 passed (`--no-file-parallelism`).
- **`npx tsc --noEmit -p tsconfig.json`, one foreground run: 1 error**, `client/src/components/admin/booking-support/action-form.ts`
  (the admin support form's per-action table had no entry for the new `assign_outside_refund`). Fixed by adding the entry, and
  the admin booking-support client tests pass (35). Per the one-run rule the compiler was **not re-run**, so the zero-error result is
  unverified. The fix adds one object entry and no other code.
- Known limit: the admin dialog has no refund/day/kitchen-share inputs for `assign_outside_refund` yet. Support can use it
  through the support action API; the form fields belong with the CP9 support UI (`shortcut:` comment in `action-form.ts`).
