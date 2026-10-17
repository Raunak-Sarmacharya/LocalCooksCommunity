# Partial acceptance: the chef approves the new total before any capture

Owner decision (Oct 17), spec `multiday-spec-2026-10-17.md` "Consistency with single-day bookings". Applies to single-day and
dated (multi-day) bookings. Airbnb special offer / Peerspace invite model: no capture happens before the chef agrees, so no
card fee is lost. **Migration 0102 is written and tested in PGlite but not applied anywhere.**

## Behaviour

- **Kitchen** (`BookingActionDialog.tsx`): declining any equipment item on a held request changes the primary action to
  "Accept without {items}" (each item named; dated items carry their day) with "We'll ask the chef to confirm the new total.
  Nothing is charged until they do." and "New total: $X" in the footer. Days stay all-or-nothing (the kitchen session is one
  toggle); dated equipment can be declined per day. Full accept and full decline keep today's wording and payload.
- **Last-minute guard**: if the chef would have < 3 h to answer, or the answer deadline would fall after the first booked start,
  the server refuses the proposal with a 409 ("This booking starts soon, so there isn't time to ask the chef about a change.
  Accept the full request, or decline it and message the chef.") and the dialog disables item declines with that line and a
  "Message the chef" link (`/manager/booking/{id}?action=message`, the existing chat). The manager details response carries
  `partialAcceptanceAvailable` so the dialog mirrors the server (`shared/partial-acceptance.ts#partialAcceptanceAllowed`).
- **Proposal** (`kitchen_bookings.partial_acceptance`, JSONB): id, state, intent, kitchen actor, proposed/deadline instants,
  full equipment plan, declined items (name, cents, day), old/new totals, answer (time, who, support note). The request stays
  `pending/authorized`; the hold, reserved days and equipment rows stay; no payment decision and no Stripe call. Deadline =
  the request rule measured from the proposal: 24 h, or 1 h before the refund deadline if sooner (start buffer and minimum
  rules reused from `resolveResponseDeadline`). Kitchen "respond by" reminders stop; an exact Inngest timer
  (`booking_request` kind) wakes at the deadline, with the worker sweep as backstop.
- **Chef** (in-app + email, per-reader en-CA/fr-CA/uk): "{kitchen} can host you, but can't provide {items}. New total $X (was
  $Y). Accept or decline by Wed, Oct 21, 9:00 p.m. Newfoundland Time. Nothing is charged until you accept. If you don't answer,
  the request closes and your card hold is released." Booking page card (`PartialAcceptanceCard.tsx`, mobile-first,
  house Button/toast): Accept $X / Decline (with an inline confirm). The kitchen sees "Waiting for the chef" (list pill, no
  action; booking page card with "Withdraw and decline the request").
- **Accept** → `POST /api/chef/bookings/:id/partial-acceptance {proposalId, answer}` → the existing decision engine with the
  proposal's exact plan: one immutable decision, partial capture of exactly the new total (Stripe releases the rest), item rows
  cancelled/failed, captured component allocations (single-day) or day allocations (dated) for accepted items only,
  confirmation/receipt as today (the existing "Not included" line names the items).
- **Decline / no answer / hold ended** → whole-hold release through the same engine; request closed; chef + kitchen get
  per-reader notices ("New total declined" / "Request closed"), Local Cooks gets its own factual admin line (all admins
  in-app; email only to admins with the toggle on — existing delivery rule). The kitchen withdrawing = declining the request
  (existing decline notices). The chef withdrawing the request or sending a change request closes the proposal too.
- **Support console**: proposal state, offer, chef deadline and support note in the Deadlines card; new action "Accept the new
  total for the chef" (acting for the chef, reason + note recorded on the proposal); closing uses the existing "Release the card
  hold" / "Decline for the kitchen". "Confirm for the kitchen" is hidden while the chef is answering.

## Race and replay safety

Every outcome is written in the same `FOR UPDATE` transaction that saves the single immutable payment decision, so chef accept
vs expiry vs kitchen withdraw vs chef withdraw vs support yields exactly one decision and one Stripe call (tested with
concurrent calls). Accept re-checks the proposal id, intent, deadline, the exact plan and that the recomputed capture equals
the saved new total. A retried accept, the recovery worker, duplicate capture/charge webhooks and checkout-session replays
finish the recorded decision without capturing again. If Stripe already released the hold (authorization lifetime), accepting
closes the request without charging, like today's pending requests. Late answers are refused and the hold is released.

Dated money (CP4): the frozen quote is unchanged. Declined equipment ids are saved on the source
(`datedDeclinedEquipmentIds`); the accepted totals use the same approved-share arithmetic as single-day
(`approvedBookingCapture`); allocation/evidence checks verify the exact smaller capture and exclude declined rows; the
checkout/evidence verifiers accept a capture ≤ the authorization (the exact amount is checked against the source).

## Files

New: `shared/partial-acceptance.ts`, `server/services/partial-acceptance-notice.ts`, `migrations/0102_partial_acceptance.sql`,
`client/src/components/booking/PartialAcceptanceCard.tsx`, tests `server/services/partial-acceptance.test.ts`,
`client/src/components/booking/PartialAcceptanceCard.test.tsx`.
Changed: `server/services/{booking-payment-decision,auth-expiry-service,booking-response-deadline,booking-lifecycle-delivery,
admin-booking-notice,booking-support,manager-decision-reminders,dated-booking-allocations,dated-booking-quote}.ts`,
`server/routes/{bookings,manager}.ts`, `shared/{schema,booking-response-deadline,booking-support}.ts`,
`client/src/components/manager/bookings/{BookingActionDialog,ManagerBookingsAgenda}.tsx`, `client/src/lib/booking-list-status.ts`,
`client/src/pages/{BookingDetailsPage,ManagerBookingsPanel}.tsx`, `client/src/components/admin/booking-support/{CaseView.tsx,
action-form.ts,types.ts}`, locales (booking/chef/manager/admin × en-CA/fr-CA/uk), `policy-facts-booking.md`, spec section.

## Verification

See the final section (filled in after the checks).
