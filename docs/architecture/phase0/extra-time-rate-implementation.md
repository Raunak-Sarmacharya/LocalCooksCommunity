# Extra time rate — implementation (owner, Oct 17)

## What changed
- **Migration 0104:** nullable `extra_time_rate_cents` (integer, CHECK > 0) on `kitchens` and `kitchen_bookings`. No backfill of bookings.
- **Kitchen settings / onboarding:** daily-only kitchens must set “Extra time rate (per hour)”; hourly kitchens store null and use the hourly rate. Client + server 400 with a clear message when required and missing.
- **Booking snapshot:** every `kitchen_bookings` insert path saves `extraTimeRateCents` = kitchen hourly if > 0, else kitchen `extra_time_rate_cents`, else null (checkout fulfillment, webhooks, booking service, dated fulfillment).
- **`priceTerms`:** uses booking snapshot first; legacy fallback is hourly single-day `booking.hourlyRate`, else kitchen hourly / extra time rate. Dated bookings are no longer refused. Dated parent payment ratios use `approvedSubtotal` when present, else `baseAmount − taxAmount` (must conserve `amount`).
- **Chef display:** booking summary and booking page show the rate (e.g. “Extra time: $25.00/hour if you ask for more time or stay past the end.”). Locales: en-CA, fr-CA, uk.

## Tests
- `extra-time-rate-migration.test.ts` — executes `0104_extra_time_rate.sql` in PGlite (idempotent, CHECK, no backfill).
- `session-extensions.test.ts` — dated pricing from snapshot (not daily applied rate); dated request/capture; legacy daily fallback to kitchen hourly.
- `extra-time-rate-dated-money.test.ts` — (a) CP5 day-1 extension installment, (b) CP6 later-day cancel ignores extension source, (c) CP7 support-only after extension, (d) CP9 day money includes extension.

## Limits
- Migration is not applied to any environment by this change; deploy applies 0104 separately.
- Existing bookings without a snapshot use the legacy fallback (kitchen’s current rates for daily/dated); new bookings always snapshot.
- Kitchen may still lower a stay-past-the-end charge via `amountCents` in `extraTimeQuote` (unchanged).
