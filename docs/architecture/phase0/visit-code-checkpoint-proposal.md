# Visit-code checkpoint proposal

2026-10-12. Reviewable proposal, not implemented or migration approval. Read `PHASE0_LOG.md`, `manager-visit-preparation.md` and the original eight-phase roadmap. Arrival/departure tab layout is the current UI checkpoint; this is its next verification dependency.

## Selected direction and evidence limits

The owner selected a visit-specific kitchen-issued attendance code, no station, with staffed and unattended arrival. Instructions are essential; managers may add no tasks, but newly added tasks/photos are required at their assigned stage. Existing accepted duties and explicitly optional legacy records remain unchanged. Arrival is evidence, not an invoice clock or payment-release trigger.

[The Food Corridor](https://help.thefoodcorridor.com/en/articles/1414030-how-do-i-digitally-sign-in-out-at-my-kitchen) documents a personal four-digit PIN on a phone or station. [Airbnb self check-in](https://www.airbnb.com/help/article/1207) describes unattended access methods. [Airbnb smart-lock codes](https://www.airbnb.com/help/article/3483) are unique reservation door credentials, sent before arrival but active only during the stay. These are useful references, not proof of universal mandatory app taps, independent presence verification, or Local Cooks hardware support. Sources checked Oct12. Local Cooks attendance confirmation must remain distinct from a building door/lock credential.

## First, repair the existing clock boundary

The split-visit service already loads a location timezone, but arrival/departure bounds use a fixed Newfoundland zone. Manager assistance also formats reported time using the default zone. A bounded Sol High task is checking and repairing actual mismatches using existing saved windows and UTC instants. Do not reinterpret stored timestamps, choose a new arrival window or introduce code validation until client/server eligibility agree. Duplicate successful arrival currently needs an idempotency design; state alone cannot prove that a retry is the same accepted request.

## Customer experience

Use the existing full-page arrival flow: operational instructions, configured tasks/photos, then Confirm arrival. For staffed visits, show one numeric visit-code field: “Kitchen staff will give you your visit code when you arrive.” Submit code and evidence together; a correct code never bypasses required tasks, status/window or identity checks.

For self-service visits, the owning manager deliberately enables/shares self check-in on that visit. The authenticated booked customer follows the instructions and confirms arrival without copying a code from one screen back into another. Record that method distinctly. This is not a magic-link login, proof of physical presence, or permission to expose door secrets in a general listing/email. Checkout uses the existing departure flow without repeating the arrival code.

Wrong/stale code retains the field and evidence with an actionable message to ask for the current code. Before the existing window, display its kitchen-local opening time. After the window, cancellation or closure, submission is unavailable and assistance remains accessible. Offline/rejected requests keep drafts while mounted; do not promise persistence across reload unless implemented and tested. Manager absence leads to contact/support and an explicit self-service or assisted-arrival action, never an automatic bypass.

## Manager experience

Place the code/mode in the existing owned booking detail and correct visit card. Show customer, kitchen and local visit time next to the code. “Issue new code” revokes the prior revision with a focused confirmation. “Set up self check-in” clearly states that the customer can confirm without staff and that the kitchen must provide access instructions. Switching back revokes prior self-service permission. Record actor/time/reason as appropriate. Once arrival is recorded, show the method and time, not a reusable code.

Today/Customers can later link to this existing action. Do not build a new CRM as a dependency. Preparation notices describe the current mode and link to the authenticated booking; no attendance code in a broad list, email, log or participant API. Existing preparation timing remains a separate worker/durable-timer checkpoint.

## Persistence, security and rollout proposal

Most ordinary/contiguous bookings have **no** `kitchen_booking_visits` row: those rows currently represent separated blocks. A code design only adding columns to that table would omit ordinary bookings. Resolve one canonical arrival target for every booking: booking-level legacy/single visit, or a verified split-visit ID. Prefer one durable challenge record keyed uniquely to that target, rather than duplicating writers/credentials across both existing tables. Exact schema and migration are a separate review gate.

The record needs the accepted verification mode, revision, target/schedule/customer binding, issuing/sharing actor and time, committed failed-attempt count, and successful request identity/outcome for safe replay. Use a dedicated server-held key with an explicit rotation strategy; a keyed derivation of a six-digit code avoids stored plaintext and unkeyed low-entropy hashes. Code generation, key provisioning and attempt limit are proposed implementation details, not installed configuration. Proposed trial limit: five wrong attempts per target/revision, with owning-manager rotation or audited assistance recovery. Endpoint throttling is additional protection, not a substitute for durable counters.

Validate current ownership and booked customer before disclosure/verification. Lock and revalidate booking/target/revision/status/saved window; commit evidence, challenge consumption, arrival and one outbox event atomically. Failed attempts must commit without recording arrival. Concurrent duplicate requests produce one arrival/notice; replay returns the original permitted success only for the same accepted operation, never overwrites original evidence or accepts a different actor/payload. Cancellation/closure invalidates eligibility. Reschedule, customer reassignment or mode/code changes invalidate the bound revision. Historical method remains visible after closure; credentials do not.

Owner-selected rollout: **new confirmations only**. Owner reports there are currently no production bookings, so no separate existing-customer conversion experience is needed. This is owner-provided context, not a production database audit. Existing development fixtures retain their accepted tap/assistance behavior; do not rewrite them or add a retrospective customer-consent flow. Enrollment must cover ordinary single and split visits, be snapshotted at confirmation, and have a local synthetic trial before deployment. A public legacy tracking toggle is not a substitute for this rollout boundary.

## Successful checkpoints

1. Existing location-zone arrival/departure/assistance boundaries agree with the client; UTC storage and original saved windows remain correct.
2. Staffed arrival accepts the right code with required evidence once; wrong, rotated, exhausted, early/late, cancelled and foreign-customer attempts fail without disclosure or duplicate notices.
3. Ordinary single and separated multi-block bookings both target the correct challenge; another visit's code cannot authorize this one. Lost-response retry returns the original success without replacing evidence.
4. Self-service requires a recorded owning-manager action; the customer sees the correct mode/contact/instructions. Revocation and assisted/offline recovery remain understandable on both sides.
5. Privacy tests cover manager ownership, participant projections, logs and captured SMTP. No code/mode operation changes money, inspection deadline, service-end clock or claim entitlement.
6. Local authenticated browser/API/SQL trial verifies both modes, failure/retry and desktop/mobile accessibility. Only after that is the checkpoint eligible for a development push; production enrollment remains separate.

The schema, key provisioning, exact trial enrollment and security limit need concrete implementation approval before persistent changes. No migrations, code credentials, notifications or settlement changes were performed for this proposal.
