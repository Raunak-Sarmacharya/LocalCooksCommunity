# Dashboard ↔ Onboarding sync — where it breaks, and the plan

Status: **analysis + proposal. No code changed yet.**
Scope: the manager side (location / kitchen / licence / availability / requirements), the dashboard
settings surfaces, and the onboarding wizard.

## 0. Basis

- Two full code maps: (a) every dashboard surface that creates a location/kitchen/licence, and what it
  does with no location; (b) every writer and reader of the onboarding record.
- OnboardJS docs (persistence, provider props) **plus** the installed typings —
  `@onboardjs/core@1.0.0-rc.3`, `@onboardjs/react@1.0.0-rc.3`.
- NN/g, *Designing Empty States in Complex Applications: 3 Guidelines*.
- Shopify, *Setup guide* composition (layout reference; it gives **no** dependency/prerequisite rules).
- Ponytail (laziest-correct) applied to the shape of each fix.

---

## 1. The one finding that explains everything

**There is one stored record and two independent readers, and they normalise it differently.**

The record: `users.manager_onboarding_steps_completed` — a JSONB `Record<stepId, boolean>`
(`shared/schema.ts:122`).

| | Reader A — the wizard | Reader B — the dashboard |
|---|---|---|
| Where | `ManagerOnboardingContext.tsx:673-712`, `727-854` | `use-onboarding-status.ts:319-404` |
| Legacy numeric ids (`step_3`) | decoded via `STEP_ID_MAP` | **not decoded** |
| `_location_<id>` suffixes | stripped to a generic key | regexed per step, inconsistently |
| Session-only signals | counts `availabilityStepCompleted` (React state) | **cannot see it** |

Same record, two answers. A third progress model (`use-manager-getting-started.ts` +
`lib/manager-getting-started.ts`) reads neither and derives everything from the banner's verdict.

### The concrete disagreements

| # | Disagreement | Effect |
|---|---|---|
| D1 | `availability`: wizard ORs in the session flag and decodes `step_3`; the hook does neither | rail ticks the step while the banner still says "Continue setup" |
| D2 | `application-requirements`: same shape; the hook's regex rejects `step_4` | as above |
| D3 | `location`/licence: wizard reads the **selected** location's licence field OR the flag; the hook reads a query and never the flag | ticked rail + open banner row, either direction |
| D4 | `managerOnboardingCompleted`: the hook short-circuits **every** row to complete; the wizard **never reads it** | after onboarding is marked complete the dashboard says all done while the wizard rail still shows gaps |
| D5 | Two different "setup is complete" verdicts feed the banner and the Getting-Started checklist | they can disagree |
| D6 | `create-kitchen` ignores the stored flag entirely; `welcome` uses it | rail and dashboard can differ on the kitchen row |
| D7 | A stale comment claims required steps don't consult the flag — three of them do | maintenance trap |

### The second-order cause

**`saveAndExit` writes the completion flag from ANY part of a step**
(`ManagerOnboardingContext.tsx:2497-2540`).

So "I was on this step" is recorded as "I completed this step". That is precisely the auto-completion
noticed on **Availability** and **Booking Requirements** — and it is what makes readers A and B diverge
in the first place. The flag is doing two jobs: *position* and *completion*.

---

## 2. The creation-path problem (the "Add Kitchen → onboarding" symptom)

Every dashboard "add" tunnels into the wizard:

| Surface | Action today | Where it goes |
|---|---|---|
| Profile → Location tab, no location | "Add your location" | `/manager/setup` (wizard root) |
| My Locations, no locations | "Add New Location" / "Add Your First Location" | `startNewLocation()` → `/manager/setup?newLocation=true` |
| Kitchens, no location | `selectALocation` + "choose a location to manage kitchens" | **no CTA** |
| Licence, no location | `selectALocation` + "choose a location to manage license settings" | **no CTA** |
| 8 further settings views | `selectALocation` + a "choose a location to…" line | **no CTA** |

Two separate defects:

1. **The dashboard cannot create a location at all.** It is the only object a manager must have before
   anything else works, and its only creation path is the wizard.
2. **Ten empty states state the problem without the action.** NN/g's third guideline is explicit: an
   empty state must *"provide direct pathways for key tasks"*, and a message that says **what** to do
   without telling **how** is the named anti-pattern. "Select a Location" when none exists is exactly
   that: there is nothing to select.

**Dead code that already solves half of this:** `client/src/components/manager/locations/CreateLocationDialog.tsx`
is a complete 416-line create-location form (name, address, logo, licence, expiry, terms) that is
**imported nowhere**. `ManagerBookingDashboard.tsx:1393` also has a `[PARKED]` multi-location
`CreateLocationSheet`.

---

## 3. What the library already gives us, and we don't use

`OnboardingProvider` accepts `localStoragePersistence` **or** `customOnDataLoad` /
`customOnDataPersist` / `customOnClearPersistedData`. The app passes **none of them**
(`ManagerOnboardingProvider.tsx` passes only `steps`, `componentRegistry`, `initialStepId`).

The engine also ships:

- **`ChecklistManager`** — `getChecklistItemsState`, `getChecklistProgress`, `isChecklistStepComplete`,
  `updateChecklistItem`
- **Flow lifecycle events** — `onFlowStarted`, `onFlowPaused`, `onFlowResumed`, `onFlowAbandoned`,
  `onFlowReset`, `onFlowCompleted`
- `onPersistenceSuccess` / `onPersistenceFailure`, `onStepAbandoned`, `onStepRetried`,
  `onStepHelpRequested`
- **`addBeforeStepChangeListener`** — a navigation guard

The app hand-rolled: the resume position, "Save & exit" (= pause), auto-resume (= resume), and **three**
progress models (= checklist). **Every bug fixed in this area so far lives in that hand-rolled layer.**

**Honest caveat:** the installed version is `1.0.0-rc.3` — a release candidate. Adopting more of its
surface carries real risk, and a wholesale migration is not a small diff. Reuse it where it deletes a
hand-rolled layer; do not rewrite the wizard for its own sake.

---

## 4. The model to adopt

Two different questions are currently answered by one record:

| Question | Nature | Today | Should be |
|---|---|---|---|
| **Where is this manager in the flow right now?** | ephemeral, per-device | `saveAndExit` writes the completion flag; `?step=` | the engine's flow state (or an explicit resume signal) |
| **What has this manager actually completed?** | durable, cross-device, business truth | the same flag, polluted by the first question | written only on genuine completion, read by ONE normaliser |

This is the repo's own rule: **one fact with two audiences needs two names, not one flag.**

---

## 5. The plan — smallest diff first

### Phase 1 — one owner for "is this step done"

Make `use-onboarding-status` import and call the same pure predicates the wizard already uses
(`isLocationStepBehindUs`, `isAvailabilityStepBehindUs`, `isRequirementsStepBehindUs`,
`resolveStripeState`) instead of its own regexes. Then decide who owns the `managerOnboardingCompleted`
short-circuit (D4) and make the other side read it too.

*Ponytail:* rung 2 — the predicates already exist in this repo. This is a small diff that makes the two
readers **structurally incapable** of disagreeing, rather than patching each symptom.
Kills D1–D3, D6, D7.

### Phase 2 — stop recording "I was here" as "I finished"

`saveAndExit` writes the durable record only for steps that are genuinely complete; position becomes the
engine's job (or an explicit `resumeAt` field, separate from the completion map).

*Ponytail:* rung 1/2 — the engine already models pause/resume (`onFlowPaused`/`onFlowResumed`) and
persistence. This is the fix for the Availability and Requirements auto-completion.

### Phase 3 — the empty states carry the action

Replace the ten `selectALocation` dead-ends with **one** shared prerequisite empty state — "You need a
location first" + a real action — placed in all ten spots. NN/g guideline 3, one component.

*Ponytail:* one component, ten placements. Deletion (of ten bespoke blocks) over addition.

### Phase 4 — creation in the dashboard, without a second implementation

**Do not build a second create-location form.** The repo already has the pattern:
`EquipmentListingContent` / `StorageListingContent` are rendered `embedded` in **both** the wizard and
the dashboard — *"one implementation in two placements, so the wizard cannot drift from My Kitchens"*.
Apply the same shape to the location form: extract the Business step's details part into a shared
component, embed it in the wizard **and** in the dashboard.

`CreateLocationDialog.tsx` is already written and orphaned — decide whether it becomes the dashboard
placement or is deleted in favour of the shared one.

*Ponytail:* rung 2 — reuse the established in-repo pattern. A second form would be a second owner of
"how a location is created", which is how the current bugs started.

### Explicitly NOT in this plan

- Rewriting the wizard onto the library's checklist/persistence wholesale. Separate, larger, and it
  rides a release-candidate dependency. Revisit once Phases 1–2 have removed the hand-rolled position
  layer, because at that point the question becomes much smaller.
- Deleting the parked multi-location `CreateLocationSheet` — settled by decision 1 (one location), but it
  is a deletion, so it happens with Phase 4 rather than on its own.

---

## 6. Decisions (answered 2026-09-28)

1. **One location per manager, multiple kitchens.** Dashboard creation is therefore a **single dialog**,
   not a multi-location manager. The parked `CreateLocationSheet` and its "Coming Soon" badges are not
   the future.
2. **The dashboard's create-location form does NOT require the licence.** Name, address, logo — then the
   licence becomes the next outstanding item with a clear CTA. This is also the API's own model, and the
   structural reason is decisive: the licence is written ONTO a location
   (`location.kitchenLicenseUrl`), so "upload a licence with no location" is impossible by construction,
   not merely discouraged. Requiring it up front would put a document upload in front of the thing the
   document belongs to.
   *Consequence to design for:* the Business step is then legitimately half-done, and the listing gate
   keeps the licence outstanding until it is uploaded. That has to be visible and actionable, not a
   silent gap.
3. **The wizard tracks the INTERNAL parts, not just the step.** Completing the identity fields elsewhere
   must not mark the whole Business step done; the wizard has to pick up at the first internal part the
   record still owes.
   **Verified — this already works and needed no new code.** `recordResumePart` (`LocationStep.tsx`)
   derives the owed part from the RECORD, so work done anywhere else is counted without anything having
   to notify the wizard. Pinned by two new cases in `LocationStep.test.tsx`: a location with only
   name/address/logo resumes at the **contact** part; with contact details but no licence it resumes at
   the **licence** part. Both fail if `resumePart` is removed.
4. **Getting Started is OUT OF SCOPE.** The user has made it its own thing and is finishing it
   separately. Nothing in `use-manager-getting-started.ts`, `lib/manager-getting-started.ts` or
   `ManagerGettingStarted.tsx` is to be touched by this work.
5. **The sidebar is NOT gated on onboarding — decision, not a question.** Every item stays visible and
   clickable while setup is unfinished. Evidence:
   - SaaSUI's navigation guide: *"Keep behavior consistent across the app. Navigation that shifts between
     screens forces users to re-learn the product on every page."* A nav that changes as steps complete
     is precisely that.
   - NN/g on disabled buttons: use them *"sparingly"* and *"clearly explain why"* — a rail of greyed-out
     items is the maximum-friction version of that.
   - This repo already made the same call once: `ManagerSetupPage` notes that showing the rail on the
     welcome step *"put '0 of 5' and four padlocks next to a friendly intro, which reads as being locked
     out rather than as a plan ahead."*
   - The sidebar is the right pattern regardless (many sections, deep hierarchy), and a command palette
     *"does not replace visible navigation — it accelerates it"*.

   **The nav was never the problem.** Destinations that could not explain themselves were, and the
   prerequisite screens are the fix. Overwhelm is answered by the destination explaining itself, an
   obvious next step, and grouping — not by removal.

   **Also settled:** do NOT hide nav sections for features a manager "does not offer". A manager can
   offer everything, and *"has not added it yet"* is not *"never will"* — the only signal available is
   absence of listings, which is exactly the wrong one. Hiding on it removes a discovery path for a
   revenue feature and shrinks the platform.

---

## 7. Recommended order

Phase 1 → Phase 2 → Phase 3 → Phase 4, in parts, each verified against the existing suite so nothing
already working regresses.

Phases 1–3 are the "does this feel cheap?" fixes and each is a small, self-contained diff with a test.
Phase 4 is the visible UX change, and it is now **unblocked** — decision 3 removed the only piece of new
logic it would have needed.

**Phase 1 shape, concretely.** The pure predicates (`isLocationStepBehindUs`,
`isAvailabilityStepBehindUs`, `isRequirementsStepBehindUs`, `resolveStripeState`) live inside
`ManagerOnboardingContext.tsx`. Importing that 2600-line component module into the dashboard hook is the
wrong move — weight, and a cycle risk. The repo's own pattern for exactly this is a small extracted
module (see `resume-gate.ts` and the `*-behind-us.test.ts` files). So: move the predicates into their own
module, have **both** readers import from it, and the two can no longer disagree.
