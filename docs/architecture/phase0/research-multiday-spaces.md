# Multi-day bookings: what space and rental marketplaces actually do

Research date **2026-10-17**. Read-only; no code, database or payments touched. Every claim is labelled **DOCUMENTED** (a first-party page says it; I fetched it on this date) or **INFERRED** (my reading, or a gap I am filling). Pages that would not load are listed in §6 rather than guessed at.

Scope: Local Cooks books a commercial kitchen by the hour or by the operating day. The question is how to let a chef take several days in one booking.

---

## 1. At a glance

| Platform | Multi-day unit | One booking? | Host can accept part? | Change / shorten model | Payout on long bookings |
|---|---|---|---|---|---|
| **Peerspace** | Any chosen dates, incl. **nonconsecutive** | Yes, one request | Not documented; re-quote via invite-to-book | Guest update request → host review | 7 days after the reservation ends |
| **Giggster** | Multi-day production (payout implies it) | Yes | No | Host edits, guest approves, delta charged | On the **last day** of a multi-day booking |
| **Tagvenue** | **Single date** + time slot | Yes, one enquiry | No (negotiate in messages) | Cancel + rebook, or venue-manager arrangement | Not verified |
| **Spacebase** | Continuous check-in → check-out | Yes | No; `RESERVE` then `BOOK` | "Adjust booking" → provider confirms (often auto) | Not verified |
| **LiquidSpace** | Hour / day / month | Not documented | Not documented | Not documented | Not documented |
| **Skedda** | **Recurring series** (daily/weekly/monthly) | No — a series is many bookings | Admin can edit before approving | Edit one / this-and-following / whole series | Charged per series; no marketplace payout |
| **Airbnb** | Continuous nights | Yes | No | Trip change request, either side | First payout after check-in, then **every 30 days** for 28+ nights |
| **Turo** | Continuous start → end datetime | Yes | No; auto-accept when calendar allows | Extend/shorten request; auto or manual | **Partial payout every 7 days** on trips > 1 week |
| **Vrbo** | Continuous nights | Yes | No | Guest messages host; host confirms within 48h | Not verified (help article would not load) |
| **Splacer** | — | — | — | — | Site unreachable |

---

## 2. Per-platform evidence

### Peerspace

- **Q1 — selection.** The booking flow says "Enter your **date(s)/time(s)** and attendee count", so more than one date goes into one request. DOCUMENTED — https://support.peerspace.com/en/articles/10119133-how-do-i-book-a-space
- **Q1 — nonconsecutive days are a first-class case.** The refund policy has a clause for "multi-day **and nonconsecutive-day** Bookings". DOCUMENTED — https://www.peerspace.com/legal/terms/cancellation-policy
- **Q2 — one decision.** A request gives the host **two business days**; accepting "confirms the booking and charges the guest in full"; declining releases the authorization. DOCUMENTED — https://support.peerspace.com/en/articles/10119524-what-happens-when-i-receive-a-booking-request
- **Q2 — partial acceptance.** No article describes accepting some days of a request. The documented way to change terms is to send an invite-to-book instead. INFERRED (absence of any partial-accept wording).
- **Q3 — host controls.** 8+ hour discount is a percentage off the hourly rate, applied "to the **entire booking**, not just the 8th hour", and not to cleaning fees. DOCUMENTED — https://support.peerspace.com/en/articles/10119426-what-is-an-8-hour-discount
- **Q3 — day rate.** Hosts can "offer a day rate" attached to the listing so it applies automatically. DOCUMENTED — https://support.peerspace.com/en/articles/10119469-how-do-i-use-the-invite-to-book-feature
- **Q3 — buffers.** 30 min / 1 h / 2 h buffers before and after bookings; guests cannot submit a request inside them; changes apply only to future requests. DOCUMENTED — https://support.peerspace.com/en/articles/10119395-how-to-incorporate-a-buffer-time-in-between-bookings
- **Q3 — advance window.** Instant Book guarantees hosts "at least a 24 hour lead time"; anything inside 24 h still needs manual acceptance. DOCUMENTED — https://support.peerspace.com/en/articles/10119406-what-is-instant-book
- **Q4 — changes.** Guests may request an update up to **1 hour before start**; host reviews; no response in two business days expires the update and the original stands. Guests **cannot** update an accepted custom offer. DOCUMENTED — https://support.peerspace.com/en/articles/10119134-how-can-i-update-my-booking
- **Q4 — cancellation money is per day.** "For multi-day and nonconsecutive-day Bookings, the deadline for cancellation … shall apply to Event start time **for each day** in which the Space is Booked." DOCUMENTED — https://www.peerspace.com/legal/terms/cancellation-policy
- **Q4 — but only Peerspace cancels part.** No provision lets a guest or host unilaterally cancel one day; rescheduling needs both parties. DOCUMENTED (same policy).
- **Q5 — payout.** "Processed within 7 days after the **end of the reservation**". DOCUMENTED — https://support.peerspace.com/en/articles/10119524-what-happens-when-i-receive-a-booking-request. A second article says "within 2-10 business days after the booking is completed". DOCUMENTED — https://support.peerspace.com/en/articles/11642753-how-to-send-a-custom-offer-using-the-invite-to-book-feature. The two pages disagree; quote neither as a promise.
- **Q6 — host offer.** Invite-to-book sets date, time, attendees, rental fee, add-ons and a note; guest has **7 days**; acceptance creates a confirmed booking; host can withdraw before acceptance. DOCUMENTED — https://support.peerspace.com/en/articles/10119469-how-do-i-use-the-invite-to-book-feature
- **Q7 — UX.** Date(s) → "Start Booking" → event details → "Request to Book"; the request is financially binding at submission. Confirmed bookings auto-block the calendar; hosts can also block time manually. DOCUMENTED — 10119133 and https://support.peerspace.com/en/articles/10119397-how-do-i-manage-availability-on-peerspace

### Giggster

- **Q1 — multi-day exists as a booking type.** "For multi-day bookings, the payout is issued to the host on the **last day** of production/event." DOCUMENTED — https://help.giggster.com/en/articles/757837-how-does-giggster-s-payment-payout-system-work. The date-picker itself is not described in any help article I could load. Not verified.
- **Q2 — one approval.** Renter sends a request, "the host will either Approve or Deny"; on approval the renter is charged the full amount. DOCUMENTED — https://help.giggster.com/en/articles/809083-how-do-i-book-a-location-on-giggster
- **Q3 — pricing.** Hosts set hourly rates that vary by **crew size and activity type**; no daily or weekly rate is documented. DOCUMENTED — https://help.giggster.com/en/articles/8073915-how-can-i-customize-my-pricing
- **Q3 — availability.** Recurring weekly "Opening Hours" per day of week; calendar sync and blocked times still apply. DOCUMENTED — https://help.giggster.com/en/articles/6805678-opening-hours. Minimum duration not documented.
- **Q4 — pending vs confirmed.** While pending: cancel and submit a new request. Once confirmed: "ask the host to update the booking on their end", guest reviews and approves, then "you will be charged/refunded based on the new booking details". DOCUMENTED — https://help.giggster.com/en/articles/8068311-how-do-i-edit-a-booking-as-a-renter
- **Q4 — refunds are whole-booking.** Terms compute refunds from "the booking start date" and a percentage of the total location fee; nothing prorates days. No renter right to cancel individual days. DOCUMENTED (math) — https://giggster.com/terms §9.F(i); INFERRED (no partial-cancel clause).
- **Q5 — payout.** Within 7 days of the start; for multi-day, on the last day. DOCUMENTED — 757837.
- **Q6 — host offer.** No custom-offer or invitation product documented; only host-side booking edits and add-ons. Not verified.
- **Q7 — UX.** A location agreement PDF is generated from the booking form before the request is sent. DOCUMENTED — 809083.

### Tagvenue

- **Q1 — single date only.** The documented flow is "Select a **date**" then "Pick time slot"; no multi-date control is described. DOCUMENTED — https://support.tagvenue.com/hc/en-gb/articles/360019426357-How-do-I-book-the-Venue. Multi-day booking is therefore unsupported. INFERRED.
- **Q2 — one approval, whole request.** Venue manager accepts or declines; no response → the request auto-expires and any authorization hold is released (up to 5 days for the bank). DOCUMENTED — https://support.tagvenue.com/hc/en-gb/articles/33535283745181-Understanding-booking-expiry-and-response-time-windows
- **Q3 — pricing granularity.** "Hire fee only" allows **per hour or per day, no other options**. "Custom pricing" allows per session / morning / afternoon / evening / day, each with from-to times and days of week. DOCUMENTED — https://support.tagvenue.com/hc/en-gb/articles/360018256258-How-do-I-add-my-prices-and-opening-hours
- **Q4 — whole-booking tiers.** Very Flexible / Flexible / Standard 30 / Standard 60; grace period 24 h after confirmation when at least 48 h before start. DOCUMENTED — https://www.tagvenue.com/blog/steps-to-cancel-your-venue-booking/ (first-party blog; the legal text sits behind the venue agreement). No partial cancellation. INFERRED.
- **Q5 — payout.** Not verified. (A support article exists but I did not fetch it.)
- **Q6 — offers.** None documented; pricing negotiation happens in the enquiry thread, then the booking is paid at the agreed price. INFERRED.
- **Q7 — UX.** Enquiry-first: contact the venue, agree details, then pay; statuses move through enquiry → confirmed. DOCUMENTED — 360019426357.

### Spacebase

- **Q1 — continuous range.** Search takes "check-in & check-out date + time", i.e. a range, not a set of days. DOCUMENTED — https://help.spacebase.com/en/article/how-to-search-for-a-space-wufe9u/. Whether a multi-night range is priced per day is not spelled out. INFERRED.
- **Q2 — two-step commitment.** `BOOK NOW` = booking request, provider confirmation makes it binding. `RESERVE` = non-binding hold valid **3 working days**, then the booker decides. DOCUMENTED — https://help.spacebase.com/en/article/what-is-the-difference-between-a-reservation-and-a-booking-12das4y/
- **Q3 — pricing.** Hourly and daily price on the profile; "some spaces charge a **minimum booking fee**". DOCUMENTED — https://help.spacebase.com/en/article/is-it-possible-to-book-a-space-for-just-a-couple-of-hours-14wqr2i/
- **Q4 — adjustment, not cancellation.** "Adjust booking" → "REQUEST CHANGES" → provider confirms or declines; "most of our spaces accept changes automatically"; only one open adjustment at a time. DOCUMENTED — https://help.spacebase.com/en/article/how-to-adjust-details-of-a-confirmed-booking-how-can-i-update-my-booking-1q2azzm/
- **Q4 — cancellation.** Pending request: free, hold released. Confirmed: "the cancellation policy of the space provider will apply"; a 50% charge example refunds the other 50%; refunds up to 14 days. DOCUMENTED — https://help.spacebase.com/en/article/how-to-cancel-a-booking-iv4xu/
- **Q5 — payout.** Not verified.
- **Q6 — offers.** None documented.
- **Q7 — billing detail worth copying.** The invoice is **not** updated on every change; Spacebase waits **3 days after check-out**, then issues the final invoice. DOCUMENTED — https://help.spacebase.com/en/article/where-can-i-update-the-invoice-after-a-booking-adjustment-15ofyht/

### LiquidSpace

- **Q1/Q2.** Public material only supports "by the hour, day, or month" and an enterprise booking/governance model; no help article on selecting several days or on approval is public. DOCUMENTED (duration) — https://liquidspace.com/pricing; the rest is not verified.
- **Q5/Q6.** Not documented publicly.
- **Relevance.** Low. It is an enterprise workplace platform now; its help center is largely gated. Do not use it as a pattern source.

### Skedda

- **Q1 — recurring, not a range.** Repeat bookings by day / week / month / year, ending by date or occurrence count, with exceptions; biweekly = weekly every 2 weeks. DOCUMENTED — https://support.skedda.com/en/articles/105723-repeat-bookings
- **Q2 — a series is many bookings.** Each occurrence is its own booking; you can edit "a single occurrence, this and following, or the full series", and editing one detaches it from the series. DOCUMENTED — 105723.
- **Q2 — approval.** One request per booking; the admin opens the request, "make changes if needed", then approves. Multiple conflicting requests can coexist and the admin picks. DOCUMENTED — https://support.skedda.com/en/articles/11774950-booking-requests-approvals
- **Q3 — controls.** Booking conditions can enforce maximum duration, fixed durations and fixed start blocks; conditions can be scoped by space, day, time, duration and user tag. DOCUMENTED — https://support.skedda.com/en/articles/112700-booking-conditions
- **Q3 — pricing.** All occurrences in a repeat series must have the same price, or the user must split the series. DOCUMENTED — 105723.
- **Q4 — after approval.** "Only admins can edit bookings once they have been approved"; users can cancel if the venue's lock-in policy allows. DOCUMENTED — 11774950.
- **Q5.** Payment is charged after approval; a repeat series can be charged in one transaction. DOCUMENTED — 11774950 and 105723. No marketplace payout timing (venue is the operator).
- **Q7 — UX.** Approval-required spaces show a stamp icon in day/map view, and only on the days where the rule applies. DOCUMENTED — 11774950.

### Airbnb

- **Q1 — continuous nights.** One check-in/check-out range. Minimum/maximum nights; minimum can be customized by **check-in day** (e.g. 2 nights for Friday check-in, 1 otherwise). DOCUMENTED — https://www.airbnb.com/help/article/880
- **Q3 — controls.** Advance notice 0/1/2/3/7 days; preparation time between bookings; availability window; min/max trip length. If no maximum is set, "a 31-night maximum will automatically be applied". DOCUMENTED — https://www.airbnb.com/help/article/484
- **Q3 — length discounts.** Weekly = 7+ nights, monthly = 28+ nights; discounts of 10%+ show in search, and all discounts appear in the price breakdown. DOCUMENTED — https://www.airbnb.com/help/article/1233
- **Q2 — one decision.** Instant Book or a host-reviewed request; the host accepts or declines the whole reservation. No partial acceptance is documented. DOCUMENTED (whole) — 484; INFERRED (no partial path).
- **Q4 — changes are a negotiation, not a cancellation.** Guests send a trip change request to add/subtract nights, change dates or guests, "any time before checkout — even during their stay". Host accepts (applied automatically, guest charged or refunded) or declines "with no consequences"; there is no response deadline. DOCUMENTED — https://www.airbnb.com/help/article/1504
- **Q4 — host-initiated.** Host can change dates, guests, price or listing and send a request; if the guest declines or does not respond, the reservation "will remain unchanged". One open request at a time; max 3 changes/day and 10 total per reservation. DOCUMENTED — https://www.airbnb.com/help/article/50
- **Q4 — monthly stays self-approve.** For 28+ nights, a change may apply **without host approval** if it is before the trip and still 28+ nights, or if 30+ nights remain to checkout. Shortening a monthly stay to 27 nights or fewer makes the guest liable for "the following 30 days of payment". DOCUMENTED — 50.
- **Q4 — cancellation policy switches with length.** Standard policies cover 27 nights or fewer; 28+ uses the long-term policy, and the applicable policy changes when a trip change crosses that line. DOCUMENTED — https://www.airbnb.com/help/article/475
- **Q5 — payout.** Standard: by the end of the business day after check-in. 28+ nights: first payout then, "future payouts **every 30 days** after the initial payout". New/flagged hosts: after checkout; for 28+ nights, first and second payout together 28 days after check-in. DOCUMENTED — Payments Terms §3.3.1/3.3.3, https://www.airbnb.ca/help/article/2909
- **Q6 — host offer.** Pre-approvals exist and a host trip-change request can carry new dates **and** a new price. The phrase "special offer" is not verified on the pages I loaded; use "host-sent trip change / pre-approval". DOCUMENTED (mechanism) — 50.
- **Q7 — UX.** Weekly/monthly discounts are surfaced in search and in the breakdown; minimum-stay rules are evaluated by check-in date, not per night. DOCUMENTED — 1233, 880.

### Turo

- **Q1 — continuous range.** A trip has a start and end datetime; multi-day is the default shape. DOCUMENTED (change requests operate on start/return times) — https://help.turo.com/en_us/managing-requests-to-extend-or-shorten-a-trip-BJDjrVg45
- **Q2 — approval is conditional.** The system auto-accepts an extension/shortening if the vehicle is available and the change does not conflict with advance notice, pickup/return hours, trip buffer or duration limits; otherwise it goes to the host. DOCUMENTED — same page.
- **Q3 — controls.** Advance notice, pickup/return hours, trip buffer and trip duration settings all constrain what can be booked and auto-approved. DOCUMENTED — same page.
- **Q4 — shorten rules are explicit.** If shortening drops the trip below a discount threshold, "a new discount rate will be calculated … and we'll charge any balance due". For a non-refundable trip shortened more than 24 h after booking, "the unused days won't be refunded and your earnings won't be impacted". DOCUMENTED — same page.
- **Q4 — cancellation is pro-rated by length.** Outside the free window, trips of 2 days or less refund price minus **half a day**; trips longer than 2 days refund price minus **one day's average cost**; protection plan and extras refund in full. Non-refundable trips refund only inside the 24 h grace period. DOCUMENTED — https://help.turo.com/en_us/refund-timing-rkyN44gEc
- **Q5 — payout.** First trip: 3 business days after it ends. Later trips: 3 hours after it ends. "Trips lasting more than a week: Stripe initiates **partial payout every seven days** until the trip has ended." DOCUMENTED — https://help.turo.com/en_us/getting-paid-SyALrVeN9
- **Q6 — offers.** No custom-offer product documented.
- **Q7 — UX.** The system tells the guest up front whether a change will be automatic, need approval, or is not allowed. DOCUMENTED — BJDjrVg45.

### Vrbo

- **Q1/Q3 — length of stay.** Minimum and maximum nights, with date-specific minimum overrides; "the minimum night stay requirement is based on the **check-in date**" (a Thursday check-in can use the weekday minimum even if the stay runs into a 3-night-minimum weekend). Changes apply only to future availability, not existing reservations. DOCUMENTED — https://help.vrbo.com/articles/How-do-I-set-a-minimum-stay-requirement
- **Q4 — change is message-based.** Guest opens the trip, chooses Change or Cancel, and messages the host; "the host should confirm … within **48 hours**"; the host confirms any extra charges or refunds before updating; "your reservation won't be impacted if the host declines the change or doesn't reply". DOCUMENTED — https://help.vrbo.com/articles/How-do-I-change-my-reservation
- **Q4 — one cutoff for the whole booking.** "The policy is always determined by the **check-in date**, not the full stay" — e.g. a Feb 2–24 stay uses the Feb 2 policy for all 22 nights. DOCUMENTED — https://help.vrbo.com/articles/What-are-the-cancellation-policy-options
- **Q4 — custom refunds.** A host may refund above the policy minimum, but not below it. DOCUMENTED — same page.
- **Q2.** Instant Booking and a 24-hour review option exist, but I could not re-fetch that page today. Not verified in this pass.
- **Q5 — payout.** Not verified; the payout article returned an error page.
- **Q6 — offers.** No custom-offer product documented; the custom refund is the only discretionary money lever described.

### Splacer

- No claims. `https://www.splacer.co/` and `https://splacer.co/` both failed TLS negotiation (`SEC_E_ILLEGAL_MESSAGE`, curl code 000) on 2026-10-17, and every article URL failed. The site appears unreachable rather than merely blocking bots. Do not cite Splacer in the design doc.

---

## 3. Common patterns

1. **A multi-day booking is one record with one decision.** Every platform that supports it (Peerspace, Giggster, Airbnb, Turo, Vrbo, Spacebase) creates one booking, one payment, one approval. None documents per-day approval. Skedda is the exception because it sells a *series of separate* bookings, not a range.
2. **Partial acceptance is not a feature.** No platform lets a host accept days 1–3 of a 5-day request. The workaround is always a re-quote (Peerspace invite-to-book) or an amendment after confirmation.
3. **Changing is a request, not a cancellation.** Both sides can propose; the other side accepts or declines; the price delta is charged or refunded automatically. Airbnb, Turo, Peerspace, Spacebase and Giggster all use this shape.
4. **The original booking survives a declined change.** Airbnb ("remain unchanged"), Peerspace ("original booking stays intact"), Vrbo ("won't be impacted"), Spacebase (declined adjustment). Nobody auto-cancels on a failed amendment.
5. **Payout waits for completion, and long bookings are paid in installments.** Airbnb: 30-day cycles at 28+ nights. Turo: 7-day cycles above one week. Peerspace: after the reservation ends. Giggster: on the last day.
6. **Length discounts are threshold-based and retroactive to the whole booking.** Airbnb 7/28 nights; Peerspace 8+ hours applied to the entire booking; Turo recalculates the discount if a shortening crosses the threshold.
7. **Blocked inventory is shown, not explained.** Confirmed bookings auto-block dates (Peerspace, Giggster via sync, Airbnb/Vrbo calendars). None of these help centers documents *why* a specific day is greyed out.
8. **Host-sent offers are rare and concentrated.** Peerspace (invite-to-book) and Airbnb (pre-approval / trip change with price) have them. Tagvenue, Spacebase, Skedda, Turo and Vrbo do not.

## 4. Differences that matter

| Question | Peerspace | Vrbo / Airbnb / Giggster | Turo | Skedda |
|---|---|---|---|---|
| Cancellation clock | **Per day**, each day's own start time | **One clock**, the check-in/start date | One clock, but refund scales with trip length | Per booking; lock-in policy |
| Shortening | Not self-service; support only | Trip change request | System request; auto or manual | Admin edits |
| Who may edit after confirmation | Host reviews guest's update | Either side proposes | Guest proposes, host/system decides | **Admins only** |
| Unit of sale | Chosen dates (may be nonconsecutive) | Continuous range | Continuous datetime range | Recurring series |
| Long-stay money | Held to the end | Paid monthly / at start | Paid weekly | Charged once |

- **Per-day vs whole-booking cutoffs** is the sharpest split. Peerspace protects each day separately; Vrbo explicitly keys the entire stay to check-in. A 5-day booking cancelled on day 2 is five separate refund calculations at Peerspace and one at Vrbo.
- **Automatic vs human approval.** Turo auto-accepts when the calendar and settings allow; Airbnb auto-applies some monthly-stay changes; Peerspace always requires a human. Automation is tied to how mechanical the rule is.
- **Series vs range.** Skedda's repeat bookings are independent rows that can be split ("this and following"); everyone else keeps one range. Splitting is powerful but multiplies cancellation and payout logic.

## 5. What fits a daytime kitchen booking

1. **One booking, N consecutive operating days, one approval, one capture.** This matches every peer except Skedda, and it matches Local Cooks' existing "one booking, N daily visits" direction. Do not create N linked bookings.
2. **Copy Peerspace's per-day cancellation clock, not Vrbo's single clock.** Each kitchen day consumes distinct inventory and has its own cutoffs; a chef who cancels day 4 should not lose day 1–3 money or be forced to cancel the whole range. Compute the refund per day against that day's allocated share, as Peerspace does. This is the single most transferable rule.
3. **Do not copy Airbnb's 30-day liability.** "Shortening a monthly stay makes the guest liable for the next 30 days" is a lodging rule for a lease-like product. For a 3-day kitchen block it would be indefensible.
4. **Use a threshold discount, not weekly/monthly tiers.** "3+ consecutive days" (or 5+) mirrors Peerspace's 8+ hour discount and Airbnb's 7-night threshold. Apply it to the whole kitchen subtotal, exclude equipment and cleaning, and recompute if the range is shortened below the threshold (Turo's rule).
5. **Require the range to be contiguous and refuse gaps.** Peerspace allows nonconsecutive days because event spaces are booked sporadically. A kitchen range with a closed Tuesday in the middle should be refused with "Tuesday is closed", not silently skipped — otherwise the price and the visit count stop matching.
6. **Show every day's price in the breakdown.** Total = Σ daily rate − length discount + equipment; then one line per day. Airbnb and Spacebase both surface the discount in the breakdown; Turo shows the recalculated rate on change.
7. **Amendment = guest request → manager approve → delta charged/refunded, original intact if declined.** Adopt Airbnb's "one open request at a time" and Peerspace's "expires in two business days" rather than an open-ended thread. Reuse the existing 24 h decision window rather than inventing a second one.
8. **Keep the manager's custom multi-day offer.** Peerspace's invite-to-book is the closest analogue to Local Cooks invitations: pick days, set the price, add equipment, send, 7-day expiry, acceptance confirms. It is also the only documented escape hatch for "I'll do 4 days at a custom rate".
9. **Payout after the last day.** Peerspace (end of reservation) and Giggster (last day) both hold to completion. Installment payouts (Airbnb 30 days, Turo 7 days) exist only because those bookings run for weeks; a 2–10 day kitchen block does not need them. Hold until the last visit closes out, consistent with per-visit damage claims.
10. **Buffers belong between bookings, not between days.** Peerspace's buffer is before/after a booking on one calendar. A kitchen closed overnight needs the normal same-day turnover buffer, not a new multi-day buffer concept.

## 6. What I could not verify

- **Splacer** — site unreachable (TLS failure). No findings.
- **Giggster** — multi-day date picker, minimum duration, daily rate, and any custom offer. Only the payout sentence proves multi-day exists.
- **Tagvenue** — payout timing, and whether a venue can counter-offer rather than decline.
- **Spacebase** — payout timing; whether a multi-night range is priced per day.
- **LiquidSpace** — multi-day selection, approval and cancellation; public help is enterprise-gated.
- **Vrbo** — payout timing (article returned an error page), and the Instant Booking / 24-hour review mechanics in this pass.
- **Airbnb** — the term "special offer" for homes; I verified the host trip-change and pre-approval mechanisms instead.
- **Peerspace** — whether a host can accept only some days of a multi-day request (no document says either way).
- **Cloudbeds / hotel practice** — not researched; out of scope for a daytime kitchen.
