# CP2: dated visits and lifecycle readers

Implemented against the owner decisions in `multiday-spec-2026-10-17.md` and CP2 in `multiday-build-plan.md`.
New booking creation remains OFF. No migrations, shared databases, deployments or live provider operations were run.

## Behavior

- One booking-locked, transaction-aware builder is shared by checkout fulfillment and code enrollment. Positive revisions require an immutable daily manifest on the initial build. It creates one dated row per day with its own anchor, pricing mode, slots and price snapshot. Retries preserve IDs and cancelled days; new revisions allocate indexes above every historical index. Legacy contiguous/split behavior is retained.
- Saved clocks retain the operating date separately from the local start date. Closeout, inspection, attendance and payout-timing projections exclude cancelled/superseded days. Parent service completes after the last remaining day; no remaining days produce no lifecycle timers. Historical rows remain stored and readable in booking evidence.
- Arrival, departure, assistance, attendance, inspection, code changes and extension target selection validate booking ownership and the current active visit. Dated parent-level arrival/departure/legacy claim paths reject ambiguous targets. Old legacy URLs work; a removed dated URL cannot silently mutate a different visit.
- Codes enroll per day, support all-days self check-in, and expose a target-only revocation helper for later day drops/moves. A locked or missed day does not block another day's code or arrival.
- V2 damage reports use the selected visit's saved end, or its own date/anchor fallback, and its recorded departure for the 72-hour filing window. Claim uniqueness stays per visit. No charge/refund/transfer arithmetic changed.
- Reminders use current stable visit identities/revisions; obsolete resources disappear through existing reminder reconciliation. Service-ended and inspection notices carry the visit target; email delivery rechecks that target and scopes times, claims and inspection links to it. Running-late limits and counts are per dated visit; current readers exclude reports from cancelled days and superseded revisions.
- Shared arrival details release exactly 48 hours before the first actual scheduled start and remain visible between selected days. Instruction updates continue for remaining days after day 1. Staffed codes are never exposed in chef projections.
- The chef visit page uses selected-day clocks/dates and chronological day ordinals. "Same as previous visit" works across gaps and prefills only matching task IDs. Photos, final confirmation and attendance are never copied. Historical review displays the visit date.

## Verification

- `npm ci` completed locally; no junction/symlink was created and no dependency manifest changed.
- `npx tsc --noEmit -p tsconfig.json`: exactly the 6 known baseline errors (five missing `reference` fixture fields in `server/services/commitment-problems.postgres.check.ts`, one missing `rentalState` fixture field in `server/services/recurring-worker.postgres.check.ts`); no new errors.
- Server: **637 passed, 28 files**, using `--config vitest.config.server.ts` and the filters below.
- Client: **42 passed, 1 file**, `npx vitest run --config vitest.config.ts client/src/pages/KitchenVisitPage.test.tsx`.
- `git diff --check` passed.

Server command:

```powershell
npx vitest run --config vitest.config.server.ts clock-closeout kitchen-visit-lifecycle visit-code booking-attendance advance-reminders damage-claims-v2 visit-duties historical-visit-review running-late closeout-notice-email dated-visits kitchen-overrides-email kitchen-payout-service visit-assistance booking-checkout-fulfillment session-extensions booking-days-contract booking-visit-blocks
```

The isolated dated PGlite suite explicitly loads the real 0043 trigger function, its block uniqueness constraint, and the 0099 `WHEN (NEW.schedule_revision = 0)` trigger guard; these are not inferred from Drizzle. Dated fixtures are separate from legacy fixtures. Coverage includes repeated hours on different dates, differing overnight anchors, stable IDs/indexes/revisions, missed day 1 then day 2 arrival, independent inspection/no-show/claim windows, cancelled/superseded exclusions, instruction visibility in gaps, per-day code locks/revocation, and old/removed URLs.

Server counts by file:

- `shared/booking-attendance.test.ts`: 20 passed.
- `shared/booking-days-contract.test.ts`: 7 passed.
- `shared/booking-visit-blocks.test.ts`: 2 passed.
- `shared/clock-closeout.test.ts`: 23 passed.
- `shared/running-late.test.ts`: 5 passed.
- `shared/visit-duties.test.ts`: 7 passed.
- `server/middleware/booking-attendance-privacy.test.ts`: 2 passed.
- `server/routes/clock-closeout-read.test.ts`: 3 passed.
- `server/routes/session-extensions.test.ts`: 12 passed.
- `server/services/advance-reminders.test.ts`: 98 passed.
- `server/services/booking-attendance-automatic.test.ts`: 1 passed.
- `server/services/booking-attendance-checkin.test.ts`: 82 passed.
- `server/services/booking-attendance-service.test.ts`: 30 passed.
- `server/services/booking-checkout-fulfillment.test.ts`: 4 passed.
- `server/services/clock-closeout.test.ts`: 28 passed.
- `server/services/closeout-notice-email.test.ts`: 16 passed.
- `server/services/damage-claims-v2.test.ts`: 35 passed.
- `server/services/dated-visits.test.ts`: 8 passed.
- `server/services/historical-visit-review.test.ts`: 5 passed.
- `server/services/kitchen-overrides-email.test.ts`: 27 passed.
- `server/services/kitchen-payout-service.test.ts`: 23 passed.
- `server/services/kitchen-visit-lifecycle.timezone.test.ts`: 39 passed.
- `server/services/running-late.test.ts`: 8 passed.
- `server/services/session-extensions.test.ts`: 71 passed.
- `server/services/storage-visit-assistance.test.ts`: 9 passed.
- `server/services/visit-assistance.test.ts`: 32 passed.
- `server/services/visit-code-challenge.test.ts`: 28 passed.
- `server/services/visit-duties.test.ts`: 12 passed.

## Later checkpoints and remaining risks

- CP3 owns availability, buffer/quota enforcement, hold groups and the remaining dated extension occupancy/boundary wiring. CP2 only scopes extension lifecycle target selection.
- CP4 owns creation of dated bookings, authoritative pricing/quote manifests and per-day equipment fulfillment. The builder is ready for that caller; creation is still gated off.
- CP5 owns daily payout partitioning and transfers. CP2 only fixes timing readers; it does not release separate daily installments.
- CP6/CP7 own day-drop/refund decisions and whole-schedule changes. They must call target revocation, supersede old rows, build the new revision and replace the saved schedule atomically. This checkpoint supplies those reader/builder primitives, not those money mutations.
- CP8/CP9 own the full chef/manager/admin day-list journey and localization of the new visit copy. This checkpoint adds the minimal selected-visit/task-reuse behavior required by CP2.
- Real PostgreSQL parity and controlled live acceptance remain CP11/lead work. No live database/provider checks or independent money review were performed by this implementation sub-agent. Creation must stay off until the later checkpoints and review pass.

## Files changed

- `client/src/components/admin/HistoricalVisitReviews.tsx`
- `client/src/components/booking/KitchenCheckinTracker.tsx`
- `client/src/hooks/use-kitchen-checkin.ts`
- `client/src/pages/KitchenVisitPage.test.tsx`
- `server/routes/bookings.ts`
- `server/services/advance-reminders.test.ts`
- `server/services/advance-reminders.ts`
- `server/services/booking-attendance-service.test.ts`
- `server/services/booking-attendance-service.ts`
- `server/services/booking-checkout-fulfillment.test.ts`
- `server/services/booking-checkout-fulfillment.ts`
- `server/services/booking-lifecycle-delivery.ts`
- `server/services/clock-closeout.test.ts`
- `server/services/clock-closeout.ts`
- `server/services/closeout-notice-email.test.ts`
- `server/services/closeout-notice-email.ts`
- `server/services/damage-claim-service.ts`
- `server/services/damage-claims-v2.test.ts`
- `server/services/damage-claims-v2.ts`
- `server/services/dated-visits.test.ts`
- `server/services/kitchen-booking-visits.ts`
- `server/services/kitchen-checkout-service.ts`
- `server/services/kitchen-instructions-updated.ts`
- `server/services/kitchen-overrides-email.test.ts`
- `server/services/kitchen-payout-service.ts`
- `server/services/kitchen-visit-lifecycle.timezone.test.ts`
- `server/services/kitchen-visit-lifecycle.ts`
- `server/services/running-late.test.ts`
- `server/services/running-late.ts`
- `server/services/session-extensions.ts`
- `server/services/visit-assistance.ts`
- `server/services/visit-code-challenge.ts`
- `server/services/visit-duties.ts`
- `shared/booking-attendance.ts`
- `shared/clock-closeout.ts`
- `shared/dated-visits.ts`
- `shared/operating-hours.ts`
- `shared/running-late.ts`
- `shared/visit-duties.ts`
- `docs/architecture/phase0/multiday-cp2-implementation.md` (this report).
