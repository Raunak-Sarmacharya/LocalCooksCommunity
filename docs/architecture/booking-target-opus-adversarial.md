# Adversarial review of the consolidated booking architecture

2026-10-11 · `development` @ `1417751f` · one bounded Opus 5.5 High review. Inputs: `booking-target-architecture.md`, `-money-and-documents.md`, `-workflows.md` and `-phases.md`, checked against the current-state/Stripe/options reports and source. Read-only. No app run, database, Stripe/Inngest/SMTP call, test or configuration change. One public statute page was read. Labels: F/R/T/O/E/I/J/Q as in the canonical docs. **Question:** can the proposal cause an unearned charge/refund, an indefinite or unlawful hold, undisclosed terms, a permission leak or an unsafe migration?

**Verdict [J]:** The direction is sound: B deferred transfer, committed-submission cancellation, gross supply-failure remedy, snapshots and separate claims. The prior A/R findings are reconciled correctly, including the rejection of blind forced release. Thirteen gaps remain. Two can move held money to the wrong place or at the wrong time (V1, V2). Three can produce long or legally unexamined holds (V3–V5). The rest are disclosure, permission and migration gaps.

## Findings

### V1 — Critical: the deferral is enforced at callers, not at the money operation

- **Draft:** architecture “Repository-backed reasons” row 4 (“Remove early transfer triggers only for bookings assigned the new settlement model”); phases “Migration, flags and rollback”.
- **Source [R]:** `transferToManagerForBooking` (`stripe-transfer-service.ts:149`) has six booking-path callers in `routes/webhooks.ts` (`:1020, :1596, :1918, :2878, :3173, :3421`) plus `payment-transactions-service.ts:837`. Each is guarded only by `managerConnectAccountId && stripeProcessingFee > 0`. The transfer function itself has no settlement-model check. `damage-claim-service.ts:1443` and `overstay-penalty-service.ts:1091` reuse it for separate charges.
- **Failure:** One missed caller (fee sync, `charge.updated` retry, a stale pre-deploy serverless instance) transfers a B allocation at capture. A later supply-failure refund then needs a reversal against a balance possibly already paid out, which is the exposure B exists to remove. Conversely, if a missing marker defaults to “hold”, legacy captured-not-transferred bookings stop paying managers indefinitely.
- **Correction:**
  - Gate settlement model inside `transferLockedSource`, under the existing row lock: one choke point.
  - Write the model atomically at fulfillment. Missing marker before the recorded cutover = legacy; after = owned, deadlined review case, never silent transfer or unbounded hold.
  - Deploy the guard everywhere before enrollment; an acceptance test enumerates callers and fails on a new one. Claim/overstay transfers declare their own model.
- **Residual:** none provider/legal; make it a Phase 5 entry criterion.

### V2 — High: the payee is resolved at transfer time from the manager's personal account

- **Draft:** money “Settlement release” (“Offboarded/reassigned manager does not silently change the financial beneficiary”); architecture “Policy ownership” reassignment note.
- **Source [R]:** `users.stripe_connect_account_id` (`shared/schema.ts:130`) is per *user*. Callers look it up on each run (`webhooks.ts:1567-1573`; `payment-transactions-service.ts:801-805`).
- **Failure:** Deferral stretches a seconds-long window to weeks. If a location changes manager, a manager re-onboards, or the business is sold, the doc's rule pays a departed individual for the business's sessions, or today's code pays whatever account the user row holds at settlement. The proposed supplier is the kitchen *business*, which may not own the Express account.
- **Correction:** snapshot payee at fulfillment (supplier identity, connected account ID, verified name/BN used on invoices). Settle only to it; on ownership/capability mismatch block and open a payee-change case decided by audited admin action with supplier evidence, never a profile edit. Invoices and statements name the same supplier.
- **Residual [Q owner/legal]:** whether Express accounts must belong to the kitchen business rather than a manager person, and who the supplier is (blocker 1).

### V3 — High: a published maximum release contradicts “no forced release” unless case resolution has its own bound

- **Draft:** architecture “Manager return…” (“Anchor published maximum release to scheduled service end” vs. “Never blindly force payment… resolve/refund, or fund an approved fallback”); phases Phase 5 rollback (“Preserve contractual maximum release obligations”).
- **Failure:** A timely remedy report has no decision deadline, so money waits until the provider ceiling nears. Then the platform either breaches the published maximum release or releases contested money (rightly rejected). Either way the kitchen's hold is bounded only by Stripe's clock; “funded fallback” is undefined.
- **Correction:**
  - Manager terms: maximum release applies unless a timely customer remedy case is open.
  - Each case gets an approved **decision SLA well inside the ceiling**, with owner escalation partway.
  - Define funded fallback: platform pays the customer remedy from its own funds, releases the kitchen allocation on schedule and pursues contractual recovery.
  - Metric: case age versus SLA and ceiling.
- **Residual [Q]:** staffing for the SLA and its number; legal wording of the release clause and recovery right.

### V4 — High: holds with no dispute still have no exit (payee unavailable, failed refund)

- **Draft:** money “Settlement release” (“inspect the reason before deciding whether transfer is allowed or should remain held”); Phase 4 (“refund pending/failed: booking stays cancelled, support owns recovery”).
- **Failure:** A delivered booking's Express account is rejected, closed or transfer-restricted: kitchen money sits with no cure path until the ceiling forces improvisation. A refund fails (closed card): returned funds become customer money held indefinitely under “support owns recovery”, and could be counted as releasable.
- **Correction:** explicit `payee_unavailable`/`refund_failed` obligations with beneficiary notice, cure deadline and lawful alternative payment by a named operator; failed-refund money stays a customer liability excluded from settlement; never redirect to another account; both count against the ceiling and protected-liability metrics.
- **Residual [Q legal]:** the alternative-payment method and the unclaimed-funds treatment.

### V5 — High (legal blocker missing): holding kitchen funds may be a regulated payment function

- **Draft:** money “Settlement release and treasury”; architecture “Blocking decisions” item 2. Both treat the holding period purely as a Stripe/treasury question.
- **Evidence [E]:** Canada's Retail Payment Activities Act lists “the holding of funds on behalf of an end user until they are withdrawn or transferred” as a payment function. Its PSP definition covers functions performed “as a service or business activity that is not incidental to another service or business activity”. Section 6 has no separate incidental exclusion. [RPAA full text](https://laws-lois.justice.gc.ca/eng/acts/r-7.36/FullText.html). The Bank of Canada supervises registered PSPs, including safeguarding end-user funds.
- **Failure [I]:** B deliberately holds kitchen earnings in the platform balance for weeks. If counsel finds this not incidental, registration/safeguarding may apply, independent of Stripe's 90-day table.
- **Correction:** RPAA legal gate before B enrollment beside the treasury gate; its answer may also cap hold duration. No conclusion drawn here.
- **Residual [Q legal]:** counsel's determination. This blocks B, not Phases 0–4.

### V6 — High: chargebacks during the hold silently shift loss to kitchens and can outlast the ceiling

- **Draft:** money settlement eligibility (“no unverified refund/capture/dispute overlap”) and the loss table row “Card dispute after transfer”. There is no row for a dispute *before* transfer.
- **Failure:** A dispute on a delivered session blocks transfer after Stripe already debited the platform; resolution can outrun the ceiling; if lost, the kitchen is never paid for delivered service. That is undisclosed chargeback allocation by withholding, contrary to the parent's own platform-debited qualification.
- **Correction:** manager terms state pre-transfer dispute allocation: platform bears loss on evidenced delivery and releases on schedule, or a disclosed clause holds **only the disputed amount**, bounded by V3's SLA. Use closeout evidence in responses. Missing `charge.dispute.*`/`refund.updated`/`refund.failed` handling [R] is a Phase 3–5 prerequisite.
- **Residual [Q owner/legal]:** the allocation choice; the actual `controller.losses` setting [E/Q].

### V7 — High: “support uses admin permission” contradicts the stated authority boundary

- **Draft:** workflows matrix preamble (“scoped support uses admin permission until a separate role exists”) vs. architecture “Policy ownership” (“Support viewing a case is not authority to change policy or charge a card”).
- **Failure:** The first non-owner support hire needed to run the Phase 4–5 queues receives full admin. That includes platform fee, policy envelopes, refunds, claim charges and every customer's documents. This is a permission leak by design.
- **Correction:** until a role exists only owner/named payment operators hold admin; ship a minimal read-and-message `support` scope before Phase 4 queues; money actions need a separate audited payment-operator permission; add to Phase 1 acceptance.
- **Residual:** owner names the operators.

### V8 — Medium-High: document storage may be public by URL

- **Draft:** architecture “Mandatory published kitchen rules…” (immutable content/hash, “R2 remains unverified/shared”).
- **Source [R]:** `server/r2-storage.ts:20-140` returns a public URL built from `CLOUDFLARE_R2_PUBLIC_URL`, and `security.ts:262` allow-lists a public `r2.dev` origin. Which credential/terms uploads use this path is **Q**.
- **Failure:** Supplemental contracts, licences and food-handler certificates stored behind guessable or shareable public URLs leak to anyone holding the link, including former managers and forwarded emails. The design treats “document URL” as identity, so a URL can be both public and mutable.
- **Correction:** private storage with authorized short-lived reads re-checking permission; hash/version in SQL; emails link to authenticated pages; audit existing uploads before migrating identities.
- **Residual [Q]:** bucket visibility and isolation (operational, not checked here).

### V9 — Medium: the positive-fee and tax paths can charge before legal facts exist

- **Draft:** money “Booking money allocation”; Phase 2 walkthrough (“compare zero-fee and positive-fee …”); blocker 1.
- **Source [R]:** checkout adds commission with no tax on it (`routes/bookings.ts:3192-3257`). Transfer is charge minus actual fee (`stripe-transfer-service.ts:149ff`), so the manager bears processing on the tax and fee portions. Tax collected is passed to the manager under a manager-entered rate [F].
- **Failure:**
  - A positive fee is published without fee tax determined.
  - An unregistered location sets a rate, and customers pay “tax” that no registrant remits, with Local Cooks as payment business of record.
  - Managers bear processing on amounts they never earn, without an agreement saying so.
- **Correction:**
  - Positive-fee publication and any tax collection are disabled per location until the accountant matrix validates registration and basis. A zero fee is the only enabled launch configuration until then.
  - Manager processing burden is stated in the manager agreement before enrollment.
- **Residual [Q accountant/legal]:** supplier, issuer, fee taxability, registration evidence.

### V10 — Medium: the horizon rule ignores multi-visit and storage spans

- **Draft:** money “Settlement release” (“restricting new capture-to-service lead time”); Phase 5 (“multiple visits end calculation”).
- **Failure:** The rule bounds lead time to *start*. A booking with several visits or attached storage settles only after its last end. Capture plus the full span, closeout, remedy and the V3 case SLA can therefore cross the ceiling even though the first session was near.
- **Correction:** At quote and again before capture, compute the projected latest release as last service end + closeout + remedy + case SLA + margin. Refuse acceptance if it exceeds the verified ceiling. Never fix it after capture. Settle per visit only if component allocation is approved later.
- **Residual [Q provider/owner]:** the verified clock and maximum span.

### V11 — Medium: legacy off-session damage charges continue unchanged until Phase 5

- **Draft:** architecture “Manager return…” (“saved-card off-session recovery requires verified lawful consent”); the phases do not touch claims before Phase 5.
- **Source [R]:** `damage-claim-service.ts:1328` charges with `off_session: true, confirm: true`. Checkout saves cards with `setup_future_usage: off_session`. The Stripe current-state doc notes that saving a card is not consent.
- **Failure:** During Phases 0–4, existing claim decisions keep charging saved cards whose consent was never established. The target calls such a charge unearned or unconsented, yet the plan keeps producing it.
- **Correction:** interim Phase 0/1 safeguard: off-session claim charges need a recorded admin decision plus verified consent evidence for that card, else an on-session link; classify open claims in the legacy inventory.
- **Residual [Q legal]:** the adequacy of the existing Checkout disclosure (rendering unverified).

### V12 — Medium: the interim lock has no escape for favourable or compelled changes

- **Draft:** architecture “Policy versions, edit lock…”.
- **Failure:** Because “active” includes unresolved money and cases, a busy kitchen may never publish, blocking customer-favourable, safety, legally compelled or unlawful-window fixes and inviting unaudited row edits.
- **Correction:** favourable changes as per-booking exceptions; compelled changes via audited admin path with notice; safety instructions as notices; objective removal criterion (100% snapshot coverage of active bookings).
- **Residual:** owner approves the transition (already a Phase 0 gate).

### V13 — Low-Medium: partial acceptance must re-derive fee and tax, and the customer must have consented

- **Draft:** money “Request and capture” (“freezes exactly accepted allocations”); architecture essential and nonessential add-ons.
- **Failure:** Partial capture releases the remainder [E]. Without recomputation the customer pays fee/tax on declined items; a reduction the customer never acknowledged is unconsented.
- **Correction:** partial capture only for items marked declinable at Checkout; re-derive per-component tax/fee with the same rounding; block capture above the recomputed amount.
- **Residual:** none beyond V9.

## Contradiction check and confirmed-good items

- **Consistent [J]:** no forced release; committed-submission eligibility; gross supply-failure refund incl. tax/positive fee; no capture after deadline/start limit; universal compensation; independent claims, silence not consent; fixtures not overbooking; modifications retired; Express loss qualified to actual controller; Peerspace not copied; no charge-model change; Neon excluded.
- **Real contradictions:** V3 and V7. Also “Freeze at request acceptance of the Checkout quote” is ambiguous between customer and manager acceptance; it should read “at the customer's Checkout submission, re-verified at fulfillment”.
- **Not raised:** no enterprise infrastructure or different Connect charge model. Option C stays a fallback only if the B gates (V5, sweep protection) fail.

## Priority for the parent

Fold V1, V2 and V5 into the B launch gate. Fold V3, V4 and V6 into the manager agreement and the Phase 5 acceptance criteria. Put V7, V8 and V11 into the Phase 0/1 interim safeguards. Make V9 and V10 config-enablement preconditions. V12 and V13 are wording fixes.
