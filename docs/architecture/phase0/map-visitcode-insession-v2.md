# Map v2: visit code + in-session screen (Phase 0, build step 2) — corrected

Read-only re-verification of `docs/architecture/phase0/map-visitcode-insession.md` against the current tree. No source was edited; no migration was written; no database or external service was touched. This document is the only file written.

Method: every code reference in v1 was opened/grepped at HEAD. Status values: **ok** (line/content unchanged), **moved** (symbol still exists, line differs — new line given), **gone** (symbol/line no longer exists or now holds different content). Doc citations (proposal/log/design) were spot-checked and are called out separately because they are the most volatile.

## 0. Headline corrections

- **`server/routes/bookings.ts` shifted +1** from ~line 77 onward (one line inserted near the top). All v1 refs ≥ ~77 are off by exactly one; the chef check-in/checkout/status routes are now **2305/2351/2396** (v1: 2304/2350/2395).
- **`client/src/pages/BookingDetailsPage.tsx` shifted +13** from ~line 1295 onward (insertions between line 258 and 1295). Attendance mount is now **1308**, multi-visit list **1344-1380**, single-visit block starts **1383**, "Message kitchen/chef" **1716**, support **1939-1940**.
- **`server/routes/manager.ts` is unchanged** — all manager visit/detail refs still match.
- **`server/services/kitchen-visit-lifecycle.ts`, `kitchen-checkout-service.ts`, `visit-assistance.ts`, `advance-reminders.ts`, `lifecycle-settings.ts`, `kitchen-booking-visits.ts` are unchanged** — all their v1 refs match.
- **Three "new" client components moved directories**: `RevokeLocationAccessDialog.tsx` and `DocumentRenewalReview.tsx` → `client/src/components/manager/applications/components/`; `RenewAccessDocuments.tsx` → `client/src/components/chef/applications/`. v1 listed them under `client/src/components/booking/` (gone there).
- **`server/services/chef.service.ts` (v1 §0) does not exist** — it is `server/domains/users/chef.service.ts`.
- **Next free migration is `0075`**, not `0074`. `migrations/0074_document_renewal_slot.sql` now exists (applied per task); `0073_clock_closeout_due_indexes.sql` still exists and is unapplied. v1 §G.1 ("next free is 0074") and §H.2 ("0074/0075 drafted for multi-day") are stale.
- **PHASE0_LOG line citations are all stale.** The log has been rewritten/appended; v1's `PHASE0_LOG.md:59/80/85/86/123` no longer hold the cited content. Cite PHASE0_LOG by section heading, not line.
- Feature symbols still absent: `visit_code|visitCode|self_checkin|selfCheckin|checkinMode|arrival_mode|arrivalMode|kitchen_visit_arrival_challenges|VISIT_CODE_HMAC` → grep over `server/ shared/ client/src/` returns **zero rows**. v1 §0 fact still true.

---

## 1. Reference status table

### §0 — "in flux" file list

| v1 reference | Status |
| --- | --- |
| `server/services/clock-closeout.ts` | ok (exists, 165 lines) |
| `shared/clock-closeout.ts` | ok (exists, 158 lines) |
| `shared/booking-attendance.ts` | ok (exists, 59 lines) |
| `server/services/kitchen-visit-lifecycle.ts` | ok (exists, 294 lines) |
| `server/services/kitchen-checkout-service.ts` | ok (exists, 798 lines) |
| `client/src/components/booking/KitchenCheckinTracker.tsx` | ok (exists, 627 lines) |
| `client/src/pages/BookingDetailsPage.tsx` | ok (exists, 2022 lines; internals shifted +13) |
| `client/src/hooks/use-kitchen-checkin.ts` | ok (exists, 281 lines) |
| `server/domains/bookings/booking.service.ts` | ok |
| `server/services/chef.service.ts` | **gone** → `server/domains/users/chef.service.ts` |
| `server/services/location-booking-eligibility.ts` | ok (17 lines) |
| `kitchen-visit-lifecycle.ts:39-45` (`savedClockForVisit`) | **moved** → `savedClockForVisit` at `:40` inside `visitWindow` `:38-46` |
| `visit-assistance.ts:45,52` (compares by `updatedAt`) | ok (`:45`, `:52`) |
| `migrations/0073...` not applied, cited `PHASE0_LOG.md:123` | 0073 exists/unapplied ok; **PHASE0_LOG:123 stale** (now "One visit code per day…") |

### §A — canonical arrival target

| v1 reference | Status |
| --- | --- |
| `kitchen-booking-visits.ts:29-30` (`blocks.length < 2 → return []`) | ok |
| `kitchen-booking-visits.ts:7` (header comment) | ok |
| `kitchen-booking-visits.ts:39` ("HTTP reads must never initialize") | ok |
| `kitchen-booking-visits.ts:40-43` (`readKitchenBookingVisits`) | ok |
| `bookings.ts:2314-2315` (chef check-in ensure visits) | **moved** → `2315-2316` |
| `bookings.ts:2360-2361` (chef checkout ensure visits) | **moved** → `2361-2362` |
| `manager.ts:8087-8088` (manager clear ensure visits) | ok |
| `manager.ts:8145-8146` (manager claim ensure visits) | ok |
| `clock-closeout.ts` exports (`projectBookingCloseout`, `projectBookingCloseouts`, `inspectionContext`, `recordKitchenInspection`, `persistBookingCloseout`, `sweepClockCloseout`) | ok (also exports `closeoutTiming`) |
| `bookings.ts:2317-2320` / `:2363-2366` (visitId validated) | **moved** → `2318-2321` / `2364-2367` |
| `manager.ts:8090-8092` / `:8148-8150` (visitId validated) | ok |
| `visit-assistance.ts:47-51` (resolves visit from `input.visitId`) | ok |
| proposal `:31` (no visit row for contiguous) | ok |
| design-multiday `:149` (target = "visit row when one exists, else the booking") | ok |

### §B — arrival writers / insertion points

| v1 reference | Status |
| --- | --- |
| `bookings.ts:2304-2347` (check-in route) | **moved** → `2305-2348` |
| `bookings.ts:2310-2313` (ownership) | **moved** → `2311-2313` |
| `bookings.ts:2321-2324` (delegate `checkinKitchenVisit`) | **moved** → `2322-2325` |
| `bookings.ts:2326-2335` (`requestKitchenCheckin` import/call) | **moved** → import `2327`, call `2329-2336` |
| `kitchen-visit-lifecycle.ts:75-104` (`checkinKitchenVisit`) | ok |
| `…:80` ownership / `:82` status / `:83` visit status / `:86-90` window / `:91-92` duties | ok |
| `…:54-73` (`updateConfirmedVisit`) / `:56` lock / `:57-58` CAS parent / `:59-60` duty reval / `:61` CAS visit status / `:62` duties snapshot / `:63-65` outbox | ok |
| `kitchen-checkout-service.ts:302-433` (`requestKitchenCheckin`) / `:336` / `:340` / `:344-348` / `:361-375` / `:378-381` / `:386-413` / `:387` / `:388` / `:401-407` / `:408` / `:409-411` | ok (all) |
| `manager.ts:8050-8059` (assist route) | ok |
| `visit-assistance.ts:35-78` / `:36-75` / `:37` / `:41` / `:44` / `:45-46` / `:47-49` / `:50` / `:52` / `:53-57` / `:70` / `:71` / `:72-74` / `:34` | ok (all) |
| `manager.ts:8070-8111` (clear) / `:8121-8178` (claim) | ok |
| `kitchen-visit-lifecycle.ts:137-139` (`clearKitchenVisit`) / `:141-228` (`claimKitchenVisit`) | ok |
| `clock-closeout.ts:71-95` (`recordKitchenInspection`) | ok (fn `:71-93`) |
| `bookings.ts:2350-2392` (checkout route) | **moved** → `2351-2393` |
| `kitchen-visit-lifecycle.ts:106-135` (`checkoutKitchenVisit`) | ok |
| `kitchen-checkout-service.ts:451-547` (`requestKitchenCheckout`) / `:509-537` / `:532-534` | ok (all) |
| `kitchen-visit-lifecycle.ts:161-165` (idempotency comment) | ok |
| proposal `:35`, `:33-35`, `:43`, `:45` | ok |
| `PHASE0_LOG.md:80` (rotation) | **stale** (line 80 = "LIVE PASS") |

### §C — manager surfaces / endpoints

| v1 reference | Status |
| --- | --- |
| `BookingDetailsPage.tsx:255-257` (manager fetch endpoint) | ok (endpoint select `256-258`) |
| `BookingDetailsPage.tsx:1295-1296` (attendance mount) | **moved** → `1308-1309` |
| `BookingDetailsPage.tsx:1331-1367` (multi-visit list) | **moved** → `1344-1380` |
| `BookingDetailsPage.tsx:1370-1430` (single-visit block) | **moved** → starts `1383` (section `1386`+) |
| `BookingDetailsPage.tsx:1703` ("Message kitchen/chef") | **moved** → `1716` |
| `BookingDetailsPage.tsx:1926-1927` (support contact) | **moved** → `1939-1940` |
| `App.tsx:390` (ManagerInspectionPage route) | ok |
| `ManagerInspectionPage.tsx:38-44` (`readDetails`) | ok (`:38-46`) |
| `ManagerInspectionPage.tsx:192` (clear POST) | ok |
| `ManagerInspectionPage.tsx:235` (VisitAssistancePanel mount) | ok |
| `ManagerInspectionPage.tsx:241` (claim-unavailable note) | ok |
| `ManagerInspectionPage.tsx:204-241` (inspection section) | ok |
| `TodaysKitchenBookings.tsx:149` (declaration) | ok |
| `TodaysKitchenBookings.tsx:188-201` (upcoming fetch, 15 s) | ok (query `189`, fetch `192`, `refetchInterval:15000` `199`) |
| `columns.tsx:124` (only other reference) | ok |
| `VisitAssistancePanel.tsx:9-67` / `:25-40` submit / `:31-34` POST | ok (all) |
| `BookingAttendancePanel.tsx:67-93` / `:78` (hosts VisitAssistancePanel) | ok |
| `manager.ts:4315-4640` (manager detail response) | **moved** → route `4314-4658`, response starts `4617` |
| `manager.ts:4612-4624` (visits attached) | ok (read `4612`, attach `4624`) |
| `bookings.ts:2395-2472` (chef status) | **moved** → `2396-2473` |
| `bookings.ts:2442-2443` (visits) | **moved** → `2443-2444` |
| `bookings.ts:2455` (derived projection) | **moved** → `2456` |
| `manager.ts:8085-8086` (`verifyManagerPermission` pattern) | ok |
| `manager.ts:41` (`context.managerId`) | **gone** — line 41 is an import of `commitment-problems` |
| `bookings.ts` ~`:2293` (cancel path for revocation hook) | ok-ish — cancel route is `2164-2298`; `2293` is inside its tail |
| `clock-closeout.ts:130` (closeout sweep hook) | **moved** → `sweepClockCloseout` at `143-165`; `130` is inside `persistBookingCloseout` |
| proposal `:25`, `:27`, `:17`, `:21`, `:19` | ok |
| proposal `:40` | **gone** — line 40 is blank (content is at `:27`) |
| design-checkin-checkout `:49`, `:128`, `:163`, `:82`, `:93`, `:113` | ok (all) |
| design-multiday `:146`, `:150` | ok |
| `PHASE0_LOG.md:80`, `:59`, `:85`, `:86` | **stale** |

### §D — chef surfaces

| v1 reference | Status |
| --- | --- |
| `App.tsx:285-286` (`/booking/:id/visit`) | ok |
| `KitchenVisitPage.tsx:14-53` / `:47-50` (tracker) / `:20` (`?visitId`) | ok (all) |
| `KitchenCheckinTracker.tsx:101-595` / `:476-523` arrival / `:525-579` departure / `:307-315` chip+next-step / `:429-444` chooser / `:293-297` state | ok (all) |
| `use-kitchen-checkin.ts:105-281` / `:109-139` / `:142-172` / `:155` body / `:175-205` / `:222-249` / `:251-261` / `:147-157` / `:19-27` / `:126-138` | ok (all) |
| `shared/clock-closeout.ts:5` (`ServicePhase`) / `:134` (visit phase) | ok |
| `BookingDetailsPage.tsx:1703` (message button) / `:204-215` (`openBookingConversation`) | **moved** → `1716` / `:205-215` |
| `bookings.ts:76-101` (conversation route) | **moved** → `77-102` |
| `bookings.ts:91-92` (`initializeConversation`) / `:95-96` (path) | **moved** → `:93` / `:96-97` |
| `shared/schema.ts:2455-2472` (`commitment_problems`) | **moved** → `commitmentProblems` at `2472-2489` |
| `commitment-problems.ts:11-44` (routes) | ok |
| `advance-reminders.ts:24` kinds / `:86-104` `visitReminders` / `:93,98` departure due / `:54-55` `reminderKey` / `:229` `scheduleAdvanceReminders` / `:354` `dispatchAdvanceReminders` / `:248` skip email for `checkin_open` | ok (all) |
| `recurring-worker.ts:114-137` (task wiring) | ok (tasks `114-128`, delivery `132-140`) |
| `recurring-worker.ts:131` (`advance` task) | **moved** → `:133` |
| `recurring-worker.ts:124` (`clockCloseout` task) | ok |
| `lifecycle-settings.ts:18` / `:6` / `:7` | ok |
| `PHASE0_LOG.md:85`, `:86` | **stale** |

### §E — env / crypto

| v1 reference | Status |
| --- | --- |
| `server/index.ts:3` (`import 'dotenv/config'`) | ok |
| `server/instrument.ts:13` (`import 'dotenv/config'`) | ok |
| `server/r2-storage.ts:12` (lazy read comment) | ok |
| `lifecycle-inngest.ts:98` (`CRON_SECRET`) / `:99-100` (`timingSafeEqual`) / `:87` (`INNGEST_SIGNING_KEY`) | ok |
| `bookings.ts:710,733` (`CRON_SECRET`) | **moved** → `711,734` |
| `alwaysFoodSafeAPI.ts:38` (`ALWAYS_FOOD_SAFE_API_KEY`) | ok |
| `env.d.ts:5` (`VITE_FIREBASE_API_KEY`) | ok (env.d.ts declares more `VITE_*` than v1 implied) |
| `reference-code.ts:1,28` (`crypto` import / `randomBytes`) | ok |
| `email-verification.ts:1,44` (`createHash`) | ok |
| `lifecycle-inngest.ts:2,100` (`timingSafeEqual`) | ok |
| `HANDOVER:72` / `HANDOVER:31` / `HANDOVER:102` | ok |
| proposal `:33` | ok |
| `PHASE0_LOG.md:59` | **stale** (now about `closeout-notice-email.ts`) |

### §F — notifications / i18n

| v1 reference | Status |
| --- | --- |
| `booking-lifecycle-delivery.ts:28-131` (`queueBookingLifecycleEvent`) | **moved** → `29-135` |
| `…:111` (outbox insert) | **moved** → `115` |
| `…:142` (`deliverBookingLifecycleEvents`) | **moved** → `146` |
| `…:6` (`sendEmail`) / `:5` (`notificationService`) | ok |
| `…:97-99` (in-app create) | **moved** → `101-103` |
| `…:100-109` (email push) | **moved** → `104-113` |
| `server/i18n/outbound.ts` / `email.ts:12` (`tEmail`) | ok |
| `recurring-worker.ts:131-132` (delivery tasks) | **moved** → `133-134` |
| `kitchen-visit-lifecycle.ts:63-65` (`checkin_recorded`) | ok |
| `kitchen-checkout-service.ts:409-411` (`checkin_recorded`) | ok |
| locales `en-CA|fr-CA|uk`; `chef.json` 117 `kci*` keys; `email.json` 64 keys | ok (all three locales: chef 2725 lines, email 64) |
| `en-CA/chef.json:1033` `kciAccessCodeWhenWindowOpens` / `:1052` `kciContactManagerForAccessCode` | ok |

### §G / §H

| v1 reference | Status |
| --- | --- |
| §G.1 "next free migration is 0074" | **wrong** → `0075` (0074 = `document_renewal_slot`) |
| design-multiday `:81` (0074 draft) | **stale** (0074 now taken) |
| §G.4 `kitchen-booking-visits.ts:30` (`readKitchenBookingVisits` returns `[]`) | ok |
| §G.2/§G.4 `HANDOVER:102`, proposal `:43`, `:45` | ok |
| §H.3 `shared/schema.ts:2455-2472` | **moved** → `2472-2489` |
| §H.5 `bookings.ts:76-101` | **moved** → `77-102` |
| §H.8 `PHASE0_LOG.md:59`, §H.2 `design-multiday:150` | log stale / design ok |

---

## 2. Overlaps and conflicts with the closeout and access code

1. **Visit-key namespace mismatch.** Closeout identifies a visit as `key = visitId ? String(visitId) : clockKey`, where `clockKey = ${localDate}|${startTime}-${endTime}|${blockIndex}` (`shared/clock-closeout.ts:36-37`, applied `:124`; `savedVisitIdentity` `:45-49`). v1 §A.2 proposes `targetKey = 'visit:<visitId>'` else `'booking:<bookingId>:block:0'`. These are separate namespaces in separate tables, so no direct collision — but the resolver must **not** reuse closeout's `clockKey` as the challenge key, and both must agree on the same set of visits (`readKitchenBookingVisits`).
2. **Arrival now drives closeout persistence.** `queueBookingLifecycleEvent` calls `persistBookingCloseout` for kinds `checkin_recorded`, `checkout_requested`, `visit_assisted`, `checkout_claim_filed` (`booking-lifecycle-delivery.ts:42-43`). Every arrival path in §B already queues one of these, so challenge consumption sits in a transaction that also re-locks the booking and rewrites `visitDuties.clockCloseout` (`clock-closeout.ts:96-117`). Consumption must therefore be idempotent with respect to that snapshot: a replay must not advance the closeout clock twice.
3. **Lock ordering / deadlock.** `updateConfirmedVisit` locks `kitchen_bookings` (`kitchen-visit-lifecycle.ts:56`) then updates the visit; `assistKitchenVisit` locks the booking (`visit-assistance.ts:37`) then the visit (`:50`); `claimKitchenVisit` locks booking then visit (`:182`,`:185`). A new challenge row lock must be acquired **after** booking+visit and in one consistent order across all writers (including the new issue/rotate endpoints) to avoid deadlock with a rotate that may lock challenge→booking.
4. **Three writers already own attendance state.** `checkinKitchenVisit` (`kitchen-visit-lifecycle.ts:95-100`), `requestKitchenCheckin` (`kitchen-checkout-service.ts:386-413`), and `assistKitchenVisit` (`visit-assistance.ts:65-71`) all write `checkinStatus`/`checkedInAt` with CAS on `updatedAt`/`checkinStatus`. The code check must be an added gate, not a fourth writer of the same state.
5. **In-session screen vs. `ClockCloseoutSummary`.** That component now renders closeout phases in three places: `KitchenCheckinTracker.tsx:427`, `BookingDetailsPage.tsx:1229`, `ManagerInspectionPage.tsx:206` (`client/src/components/booking/ClockCloseoutSummary.tsx:4-26`). The §D.2 in-session section overlaps it — build on top of it rather than duplicating phase/countdown text.
6. **"No polling" is not currently true.** `use-kitchen-checkin.ts:126-135` sets `refetchInterval` 30 s. The in-session countdown must be a pure client tick between polls (the spec's "client-side, no polling"); do not read the phase from a fresh poll to drive the countdown.
7. **VisitAssistancePanel is no longer a small dialog.** It is now a generic manager "record missed check-in/checkout" panel with storage support (`VisitAssistancePanel.tsx:9-67`, `storage` prop `:45,54`), hosted by `BookingAttendancePanel.tsx:78`. Reusing it as the code/mode surface (§C.1) conflicts with its "manager statement, never chef submission" semantics (`:34`); prefer a dedicated dialog.
8. **Access-end does not cancel visits.** `revokeManagerLocationAccess` deletes `chefLocationAccess` but explicitly keeps existing/pending bookings (`location-access-notices.ts:53-62`). So code revocation is **not** required on access-end; follow the proposal's cancel/reschedule/closure triggers (`visit-code-checkpoint-proposal.md:35`) only.
9. **Worker task surface grew.** `recurring-worker.ts` now runs `clockCloseout` (`:124`), `chefDocumentExpiry` (`:126`), and an `access` delivery task (`:139`), plus `advance` (`:133`). A new in-session reminder must add a kind to `advance-reminders.ts:24` (and possibly a `ReminderSource` at `:22`), delivered via the existing `advance` task.
10. **New settings precedent.** `closeout_notifications_from` is a `platform_settings` row (`lifecycle-settings.ts:64-91`). If visit-code mode/attempt limits become settings, follow this pattern; otherwise keep them on the challenge table.

---

## 3. Proposed split — 3 non-overlapping packages

**PKG-1 — Challenge core + migration (new files only; no edits to existing files).**
- Owns: migration SQL, target resolver, 6-digit generation, HMAC hash/verify, attempt counter, consume/replay, issue/rotate, mode toggle, revoke.
- Files: `migrations/0075_kitchen_visit_arrival_challenges.sql` (draft; owner gate to apply), `server/services/visit-code-challenge.ts` (new), `shared/visit-code.ts` (new), `env.d.ts` (add `VISIT_CODE_HMAC_SECRET` declaration), `server/services/visit-code-challenge.test.ts` (new).
- Interface it must publish to PKG-2: `resolveArrivalTarget(bookingId)`, `verifyAndConsume(tx, target, code, requestKey)`, `issueOrRotate`, `setMode`, `revoke`.

**PKG-2 — Server wiring + manager endpoints + notifications.**
- Owns: every server response shape and the four arrival writers.
- Files: `server/routes/bookings.ts`, `server/routes/manager.ts`, `server/services/kitchen-visit-lifecycle.ts`, `server/services/kitchen-checkout-service.ts`, `server/services/visit-assistance.ts`, `server/services/booking-lifecycle-delivery.ts`, `server/services/advance-reminders.ts`, and integration tests. (`server/services/lifecycle-settings.ts` only if a setting is added.)
- Must not touch client or locale JSON. Anchors: check-in route `bookings.ts:2305-2348`, checkout `:2351-2393`, status `:2396-2473`; manager assist/clear/claim `manager.ts:8050-8178`; manager detail `4314-4658`.

**PKG-3 — Client + i18n.**
- Owns: all UI and locale keys; consumes PKG-2's response shape.
- Files: `client/src/pages/KitchenVisitPage.tsx`, `client/src/components/booking/KitchenCheckinTracker.tsx`, `client/src/hooks/use-kitchen-checkin.ts`, `client/src/pages/BookingDetailsPage.tsx`, `client/src/pages/ManagerInspectionPage.tsx`, `client/src/components/booking/VisitAssistancePanel.tsx` (or a new panel), `client/src/components/manager/TodaysKitchenBookings.tsx`, `shared/i18n/locales/{en-CA,fr-CA,uk}/{chef,email}.json`, and component tests.
- Must not touch server files. Anchor: attendance mount `BookingDetailsPage.tsx:1308`, multi-visit list `1344-1380`, single-visit block `1383+`, message button `1716`.

Sequencing: PKG-1 first (contract), then PKG-2 and PKG-3 in parallel. PKG-2's edits to `bookings.ts`/`BookingDetailsPage.tsx` are the highest-churn; re-anchor immediately before editing.

---

## 4. Open risks

1. **Line drift is live.** `bookings.ts` (+1), `BookingDetailsPage.tsx` (+13), `booking-lifecycle-delivery.ts` (+1/+4), `shared/schema.ts` (+17), and `recurring-worker.ts` delivery (+2) already differ from v1. Re-grep before every patch; do not trust any line in this doc after the next merge.
2. **Migration ordering.** `0073` is unapplied while `0074` is applied; writing `0075` continues the sequence but the unapplied `0073` must be reconciled before any apply (owner decision).
3. **Challenge key vs. closeout key.** If the two ever need to be joined (e.g. redacting a code on `service_ended`), the mismatch between `target_key` and `clockKey`/`String(visitId)` must be bridged explicitly.
4. **Assisted arrival + code** is still unresolved (`visit-code-checkpoint-proposal.md:21` says never an automatic bypass). This changes §B.3.
5. **15-min alert mechanism.** Reusing `departure` changes everyone's departure reminder (default 30 min, `lifecycle-settings.ts:18`); a new `in_session_ending` kind avoids that but adds a kind to `advance-reminders.ts:24`.
6. **"Need more time?" interim** should reuse `POST /api/bookings/:id/conversation` (`bookings.ts:77-102`) — confirm the prefilled-topic behavior.
7. **Today board.** `TodaysKitchenBookings` is still dead code (`TodaysKitchenBookings.tsx:149`); the "In session · N min left" row needs it (or its successor) mounted.
8. **No incident table.** "Report a problem" still has only `commitment_problems` (`shared/schema.ts:2472-2489`); design wants a separate case (`design-checkin-checkout.md:82,93`).
9. **Redaction.** Codes must never appear in lists, emails, logs, or participant APIs (proposal `:27`); after consumption show method/time only.
10. **Doc citations.** PHASE0_LOG line refs are all stale; cite by section heading. proposal `:40` is blank (use `:27`).
