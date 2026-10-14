# Manager setup, preparation and visit-code continuation

Updated 2026-10-12. Read `continuation-handoff.md` and `PHASE0_LOG.md` first. This extends the existing eight-phase roadmap; it does not authorize migrations, new financial writers, production rollout or new numerical policy clocks.

## Latest owner decisions

- Visit-code verification applies to new confirmations only. Owner reports no existing production bookings; do not build a retrospective customer migration experience. Existing development fixtures retain their accepted arrival flow. Persistent credential schema/key changes remain the implementation review gate.

- Arrival/departure instructions are essential kitchen setup, rather than a legacy optional tracking feature. The existing publication gate already requires both notes. Guide the manager through arrival instructions, departure instructions, optional-added tasks and customer preview. Remove misleading opt-in wording without leaving a kitchen unable to publish or silently changing old bookings.
- Adding a checklist is optional for the manager. Once a manager adds a task, the customer must complete it at its assigned stage. Photos are required only when requested. Zero-task setups remain valid. Preserve pre-existing explicitly optional legacy flags on ordinary edit/save; do not silently convert historical data or relax already-accepted requirements.
- The selected code is visit-specific and kitchen-issued, not a persistent personal PIN or a sign-in station. Most arrivals have staff present, but the flow must also support an unattended kitchen whose manager deliberately shares self-check-in details.
- Preparation emails should contain useful arrival/departure guidance and a link to the current booking, matching the quality of tours. Hide the live preparation panel after completion/cancellation while retaining historical evidence for permitted support/dispute work. Already-delivered emails cannot be withdrawn.
- First special-offer/invitation checkpoint is before confirmation. Changes to confirmed/paid bookings remain later. A customer acceptance page must show the complete proposal and payment/policy implications; one-click entry does not remove authentication, explicit acceptance, provider challenges or final financial verification.
- Manager customer context is requested: application, tour, access, booking, active session, checkout and whose action is due. Reuse existing views before adding a new section; respect kitchen ownership and private support/feedback boundaries.

## Current evidence and corrections

The manager editor's `itemsToStorage` writes every item/photo as required. Its unified stage flags assign the task to arrival/departure; they are not a customer optionality switch. Saved duty validators and chef UI support `required:false`, so conversion must preserve older explicit optional data even though the current new-item default stays required.

Instructions are location-scoped (`CheckinCheckoutSettings`), with separate per-kitchen enablement (`KitchenWorkspaceControls`). Publication uses the location notes plus both stage flags and the kitchen flag. A cosmetic removal of the last toggle is insufficient if it leaves stored-disabled kitchens with no guided completion action. Existing bookings' accepted duty snapshots must remain stable. Integration of these two scopes is still a checkpoint, not a completed side effect of a clearer form.

Booking preparation/arrival reminders already exist in `server/services/advance-reminders.ts` and already incorporate saved duty instructions. Unlike tours, they used plain email. They currently run through the Inngest-backed recurring worker: the event-driven `bookingNoticeDelivery` handles state notices, not exact per-booking preparation timing. Current source defaults are preparation 24 hours, arrival 2 hours and departure 30 minutes; admin-configured values apply. These are observed defaults, not newly chosen values. Keep catch-up consolidation, current-state revalidation, recipient revision, cancellation/completion suppression, accepted-attempt deduplication and recovery.

Parent verified Code Buddy's read-only trace against current source. Its recommendation against a per-booking timer is not an owner decision: precise durable due-time scheduling still needs its own design/checkpoint. Its storage/non-coupled wording observations must not be applied indiscriminately to the coupled kitchen panel. Publication remains mandatory; no new decision is required to preserve that gate.

Local preparation repair uses the existing transactional email shell for booking preparation/arrival/check-in-open/departure, with current kitchen, reference, kitchen-local start/end, saved instructions, contact and booking link. It does not change timing, activation policy or provider settings, and does not promise a PIN that is not implemented. The live preparation panel is hidden on completed/cancelled detail/direct-visit views; recorded timestamps, checklists and notes remain. API-level redaction of future access secrets is separate from cosmetic hiding.

## Practical code flow proposal

No PIN/code verification is implemented yet. Code format/storage, exact disclosure/release timing and the persistent migration remain reviewable implementation decisions.

For a staffed visit, manager Today/customer/booking views should expose an Arriving task and a clearly named visit code when relevant. The customer opens the same arrival page, reads instructions, enters the code once, completes configured required tasks/evidence and confirms arrival. The server validates ownership, kitchen, visit, current status/window and the current code revision. A matching code records kitchen-issued-code confirmation; it is not independent proof of physical presence or service delivery.

For unattended arrival, the manager explicitly selects/shares self-check-in details for that visit. Preparation guidance links to the authenticated booking, with the current instructions and clear self-service confirmation. A pre-shared code adds no independent presence evidence. Prefer a visit-bound authenticated link that avoids copying a code between screens, while retaining the kitchen-issued visit challenge and recording self-service provenance. This is a recommendation to review, not an already implemented bypass. The building's door/key/lock code is a separate access credential and must not be conflated with attendance confirmation.

The same departure page needs no repeated arrival PIN. It presents instructions and required configured actions, then records checkout for inspection. A forgotten or offline tap has a reasoned manager/Local Cooks assistance path and a separate scheduled-end/closeout fallback; it cannot indefinitely block settlement or automatically prove absence/overstay.

Checkpoints before enabling the code flow:

1. One authoritative challenge per visit, protected at rest; manager disclosure only for owned kitchen/visit, authenticated customer use only for the booked customer. Never log plaintext codes or put them in public listing data or broad customer lists. No new login credential or hardware requirement.
2. Idempotent consumption/retry; a stale/rotated code does not duplicate arrival. Booking cancellation, reschedule, reassignment and closure revoke/supersede access to the relevant challenge. Multi-block bookings target the correct visit.
3. Staffed/self-service provenance, deliberate manager sharing, actionable wrong/expired/unavailable-code errors, bounded guessing/attempt abuse, visible assistance and reconnect behavior. Do not select new attempt/expiry numbers silently.
4. Notify the manager before the expected arrival using approved configured timing; customer preparation distinguishes staff handover from self-service. Re-read current mode/status/revision before sending. Late bookings get useful consolidated guidance, not stale repeated mail.
5. Permission tests, failure/race/replay tests and synthetic browser/API/DB checks for both arrival modes. No payment release on a code match, missing tap or early manager inspection clear.

## Before-confirmation invitations and offers

[Airbnb special offers](https://www.airbnb.com/help/article/35) support custom prices/dates before booking and explicit guest acceptance. [Peerspace custom invite-to-book](https://support.peerspace.com/en/articles/11642753-how-to-send-a-custom-offer-using-the-invite-to-book-feature) similarly lets hosts prepare an offer that the guest reviews and pays. Airbnb's help pages differ on whether an already-pending request may receive a special offer; do not import that inconsistency as Local Cooks behavior. Its [confirmed-price-change guide](https://www.airbnb.com/help/article/1505) clearly preserves the original booking if a proposed confirmed change is declined or unanswered.

Recommended first offer: manager selects the eligible customer/kitchen, date/slots, supported extras and a one-off kitchen-price adjustment; previews the customer total and own estimate; sends a private versioned proposal. The customer sees an itemized full-page review including tax, any positive platform fee, cancellation terms, instructions/tasks, expiry and availability limits, then accepts and completes payment. Acceptance carries manager preapproval; no second redundant manager approval should be required if the exact offer and capacity are still valid. Availability/payment must be verified before Confirmed is presented.

Changing an already-requested price must not silently rewrite a held PaymentIntent. Offer version, old hold disposition and new consent/authorization must be reconciled through an explicitly designed transition. No new writer is enabled by this document. Discount authority is the manager's rental allocation, not the platform fee or configured tax. Zero/positive fee cases, competing acceptance, expired/withdrawn/replaced offers, recipient eligibility, failed payment, linked storage/equipment, audit and notices require their own tests. Offer expiry/hold policy is not selected here.

## Manager Customers and Today proposal

Customers should provide one relationship view, with application/access status, relevant tours/bookings and a linked next-action timeline. Today should answer who is expected, who has recorded arrival, who is using the booked time, who submitted checkout and what requires inspection/assistance. Missing recorded check-in must remain distinct from confirmed absence. Each task identifies its owner, due time in the kitchen zone and existing source action; this view does not create another state writer.

Do not expose other managers' kitchens, private Local Cooks notes/feedback, unrelated applications, full financial/card data or unnecessary personal documents. Multiple kitchens/locations, an application without booking, tours without access, simultaneous separate visits and disabled/closed relationships need explicit visibility tests. `TodaysKitchenBookings` already exists; the exact current integration and ownership-safe aggregate contract are under read-only investigation before adding navigation.

## Research basis and scope

[Food Corridor sign-in/out](https://help.thefoodcorridor.com/en/articles/1414030-how-do-i-digitally-sign-in-out-at-my-kitchen) uses a personal four-digit PIN, phone or station; Local Cooks' visit-specific/no-station choice is the owner's product direction, not an exact clone. [Airbnb self check-in](https://www.airbnb.com/help/article/1207) separates unattended building access from host presence. [Airbnb check-in instructions](https://www.airbnb.com/help/article/100) places guidance in the reservation and reminds guests to check email/messages. [Vrbo welcome guides](https://help.vrbo.com/articles/What-is-the-welcome-guide) are emailed before arrival and unavailable after checkout/cancellation; this supports the selected live-display lifecycle without deleting historical records or promising email withdrawal.

Local writes and mocked tests are authorized. No real invitations, code notifications, production settings, migrations or settlement changes have occurred. See the running log for active delegated tasks and validation counts.
