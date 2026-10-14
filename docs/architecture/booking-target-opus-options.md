# Booking target architecture: three startup options (independent Opus draft)

2026-10-11 · `development` @ `1417751f` · one bounded Claude Opus 5.5 High pass. Read-only: local docs, source and public official pages. No provider, database, network-side-effect, email, SMS, test or configuration call; nothing else changed. **Input to the lead's consolidated draft**, not approval of policy, thresholds or implementation. Code numbers are current fallbacks, not proposals.

Evidence classes follow [booking-current-state.md](booking-current-state.md): F owner/founder, R repository, T executed diagnostic (none here), O operational (none), E current official external source, I inference, J judgment, Q unresolved.

## 1. Fixed inputs

- **Owner answers [F].** Admin-set platform fee, may be 0. A zero fee is never displayed, and fee-refund actions exist only when a fee was charged. The platform will return its fee where appropriate. Owner proposes locking the cancellation field while bookings are active or unclosed, and the sequence manager closeout → admin damage-claim window → payout. No numeric cutoffs are chosen here.
- **Money shape [R].** Platform Checkout, manual capture (`server/services/stripe-checkout-service.ts:338`). Separate charges and transfers to **Express** accounts (`server/services/stripe-connect-service.ts:60`). Transfer fires from the capture/charge webhooks (`server/routes/webhooks.ts:1915-1928,3418-3428`). Pending timeout is creation + 24 h (`server/services/auth-expiry-service.ts:42`), not `capture_before`.
- **Reusable strengths [R].**
  - Durable `paymentDecision` (`booking-payment-decision.ts:21`).
  - Frozen quote metadata (`shared/booking-capture-terms.ts`), saved `cancellationPolicyHours` and duty snapshots.
  - Original-identity refund/reversal recovery (`stripe-service.ts` `reverseTransferAndRefund`).
  - Transfer key `transfer:<pi>` (`stripe-transfer-service.ts:420`).
  - Component allocations, outboxes and the checkpointed worker (`recurring-worker.ts:112`).
- **Accepted defects [R].**
  - Booking unlocks at tier 2 while the UI treats tier 3 as final (`chef.service.ts:186-197`).
  - Acceptance re-checks the current time (`booking-cancellation-refund.ts:63`).
  - A manager's paid cancellation returns `requiresManualRefund` (`manager.ts:4843-4845`).
  - New changes are retired (`kitchen-booking-changes.ts:245-422`).
  - Plain fulfilment errors can orphan an authorization (`booking-checkout-fulfillment.ts:92`).
  - No general add-on capacity control (ownership and removal checks do exist).
  - Policy save clears the submitted fields' overrides location-wide (`manager.ts:3317-3330`).
  - Booking SMTP-uncertainty handling is weaker than tours'.
  - The fixture failures are **not** proven overbooking.
- **Out of scope.** Multi-day storage redesign. The shared PaymentIntent and occupied-resource dependencies remain constraints.

## 2. Stripe facts that decide settlement [E]

| Fact | Consequence |
|---|---|
| Separate charges: "refunding a charge has no impact on any associated transfers". A reversal is "only possible … if the connected account's available balance is greater than the reversal amount or has connected reserves enabled" ([SCT](https://docs.stripe.com/connect/separate-charges-and-transfers.md?platform=web&integration=checkout&ui=stripe-hosted)). | After a transfer, the refund cost sits with the platform until recovered. |
| A `source_transaction` transfer takes the charge's pending status. Without one, a transfer fails on insufficient balance and is not retried. "Automatic payouts can interfere with transfers that don't have a defined `source_transaction`" (same page). | A deferred transfer must keep `source_transaction`. Platform payouts must not sweep held funds. |
| "Your platform is responsible for losses incurred by Express connected accounts" ([Express](https://docs.stripe.com/connect/express-accounts)). | Disputes and negative balances fall on Local Cooks under every option. |
| Stripe recommends holding funds "only when there's a clear purpose". Its typical case is rentals, where the platform "waits for the service to be completed and confirmed". Its holding-period table lists "All other countries: 90 days" ([balances](https://docs.stripe.com/connect/account-balances)). Manual payouts must be paid out within 90 days outside the US and Thailand ([manual payouts](https://docs.stripe.com/connect/manual-payouts)). | Holding until the service is complete is an endorsed purpose. Lead time + closeout + window must fit within 90 days, so far-ahead bookings need a release rule. The lead should confirm the 90-day table applies to platform-balance holds. |
| Payout `interval` (manual/daily/weekly/monthly) can be changed by platforms that own fraud and dispute liability or have platform controls. `delay_days_override` (≤ 31) applies to `on_behalf_of` and direct charges ([schedule](https://docs.stripe.com/connect/manage-payout-schedule)). | `delay_days` does **not** delay these transfers. The levers are transfer timing or manual payouts. |
| Canada default settlement is 3 business days; the initial settlement is 7 calendar days ([payouts](https://docs.stripe.com/payouts)). | Settled is not the same as bank cash. Disclose timing to managers. |
| Negative connected balances: the platform reserve is held, and after 180 days a `connect_collection_transfer` zeroes the balance. `debit_negative_balances` can debit Canadian banks ([balances](https://docs.stripe.com/connect/account-balances)). | Reversal failure has a back-stop, at platform cost. |
| Authorization windows: Visa CIT 7 days, Visa MIT 4 d 18 h, other brands 7 days. The true deadline is `payment_method_details.card.capture_before`. Partial capture releases the remainder, and most payments allow a single capture. Automatic delayed capture is **private preview** ([hold](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)). | A far-ahead request cannot hold its authorization until the session, so capture at confirmation. Don't depend on preview features. |
| Receipts are sent only for successful payments. `invoice_creation` on Checkout is priced separately ([receipts](https://docs.stripe.com/payments/checkout/receipts)). | An authorization is not a receipt. The code note that `invoice_creation` is incompatible with manual capture (`stripe-checkout-service.ts:366`) is R only, not confirmed by E. |

Market close-out evidence is weak [E]:
- Airbnb says reviews "could result in funds being delayed up to 45 days after guest check-in" ([Airbnb payouts](https://www.airbnb.com/help/article/425), opened directly).
- A search summary of Peerspace's help centre reports host payouts "within 7 days after the booking ends", with overtime and extra charges submitted within 72 h paid separately ([Peerspace help centre](https://intercom.help/peerspace-108cf19aff8e/en/); **summary only, lead to verify**).

Pattern: payout after service, adjustments in a separate window; no Local Cooks number follows.

## 3. Three viable architectures

All three options stay within the current setup: the Express/React/Drizzle modular monolith, SQL as source of truth, the existing outboxes and the recurring worker. None adds a workflow engine, event store or rules engine. They differ in **when the kitchen's money leaves platform control**.

### Option A: harden the current shape (transfer near capture)

Keep the transfer at capture time. Close the defects:
- tier-3 gate;
- cancellation effective on submission;
- enforced refund when the kitchen cancels;
- no capture after the session starts;
- compensation fix.

Refunds after capture that the kitchen should fund run in order: platform refund, then reversal, then offset against future transfers, then invoice.

- **For:** smallest change. Kitchens get cash fastest. Recovery code is reused as is.
- **Against:**
  - Every kitchen cancellation, platform failure and post-capture chef refund depends on reversal liquidity, and the funds may already have been paid out [E].
  - Offsetting needs new receivable semantics and a contract set-off clause (Q).
  - Closeout and the claim window never gate money, so the owner's sequence becomes advisory only.

### Option B: transfer at closeout (platform-held settlement)

Capture at confirmation, as now. Move `transferToManagerForBooking` out of the capture webhooks into a worker settlement step:

```text
confirmed+captured ─ session ─ closeout (manager clear | auto-clear) ─ remedy window ─ SETTLEABLE ─ transfer(source_transaction) ─ Express auto payout
        ↘ any cancellation/refund before settlement: refund from platform balance, no reversal
```

- **For:**
  - Refunds before settlement never need a reversal, which removes most of the R1 liquidity risk.
  - Matches the fund holding Stripe endorses.
  - Reuses the existing idempotent `source_transaction` transfer.
  - Closeout becomes a real financial gate.
  - Retained cancellation shares settle through the same step.
- **Against:**
  - Kitchens are paid later (commercial/contract Q).
  - Platform payouts must not sweep held funds [E/Q].
  - Far-ahead bookings approach the 90-day limit.
  - Held funds are commingled; funds segregation is private preview.
  - Disputes after settlement still fall on the platform.

### Option C: transfer at capture, manual Express payouts

Keep the capture-time transfer, set Express payouts to `manual`, pay out after closeout. `server/services/payout-processing-service.ts` is an unwired scaffold [R].

- **For:** funds stay reversible in the connected available balance; managers see earnings immediately.
- **Against:** interval control needs liability ownership or platform controls (`controller` Q); new per-account payout/failure/bank-arrival surface; claim and overstay reimbursements also go manual; visible-but-unpayable balances drive support; one disputed booking can stall an aggregated payout; 90-day limit still applies.

| Criterion | A | B | C |
|---|---|---|---|
| Refund independent of kitchen funds | Platform float only | Until settlement | Until payout |
| New money surface | Receivable/offset ledger | One trigger + release rule | Per-account payout scheduler |
| Kitchen cash timing | Fastest | Slowest | Slow, balance visible |
| Owner's closeout → payout sequence | Advisory | Native | Native |
| Main unknown | Contract set-off | Platform payout sweep, 90-day release | Payout-interval authority |

## 4. Recommendation [J]: Option B with explicit controls

### 4.1 Eligibility, final approval and revocation

- **One bookable state.** Booking unlocks only at **Approved for this location**: Local Cooks has verified the mandatory requirements and the assigned manager has given final approval (today's tier 3). Remove the tier-2 self-grant (`chef.service.ts:186-197`).
- **Credential validity.** At request and again at confirmation, each expiring mandatory credential must be valid through the end of the session.
- **Why two-party approval.** Comparable practice supports platform minimum checks plus kitchen acceptance (Food Corridor document compliance and Peerspace host acceptance, cited in the policy proposals). It does not support an extra manager pre-review.
- **Revocation is prospective and reasoned.** It blocks new requests immediately and records actor, reason and time. Confirmed bookings are never silently deleted:
  - **Safety or credential revocation:** suspends the session into an admin case. Funds are held and there is no forfeit.
  - **Kitchen's discretionary revocation:** counts as a kitchen cancellation, so the chef gets a gross refund.
  - **Alleged chef rule breach:** becomes an admin case that defaults to the snapshot refund schedule.
- **Existing tier-2 rows** go on a one-time admin review list.

### 4.2 Active booking definition, and lock versus immutable terms

- **Active** means Local Cooks may still owe a decision, service or money. That covers:
  - a pending authorization;
  - a confirmed or in-progress booking;
  - a cancellation whose refund is not terminal;
  - a booking that has ended but is not closed out;
  - an open remedy window;
  - an open claim or dispute;
  - an unsettled transfer.
- **Closed** means settlement is terminal and no refund, claim or dispute is open. This should be one derived predicate, not another status column.
- **Prefer immutable per-booking terms snapshots over a lock.** Most pieces already exist (hours, quote, duties). Extend them into one frozen terms record holding the cutoff, refund schedule ID, disclosed text, fee rate (an explicit 0) and timezone. Policy edits then apply only to new bookings, and the manager sees "N existing bookings keep their terms".
- **Why not the lock:** permanent for any kitchen with recurring bookings, blocks chef-favourable edits, protects one field. **Fallback:** lock only not-yet-snapshotted fields; confirm explicitly before `manager.ts:3317` clears overrides.

### 4.3 Cancellation

- **Before capture.** Withdrawal, decline or timeout releases the hold at no cost.
  - Decision deadline = min(session start, `capture_before`) − an admin margin (not chosen here).
  - No acceptance or capture after the session starts, enforced in `decideAuthorizedBooking`.
- **Chef cancels after capture.**
  - Effective at the platform-recorded submission time and computed from the snapshot. The manager is notified, not asked.
  - A failed refund never reverts the booking.
  - Gross versus disclosed-net inside the full-refund band remains the owner's choice (P4/R2).
- **Kitchen cancellation, platform failure or failure to supply.**
  - Automatic refund from the platform balance of the affected kitchen price, unused add-ons, tax and any fee charged. No reversal is needed before settlement.
  - An enforced refund decision replaces `requiresManualRefund`.
  - A manager's fault claim opens an admin case but cannot withhold the refund.
- **Partial use and occupied storage** keep the existing admin gate (`booking-cancellation-refund.ts:65-67`).

### 4.4 Manager closeout and settlement

**Correction to the owner's sequence.** Damage claims are charged off-session to the **chef's** saved card (`damage-claim-service.ts:1155,1328`) and transferred to the kitchen once paid (`:1441`). Holding the kitchen's booking payout through the *damage* window therefore secures nothing and only delays the kitchen. The hold should instead protect the **chef's remedy**: service not provided, kitchen inaccessible, equipment unusable.

1. **Closeout.** The manager clears (`kitchen-checkout-service.ts:547`), or the existing auto-clear fires after the admin-only review window (`:79`, current fallback maximum 480 min). Attendance evidence stays separate from payment.
2. **Remedy window** (new, admin-set). An open non-delivery report holds only that booking's settlement.
3. **Settle.** Transfer with `source_transaction` and a deterministic key. With zero commission, the transfer is the charge minus the actual processing fee.
4. **Damage-claim window, in parallel.** Admin-set; current fallback 14 days (`damage-claim-limits-service.ts:32`). Collected from the chef, independent of settlement.
5. **Forced release.** Settle and flag the booking before it nears the provider holding limit.

If the owner still prefers to settle only after the claim window, record that as a commercial choice. It lengthens the kitchen's cash delay without adding customer protection [J].

### 4.5 Fee, invoice and receipt timing

| Moment | Customer | Manager |
|---|---|---|
| Request (authorized) | "Request received, card hold". Not a receipt or invoice. | Action request |
| Confirmation/capture | Itemised receipt for the captured amount. Any tax invoice is issued here, because partial capture fixes the sale (issuer/HST Q). | Confirmed, with expected settlement date |
| Refund | Refund receipt or credit note once the provider reports `succeeded`, not at request time | Notice of retained/refunded amounts |
| Settlement | None | Statement: gross, actual processing fee, commission **only if > 0**, net, transfer ID. The bank payout follows separately. |
| Damage claim | Separate receipt | Separate line |

- **Store the zero.** Persist `feeRate = 0` explicitly, so a missing value never means "unknown".
- **Hide when zero.** Hide fee lines and fee-refund actions when the charged fee is 0. Several surfaces already gate on `> 0` (`BookingPricingBreakdown.tsx:69,137`; `BookingConfirmationPage.tsx:754`) [R].
- **Caution [R/I, rendering unverified].** `calculateCheckoutFeesAsync` folds the Stripe estimate and a minimum into "totalPlatformFee" (`stripe-checkout-fee-service.ts:325-330`). Displays must separate processing cost from commission, or managers will see a "platform fee" even at 0%.

## 5. Provisional state, authority and refund-loss matrix [J]

| Situation | Result | Authority | Customer gets | Loss bearer (startup default) |
|---|---|---|---|---|
| Withdrawal, decline or deadline before capture | Hold released | Chef / manager / system | Full release | None |
| Chef cancels inside full-refund band | Cancelled on submission | Chef | Gross (or disclosed net) | Platform absorbs processing fee; kitchen not paid |
| Chef cancels after cutoff | Retained share settles | Chef | Per snapshot | Chef |
| Kitchen cancels, discretionary revocation, or cannot supply | Kitchen-caused cancellation | Manager / admin | Gross, including any fee | Platform pays first; fee recovered only by contract (Q) |
| Platform error | Platform-caused cancellation | Admin | Gross | Platform |
| Credential or safety revocation | Suspended into a case | Admin | Held refundable; no default forfeit | Case outcome |
| No-fault disruption | Case | Admin | Unused portion | Platform absorbs fee (owner to accept) |
| Chef no-show | No-show | System + manager evidence | None by default | Chef; disputes go to admin |
| Non-delivery reported in remedy window | Settlement held | Admin | Scoped refund | Kitchen share withheld before transfer |
| Damage | Claim | Manager files, chef responds, admin decides | n/a | Chef's card; a failed charge is not offset from the kitchen |
| Card dispute | Dispute hold | Admin | Per dispute | Platform (Express); reversal or offset if already settled |

## 6. Payment and closeout safeguards

- **S1. Money predicates.** Derived money predicates; `failed` never means a release. Use distinct terms for released, captured, refund pending, refunded, settled and paid out.
- **S2. Deadline.** Take the decision deadline from the provider's `capture_before` at fulfilment. Keep the 24 h default only if it is shorter.
- **S3. One settlement task.** A single idempotent settlement task. Capture webhooks record fees only. Claim and overstay transfers keep their own paths.
- **S4. Settlement conditions.** Settle only when all of these hold:
  - refunds are terminal;
  - no dispute is open (requires adding `charge.dispute.*` and `refund.updated/failed` handling, absent today [R]);
  - no remedy report is open;
  - the account is `payouts_enabled`.
- **S5. Held funds.** Verify that platform payout settings cannot sweep held funds. Reconcile held liability against the platform balance daily [E/Q].
- **S6. Compensation.** Every fulfilment failure after authorization enters compensation, and compensation verifies a terminal cancel or refund (A8).
- **S7. Health signals.** Track per booking: undecided-request age, closed-out but unsettled bookings, pending refunds, and approach to the holding limit.
- **S8. Migration.** Bookings already transferred keep A-style recovery. Only new captures defer settlement, flagged per booking in the snapshot.
- **S9. Notices.** Outcome-style delivery with recipient revalidation plus the tours' SMTP-uncertainty pause. Sender config untouched: `test_automated@localcooks.ca` is the development sender; local `EMAIL_FROM`/`EMAIL_USER` read `localcooks@localcook.shop` [F/R].

## 7. Consequential objections for the lead

1. **Owner sequence vs claim mechanics.** Holding payout until the claim window closes does not secure claims. Gate settlement on a chef remedy window instead (§4.4). Needs owner acceptance.
2. **Kitchen cash delay.** B pays kitchens later than today. Existing promises to managers and contract terms are Q. Peerspace's reported "within 7 days after the booking ends" is unverified.
3. **Platform payout sweep.** B is unsafe until the lead, who owns Stripe research, verifies the payout settings.
4. **90-day limit vs far-ahead bookings.** Needs a release rule, or an owner-chosen maximum booking horizon.
5. **Lock vs snapshot.** I recommend snapshots. The lead decides whether a lock is acceptable as an interim measure only.
6. **Gross vs net, and fee tax.** Still open. A zero commission removes fee refunds but not processing cost.
7. **Express liability.** Post-settlement disputes and negative balances remain platform losses. The actual `controller.losses` value is Q.
8. **Invoice issuer.** Whether Local Cooks or the kitchen issues determines invoice versus receipt (accountant Q).
9. **Start-time invariant vs same-day requests.** The margin is an owner threshold.
10. **Keep Option C alive** until S5 is verified.
11. **Rule-breach revocation default.** Defaults to the snapshot schedule; any forfeit needs legal review.

## 8. Phased architecture checkpoints (not work packages)

Each checkpoint ends with local, network-blocked, mocked verification and owner sign-off. No implementation packages until the final architecture is approved.

- **CP0:** vocabulary and the active/closed predicates.
- **CP1:** eligibility, revocation and the tier-2 review list.
- **CP2:** provider deadline, start-time invariant and compensation.
- **CP3:** effective cancellation, enforced kitchen refund and the terms snapshot.
- **CP4:** deferred settlement for new captures, settlement preconditions, dispute/refund events and platform-balance verification.
- **CP5:** remedy window, independent claim window and forced release.
- **CP6:** receipts, credit notes, settlement statements, zero-fee rendering and booking SMTP uncertainty.
- **CP7:** observability and a named recovery owner, then a bounded test-mode rehearsal, but only after resources are verified. Firebase `formauth-9e620`, R2 `localcooks-training-videos` and Twilio are unverified; `test_admin@localcooks.ca` is the only approved recipient.

## 9. Evidence index

**R** (all under `server/` unless noted): `routes/webhooks.ts:1915-1928,3418-3428` · `services/stripe-transfer-service.ts:149,404,420,546` · `services/booking-payment-decision.ts:21` · `services/booking-cancellation-refund.ts:57-67` · `routes/manager.ts:3317-3330,4843-4845` · `domains/users/chef.service.ts:186-197` · `services/kitchen-checkout-service.ts:79,547,612,746` · `services/damage-claim-service.ts:1155,1328,1441` · `services/damage-claim-limits-service.ts:28-32` · `services/stripe-checkout-service.ts:366,553` · `services/stripe-checkout-fee-service.ts:308-330` · `services/payout-processing-service.ts` (no callers) · `services/recurring-worker.ts:112` · `services/auth-expiry-service.ts:42` · `shared/kitchen-booking-policies.ts:8-24` · `client/src/components/booking/BookingPricingBreakdown.tsx:69,137`.

**E:** §2 URLs, opened directly except Peerspace (search summary). **F:** owner answers in the brief; founder PDF/extract is context only.
