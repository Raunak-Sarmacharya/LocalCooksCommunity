# Build plan: admin "Booking support" case screen (P0 pilot gate) — parent-authored 2026-10-13

Source: `audit-admin-support-controls.md` §2/§4 (P0), narrowed by owner decisions (PHASE0_LOG "Oct13 late"):
- **One support person** (the owner): no second approver. Every action requires a reason code and an internal note, is audited, and notifies both parties.
- **Goodwill cap $25** per booking, funded by Local Cooks. Above it: a second explicit confirmation, and the action is recorded as `exception`.
- **Chargebacks and payout failures:** flag the booking, notify the admin (email + in-app), freeze conflicting refunds and transfers for that booking, and keep chef/manager messaging calm and trustworthy. Resolution happens in the Stripe dashboard for now.
- Kitchen-caused cancellation after confirmation: **chef gets 100%**; the pilot Stripe fee is absorbed by Local Cooks and recorded (locked earlier).
- Standing rule D11: support can act for either side in every state, with no raw SQL and no generic status/amount editor.

Prerequisite: Package E (booking emails on the notice shell) has landed; support notices reuse that shell. The cancellation-policy engine is NOT a prerequisite. Chef-caused cancellation by staff uses the current request → manager-accept refund path with `acting_for`. When the engine lands, it plugs into the same action.

## Data (migration 0077; multi-day moves to 0078+)

`support_actions` (append-only):
- identity: id, booking_id, case_ref (booking reference), action_type, actor_user_id (real staff), acting_for (`chef | manager | local_cooks`), request_source (`message | call | email | in_person | proactive`) + source_ref;
- why: reason_code, internal_note (required, ≥10 chars);
- money: amount_cents, currency, funded_by (`manager | local_cooks | none`), exception boolean;
- state: before_state jsonb (non-secret fields), after_state jsonb, operation_key (unique), provider refs (refund/transfer/PI ids), status (`executing | verified | failed | recovery_required`), error, notified_event_ids, created_at, completed_at.

`booking_flags`: id, booking_id, kind (`chargeback | payout_failed | transfer_failed | manual_hold`), provider_ref, opened_at, resolved_at, resolved_by, note. While a flag is open, refund and transfer writers for that booking refuse with a clear error. Enable RLS and revoke PUBLIC on both tables, as in 0075.

## Server — Codex GPT-6.1 Sol high

New `server/services/booking-support.ts` + routes in `server/routes/booking-attendance.ts` (existing staff routes live there) or a new `server/routes/admin-booking-support.ts` mounted with `requireAdmin`.

1. `GET /admin/booking-support/search?q=` matches reference (`KB-…`), booking id, chef/manager name or email. Returns compact rows.
2. `GET /admin/booking-support/:bookingId` returns the case view:
   - parties and contacts; kitchen/location; schedule in kitchen local time with a friendly zone label;
   - status, payment, check-in and visit-code state (redacted, never digits), with deadlines (response, inspection, closeout);
   - money summary (captured, refunded, platform fee, processor fee, transfer status);
   - open flags; chronology merged from lifecycle events, payment history, email_logs, support_actions and commitment problems;
   - `availableActions[]` computed from state, each with a money preview.
   Reuse `GET /admin/bookings/:id/support` data where it fits.
3. `POST /admin/booking-support/:bookingId/actions`, body `{type, actingFor, requestSource, sourceRef?, reasonCode, note, amountCents?, confirmException?, operationKey}`. Each action reuses the existing service, never a raw update:
   - **pending:** `confirm_for_manager` (items; `decideAuthorizedBooking`), `decline_for_manager`, `release_hold_for_chef` (existing cancel-authorization).
   - **payment recovery:** `replay_payment_decision` (existing recover-payment).
   - **confirmed:**
     - `cancel_kitchen_caused`: full refund to the chef; the fee is absorbed by Local Cooks and recorded; codes are revoked and linked items handled via `cancelLinkedBookingDates`.
     - `request_cancellation_for_chef` and `accept_cancellation_for_manager`: the current refund path, recorded `acting_for`.
   - **visit:** `issue_visit_code`, `set_arrival_mode`, `record_assisted_arrival` (existing visit-assistance), `correct_attendance` (existing attendance correction), `clear_checkout_for_manager` / `report_issue_for_manager` (existing inspection service).
   - **goodwill:** `goodwill_refund` up to $25, funded by Local Cooks (separate charges: the refund debits the platform; do NOT reverse the kitchen transfer). Above $25 requires `confirmException: true` and is marked exception.
   - **notices:** `resend_notice` (re-queue a failed lifecycle email for a given event/recipient; never resend an already-accepted one without `force` + reason).
   - **flags:** `open_flag` (manual_hold), `resolve_flag`.
   Common to all actions: an idempotent `operationKey`; persist the support_action row BEFORE provider I/O; verify the provider result; queue lifecycle notices to both parties via the outbox ("Local Cooks support updated your booking: …", with no internal note text); return the updated case.
4. **Disputes and payout failures:** in `routes/webhooks.ts`, handle `charge.dispute.created/updated/closed`, `payout.failed` (Connect) and transfer failure events. Open or resolve a `booking_flag` for the linked booking, notify admins (email + in-app, via the notice shell, CTA to the case page), and freeze. Chef copy, only if the chef must act: none for disputes (it's between the bank and Local Cooks). Manager copy for a payout failure: "We couldn't send your payout for KB-… — update your payout details" with a link to Stripe Connect onboarding.
5. Tests: state × action matrix (allowed/refused), idempotency (same key twice → one provider op), goodwill cap, flag freeze blocks refund/transfer, notices queued to both parties, no visit-code digits in any response. Mocked Stripe and DB fixtures.

## Client — Claude Sonnet

1. Admin sidebar: "Booking support" (top of Management). The ⌘K reference match opens the case page (`/admin?section=booking-support&booking=:id`), not Transactions. Add a "Open booking support" link on the Transactions row.
2. Case page:
   - Header: reference, status chips, flags in red, parties with contact buttons, kitchen-local schedule with a zone label.
   - Left: facts (money summary, deadlines, visit code state, payout).
   - Right: chronology (newest first, filter chips).
   - Sticky "Take action" panel listing `availableActions`.
3. Action dialog (in-app dialog, never `window.confirm`):
   - fields: acting for, request source, reason (select), internal note (required);
   - money preview (chef receives / manager pays / Local Cooks pays / processing fee);
   - "Both parties will be notified" text;
   - exception double-confirmation above $25.
   - Success: toast plus case refresh.
4. Times in admin always show the kitchen local time with a zone label (fixes UTC-without-label in Transactions too).
5. Remove the stale "Damage Claims" admin navigation entries if damage deposits are fully retired (verify there are no live claims first; otherwise keep history read-only and list it in the checkpoint).
6. Tests for the action matrix rendering, the dialog validation and the exception confirm.

## Live test (parent)
On dev, with synthetic bookings, one per state: pending (confirm for manager), confirmed (kitchen-caused cancel → 100% refund verified in the Stripe sandbox), visit (assisted arrival, code reissue), checkout (clear for manager), goodwill $10 and $30 (exception), simulated dispute webhook (Stripe CLI trigger in sandbox) → flag + admin email + refund blocked.
