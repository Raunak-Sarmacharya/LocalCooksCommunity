# Team test plan — dev (Oct 2026)

Everything below runs on **dev** with **Stripe test mode**. Nothing touches production.

- Chef: https://dev-chef.localcooks.ca · Kitchen: https://dev-kitchen.localcooks.ca · Admin: https://dev-admin.localcooks.ca
- Test cards (any future expiry, any CVC, any postcode):
  - `4242 4242 4242 4242` — pays normally
  - `4000 0027 6000 3184` — asks for a bank check (3-D Secure); approve or fail it
  - `4000 0000 0000 9995` — declined (insufficient funds)
  - `4000 0000 0000 0259` — pays, then the bank opens a chargeback a minute later
- Times are shown in the kitchen's time zone (Newfoundland for the test kitchen).
- Try every flow on a phone too (390 px wide is what we check).

## Kitchen bookings

1. **Book:** pick a kitchen, a day and hours, add equipment, check the total (kitchen time, equipment, HST, service fee) and the cancellation line before paying. Request → card hold.
2. **Kitchen answers:** accept (card charged) or decline (hold released). Let one request expire (24 h or the 1-hour-before-refund-deadline rule).
3. **Invitations:** kitchen invites a chef at its own price; chef adds equipment and pays; booking is confirmed at once.
4. **Change a pending request:** rebook; the old request closes once the new one is sent.
5. **Change a confirmed booking:** new date/time/length before the refund deadline; see the price difference first; kitchen approves or declines. Try a length that doesn't fit a later start time (you should get an explanation).
6. **Remove an add-on** from a confirmed booking: refund shown first, then paid at once.
7. **Cancel:** before the refund deadline (refund minus the card fee, shown in dollars) and after it (per the kitchen's policy).
8. **Arrival/visit:** arrival details 48 h before, check-in code, extra time, check-out, "Can't get in" problem report.
9. **Inspection and payout:** kitchen finishes inspection → paid now; or auto 24 h after the visit. Damage/cleaning claim within 72 h (Local Cooks reviews first).
10. **Overnight hours:** a kitchen open past midnight (e.g. 9 a.m.–1 a.m.) books cleanly across midnight.

## Storage (rented on its own, by the day)

1. **Kitchen lists storage:** type, name, how many units, price per day, photos, size, access, temperature (cooler/freezer), notes. One unit = one renter at a time.
2. **Chef rents:** from the kitchen page "Rent storage" → dates (start within 14 days, 1–30 days) → disclosure (no automatic charges, 5 extra days to extend, ending early not refunded, kitchen's cancellation policy applies, card kept on file) → card hold. Not approved at the kitchen yet? You should be sent to apply first.
3. **Kitchen board (Storage):** every unit with status and occupant; Approve/Decline requests; "Occupied X / Y".
4. **Full listing:** rent every unit → chef sees "Available from {date}", full dates greyed out. Take a unit **out of service** → chef sees it full; put it back.
5. **Move in / move out** (photos optional; no move-in photos is noted on claims). Kitchen clears the move-out → payout released at once.
6. **Extend:** one tap with the saved card; try the decline card → "Pay with another card".
7. **After the paid time:** 5 extra days (grace), then the kitchen may "Charge holdover" or "Waive holdover"; chef pays or disputes within 72 h. At 15 holdover days Local Cooks runs removal review and the final notice (admin). Disposal stays off until counsel approves.
8. **Kitchen tools (More):** change unit, ask to move out by a date (unused days refunded — preview first), offer more time, refund, release a never-used unit, report damage after move-out.
9. **Problems:** chef "Report a problem" holds the kitchen's payout until resolved.
10. **Money the kitchen sees:** "You'll be paid $X on {date}" (net after the Local Cooks fee and the card fee). Payout at the end of each paid term.

## Admin

- Storage rentals list + drawer (payments, holds, problems, claims, holdover requests) and actions (filtered by state, reason required).
- Booking support: flags (chargebacks), stuck booking-change recovery (finish / give back / close), refunds.
- Every money event notifies all admins in-app; email only for admins with the email toggle on.

## Known dev limitations (not bugs)

- **Bookings are single-day.** A booking can be hourly or a full day at the kitchen's daily rate, but not a range of days (e.g. Mon–Wed) — consecutive multi-day bookings are designed but not built (owner, Oct 17: leave for now). Book each day separately.

- Test accounts use `@localcooks.test` emails, which bounce, so admins see "Booking notice needs delivery recovery". Use real inboxes for your team accounts if you want to read emails.
- The recurring worker runs every 30 minutes on dev, so time-based steps (reminders, grace, removal review, auto-clear) can lag up to 30 minutes.

## How to report

For each issue: who you were (chef/kitchen/admin), the page URL, the booking or rental reference (KB-… / SB-…), what you expected, what happened, and a screenshot. Phone or desktop.
