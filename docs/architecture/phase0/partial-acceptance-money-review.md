# Partial acceptance — independent money review (Oct 17)

Scope: `git diff 8e680446 abd68661` (branch `t3/partial-acceptance-proposal`, commits 338e33fa, 78cf3a5a, abd68661).
Review was read-only, done by reading the code: no tests, tsc, Stripe or DB. Line numbers are from `abd68661`.

## Ranked findings

### 1. MEDIUM — The chef's answer window can run past the refund deadline (owner rule broken)
`server/services/booking-response-deadline.ts:25-29` (`getPartialAcceptanceWindow`) reuses `resolveResponseDeadline` with
`createdAt = now`. Inside it, `freeCancelResponseCap` (`shared/booking-response-deadline.ts:12-20`) **drops the cap
completely** when "1 h before the refund deadline" is less than 30 min from now. The window then falls back to 24 h /
start − buffer, and the 3 h guard passes.

Scenario: 24 h free cancellation, first start = now + 25 h 20 m. The kitchen is still inside its own (capped) window
(created earlier). Cap = start − 25 h = now + 20 m, which is under 30 min, so the cap is null. Deadline = min(now + 24 h,
start − 1 h) = now + 24 h, and `allowed = true`. The chef can accept about 22 h after free cancellation ended and is charged
with no free-cancel window. The owner rule gives min(24 h, refund − 1 h) = 20 min here, which is under 3 h, so the server
should refuse the proposal. The same happens for every request made inside the "near deadline" band (cap null from
creation): every proposal gets a full 24 h.

Minimal fix: in `getPartialAcceptanceWindow`, apply the cap with no 30-min floor and let the 3 h guard decide:
```ts
const fc = bookingFreeCancelHours(booking), start = bookingFirstStart(booking, zone);
const capped = fc && fc > 0 ? new Date(Math.min(deadline.getTime(), start.getTime() - (fc + 1) * 3_600_000)) : deadline;
return { deadline: capped, allowed: partialAcceptanceAllowed(capped, start, now) };
```
Add the 25 h 20 m boundary case to `partial-acceptance.test.ts`. The dialog mirror (`partialAcceptanceAvailable`) uses the
same function, so it follows automatically.

### 2. MEDIUM (likely; check with a dated fixture) — Dated bookings: the kitchen's "New total" is not what the chef is offered
`client/src/components/manager/bookings/BookingActionDialog.tsx:407-449` builds the total as `booking.totalPrice +
equipment`. For a dated booking, `kitchen_bookings.total_price` is already the **full** subtotal including equipment (the
server requires `Number(booking.totalPrice) === m.subtotalCents`, `booking-payment-decision.ts:144`). So the dialog counts
equipment twice. It also uses the kitchen's **current** `taxRatePercent` instead of the frozen rate.

Example: 2 days × $100 kitchen + 2 × $10 equipment, 15 % HST, $11 fee, hold $264.00. Declining one day's item: the dialog
footer says "New total $275.04" (more than the hold), but the server's `newTotalCents` and the chef's offer are $252.00. The
captured money is right (the server recomputes it). What the kitchen is shown is wrong, which is exactly the
"Accept without …" moment. (Full-accept "Charge" on dated was already off before this change.)

Minimal fix: for `scheduleRevision > 0`, pass `totalPrice` minus the sum of the equipment rows (kitchen-only) into
`BookingForAction`, and use the frozen tax rate (`paymentTransaction.metadata.taxRatePercent` / manifest). A better option:
have the manager details GET return the server preview `approvedBookingCapture(...)` and show that. Add a dated
dialog test.

### 3. LOW — "Hold ended at Stripe" is announced as "the chef didn't answer in time"
`booking-payment-decision.ts:311-313` closes the request with `proposalOutcome: 'expired'` when the chef (or support)
accepts after Stripe dropped the authorization. `reconcileBookingDecision` (≈ :429-436) then sends "The chef didn't answer
the new total in time" to chef, kitchen and admin, even though the chef did answer. The chef's 409 text is correct.
Fix: use a separate outcome (e.g. `'closed'` → the generic request-outcome copy), or a `holdEnded` variant.

### 4. LOW — Support "Accept the new total for the chef": a business refusal is recorded as `recovery_required`
`booking-support.ts:591-594`: any throw from `answerPartialAcceptance` sets the action to `recovery_required`, with "Local
Cooks needs to verify this original payment operation". That includes the hold-ended path, which already released the hold
and then throws a conflict, and also CLOSED/PASSED conflicts. On replay, the verify branch (:557-561) sees a cancelled
decision with a canceled intent, marks it verified, then dispatches again and throws again. No money risk, but the case
shows a false recovery. This is the same pre-existing pattern as `confirm_for_manager` + `BookingRequestExpired`.
Fix: treat `PartialAcceptanceConflict` as `failed`.

### 5. LOW — The internal support note goes to the chef and kitchen in the booking JSON
`answered(..., supportReason)` stores `"{reasonCode}: {note}"` (plus `answeredBy`/`actorId` user ids) on
`kitchen_bookings.partial_acceptance`. Chef and kitchen booking reads spread the row (`chefBookingInstructions(booking)`,
manager details), so the note goes over the wire even though the UI doesn't show it. Fix: strip `supportReason`,
`answeredBy` and `actorId` in those responses, or keep the note only on the support action row.

### 6. LOW — Replacement without a pre-recorded withdrawal is labelled "New total declined"
`booking-replacement.ts:132` calls `decideAuthorizedBooking(old, 'cancelled', …, chefId, …, { replacedBy })` with no
`proposalOutcome`. For a waiting proposal, the outcome is inferred as `'declined'` (actor = chef), and the
`answeredProposal` branch replaces the "Request replaced" notices. This only happens when `recordReplacementWithdrawal`
didn't already record `closed` (the normal path does). Fix: pass `proposalOutcome: 'closed'` there.

### Info (not defects)
- The chef's own "withdraw request" (`PUT /chef/bookings/:id/cancel`) while an offer is waiting is recorded as `declined`
  and announced as "New total declined". Defensible; copy only.
- The service fee on a partial capture is the frozen fee scaled half-up (`approvedBookingCapture`), not a re-run of the
  checkout fee rate. This can differ from a fresh checkout of the smaller cart by at most 1¢. It was already like this
  before (Oct 15 single-day), and the chef approves the exact amount that is then captured, so the two stay consistent.

## Per area

1. **Full accept / full decline unchanged — no defects.** `proposing` needs `target==='confirmed'`, no decision, and at
   least one `cancelled` equipment action on a row that is not already cancelled (`declinedIds`). Without one, the old code
   path runs unchanged: same deadline check, plan, capture, metadata and notices. The `proposal` field and the
   `partialAcceptance` write are added only when a proposal exists. Dated full accept keeps the full-capture assertion
   (`rejectedCents === 0`). The dated item-action relaxation only lifts the equipment restriction (storage is still
   refused). Support decline/release now passes `proposalOutcome:'closed'`, which is only read when a proposal is open.
2. **Capture amount — correct.** On accept, the server re-reads the Stripe session and intent, re-checks item prices
   against the checkout metadata, recomputes subtotal − declined, then tax and fee via `approvedBookingCapture`, and refuses
   unless the amount equals the saved `newTotalCents` and the plan is identical (:186-188, :242). The capture uses
   `amount_to_capture` with the idempotency key `booking-decision:{id}`, and the rest is released by Stripe. Single-day
   allocations exclude declined rows. On dated bookings, `datedDeclinedEquipmentIds` is written in the same transaction
   before capture. `datedSourceComponents`/`acceptedDatedTotals` reproduce the same arithmetic, and
   `writeDatedCaptureAllocations` requires the exact captured cents. Payout `managerRevenue` = approved subtotal + tax.
   Display issue only: see #2.
3. **Races / idempotency — no defects found.** Every outcome is written under `FOR UPDATE` and the `updatedAt` check, and
   whoever records the decision first wins. Losers get `ANSWERED`/"Booking changed" and never reach Stripe with a second
   decision. A retried accept, the recovery worker (`decideAuthorizedBooking(id, target)` with no proposalId) and support
   replays all reconcile the recorded decision under the same idempotency key. Kitchen re-propose or full accept while an
   offer is waiting → `WAITING` 409. A proposal racing the kitchen's own deadline is refused in the transaction
   (`BookingRequestExpired`). A legacy `payment_intent.canceled` webhook only touches rows with no decision, and
   `waitingPartialAcceptance` then returns null (status not pending). Capture failure after accept: the decision stays
   `pending`, a recovery task is queued once, and `hold_canceled`/`amount_mismatch` dead ends work as before.
4. **Deadline / guard — one defect (#1).** The 3 h check and the "not after first start" check run on the server (409) and
   use absolute instants (DST-safe, a true 24 h). Dated bookings measure from `policy.sessions[0].startAt` and the snapshot
   `noticeHours`. The deadline text uses the kitchen zone with `longGeneric`.
5. **Notices — exactly once, rule respected.** Proposed → chef only (`recipientPolicy:'chef'`). Declined/expired → one
   `cancelled` event: per-role chef/kitchen copy and the admin line through the existing delivery (all admins in-app, email
   only with the toggle on). `sendAuthExpiryNotification` is not sent for proposal expiry. Timer + sweep + lazy read can't
   send twice (the second finds the decision complete or the status cancelled). Kitchen withdraw / support close →
   existing request-outcome notices. Copy issues: #3, #6.
6. **Stuck "waiting for the chef" — none found.** The sweep scans every `pending/authorized` row (not created-at filtered).
   The exact Inngest timer is deduped per due instant, the kitchen's original timer does nothing before the chef's
   deadline, and reads lazy-expire. Late accept triggers a lazy expiry before refusing. A Stripe-ended hold is closed on the
   chef's answer or on the deadline expiry (cancel with intent `canceled` is allowed). Kitchen reminders stop
   (`manager-decision-reminders.ts:22`).

Not checked: runtime behaviour (no tests run), the client list endpoint actually returning `partial_acceptance` for the
"Waiting for the chef" pill, the fr-CA/uk copy, and the PGlite race tests' fidelity to real Postgres locking.
