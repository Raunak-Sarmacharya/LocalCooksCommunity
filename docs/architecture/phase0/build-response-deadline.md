# Build plan: manager response deadline (R5) + decision reminders (lead-authored 2026-10-14)

Owner decision R5 (PHASE0_LOG, "Oct14 owner decisions"): the manager's response deadline is **the earlier of 24 h after the request or a buffer before the start**. Today the deadline is `createdAt + 24h` everywhere, so a short-notice request can still be pending after its start time (lifecycle-walkthrough finding). The map with file:line references is `map-payout-deadline-feedback.md` §2.

Research basis:
- Vrbo auto-declines after 24 h; Peerspace expires after its window.
- Our research doc §"Decision reminders" proposes manager reminders 12 h and 2 h before expiry (a Local Cooks choice).

## Rule (shared, pure, tested): `shared/booking-response-deadline.ts`
```
resolveResponseDeadline({ createdAt, startAt, windowHours = 24, bufferHours = 1, minResponseMinutes = 30 })
  deadline = min(createdAt + windowHours, startAt - bufferHours)
  if deadline < createdAt + minResponseMinutes:  // very short notice
      deadline = min(createdAt + windowHours, startAt)  // the manager may still accept up to the start
  return deadline
```
- `startAt` is the first visit's start instant, built in the kitchen zone with the existing helpers; never the browser zone.
- `windowHours` stays `AUTH_EXPIRY_HOURS`.
- `bufferHours` (default 1) and the reminder offsets come from `server/services/lifecycle-settings.ts`. Add them to the admin LifecycleSettings UI with plain labels: "Requests expire this long before the start" and "Remind kitchens before a request expires".
- Examples for the tests:
  - booked 5 days ahead → created + 24 h;
  - booked 10 h ahead → start − 1 h;
  - booked 70 min ahead → start (the short-notice branch);
  - start in the past → created + 0 (expire now; it should not happen given minimum notice).

## Server
1. Replace every `createdAt + AUTH_EXPIRY_HOURS` computation with `resolveResponseDeadline`. That covers the expiry sweep, lazy expiry, the confirm-command guard in `booking-payment-decision.ts`, and `email.ts` `bookingResponseDeadline` (it needs the start; pass the booking's date/time + zone).
   - Expiry runs when `now >= deadline`.
   - **Stripe safety:** the authorization itself lasts 7 days, so an earlier expiry is always safe.
2. Add `responseDeadlineAt` (ISO) to the four detail payloads (`bookings.ts` chef details + list, `manager.ts` details + list per the map). The client then uses the payload value, falling back to the local computation only if it's absent.
3. **Manager decision reminders.**
   - Add a new reminder kind `manager_decision`, due at `deadline − 12h` and `deadline − 2h`. Skip any due time earlier than `createdAt + 30 min` or already past.
   - Suppress all of them once a decision, withdrawal or expiry occurs.
   - Use the existing reminder/reconciliation machinery (`advance-reminders.ts`, `reminder-reconciliation.ts`, the outbox); no new cron.
   - Copy, manager, email + in-app, on the notice shell, CTA "Review request" → `/manager/booking/:id`:
     - subject "Reminder: respond to {chef}'s request by {deadline}";
     - body "{chef} asked for {kitchen} on {date · time}. If you don't respond by {deadline}, the request expires and their card hold is released."
   - Chef copy: none (Airbnb doesn't nag guests).
4. **Expiry notice copy** (`sendAuthExpiryNotification`): remove the literal "did not respond within 24 hours". Say:
   - chef: "{kitchen} didn't respond in time, so your request for {date} expired. Your card wasn't charged." plus a "Find another time" CTA (kitchen page link, env-aware);
   - manager: "{chef}'s request for {date} expired because it wasn't answered by {deadline}. Their card hold was released."
5. Request emails already show the deadline; they now get the R5 value automatically through (1).

## Client
1. `client/src/lib/booking-response-deadline.ts`: prefer `booking.responseDeadlineAt`, keeping the existing fallback.
2. Checkout step (`KitchenBookingFlow.tsx`, the literal "48 hours"): use the configured preparation lead (`preparationReminderHours`, exposed on an existing public settings/booking-config endpoint, read-only; if there's no endpoint, add the field to the kitchen booking-config payload the flow already loads).
3. Checkout "What happens next": "The kitchen has until {deadline} to respond." Compute it client-side with the shared rule for the selected slot (same function).

## Tests
- The shared rule (all the examples).
- Expiry sweep: expires at the R5 deadline, not before.
- The confirm guard refuses after the R5 deadline.
- Reminders: scheduled at −12 h/−2 h, the skip rules, suppression after a decision.
- Payload field present.
- The email deadline uses R5.

Run the touched suites + `npx tsc --noEmit`. Known pre-existing server failures: ~49 server tests, incl. 2 decision-ordering, tour-delivery-service copy asserts, 1 stripe-checkout-cancel fixture. Report new versus pre-existing separately.

## Out of scope
Changing the 24 h window itself; instant book; chef-side reminders.

Output: `.phase0-harness/response-deadline-checkpoint.md`.
