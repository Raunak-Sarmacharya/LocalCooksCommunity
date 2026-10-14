# Booking policy proposals: independent Opus review

2026-10-11 · `development` · one bounded Claude Opus 5.5 High review. I read local docs and source and checked public official pages. I ran no tests, made no provider or resource calls, read no environment secrets, and changed nothing except this file. The recommendations reviewed here are **proposals, not owner-approved policy**. The target architecture is still gated. I select no numeric threshold.

Evidence classes (F/R/T/O/E/I/J/Q) follow [booking-current-state.md](booking-current-state.md). No T or O evidence was produced here.

**Verdict (J):** the direction holds up: fault falls on whoever breaks the promise, timely requests are protected, and full-refund windows are honest. As written, though, four proposals hand Local Cooks the cost while the funds sit elsewhere. Those are R1–R4 below. Each has a simple fix that needs no fault engine.

## Ranked objections

### R1. "The customer gets everything back and the responsible party bears the cost" is unfunded at the moment it applies (highest)

- **Who Stripe debits [R/E].** Charges are separate charges and transfers on the platform (`stripe-checkout-service.ts:338`). The connected accounts are Express (`stripe-connect-service.ts:60`). Stripe debits the platform for refunds and disputes on separate charges and transfers. A transfer reversal works only if the connected account's *available* balance covers it, or connected reserves exist. With Express, "your platform is responsible for losses."
- **When the kitchen is paid [R/I].** The manager transfer is triggered from the payment-success and charge-update handlers (`webhooks.ts:1918` `handlePaymentIntentSucceeded`; `:3421` `handleChargeUpdated`). That happens around capture, not after the session. By the time a kitchen cancels, the kitchen's share may already be in its bank, and the payout schedule is Q. So "assigned internally to the kitchen under contracts" means in practice that the platform pays first and then chases a receivable.
- **Fees not returned [E].** Stripe does not return original processing fees on a refund. A full refund therefore costs the platform at least the processing fee plus the platform fee it gives back. It costs the entire kitchen share as well if the reversal fails.
- **Market practice [E].** Peerspace refunds host cancellations "including any Fees paid" and cancels the host's payouts. Airbnb withholds refunds from future host payouts.
- **Simplest startup-safe adjustment (J):**
  - Refund the customer first, from the platform, on a defined default. Never make the customer's refund depend on recovering money from the kitchen.
  - Recover in this order: transfer reversal, then offset against the kitchen's future transfers, then an invoice.
  - Get a contract clause authorizing set-off. That is a legal Q.
  - Alternatives to evaluate later, not choose here: (a) move the transfer from capture to session start or completion. Stripe allows holding funds "with a clear purpose", for 90 days in Canada. (b) Keep transfers at capture and accept the receivable risk while volume is small. (c) A per-kitchen reserve.
  - Option (a) also removes most reversal-failure risk for every cancellation path. It is the strongest candidate, but it delays kitchen cash flow, so it is an owner and commercial decision.

### R2. Gross versus net inside a full-refund window: only the pre-capture stage costs nothing

- **What the code does now [R].**
  - The manager refund is `captured − processingCost − serviceFee − retainedUsedAddons` (`shared/cancellation-refund.ts:42`).
  - The copy says confirmed cancellations "may retain" processing costs and service fees (`kitchen-booking-policies.ts:11`).
  - Pre-confirmation copy promises 100% "including taxes and fees" (`:8`). That holds only on the modern manual-capture path (Opus A10).
- **Cost by stage [E].** Cancelling an uncaptured PaymentIntent costs nothing. A refund after capture loses the processing fee. Some refunds issued shortly after the charge settle as fee-free reversals, but that depends on the pricing plan and is not a guarantee.
- **How others draw the line [E].**
  - Vrbo returns commission and processing fees only on a full refund.
  - Peerspace's 24-hour grace period applies only if the booking is also at least 48 hours before the event.
  - Giggster's terms make the renter processing fee non-refundable.
- **Objection.** "No separate customer deduction inside an advertised full-refund window" is sound consumer UX. But if that window extends past capture, the platform or kitchen pays for every voluntary cancellation. This creates the zero-cost abuse loop in R6.
- **Adjustment (J).** Anchor the costless, no-questions full return to the **pre-capture** stage, where it really costs nothing. After capture, choose one of these:
  - (a) a full-refund window the platform knowingly absorbs, bounded by the saved cutoff schedule and monitored;
  - (b) a disclosed net-of-processing refund, shown on the preview as a line item;
  - (c) refunds only under the cutoff schedule.

  I recommend (a) at startup volume, with a cancellation-rate trigger for moving to (b). Any choice must make "100%" copy true on every live path, including the legacy paid-pending 409 (`bookings.ts:2284`).

### R3. Tier 3 plus current documents is right, but "current" needs a reference date and a rule for lapses after confirmation

- **The gate today [R].** Booking unlocks at tier 2 or higher and self-creates a permanent access row (`chef.service.ts:188-197`). The UI treats tier 3 as final (`chef-application.service.ts:389`). Existing access rows take precedence and survive rejection (A2). The chef's document expiry dates (`schema.ts:1680,1686`) are validated only at tier review. Kitchen licence expiry is checked when booking (`schema.ts:377`), not at the session.
- **Objections.**
  - (1) "Current at booking" lets a certificate that expires mid-way between booking and session through. That produces a later dispute about who broke the promise.
  - (2) Switching to tier 3 strands existing tier-2 self-granted rows and any bookings made under them. The proposal needs a rule for those grandfathered rows.
  - (3) The symmetric case is missing. A kitchen licence or inspection lapse is the kitchen being unable to supply, so R1 applies.
- **Adjustment (J).**
  - Require each mandatory document to be valid **through the end of the session** at request and again at confirmation. This removes most lapses after confirmation without any monitoring job.
  - Remaining revocations (an insurer cancels, a regulator acts) go to admin case review. The default holds the booking and gives no automatic forfeit.
  - Treat existing tier-2 access as a one-time admin review list, not a silent revocation.
- **Q.** Which documents are mandatory, and who may waive them, is a legal, insurer and kitchen decision. I make no claim about what the law requires.

### R4. Protecting a timely cancellation means the manager has no role in deciding the outcome

- **The trap today [R].** Acceptance requires both request time and current time before the cutoff (`booking-cancellation-refund.ts:62-63`). The worker skips paid requests (`scheduled-cancellations.ts:47`), and its comment requires manager acknowledgement of the quote. The admin copy claiming auto-accept is false (A5).
- **Objection.** "No veto" while keeping a manager acceptance step still leaves the manager able to block by not acting.
- **Adjustment (J).**
  - A voluntary chef cancellation submitted before the saved cutoff is **effective on submission**. The refund is computed from the booking's saved snapshot, and the manager is notified, not asked.
  - Keep cancellation state separate from money state. A failed reversal or refund must never revert the booking to `confirmed`.
  - Keep the existing storage-in-use exception (`booking-cancellation-refund.ts:67`) as an admin case.

### R5. A manager cancellation of a paid booking with a manual refund contradicts the proposal

- **Current behaviour [R].** `manager.ts:4843` returns `requiresManualRefund`; the refund is discretionary (A6).
- **Adjustment (J).** When the kitchen cancels a paid booking, the customer gets the gross refund by default, executed under R1. If the kitchen claims the chef was at fault (rule breach, safety), it opens an admin case. Any recovery runs through the existing claim path (`damage-claim-service.ts`), not by withholding the refund. This replaces a fault engine with one default and one escape route.

### R6. Startup abuse controls that cost nothing

- **Risks (I).** Free cancellation after capture, or repeated kitchen cancellations, lets people block slots at platform cost. Saved off-session cards make later charges technically possible without fresh consent.
- **Controls (J), with no new infrastructure.** Anchor free cancellation before capture (R2). Limit how many pending requests a chef can have open. Show admins cancellation counts per chef and per kitchen, with a review trigger. Recover actual cost from kitchens, not fines. Copying Peerspace's host fine (the greater of $100 or 30%) is premature without legal review.

### R7. Disputes, weather and partial use need a default interim outcome

- **Disputes [R/E].** No `charge.dispute.*` or `refund.failed` webhook cases were found. With separate charges and transfers, the platform is debited for the disputed amount and the dispute fee. Stripe warns that a pending refund plus a dispute can reimburse the customer twice (`charge_for_pending_refund_disputed`).
- **Objection.** Admin case review without a default leaves money in limbo.
- **Adjustment (J).**
  - While a case is open, the unused portion stays refundable and no transfer is released.
  - For no-fault events (weather, access, utility failure), refund the customer and impose no penalty, as Airbnb does under its Major Disruptive Events policy. Under the founder's "promise-breaker pays" hypothesis there is no breaker here, so the platform absorbs the processing fee. That is J, and it needs owner acceptance as a cost.
  - Before refunding, check whether a dispute is already open.

### R8. Adjacent invariant: never capture once the session has started

- **[R/I] (A7).** Decisions are not compared against the session start, and the 24-hour timeout (`auth-expiry-service.ts:42`) is not Stripe's `capture_before`.
- **Adjustment (J).** Make it a policy invariant that a booking cannot be accepted or captured after its start time. Show the provider's actual authorization deadline to admins only. This sets no SLA number.

### R9. Tax and fee basis

[R/F/Q] There is no tax on the platform fee (`bookings.ts:3247-3257`), commission defaults to 0% in code, and the founder's 7% is unverified. Refunding "including tax" assumes tax can be reversed and a credit note issued. That is an accountant or legal decision.

## Simplest consolidated proposal set to evaluate (J, not approval)

Tier 3 plus documents valid through the session end · free release before capture · a pre-cutoff chef cancellation takes effect on submission, with the platform absorbing fees inside the advertised full-refund band · kitchen or platform failure means a gross refund from the platform first, then recovery with no fines · admin cases have a customer-protective interim default · no capture after the session starts.

## Unresolved owner, legal and commercial decisions (Q)

- **Contracts:** a set-off and recovery clause in the kitchen contract; whether to move transfers from capture to session time (cash-flow trade-off); the Stripe loss and negative-balance settings actually in force (`controller.losses`); the payout schedule.
- **Absorbed costs:** who pays the processing fee in no-fault events; how large an absorbed full-refund band the platform can fund.
- **Documents:** which documents are mandatory for each location; who can waive them; how to grandfather tier-2 access.
- **Tax:** tax and credit-note treatment of refunds; whether the platform fee is taxable; the actual commission rate.
- **Thresholds:** cutoffs, pending-request limits, review triggers. None proposed here.

## Sources [E]

Stripe: [refunds](https://docs.stripe.com/refunds), [separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers.md?platform=web&integration=checkout&ui=stripe-hosted), [account balances](https://docs.stripe.com/connect/account-balances), [Connect disputes](https://docs.stripe.com/connect/disputes), [Express accounts](https://docs.stripe.com/connect/express-accounts), [manual capture](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method). Peerspace: [cancellation policy](https://www.peerspace.com/legal/terms/cancellation-policy). Airbnb: [host cancels](https://www.airbnb.com/help/article/1360), [Major Disruptive Events](https://www.airbnb.com/help/article/1320). Vrbo: [fee refunds](https://help.vrbo.com/articles/If-I-or-my-traveler-has-to-cancel-a-reservation-am-I-still-charged-a-booking-fee). Giggster: [host cancels](https://help.giggster.com/en/articles/757842-what-do-i-do-if-a-host-cancels-my-booking), [terms](https://giggster.com/terms). Food Corridor: [cancellation policy](https://help.thefoodcorridor.com/en/articles/1413947-what-is-a-cancellation-policy-and-how-does-it-work), [terms](https://www.thefoodcorridor.com/terms-conditions/). Airbnb, Vrbo, Giggster and Food Corridor pages were read through summaries. Where those disagree with older terms, the help pages take precedence for current practice and stay E/Q until re-read. The Giggster terms and the Airbnb host-cancellation article came from search results and were not opened.
