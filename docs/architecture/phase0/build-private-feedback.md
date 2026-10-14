# Build plan: private two-sided booking feedback (lead-authored 2026-10-14)

Owner decision (PHASE0_LOG §10): **private two-sided feedback and operator flags; public exposure deferred.** Tours already have a private feedback precedent; mirror it (map: `map-payout-deadline-feedback.md` §3).

## Research basis
- Airbnb and Peerspace both ask each side to review after completion; Airbnb's window is 14 days.
- We keep the **prompt timing and window** (after completion, 14 days, one reminder) but make the answers **private to Local Cooks**.
- This lets us collect honest signal before we're ready for public reviews. Ratings stored now can seed public reviews later only with fresh consent; say nothing about that in the UI.

## Product
- **Who and when:**
  - both the chef and the kitchen manager;
  - prompted when the booking closes (`persistBookingCloseout` writes `completed`) and attendance wasn't a no-show (there must have been an arrival record, or attendance unknown but not reported as a no-show);
  - no prompt for cancelled, declined or expired bookings;
  - window: 14 days from closeout; one reminder at day 3 if not answered; then closed.
- **Form** (one screen, under 30 seconds):
  - Chef: "How was your session at {kitchen}?"
    - 1–5 stars, required.
    - Optional chips. Positive: "Clean and ready", "Equipment as described", "Easy to get in", "Helpful staff". Negative: "Not clean", "Equipment missing or broken", "Trouble getting in", "Didn't match the listing".
    - Optional "Anything Local Cooks should know?" (≤1000 chars).
  - Manager: "How was {chef}'s session?"
    - 1–5 stars, required.
    - Optional chips. Positive: "Left it clean", "On time", "Followed the rules", "Easy to work with". Negative: "Left a mess", "Late or overstayed", "Didn't follow the rules", "Damaged something".
    - Optional note (≤1000 chars).
  - Both: a muted line "Only Local Cooks sees this. {other party} won't see your answers."; button "Send feedback".
  - After sending: "Thanks — this helps us keep Local Cooks great." Answers are immutable once sent; show them read-only.
- **Where it appears:**
  - a card on the booking details page (both roles) when open: "How did it go?" plus the stars inline (tapping opens the form in a sheet on mobile, inline on desktop);
  - after submitting, the card shows "You sent feedback on {date}";
  - after the window closes unanswered, the card disappears.
- **Notifications:**
  - closeout already emails both sides ("visit complete"), so add the feedback ask to THAT email as a CTA ("Rate your session" → booking page `#feedback`) rather than sending a second email;
  - day-3 reminder: one email + in-app, only if not answered: "How was your session at {kitchen}? It takes 30 seconds.";
  - no reminder after that.
- **Operator flags (admin):**
  - a rating ≤ 2, OR any negative chip "Damaged something" / "Not clean" / "Trouble getting in", → an admin in-app notification + email (notice shell, CTA to the booking support case `/admin?section=booking-support&booking=:id`);
  - the booking-support case view (being built in parallel; see `build-booking-support.md`) gets a "Feedback" block. If that file isn't there yet when you finish, expose `GET /api/admin/bookings/:id/feedback` and note the integration as a follow-up.

## Data (migration **0078_booking_feedback.sql**; 0077 is booking support)
`booking_feedback_responses`:
- `id`, `booking_id`, `respondent_id`, `respondent_role` (chef|manager), `rating` smallint 1–5 not null, `tags` text[] (validated against the role's allow-list), `comment` text, `created_at`;
- unique `(booking_id, respondent_role)`.

Also add `kitchen_bookings.feedback_requested_at` and `feedback_reminded_at` (timestamptz null). RLS on, revoked from PUBLIC/anon/authenticated as 0075. Drizzle schema in `shared/schema.ts`.

## Server
- **Shared rules:** `shared/booking-feedback.ts`, with the zod input schema, the tag allow-lists per role, and `feedbackOpen(booking, now)` / `feedbackDue` (reminder) helpers mirroring `shared/tour-feedback.ts`.
- **Service:** `server/services/booking-feedback-service.ts`.
  - Participant read returns their own response only.
  - Submit is row-locked and immutable (409 if already sent), and refused when not open (403/409 with a plain message).
  - On submit, evaluate the flag rule → admin notice.
- **Routes:**
  - `GET/POST /api/bookings/:id/feedback` (chef) and `/api/manager/bookings/:id/feedback` (manager), each scoped to the participant;
  - `GET /api/admin/bookings/:id/feedback` returns both responses.
- **Prompt:**
  - set `feedback_requested_at` inside `persistBookingCloseout` when status becomes completed (same tx);
  - add the CTA to the existing closeout notice emails (`closeout-notice-email.ts`), but only when feedback is open for that recipient.
- **Reminder:**
  - in the existing recurring worker, a bounded task (same pattern as the other sweeps, an indexed query on `feedback_requested_at` with `feedback_reminded_at IS NULL`) at requested + 3 days;
  - skip recipients who already answered; set `feedback_reminded_at`.
  - Mind Vercel Hobby CPU: the query must be index-backed and early-exit when nothing is due.
- **Outbox kinds** for the reminder email + in-app: reuse `queueBookingLifecycleEvent` with a new kind `feedback_requested` (per-recipient targeting as existing kinds do).

## Client
- `client/src/components/booking/BookingFeedbackCard.tsx`: the stars (keyboard accessible, `role="radiogroup"`), toggle chips, the textarea, and the states open / sent / closed.
- Mounted in `BookingDetailsPage.tsx`'s main column under "Visit" when open or sent. Use anchor `#feedback` to scroll to it.
- i18n in en-CA, fr-CA, uk. 390 px with no overflow; a 44 px tap target for each star.

## Tests
- The shared rules (open window, tags per role, validation).
- The service: own-only read, immutable submit, closed window refused, flag rule → admin notice.
- `persistBookingCloseout` sets `feedback_requested_at` only for attended/unknown completed bookings.
- The reminder task picks exactly the due ones.
- The client card states and validation.

Run the touched suites + `npx tsc --noEmit` + `client/src/i18n/locales.test.ts`. Known pre-existing failures as in the other plans; report new versus pre-existing separately.

Do NOT apply the migration (the lead applies it). No commits/deploys.

Output: `.phase0-harness/private-feedback-checkpoint.md`.
