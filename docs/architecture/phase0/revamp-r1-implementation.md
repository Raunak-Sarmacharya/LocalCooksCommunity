# R1 — Revenue and payouts

## Scope

Display/reporting only. No charge, refund, transfer, payout eligibility, release timing, worker or database-schema changes.

`GET /api/manager/revenue/ledger` requires the existing Firebase manager authentication. It accepts `startDate` and
`endDate` (`YYYY-MM-DD`, inclusive, up to three years), plus optional positive `locationId` and `kitchenId` filters.
Every financial read joins the current manager's owned locations, including platform-funded claim compensation.
Foreign filters return no financial rows. Filter choices contain only owned kitchens/locations.

Revenue and the staged overview card use the same TanStack Query hook, endpoint and summary component. Their initial
range is month to date. Upcoming and On hold intentionally include all outstanding payouts for the filtered kitchens;
Paid and Reports use the chosen period. The page explains this distinction.

## Money and dates

All computation stays in integer CAD cents. The new reader only selects saved data and calls existing read projections;
it never contacts Stripe, takes a money lock, schedules a payout or writes anything.

- Daily installment entitlement: `subtotal + HST - actual card fee - saved manager debits`, from the matching
  source/visit/allocation revision. Existing payout reads determine status and expected dates. Superseded allocation
  revisions and zero outstanding amounts do not appear. Captured sources awaiting allocation recovery show a review hold.
- Other source entitlement: the existing `unpaidKitchenEntitlement` / transfer-split math. Extension charges use their
  own amounts and their parent's live payout status; their money is never added again through a booking summary.
  Storage terms use the existing live storage-term eligibility/hold reader. Claim processing costs paid by Local Cooks
  are never deducted from the kitchen's claim award. Platform-recovery payments are excluded.
- Upcoming sources merge by booking, operating day, payout type, status and hold reason. A held share stays separate
  from a scheduled share. The merged date is the latest known date required for its shares; an unknown date stays unknown.
  Storage terms and independent non-daily payouts remain separate.
- Paid is one row per recorded transfer, including per-day installments and earlier/replacement transfers preserved in
  `payment_history` (`payout_transfer_verified`). Capture alone never makes a row paid. Original transfer amounts and
  verified reversals remain separate. `paidOut = sum(original transfer amount - verified reversed amount)` for transfers
  sent in the chosen period, using reversals known at read time. This is a Connect transfer history, not a bank-arrival
  ledger. The copy explains that the bank processes the deposit afterward.
- Report net: `kitchen time + equipment + storage + extra time + claims received + HST collected - card processing fees
  - kitchen-funded refunds`. Net earnings is the sum of report events. HST is a separate gross-collected column, included
  once in the kitchen's payout; refunds are the kitchen's share, not the platform's refunded service fee/goodwill.
  Component splits prefer immutable captured-component evidence; otherwise the existing saved payment and add-on data
  supplies the split. Tax prefers saved tax/approved tax and uses the existing tax resolver for older rows.
- Captures belong to their paid/created date. Each manager refund debit belongs to its receipt date, recorded refund
  history date, or verified saved operation date. Older evidence lacking an individual date falls back to the payment's
  refunded/updated timestamp. An October refund of a September charge can therefore make October earnings negative.
  Platform-funded claim compensation enters Reports when its saved transfer exists, separately from any later recovery
  from the chef. Claim transfer dates prefer the `kitchen_paid` claim-history receipt; older compensation without a
  receipt timestamp falls back to the saved attempt/start time. Pending claim payouts reuse the existing read-only
  money-freeze check rather than inheriting the booking's inspection or chef-issue hold.
- Bookings count the first captured kitchen charge once, not each source/installment. Hours use the saved booking
  duration (legacy slot-count fallback), plus separately paid extension minutes. Payment count remains in Reports.
  Month/chef/type totals are sums of the same report events. Dates are interpreted in each location's timezone.

## UI and exports

Four headline cards: Paid out, Upcoming (next date and amount), On hold (count and amount), Net earnings. The overview
shows the first three from the identical summary, retaining its Revenue link and existing staging.

Upcoming / Paid / Reports reuse the responsive TanStack table and pagination extracted from the transaction table.
Reports reuses the existing earnings chart with explicit monthly buckets, including partial-month ranges. The date
picker is retained. Location and kitchen filters feed the shared read. Existing payment details, invoices, Stripe
setup/dashboard access and bank-payout statements remain available in Reports.

Each tab exports its complete filtered rows, independent of table pagination. Report CSV has one row per payment/refund
event; payout CSV has one row per displayed payout/transfer. Exports include separate HST, processing fees, refunds,
net payout and reversal columns. Money columns are decimal CAD amounts. CSV cells are quoted and spreadsheet formulas
in user-controlled names/references are neutralized. Provider identifiers appear only inside dashboard-link targets.

New copy is in en-CA, fr-CA and uk locale JSON, edited by a UTF-8 Python script. ICU plurals use `#`.

## Verification

Focused server tests cover merged multi-source days, zero-row omission, held/type separation, source/transfer history,
replacement transfers and reversals, report reconciliation, separate HST, dated refunds, claim fees, storage terms,
superseded revisions, location timezones, read-only inputs, live-hold clearing, allocation recovery and ownership/query
validation. Existing kitchen, daily and storage payout tests also run unchanged.

Focused client tests cover all tabs, four headline amounts, next payout, multi-day labels, booking/Stripe links, report
groups, tab CSV columns, formula escaping, shared overview amounts and partial-month chart buckets. Existing page staging
and transaction-table tests also run.

Results: **38 client tests** in five files and **102 unique server tests** in five files passed. The server full focused
run passed 101 tests; after adding the final claim-hold regression, the two new server suites passed all 20 tests
(the unchanged payout suites account for the other 82). The claim-reader test also verifies the actual transfer date
comes from claim history rather than the earlier chef charge. `node scripts/i18n-lint.mjs` passed (all 15 namespaces).

Client command:

```text
npx vitest run client/src/components/manager/revenue/components/RevenueLedger.test.tsx client/src/components/manager/revenue/components/TransactionTable.test.tsx client/src/components/manager/revenue/earnings-chart.test.ts client/src/pages/ManagerRevenueDashboard.test.tsx client/src/components/dashboard/KitchenDashboardOverview.test.tsx
```

Server command (the new ledger/reader suites were also rerun after the final claim read changes):

```text
npx vitest run --config vitest.config.server.ts server/services/manager-revenue-ledger.test.ts server/services/manager-revenue-service.test.ts server/services/kitchen-payout-service.test.ts server/services/kitchen-day-payouts.test.ts server/services/storage-payouts.test.ts
```

The single foreground `npx tsc --noEmit -p tsconfig.json` completed with exit code 1 and ten diagnostics, all in the new
server files: eight TS2802 iterator/downlevel-target errors and two TS2339 references to a nonexistent `users.fullName`.
All reported issues were fixed: Map/Set/array iterators use `Array.from`, and chef labels come from profile/application
names using the actual schema. Both new server suites were then rerun: **20/20 passed**. Per the explicit one-run limit,
TypeScript was not run again, so a clean post-fix whole-project type check is not claimed.

Lead money-display review and an authenticated live-dev check remain the handoff steps from the stage plan.
