# QA test clock (dev only)

Test reminders, deadlines and other timed steps without waiting for them.

## Where
Dev admin (`dev-admin.localcooks.ca`):
- **Tours:** Tour Requests → "Test clock" next to a tour's reference. The tour opens with a Test clock card beside its history.
- **Bookings:** Booking support → find the booking → the Test clock card sits under "Take action". Single-day and multi-day.

The card lists every automatic step still ahead for that tour or booking, with its time. "Jump here" moves its saved times
earlier so that step is due now, then runs it the same way the live system would. Every step between now and the one you
picked runs first, in order. For example, jumping to the day-3 feedback reminder first runs the 24-hour auto-close, and a
closed tour gets no reminder, just as in real time.

## Rules for testing
- **Tours: do the people steps first, then jump.** Approve, confirm, reschedule and "They came" at the real time. A moved request
  can't be confirmed afterwards, because its new time is no longer one of the kitchen's tour slots.
- **Bookings:** accept or decline first. A pending single-day request can jump anywhere, but test acceptance before moving
  it. A multi-day request can only jump to its answer deadline, because its paid quote is locked to the original dates.
  A move that would land on another booking in that kitchen is refused; so is a jump while a payment is still finishing.
- **Money is real Stripe sandbox money.** Jumping past the answer deadline cancels the card hold; jumping past payout
  sends the kitchen's test-account transfer; time-change and extra-time deadlines refund or cancel as they would live.
- **"Free cancellation ends"** has no automatic action. It is there so you can test a late cancellation right after it.
- **Jumps can't be undone.** Dates move earlier: a tour or booking for Friday can show Wednesday after a jump. Use records
  made for testing.
- **Emails and notifications send for real** to whoever is on the tour or booking. `@localcooks.test` addresses never receive email
  (in-app notifications still arrive); use accounts with inboxes you can read.
- Times move in whole 5-minute steps, so a step runs up to 5 minutes after its due time.
- Clock times change with the move: a 9 a.m. booking jumped 10 h 15 min shows 10:45 p.m. the night before, and a full day can
  read as an overnight span ("20:15–13:15"). The steps still line up; only the wall-clock look is odd.
- If a jump crosses many steps it may stop early to stay inside the server time limit. The card says so; jump again.

## Background worker
Some work isn't on a timer of its own: retries of messages that didn't send, and the sweeps that close out old records.
The background worker does it every 30 minutes on dev. If a jump's result says "not sent yet", or you're waiting on one of
those sweeps, press **Run background worker now** at the bottom of the card instead of waiting. It runs everything due, for all
records, not just this one.
- "The worker is already running": the scheduled run is going; try again in a minute.
- "Ran part of the work": it has a time limit; press it again.
- "Ran, but N tasks failed": check Email logs (admin) or tell the developers.

## Walkthroughs (checked on dev, Oct 28)
- **Day-3 feedback reminder (booking):** a completed booking with no feedback → jump "Day 3 · feedback reminder" → "How did it go?"
  reaches both sides.
- **Time change not answered:** as the chef, booking → ⋯ → "Change date or time" → pick a new time → Send. On the admin card,
  jump "Time change: kitchen answer deadline" → both sides get "Change request expired"; the booking keeps its old time.
- **Extra time not answered:** jump the booking to "Booked time starts", check the chef in with the kitchen's code, then as the chef
  "Need more time?" → pick a time. On the admin card jump "Extra time request expires" → the hold is released, nothing charged.

## Can't be tested by design
- **Unpaid cancellation requests auto-accepting:** unpaid items are cancelled at once, so a booking never waits in that state.
  Paid cancellation requests wait for the kitchen; their reminder is on the card.
- **Card holds expiring after 7 days:** Stripe's real clock. Test an unanswered request with the answer-deadline jump instead.

## Not on the clock yet
Storage rentals, damage claims, kitchen invitations and document expiry reminders (45, 14 and 3 days before, and on the day)
still run on real time. They're the next checkpoints.

## What it does not move
- Card holds in Stripe (still 7 real days).
- Booking documents, feedback answers, support actions and the accepted cancellation terms (only their session times move).
- The multi-day quote stored with the payment (receipts show the quoted dates).
- Chat message times.

## Safety
It is off unless `QA_TEST_CLOCK_ENABLED=true`, and it refuses to run in production (Vercel production, production
lifecycle or a live Stripe key) even with the flag set. Admins only. Each jump is recorded in `platform_settings`
(`qa_test_clock_log`, last 200).
