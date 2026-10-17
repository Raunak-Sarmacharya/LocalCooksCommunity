# CP5 — daily payout installments (Oct 17, 2026)

Scope: daily payout partition and reporting, based on `development` at `8e680446`. The multi-day creation gate stays off. CP6 refunds/drops and CP7 schedule changes remain gated by their existing guards.

## Money flow

The real captured payment remains one `payment_transactions` source. CP4 component allocations create one `kitchen_booking_day_payouts` row per source/visit/revision, including pending actual-fee evidence. Day net is subtotal + allocated HST − actual allocated Stripe fee − scoped settled kitchen debit. No estimated processing fee is treated as final. Zero entitlement has a durable terminal marker.

Each visit uses its own CP2 saved clock and inspection (including claim-filed inspection closure), with actual-departure auto-close semantics. Cancelled retained shares wait until that visit's scheduled end plus grace. A scoped chef problem or operational flag holds only its visit; unscoped problems/flags hold the booking. Chargebacks still freeze refunds source-wide, while delivered-day payouts continue under the pilot loss-absorption rule. Claims themselves do not hold payout.

Release locks money sources in ascending order, then booking, visit and installment. It rechecks entitlement, holds and refund reservations, and commits exact cents, Connect destination, original charge, metadata and `kitchen-day-transfer:{sourceId}:{visitId}:{allocationRevision}` before provider I/O. A pending installment reservation blocks refunds through the common money guard. Unknown attempts retain their frozen parameters and reconcile by operation/ installment metadata, validating amount, currency, destination, charge, group and metadata before saving a transfer ID. Discovery is bounded to one complete provider page; incomplete/ambiguous evidence fails closed. Parent transfer IDs are never written.

The recurring worker has a separate bounded source/fee recovery page and installment retry page, with rotating cursors and one-hour retry backoff. Inspection release, supplemental payout release and support retry use the same daily engine. Legacy capture/webhook/manual-sync dispatchers continue to refuse `per_day` transfers.

Supplemental extra-time charges resolve their persisted extension visit; WP-RS supplemental charges require an explicit visit or validated day component manifest. Both use actual verified charge/balance evidence and the same installment engine. Dated extra-time pricing/creation and dated change creation remain gated by the earlier checkpoints; this does not enable those features.

## Reporting and support

One durable payout notice per release run summarizes its day installments. Payment history retains original transfer evidence separately for every transfer. Immutable documents retain one chef receipt per charge and issue one kitchen remittance per day transfer; final settlement waits for remaining day shares. Bank payout statement inputs include daily transfer lines. Revenue V2 uses correlated installment sums, preserving one charge row for gross/fees/refunds; date reports include installment release events. Legacy revenue/repository paths use sent installment net. Upcoming totals list unpaid installments separately. Admin booking-support shows installments and offers a scoped retry through the existing audited payout action.

Migration `0102_day_payout_problem_scope.sql` adds nullable visit scopes to problems and flags; existing NULL rows remain booking-wide. It must be deployed before this code is enabled. It is executed only in the PGlite test fixture in this task; no development/live migration application is authorized.

## Verification

Implementation is committed before final verification. Tests and the single foreground `npx tsc --noEmit -p tsconfig.json` invocation are recorded below after completion.

## Limits

Unallocated or unreconciled refunds fail closed pending CP6; no daily refund engine is introduced here. Supplemental changes without an explicit visit/component manifest need support review rather than an inferred split. No live Stripe, deployment, migration application, Vercel or Inngest operation is performed.
