# Build plan: cancellation policy engine (lead-authored 2026-10-14)

Design source: `design-modular-cancellation-policy.md` (read §§1–6; §7's open questions are answered below). Owner policy, locked earlier (PHASE0_LOG): D5/D6, R1–R5, and "Kitchen cancel pilot CONFIRMED".

## Owner decisions (Oct 14) + lead research
1. **Short-notice bookings inside the no-refund window:** ALLOW. Warn before payment: "This booking starts within {hours} hours. Once the kitchen confirms, it can't be cancelled for a refund. You can withdraw free while the request is pending."
2. **Policy model (owner, Oct 14 — FINAL): Food Corridor style.** Research: The Food Corridor lets each kitchen set ONE rule — a cancellation period in hours (24/72 typical) and a late-cancellation fee as % of the booked time (or flat; we use % only), shown on the calendar and warned before confirming a cancellation ([TFC help](https://help.thefoodcorridor.com/en/articles/1413947-what-is-a-cancellation-policy-and-how-does-it-work), [hourly vs monthly](https://help.thefoodcorridor.com/en/articles/1413970-if-i-have-to-cancel-a-shift-do-i-still-have-to-pay-for-those-hours)); real shared kitchens use "48 h notice or full price" / "50% inside 24–48 h".
   - A kitchen chooses exactly two things: **notice period** ∈ {24, 48, 72} hours and **late-cancellation charge** ∈ {50%, 100%} of the kitchen time (and its linked add-ons). Default for new/migrated kitchens: 24 h, 100%.
   - Engine tiers derived: `[{minHoursBeforeStart: notice, refundPercent: 100}, {minHoursBeforeStart: 0, refundPercent: 100 - charge}]`. Keep the generic tier engine internally (future-proof) but expose ONLY these two knobs.
   - Chef-facing sentence (one line everywhere): "Cancel by Thu, Oct 15, 4:00 p.m. for a full refund minus the $1.18 card processing fee. After that, you're charged {50%|the full price} of the kitchen time." (100% → "no refund").
   - **Admin controls** (Platform settings → Cancellation): allowed notice options, allowed charge options, default; per-kitchen override by admin with reason (audited).
3. **Add-ons:** cancelling kitchen time cancels the unstarted equipment/storage tied to that session at the same refund % (existing `cancelLinkedBookingDates`). Storage already in use is NOT refunded by the engine; support handles it. Note recorded for the storage redesign (bottom).
4. **No grace period.** (Peerspace's post-confirmation grace was researched and deliberately not adopted: TFC/shared kitchens don't use it and it adds a second rule to explain. Support can still make exceptions.)
5. **Policy is frozen per booking** (Airbnb: a policy change never affects existing reservations, [Airbnb](https://airbnb.com/help/article/3874)). Snapshot at checkout. Editing a kitchen's policy affects only new checkouts.
6. **Money rules (locked):**
   - Before confirmation, withdrawing releases the hold.
   - After confirmation, a chef cancellation inside a refund tier refunds the tier % of the captured amount minus the actual Stripe processing fee (D5; disclosed before payment and shown in dollars before cancelling). Never say "free" or "100% back" for a captured payment. Say "full refund minus the $X card processing fee".
   - Kitchen-caused cancellation (and R2: kitchen unusable): 100% including the fee; Local Cooks absorbs the fee in the pilot.
   - No-show = cancellation at start (0% tier).
   - Support exceptional circumstances (R4): Local Cooks-funded, via the existing support desk.
   - **Actual fee source:** the Stripe charge balance transaction `fee_details` type `stripe_fee`. If unavailable, hold the quote with a support state; never estimate.
7. **Deferred payout interplay:** a refund before release reduces the kitchen's unpaid entitlement (existing pre-payout branch). For a chef cancellation with a retained kitchen share, release that share at the scheduled end + service grace (already implemented in the payout sweep). After release, the existing reversal paths apply.

## What exists today (verify; reuse)
- `kitchen_bookings.cancellation_policy_hours` (single cutoff);
- `BookingCancellationChooser`;
- chef "request cancellation" → manager accept/decline (`booking-cancellation-refund.ts`, quote hash);
- `shared/cancellation-refund.ts`;
- the cutoff block in `bookings.ts` (~2229, "cannot be cancelled within {hours} hours").

The engine REPLACES the request/approve step for in-policy refunds with **self-serve instant cancellation** (D5). The manager keeps: cancelling as the kitchen (kitchen-caused, 100%) and an optional extra goodwill refund on a cancelled booking (capped at captured − fee; funded from the kitchen's share).

## Data (migration `0080_cancellation_policies.sql`; do NOT apply)
- `kitchen_cancellation_policies`:
  - `id`, `kitchen_id`, `version`, `status` (draft|published|retired), `notice_hours`, `late_charge_percent`, derived `tiers` jsonb, `published_at`, `published_by`, `admin_override_reason`;
  - append-only once published.
- `kitchen_bookings.cancellation_policy_snapshot` jsonb, holding:
  - `{policyId, version, noticeHours, lateChargePercent, tiers, timezone, sessions: [{startAt}], disclosureVersion, acceptedAt}`;
  - set at checkout fulfillment from the Checkout metadata, never re-read later.
- `platform_settings` keys (existing kv): `cancellation_notice_options` ([24,48,72]), `cancellation_charge_options` ([50,100]), `cancellation_default` ({notice:24, charge:100}).
- Legacy bookings without a snapshot: derive `[cancellation_policy_hours → 100%, 0 → 0%]` with no grace, and label it "your booking's original terms".

## Pure engine `shared/cancellation-policy.ts` (heavily tested)
- `quoteCancellation(snapshot, {cancelAt, confirmedAt, capturedCents, processingFeeCents, components, startedComponents, cause})` → `{tier, refundPercent, chefRefundCents, feeRetainedCents, kitchenShareRetainedCents, platformShareRetainedCents, perComponent[], reasonCode, explanation keys}`.
- Boundaries per the design: an exact threshold belongs to the more generous tier.
- `cause`: `chef | kitchen | no_show | support_exception`.
- Edge cases to test:
  - DST day;
  - multi-session bookings (each session's own start; already-started sessions not refundable);
  - booking inside the window at checkout;
  - exactly at the notice threshold (belongs to the refund side);
  - cancellation after the start → no-show treatment;
  - partial earlier refunds/goodwill (never refund above captured − already refunded);
  - 0% service fee omits fee lines;
  - add-ons cancelled together;
  - used storage excluded;
  - a policy changed after booking keeps the snapshot;
  - legacy booking without a snapshot.

## Server
1. **Checkout:** include the policy snapshot in the Checkout metadata/quote (size-safe: policy id + version + notice + charge); persist it at fulfillment; reject checkout if the kitchen has no published policy (migrate: auto-publish v1 for existing kitchens: notice = nearest of 24/48/72 to existing `cancellation_policy_hours` (default 24), charge = 100%; log each mapping in the checkpoint).
2. **`GET /api/bookings/:id/cancellation-quote`** returns the exact dollars. `POST /api/bookings/:id/cancel` (chef) is idempotent with an operationKey: confirmed → self-serve refund now (existing refund + linked add-on cancellation + code revocation + pre-release entitlement); pending → release the hold (existing).
3. **Manager:** `POST /api/manager/bookings/:id/cancel` (kitchen-caused, 100%, a reason required, chef notified with an apology, kitchen cancellation tracked); an optional extra refund on a cancelled booking (existing manager refund route, capped).
4. Remove the 400 "cannot be cancelled within {hours} hours" block; inside 0% the chef can still cancel (no refund) so the kitchen gets its slot back.
5. **Notices** (outbox, notice shell): chef "You cancelled… refund $X (card processing fee $Y kept)" / "no refund under {kitchen}'s policy"; manager "{chef} cancelled; your payout for this booking is $Z".
6. **Admin:** platform settings + per-kitchen override endpoints (audited in `support_actions`, or an admin audit that already exists).

## Client
- **Manager** (kitchen settings → Cancellation policy):
  - two simple selects ("Chefs can cancel for a refund up to [24/48/72] hours before"; "If they cancel later, they pay [50% / the full price]") with a live preview of the sentence chefs will see;
  - "applies to new bookings only";
  - shows the admin override when set.
- **Listing / booking flow:**
  - a one-line summary + "Cancellation policy" detail;
  - at checkout (confirm step), exact local deadlines: "Full refund (minus the card processing fee) until Thu, Oct 15, 4:00 p.m.";
  - the short-notice warning;
  - a required acknowledgement checkbox next to Pay (card-network requirement in the design §1).
- **Chef booking page:**
  - the cancellation card shows the current tier and the next deadline ("Full refund minus $1.18 processing fee until Oct 15, 4:00 p.m., then 50%…");
  - "Cancel booking" opens a sheet with the exact refund, what's kept and why, add-ons included, and one "Cancel booking" button;
  - success state + email.
- **Manager booking page:** cancelled state shows the payout effect. "Cancel as the kitchen" lives in the ⋯ menu with a consequence line ("TestSprite chef gets a full refund. Cancelling often affects your listing.").
- **Admin:** Platform settings → Cancellation; kitchen override in the kitchen admin view; the support case shows the frozen snapshot.
- All copy in en-CA, fr-CA, uk; warm, specific, never "free" for captured money.

## Tests
- The pure engine (all the edge cases above).
- Routes: quote/cancel idempotency, the self-serve path with no manager approval, kitchen-caused 100%, legacy fallback, the snapshot frozen after a policy edit.
- Payout interplay: entitlement reduced pre-release; retained share released.
- Client: policy picker, checkout disclosure + ack, cancel sheet.
- Full suites vs baseline (`.phase0-harness/head-server-fails.txt`; known client failing files).

## Storage note (owner, Oct 14)
Storage will be redesigned separately (monthly per-unit, daily holdover, "Manage my storage"). The engine must only cancel UNSTARTED storage tied to the session and leave started storage to support. Record any storage-specific edge cases in the checkpoint for the storage design.

Output: `.phase0-harness/cancellation-engine-checkpoint.md` (files, behaviour, tests vs baseline, gaps, a migration note).
