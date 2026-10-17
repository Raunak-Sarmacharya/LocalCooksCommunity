# Kitchen booking — policy facts register

Source of truth for the public policy page (Terms for chefs and kitchens, Cancellation & refunds, Extra time, Damage & cleaning,
Payouts). Every rule below is what the product ENFORCES today, with the code that enforces it, and the date it was verified live.
The policy page is drafted only from rows marked **verified**; a row changes here first whenever the code changes.

Status: `verified` (live on dev with real sandbox money) · `built` (code + tests, not yet live-verified) · `open` (owner decision pending).

## 1. Requesting and confirming a booking

| Rule | Enforced in | Status |
|---|---|---|
| Chefs book only kitchens that approved their access application. | booking routes / access checks | verified (Oct 15) |
| Kitchens set their own hourly rate, minimum/maximum booking length and advance notice; the chef sees the total (kitchen time, add-ons, HST at the kitchen's rate, Local Cooks service fee) before paying. | `KitchenBookingFlow.tsx`, `BookingPriceSummary.tsx`, `@shared` pricing | built (B) — re-verify after deploy |
| Requesting places a card **hold**; the chef is charged only if the kitchen accepts. Declined or expired requests release the hold. | `stripe-checkout-service.ts` (manual capture), `booking-payment-decision.ts` | verified (Oct 15, #166/#167) |
| The kitchen may accept or decline each requested item (kitchen time, each add-on) separately. | manager review dialog | verified (Oct 15) |
| The kitchen must respond within 24 hours of the request, and never later than its admin-set buffer before the start. | `shared/booking-response-deadline.ts`, `auth-expiry-service.ts` | verified (earlier) |
| **New (owner, Oct 15):** when the chef still has free cancellation, the kitchen must respond at least 1 hour before free cancellation ends (if that leaves ≥ 30 minutes to respond). Requests made closer than that show an explicit checkout warning. | `freeCancelResponseCap`, `CheckoutCancellationDisclosure.tsx` (`cpNearDeadline`) | built — verify after deploy |
| The chef can withdraw a pending request at no cost (the whole hold is released). | cancellation engine | verified (earlier) |
| **Changing a pending request (owner, Oct 16): rebook first.** The chef sends the changed request (new time/length/add-ons) with a new card hold; the earlier request is withdrawn and its hold released only once the new one is sent. The kitchen gets one "changed their request" notice and a fresh response window. If the kitchen accepted the original first, the chef keeps it; a change that overlaps it fails with no charge, a different time leaves two bookings and the chef is told to cancel the one they don't need (the new request can be withdrawn at no cost). | `booking-replacement.ts`, `booking-checkout-fulfillment.ts` | verified live (Oct 16, #187→#188; race #189) |

## 2. Cancellation and refunds (chef cancels)

| Rule | Enforced in | Status |
|---|---|---|
| Each kitchen chooses a notice period (24, 48 or 72 hours) and a late charge (50% or 100%). The policy in force when the chef books is frozen on that booking; later changes never apply to it. | `shared/cancellation-policy.ts`, `cancellation_policy_snapshot` | verified |
| Cancel before the deadline: full refund of everything paid (kitchen time, add-ons, HST and the Local Cooks service fee) minus the **actual** card processing fee, shown in dollars before confirming. | `shared/cancellation-refund.ts` | verified (Oct 15, #167: $30.50 → $29.07, $1.43 kept) |
| Cancel after the deadline: the chef pays the late charge as a percentage of the **booking total** (not just kitchen time). | cancellation engine; copy fixed Oct 15 (A) | verified engine; copy built |
| Booking inside the window: shown before paying ("once the kitchen confirms, you pay …"); no grace period after confirmation (owner, Oct 15; matches The Food Corridor). | `cpShort`, `cpNearDeadline` | verified copy (A); near-deadline built |
| Kitchen cancels: the chef gets a full refund, including the processing fee. | `cause: 'kitchen'` remedy | verified (earlier, #158) |
| Refund timing: issued immediately; banks usually show it in 5–10 business days. | notices | verified |
| Wording (owner, Oct 16): "Cancel by {deadline} for a refund, minus the {fee} card processing fee. After that, this booking isn't refundable." The cancel dialog leads with "You'll get $X back" and a breakdown (paid · already refunded · kept under the policy · card fee · refund). Never "free" when a fee is deducted. | `booking.json` cp*, `BookingCancellationChooser.tsx` | verified (Oct 16, #185: $30.50 → $29.07) |
| **No-shows** aren't refunded at any kitchen, whatever its late charge (owner, Oct 15); disclosed at checkout. The kitchen answers "Did they come?" within the inspection window; its answer never moves money. The chef can contest with "I was there", which goes to Local Cooks as a problem report. Admins are told about no-show reports. | WP-N, `booking-attendance-service.ts` | verified (Oct 16, #182) |
| **Removing an add-on** (owner, Oct 16, decided — to build): instant under the booking's own policy. Before the refund deadline the chef sees the refund for that part first and is refunded at once, minus the card processing fee on that part; included (free) equipment is removed with no money. After the deadline the add-on follows the booking's late tier (50% kitchens refund 50% of it, minus its card-fee share; 100% kitchens refund nothing). Kitchen is told; payout adjusts. If the kitchen was already paid, the chef is still refunded and the kitchen's share is recorded as owed and recovered manually by Local Cooks (owner, launch). Today it waits for the kitchen's Accept/Decline and shows no amount (finding #177). | cancellation engine | verified (Oct 17, #197 KB-CUM9TY: oven removed → $29.22 refunded at once, kitchen payout −$27.47, admins see card fee kept $1.28) |
| **Changing a confirmed booking** (owner, Oct 16, decided — building): the chef can request a new date/time/length until the refund deadline; the kitchen always approves; it answers within the new-request rule (≤24 h, ≥1 h before the chef's refund deadline); declined/expired = unchanged. Price up: the difference is charged (card hold at request, captured on approval). Price down: the difference is refunded minus the card fee on it. The refund deadline follows the new time. Single-visit bookings only at launch. | WP-RS | verified (Oct 17, #197: 7–8 → 8–10 a.m., +$30.50 held then captured on approval; needed migration 0098; admin recovery screen added) |
| **Changing a pending request** (owner, Oct 16): rebook first; the old request is withdrawn automatically (hold released) only once the new one is sent. | WP-RB | verified (Oct 16, #187 → #188) |

## 3. Arrival, extra time, departure

| Rule | Enforced in | Status |
|---|---|---|
| Check-in opens 15 minutes before the start (kitchen setting). Staffed kitchens give a 6-digit code in person; kitchens can allow self check-in. Late arrival never moves the end time. | visit code challenge, `kitchen-visit-lifecycle.ts` | verified |
| Early start only when the kitchen grants it (free ≤ 30 min or paid offer; kitchen chooses). | session extensions | verified (earlier) |
| **Extra time:** the chef can ask any time while checked in (owner Oct 14; last-hour gate removed Oct 15). The kitchen approves with a charge, approves for free, or declines; instant mode if the kitchen enables it. Only free time is offered. A card hold is placed and charged only on approval. Extra time is non-refundable once added. Requests expire after 15 minutes. | `server/services/session-extensions.ts` | verified (Oct 15, $15.26) — re-verify window change |
| Overstay: the kitchen can record when the chef left and send an extra-time charge (30-minute blocks); the chef pays or disputes; never charged automatically; unanswered after 48 h → Local Cooks. | session extensions (extra_time) | verified (earlier) |
| Checking out early does not refund unused booked time (confirmed before checkout). | visit page | built (B) |
| **Can't get in / safety:** from check-in opening, the chef (or kitchen) can report a problem; the kitchen, every Local Cooks admin and the chef are told at once, and the chef can message the kitchen from the check-in screen. An open report holds the kitchen's payout until Local Cooks reviews it. Emergencies: call 911 first. | `commitment-problems.ts`, `VisitCodeField.tsx`, `OpenProblemAlert.tsx` | verified live (Oct 16, #189) — copy fix pending deploy |

## 4. Inspection, damage and cleaning

| Rule | Enforced in | Status |
|---|---|---|
| After checkout the kitchen inspects within 24 hours; if it doesn't, the visit closes automatically. | clock closeout | verified |
| The kitchen can report damage or extra cleaning within 72 hours of the chef's departure (or the booked end), once per visit, up to $250 in-app, with a receipt, invoice or quote for each cost. No fines or lost revenue. Larger amounts: Local Cooks helps directly. | `damage-claims-v2.ts` | verified (Oct 15: one-per-visit 409) |
| Local Cooks reviews every claim before the chef is contacted; it may ask the kitchen for more information, reduce, close, or pay the kitchen itself at no cost to the chef. What the kitchen tells Local Cooks during review is never shown to the chef. | `damage-claims-v2.ts` (privacy) | verified (Oct 15: page + API) |
| The chef has 72 hours to pay (saved or new card, confirmed by the chef) or dispute; disputes and unanswered claims return to Local Cooks for a final decision. Cards are never charged automatically for a claim. | claim payment | verified (Oct 15, $70) |
| If an upheld claim is still unpaid 7 days after the final decision, the chef can't make new bookings until it's paid or resolved; existing bookings are unaffected. Paying lifts the pause at once. | booking hold | verified (Oct 16, claim #11: checkout 403 while held, released on payment) |
| The kitchen receives the full approved amount; Local Cooks absorbs the processing fee. Claims never hold the booking payout. | claim transfer | verified (Oct 15, $70 transfer) |

## 5. Payouts (kitchens)

| Rule | Enforced in | Status |
|---|---|---|
| Payout = what the chef paid minus the Local Cooks service fee and the actual card processing fee; HST collected is included and the kitchen remits it. | payout statement | verified (Oct 15: $54.94) |
| Paid after the visit: as soon as the kitchen finishes the inspection, or automatically 24 hours after the visit ends. Extra-time charges are paid out with the booking (net of their own processing fee). | `kitchen-payout-service.ts` | verified (Oct 15: $54.94 + $13.52, one notice) |
| One "You've been paid" notice per payout run. | payout notice batching | verified |

- **Lead decision, owner may override (Oct 16):** if a confirmed-booking change was refunded (cheaper new time) but the move can no longer be applied, Local Cooks can close it and the booking stays at the original time; the chef keeps the refund and Local Cooks absorbs the difference — the kitchen's payout is not reduced further. Rare recovery case only.

## 5a. Chargebacks (card disputes)

| Rule | Enforced in | Status |
|---|---|---|
| A chargeback flags the booking for Local Cooks within seconds of Stripe's notice; every admin gets an in-app notice with the amount, the bank's reason, the Stripe response deadline and a dashboard link (email only for admins with the toggle). | `booking-support-flags.ts` `chargebackCopy` | verified (Oct 16: KB-DJGQMP, $30.50 "fraudulent", flag + 5 admin notices); new wording built |
| While a chargeback is open, refunds for that booking are paused (the bank already returned the money). | `booking-money-guard.ts` | built |
| **Pilot (owner, Oct 16): Local Cooks absorbs chargebacks.** The kitchen is still paid for a delivered session; a lost dispute (amount + Stripe's $15 dispute fee) is Local Cooks' cost. | `kitchen-payout-service.ts` (chargeback flags don't hold payouts) | built |
| Local Cooks answers chargebacks in the Stripe Dashboard with the booking's evidence (accepted policy, check-in/out, inspection, receipt, messages); Stripe also emails the account owner deadline reminders. A won, lost or closed dispute closes the flag and tells admins the outcome. | Stripe Dashboard; `booking-support-flags.ts` | built |
| The chef's Terms already say they agree not to charge back unless Local Cooks mishandled the payment, and fraudulent chargebacks may end the account. No automatic booking pause yet (rare; admins act case by case). | `TermsContent.tsx:694` | open (later: pause new bookings like Turo) |

## 5b. Storage rentals (standalone; owner decisions plan-storage-rentals-2026-10.md §7)

| Rule | Enforced in | Status |
|---|---|---|
| Storage is rented on its own (not inside a kitchen session). A listing is a kind of storage with a count of units (Food Corridor model); each rental takes one unit for its dates, so several chefs can rent one listing until every in-service unit is taken. The database refuses two renters on one unit for overlapping dates. | `storage-rentals.ts`, btree_gist constraint (0093) | verified (Oct 16: #43 unit 1, #44 unit 2; listing then "Available from Oct 28") |
| Daily price only; a term is 1–30 days (platform max, admin setting; a kitchen may set lower); start within 14 days. | `shared/storage-rental.ts`, `storage-settings.ts` | verified (request page offers 1–30 days, 15 start dates) |
| Start dates that are full are greyed out; the page starts on the first free day; a full date is refused before any card hold. | `ChefStorageRequestPage.tsx`, quote `full` | verified |
| Only chefs approved at the kitchen can rent; others see the listing and "Apply to this kitchen first". | `storage-rentals.ts` `approval_required` | built |
| Request = card hold for the full term; the kitchen answers within 24 h; withdraw is free while pending; decline/expiry releases the hold. Kitchen + all admins notified in-app (email per admin toggle). | `storage-rentals.ts`, `storage-rental-notices.ts` | verified (#43: $12.82 hold, kitchen + 5 admins notified; approve captured) |
| **No automatic charges.** Nothing renews. To keep the space the chef taps Extend (only when 14 days or fewer remain) and pays now; Stripe keeps the card on file for this, charged only when the chef taps Pay; bank checks (3-D Secure) shown on the spot; a decline falls back to "Pay with another card" (Stripe Checkout). | `storage-extensions.ts` (`setup_future_usage: on_session`, `off_session: false`) | verified (Oct 16: one tap, $12.82, paid through Oct 29) |
| Cancellation after approval and before the start follows the kitchen's booking cancellation policy (same notice/late charge), refund minus the actual card fee; the request page says it applies to storage. | `beforeStartRefund`, `stcDiscCancel` | built (copy verified) |
| Ending early is not refunded (the kitchen may refund unused days). | `stcDiscEarly`, kitchen Refund tool | built |
| 5 extra days after the paid-through date to extend at the same price (grace); after that the kitchen may raise a holdover charge at the daily price, or waive it; the chef pays or disputes within 72 h. Never charged automatically. | `storage-rental-lifecycle.ts` | built (unit-tested) |
| **Holdover money (owner, Oct 17): paid to the kitchen at once** when the chef pays (days already used; the chef agreed by paying), less the card fee and Local Cooks' commission. The chef pays with Stripe Checkout ("Holdover · {listing}") and returns to the rental; chef, kitchen and all admins get one notice with the amount incl. tax. | `createPenaltyPaymentCheckout`, `reconcileObligationPayment` | verified (#3: $5.18 paid, $4.01 transferred); new notices built |
| Holdover ≥ 15 days → Local Cooks removal review (accrual frozen). After Local Cooks' final notice the kitchen may discard perishables after 48 h and other items after 7 days (photos + item list, never sold) — disposal toggle OFF until counsel signs. | `storage-rental-lifecycle.ts` | built |
| Never moved in = like a no-show: from 7 days after the start the kitchen may release the unit; no refund; chef can dispute via "Report a problem". | `storage-rental-actions.ts` `release` | built |
| Move in / move out with optional photos (no move-in photos → claims show "No move-in photos were taken."); the kitchen clears the move-out, or it auto-clears after the review window. | `storage-checkout-service.ts` | verified (#43 move-in; #44 move-out → kitchen "Clear move-out" → ended/cleared) |
| Damage/cleaning claim: within 72 h of move-out, one per move-out, $250 cap, Local Cooks reviews first. | `damage-claims-v2.ts` storage branch | built |
| Kitchen reclaim ("move out by"): not for rentals of 7 days or fewer (emergencies via Local Cooks); otherwise 7 days' notice (or the time left); unused days refunded, kitchen-funded. | `storage-rental-actions.ts` `move-out-by` | built |
| No deposit. | — | built |
| **Kitchen payout = end of each paid term** (each extension pays at its own end); earlier when the kitchen clears the move-out itself (it inspected, so no claim window); an auto-cleared move-out waits for the 72 h claim window. Paused while a problem/claim/flag is open; chargebacks never hold it (pilot: Local Cooks absorbs). The kitchen sees "You'll be paid $X on {date}" (its net, after the Local Cooks fee). | `storage-payouts.ts`, transfer gate | verified (#43 term 1 $12.08 on Oct 23, term 2 $12.08 on Oct 30; #44 eligible on clear) |
| Kitchen board: every unit with status and occupant, summary "Occupied X / Y" (out-of-service units excluded from capacity), requests first. Per-unit "Take out of service / Put back" (reason required) blocks new rentals on that unit only; pausing the listing stops all new requests. | `ManagerStorageBookingsPage.tsx`, `storage-availability.ts` | verified (fridge out of service → chef "Full right now", Continue blocked; put back) |
| Deleting a kitchen, location or account is blocked while a rental is requested/reserved/active/moving out/in removal review, or a storage payout is unreleased. | `deletion-guard.ts` | built (real-Postgres test) |

## 6. Open items before the policy page

- Re-verify every `built` row live after the next deploy.
- Exceptions after the refund deadline: owner chose not to advertise an exception path in the terms (Oct 16); chefs still have "Contact Local Cooks" on every booking. Decide with counsel whether the page needs an extenuating-circumstances clause (Airbnb has one).
- Service fee (owner, Oct 15): the page says Local Cooks "may charge a service fee", always shown before paying; no percentage on the
  page (it may be $0 during the pilot and will likely depend on the kitchen's subscription tier).
- Storage: separate policy section after the storage rebuild.
- **Production deploy check (storage):** storage listings' `base_price` now means a DAILY price in cents (WP-ST2). Before deploying to production, read every existing production storage listing's price and pricing model and convert monthly prices (or confirm there are none) with the owner — never change prod data without the owner's go-ahead.
- Current Terms/Privacy (Sept 7, 2025) are meal-marketplace only and conflict in places — see `policy-gap-review.md`.
- Legal review (owner confirmed, Oct 15): the drafted page will be reviewed by a lawyer familiar with Newfoundland and Labrador consumer protection
  (the Consumer Protection and Business Practices Act) and Canadian e-commerce disclosure rules before publishing — the lead
  can draft to top-platform clarity, but the binding wording needs counsel.
