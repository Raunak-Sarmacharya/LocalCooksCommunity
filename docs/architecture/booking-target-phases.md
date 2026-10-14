# Phased architecture checkpoints and acceptance plan

2026-10-11. **Planning only.** This is the requested phase-by-phase sequence with owner-verifiable checkpoints, not implementation work packages, tickets or authorization to change code/schema/configuration. After architecture approval, detailed work packages may be written; implementation remains a separate gate. All proposals J, facts labelled R/F/T/Q. [Consolidated proposal](booking-target-architecture.md).

## Common checkpoint discipline

Every phase ends with: visible behavior demonstration, meaningful automated invariant tests, financial/permission/history comparison, owner local walkthrough, documented failures and rollback rehearsal. Stop advancing until the checkpoint passes and owner accepts the behavior. Do not implement all phases before the first walkthrough. Cross-cutting legal/provider blockers can be researched independently, but blocked features stay disabled.

Local baseline uses network-blocked/mocked adapters for Stripe, SMTP, Twilio, Firebase/Auth/Firestore, R2, Inngest and telemetry. Simulated provider/time outcomes are explicitly labelled. Verified development Supabase disposable rows may be used only with isolated runtime recipients/side effects blocked; no pre-existing records changed/deleted. Config labels, a dev branch and test keys alone do not prove the full path. Existing experiment records and baseline suite failures are in [environment evidence](booking-environment-and-experiments.md); a later agent must not change implementation merely to make an investigative test pass.

## Phase 0 — decisions, boundaries and reproducible baseline

### What the owner checks when Phase 0 is complete

Phase0 is investigator-run verification and decision preparation, not new application functionality. The owner receives: (1) an environment/recipient map showing verified test targets versus mocked/blocked integrations; (2) a reproducible current-flow walkthrough using approved synthetic accounts; (3) test results with expected/observed behavior, known defects and simulation limitations; (4) proposed policy choices and exact outstanding factual/approval dependencies. The owner checks that the walkthrough reflects the intended business, that no diagnostic money/message reaches a real recipient/resource, and that the evidence supports proceeding to Phase1. The owner need not operate a harness or assemble child reports. Phase1 onward introduces the proposed functionality only under separate implementation authorization.

Owner subsequently authorizes bounded harness/browser diagnostics on `dev-chef.localcooks.ca`, `dev-kitchen.localcooks.ca` or localhost. This does not override the no-production, no-implementation and complete-path-isolation requirements. Read-only browser initialization reached the chef site and its `/en-CA` route; two snapshot attempts timed out with `Preview automation snapshot timed out after 15000ms.` No forms/actions submitted, login attempted or downstream resource isolation established. This is initial tooling evidence, not completion of Phase0 or proof of a website defect. Kitchen-site browser inspection was not established.

**Goal:** approved architecture principles and environment evidence before money/communications change. Resolve which kitchen business supplies rental, collection agreement, taxable bases and invoice issuer; actual test Stripe platform/account country/controller, connected capability, webhook endpoints/API version; permissible holding/sweep controls; manager operating coverage, required credentials/equipment capacities, supported booking lead-time and clock choices. Compile exact fixture identities and recipient allowlists. Existing owner answers: manager tax configuration; admin fee including zero; fee refundable; development sender and admin inbox.

**Local checkpoint:** owner can inspect current application/request/confirmation journey and baseline known mismatches; fixture money maps match source, no external request/message occurs. Produce an evidence pack without keys/card details. Pure local mocks may show proposed screens but must not pretend Stripe controls were verified.

**Gate:** approve P-A or another refund principle, policy-edit lock transition, settlement B or another option, supplier/fee roles and proposed staffing-dependent clocks. Any unknown stays explicitly disabled/conditional. Required numbers must be approved before configuration publication, not filled from source defaults.

**Interim safeguards to authorize before any phased rollout:** classify open legacy damage claims and saved-card consent evidence; do not continue automatic off-session claim charging without verified disclosure/consent and appropriate recorded authority. Use a lawful on-session recovery link where evidence is missing. Establish named administrators/payment operators; no support hire gets full admin. Audit sensitive upload routing/public visibility with read-only evidence; keep private document delivery blocked where protection is unknown. Assess RPAA/payment-regulation applicability against the actual custody chain and controlled bank accounts; provider handling alone is not a legal determination. These are future rollout entry conditions, not changes made in this investigation.

## Phase 1 — authoritative access, vocabulary and listing readiness

**Goal:** one final access guard, requirement validity/waiver ownership, reasoned prospective suspensions, accurate stage labels, mandatory published kitchen rules with guided fields and conflict review. Preserve optional tour and canonical location conversation; direct-grant access needs messaging continuity. Existing tier-2 grants become review cases without unsafe blind grandfathering or deletion of paid bookings.

**Owner walkthrough:** new chef completes platform checks and requirements, remains unable to request until manager final approval; receives actionable renewal/denial notices. Existing approved chef can see why suspended and status of paid future sessions. Manager publishes a complete rules profile, sees platform fields read-only, supplemental agreement before request. Former manager cannot see new sensitive content after reassignment.

**Acceptance:** server bypass at tier2 rejected; valid final entitlement succeeds; rejection/expiry supporting grant suspends new access; valid separate entitlement survives unrelated application failure; legal requirement cannot be waived via admin convenience; licence expiry routes paid session to review; inaccessible documents are not accepted. Role/assignment tests cover customer/manager/admin and future support restrictions.

Before support staffing, verify minimal case-read/messaging and separate payment-operation scope; support cannot change fees/policies, charge cards or browse unrelated credentials. Sensitive files use authenticated authorized short-lived reads, with version/hash retained; forwarded raw URLs must not disclose private evidence. Supplier business/Connect ownership is explicit, separate from operational manager assignment.

**Rollback:** disable new-request cohort if safety uncertainty; preserve entitlement audit and booked customer recovery. Do not restore the vulnerable tier2 unlock as a rollback convenience. Existing active sessions remain explicitly handled.

## Phase 2 — terms snapshots, fees, taxes and transparent quotes

**Goal:** stable policy/rules/price/tax/fee identity, quote acknowledgements and exact local deadlines. Enforce interim active-booking policy lock server-side. Stage future-only versions behind a separate gate; remove lock only after snapshot coverage demonstrated and owner approves. Positive historic fees remain intact after admin fee changes.

**Owner walkthrough:** compare zero-fee and positive-fee listings/Checkout/customer/manager/admin/email/PDF. With zero charged fee no transaction fee row/action appears; processing cost still correctly labelled to manager. Change location tax/price or admin fee; new quote changes, accepted booking does not. Try changing cancellation window with active bookings; server blocks and explains. Draft future version preserves existing booking if later approved.

**Acceptance:** integer minor units, stable rounding/allocation totals, tax/fee basis validated, expiry/timezone boundary, quote-versus-fulfillment version mismatch, explicit zero versus unknown legacy data, immutable terms/document hash, current policy link never replaces accepted rules; concurrent request/policy publish cannot bypass lock. Override edits affect only explicitly intended scope.

New positive-fee/tax configurations cannot become payable until their legal supplier/registration/basis and manager processor-burden matrix is validated. Unknown tax is not solved by charging zero; affected new-cohort supply stays payment-disabled pending review. Customer-favourable exceptions and legally compelled corrections have audited notice/remedy paths without mutating original terms.

**Rollback:** stop publishing new policy versions; retain snapshots/readers and prior documents. Do not reconstruct existing terms from mutable configuration.

## Phase 3 — inventory request and payment confirmation

**Goal:** one authorized-request path, kitchen and constrained add-on reservation, bounded product/provider decision deadline, durable capture/release compensation and correct confirmation. Legacy automatic/free paths inventoried and gated; keep shared storage payment/removal invariants without multi-day redesign.

**Owner walkthrough:** choose equipment capacity, see held versus confirmed calendar, submit request and see authorized/not charged. Manager accepts before deadline: exact capture, confirmation and receipt. Decline/withdraw/timeout: hold-release states. Two customers contend for final slot/item; only permitted capacity succeeds. Essential add-on unavailable means customer review, not silently downgraded paid booking.

**Acceptance:** last-unit concurrency with real transactions in verified disposable test DB; provider capture_before shorter than product SLA; missing deadline; capture versus cancellation race; partial accepted items and released remainder; zero-cost path; lost capture reply/provider success SQL failure; every post-auth fulfillment error compensation; no capture at/after deadline; client redirect cannot confirm; duplicate/reversed webhooks. Pure mocks do not prove real DB locking or card expiry.

Signed provider-event inbox and recovery must cover `charge.dispute.*`, refund updates/failures and account/payout status before the new money cohort is enabled. Partial acceptance recomputes tax/positive fee from original consented components. Deadline tests prove refusal to initiate at/after cutoff; deliberately delayed provider completion exercises explicit incident/recovery, not an impossible network-completion promise.

**Rollback:** pause new requests/captures, leave durable recovery/webhook processing active for in-flight operations. Never switch an ambiguous capture to another PI or release inventory while a paid service obligation is untracked.

## Phase 4 — cancellation, remedies and recovery

**Goal:** committed cancellation is effective independent of manager response/refund completion; exact itemized entitlement; automated unused kitchen/platform full remedy; distinct incident/used-resource review; funded startup loss accounting.

**Owner walkthrough:** cancel immediately before cutoff; delay manager/worker beyond cutoff and retain same entitlement. Try after cutoff and see agreed retention. Kitchen cancels a paid booking: full affected gross including positive fee/tax, no customer processor deduction. Simulate refund pending/failed: booking stays cancelled, support owns recovery, money status honest. Occupied storage does not become physically cleared.

**Acceptance:** equality boundary explicitly approved; retry same cancellation ID after network failure; old quote changes state before submit forces refresh or honours still-valid quote rule; cumulative refunds never exceed refundable captured allocations; tax adjustment matches original; fee zero/new-zero/historic-positive cases; capture/cancel/refund/transfer overlap; legacy already-transferred reversal failure does not block owed customer remedy; reversal succeeded/refund failed preserves restoration debt; card dispute prevents duplicate refund outside reconciliation.

**Rollback:** disable automation for new exceptional cases while retaining owed obligations and refund operations. Keep cancellation timestamp fixed. Admin queue becomes temporary recovery, not a manager veto.

## Phase 5 — closeout, claims and deferred settlement

**Goal:** end-to-end post-service release without indefinite manager dependency. Manager inspection, missing-checkout fallback, bounded customer remedy, later damage filing and settlement clocks remain distinct. Verify treasury/platform sweep protection before enabling B. Existing early-transferred cohort stays on legacy recovery.

**Owner walkthrough:** complete booking, receive manager inspection task, clear with evidence, wait saved remedy gate, see Transfer to Express and separately simulated bank payout. Ignore inspection: auto-close visibly says no inspection and releases on saved conditions. Report non-delivery before deadline: only affected booking held with admin owner/deadline. Draft damage claim expires without indefinite hold; timely submitted claim reviewed separately. Later claim after ordinary settlement remains possible under saved rules and is not automatically paid.

**Acceptance:** scheduled-end cap independent of delayed checkout; no check-in/out/no-show contested path; multiple visits end calculation; early manager clear cannot end customer remedy; repeated drafts cannot restart clocks; claim silence escalates; separate SCA-required/failed claim charge never marks reimbursed; no transfer while overlapping refund/dispute/incident operation; exact net allocation and actual fees including genuine zero fee; transfer accepted SQL lost-reply reconciles once; account offboard/reassignment preserves beneficiary; transfers capability versus payout_disabled correctly classified; failed bank payout does not reverse service completion; holding-limit escalation resolves/funds lawful alternative rather than blindly releasing contested money.

**Treasury/provider gate:** country/holding deadline and clock verified, protected retained liabilities and refund/dispute float proved, manager agreement/expected bank timing approved. No clock-reset or account-hop workaround. No whole-kitchen freeze for one contested booking.

**Additional Phase5 entry/acceptance:** central source transfer guard enforced for every caller/source type; record settlement model/supplier payee atomically; prove all old executors drained and pre-guard rollback excluded for B. Manager profile/account change cannot reroute funds; ownership mismatch enters beneficiary cure. Timely incident has separate maximum case SLA/escalation and fully funded contractual provisional fallback. Reject/disabled payee and failed refund get cure deadlines and legally approved alternate/unclaimed-funds runbooks; failed customer refund excluded from kitchen settlement. Pre-transfer delivered-service fraud chargeback allocation is explicitly approved/funded, not silently shifted to kitchen. Check entire capture-to-last-service/attached-storage-end plus closeout/remedy/case/cure/margin against holding ceiling at quote and capture; mixed PI cannot transfer owed components prematurely. This is a dependency constraint, not a multi-day storage redesign. RPAA/custody assessment is complete before enrollment.

**Rollback:** stop new deferred-settlement enrollment/transfers while recovery stays active; never route held in-flight B funds to legacy early transfer through a global flag. If released money requires refund, use the recorded source/model. Preserve contractual maximum release obligations during rollback.

## Phase 6 — durable communications and financial documents

**Goal:** apply [communication matrix](booking-target-workflows.md), current recipient authorization and SMTP uncertainty to existing delivery families; immutable receipts/tax invoices/adjustments/final summaries/settlement statements. Most notice dependencies must be introduced with the earlier phases, not deferred until here; this phase verifies complete coverage and operator tooling.

**Owner walkthrough:** fake clock traverses request/confirmation/prep/arrival/end/inspection/refund/settlement; inbox sink contains correct timely message for each role. Cancel/reschedule/reassign before queued send: stale actions absent. SMTP accepts then times out: uncertain case visible, no blind repeated send. Download original receipt after setting changes; identical original financial content and issue date; separate refund adjustment/final summary. Supplier identity/tax docs reviewed by accountant.

**Acceptance:** full timing matrix including Newfoundland/DST/overnight; permanent email failure leaves in-app critical task/admin recovery; privacy changes before IO; separate channel outcome; duplicate event/retry key; late actions suppressed; financial finality prerequisite; old paid event after cancellation factual/current-status-aware; source docs original schedule not current mutable fallback; positive refunded fee history versus original zero; no duplicate Stripe/app receipt emails; current Stripe test automatic receipt behavior not assumed.

**Rollback:** suppress new optional sends and document publication on uncertainty; keep in-app obligations, immutable originals and audit. Recover critical notices manually to approved recipients. An already-sent message cannot be unsent; corrective notice has new explicit identity/reason.

## Phase 7 — isolated rehearsal and staged release

**Goal:** prove the integrated path before any live rollout is separately authorized. First local mocks; then bounded test providers only after runtime targets and every recipient/storage/auth side effect are verified. Never use production Neon here. No test phone approved, Firebase/R2 isolation not proven, local sender still differs from tour-approved sender [F/R/Q]. Keep those paths blocked/mocked until resolved.

**Rehearsal:** synthetic clearly labelled customer/manager/location/booking, Stripe test method and test connected account; webhook signature, retry/duplicate/order; real test authorization/capture/cancel/refund status; isolated Inngest destination/signed route and dedicated SQL worker connection; only approved mail recipients/sink. Log IDs, expected/observed outcomes, cleanup and retained evidence. Test Clocks/fake time don't establish real card expiry, bank clearing or month-long holding. Real long waits require an explicitly bounded observation plan.

**Owner checkpoint:** replay normal request → accept → use → close → transfer, then cancellation/refund, no-manager action, provider lost reply, inaccessible kitchen, stale reminder and dispute scenarios. Compare every view/ledger/Stripe test object. Review residual failures, support runbook and rollback before enabling any real cohort.

**Later live release proposal, not authorization:** selected new bookings at opted-in kitchens, small funded exposure, operations staffed. Expand by observed money/delivery mismatch and owner gate, not date-based auto rollout. Production verification requires separate permissions/process; no production guarantee is inferred from this phase.

## Optional later phase — modifications and counteroffers

New confirmed modifications are currently retired [R]. Core booking may launch without them only if UX says change unsupported and offers transparent cancellation/new-request or support-assisted alternative without disguised penalties. If owner requires self-service changes for initial release, include this phase before Phase7; this scope choice remains Q.

Target proposal/consent version keeps original confirmed booking and inventory until replacement is financially and transactionally committed. Hold new capacity bounded; display original/new schedule, price/tax, positive fee, policy, cutoff and delta. Increases need separate customer-authorized payment; reductions create owed refund, not fiction that original capture changes. For extensions/moves avoid resetting cancellation rights to permit costless repeated cutoff evasion; define carried-forward versus new component terms explicitly. Failed/expired change releases only replacement hold and preserves original. Never silently move booking because manager suggests it in chat. Reconcile source financial documents per revision and compensating operations; no generic counteroffer engine is needed.

## Migration, flags and rollback design

Proposed rollout flags: final-access guard, snapshot-required quotes, policy publication lock/future versions, definitive cancellation, compensation recovery, deferred settlement enrollment, communication uncertainty, optional modifications. Capture policy/settlement versions on each booking/operation; request-time flags alone are insufficient. Reader capability ships before new writer; schema expansion is additive and separately authorized later.

Classify legacy records by provider/money/accepted-terms evidence: authorized undecided; captured not transferred; transferred; refunded/reversed; unknown/contradictory. Never backfill today's cancellation/tax/fee into a supposed historical accepted snapshot. Store provenance and `legacy_requires_review` where incomplete. Unknown paid sessions get explicit operator review, not automatic punitive policy; unsafe requirements are not blindly grandfathered. Preserve all original IDs/receipts/history.

Shadow comparisons compute hypothetical new entitlement/net without provider mutations and explain divergences. Dry-run settlement is not permission to write/sweep funds. At cutover, finish/reconcile in-flight operations under their own recorded model; new B bookings stay B even if flag later disabled. Keep old financial reader/recovery until every legacy cohort obligation is resolved. No database reset, deletion of old ledger or dual charge/refund path. A rollback pauses new writes/actions and keeps reconciliation alive; it cannot undo accepted terms, captured money or mailed disclosure.

## Acceptance coverage and production observability proposal

Use unit tests for policy/time/allocation functions, real transaction tests for locks/atomic outboxes in a verified disposable development DB, adapter contract tests for provider truth, and UI role walkthroughs for comprehension. Existing executed diagnostics: many money/recovery tests pass, but baseline suite has failures/missing modules and only mocked external effects [T]. Those results are not a completed target acceptance suite. New architecture tests are future acceptance requirements, not fabricated passed results.

Observe booking/operation/event/delivery correlation IDs with no credentials/full card data. Named operator owns queues for undecided approaching deadline, authorization orphan, capture uncertain, refund owed/pending/failed, transfer uncertain, incident overdue, holding-limit approach, stale worker, delivery uncertain/permanent failure and provider-event unapplied. Dashboards expose source, next safe action, deadline, amount at risk and last verified provider state.

Metrics: current-state/provider-state mismatches; captured-but-unconfirmed; cancelled-without-funded-refund; gross refund liability versus protected liquidity; transfer before release (target zero); cumulative refund/settlement over-allocation (zero); snapshot mutation (zero); expired pending authorization; hold contention; reminder stale/unauthorized sends (zero); SMTP uncertain age; operations recovery age; policy comprehension/support-contact rate; kitchen/customer cancellation cause; resold hours; processor loss as actual amount/reason; manager cash delay and unresolved claims. Exact alert thresholds are approved with volume/staffing; existing worker >10-minute health logic is R, not a promise chosen here.

Runbooks specify original-object lookup, safe idempotent retry, conflict escalation, balance funding, payout/account restriction response, delivery verification/correction, participant revocation, failed damage collection, provider-limit approach and rollback. Operators never manually edit `paid`/`refunded` to clear a queue without verified source evidence. Production monitoring is proposed; no production system was accessed or configured.
