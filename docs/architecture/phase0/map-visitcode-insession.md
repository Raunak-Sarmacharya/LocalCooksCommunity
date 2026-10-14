# Map: visit code + in-session screen (Phase 0, build step 2)

Read-only code map. Task `phase0-visitcode-map-deepseek-r1-20261014`. Every claim below carries a `file:line` citation. No source was edited; no migration was written to `migrations/`; no database or external service was touched. This document is the only file written.

Governing inputs read first: `HANDOVER-2026-10-14.md` (§3 visit code + in-session screen), `PHASE0_LOG.md` (top Oct14 sections, esp. lines 50–59, 61–66, 78–89), `visit-code-checkpoint-proposal.md`, `manager-visit-preparation.md`, `design-checkin-checkout.md` (§3–§6), `design-multiday-invites-extension.md` (§A8, §B6–B8).

## 0. Status and the "in flux" warning (read this before relying on any line)

Two other agents were editing arrival/closeout/access files while this map was written. The files below were read **as they are now** and **must be re-verified after those builds land**:

- `server/services/clock-closeout.ts`, `shared/clock-closeout.ts`, `shared/booking-attendance.ts`, `server/services/kitchen-visit-lifecycle.ts`, `server/services/kitchen-checkout-service.ts`
- `client/src/components/booking/KitchenCheckinTracker.tsx`, `client/src/pages/BookingDetailsPage.tsx`, `client/src/hooks/use-kitchen-checkin.ts`
- `server/domains/bookings/booking.service.ts`, `server/services/chef.service.ts`, `server/services/location-booking-eligibility.ts` (and any `location-booking-eligibility*`)

Observed facts in this snapshot that could change: `kitchen-visit-lifecycle.ts` currently keys visits via `savedClockForVisit` (`server/services/kitchen-visit-lifecycle.ts:39-45`) and `visit-assistance.ts` still compares by `updatedAt` (`server/services/visit-assistance.ts:45,52`); the Oct14 steering ("key visits by visit id or date, not start/end") may alter these. `migrations/0073_clock_closeout_due_indexes.sql` exists and is **not applied** (`PHASE0_LOG.md:123`).

Facts confirmed absent in this snapshot (re-check after the builds): there is **no** `visit_code`, `visitCode`, `self_checkin`, `selfCheckin`, `checkinMode` or `arrival_mode` symbol anywhere in `server/`, `shared/` or `client/src/` (grep over `--include=*.ts --include=*.tsx` returned zero rows).

---

## A. The canonical arrival target per booking

### A.1 The problem, with evidence

`ensureKitchenBookingVisits` is the only creator of `kitchen_booking_visits` rows, and it deliberately returns **no rows** for a booking with fewer than two blocks:

- `server/services/kitchen-booking-visits.ts:29-30` — `const blocks = bookingVisitBlocks(orderedSlots); if (blocks.length < 2) return [];`
- Header comment `server/services/kitchen-booking-visits.ts:7` — "Legacy and contiguous bookings keep the existing single-visit lifecycle."

So today, **single/contiguous bookings have no `kitchen_booking_visits` row**; only split (non-consecutive multi-block) bookings do. Confirmed by every call site, which creates visits lazily at action time, never at confirmation:

- `server/routes/bookings.ts:2314-2315` (chef check-in), `:2360-2361` (chef checkout)
- `server/routes/manager.ts:8087-8088` (manager clear), `:8145-8146` (manager claim)

The clock-closeout service only *projects* visits; it does not insert visit rows (`server/services/clock-closeout.ts` exports are `projectBookingCloseout`, `projectBookingCloseouts`, `inspectionContext`, `recordKitchenInspection`, `persistBookingCloseout`, `sweepClockCloseout`; no `insert(kitchenBookingVisits)`), so it does not change this.

This matches the proposal's own warning: "Most ordinary/contiguous bookings have **no** `kitchen_booking_visits` row … A code design only adding columns to that table would omit ordinary bookings." (`visit-code-checkpoint-proposal.md:31`).

### A.2 Recommendation

**One additive challenge table keyed to a single canonical target**, resolved by one shared function, not by duplicating credential columns across `kitchen_bookings` and `kitchen_booking_visits`.

- Define `resolveArrivalTarget(bookingId)` → `{ targetKey, bookingId, visitId?, blockIndex }` where:
  - split booking (visit rows exist) → `targetKey = 'visit:<visitId>'`, `visitId` set, `blockIndex = visit.blockIndex`;
  - single/contiguous (no visit rows) → `targetKey = 'booking:<bookingId>:block:0'`, `visitId = null`, `blockIndex = 0`.
- The resolver reads visit rows with the non-initializing reader `readKitchenBookingVisits` (`server/services/kitchen-booking-visits.ts:40-43`) so a **read never creates** rows (the file explicitly documents "HTTP reads must never initialize visit rows" at `:39`).
- The challenge row stores both `booking_id` and the nullable `visit_id` plus the normalized `target_key` (unique partial index, see §G). This is the same model the multi-day doc requires: "resolve its target as 'visit row when one exists, else the booking'" (`design-multiday-invites-extension.md:149`).

### A.3 Where to resolve it (exact insertion points)

- A new `server/services/visit-code-challenge.ts` owns the resolver and all challenge reads/writes. It is the **single** place that maps target → challenge row.
- Callers pass `(bookingId, visitId?)` they already have: the chef routes already receive/validate `visitId` (`server/routes/bookings.ts:2317-2320`, `:2363-2366`), the manager assist/clear/claim routes already receive/validate `visitId` (`server/routes/manager.ts:8090-8092`, `:8148-8150`), and `assistKitchenVisit` already resolves `visit` from `input.visitId` (`server/services/visit-assistance.ts:47-51`). Each caller hands its resolved target to the challenge service rather than re-deriving it.

---

## B. Every server path that records arrival, and where the code check must be inserted

There are four arrival writers. All four must (a) validate the code against the live challenge, (b) increment the failed-attempt counter on failure **without** recording arrival, and (c) on success consume the challenge and record arrival in **one** transaction.

### B.1 Chef self check-in — split visit (visit-level)

Path: `POST /api/chef/bookings/:id/checkin` → `checkinKitchenVisit`.

- Route: `server/routes/bookings.ts:2304-2347`. Ownership check `:2310-2313`; visits ensured `:2314-2315`; `visitId` validated `:2317-2320`; delegate `:2321-2324`.
- Service: `server/services/kitchen-visit-lifecycle.ts:75-104`. Pre-transaction validation: ownership `:80`, status `:82`, visit status `:83`, **time window** `:86-90`, **duties/photos** `:91-92`.
- Atomic write: `updateConfirmedVisit` `server/services/kitchen-visit-lifecycle.ts:54-73`:
  - `SELECT … FOR UPDATE` on `kitchen_bookings` `:56`;
  - parent-status + **CAS on `booking.updatedAt`** `:57-58`;
  - duty re-validation `:59-60`;
  - **CAS on visit `checkinStatus`** `:61` (`eq(kitchenBookingVisits.checkinStatus, expectedStatus)`);
  - **outbox event** `queueBookingLifecycleEvent(...'checkin_recorded'...)` `:63-65`;
  - duties snapshot `:62`.

**Insertion point:** the code check belongs between `:90` (window) and `:91` (duties) for the *decision*, but the **counter/consumption commit must be inside `updateConfirmedVisit`'s transaction** (before `:61`), because that is where the row is locked and the CAS happens. Pass the resolved target + submitted code into `updateConfirmedVisit` (or a thin wrapper) so the challenge consumption and the visit CAS share one transaction.

### B.2 Chef self check-in — single/contiguous (legacy booking-level)

Path: same route, no visit rows → `requestKitchenCheckin`.

- Route: `server/routes/bookings.ts:2326-2335` (imports + call).
- Service: `server/services/kitchen-checkout-service.ts:302-433`. Pre-transaction validation: ownership `:336`, status `:340`, status guards `:344-348`, **window** `:361-375`, **duties** `:378-381`.
- Atomic write: transaction `:386-413`:
  - `SELECT … FOR UPDATE` on `kitchen_bookings` `:387`;
  - duty re-validation `:388`;
  - update `WHERE id = ? AND updatedAt = ? AND status = 'confirmed' AND checkinStatus IN ('not_checked_in', NULL)` `:401-407` (CAS on `updatedAt` + status + checkin status);
  - duties snapshot `:408`; **outbox** `queueBookingLifecycleEvent(...'checkin_recorded'...)` `:409-411`.

**Insertion point:** the code check decision at `:378-381`; consumption + attempt counter inside the transaction `:386-413`.

### B.3 Manager assisted arrival (both target shapes)

Path: `POST /api/manager/bookings/:id/assist-visit` → `assistKitchenVisit`.

- Route: `server/routes/manager.ts:8050-8059`.
- Service: `server/services/visit-assistance.ts:35-78`. Transaction `:36-75`:
  - `SELECT … FOR UPDATE` on `kitchen_bookings` `:37`;
  - ownership `:41`; status `:44`; **CAS on `expectedBookingUpdatedAt`** `:45-46`;
  - resolve visit from `input.visitId` `:47-49`, `SELECT … FOR UPDATE` on the visit `:50`;
  - **CAS on `expectedUpdatedAt`** of the chosen record `:52`;
  - state guards `:53-57`;
  - writes to visit `:70` or booking `:71`;
  - **outbox** `queueBookingLifecycleEvent(...'visit_assisted'...)` `:72-74`.

**Insertion point:** assisted arrival is a *manager statement* (`:34` "never chef submission"). The code check should be a **separate, explicit field** (manager asserts the code was shown/entered) or omitted for assisted arrival per the design ("manager absence leads to contact/support and an explicit self-service or assisted-arrival action, never an automatic bypass", `visit-code-checkpoint-proposal.md:21`). If required, validate + consume inside the transaction at `:36-75`, alongside the `expectedUpdatedAt` CAS.

### B.4 Split-visit manager clear / claim (departure side; no code)

- Clear: `POST /manager/bookings/:id/clear-kitchen-checkout` `server/routes/manager.ts:8070-8111` → `clearKitchenVisit` (`server/services/kitchen-visit-lifecycle.ts:137-139`) → `recordKitchenInspection` (`server/services/clock-closeout.ts:71-95`).
- Claim: `POST /manager/bookings/:id/kitchen-checkout-claim` `server/routes/manager.ts:8121-8178` → `claimKitchenVisit` (`server/services/kitchen-visit-lifecycle.ts:141-228`).

Per the proposal, checkout "uses the existing departure flow without repeating the arrival code" (`visit-code-checkpoint-proposal.md:19`), so **no code check on any departure path**.

### B.5 Chef checkout (departure side; no code) — for completeness

- Route: `server/routes/bookings.ts:2350-2392`; service `checkoutKitchenVisit` `server/services/kitchen-visit-lifecycle.ts:106-135`; legacy `requestKitchenCheckout` `server/services/kitchen-checkout-service.ts:451-547` (atomic tx `:509-537`, outbox `:532-534`).

### B.6 Replay semantics

- The challenge row carries `consumed_request_id` (§G). On success, the recording transaction writes `consumed_request_id = <requestKey>` and `consumed_at` atomically with the arrival CAS.
- Replay rule (from `visit-code-checkpoint-proposal.md:35`): a retry with the **same** `consumed_request_id` returns the original permitted success and must **not** overwrite evidence or accept a different actor/payload; a different request against an already-consumed challenge is rejected. The existing patterns to mirror: the idempotency-by-unique-key comment in `claimKitchenVisit` ("A previous request may have created the claim before its visit update committed. Reuse that claim so a retry cannot charge or notify twice", `server/services/kitchen-visit-lifecycle.ts:161-165`) and the CAS `updatedAt` guards above.
- Wrong/rotated/exhausted attempts: increment `failed_attempts` and **commit** (proposal `:33-35`), never recording arrival. At `max_attempts` (5) the challenge is locked and only a manager **rotation** (`revision + 1`, new hash) re-enables it (`PHASE0_LOG.md:80`).

---

## C. Manager surfaces where the code and the mode belong, and the endpoints needed

### C.1 Surfaces (file:line)

| Surface | Where it is | Current relevant content |
| --- | --- | --- |
| Shared booking detail (manager + chef) | `client/src/pages/BookingDetailsPage.tsx` | Manager fetch `:255-257`; attendance panel mount `:1295-1296`; multi-visit list `:1331-1367`; single-visit check-in/out block `:1370-1430`; "Message kitchen/chef" `:1703`; support contact `:1926-1927` |
| Manager inspection page | `client/src/pages/ManagerInspectionPage.tsx` (route `client/src/App.tsx:390`) | Details read `:38-44`; clear call `:192`; `VisitAssistancePanel` mount `:235`; claim unavailable note `:241` |
| Today board component (declared, **not mounted**) | `client/src/components/manager/TodaysKitchenBookings.tsx:149` | `GET /api/manager/bookings/upcoming` every 15 s `:188-201`; only reference elsewhere is a comment at `client/src/components/manager/bookings/columns.tsx:124` |
| Visit assistance panel | `client/src/components/booking/VisitAssistancePanel.tsx:9-67` | Submit `:25-40`; posts to `/api/manager/bookings/:id/assist-visit` `:31-34` |
| Attendance panel (correction/assist entry) | `client/src/components/booking/BookingAttendancePanel.tsx:67-93` | "Manage visit" dialog hosts `VisitAssistancePanel` `:78` |

**Where the code + mode UI belongs:** the visit card in the shared booking detail (`BookingDetailsPage.tsx:1331-1367` for split visits, `:1370-1430` for single) and the inspection page (`ManagerInspectionPage.tsx:204-241`), reusing the existing `VisitAssistancePanel` dialog (`BookingAttendancePanel.tsx:67-93`). The proposal names exactly these: "Place the code/mode in the existing owned booking detail and correct visit card … Show customer, kitchen and local visit time next to the code." (`visit-code-checkpoint-proposal.md:25`).

`TodaysKitchenBookings` is currently **dead code** (only its declaration and a comment, per grep). It is the natural home for the "In session · N min left" row (design `design-checkin-checkout.md:49,128`) but must be mounted first (design PR-4 `:163`).

### C.2 Endpoints needed (add near the existing manager visit routes)

Add to `server/routes/manager.ts` next to the assist/clear/claim handlers (`:8050-8178`):

1. `POST /api/manager/bookings/:id/visits/:visitId?/issue-code` — issue/rotate. Body `{ mode: 'staffed'|'self', reason? }`. Manager-ownership check via the pattern at `:8085-8086` (`verifyManagerPermission`) or `:41` (`context.managerId`); returns the plaintext code **once** to the authenticated owner (never in a list, email, log or participant API — proposal `:27,40`).
2. `POST /api/manager/bookings/:id/self-checkin` — enable/disable self check-in. Body `{ enabled: boolean, allVisits?: boolean, reason? }`. "for all visits" iterates the booking's visit targets in one transaction and writes one challenge per day target (multi-day rule `design-multiday-invites-extension.md:146`).
3. Readback: extend the manager detail response (`server/routes/manager.ts:4315-4640`; visits attached `:4612-4624`) and the chef status response (`server/routes/bookings.ts:2395-2472`; visits `:2442-2443`, derived `:2455`) with the current `mode` and a **redacted** challenge summary (status/revision/attempts-left; **never** the hash or plaintext after consumption — proposal `:25,35`).

Revocation is event-driven, not a separate endpoint: revoke on cancel, reschedule and closure (proposal `:35`; `PHASE0_LOG.md:80`). Hook it where those transitions already run (booking cancel path in `server/routes/bookings.ts` around `:2293`; the closeout sweep `server/services/clock-closeout.ts:130`).

---

## D. Chef surfaces: arrival page, in-session screen, messaging, report/support, reminders

### D.1 Arrival page

- Route registration: `client/src/App.tsx:285-286` (`/booking/:id/visit` → `KitchenVisitPage`).
- Page: `client/src/pages/KitchenVisitPage.tsx:14-53`; renders `KitchenCheckinTracker` `:47-50`; reads `?visitId` `:20`.
- Tracker: `client/src/components/booking/KitchenCheckinTracker.tsx:101-595`. Arrival form (checklist + photos + notes + submit) `:476-523`; departure form `:525-579`; status chip/next-step `:307-315`; multi-visit chooser `:429-444`.
- Data hook: `client/src/hooks/use-kitchen-checkin.ts:105-281`. Status query `:109-139`; check-in mutation posts `visitId` `:142-172` (body `:155`); checkout mutation `:175-205`; window helpers `canCheckin` `:222-249`, `canCheckout` `:251-261`.

**Where the code field goes:** a single numeric field in the arrival section (`KitchenCheckinTracker.tsx:476-523`), submitted with the existing `checkin()` payload (`use-kitchen-checkin.ts:147-157`), shown only when the resolved mode is `staffed` (proposal `:17`).

### D.2 In-session screen (after check-in)

- Location: a new section rendered when `checkinStatus === 'checked_in'` and the visit is live, in `KitchenCheckinTracker.tsx` (state derived at `:293-297`, `liveBooking`/`visitFinished`). The countdown uses the saved scheduled end already returned by the status projection: `client/src/hooks/use-kitchen-checkin.ts:19-27` (`closeout`, `visitCloseout`) populated server-side from `projectBookingCloseout` (`server/routes/bookings.ts:2455`).
- Phase model already exists for the time-aware primary button: `shared/clock-closeout.ts:5` (`upcoming | arrival_window | in_booked_time | booked_time_ended | ended`) and `:134` (visit phase from saved instants). Map the spec's three states to these phases: "Need more time?" = `in_booked_time` early; "Start check-out" = last 15 min before `scheduledEndAt`; "Your booked time ended" = `booked_time_ended`/`ended`.
- Countdown must be **client-side, no polling** (spec `PHASE0_LOG.md:85`); refresh on window focus. The existing hook already sets `refetchOnWindowFocus: true` and backs off (`use-kitchen-checkin.ts:126-138`).

### D.3 Existing messaging entry point ("Message kitchen")

- Button: `client/src/pages/BookingDetailsPage.tsx:1703` → `openBookingConversation` `:204-215`.
- Server: `POST /api/bookings/:id/conversation` `server/routes/bookings.ts:76-101`; resolves/creates the participant conversation via `initializeConversation` (`:91-92`) and returns a dashboard `path` (`:95-96`).
- Reuse for the in-session "message the kitchen" and for the interim "Need more time?" action (spec `PHASE0_LOG.md:86`).

### D.4 Report a problem / get help

- Existing generic problem channel: `commitment_problems` table (`shared/schema.ts:2455-2472`; fields `kind`, `owner`, `status`, `revision`, `history`) and route `server/routes/commitment-problems.ts:11-44` (`GET /`, `GET /:kind/:id`, `POST /:kind/:id`, `PATCH /:id`).
- Support contact surface: `client/src/pages/BookingDetailsPage.tsx:1926-1927` (`bdContactSupport`).
- **Gap:** there is **no** incident/safety table (grep of `pgTable(` in `shared/schema.ts` for `incident|report|ticket|case` returns only `commitment_problems`). The spec's "report a problem (safety, access, equipment, cleanliness)" needs either a new category on `commitment_problems` (`kind`/`description`) or a new incident table; the design explicitly wants a separate case ("issue creates a separate case", `design-checkin-checkout.md:82,93`). Flag as an open question (§H).

### D.5 15-minute pre-end alert — existing reminder infrastructure

- Reminder engine: `server/services/advance-reminders.ts`. Kinds enumerated `:24` (`preparation | arrival | departure | deadline | checkin_open`). `visitReminders` builds them `:86-104`; the **departure** kind is computed as `end - departureReminderMinutes` `:93,98`; reminder idempotency key `reminderKey` `:54-55`.
- Scheduler: `scheduleAdvanceReminders` `server/services/advance-reminders.ts:229`; delivery `dispatchAdvanceReminders` `:354`.
- Worker wiring: `server/services/recurring-worker.ts:114-137`; delivery task `advance` `:131`; the closeout sweep task `clockCloseout` `:124`.
- Defaults: `departureReminderMinutes` = **30** (`server/services/lifecycle-settings.ts:18`), `serviceEndGraceMinutes` = **15** (`:6`), `inspectionAutoCloseHours` = **24** (`:7`).
- **Implication:** the "alert 15 min before the end" is a `departure`-style reminder. Either set `departure_reminder_minutes = 15` (admin-configurable, no code) or add a distinct `in_session_ending` kind in `advance-reminders.ts:24,86-104` so it does not collide with the existing departure-obligations reminder. In-app channel is `checkin_open`-style: email-only reminders are skipped for that kind at `:248` — mirror this to guarantee an in-app notification as well as email.

---

## E. Env / config: how server secrets are loaded, and the crypto helpers to reuse

### E.1 Secret loading

- `.env` is loaded by `import 'dotenv/config'` at `server/index.ts:3` and again in `server/instrument.ts:13` (with a comment that it runs before `index.ts`). `server/r2-storage.ts:12` documents the "read lazily so dotenv has loaded" pattern.
- Existing server-secret reads to copy: `process.env.CRON_SECRET` (`server/lifecycle-inngest.ts:98`, compared with `timingSafeEqual` `:99-100`; also `server/routes/bookings.ts:710,733`), `process.env.INNGEST_SIGNING_KEY` (`server/lifecycle-inngest.ts:87`), `process.env.ALWAYS_FOOD_SAFE_API_KEY` (`server/alwaysFoodSafeAPI.ts:38`).
- Vercel: no code-level env schema for server secrets exists (`env.d.ts` only declares `VITE_FIREBASE_API_KEY`, `env.d.ts:5`); secrets are provided as platform env vars. Per `HANDOVER-2026-10-14.md:72` and `PHASE0_LOG.md:59`, the new `VISIT_CODE_HMAC_SECRET` (name illustrative) is **local first**, and setting it on Vercel requires **asking the owner first**.

### E.2 Crypto / HMAC helpers

- No HMAC helper exists. Existing `node:crypto` usages to model on:
  - `server/reference-code.ts:1,28` — `crypto.randomBytes` for random reference codes (the pattern for the 6-digit generation seed).
  - `server/email-verification.ts:1,44` — `createHash('sha256')` (the shape to replace with `createHmac('sha256', secret)`).
  - `server/lifecycle-inngest.ts:2,100` — `timingSafeEqual` for constant-time comparison (use this to compare the candidate hash, never `===`).
- Recommended: `createHmac('sha256', process.env.VISIT_CODE_HMAC_SECRET).update(`${targetKey}:${revision}:${code}`).digest('hex')` stored as `code_hash`; compare with `timingSafeEqual` on equal-length hex buffers. The proposal explicitly requires "a keyed derivation of a six-digit code avoids stored plaintext and unkeyed low-entropy hashes" (`visit-code-checkpoint-proposal.md:33`).

---

## F. Notifications / emails touched, and the i18n keys needed

### F.1 Existing notification/email plumbing

- Durable outbox: `queueBookingLifecycleEvent` `server/services/booking-lifecycle-delivery.ts:28-131`; the outbox row is inserted at `:111`; delivery `deliverBookingLifecycleEvents` `:142`. It already imports `sendEmail` (`:6`) and `notificationService` (`:5`).
- In-app notification: `notificationService.create(...)` `server/services/booking-lifecycle-delivery.ts:97-99` (with `actionUrl`/`actionLabel`).
- Email: `:100-109`; outbound translation helper `tEmail` (`server/i18n/outbound.ts`, imported at `server/email.ts:12`).
- Worker delivery tasks: `advance` and `booking` in `server/services/recurring-worker.ts:131-132`.

### F.2 Events that will touch notifications

1. **Code issued / rotated** → manager-facing in-app notice (do **not** email the code — proposal `:27,40`).
2. **Self check-in enabled/disabled** → customer in-app notice (proposal `:34`).
3. **Arrival recorded** → existing `checkin_recorded` outbox event (`server/services/kitchen-visit-lifecycle.ts:63-65`; legacy `server/services/kitchen-checkout-service.ts:409-411`) — add the method (`self`/`staffed`) to the message metadata.
4. **15-min pre-end alert** → new/`departure` reminder, in-app + email (§D.5).
5. **Challenge locked after 5 failures** → manager in-app notice (proposal `:33`).

### F.3 i18n keys (locales `shared/i18n/locales/{en-CA,fr-CA,uk}/`)

Namespaces already present in all three locales: `chef.json`, `email.json` (each currently 64 keys; `grep -c ":" email.json` = 64 in all three). The chef namespace already carries 117 `kci*` keys (`grep -c '"kci' en-CA/chef.json` = 117), including two legacy access-code strings to reuse or replace: `kciAccessCodeWhenWindowOpens` (`en-CA/chef.json:1033`) and `kciContactManagerForAccessCode` (`:1052`).

Proposed new keys (add to `chef.json` and `email.json` in all three locales):

- `chef.json`: `kciVisitCodeLabel`, `kciVisitCodePlaceholder`, `kciVisitCodeWrong`, `kciVisitCodeLocked`, `kciSelfCheckinBadge`, `kciInSessionTitle`, `kciInSessionEndsAt`, `kciNeedMoreTime`, `kciStartCheckout`, `kciBookedTimeEnded`, `kciLeaveEarlyNoRefund`, `kciReportProblem`, `kciGetHelp`, `kciDeparturePreview`, `kciBookedEquipment`, `kciBookedStorage`.
- `email.json`: `visitCodeIssuedTitle/Body` (manager, no code in body), `selfCheckinEnabledTitle/Body`, `inSessionEndingTitle/Body` (the 15-min alert), `visitCodeLockedTitle/Body`.

The email namespace is delivered through `tEmail` (`server/i18n/outbound.ts`), so the reminder/notice builders in `advance-reminders.ts` and `booking-lifecycle-delivery.ts` should reference these keys rather than hardcoding English.

---

## G. Proposed migration SQL, ordered implementation plan, work packages, tests

### G.1 Migration SQL (written here only — do **not** create the file or apply)

Next free migration number is `0074` (`migrations/` ends at `0073_clock_closeout_due_indexes.sql`; note `0074/0075` are drafted for multi-day in `design-multiday-invites-extension.md:81`, so the owner should reserve a distinct number, e.g. `0076`, to avoid collision). Additive only; owner approval required before apply (`HANDOVER-2026-10-14.md:31`).

```sql
-- Proposed. Additive. DO NOT APPLY without owner approval.
CREATE TABLE IF NOT EXISTS kitchen_visit_arrival_challenges (
  id                  serial PRIMARY KEY,
  booking_id          integer NOT NULL REFERENCES kitchen_bookings(id) ON DELETE CASCADE,
  visit_id            integer REFERENCES kitchen_booking_visits(id) ON DELETE CASCADE,
  block_index         integer,
  -- Canonical target key: 'visit:<visitId>' when a visit row exists,
  -- else 'booking:<bookingId>:block:<n>' for single/contiguous bookings.
  target_key          text NOT NULL,
  mode                text NOT NULL,                 -- 'staffed' | 'self'
  revision            integer NOT NULL DEFAULT 1,
  code_hash           text NOT NULL,                 -- HMAC-SHA256 hex; never plaintext
  failed_attempts     integer NOT NULL DEFAULT 0,
  max_attempts        integer NOT NULL DEFAULT 5,
  consumed_request_id text,                          -- replay/idempotency key of accepted arrival
  consumed_at         timestamp,
  issued_by           integer REFERENCES users(id) ON DELETE SET NULL,
  issued_at           timestamp NOT NULL DEFAULT now(),
  shared_by           integer REFERENCES users(id) ON DELETE SET NULL,
  shared_at           timestamp,
  revoked_at          timestamp,
  revoked_reason      text,
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now()
);

-- At most one live challenge per target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_visit_challenge_live
  ON kitchen_visit_arrival_challenges (target_key) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_visit_challenge_booking
  ON kitchen_visit_arrival_challenges (booking_id, revoked_at);
```

(Consider also a `CHECK (mode IN ('staffed','self'))` and `CHECK (failed_attempts <= max_attempts)` if the team prefers DB-enforced invariants.)

### G.2 Ordered implementation plan

1. **Migration + secret (owner gate).** Write `migrations/00NN_kitchen_visit_arrival_challenges.sql`; add `VISIT_CODE_HMAC_SECRET` locally only; ask before Vercel (`PHASE0_LOG.md:59`).
2. **Challenge core** (new `server/services/visit-code-challenge.ts` + `shared/visit-code.ts`): target resolver (§A.2), 6-digit generation, HMAC hash, verify, attempt increment, consume/replay, issue/rotate, enable/disable mode, revoke. Unit tests first.
3. **Server wiring** into the four arrival paths (§B) and the new manager endpoints (§C.2); extend the manager detail and chef status read models (§C.2).
4. **Chef client**: code field in the arrival section; in-session screen keyed off the existing `closeout`/`visitCloseout` projection (§D.1–D.2).
5. **Manager client**: code/mode card in the shared detail and inspection page; mount/mirror the Today row (§C.1).
6. **Reminders/notifications**: 15-min pre-end alert and the new event notices (§D.5, §F).
7. **i18n** across `en-CA`, `fr-CA`, `uk` (§F.3).
8. **Live local walkthrough** (both roles, both modes, failure/retry) then log the checkpoint (`HANDOVER-2026-10-14.md:102`).

### G.3 Work packages (2–3 non-overlapping, for parallel agents)

Sequencing note: **WP-B and WP-C touch files currently being edited by the closeout/access agents** (see §0) and must start only after those builds land.

- **WP-A — Challenge core (no shared-file edits).**
  Files: `migrations/00NN_*.sql` (draft), `server/services/visit-code-challenge.ts` (new), `shared/visit-code.ts` (new), `env.d.ts` (new secret declaration), `server/services/visit-code-challenge.test.ts` (new). Owns: resolver, HMAC, generation, verify/attempt/consume/rotate/revoke, mode toggle. No edits to existing routes/services.
- **WP-B — Server wiring + manager endpoints + reminders.**
  Files: `server/routes/bookings.ts` (targeted edits only), `server/routes/manager.ts` (targeted), `server/services/kitchen-visit-lifecycle.ts`, `server/services/kitchen-checkout-service.ts`, `server/services/visit-assistance.ts`, `server/services/advance-reminders.ts`, `server/services/booking-lifecycle-delivery.ts`, plus integration tests. Owns every server response shape. Does not touch client or locale JSON.
- **WP-C — Chef + manager client + i18n.**
  Files: `client/src/pages/KitchenVisitPage.tsx`, `client/src/components/booking/KitchenCheckinTracker.tsx`, `client/src/hooks/use-kitchen-checkin.ts`, `client/src/pages/BookingDetailsPage.tsx`, `client/src/pages/ManagerInspectionPage.tsx`, `client/src/components/booking/VisitAssistancePanel.tsx`, `client/src/components/manager/TodaysKitchenBookings.tsx`, `shared/i18n/locales/{en-CA,fr-CA,uk}/{chef,email}.json`, plus component tests. Consumes the WP-B response shape; does not touch server files.

### G.4 Tests to write

- **Challenge core (WP-A):** correct code accepted once; wrong code increments and never records arrival; 5 failures locks and requires rotation; rotated revision invalidates the old code; a day-1 code never authorizes day-2 (multi-day); HMAC never stores plaintext; constant-time compare.
- **Target resolution:** single/contiguous booking resolves to `booking:<id>:block:0` and creates **no** visit row (assert `readKitchenBookingVisits` returns `[]`, `server/services/kitchen-booking-visits.ts:30`); split booking resolves to its visit id; another visit's code cannot authorize this one (proposal checkpoint 3, `visit-code-checkpoint-proposal.md:43`).
- **Replay/race (WP-B):** concurrent duplicate arrivals produce one arrival + one outbox event; lost-response retry with the same `consumed_request_id` returns the original success without replacing evidence; a different actor/payload is rejected (proposal `:35,43`).
- **Revocation:** cancel, reschedule and closure revoke remaining challenges; a stale action POST returns `409` (edge-case contract `design-checkin-checkout.md:113`).
- **No money movement:** no code path touches capture/transfer/deadline (proposal checkpoint 5, `:45`).
- **Client (WP-C):** code field only in staffed mode; in-session countdown uses the saved end and the correct phase for the primary button; 15-min alert shows in-app; a11y (labels, focus to first error, mobile).
- **Regression:** the existing chef arrival tests must still pass; compare against the baseline (server 7 receipt failures; client 0) per `HANDOVER-2026-10-14.md:102`.

---

## H. Risks and open questions

1. **In-flux files.** `kitchen-visit-lifecycle.ts`, `kitchen-checkout-service.ts`, `KitchenCheckinTracker.tsx`, `BookingDetailsPage.tsx`, `use-kitchen-checkin.ts` (and the clock-closeout/access files) are being edited now (§0). All insertion points in §B/§D must be re-verified after those builds land. `kitchen-visit-lifecycle.ts:39-45` and `visit-assistance.ts:45,52` currently key/match visits by saved clock and `updatedAt`; the Oct14 steering may change this.
2. **Migration number collision.** `0074/0075` are drafted for multi-day (`design-multiday-invites-extension.md:81`); the visit-code migration needs a reserved number (owner decision).
3. **No incident/report table.** "Report a problem (safety, access, equipment, cleanliness)" has no dedicated store today (only `commitment_problems`, `shared/schema.ts:2455-2472`). Decide: new category vs. new incident table (design wants a separate case, `design-checkin-checkout.md:82,93`).
4. **Assisted arrival + code.** Should assisted arrival require a code at all, or record a manager assertion (proposal `:21` says never an automatic bypass)? This changes §B.3.
5. **"Need more time?" interim behavior.** Until extensions ship, it "opens a message to the kitchen" (`PHASE0_LOG.md:86`); confirm it reuses `POST /api/bookings/:id/conversation` (`server/routes/bookings.ts:76-101`) with a prefilled topic.
6. **15-min alert mechanism.** Reuse the existing `departure` reminder (default 30 min, `lifecycle-settings.ts:18`) or add a new kind? Reusing changes the departure-obligations reminder timing for everyone; a new kind avoids that but adds a reminder kind.
7. **Today board mounting.** `TodaysKitchenBookings` is dead code (§C.1); the "In session · N min left" row requires mounting it or its successor (design PR-4, `design-checkin-checkout.md:163`).
8. **Manager secret on Vercel.** `VISIT_CODE_HMAC_SECRET` is local-first; setting it on Vercel needs explicit owner approval (`PHASE0_LOG.md:59`), and a rotation strategy for the key itself is still undefined (proposal `:33`).
9. **Multi-day code count.** One code per day vs. one code for the whole range is still an owner question (`design-multiday-invites-extension.md:150`, F4); the schema above supports both (per-day target rows), but the enable-all action must pick one.
10. **Redaction of codes.** The proposal forbids codes in broad lists, emails, logs and participant APIs (`visit-code-checkpoint-proposal.md:27,40`); the manager detail and chef status responses must return only a redacted summary after issuance, and after consumption show method/time only (proposal `:25`).
