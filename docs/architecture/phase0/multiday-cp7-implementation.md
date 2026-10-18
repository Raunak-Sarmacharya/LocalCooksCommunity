# CP7: whole-booking change requests for dated bookings (Oct 17, 2026)

Built against the owner spec row 9 and "Consistency with single-day bookings", build plan §5 and §8 CP7, and the CP2–CP6/CP8
reports, on `development` cd58b19b (CP1–CP6 + CP8 merged). Multi-day creation stays off; a dated booking that already exists
can still change (the change path passes CP3's `authorizedContract`, so the creation gate does not block it, while the kitchen's
switch and days-per-booking limit still apply). **No migration**: the change reuses `kitchen_booking_changes` JSON columns and
the 0099 ledger columns. CP8 left the chef's "Change booking" on a dated booking opening the one-day dialog, which the server
refused with "message the kitchen" (multi-visit guard); that guard now applies only to legacy one-day rows.

## Contract

- `ChangeSchedule` keeps its one-date shape for legacy rows. New versioned variant `{ version: 'days-v1', days: [{ date,
  pricingMode, slots, windowStart, equipmentIds }] }` (`shared/kitchen-booking-change.ts`, `isDatedChangeSchedule`,
  `changeScheduleDays`). The route accepts either; a dated booking only takes the day set, a legacy booking only the one date.
- The engine (`kitchen-booking-changes.ts`) keeps its state machine, card hold, capture/refund-then-apply, recovery, expiry,
  webhooks and notices. It dispatches to `server/services/dated-booking-changes.ts` when `booking.scheduleRevision > 0`, and
  marks the change `policy.dated = true`. Single-day code paths are unchanged (the full existing suite passes).

## Rules (same as single-day, measured on the day set)

- Eligibility: confirmed, no linked storage, no day started (no check-in on any active day), one open change, and before the
  **one refund deadline** = notice before the first saved session (CP6's basis; a dropped first day keeps its place). The kitchen's
  answer window is the existing rule from that start.
- Destination: CP3 `validateBookingDays` — kitchen switch/days-per-booking cap, first +14 span, notice, advance window (request
  time), hours/occupancy/buffer (the booking's saved buffer), longest/shortest hourly length, equipment ownership, weekly hours.
  It excludes the booking's own days and its own hold group (`excludeBookingId`, `excludeHoldId` = the change's hold id), under
  the CP3 lock order (kitchen, sorted days, sorted equipment). Approval re-checks the same without notice/advance window, and
  requires the whole hold group to still be present. Per-date failure reasons are the server's own words (as at checkout).
- New start must be after the kitchen's answer deadline (`tooSoon`), as single-day.

## Money flow

- **Quote.** Old total = the current active parts of every captured per-day source (subtotal + tax + service fee as paid).
  New total = CP4 `priceBookingDays` at today's rates (each day hourly × hours or daily, each item per day), HST rounded once on
  the aggregate with the kitchen's tax rate, service fee once via `calculateCheckoutFeesAsync`. Day-by-day increases and decreases
  net out; only a split moving both ways (a rate *setting* changed) or a price-up with no subtotal increase needs Local Cooks
  (`pricingReview`). The full priced day list is frozen in the quote (`datedDays`) and hashed (`datedChangeFingerprint`).
- **Positive difference** (e.g. plan C + Wed Mixer + Fri 2 h + Sat: $744.20 vs $658.80): only the difference ($85.40) is held on
  the saved card at request (manual capture) and captured on approval, exactly as single-day. The capture is a separate
  `per_day` source; at apply its `dayComponents` manifest splits its subtotal over the new days' components by their new subtotals
  (`allocateCents`), and CP5 `syncDayPayoutSource` allocates tax, service fee and its own verified card fee with CP4
  `allocateDatedCapture` (tested: 7000 / 1050 / 490 / 278 conserved; both sources together = $744.20).
- **Negative difference** (e.g. Tue 4 h + Thu full day: $329.40): refund = difference − its card-fee share
  (`round(actualFee × difference / captured)`, the single-day formula): $329.40 − $9.71 = **$319.69**; Local Cooks returns the service
  fee that goes away ($18.90), the kitchen is debited the rest ($300.79). Newest source first, as single-day. The provider call is
  the engine's existing refund with `installmentReversals: []` (a per-day source never discovers or prorates a source transfer;
  no day can have been paid because a sent/in-flight installment makes the change support-only). Funding verification against a
  source transfer is skipped for per-day sources for the same reason.
- **Equal**: nothing moves; approval applies at once.

## Apply (one transaction, after money where money moves)

1. Old active days → `schedule_state='superseded'`, their codes revoked (`revokeForVisit`), their equipment rows cancelled.
   Cancelled days stay cancelled with their refund evidence.
2. Parent: `schedule_revision + 1`, first-day projection (date/times/mode/rate), totals, dated `selected_slots`, and
   `cancellation_policy_snapshot.sessions` replaced by the new days' starts — the only snapshot field that changes, as 0098
   permits — so the one refund deadline moves with the new first day exactly as a single-day change moves it.
3. CP2 `ensureKitchenBookingVisits` builds the new revision (new block indexes, per-day price snapshots); per-day equipment rows
   are inserted (paid, linked to their day); `ensureChallengesForBooking` enrolls new codes; a fresh saved closeout clock is
   written, then the existing closeout persistence, reminders and notices run.
4. **Ledger move** (per source): the active parts' subtotal, tax, service fee and actual card fee move to the new day components
   by new subtotals (CP4 allocation helpers, so each source conserves exactly: Σ paid = captured, Σ card fee = actual fee). Moved rows
   keep their cents and get `evidence.supersededBy = { changeId, allocationRevision }`; new rows carry `movedFrom`, charge and
   balance-transaction evidence. A negative change's refunded part becomes one fully settled `change-refund:<changeId>` row
   (subtotal/tax by the moved split, service fee = platform return, card fee = the kept fee share, `managerDebitedCents` = kitchen
   debit, entitlement 0) with a no-entitlement installment; its refund id is recorded in `allocatedChangeRefunds` so CP5 treats
   the receipt as allocated. Old installments end with `noEntitlement` and `supersededBy`; CP5 creates installments for the new rows.
   Settled parts (dropped days, removed items, earlier change refunds) are never moved, re-priced or refunded again.

Support-only (code `datedChangeSupport`): any installment already sent or frozen for sending, a refund not assigned to a day, an
active part with a partial refund (e.g. a kitchen's extra refund), a cancelled part that still carries a kitchen share, a ledger
that does not add up to the captured cents/fee, or a non-per-day payment. Pending card fee → `feeNotKnown` (transient).

## Recovery

- Capture-then-apply and refund-then-apply keep the existing `recovery_required` state, admin recovery screen and actions. Finish
  re-validates the day group and applies without a second charge/refund (tested). Compensate refunds a change charge with
  `installmentReversals: []` (never allocated before apply). **Keep refund** on a dated booking records the refund as a Local
  Cooks-funded outside refund on the source, so CP5 resumes day payouts (tested; the kitchen's share is not reduced).
- CP4/CP5 readers tolerate a moved ledger: a late capture/charge event no longer re-runs the frozen checkout manifest once parts
  were moved; supplemental sync skips moved sources and waits (no error) for a change charge whose change has not applied yet
  (a missing change still refuses); payout notices' remaining net excludes moved rows.
- CP6 after a change: its live ledger = current days plus settled parts of earlier schedules; the engine prices only the current
  days' own paid cents and fee shares (identical to the source before any change). Tested: dropping Thursday after the negative
  change quotes **$213.13** (21960 − 647) with the deadline moved to Mon Nov 2 09:00.

## UI

- Chef: "Change booking" on a dated booking opens `DatedChangeEditor` inside the existing dialog — the CP8 calendar
  (`UICalendar mode="multiple"`, `DatedCalendarDay`, the same class names and reason copy, now shared in `booking-calendar.ts`),
  the booking's own days pre-selected and excluded from availability (`changing=`), and per day Full day / Hourly (start + length
  from that day's free hours) and that day's equipment. The existing preview block shows old/new totals, the exact amount to pay or
  get back, the card-fee line and the moved deadline; Send posts exactly the previewed day set.
- Kitchen (booking page "Now" row) and admin recovery list every old and new day ("Mon, Nov 2 · 9:00 a.m.–5:00 p.m.; Wed …").
- Notices: the kitchen's request notice and the admin "booking changed" line name all old and all new days; approved/declined
  copy is the existing single-day copy with every day listed. No single-event calendar update rides on a dated approval (each day
  has its own event from the booking page download).

## Tests

- `server/services/dated-booking-cp7.test.ts` (PGlite, **10 tests**; executes the actual 0099 ledger DDL, 0102, and the 0098
  trigger): eligibility before/at the deadline; span +14 ok / +15 refused, days-per-booking cap, kitchen switch off, a booked day
  with its own message, own-booking exclusion and advance window, unchanged request refused; one open change; support-only after a
  paid installment; equal-price mixed-mode move (new visits/blocks/modes, codes revoked/enrolled, sessions-only snapshot change,
  ledger 18000/2700/1260/647 per day, old installments no entitlement, superseded installment never releases, 0098 still refuses
  a terms edit, notices); negative mixed-mode $319.69 with `installmentReversals: []`, settled refund part, conservation and the
  CP6 quote after the change; positive mixed-mode with equipment ($85.40 held → captured once, charge split 2066/2066/287/516/2065,
  CP5 allocation); settled add-on kept and never refunded again; decline/expiry/withdraw leave the original intact and release the
  group and card hold; capture-then-apply failure + finish; refund-then-apply failure + keep-refund and + finish.
- Client: `KitchenBookingChanges.test.tsx` +2 (kitchen row lists old/new days; dated dialog loads the picker with `changing`,
  prices an equipment edit as `days-v1` and sends the previewed request).

## Verification

(See final section below; filled after the runs.)

## Risks and limits

- **Day drops after a positive change stay support-only**: CP6 refunds only the original charge and still refuses when a captured
  change charge exists ("Contact Local Cooks to cancel days"). Multi-source day refunds are not built here.
- A CP6 partial day drop while a change is open does not close the change; approval then refuses ("The booking changed since this
  request was sent") and it closes on decline or expiry (card hold released then). Whole-booking cancellation still withdraws it.
- Self check-in mode is not carried to the moved days: new codes enroll staffed; the kitchen can turn self check-in on again in one
  action.
- Mixed-sign kitchen/tax/fee deltas (only when a kitchen's rates or the fee setting changed since booking) go to Local Cooks.
- No dated receipt line for the original schedule (`originalBookingSchedule` stays single-day); per-day receipts are CP9.
- Real-PostgreSQL parity and live Stripe sandbox acceptance remain CP11/lead work. No push, deploy, migration, Stripe, Vercel or
  Inngest action was performed.

## Files

New: `server/services/dated-booking-changes.ts`, `server/services/dated-booking-cp7.test.ts`,
`client/src/components/booking/DatedChangeEditor.tsx`, `client/src/components/booking/booking-calendar.ts`, this report.
Changed: `shared/kitchen-booking-change.ts`, `server/services/kitchen-booking-changes.ts`, `kitchen-booking-change-notice.ts`,
`server/routes/kitchen-booking-changes.ts`, `kitchen-day-payouts.ts` (`refundsAllocated`, notice remaining net),
`kitchen-day-payout-sources.ts`, `dated-booking-allocations.ts`, `dated-booking-cancellation.ts` (live ledger / engine inputs),
`client/src/components/booking/KitchenBookingChanges.tsx` (+ test), `KitchenBookingFlow.tsx` (imports the shared calendar
constants), `client/src/components/admin/booking-support/KitchenChangeRecovery.tsx`, `shared/i18n/locales/{en-CA,fr-CA,uk}/booking.json`,
`docs/architecture/phase0/policy-facts-booking.md`.
