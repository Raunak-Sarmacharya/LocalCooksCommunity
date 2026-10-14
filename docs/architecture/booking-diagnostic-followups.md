# Meaningful unresolved diagnostics and evidence needed

2026-10-11. These are prioritized investigation follow-ups, not executed results or final target acceptance tests. Q/J throughout. No new application tests, schema/config changes or real-provider experiments performed. Target architecture acceptance/production observability is still gated.

## Safe local/mocked reproductions to add in the next authorised investigation

1. Tier2 `approved` application versus tier3 UI, including auto-grant and later rejection; distinguish actual eligibility bypass from intended direct-grant access. Test current resolver/route, not only replicated predicate.
2. Paid cancellation submitted before cutoff, clock advanced after cutoff before manager decision; verify accept/decline/auto-accept and exact disclosed refund outcome. Record saved policy and both timestamps.
3. Manager unilateral cancellation of confirmed paid booking: prove booking transition, refund obligation record and subsequent recovery behavior, including existing linked used/unused items. Do not equate requiredManualRefund to completed refund.
4. Pending booking starts before 24-hour request expiry; attempt decision after start/after end/provider capture_before. Validate current guard and what chef sees; no real capture to patch the result.
5. Checkout succeeds then equipment disappears/moves or storage accepted terms disappear; verify no booking/ledger, webhook retry behavior and original PI compensation/recovery. Test refund pending/failed rather than only API method return.
6. Generic first booking confirmation delayed until cancellation/manager reassignment/contact change; check actionable ICS/history/privacy and recipient suppression. Tour replay tests do not prove generic booking behavior.
7. Refund accepted by provider but response lost, pending then failed, duplicate events, charge/dispute race, partial refund before/after transfer; preserve source operation and never fresh refund on uncertain result. Existing fixture-only order tests insufficient.
8. Correct availability fixtures with real IDs before alleging kitchen overbooking; test two cooperating checkout transactions and boundary midnight/DST separately in an isolated database. Add-on capacity requirements must be defined before claiming a particular exclusive-resource invariant.
9. SMTP accept followed by timeout/DB-commit failure across booking/outcome versus tour; distinguish uncertain, retry-authorised and inbox-verified status; no blind retry to real users.
10. Newfoundland spring gap/autumn fold, half-hour offset, overnight operating day, last-minute/short visit, stale reminders and location timezone changes. Simulated clocks prove calculations, not real scheduler latency.

## Gates for real diagnostics

Use the [environment ledger](booking-environment-and-experiments.md). Need exact server/DB/runtime identity; Stripe test platform/connected accounts/webhook receiver; Inngest destination and session-capable worker URL; Firestore named selector and Auth identity boundary; R2 bucket/prefix/token scope; exact chef/manager/location/admin recipients; Twilio test credentials and approved numbers. Test sender alone cannot meet recipient isolation. If any side effect remains uncertain, retain mocks and continue unrelated safe work.

Real experiments should use one clearly labelled synthetic request at a time, record provider/source IDs, expected/observed logs redacted, cleanup only created records, and state limitations. No persistent schema/config change, production access, deploy/reset, or application fix-to-pass is authorised.

## Operational evidence questions

Read-only verified development observations can establish current rate settings, source/build agreement, worker queue age, exact deployed delivery routing and test-account state. Production guarantees require separate authorised operational evidence; production Neon remains prohibited here. Need customer/support incident examples, cancellation lead times/resale, actual fee/refund loss, transfer/reversal failure rates and notification backlog to justify policy thresholds or removing startup safeguards.
