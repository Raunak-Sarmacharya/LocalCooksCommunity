# Build plan: session extensions + extra-time charges (lead-authored 2026-10-14)

## Research basis
- **The Food Corridor** (kitchen platform): a renter can increase the length of an ongoing booking. Under the kitchen's auto-approval it's applied directly; under manual approval the kitchen approves or declines. Overage is billed from sign-out hours. ([TFC: edit bookings](https://help.thefoodcorridor.com/en/articles/1524649-can-a-food-business-edit-their-bookings), [overage](https://help.thefoodcorridor.com/en/articles/12260410-how-does-overage-work))
- **Turo:** extensions only count when made in-app; they're auto-approved when the calendar allows, otherwise reviewed by the host; a host's informal OK in chat is not valid. ([Turo](https://help.turo.com/en_us/trip-extension-approvals-costs-and-mileage-guests-BkC6WX9Qfl.md))
- **Peerspace:** a host can propose more hours + a price, but the guest must approve; overtime is in 30-min blocks with a dispute window. ([Peerspace update booking](https://intercom.help/peerspace-108cf19aff8e/en/articles/10119465))
- **Shared kitchens:** they schedule tightly and ask renters to tell the manager if running over.

## Owner decisions (Oct 14)
1. **The chef asks for more time in one tap.** The kitchen approves by default (consistent with request-to-book and TFC manual approval). Each kitchen can turn on "Approve extensions automatically when the time is free" (default OFF).
2. **The kitchen can offer more time in one tap;** the chef accepts and pays in one tap.
3. **Overstay without an extension:** the kitchen sends an extra-time charge after the visit; the chef accepts and pays with one tap; unanswered after 48 h → Local Cooks support. No automatic card charges.

## Product
- **Chef, in session** (InSessionPanel "Need more time?"), from 60 min before the end until the end:
  - show the bookable options computed server-side: +30 min, +1 h, +2 h, limited by the next booking/blackout, the kitchen's operating hours, and the kitchen's max hours;
  - each option shows its new end time and price ("Until 4:30 p.m. · $28.75").
  - **Approval mode (default):** one tap places a card hold on the chef's saved card (the booking's `stripePaymentMethodId` / customer from checkout, which uses `setup_future_usage: off_session`). Confirm on-session (the chef is present; handle 3DS with the Stripe.js `handleNextAction` if required). The state shows "Waiting for {kitchen} · we'll let you know"; the inventory hold blocks that time.
    - The kitchen approves → capture → the booking end moves → the chef sees "You have until 4:30 p.m."
    - Declined, or no answer within 15 min, or the booking end passes → release the hold: "{kitchen} couldn't extend this time. Your card wasn't charged."
  - **Instant mode:** one tap charges immediately and the extension is confirmed.
  - If no time is free: "The kitchen is booked right after you. Message {kitchen}."
- **Kitchen request alert:**
  - in-app + email (notice shell; push-like urgency): "{chef} asked for 1 more hour (until 4:30 p.m.) · you'd get $27.32";
  - **Approve / Decline** buttons on the manager booking page (a sticky banner) and the dashboard;
  - the email CTA opens the booking (never approve via GET).
- **Kitchen offers time** (manager in-session booking page, "Offer more time"): pick +30/+60/+120 (same availability rules) → the chef gets an in-app + email offer, "{kitchen} offered you 30 more minutes (until 4:00 p.m.) · $14.38". Accept & pay (on-session, saved card) or decline. Expires at the booking end.
- **Extra-time charge after the visit** (manager, from the inspection page or booking page, within 24 h after the checkout/end):
  - "Charge for extra time": prefilled from the recorded checkout time vs the booked end, rounded up to 30-min blocks at the booking's hourly rate (manager can lower it, never raise above the computed amount);
  - a note to the chef (required).
  - Chef: in-app + email "You stayed 40 minutes past your booking at {kitchen}. They've asked for $14.38 for 30 extra minutes." → **Pay $14.38** (saved card, on-session) or "This isn't right" (→ Local Cooks support, with the case flagged).
  - Unanswered after 48 h → support case + reminder; no automatic charge.
- **Payout:** every extension/extra-time charge is its own Stripe charge (separate charges & transfers). Its kitchen share follows the parent booking's payout timing: deferred until closeout, released together; if the parent already released, release immediately. Platform commission rules are the same as the booking.
- **Refunds:** extra time can't be refunded once added (shown before paying). The support desk can still refund.
- **History/receipts:** booking history lines ("Extended until 4:30 p.m. · $28.75"); the final invoice includes extensions and extra-time charges; the manager payout statement includes them.

## Settings
- Kitchen settings → Bookings: a toggle "Approve extensions automatically when the time is free" (default off), with the helper "When off, you'll get a request to approve with one tap."
- Admin: per-kitchen view/override (reuse the cancellation admin override pattern); a platform-level kill switch for extensions.

## Server notes
- Reuse the storage-extension precedents (request → authorize → manager approve → capture), the kitchen inventory hold/conflict check (`kitchen-checkout-holds`), the money guard/flags, idempotency keys, the lifecycle outbox notices, and the payout engine (extend the gate so these charges follow the parent's `after_closeout` timing).
- Data: prefer a `kitchen_booking_extensions` table (`id`, `booking_id`, `kind` request|offer|extra_time, `minutes`, `amount_cents`, `status` requested|offered|approved|declined|expired|paid|cancelled|disputed, `payment_intent_id`, `requested_by`, `decided_by`, `expires_at`, `note`, timestamps). Migration `0081_session_extensions.sql` (write only; do NOT apply). Extending a booking updates its end time/slots through one function that also updates the closeout snapshot, reminders (session_ending/departure re-scheduled), and the cancellation snapshot sessions (the extended time is non-refundable).
- Worker: expire stale requests/offers (bounded, index-backed, early exit).

## Tests
- Availability options (next booking, operating hours, max hours, DST).
- Approval-mode hold → approve capture / decline release / expire release.
- Instant mode.
- Offer accept/decline/expire.
- Extra-time charge computation (30-min rounding, the manager may lower only), pay/dispute/48 h escalation.
- The payout follows the parent (deferred + already-released).
- Money guard/flag blocks.
- End-time propagation (closeout, reminders).
- Client panels and manager banner.
- Full suites vs baseline.

Output: `.phase0-harness/session-extensions-checkpoint.md`.
