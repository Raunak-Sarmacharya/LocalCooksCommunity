# Build plan: booking UX sweep (parent-authored, 2026-10-14)

Trigger: the owner found the manager "Attendance correction" dialog on the booking page. It starts with a bare textbox "Message to chef (shared with chef and kitchen manager)", then three unexplained buttons (No-show / Attended / Withdraw) that stay disabled until a hidden checkbox is ticked. It sits next to two other overlapping buttons ("Manage visit", "Visit inspection"). The owner's standard: every screen, dialog, toast and notification must be intuitive, aesthetically clean and parallel to top platforms (Airbnb, Turo, Peerspace). Nothing that reads like internal or engineering language.

Research basis (Turo guest no-show):
- the host first messages the guest;
- waits a grace period;
- reports through a structured flow with a deadline;
- the guest can respond.
Sources: https://help.turo.com/en_us/how-to-manage-a-guest-no-show-SkNzL4g4q.md and https://help.turo.com/en_us/guest-no-shows-SkNzL4g4q.md

## Part 1: reference redesign, visit record fixes (binding spec)

Component: `client/src/components/booking/BookingAttendancePanel.tsx` (+ `VisitAssistancePanel.tsx`). The server endpoints stay as they are (`/api/{manager|admin}/bookings/:id/attendance` actions `report_no_show | report_attended | withdraw_attendance`; assisted check-in/out via `VisitAssistancePanel`).

**Entry points**
- The booking page header keeps **one** visit button: "Visit inspection" for checkout review.
- In the "Visit record" card, remove the duplicate "Manage visit" link. Replace "Attendance correction" with a quiet secondary button: **"Fix the visit record"**. Admin: "Fix visit record (support)".

**Dialog: "Fix the visit record"**
- Subtitle: "Choose what happened. {Chef} gets a notification, and the booking history keeps a record."
- Show **only the options valid right now**, as selectable cards (icon, title, one-line consequence). Unavailable ones are hidden; there are no disabled mystery buttons.
  1. **"{Chef} arrived but didn't check in"**: "Add their arrival time to the record." Available from the check-in window until closeout. Opens the arrival form (time picker defaulting to the scheduled start, required).
  2. **"{Chef} left without checking out"**: "Add the time they left." Available after arrival is recorded and until closeout.
  3. **"{Chef} didn't show up"**: "Report a no-show. {Chef} is notified and can reply if this is a mistake." Available after the visit's scheduled end (the existing `canReport` rule).
     Form:
     - a checkbox "I tried to reach {chef} before reporting" (required);
     - **"Note to {chef}"** (required, 10–500 chars) with helper "{Chef} sees this in their booking and email. Keep it factual." and placeholder "e.g. We waited until 10:30 a.m. and called at 10:15 but couldn't reach you.";
     - an info line: "No-shows follow your cancellation policy: no refund is due. If {chef} disputes it, Local Cooks reviews."
     - Button: "Report no-show".
  4. **"{Chef} did come, the record is wrong"**: "Mark the visit as attended." Available after the scheduled end when there is no recorded arrival. Note to the chef is optional.
  5. **"Undo my no-show report"**: "Use this if {chef} came after all or you reported by mistake." Shown only when a no-show report exists. A note is optional.
  6. **"Something else"**: opens the existing "Report a problem" / Local Cooks support entry.
- After an option is chosen, show a single form with one primary button labelled with the exact action, plus "Back". On success: toast ("No-show reported. {Chef} has been notified."), close the dialog, refresh the card.
- Admin only: an extra field **"Internal note (only Local Cooks sees this)"**, plus an "Acting for" line, "You're updating this visit as Local Cooks support".

**Card body (manager and chef)**
- Status in one plain sentence: "Checked in 10:02 a.m. · checked out 12:01 p.m.", "No check-in recorded yet", "Reported as a no-show on Oct 16 at 3:10 p.m.", and so on.
- History: a "Show history" disclosure with friendly lines ("Kitchen reported a no-show · Oct 16, 3:10 p.m. · 'We waited…'").
- Use the kitchen's time zone label from props (no hard-coded `America/St_Johns`). All strings go through i18n (en-CA, fr-CA, uk); no English literals in JSX.
- **Chef side:** when reported as a no-show, show the kitchen's note and two actions: "Message kitchen" and "This isn't right: contact Local Cooks". No textbox for the chef inside this card.

## Part 2: sweep every booking surface to the same standard

Scope (client): chef booking page, chef visit page (arrival / in session / departure), manager booking page, manager inspection page, all booking dialogs (review request, cancellation chooser, visit code, self check-in, report a problem, attendance), the manager dashboard booking cards, toasts, empty and loading states.

Scope (server, copy only): in-app notification titles and messages from booking lifecycle producers (e.g. "Booking #149 awaits manager approval. Payment is authorized and has not been captured." must become people-language). Change only string literals and their i18n keys; no logic changes.

Known items from the lead's walkthrough (must fix):
- **Inspection page:**
  - "Kitchen timezone: America/St_Johns" and the mixed "11:55 PM" / "p.m." times;
  - raw "Booking status: confirmed";
  - "the person booking" (→ the chef's name);
  - the legalistic "Missing photos do not establish absence, damage or liability.";
  - the duplicated "Inspection due by" and "Response deadline";
  - the visit-code panel still shown after the visit;
  - a native `window.confirm` (→ in-app dialog with a clear consequence line).
- **Booking history:** "Earlier activity may not be available for this booking." (drop it or explain it plainly).
- **Chef check-in screen:**
  - "Having trouble getting in or submitting? Contact the kitchen manager using your booking contact details." (verify Package U replaced it with real actions everywhere);
  - "Booking instruction record".
- **Manager "Arrived 11:37 p.m. · code"** → "Arrived 11:37 p.m. with the visit code".
- **Chef's own request email** labels their note "Chef message" → "Your note" (server email key; allowed as copy-only).
- **Stripe line item date** "2026-10-16" → "Fri, Oct 16" (server copy-only, `stripe-checkout-service.ts`).
- Any remaining "Customer" for the chef, "person booking", "acting party", "record", "evidence", "operations", "outcome" in user-facing text.

Method:
1. Inventory every user-visible string and flow on these surfaces (file:line). For each, give a verdict: keep or rewrite, with the proposed text.
2. Apply the rewrites.
3. Flows with disabled-without-explanation buttons, unexplained jargon or duplicated actions get the Part 1 treatment (guided choice, consequence lines, one primary action).

Tone: warm, short, specific; name people ("TestSprite chef", "the kitchen"); say what happens next; never blame; never legalese. 12-hour times with the friendly zone name. Every string goes through i18n in en-CA, fr-CA and uk.

Out of scope: money and policy logic, server behaviour, migrations, new endpoints. If a flow needs data the client lacks, list the gap.

Output: `.phase0-harness/ux-sweep-checkpoint.md`: a before/after table per surface (screen → element → before → after → why), plus files touched, tests, and gaps. Tests: update affected tests; run `npx tsc --noEmit` and the touched tests plus `client/src/i18n/locales.test.ts`. Known pre-existing failures: 9 locale ICU (booking.json), 1 BookingCancellationChooser, 14 tour/manager/cancellation-policy-dialog tests. Report new versus pre-existing separately.
