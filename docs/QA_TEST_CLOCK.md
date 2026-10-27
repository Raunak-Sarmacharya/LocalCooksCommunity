# QA test clock (dev only)

Test reminders, deadlines and other timed steps without waiting for them.

## Where
Dev admin (`dev-admin.localcooks.ca`) → Tour Requests → "Test clock" next to a tour's reference. The tour opens with a
Test clock card beside its history. Bookings come in the next checkpoint.

The card lists every automatic step still ahead for that tour, with its time. "Jump here" moves the tour's saved times
earlier so that step is due now, then runs it the same way the live system would. Every step between now and the one you
picked runs first, in order. For example, jumping to the day-3 feedback reminder first runs the 24-hour auto-close, and a
closed tour gets no reminder, just as in real time.

## Rules for testing
- **Do the people steps first, then jump.** Approve, confirm, reschedule and "They came" at the real time. A moved request
  can't be confirmed afterwards, because its new time is no longer one of the kitchen's tour slots.
- **Jumps can't be undone.** The tour's date moves earlier: a tour booked for Friday can show Wednesday after a jump. Use a
  tour made for testing.
- **Emails and notifications send for real** to whoever is on the tour. `@localcooks.test` addresses never receive email
  (in-app notifications still arrive); use accounts with inboxes you can read.
- Times move in whole 5-minute steps, so a step runs up to 5 minutes after its due time.
- If a jump crosses many steps it may stop early to stay inside the server time limit. The card says so; jump again.

## What it does not move
- Card holds in Stripe (still 7 real days).
- Chat message times.

## Safety
It is off unless `QA_TEST_CLOCK_ENABLED=true`, and it refuses to run in production (Vercel production, production
lifecycle or a live Stripe key) even with the flag set. Admins only. Each jump is recorded in `platform_settings`
(`qa_test_clock_log`, last 200).
