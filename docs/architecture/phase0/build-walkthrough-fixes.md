# Build plan: fixes from the two-role, every-state walkthrough (lead-authored 2026-10-14)

The lead walked chef and manager through every state on dev (`1f985dbb`), at 1280 px and at 390 px:
- pending (150);
- today, in session, checkout to review, completed (152, live: seeded, then a real code check-in, a real checkout and a real inspection clear);
- cancelled/declined (123);
- the lists.

**Already at par (leave alone):**
- the booking details header (who, when, one pill, next step);
- the sticky mobile Message bar, with no horizontal overflow at 390;
- the in-session screen;
- the visit-code check-in;
- the checkout toast;
- the inspection confirm dialog (in-app, with a clear consequence).

Fix only what's below. Client + i18n (en-CA, fr-CA, uk) only, unless a line says otherwise. Other agents are editing **server** files concurrently, so don't touch `server/`.

## A. Bugs (must fix)
1. **Chef list dates are one day early** (`client/src/components/booking/ChefBookingsView.tsx`): #152 (Wed Oct 14) shows "Tue, Oct 13" and KB-GNEWRD (Fri Oct 16) shows "Thu, Oct 15". `booking_date` is a date at UTC midnight/noon; format it as a calendar date, never through the browser zone. Use the same helper as the details page (it shows the right day). Grep for the same mistake in the manager list, the dashboard cards, document/PDF dates on the client ("document dates one day early" backlog item), and fix them all with one shared helper.
2. **"Upcoming" includes finished visits** (chef list): #152 (completed this morning), #147, #141 and #139 (ended hours ago) sit under Upcoming. Upcoming/past must split by the visit's end instant in the kitchen zone (or the projected status: anything `completed`, `cancelled` or past its end is Past).
3. **Manager list shows completed bookings as "Pending"** (`ManagerBookingsPanel.tsx` / `ManagerBookingDashboard.tsx`): #151 and #145 (status completed) render "Pending · Checkout Pending" plus the line "The scheduled visit time has ended. Check-in and checkout status are shown below." Map statuses with the same phase logic as the details header (`client/src/lib/booking-header-state.ts`: `bookingHeaderPhase` and the pill labels), so a list row and its details page always agree.
4. **"Cancel or change" on a finished visit** (`BookingDetailsPage.tsx:1154` `chefCanCancel`): booking 152 is DB-`confirmed` with `checkin_status = checked_out`; the header correctly says Completed, but the chef still gets a Cancellation card ("deadline has passed") plus "Cancel or change" in the card and the ⋯ menu. `chefCanCancel` must be false once an arrival is recorded or the header phase is anything past `today` (in session, checkout to review, completed, visit ended…). Same for `managerCanManage`'s "Cancel or change" (keep "Manage refund" for cancelled).
5. **Declined / expired / withdrawn are all shown as "Cancelled"** (123: the manager declined; the card was never charged). Derive the cause on the client from the existing payload: `paymentDecision.target === 'cancelled'` with `actorId === chefId` → withdrawn by the chef; with another `actorId` → declined by the kitchen; with no `actorId` → expired (the 24 h sweep calls `decideAuthorizedBooking` without an actor). `paymentDecision.target === 'confirmed'` with status cancelled → cancelled after confirmation. Put this in a small pure helper with tests.
   - Pill:
     - "Declined" or "Expired" (grey) for those causes; "Cancelled" otherwise.
   - Next step, chef (Airbnb pattern):
     - declined: "{kitchen} couldn't take this request. Your card wasn't charged." plus a secondary "Find another time" link to the kitchen's booking page (see the existing kitchen link helpers; if none is available client-side, list it as a gap);
     - expired: "{kitchen} didn't respond in time, so the request expired. Your card wasn't charged.";
     - withdrawn: "You cancelled this request. Your card wasn't charged."
   - Next step, manager:
     - declined: "You declined this request. {chef}'s card wasn't charged.";
     - expired: "This request expired before it was answered. {chef}'s card wasn't charged.";
     - withdrawn: "{chef} cancelled this request."
   - History line: "Booking cancelled" → "Request declined" / "Request expired" / "Request withdrawn" when the cause is known (`BookingHistoryPanel` + `shared/booking-history.ts` labels; shared is fine to touch, it isn't server).
6. **Declined/uncaptured payment card** (123, both roles):
   - It shows "Your payment hold was released." to the **manager**; manager copy is "The chef's card hold was released. Nothing was charged."
   - The breakdown "Kitchen payment $25.00 / Original Quote $25.00" (capitalized, duplicated, missing the real $30.50 total) becomes one line: "Not charged" with the struck original total.
   - Hide "View cancellation and refund details" whenever nothing was captured (it opens a 500 "No cancellation request awaits a decision" today).
7. **Completed inspection page keeps the live form** (`/manager/booking/:id/inspection` after "Finish inspection"):
   - The page still shows "Inspect by…", the note box and the draft helper, a **disabled** "Finish inspection — all looks good", and an enabled "Report a cleaning or damage concern".
   - After it finishes, show a done state: "You finished this inspection on Oct 14 at 9:29 a.m. TestSprite chef was notified." plus a "Back to booking" primary.
   - Keep a quiet secondary "Found a problem later? Ask Local Cooks to review" only while the existing server rules allow a report (use whatever the inspection payload already says, e.g. `canRespond`/deadline; don't invent a rule).
   - Manager-facing "The kitchen finished its inspection" → "You finished the inspection". Chef-facing → "The kitchen checked the space. All good."

## B. Copy / clarity (should fix)
8. **Inspection page:**
   - "Oct 14, 2026, 9:30 a.m. – Oct 14, 2026, 10:30 a.m." → "Wed, Oct 14 · 9:30–10:30 a.m.";
   - remove the "Booking confirmed" status line;
   - remove the "Refresh inspection" button (refetch on focus/interval instead, if the page needs it);
   - drop "Your draft stays here if you retry or use Refresh inspection. Send it before reloading or leaving this page.";
   - "These instructions were saved when this visit was booked." appears detached; drop it or put it under the instruction block as a muted caption;
   - "0 photos requested" → "No photos were required" (hide the count when it's 0);
   - "Checkout review requested: …" → "Checked out: …".
9. **Manager booking list:**
   - title "Booking Requests" → "Bookings" (the tabs already cover pending);
   - status chips "Confirmed / Checked Out", "Not Checked In" in Title Case → the single header-phase pill (sentence case), with the chef's check-in shown only when useful ("Checked in 9:28 a.m.");
   - the reference shows "#152" for rows without `referenceCode`; use one fallback everywhere (`#152`), including `BookingHistoryPanel` ("BOOKING-152") and `BookingCancellationChooser` ("BOOKING-…").
10. **Chef list:**
    - "Pending Approval (2d)" and "Confirmed (21h)": the bracketed age is unexplained. Drop it, or replace it with "Responds by Oct 15, 1:04 a.m." for pending (`bookingResponseDeadline`).
    - Row action "Request cancellation" on confirmed → "Cancel or change" (the same wording as the details page).
11. **Manager details, in session:** "Checked in 9:28 a.m." and "Arrived 9:28 a.m. with the visit code" say the same thing; keep one line: "Checked in 9:28 a.m. with the visit code".
12. **Chef visit page:**
    - the date "Oct 14, 2026, 9:30 a.m. – 10:30 a.m." → the header format "Wed, Oct 14 · 9:30–10:30 a.m.";
    - "1 h 2 min left" plus "62 minutes left in your booked time" duplicate each other (keep the first).
    - "Check-in opens Oct 14, 9:15 a.m." on the chef details page after check-in has opened → "Check-in opened at 9:15 a.m."
13. **Chef details, in session:** the header primary still says "Open your visit"; in session it should say "Check out" (same target).
14. **Manager hits a chef URL** (`/booking/:id` while signed in as a manager, e.g. from a shared link): it shows the chef sidebar plus "Booking not found / You don't have permission". If the signed-in user is the booking's manager, redirect to `/manager/booking/:id`.

## Out of scope (tracked separately)
- Reviews/ratings and "Book again" beyond item 5.
- Payout timing copy (it waits for the payout-after-closeout work).
- Bookings with no check-in staying DB-`confirmed` (the projection already shows Completed after the end; the server-side closeout is separate).

## Verification
Unit tests for the pure helpers:
- calendar-date formatting;
- the upcoming/past split;
- cancel-cause derivation;
- the chefCanCancel gating.

Also:
- update affected component tests;
- `npx tsc --noEmit`;
- run the touched tests plus `client/src/i18n/locales.test.ts`.

Known pre-existing failures: 9 locale ICU (booking.json), 1 BookingCancellationChooser, 14 tour/manager/cancellation-policy-dialog tests. Report new versus pre-existing separately.

Write `.phase0-harness/walkthrough-fixes-checkpoint.md`: a before/after table per item, files touched, tests, gaps.
