# R2: manager tracking lists

Implemented section 3 of `manager-tracking-revamp-plan.md`. This stage changes display and filtering only. Charges, refunds, transfers, payout timing and booking state transitions are unchanged. Existing booking tabs, groups and actions, storage actions, and claim cards remain available.

## Bookings

- Refunded rows show **You receive** from the existing attached `KitchenPayout` projection, with **Refunded** as secondary copy. Chef refunds are never subtracted from kitchen earnings in the client: they can include platform-funded money.
- For the selected multi-day visit, earnings sum that visit's payout installments. The existing selected-day behavior and **Day N of M** label remain in place.
- Search continues to match chef names and booking references. Inclusive start/end dates and the displayed booking status filter combine with search inside the existing Upcoming/Past/Cancelled tabs and groups.
- Export CSV downloads only the rows shown in the active tab after all filters. Columns: date, day, chef, kitchen, status, total, refunded, you receive. Amounts are CAD decimal values. Cells are quoted, quotes escaped, and leading spreadsheet formulas neutralized. No Stripe identifiers are exported.

## Storage

- Reserved units whose start date is before the current kitchen-local date show **Move-in overdue · started {date}** and appear under Needs action. This is a display projection; it does not alter rental lifecycle behavior.
- **Past rentals** appears as a section on All and as its own filter. It includes ended rentals even when their units are still waiting for cleaning, sorted by ending date, with actual start/end dates, chef, and kitchen earnings.
- Earnings sum existing term `payoutCents` fields, which already account for kitchen-funded refunds. Missing payout data contributes zero; chef totals are never used as a kitchen earnings fallback.
- Each history entry links to its rental detail, the chef's customer page when an account exists, and the existing revenue view for payouts.

## Claims

- Status and inclusive filed-date filters preserve Open/Closed groups and the existing claim card actions. Date filtering follows the same viewer-local calendar date as the card's filed date.
- Totals apply only to shown claims: **Claimed** sums original claimed amounts; **Collected** sums final amounts confirmed paid to the kitchen; **Still pending** sums unpaid final amounts on open claims or claims explicitly awaiting kitchen payment/compensation. Rejected/expired/closed claims without pending payment do not inflate pending totals.

## Reuse and scope

The shared list filter controls reuse the existing `DateField`, `Select` and `Button` components. Booking downloads reuse `downloadCSV`. New copy is present in en-CA, fr-CA and uk, updated exclusively through a UTF-8 Python script. No dependencies or server routes/services were changed: `/manager/bookings` already attaches payouts, and storage rentals already carry per-term net payout data.

## Validation

- 36 focused client tests pass across five files: bookings agenda (13), storage board model (16), storage unit card (2), storage bookings page (3), and claims queue (2). Coverage includes retained groups/actions, refunded rows, combined search/status/date filters, CSV columns and escaping, multi-day labels and payout amounts, kitchen-local overdue labels, past-rental earnings/links, and claim totals after filtering.
- Tests ran with `npx vitest run` restricted to those files and `--maxWorkers=1`. The bookings file was rerun after scoping an older pill assertion to exclude the new filter option.
- `node scripts/i18n-lint.mjs` passes: 15 namespaces synchronized across fr-CA and uk; 2,435 manager, 6 kitchen, 70 chef, 22 booking and 62 common keys verified.
- `git diff --check` passes.
- One foreground `npx tsc --noEmit -p tsconfig.json` completed successfully with exit code 0. It was run exactly once; no Node processes were stopped.
- Server code is unchanged, so server tests were not needed for this stage.
- Live browser verification on dev remains for lead review.
