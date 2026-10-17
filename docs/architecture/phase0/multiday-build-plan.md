# Multi-day bookings: implementation plan against the current code

Design only, 2026-10-17, `development`; includes the owner's **any selected dates** revision, **Kitchen controls** and resolved weekly/cap/buffer decisions, plus lead corrections to refund arithmetic/funding, discount-only invitations and previous-visit task copy; updated spec re-read for each amendment.
Binding source: `docs/architecture/phase0/multiday-spec-2026-10-17.md:17`; money baseline: `docs/architecture/phase0/policy-facts-booking.md:29`.
The Oct 13 design is background only. This document's source citations were read in the current, already dirty working tree; re-read before building.
Only this document was written. No migrations, application files, git state, databases, providers, deployments, or network resources were changed.
Existing graph data was inspected read-only; code, rather than graph freshness or the old design's references, supplies the evidence below.

## 1. Contract and representation

- One booking, one request/decision, one initial authorization/capture, N separately dated visits; never N linked bookings.
- Input is a **set** `days: [{date, pricingMode, slots, equipmentIds}]`, sorted by valid kitchen-local operating date; reject duplicates and impossible dates.
- Any tapped dates are allowed, including Mon/Wed/Fri. Validate `1 <= N <= (allowMultiDayBookings ? min(kitchen override ?? location default 7, platform cap 14) : 1)`; switch defaults On for all kitchens at launch.
- Interpret the span literally: `lastDate - firstDate <= 14 calendar days` (first + 14 allowed; first + 15 refused), independently of N and the advance window.
- Every selected date must pass notice, advance horizon, schedule/override, DST, occupancy, equipment and eligibility validation. Unselected closed dates are irrelevant.
- Each day has hourly or daily pricing and its own hours/equipment; defaults copy to all selected dates, then allow individual changes. No launch length discount.
- Apply the longest-booking limit separately to each day's **hourly** slots, never to the combined N-day total or another booking's hours. Full days stay allowed at the daily rate, preserving today's bypass (`server/routes/bookings.ts:2222`); their opening hours still count toward the separate weekly quota. Settings must explain this explicitly.
- Preserve legacy one-day behavior behind the legacy payload adapter; new controls must not cancel or reprice existing bookings. Weekly quota is separate from the per-request length rule.
- All-or-nothing acceptance includes the quoted day/equipment set and full total for the new contract; prohibit item rejection/partial capture there. Legacy item decisions remain supported.
- One refund deadline is frozen before the first scheduled start. Dropping the earliest day does **not** move it; an approved whole-booking change does.
- Storage remains its separate rental product, never an add-on spanning the selected dates (`shared/cancellation-refund.ts:8`; `server/services/booking-payment-decision.ts:100`).

### Extend the existing booking/visit model

Current parent fields are first-date/time/rate oriented (`shared/schema.ts:658`); visits have global `blockIndex`, times and evidence but no date (`shared/schema.ts:752`).
Use `kitchen_booking_visits` as the durable daily schedule for the new contract; create one row per selected date in fulfillment, even when that day's hours are contiguous.
Keep hourly slots contiguous within each day, as the current change flow requires (`server/services/kitchen-booking-changes.ts:202`); separated same-day blocks remain legacy behavior.
Add nullable `visit_date` (operating date), per-day operating-window anchor, mode, selected slots and price snapshot; keep every existing evidence field and visit ID.
`visit_date` is **not** necessarily `SavedVisitClock.localDate`: an after-midnight start can belong to the previous operating date (`shared/operating-hours.ts:161`; `shared/clock-closeout.ts:102`).
Keep `bookingDate/startTime/endTime/operatingWindowStartTime` as the first day's compatibility projection; aggregate duration/subtotal remain booking totals, never an occupancy envelope.
Parent `schedule_revision=0` means legacy; positive revisions mean the dated contract. Store current days in visit rows of that revision; retain superseded/cancelled rows for evidence and money history.
Keep block indexes globally unique per booking, monotonically assigned and never recycled; display day ordinal separately. The SQL uniqueness already exists (`migrations/0043_kitchen_booking_visits.sql:26`).
Every arrival/departure/extension/inspection mutation checks visit ownership, current schedule revision and noncancelled state; an old bookmarked visit ID after a move must never mutate the new schedule. Historical evidence remains readable to its authorized parties.
Parent `selected_slots` becomes the denormalized **active occupancy only**, with `{date,startTime,endTime,windowStartTime}` on every slot; rebuild atomically from current noncancelled visits.
`occupiedIntervals` preserves extra runtime properties but types only hours (`shared/operating-hours.ts:152`): extend its slot type and every consumer to retain/use date **and each slot's anchor**.
Clock identities already include date and block index (`shared/clock-closeout.ts:38`); reuse them. Extend snapshot construction to consume each day's anchor and stable block index; it currently uses one parent anchor (`shared/clock-closeout.ts:82`).
Each selected equipment/day gets its own `equipment_bookings` row and visit FK, including zero-price included items; no continuous equipment reservation across gaps.
Current fulfillment instead creates one equipment row per listing with both dates equal to the parent date (`server/services/booking-checkout-fulfillment.ts:127`). Use real scheduled start/end instants for new rows.
Holds remain one row per date, sharing `group_id=head.id`; only the head holds the unique Stripe session ID. Put the complete versioned immutable quote/policy/day manifest on the head.
Bind, validate, renew, exclude, expire and release the entire group. Before deleting the head, copy its immutable manifest into checkout-incident evidence and then booking/payment snapshots; webhook retries must not depend on an expired hold row.
If provider creation/binding crashes before a session ID is recorded, retain the expired head's quote snapshot (no occupancy after expires_at) until recovery archives it. Update every expired-hold deletion to preserve these heads; current reserve cleanup deletes expired rows indiscriminately (`server/services/kitchen-checkout-holds.ts:102`).
Use Stripe metadata for contract version, head ID, manifest hash and aggregate cents, not N days of JSON: the existing serializer discards dates and limits metadata to 500 characters (`server/services/checkout-metadata.ts:29`; `server/services/stripe-checkout-service.ts:321`).

### Draft migration 0099 — SQL belongs here only; do not apply

New columns are nullable/defaulted, no historical schedule backfill or policy rewrite. Mirror them in Drizzle before code uses them.
The one trigger replacement only gates the existing legacy function; its original body is retained. Without that gate the SQL trigger groups repeated hours without dates (`migrations/0043_kitchen_booking_visits.sql:49`).

```sql
BEGIN;
ALTER TABLE locations ALTER COLUMN max_advance_booking_days SET DEFAULT 60;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS max_booking_days integer NOT NULL DEFAULT 7
  CHECK (max_booking_days BETWEEN 1 AND 14);
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS max_booking_days integer
  CHECK (max_booking_days BETWEEN 1 AND 14);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS allow_multiday_bookings boolean NOT NULL DEFAULT true;
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS allow_multiday_bookings boolean;
-- Existing numeric NULLs inherit the old boolean (false=0, true=60); new locations default Off.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS booking_buffer_minutes integer CHECK (booking_buffer_minutes IN (0,60,120));
ALTER TABLE locations ALTER COLUMN booking_buffer_minutes SET DEFAULT 0;
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS booking_buffer_minutes integer CHECK (booking_buffer_minutes IN (0,60,120));
ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS weekly_chef_hours_limit integer CHECK (weekly_chef_hours_limit BETWEEN 1 AND 168);
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS buffer_minutes_snapshot integer CHECK (buffer_minutes_snapshot IN (0,60,120));
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS booking_rule_overrides jsonb;
ALTER TABLE kitchen_checkout_holds ADD COLUMN IF NOT EXISTS buffer_minutes_snapshot integer CHECK (buffer_minutes_snapshot IN (0,60,120));
ALTER TABLE kitchen_invitations ADD COLUMN IF NOT EXISTS buffer_minutes_snapshot integer CHECK (buffer_minutes_snapshot IN (0,60,120));
ALTER TABLE kitchen_invitations ADD COLUMN IF NOT EXISTS booking_rule_overrides jsonb;
INSERT INTO platform_settings (key, value, description) VALUES
  ('booking_max_days_cap', '14', 'Maximum selected days in one kitchen booking'),
  ('booking_multiday_enabled', 'false', 'Enable dated kitchen booking creation after rollout')
ON CONFLICT (key) DO NOTHING;
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS schedule_revision integer NOT NULL DEFAULT 0
  CHECK (schedule_revision >= 0);
ALTER TABLE kitchen_bookings ADD COLUMN IF NOT EXISTS kitchen_day_cancellation_offer jsonb;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS visit_date date;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS schedule_revision integer;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS schedule_state text DEFAULT 'active'
  CHECK (schedule_state IN ('active', 'cancelled', 'superseded'));
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS operating_window_start_time text;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS pricing_mode text
  CHECK (pricing_mode IN ('hourly', 'daily'));
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS selected_slots jsonb;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS price_snapshot jsonb;
ALTER TABLE kitchen_booking_visits ADD COLUMN IF NOT EXISTS cancellation_plan jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_visits_revision_day_unique
  ON kitchen_booking_visits (booking_id, schedule_revision, visit_date)
  WHERE schedule_revision IS NOT NULL AND visit_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS kitchen_visits_date_lookup
  ON kitchen_booking_visits (visit_date, booking_id) WHERE visit_date IS NOT NULL;
ALTER TABLE equipment_bookings ADD COLUMN IF NOT EXISTS kitchen_booking_visit_id integer
  REFERENCES kitchen_booking_visits(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS equipment_booking_visit_lookup
  ON equipment_bookings (kitchen_booking_visit_id) WHERE kitchen_booking_visit_id IS NOT NULL;
ALTER TABLE kitchen_checkout_holds ADD COLUMN IF NOT EXISTS group_id text;
ALTER TABLE kitchen_checkout_holds ADD COLUMN IF NOT EXISTS quote_snapshot jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS kitchen_holds_group_day_unique
  ON kitchen_checkout_holds (group_id, operating_date) WHERE group_id IS NOT NULL;
ALTER TABLE kitchen_invitations ADD COLUMN IF NOT EXISTS days_snapshot jsonb;
ALTER TABLE kitchen_checkout_incidents ADD COLUMN IF NOT EXISTS quote_snapshot jsonb;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS payout_partition text
  CHECK (payout_partition IS NULL OR payout_partition = 'per_day');
CREATE TABLE IF NOT EXISTS kitchen_booking_day_allocations (
  id serial PRIMARY KEY,
  source_id integer NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  visit_id integer NOT NULL REFERENCES kitchen_booking_visits(id) ON DELETE RESTRICT,
  allocation_revision integer NOT NULL DEFAULT 1 CHECK (allocation_revision > 0),
  component_key text NOT NULL,
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents integer NOT NULL CHECK (tax_cents >= 0),
  service_fee_cents integer NOT NULL CHECK (service_fee_cents >= 0),
  stripe_fee_cents integer CHECK (stripe_fee_cents >= 0),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, allocation_revision, visit_id, component_key)
);
CREATE TABLE IF NOT EXISTS kitchen_booking_day_payouts (
  id serial PRIMARY KEY,
  source_id integer NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  visit_id integer NOT NULL REFERENCES kitchen_booking_visits(id) ON DELETE RESTRICT,
  allocation_revision integer NOT NULL DEFAULT 1 CHECK (allocation_revision > 0),
  operation_key text NOT NULL UNIQUE,
  eligible_at timestamptz,
  hold_reason text,
  released_at timestamptz,
  transfer_amount_cents integer CHECK (transfer_amount_cents >= 0),
  transfer_id text UNIQUE,
  no_entitlement boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, allocation_revision, visit_id)
);
CREATE INDEX IF NOT EXISTS kitchen_day_payout_due
  ON kitchen_booking_day_payouts (eligible_at, id)
  WHERE transfer_id IS NULL AND no_entitlement = false;
DROP TRIGGER IF EXISTS kitchen_booking_visits_on_insert ON kitchen_bookings;
CREATE TRIGGER kitchen_booking_visits_on_insert AFTER INSERT ON kitchen_bookings
  FOR EACH ROW WHEN (NEW.schedule_revision = 0)
  EXECUTE FUNCTION create_kitchen_booking_visits();
COMMIT;
```

Migration prerequisites: confirm 0099 is still free, 0043/0091/0098 are present and `kitchen_checkout_incidents` exists; the current incident service uses that durable recovery path (`server/services/kitchen-checkout-incidents.ts:205`).
Cross-row invariants (allocation totals, source/visit ownership, one current schedule, quote hash, valid day sets) require transactional service validation; a local CHECK cannot validate those relationships.
No SQL trigger should invent new dated visits: fulfillment owns their creation within its existing transaction (`server/services/booking-checkout-fulfillment.ts:105`).
The release ledger must freeze provider arguments before I/O; retries use the same row/key/amount/destination/charge, not recomputed entitlements.
Allocation revisions are immutable historical mappings; active revision is identified in source metadata. Never sum multiple revisions. A refund receipt records allocation IDs/revision, not merely a day number.

### Settings and compatibility

Mirror `maxAdvanceBookingDays`: location `maxBookingDays=7`, nullable kitchen override, effective `min(override ?? location ?? 7, cap)`; configurable admin cap defaults 14 and is bounded 1..14.
`allowMultiDayBookings` inherits kitchen -> location -> true; Off limits new requests to one day while preserving configured N for re-enabling. This kitchen preference is distinct from the temporary platform rollout gate, which remains OFF until CP11. Disabling does not invalidate existing bookings, active quoted holds or already sent invitations; new/replaced invitations and changed schedules use current controls.
Extend `shared/kitchen-booking-policies.ts:42`, `server/services/booking-policy-settings.ts:6`, manager allow-lists/reset/apply-to-location (`server/routes/manager.ts:3047`, `:3098`) and location create/update DTO/repository (`server/domains/locations/location.repository.ts:84`).
Expose effective limit/cap in public and chef booking rules (`server/routes/kitchens.ts:148`); add a sibling `BookingDaysCapSetting` beside `BookingWindowCapSetting` (`client/src/components/admin/BookingWindowCapSetting.tsx:9`).
Use a dedicated validated admin endpoint and prevent generic setting writes bypassing it, following the existing cap protection (`server/routes/admin.ts:4464`, `:4492`). Lowering a cap affects new quotes/changes, never existing accepted bookings.
Touch `BookingRulesSettings`, `KitchenWorkspaceControls`, location settings DTOs and admin platform settings; reset null to inherit (`client/src/components/manager/settings/BookingRulesSettings.tsx:60`; `client/src/components/manager/settings/KitchenWorkspaceControls.tsx:97`).
Change the **location** Drizzle default 30 to 60 (`shared/schema.ts:370`), plus new-location form/create defaults; keep stored existing values and existing-row fallback semantics. The tour setting at `shared/schema.ts:2584` is a different product.
Readers must support both contracts before writers are enabled. Gate only **new creation**; money/lifecycle recovery must continue when the rollout setting is turned off. Do not roll back to binaries unable to read dated bookings after activation.

### Kitchen controls: buffer, length and per-chef weekly quota (CP1/CP3)

**Controls/UI:** extend `BookingRulesSettings`/`KitchenWorkspaceControls` and location settings/onboarding/admin DTOs, validators, manager save/reset/apply-to-location paths above; add On/Off + “Up to N days,” Off/1 h/2 h selector, “Longest booking: N hours per day” with “Applies to hourly bookings; full days are available at the daily rate,” and optional weekly limit explaining Monday–Sunday including hours already used. Current buffer is a Switch (`client/src/components/manager/settings/BookingRulesSettings.tsx:375`); update all three locale files and `LocationSettingsView`/`LocationEditModal`/legacy ManagerBookingDashboard, not just the workspace.
At CP11 launch, every kitchen inherits On/7 (admin cap 14); send an idempotent in-app manager announcement linking to each kitchen's controls, explaining how to turn it off. Reuse manager system announcements (`server/services/notification.service.ts:597`), add a campaign key/durable delivery guard under a manager lock; show settings-page launch guidance too. Do not send notices in this design task. Trusted-chef auto-approval stays out.
**Buffer representation:** retain old `turnoverBufferEnabled` columns for deployed clients (`shared/schema.ts:371`, `:497`). Resolve kitchen numeric override, else explicit kitchen legacy boolean, else location numeric, else location legacy boolean, else 0; null reset must clear both kitchen representations. Write numeric settings going forward; reject/translate stale boolean writes under the same kitchen lock so they cannot erase a 2 h setting. Add DTO fields in `server/shared/validators/input-validator.ts:97`, kitchen/location types/repositories and public rule responses.
**Freeze (owner-approved):** snapshot 0/60/120 on every new booking and hold, including legacy single-day/free/external paths, and on each sent invitation. Keep it through authorization/fulfillment/acceptance, reschedules and added time; unchanged existing bookings never adopt a new setting. At rollout freeze the **currently effective 0/60** on existing upcoming bookings/active holds under the kitchen lock **before** enabling control edits; this accepted baseline does not reconstruct unknown historical original values. A quote carries buffer/provenance and setting revision/hash; changes between quote and reserve require refresh, not a silent new buffer.
**Pair rule (owner-approved):** between different booking identities require gap >= `max(existingSnapshot, candidateSnapshot)`, padding once, not adding two buffers; two separate bookings by the same chef still need the gap. Same booking's days/extensions do not need an internal buffer, but actual time/equipment overlap remains forbidden. Existing grandfathered neighbors are never moved/cancelled. This generalizes today's one-sided padding (`shared/booking-occupancy.ts:18`).
**Kitchen bypass:** trusted server context `ignoreBuffer` only after authenticating the owning manager/admin, with reason/actor/scope in `booking_rule_overrides`; never accept a chef-supplied bypass. A kitchen-created booking may waive spacing, not actual occupancy, closed hours or equipment ownership. Its own saved buffer is 0 when explicitly waived; an external portal customer is not automatically the kitchen. Both portal validations must receive the trusted context (`server/routes/portal.ts:406`; `server/domains/bookings/booking.service.ts:251`). Ordinary manager invitations/offers follow buffers unless explicitly overridden.

| Every buffer availability/conflict path | Required wiring and verified current anchor |
|---|---|
| Chef/public slots and plain availability | Shared `occupiesOperatingSlot`/interval predicate with both snapshots; `getAvailableTimeSlots`, `getAvailableSlots`, `getAllTimeSlotsWithBookingInfo` (`server/domains/bookings/booking.service.ts:424`, `:498`, `:510`); chef routes `server/routes/kitchens.ts:298`, `:363`, public `:651`. Mark buffer-only slots with a reason. |
| Chef/public month map and full-day status | `server/domains/bookings/booking.service.ts:687`; `server/routes/kitchens.ts:332`, `:607`; full-day guard `server/domains/bookings/booking.service.ts:399`. Use the same predicate, dated anchors, neighboring-day tails and saved margins, not a separate live boolean. |
| Quote, paid/direct/free/manual creation and schedule-edit impact | `validateBookingAvailability` (`server/domains/bookings/booking.service.ts:319`), routes `server/routes/bookings.ts:1819`, `:2197`, `:2457`, service create `server/domains/bookings/booking.service.ts:82`, portal paths above; replace/deprecate date-blind `hasBookingConflict` (`:37`) if used. Schedule/override impact uses saved margins, without retro-invalidating old bookings (`shared/operating-schedule.ts:41`). |
| Checkout/group holds and fulfillment/rebook-first/fallback | `server/services/kitchen-checkout-holds.ts:61`, `:95`, `:107`, `:159`; `server/services/booking-checkout-fulfillment.ts:110`; `server/routes/webhooks.ts:672`. Hold/group snapshots and booking IDs must survive exclusions, expiry and retries; current conflict scan hard-codes live bool -> 60 (`server/services/kitchen-checkout-holds.ts:84`). |
| Whole-booking changes | Preview/request and pre-apply `validateDestination`/`assertStillValid` (`server/services/kitchen-booking-changes.ts:203`, `:653`); destination holds at `:454`; preserve source buffer, exclude only original booking/own hold group and carry any explicit scoped kitchen bypass. |
| Invitations | Preview/create/replace and DTO availability (`server/services/kitchen-invitations.ts:112`, `:226`), accept-to-checkout validation/reserve (`server/routes/kitchen-invitations.ts:104`, `:127`), auto-accept fulfillment; use the invitation's frozen buffer through checkout and explicit manager-only override. |
| Extension/early-start options, blockers, request/offer/free/paid acceptance and application | `server/services/session-extensions.ts:100`, `:127`, `:134`, `:141`, `:159`, `:264`, `:390`, `:440`, `:454`; replace fixed 60 in `shared/session-extension.ts:64`, `:86`, `:176`. `stillFits`/recovery must revalidate before adding promised time; reserve added-time holds with source booking identity/snapshot, not as a separate booking. Both free and paid offers obey spacing absent an explicit kitchen override. |
| Non-capacity products/readers | Tours remain context-only (`shared/tour-booking-overlap.ts:20`), with correct dated overlaps; display affected chef/manager calendars consistently. Storage rental capacity/terms/check-in/checkout are entirely unaffected; no kitchen buffer/quota in `storage-rentals`/`storage-availability`. |

**What the hours cap does today:** `maxSlotsPerChef` is merely the API alias for kitchen `defaultDailyBookingLimit ?? location default ?? 2` (`server/routes/kitchens.ts:145`, `:721`), not a chef aggregate. Checkout/direct-intent/free routes compare this request's normalized one-hour slot count (`server/routes/bookings.ts:1832`, `:2222`, `:2493`); selected gaps count selected hours, not envelope length. Separate requests can each reach N hours on the same day. Checkout skips min/max for daily mode (`:2270`); portal caps non-daily (`server/routes/portal.ts:433`), WP-RS caps hourly destinations (`server/services/kitchen-booking-changes.ts:195`, `:211`).
**Current enforcement gaps:** common availability normalizes/conflict-checks but does not enforce that cap; service create only checks hourly minimum (`server/domains/bookings/booking.service.ts:90`), invitation preview prices without a duration-limit check (`server/services/kitchen-invitations.ts:112`), and extensions use parent aggregate duration plus kitchen-only override (null means no cap, ignoring location; `server/services/session-extensions.ts:125`). Put per-day **hourly-only** length enforcement in the shared server validator and use selected day's duration/effective inherited cap for hourly extension/early-start choices; full days retain the daily-rate bypass, while operating hours, occupancy and weekly quota still apply. Retain `maxSlotsPerChef` alias for old clients. Remove unsupported date-override help unless implemented: current settings promises it (`client/src/components/manager/settings/BookingRulesSettings.tsx:369`), but current cap sources are kitchen/location only.
**Weekly model (new):** `kitchens.weekly_chef_hours_limit` null = unlimited, integer 1..168 = optional per-kitchen cap; no location default/admin cap requested. Proposed new `shared/kitchen-booking-quota.ts` owns pure week/minute math, `server/services/kitchen-booking-quota.ts` reads authoritative reservations under locks. Count scheduled kitchen minutes only: hourly actual selected intervals; daily original opening-window/override slots snapshotted on that visit, never the latest edited schedule or its price; equipment, buffers, storage and tours count zero.
**Owner-approved whole-week rule:** Monday 00:00 inclusive to next Monday 00:00 exclusive in kitchen timezone; split overnight visits at week boundary by scheduled wall-clock minutes, not server UTC or a fixed 168 elapsed hours. Count the whole week's noncancelled scheduled hours, including pending/confirmed reservations, in-progress visits and **completed/used hours**; do not filter by now, visit end or parent upcoming status. Ignore cancelled/superseded daily rows even if money is retained or parent remains confirmed; retained completed days continue counting. Full days count their snapshotted opening hours.
Capacity = other counted whole-week bookings/used hours + active checkout/change/extension quota reservations + proposed set, by chef/kitchen/week; do not count a converted hold twice. Ordinary change/rebook-first excludes its original only while still eligible and reserves `max(0,newMinutes-oldMinutes)` per week, keeping original reservations until applied; if original acceptance wins the replacement race, recheck without exclusion before committing a second booking. Unaccepted invitations reserve no quota. Cancel/expire/drop releases only affected cancelled/reserved hours; completion/check-out does **not** free weekly quota. Early-start/extension reserves added minutes, not another full day's hours.
Persist hold quota reservations/booking identity/week-minute map and scoped override evidence in the head `quote_snapshot` (extension/change holds also need this payload); transfer the reservation atomically to booking/current visits on fulfillment. Summation reads the durable manifest/current visits, not client duration or one parent date; never double-count released/superseded hold groups or already applied extensions. No extra quota table is needed.
Enforce at quote/request and inside grouped reservation, free/direct creation, fulfillment, WP-RS request/approval/apply, invitation preview/send/replace/checkout and any added-time commit; stable kitchen -> source/booking -> day/equipment lock order serializes simultaneous requests. Recheck changed settings before **new** reservation; existing valid held requests keep their recorded rules until expiry. New quota must not cancel an existing booking just because a kitchen lowers it.
Return `WEEKLY_CHEF_HOURS_LIMIT` with weekStart/weekEnd/timezone/limit/alreadyCounted/used/reserved/requested/remaining; e.g. “You have used or booked 6 of 8 hours at this kitchen for Oct 19–25. These days add 3 hours. Choose fewer hours or ask the kitchen to override.” Return all failing weeks; chef-specific remaining quota must never leak through public month maps. UI: settings optional toggle/input, picker/change/invite summary, blocked-action message, manager override confirmation and support audit.
**Weekly override:** no permanent trusted-chef exemption. Owning manager can send an invitation with explicit “Override this chef's weekly limit” + reason; save a scoped grant in invitation `booking_rule_overrides`, bind chef/kitchen/invite version/manifest hash/week deltas/expiry, copy to quote/booking. For a blocked confirmed change, proposed manager-only `POST /manager/bookings/:id/weekly-limit-override` grants the exact destination hash in parent overrides; consume/copy into WP-RS policy on request. A normal invite/manager approval does not imply override; reject stale/reused grants and chef role forgery. These grants waive only weekly quota, never payment consent/actual occupancy; log author/reason in booking history/support.

## 2. One-date assumption inventory and required disposition

Inventory method: searched `bookingDate|booking_date` across server, client and shared source, then followed slots, clocks, visits, transfer and instruction consumers. Rows group related callers; citations refer to current code, not Oct 13.
**MONEY** marks changes affecting charge, refund, allocation, transfer or financial evidence; those require a high-effort builder and independent review.

| Area / verified evidence | Required change or existing behavior to keep |
|---|---|
| Parent/visit creation: `shared/schema.ts:658`; `server/services/kitchen-booking-visits.ts:26`; duplicate builder `server/services/visit-code-challenge.ts:157`; SQL `migrations/0043_kitchen_booking_visits.sql:49` | One transaction-aware daily builder shared by fulfillment/code enrollment; date grouping and per-day anchors; SQL bypass for positive revisions. Keep legacy split blocks. |
| Core overlap: `server/domains/bookings/booking.service.ts:54`; `shared/operating-hours.ts:152` | Both buffered and unbuffered core branches already read `slot.date`; retain this. Replace parent-anchor assumptions with dated slot anchors and audit the separate same-day helper (`server/domains/bookings/booking.service.ts:40`). |
| Full-day and slot/month availability: `server/domains/bookings/booking.service.ts:399`, `:471`, `:561`, `:687`; `server/routes/kitchens.ts:317` | Full-day “any booking on date” must examine selected dates, not first date. All slot/map variants must see later days and cancellations. Keep boolean month endpoint for old clients; add structured per-date reasons and separate hourly/full-day eligibility. |
| Date repository lookup: `server/domains/bookings/booking.repository.ts:445`; schedule edits `shared/operating-schedule.ts:50` | Query overlap with active dated visits/slots plus legacy first-date rows; avoid pruning a later day because its parent started earlier. Date override/weekly edit impact must include every selected day. |
| Holds: `server/services/kitchen-checkout-holds.ts:23`, `:39`, `:78`, `:119`, `:134` | Group reserve/bind/fulfill/release and group exclusion; equality checks include dates/anchors, not hours alone. Kitchen-wide lock already serializes writers; reserve all rows in one actual DB transaction. |
| Checkout/fulfillment **MONEY**: `server/routes/bookings.ts:2145`, `:2334`; `server/services/booking-checkout-fulfillment.ts:95`; `server/services/stripe-checkout-service.ts:288` | Server-price the set, persist/hash manifest, authorize aggregate total, atomically create all days/equipment/payment evidence, verify ownership/hash on fulfillment. |
| Legacy/free/direct writers **MONEY**: `server/domains/bookings/booking.service.ts:82`; `server/routes/bookings.ts:1805`; fallback `server/routes/webhooks.ts:672`; manual `server/routes/portal.ts:408` | Keep legacy single-day APIs; explicitly reject dated payloads there rather than truncating them. Versioned checkout dispatch must never fall into the single-date webhook reconstruction. Manual blocks still conflict with every dated visit. |
| Incidents and pending rebook-first **MONEY**: `server/services/kitchen-checkout-incidents.ts:205`; `server/services/booking-replacement.ts:53`; `server/services/booking-checkout-fulfillment.ts:108` | Persist manifest through compensation/retry; replace entire old request after complete new fulfillment. Acceptance race rechecks all days; extend notices to old/new day lists. No partial withdrawal or hold-group leak. |
| Approval/expiry **MONEY**: `server/services/booking-payment-decision.ts:108`, `:119`, `:132`; `shared/booking-response-deadline.ts:43` | First-start helper already takes minimum saved visit start. Reuse the 24 h/1 h-before-cutoff rule and near-deadline disclosure; all days/equipment accepted or entire request declined. Capture full new-contract amount; retain durable decision/reconciliation. |
| Price display **MONEY**: `shared/kitchen-booking-rate.ts:85`; callers `server/routes/bookings.ts:918`; `server/services/invoice-service.ts:92` | Sum frozen daily/hourly day prices. One `dailyRate * dayCount` is insufficient for mixed modes/hours/invited allocation; never infer a single rate from aggregate duration. |
| Saved closeout: `shared/clock-closeout.ts:38`, `:54`, `:89`; `server/services/clock-closeout.ts:56` | Date-aware keys, block matching, visit-ID projection already exist. Add day anchors/state/revision filtering; cancelled days stop timers; archived evidence stays readable. Complete parent only after every remaining day ends. |
| Arrival/checkout: `server/services/kitchen-visit-lifecycle.ts:38`; `server/services/kitchen-checkout-service.ts:367`, `:521` | Saved-clock visit windows already work; legacy fallback must use visit date/anchor. Require explicit visit target for dated bookings; parent check-in/out endpoints cannot affect all days. |
| Visit codes: `server/services/visit-code-challenge.ts:192`, `:432` | Existing target-per-visit and `all` self-check-in are reusable. Enroll every day, revoke only dropped/superseded targets; never reuse codes after a move; one missed/locked code does not block another date. |
| Attendance/no-show: `shared/booking-attendance.ts:26`; `server/services/booking-attendance-service.ts:102`, `:148`; `server/routes/booking-attendance.ts:54` | Saved-clock per-visit attendance already works and reports explicitly do not move money. Add date to DTO/select/fallback and scope started/no-show refund exclusions to affected day only. |
| Historical review: `server/services/kitchen-visit-lifecycle.ts:300`; `client/src/components/admin/HistoricalVisitReviews.tsx:26` | Broad parent-date prefilter can remain only if followed by saved per-visit end; exclude cancelled/superseded daily rows and show actual visit date, not parent date. |
| Reminders: `server/services/advance-reminders.ts:143`, `:228`; `server/services/deadline-reminders.ts:85` | Already iterate saved clocks and match block indexes. Filter daily state/revision; stable resource keys include visit identity; cancel obsolete schedules, retain one reminder per day/kind/revision. |
| Running late/closeout notices: `server/services/running-late.ts:46`, `:69`; `server/services/closeout-notice-email.ts:65`, `:82` | Already use visit targets and saved clocks/date lists. Keep visit-specific late reports and inspection notices; exclude cancelled/superseded targets and do not repeat whole-booking service-ended copy after each day. |
| Arrival details: `server/services/visit-duties.ts:17`, `:36`; `server/services/advance-reminders.ts:233`; `server/services/kitchen-instructions-updated.ts:42` | Current release follows each/next unfinished visit, and instruction notices test “all not checked in.” New contract releases shared details 48 h before first scheduled day, keeps them visible between days, and updates remaining days even after day 1. Do not reveal a future staffed code early. |
| Inspection/claims **MONEY**: `server/services/clock-closeout.ts:98`; `server/services/damage-claims-v2.ts:54`; legacy `server/services/damage-claim-service.ts:818` | Inspection targets already per visit. V2 claim deadline still derives from parent date: use that visit's saved end/departure. Enforce per-visit claim uniqueness; reject legacy claim paths that could misdate new bookings. |
| Session extensions **MONEY**: `server/services/session-extensions.ts:90`, `:94`, `:111`; `server/services/session-extension-payout.ts:32` | Already selects a visit/clock, but bounded parent-date query misses later-day occupancy and parent anchor misderives operating date. Use daily anchor and overlap query; extension payout follows **that day's** release. |
| Cancellation/add-ons **MONEY**: `server/services/booking-cancellation-refund.ts:373`, `:503`; `shared/cancellation-policy.ts:85` | Explicit day/component scopes, one deadline, frozen allocation shares, settled components and future-day eligibility after earlier attendance. See money section. |
| Payout/transfer **MONEY**: `shared/kitchen-payout.ts:49`; `server/services/kitchen-payout-service.ts:80`; `server/services/stripe-transfer-service.ts:508` | Current max-inspection deadline/every-visit gate and one transfer/PI cannot pay daily. Add installment partition; all legacy sweep/webhook/sync/support transfer entry points must defer partitioned sources. |
| Receipts/invoices **MONEY**: `shared/booking-documents.ts:188`; `server/services/booking-documents.ts:150`, `:169`; `server/services/invoice-service.ts:438`; `server/services/payout-statement-service.ts:199` | Receipt contains every purchased day/equipment, source-specific original schedule. Credit notes identify dropped parts; remittance per installment/transfer. Old issued documents remain immutable; final statement sums transfers exactly once. |
| Revenue/reconciliation **MONEY**: `server/services/revenue-service-v2.ts:200`, `:263`; `server/services/revenue-service.ts:703`, `:827`; `server/domains/managers/manager.repository.ts:78`; `server/routes/manager.ts:2102`, `:2233` | Keep payments counted once by source; sum sent/unpaid installments separately. Service-date reports expand day allocations; cash/transaction reports retain payment date. Payout statements must select actual transfer evidence, not first-date period. |
| Email/notifications/SMS: `server/email.ts:862`, `:883`, `:3650`; `server/services/booking-lifecycle-delivery.ts:201`, `:311`, `:619`; `server/services/notification.service.ts:286`; `server/sms.ts:251` | Request/confirmation/cancel/change show explicit date list and aggregate money; day events show affected day and visit link. Never describe first-to-last continuous possession. Reuse outbox dedupe. |
| Calendars/ICS: `server/email.ts:899`; `client/src/lib/booking-ics.ts:5`; `client/src/components/dashboard/BookingCalendarWidget.tsx:83` | Emit one event per day, stable UID `booking-ID-visit-ID`, revision sequence; drop sends CANCEL for that event, whole change updates/replaces affected events. Single-event helper is reusable per day. |
| Chef lists/pages: `client/src/hooks/use-kitchen-bookings.ts:208`; `client/src/lib/booking-list-status.ts:149`; `client/src/pages/BookingDetailsPage.tsx:1225`; `client/src/pages/KitchenVisitPage.tsx:23` | Upcoming/active/past uses remaining visits, not first start. Booking details lists days; visit route chooses explicit/next day and passes selected date/clock. Update check-in hook, tracker, policy times and links. |
| Picker/preview/confirmation: `client/src/components/booking/KitchenBookingFlow.tsx:432`, `:1388`, `:1725`; `client/src/pages/KitchenPreviewPage.tsx:1659`; `client/src/pages/BookingConfirmationPage.tsx:427` | Replace scalar selected date with versioned day-set draft and multiple calendar in both picker/popover; update preview handoff, persisted prefs and checkout summary. No parallel range picker. |
| Manager list/review: `client/src/pages/ManagerBookingsPanel.tsx:82`; `client/src/components/manager/bookings/BookingApprovalDialog.tsx:245`; `client/src/components/manager/bookings/BookingActionDialog.tsx:576`; `client/src/components/manager/bookings/BookingManagementDialog.tsx:509` | Day-list review/booking rows, one accept/decline for new contract, “Day 2 of 5” visit context; future sort/filter derives next live day. |
| Today/agenda: `server/routes/manager.ts:3909`, `:3917`, `:3933`; `client/src/components/manager/TodaysKitchenBookings.tsx:165`, `:291`; `client/src/lib/manager-overview-lifecycle.ts:50` | Query active visits even if first date is old, then emit/filter each row's date/anchor/closeout. Today already has visit IDs/keys; replace inherited first-date labels and add ordinal/count. Update agenda, both dashboard overviews and availability calendar. |
| Manager inspection/customer history: `client/src/pages/ManagerInspectionPage.tsx:154`; `server/services/manager-customers.ts:88`, `:319`; `server/services/manager-customer-page.ts:80` | Use visit bounds and day-aware future/history classification; preserve one customer booking count with N visits. Inspect selected day's photos/tasks/deadline. |
| Admin support **MONEY**: `server/services/booking-support.ts:72`, `:84`, `:100`; `client/src/components/admin/booking-support/BookingSupportSection.tsx:128` | Already loads visits; add day/allocation/installment evidence and scoped previews/actions/retries. Existing full-booking release/refund commands cannot silently act on one day. Update CaseView, ActionDialog, types, claim and change-recovery panels. |
| Admin transactions/report UI **MONEY**: `server/routes/admin.ts:3503`; `client/src/pages/ManagerRevenueDashboard.tsx:260`; `client/src/components/manager/revenue/columns.tsx:156`; `client/src/lib/formatters.ts:255` | Display booking day list versus payment/transfer date explicitly; CSV/invoice links use correct source/installment, no duplicate full-charge rows per day. |
| Tours/schedule conflicts: `shared/tour-booking-overlap.ts:25`; `server/routes/viewings.ts:308`, `:1286` | Tour overlaps are context only, not capacity blocks. Expand by dated interval/zone and fix first-date query bounds; retain tour behavior. |
| Access/deletion/privacy: `server/services/location-access-notices.ts:24`; `server/services/deletion-guard.ts:92`; `server/middleware/booking-attendance-privacy.ts:8` | Show remaining dates in access-revoke notices. Existing booking-status guards remain, plus unpaid day installments/retained visit evidence. Apply attendance/privacy redaction to nested days; no new code/photo disclosure. |
| Thin date utilities/fixtures: `shared/booking-attendance.ts:11`; `client/src/lib/calendar-date.ts:20`; `client/src/utils/timezone-utils.ts:99`; `server/date-utils.ts:6`; `server/dev-journey-d-ready.ts:1026` | Single-date functions stay valid when passed a selected day's projection; audit callers, not generic date math. Add dated fixtures without reinterpreting legacy fixtures. |

## 3. Validation, locks and checkout

Build one server-authoritative `validateBookingDays` adapter over the existing single-day engine (`server/domains/bookings/booking.service.ts:321`), shared by quote, reserve, fulfillment, change and invitation paths; it also enforces kitchen switch/count, per-day length and weekly quota, with frozen buffer/scoped override context from §1.
Return normalized days, per-date reason codes and priced components; do not call the client boolean month map authoritative. Include hourly availability versus full-day eligibility and available equipment/day.
Use location timezone throughout; current route-level notice validation still hardcodes St John's (`server/routes/bookings.ts:2226`), although policy resolution already returns location timezone (`server/services/booking-policy-settings.ts:17`).
Validate every date's horizon, not just first; count calendar dates, not elapsed milliseconds across DST. Reuse current ambiguous-slot refusal (`server/domains/bookings/booking.service.ts:392`).
Take kitchen-wide lock once, then sorted day locks and sorted equipment-listing locks; use the same order for schedule edits, change holds and fulfillment. The existing lock helper's callback uses another pool (`server/services/kitchen-checkout-holds.ts:36`): do not mistake it for a transaction across N inserts.
Run all group hold inserts and weekly quota reservations in one transaction; check internal actual overnight overlap, and buffers only against different bookings/holds. Equipment must also be held in the manifest and scanned under its listing locks, not just priced from an active listing.
Fulfillment checks session/PI/currency/chef/kitchen/hash, exact quoted component prices, group membership, first-start deadline and conflicts again. Commit all rows/payment/outbox or none, then existing conflict compensation releases/refunds the authorization.
Persist full immutable manifest before provider creation/binding; retain it after hold cleanup for 500-character-safe webhook recovery. Replay same PI returns the same booking and completes outstanding invitations/replacements (`server/services/booking-checkout-fulfillment.ts:74`).

## 4. Money design — all work here needs high-effort implementation and review

### Authorization, capture and allocation

Keep one full-amount manual authorization and durable acceptance decision; current decision prices rejected equipment and partially captures (`server/services/booking-payment-decision.ts:125`): prohibit that branch for dated bookings.
Freeze ordered day/component **subtotals** from the server quote. Calculate aggregate tax/service fee once using the existing checkout fee path (`server/routes/bookings.ts:2305`, `:2315`).
Reuse `capturedComponentAllocations` for tax (`shared/captured-component-allocations.ts:2`), and `allocateCents` for stable largest-remainder distributions (`shared/cancellation-policy.ts:34`); no new rounding implementation.
Allocate aggregate tax by component subtotal, then service fee and actual Stripe fee by component manager gross (subtotal + allocated tax), matching the current component-refund weights (`server/services/booking-cancellation-refund.ts:265`). Aggregate components to days; do not allocate once to days and again differently to items.
Freeze actual fee only after verified BalanceTransaction evidence; retain its ID/details in allocation evidence. Unknown actual fee means refund/payout pending, never an estimated fee presented as final (`shared/cancellation-policy.ts:76`).
For each source, assert `sum(subtotal+tax+serviceFee)=captured`, `sum(stripeFee)=actualFee`, and `sum(managerNet)=captured-serviceFee-actualFee`. Include zeros and deterministic date/component tie ordering.
Mirror day/component IDs/session indexes into the existing captured-component metadata for compatibility; current refund code explicitly rejects multi-session allocations without indexes (`server/services/booking-cancellation-refund.ts:381`). New ledger is authoritative for dated paths.
Never redistribute original fees/tax/service-fee shares when a day/item is dropped; use cumulative settled-component receipts, not rounding the remaining charge again.

### Daily transfer release and recovery

Today `payoutEligibility` waits for every inspection and uses the maximum deadline (`shared/kitchen-payout.ts:49`); the payout service persists one release then transfers one payment source (`server/services/kitchen-payout-service.ts:123`, `:135`).
New captured dated sources get `payout_partition='per_day'` **before capture**, and `payout_timing='after_closeout'` regardless of the legacy environment default (`shared/kitchen-payout.ts:21`). Original payment_transactions remains one real charge row.
Create one day-payout row per source/day with nonzero entitlement, grouped across that day's components. Do not create fake charge rows or store the last day's transfer in parent `transfer_id`.
Each day uses its own cleared/claim-filed/auto-closed inspection; preserve the actual-departure deadline semantics (`shared/clock-closeout.ts:128`) and cancelled-retained-share scheduled-end gate (`shared/kitchen-payout.ts:54`).
Guard partitioned sources at the common transfer dispatcher **before** special change-source dispatch (`server/services/stripe-transfer-service.ts:161`), legacy sweep, capture webhooks, manual sync, admin payout and source refund/reversal helpers.
Daily release takes source locks, booking/visit and installment lock in consistent order, verifies refund/money holds and current revision, commits exact cents/destination/charge/key, then calls provider outside the transaction.
Use `kitchen-day-transfer:{sourceId}:{visitId}:{allocationRevision}`; metadata includes source, booking, visit, operating date and installment ID; source_transaction is the original charge, transfer_group remains PI-based. Current PI-only key cannot be reused (`server/services/stripe-transfer-service.ts:508`).
Reconcile a lost response by the installment's provider metadata/key and verify amount/currency/destination/source before saving transfer ID; do not infer success from source-level totals. Preserve zero-entitlement terminal rows and bounded retry sweeps.
Persist an in-flight transfer reservation recognized by money guards: concurrent refund cannot change an installment's amount between release and provider reconciliation. Recheck holds before an unstarted attempt; never reprice an unknown attempt.
Extensions already have `visit_id` (`shared/schema.ts:784`); their separate charge pays with that day's installment, not the last day. WP-RS supplemental sources need day allocations too (`server/services/kitchen-change-payout.ts:40`).
One payout notice per release run can summarize released days; show each remittance, sent net and remaining net. Extend payout evidence/documents, revenue V2, reconciliation, upcoming totals and admin support together.

### Refunds, drops, add-ons and kitchen interruption

Add a dated-contract disclosure/snapshot discriminator at **checkout creation**, e.g. `deadlineBasis:'booking_first_day'`; retain accepted policy ID/version/tiers/zone and the existing fee arithmetic. Never add it retrospectively; no separate fee-order contract/version is needed.
Extend snapshot serialization/parsing and accepted disclosure versions together: current metadata reconstruction restores only one session and would discard new discriminators (`server/services/cancellation-policy-settings.ts:83`; `shared/cancellation-policy.ts:12`). Dated fulfillment restores the verified manifest snapshot, not that lossy legacy parser.
Use first saved session start minus frozen notice hours for every refundable component; retain the original anchor even if day 1 is cancelled. Approved WP-RS may replace `sessions`, but not accepted terms: 0098 compares snapshot **minus `sessions`** (`migrations/0098_policy_snapshot_sessions_movable.sql:6`).
Keep sessions for all originally scheduled days after a drop; occupancy/active-day state lives elsewhere. Whole change replaces session mappings atomically and records original evidence.
Implement selected-day scope alongside whole-booking scope: a chef drop removes that day's occupancy/equipment/code/reminders immediately and records a durable refund plan; other days and their clocks remain active. “Cancel all” selects remaining eligible days, not consumed sessions.
Keep parent confirmed while a remaining day is still upcoming/in service; complete it when all noncancelled visits end. Parent cancellation describes an entirely cancelled undelivered booking, not a completed day plus cancelled future days. Display original day ordinal/count with cancelled rows explicitly marked and remaining-day count separately.
Before deadline: `refund = paid selected share - its actual card-fee share`. After deadline: use the frozen 50%/100% tier for future dropped days; started/no-show days get no ordinary refund. Kitchen may award more through an explicit scoped refund.
**Keep existing late-charge arithmetic:** refund percent multiplies `(paidShare - feeShare)` (`shared/cancellation-policy.ts:87`, `:93`), with the engine's cumulative cent rounding/allocation unchanged. A $100 paid share with a $3 fee share at a 50% refund tier returns **$48.50** (half the total minus the card fee on that half); test this same formula for single-day, day-drop and WP-AO scopes rather than introducing a new fee order.
A day with multiple equipment components must be rounded cumulatively with largest remainder; dropping items one at a time cannot increase total refund. Keep fee deductions/settled components fixed across later day/whole cancellation.
WP-AO already reserves, removes, refunds/retries and settles per component (`server/services/booking-cancellation-refund.ts:605`, `:633`, `:655`). Reuse it; scope item row to visit and replace its “any visit checked in” guard (`:508`) with affected-day eligibility. Earlier attendance must not prevent removing day 3's equipment.
Keep `settledAddons`/already-refunded funding records when a later day/all refund runs (`server/services/booking-cancellation-refund.ts:495`). Never refund a removed item twice or recreate it during a change. Included/free equipment removes with zero refund.
Unsent installment: reduce only that day's unpaid entitlement by its kitchen refund debit. Sent installment: reverse that exact transfer share, or refund promptly and record kitchen debt under the existing WP-AO shortfall fallback (`server/services/booking-cancellation-refund.ts:980`). Never debit another day silently.
Extend `reverseTransferAndRefund`, fee/funding verification and payment-refund reconciliation to an explicit list of installment reversals; those current callers pass one source transfer ID (`server/services/booking-cancellation-refund.ts:403`). Refund operation is per source with exact per-allocation funding, reversal subkeys per transfer.
Keys: `kitchen-day-refund:{bookingId}:{operationId}:{sourceId}`, reversal `...:{transferId}`; persist selected visit/component IDs, allocation revision, quote/effective time, fee and funding before provider work. Serialize overlapping day/add-on/whole/refund/payout/change commands.
Kitchen cancels one day: commit scoped cancellation and full remaining day refund including its fee; never call today's whole-booking cancellation unchanged (`server/services/booking-cancellation-refund.ts:79`). Keep other days booked.
Persist the #10 offer with affected day, eligible remaining future visit IDs, creation time and expiry = next remaining scheduled start after cancellation; chef may drop those days without late charge until expiry. If none remain, no offer. Replay does not extend expiry.
The kitchen-cancelled day's funding is **exactly today's kitchen cancellation**: debit/reverse that day's remaining kitchen share, return its platform service-fee share, and have **Local Cooks absorb its card-fee share** (`server/services/booking-cancellation-refund.ts:71`, `:164`, `:172`). Scope the existing funding evidence to the day; never charge that processing cost to the kitchen. Record exact refund/reversal/debt allocations and use the established recovery path if already paid; never silently charge a saved card.
The chef's remaining-day remedy refunds each selected day's paid share minus its fee, with no late charge; the kitchen-funded portion reduces that day's kitchen entitlement (or its exact transfer/recovery balance), with platform service-fee returns following existing component funding. Those days' card-fee shares remain deducted, unlike the kitchen-cancelled day. Show offer expiry/exact dollars; consumed/no-show days are not “remaining.” Keep the owner-overridable lead decision visible in policy documentation.

### Claims, chargebacks and support

Damage/cleaning stays one claim per visit, existing $250 cap/review/payment flow; fix the parent-date filing-window bug (`server/services/damage-claims-v2.ts:56`, `:106`). Claims do not hold kitchen payout (`shared/kitchen-payout.ts:56`).
A bank dispute belongs to a charge, not automatically to one day. Associate known affected day IDs for evidence/admin reporting; an unallocated dispute remains source/booking-scoped, never guessed by equal division.
Keep source-wide refund freeze while chargeback is open and implement pilot payout protection: delivered days still pay, Local Cooks absorbs loss (`server/services/booking-support-flags.ts:93`; `server/services/kitchen-payout-service.ts:47`).
Current guard discrepancy to fix/test in CP5: payout context excludes chargeback flags, but the guard's kitchen-booking flag query lacks the exemption applied to its storage branch (`server/services/booking-money-guard.ts:30`). Do not claim daily payouts are protected until this common guard agrees.
Money guard must resolve day transfer IDs back to source/booking (`server/services/booking-money-guard.ts:19` currently resolves only parent transfer IDs). A scoped operational problem can hold its day's payout; unscoped support flags remain booking-wide until explicitly resolved.
Add visit/allocation/transfer/reversal IDs to support audit/evidence, with exact affected-day previews. Preserve admin-only notes and per-visit attendance privacy.

## 5. Whole-booking change requests on WP-RS

Extend `ChangeSchedule` with a versioned day-set variant and legacy reader (`shared/kitchen-booking-change.ts:9`); `kitchen_booking_changes` already stores JSON schedules/quote/policy, so no parallel change-request table.
Replace the explicit multi-visit rejection (`server/services/kitchen-booking-changes.ts:176`; `shared/kitchen-booking-change.ts:45`) for new dated contracts only. One open request/revision, before the **current whole-booking deadline**, no started days.
Destination obeys count/span/advance/notice rules and per-day pricing/equipment availability. Quote whole old/new totals and exact difference; do not accidentally reject mixed component deltas merely because current single-day pricing does (`server/services/kitchen-booking-changes.ts:327`).
Reuse authorization/capture/refund/release/recovery state machine and source locking. Hold the complete destination set while original days stay booked; group exclusion covers the source booking and own destination holds, not someone else's dates.
Positive difference: hold only difference, capture on approval, allocate that separate source across new days. Negative: refund verified original-source difference minus fee share; preserve current source ordering/recovery semantics (`server/services/kitchen-booking-changes.ts:335`).
Maintain immutable allocation lineage per schedule revision. Carry settled refunds/items forward unchanged; map/reallocate only uncommitted balances, retaining original cents/fee provenance and per-source conservation. No superseded installment may release; no already sent amount may be reallocated.
Because ordinary changes occur before the first deadline/start, any released/sent installment or inconsistent historical evidence makes the case support-only. Do not remove that guard simply to allow N visit rows.
Approval atomically creates the new visit revision, supersedes old future targets, rebuilds slots/policy sessions/clock/holds/equipment, rotates codes, reschedules reminders/payouts and emits day-calendar updates; original receipts retain source-specific schedule (`server/services/kitchen-booking-changes.ts:664`, `:687`).
Decline/expiry/withdraw releases the full destination group and difference hold, leaving original schedule/policy/clocks intact. Preserve capture-then-apply and refund-then-apply recovery, including support's existing keep-refund resolution; expand recovery UI to all affected days.

## 6. Multi-day invitations on 0091

Retain 0091 IDs/version/request keys/status/outbox and pre-approved checkout (`migrations/0091_kitchen_invitations.sql:1`; `server/services/booking-checkout-fulfillment.ts:34`). Add nullable `days_snapshot`; null adapts the current one-date columns.
Use the same any-date/count/14-day-span validator as chef checkout and changes; the owner's revised #14 supersedes consecutive-only invitation wording.
Preview/create/replace/DTO/expiry/pending-conflict/overlap-warning/admin-resend paths currently use `input.date` (`server/services/kitchen-invitations.ts:80`, `:96`, `:132`, `:191`, `:238`). Extend all, keeping expiry based on first start and existing notice/checkout buffer.
Discounted **booking** kitchen subtotal: allocate offered amount across day kitchen list subtotals using `allocateCents`; equipment added by chef stays separately priced per selected day. Freeze list/offered allocations; no ordinary length discounts.
Keep the existing discount-off-list representation and **$1 floor** (`server/services/kitchen-invitations.ts:47`): offered kitchen subtotal is at least 100 cents and never above list; no above-list offers or validation extension. Apply the floor to the booking's offered kitchen subtotal, not separately to every day's allocation.
No inventory held merely by sending an invite; accept-to-checkout revalidates/reserves all days, version and chef access. One unavailable date blocks the whole checkout; no partial invitation acceptance.
Keep automatic acceptance/capture after authorized invitation fulfillment, not an immediate-capture fork (`server/services/booking-checkout-fulfillment.ts:36`); replay/version races must preserve exactly one booking and captured total.
Touch `server/routes/kitchen-invitations.ts:127`, invitation service/types, `ManagerInvitationNewPage`, `ChefInvitationPage`, sent/admin invitation lists and notices (`client/src/lib/invitations.ts:18`; `client/src/pages/ManagerInvitationNewPage.tsx:68`; `client/src/pages/ChefInvitationPage.tsx:93`).

## 7. UI composition

Reuse the existing calendar/steps; declared `react-day-picker` dependency is ^8.10.1 (`package.json:163`): **mode="multiple"**, N selected dates, announced selection count, disabled-date reasons available to keyboard/touch/screen readers.
`KitchenBookingFlow` owns the day-set draft; per-day cards offer “use these hours/equipment for all days,” then independent hourly/full-day and equipment edits; changing first date recomputes span eligibility without silently deleting selected dates.
Disable closed/taken/notice/horizon dates; a partly booked day can still be selected for available hourly time, but its full-day option is disabled. Explain exhausted count/span separately; no implied continuous range between selected dates.
`BookingPriceSummary` and confirm step list each date/mode/hours/equipment/subtotal, aggregate tax/service fee/total, full-card-hold disclosure and the **one** refund deadline. Update `CheckoutCancellationDisclosure`/`CancellationPolicySummary` and translated strings.
`BookingDetailsPage` gets chronological day list, selected-day status/receipt/refund/code/visit links; `BookingCancellationChooser` adds day selectors and scoped quote. Do not hide all future-day actions because an earlier day is active (`client/src/components/booking/BookingCancellationChooser.tsx:55`).
`KitchenVisitPage`, `KitchenCheckinTracker`, `use-kitchen-checkin`, `BookingAttendancePanel`, `CheckinPolicyTimesCard`, `VisitAssistancePanel`, `SessionExtensionsCard` and claim sheets use selected visit/date and “Day 2 of 5.” Use **“Same as previous visit”**, including across gaps; copy task choices only when current requirement IDs match, require fresh confirmation/photos, and never fabricate attendance/evidence (`server/services/visit-duties.ts:112`).
Manager: `ManagerBookingsPanel`, `ManagerBookingsAgenda`, approval/action/management dialogs, `ManagerBookingPayment`, `VisitCodePanel`, `ManagerInspectionPage`, `TodaysKitchenBookings`, dashboard overviews and `KitchenAvailabilityManagement` show dated rows/next day, one booking decision and per-day payout/inspection context.
Admin: support `CaseView`/`ActionDialog`/`FrozenCancellationPolicy`/`DamageClaimPanel`/`KitchenChangeRecovery`, booking list types and transaction history expose the day list and scoped evidence/actions. Revenue tables/CSV distinguish booking total, this day and this transfer.
Persist versioned day-set preferences in `client/src/lib/persisted-booking-prefs.ts`; keep scalar legacy URL/draft restore. Preview, confirmation and change-request notices must preserve all selected days through handoff.

## 8. Checkpoints in build order

Every checkpoint can deploy to dev with new creation OFF; later checkpoints depend on earlier readers/schema. Activation is last. Money checkpoints require a **high-effort builder plus independent money review**; no sub-builders are started by this design task.
For each checkpoint run relevant existing and new unit/PGlite suites plus type checks; execute live steps only later in authorized dev/sandbox sessions, recording booking/source/transfer IDs and actual cents.

1. **CP1 — Schema/kitchen controls/contract adapter (M, medium, non-money).** Files: draft 0099/Drizzle, booking policy resolver/service, kitchen/location DTOs/repositories/input-validator, manager/admin/kitchen routes, workspace/location/onboarding settings and locales; notification campaign at CP11 only.
   Tests: all kitchens inherit On/7, Off accepts exactly one day, stored N survives toggle, cap 14/inherit/reset/apply-to-location; numeric buffer null/0/60/120 and old boolean compatibility; optional weekly limit null/1..168; settings copy explicitly states hourly-only longest cap/daily-rate bypass and whole Monday–Sunday quota including used hours; old payload/rows, duplicate dates, N=1/7/14, span +14/+15 and Drizzle/SQL parity.
   Dev acceptance: existing location still 30/new one 60; On/7 default and kitchen Off/override/reset work; buffer selector and weekly Off/value persist with correct copy in every settings surface; daily-rate full day remains offered despite a shorter hourly cap; old single-day still works; platform rollout gate OFF independently rejects new payload.
2. **CP2 — Dated visits and lifecycle readers (L, high, MONEY timing/evidence).** Files: visit builders, clock-closeout shared/service, visit-code, visit lifecycle, attendance, duties, reminders, claim-window context.
   Tests: identical hours across dates, different overnight anchors, stable block IDs/revisions, missed day 1 then day 2 arrival, per-day inspection/no-show/claim window, cancelled-day exclusion, first-day instruction release stays visible in gaps.
   Dev acceptance: controlled dated fixture; each code/window/inspection is independent; all-self-check-in works; details release first minus 48 h; required tasks each day; old visit URLs still work.
3. **CP3 — Availability/buffer/quota and atomic hold groups (L, high, MONEY-adjacent inventory/authorization gates; high-effort builder + review).** Files: all buffer paths in §1, new shared/server kitchen-booking-quota helpers, booking service/repository, holds/incidents, route validators, WP-RS/invitation/extension adapters and manager override/history/support path. Pre-enable legacy-buffer snapshot initialization is a separate audited step, not a policy/schedule rewrite.
   Tests (unit/PGlite): every path matrix at Off/60/120, exact boundary and one-minute short, max-of-margins not sum, rollout legacy 0/60 freeze/settings edits, overnight/DST/later dates, same-booking exemption versus same-chef separate booking, owner bypass/chef forgery, full-day equipment/group rollback; hourly per-day N cap across multi-day/separate same-day requests versus daily bypass; quota separate chef/kitchen/week, Monday/DST/overnight split, full-day opening-hour snapshot, used/completed/in-progress hours remain counted, cancellation removes hours regardless of retained charge, no checkout quota release, concurrent holds/conversion/rebook/change delta, added time, expired/forged overrides, no public quota leak, storage unchanged.
   Dev acceptance: compare chef/public slots + month + hold + fulfillment + change + invite + free/paid extension/early-start; 12:00 end + 1 h allows 13:00, +2 h allows 14:00; switch setting and old snapshot remains, kitchen bypass fits spacing but true overlap fails. With weekly 8 h and hourly max >=3, **6 already-used hours +3 new rejects** before card hold, +2 accepts; completing visits never restores quota, cancellation does, next Monday/another kitchen/chef is independent; manager scoped grant allows +3 once, stale/chef grant fails. With longest hourly 2 h and enough weekly capacity, an 8 h full day stays allowed/counts 8 h; race two checkouts for one capacity winner/no orphan holds.
4. **CP4 — Aggregate checkout/capture and day allocations (L, critical, MONEY).** Files: booking routes, Stripe checkout/metadata, fulfillment/payment-decision, webhook/fallback/rebook-first, captured allocations and new ledger service.
   Tests: mixed modes/rates/equipment, 14-day metadata bounds, tax/fee remainder conservation, full capture/no partial acceptance, expired/replayed webhooks, acceptance/replacement race, lost response and manifest recovery.
   Dev acceptance: gated sandbox request holds full total; accept captures exactly total, decline releases it; no transfer yet; one booking/N visits/items; fees reconcile to BalanceTransaction; replay changes nothing.
5. **CP5 — Daily payout partition and reports (L, critical, MONEY).** Files: kitchen-payout/shared eligibility, transfer service/money guard, day ledger/sweeps, extension/change payout, payout evidence/documents, revenue V2/legacy repository paths.
   Tests: day 1 clears while day 2 upcoming, 24 h auto-close, issue/chargeback distinctions, zero entitlement, missing fee, refund/transfer race, duplicate sweep/webhook/manual sync, lost transfer response and installment reconciliation.
   Dev acceptance: clear day 1 -> one correct transfer; day 2 unpaid; replay all recovery entry points -> no duplicate/full-source transfer; close day 2 -> second transfer; revenue/payout evidence totals match original net.
6. **CP6 — Day drops, WP-AO and kitchen interruption (L, critical, MONEY).** Files: cancellation-policy/refund shared helpers, booking-cancellation-refund, item routes, installment reversals/reconciliation, lifecycle notices and support actions.
   Tests: one cutoff before/at/after for all days; drop earliest keeps cutoff; existing 50% x (paid share - fee share), $100/$3 -> $48.50 and cumulative rounding; item-then-day-then-all conservation; free equipment; day 1 attendance does not block day 3 removal; paid/unpaid reversal/debt; #10 offer expiry/race/replay, cancelled-day card fee absorbed by Local Cooks versus remaining-day card fees deducted and kitchen entitlements debited.
   Dev acceptance: drop middle/first day, verify only its inventory released/refund exact; remove later equipment after earlier visit; kitchen cancel one -> full incl fee with kitchen share reversed and Local Cooks card-fee cost; chef drops rest before next start without late charge, minus their fees; support funding/debt evidence reconciles per day.
7. **CP7 — Whole-booking WP-RS changes (L, critical, MONEY).** Files: shared change/reschedule types, kitchen-booking-changes/routes/notice/payout, grouped holds, policy session amendment, visit/code/reminder builders, change UI/recovery.
   Tests: set span/count/limits; positive/negative/equal-price mixed-mode changes; settled add-ons; only one open change; decline/expiry original intact; capture/refund then apply failure; 0098 accepts sessions-only amendment; no old installment releases.
   Dev acceptance: move Mon/Wed/Fri to Tue/Thu with per-day hours, accept price-up/down; old codes/holds gone, new clocks and first deadline correct; decline leaves original; exercise recover/keep-refund without double charge/refund.
8. **CP8 — Chef picker, booking/day pages and calendars (L, medium, money UI).** Files: KitchenBookingFlow/PriceSummary/disclosure, preview/confirmation/prefs, BookingDetailsPage/cancel chooser/visit hooks and panels, calendar/ICS helpers, locales.
   Tests: keyboard/touch multiple selection, retained per-day edits, count/span reasons, partial hourly availability, date-set draft restore, exact one deadline, future-day actions after day 1, selected visit links, “Same as previous visit” across gaps with changed requirement IDs/fresh photos, event UID/sequence/cancel.
   Dev acceptance: mobile and desktop Mon/Wed/Fri mixed-mode/equipment booking; summary/hold/refund quotes match backend; refresh restores; day list/visit/ICS show no continuous possession; legacy one-day journey passes.
9. **CP9 — Manager/admin operations, communications and documents (L, high, MONEY evidence/actions).** Files: Today route/agenda/review/dialogs/inspection, customer/access histories, booking-support service/UI/routes, email/SMS/outbox, invoice/booking documents/shared document schema/revenue UI/CSV.
   Tests: parent started last week but today's day appears; Day 2 of 5; no partial acceptance; per-day support preview/retry/redaction; source counted once; every receipt/credit/remittance sums; per-day calendar update/cancellation and outbox dedupe.
   Dev acceptance: manager accepts/inspects correct day from Today; admin cancels/refunds/releases scoped day with audit trail; chef/manager/admin notices and downloaded PDFs/CSV agree on dates/cents; existing single-day communications unchanged.
10. **CP10 — 0091 invitation extension (M, high, MONEY).** Files: kitchen-invitations service/routes/types, invited pricing/fulfillment, ManagerInvitationNewPage/ChefInvitationPage/sent/admin lists/notices.
    Tests: discounted total allocation/ties, $1 booking-subtotal floor, below-floor/above-list rejection, nonconsecutive set and span, equipment per day, expiry first start, changed invite/version/eligibility race, one unavailable day, duplicate request/checkout/webhook and replayed auto-accept.
    Dev acceptance: send Mon/Wed/Fri discounted invitation; chef chooses equipment/day, one hold and captured total; reject below-$1/above-list offer; second chef takes one date -> whole invite checkout fails safely; old single-day invite still works.
11. **CP11 — PostgreSQL parity and dev activation (M, critical, MONEY rollout).** Files: schema/migration parity checks, meaningful integration fixtures and focused regression suites; rollout setting only after CP1–10 pass.
    Tests: run reviewed 0043/0091/0098/0099 DDL in isolated real PostgreSQL; verify triggers, FKs/uniques/CHECKs, source locking, money recovery and old deployed INSERTs. Re-run focused single-day suites after new-contract final changes.
    Dev acceptance: initialize/verify legacy buffer snapshots before edits, enable for controlled dev users, repeat request/accept/drop/change/invite/each-day-closeout/quota/buffer reconciliation; turn creation OFF and confirm existing recovery continues; launch generally on dev with kitchen switch On/7, one in-app manager announcement per campaign, and verify disabled kitchens remain Off on replay.

**PGlite warning:** `server/services/kitchen-booking-changes.pglite.ts:25` generates only columns/defaults/primary keys; `:44` runs explicit extra SQL. Migration-only CHECKs/triggers/FKs/uniques are not automatically exercised, nor are all Drizzle indexes. Include necessary extra SQL in focused tests and keep CP11 real-PostgreSQL parity mandatory—especially the 0043 date-blind trigger and 0098 immutable-policy exception.
Do not run broad provider/DB tests or deploy during this read-only design task. Existing single-day regression anchors include booking-payment-decision, booking-replacement, booking-cancellation-refund, kitchen-booking-changes, kitchen-payout-service, visit-code, clock-closeout and invitation suites.

## 9. Owner-resolved controls — no remaining questions

- **Resolved — weekly quota:** whole calendar week Monday 00:00–next Monday 00:00 in kitchen timezone, including already used/completed and in-progress hours; cancelled hours excluded. Full days count that day's snapshotted opening hours. Completion never resets allowance; UI displays explicit week bounds and used/booked totals.
- **Resolved — longest booking:** hourly bookings only, independently per day; full days remain available at the daily rate and count opening hours toward weekly quota. Settings copy explains the daily-rate bypass; preserve current behavior.
- **Resolved — buffers:** freeze currently effective 0/60 on existing upcoming bookings/holds at rollout, snapshot new rows, and require pair gap = max of snapshots, never their sum. Keep explicit existing On choices and a booking's saved buffer through approved moves; no existing appointment moves. This is the accepted rollout baseline, not reconstructed historical terms.

Resolved implementation detail: overnight release/deadline uses first actual scheduled start in the location timezone; show the operating date and next-calendar-day clock explicitly, consistent with saved-clock math (`shared/clock-closeout.ts:95`).

Count/span, arbitrary dates, per-day equipment, all-or-nothing acceptance, one refund deadline/existing refund arithmetic, daily payout, drop-any-day, whole-set changes, interruption funding split, discount-only invitations/$1 floor, “Same as previous visit” and first-day arrival-details release are decided; they are not reopened here.
