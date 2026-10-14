# Build plan: damage & cleaning claims (lead-authored 2026-10-14)

## Research basis
- **Airbnb:** the host requests within 14 days of checkout; the guest has 72 h to pay or decline; Airbnb reviews both sides and can pay the host (AirCover). ([Hostfully summary](https://www.hostfully.com/blog/how-to-file-airbnb-aircover-claim/), [Airbnb ANZ FAQ](https://www.airbnb.com/e/anz-prohost-resource-centre-faq))
- **Peerspace:** report within 72 h of the booking end; third-party receipts/estimates required; no arbitrary fines (cleaning labour as a fine, lost revenue); dispute resolution by Peerspace. ([Peerspace help](https://intercom.help/peerspace-108cf19aff8e/en/articles/10119177))
- **The Food Corridor:** billing software that charges fees to the card on file. Not adopted for marketplace claims.

## Owner decisions (Oct 14) — FINAL
1. The kitchen files within **72 h** of the visit ending (actual departure if recorded, else the booked end).
   - Types: **damage** (repair/replacement) and **extra cleaning**, each line itemized with a receipt, invoice or quote (an upload is required per line).
   - The check-in/checkout photos and notes are attached automatically. No fines, no lost revenue.
2. **Cap $250 per claim.** Larger claims can't be filed in-app: "For amounts over $250, Local Cooks handles it with you" → opens a support case prefilled with the details.
3. The chef has **72 h**: **Pay {amount}** (one tap, on-session with the saved card; the card can be updated on the payment screen) or **Dispute** (required note + optional photos).
4. Disputed or unanswered after 72 h → a Local Cooks review in the support desk. Admin actions (audited `support_actions`, reason + internal note required):
   - **Uphold** (full or reduced amount) → the chef gets a one-tap "Pay {amount}" request.
   - **Reject** → closed; both sides told why (shared message).
   - **Local Cooks pays the kitchen** (any time) → a platform-balance transfer to the kitchen for the approved amount (funded_by local_cooks; reuse the goodwill/exception pattern: ≤ $250 here by the cap). The admin chooses "Chef still owes Local Cooks" or "Write off".
   - **Close** with a reason.
5. **Never auto-charged.** If the chef doesn't pay an upheld claim within **7 days**, their account can't make NEW bookings until it's resolved with Local Cooks (existing bookings untouched). Banner: "You have an unpaid charge from {kitchen}. Pay it or contact Local Cooks to keep booking." The hold lifts automatically on payment, rejection, write-off, or admin release.
6. **Disclosure:** the Terms of Service + booking-policy page get a plain "Damage and cleaning" section. Checkout keeps its neutral acknowledgement; there is NO new checkout warning.
7. **Payout:** a damage claim does NOT hold the booking's kitchen payout (only chargeback/manual support flags hold). Fix the existing behaviour where a filed issue/claim holds the payout (`payoutEligibility` reported_issue — keep holds for flags; review whether `commitment_problems` should still hold — keep holding only for problems the CHEF reported against the kitchen). The claim payment is its own charge; the kitchen's share is transferred when the chef pays, or Local Cooks transfers it from the platform balance.

## Stripe safety
- No holds/authorizations in this flow (nothing to expire). The chef payment is a new PaymentIntent confirmed on-session at tap (3DS supported via Stripe.js). Saved PaymentMethods persist until the card expires; the payment sheet allows a new card.
- The Local Cooks compensation is a `transfers.create` from the platform balance without `source_transaction` (supported in separate charges & transfers). It checks available balance first and shows a clear admin error if insufficient; idempotent operation keys; decisions persisted before Stripe I/O; `booking_flags` freeze respected.
- Fees on the claim charge: the kitchen receives the claim amount minus the actual Stripe processing fee? **NO** — the kitchen should be made whole: Local Cooks absorbs the processing fee on claim payments in the pilot (record as platform cost). The kitchen gets the full approved amount.

## Reuse vs replace
`server/services/damage-claim-service.ts` (legacy, includes off-session charging) + the admin "Damage Claims" UI. Inventory it, reuse the data model where sound, REMOVE the off-session auto-charge path from the claim flow, and route reviews through the booking support desk (`booking-support.ts`, a new action set). A migration only if needed: `0082_damage_claims_v2.sql` (write only; RLS + revokes).

## UX (intuitive, uncluttered — consequence-first)
- **Manager** (booking page after the visit + inspection page): "Report damage or extra cleaning", a guided 3-step sheet:
  1. what happened (type, description, the auto-attached visit photos to pick from + new photos);
  2. cost lines with a required receipt/quote each; the total with a cap indicator;
  3. review: "{chef} has 72 hours to pay or dispute. If they dispute, Local Cooks reviews both sides. Your payout for this booking isn't affected."
  - Status timeline afterwards (Sent → Chef paid / Disputed → Local Cooks decision → Paid to you).
- **Chef** (email + in-app + booking page card): "{kitchen} reported {type}: {amount}", photos, receipts, the kitchen's note, a deadline. Buttons **Pay {amount}** / **Dispute**. A plain explanation of what happens next.
- **Admin** (support desk case): a claim panel with evidence side by side (check-in vs checkout photos, receipts, both statements) and the actions above with consequence lines.
- Notices at every step, to both sides, people-language, kitchen-local times.

## Tests
- Filing validation (72 h window, cap, receipts per line).
- The chef pay/dispute paths.
- Escalation at 72 h (bounded worker, index-backed, early exit).
- Admin uphold/reduce/reject/compensate (write-off vs owed)/close.
- The 7-day booking hold applied/lifted.
- The payout NOT held by claims; flags still hold.
- Compensation transfer idempotency + insufficient balance.
- No auto-charge anywhere in the flow.
- Full suites vs baseline.

Output: `.phase0-harness/damage-claims-checkpoint.md`.

## AMENDMENT (owner, Oct 14) — Local Cooks reviews EVERY claim before the chef sees it (Peerspace-style)
Supersedes decisions 3–4 where they conflict:
- Kitchen files → status `in_review`; kitchen sees "Local Cooks is reviewing your claim. We'll update you within 2 business days." Admins get email + in-app alert with CTA to the support-desk claim panel.
- Admin first-review actions: **Send to chef** (full or reduced; reduction note shared with kitchen), **Ask kitchen for more info** (paused; kitchen gets a request + reply/upload; returns to review), **Close** (reason shared with kitchen; chef never notified), **Local Cooks pays the kitchen** (closed, no cost to chef).
- Only approved claims reach the chef → 72 h to **Pay** (one tap) or **Dispute** → dispute/no response returns to admin for a **final decision**: uphold (full/reduced), reject, or Local Cooks pays. Admin can **withdraw** a claim at any stage at no cost to anyone.
- Unpaid after final decision → 7-day booking hold (unchanged). Never auto-charged (unchanged).
- Future-proof: a platform setting `damageClaimsReviewFirst` (default true) so small claims could later go straight to the chef; implement the setting but keep default true.
