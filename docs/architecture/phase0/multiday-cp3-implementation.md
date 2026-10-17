# CP3: availability, buffers, weekly limit and grouped holds

Built against `multiday-spec-2026-10-17.md` ("Kitchen controls"; longest booking has no default cap) and CP3 in
`multiday-build-plan.md` (§1 Kitchen controls, §3, §8). Dated booking creation stays gated off (`booking_multiday_enabled`).
No migration was applied, no database, provider, deployment or setting was touched. No money capture/allocation (CP4).

## Behaviour by area

- **`validateBookingDays`** (`server/services/booking-days-validation.ts`): one server check for a day set on top of the
  single-day engine. CP1 count/span contract and rollout gate (a one-day legacy payload is exempt from the gate), chef access
  (`not_open_to_you`), per-day hours/occupancy/buffer (`closed`, `booked`, `held`, `buffer`, `beyond_advance_window`,
  `clock_change`, `invalid_hours`), longest booking on **hourly** days only (full days keep the daily-rate bypass), minimum
  hours, notice in the **location time zone** (`notice`), per-day equipment (`equipment_unavailable`: listing must be this
  kitchen's, active, not archived), then the weekly limit across all days. Returns every failing date with its reason.
  Paid checkout (`POST /chef/bookings/checkout`) now uses it instead of its own checks; the hard-coded St. John's zone is
  gone from checkout, `/payments/create-intent` and `/chef/bookings` (they use the location's zone).
- **Occupancy sees later dated days everywhere.** `datedOccupiedSlots` reads each slot's own date and anchor (legacy rows:
  parent date/anchor). Used by availability, the full-day guard (any booking with a slot on that date), slot lists, the month
  map, hold conflict scans, fulfillment, weekly counting, tours (context only, now in the location zone for changes) and
  schedule-edit impact (`activeBookingIdsOnOperatingDate`, `bookingsAffectedByWeeklyChange` + every caller now selects
  `selected_slots`). Bounded parent-date queries widened by 14 days (extensions, tours). The date-blind
  `hasBookingConflict` and the unused `findConflictingBookings` were removed.
- **Buffers Off/1 h/2 h**: pair gap = `max(existing snapshot, candidate snapshot)`, never the sum; a row with no snapshot
  uses the kitchen's current buffer (today's behaviour). Same booking (its own days, its extensions, a move excluding itself)
  never needs a gap; a separate booking by the same chef does. Snapshots are written on every new booking
  (`BookingRepository.createKitchenBooking`, quoted fulfillment and the webhook fallback copy the hold's), every hold
  (checkout, change, extension, grouped) and every invitation (create/replace). Changes keep the booking's own buffer;
  invitations use their frozen one through checkout; extensions use the booking's own vs each neighbour's. Error messages
  for buffer conflicts keep today's wording (with `code: 'buffer'`); slot lists add `reason: 'buffer'`.
- **Kitchen override** (`server/services/booking-rule-overrides.ts`): only server code can build a grant (symbol-branded;
  request JSON can never carry it). Manager invitations accept `ruleOverride: { ignoreBuffer?, ignoreWeeklyLimit?, reason }`
  after the ownership check; the grant is saved on the invitation (`booking_rule_overrides`, scoped to that invitation row,
  kitchen and chef), logged in the `created` event, copied to the booking at fulfillment, and re-trusted only for that exact
  row. It waives spacing or the weekly limit, never actual overlap, hours or equipment ownership.
- **Weekly hours per chef** (`shared/kitchen-booking-quota.ts`, `server/services/kitchen-booking-quota.ts`): Monday 00:00 to
  next Monday 00:00 in kitchen wall-clock minutes (DST never stretches a week; overnight visits split at Monday 00:00).
  Counts every non-cancelled booking (pending, confirmed, in progress, completed) and active holds (checkout, change,
  added time); full days count their opening-hour slots. Enforced at checkout quote and inside the reservation lock, free/
  direct creation (under the day lock), holdless fulfillment, change preview/request/approval (original excluded),
  invitation preview/create/replace (shortfall shown to the kitchen) and checkout, and added time (extension and early-start
  options stop at the limit; reason `weekly_limit`). Error `WEEKLY_CHEF_HOURS_LIMIT` (HTTP 409) with every failing week:
  "You have used or booked 6 of 8 hours at this kitchen for Oct 19–25. These days add 3 hours. ...".
- **Grouped holds** (`server/services/kitchen-checkout-holds.ts`): `reserveKitchenCheckoutGroup` runs in ONE transaction:
  kitchen lock, sorted day locks, sorted equipment locks (`lockKitchenInventory`, shared order), per-day validation, internal
  overnight overlap check, equipment ownership, in-transaction conflict scan, weekly limit, then all rows (head id = group id,
  quote only on the head). Bind only via the head, copying the quote into `kitchen_checkout_incidents.quote_snapshot`;
  `assertKitchenCheckoutGroup` validates the whole group against the session; `renewKitchenCheckoutGroup` renews all rows;
  `releaseKitchenCheckout` from any row releases the whole group; exclusion by group id works everywhere. Expired-hold
  cleanup keeps an unbound head with a quote (no occupancy after expiry) for recovery.
- **Per-date status endpoints**: `GET /api/chef/kitchens/:id/date-status?year&month` (adds the chef's access and weekly
  limit) and `GET /api/public/kitchens/:id/date-status` (same public gate as the month map, never chef data). Each date:
  `{ hourly, fullDay, reason, fullDayReason }`. The old boolean `month-availability` maps are unchanged.
- **Legacy single-day paths**: with buffer 0 and no weekly limit, accept/reject outcomes and messages are as before (the
  existing suites pass unchanged except the date-blind helper's tests, rewritten for the dated predicate).

## Data migration (written, not applied)

`docs/architecture/phase0/multiday-cp3-buffer-freeze.sql` freezes the currently effective 0/60 on live bookings, active
holds and open invitations with no snapshot, under every kitchen's `(kitchen_id, 0)` advisory lock, with verification
queries. Run once per environment before kitchens can edit the new control. Until it runs, null snapshots follow the
kitchen's current setting (today's behaviour).

## Verification

- Work committed first; `npx tsc --noEmit -p tsconfig.json` run once afterwards: **0 errors**.
- Server: **50 files, 926 passed, 1 expected fail** (`--config vitest.config.server.ts --maxWorkers=4` with filters
  `booking-availability booking-buffers booking-days-validation kitchen-booking-quota booking-buffer-pairs
  kitchen-checkout-holds session-extension kitchen-booking-change checkout-fulfillment checkout-replacement
  booking-replacement tour-booking operating-schedule invitation days-contract booking-polic booking-occupancy
  viewings-availability storage-availability dated-visits clock-closeout kitchen-visit-lifecycle visit-code
  booking-attendance advance-reminders damage-claims-v2 kitchen-payout-service booking-visit-blocks`). A few slow suites can
  time out at 5 s when another agent loads the machine; each passed when re-run alone.
- Client: `SessionExtensions.test.tsx` + `SessionExtensionsDeadline.test.tsx` 46 passed.
- New/changed CP3 tests: `shared/kitchen-booking-quota.test.ts` 9 (Monday boundaries, overnight split, DST weeks, full-day
  hours, 6+3 vs 8, every failing week, message); `shared/booking-buffer-pairs.test.ts` 16 (Off/60/120 exact boundary and
  one minute short, max not sum, symmetric, overnight tail, spring-forward real gap, dated slots, tours and schedule impact
  on later days, extension/early-start pair buffers); `server/domains/bookings/booking-buffers.test.ts` 18 (matrix, existing
  keeps its snapshot, legacy null follows current, same-booking vs same-chef, hold buffers, group exclusion, trusted
  override vs forged JSON vs chef role, grant scope, later dated day in validation/full-day/slots/month, per-date reasons,
  public view has no chef data); `server/services/booking-days-validation.test.ts` 18 on PGlite (Mon/Wed/Fri, contract/
  gate, every failing date, hourly cap vs daily bypass, minimum, notice in location zone, eligibility, equipment, weekly
  used/completed/cancelled/other chef/other kitchen/next week/holds/own booking excluded/grant vs forged flag, grouped
  hold commit, **concurrent group reserve: one winner, loser leaves no rows**, buffer and weekly failures write nothing,
  kitchen waiver vs real overlap, overnight into next selected day, foreign equipment, bind/quote copy/validate/renew/
  release-from-any-row, expired cleanup keeps unbound head); `session-extensions.test.ts` +2 (own 2 h vs neighbour Off,
  weekly cut + reason); `kitchen-booking-changes.test.ts` +1 (move uses only what the original frees).
- Two CP2-era fixture DBs were repaired (they failed on the parent commit too): `booking-checkout-replacement.test.ts`
  (fake `execute`/`orderBy`) and `booking-replacement.recovery.test.ts` (adds `kitchen_booking_visits`).

## Not done here / risks

- Change and invitation paths call the same engine and weekly primitives with their saved buffer/grant but keep their own
  translated errors; CP7/CP10 move them to day sets through `validateBookingDays`. The webhook fallback (legacy metadata
  without a hold) does not recheck the weekly limit.
- No manager-only "override this chef's weekly limit" for a blocked confirmed change (`POST /manager/bookings/:id/
  weekly-limit-override` in the plan); the audited override path is the invitation. No kitchen-created direct booking
  route exists to wire `ignoreBuffer` into; the portal stays an external customer and follows buffers.
- Equipment belongs to one kitchen whose time is exclusive, so per-day equipment availability is listing ownership/active
  status under the listing locks; no separate equipment-row time scan was added for new rows (CP4 creates them per day).
- Unbound expired group heads are kept until recovery archives them; CP4's incident worker must archive them.
- Picker UI (CP8) does not yet call the new endpoints; manager invitation UI does not yet send `ruleOverride`.
- Real-PostgreSQL parity (0099 CHECKs, partial unique index, advisory lock behaviour under real concurrency) remains CP11.

## Files changed

- `client/src/components/booking/SessionExtensionRequest.tsx`, `client/src/lib/session-extensions.ts`
- `docs/architecture/phase0/multiday-cp3-buffer-freeze.sql`, `docs/architecture/phase0/multiday-cp3-implementation.md`
- `server/domains/bookings/booking.repository.ts`, `booking.service.ts`, `booking-availability.test.ts`, `booking-buffers.test.ts`
- `server/routes/bookings.ts`, `kitchen-invitations.ts`, `kitchens.ts`, `manager.ts`, `viewings.ts`, `webhooks.ts`
- `server/services/booking-checkout-fulfillment.ts` (+ test), `booking-checkout-replacement.test.ts`, `booking-days-validation.ts`
  (+ test), `booking-replacement.recovery.test.ts`, `booking-rule-overrides.ts`, `kitchen-booking-changes.ts` (+ test),
  `kitchen-booking-quota.ts`, `kitchen-checkout-holds.ts`, `kitchen-checkout-incidents.ts`,
  `kitchen-invitation-fulfillment-recovery.test.ts`, `kitchen-invitations.ts`, `session-extensions.ts` (+ test)
- `shared/booking-buffer-pairs.test.ts`, `booking-occupancy.ts`, `kitchen-booking-policies.ts`, `kitchen-booking-quota.ts`
  (+ test), `operating-schedule.ts`, `session-extension.ts`, `tour-booking-overlap.ts`, `i18n/locales/{en-CA,fr-CA,uk}/chef.json`
