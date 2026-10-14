# Local Cooks proposed booking architecture

2026-10-11. **Proposed design for owner approval; not an implementation authorization.** Lead: Sol through Codex, High. Independent options and adversarial review: Opus 5.5 through Claude, explicit High. No Fable/Astra escalation is justified. Application code, configuration and schemas have not been changed. Numeric policy choices remain approval gates.

## Read this first

**Recommendation [J]: retain the modular monolith and current separate-charges-and-transfers integration. Authorize when requesting; capture only when the manager accepts before the decision deadline; transfer the kitchen's earned money after a bounded closeout/remedy period. Express then pays the kitchen's bank according to its effective schedule.** Manager inaction cannot keep money withheld indefinitely. A damage allegation is a separate case and payment, never an automatic debit or proof of liability.

Require final access approval and applicable valid credentials before checkout. Make ordinary cancellations effective at the committed submission time. Give a blameless customer a full affected refund when the kitchen/platform cannot deliver, including tax and any platform fee charged. Preserve accepted policies, prices, taxes and kitchen rules for every booking. Hide platform-fee rows/actions only when that booking's actual fee is zero. [J; zero-fee and refundable-fee requirements F]

This document consolidates the decisions; supporting specifications provide the detail an eventual implementation needs:

- [Current journey, terminology, evidence and contradictions](booking-current-state.md), [Stripe current state](booking-stripe-current-state.md), [communications current state](booking-communications.md).
- [Target money flow, Stripe limits and financial documents](booking-target-money-and-documents.md).
- [Target communication timing and failure matrix](booking-target-workflows.md).
- [Phased checkpoints, migration, acceptance and observability](booking-target-phases.md).
- [Independent review and explicit reconciliation](booking-target-review-reconciliation.md).
- [Investigation task register](booking-investigation-register.md), [environment and diagnostic evidence](booking-environment-and-experiments.md).

Evidence labels: **F** founder/owner context; **R** repository; **T** executed tests; **O** operational/production evidence; **E** current external source; **I** inference; **J** recommendation/product judgment; **Q** unresolved. All target behavior below is J unless individually labelled. Existing test source is R until executed. No production evidence was obtained. Founder PDF at `C:/Users/rauna/.t3/userdata/attachments/f762e860-12ab-43c4-9486-b418deca8385-0c8f90e8-d753-4414-83ab-ffe23fa53b8e-pdf.pdf` is hypotheses/context, not specifications; it was read after repository reconstruction.

## Fixed owner requirements and hypotheses

**F requirements:** admin sets platform fee, including zero; platform may refund its fee; location/kitchen manager sets the location's tax configuration; Local Cooks is a marketplace and kitchens have connected Express accounts. `test_automated@localcooks.ca` is the development sender, not a test customer. `test_admin@localcooks.ca` is the approved development administrator recipient. Tour sender changes are precedent for selective reuse; booking configuration has not yet been updated.

**F hypotheses to evaluate, not settled requirements:** lock cancellation-policy editing while active bookings exist; wait for manager closeout and an admin-controlled claims period before payout; require kitchen terms and replace upload-only UX. Recommendations below explicitly qualify these hypotheses. Owner has authorized this architecture proposal and phased plan, but has not approved it or requested implementation work packages.

## Repository-backed reasons for change

| Current evidence [R, unless marked] | Consequence | Proposed response [J] |
|---|---|---|
| `server/domains/users/chef.service.ts` and `server/domains/bookings/booking.service.ts` allow approved tier 2; application UI expects tier 3 | Access appears final before final review; saved grants can outlive rejection | One final entitlement service; existing grants reviewed, not blindly revoked |
| `server/services/booking-payment-decision.ts`, `shared/booking-capture-terms.ts` persist decisions/quotes before Stripe IO | Strong foundation already exists | Extend the existing durable operation pattern, not replace it |
| `booking-checkout-fulfillment.ts` atomically creates request/add-ons/ledger/outbox but some plain errors escape compensation | Authorized card can remain without usable booking | One durable compensation outcome for every post-authorization failure |
| `stripe-checkout-service.ts` manual-capture platform Checkout; `stripe-transfer-service.ts` separate transfer; `routes/webhooks.ts` invokes transfer near capture | Express alone does not gate settlement until service completion | Remove early transfer triggers only for bookings assigned the new settlement model |
| `booking-cancellation-refund.ts` checks decision time as well as request time; manager paid cancellation can require manual refund | Earned eligibility can expire while waiting; cancellation can lack financial remedy | Committed submission determines entitlement; durable refund obligation accompanies cancellation |
| `kitchen-checkout-service.ts` manager clear, draft claim handoff, auto-clear already exist | Useful closeout foundation, currently separate from early transfers | Preserve visit evidence and attach an explicit settlement gate |
| `damage-claim-limits-service.ts` separate inspection and claim filing defaults; `damage-claim-service.ts:2018` escalates silence | A later claim need not hold ordinary payout; silence is already not consent | Keep separate clocks, review disputed claims, bound settlement holds |
| `shared/schema.ts:570` saves cancellation hours; quote/duties have partial snapshots | Versioned immutable terms are justified by concrete retroactive-change risks | Small typed policy versions plus immutable accepted snapshots |
| `shared/schema.ts:385` kitchen terms URL/timestamp; manager creation/settings upload UI | Current uploaded file identity is weaker than immutable published terms | Guided rules, versioned document identity and explicit acceptance |
| `invoice-service.ts` titles chef PDF INVOICE, manager PDF PAYOUT STATEMENT; generates date at download and has mutable fallbacks | Labels and original issue evidence can drift | Separate receipt, tax invoice, adjustment and settlement documents |
| Outboxes, `advance-notice-service.ts`, `recurring-worker.ts`, delivery families already exist | No new infrastructure needed; delivery gaps remain | Reuse SQL workflow intents and worker; fix recipient/state/SMTP uncertainty consistently |
| Baseline diagnostics include failures and missing imports [T] | No all-green or provider-correctness claim | Preserve test limitations; staged acceptance must prove new invariants |

Full evidence qualifications, exact symbols and test results remain in the current-state reports. In particular, failing availability fixtures are **not proof of real overbooking**, ownership/removal checks already exist, and new confirmed-booking modifications are retired rather than merely incomplete.

## Three viable architectures

| Alternative | How it works | Benefits | Costs/risks | Viability condition |
|---|---|---|---|---|
| **A: early transfer with funded recovery** | Keep capture-time transfers; fund refunds at platform; recover by reversal and contract-backed receivable/set-off | Smallest settlement change; fastest manager cash | Refunds after transfer depend on platform liquidity; recovery/support burden and credit exposure | Sufficient funded refund/dispute float, agreements and recovery owner; owner accepts closeout is advisory |
| **B: deferred booking transfer — recommended** | Capture on acceptance; keep allocation on platform; transfer after service and bounded remedy/closeout | Most pre-settlement remedies avoid reversal; fits desired trust flow; reuses transfer machinery | Platform payout sweep protection, per-booking release/accounting, later kitchen cash, holding-limit controls | Effective Stripe controls/allowed holding confirmed, protected liquidity and approved manager terms |
| **C: early transfer, controlled Express manual payouts** | Transfer near capture; with verified authority disable automatic/self payouts; calculate releasable account amounts and issue bank payouts | Earnings visible in connected balance; account-level control | Aggregate balances do not identify bookings; reversals still needed; payout jobs, currency, failed-bank and dashboard permissions add complexity | Actual account controls enforced, booking allocations, provider limits and funded refunds; no assumption that manual mode alone is sufficient |

All use one application/database, explicit SQL transactions, outboxes and durable work. No change to charge model is recommended. Option C is a fallback if B's balance controls cannot be made safe, not an automatic substitute. Option A can support already-transferred legacy bookings alongside B; that does not justify switching new bookings between models unpredictably.

**Why B [J/I]:** current code already owns platform charges, captured line-item allocations and stable transfer operations. Deferral addresses customer recovery without adding an account-wide payout scheduler. It is more than moving a webhook line: settlement eligibility, sweep protection, idempotency, component allocation, independent claims, observability and migration must come first.

## Application boundaries and records

Keep focused modules inside the existing Express/React/Drizzle application:

1. **Access/onboarding:** requirements, document evidence, final entitlement, suspensions and reviewer authority.
2. **Booking/inventory:** quote, committed request, manager decision, session/visit, cancellation and optional later modifications.
3. **Terms/pricing:** typed policy definition, effective version, per-booking snapshot and line-item/tax/fee allocations.
4. **Payments/settlement:** provider objects, durable operations, refund obligations, transfers, dispute/recovery cases and reconciliation.
5. **Communications:** SQL outboxes, recipient authorization, channel delivery attempts and Inngest wakeups.
6. **Operations/documents:** immutable financial document versions, audit timeline, case queues and operator actions.

Logical records are design requirements, not permission to migrate: reuse `kitchen_bookings`, visits, `payment_transactions`, existing decision/outbox/delivery/claim/history objects wherever practical. Add only missing policy/snapshot, settlement obligation, provider-event inbox or operation fields. Store integers in minor currency units and currency on all financial records; no floating-point money. An ordinary relational allocation/operation ledger is sufficient; do not build a general accounting engine or event-sourcing platform.

Commands validate actor, current state, applicable immutable terms and deadline under the same cooperating lock/transaction; write state/history/outbox atomically. Provider calls happen outside long SQL locks through durable operations. Commit a pending operation before IO; verify provider identity/status/amount after IO; finalize with compare-and-set. On uncertainty reconcile the original operation, never invent a replacement payment. Inngest orchestrates wakeups/retries, SQL determines eligibility and Stripe determines financial outcomes.

## Journey and separate state maps

```text
Discover → optional tour/location conversation → apply → Local Cooks checks
→ chef requirements → manager final approval → approved access
→ choose verified slots/add-ons → held quote/Checkout → authorized request
→ manager acceptance + verified capture → confirmed booking
→ preparation/arrival/use/departure → manager inspection or auto-close
→ bounded customer remedy gate → settlement eligible → transfer → Express bank payout
```

Rejection/withdrawal/timeout before capture releases authorization. Chef cancellation after capture records cancellation and its refund obligation immediately. Kitchen failure records a cancellation and full affected remedy. Open incidents can block only the relevant settlement; banking progress does not determine whether a session was delivered.

| Dimension | Target states/meaning | Guard |
|---|---|---|
| Access | applying / awaiting evidence / final review / approved / suspended / revoked | Approved entitlement plus applicable credentials; no tier-2 unlock |
| Request/booking | request pending / confirming / confirmed / in use / cancelled / service ended | Confirmed only after capture or explicit genuine zero-charge path; no use while merely requested |
| Inventory | no hold / Checkout hold until timestamp / request reservation until deadline / confirmed allocation / released | Capacity and hold ownership under cooperating locks; financial refunds can finish after released session inventory |
| Payment | not required / authorization pending / authorized / capture pending / captured / released / failed / review required | Release is not payment failure; captured amount comes from provider truth |
| Refund | none / owed / processing / succeeded / failed / review | Cancellation does not revert if money fails; original refunded amounts limit further refund |
| Closeout | not due / inspection due / cleared / auto-closed without inspection / incident review | Auto-close is not proof of physical inspection; missing checkout/check-in has explicit fallback |
| Claim | draft / submitted / customer response / admin review / decided / payment pending / paid or failed | Draft and silence neither approve nor charge |
| Settlement | retained pending service / held for scoped review / eligible / transfer pending / transferred / recovery required | No open overlapping money operation; no transfer before contractual release gate |
| Bank payout | unknown / scheduled / pending / paid / failed | Stripe Payout and allocation evidence; a Transfer alone does not prove bank deposit |
| Policy | draft / published version / superseded | Accepted snapshot never changes; future edits create new version |

Use these as separate dimensions, not one giant status enum. UI shows only the few relevant labels and the next actor/deadline.

## Policy ownership and final authority

| Decision | Customer | Kitchen manager | Local Cooks admin/support | System/provider |
|---|---|---|---|---|
| Mandatory minimum credentials | Supplies evidence | Verifies kitchen-specific requirements; cannot waive legal/platform minimum | Owns platform minimum, evidence exceptions within lawful authority | Server gates request/confirmation/use; legal requirements cannot be waived by software |
| Final access | Applies, renews | Final assigned-location approval or reasoned denial | Platform veto/safety suspension; documented override only within authority | No privilege inferred from an intermediate tier |
| Tax configuration | Reviews charged tax | Configures own location's applicable rate/status/details [F] | Validates required data; cannot invent tax obligation | Snapshot correct basis/rate; accountant/legal confirms collection/issuer |
| Platform fee | Reviews positive charge | Views relevant charged allocation | Sets future fee [F], approves standard fee-refund policy | Explicit zero saved and hidden; historic positive fee preserved |
| Cancellation policy | Accepts before request | Chooses allowed cancellation window; cannot override platform supply-failure protections | Owns allowed envelope and refund/exception rules | Saved deadline and submission time, not manager discretion |
| Kitchen rules | Accepts visible version | Authors use/safety/access/cleaning rules and lawful supplemental contract | Reviews contradictions/publication readiness, controls platform rules | Snapshot, acceptance identity and history |
| Standard chef cancellation | Initiates definitive action | Receives notice; no veto | May grant customer-favourable exception, documented | Automatically computes entitlement from accepted terms |
| Kitchen cancellation | May report cause/decline reschedule | Reports inability; cannot force chef to cancel as voluntary | Owns disputed attribution/remedy/recovery case | Default unused supply-failure gross refund |
| Closeout/claims | Requests checkout, supplies evidence, contests claim | Inspects/clears, submits supported claim by saved deadline | Decides disputed claims/remedies; reasoned review/appeal | Auto-close bounded; chef silence never consent |
| Refund/transfer | Sees owed/processing/completed | Sees own earnings/recovery | Named payment operator executes recovery; privileged actions audited | Provider authoritative, idempotent money operations |

There is no separate support role today [R]. Until scoped permissions exist, only the owner and explicitly named authorized administrators/payment operators operate these queues; do not give a support hire full admin as a shortcut. Before staff delegation, provide minimal case-read/messaging permission separately from payment-operation permission, with reasons and audit; no policy editing or unrestricted credential-document access. Support viewing a case is not authority to change policy or charge a card. Reassignment revokes former manager future communications/operational access while retaining lawful historical financial records under an explicit privacy rule. Financial beneficiary identity belongs to the supplier business and verified account, not automatically to the current manager user.

## Eligibility, rejection and revocation

Final manager approval should follow platform minimum checks and applicable kitchen requirements. Tours remain optional unless a published operational requirement is approved; conversation continuity spans onboarding and booking, and valid direct grants must receive a proper booking messaging path. Scope stays location-based to match current access/conversation code; business representation scope remains a blocking Q.

Requirements must declare issuer, reviewer, expiry semantics, validity at request/confirmation/use, and permitted waiver authority. Required expiring documents normally cover the intended session end; renewal-dependent conditional bookings are a separate later product choice. Rejecting an incomplete application stops new access; existing valid approved access is not silently erased by an unrelated application. Rejection/expiry of the evidence supporting an entitlement suspends it with notice and an audit reason.

Revalidate confirmed future sessions on licence/credential suspension. Suspend unsafe use and open an admin case; do not silently cancel paid bookings, release occupied storage, apply forfeiture or pretend safety is grandfathered. Kitchen discretionary denial of an already-confirmed valid customer is supply failure. Chef-caused noncompliance, fraud and disputed safety attribution require evidence and a saved policy, not automatic blame. Review legacy tier-2 grants before new requests and assess upcoming paid sessions individually.

## Policy versions, edit lock and kitchen terms

Snapshots are supported by repository evidence: cancellation hours, frozen capture terms and duties already exist, while mutable settings and document URLs still threaten accepted terms. The target is a few explicit typed policies, not a generic rules engine.

Freeze the quote/terms when the customer submits Checkout and re-verify its unchanged identity at authorized-request fulfillment: policy ID/version, disclosed text version, timezone, exact UTC/local cutoff, response deadline, refund bands/component eligibility, line items/tax/fee basis, closeout/remedy/claim windows and limits, requirement/rules/document versions, money model, verified supplier/payee account identity and acknowledgements. This is customer assent, not the manager's later acceptance. Verify policy/quote identity through Checkout expiry and fulfillment. An approved booking modification receives a new explicitly consented revision; original terms/receipts remain retrievable.

**Owner lock hypothesis:** launch with a strict server-side lock on cancellation policy/terms changes that could affect unresolved accepted bookings until full snapshot coverage is proven. A banner must explain affected bookings and how to close/review them. Drafts may be edited; publishing is blocked. "Active" for this interim lock includes pending requests, confirmed/unclosed service and unresolved affected money/cases, not merely calendar dates. SQL must prevent concurrent booking creation and policy publication bypassing the lock.

**Recommended eventual behavior, requiring owner approval:** manager publishes future-only versions with a clear preview, effective date and count of existing bookings retaining earlier terms. Busy kitchens otherwise could never edit policy. The permanent invariant is no retroactive disadvantage, not an endless settings lock. Customer-favourable exceptions are recorded per booking; they do not mutate original terms. Compelled legal corrections use an audited admin review/notice path and affected-booking remedies; safety instructions may be sent immediately as notices, not fictional new contractual assent. The lock's objective removal criterion is verified immutable coverage/provenance for all active bookings plus owner approval of future-only publication. Location saves must not silently clear unrelated kitchen overrides.

**Mandatory published kitchen rules, optional file:** require a guided rules profile for listing bookability. Sections: permitted business activities and occupancy; food-safety/allergen duties; opening/access and emergency contact; included versus reserved/paid equipment; cleaning, waste, utilities and checkout evidence; prohibited conduct; required credentials and any separately signed agreement. Generate an accessible human summary. Show platform-controlled cancellation/refund/fee/claim/payment rules from structured fields as read-only content; do not require managers to manually copy changing numbers into PDFs.

Optional supplemental contracts need legal business identity, version, immutable content/hash, effective date, review status and signature requirement disclosed before the paid request. A file link alone is not proof of accepted content. If signature is mandatory, complete it before request or clearly disclosed conditional onboarding before money; do not spring a contract after confirmation. Terms cannot override platform protections, introduce hidden deposits/fees or automatically authorize damages. Review detects conflicts; do not promise automated legal analysis. Changes affect future bookings; new emergency instructions may notify existing customers without claiming retroactive contractual assent. R2 remains unverified/shared, so future storage changes require verified isolation. Published non-sensitive rules can be public; credentials, licences, claim evidence and business-specific private agreements need private objects and authenticated, short-lived authorized reads. Emails link to permission-checked pages, not raw sensitive file URLs. Audit existing upload routing/public visibility; `server/r2-storage.ts` can return public URLs [R], but exposure of each document category remains Q, not a proven breach.

Airbnb displays standard/additional rules across listing, booking, communications and post-booking views, and requires supplemental contract disclosure before booking. These support disclosure placement, not importing lodging rules or legal conclusions. [E: house rules](https://www.airbnb.com/help/article/472), [E: guest contracts](https://www.airbnb.com/help/article/2824). Food Corridor's configured compliance and monthly billing are useful kitchen context, but its billing cycle should not replace this per-booking marketplace model. [E: kitchen settings](https://help.thefoodcorridor.com/en/articles/1413936-set-your-kitchen-s-general-settings), [E: bills](https://help.thefoodcorridor.com/en/articles/14759929-how-to-check-your-bill).

## Cancellation policy alternatives and recommended principles

For ordinary chef cancellation, one platform-standard schedule with a manager-chosen window inside an approved envelope is the simplest launch choice. The window determines an exact deadline in the saved kitchen IANA timezone. Do not copy Airbnb's nightly tiers into hourly commercial use.

| Viable policy | Before saved cutoff | After cutoff | Startup trade-off |
|---|---|---|---|
| **P-A: simple gross full-refund window — recommended** | Refund entire affected customer charge, including applicable tax and positive fee | Retain agreed booking value under approved schedule; unused variable add-ons handled explicitly | Clearest promise; platform budgets sunk processor costs; owner must approve late bands and unused-item treatment |
| **P-B: disclosed processor-net window** | Return eligible gross less disclosed actual nonreturnable processing cost | Saved late schedule | Lower cash loss but weaker UX/accounting; cannot advertise full refund; only voluntary chef cancellation, never blameless supply failure |
| **P-C: graded cancellation bands** | Full gross in earliest band; then an agreed partial band | Agreed final retained band | Better resellability economics, more copy/calculation/test burden; defer until lead-time/resale evidence warrants it |

No cutoff hours, percentage, new cap or penalty is approved here. Existing location cancellation-window values can be migration evidence but do not establish that customers accepted a complete new refund schedule. Recommend P-A's principle; measure lead time, resold hours, cancellation reasons and processor losses before expanding bands. Full-refund language means full affected customer-paid amount; actual Stripe expense is internal.

**Proposed P-A launch rule for approval:** an uncaptured request releases its entire authorization. A chef cancellation recorded by the saved cutoff returns all affected captured value, tax and positive fee. After cutoff, reserved rental and reserved equipment value remain payable; genuinely unused variable services not committed to that reservation are refunded with corresponding tax and the associated proportional platform fee. A classification of included/reserved/variable components must be published, not inferred from the word “unused.” Used/delivered resources and storage removal require scoped handling. Kitchen/platform non-delivery returns full affected gross regardless of the chef cutoff. Admin can grant a documented customer-favourable exception. This is a proposed simple two-band schedule, not a policy changed in the database; exact hours and component classifications still require approval. Recommend “cancel by” to include a submission exactly at the saved cutoff, with identical server/UI/test semantics, subject to owner approval.

**Committed submission governs eligibility.** An idempotent cancel command commits timestamp, reason, affected components, frozen monetary quote, cancellation and refund obligation in one transaction. Refund processing can continue after inventory release. The manager cannot erode an earned refund by responding later. A discretionary extra-refund request is labelled separately. Provider status races require reconciliation without restoring the cancelled booking. Chat reports become cases; an explicit cancel confirmation is the ordinary effective action, with admin correction for demonstrated outage/host-induced cancellation.

Kitchen/platform inability to supply unused confirmed value returns its full affected gross, including unused promised add-ons, associated tax and positive platform fee; no credit/reschedule coercion. Delivered unrelated sessions/used resources remain separately allocated. An essential missing item cannot be silently rejected while capturing the rest: chef must have consented to substitutability or review the reduced offer. Nonessential add-ons may be declined only under clearly disclosed acceptance semantics.

Refund payer and economic responsibility are different. Platform executes/refunds its charge. Recommend absorbing modest startup processor loss for good-faith eligible cancellation/supply failure within a funded monitored budget, while returning/foregoing its fee. Unpaid kitchen earnings can fund their refunded service value. Contract-backed recovery of kitchen-caused sunk costs can be added later; do not make customer reimbursement wait for collection. Platform mistakes are platform losses. Disputed safety/weather/partial use go to documented admin review, not an actor-based fault switch. Ordinary weather is not automatically an extraordinary disruption. [E: Airbnb disruptive events](https://www.airbnb.com/help/article/1320).

Chef no-show is an evidence classification, not a timer that proves misconduct or delivery. Apply the accepted late-cancellation/no-show schedule only with delivery/access evidence and appeal; kitchen inaccessibility is supply failure. Damage claims are separate from cancellation penalties. No hidden cleaning fine or off-session debit based only on manager assertion; use transparent pre-disclosed fees or proven loss through the approved claims process.

## Manager return, closeout and damages

Invite manager to inspect from the booking task list and deadline reminders. Offer **Clear booking** or **Report an issue** with required evidence and saved deadlines. Chef sees checkout received, who acts next and expected earnings release; manager sees estimated net and release conditions. One click is not a universal financial finality statement.

Maintain distinct clocks: inspection response, customer service-remedy report, later damage filing, customer claim response, admin case resolution and provider holding ceiling. Anchor published maximum release to scheduled service end, not an indefinitely delayed checkout submission. Manager can inspect earlier, but cannot terminate a promised customer remedy period. Missing check-in/checkout needs a service-ended exception path, not perpetual waiting; serious no-show/access disputes go to review. Auto-close says "closed after response deadline without inspection," not "manager inspected and approved."

Recommend a **short bounded closeout/customer-remedy period**, distinct from later damage filing. Candidate inspection models for approval: existing minute-based staffed inspection; next staffed working interval with hard cap; a next-day review period for unattended kitchens. Peerspace separately pays after service and handles later extra charges, but does not dictate Local Cooks duration. [E: payouts and separate extras](https://support.peerspace.com/en/articles/10119435-how-do-i-get-paid-for-a-booking). Owner/operations must approve precise clocks based on real staffing and kitchens before publication.

A submitted, timely service-remedy report holds the affected booking allocation until admin decision within a separately published maximum case-resolution period. Manager terms disclose normal release and the bounded timely-case exception. Every case has named owner, decision deadline, escalation deadline and applicable provider ceiling; repeated messages/drafts cannot restart them. A draft claim alone does not freeze money forever. At launch, one temporary booking-level manual case hold is simpler than arbitrary partial settlement; release unrelated bookings normally. If cases frequently need partial release, add explicit component allocations and tested cumulative settlement limits later. Before the case deadline, decide delivered/undelivered amounts with evidence. If the platform fails to resolve on time, an approved funded fallback can pay the customer's established remedy from platform funds while paying verified undisputed kitchen earnings, with separate contractual recovery; it is not permission to double-refund a card dispute or release contested money blindly. Staffing, fallback funding, exact maximum and contractual wording are launch gates, not deferred until the Stripe ceiling approaches.

Damage filing can remain open after regular booking settlement under its saved terms. Manager supplies before/after evidence, itemized claimed loss, no wear-and-tear/unrelated charges and receipt/supporting estimate. Chef can accept or dispute. Admin decides disputes, reasons and appeal; silence escalates, never accepts. Approved liability does not guarantee successful collection. Prefer an on-session payment link for disputed/new charges; saved-card off-session recovery requires verified lawful consent and SCA/failure handling. Kitchen is not promised an insurance guarantee; uncompensated collection loss stays with kitchen unless Local Cooks explicitly buys an approved protection program.

Holding the kitchen payout cannot secure a chef's damaged-equipment debt. It can protect customer service remedies and aid agreed settlement review. Requiring payout to wait for the entire current 14-day claim fallback [R] would delay kitchen cash without authorizing collection; not recommended by default.

## Policy transparency placement map

| Surface | Minimum visible content | Terms/fee behavior |
|---|---|---|
| Listing and kitchen rules | Eligible activities, required credentials, included/paid equipment, timezone, manager cancellation window and refund summary, supplemental agreement/signature | Published version; fee positive only; mandatory charges never hidden in PDF |
| Application/progress | Application, not booking; no inventory/payment hold; next reviewer/evidence | Required terms identity separate from optional tour |
| Tour/conversation | Tour is not kitchen access or confirmed booking; location continuity and participants | No invented booking entitlement from tour attendance |
| Availability/calendar | Available versus held/requested/confirmed; requested inventory expiry | Other customers' identity/details private |
| Quote/Checkout | Request action, itemized total/tax, positive platform fee, refundable line items, exact local cutoff, request/hold expiry, essential add-on consent | Stable quote/terms revision; explicit acknowledgement, links to full accepted rules |
| Request submitted | Card authorized, not charged; inventory reserved until deadline; manager next | Exact decision deadline, release behavior and withdrawal action |
| Manager request | Eligibility, intended use, mandatory/optional items, gross/tax, estimated versus actual net, decision deadline | Accept means capture; reduced/changed proposal needs chef consent |
| Confirmation/detail | Confirmed time, captured amount, cancellation deadline/refund quote, access instructions, next action | Accepted policy/rules always retrievable, latest listing edits do not replace them |
| Cancel dialog/result | Affected scope, gross refund, retained amounts, reason, authoritative recorded time, refund status | Positive charged fee may be refunded; zero-fee line/action absent |
| Modification (later phase) | Old/new time, price/tax, policy/deadline, delta charge/refund and consent | Original booking remains until atomic replacement commitment and finance verified |
| Checkout/manager task | Inspection evidence, auto-close and claims deadlines, release conditions | Draft claim not submission/approval; current participant authorization |
| Customer issue/claim response | Case/evidence, response deadline, effect on service/settlement, accepted liability vs payment | No claims arising solely from silence; historical rules accessible |
| Manager earnings | Retained for service/review, release date, transfer vs bank payout, gross/refunds/cost/net | Fee hidden if originally zero; processing cost distinctly labelled |
| Admin/support | Cross-dimension timeline, policy versions, source objects, owed/uncertain money, operations and delivery attempts | Reasons/privilege audit; no secret keys/card data in logs |
| Financial documents | Paid receipt, lawful supplier invoice, refund adjustment, final summary and manager statement | Original issue/version retained; no recomputation from today's rate/fee |

UX copy names application, request, confirmation, payment authorization, capture, refund processing, transfer and bank payout accurately. Use precise kitchen-local dates and zone/offset where ambiguity matters. No generic "approved" badge that conceals what was approved.

## Controls and startup cost

| Control/risk | Invariant or safeguard | Simplest safe implementation / cost | Evidence to relax and migration |
|---|---|---|---|
| Final access/current mandatory evidence | Permanent | Shared entitlement guard at command boundaries; medium audit/backfill effort | Simplify review stages only with insurer/legal/kitchen agreement; preserve final authorization |
| Accepted terms/prices/tax never rewritten | Permanent | Typed versions + existing snapshots, document identity; moderate migration | Remove interim edit lock after full new/legacy coverage audit; keep snapshots |
| Durable payment decisions/reconciliation | Permanent | Extend existing operations and idempotency; moderate | No relaxation; reduce manual queue when observed recovery is reliable |
| Bounded inventory/capacity locks | Permanent | Reuse slot locks, add resource allocations/status rechecks; moderate | Optimize only after contention evidence; never relax capacity correctness |
| Deferred transfer and sweep protection | Permanent for B | One booking settlement worker/operation, protected cash; significant operational funding | Changing settlement timing requires new agreed terms, not changing old bookings |
| Manual incident/partial-use review | Temporary safeguard | Existing claims/case history, named operator; per-case support cost | Automate narrow evidence-based causes after low error/appeal metrics; retain appeal |
| Booking-wide incident hold | Temporary safeguard | Hold affected booking only, published max/escalation; kitchen cash cost | Component partial-release ledger after demand; release migration verified against cumulative totals |
| Platform absorbs modest sunk processor cost | Startup safeguard | Explicit loss entry, funded budget, weekly reason analysis | Change future commercial allocation when cancellation/margin evidence warrants; existing promises retained |
| Local mocked diagnostics until isolation proved | Permanent safety boundary | Network deny/sinks/recipient allowlist; modest setup | Verified resources permit bounded real tests, never remove recipient safeguards |
| SMTP uncertainty pauses | Permanent trust safeguard | Attempt state/lease/manual resolution; low-volume support cost | Provider idempotency/status lookup can reduce manual cases; never claim exactly-once SMTP |
| Legacy manual financial review | Temporary safeguard | Legacy cohort queue, read-only comparison; bounded ops work | Clear evidence/settlement classifications, retain source/audit permanently |
| Explicit next actor/deadline and refund quote | Permanent | Reusable presentation from authoritative API; moderate UX work | Simplify display only with comprehension evidence; preserve material disclosure |

Do not fund refund liability with anticipated new bookings or treat held manager earnings as operating revenue. Deferred transfers reduce recovery risk but do not eliminate refund liquidity needs, chargebacks, provider reserves or account restrictions.

## Blocking decisions and next gate

The owner need not design these policies. Approve/revise the recommended principles first; supply business facts that research cannot invent. Priority blockers:

1. **Contract/tax [Q]:** proposed kitchen-as-supplier and Local-Cooks-as-fee-supplier; actual collection/agency agreement, registration, rate basis, platform-fee tax and invoice issuer. Owner confirms marketplace/Express and manager-configured location tax, not these legal facts. Accountant/legal approval before publication/charging under new terms.
2. **Provider/treasury/legal [Q]:** actual test platform/account countries/controller and capabilities, supplier-to-Express ownership, payout/self-payout controls, platform sweep protection and permitted holding clock; maximum booking horizon/span, closeout/case/cure hard limits and funded refund/dispute budget. Counsel must assess Canadian RPAA/payment-regulation applicability against actual custody/flow, including whether funds ever enter a Local Cooks-owned bank account; Stripe involvement alone neither proves exemption nor regulation. Do not access production Neon to answer.
3. **Policy choices [Q]:** P-A versus disclosed-net/graded alternatives; allowed kitchen cancellation-window envelope and late unused-add-on/refund bands; exact response, closeout/remedy/claim/appeal clock and loss allocation. Source defaults are not approval. Existing promises must be honoured.
4. **Compliance/inventory [Q]:** requirement matrix/waivers/business representation, equipment exclusivity/quantity and essential-item acceptance semantics; use scope and safety authority. Multi-day storage redesign remains excluded.
5. **Operations/diagnostics [Q]:** real manager staffing and named support/payment operator; verified chef/manager test recipients, Stripe routes, Inngest targets, Firebase/Auth/R2/Twilio isolation. No SMS number currently approved; SMTP development sender does not approve every dev user's inbox.

The [phase plan](booking-target-phases.md) provides local checkpoints without pretending these blockers are settled. **Approval of this architecture/policy proposal is the next gate. Only afterwards should implementation work packages be produced; implementation itself still requires separate authorization.**
