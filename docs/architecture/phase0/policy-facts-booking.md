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

## 2. Cancellation and refunds (chef cancels)

| Rule | Enforced in | Status |
|---|---|---|
| Each kitchen chooses a notice period (24, 48 or 72 hours) and a late charge (50% or 100%). The policy in force when the chef books is frozen on that booking; later changes never apply to it. | `shared/cancellation-policy.ts`, `cancellation_policy_snapshot` | verified |
| Cancel before the deadline: full refund of everything paid (kitchen time, add-ons, HST and the Local Cooks service fee) minus the **actual** card processing fee, shown in dollars before confirming. | `shared/cancellation-refund.ts` | verified (Oct 15, #167: $30.50 → $29.07, $1.43 kept) |
| Cancel after the deadline: the chef pays the late charge as a percentage of the **booking total** (not just kitchen time). | cancellation engine; copy fixed Oct 15 (A) | verified engine; copy built |
| Booking inside the window: shown before paying ("once the kitchen confirms, you pay …"); no grace period after confirmation (owner, Oct 15; matches The Food Corridor). | `cpShort`, `cpNearDeadline` | verified copy (A); near-deadline built |
| Kitchen cancels: the chef gets a full refund, including the processing fee. | `cause: 'kitchen'` remedy | verified (earlier, #158) |
| Refund timing: issued immediately; banks usually show it in 5–10 business days. | notices | verified |

## 3. Arrival, extra time, departure

| Rule | Enforced in | Status |
|---|---|---|
| Check-in opens 15 minutes before the start (kitchen setting). Staffed kitchens give a 6-digit code in person; kitchens can allow self check-in. Late arrival never moves the end time. | visit code challenge, `kitchen-visit-lifecycle.ts` | verified |
| Early start only when the kitchen grants it (free ≤ 30 min or paid offer; kitchen chooses). | session extensions | verified (earlier) |
| **Extra time:** the chef can ask any time while checked in (owner Oct 14; last-hour gate removed Oct 15). The kitchen approves with a charge, approves for free, or declines; instant mode if the kitchen enables it. Only free time is offered. A card hold is placed and charged only on approval. Extra time is non-refundable once added. Requests expire after 15 minutes. | `server/services/session-extensions.ts` | verified (Oct 15, $15.26) — re-verify window change |
| Overstay: the kitchen can record when the chef left and send an extra-time charge (30-minute blocks); the chef pays or disputes; never charged automatically; unanswered after 48 h → Local Cooks. | session extensions (extra_time) | verified (earlier) |
| Checking out early does not refund unused booked time (confirmed before checkout). | visit page | built (B) |

## 4. Inspection, damage and cleaning

| Rule | Enforced in | Status |
|---|---|---|
| After checkout the kitchen inspects within 24 hours; if it doesn't, the visit closes automatically. | clock closeout | verified |
| The kitchen can report damage or extra cleaning within 72 hours of the chef's departure (or the booked end), once per visit, up to $250 in-app, with a receipt, invoice or quote for each cost. No fines or lost revenue. Larger amounts: Local Cooks helps directly. | `damage-claims-v2.ts` | verified (Oct 15: one-per-visit 409) |
| Local Cooks reviews every claim before the chef is contacted; it may ask the kitchen for more information, reduce, close, or pay the kitchen itself at no cost to the chef. What the kitchen tells Local Cooks during review is never shown to the chef. | `damage-claims-v2.ts` (privacy) | verified (Oct 15: page + API) |
| The chef has 72 hours to pay (saved or new card, confirmed by the chef) or dispute; disputes and unanswered claims return to Local Cooks for a final decision. Cards are never charged automatically for a claim. | claim payment | verified (Oct 15, $70) |
| If an upheld claim is still unpaid 7 days after the final decision, the chef can't make new bookings until it's paid or resolved; existing bookings are unaffected. | booking hold | verified (earlier) |
| The kitchen receives the full approved amount; Local Cooks absorbs the processing fee. Claims never hold the booking payout. | claim transfer | verified (Oct 15, $70 transfer) |

## 5. Payouts (kitchens)

| Rule | Enforced in | Status |
|---|---|---|
| Payout = what the chef paid minus the Local Cooks service fee and the actual card processing fee; HST collected is included and the kitchen remits it. | payout statement | verified (Oct 15: $54.94) |
| Paid after the visit: as soon as the kitchen finishes the inspection, or automatically 24 hours after the visit ends. Extra-time charges are paid out with the booking (net of their own processing fee). | `kitchen-payout-service.ts` | verified (Oct 15: $54.94 + $13.52, one notice) |
| One "You've been paid" notice per payout run. | payout notice batching | verified |

## 6. Open items before the policy page

- Re-verify every `built` row live after the next deploy.
- Service fee (owner, Oct 15): the page says Local Cooks "may charge a service fee", always shown before paying; no percentage on the
  page (it may be $0 during the pilot and will likely depend on the kitchen's subscription tier).
- Storage: separate policy section after the storage rebuild.
- Current Terms/Privacy (Sept 7, 2025) are meal-marketplace only and conflict in places — see `policy-gap-review.md`.
- Legal review (owner confirmed, Oct 15): the drafted page will be reviewed by a lawyer familiar with Newfoundland and Labrador consumer protection
  (the Consumer Protection and Business Practices Act) and Canadian e-commerce disclosure rules before publishing — the lead
  can draft to top-platform clarity, but the binding wording needs counsel.
