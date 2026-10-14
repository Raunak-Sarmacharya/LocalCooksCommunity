# Booking investigation task register

Date: 2026-10-11. Original scope: current-state investigation and prioritized blocking questions. **Latest owner steering authorizes the final target architecture proposal and phased local checkpoints.** Architecture/policy acceptance and numeric thresholds remain gated. Implementation work packages are deferred until architecture approval; application edits, migrations and configuration changes are not authorized.

## Boundaries

- Founder states development uses Supabase, production uses separate Neon, and development has Stripe test credentials. These are context, not proof of effective runtime isolation.
- Never access production Neon or live Stripe. No external mutations until the entire side-effect path is verified test-only. No communications except verified test recipients/sinks.
- Documentation writes only under `docs/architecture/`. Preserve pre-existing worktree changes including graphify outputs and other documents.
- No recursive delegation, teams, advisor modes or open-ended debates. Initial premium allowances: at most one Fable and one Astra task, High maximum, verified/enforced before launch; no premium task is currently justified/launched.
- Attachment: `C:/Users/rauna/.t3/userdata/attachments/f762e860-12ab-43c4-9486-b418deca8385-0c8f90e8-d753-4414-83ab-ffe23fa53b8e-pdf.pdf`. Founder context and hypotheses, never a specification. Read after independent repository reconstruction.

## Evidence vocabulary

F = founder-supplied context; R = repository code; T = tests executed in this investigation; O = production/operational evidence; E = current external evidence; I = reasonable inference; J = product judgment; Q = unresolved question. Existing tests/documents without an executed observation are R, not T/O. No production observations are authorized.

## Tasks

| Task | Model/provider | Purpose | Status | Output | Unresolved findings |
|---|---|---|---|---|---|
| Lead | GPT-6.1 Sol / codex | Runtime boundary verification, Stripe/workflows, evidence reconciliation and consolidated current state; owner-requested provisional policy proposals | Complete at owner gate | booking-current-state.md; booking-stripe-current-state.md; booking-environment-and-experiments.md; booking-communications.md; booking-blocking-questions.md; booking-policy-research-and-proposals.md; booking-diagnostic-followups.md; booking-investigation-review.html | Runtime side-effect isolation and owner policy acceptance/architecture approval remain open |
| Independent investigation | Claude Opus 5.5 / claudeAgent, explicit High effort, fastMode=false | Independent journey/policy/permission/inventory investigation and adversarial evidence review | Completed, execution authenticated | booking-opus-investigation.md only | All12 A findings and override/fee/founder objections explicitly reconciled in booking-current-state.md |
| Owner-requested policy review | Claude Opus 5.5 / claudeAgent, explicit High effort, fastMode=false | Bounded adversarial review of proposed eligibility/cancellation/cost responsibility after owner asked for recommendations | Completed, execution authenticated | booking-policy-opus-review.md only | R1–R9 reconciled in booking-policy-research-and-proposals.md; no thresholds approved, final architecture gated |
| Fable | Not launched | Optional difficult unresolved architecture escalation | Deferred | None | Target architecture outside current gate |
| Astra | Not launched | Optional high-consequence adversarial review | Deferred | None | No premium substitution |

## Capability check

T3 `orchestrator_capabilities` advertises app-owned subagents, cross-provider child tasks, status/cancellation and authenticated/configured provider instances `codex` and `claudeAgent` as runnable with no catalog constraints. Actual execution remains the authentication check; catalog alone cannot prove a working credential.

Advertised exact IDs relevant to roles: `gpt-6.1-sol`, `gpt-6-astra`, `claude-opus-5-5`, `claude-fable-5-1`, `claude-fable-5`. Delegation accepts explicit `target.options`: Codex `reasoningEffort=high`; Claude `effort=high`. No inherited effort is trusted (catalog Sol currentValue=low differs from harness High). Claude High is a native select value; `ultrathink` is prompt injected and will not be used. No premium run launched.

Round1 task ID: `node:delegated-task:command%3Amcp%3A6612cdf1-d024-4791-942d-f7d2f7110cd6%3Adelegate-task%3Abooking-current-state-opus-round1-20261011`. Terminal completed, no pending child runs. Provider/model returned `claudeAgent` / `claude-opus-5-5`. Child reports local reads only, High, no fast mode, no subagents, no tests/provider calls, only assigned doc written.

Round2 task ID: `node:delegated-task:command%3Amcp%3A6612cdf1-d024-4791-942d-f7d2f7110cd6%3Adelegate-task%3Abooking-policy-opus-round2-20261011`. Distinct fresh delegation, no child-thread continuation. Refreshed live catalog advertises exact model and native High/fastModefalse before launch. Self-contained brief includes source/evidence/PDF paths, founder hypothesis status, prior findings/qualifications, owner request for policy proposals, all environment/recipient restrictions and no-implementation/delegation rules. No premium model launched.

Round2 terminal completed, no pending child runs. Only assigned output changed. High-consequence objections accepted/refined: liquidity/early transfer, captured processing cost, validity through session, effective cancellation independent of refund, separate incident/claim authority, abuse counts/support cost, no blanket weather rule, no late capture, tax/account agreement questions. No review rounds remain open.

Scope update: owner explicitly asked Sol to research/propose these policies rather than ask owner to design them. Draft policy recommendations are now authorized; policy acceptance, exact numeric thresholds and final target architecture are not. New recommendations must be distinguished from current-state evidence and independently reviewed.

Artifact verification: all local Markdown supporting links resolve; desktop/light, desktop/dark and360px/mobile HTML preview completed, three tab transitions checked without horizontal overflow. No artifact network request used. Scope verification preserved baseline tracked changes; concurrent untracked `.verify-tour-instruction-update/` appeared during investigation and was not touched. Only investigation-owned booking documents/results/indexes added; no application/schema/configuration edits or commits. Diagnostics have baseline failures and missing imports as recorded, not a full suite green guarantee.

## Target proposal phase: owner authorization and tasks

Owner requests end-to-end target proposal with digestible phases and local checkpoints, thorough primary research and consequential Opus cross-checks. All delegated tasks now have an explicit High maximum. Owner confirms admin-set fee including zero/hidden transaction line, platform willingness to return fee, manager-set location tax, marketplace/Express arrangement; proposes policy-edit lock and manager closeout/claims-before-payout and guided mandatory kitchen terms. These hypotheses are evaluated, not silently settled. Legal supplier/agency/fee tax remains unknown despite payment arrangement clarification.

| Task | Model/provider/effort | Purpose | Status | Output | Residual questions |
|---|---|---|---|---|---|
| Target lead | GPT-6.1 Sol / Codex / High | Primary provider research, conditional design, phased checkpoint and review reconciliation | Consolidated proposal complete at owner approval gate | booking-target-architecture.md, booking-target-money-and-documents.md, booking-target-workflows.md, booking-target-phases.md, booking-target-review-reconciliation.md, booking-target-review.html | Owner acceptance, legal/account/treasury/clock gates |
| Independent options round3 | Claude Opus 5.5 / claudeAgent / explicit High, fastMode=false | Bounded three-option architecture/authority/payment synthesis | Completed, authenticated execution | booking-target-opus-options.md only | Eleven consequential objections reconciled by lead; no provider tests |
| Adversarial target round4 | Claude Opus 5.5 / claudeAgent / explicit High, fastMode=false | Fresh bounded failure review of consolidated draft | Completed, authenticated execution | booking-target-opus-adversarial.md only | V1-V13 each reconciled in booking-target-review-reconciliation.md; residual facts/decisions gated |
| Fable/Astra | Not launched | Optional uncertainty escalation | Not justified | None | Opus and lead suffice for evidence available; unknown account/legal facts require verification, not premium speculation |

Round3 ID: `node:delegated-task:command%3Amcp%3A6612cdf1-d024-4791-942d-f7d2f7110cd6%3Adelegate-task%3Abooking-target-opus-options-round3-20261011`. Terminal completed, no pending child runs. Self-contained brief included source/evidence paths, founder hypothesis status, owner answers, verified/uncertain environments, no-production/no-implementation/no-recursive-delegation restrictions and one bounded output. Local reads/public official research only; no tests/provider resource calls or messages reported.

Round4 ID: `node:delegated-task:command%3Amcp%3A6612cdf1-d024-4791-942d-f7d2f7110cd6%3Adelegate-task%3Abooking-target-opus-adversarial-round4-20261011`. Fresh `delegate_task`, distinct stable request ID, not continuation on childThreadId. Live catalog refreshed: exact claude-opus-5-5 advertises native effort high and fastMode boolean on runnable claudeAgent. Explicit options accepted; no ultrathink/extra-high/fast mode/team/advisor option. Brief includes all four consolidated drafts, original current-state evidence, previous A/R/round3 findings with qualifications, newest tax/terms owner answers and residual money/holding objections. Review read-only except distinct output; no conflicting writes or shared-resource tests.

Parent uses Codex harness; bounded cross-provider reviews use Claude harness. No top-level conversations or large teams created. No production Neon, live credentials, recipient delivery, configuration changes or provider mutations performed in proposal phase. Existing read-only Supabase observation and network-blocked diagnostics remain the only earlier experiments; proposal tests are future acceptance requirements, not newly passed tests.

Round4 terminal completed with no pending child runs, exact claudeAgent/claude-opus-5-5. Child reports only assigned doc written, local source reads and one public statute page, no tests/resource calls/config changes. Thirteen findings reconciled explicitly; corrections include central transfer guard, business payee, case/cure exits, payment-regulation/custody assessment, pre-transfer fraud loss, minimal support permissions, sensitive files, fee/tax gating, full-span horizon and legacy charge consent. Lead directly opened Bank of Canada marketplace guidance to qualify statute-only inference. No additional model round launched.

Target artifact verification: supporting local Markdown links resolve; credential-pattern scan returned zero matches (not an exhaustive secrecy guarantee). Self-contained HTML checked desktop/light, desktop/dark and360px/mobile, all four tabs, eight proposed phase selectors and both fee examples; no horizontal overflow/console errors, original-zero fee CSS actually hidden. Visual is an analytical document, not application implementation. Git branch/HEAD remain development/1417751f; tracked dirty paths match preserved baseline, only owned planning documents added/updated. No new external resource diagnostics or delivery occurred. No target acceptance tests are claimed passed; those are future phase gates.
