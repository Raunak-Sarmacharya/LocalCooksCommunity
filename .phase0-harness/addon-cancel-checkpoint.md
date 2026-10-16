# Fix round 1

1. Frozen late tier -> add-on quotes and execution now keep the policy engine's 50% refund instead of forcing every late removal to zero; chef, kitchen, admin, history, and en-CA/fr-CA/uk copy use the actual outcome -> covered by 50% and 100% server, chooser, notice, admin, history, and fee-pending tests.
2. Automatic refund recovery -> booking support now offers exact-operation **Retry refund** and receipt-only **Mark refunded after checking Stripe** actions; notes are required, strict provider evidence is recorded, manual retry uses a new refund key and the original reversal key -> covered by server and client booking-support tests plus retry-key and receipt-evidence tests.
3. Provider transaction boundary -> add-on provider facts are read before reservation, provider mutations run after the reservation transaction commits, and reconciliation fetches Stripe facts before its locking transaction -> covered by reservation/retry tests and touched-file type check.
4. Kitchen debt -> platform funding is persisted before refund retry, debt survives lost responses in payment metadata, reconciliation moves it to open, kitchen/admin copy says repayment is manual, and only the explicit reversal-balance error creates debt -> covered by normal, lost-response, unrelated-insufficient, notice, and support-console tests.
5. Kitchen-caused component settlement -> saved component refund and funding allocations are included in later whole-booking policy calculations -> covered by the later-cancellation regression test.
6. Missing/contradictory payment evidence -> positive or contradictory add-ons are refused with the plain payment-review message and an admin support event; only verified zero/never-captured allocations are uncharged -> covered by missing source, missing link, zero-price contradiction, and money-guard tests.
7. Crash-safe finalization -> removal reservations persist a finalization intent, and the recovery sweep finalizes paid, successful, and free removals once -> covered by interruption tests before provider completion and before free-removal finalization.
8. Shared completion -> route, worker, support retry, and provider reconciliation use the same idempotent add-on finalizer, including receipts and role-specific notices -> covered by webhook reconciliation and replay tests.
9. History state -> processing and fee-pending removals remain pending until the correlated refund event supplies the verified amount, then fold into one row -> covered by shared history and panel tests.
10. Legacy kitchen acceptance -> settled component receipts are matched to frozen allocations, so another legacy cancellation request on the same charge keeps its remaining entitlement -> covered by the mixed new-removal/legacy-accept test.
11. Refund review privacy/currency -> add-on operations use normalized cent fields and named items; chef/kitchen views show party name/date and plain status while hiding transaction, provider, item IDs, and raw errors -> covered by CancellationRefundReview tests.
12. Stale chooser quote -> a 409 clears and reloads the affected quote, disables confirmation while loading, preserves completed items and the request key, and succeeds only after reconfirmation -> covered by the stale-quote second-confirmation test.

Validation:
- `npx vitest run -c vitest.config.server.ts --testTimeout 10000 server/services/booking-cancellation-refund.test.ts server/services/addon-removal-notice.test.ts server/services/admin-booking-notice.test.ts server/services/booking-support.test.ts server/services/payment-refund-reconciliation.test.ts server/services/booking-money-guard.test.ts shared/booking-history.test.ts shared/cancellation-refund.test.ts` -> 7 files, 195 tests passed (the requested reconciliation path is exercised in `booking-cancellation-refund.test.ts`; there is no standalone reconciliation test file).
- `npx vitest run client/src/components/booking/BookingCancellationChooser.test.tsx client/src/components/booking/CancellationRefundReview.test.tsx client/src/components/admin/booking-support/BookingSupport.test.tsx` -> 3 files, 55 tests passed.
- Follow-up retry-key run -> 2 files, 94 tests passed.
- Temporary focused tsconfig extending the root config, including touched source files and `client/src/**/*.d.ts`; `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` -> passed.
- IDE diagnostics for touched source directories -> no errors.
- `git diff --check` -> passed.

No migration is required. Kitchen debt is recorded and surfaced for manual recovery; automatic payout netting remains intentionally deferred.
