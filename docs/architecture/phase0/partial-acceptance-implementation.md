# Partial acceptance: the chef approves the new total before any capture

Owner decision (Oct 17), spec `multiday-spec-2026-10-17.md` "Consistency with single-day bookings". Applies to single-day and
dated (multi-day) bookings. Airbnb special offer / Peerspace invite model: no capture happens before the chef agrees, so no
card fee is lost. **Migration 0103 is written and tested in PGlite but not applied anywhere.**

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

## Money review fix round (Oct 17)

1. **Chef deadline without the request rule's 30-minute floor.** `partialAcceptanceDeadline` = min(offer + 24 h, first start −
   (notice hours + 1) h). Example from the review: 24 h notice, first start in 25 h 20 min → 20 min left → refused (409) and
   the dialog disables item declines (the details response and the preview both read `getPartialAcceptanceWindow`).
2. **Dialog shows the server's new total.** `POST /api/manager/bookings/:id/partial-acceptance/preview` returns the total from
   `previewPartialAcceptance`, which shares `confirmationTerms` + `acceptedCapture` with the proposal and the capture (frozen tax,
   dated quote). The dialog no longer recomputes; full approval shows the hold itself.
3. **Hold ended** is its own outcome (`hold_ended`): "The card hold ended before the booking could be confirmed. Nothing was
   charged." for chef, kitchen and admins (never "didn't answer").
4. **Support refusals** (offer closed, past deadline, hold ended) are recorded as `failed` with their reason; unknown provider
   failures still go to recovery.
5. **Privacy:** `actorId`, `answeredBy` and `supportReason` are stripped from every chef/kitchen booking response (repository DTO
   and the proposal returned to the kitchen); Local Cooks' support console reads the raw row.
6. **Replacement** closes a waiting offer as `closed` → "Request replaced" notices.
7. Migration renumbered to **0103** (`0102` belongs to CP5).
8. Chef "My bookings": "Answer needed" pill, "The kitchen offered a new total. Answer by {deadline in the kitchen zone}." and
   "Review the new total".
9. The manager bookings list already carried `partialAcceptance` (repository spreads the row); now tested through the real query
   (PGlite), together with the chef list and booking-by-id projections.

## Files

New: `shared/partial-acceptance.ts`, `server/services/partial-acceptance-notice.ts`, `migrations/0103_partial_acceptance.sql`,
`server/domains/bookings/booking-partial-acceptance-projection.test.ts`,
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

### Results (Oct 17)

- Server: 35 files, **811 passed** (CP4/dated, decision, checkout, support, expiry, delivery, notices, reminders, payouts,
  cancellation, extensions), including 10 new PGlite partial-acceptance tests (proposal, exact partial capture 11109 of 11232
  with allocations conserving, free-item decline, chef decline, expiry/late accept, kitchen withdraw, accept-vs-withdraw and
  accept-vs-expiry races, hold ended at Stripe, unknown proposal), 17 in `partial-acceptance.test.ts` (3 h guard boundaries
  2 h 59 / 3 h 00 and after-start, migration 0103 executed in PGlite, en/fr/uk notices, admin copy), 6 single-day decision tests,
  1 expiry and 1 support-availability test.
- Client: 11 files, **267 passed**, including dialog copy ("Accept without …", ask-chef line, last-minute line + "Message the
  chef" link, full accept/decline unchanged), the chef card (accept, confirm-before-decline, refused answer, kitchen view)
  and the list ("Waiting for the chef", no action, under Upcoming).
- `node scripts/i18n-lint.mjs`: OK.
- `npx tsc --noEmit -p tsconfig.json`, run once (17 min): **3 errors, all in new code** (`open` possibly null in the accept
  check; a list-row type widening that made `Booking[]` unassignable to the agenda rows). Fixed in the follow-up commit and
  re-verified with the affected suites (104 + 46 passed); the full compiler was not run a second time (one-run rule).
