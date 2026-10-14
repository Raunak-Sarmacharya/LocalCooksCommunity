# Environment verification and diagnostic ledger

Investigation date: 2026-10-11. Baseline branch `development`, commit `1417751f50d730f581dd2cd39162163f3a9c5dae`. Existing unrelated worktree edits were present before investigation. No production database accessed; no external writes or communications performed.

Evidence classes: F founder; R code/config inspected; T diagnostic executed; O direct operational evidence; E current official external source; I inference; J judgment; Q unresolved. Configuration is not proof of a running deployment. Historical operational reports in repository documents are attributed historical evidence, not fresh O verification.

## Effective local inputs inspected without exposing secrets [R]

Inspection parsed `.env` and overlaid the current parent process environment. Only key presence, endpoint hosts/ports, nonsecret resource names and Stripe key-mode prefixes were output. No credentials, complete connection strings, sender addresses, private keys or tokens were printed. Only `.env` exists locally; `.env.example` and `client/.env.example` are examples, not active configuration. A separate deployed server, shell, Vercel build or browser bundle may use other inputs; these remain Q.

| Resource | Local finding and routing evidence | Isolation / action status |
|---|---|---|
| SQL application | `DATABASE_URL` host `aws-1-ca-central-1.pooler.supabase.com`, port 6543; `server/db.ts` uses this URL through pg/Drizzle | Founder identifies dedicated development F; exact-host-guarded READ ONLY query of test aliases completed O-dev (E04). No production Neon accessed. This does not verify a deployed server's DB. |
| SQL recurring worker | `LIFECYCLE_WORKER_DATABASE_URL` absent; falls back to application URL (`server/services/recurring-worker.ts:20`) | Source rejects Supabase transaction pooling on port 6543 (`assertWorkerSessionConnection`). Local worker cannot meet its session-lock connection requirement as configured. No persistent change made. |
| Server | `.env` `NODE_ENV=development`, `BASE_URL=http://localhost:5001`; npm dev imports dotenv; default development port 5001 (`server/index.ts`, `package.json`) | Inputs only; no server started and no assumption that an existing server uses them. GET booking routes can perform lazy financial expiry, so not used as harmless probes. |
| Stripe | Secret and browser publishable keys both have test prefixes. Webhook signing secret present; API version in code `2026-02-25.clover` | Credential mode confirmed R; platform account, connected account IDs, webhook destinations and receiver DB unverified Q. No Stripe call made. Test prefix alone cannot certify webhook routing. |
| Inngest | Event key, signing key, serve origin, lifecycle environment and enable flag absent from inspected local inputs | No local environment proven. `isDev:false` client defaults to `localcooks-lifecycle`; signing-secret absence fails closed. No events sent. Deployed staging is a different configuration Q. |
| Firebase Auth | Server/client project `formauth-9e620`; credentials present; client `getAuth(app)` and server Admin SDK use project auth | Shared-project identity namespace; no auth tenant/emulator routing established. No synthetic Firebase users created. |
| Firestore chat | `FIRESTORE_DATABASE_ID` and `VITE_FIRESTORE_DATABASE_ID` absent. `shared/firestore-database.ts` defaults to `(default)`; `server/chat-service.ts:21`, `client/src/lib/firebase.ts:28` call it | Local configuration selects default database I from explicit R routing. Named `staging` exists in source and historical audit, but omission is not isolation. No Firestore reads/writes executed. |
| Firebase Functions | `functions/package.json` exposes `lib/staging.js`; `functions/src/staging.ts` selects named staging, `STAGING_DATABASE_URL`, `STAGING_INNGEST_EVENT_KEY`; restricted staging service identity | Staging path present R. Bound deployed secrets, SQL identity and current Inngest destination need fresh verification Q. Do not execute whole audit script indiscriminately: it also inspects production function/rule fingerprints. |
| Firebase Storage | Client names `formauth-9e620.appspot.com`; project config alone supplies no test boundary | No upload/delete allowed. Actual use requires route tracing; project storage config does not imply Firebase Storage is the file backend. |
| R2 | Configured bucket `localcooks-training-videos`; shared S3 client built from account/bucket; object key `${folder}/${filename}` (`server/r2-storage.ts:97`) | No development bucket selection or environment prefix guard in this helper R. Credential bucket permissions and public/private document routing unverified Q. No object accessed or mutated. |
| Hostinger SMTP | Configured `smtp.hostinger.com`, credentials present; local EMAIL_FROM/EMAIL_USER `localcooks@localcook.shop`; `server/email.ts:299,357` selects header/envelope respectively | Owner clarified `test_automated@localcooks.ca` is development platform SENDER, not recipient/user F. Owner confirms tour setup differs and booking hasn't been updated; not treated as a configuration defect. Admin `test_admin@localcooks.ca` is approved F and SQL identity verified O-dev. Exact chef/manager/location/recovery recipient allowlist still Q. No actual sends. |
| Twilio SMS | SID/token/from-number present; `server/sms.ts` directly creates client from them, with optional E2E suppression | Cannot infer test credentials from SID format. No test credential/account verification or recipient allowlist proven. Founder suspects no dedicated test environment F/Q. No API call/send. |
| Sentry | Server and client DSNs present, same organization ingest host | Project separation unverified; starting app can emit operational telemetry. No app startup. Diagnostic runner excludes DSNs and blocks networking. |
| Google OAuth/Maps | Client credentials/Maps key present | Authorized origins/quota/billing and test projects unverified. No authentication/maps calls. |

The owner asked us to inspect code rather than guess isolation or recipients. Read-only code inspection continued; uncertain side effects remained paused. A named test inbox does not isolate the other recipients generated by a real booking workflow (manager, chef, administrators, location notificationEmail, recovery owners).

## Experiment E01: graph-assisted repository navigation [T]

- Question: where do booking, payment, refund, policy and communication paths intersect?
- Environment: filesystem only, existing dirty `graphify-out/graph.json`; no rebuild or overwrite.
- Inputs: actual graph vocabulary expansion selected booking/payment/stripe/refund/policy/notification/cancellation/tour/application/inventory/approval; bounded BFS from three matching nodes, depth three, 24 output nodes.
- Observation: graph located Stripe sync/refund and notification sources, but omitted Inngest vocabulary and reflected some older line numbers. Used only for navigation, verified current code directly.
- Cleanup: none; existing graph untouched. Limitation: graph is cached, not authoritative current code.

## Experiment E02: sanitized local configuration inspection [T]

- Question: are effective local resource targets demonstrably test-only?
- Environment: local `.env` parse plus process overlay only, no resource connections.
- Expected: identify independently selected database, Stripe and downstream destinations.
- Observed: Supabase transaction-pooler and Stripe test prefixes; missing Firestore selectors, missing Inngest keys, R2/Twilio/shared project boundaries unverified. Details above.
- Synthetic records: none. Cleanup: none. No secrets exposed.
- Limitations: cannot prove current deployed endpoints or running server configuration. An initial Python dotenv import was unavailable; retried using existing Node dotenv dependency. No environment file changed.

## Experiment E03: isolated booking/payment/workflow regression diagnostics [T, complete]

- Question: do existing tests demonstrate money recovery, request/confirmation distinction, stale reminders, DST, permission checks, webhook signatures and duplicate handling?
- Environment: subprocess gets only OS utility environment, `NODE_ENV=test`, dummy localhost DB URL, E2E suppression, absent dotenv path. Real TCP/TLS/HTTP/HTTPS/fetch denied by temporary preload guard. Existing unit tests use mocked providers/databases and local synthetic IDs. No actual server/resources/recipients.
- Harness: `booking-diagnostic-runner.cjs`, `booking-diagnostic-network-guard.cjs` under this directory, temporary diagnostic tools only, not application implementation. Runs files serially with one worker; no concurrent shared-resource tests.
- Expected: selected existing tests pass or expose current baseline failures without implementation edits.
- Observed: server39 files (30 pass/9 fail),663 assertions (JSON635 pass including1 expected-failure case,28 fail); client4 files,4 pass/1 fail assertion. Two server files fail import of missing local `inngest` / `firebase-functions/v2/firestore` before assertions. Follow-up contract run with dummy `sk_test_investigation_fixture` and `whsec_investigation_fixture`:5/5 pass, no network. Baseline had no Stripe key, making its test-only prefix assertion fail; this was harness setup, not live-key guard behavior.
- Results retained: `booking-server-diagnostics.json/.log`, `booking-client-diagnostics.json/.log`, `booking-contract-diagnostics.json/.log`. JSON nested-suite totals differ from file totals; file counts are derived from testResults, not numPassedTestSuites.
- Failure reconciliation:21 tour cases concern copy/time-format/support/public-guidance expectations;1 request email +1 client policy test expose missing hold-release copy;1 visibility expects obsolete chef tour arrival;1 checkout fixture supplies nonconsecutive slots now rejected;1 retired confirm-checkin route410 vs expected404;2 availability fixtures omit IDs and are excluded when both ID/exclude-ID undefined, not a proven real overlap bypass. No application edits made to pass tests. Financial recovery/reminder/permission/signature tests listed in consolidated report pass with mocks.
- Cleanup: no remote records created. Removed only the two investigation-owned temporary runner/guard scripts after completion; results retained. Network guard denied real TCP/TLS/HTTP/fetch; tests may replace mocked fetch but underlying sockets remained denied. Server dotenv pointed to nonexistent file; Vite configuration can independently load browser build settings, so credential stripping is not a claim about every tool's dotenv internals. Real service calls were prohibited.
- Limitations: mocks do not prove actual Stripe processing, card-network expiry, database constraints/concurrency, deployed Inngest routing, SMTP inbox arrival or real-time latency.

## Experiment E04: exact development test identity lookup [O-dev, complete]

- Question: is automated address a development recipient identity, and is approved admin account present?
- Verified environment: owner identifies development Supabase; guarded exact effective hostname `aws-1-ca-central-1.pooler.supabase.com`,port6543 before connection. Did not import application, middleware or worker.
- Inputs: existing pg/dotenv modules; query parameters only local parts `test_automated` and `test_admin`. `BEGIN READ ONLY`, `SHOW transaction_read_only` returned `on`,3-second statement timeout,5-second connection/query timeouts. `SELECT username,role FROM users` filtered ONLY exact test local parts. No other user/phone/location records queried.
- Expected: identify candidate test users without disclosing private user data or altering records.
- Observed: `test_admin@localcooks.ca`,roleadmin; no `test_automated` user. Owner subsequently clarified automated mailbox is SENDER, so its absence in users is expected, not a defect.
- Cleanup: transaction rolled back, connection closed; no synthetic records/remote mutations, nothing retained in database. Sender header/authenticated username later inspected from local configuration without passwords.
- Limitation: SQL username existence is not inbox arrival verification. Owner approved admin inbox; other customer/manager recipients unverified. Pooler host alone is not project ownership proof; owner identification plus guarded effective endpoint scoped this bounded read only.

## Owner clarifications and local tooling

- F: exact automated sender is `test_automated@localcooks.ca`, admin test recipient `test_admin@localcooks.ca`. Do not confuse sender identity with authorization to message all development users.
- F: tour sender changes were already made as needed, booking has not yet been redone; use tour selectively as inspiration, not wholesale specification. No sender config changed here.
- F: Firebase/R2/Twilio dedicated test resources are doubtful; no approved SMS number supplied. Keep uncertain-path diagnostics mocked.
- Work ran from E: project. Attachment and installed skills/T3 live on C:; Python PDF extraction dependency was installed into investigation-owned system temporary folder before E: preference was supplied. Extract retained under docs/architecture on E:. No repository dependency/configuration changed; temporary dependency directory intentionally retained rather than broad system cleanup.

## Operational evidence status

`docs/chat-message-emails.md` records October 7 staging activation, both-direction user-observed inbox delivery, Inngest run/SQL intent identities and remaining untested one-hour timing. This is an attributed historical report R/O-history, not a fresh verification. Earlier failure paragraphs are superseded by later activation/fix paragraphs; reading only the initial report would incorrectly claim the producer is still broken. No production guarantees follow from those staging observations.
