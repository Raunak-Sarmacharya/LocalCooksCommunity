# Local Cooks booking investigation — consolidated current state

2026-10-11 · `development` · baseline `1417751f50d730f581dd2cd39162163f3a9c5dae`.

**Owner gate:** this is investigation, not an approved target design. No application, schema, configuration or deployment change was made. Latest owner steering now authorizes [the target architecture proposal](booking-target-architecture.md), including alternatives, UX, policies and phased migration/rollout/checkpoints. Architecture/policy acceptance and numeric choices remain gated; implementation work packages follow only after architecture approval. Current-state safety issues are not silently accepted as product decisions.

**Read-only follow-up during target planning [R]:** `server/services/invoice-service.ts:generateInvoicePDF` uses saved financial metadata/original schedule where present, but has legacy mutable-rate fallbacks and a download-time issue date; chef PDF is labelled INVOICE and manager PDF PAYOUT STATEMENT. `server/routes/manager.ts` blocks pending/authorized invoice download. `payout-processing-service.ts:processManagerPayout` reads balances/logs and does not create a Stripe Payout despite its header. `stripe-transfer-service.ts:transferToManagerForBooking`/`transferLockedSource` is reused by seven booking caller sites across `routes/webhooks.ts`/`payment-transactions-service.ts`, plus separate damage/overstay charges. `shared/schema.ts` stores Connect ID on users; beneficiary business ownership at delayed settlement remains Q. `server/r2-storage.ts` can generate public URLs; actual sensitive-document category routing/visibility remains Q, not a proven exposure. These observations informed the proposal; no new provider operations/tests were performed.

## Reading guide and evidence discipline

This document is the canonical reconciliation. [Stripe map](booking-stripe-current-state.md), [workflow/communication map](booking-communications.md), [boundary and experiment ledger](booking-environment-and-experiments.md), [owner questions](booking-blocking-questions.md) and [task register](booking-investigation-register.md) are its supporting evidence. [Opus investigation](booking-opus-investigation.md) preserves the independent report, including findings qualified below; it is not a second specification the owner must assemble.

F founder context; R repository code/configuration; T executed diagnostic; O direct operational observation; E current external evidence; I inference; J product judgment; Q unresolved. R absence means a bounded source search, not proof that a feature cannot exist operationally. Test names and historical reports alone are R. No production observations were taken. Code line references below are relative to the repository; operational guarantees require deployment/provider verification.

Method [R/T]: existing graph used only for navigation, then current source traced independently of the PDF. Founder attachment read afterwards as a hypothesis register, with extraction retained in `booking-founder-guideline-extract.txt`. Sol inspected money/workflows and ran network-blocked diagnostics; one bounded Claude Opus 5.5 High task independently reconstructed journeys and supplied adversarial findings. No Fable/Astra task was warranted before this gate.

## Current journey and state boundaries [R]

1. **Discovery and optional tour.** `kitchen_viewings` is distinct from a booking (`shared/schema.ts:2282`). Tour review may begin with Local Cooks and then a manager; tour confirmation, rescheduling, attendance, reconfirmation and outcomes have dedicated records/outboxes (`server/routes/viewings.ts:1685`, `server/services/tour-delivery-service.ts:30`). Tours provide context, not paid kitchen capacity: `shared/tour-booking-overlap.ts` and `booking.service.ts` distinguish overlap notices from paid inventory.
2. **Request to apply.** A chef submits a location application, `inReview`, tier 1. Local Cooks administrator performs initial review; the manager is blocked below tier 2. Approval at tier 1 means permission to continue onboarding, not final kitchen approval (`server/domains/applications/chef-application.service.ts:155`; `server/routes/firebase/kitchen-applications.ts:1235,1881`). No requested inventory hold or booking schedule is represented on this application (`shared/schema.ts:1657`).
3. **Requirements.** Kitchen/location custom fields, documents and tier data are collected; submission advances to tier 2 while application status can remain `approved`. Manager or admin final validation advances to tier 3 and grants location access (`kitchen-applications.ts:388,1259,1890`). Requirement validation exists in `server/domains/applications/tier-validation.ts`; a general onboarding requirement-waiver/deferral model was not found. Admin direct access grants are a separate bypass, not evidence of documented waiver authority.
4. **Eligibility contradiction.** UI/status and approved-kitchen discovery expect tier 3 (`chef-application.service.ts:348,389`), but booking gate permits `approved` tier ≥2 and self-creates `chef_location_access` (`server/domains/users/chef.service.ts:188`; `server/domains/bookings/booking.service.ts:125`). Existing access rows take precedence over rejected applications; explicit revocation is separate. Chef document validity at booking time is not enforced by that resolver, although kitchen listing/licence checks are present. Direct API bypass and affected records are not reproduced or measured [I/Q].
5. **Select kitchen time and add-ons.** Modern checkout checks kitchen booking eligibility, active listing, duration/lead-time/daily rules and consecutive operating-window slots (`server/routes/bookings.ts:3062`; `booking.service.ts:475`). Time capacity is protected by cooperating advisory locks and `kitchen_checkout_holds`: a 37-minute database hold versus a 32-minute Checkout expiry (`server/services/kitchen-checkout-holds.ts:7`). Real concurrent database behavior was not tested. Paid equipment is session-priced; included equipment is descriptive. Neither a general equipment quantity/overlap allocation nor a comprehensive storage overlap model was found [R absence/Q]. Storage remains out of design scope but shares money, decisions, removal state and add-on cancellation dependencies.
6. **Submit booking request.** Stripe-hosted Checkout authorizes a card, not final booking acceptance. The modern `addon_prices` fulfillment path atomically records pending booking, linked items, authorized payment ledger and requested-event outbox (`server/services/booking-checkout-fulfillment.ts:16`). A completed Checkout page is insufficient proof of confirmed booking or captured money. Legacy/alternate direct PaymentIntent, free and sequential fulfillment paths remain in source (`bookings.ts:2698,3361`; `server/routes/webhooks.ts:550`). Their current UI/deployment usage is Q.
7. **Manager decision.** `decideAuthorizedBooking` freezes a durable decision before capture/cancel. Manager may drop individual add-ons and capture a smaller agreed amount; the chef is not asked for a fresh consent in this path. Confirmation requires verified Stripe `succeeded` amount and ledger finalization; recovery reuses the same decision (`server/services/booking-payment-decision.ts:21,136`). Unanswered pending authorization has a 24-hour application timeout from creation, with lazy expiry and recurring recovery (`server/services/auth-expiry-service.ts:42`). This is not Stripe's actual authorization deadline. Approval-before-session-start is not an explicit invariant in the inspected decision path [R/I/Q].
8. **Attendance and completion.** Visits, confirmation-time duties, photos/checklists, check-in/out, manager review and claims are separate from payment acceptance (`server/services/booking-attendance-service.ts:65`; `server/services/visit-duties.ts`; `server/services/kitchen-checkout-service.ts`). No PIN attendance implementation was found. Overstay/storage removal cannot be equated to kitchen checkout.
9. **Cancellation and refund.** Pending authorized booking can be released. Pending paid legacy cases require Local Cooks review. Confirmed paid chef cancellation is a request before the saved cutoff; accepting it also requires processing before cutoff. Manager decline is separate; auto-accept skips paid/authorized requests (`bookings.ts:2227`; `server/services/booking-cancellation-refund.ts:62`; `server/services/scheduled-cancellations.ts:47`). Timely submission can therefore lose acceptance eligibility while waiting [R]. A manager unilateral cancellation route can mark a paid booking cancelled with `requiresManualRefund` rather than enforcing a refund (`server/routes/manager.ts:4689,4843`). Refund quotes use verified amounts and used-item allocations; platform service-fee return has a separate admin decision. Policy fairness and kitchen-caused refund obligations remain owner/legal questions.
10. **Modifications.** Confirmed booking reschedule/extend preview, new request, approval/consent, new Checkout and apply are currently retired (`server/services/kitchen-booking-changes.ts:245,261,272,286,422`). Historical changes can be read, declined/withdrawn, and provider money reconciled; retained tables/shared policy engine do not establish a working modification product. Counteroffers, manager invitations and custom prices were not found [R absence].

### State maps [R]

```text
Application: inReview/tier1 → approved/tier1 → approved/tier2 → approved/tier3
             ↘ rejected/cancelled          (access row is a separate entitlement)
Tour:        pending_local_cooks → pending → confirmed → attendance/outcome
             plus review denial, proposed reschedule, cancellation, expiry and reconfirmation
Inventory:   available → expiring checkout hold → pending booking → confirmed booking
             release/cancel removes future reservation; occupied storage has separate removal gate
Booking:     pending → confirmed → visit/check-out/completion
              ↘ cancelled       ↘ cancellation_requested → cancelled OR confirmed
Payment:     requires_capture / DB authorized → provider succeeded / DB paid
              ↘ provider canceled / DB failed (release is not charge failure)
Refund:      requested/decision → provider pending OR succeeded OR failure/recovery
Transfer:    platform capture → actual fee known → connected-account transfer
Payout:      connected-account bank settlement; independent of booking confirmation
Change:      new changes closed; historical recovery_required/payment/refund/release states persist
```

No single status describes eligibility, inventory, booking, payment, refund and payout. Database `failed` includes normal authorization releases, and application `approved` spans intermediate and final approval. This makes terminology a financial-trust concern [R/J].

## Policy representation and ownership [R/Q]

`shared/kitchen-booking-policies.ts` resolves kitchen override → location → numeric code defaults (cancellation 24 h, lead time 1 h, daily limit 2). These are current fallback values, **not proposed policy thresholds**. Booking saves `cancellationPolicyHours`; Checkout/ledger metadata freezes quoted rates/tax/fee/add-on prices; confirmation saves duties; storage saves accepted overstay terms. These partial snapshots already matter. Current location cancellation message is read later, and global copy is mutable. `shared/policy-config.ts` legal version `v2.0` is not a complete versioned booking-policy registry. Historical change policy JSON is not an active general rules engine.

Local Cooks owns initial eligibility/admin review, platform settings, service-fee refund decisions and recovery. The location's assigned manager owns final kitchen approval, pending booking decisions, cancellation reviews and manager-funded refunds. A chef owns their request/payment/attendance actions. Requirements legal/insurer ownership, waiver authority, policy change authority and contract liability are Q; code permissions cannot establish law.

Role enum contains chef/manager/admin, not a separate support role (`shared/schema.ts:16`); location has one `managerId` (`:357`). Explicit grant/revoke lives at `admin.ts:446-528`, `manager.ts:4082`; current manager ownership guards protect decision paths. Support operational powers presently depend on admin capabilities [I/Q]. Manager reassignment, history access and queued communications need explicit privacy decisions.

## Terminology and current disclosure audit [R]

| Surface | Actual concept / disclosed fact | Material gap |
|---|---|---|
| Preview/application CTA (`KitchenPreviewPage.tsx:1944`, kitchen locale) | Request to apply, eligibility onboarding | `approved` lacks phase-specific meaning; founder's extra preliminary manager review is not current flow |
| Booking calendar (`KitchenBookingCalendar.tsx:1449`) | Apply/book terminology | API unlocks earlier than UI final-approval concept |
| Checkout (`KitchenBookingFlow.tsx:1154`, `BookingConfirmationPage.tsx:346`) | Selected time, quote, card authorization | Exact response deadline and distinction between Checkout hold and pending reservation need full rendered UX verification |
| Shared policy notice (`BookingRefundPolicyNotice.tsx`, `kitchen-booking-policies.ts:8`) | 100% before confirmation; saved deadline after | Authorization-release explanation missing; paid legacy path refuses direct cancellation; request versus entitlement unclear |
| Booking details (`BookingDetailsPage.tsx:618`) | Distinguishes some release/payment states | Database `failed` remains overloaded; bank arrival cannot be inferred |
| Confirmation (`booking-lifecycle-delivery.ts:31`) | Verified captured amount, approved items, duties, itinerary/ICS | First delayed generic delivery lacks universal current-recipient/state revalidation |
| Cancellation quote/review (`CancellationRefundReview`, cancellation refund service) | Component amount, costs, manager and service-fee split | Timely request versus decision-time eligibility; kitchen-caused cancellation default unresolved |
| Admin setting (`PlatformSettingsSection.tsx:466`) | Unanswered cancellation requests described as auto-accepted | Paid kitchen requests are excluded in worker |
| Manager location policy save (`server/routes/manager.ts:3319`) | Location defaults and kitchen overrides | Save clears the submitted policy fields' overrides across all kitchens at that location, not every unrelated override; scope and owner notice unresolved |

This is a source-backed placement audit, not a rendered browser audit or a proposed disclosure design. A target placement matrix is gated on owner decisions.

## Explicit reconciliation of independent adversarial findings

| Opus finding | Lead disposition and consequential uncertainty |
|---|---|
| A1 tier 2 vs 3 | **Accept R contradiction.** Reviewed resolver; actual exploitability and affected entitlement records remain untested. Highest eligibility blocker. |
| A2 persistent access | **Accept R precedence and limited revocation callers; qualify impact I/Q.** Could be intentional retained access; owner must define revocation contract. |
| A3 expired chef documents | **Accept bounded R absence.** Requirement-by-requirement legal validity/renewal ownership cannot be inferred. |
| A4 cutoff lost while manager waits | **Accept R.** Acceptance checks both request and current time. Existing mocked quote tests are not a reproduction of manager inaction end to end. |
| A5 auto-accept setting | **Accept R contradiction.** Worker exclusion means admin wording does not protect paid kitchen requests. |
| A6 manager cancellation without enforced refund | **Accept API R, qualify UI/O.** Separate refund controls exist; do not claim they are absent. Whether exposed/currently used and contractual outcome remain Q. |
| A7 approval after session | **Retain R/I risk.** No explicit start guard in inspected decision; no real capture experiment performed. 24 h must not be described as guaranteed inside every Stripe authorization window. |
| A8 stranded fulfillment authorization | **Accept specific R/I risk.** Plain unavailable add-on/terms errors bypass inventory-conflict compensation. Compensated conflict path also does not verify terminal refund/cancel status despite its comment. No live Stripe reproduction. |
| A9 double allocation | **Accept missing general add-on capacity control, qualify “proven double booking.”** Modern fulfillment DOES check kitchen ownership and occupied-storage removal; checkout lookup and general overlap/quantity controls remain gaps. No actual duplicate-resource experiment. |
| A10 100% pre-confirmation copy | **Accept R path mismatch and T copy failure.** Modern checkout normally releases authorization; legacy paid pending path returns review-required. Exact production incidence unknown. |
| A11 retired changes | **Accept.** Correct initial Sol interpretation of retained pricing/recovery code: it is not a currently enabled modification feature. Passing recovery/shared-engine tests do not prove new-change availability. |
| A12 manual replay secret | **Accept code risk.** Production-conditioned route falls back to webhook signing secret and ordinary comparison (`webhooks.ts:194`). Deployment exposure not observed; no attack attempted. |
| Founder flow/7% objections | **Accept.** Current first review is admin, final manager; 7% is F and actual setting Q, code default 0%. No founder hypothesis adopted as specification. |
| Location policy override wipe (Opus §2.7) | **Narrow the claim.** `manager.ts:3323` only adds fields actually present in the submitted patch; those overrides are cleared for every kitchen at that location. Unrelated policy overrides are retained. Product intent/disclosure still Q. |

Additional lead findings [R/I]: location timezone exists but key availability/checkout/cancellation/change rules hard-code Newfoundland, whereas some reminders read location timezone; local worker lacks required session-capable URL; generic booking/outcome SMTP recovery is weaker than tour uncertainty handling; no universal webhook event inbox was found; individual refund/dispute webhook coverage needs verification. Details in supporting maps.

## Permission and policy ownership map [R/Q]

| Action | Chef | Assigned location manager | Administrator / support | Evidence |
|---|---|---|---|---|
| Initial application review | Submit/respond | Blocked below tier2 | Approve/reject | `kitchen-applications.ts:1235,1881` |
| Final access approval | Submit required evidence | Approve after requirements | Approve/grant/revoke | `kitchen-applications.ts:1890,1259`; `admin.ts:446` |
| Paid booking request | Own request, eligibility gate | Not customer checkout actor | Recovery/admin tooling, not standard request actor | `bookings.ts:3062` |
| Pending capture/decline, item selection | Withdraw/release own authorization | Decide owned booking | Cancel authorization/recover payment | `manager.ts:4642`; `booking-attendance.ts:41` |
| Paid chef cancellation | Request before cutoff | Accept before cutoff/decline | Service-fee/recovery decisions | `bookings.ts:2259`; `booking-cancellation-refund.ts:62` |
| Kitchen-initiated cancellation | Receives outcome | Can cancel; refund separate | Financial recovery | `manager.ts:4689,4843` |
| Manager-funded refund | Receives/refund history | Scoped verified refund | Platform fee decision | `manager.ts:1398,1672`; `admin.ts:3593` |
| Policies/tax/rates | Sees terms | Location/kitchen settings | Platform commission/settings | `manager.ts:3319`; `stripe-checkout-fee-service.ts:308` |
| Historical changes | Withdraw/read own | Decline/read owned | Read/recovery | `kitchen-booking-changes.ts:279` |
| Thread/history/messages | Canonical eligible participant | Current ownership | Admin chat/recovery powers | `shared-chat-access.ts`; `chat-service.ts:48`; `participant-chat` tests |

Support has no distinct role/permission contract in the enum. Legal requirement ownership and authorised exceptions remain Q even where an admin technically has access.

## Audit, analytics, storage and recovery evidence [R/I/Q]

Focused durable records exist: `payment_transactions`, `payment_history` (`shared/schema.ts:1834`), original `paymentDecision`, `booking_lifecycle_events` (`:1378`), `tour_delivery_events` (`:2480`), `email_logs` (`:2456`), notification records, visits/checklist evidence, damage/overstay histories. These are not an immutable comprehensive platform audit: some foreign-key deletes cascade, and no universal provider-event received/applied ledger was found. Financial original-operation identity and receipt recovery are stronger than generic log-only errors.

Sentry instruments server/client and authenticated context (`server/instrument.ts`, `client/src/instrument.ts`, `firebase-auth-middleware.ts:212`). Seller analytics/dashboard routes exist (`server/routes.ts:1344`; `server/routes/analytics.ts`), but a booking-specific funnel, deadline breach, policy-drift, refund mismatch or workflow queue-age metric coverage was not established. No telemetry endpoint was triggered. Exact PII retention, masking/access and dedicated test Sentry destination remain Q.

File uploads flow through `server/upload-handler.ts` → `server/fileUpload.ts:125` → R2 when keys exist, including development; the local-storage fallback applies only when R2 is unconfigured. Certificate/document and booking-photo hooks use this upload path. A development branch therefore does not prevent shared bucket writes. Authenticated upload is not proof of private object retrieval or safe document retention/deletion; R2 ACL/token/prefix ownership and access URLs need isolated inspection before experiments. No real document/photo upload/delete performed.

Recovery surfaces include payment authorization/reconciliation tools, original refund/transfer recovery, email logs/manual retry, tour uncertain-delivery review, worker durable cursor/failure health and admin recovery notices. Operational activation, alert routing, staffed owner and successful restore exercises are Q. Existing staging chat evidence proves only its recorded test path/time, not those financial/booking recovery guarantees.

## Tests and operational limits

Executed selected diagnostics with real networking blocked and dummy provider settings [T]. Server baseline: 39 files, 30 passing, 9 failing; 663 assertions, JSON 635 passes (including one expected-failure case), 28 failures. Two failed files could not import locally missing Inngest/Firebase Functions dependencies. Client: 4 files, 4/5 assertions pass. Dummy-key contract rerun: 5/5 pass. Financial decisions, recovery, scoped refund/transfer, reminder invalidation, chat participant guards and signature routes have passing mocked coverage. This is not a green full-repository suite.

Important correction [R/T/I]: two failing availability fixtures omit record IDs; `id !== excludeBookingId` filters `undefined !== undefined` to false. They do **not** demonstrate real kitchen overbooking. Deprecated route 410 versus expected 404, obsolete tour reminder expectations and nonconsecutive-slot fixtures also cannot be called live safety defects. Tour email failures mix copy/time-format/support-guidance drift; content expectations need owner reconciliation rather than changing application to satisfy them.

Only a bounded read-only SQL query was made to the inspected Supabase endpoint [O-dev], selecting exact test aliases: admin test identity found, automated sender not a user (owner subsequently clarified). No records created or changed; transaction rolled back. No real Stripe calls, sends, Firestore/R2/Twilio mutation, app startup or production access. Existing staging chat report has historical inbox evidence, not a new delivery guarantee. Full environment and cleanup details are in the ledger.

## Next gate [Q]

Review the prioritized owner questions and [owner-requested draft policy proposals](booking-policy-research-and-proposals.md). The owner subsequently authorised policy recommendations, now independently reviewed and explicitly reconciled; this did not approve policy choices. Approval is still required to draft the final target architecture. It would not approve thresholds, implementation, migrations or deployment. Implementation work packages come only after later approval of the consolidated target design. No premium review has been consumed.
