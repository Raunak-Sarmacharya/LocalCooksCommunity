# Local Cooks booking policy and operating contract

**Design handback — 13 October 2026.** This document contains public policy copy, manager responsibilities and the complete operational contract needed to deliver them. It is a draft for review, not a claim that the current application implements the policy. No source code, database, Stripe account, Vercel or Inngest changes were made.

**Authority:** the final owner decisions in this task and the latest Oct13 decisions in `docs/architecture/phase0/PHASE0_LOG.md:6–35` supersede older proposals. In particular: three fixed presets only; automatic policy refunds; manager discretion upward only; future-only policy/terms versions; terms accepted at kitchen application; live instructions; no damage deposits; post-closeout settlement; private feedback. The editable/custom tiers, checkout PDF checkbox, instruction snapshots governing future visits, grace periods and gross ordinary-cancellation refunds proposed in older documents are not selected policy.

**Status discipline:** “Owner-confirmed” means the product decision is settled, not implemented. Every unsettled product or operating proposal is labelled **Recommended — pending owner confirmation**. Recommendations R1–R5 must not be published as customer promises before approval. Public copy in A includes explicitly marked conditional paragraphs for those recommendations; remove the editorial labels only after approval and implementation. Numerical clocks in C are also proposals; they must be set and displayed before launch. Existing bookings retain their evidenced contract; do not impose this document retroactively.

## A. Public copy: Local Cooks Booking & Cancellation Policy

### Your request and payment

Local Cooks lets you request time at a kitchen and see its cancellation policy before you submit your request. All prices and refunds below are in Canadian dollars.

We place a temporary hold on your card when you request a booking. **Your card is charged only when the kitchen manager confirms your booking.** A pending request does not guarantee access. Your booking page shows whether your request is awaiting a decision or confirmed, and the manager's response deadline.

Before confirmation, you may cancel your request at any time, including close to the session's start. We release the entire hold. You pay nothing. We also release the entire hold if the manager declines or the request expires. A released hold is not a refund: no booking payment was collected. Your bank controls when the hold disappears from your available balance.

### Cancelling a confirmed booking

You can cancel in your booking details. Your cancellation takes effect when Local Cooks receives it. **You do not need the manager's approval.** Your refund follows the policy saved with your booking. We automatically start any refund owed by that policy; the manager cannot reduce it or delay it by withholding approval.

After confirmation, ordinary cancellation refunds exclude the **actual Stripe card-processing fee for your payment**. This is the original cost of processing the card payment, not an extra fee for cancelling. The cost varies with your card. We show the actual dollar amount and the refund before you confirm cancellation. We do not add an estimate, markup or second processing deduction.

The refundable amount is your payment, including the HST charged, minus that actual processing fee. A 100% tier returns all of that refundable amount; a 50% tier returns half of it, rounded to the nearest cent. A 0% tier provides no automatic refund. Kitchen time and reserved session equipment follow the saved policy. Any separately governed storage or other service is identified in your booking; cancelling kitchen time does not authorize disposal of stored goods.

### The three cancellation policies

Your kitchen uses one of these presets. Flexible is the default. There are no custom money rules in a kitchen's PDF terms.

- **Flexible:** cancel at least 24 hours before the session starts for 100% of the refundable amount. Less than 24 hours before start: no automatic refund.
- **Moderate:** cancel at least 72 hours before start for 100% of the refundable amount. From less than 72 hours through exactly 24 hours before start: 50% of the refundable amount. Less than 24 hours before start: no automatic refund.
- **Strict:** cancel at least seven days before start for 100% of the refundable amount. From less than seven days through exactly 72 hours before start: 50% of the refundable amount. Less than 72 hours before start: no automatic refund.

Seven days means 168 elapsed hours. Deadlines use the booked start time, not midnight. We show the date, time and kitchen time zone for your session. At the exact cutoff, the more generous tier still applies. For example, cancelling exactly 24 hours before a Flexible session qualifies for the 100% tier. Local Cooks records the cancellation time; later refund processing cannot move you into a worse tier.

### Booking close to the start time

If you request a booking after a refund cutoff has passed, we show the policy that will apply **as soon as the manager confirms**, before you authorize payment. Booking late does not create a new refund period. Until confirmation, cancelling still releases your whole hold at no cost.

Example notice: “Priya, this session starts today at 6:00 p.m. NDT. It is already inside Harbour Kitchen's Flexible cancellation window. If the manager confirms and you then cancel, there is no automatic refund. You can cancel before confirmation and we will release the entire card hold.”

### Asking for an additional refund

Inside the cancellation window, the manager may offer more than the automatic policy refund, up to your total payment minus the actual Stripe processing fee. The manager cannot offer less than your policy entitlement. You can ask through your cancelled booking. Your cancellation and automatic refund proceed while the additional request is considered. The processing fee remains excluded from an ordinary manager-granted refund.

### If the kitchen cancels or cannot be used

Contact Local Cooks through your booking if the kitchen cancels, you cannot get in, or the kitchen is unsafe or unusable. Report the problem and keep any messages or photographs you can safely obtain. **Use the problem-reporting route; do not select an ordinary change-of-plans cancellation for a kitchen failure.** Local Cooks can record the problem for you if you cannot use the app. For an immediate danger, contact emergency services first.

**Recommended — pending owner confirmation (R1):** “If the kitchen cancels a confirmed booking, Local Cooks refunds your full payment, including the amount otherwise excluded for Stripe processing. The kitchen receives no booking earnings. Local Cooks may help you find another suitable kitchen, subject to availability; you choose whether to accept it.”

**Recommended — pending owner confirmation (R2):** “If you cannot use the kitchen on arrival because you are locked out, have no access, or it is unsafe, Local Cooks reviews the incident and refunds the full payment for an entirely unprovided session, including the processing-fee amount. If you use part of the session, Local Cooks reviews the affected time and services separately.”

These recommendations do not promise reimbursement of food, travel, wages or lost business. Rights required by law are preserved regardless of approval of R1 or R2.

### Arrival, departure and problems during your visit

Read the current arrival and departure instructions on your booking page before your visit. Instructions use the location default unless the kitchen has its own override. Managers may update them. Local Cooks sends an “instructions updated” email to people with affected upcoming confirmed bookings; departure changes also notify people currently using the kitchen. The page shows the latest instructions even if an email cannot be delivered.

Follow your booked hours and the kitchen's house rules. Arriving late or leaving early does not automatically change your price or extend your time. Contact the manager if your plans change. If a kitchen problem causes lost time or an early departure, report it to Local Cooks for review. A missed arrival or departure record alone does not prove that you were absent or stayed overtime.

**Recommended — pending owner confirmation (R3):** “If you do not attend and the kitchen was available, the cancellation outcome is calculated as if you cancelled at the session's start time. There is no additional no-show penalty. Local Cooks reviews disputed attendance; missing an app action alone is not a no-show.”

Damage deposits are not collected. A damage or extra-use claim is separate from a cancellation refund. Local Cooks provides the claim, evidence, amount and response deadline for review. A report or unticked checklist does not itself authorize a charge. You can dispute a claim and provide your own evidence.

### Your policy, terms and feedback

Your booking keeps the policy and terms versions that applied when it was made. Later manager edits apply only to new bookings. A kitchen's terms PDF contains house rules and legal terms, accepted when you apply to that kitchen. It cannot change cancellation percentages, introduce a deposit or add payment penalties. The structured booking policy governs money rules if PDF wording conflicts. Mandatory legal rights take priority.

When a new terms version is required for a future booking, Local Cooks asks you to accept it through the kitchen application/access process. Existing confirmed or pending bookings keep their earlier version. There is no kitchen-terms checkbox at payment.

After your visit, you and the manager may each give feedback privately to Local Cooks. Feedback is not published on listings or disclosed as the other person's review. Each person can see their own submission. Feedback does not automatically decide refunds, attendance or damage liability.

### Refund timing and help

We distinguish “booking cancelled,” “refund processing” and “refund confirmed by Stripe.” Your bank controls when a confirmed refund appears. If a payment or refund fails, Local Cooks retains your case and tells you the next step. You do not need to contact the manager to release a policy refund.

**Recommended — pending owner confirmation (R4):** “In exceptional circumstances, Local Cooks may grant a full refund outside the kitchen's policy. These decisions depend on the circumstances and evidence. During the pilot, Local Cooks funds this exception, including the processing-fee amount, rather than taking the exception from the kitchen's earnings.”

### Worked examples

These examples assume kitchen rent of **$100.00**, manager-set Newfoundland and Labrador HST of **15% ($15.00)** and total payment of **$115.00**. The Local Cooks service-fee setting is **0%** for these examples; customer price displays therefore contain only rent, HST and total, with no service-fee row. The actual processing fee is assumed to be **$3.64**, solely to illustrate the calculation. It is not a quoted rate for your card. The NL rate is supported by [CRA's current provincial rates](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html).

1. **Pending request, even one hour before start:** Priya cancels before confirmation. The full **$115.00 hold is released**; nothing is charged or deducted.
2. **Flexible, exactly 24 hours before start:** Priya cancels a confirmed booking. Refundable amount: $115.00 − $3.64 = **$111.36**. The automatic refund is **$111.36**; **$3.64** remains unreturned.
3. **Moderate, 48 hours before start:** Priya cancels in the 50% tier. Refund: ($115.00 − $3.64) × 50% = **$55.68**. Total payment not returned: **$59.32**. The manager cannot reduce the $55.68 refund. If the manager grants another $20.00, the cumulative refund is **$75.68**, still below the $111.36 ordinary-cancellation cap.
4. **Strict, exactly seven days before start:** refund **$111.36**. At four days before start, refund **$55.68**. At two days before start, the automatic refund is **$0.00**.
5. **Flexible booked three hours before start:** before confirmation, all $115.00 is releasable. After confirmation, cancelling produces **$0.00 automatically**. The manager may grant up to **$111.36**; the before-payment notice must explain this transition.
6. **Recommended — pending owner confirmation (R1):** the kitchen cancels Priya's confirmed session. Priya receives **$115.00**, the kitchen receives no booking earnings, and the **$3.64** processor loss is charged to the manager once, unless Local Cooks waives it. The waiver does not reduce Priya's refund.

These are customer cash examples, not GST/HST credit-note instructions. Tax treatment of retained cancellation amounts requires accountant approval; do not assume a refund of $111.36 means every cent of the original $15.00 HST is reversed.

## B. One-page kitchen manager responsibilities

**Respond in time.** Accept or decline by the displayed deadline. Confirmation charges the card; before that it is a hold. **Recommended — pending owner confirmation (R5):** the deadline is the earlier of 24 hours or a preparation buffer before start, bounded by authorization validity. Silence expires the request and releases the hold. Local Cooks may act on your recorded instructions, never assume acceptance.

**Keep the kitchen ready and accurately described.** Maintain availability, working equipment, safe/lawful facilities, accurate instructions, a reachable contact and backup entry. Instruction/task edits use location defaults or kitchen overrides, apply live and notify affected people. They cannot alter booked hours, price or accepted legal terms.

**Use the published preset.** Choose Flexible, Moderate or Strict; Flexible is default. Before the first cutoff, the system automatically refunds payment minus actual processing cost. Inside the window, grant more if appropriate, never less than the tier, up to that same cap. Your PDF contains house rules/legal terms only. New policy/terms versions affect new bookings. Set kitchen HST correctly and provide supplier/tax details for receipts.

**Own a kitchen cancellation.** Cancel promptly if you cannot supply the booking; do not ask the customer to cancel as a change of plans. **Recommended — pending owner confirmation (R1):** the customer receives the entire payment, you earn nothing, and actual Stripe processing loss is deducted from your next earnings once. Local Cooks may waive it with a reason. Repeat cancellations are flagged. Report safety/regulatory closures.

**Inspect and submit claims on time.** Inspect before another session where possible. Review departure/condition evidence and select Clear or Report an issue by the inspection deadline. Clearing records inspection; it does not release money early or waive customer protections. Silence closes as “not inspected.” Submit a complete claim, evidence and amount by the separate filing deadline; a draft is not submitted. No damage deposit exists. Wear, pre-existing defects or unsupported allegations are not automatic charges. Cooperate with the response/review. Exact clocks in C need approval.

**Understand payout timing.** Eligible earnings transfer after session closeout, claim-filing and customer-response/remedy windows finish. A timely case affects only its booking allocation, with a maximum review deadline. Stripe then pays your bank on its schedule. Confirmation, early clearance and transfer are distinct from bank payment. Keep your payout account valid and respond to recovery requests.

**Cooperate with support and feedback.** Local Cooks acts for either side through audited, guarded actions. Provide factual evidence and report mistakes promptly; corrections preserve history. Two-sided booking feedback is private to Local Cooks.

## C. Complete situation matrix

### Reading the matrix and current-state evidence

Each numbered record below is a matrix row with the same fields: **outcomes** for the person booking, manager and Local Cooks; **Stripe-fee bearer**; **automatic action**; **timer/expiry**; **escalation**; **support action/guardrail**; **notifications**; and **today/build evidence**. This record layout preserves all columns without a very wide table.

“Exists” means documented repository functionality, not production readiness. “Partial” means some commands exist but the complete promised outcome needs building. “Build” means missing target behavior or a known contradiction. Evidence paths are repository-relative, with line numbers in the reviewed documents. Audits dated Oct12 may describe older surfaces: the Oct13 checkpoint at `docs/architecture/phase0/PHASE0_LOG.md:37–45` and later local handbacks take precedence. No fresh live tests were performed for this document.

### Shared calculation, funding and support guards

- **Ordinary refund arithmetic:** retain the refundable-pool convention in `docs/architecture/phase0/design-modular-cancellation-policy.md:99–117`: captured total T, verified actual original card-processing fee F, pool C = T − F; policy entitlement E = round-half-up(C × tier percentage). Calculate integer CAD cents. A 50% tier is half of T − F, not half of T with F subtracted again. No fee is deducted on an uncaptured request. No second fee for an extra refund. Successful and pending refunds consume the same cumulative cap. At an actual F of zero, deduct zero; unknown F is not zero.
- **Who actually pays Stripe:** Stripe initially debits Local Cooks in the current separate-charge model. “Bearer” below means the final economic allocation, not who appears on Stripe's invoice. Ordinary cancellation leaves the disclosed fee outside the customer's refund; manager payable starts from kitchen gross including HST less that fee, and then is reduced by the manager-funded refund. At a 50% tier, the customer gets E and the manager keeps the remaining net entitlement; there is no second manager fee debit. Local Cooks returns any refunded share of its own positive service fee/tax from its own allocation. At 0%, the fee remains the manager's ordinary processing expense against retained proceeds; there is no new charge to the customer.
- **R1 accounting, no double recovery:** at fee=0, T=$115.00 and F=$3.64, the normal net manager allocation is $111.36. Kitchen cancellation removes/reverses that allocation, Local Cooks supplies the $3.64 shortfall to refund $115.00, and records a single $3.64 receivable to deduct from the manager's next earnings. Do not reverse $115.00 from a $111.36 transfer and also deduct $3.64 later. If there is no next payout, use the agreed recovery/cure process; the customer's refund remains owed. A waiver moves that receivable to Local Cooks expense. Manager debit authority and funding must be approved before R1 automation.
- **Common guard G:** named authorized Local Cooks actor; selected acting-for person or Local Cooks; verified requester/authority; reason, evidence and policy version; fresh booking/payment revision; immutable operation and provider idempotency keys; before/after money preview, funding and tax allocations; append-only audit; no impersonation or raw database/provider edits. Check captured, refunded, pending and disputed amounts before money moves. Policy entitlement is a floor. A statutory remedy or an approved R1/R2/R4 exception uses its own rule, not the ordinary cap. A goodwill decision cannot debit the manager without consent or an approved contractual rule. This follows `docs/architecture/phase0/audit-admin-support-controls.md:24,34–49,65–75`.
- **Money finality:** cancellation, refund obligation, refund execution, manager recovery, transfer and bank payout are separate states. A recovery failure cannot reopen a cancelled booking or erase an owed refund. Protect affected funds; resolve customer liquidity separately from collecting manager debt. Provider uncertainty means reconcile the original object, not start another charge/refund. Cancellation removes future entry credentials/actions while preserving historical evidence; occupied storage still needs its custody/removal process.

### Proposed timers used by matrix rows

**All numerical defaults in this subsection are Recommended — pending owner confirmation.** They are Local Cooks operating proposals, not copied marketplace rules. Publish saved deadlines in kitchen-local date/time, store UTC instants, and never restart them because someone saves a draft, edits instructions or retries an operation. Mandatory legal/provider deadlines prevail if earlier.

- **D — request decision:** min(request received + 24 h, booked start − 30 min preparation buffer, actual authorization capture-before − 15 min safety margin). The buffer implements R5 but its number needs approval. If no positive decision time remains, do not create an unfulfillable request. No automatic extension or capture at/after D.
- **P — payment completion:** authenticated payment/3DS or fresh-authorization recovery expires after 15 min, or D/provider expiry if earlier. An uncertain capture is a reconciliation case, not an unpaid request that can be blindly expired/rebooked.
- **S — service end:** booked scheduled end, or last end for a series. Use right ends exactly at S; persist Ended by S + 15 min even with no taps. The 15 min is operational transition grace, not free occupancy. Inventory/use and custody still require their own facts.
- **I — inspection:** due at departure report or S; ordinary inspection closes no later than S + 24 h. An early clear does not shorten other protections. A late/missing departure cannot move the absolute cap.
- **H — damage/extra-use filing:** complete claim submitted by S + 24 h for the affected visit; draft expires then. Late discovery can open an exceptional support case, without restoring an indefinite hold or automatic debit entitlement.
- **U — customer remedy reporting:** ordinary non-delivery/problem reporting through S + 48 h, with an immediate door-problem route. Late reports or failed notice delivery receive reasoned support review; this timer does not waive statutory/card rights.
- **Q — claim response:** 48 elapsed hours after usable evidence/amount notice is actually made available through a verified reachable channel. Missing delivery opens support recovery instead of deeming agreement. Silence sends the case to Local Cooks, never authorizes a damage charge. An approved extension is recorded and subject to K.
- **K — case maximum:** named support review within one business day; target final or provisional funded decision within seven calendar days of report. A provider/holding limit may require earlier escalation. By the cap, apply the approved provisional remedy/settlement allocation and move residual collection to a separate receivable/case. Do not blindly release contested money. The provisional funding/reserve runbook is a launch gate, not yet authorized spending.
- **O — operation recovery:** provider failures/uncertainty alert Local Cooks immediately; reconcile within one business day; owner/finance escalation at 48 h without a verified path. Bank/provider completion may take longer, but the case always has a named owner, next check and customer update. At K, use an approved funded fallback where lawful; unresolved external obligations retain scheduled case reviews.
- **X — discretionary extra refund:** manager reply within 48 h of the request; silence closes the extra request without changing the policy refund. Support may reopen for evidence or an approved exception.
- **V — private feedback:** invite after last service end; responses close 14 days later, with one useful reminder. Participation and disagreement never gate settlement.

With no case, ordinary settlement waits until max(S, I, H, U): under these proposed defaults, S + 48 h. A timely submitted claim also preserves Q and its scoped K review. All numbers and treasury feasibility require approval before a release timestamp can be promised. Existing lazy 60-minute checkout review is observed behavior, not selection of a new policy (`docs/architecture/phase0/lifecycle-walkthrough.md:24–29,63–65`).

### Requests and cancellation

#### C01 — Request pending

- **Outcomes:** person booking has held funds but no confirmed access; manager owes a timely decision; Local Cooks owns reserved inventory and hold reconciliation.
- **Stripe-fee bearer:** no captured-payment fee deduction; any unrelated provider authorization cost is Local Cooks' expense unless separately agreed with the manager, never taken from the released hold.
- **Automatic action:** reserve eligible kitchen/add-on capacity; show hold and D; confirm only after verified capture, or expire/release.
- **Timer/expiry:** D; P applies to unfinished payment. Request age is never permission to capture after start.
- **Escalation:** approaching D, failed request notice or uncertain capture → Local Cooks decision/payment queue.
- **Support action/guardrail:** accept/decline for the manager only on verified instruction using the normal decision service; withdraw for the customer; replay the recorded capture/release under G. No assumption of acceptance or extension of an expired authorization.
- **Notifications:** immediate named request acknowledgement and manager task, deadline reminders, final confirmed/declined/expired status to both; in-app remains usable if email fails.
- **Today/build:** **Partial** hold/member decisions and staff release/replay; staff confirmation and shortened deadline need building. `docs/architecture/phase0/audit-admin-support-controls.md:29–30`; `docs/architecture/phase0/lifecycle-walkthrough.md:15`.

#### C02 — Request declined

- **Outcomes:** no booking charge or access; manager earns nothing; Local Cooks releases inventory and reconciles any linked item holds.
- **Stripe-fee bearer:** no customer deduction for an uncaptured charge.
- **Automatic action:** record manager decline reason, release entire authorization, cancel request and linked unused reservations; retain release-pending until verified.
- **Timer/expiry:** immediate on decline; unsuccessful release enters O rather than disappearing.
- **Escalation:** release uncertainty, contradictory capture or failed notice → payment case.
- **Support action/guardrail:** decline on manager instruction or reconcile original release under G; if capture actually occurred, use captured-booking remedy, never claim “nothing charged.”
- **Notifications:** both receive decline, no-charge/hold-release wording and bank-display caveat; no refund or payout estimate on the cancelled request.
- **Today/build:** **Exists** for member decline; staff attribution/complete outcome copy remains **Build**. Sandbox replay verified release and immediate corrected UI. `docs/architecture/phase0/lifecycle-walkthrough.md:67–69,83`; `docs/architecture/phase0/audit-admin-support-controls.md:29`.

#### C03 — Request expired / checkout abandoned

- **Outcomes:** no confirmed access or manager earnings; Local Cooks releases unused capacity and the full uncaptured hold.
- **Stripe-fee bearer:** no customer deduction; captured-by-race cases require separate funded reconciliation.
- **Automatic action:** expire abandoned Checkout/quote at P; at D prevent new acceptance and release authorization idempotently. Provider success discovered after timeout enters recovery.
- **Timer/expiry:** P/D/provider validity, whichever applies first; release failures O.
- **Escalation:** orphan authorization, capture/expiry race or overdue due-work → named payment operator.
- **Support action/guardrail:** run expiry/release through the same command under G; reconcile before offering new Checkout. Never turn an ambiguous paid booking into an unpaid expired row.
- **Notifications:** expiry/hold release to both where a request existed; payment-timeout instructions to the person booking; recovery updates if uncertain.
- **Today/build:** **Partial** 24-hour age-based authorization expiry exists; start cap and complete race recovery need building/proof. `docs/architecture/phase0/audit-admin-support-controls.md:30`; `docs/architecture/booking-target-phases.md:53–61`.

#### C04 — Customer cancels before confirmation, including inside the window

- **Outcomes:** entire hold released, no charge; manager loses the request and earns nothing; Local Cooks releases unused reservations.
- **Stripe-fee bearer:** none deducted from the customer.
- **Automatic action:** record withdrawal and cancel authorization; no manager decision or refund operation required.
- **Timer/expiry:** immediate receipt; any release/capture uncertainty O. Capture-versus-withdraw race is serialized and truthfully reported.
- **Escalation:** ambiguous capture → support; cannot quietly apply confirmed-cancellation penalties to a withdrawal received first.
- **Support action/guardrail:** withdraw for the person booking with verified instruction and G; reconcile same operation without capture-to-refund as a shortcut.
- **Notifications:** cancellation and released-hold status to both, bank-display caveat to the customer.
- **Today/build:** **Exists/Partial** pending member release and staff authorization cancel; complete acting-for attribution/race contract needs proof. `docs/architecture/phase0/design-modular-cancellation-policy.md:9,47,123`; `docs/architecture/phase0/audit-admin-support-controls.md:29–30`.

#### C05 — Customer cancels after confirmation, before the window

- **Outcomes:** cancellation immediate; automatic refund T − F; manager has no cancellation-review veto and no retained ordinary earnings at fee=0; Local Cooks owes refund execution and any returned platform-fee allocation.
- **Stripe-fee bearer:** original processing fee remains outside the customer's refund; do not charge the manager that same fee again.
- **Automatic action:** save cancellation receipt time/tier, release unused inventory, reserve and issue refund automatically; reduce unpaid payable or recover an existing transfer separately.
- **Timer/expiry:** immediate cancellation/refund attempt; unknown fee or provider failure O, tier fixed at first accepted receipt.
- **Escalation:** fee unavailable, refund failure, reversal failure or conflicting dispute → Local Cooks, never manager approval.
- **Support action/guardrail:** cancel for the customer, reconcile fee or replay owed operation under G; no lower refund, manager gate or overwritten cancellation time.
- **Notifications:** both receive effective cancellation and exact entitlement; customer receives processing/success/failure status and bank caveat; manager receives payable adjustment.
- **Today/build:** **Build**: current confirmed route enters manager-reviewed cancellation rather than this automatic outcome. `docs/architecture/phase0/audit-admin-support-controls.md:31`; `docs/architecture/phase0/design-modular-cancellation-policy.md:47–48,124,131`.

#### C06 — Customer cancels inside the window

- **Outcomes:** cancellation immediate; customer gets E automatically, including $0 if applicable; manager keeps only saved net entitlement and may add relief up to C; Local Cooks executes policy money without approval.
- **Stripe-fee bearer:** as ordinary arithmetic above; at a 0% refund the manager's retained earnings bear the original expense. No added customer debit.
- **Automatic action:** evaluate frozen preset at received instant, issue positive E, release unused reservations, then offer a separate extra-refund request.
- **Timer/expiry:** cancellation now; positive refund O; extra request X. Equality boundaries stay inclusive.
- **Escalation:** policy/fee mismatch or failed money operation → support; manager silence only closes the extra request.
- **Support action/guardrail:** cancel for customer or record manager-authorized extra amount under G; cumulative refund between E and C; no tier reduction or hidden fee refund.
- **Notifications:** both receive tier, exact refund and retained total; extra request/award/expiry separate from cancellation; no “refund approved” when already policy-owed.
- **Today/build:** **Build**: late member cancellation is blocked; current manager-share refund exists but is insufficient. `docs/architecture/phase0/audit-admin-support-controls.md:32–34`; `docs/architecture/phase0/design-modular-cancellation-policy.md:74,101,125–126`.

#### C07 — Booking made inside the window

- **Outcomes:** customer is told immediate confirmed-cancellation outcome before payment; manager cannot invent grace or harsher terms; Local Cooks retains acceptance evidence.
- **Stripe-fee bearer:** before confirmation none; after confirmation ordinary policy allocation.
- **Automatic action:** display current tier, all applicable deadlines and explicit late-booking warning before card authorization, repeat on review and Checkout; apply saved policy after capture.
- **Timer/expiry:** D/P still apply; original cutoff is not reset to booking creation/confirmation time.
- **Escalation:** missing/contradictory warning or no feasible D → prevent new payment and support review, not a post-payment surprise.
- **Support action/guardrail:** inspect acceptance/disclosure evidence under G; honour proven terms; customer-favourable reviewed remedy for missing disclosure, funded explicitly.
- **Notifications:** request and confirmation restate “already inside” tier; booking page and cancel preview retain it.
- **Today/build:** **Build**: real booking showed a cutoff predating its creation with no warning and disabled cancellation. `docs/architecture/phase0/lifecycle-walkthrough.md:11,13,16`; `docs/architecture/phase0/design-modular-cancellation-policy.md:157`.

### Supply failure and attendance

#### C08 — Kitchen cancels a confirmed booking

- **Outcomes — Recommended — pending owner confirmation (R1):** customer refunded full T, including F equivalent; manager earns zero and owes F once unless waived; Local Cooks advances refund, offers optional rebooking and flags repeat kitchen cancellations.
- **Stripe-fee bearer:** manager via next payable earnings; Local Cooks if waiver approved or recovery ultimately fails. This is separate from ordinary customer-cancellation caps.
- **Automatic action:** immediate supplier-cause cancellation, release unused inventory, full owed refund operation; reduce/reverse net manager allocation, create single F recovery receivable and repeat-cancellation flag.
- **Timer/expiry:** immediate refund attempt; recovery O/K; manager debt cure deadline saved even if there is no future payout.
- **Escalation:** imminent session, repeat failure, insufficient funds or disputed cause → Local Cooks operations/finance.
- **Support action/guardrail:** cancel for manager, apply R1 or waive its manager fee under G and approved liability agreement; waiver requires reason/funding approval and cannot reduce the customer's refund. No disguised customer cancellation or duplicate recovery.
- **Notifications:** both receive kitchen-cause cancellation/refund; manager sees exact earnings removal, processor debit/waiver and review flag; rebooking requires customer consent.
- **Today/build:** **Build** full cause/funding workflow; current legal/customer copy conflicts. `docs/architecture/phase0/audit-admin-support-controls.md:32,34–35,79`; `docs/architecture/phase0/design-modular-cancellation-policy.md:16,49,127`.

#### C09 — Kitchen unusable on arrival: locked out, unsafe, no access

- **Outcomes — Recommended — pending owner confirmation (R2):** full T for an entirely unprovided booking through a Local Cooks case; manager earns nothing for unprovided supply; Local Cooks coordinates immediate help and reviews partial-use remedies separately.
- **Stripe-fee bearer — Recommended — pending owner confirmation:** Local Cooks during the pilot for R2; only debit the manager if R1's approved kitchen-cause rule or specific consent applies. R2 alone does not establish fault-based debt authority.
- **Automatic action:** open access/safety case, preserve report time/evidence, alert manager/Local Cooks, protect affected settlement; never run voluntary-cancellation penalty logic.
- **Timer/expiry — Recommended — pending owner confirmation:** urgent manager response within 15 min, immediate safety escalation without a waiting requirement; U reporting and K case cap.
- **Escalation:** no response, unsafe facilities, lost material session time or imminent next booking → on-call support; emergencies → emergency services.
- **Support action/guardrail:** record incident for either side, seek access/voluntary alternative, adjudicate full/partial remedy under G; do not require a photo, app tap or waiting in danger as the sole proof. Additional loss reimbursement is not promised.
- **Notifications:** acknowledgement and help to reporting person; immediate manager/support alert; evidence request, decision, exact refund and recovery status to both.
- **Today/build:** **Build** integrated access case/remedy; attendance support is only partial. `docs/architecture/phase0/design-checkin-checkout.md:106,123,135,165`; `docs/architecture/phase0/audit-admin-support-controls.md:38,65`.

#### C10 — Customer no-show

- **Outcomes — Recommended — pending owner confirmation (R3):** evaluate cancellation at booked start; all selected presets give $0 automatic refund at that instant; manager keeps saved net entitlement; Local Cooks reviews evidence/corrections. No added no-show fee.
- **Stripe-fee bearer:** original expense from retained manager proceeds; no new customer fee.
- **Automatic action:** end service on S even with no attendance taps; accept a no-show allegation as evidence, not automatic liability; after a verified finding apply start-time financial outcome without altering recorded report time.
- **Timer/expiry:** allegation by H, response Q and case K. Do not cancel/release the customer's remaining use right at start merely because no tap exists; timely late arrival may rebut the allegation.
- **Escalation:** disputed attendance, access failure or missing evidence → Local Cooks; distinguish kitchen no-access from customer absence.
- **Support action/guardrail:** record/correct/withdraw attendance for either side under G; verify kitchen availability and contact attempts; record finding, start-time policy instant and actual decision time separately. No-show finding is not an automatic new card charge.
- **Notifications:** neutral allegation, evidence and response deadline to customer; determination/correction to both, truthful earnings/refund outcome.
- **Today/build:** **Partial** staff attendance report/withdraw exists; financial no-show rule and clock-based end need building. `docs/architecture/phase0/audit-admin-support-controls.md:15,38`; `docs/architecture/phase0/lifecycle-walkthrough.md:25–29`; `docs/architecture/phase0/design-checkin-checkout.md:91,102`.

#### C11 — Late arrival

- **Outcomes — Recommended — pending owner confirmation:** original end/price remain; manager provides remaining booked access; Local Cooks separates voluntary lateness from kitchen-caused delay.
- **Stripe-fee bearer:** ordinary completed-booking expense against manager proceeds; kitchen-fault refunds use C09 separately.
- **Automatic action:** retain booked instants; record actual arrival; show remaining time, never create an extension or no-show solely from lateness.
- **Timer/expiry:** S/I; a delay complaint uses U/K, not a rolling new session.
- **Escalation:** denied remaining access, disputed late arrival or requested extension → support.
- **Support action/guardrail:** assisted arrival/correction or scoped lost-time remedy under G; extension requires availability, both parties' acceptance and lawful payment, not an end-time edit.
- **Notifications:** arrival record to manager, remaining end time to customer; agreed extension or remedy to both.
- **Today/build:** **Partial** arrival/assistance exists; complete support and lost-time outcome need building. `docs/architecture/phase0/design-checkin-checkout.md:63–65,102`; `docs/architecture/phase0/audit-admin-support-controls.md:36,38`.

#### C12 — Early leave

- **Outcomes — Recommended — pending owner confirmation:** no automatic unused-time refund for voluntary early leave; manager inspects but cannot release settlement before other windows; Local Cooks reviews a kitchen-fault departure separately.
- **Stripe-fee bearer:** manager's normal processing expense; fault/exception allocation follows approved remedy.
- **Automatic action:** record actual departure and inspection task; retain scheduled end and remedy rights; stop irrelevant departure nudges.
- **Timer/expiry:** I capped from original S, U/H/Q independent; early clear does not shorten them.
- **Escalation:** partial-supply problem, disputed departure or refund request → support, O for money failure.
- **Support action/guardrail:** record assisted departure/correction or adjudicate separate remedy under G; do not fabricate earlier service completion to accelerate transfer.
- **Notifications:** departure/inspection task, factual inspection outcome and any remedy to both.
- **Today/build:** **Partial** checkout/early manager clearance exists; independent end/remedy/settlement needs building. `docs/architecture/phase0/lifecycle-walkthrough.md:19,85`; `docs/architecture/phase0/design-checkin-checkout.md:92–96,103`.

#### C13 — Overstay

- **Outcomes — Recommended — pending owner confirmation:** customer must depart or obtain an accepted extension; manager can report proven extra use, with no assumed payment guarantee; Local Cooks protects the next booking and reviews disputed extra use.
- **Stripe-fee bearer:** original charge expense remains with manager earnings; a separately approved extra-use charge has its own processor allocation, to be agreed before enabling collection. No invented processor debit or PDF penalty.
- **Automatic action:** service ends at S; missing checkout creates a neutral evidence gap, not a billed overstay; open separate extra-use case only from occupancy evidence; offer extension only if capacity/payment/consent permit.
- **Timer/expiry:** urgent occupancy response; H/Q/K for claim/review; a saved, approved rate/increment/grace and payment deadline required for collection.
- **Escalation:** next booking threatened, safety/removal problem or disputed amount → Local Cooks immediately.
- **Support action/guardrail:** assist departure, adjust/waive evidenced charge or adjudicate under G; verify frozen structured extra-use rule and valid mandate/on-session acceptance. Until approved structured rates and consent exist, no automatic monetary penalty.
- **Notifications:** departure request, exact proposed charge/evidence/response deadline, decision/payment status to both; notify affected next customer without exposing private allegations.
- **Today/build:** **Partial** manager adjustment/waiver and staff dispute review; full support/collection safeguards need building. `docs/architecture/phase0/audit-admin-support-controls.md:16,40`; `docs/architecture/phase0/design-checkin-checkout.md:104–105,174`.

#### C14 — Damage claim

- **Outcomes — Recommended — pending owner confirmation for clocks/collection:** customer receives evidence, amount and fair response; manager has no deposit or guaranteed reimbursement; Local Cooks reviews causation, wear, pre-existing condition and duplicate insurance recovery.
- **Stripe-fee bearer:** original booking processing unchanged; separately consented damage payment has its own approved fee allocation. No silent deduction from an unrelated owed refund.
- **Automatic action:** draft is nonfinancial; submit complete evidence by H, notify customer and start Q; dispute/silence → review; approved liability and verified collection tracked separately.
- **Timer/expiry:** H draft/file cap, Q response, K resolution; separate payment/authentication deadline P/O and approved collection/appeal deadline. Legal/network waits prevail over internal targets.
- **Escalation:** disputed/late/undelivered claim, authentication required, declined collection or insurance overlap → support/finance; no indefinite settlement hold.
- **Support action/guardrail:** submit/respond for either side on instruction, adjudicate/reduce/waive, seek fresh payment acceptance and reconcile under G; silence is not charge consent. Preserve evidence and separate approval of higher-risk spending/collection. Only scoped approved exposure may affect settlement.
- **Notifications:** evidence and proposed amount, Q, response/decision, payment request and verified collection/failure to both; manager sees pending versus recovered money.
- **Today/build:** **Partial** staff decision/charge and member claim routes exist; acting-for, new timers and mandate-safe collection need building/review. `docs/architecture/phase0/audit-admin-support-controls.md:39`; `docs/architecture/phase0/research-cancellation-deposit-policy.md:177–188`; `docs/architecture/booking-target-phases.md:77–83`.

#### C15 — Customer dispute with manager or Local Cooks

- **Outcomes:** customer may contest attendance, supply, claim or outcome; manager can respond; Local Cooks owns evidence-based decision, separate from card chargeback. Ordinary cancellation entitlement still proceeds unless provider reconciliation prevents duplicate reimbursement.
- **Stripe-fee bearer:** ordinary outcome unchanged unless approved R1/R2/R4 or mandatory remedy applies; platform goodwill never silently debits manager.
- **Automatic action:** open case and preserve evidence/version; reserve only affected money; do not freeze all kitchen earnings or treat feedback disagreement as proof.
- **Timer/expiry:** U/Q/K; **Recommended — pending owner confirmation:** internal appeal within 30 days of decision, with statutory/card rights unaffected; appeal review has a new named bounded case.
- **Escalation:** conflicting evidence, failed notice or overdue review → second reviewer/owner; urgent access case takes priority.
- **Support action/guardrail:** record either party's statement, grant scoped remedy or confirm/revise outcome under G; second reviewer for appeal, no deletion of original decision or unilateral consent fabrication.
- **Notifications:** case acknowledgement, evidence/response deadline, updates, reasoned decision/appeal path and verified money changes to both.
- **Today/build:** **Partial** specialist claim/overstay disputes; unified booking case and appeals need building. `docs/architecture/phase0/audit-admin-support-controls.md:28,39–41,65–71`; `docs/architecture/phase0/design-checkin-checkout.md:109,135`.

#### C16 — Card chargeback

- **Outcomes:** customer retains issuer rights; manager allocation is reviewed against supply/evidence and contract; Local Cooks manages provider evidence, disputed funds and deadlines. No simultaneous duplicate refund/transfer.
- **Stripe-fee bearer:** Stripe initially debits Local Cooks; final chargeback fee/loss allocation requires the manager agreement and legal review. Do not assume every customer chargeback is manager fault or impose F again.
- **Automatic action:** receive dispute event, link booking/source, protect affected unsettled allocation, suppress conflicting refund/transfer until provider reconciliation; preserve schedule/service facts.
- **Timer/expiry:** actual provider response deadline, with internal O alerts before it; provider resolution tracked with a next-check time even if longer than K.
- **Escalation:** immediately to named payment-disputes operator; approaching evidence deadline to owner/finance.
- **Support action/guardrail:** assemble disclosure, attendance and refund evidence; accept/challenge with approved authority under G; no alternate cash refund while an issuer credit could duplicate it; no suppression of legal rights.
- **Notifications:** factual dispute acknowledgement and evidence request; financial decision/status to affected parties; do not expose sensitive payment evidence beyond need.
- **Today/build:** **Build** booking-linked dispute workflow. `docs/architecture/phase0/audit-admin-support-controls.md:17,41`; `docs/architecture/booking-target-phases.md:59,69,83`.

#### C17 — Payment failure, expired authorization or 3DS not completed

- **Outcomes:** no confirmation/access until verified capture; manager sees payment action needed, no paid earnings; Local Cooks preserves any paid-by-race service/refund obligation.
- **Stripe-fee bearer:** no successful capture means no card-processing deduction from customer; if captured, use verified charge facts and cause-specific remedy.
- **Automatic action:** show authentication/update-payment route, bounded P; release unused hold/capacity on safe expiry; capture uncertainty becomes recorded recovery, not an automatic second payment.
- **Timer/expiry:** P within D/provider validity; uncertain operation O.
- **Escalation:** captured-but-unconfirmed, orphan hold or start approaching → payment operator immediately.
- **Support action/guardrail:** reconcile original PaymentIntent then resume/release/refund it under G; require fresh authenticated consent for new authorization; no expired capture, silent card retry or double hold.
- **Notifications:** specific action/deadline to customer, pending/recovered/expired state to manager, truthful final capture or hold release to both.
- **Today/build:** **Partial** payment decision/recovery exists; complete compensation/start cap needs building/proof. `docs/architecture/phase0/audit-admin-support-controls.md:29–30`; `docs/architecture/booking-target-phases.md:53–61`; `docs/architecture/phase0/research-cancellation-deposit-policy.md:208–210`.

### Recovery, changes and offboarding

#### C18 — Refund pending, failed or actual fee unavailable

- **Outcomes:** booking stays cancelled and customer's entitlement stays owed; manager cannot veto it; Local Cooks owns fee verification, funding and payment recovery.
- **Stripe-fee bearer:** saved cause-specific allocation; refund failure introduces no new customer cancellation fee. Local Cooks funds its own recovery overhead.
- **Automatic action:** record owed amount or fixed tier/receipt time if F unknown; protect funds, reconcile original refund/webhook and surface recovery. Unknown F never becomes an estimate or zero; cancel now with explicit “exact refund being verified” acknowledgement instead of a false dollar quote.
- **Timer/expiry:** immediate O; fee-unavailable quote reviewed within one business day, owner escalation at 48 h. A provider pending refund may remain external longer, with scheduled updates and next-check time.
- **Escalation:** unavailable liquidity, fee cannot be isolated, failed card refund or pending refund disputed → named finance operator.
- **Support action/guardrail:** verify charge fee, fund/retry same operation, obtain refund trace, or arrange approved alternate payment after reconciling returned/failed original funds under G. Do not duplicate a pending refund or erase the debt. An approved customer-favourable fallback when F is unknowable must be explicitly Local Cooks-funded.
- **Notifications:** customer sees cancellation, entitlement, processing/failure and next update separately; manager sees protected refund allocation; confirmed-success notice only from provider evidence.
- **Today/build:** **Partial** recovery-required refund state/idempotent helpers exist; unified fee classifier/unknown-fee and alternate-refund support need building. `docs/architecture/phase0/design-modular-cancellation-policy.md:117,131`; `docs/architecture/phase0/audit-admin-support-controls.md:33–35`; `docs/architecture/booking-target-phases.md:69,83`.

#### C19 — Transfer reversal fails, or succeeds while refund fails

- **Outcomes:** customer's owed refund/cancellation unchanged; manager recovery becomes a separate obligation; Local Cooks reconciles both legs and advances owed customer liquidity through an approved reserve.
- **Stripe-fee bearer:** original cause-specific allocation; reversal failure itself is not a customer fee. Platform loss/manager debt is separately journalled.
- **Automatic action:** no new manager transfer against refund-reserved money; retry/reconcile recorded reversal within its remaining cap; if reversal succeeded but refund failed, keep recovered funds tied to the refund obligation, not a second reversal or automatic manager repayment.
- **Timer/expiry:** O/K funding/recovery path; manager receivable has an approved cure date even without next earnings.
- **Escalation:** insufficient connected balance, paid-out funds, unknown reversal reply or failed refund → finance/owner immediately.
- **Support action/guardrail:** reconcile original transfer/reversal/refund, advance approved funds, apply contractual future offset or voluntary recovery under G; no reversal above unreversed transfer or “refund succeeded” from reversal success alone.
- **Notifications:** customer gets refund progress only; manager receives precise reversal/debt/offset statement; both receive final financial outcome with no private balance exposure.
- **Today/build:** **Partial** low-level reversal/reconciliation; complete staff/funding workflow needs building. `docs/architecture/phase0/audit-admin-support-controls.md:35,49`; `docs/architecture/phase0/design-modular-cancellation-policy.md:129–131`; `docs/architecture/booking-target-phases.md:69`.

#### C20 — Manager unresponsive

- **Outcomes:** pending request expires; confirmed booking remains a service obligation; inspection silence auto-closes uninspected; extra-refund silence changes no policy entitlement; Local Cooks owns urgent failure/case escalation.
- **Stripe-fee bearer:** no capture for expired request; confirmed booking follows actual cause. Unresponsive supplier failure uses approved R1/R2, never automatically the customer's penalty tier.
- **Automatic action:** request expires at D; inspection at I; optional extra request at X; claim response at Q routes to Local Cooks. Preserve independent settlement/remedy clocks.
- **Timer/expiry:** D/I/X/Q/K as applicable; current 24-hour response never extends beyond approved start buffer.
- **Escalation:** locked-out now, overdue case, notice failure or repeated missed requests → named support; repeat issues flagged for listing review.
- **Support action/guardrail:** contact manager, decline/withdraw pending request, assist inspection or resolve scoped incident under G; acceptance needs manager instruction, and silence is neither liability admission nor customer payment consent.
- **Notifications:** reminders/escalation and automatic outcome to both; say “response window ended without inspection,” not “manager found no issues.”
- **Today/build:** **Partial** expiry/lazy inspection exists; integrated takeover/caps need building. `docs/architecture/phase0/audit-admin-support-controls.md:30,38,65`; `docs/architecture/phase0/lifecycle-walkthrough.md:25–26`; `docs/architecture/phase0/design-checkin-checkout.md:92–96`.

#### C21 — Local Cooks exceptional full refund

- **Outcomes — Recommended — pending owner confirmation (R4):** customer may receive full T outside ordinary tiers; manager retains otherwise legitimate net earnings for a Local Cooks-funded pilot exception; Local Cooks bears the additional expense, including F equivalent.
- **Stripe-fee bearer:** Local Cooks funds the exception and does not reverse the manager's legitimate entitlement. When the manager retains the normal T − F allocation, original processing remains in normal booking accounting; Local Cooks bears the full goodwill cash expense. No manager debit without separate consent/fault rule.
- **Automatic action:** approved case reserves remaining refund, separates platform goodwill from policy refund and any previously paid refund; existing booking remains cancelled or supplied as factually appropriate.
- **Timer/expiry:** K decision, O execution; request alone does not promise eligibility or freeze unrelated earnings.
- **Escalation:** budget/cap exceeded, manager funding disputed or duplicate issuer remedy → second approver/owner.
- **Support action/guardrail:** approve documented exception with explicit platform expense under G and delegated budget; refund no more than remaining original captured charge, including prior/pending/issuer credits. Any compensation beyond T is a separately approved payment, never a larger Stripe refund.
- **Notifications:** customer gets decision and exact total/refund status; manager gets accurate earnings effect, including “no reduction” when platform-funded; internal approval/budget trail retained.
- **Today/build:** **Build** general platform goodwill/refund facility; current staff approval requires an existing manager refund request. `docs/architecture/phase0/audit-admin-support-controls.md:34,44–49,65,79–80`.

#### C22 — Policy changes after booking

- **Outcomes:** customer's saved preset/version survives; manager publishes new version for new requests only; Local Cooks keeps historical evidence/readers.
- **Stripe-fee bearer:** original saved payment rule unchanged.
- **Automatic action:** publish append-only version; resolve location default/kitchen override for new quotes; never modify pending or confirmed snapshots. A stale Checkout must be refreshed/reaccepted before authorization if its promised version can no longer be honoured; after authorization preserve it.
- **Timer/expiry:** quote expiry P; historical version retained for contract/tax/dispute record period, not expired by publication.
- **Escalation:** missing legacy snapshot or contradictory historical disclosure → support review; unknown history is never backfilled with today's harsher policy.
- **Support action/guardrail:** view original version, correct a prospective publication error, or grant an audited customer-favourable remedy under G; no historical snapshot edits.
- **Notifications:** manager gets publication summary and unaffected-existing-bookings count; new applicants/bookers see new version. No tour-style policy-change email to existing bookings.
- **Today/build:** **Build** complete versioned preset model/readers; current hour snapshot is partial. `docs/architecture/phase0/design-modular-cancellation-policy.md:43–45,84,90–93`; `docs/architecture/phase0/PHASE0_LOG.md:21–32`.

#### C23 — Arrival/departure instructions or tasks change

- **Outcomes:** customer sees effective current guidance; manager freely edits location default or kitchen override; Local Cooks preserves what was shown/submitted as evidence without locking future instructions.
- **Stripe-fee bearer:** unchanged; instruction changes cannot add money rules or reset deadlines.
- **Automatic action:** resolve effective guide per kitchen, show update time; one coalesced instruction-update event per affected booking; revalidate recipients at send. Upcoming confirmed bookings notified for relevant changes; checked-in visits notified for departure changes. Managers receive no copy of this update email.
- **Timer/expiry:** immediate update/wakeup, bounded delivery O; booking/access authorization rechecked before every send/read. Old undelivered events coalesce into latest effective content.
- **Escalation:** undeliverable critical access notice, contradictory/safety change or new impossible task → Local Cooks; no automatic penalty for unread/unperformable updates.
- **Support action/guardrail:** relay current guide, record assisted evidence or report unsafe/impossible requirement under G; do not silently edit legal terms, price or schedule through instructions. Read-side access control protects door codes.
- **Notifications:** “instructions updated” email to affected customer only, direct current-guide link and in-app update marker; evidence records update versions. Safety incidents use their separate manager/support alerts.
- **Today/build:** **Partial/Build** Oct13 live-instruction/task direction and override schema exist; complete resolver/notification delivery not established by latest checkpoint. `docs/architecture/phase0/PHASE0_LOG.md:9–35,39–45`; older frozen-guide proposal in `docs/architecture/phase0/design-checkin-checkout.md:74,131` is superseded.

#### C24 — Kitchen PDF terms change

- **Outcomes:** existing pending/confirmed bookings retain accepted PDF version; manager publishes new nonfinancial terms for new bookings; Local Cooks retains accessible immutable PDFs and acceptance provenance.
- **Stripe-fee bearer:** unchanged; a PDF cannot introduce financial retention, deposits or penalties.
- **Automatic action:** store original bytes/hash/version and location/kitchen scope; new applicants accept effective PDF in application. An already approved person who needs a new terms version completes a supplemental application/access acceptance before their next new booking, without disturbing existing bookings. Do not swap an accepted URL's contents.
- **Timer/expiry:** new-booking access waits for valid acceptance; abandoned supplemental acceptance simply closes without altering existing paid obligations; missing historical PDF enters O review.
- **Escalation:** money clauses, inaccessible PDF, changed safety/legal requirement or mismatch with policy → content/legal support review.
- **Support action/guardrail:** retrieve accepted PDF, quarantine contradictory new upload and request corrected version under G; no accepting on behalf of a customer without their verified instruction/authority, no retroactive substitution.
- **Notifications:** application/renewal acceptance notice and durable PDF copy/link; manager publication summary; no “terms updated” email intended to change existing bookings, and no payment-stage kitchen-terms checkbox.
- **Today/build:** **Partial** upload and new optional kitchen URL columns; immutable version/acceptance/renewal workflow needs building. `docs/architecture/phase0/design-modular-cancellation-policy.md:44,58,80,84,162`; `docs/architecture/phase0/PHASE0_LOG.md:19–26`.

#### C25 — Booking modified: move, extension, reduction or different kitchen

- **Outcomes — Recommended — pending owner confirmation for modification rules:** original commitment remains until both parties accept a financially/inventory-safe revision; manager cannot move a booking unilaterally; Local Cooks owns compensation recovery. No general new amendment feature is authorized by this policy.
- **Stripe-fee bearer:** original actual charge cost remains recorded once; a new authorized charge has its own actual fee. Allocation across carried-forward/new/used components requires approved amendment terms.
- **Automatic action:** where change supported, preview dates/price/HST/deadlines, reserve replacement capacity bounded, obtain consent and any payment, then commit revision. Failed/expired proposal releases only replacement capacity. Retired writers stay retired.
- **Timer/expiry — Recommended — pending owner confirmation:** proposal/consent expires after 24 h or D-like pre-start bound if earlier; payment P and provider recovery O; original booking continues while proposal expires.
- **Escalation:** payment success/commit failure, unavailable capacity, unresolved original cancellation rights or cross-kitchen relocation → support.
- **Support action/guardrail:** use approved preview/consent service under G; preserve original policy/terms and original cancellation rights on carried-forward value; never move to a later start to evade a cutoff. A different kitchen requires new contract/consent/payee allocation, not editing kitchen ID. Until rules approved, show change unsupported and offer transparent support/cancel/new-request options.
- **Notifications:** proposal with full before/after terms, consent/payment deadline, applied/expired result and original booking status to both; suppress obsolete reminders only after committed revision.
- **Today/build:** **Partial legacy contracts / target Build**: audit found move/extend state/routes, but roadmap says confirmed writers are retired. Route presence is not permission to offer it. `docs/architecture/phase0/audit-admin-support-controls.md:14,36–37`; `docs/architecture/booking-target-phases.md:107–111`; `docs/architecture/phase0/continuation-handoff.md:62`.

#### C26 — Account closed, suspended, revoked or manager ownership changes

- **Outcomes — Recommended — pending owner confirmation for offboarding contract:** customer's and supplier's existing obligations/refunds persist; no access where unsafe/unlawful, but paid booking receives a reasoned remedy; manager payee is not replaced by the next operational manager; Local Cooks keeps authorized recovery contact and necessary records.
- **Stripe-fee bearer:** apply actual cancellation/fault/mandatory-remedy cause, never a new account-closure penalty.
- **Automatic action:** block new transactions, enumerate future/active bookings and open claims/refunds/payouts, create owned cases; restrict sensitive access while retaining authorized copies and financial rights. Account deletion does not delete obligations.
- **Timer/expiry:** immediate risk triage, before-start decision, existing D/S/H/U/Q/O/K unchanged; retained-record period approved by counsel/accountant.
- **Escalation:** safety/licence expiry, unreachable party, supplier identity/payee mismatch or unclaimed refund → legal/finance owner.
- **Support action/guardrail:** coordinate fulfillment or cause-specific cancellation/remedy for either side, assist offline response and authorized payout cure under G; never reroute funds by profile edit, bypass a legal prerequisite, erase audit or require account reopening to receive owed money.
- **Notifications:** reason, affected bookings, available recovery/contact and financial next steps to reachable authorized recipients; incoming manager sees only newly authorized information.
- **Today/build:** **Build** end-to-end offboarding support/runbook; access/payee risks specified in roadmap. `docs/architecture/booking-target-phases.md:29–37,79–83`; `docs/architecture/phase0/audit-admin-support-controls.md:28,71`.

#### C27 — Kitchen delisted with future bookings

- **Outcomes — Recommended — pending owner confirmation for delisting contract:** listing disappearance alone does not cancel paid bookings; customer retains fulfillment or an approved supplier-failure remedy; manager must fulfill or cancel explicitly; Local Cooks owns every impacted obligation.
- **Stripe-fee bearer:** ordinary cost if fulfilled; approved R1/R2 cause if unprovided. Do not classify delisting as customer convenience cancellation.
- **Automatic action:** stop new requests, inventory all future/active commitments, retain authorized booking page/terms/instructions; unsafe closure opens immediate service-failure cases.
- **Timer/expiry:** manager fulfillment decision before each start, urgent safety immediately, unresolved cases K; pending requests D release if no safe fulfillment.
- **Escalation:** unavailable kitchen, no response or large affected cohort → Local Cooks; no unowned mass-cancellation queue.
- **Support action/guardrail:** coordinate documented fulfillment, voluntary relocation or supplier cancellation/refund under G; review each source/payee and record bulk action as individual operations. No cascade deletion or silent replacement kitchen.
- **Notifications:** individualized fulfillment/cancellation status, access guidance or relocation offer and exact refund to both; explicit disclosure that new listing availability is separate from booked rights.
- **Today/build:** **Build** protected offboarding/cancellation workflow. `docs/architecture/booking-target-phases.md:29–37,61,79–83`; `docs/architecture/phase0/audit-admin-support-controls.md:28,32,65`.

### Additional rows required to ensure no stranded state

#### C28 — Session ends with no arrival or departure taps

- **Outcomes — Recommended — pending owner confirmation for end clock:** customer attendance stays unknown, booked use ends at S; manager receives inspection task and eventual eligible settlement; Local Cooks can reconstruct/correct evidence without blocking ordinary closeout forever.
- **Stripe-fee bearer:** normal booking expense unless a verified separate incident changes remedy.
- **Automatic action:** Ended by S + 15 min, inspection due and I closure independent of taps; no automatic no-show, overstay or damage finding; storage custody handled separately.
- **Timer/expiry:** S/I/H/U, disputed case Q/K; delayed worker cannot move these deadlines.
- **Escalation:** unresolved access/attendance allegation or job failure → support with affected-booking owner.
- **Support action/guardrail:** record assisted event, correct history or close ordinary inspection under G; preserve actual reported versus received time, never use a fake tap to unlock payout.
- **Notifications:** factual end/inspection/remedy deadlines to both; “arrival/departure unconfirmed” where appropriate, then “closed without inspection.”
- **Today/build:** **Build** no-tap closeout; current no-tap visits can stay confirmed forever and historical review does not complete/settle. `docs/architecture/phase0/lifecycle-walkthrough.md:25–29,63–65`; `docs/architecture/phase0/design-checkin-checkout.md:90–96,161`; `docs/architecture/phase0/PHASE0_LOG.md:45`.

#### C29 — Inspection awaiting manager, early clear or claim handoff

- **Outcomes:** customer sees inspected/auto-closed/issue state; manager can inspect/report on time; Local Cooks keeps inspection, claim and payout independent.
- **Stripe-fee bearer:** no inspection-specific fee; underlying booking/claim allocation unchanged.
- **Automatic action:** show I, clear with factual evidence or auto-close uninspected, preserve H/U/Q; claim handoff creates draft, not an approved charge or indefinite hold.
- **Timer/expiry:** I/H absolute from S under proposed clocks; early clear cannot erase U/Q. Draft expires at H.
- **Escalation:** stale visit/deadline, disputed inspection or missed timer → support; claim follows K.
- **Support action/guardrail:** assist/clear/report for party on instruction under G, revalidate selected visit/deadline before action, retain note on failure. No “manager inspected” label from time expiry.
- **Notifications:** inspection due, manager clear/shared note, uninspected auto-close or claim evidence/response to both.
- **Today/build:** **Partial**, with newer local full-page inspection/stale-action repair verified on an attendance-only fixture; capped scheduled closeout/money remains **Build**. `docs/architecture/phase0/PHASE0_LOG.md:98–100`; `docs/architecture/phase0/design-checkin-checkout.md:63,92–96`; `docs/architecture/phase0/lifecycle-walkthrough.md:65`.

#### C30 — Settlement waiting, transfer uncertain or bank payout failed

- **Outcomes:** customer sees service/refund honestly; manager sees eligibility, transfer and bank arrival separately; Local Cooks owes safeguarded payable and timely cure, never an indefinite hold.
- **Stripe-fee bearer:** saved charge/cause allocation; provider correction costs need explicit contract/budget and are never hidden customer penalties.
- **Automatic action:** central guard permits transfer only after S/I/H/U/Q plus scoped case resolution; protect refund/dispute reserves. Reconcile existing transfer before retry. Track bank payout independently; a failed bank payout does not undo service completion.
- **Timer/expiry:** displayed saved release/case cap and provider holding limit; O for transfer/account cure; actual bank schedule and provider payout failure deadline. Unreachable beneficiary enters approved alternate/unclaimed-funds runbook.
- **Escalation:** holding ceiling approaching, payee mismatch, disabled capability, insufficient platform funds or failed bank payout → finance/legal owner before expiry.
- **Support action/guardrail:** hold/release scoped allocation, reconcile recorded transfer, request verified beneficiary/account cure or approved alternate payment under G; no profile-based payee rerouting, duplicate transfer, account-hop holding reset or blind release of contested funds.
- **Notifications:** manager eligibility date/blocker, transfer initiated/verified, bank pending/failed/paid evidence and required cure; customer only receives relevant refund/remedy changes.
- **Today/build:** **Build** deferred release guard/payout workspace; current transfer happens at confirmation and provider recovery is partial. `docs/architecture/phase0/lifecycle-walkthrough.md:16,27,31–39,71–77`; `docs/architecture/phase0/audit-admin-support-controls.md:35,41`; `docs/architecture/booking-target-phases.md:75–85`.

#### C31 — Notification queued, delayed, undeliverable or uncertain

- **Outcomes:** underlying booking/refund rights persist; manager/customer get an in-app task and reachable fallback; Local Cooks owns delivery recovery without making “sent” mean “read.”
- **Stripe-fee bearer:** no new fee; delivery expense is Local Cooks' operating cost.
- **Automatic action:** durable recipient-specific event; revalidate current state/authorization and suppress stale actions; bounded retry, permanent refusal parked with support alert; uncertain send investigated before duplication.
- **Timer/expiry:** existing delivery retry is up to eight attempts with backoff capped at six hours; critical failed delivery enters O immediately. Claim notice failure never silently starts a consent-by-silence clock.
- **Escalation:** deadline-bearing or door-access delivery failure → support now; optional old reminders may expire as stale with an audit record.
- **Support action/guardrail:** retry original or send explicitly versioned correction/reachable fallback under G; no silent email-body edit, unrelated recipient or revived obsolete action. Maintain recipient authorization/privacy.
- **Notifications:** in-app fallback and case update to affected person; staff recovery event; instruction-update email remains customer-only, while case decisions notify affected parties.
- **Today/build:** **Partial** outbox, bounded email retry and staff retry exist; complete timeline/uncertainty/reminder and instruction-update coverage needs building. `docs/architecture/phase0/audit-admin-support-controls.md:18,42`; `docs/architecture/phase0/PHASE0_LOG.md:184–185,200`; `docs/architecture/booking-target-phases.md:89–95`.

#### C32 — Historical cancellation request accepted/declined or policy evidence unknown

- **Outcomes:** preserve customer rights and paid history; manager's prior decision remains evidence, not a new veto on settled owner policy; Local Cooks resolves the historical contract/owed operation.
- **Stripe-fee bearer:** proven historical rule or mandatory remedy; never backfill today's fee/preset into undocumented past acceptance.
- **Automatic action:** classify authorized/captured/transferred/refunded/unknown source; retain legacy readers and reconcile pending operations; no new requests enter manager-gated cancellation after target release.
- **Timer/expiry:** O named review then K remedy plan; existing entitled receipt time remains fixed. Unknown history cannot stay unowned forever.
- **Escalation:** conflicting prior refund, policy or linked allocation → finance/legal support.
- **Support action/guardrail:** honour evidenced terms or make customer-favourable reviewed determination under G, resume same accepted refund operation, record superseding decision without deleting original. Do not rewind cancellation to confirmed to clear a queue.
- **Notifications:** reasoned historical outcome and money status to both; corrected notice separately identified.
- **Today/build:** **Partial** manager request/recovery paths; safe migration/version classification needs building. `docs/architecture/phase0/audit-admin-support-controls.md:13,33`; `docs/architecture/phase0/design-modular-cancellation-policy.md:52,90–93`; `docs/architecture/booking-target-phases.md:115–119`.

#### C33 — Linked equipment, multiple visits or occupied storage

- **Outcomes — Recommended — pending owner confirmation for component scope:** unused reserved session equipment follows its session preset; independently priced/used storage keeps its custody contract; manager does not silently release occupied space; Local Cooks preserves source allocations and visits.
- **Stripe-fee bearer:** each original charge's actual F recorded once; allocate across frozen components without repeated fixed deductions. Separate used storage is not a refund funding pool by assumption.
- **Automatic action:** calculate cancellation per unstarted visit and allocated charge components where approved; release only unused inventory; storage removal/extension has its own bounded task. A charge shared by used/unstarted components needs verified allocation or support review.
- **Timer/expiry:** each visit's actual cutoff and last S; storage extension D/P, saved removal deadline and K custody escalation; no automatic disposal from kitchen cancellation.
- **Escalation:** ambiguous allocation, essential missing equipment, overdue physical removal or mixed-charge holding horizon → support/finance.
- **Support action/guardrail:** decide item/extension for party with consent, reconcile allocation or coordinate removal under G; no double refund, presumed empty storage or applying new kitchen tiers to already-used monthly storage. Keep broader storage redesign deferred.
- **Notifications:** exact cancelled/retained components, custody/removal obligations, item remedy and separate payment status to affected parties.
- **Today/build:** **Partial** item/storage paths; complete automatic allocation/support needs building. `docs/architecture/phase0/audit-admin-support-controls.md:12,37`; `docs/architecture/phase0/design-modular-cancellation-policy.md:74,115,163`; `docs/architecture/phase0/continuation-handoff.md:62`; `docs/architecture/booking-target-phases.md:83`.

## D. Disclosure map: exactly where each rule appears

The following placements are required target behavior. A policy link alone cannot substitute for a visible price, deadline or restriction. Use one structured renderer/version across customer, manager, email and receipt views. All outbound copy uses the person's name where available and “Local Cooks”; no “admin” or “Chef” greeting. Evidence for today's gaps and targets: `docs/architecture/phase0/design-modular-cancellation-policy.md:27–35,43–49,137–147`; `docs/architecture/phase0/lifecycle-walkthrough.md:11–16`.

### Listing — KitchenPreviewPage, directly below price/availability

- Cancellation card: effective preset name, all tiers, “after confirmation, minus actual Stripe processing fee,” pending whole-hold release and Local Cooks help. With dates selected, replace relative thresholds with exact local dates/times and mark the current tier.
- Price breakdown: rent, selected equipment/services, manager-set HST and attainable total; positive Local Cooks service fee and its tax only where charged. At saved 0%, omit label, rate, row and fee-refund prompts. No damage-deposit offer. Klarna absent from payment messaging/options.
- House rules/legal PDF link with effective location/kitchen scope and version, explicitly separate from governing structured money rules. General access overview only; sensitive entry codes restricted to authorized booking views.
- If approved, R1/R2 protections appear as a separate “If the kitchen cannot provide your booking” card, never inside ordinary customer cancellation tiers.

### Kitchen application/access acceptance — before submitting or renewing the application

- Effective location-default or kitchen-override PDF, readable/downloadable; explicit acceptance recorded with file hash/version, person and timestamp. The PDF contains no money rules.
- Already-approved applicants accept a new effective terms version here before a new booking that requires it. Existing bookings stay usable under their earlier terms. Acceptance must not be retroactively attributed or bundled into a payment checkbox.

### Booking flow — date selection and selected-services price summary

- Next to chosen start/end: kitchen zone and exact tier cutoffs; a prominent “Already inside [preset] window” notice if applicable, with the refund outcome that begins on confirmation.
- Immediately above Continue: card hold now/capture only on confirmation, response deadline D and no-cost preconfirmation withdrawal. Show separately governed/used storage and any supported component exceptions, not a hidden PDF clause.
- No damage deposit or Klarna. Any saved-card/extra-charge consent is purpose-specific and separate from application terms; if no approved mandate/rate exists, no automated extra charge is advertised.

### Review step — immediately above Submit request / continue to secure payment

- Restate schedule/zone, exact full/partial/no-refund deadlines, total/HST, hold-versus-charge and D. Repeat inside-window warning even if already displayed earlier.
- Acknowledge **structured cancellation disclosure** through an explicit review acceptance, labelled distinctly from kitchen PDF terms: “I understand the cancellation amounts and deadlines shown, including the actual Stripe processing-fee deduction after confirmation.” **Recommended — pending owner confirmation of acceptance control, subject to acquirer/legal review:** an unchecked structured-policy acknowledgement recorded before Checkout. This does not create a kitchen-terms checkbox at checkout.
- Show a read-only link to the already accepted kitchen terms version and application acceptance record. Do not ask for PDF reacceptance here. Include conditional R1/R2 help and statutory-rights link once approved.

### Stripe Checkout — visible supported custom text beside final payment action

- Repeat “Temporary hold; charged only if the kitchen confirms” and a compact saved-policy restriction, including actual processing-fee deduction and “already inside window” where applicable. Link the same accepted structured version and return path.
- Provider line items match the frozen total/rent/equipment/HST and only positive platform fee/tax. No zero platform row, deposit or Klarna.
- Final action must not contradict app wording by implying immediate capture or unlimited future-charge consent. Required payment/network acknowledgement must be implemented using supported provider controls and approved copy; inability to disclose is a launch blocker, not a reason to invent a PDF terms checkbox.

### Request and confirmation emails — schedule block then cancellation block

- Request email: person's name, kitchen, request status, hold total, D, withdraw link and bank-release caveat.
- Confirmation email: captured amount/receipt, effective saved preset/version, each exact deadline/zone, actual-fee rule, inside-window warning where applicable, saved PDF link and live instruction link. The manager copy shows net earnings and post-closeout transfer timing, not “paid out.”
- Later cancellation/refund emails distinguish cancelled, owed/processing, Stripe-confirmed and failed; include exact total, F, refund and retained amount. At no automatic refund say $0, with separate upward-only extra-refund route.

### Booking page — persistent status/financial summary and separate preparation area

- Header: request/confirmed/cancelled/use/closed state, next action and deadline. Financial card separately shows held/captured/refund/transfer status.
- Saved cancellation card: preset/version, cutoffs, F when known, current refund quote and Cancel booking action at every applicable time; no manager-approval language.
- Saved application PDF/version plus current live instructions/tasks/update time in separate sections. Show instruction-update notices without changing policy/terms versions. Arrival/departure evidence retains what was displayed at submission.
- Persistent Get help / Can't access kitchen; claim/dispute evidence and response clocks; private feedback entry after eligible end. Reviews visible only as own submission to participants, with operator-only combined review.

### Cancel sheet — before the final cancellation button

- Pending: exact hold to release, no charge, bank-display caveat, button “Cancel request.”
- Confirmed: saved tier/deadline, captured T, actual F, E, total not returned, cumulative earlier refund and exact incremental amount. Button describes immediate cancellation and automatic refund; no manager consent gate.
- Unknown F: clear cancellation-now/quote-pending alternative preserving received time; no estimated dollar promise. After cancel, separate Ask for an additional refund and Get help for kitchen-failure/exception routes.
- Manager extra dialog: policy floor, existing owed/paid amount, incremental extra, maximum C and funding preview; disable below-floor/above-cap entries. No processor-fee override for ordinary discretion.

### Manager screens — setup, request detail, inspection, claims and earnings

- **Booking rules setup:** location default plus optional kitchen override, “Using {location} default · Customize for this kitchen,” exactly three presets with Flexible default, generated customer preview, prospective version publication summary. No custom thresholds/percentages.
- **Terms setup:** separate nonfinancial PDF controls, optional kitchen override, upload review, immutable version and new-booking effect. Money wording rejected/reviewed; structured policy wins.
- **Arrival & departure / Customer tasks:** live default/override and preview, separate instruction/task editing, customer-only update-email consequence, no per-booking guide lock.
- **Request detail:** D countdown, amount held, captured only on confirmation, confirm/decline, failure recovery. **Cancelled detail:** automatic policy outcome plus upward-only extra refund; approved R1 kitchen-cancel cost and repeat flag.
- **Inspection/claim pages:** I/H/Q, selected visit/evidence, Clear / Report issue, draft versus submitted, no deposit/automatic liability, truthful collection status.
- **Earnings:** saved supplier/payee, kitchen HST, actual processor cost, expected closeout eligibility, affected-case hold, transfer and bank payout separately. Approved R1 processor debit/waiver appears once in the statement.
- **Local Cooks support case:** same versions, parties, deadlines and full ledger; guarded acting-for actions, reason/evidence/funding/approval preview, operation trace and notice status. Support sees private feedback; participant screens do not expose the other response.

## E. “Nothing gets stuck” launch checklist

Every non-terminal **state on every axis**, including a financial overlay on an otherwise completed booking, must have a persisted owner, next action, due instant, escalation instant, retry/expiry rule and support command. If a provider cannot guarantee completion time, the case still has a next review and a lawful funded cure path; an unowned “waiting for Stripe” state fails this checklist. Below is required target coverage, not completed implementation.

- [ ] **Draft quote / abandoned Checkout:** P expires; release only uncommitted capacity/hold. Support expires/reconciles original Checkout; do not release a captured obligation. C03/C17.
- [ ] **Authorized pending request:** D expires even if manager unreachable; support confirm/decline on instruction or withdraw for customer. Real provider validity bounds every decision. C01–C04/C20.
- [ ] **Capture/release decision executing or uncertain:** O; support reconciles/replays same immutable operation, with original-object lookup and optimistic revision. No second PI or fictional paid/released status. C01/C03/C17.
- [ ] **Confirmed upcoming / use in progress:** starts/ends from saved schedule, persists Ended by S + operational grace; support can cancel for either side, record access issue or assisted arrival/departure. Never require a raw status edit. C05–C13/C28.
- [ ] **Arrival/departure evidence missing, upload failing or stale submission:** schedule remains authoritative; assistance/correction route with reason, reported/received time and retained evidence. End/inspection clocks proceed. Offline draft is not server evidence. C10–C12/C28–C29.
- [ ] **Inspection due / checkout requested:** I closes uninspected or timely issue enters its separate case; support clears/records issue for party through fresh preflight. Early clearance cannot skip H/U/Q. C20/C29.
- [ ] **Legacy cancellation requested / accepted / declined:** named O/K review, same operation recovery and reasoned legacy entitlement. New cancellations have no manager-veto state. C32.
- [ ] **Cancelled with policy refund owed / F unknown / refund pending, failed or requires action:** cancelled stays terminal on commitment axis; refund remains outstanding on finance axis, O/K and protected funding. Support verifies actual fee, retries or uses approved alternate route after provider reconciliation. C18.
- [ ] **Transfer reversal pending/failed or recovered money awaiting failed refund:** O, manager debt cure and separate customer refund funding; support reconciles both legs and prevents double recovery. C19.
- [ ] **Optional extra-refund request:** X reply/expiry; support records manager consent or approved platform exception. Policy refund is never held for this. C06/C20/C21.
- [ ] **Access/safety/supply incident:** urgent response, U/K, named on-call fallback and scoped provisional remedy; support coordinates access/relocation or full/partial refund under approved rules. No ordinary cancellation penalty substitution. C08–C09.
- [ ] **Attendance/no-show allegation or correction pending:** H/Q/K review; support receives both accounts and can withdraw/correct. Missing taps never create guilt. Original service end/financial receipt preserved. C10/C15/C28.
- [ ] **Damage draft:** expires at H without extending settlement. **Submitted/disputed/under review:** Q then K; support submits/responds for party, adjudicates/reduces/waives; silence escalates, not payment permission. C14.
- [ ] **Claim approved / charge pending / authentication required / charge failed:** bounded consent/payment P/O, separate liability versus recovered-money states; support requests voluntary payment or approved legal recovery. Manager reimbursement is not promised without verified collection/funding. C14.
- [ ] **Overstay detected / review / dispute / collection:** factual occupancy and approved structured rates/consent required; H/Q/K/P/O as applicable; support records departure, adjusts/waives/reviews and protects next booking. No tap-based charge. C13.
- [ ] **Customer remedy/dispute/appeal awaiting evidence/decision:** U/Q/K, reasoned extension with named reviewer and maximum financial hold; support makes explicit scoped final/provisional decision and funds it through approved authority. C15.
- [ ] **Card chargeback awaiting evidence/provider decision:** actual issuer deadline plus O next-check reviews; disputes operator accepts/challenges and reconciles credits before refund/transfer. Provider delay cannot be hidden by marking settled. C16.
- [ ] **Change awaiting consent/payment/capture/refund/release/recovery:** bounded proposal/P/O, original booking intact; support previews/decides/reconciles approved revision; expire only replacement holds. Retired amendment writers remain off. C25.
- [ ] **Storage extension/physical removal pending:** original custody contract, displayed deadline and K escalation; support acts for party, coordinates removal and reconciles sources; no automatic emptying or new kitchen-policy coercion. C33.
- [ ] **Settlement ineligible/held/ready/transfer pending or uncertain:** saved end/protection/case and provider holding deadlines; support can resolve case allocation or reconcile same transfer. Protect liquidity and contractual payee. C30.
- [ ] **Payee restricted/missing/account closed or bank payout failed:** finite cure/next review, before-holding-limit finance/legal escalation, approved alternate/unclaimed-funds route. Support requests verified account cure; never repoints funds by manager profile edit. C26/C30.
- [ ] **Policy/terms version missing, conflicting upload or legacy unknown:** new payment disabled until valid evidence; O/K case for existing booking, customer-favourable adjudication without rewriting history. Support retrieves/quarantines/corrects prospectively. C22/C24/C32.
- [ ] **Instruction update queued/failed/stale:** effective guide available in authorized booking view, coalesced durable event and O fallback; support relays current instructions or assists. Revalidate recipient/booked need at send; manager receives no update-email copy. C23/C31.
- [ ] **Any critical notice undelivered/uncertain:** bounded retry then owned recovery, in-app task and reachable fallback; support retries original/corrected version. Claim response cannot be treated as agreement after failed notice. C31.
- [ ] **Account/kitchen offboarding with future obligations:** enumerate every request/booking/claim/refund/payable; each has a disposition and owner before start/holding deadline. Support can fulfill, relocate voluntarily or remedy; no cascade delete or lost refund recipient. C26–C27.
- [ ] **Private feedback awaiting submission:** V expires; support can help submit on verified instruction or correct disclosure, with participant-own/operator-private permissions. Never blocks settlement or automatically decides liability.
- [ ] **Support action awaiting approval/executing/provider pending/recovery:** O/K; approval timeout escalates to named alternate, not permission bypass. **Recommended — pending owner confirmation:** independent second approval at CAD $100 of discretionary exposure or any positive Local Cooks goodwill expense; routine deterministic policy refunds remain automatic within preauthorized rules. Approver cannot approve their own exception. Single-person coverage needs an on-call second approver or queued funded response, never shared credentials.

Release is blocked until all applicable support commands are real guarded service/UI operations with mock/isolated acceptance evidence, not merely a case note saying “someone can fix it.” Required invariants: one effective cancellation time, one operation per obligation, no refund over remaining capture, no transfer of refund-reserved funds, no history rewrite, no manager debit outside policy/consent, no automatic liability from silence, no indefinite tap/manager gate, two-party factual decisions and privacy-safe recipient handling. See `docs/architecture/phase0/audit-admin-support-controls.md:65–75`; `docs/architecture/booking-target-phases.md:69,79–85,125–129`. Existing specialist queues do not yet satisfy this full checklist.

## F. Cited research and professional review

### Evidence supporting the five recommendations

Primary public sources were rechecked on **13 October 2026**. These establish published customer/host outcomes, not competitors' internal staff powers, tax roles or Stripe agreements. Local Cooks' chosen percentages and operational clocks are its own decisions.

1. **Recommended — pending owner confirmation (R1): kitchen cancellation → full customer refund, manager processor cost, waivable, repeats flagged.** [Peerspace's host-cancellation help](https://support.peerspace.com/en/articles/10119173-what-do-i-do-if-a-host-cancels-my-booking) promises the transaction and all Peerspace fees back, with relocation help. [Airbnb's host cancellation policy](https://www.airbnb.com/help/article/990) documents no cancelled-booking payout, deductions from future payouts, evidence-based waivers and repeat/listing consequences. **Local Cooks inference:** recover only the actual processing loss during the pilot, with a waiver, rather than importing competitors' penalty schedules. Neither page proves a universal actual-Stripe-fee liability. Manager offset authority and proportionality require counsel/accountant review.
2. **Recommended — pending owner confirmation (R2): unusable on arrival → full refund through support.** [Airbnb's rebooking/refund policy](https://www.airbnb.com/help/article/2868) covers failed access, health/safety hazards and materially missing facilities; it weighs severity, evidence and affected use. [Turo's cancellation policy](https://turo.com/us/en/policies/cancellation), revised **12 October 2026**, provides full refunds for eligible unsafe/unclean vehicles rejected at start and immediate support reporting. **Local Cooks inference:** refund a wholly unprovided kitchen session in full; review partial use separately and do not force a voluntary-cancellation selection. Turo's check-in conditions are not kitchen rules. Pilot fee funding and safety coverage require approval.
3. **Recommended — pending owner confirmation (R3): customer no-show → start-time cancellation outcome.** [Turo's cancellation policy](https://turo.com/us/en/policies/cancellation) treats no-shows as a separate evidenced cancellation category with timing, refund and host-report requirements. It uses different economics from ordinary late cancellation. **Local Cooks inference:** a simple start-time policy calculation with no added penalty is predictable for hourly kitchens. This exact rule is a Local Cooks proposal, not an Airbnb/Peerspace/Turo standard. Evidence and late-arrival safeguards must accompany it.
4. **Recommended — pending owner confirmation (R4): exceptional full refund → Local Cooks-funded pilot.** [Airbnb's Major Disruptive Events Policy](https://www.airbnb.com/help/article/1320) establishes a separate, bounded exception layer that can override listing cancellation rules for covered events. Its policy excludes many personal disruptions and can affect host payouts. **Local Cooks inference:** use a documented, budgeted support exception instead of silently rewriting presets; platform-fund pilot generosity so it does not spend manager money without consent. The source does not establish a duty for Local Cooks to fund every exception or provide insurance.
5. **Recommended — pending owner confirmation (R5): manager response capped at 24 h and before start.** [Airbnb request handling](https://www.airbnb.com/help/article/28) gives a 24-hour response period. [Stripe authorization guidance](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) requires capture before actual authorization expiry. The Local Cooks short-notice failure is documented at `docs/architecture/phase0/lifecycle-walkthrough.md:15–16`. **Local Cooks inference:** min(24 h, start minus preparation buffer, provider validity minus safety margin) prevents confirmation after the usable session has started. The 30/15-minute buffer proposals are not sourced marketplace standards.

### Other product/financial conclusions

- **Preset floor, document precedence and booked-version preservation:** [Vrbo policy options](https://help.vrbo.com/articles/What-are-the-cancellation-policy-options) describes tiers, displayed policy precedence over conflicting rental agreements, custom refunds at least equal to entitlement and existing-booking preservation for seasonal edits. This supports the pattern; Local Cooks uses only its three fixed presets and future-only versions, not Vrbo's calendar cutoffs or custom policies.
- **Processor expense versus customer entitlement:** [Stripe Canada pricing](https://stripe.com/en-ca/pricing) says original processing, Connect and FX fees are not returned under standard refunds. It does not authorize retaining them from a customer. Only the verified actual card-processing component selected by the owner belongs in F; exclude unrelated Connect/FX/Radar/refund fees, tax on Stripe services and markup. The repository currently reads aggregate fee, so classification is a build/review gate (`docs/architecture/phase0/design-modular-cancellation-policy.md:21,48,117`).
- **Refund recovery:** [Stripe refund guidance](https://docs.stripe.com/refunds) documents pending/failed refunds, alternate arrangements after failure and avoidance of duplicate reimbursement where a pending refund is disputed. A cancelled booking's refund debt survives provider failure. Refund success and bank receipt differ.
- **Transfer and bank constraints:** [Stripe separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers?locale=es-ES) documents separate refund/transfer funding; [manual payouts](https://docs.stripe.com/connect/manual-payouts) describes country-specific holding limits and makes clear that manual payouts are not escrow. The first link is the official regional documentation returned by search; the current English variant could not be opened during this review, so account-specific verification remains required. Deferred settlement requires approved retained-liability protection, holding horizon and payee recovery; changing a bank payout schedule alone is not booking-aware settlement. Repository gate: `docs/architecture/booking-target-phases.md:79–85`.
- **Finite claim/inspection rather than infinite settlement:** the earlier primary-source comparison of kitchen PIN records, post-event payouts and claim windows is in `docs/architecture/phase0/design-checkin-checkout.md:17–27`. It supports separate evidence, service-end, claim and payout axes; it does not establish universal mandatory taps or Local Cooks' proposed I/H/Q/U/K values. Owner approval of those values remains necessary.

### Required legal, accountant and payment-provider review before publication/rollout

1. **Canada/NL contract and refund rights — legal review.** Identify the legal supplier for rent, equipment, storage and platform fee; booking/application contract formation; cardholder/business authority; refund cost disclosure; mandatory rights; liability and relocation obligations. [NL's Consumer Protection and Business Practices Act](https://www.assembly.nl.ca/legislation/sr/statutes/c31-1.htm) excludes business-purpose persons from its consumer definition, but covered distance-sale cancellations under sections 32–33 require a refund without deduction within 15 days. Do not treat job title or a business checkbox as proof that protections never apply. Mandatory remedies override the ordinary cap.
2. **Truthful price/refund presentation — legal/acquirer review.** [Competition Bureau drip-pricing guidance](https://competition-bureau.canada.ca/en/deceptive-marketing-practices/drip-pricing) warns against unattainable prices caused by mandatory fees other than government charges. Show any positive mandatory platform fee in attainable pricing and never market a captured refund as “free cancellation” or “100% of your payment” while retaining F. Have the acquirer approve conspicuous structured-policy acknowledgement and hosted Checkout wording; previous network evidence is in `docs/architecture/phase0/design-modular-cancellation-policy.md:22–35`, and needs current Canada/account-specific confirmation. Application PDF acceptance alone is not acceptance of an undisclosed later money restriction.
3. **GST/HST — accountant review.** Manager configuration is an operational input, not proof of registration, agency, invoice issuer or remittance responsibility. Verify supplier registration and place of supply; the current [CRA provincial table](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html) lists NL at 15%, while rates differ elsewhere. [CRA collection/invoice guidance](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html) requires truthful rate/tax documentation. Confirm Local Cooks registration rather than assume it from older memo wording. A positive platform fee and any tax on it need a separate lawful basis; at zero fee there is no fee/tax row.
4. **Cancellation/no-show/offset tax treatment — accountant review.** [Excise Tax Act section 182](https://laws-lois.justice.gc.ca/eng/acts/E-15/section-182.html) addresses certain breach/modification/termination payments to registrants. Decide how retained cancellation payments, processor deduction, manager cost recovery/waivers, goodwill, damages and overstay are treated, and issue appropriate immutable adjustments/credit notes. Cash entitlement arithmetic does not determine taxable consideration or a blanket 100% HST credit.
5. **Manager offsets, reserve and custody — legal/accountant/provider review.** Approve R1 written recovery authority, one-time F allocation, no-next-payout cure, waiver and lost-recovery expense. Approve platform-funded refund/goodwill reserve and delegated spending. Review actual Canadian holding limits, safeguarded retained liabilities, refund/chargeback float, RPAA applicability and unclaimed funds; use the real custody chain, not the word “escrow.” Treasury gates remain unverified for production (`docs/architecture/phase0/lifecycle-walkthrough.md:71–79`; `docs/architecture/booking-target-phases.md:81–85`).
6. **Damage/extra-use, privacy and notices — legal/acquirer review.** No deposit may be reintroduced through PDF or saved-card wording. Obtain permissible charge purposes, structured rates/caps, evidence/notice/response requirements, fresh assessed-amount consent or a valid brand/MCC-specific mandate. A saved card, reported claim, unticked task or unanswered email is not general authority. Confirm private feedback/evidence access, record retention, account deletion exceptions and transactional-email/CASL treatment. The detailed review dependencies remain at `docs/architecture/phase0/research-cancellation-deposit-policy.md:169–188,264–277`.

## G. Remaining owner decisions

Settled items above are not reopened. The remaining approvals can be grouped into four decisions:

1. **Approve R1–R5 as a package or specify exceptions:** kitchen-cancel full refund/manager F debit and waiver; wholly unusable kitchen full refund (recommended pilot F funded by Local Cooks unless approved fault rule applies); evidenced no-show at start; Local Cooks-funded exceptional full refund; manager deadline capped before start.
2. **Approve the operating clock package and coverage:** D buffers, P/S/I/H/U/Q/K/O/X/V and appeal/cure deadlines; staffed urgent fallback and the funded provisional outcome at maximum case/holding deadline. Current 60-minute lazy inspection is not a selected replacement policy.
3. **Approve money/recovery authority:** goodwill/refund reserve, second approver/delegated limits, manager debt/waiver agreement, chargeback loss allocation and lawful alternate/unclaimed-funds cure. Positive platform-fee partial/extra-refund allocation must be approved before any fee above 0% is enabled; kitchen HST remains manager-configured, subject to accountant validation.
4. **Approve remaining edge contracts only if enabled:** structured extra-use rates/consent and damage collection; component/series/used-storage allocation; amendment cancellation-clock preservation; offboarding remedy and renewal acceptance for updated kitchen PDFs. These may stay disabled/deferred; existing bookings still require guarded support resolution. Counsel/acquirer/accountant sign-off in F is a professional launch gate, not an unanswered product choice.

**Handoff:** this is the single requested documentation file. Implement through the existing Phase 2 snapshot/disclosure, Phase 3 request/payment, Phase 4 cancellation/recovery, Phase 5 closeout/settlement and Phase 6 communications checkpoints. The repaired local visit UI is not evidence that automatic refunds, full support coverage or deferred payouts already work.
