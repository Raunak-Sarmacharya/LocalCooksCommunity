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

## Booking settings (kitchen and location)

Most booking settings are set once for a **location** and a kitchen can override them. Every field must say where its value comes from: **Location default**, **Set for this kitchen**, or **At this kitchen only**. Use a location that has at least two kitchens.

1. **Every setting shows its source.** *Who:* kitchen manager. *Do:* open the kitchen's booking settings and read every field. *Expected:* each field says "Location default" or "Set for this kitchen"; location-only fields (terms, tax, arrival timing) say "Set for {location}"; kitchen-only fields (hourly/daily rate, opening hours, equipment, extra time auto-approve, weekly limit per chef) say "At this kitchen only". Nothing is blank or unlabelled.
2. **Changing a location default warns which kitchens change.** *Who:* location owner (or Local Cooks support). *Do:* change the location's advance notice from 24 to 48 hours and save. *Expected:* a warning before saving says how many kitchens use this default (to confirm: whether it also lists them by name). Kitchens using the location default now show 48 hours; kitchens with their own override keep their value and still say "Set for this kitchen".
3. **A kitchen override, and going back.** *Who:* kitchen manager. *Do:* set the buffer to 1 hour, save, then tap "Use the location's rule". *Expected:* after saving the field reads "Set for this kitchen · 1 hour"; after tapping "Use the location's rule" it reads "Location default" and shows the location's value (Off unless changed).
4. **Tax is set once, on the location.** *Who:* location owner, then kitchen manager, then chef. *Do:* set HST to 15% on the location; open the kitchen's pricing settings; book as a chef. *Expected:* the kitchen shows "HST 15% — Set for {location}" and cannot be edited there; the chef's checkout shows HST at 15% of the kitchen price. (To confirm: whether HST also applies to the Local Cooks service fee — with the accountant.)
5. **Cancellation policy: location default, kitchen override, kept per booking.** *Who:* location owner, kitchen manager, then chef. *Do:* set the location to 24 h / 50%. Make a booking. Change the kitchen to 48 h / 100%. Open the old booking, then make a new one. *Expected:* the old booking still says "Cancel by {old deadline} … 24 h / 50%" and its refund deadline does not move; the new booking shows 48 h / 100% and its own deadline. The chef sees the exact policy before paying.
6. **Terms live on the location only.** *Who:* location owner; kitchen manager. *Do:* open the kitchen's Terms and conditions page. *Expected:* it can be read (PDF/house rules) but not edited at the kitchen. It says it holds the house rules and cannot change Local Cooks booking, refund, payment or claim rules. A chef applies to the location and accepts its terms.
7. **Longest booking: no limit by default, full days still allowed.** *Who:* kitchen manager; chef. *Do:* open a new kitchen's settings; then set "Longest booking" to 4 hours and try a 5-hour hourly booking, then a full day. *Expected:* the default reads "No limit" and the chef can book up to the kitchen's opening hours. With 4 hours: the 5-hour hourly booking is refused with the limit in the message; a full day is still offered at the daily rate, and the screen says the limit applies to hourly bookings only.
8. **Buffer: Off / 1 h / 2 h.** *Who:* kitchen manager; chef. *Do:* leave it Off and book two back-to-back; then set 1 hour and try to book the hour right after an existing booking; book from the kitchen's own side inside that hour. *Expected:* Off = no gap enforced. 1 hour = the chef can't pick hours inside the hour before or after another booking and sees why; existing bookings are unchanged; the kitchen can still book inside it. Where two bookings have different buffers, the larger one applies (not both added).
9. **Weekly limit per chef, at this kitchen.** *Who:* kitchen manager; chef. *Do:* set the limit to 20 hours (kitchen open 9 a.m.–5 p.m., 8 hours a day). As a chef, book 8 hours on Monday, then try 16 hours on Wednesday; cancel the Monday hours and try again. *Expected:* the Wednesday request is blocked with a message naming the limit and the week (Monday–Sunday, kitchen time) and counting the 8 hours already used (24 > 20). After the Monday hours are cancelled they no longer count and the request goes through. A full day counts as that day's opening hours (8). The kitchen can override the block.
10. **Multi-day switch and days per booking.** *Who:* kitchen manager; chef. *Do:* check the switch and the limit; set the limit to 3 and try to pick 4 days; turn the switch off. *Expected:* on by default with "Up to 7 days per booking"; the limit can be set up to 14 (the Local Cooks cap). With 3, the chef can pick at most 3 days. Off = one day per booking, and the chef is told.

## Kitchen declines an item (chef approves)

Declining an item no longer changes the booking on its own: the chef must agree to the new total first. This applies to single-day and multi-day (on multi-day all days stay together — see below).

Worked example: full day $180, one equipment item $40, HST 15%, service fee 7%.
- Old total: $220.00 + $33.00 HST + $15.40 service fee = **$268.40**
- New total without the item: $180.00 + $27.00 HST + $12.60 service fee = **$219.60**
- Difference: **$48.80**

1. **Kitchen accepts without the item.** *Who:* kitchen. *Do:* on a request, choose "Accept without {item}". *Expected:* the kitchen sees "We'll ask the chef to confirm the new total. Nothing is charged until they do." The booking shows "Waiting for the chef" and the time stays reserved.
2. **Chef sees the new total and the deadline.** *Who:* chef (in-app and email). *Do:* open the booking. *Expected:* "{kitchen} can host you, but can't provide {item}. New total $219.60 (was $268.40). Accept or decline by {time}." The time is in kitchen time: 24 hours, or 1 hour before the refund deadline if that is sooner. It also says that no answer closes the request and releases the hold.
3. **Chef accepts.** *Who:* chef. *Do:* tap Accept. *Expected:* the card is charged **$219.60** only; the rest of the hold (**$48.80**) is released. The booking is confirmed at the new total and both sides see it.
4. **Chef declines.** *Who:* chef. *Do:* tap Decline. *Expected:* the whole hold ($268.40) is released, nothing is charged, the booking is closed and both sides are told.
5. **No answer.** *Who:* nobody. *Do:* let the deadline pass. *Expected:* the whole hold is released, nothing is charged, the booking is closed and both sides are told. No card fee is lost, because nothing was captured.
6. **Last-minute booking (under 3 hours).** *Who:* kitchen. *Do:* take a request that starts in under 3 hours (e.g. request at 11 a.m. for a 1 p.m. start) and open the answer screen. *Expected:* "Accept without {item}" is not offered. The kitchen can accept everything or decline, with: "This booking starts soon, so there isn't time to ask the chef about a change. Accept the full request, or decline it and message the chef." Declining opens the message-to-chef box.
7. **Multi-day.** *Who:* kitchen. *Do:* repeat on a multi-day booking (when it is switched on). *Expected:* same flow, but days are all-or-nothing: accepting without an item keeps every day, and the chef approves the whole new total. (Not testable yet — see the next section.)

## Multi-day bookings (when switched on)

**Not testable yet: multi-day is switched off until the chef and kitchen screens are built.** Keep these steps for when it is switched on. The single-day sections above still apply — a multi-day booking is the same booking with more than one day.

Worked example: full days on Monday, Wednesday and Friday at $180/day, HST 15%, service fee 7%, 24 h / 50% policy.
- Kitchen time: 3 × $180 = **$540.00**
- HST: **$81.00**
- Service fee: **$37.80**
- Total held on the card: **$658.80**
- Each day's share: **$219.60** ($180.00 + $27.00 HST + $12.60 service fee)

1. **Pick the days.** *Who:* chef. *Do:* choose Mon, Wed and Fri (not consecutive). *Expected:* all three go in one booking. Any day within 14 days of the first can be picked, up to the kitchen's "days per booking" limit (default 7, most 14).
2. **Days that can't be picked.** *Who:* chef. *Do:* try a closed day, a day already booked, a maintenance day, a day inside the kitchen's advance notice (too soon) and a day past the advance window. *Expected:* each can't be tapped and says why: "Closed", "Already booked", "Maintenance", "Too soon", "Beyond how far ahead this kitchen takes bookings".
3. **Hours and equipment per day.** *Who:* chef. *Do:* keep all three as full days, then change Wednesday to 10 a.m.–2 p.m.; add an oven for all days, then untick it on Friday. *Expected:* each day shows either full day or its own hours; the kitchen's minimum/maximum hours apply per day; the oven is priced per day booked (2 days); Friday only offers equipment that is free that day.
4. **Summary and one deadline.** *Who:* chef. *Do:* read the confirm screen. *Expected:* it lists each day with its hours and equipment, then one total ($658.80) and **one** refund deadline, 24 hours before the first day starts (Sunday 9 a.m. for a Monday 9 a.m. start). The card is held for the whole total; nothing is charged yet.
5. **Kitchen answers all days.** *Who:* kitchen. *Do:* accept, then repeat with a decline. *Expected:* accept = every day confirmed and **$658.80** charged. Decline = every day released, nothing charged, chef told. There is no accept-some-days option.
6. **Day 2 on Today.** *Who:* chef and kitchen. *Do:* on the second day of a 5-day booking, open Today. *Expected:* it says "Day 2 of 5" and shows that day's hours only; no other day is checked in or out by mistake.
7. **Each day is its own visit.** *Who:* chef and kitchen. *Do:* check in with the 6-digit code each day, check out, and let the kitchen inspect. *Expected:* one code per day; a missed tap on one day never affects the others; arrival details arrive 48 hours before the first day; from day 2 the required tasks are low-friction ("Same as previous visit").
8. **Payout after each day.** *Who:* kitchen. *Do:* finish the inspection for one day (or wait 24 hours after it). *Expected:* that day's share is paid separately: about **$200.53** ($207.00 kitchen time + HST, minus that day's share of the card processing fee, about $6.47). Over three days the kitchen is paid about **$601.59**, one "You've been paid" notice per payout.
9. **Drop a day before the deadline.** *Who:* chef. *Do:* drop Wednesday before the Sunday 9 a.m. deadline. *Expected:* the booking keeps Monday and Friday (a gap is allowed); **$219.60 minus the card processing fee shown on that part** is refunded (about $213.13 if that day's fee share is $6.47). The two remaining days total **$439.20**.
10. **Drop a day after the deadline (50% kitchen).** *Who:* chef. *Do:* drop Wednesday after the deadline. *Expected:* the refund is half of that day's paid share minus its card-fee share: 50% × ($219.60 − $6.47) = about **$106.57**. A 100% kitchen refunds nothing. Same arithmetic as a single-day booking.
11. **Kitchen cancels one day.** *Who:* kitchen. *Do:* cancel Wednesday (e.g. maintenance). *Expected:* Wednesday is refunded in full, **$219.60 including its card fee**; Local Cooks absorbs the card fee and the kitchen is debited its share. The chef may then drop the remaining days **without the late charge**, until the next booked day starts: each is refunded $219.60 minus its card-fee share (about $213.13). Those refunds come out of the kitchen's payout for those days.
12. **Change the whole booking.** *Who:* chef, then kitchen. *Do:* before the deadline, ask to add Thursday as a full day and change Friday's hours. *Expected:* one change request for the whole booking, with the price difference shown first (+$219.60 for Thursday); the kitchen approves or declines; if declined, the original booking stands. Changes are not offered after the deadline.
13. **Invitations for several days.** *Who:* kitchen, then chef. *Do:* invite a chef to Mon/Wed/Fri at a price the kitchen sets. *Expected:* the chef sees the days and price, adds equipment, pays, and the booking is confirmed at once. The price is a discount off the listed price with the $1 floor; no offers above the listed price.

Until further notice, extra time and removing an add-on are refused on a multi-day booking; they will work exactly as single-day once they are priced per day.

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

- **Bookings are single-day.** A booking can be hourly or a full day at the kitchen's daily rate, but not several days in one booking — multi-day is designed but switched off until the chef and kitchen screens are built (see "Multi-day bookings (when switched on)" above). Book each day separately.

- Test accounts use `@localcooks.test` emails, which bounce, so admins see "Booking notice needs delivery recovery". Use real inboxes for your team accounts if you want to read emails.
- The recurring worker runs every 30 minutes on dev, so time-based steps (reminders, grace, removal review, auto-clear) can lag up to 30 minutes.

## How to report

For each issue: who you were (chef/kitchen/admin), the page URL, the booking or rental reference (KB-… / SB-…), what you expected, what happened, and a screenshot. Phone or desktop.
