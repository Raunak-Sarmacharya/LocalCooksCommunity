# Phase 0 evidence pack: kitchen booking (current state)

Date: 2026-10-11/12 (Newfoundland evening; DB/Stripe times are UTC). Branch `development` @ `1417751f`.
Scope: environment map, end-to-end walkthrough on the Stripe sandbox, defects ranked, decisions needed. No booking code was changed.

Companion reports (Codex, effort ≤ high):
- `audit-timezone-and-email-parity.md`: code-level timezone and email audit (file:line evidence).
- `research-booking-standards.md`: 87 official sources; P0/P1/P2 standards checklist.

---

## 1. Environment map (verified)

| Resource | Test / dev | Production (reference only, untouched) |
|---|---|---|
| Stripe | Sandbox **Kitchen.LocalCooks Test** `acct_1SmNI9CvcNYAkDXN` (CA, CAD). One webhook → `https://dev-chef.localcooks.ca/api/webhooks/stripe`, pinned to API `2025-12-15.clover` (code uses `2026-02-25.clover`), subscribed to nearly all events, **no Connect endpoint**. | **Local Cooks** `acct_1SmNGrCabyEgIrad`; one live webhook → `chef.localcooks.ca`. |
| Database | Supabase `zjiaghzmmgvswsllzxip` (ca-central-1), shared by every dev deployment and every teammate running locally. | Separate Neon DB. |
| App | Vercel `local-cooks-community`, `development` branch → `dev-chef/dev-kitchen/dev-admin.localcooks.ca` (Preview env). | `chef/kitchen/admin.localcooks.ca`. |
| Inngest | Env `staging-0d2e45a4`, app `localcooks-lifecycle-staging` synced from dev-chef; `lifecycle-recurring-worker` cron is **paused**. `production` and `branch` envs have no apps. | — |
| Email | Hostinger SMTP; dev sender `test_automated@localcooks.ca`; admin recipients controlled by the admin toggle (only `test_admin@localcooks.ca` enabled). | — |

**Shared-environment hazard (confirmed).** Every sandbox webhook is processed by the deployed dev app *and* by anyone running `stripe listen` locally, against the same DB. In this session the two raced and voided a paid booking (§3, C1). Anyone testing locally must not run a local listener while dev is consuming the same sandbox, or dev needs its own sandbox/DB.

### Local harness used (not committed; `.phase0-harness/`, git-excluded)
- `start-local.cjs` aborts unless keys are the sandbox and the DB is dev Supabase. It blanks Twilio/R2/Inngest/Sentry, uses Firestore `staging`, and points SMTP at a dead port. It runs `stripe listen` forwarding to localhost.
- `CAPTURE_MAIL=1` mode sends through the real email path, but only to `smtp-sink.cjs` (127.0.0.1:2525), which writes `.eml` files to `.phase0-harness/mail/`. Nothing is relayed.
- `set-pw.cjs` sets a password **only** on `@localcooks.test` Firebase users.

## 2. Walkthrough performed (all sandbox / synthetic)

| Step | Result | Evidence |
|---|---|---|
| Manager signup + onboarding (business, licence, kitchen, $25/h, oven $25 + $50 deposit, fridge $12/day, hours 06–23 daily, 24 h cancel window, 4 h max) | Works. Setup says "complete" but listing still needs 2 check-in/out blockers. | user 379, location 47, kitchen 54 |
| Stripe Connect Express onboarding (test data) | Works; `charges_enabled`/`payouts_enabled` true; Stripe test bank. `losses.payments=application`. | `acct_1UPWdbCf9PlKmwqd` |
| Admin licence approval | Works; manager email fires. | email_logs 3074 |
| Chef apply → admin step 1 → chef docs → manager approve | Works; every step emails the right people. | APPLICATION-67, email_logs 3075–3090 |
| Book 2 h + oven, pay 4242 | $50 + $25 + HST 15% $11.25 + fee 7% $5.25 = **$91.50**; manual-capture auth; booking pending. | booking 114, `pi_3UPWx3…` |
| Manager approve | Captured. Transfer **$82.56** = $75 + $11.25 − actual Stripe fee $3.69 (estimate showed $2.95; US test card adds 0.8%). | `tr_3UPWx3…` |
| Chef cancel ~40 h before (deadline Oct 12 10:00 NDT) → manager accept | Chef refunded **$82.56 of $91.50**; transfer fully reversed; platform keeps $5.25 (fee); chef loses $3.69 processing. | `re_3UPWx3…`, `trr_1UPX2w…` |
| Decline card 4000…0002 | Stripe shows decline; no booking created. | `evt_3UPX49…bpfdTsy` |
| Retry same checkout with 3DS 4000 0027 6000 3184 | 3DS passed; booking 115 created then **voided ~2 s later** (C1). Chef saw "payment success". | booking 115, `pi_3UPX49…` cancelled by our API key |
| Email content | Captured locally and rendered at 375 px. | `.phase0-harness/mail/0001–0006.eml` |

Not yet exercised: manager **decline** (hold release), manager no-response expiry, cancel inside 24 h, abandoned-checkout expiry, storage booking, damage deposit, disputes, payout failure, DST-day booking.

## 3. Defects ranked

### Critical
- **C1. A paid booking can be voided by a duplicate or concurrent webhook.** `fulfillQuotedKitchenBooking` checks "booking exists for this PaymentIntent" *before* taking the kitchen-day lock (`server/services/booking-checkout-fulfillment.ts:23`). After the lock, a consumed hold raises `KitchenHoldMissingError` and the code cancels the PaymentIntent without re-checking (`:93–97`). Stripe states events can be delivered more than once, so this is a production risk, not only a shared-env artifact. Fix: re-check by PaymentIntent inside the lock and treat "already fulfilled" as success; make fulfillment idempotent per `session.id`.
- **C2. Request/decision/cancellation/refund emails don't go out on time.** These go through the `booking_lifecycle_events` outbox. Only some routes drain it (`deliverBookingLifecycleEvents` callers). Booking-request emails went out only when the manager later approved; the cancellation-requested/accepted/refund emails for #114 were **still undelivered**. The backstop (Inngest `lifecycle-recurring-worker`) is **paused on dev**. In a request-to-book model, the manager is never emailed that a request is waiting.

### High
- **H1. Non-confirmation booking emails are unbranded plain HTML** (`booking-lifecycle-delivery.ts:151–153`): `<h2>title</h2><p>message</p>`, with the same internal text sent to chef, manager and admin. Example to chef: "Payment is authorized and has not been captured." Only `confirmed` uses a designed template. Far from tour parity.
- **H2. Cancellation outcome is not truthful up front.** The listing says "100% refund before confirmation". A chef who cancels *before the deadline* gets 90.2% back ($82.56/$91.50): the processing fee is kept and the service fee needs admin approval. There's no refund preview in the cancel sheet, and chefs can only *request* cancellation, even outside the window.
- **H3. Time is stored host-dependently.** All booking, payment and audit columns are `timestamp without time zone`. In the same table within a minute, one row was written in UTC (00:05) and another in Newfoundland wall time (21:36, from a NDT host). Production on Vercel (UTC) is consistent, but local runs pollute the shared DB, and the design blocks multi-timezone expansion.
- **H4. Date-only values display one day early** (UTC midnight rendered in NDT). Licence expiry 2027-10-15 shows 10/14/2027 in admin. Chef document expiry chosen 2027-06-15 shows 6/14/2027 to the manager.
- **H5. Pricing transparency.** The browse card and booking panel show "$25/hr", and the panel merges "Taxes & non-govt. fees". Canada's Competition Act drip-pricing rule (2022) requires mandatory fees in the advertised price; only sales tax may be added. The equipment dialog shows "$61.00 + $25.00 = $91.50", which doesn't add up on screen.
- **H6. Location time zone is locked and ignored** (Codex audit §1). Manager UI forces `America/St_Johns`. Tours are DST-correct but also hard-wired to Newfoundland. The browser converter is one hour wrong at the NL spring transition.

### Medium
- M1. The $50 equipment damage deposit is never shown to the chef or collected at checkout. Checkout consent says the card may be charged for "future payments" (`setup_future_usage=off_session`), but the app never explains this before checkout.
- M2. PaymentIntent metadata has no `booking_id` (the booking is created after payment). Transfers and refunds do carry it.
- M3. Sandbox webhook API version (`2025-12-15.clover`) ≠ code (`2026-02-25.clover`); no Connect webhook, so dev only learns `account.updated` via the return-page sync; the event list is over-broad.
- M4. Manager money panel says "Total charged" while funds are only authorised, doesn't show the HST the manager must remit, and after a refund shows both "Amount Charged $75.00" and "Total charged $91.50".
- M5. The fee bearer is described inconsistently. Payout copy says the manager absorbs Stripe's fee; the refund dialog says "the customer absorbs the Stripe processing fee".
- M6. `kitchen_license_approved_by` is null (no approver audit). `email_logs.recipient_role` is `chef` for `test_admin`.
- M7. File URLs embed the Firebase ID token in the query string (`/api/files/...?token=eyJ…`), so it leaks to logs, history and referrers.
- M8. SMTP transport has `tls.rejectUnauthorized: false` in production (`server/email.ts:129`).
- M9. Klarna (buy now, pay later) is offered for kitchen bookings with manual capture; needs a deliberate decision.
- M10. A local `E2E_SUPPRESS_OUTBOUND` run silently skips the booking outbox (`booking-lifecycle-delivery.ts:110`), so suppressed booking emails leave no `email_logs` evidence, unlike every other email.

### Low / UX
- Raw status enum `cancellation_requested` shown as a badge (chef and manager).
- Slot picker shows no time-zone label; the booking page does ("Newfoundland time"). The confirmation email shows the raw IANA ID "America/St_Johns" and greets "Hi Chef" instead of the name.
- Re-entering manager setup restarts at step 1. Kitchen tax rate is never asked during onboarding (it was empty).
- Manager activity feed reads "Access request · Approved" while the request awaits *their* review.
- Equipment dialog's "Create your own" says "blank storage listing". Expiry pickers are month-by-month only.
- "Delete Kitchen" says it permanently removes the kitchen's bookings (hard-deleting records tied to money).
- Timezone-utils serverless loader warning (cosmetic; the fallback is DST-aware; Codex §1).

### What works well
- Admin email toggle is respected. Application lifecycle emails are complete and well targeted.
- Itemised Stripe Checkout, separate charges and transfers with `source_transaction`, idempotent refund operation IDs, and full transfer reversal on refund.
- Per-item manager approval, slot holds with advisory locks, 3DS handled by Checkout, and declines produce no orphan bookings.
- Reminders are re-evaluated at send time, so cancelled bookings don't get stale reminders.
- The confirmation email renders cleanly at 375 px.

## 4. Time zones: answer to the owner's question

Tours are **DST-correct but not modular**: `shared/tour-time.ts:3` forces Newfoundland by policy, and booking also forces or ignores the location zone. Neither is the standard approach yet. The industry standard (see `research-booking-standards.md` §6), which matches what top marketplaces do:
1. An IANA zone per location (Newfoundland only as the onboarding default), validated and editable.
2. Freeze the agreed zone on each booking; store scheduled start/end as UTC `timestamptz`; keep the operating date as a `date`.
3. One shared conversion/format module used by server, browser and email. Reuse the tour algorithms but pass the zone in. Reject DST gaps; handle folds explicitly.
4. Every displayed time carries its zone ("10:00 a.m. NDT"); ICS uses UTC instants.
5. Migrate the existing `timestamp without time zone` columns carefully: their historical meaning is mixed (H3), so do not blindly convert.

## 5. Decisions needed from the owner

1. **Cancellation policy**: keep "manager reviews every cancellation", or Airbnb-style self-serve with automatic refund by policy? Before the deadline, should the chef get 100% (including service fee and processing)? Who absorbs Stripe's fee on refunds?
2. **Fee display**: show all-in price (rate + service fee) on cards and the panel to comply with drip-pricing rules? Separate HST and service-fee lines everywhere?
3. **Damage deposits**: collect (authorise) at checkout, disclose only, or drop until the claims process is ready?
4. **Request-to-book SLA**: how long a manager has to respond before the hold auto-releases (research suggests 24 h); card authorisations lapse at about 7 days, so how to handle bookings made far ahead.
5. **Klarna** for kitchen bookings: allow or disable?
6. **Dev environment isolation**: give local/agent testing its own sandbox + DB (or a dev-only flag that stops dev's webhook handler for local sessions), and un-pause or replace the lifecycle cron on dev.
7. **Tax**: confirm with the accountant who is the supplier of record and remits the 15% HST (research §3).

## 6. What the owner can test on dev now
- Admin email toggle and application emails (they arrive at `test_admin@localcooks.ca`).
- After this pack: the C1/C2 behaviour on dev itself. Book with a declined card, then retry with a 3DS card on the same checkout; and watch whether request/cancellation emails arrive before any manager action.

## 7. Synthetic data created (cleanup list)
- Users: 379 `phase0-manager@localcooks.test`, 380 `phase0-chef@localcooks.test`, 381 `phase0-admin@localcooks.test` (Firebase password set).
- Location 47 "PHASE0 Test Kitchen (Claude)", kitchen 54 (listed), equipment, storage, check-in/out settings, application 67.
- Bookings 114 (cancelled/refunded) and 115 (voided), payment_transactions 91+, booking_lifecycle_events 18–23 (20–23 undelivered).
- email_logs 3070–3105. **Rows 3098–3103 say `sent` but were captured by the local sink, not delivered** (including the two `test_admin@localcooks.ca` rows).
- In-app admin notifications created for admins 9, 10, 30, 375 (application and booking alerts for these tests).
- Stripe sandbox: Connect account `acct_1UPWdbCf9PlKmwqd`, customers, PIs `pi_3UPWx3…`, `pi_3UPX49…`.
- R2 (cloud) objects from the first upload attempt: `location-logos/379_file_1791754442095_test-logo.png`, `documents/379_file_1791754460181_certificateDemo.jpg`. Later uploads are local disk only.
- Local only: `.phase0-harness/`, Stripe CLI in `%TEMP%/phase0-stripe-cli`, `inngest@4.21.1` installed with `--no-save`.
