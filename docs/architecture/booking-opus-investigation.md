# Booking journey investigation (independent, Claude Opus 5.5)

Date: 2026-10-11. Branch: `development` (worktree has unrelated uncommitted changes; this file is the only write).
Scope gate: **current state only**. This document gives no target architecture, fixed policy thresholds or implementation plan.

## 0. Method, evidence classes and execution status

| Class | Meaning in this document |
|---|---|
| F | Founder-supplied context (task brief; attachment PDF read **after** repository reconstruction, treated as hypotheses) |
| R | Repository code/config/copy read in this investigation (`path:line` + symbol). Existing tests that I read but did not run are R. |
| T | Tests executed in this investigation. **None.** No test, script, app start or migration was run. |
| O | Production/operational evidence. **None.** No database, Stripe, Inngest, Firestore, Vercel or Sentry access was used. |
| E | Current external evidence. **None.** No network research was done. Founder-cited external sources were not checked. |
| I | Reasonable inference from R |
| J | Product judgment (flagged; not a recommendation of a final design) |
| Q | Unresolved question |

Execution: model/provider run succeeded as an in-session Claude Opus 5.5 (High) investigation: local file reads and `grep` only, plus `pdftotext` to extract the attachment to stdout. No subagents and no network calls. No `.env` values were read.

How sure each finding is:
- **Proven contradiction (R):** two pieces of code or copy that cannot both be true, shown by reading the code. Real-world impact still needs T or O.
- **Suspected defect (R+I):** a code path that by reading appears to give a harmful result. It needs a T reproduction before anyone calls it a bug.
- **Absence (R-absent):** a search found no implementation. The search terms are listed, and absence findings are weaker than positive ones.

---

## 1. Priority findings (adversarial)

| # | Finding | Class | Proof status | Severity (J) |
|---|---|---|---|---|
| A1 | **Booking eligibility gate is tier ≥ 2, but "approved to book" everywhere else is tier ≥ 3.** `chefService.resolveApplicationAccess` grants `canBook` when `status==='approved' && current_tier >= 2` (`server/domains/users/chef.service.ts:188`). It also auto-inserts a permanent `chef_location_access` row (`chef.service.ts:190-197`). `bookingService` uses the same `>= 2` gate and auto-grant (`server/domains/bookings/booking.service.ts:124-141`). When a chef submits Step-2 documents, the application gets `current_tier=2` (`server/routes/firebase/kitchen-applications.ts:388-395,647`) and status stays `'approved'` (`server/domains/applications/chef-application.service.ts:485-487`). Meanwhile the UI status uses `current_tier >= 3` (`chef-application.service.ts:387-396`), `getApprovedKitchens` uses `gte(current_tier, 3)` (`:348`), and the manager route says "A document review that leaves the application at tier 2 does not grant booking access" (`kitchen-applications.ts:1935`). Result: a chef whose documents await the manager's final review appears to pass the server checkout gate (`server/routes/bookings.ts:3094`, `:2711`, `:3387`). Once one checkout passes, the auto-grant keeps access in place even if the manager later rejects. | R | Proven contradiction. Exploitability via direct API calls needs T. | Critical (eligibility/compliance bypass) |
| A2 | **Revoking an application does not revoke booking access.** `chef_location_access` is checked first and grants booking unconditionally (`chef.service.ts:155-172`). It is only deleted by explicit admin/manager `DELETE /chef-location-access` (`server/routes/admin.ts:508-528`, `server/routes/manager.ts:4082-4093` → `chef.repository.ts:29-37`). Application rejection or cancel paths do not call `revokeLocationAccess` (search for `revokeLocationAccess` found only those two callers). | R / R-absent | Suspected defect, needs T | High |
| A3 | **Chef credential expiry is not checked when booking.** `getApplicationStatusForBooking` checks only kitchen listing status and the kitchen licence (`chef.service.ts:92-146`). The chef's food-safety / establishment certificate expiry columns (`shared/schema.ts:1680,1686`) are validated only during tier review (`server/domains/applications/tier-validation.ts`), not at booking time. | R | Proven by reading; whether this is intended is Q | High (compliance) |
| A4 | **Paid cancellation requests can be defeated by manager inaction.** A chef can request cancellation of a confirmed, paid booking only *before* the saved cutoff (`bookings.ts:2229`). The manager can accept only while `now < cutoff` (`server/services/booking-cancellation-refund.ts:62-64`). Decline has no time limit (`manager.ts:1025-1033`; `accepted` is hard-coded `false`, so the cutoff check at `:1029` is dead code). The auto-accept worker skips paid bookings (`server/services/scheduled-cancellations.ts:47`). So a timely request that the manager ignores until the cutoff can only be declined, which restores `confirmed`. | R | Proven by reading | High (consumer fairness/disclosure) |
| A5 | **Admin "auto-accept" setting is inert for kitchen bookings and its UI copy is false.** The admin UI says unanswered cancellation requests "are auto-accepted" (`client/src/components/admin/sections/PlatformSettingsSection.tsx:466-468`). The worker skips every kitchen request with payment status `paid/partially_refunded/refunded/processing/authorized` (`scheduled-cancellations.ts:47`). The chef route creates kitchen `cancellation_requested` only for `confirmed` + `paid/partially_refunded` (`bookings.ts:2259-2281`). | R | Proven contradiction | High (admin is misinformed) |
| A6 | **A manager can unilaterally cancel a confirmed, paid booking without any refund being enforced.** `PUT /api/manager/bookings/:id/status {status:'cancelled'}` blocks only `cancelled/completed/cancellation_requested` (`manager.ts:4689`). It then cancels and returns `requiresManualRefund` (`manager.ts:4843-4846`). The refund is a separate, discretionary manager action (manager-share partial refund, or a full refund needing admin approval: `manager.ts:1398`, `:1672`, `admin.ts:3593`). There is no cutoff, no reason requirement and no chef-protective default. | R | Proven by reading; whether the UI exposes it is Q | High |
| A7 | **A manager can approve (capture) after the session has started or ended.** The approval window is 24 h from `createdAt` (`server/services/auth-expiry-service.ts:42,57-58,77-78`). The minimum lead time defaults to 1 h (`shared/kitchen-booking-policies.ts:21`). Neither `decideAuthorizedBooking` (`server/services/booking-payment-decision.ts:21-107`) nor the status route (`manager.ts:4642-4770`) compares the approval time with the booking start. The slot is blocked while pending (`server/services/kitchen-checkout-holds.ts:66-70`). | R+I | Suspected defect, needs T | High (payment for unusable time; chef uncertainty) |
| A8 | **Fulfillment can strand a card authorization with no booking.** `fulfillQuotedKitchenBooking` throws plain `Error` for "Quoted storage/equipment is unavailable" or "Accepted storage terms are unavailable" (`server/services/booking-checkout-fulfillment.ts:54,57,68`). Only `KitchenHoldMissingError` / `KitchenSlotUnavailableError` trigger cancel or refund (`:92-98`). The webhook rethrows (`server/routes/webhooks.ts:1378`). Stripe retries, but no booking row is created, so the auth-expiry sweep (which reads `kitchen_bookings`, `auth-expiry-service.ts:202-218`) can never release the hold. Triggers include a listing being deleted or moved during the 32-minute checkout, or a client-supplied listing id from another kitchen (checkout does not check listing ownership; see A9). | R+I | Suspected defect, needs T | High |
| A9 | **Add-on inventory has no availability, quantity, status or kitchen-ownership check at checkout.** Storage and equipment lookups have no status, `isActive` or kitchen filter (`server/domains/inventory/inventory.repository.ts:59-65,120-126`; used at `bookings.ts:3192-3245`). Fulfillment checks only `kitchenId` (`booking-checkout-fulfillment.ts:50-51,67`). Equipment has no quantity or overlap model; its booking dates are the operating date only (`booking-checkout-fulfillment.ts:69-71`). No storage overlap check was found (search: `overlap|conflict|capacity|quantity` in `server/domains/inventory`, storage overlap in `server/`). The kitchen-slot lock covers kitchen time only (`kitchen-checkout-holds.ts:59-79`). | R / R-absent | Proven absence (by search) | High (double allocation) |
| A10 | **Pre-confirmation "100% refund" is not universally true.** The copy promises a 100% refund including taxes and fees before confirmation (`shared/kitchen-booking-policies.ts:8-9`, shown in `client/src/components/booking/BookingRefundPolicyNotice.tsx:11` and `server/email.ts:3851`). For `pending` + `paid` (auto-capture or legacy) bookings, the chef cancel route returns 409 "needs Local Cooks review" (`bookings.ts:2227-2228,2284`). The current checkout always uses manual capture (`server/services/stripe-checkout-service.ts:352`), so this mostly affects legacy or alternate paths. | R | Proven for the code path; how often it occurs is O | Medium |
| A11 | **Confirmed-booking modifications are retired at the server but still mounted.** Preview, request, approve, consent and apply all throw (`server/services/kitchen-booking-changes.ts:245-247,261,272-274,286,295,422`). Routes are still mounted (`server/routes.ts:1273`). A full pricing/policy engine remains in `shared/kitchen-booking-change.ts`. No client caller was found (search `changes/preview`, `/changes'` in `client/src`). Comments disagree about timing: `stripe-checkout-service.ts:44` says "manager-approved post-confirmation adjustment", while the policy type requires `authorization: 'before_manager_approval'` (`shared/kitchen-booking-change.ts:15`). | R | Proven | Medium (dead surface plus historical recovery debt) |
| A12 | **Manual webhook replay authenticates with the Stripe webhook signing secret.** In production, `/api/stripe/manual-process-session` compares a header or body value to `ADMIN_WEBHOOK_SECRET \|\| STRIPE_WEBHOOK_SECRET` using `!==`, not a timing-safe compare (`webhooks.ts:194-201`). Outside production, any chef can replay their own session (`:194,213-214`). | R | Proven by reading | Medium (security hygiene; out of booking scope but touches Stripe) |

---

## 2. Current-state maps (R unless marked)

### 2.1 Access / eligibility (application) journey

| Step | Actor | Data/state | Evidence |
|---|---|---|---|
| Optional tour request | Chef | `kitchen_viewings.status='pending_local_cooks'` or `'pending'`; location-level, with a required `targeted_kitchen_id` | `shared/schema.ts:2282,2325-2380` |
| Tour review | Admin, then manager | `adminReviewDecision`; the manager accepts or proposes reschedules | `server/routes/viewings.ts:1685-1880`; `shared/schema.ts:2349-2352` |
| Step 1 "Request to apply" | Chef | `chef_kitchen_applications` row, `status='inReview'`, `current_tier=1`. Copy key: `requestToApply` | `shared/i18n/locales/en-CA/kitchen.json:1086`; `client/src/pages/KitchenPreviewPage.tsx:1944` |
| Step 1 review | **Admin only** (manager is blocked below tier 2) | `status='approved'`, stays tier 1, stamps `tier1_completed_at` | `chef-application.service.ts:155-163`; `kitchen-applications.ts:1235`, `:1881-1888` |
| Step 2 kitchen docs and custom fields | Chef | Requires Step-1 approval. Sets `current_tier=2`, keeps `status='approved'` | `kitchen-applications.ts:388-401,647`; `chef-application.service.ts:485-487` |
| Final approval | Manager **or** admin | `current_tier=3` after tier-2 requirement validation; grants `chef_location_access` | `kitchen-applications.ts:1890-1930` (manager), `:1259-1306` (admin) |
| Booking gate | Server | **tier ≥ 2** (A1), or any `chef_location_access` row, or legacy `chef_location_profiles.status='approved'` | `chef.service.ts:148-257` |
| UI gate | Client/API status | tier ≥ 3 | `chef-application.service.ts:387-396,348` |

Notes:
- R: Duplicate applications per chef and location are read without ordering (`chef.service.ts:175-183`, `chef-application.service.ts:464-473`). Q: are multiple businesses per identity possible?
- R-absent: no waiver, deferral or override concept for requirements. "Waiver" search hits are overstay-penalty waivers (`manager.ts:7477`) and legal terms copy, not onboarding.
- F vs R: the founder says the customer cannot see that Local Cooks reviews first. R shows the server enforces admin-first Step 1. Whether the UI discloses it was not audited (Q).

### 2.2 Tour → application → booking conversation continuity

- R: One Firestore conversation per chef and location: `conversations/chef-{chefId}-location-{locationId}`, mapped in `chatRelationships` (`server/chat-service.ts:48-107`). Older application-scoped threads are adopted, not merged (`:66-100`).
- R: Eligibility comes from an approved application or a qualifying tour (`server/services/shared-chat-access.ts:6-27`). Tour approval provisions the chat (`viewings.ts:2071-2078`).
- R: The booking "Message" entry point requires an **approved application** and status `confirmed/cancellation_requested/completed` (`bookings.ts:72-97`, specifically `:81-88`). Booking context travels only as a URL `booking=` parameter (`:93`). This is not a structured link in the thread.
- Contradiction (R): booking eligibility can come from `chef_location_access` or legacy profiles with no approved application (`chef.service.ts:155-172,224-257`). Such a chef can book but gets "kitchen application conversation is unavailable" (`bookings.ts:87`).
- I: The thread is location-scoped, so every kitchen at a location shares one thread, and pending bookings have no messaging entry. The manager identity on the thread is refreshed from `locations.managerId` (`chat-service.ts:52,92`). Q: what access does a previous manager keep after reassignment? Firestore rules were not read.
- R: Tour notes are split into `managerNotes` (admin-only) and `sharedManagerNotes` (`shared/schema.ts:2347-2348`).

### 2.3 Session booking request → decision (current primary path)

```
Chef UI (KitchenBookingFlow.tsx:1154 / BookingConfirmationPage.tsx:346)
 → POST /api/chef/bookings/checkout (bookings.ts:3062)
    eligibility (A1), kitchen active+listed, availability, daily-limit, min hours, lead time (tz hard-coded 'America/St_Johns' :3132)
    price = kitchen + storage + equipment (client-supplied ids/dates) ; tax = kitchen.taxRatePercent on whole subtotal (:3247-3248)
    fee = calculateCheckoutFeesAsync(subtotal, tax) → commission line item (stripe-checkout-fee-service.ts:308-348)
    reserveKitchenCheckout hold 37 min under advisory lock (kitchen-checkout-holds.ts:7,81-110)
    Stripe Checkout: capture_method manual, setup_future_usage off_session, customer_creation always, expires 32 min (stripe-checkout-service.ts:338-369)
 → webhook checkout.session.completed (webhooks.ts:106) → fulfillQuotedKitchenBooking (booking-checkout-fulfillment.ts:16-100)
    one tx: kitchen_bookings status 'pending' paymentStatus 'authorized'; storage/equipment rows 'pending'; payment_transactions 'authorized'; lifecycle event 'requested'
 → manager PUT /api/manager/bookings/:id/status (manager.ts:4642) → decideAuthorizedBooking (booking-payment-decision.ts:21)
    persisted decision first; may reject individual add-ons ⇒ partial capture of authorized amount (:67-103; booking-capture-terms.ts:27-36)
    confirmed: capture; booking/items 'confirmed', paymentStatus 'paid'
    cancelled: release; booking 'cancelled', paymentStatus **'failed'** (:191)
 → no decision in 24 h from createdAt: auto-release (auth-expiry-service.ts:42-62,194-268), lazily on reads plus a worker task (recurring-worker.ts:119)
```

- R: The legacy and alternate paths are still live. `POST /api/payments/create-intent` (`bookings.ts:2698`) plus `POST /api/chef/bookings` with `paymentIntentId` (`bookings.ts:3361-3628`) use the client hook `use-kitchen-bookings.ts:323-360`, called by `KitchenBookingFlow.tsx:1245` and `BookingConfirmationPage.tsx:423`. Free kitchens (rates 0) can be booked directly (`bookings.ts:3413-3415`). Webhook legacy creation still exists for sessions without `addon_prices` (`webhooks.ts:551-1215`). Q: which UI branch reaches `createBooking.mutate` today?
- R: `Object.assign(location, …)` runs before the `if (!location)` null check (`bookings.ts:3124-3127`, `:3422`). If the location were null this would be a 500 instead of a 404. Minor.
- R: `locations.timezone` exists (`shared/schema.ts:370`), but checkout, cancel and change logic hard-code Newfoundland (`bookings.ts:2222,3132`; `shared/kitchen-booking-change.ts:28`). Q: will any non-NL location exist?

### 2.4 Cancellation map

| Situation | Who | Result | Money | Evidence |
|---|---|---|---|---|
| Pending + authorized | Chef, any time (no window check) | Cancelled | Authorization released; recorded as payment `failed` | `bookings.ts:2227-2241`; `booking-payment-decision.ts:176-191` |
| Pending + unpaid (no intent) | Chef | Cancelled | None | `bookings.ts:2245-2256` |
| Pending + paid (legacy auto-capture) | Chef | 409, "Local Cooks review" | n/a; contradicts the 100% copy (A10) | `bookings.ts:2284` |
| Confirmed + paid, > cutoff | Chef | `cancellation_requested`; "refund handled separately" | none yet | `bookings.ts:2259-2281` |
| Confirmed + paid, ≤ cutoff | Chef | Rejected with the location's *current* message (hours from snapshot) | n/a | `bookings.ts:2229-2232` |
| Request pending, before cutoff | Manager accept (quote hash) | Cancelled; linked dates cancelled; storage in use stays reserved | Refund = captured − actual Stripe processing − service fee − used add-ons (`shared/cancellation-refund.ts:42`); reverse transfer + refund (`booking-cancellation-refund.ts:189-196`) | `booking-cancellation-refund.ts:146-182` |
| Request pending, after cutoff | Manager | Only decline is possible → `confirmed` (A4) | none | `booking-cancellation-refund.ts:63-64`; `manager.ts:1025-1045` |
| Request never answered | Worker | Skipped if paid (A5) | none | `scheduled-cancellations.ts:47` |
| Confirmed + paid | Manager, unilateral | Cancelled | Manual, discretionary refund (A6) | `manager.ts:4689-4846` |
| Service-fee return | Manager request → admin decision | separate | `manager.ts:1672`; `admin.ts:3593` |
| Add-on cancel | Chef per item → manager accepts item quote | item cancelled / removal required | item allocation | `booking-item-cancellation.ts:32-46`; `manager.ts:1061-1073` |
| Authorization stuck/recovery | Admin | `cancel-authorization`, `recover-payment` | | `server/routes/booking-attendance.ts:41-84` |

### 2.5 Modifications, counteroffers, invitations

- R: Self-service move and extend for confirmed bookings is **retired** (A11). Only historical requests can be declined, withdrawn or settled (`kitchen-booking-changes.ts:279-340`).
- R-absent: no counteroffer, "invite to book", custom-price or manager price-override object. The search for `counteroffer|counter-offer|invite to book|custom offer|customPrice|priceOverride` found no matches.
- R: The only manager-side term adjustment is **rejecting individual add-ons at approval**, which partially captures the authorization (`booking-payment-decision.ts:67-103`). Chef consent is not requested. The lifecycle message says "Payment was captured for the approved items" (`:202`).
- R: Manager tour reschedule proposals do exist for tours (`viewings.ts:1757-1855`), not for bookings.

### 2.6 Inventory and equipment

| Item | Model in code | Evidence |
|---|---|---|
| Kitchen time | Hourly slots or full day; advisory lock per kitchen/day; holds plus non-cancelled bookings block | `kitchen-checkout-holds.ts:28-79` |
| Included equipment | `equipment_listings.availability_type='included'`; skipped from pricing and booking rows. No allocation and no capacity. | `shared/schema.ts:1318`; `bookings.ts:3231` |
| Rental equipment | Flat `sessionRate` once per booking; `pricingModel` stored as `'daily'`; dates = operating date. No quantity, no overlap check. | `booking-checkout-fulfillment.ts:66-72`; `shared/schema.ts:1321` |
| Storage | Separate multi-day rows linked to the kitchen booking; daily / hourly / monthly-flat (flat ignores duration); overstay terms snapshot accepted at checkout | `bookings.ts:3192-3225`; `stripe-checkout-service.ts:323-333,363-365` |
| Tours vs bookings | "Tours are context, not capacity." Bookings do not check tours; tour acceptance and manager proposals do check bookings | `kitchen-booking-changes.ts:155-162`; `viewings.ts:299-314,1278-1290` |

- Price quote contradiction (R): hourly storage server price is `max(1, ceil(hours))` with no listing minimum (`bookings.ts:3206-3207`). The client applies `minimumBookingDuration` (`client/src/hooks/use-storage-pricing.ts:81-88`). The displayed estimate and the Stripe charge can differ.
- Disclosure contradiction (R): the client storage summary says "Platform fees handled via Stripe Connect (invisible to chef)" (`use-storage-pricing.ts:100,122`). The checkout adds a chef-paid "Service Fee" line (`stripe-checkout-service.ts:223-233`).

### 2.7 Policy ownership and snapshots

| Policy | Owner (code) | Snapshotted on booking? | Disclosed? | Evidence |
|---|---|---|---|---|
| Cancellation hours | Manager: location default, kitchen override | Yes, `kitchen_bookings.cancellation_policy_hours` via checkout metadata | Dialog uses `formatCancellationWindowText` | `bookings.ts:3304`; `booking-checkout-fulfillment.ts:46`; `client/src/components/booking/CancellationPolicyDialog.tsx:10-24` |
| Cancellation message | Manager, location only | **No**, read live at cancel time | Yes | `bookings.ts:2181,2229-2231` (`.replace` handles only the first `{hours}`) |
| Pre/post confirmation refund rule | Platform constant (unversioned) | No | Yes | `shared/kitchen-booking-policies.ts:8-12` |
| Refund math (processing cost and fee retained) | Platform code | Implicit | Partial ("may be retained") | `shared/cancellation-refund.ts:42-43` |
| Approval window 24 h | Platform constant | No | **Not found in chef/manager copy** (search `24 hours\|within 24` in `client/src`, `shared/i18n`) | `auth-expiry-service.ts:42` |
| Auto-accept window | Admin `platform_settings` | No | Admin only; inaccurate (A5) | `admin.ts:2462-2530` |
| Min lead / daily limit / min hours | Manager | No (validated at checkout) | Calendar | `shared/kitchen-booking-policies.ts:14-24`; `manager.ts:3319-3356` |
| Commission rate | Admin `platform_settings.platform_commission_rate` (default 0) | Yes, as cents in session metadata | Line item | `stripe-checkout-fee-service.ts:72-77,118`; `booking-capture-terms.ts:14-25` |
| Tax rate | Manager per kitchen | Yes (rate and cents) | Line item | `bookings.ts:3247-3248` |
| Storage overstay terms | Manager listing → location → platform | Yes, `overstayTerms.acceptedAt` | Stripe custom text | `booking-checkout-fulfillment.ts:55-61` |
| Site terms version | Platform `CURRENT_POLICY_VERSION` | Per user, not per booking | Terms gate | `shared/policy-config.ts:6` |

- R: Saving location booking policies sets **every kitchen override at that location to null** (`manager.ts:3331`). The kitchen workspace route can set overrides (`manager.ts:3266-3275`). Q: is silently wiping overrides intended?
- R: Manager cancellation hours have no upper bound (`manager.ts:5212-5219`; max 2147483647 at `:3328`). I: a very large value effectively removes chef cancellation rights.

### 2.8 Stripe/workflow intersections

- R: Charge model is separate charges and transfers. The chef pays subtotal + tax + commission. The manager is transferred (subtotal + tax) − **actual Stripe fee on the whole charge**, including the fee on the platform's service-fee portion (`stripe-transfer-service.ts:354-355`). The FeeConfig comment "Real: deducted from manager transfer" (`stripe-checkout-fee-service.ts:59`) contradicts the chef-paid line item.
- R: Commission base is the subtotal including add-ons, excluding tax. No tax on the fee (`bookings.ts:3256-3257`). The founder's "7%" (F) is configuration, not code (default 0). Verifying it needs O.
- R: Manual capture plus 24 h approval sits well inside Stripe's authorization lifetime (I; E not checked).
- R: Idempotency: booking keyed by `paymentIntentId` (`booking-checkout-fulfillment.ts:23-24`); capture idempotency key `booking-decision:{id}` (`booking-payment-decision.ts:136`); refund keyed by operation id (`booking-cancellation-refund.ts:197`); inventory-conflict refund key (`booking-checkout-fulfillment.ts:96-97`).
- R: Workflows: Inngest cron runs every 2 minutes only when `LIFECYCLE_RECURRING_ENABLED` and the production/staging flags hold (`server/lifecycle-inngest.ts:13-21`). The client is created with `isDev: false` in every environment (`:18`). CRON_SECRET HTTP fallback endpoints exist (`:64-96`; `bookings.ts:704-722`). Worker tasks include payment recovery, auth expiry, cancellations and lifecycle email delivery (`server/services/recurring-worker.ts:113-137`).
- Q (isolation): the webhook, the replay endpoint and the change routes each construct Stripe from `STRIPE_SECRET_KEY` (`webhooks.ts:40-57`; `kitchen-booking-changes.ts` route `:20-23`). Development-vs-production key separation, webhook endpoint registration, Inngest app identity and Firestore project selection were not verified (no env access).

---

## 3. Matrices

### 3.1 Permissions (R)

| Action | Chef | Manager (location owner) | Admin | Evidence |
|---|---|---|---|---|
| Approve application Step 1 | — | blocked below tier 2 | ✓ | `kitchen-applications.ts:1881-1888,1235` |
| Final application approval (tier 3) | — | ✓ | ✓ | `:1890-1930`, `:1259-1306` |
| Grant/revoke location access | — | revoke ✓ | grant/revoke ✓ | `admin.ts:446-528`; `manager.ts:4082` |
| Create booking checkout | ✓ (gate A1) | — | — | `bookings.ts:3062` |
| Approve/decline pending booking; reject add-ons | — | ✓ | — (admin can only release the authorization) | `manager.ts:4642`; `booking-attendance.ts:41` |
| Cancel pending authorized | ✓ | ✓ | ✓ | as above |
| Request paid cancellation | ✓ (before cutoff) | — | — | `bookings.ts:2259` |
| Accept/decline paid cancellation | — | accept before cutoff; decline any time | — | §2.4 |
| Unilateral confirmed cancel | — | ✓ (A6) | — | `manager.ts:4689` |
| Manager-share refund | — | ✓ | — | `manager.ts:1398` |
| Service-fee refund | — | request | decide | `manager.ts:1672`; `admin.ts:3593` |
| Booking messaging | ✓ (needs approved application) | ✓ | admin chat routes | `bookings.ts:72`; `kitchen-applications.ts:1655-1700` |
| Change requests | historical withdraw | historical decline | read | `kitchen-booking-changes.ts:279-297` |
| Auto-accept window, commission | — | — | ✓ | `admin.ts:2490`; `platform_settings` |
| Replay Stripe session | own session (non-prod) | — | ✓ (+secret in prod) | `webhooks.ts:194-214` |

R-absent: there is no distinct "support" role (`userRoleEnum` = admin, chef, manager at `shared/schema.ts:16`). There is no kitchen-staff role below the location owner: one `locations.managerId` (`:357`).

### 3.2 Terminology (R; partial audit)

| Term | Where | Actual meaning | Conflict |
|---|---|---|---|
| "Request to apply" | `kitchen.json:1086`, preview CTA | Step-1 application, no inventory | consistent |
| "Apply to Book", "Request to book" | `kitchen.json:141,397`; `booking.json:21` | No caller found for `continueWithSelectedDates`; "Apply to book" is used in `KitchenBookingCalendar.tsx:1449` | "Request to book" may be dead copy (Q) |
| "Booking opens after approval" | `kitchen.json:143` | Server opens at tier 2 (A1) | contradiction |
| `approved` (application) | DB | Step-1 passed **or** fully approved, distinguished only by tier | one status, two meanings |
| `pending` (booking) | DB/UI "Pending" | Card authorized, awaiting manager | No deadline shown (Q) |
| `failed` (payment) | DB | Also means "authorization released after decline/expiry" | UI disambiguates (`BookingDetailsPage.tsx:618-672`) |
| "refund" (pre-confirmation) | `kitchen-booking-policies.ts:8` | Usually an authorization release, not a refund | wording |
| "Tour"/"viewing" | DB `kitchen_viewings`, UI "tour" | same | naming split |
| "Kitchen tour kitchen before applying" | `kitchen.json:1085` | typo | copy defect |

### 3.3 Policy disclosure vs enforcement

| Disclosed | Enforced | Gap |
|---|---|---|
| "100% refund before confirmation, incl. taxes and fees" | Authorization release; pending+paid → 409 | A10 |
| "After confirmation the saved cancellation deadline applies…" | Before the deadline the chef can only *request*; the manager may decline; after the deadline the manager cannot accept | A4 |
| "processing costs and platform service fees may be retained" | Processing cost is always retained; the fee is retained unless the admin approves a return | "may" vs "always" (I) |
| Location custom cancellation message | Not snapshotted; can change after booking | §2.7 |
| Admin: "request is auto-accepted" | Never for paid kitchen requests | A5 |
| Manager approval deadline (24 h) | Enforced | Not disclosed (search) |
| Storage overstay terms | Snapshotted and accepted | consistent |
| Equipment "included" | No reservation | Q: does the UI imply a reservation? |

---

## 4. Founder statements vs repository

| Founder statement (F) | Status | Evidence |
|---|---|---|
| Local Cooks reviews eligibility first | **Confirmed** (Step 1 is admin-only) | §2.1 |
| Manager makes initial then final decision | **Partially contradicted**: the manager makes only the final (tier 2→3) decision; the admin makes Step 1. Booking unlocks at tier 2 on the server. | §2.1, A1 |
| Second part has kitchen custom fields and documents | **Confirmed** (`location_requirements` tier2 fields, `tier_data`) | `shared/schema.ts:410-462` |
| Portal chat during onboarding | **Confirmed**; one thread per chef and location, shared with tours | §2.2 |
| First request includes date/time? | **Not represented**: no slot data on the application | `shared/schema.ts:1657-1730` |
| Booking request authorizes card; manager confirmation captures | **Confirmed** for the checkout path | §2.3 |
| 7% service fee | **Requires O**: config-driven, code default 0% | §2.8 |
| Kitchen may collect tax | **Confirmed** (kitchen tax rate, transferred to manager) | §2.8 |
| Included vs paid equipment, once per session | **Confirmed**, with no inventory or quantity | §2.6 |
| Manager invitations, custom prices, counteroffers | **Not represented** | §2.5 |
| Confirmed modification policy | **Code exists but is retired** | A11 |
| PIN arrival/departure | **Not represented**: no PIN search hits; attendance is check-in/out with photos and checklists | `bookings.ts:2296-2400`; `booking-attendance-service.ts:65-120` |
| Storage separable from session | **Partially**: storage is created in the same checkout, payment and decision as the session | `booking-checkout-fulfillment.ts:49-65` |
| Known-customer fast track | **Not represented**, except the admin direct-grant of `chef_location_access`, which bypasses all requirements | `admin.ts:446-470` |

---

## 5. Prioritized blocking questions (Q)

1. **Eligibility gate (A1):** Should booking unlock at tier 2 (documents submitted) or tier 3 (manager final approval)? Every non-booking surface assumes tier 3. *Blocks:* every eligibility and compliance design.
2. **Persistent access (A1/A2):** Is `chef_location_access` meant to outlive application rejection, cancellation or document expiry? Do existing production rows include auto-granted tier-2 entries? (needs O)
3. **Chef document expiry (A3):** Which chef requirements must be valid *at booking time* vs *at approval time*? Who owns each (law, insurer, Local Cooks, kitchen)?
4. **Paid cancellation rights (A4/A5/A6):** Does a timely chef request create a right to cancel? What happens when the manager does not act before the cutoff? Should the admin auto-accept setting apply to paid requests? May managers cancel confirmed bookings without a refund default?
5. **Approval timing (A7):** Must a manager decide before session start (or before some lead time)? What should the chef be told about the 24 h window?
6. **Add-on inventory (A9):** Are rental equipment and storage units single-capacity? Are quantities or overlaps expected? Must included equipment be reservable?
7. **Fulfillment failure (A8):** Which party owns stranded authorizations, and is automatic release required?
8. **Legacy/alternate creation paths:** Is `/api/payments/create-intent` + `POST /api/chef/bookings` still reachable from UI? Do free-kitchen bookings exist?
9. **Policy snapshot scope:** Should the cancellation message, refund rule text and approval window be versioned per booking? Is wiping kitchen overrides on location save intended?
10. **Fee basis:** Is the platform commission meant to be chef-paid on top, while the manager bears Stripe fees on the whole charge, including the fee portion? (needs O for the configured rate and contracts)
11. **Conversation scope:** Is one thread per chef and location (all kitchens) acceptable? Should booking messaging require an application when access came from other sources? What happens to access after a manager reassignment?
12. **Environment isolation:** Are development Stripe keys and webhook endpoints, Inngest app/keys (`isDev:false`), Firestore project and email sinks proven test-only? (needs O; out of my access)
13. **Timezone:** Will locations outside Newfoundland exist? `locations.timezone` is currently ignored for booking rules.

---

## 6. Test limitations and suggested diagnostics (for the parent; not executed)

- T: **none run.** Every "suspected" item needs a reproduction against an isolated database and Stripe test mode, after the lead verifies isolation.
- Existing tests that bear on these areas but were **not run** (R): `server/services/booking-payment-decision.test.ts`, `booking-cancellation-refund.test.ts`, `booking-checkout-fulfillment.test.ts`, `kitchen-checkout-holds.test.ts`, `kitchen-booking-changes.test.ts` and `.postgres.check.ts`, `server/routes/consecutive-bookings.test.ts`, `server/stripe-webhook-contract.test.ts`, `client/src/components/booking/CancellationRefundReview.test.tsx`, `BookingCancellationChooser.test.tsx`.
- Suggested reproductions (no side effects beyond test DB/Stripe test mode):
  - A1: application `status='approved', current_tier=2` → `getApplicationStatusForBooking` returns `canBook:true` and inserts `chef_location_access`.
  - A2: reject application after grant → checkout still passes.
  - A4: confirmed paid booking, request at T−cutoff−ε, advance the clock past the cutoff → accept throws, decline succeeds.
  - A5: auto-accept worker on a paid `cancellation_requested` → skipped.
  - A6: manager status `cancelled` on a confirmed paid booking → succeeds, no refund row.
  - A7: create a booking 1 h ahead, approve 3 h later → capture succeeds.
  - A8: delete the equipment listing between session creation and webhook → webhook throws repeatedly, authorization persists, no booking.
  - A9: two chefs, the same rental equipment or storage listing, overlapping dates → both fulfilled.
  - Storage hourly minimum mismatch between `use-storage-pricing` and the server.
- Coverage limits: I did not read Firestore security rules, all client screens, email templates, `booking-lifecycle-delivery` recipient policy, payout/transfer reconciliation in depth, damage claims or overstay logic. The terminology audit is a spot check of en-CA strings, not every locale or component.

## 7. Unresolved objections (to other reports or assumptions)

- I object to describing the current flow as "manager initial + final decision" (F): the code shows admin Step 1 and manager final only, and the server's actual booking unlock point is earlier than either party's final decision (A1).
- I object to treating `cancellation_request_auto_accept_hours` as a consumer protection: it does not apply to any paid kitchen request (A5).
- I object to presenting confirmed-booking modification as an existing capability: it is server-retired (A11). The shared policy engine is not evidence of a working flow.
- I object to "7% fee" as a repository fact: it is configuration (O) with code default 0.
- Environment isolation remains **unverified** by me; nothing in this document relies on runtime observation.
