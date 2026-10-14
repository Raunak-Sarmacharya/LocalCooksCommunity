# Arrival/departure scope & instruction-update map (Phase 0, read-only)

Read-only investigation. Nothing in this file was executed against a database, migration or provider.
Every claim cites `file:line` against the tree as read on 2026-10-13.

Owner decisions this map serves (PHASE0_LOG.md:6-13, manager-visit-preparation.md:5-14):

1. **Remove the per-kitchen tracking switch** (`kitchens.checkin_checkout_enabled`). Every kitchen
   always has arrival & departure. Only the **customer task list** (checklist items + photos) is
   optional.
2. **One scope pattern everywhere:** location default + optional kitchen override, for
   arrival/departure instructions, customer tasks, the cancellation policy
   (`locations.cancellation_policy_hours` → `kitchens.cancellation_policy_hours`, which exists) and
   terms (`locations.kitchen_terms_url` today + an optional kitchen-specific version). UI copy:
   *"Using {location} default · Customize for this kitchen"*, with a preview.
3. **No per-booking lock on instructions.** Managers edit freely. When a kitchen's effective
   instructions or tasks change, every chef with an **upcoming confirmed** booking at that kitchen
   gets an "instructions updated" email, like the tour side.

Status: `phase0-arrival-scope-map-deepseek-r1-20261013` (read-only). Implementation waits for this
map **plus owner approval of the additive migration for kitchen overrides**
(PHASE0_LOG.md:13).

---

## A. Every read and write of `kitchens.checkin_checkout_enabled` and derived flags

### A.0 What the flag actually is

`kitchens.checkin_checkout_enabled` is a per-kitchen boolean, `NOT NULL DEFAULT false`
(`shared/schema.ts:491`). It was back-filled from the shared location checklist so kitchens with an
enabled checklist started ON; new kitchens start OFF (`migrations/0048_kitchen_workspace_controls.sql:5-12`).

It is **not** the only gate. A kitchen visit is "on" only when the kitchen flag **and** the
location checklist's `checkin_enabled`/`checkout_enabled` are both true:

- `shared/kitchen-tracking.ts:1-12` — `resolveKitchenTracking`:
  `checkinEnabled = enabled === true && checklist?.checkinEnabled === true`,
  `checkoutEnabled = (enabled === true || started) && checklist?.checkoutEnabled === true`.
  `started` is `['checked_in','checkout_requested','checkout_claim_filed']` so an in-flight visit
  can still be finished after a later opt-out (`shared/kitchen-tracking.ts:7-10`).
- `shared/visit-duties.ts:24-37` — `makeVisitDuties` sets
  `enabled: (storage || kitchenEnabled) && row[prefix+'Enabled'] === true` (`:28`). So the snapshot's
  `arrival.enabled`/`departure.enabled` also require the kitchen flag.

Consequence for decision #1: treating the flag as always true is **not sufficient**. The location
checklist's `checkin_enabled`/`checkout_enabled` booleans are a second switch. The manager UI already
forces those to `true` on save (`server/routes/manager.ts:3296-3298`;
`client/.../CheckinCheckoutSettings.tsx:537-540`), but the schema defaults are `false`
(`shared/schema.ts:686,692`) and `migrations/0036` seeds `false`. So "always has arrival &
departure" must be expressed by **not gating visit eligibility on either boolean**, not merely by
deleting the kitchen column.

### A.1 Schema, migrations, types

| # | Location | Kind | Note |
|---|---|---|---|
| A1 | `shared/schema.ts:491` | schema write (default) | `checkinCheckoutEnabled` column, `NOT NULL DEFAULT false` |
| A2 | `migrations/0048_kitchen_workspace_controls.sql:6-12` | migration | add + backfill + default + not-null |
| A3 | `server/domains/kitchens/kitchen.types.ts:93` | server type | `checkinCheckoutEnabled?: boolean` on the kitchen DTO |
| A4 | `client/src/hooks/use-manager-dashboard.ts:43` | client type | `checkinCheckoutEnabled?: boolean` |
| A5 | `shared/kitchen-listing-readiness.ts:306-316` | shared wire type | `visitSetup.trackingEnabled` |

### A.2 Server reads (publication / listing readiness)

| # | Location | Behavior if flag always true |
|---|---|---|
| A6 | `server/services/kitchen-listing-readiness-service.ts:145` `resolveKitchenTracking(kitchen.checkinCheckoutEnabled, visitChecklist)` | `tracking.checkinEnabled/checkoutEnabled` become `visitChecklist.checkinEnabled/checkoutEnabled`; the kitchen half is a no-op |
| A7 | `server/services/kitchen-listing-readiness-service.ts:166` `hasVisitSetup: tracking.checkinEnabled && tracking.checkoutEnabled && hasTrackingNotes(visitChecklist)` | publishing gate no longer depends on the kitchen flag; still requires both notes |
| A8 | `server/services/kitchen-listing-readiness-service.ts:194` `trackingEnabled: kitchen.checkinCheckoutEnabled === true` | readiness **details** `trackingEnabled` becomes always true (feeds the review screen) |
| A9 | `server/services/kitchen-listing-readiness-service.ts:199-202` `arrival/departureRequirementCount` gated by `tracking.*` | counts become gated only by checklist flags |

`hasVisitSetup` is a **blocking requirement** in the shared checklist
(`shared/kitchen-listing-readiness.ts:27,84,125,261,274`); it is what makes publishing depend on the
kitchen flag today. Treating the flag as always true removes the kitchen half but leaves the note
requirement.

### A.3 Server reads (visit-duties snapshot)

| # | Location | Behavior if flag always true |
|---|---|---|
| A10 | `server/services/visit-duties.ts:19` `makeVisitDuties(row.checklist, row.kitchen.checkinCheckoutEnabled === true, false, ...)` | `arrival.enabled`/`departure.enabled` reduce to `checklist.checkinEnabled/checkoutEnabled` |
| A11 | `server/services/checkin-checkout-checklist.ts:26-32` `getKitchenTrackingState` reads `kitchens.checkinCheckoutEnabled` | kitchen half becomes a no-op; the `trackingStarted` "finish in-flight" path is preserved by `resolveKitchenTracking` |
| A12 | `server/services/checkin-checkout-checklist.ts:20-25` `getKitchenTrackingState(bookingId)` — snapshot path | already ignores the kitchen flag when a booking id is given; returns `duties.arrival/departure.enabled` |

### A.4 Server reads (booking lists, details, status)

| # | Location | Behavior if flag always true |
|---|---|---|
| A13 | `server/domains/bookings/booking.repository.ts:115-117,170` chef booking list `resolveKitchenTracking(row.kitchen.checkinCheckoutEnabled, row, ...)` | list flags become checklist-flag driven |
| A14 | `server/domains/bookings/booking.repository.ts:204-206,400` manager booking list, same | same |
| A15 | `server/routes/bookings.ts:1625-1637` chef booking detail: reads checklist instructions/flags, then `getKitchenTrackingState(kitchen.id, booking.checkinStatus, booking.id)` | detail flags become snapshot-driven (booking id present) |
| A16 | `server/routes/bookings.ts:2433,2437-2449` `/chef/bookings/:id/checkin-status`: `getKitchenTrackingState(..., booking.id)` + `kitchenDuties(id)` | snapshot path |
| A17 | `server/routes/bookings.ts:2520-2558` `/chef/locations/:locationId/checklist`: `resolveKitchenTracking(kitchen.checkinCheckoutEnabled, checklist)` when `?kitchenId` present | kitchen half no-op |
| A18 | `server/routes/manager.ts:4331-4340` manager booking detail: reads checklist flags then `getKitchenTrackingState(kitchen.id, ..., booking.id)` | snapshot path |

### A.5 Server reads (reminders)

| # | Location | Behavior if flag always true |
|---|---|---|
| A19 | `server/services/advance-reminders.ts:149-151` — `duties = readVisitDuties(...)`; `tracking = duties ? {duties.arrival.enabled,...} : resolveKitchenTracking(row.kitchen.checkinCheckoutEnabled, row.checklist, state)` | the legacy (no-snapshot) branch's kitchen half becomes a no-op; the snapshot branch already ignores the kitchen flag |
| A20 | `server/services/advance-reminders.ts:156,164-169` — departure guidance and reminder `requirement`/revision keyed on `tracking.checkoutEnabled` and duties | a kitchen that was OFF but has notes/items now produces the same reminders as an ON kitchen |

### A.6 Server writes

| # | Location | Note |
|---|---|---|
| A21 | `server/routes/manager.ts:3276-3284` PUT `/manager/kitchens/:kitchenId/workspace-settings` — validates and sets `patch.checkinCheckoutEnabled`; refuses enable until notes saved (`:3279-3283`) | the switch's write path |
| A22 | `server/routes/manager.ts:3294-3300` — inside the tx, when enabling, also sets `checkinEnabled:true, checkoutEnabled:true` on the location checklist | couples the kitchen flag to the location flags |
| A23 | `server/routes/manager.ts:3004-3035` PUT `/manager/locations/:locationId/checkin-checkout-settings` — writes checklist flags/items/instructions via `normalizeTrackingSetup` + upsert | the shared row's writer |
| A24 | `server/routes/manager.ts:3264-3275` PUT workspace-settings — `cancellationPolicyHours`/`minimumBookingWindowHours`/`defaultDailyBookingLimit` (the existing location→kitchen override pattern) | reference for pattern #2 |

### A.7 Shared helpers

| # | Location | Note |
|---|---|---|
| A25 | `shared/tracking-setup.ts:9-31` `normalizeTrackingSetup` — enforces check-in/checkout same value, requires notes before enabling | the "tracking" coupling logic |
| A26 | `shared/tracking-setup.ts:2-6` `hasTrackingNotes` — both instructions non-blank | reused by readiness, workspace-settings and the editor |
| A27 | `shared/kitchen-tracking.ts:1-12` `resolveKitchenTracking` | the single derived-flag helper |
| A28 | `shared/visit-duties.ts:24-37` `makeVisitDuties` | snapshot builder; `enabled` includes `kitchenEnabled` |

### A.8 Client reads/writes

| # | Location | Note |
|---|---|---|
| A29 | `client/src/components/manager/settings/KitchenWorkspaceControls.tsx:71-82` `mode="tracking"` card — `Switch` bound to `data.kitchen.checkinCheckoutEnabled`; enabling without notes routes to `onConfigure` | the per-kitchen toggle in **Details & Pricing** |
| A30 | `client/src/components/manager/settings/KitchenDetailsPricing.tsx:284-285` renders `KitchenWorkspaceControls ... mode="tracking"` | where the toggle lives |
| A31 | `client/src/components/manager/settings/KitchensManagement.tsx:232-236` `trackingConfigured` / `trackingEnabled` from `workspaceSettings.kitchen.checkinCheckoutEnabled` | My Kitchens status |
| A32 | `client/src/components/manager/settings/KitchensManagement.tsx:249-275` `trackingSetupSignature` / dismissal storage | the "finish setup" nudge keyed on the flag |
| A33 | `client/src/components/manager/settings/KitchenListingReview.tsx:411-419` `visitSetup` row text uses `setup.trackingEnabled`, `listingVisitTrackingOn/Off` | review screen |
| A34 | `client/src/components/manager/settings/KitchenCheckinCheckoutEditor.tsx:1286-1293` per-stage `Switch` (`enabled`/`onEnabledChange`) | in setupUx mode both are forced on by the caller (A37) |
| A35 | `client/src/components/manager/settings/KitchenCheckinCheckoutEditor.tsx:2180-2185` `bothDisabled` + `trackingDisabledHint`/`bothStagesDisabledHint` | copy that assumes an off state exists |
| A36 | `client/src/components/manager/settings/KitchenCheckinCheckoutEditor.tsx:1203,1213-1217` `trackingNotesRequired`/`trackingOffNotesDraft`/`trackingOptionalDuties` | coupledStages copy |
| A37 | `client/src/components/manager/settings/CheckinCheckoutSettings.tsx:526-549` passes `checkinEnabled` / `checkoutEnabled` (hard `true`) and no-op toggles in setupUx | the instructions tab already forces both on |
| A38 | `client/src/hooks/use-kitchen-checkin.ts:215-252` `canCheckin` requires `checkinEnabled===true` (`:218`); `canCheckout` requires `checkoutEnabled===true || checkinEnabled===true` (`:248-249`) | chef visit actions gated on the derived flags |
| A39 | `client/src/components/booking/ChefBookingsView.tsx:399,773,1618` uses `booking.checkinEnabled/checkoutEnabled` to show visit actions | list-level gating |
| A40 | `client/src/components/manager/settings/KitchenCheckinCheckoutEditor.tsx:1886-1893,2032-2048,2058-2059` `checkinEnabled/checkoutEnabled` props | editor plumbing |

### A.9 i18n keys that mention tracking

`manager` namespace (all three locales unless noted):

| Key | en-CA | fr-CA | uk |
|---|---|---|---|
| `kitchenArrivalDepartureHelp` | `manager.json:3` | `:3` | `:3` |
| `kitchenArrivalDepartureScope` | `:6` | `:6` | `:6` |
| `trackingSetupTitle/Description` | `:138-139` | `:139-140` | `:147-148` |
| `kitchenTrackingSharedHelp` | `:180` | `:181` | `:189` |
| `kitchenTrackingSharedDescription` | `:190` | `:192` | `:200` |
| `kitchenTrackingConfigureShared` | `:191` | `:193` | `:201` |
| `kitchenTrackingEnableFirst` | `:192` | `:194` | `:202` |
| `listingReq_visitSetupWhy` | `:2997` | `:3206` | `:3214` |
| `trackingNotesRequired` / `trackingOffNotesDraft` | `:2998-2999` | `:3207` | `:3215` |
| `trackingDisabledHint` / `trackingRequiredNotes` / `trackingNotesSaveTogether` / `trackingOptionalDuties` | `:3000-3003` | (present) | (present) |
| `kitchenTrackingRolesHelp` / `SetupHelp` / `WindowsHelp` / `TimingOwnerHelp` | `:3004-3007` | (present) | (present) |
| `trackingBothStages` | `:3012` | `:3221` | `:3221` |
| `listingVisitSharedScope` / `listingVisitTrackingOn` / `listingVisitTrackingOff` | `:3020-3022` | `:3230-3231` | `:3230-3231` |
| `storageTrackingDescription/Help` | `:3332-3333` | `:3253` | `:3253` |

`chef` namespace:

| Key | en-CA | fr-CA | uk |
|---|---|---|---|
| `kciStatusNoTracking` | `chef.json:2678` | `:2678` | `:2678` |

`kciStatusNoTracking` is rendered from `KitchenCheckinTracker.tsx:101` when neither flag is on — the
copy "This kitchen doesn't ask you to check in or out here" becomes **unreachable** once arrival &
departure are universal. `storageTracking*` keys are storage-side and stay.

### A.10 Tests that assert the flag or derived flags

| # | Location | Asserts |
|---|---|---|
| A41 | `server/routes/manager-tracking-setup.test.ts:56,60-85` | enable-blocked-without-notes; enabling sets both checklist stages and the kitchen flag |
| A42 | `server/services/visit-duties.test.ts:5,12-34` | snapshot uses `kitchen.checkinCheckoutEnabled`; snapshot immutability |
| A43 | `server/services/kitchen-listing-readiness-service.test.ts:5,28,92` | `trackingEnabled` / `hasVisitSetup` toggled via the kitchen flag |
| A44 | `server/services/advance-reminders.test.ts:55,240` | reminder fixture flips `checkinCheckoutEnabled` |
| A45 | `server/services/booking-lifecycle-delivery.test.ts:4-5,72` | mocked `kitchenDuties` mirrors `checkinCheckoutEnabled` |
| A46 | `server/routes/manager-confirmed-receipt.test.ts:12` | fixture kitchen `checkinCheckoutEnabled: false` |
| A47 | `client/.../KitchenWorkspaceControls.test.tsx:98-116` | toggle routes missing notes to setup or PUTs `{checkinCheckoutEnabled:true}` |
| A48 | `client/.../KitchensManagement.test.tsx:45` | mocks `checkinCheckoutEnabled` |
| A49 | `client/.../KitchensManagement.arrival.test.tsx:57-60` | seeds `checkinCheckoutEnabled: true` |
| A50 | `client/.../KitchenCheckinCheckoutEditor.test.tsx`, `...serialization.test.ts`, `CheckinCheckoutSettings.test.tsx`, `KitchenListingReview.test.tsx` | editor/readiness flag plumbing |

### A.11 What changes if the flag is treated as always true — and the risks

**If we only delete `checkin_checkout_enabled` and nothing else:**
- A6-A14 and A19 keep working, but now reduce to the location checklist flags. Kitchens whose
  checklist flags are `false` (schema default; `migrations/0036` seeded every pre-existing location
  OFF) would **still** have no arrival/departure — the opposite of decision #1.
- A15-A18, A12, A16 continue to prefer the snapshot when a booking exists, which is the correct
  behavior under decision #3 (booking evidence keeps what was shown).

**If we treat both the kitchen flag and the checklist flags as always true for the workflow:**
- Publishing (`hasVisitSetup`, A7) still blocks until **both notes are non-blank** (A26). That is
  consistent with decision #1 ("only the customer task list is optional") but is a real behavior
  change for the many kitchens seeded OFF: they now **cannot publish** until they write arrival and
  departure instructions. This is the biggest rollout risk and needs owner sign-off.
- `resolveKitchenTracking` (A27) collapses to `{checkinEnabled:true, checkoutEnabled:true}` for
  confirmed bookings. The `started` in-flight carve-out (`:7-10`) becomes moot for kitchens, but the
  storage path still relies on it.
- `arrival.enabled`/`departure.enabled` in the snapshot (A28) currently conflate **"workflow on"**
  with **"there are instructions/items"**. Under the new model the workflow is always on and only the
  **tasks** are optional, so these fields must be split: keep them meaning "instructions present /
  visit has an arrival step" and stop using them as the check-in eligibility gate. Otherwise
  `requestKitchenCheckin` returns *"Check-in is not required for this reservation"*
  (`server/services/kitchen-checkout-service.ts:328`) for any kitchen whose checklist section was
  never enabled.

**Concrete risks to record:**
1. **Bookings for kitchens that were OFF with no notes.** Under the new gate they cannot publish, and
   if they are already published (admin override / older data) their chefs get an arrival page with
   no instructions (`KitchenCheckinTracker.tsx:318,323` fall back to "No arrival instructions
   provided"). Decision #1 says instructions are required to publish, so the correct handling is to
   surface them as "missing" in the publish review, not to silently allow a blank arrival page.
2. **Historical bookings** keep `visit_duties` snapshots (A12/A16) and must not be reinterpreted
   (manager-visit-preparation.md:18,20). Removing the flag must not rewrite stored snapshots.
3. **Reminder behavior changes** (A19-A20): a formerly-OFF kitchen that has notes but zero tasks will
   now send preparation/arrival/departure reminders. If its notes are blank, the reminder text falls
   back to generic guidance (`advance-reminders.ts:154-156`). Timing defaults are preparation 24 h,
   arrival 2 h, departure 30 min (`server/services/lifecycle-settings.ts:14-16`).
4. **Chef list/detail flags** (A13-A16, A38-A39): once always true, every confirmed booking shows a
   visit action. A booking whose start is in the past but never closed still shows departure-only
   (`use-kitchen-checkin.ts:248-251`), which is intended.
5. **In-flight carve-out** (`shared/kitchen-tracking.ts:7-10`): removing the flag removes the reason
   for it; keep the behavior for storage, and confirm no kitchen test depends on "opt out mid-visit".
6. **Copy/i18n debt:** A.9 keys that say "tracking is turned on separately" become false and must be
   rewritten or deleted. `kciStatusNoTracking` (chef) becomes dead code.

---

## B. Storage of instructions and tasks, the snapshot, and the override schema

### B.1 Location-scoped instructions and tasks

All arrival/departure **instructions** and **customer tasks/photos** live in one row per location:

- Table `checkin_checkout_checklists` (`shared/schema.ts:681-711`). Columns: `locationId`
  (`.notNull().unique()` — `:683`), `checkinEnabled`/`checkinItems`/`checkinPhotoRequirements`/
  `checkinInstructions` (`:686-689`), the checkout mirror (`:692-695`), storage checkout (`:698-701`)
  and storage checkin (`:704-707`).
- Writer: `PUT /manager/locations/:locationId/checkin-checkout-settings`
  (`server/routes/manager.ts:2927-3067`), payload built at `:3000-3019`, normalized by
  `normalizeTrackingSetup` (`:3024`), upserted on `locationId` (`:3028-3035`), time-window fields
  written to `locations` (`:3043-3058`).
- Default row guarantee: `ensureDefaultCheckinCheckoutChecklist`
  (`server/services/checkin-checkout-checklist.ts:65-99`) and `migrations/0036`.
- `activeChecklist` strips retired `smart_lock` items/photos (`shared/active-checklist.ts:1-18`).

The **only** key is `location_id`. There is no kitchen dimension today; every kitchen at a location
shares the instructions and tasks (confirmed by copy at `en-CA/manager.json:6`,
`CheckinCheckoutSettings.tsx:424-428`).

### B.2 The per-booking duty snapshot

- `kitchenBookings.visitDuties` jsonb, nullable (`shared/schema.ts:541`), added by
  `migrations/0059_visit_duties_and_assistance.sql:3`. Storage bookings have their own
  (`shared/schema.ts:1396`, `0059:6`).
- Shape `VisitDuties` v1 (`shared/visit-duties.ts:8-12`): `{version:1, capturedAt, source,
  arrival:DutySection, departure:DutySection, checkinWindowMinutesBefore, checkoutReviewWindowMinutes}`.
  `DutySection = {enabled, instructions, items, photos}` (`:3-7`).
- Builder `makeVisitDuties` (`shared/visit-duties.ts:24-37`); validator `readVisitDuties` (`:13-23`),
  which throws on unsupported/invalid snapshots.
- Capture service `kitchenDuties(bookingId, tx, capture?)` (`server/services/visit-duties.ts:10-23`):
  if a snapshot exists it is returned unchanged; otherwise it is built from the current checklist and,
  when `capture` is supplied, written **only if still null**
  (`:20-21`). `storageDuties` is the storage twin (`:24-40`).
- `captureKitchenDuties(tx, bookingId, expected)` (`server/services/visit-duties.ts:42-46`) recomputes
  and compares, throwing *"Visit requirements changed; refresh the booking before submitting"* on a
  mismatch. It is the concurrency guard for check-in/checkout.
- Capture points: confirmation (`server/services/booking-lifecycle-delivery.ts:42-43,62`), first
  check-in/checkout (`server/services/kitchen-checkout-service.ts:398,519`), assistance
  (`server/services/visit-assistance.ts:58`), visit lifecycle
  (`server/services/kitchen-visit-lifecycle.ts:55,74,110`).
- `source` is `'confirmation' | 'legacy_first_action'` (`shared/visit-duties.ts:9`). Read-only
  previews never write (`server/services/visit-duties.ts:9` comment).

### B.3 Every reader that prefers the snapshot over current settings

| # | Location | What it prefers |
|---|---|---|
| B1 | `server/services/checkin-checkout-checklist.ts:21-25` `getKitchenTrackingState(bookingId)` | `duties.arrival/departure.enabled` |
| B2 | `server/services/kitchen-checkout-service.ts:327-328,369` check-in | snapshot `arrival` for eligibility + `validateDutySection` |
| B3 | `server/services/kitchen-checkout-service.ts:474-489` checkout | snapshot `departure` |
| B4 | `server/services/advance-reminders.ts:149-169` | snapshot instructions/items for the message and the reminder `requirement`/revision |
| B5 | `server/services/booking-lifecycle-delivery.ts:70-72` confirmation email | snapshot `arrival/departure.instructions` |
| B6 | `server/routes/bookings.ts:2437-2449` checkin-status | snapshot `visitDuties` returned to the client |
| B7 | `client/src/components/booking/KitchenCheckinTracker.tsx:137-146` | when `data.visitDuties` exists, skips the location checklist fetch and renders snapshot items/photos/instructions |
| B8 | `server/services/deadline-reminders.ts:54-55,77` | snapshot `checkoutReviewWindowMinutes` |
| B9 | `server/services/kitchen-checkout-service.ts:820,844` and `kitchen-visit-lifecycle.ts:250` | snapshot review window in SQL |

**Contrast — readers that use current settings, not the snapshot:**
- Chef booking **detail** page: `server/routes/bookings.ts:1625-1626` reads
  `checkinCheckoutChecklists.checkinInstructions/checkoutInstructions` directly → rendered by
  `client/src/pages/BookingDetailsPage.tsx:1210` via `BookingPreparation`
  (`client/src/components/booking/BookingPreparation.tsx:4-12`). This is **current** location
  instructions.
- Chef booking **list** flags: `server/domains/bookings/booking.repository.ts:170,400` (current).
- `GET /chef/locations/:locationId/checklist`: `server/routes/bookings.ts:2513-2561` (current).

So today the same chef sees **snapshot** instructions on the visit page (`/booking/:id/visit`,
`KitchenVisitPage.tsx:10,47`) and **current** instructions on the booking detail page. Under decision
#3 (no per-booking lock, managers edit freely) the visit page should show **current** instructions
too, with the snapshot kept only as arrival/departure evidence. This inconsistency is the concrete
place to change (B7).

### B.4 Proposed minimal schema for kitchen-level overrides

**Recommended: kitchen-override rows with copy-on-write.**

Migration (additive; requires owner approval — PHASE0_LOG.md:13):

```sql
ALTER TABLE checkin_checkout_checklists
  ADD COLUMN IF NOT EXISTS kitchen_id integer REFERENCES kitchens(id) ON DELETE CASCADE;
-- Replace the single-column unique on location_id with two partial uniques:
ALTER TABLE checkin_checkout_checklists DROP CONSTRAINT IF EXISTS checkin_checkout_checklists_location_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS checkin_checkout_checklists_location_default
  ON checkin_checkout_checklists (location_id) WHERE kitchen_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS checkin_checkout_checklists_kitchen_override
  ON checkin_checkout_checklists (location_id, kitchen_id) WHERE kitchen_id IS NOT NULL;
```

Schema changes: `shared/schema.ts:683` becomes a nullable `kitchenId` plus the two partial unique
indexes; the insert/upsert target changes from `locationId` to the partial index expression
(Drizzle: `onConflictDoNothing({ target: [locationId] , targetWhere: sql\`kitchen_id IS NULL\` })`).

**Resolution order (per field):** kitchen override row `(location_id, kitchen_id)` → location default
row `(location_id, kitchen_id IS NULL)` → schema default. A single resolver beside
`shared/kitchen-tracking.ts` (e.g. `resolveKitchenChecklist(kitchenRow, locationRow)`) returns the
effective `{checkinEnabled, checkinInstructions, checkinItems, checkinPhotoRequirements, checkout*,
storage*}`.

**Copy-on-write:** "Customize for this kitchen" copies the location row into a kitchen row and the
manager edits it; "Use {location} default" deletes the kitchen row. This keeps one write path and one
preview. It does **not** require making the existing NOT NULL columns nullable.

**Alternative (field-level inheritance):** add nullable override columns to `kitchens` (e.g.
`checkin_instructions_override`, `checkout_instructions_override`, and jsonb task overrides). This is
closer to the `cancellationPolicyHours` pattern (B.5) and avoids a second table, but it splits
instructions/tasks across two tables, needs new nullable columns, and makes "which kitchens override"
harder to enumerate. Recommend the row approach for the four fields together.

**Resolver wiring:** replace the direct `checkinCheckoutChecklists.locationId` lookups in
`server/services/visit-duties.ts:13`, `server/services/kitchen-listing-readiness-service.ts:104-105`,
`server/routes/bookings.ts:2513-2516,1625-1631`, `server/routes/manager.ts:3022-3023,3280-3281,4331-4337`,
`server/services/checkin-checkout-checklist.ts:30`, `server/services/advance-reminders.ts:136` and
`server/services/kitchen-checkout-service.ts:135-139,204-207` with the resolver (location row for
`kitchen_id IS NULL`, plus the kitchen row when a kitchen id is known).

**Effect on the snapshot:** `makeVisitDuties` (`shared/visit-duties.ts:24-37`) must resolve through
the new resolver so a confirmation snapshots the **kitchen-effective** instructions/tasks, not the
location's. `kitchenDuties` (`server/services/visit-duties.ts:11-14`) must pass the kitchen id.

### B.5 How the two existing "location default → kitchen override" cases work

**Cancellation policy (the pattern to copy).**
- Storage: `locations.cancellationPolicyHours NOT NULL DEFAULT 24` (`shared/schema.ts:364`);
  kitchen override nullable `kitchens.cancellationPolicyHours` (`:488`).
- Resolver `resolveKitchenBookingPolicies` (`shared/kitchen-booking-policies.ts:18-24`):
  `kitchen.cancellationPolicyHours ?? location?.cancellationPolicyHours ?? 24`.
- Booking freezes the resolved value at creation: `kitchenBookings.cancellationPolicyHours`
  (`shared/schema.ts:570`) with a DB trigger `snapshot_kitchen_booking_policy`
  (`migrations/0048_kitchen_workspace_controls.sql:20-32`).
- Writers: kitchen override via `PUT /manager/kitchens/:kitchenId/workspace-settings`
  (`server/routes/manager.ts:3264-3275`); location default + clear-kitchen-overrides via
  `PUT /manager/locations/:locationId/kitchen-booking-policies` (`:3319-3355`).
- UI: `BookingRulesSettings.tsx:299-366` numeric fields with a "reset to location default" control
  (`:150-160`), wrapped by `KitchenWorkspaceControls.tsx:84-111` with a kitchen/location save scope
  (`:98-109`). This is exactly the "Using {location} default · Customize for this kitchen" shape.

**Terms.**
- `locations.kitchenTermsUrl` only (`shared/schema.ts:385`); no kitchen column. Written via
  `PUT /manager/locations/:locationId` (`server/routes/manager.ts:6216-6219`).
- Displayed: manager terms card `BookingRulesSettings.tsx:472-548`; chef application
  `KitchenApplicationForm.tsx:2966-3013`; chef requirements page
  `KitchenRequirementsPage.tsx:223`; booking cancellation dialog
  `CancellationPolicyDialog.tsx:94-95`; readiness recommendation `hasTerms`
  (`kitchen-listing-readiness-service.ts:170`).
- To add a kitchen-specific version consistently, mirror the cancellation pattern: a nullable
  `kitchens.kitchen_terms_url` resolved as `kitchen ?? location`, with the same
  `location | kitchen` save scope and a reset control.

---

## C. The tour "instructions updated" mechanism, and the kitchen equivalent

### C.1 Producer

`PUT /viewings/settings/:kitchenId` in `server/routes/viewings.ts`:

1. Validates/updates `kitchenViewingSettings` inside a transaction with an advisory lock
   (`:825-864`).
2. Computes changed instructions: `changedTourInstructions(existing, result)`
   (`:871`; helper `shared/tour-instructions.ts:4-9`).
3. If either changed: generates one `revision = randomUUID()` (`:874`) and selects confirmed tours
   for that kitchen that are **future** or **in-flight**
   (`scheduledAt > clock_timestamp()` OR checked in and not checked out), locking them
   (`:875-879`).
4. For each tour computes `tourInstructionChangesForVisit` (`:881`) and, when relevant, calls
   `queueTourEvent({kind:'instructions_updated', ..., instructionChange:{...relevant, revision}})`
   (`:883-885`).
5. After commit, one bounded immediate delivery attempt per notified tour
   (`deliverTourEvents`, `:891-900`); remaining sends fall to the durable worker.

`queueTourEvent` (`server/services/tour-delivery-service.ts:74-124`) builds the recipient payload,
creates any notifications, and inserts one `tour_delivery_events` row with
`eventKey = ${tour.id}:instructions_updated:${revision}` (`:104-110`).

### C.2 Eligibility (which tours, which recipients)

`tourInstructionChangesForVisit` (`shared/tour-instructions.ts:12-20`):
- Suppress both if `status !== 'confirmed'`, or already checked out, or a disruption/visit result.
- If already checked in → **departure only**.
- Else require `scheduledAt > now` (future) → both changes.
- A missing/unchanged section is dropped (`tour-delivery-service.ts:146-147`).

Recipients: **chef only** (`tour-delivery-service.ts:151-164` returns a single `chef-email`
message). Managers/admins are not emailed for this kind.

### C.3 Email template / content

`tour-delivery-service.ts:145-165`:
- Subject `Tour instructions updated at {kitchenName}` (`:152`).
- Heading "Your tour instructions have been updated"; body names which instructions changed
  ("arrival and departure instructions" / "arrival instructions" / "departure instructions")
  (`:148-154`).
- Facts: kitchen, location, date, time, `TOUR-{id}` (`:155-158`).
- "Updated instructions" section shows **only the changed** sections with the **current** value, or
  "Removed by the kitchen manager." when now blank (`:159-161`). It shows **current only**, not
  old-vs-new.
- Actions: "View details" → chef dashboard view=viewings, secondary "Message manager" (`:162-163`).
- Rendered with `renderTransactionalEmail` and `getSubdomainUrl('chef')` (`:143-144,150`).

### C.4 Dedupe and coalescing

- **Dedupe:** one durable event key per revision (`:105`). Two saves get two keys, so two emails —
  verified by `tour-delivery-service.test.ts:255-262`
  (`['10:instructions_updated:save-1','10:instructions_updated:save-2']`).
- **No time-based coalescing:** each save produces one event per eligible tour. There is no debounce
  that collapses rapid successive edits into one email. (Contrast: the kitchen outbox wakeup has a
  10 s per-booking debounce, C.7.)
- **Per-recipient dedupe:** `deliveredKeys` prevents re-sending an already-delivered channel on retry
  (`tour-delivery-service.ts:760`).
- **Ordering:** a later event for the same tour is not delivered before an earlier uncompleted one
  (`:700-702`).

### C.5 Delivery-time suppression / revalidation

`deliverTourEvents` (`server/services/tour-delivery-service.ts:688+`) treats
`instructions_updated` as a "current facts" kind (`:721`) and:
- Re-reads the tour (`:722`), re-resolves recipients (`:725`), and if the tour is gone throws
  "Current tour unavailable" (`:723`).
- Recomputes eligibility and current instructions via `currentInstructionPayload`
  (`:750,613-624`): same visit + `tourInstructionChangesForVisit`; re-reads the **current**
  `kitchenViewingSettings`; throws "Current tour instructions unavailable" if missing (`:621`).
- Before each send re-reads the tour again and rebuilds the message; skips if the message no longer
  exists; throws "Current tour visitor unavailable" when the chef account is gone
  (`:767-774`).
- Historical/replay sends are rendered as "Recorded notice" (`:842-844`, `renderHistoricalTourEmail`
  `:665-686`); `instructions_updated` is explicitly excluded from the historical downgrade
  (`:842`), so a late retry still shows current instructions.

### C.6 Tests

- `server/services/tour-delivery-service.test.ts:224-262` — content per changed section, explicit
  removal, distinct durable keys per revision, retry uses current instructions/contact and does not
  repeat an accepted email (`:263-275`).
- `server/routes/viewings-availability.test.ts:125-155` — one event per affected tour; upcoming gets
  both changes, in-progress gets departure only, checked-out/cancelled get none; events queued inside
  the transaction and delivered only after commit.

### C.7 The equivalent for kitchen bookings — specification

**Which bookings are "upcoming".**
- `status === 'confirmed'` (`bookingStatusEnum`, `shared/schema.ts:26`), `chefId` not null (external
  bookings have no chef email), and the booking has **not started** in the kitchen's timezone.
- "Started" = now ≥ first visit-block start. Blocks come from
  `reminderVisitTimes` (`server/services/advance-reminders.ts:68-83`) using `bookingVisitBlocks`;
  the same helper already drives kitchen reminders. Simpler alternative: `bookingDate + startTime`
  interpreted in `locations.timezone`.
- Exclude cancelled/completed/`cancellation_requested` (the tour helper only allows `confirmed`).
- **In-progress option (recommend for parity with tours):** if the visit is in flight
  (`checkinStatus === 'checked_in'`, not checked out), send **departure-only** updates. The owner
  wording says "upcoming", so this is a decision to confirm; I would include it because it mirrors
  `tourInstructionChangesForVisit` and is useful to a chef mid-visit.
- Which instructions count as changed: reuse the same trim-compare helper. For kitchens, arrival =
  `checkinInstructions` (effective), departure = `checkoutInstructions` (effective), plus optionally
  the task list. The owner wording covers "instructions **or tasks**", so the trigger should be a
  hash of the effective `{arrivalInstructions, departureInstructions, arrivalTasks,
  departureTasks, arrivalPhotos, departurePhotos}` — not just the two notes.

**Trigger point.** The change happens in the shared location checklist writer
(`server/routes/manager.ts:2927-3067`) and, after B.4, in a kitchen-override writer. Because
instructions are currently **location-scoped**, a location edit affects **every kitchen at that
location**, so the recipient set is "every upcoming confirmed booking at every kitchen of the
location" (after overrides, per-kitchen). The producer must:
1. Detect which effective fields changed (compare saved vs incoming, per kitchen where overridden).
2. Find the affected bookings (query by `kitchen_id IN (...)` + `status='confirmed'` + not started,
   `FOR UPDATE`).
3. For each, enqueue an instructions-updated notice.

**Coalescing / debounce so several quick edits send one email.**
- The tour side does **not** coalesce; this is a deliberate improvement for kitchens.
- The Inngest wakeup already debounces per booking for 10 s:
  `bookingNoticeDelivery` has `debounce: { key: 'event.data.bookingId', period: '10s' }`
  (`server/lifecycle-inngest.ts:46-49`) and delivers
  `deliverBookingLifecycleEvents(10, 20_000, bookingId)` (`:52-55`). So **wakeups** are coalesced,
  but each queued outbox row is still a separate email.
- To send **one** email per burst, coalesce the **outbox rows** in the producer transaction: before
  inserting the new notice, supersede/skip any earlier undelivered instructions-updated row for the
  same booking (mark it `completedAt` or a `supersededBy` in `metadata`). Options:
  - (a) *One pending row per booking:* look up an uncompleted `kind='instructions_updated'` row for
    the booking and update its `metadata.revision` + `emails` content in place instead of inserting a
    second row. Simplest, no migration. Race-safe if done under the same row lock as the checklist
    write (advisory lock like the tour producer, `viewings.ts:826`).
  - (b) *Insert + supersede:* insert the new row, then mark earlier uncompleted rows of the same kind
    for that booking completed with a `superseded` marker. Keeps an audit trail of edits.
  - Recommend (a) with a `revision` in metadata and a delivery-time revalidation (below), so even if a
    burst lands across the 10 s window the email carries the **latest** instructions.
- Additional guard: the delivery worker already refuses to deliver a later event for a booking before
  an earlier uncompleted one (`server/services/booking-lifecycle-delivery.ts:139-141`) — so
  superseding is required; the worker will not skip ahead on its own.

**What the email should show.** Follow the tour precedent: **current values only**, naming which
sections changed, with an explicit "Removed by the kitchen manager." for a blanked section
(`tour-delivery-service.ts:159-161`). Do not show old-vs-new (privacy/noise). Include kitchen,
location, kitchen-local date/time, `BOOKING-{referenceCode}` and a link to the booking. This should
be a new rendered content payload, not the generic fallback text
(`booking-lifecycle-delivery.ts:176-178`).

**How it uses the existing outbox and wakeup.**
- New outbox kind, e.g. `instructions_updated`, enqueued via `queueBookingLifecycleEvent`
  (`server/services/booking-lifecycle-delivery.ts:28-116`). That function currently pre-renders rich
  content only for `kind === 'confirmed'` (`:41-77`). Add an `instructions_updated` branch that
  builds the per-recipient email content (chef only, or chef + manager per owner preference), using
  `renderTransactionalEmail` (`server/email.ts`). The outbox row's `emails` array already carries
  `{key, to, url, content}` (`:18,88-93`).
- `queueBookingLifecycleEvent` already calls `wakeBookingNoticeDelivery(bookingId)` (`:97,120-125`),
  which sends `localcooks/booking.notice.queued`; `bookingNoticeDelivery` debounces 10 s per booking
  and drains the outbox (`server/lifecycle-inngest.ts:41-56`). No new event or function is needed.
- Delivery-time revalidation: `deliverBookingLifecycleEvents` currently only re-checks booking status
  for replays/recovery (`:155-159`). For instructions-updated we must re-read the **current effective
  instructions** and the booking start at delivery, skip if the booking started/cancelled, and render
  current values (mirror `currentInstructionPayload`, `tour-delivery-service.ts:613-624`). Without
  this, a burst spanning the debounce window or a worker backlog could email stale text.
- Recipients: chefs with upcoming confirmed bookings. Managers get the confirmation notice through
  the same outbox kind only if the owner wants it; the tour side excludes managers, so default to
  chef-only unless the owner says otherwise.

**Precedent for a special outbox kind.** `kitchen_change_%` rows already bypass the per-booking
ordering guard (`server/services/booking-lifecycle-delivery.ts:139`) and have bespoke content
(`:179-193`); `instructions_updated` can follow the same shape.

### C.8 Where the chef UI shows the snapshot instead of current instructions

- Visit page (`/booking/:id/visit`): `KitchenCheckinTracker.tsx:137-146` skips the live checklist
  fetch whenever `visitDuties` exists and renders the snapshot's instructions/items/photos; the
  instructions block at `:315-326,435-444` therefore shows what was captured, not current settings.
- Booking detail page: `BookingDetailsPage.tsx:1210` → `BookingPreparation` shows the **current**
  location instructions (`bookings.ts:1625-1626`).
- Reminders/confirmation email: snapshot (`advance-reminders.ts:149-169`;
  `booking-lifecycle-delivery.ts:70-72`).

Under decision #3 the visit page should show **current** effective instructions (and a subtle
"updated since you booked" note), while the snapshot remains the arrival/departure **evidence**
record. The booking-detail page is already current and should stay the single source of truth for
what the chef reads.

---

## D. Implementation plan (small, ordered PRs)

Ordered so each PR is independently shippable and testable. PRs 1-2 are behavior-preserving
plumbing; PR 3 is the owner-visible scope change; PRs 4-5 add overrides; PR 6 adds the email.

### PR 1 — Introduce the effective-checklist resolver (no behavior change)
- Add `resolveKitchenChecklist(kitchenRow, locationRow)` beside `shared/kitchen-tracking.ts`
  (today it just returns the location row; kitchen row is always null).
- Route all `checkin_checkout_checklists` reads through it: `server/services/visit-duties.ts:13`,
  `kitchen-listing-readiness-service.ts:104-105`, `checkin-checkout-checklist.ts:30`,
  `advance-reminders.ts:136`, `kitchen-checkout-service.ts:135-139,204-207`,
  `routes/bookings.ts:1625-1631,2513-2516`, `routes/manager.ts:3022-3023,3280-3281,4331-4337`.
- Tests: unit test the resolver; existing suites must stay green (A41-A50).
- No migration.

### PR 2 — Split "workflow on" from "tasks exist" in the duty snapshot (no behavior change)
- Keep `arrival.enabled`/`departure.enabled` but add explicit `arrival.instructions` presence
  semantics; introduce an `arrival.tasks`/`departure.tasks` reading so eligibility and task
  enforcement stop sharing one flag.
- Update `shared/visit-duties.ts:24-37`, `validateDutySection` (`:39-47`), and the readers in B.3.
- Tests: extend `visit-duties.test.ts`, `booking-attendance-checkin.test.ts`,
  `booking-checkout-guards.test.ts`.

### PR 3 — Remove the per-kitchen tracking switch (owner decision #1)
- Stop reading `kitchens.checkinCheckoutEnabled` for eligibility: `shared/kitchen-tracking.ts:1-12`,
  `shared/visit-duties.ts:28`, `server/services/visit-duties.ts:19`,
  `checkin-checkout-checklist.ts:26-32`, `kitchen-listing-readiness-service.ts:145,166,194`,
  `routes/bookings.ts:2526`, `booking.repository.ts:170,400`.
- Treat check-in/out as always available for confirmed bookings within the window; keep the task
  list optional. Update `kitchen-checkout-service.ts:327-328` and `use-kitchen-checkin.ts:215-252`.
- Remove the write path: `routes/manager.ts:3276-3284,3294-3300`; remove
  `KitchenWorkspaceControls` `mode="tracking"` (`:71-82`) and its call site
  `KitchenDetailsPricing.tsx:284-285`; clean `KitchensManagement.tsx:232-275`,
  `KitchenListingReview.tsx:411-419`.
- i18n: delete/rewrite A.9 keys (`manager.json:3,6,138-139,180,190-192,2997-3022,3332-3333` en/fr/uk;
  `chef.json:2678` `kciStatusNoTracking` in all three).
- **Migration (separate, additive, owner-approved):** `ALTER TABLE kitchens DROP COLUMN
  checkin_checkout_enabled` after the code no longer reads it (ship code first, drop column in a
  later migration). Publication now requires both notes (A7) — flag to owner.
- Tests: rewrite A41, A43, A44, A47-A50.

### PR 4 — Kitchen override rows (owner decision #2, schema)
- Migration B.4: add nullable `kitchen_id`, drop single-column unique, add two partial unique indexes.
- Schema `shared/schema.ts:681-711`; writer changes in `routes/manager.ts:2927-3067` to accept a
  kitchen id; resolver from PR 1 gains the kitchen row; `makeVisitDuties` resolves effective values.
- UI: "Customize for this kitchen" / "Use {location} default" in `CheckinCheckoutSettings.tsx` and
  the tasks page, with a preview — reuse the `BookingRulesSettings.tsx:150-160,299-366` +
  `KitchenWorkspaceControls.tsx:84-111` pattern.
- Tests: new resolver tests; update `manager-tracking-setup.test.ts`, `KitchenCheckinCheckoutEditor*`
  tests.

### PR 5 — Kitchen terms override (owner decision #2, terms)
- Add nullable `kitchens.kitchen_terms_url`; resolve `kitchen ?? location`; writer + reset control
  mirroring cancellation policy (`manager.ts:6216-6219`, `BookingRulesSettings.tsx:472-548`).
- Update display callers listed in B.5.
- Tests: `BookingRulesSettings.test.tsx`, readiness `hasTerms`.

### PR 6 — "Instructions updated" booking email (owner decision #3)
- New producer in the checklist/override writer: detect changed effective fields, select upcoming
  confirmed bookings `FOR UPDATE`, enqueue one coalesced outbox row per booking (C.7).
- New `instructions_updated` branch in `queueBookingLifecycleEvent`
  (`booking-lifecycle-delivery.ts:28-116`) rendering current values chef-only.
- Delivery-time revalidation + skip-if-started in `deliverBookingLifecycleEvents`
  (`:127-248`).
- Tests: new producer test (one email per burst, eligibility: upcoming yes / started no /
  cancelled no), delivery revalidation test, i18n for the email template.

### PR 7 — Chef visit page shows current instructions
- Change `KitchenCheckinTracker.tsx:137-146` to always use the live checklist (current effective)
  for instructions, keep the snapshot for recorded evidence; add an "updated since you booked" note.
- Tests: `KitchenVisitPage.test.tsx`, `BookingPreparation.test.tsx`.

### Migration summary
| PR | Migration | Additive? | Owner approval |
|---|---|---|---|
| 4 | `kitchen_id` + partial unique indexes on `checkin_checkout_checklists` | additive (drops the single-column unique) | **required** |
| 3 | drop `kitchens.checkin_checkout_enabled` | destructive (separate, after code) | **required** |
| 5 | add nullable `kitchens.kitchen_terms_url` | additive | recommended |

### Flagged for owner approval
1. The additive `checkin_checkout_checklists` migration (partial unique indexes) — explicitly
   required before implementation (PHASE0_LOG.md:13).
2. Dropping `kitchens.checkin_checkout_enabled` (destructive; ship code first, drop later).
3. Making both arrival/departure **instructions required to publish** for every kitchen (A7) —
   changes publishability for kitchens seeded OFF.
4. Whether the instructions-updated email also goes to in-progress (departure-only) visits, and
   whether managers/admins are recipients (tour side is chef-only).
5. Coalescing strategy (a) one pending row per booking vs (b) insert+supersede — (a) needs no
   migration; (b) keeps an edit audit trail.
6. Whether the task list (items/photos) change is part of the email trigger, or only instructions.
