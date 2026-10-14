# Build plan: polish from the live check of `a5c2eb41` (lead-authored 2026-10-14)

The live check on dev covered chef, manager and admin on bookings 123, 149, 152, 153 and the lists. All of these passed:
- list dates;
- declined state + "Find another time";
- private feedback, both sides + the admin flag;
- admin case view;
- a $10 goodwill refund (Stripe sandbox `re_3UQInrCvcNYAkDXN1zc427ie`, succeeded, kitchen debited $0);
- a $16 exception.

Fix these:

1. **Finished visit with no check-in** (153, both roles): the Visit card shows "No check-in recorded yet" and "Visit finished / No check-in yet". After the visit has ended, show one line: chef "No check-in was recorded for this visit."; manager "{chef} didn't check in. If they came, fix the visit record." (link opens the existing Fix-the-visit-record dialog).
2. **Feedback sheet** shows the privacy line twice (top and bottom). Keep the one above the button.
3. **Admin case view** (`client/src/components/admin/booking-support/*`, server `server/services/booking-support.ts`):
   a. The manager's name shows the literal "Kitchen manager". Resolve both parties with `getUserDisplayName` (`server/utils/user-display`) as the lifecycle emails do. Never fall back to an email or a role word; use "Name not set" muted if truly empty.
   b. The schedule line "Oct 14, 2026, 10:00 a.m. – Oct 14, 2026, 11:00 a.m." → "Wed, Oct 14, 2026 · 10:00–11:00 a.m." (same-day ranges collapse the date).
   c. The visit-code state "Waiting to be used" after the visit has ended → "Not used". The code was never consumed.
   d. Goodwill exception copy "This is above the $15.00 goodwill limit." → "Goodwill for this booking is limited to $25. $10.00 was already sent, so $15.00 is left. Record this $16.00 as an exception?". Compute it from the case's support actions and the preview.
   e. No success toast after an action. Show "Done. {action label}" for verified; the failure states already render.
   f. Reference fallback: the server prints "KB-153" for bookings without a `reference_code`, which looks like a real reference. Use "#153" consistently (same as the client fallback in `client/src/lib/booking-reference.ts`).
4. **Refunds the chef can see** (149 after $26 goodwill): the chef payment card says only "Part of your payment was refunded."
   - Payment card: show "Refunded $26.00" with the breakdown line "Local Cooks refund · $26.00" (goodwill, from the payment history the card already loads or the details payload; add a field server-side if missing).
   - Booking history: "Local Cooks refunded $26.00" (chef) / "Local Cooks sent {chef} a $26.00 refund (your payout is unchanged)" (manager). The history projection lives in `shared/booking-history.ts`, plus the server event kinds (`support_updated`, payment history `support_goodwill_verified`).
   - The manager payment card must state the payout is unchanged.
5. **Overnight slots in the chef list** (139: operating window 06:00, slot 00:15–01:15) are labelled with the operating day (Wed Oct 14) although the instant is Thu Oct 15. Label lists and the details header with the calendar date of the slot start (`calendarDateForBookingTime`), the same instant the upcoming/past split already uses.

Scope: client + `shared/` + `server/services/booking-support.ts` and the minimal server code needed for item 4 (the payload field / history events). No migrations. Another agent is building payout-after-closeout in `server/services/stripe-transfer-service.ts`, `server/routes/webhooks.ts`, `server/services/clock-closeout.ts`, `stripe-service.ts`, and manager revenue pages; don't touch those.

Tests:
- update and add focused tests;
- `npx tsc --noEmit`;
- the touched suites + `client/src/i18n/locales.test.ts`;
- i18n in all three locales.

Known pre-existing failures: server 50 tests in 15 files (baseline list `.phase0-harness/head-server-fails.txt`); client 12 files (BookingCancellationChooser, BookingPreparation, tour*, KitchenHero, ManagerGettingStarted, locales ICU, cancellation-policy-dialog).

Output: `.phase0-harness/live-check-polish-checkpoint.md`.
