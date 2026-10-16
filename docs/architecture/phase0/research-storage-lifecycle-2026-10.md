# Storage rental lifecycle — research, current state, recommended design (16 Oct 2026)

Read-only research. No code, DB or Stripe was touched. Builds on `research-storage-structure.md`, `research-storage-availability.md`, `design-storage-decoupling.md`, `map-storage-current.md` (all Oct 14) and adds what the Oct 16 constraints change: **no auto-renew, no automatic money movement, no dead ends, check-in/out with evidence.**

Names: Priya = chef/member renting; Sam = kitchen manager; "Local Cooks" = admin/support.

Evidence tags: **Documented** (first-party page says so, URL given) · **Search-summary** (seen only in a search snippet, page body not readable; treat as lower confidence) · **Inferred** (my design reading) · **Not found** (searched, nothing public).

**The one big finding.** Dropping auto-renew removes the need for Stripe subscriptions altogether. A storage rental becomes a **paid-through date**: Priya pays for a term (a month, or a date range at the daily rate), and "renewing" is Priya paying to **extend** it. That is what `pending_storage_extensions` + `StorageExtensionDialog` already do, so the cheapest correct design extends the existing term-with-end-date model instead of building recurring billing (section c).

---

## (a) Top-platform practices

### a1. Comparison table

| Topic | Food Corridor (TFC) | Neighbor.com | Self-storage (Public Storage, StorageMart, others) | Commissary kitchens | Airbnb / Peerspace |
|---|---|---|---|---|---|
| **Pricing unit** | Monthly per named unit (count + monthly cost). Documented: [set up storage](https://help.thefoodcorridor.com/en/articles/1413924-set-up-your-storage-and-storage-fees) | Month only, min 1 month; anniversary renewal. Documented: [monthly periods](https://help.neighbor.com/en_us/monthly-rental-periods-reservation-renewals-SkNmsMnpi) | Month-to-month, min 1 month, 10-15 day vacate notice. Documented: [StorageMart FAQ](https://www.storage-mart.com/self-storage/faqs/general) | Flat monthly per shelf/cage/rack; some 6-12 month minimums (My Commissary, Church Kitchen). Documented: [mycommissarykitchen.com](https://mycommissarykitchen.com/), [thechurchkitchennola.com](https://www.thechurchkitchennola.com/) | Per night / per hour. [Peerspace](https://www.peerspace.com/) |
| **Prepay vs invoice** | Storage is always prepaid for the coming month, even for kitchens billing in arrears. Documented: [pay at end of month?](https://help.thefoodcorridor.com/en/articles/1506349-can-clients-pay-at-the-end-of-the-month-instead-of-pre-paying) | Charged on day 1 of each period; host paid at period end. Documented: [payouts](https://help.neighbor.com/en_us/how-do-payouts-work-as-a-host-HJkBDAICu) | Prepaid monthly, autopay standard | Monthly invoice | Charged at booking |
| **Renewal** | Automatic. Bill generated 8+ days ahead, client notified 3+ days ahead and can report problems before the charge on the billing date. Documented: [monthly bills](https://help.thefoodcorridor.com/en/articles/1413975-how-are-monthly-bills-generated) | Automatic, same day each month. Renter must end the reservation in-app to stop it. Documented: [cancellation policy](https://help.neighbor.com/en_us/cancellation-and-refund-policy-Bkn_vj9QA) | Automatic autopay | Invoice | A change/extension is a request the host accepts; charge or refund the difference only if accepted. Documented: [Airbnb alter a reservation](https://www.airbnb.co.in/help/article/3121) |
| **Non-automatic renewal (our case)** | No peer sells storage with manual renewal. The closest analogue is TFC's review window plus Stripe `send_invoice` (hosted pay page, due date, reminders; status becomes past_due). Documented: [Stripe collection methods](https://docs.stripe.com/billing/collection-method) | Not offered | Not offered (autopay can be turned off; rent is then due by the 1st) | Invoice paid by the member | Airbnb: once a stay ends you cannot extend, you must make a new request. Documented (same Airbnb link) |
| **Non-payment** | Email to both sides; auto-retry 3x weekly; then the manager can re-run, credit, mark paid, write off or stop. Documented: [payment fails](https://help.thefoodcorridor.com/en/articles/1413999-what-happens-if-a-payment-fails), [past due options](https://help.thefoodcorridor.com/en/articles/1413995-what-can-i-do-if-a-client-s-payment-is-past-due) | Card retried every 48 h, late fee after 10 days, 18%/yr interest, collections. Payout Protection pays the host up to 2 months. Search-summary: [declined payment](https://help.neighbor.com/en_us/when-my-payment-fails-rkF_DRU0O), [renter stops paying](https://help.neighbor.com/en_us/what-happens-if-my-renter-stops-paying-Sy2SDRICd) (page bodies did not load) | Late fee (US statutes cap it, e.g. North Carolina: not before 5 days late, greater of $15 or 15%), then overlock (one facility: after day 30, access denied until paid; cut-lock fee $25), then lien sale (Public Storage: proceedings can begin about 30-60 days in, state dependent). Search-summary: [NC statute](https://library.ncleg.net/EnactedLegislation/SessionLaws/HTML/2013-2014/SL2013-239.html), [Public Storage summary](https://terms.law/ToS-Watchdog/moving-storage/public-storage/), [facility terms](https://leewardstoragetci.storeganise.com/terms) | Case by case | n/a |
| **Early move-out refund** | No proration; mid-month changes roll to the next bill. Documented: [mid-month rule](https://help.thefoodcorridor.com/en/articles/1413885-assigning-or-changing-a-client-s-billing-plan-or-recurring-charges-mid-month). Credit preferred over refund: [refunds](https://help.thefoodcorridor.com/en/articles/1479949-how-do-i-refund-a-client) | None for a partial month. 100% back only if cancelled on the renewal date. Documented (cancellation link above) | "Prorated going in, not prorated going out." Search-summary: [Storeganise facility terms](https://leewardstoragetci.storeganise.com/terms) | n/a | Per cancellation policy |
| **Who can end it** | Kitchen removes the storage assignment at any time | Renter any time (no refund). Host needs 30 days' notice; if short, host loses the last payout and may be charged a $60 fee. Documented: [notice to vacate](https://help.neighbor.com/en_us/how-to-give-my-renter-a-notice-to-vacate-rkG8DCIRu) | Tenant 10-15 days' notice; operator by lien process | Contract | Host cancels with penalties |
| **Move-in / move-out evidence** | Not documented for storage | None. No inspection, no deposit, only a $1M host guarantee. Documented: [become a host](https://www.neighbor.com/host) | No inspection by default; deposit refunded only if clean, noticed and fully paid (one facility's terms, search-summary: [lease sample](https://form.jotform.com/212025081542039)) | Deposit plus licence/insurance gate; Church Kitchen: refundable 1-month deposit | Photos by convention only |
| **Deposit** | None for storage | None | Often; refund conditional on clean unit | Chefs Touch, Church Kitchen yes; My Commissary membership fee instead | Security deposit (host option) |
| **Abandoned items** | Not documented | Not found for Neighbor. Its UK peer Stashbee: host reports with photos, items go to a partner auction (about 1 week), else a removal company; Stashbee pays removal up to GBP 250; it "strongly recommend[s] requiring a sizeable deposit". Documented: [Stashbee abandoned items](https://help.stashbee.com/en/articles/320919-what-happens-if-a-renter-abandons-their-items) | Lien sale, statute-driven (days vary by US state: 21-day mailed notice in California, 90 days continuous default in New Mexico, 30 days in Georgia). Search-summary: [CA AB 655 analysis](https://www.leginfo.ca.gov/pub/09-10/bill/asm/ab_0651-0700/ab_655_cfa_20090413_111434_asm_comm.html) | Contract clause: unremoved property deemed abandoned, owner may dispose and bill removal. Search-summary: [Law Insider clauses](https://www.lawinsider.com/clause/abandoned-articles) | n/a |
| **Notice periods** | Bills 8/3 days ahead | Renter none; host 30 days | 10-15 days (tenant) | Contract | Per policy |

### a2. Canada / Newfoundland context

- **Not found:** no Newfoundland and Labrador statute on self-storage liens or abandoned stored goods turned up in three searches. Residential tenancy rules (5 days late before a termination notice, 10 days to pay or leave) are not applicable to a commercial kitchen shelf. Ontario has a `Repair and Storage Liens Act` (a storer's lien exists once goods are received, sale follows a Part III procedure), which shows Canadian law does have a lien concept, but I could not confirm NL has an equivalent. [Ontario RSLA](https://www.ontario.ca/laws/statute/90r25/v16). Consistent with the existing Terms/policy rule (`policy-facts-booking.md` section 6): **NL counsel must review any disposal or lien wording before launch.**
- Practical consequence: copy the **notice-and-hold discipline** of self-storage, not the lien sale. A kitchen cannot sell food, and we have no confirmed legal power to sell anything.
- Analogues useful for the wording counsel will review: Virginia self-storage requires a written 10-day notice before disposal; Wyoming lets an owner discard perishable or hazardous items immediately and presumes other items valueless after termination. Search-summary: [Virginia](https://law.lis.virginia.gov/vacode/55.1-1254/), [Law Insider property not removed](https://lawinsider.com/clause/property-not-removed). These are US residential/storage rules, analogy only.

### a3. Lessons for Local Cooks

1. **Nobody sells manual-renewal storage**, so there is no peer pattern to copy for "pay to extend". The nearest proven mechanics are: TFC's review window (notify well ahead), Stripe's hosted invoice with a due date, and Airbnb's "request, host accepts, pay the difference". Our extension flow already matches the Airbnb shape.
2. **Month-to-month with no proration on the way out** is the near-universal norm (TFC, Neighbor, self-storage). Challenge to the Oct 14 answer "cancel any time effective at month end": with no auto-renew there is nothing to cancel, the rental just stops at the paid-through date. Keep "no partial refund" as the default.
3. **Evidence at move-in is rare** (Neighbor and TFC skip it). It is our advantage and the cheapest way to avoid disputes, but it only works if move-in actually happens. Rule below.
4. **Deposits solve abandonment for peers** (Stashbee "strongly recommends", Church Kitchen, self-storage). We have an alternative that fits "no automatic money movement": a request-to-pay holdover and a booking hold on the chef's account when unpaid (already used for damage claims). A deposit is an open question (OQ6).
5. **Pricing unit:** month for the main product, day for short ranges and holdover. No weekly or hourly (matches the Oct 14 decision; no peer sells them).
6. **Late fees and interest (Neighbor: 18%/yr; self-storage late fees)** are not needed. Holdover at a daily rate is the late fee.

---

## (b) Current-state map (verified Oct 16, file:line against the working tree)

### b1. What exists

| Area | Where | Notes |
|---|---|---|
| Listings | `shared/schema.ts:1357` `storageListings`; CRUD `server/routes/storage-listings.ts`; UI `client/src/pages/StorageListingManagement.tsx` | No unit count, no capacity. `pricePerCubicFoot` and `availabilityCalendar` are dead columns. Pricing enum `:47` `monthly-flat \| per-cubic-foot \| hourly \| daily`. |
| Rental row | `shared/schema.ts:1593` `storageBookings` | Has `startDate`/`endDate` (so a term already exists), `status`, `totalPrice`, frozen `overstayTerms`, `checkinStatus` + `checkinPhotoUrls`, `checkoutStatus` + `checkoutPhotoUrls`, saved card ids. **No unit index, no paid-through/period fields, no monthly price, no reclaim-notice field.** Comment `:1573-1574` ("ONLY as part of a kitchen booking") is stale; `kitchenBookingId` is nullable (`:1600`). |
| Creation | `server/services/booking-checkout-fulfillment.ts:64-80` (live), `server/routes/webhooks.ts:803-824` (legacy), `server/domains/bookings/booking.service.ts:172,226` (legacy) | **Every insert sets `kitchenBookingId`. There is no standalone create endpoint.** `server/routes/bookings.ts` only has the add-on path. |
| Approval | `server/services/booking-payment-decision.ts:185-187` | Storage is confirmed only as a side effect of the kitchen booking decision. |
| Cancellation | `server/services/booking-item-cancellation.ts:16` throws "Local Cooks must review this historical standalone booking" when there is no parent; `:19` takes the parent's clock; `shared/cancellation-policy.ts:89` `used_storage` (started storage is non-refundable) | Clock is the kitchen session's. |
| Extension | `server/routes/bookings.ts:821` (`extension-preview`), `:940` (`extension-checkout`, gated by `requireNoUnpaidPenalties`); `shared/schema.ts:2115` `pendingStorageExtensions`; manager approve `server/routes/manager.ts` (~6774); `server/services/auth-expiry-service.ts:117` lazy expiry; UI `StorageExtensionDialog.tsx`, `PendingStorageExtensions.tsx`, `ExpiringStorageNotification.tsx` | Priced per day x extra days. Needs manager approval and auth-then-capture. Extension money transfers **at capture**, not after closeout (map section 10). **Never verified live.** |
| Move-in | `server/services/storage-checkout-service.ts:287` `requestStorageCheckin` | Auto-approved, photos stored as `photo_before`. Needs booking `confirmed` and started. |
| Move-out | `storage-checkout-service.ts:137` `requestStorageCheckout`, `:746` `processCheckoutApproval` (clear or claim), `processCheckoutClear`, `processCheckoutStartClaim`, `:1038` `autoCleanExpiredCheckout`, `:1089` sweep wired at `server/services/recurring-worker.ts:141` | Clear-or-claim, no deny or re-clean. |
| Holdover | `server/services/overstay-penalty-service.ts:120` `detectOverstays`, `:612` manager decision, `:759` charge, `:1391` dispute; schema `:2143-2224` | Penalty is never auto-charged (good, matches owner). **Only "supported" when frozen terms are `daily` and accepted (`:206`); anything else is forced to `escalated` (`:226`).** A monthly product has no daily rate, so every case lands in manual review. |
| Damage claims | `server/services/damage-claim-service.ts:62-65,152-160,242-257` accepts `bookingType: 'storage'` + `storageBookingId`; v2 rules in `damage-claims-v2.ts` | Storage claim already creates. Confirm v2 limits (72 h window, $250 cap, one per visit) apply: written for visits. |
| Reminders | `server/services/advance-reminders.ts:27,181` `storage_arrival`; `deadline-reminders.ts:54-69` storage review reminders | Arrival reminder exists. **No renewal-due, grace, or holdover reminders.** |
| Chef UI | `ChefBookingsView.tsx` storage table, dialogs `StorageCheckinDialog.tsx`, `StorageCheckoutDialog.tsx`, `StorageExtensionDialog.tsx`, status trackers; overstay `PendingOverstayPenalties.tsx` | Buried in the Bookings tab. **No "Manage my storage" page.** |
| Manager UI | `ManagerStorageBookingsPage.tsx`, `StorageExtensionApprovals.tsx`, `PendingStorageCheckouts.tsx`, `PendingStorageCheckins.tsx`, `overstays/OverstayPenaltyQueue.tsx`, `VisitAssistancePanel.tsx` | No occupancy board. |
| Admin UI | `AdminOverstayPenalties.tsx`, `EscalatedPenalties.tsx`, `OverstayPenaltySettings.tsx` | Admin sees penalties only, not storage rentals. |
| Invitations | `shared/schema.ts:550` `kitchenInvitations` (this week) | Session shaped (date, start/end time, slots). Not storage. |

### b2. What is coupled to kitchen bookings (breaks for a standalone rental)

1. **Creation + approval:** only inside a kitchen booking and its decision (`booking-checkout-fulfillment.ts`, `booking-payment-decision.ts:185`).
2. **Payment:** shares the kitchen PaymentIntent (`schema.ts` `paymentIntentId` comment; fulfillment `:75`) and its captured component allocations; refund and cancel math assume one intent per booking.
3. **Cancellation clock** is the kitchen's (`booking-item-cancellation.ts:19-28`).
4. **Support console, money guard and support flags join storage to its parent** and silently drop rentals with `kitchen_booking_id` null: `server/services/booking-support.ts:78` (loads storage by `kitchenBookingId`), `booking-money-guard.ts:16-19` (maps a storage payment to `s.kitchen_booking_id`), `booking-support-flags.ts:11,48` (`if (item?.bookingId) ids.push(...)`). A standalone storage payment would be invisible to the money guard and the support desk.
5. **Commitment problems (check-in problem reports)** are `booking | tour` only (`server/services/commitment-problems.ts:28`); storage cannot raise one.
6. **Documents and history:** receipts for storage are built only from the parent's `capturedComponentAllocations` (`booking-documents.ts:150`); booking history shows storage only as an item inside a booking (`shared/booking-history.ts:13,115`).
7. **Hide-the-whole-listing rule:** `storageListingAwaitingRemoval` (`booking-linked-cancellation.ts:13`) blocks the listing while any occupant awaits removal. No capacity model.
8. **Overstay engine** needs frozen daily terms (see above).

### b3. Half-built or never verified

- Standalone create path: none. Schema allows it, no route produces it.
- Capacity / unit assignment / per-unit availability: designed Oct 14, not built.
- Storage booking has never been exercised live: `PHASE0_LOG.md:622` ("Not yet exercised: ... storage booking ...").
- Storage extension flow, move-in/out, holdover: built years ago against the old daily model; no live run in this cycle.
- `autoCleanExpiredCheckout` clears a move-out when the review window expires without a manager answer. Combined with overstay detection skipping "checkout in progress", **a chef can stop a holdover by requesting move-out and leaving items in the unit.** (Map pain point 5.) Needs a "items still here" reopen (see dead end 14).
- Notification copy for storage lifecycle events is English-only (`map-notification-i18n.md`).
- Orphaned UI: `StorageSelection.tsx`/`KitchenBookingCalendar.tsx`, default export of `StorageListingManagement.tsx`.

---

## (c) Recommended lifecycle

### c1. Model in five lines

1. **Rental = one unit + a term.** `startDate`, `paidThroughDate` (today's `endDate`), unit, frozen price terms (monthly price, daily price, holdover daily price, grace days, reclaim notice days).
2. **Term lengths:** a month (default, anniversary-based: Jan 17 to Feb 17) or a date range at the daily price (Oct 14 owner decision: no weekly, no hourly).
3. **Renewal = Priya pays to extend** ("Extend to {date} · $X"), on-session, one tap on the saved card with Stripe Checkout fallback. **No subscription object, no off-session charge, no retries.**
4. **The first rental is approved by Sam; extensions are not**, unless an extension would run into a reservation or a reclaim notice (then it is blocked, not queued).
5. **Everything that costs Priya money beyond her own extension** (holdover, damage) is raised by Sam or Local Cooks, shown to Priya, and paid or disputed by her. Same pattern as damage claims (`policy-facts-booking.md` section 4).

### c2. States

| State | Meaning | Unit | Money |
|---|---|---|---|
| `requested` | Priya asked; card hold placed | held for Sam's decision | hold only |
| `declined` / `expired` | Sam said no, or no answer in 24 h | released | hold released |
| `reserved` | Approved and paid, start date not reached | assigned, reserved | captured |
| `active` | Items in the unit (move-in done) | occupied | paid through `paidThroughDate` |
| `ending_soon` | Sub-state of active: 7 days or fewer to `paidThroughDate` | occupied | reminders run |
| `grace` | Past `paidThroughDate`, within the grace days (5) | occupied | Priya may still extend at the normal price, no penalty |
| `holdover` | Grace over, items still there | occupied | daily holdover **accrues as a figure only**; nothing charged until Sam or Local Cooks raises a request-to-pay |
| `move_out_requested` | Priya says she emptied it | occupied until checked | stops holdover **once cleared** |
| `ended_clear` | Sam cleared it; closed | released (needs-cleaning if flagged) | settled |
| `ended_claim` | Sam filed a damage claim | released | claim flow |
| `ended_by_kitchen` / `ended_by_admin` | Reclaim notice served, kitchen closed, or Local Cooks ended it | follows the same move-out path | refund of unused paid time (see dead end 6) |
| `cancelled` | Withdrawn before start | released | refund under the storage-before-start rule |
| `removal_review` | Items left past the holdover cap; Local Cooks has the case | occupied | holdover frozen at the cap |

Allowed transitions: `requested -> reserved | declined | expired`; `reserved -> active | cancelled`; `active -> grace -> holdover`; `active | grace | holdover -> move_out_requested -> ended_clear | ended_claim | active (reopened: items still there)`; `holdover -> removal_review -> ended_clear`; any occupied state `-> ended_by_kitchen | ended_by_admin`.

### c3. Who acts, what money moves

| Moment | Priya (chef) | Sam (kitchen) | Local Cooks | Money |
|---|---|---|---|---|
| Request | Pick unit type, dates or "month", accept price, rules, holdover terms and the "no automatic charges" statement; card hold | Gets request, 24 h to answer (reuse booking response rules) | Told of requests that expire unanswered | Hold only |
| Approve | Notified, sees unit label | Approves (auto-assigns a unit, can change), or declines with a reason | none | Hold captured on approval (same as kitchen booking) |
| Move-in | Required: photos of the empty unit and of the stored goods, checklist (reuse `requestStorageCheckin`). Nudged at day 1 and day 3 | Gets the photos. May add its own handover photo | none | none |
| Extend | "Extend to {date} · $X" at any time, last 7 days highlighted; pays | Told "extended"; no approval | none | New charge on Priya's explicit tap |
| Reminders | In-app + email at 14, 7, 2 days before, on the day, and in grace on days +1, +3, +5 | Digest of "renewal due" and "in grace" on the storage board | Admin sees counts per kitchen only | none |
| Grace ends | Told holdover starts, how to pay, how to move out | "Holdover started" with one primary action: "Raise holdover charge" or "Waive" | none | Holdover figure accrues, **nothing charged** |
| Holdover charge | Sees a request-to-pay with days and rate; pays, or disputes within 72 h | Raises (can only lower the computed amount); can waive | Final decision on disputes | Charged only when Priya pays |
| Move-out | Request move-out with photos of the empty unit (reuse checkout) | Inspect: **clear** or **file claim** within the window | Reviews claims | none unless claim |
| End by kitchen | Sees a dated notice, can move out earlier | "Ask Priya to move out by {date}", min 30 days for monthly | Can do it for the kitchen with a reason | Unused paid time refunded (dead end 6) |

### c4. Notices (all in-app + email, three languages, tour notice shell like the booking emails)

Chef: request received; approved with unit label and start date; declined/expired (hold released); move-in reminder; "paid through {date}" at 14/7/2 days and the day; grace start and last day; holdover started and each daily total on request-to-pay; move-out cleared; claim filed; reclaim notice; admin action.
Manager: request needs an answer (24 h), moved in, renewal due this week, in grace, holdover started, move-out requested, extension paid, chef ended early.
Local Cooks: new notice kinds into `ADMIN_BOOKING_KINDS` (`server/services/admin-booking-notice.ts`): rental requested/expired, holdover raised, dispute opened, removal review opened, reclaim notice served. Not tracked: reminders, move-in, extensions (matches the Oct 15 admin rule).

### c5. Every dead end and its resolution

| # | Situation | Chef next step | Kitchen next step | Local Cooks next step |
|---|---|---|---|---|
| 1 | **Chef forgets to extend** | Reminders (14/7/2/0). In grace she can still extend at the normal price, no penalty. | Sees "in grace" on the board; can message Priya | none |
| 2 | **Chef doesn't move out after grace** | Holdover figure grows; she can still extend or move out; request-to-pay arrives | Raise or waive the holdover charge; "Ask Priya to move out by {date}" | Contacts Priya; if still nothing after the cap, opens `removal_review` (see 4) |
| 3 | **Holdover charge unpaid or disputed** | Pay, or dispute within 72 h | Waits; dispute goes to Local Cooks | Final decision (existing overstay dispute/escalation). Unpaid and upheld for 7 days sets the same booking hold as an unpaid damage claim (new bookings paused, existing unaffected). |
| 4 | **Items left behind / abandoned** | Holdover cap (recommended 30 days past grace) and a final written notice with a 10-day deadline, sent by Local Cooks only | Photos of the unit; cannot dispose by itself | Final notice, then authorizes: perishables discarded for food safety with before/after photos; non-perishables boxed, labelled and held (recommended 30 days), then returned, donated or discarded per counsel's wording. **Never sold, never on a timer.** Unpaid holdover stays a debt (account hold). |
| 5 | **Kitchen needs space back** | Gets a dated notice (min 30 days for monthly), can move out sooner. Extension past the notice date is blocked. | "Ask Priya to move out by {date}" in the rental's More menu | Can issue on the kitchen's behalf for emergencies with a reason; relocates the rental to another unit if available |
| 6 | **Kitchen-side end leaves paid time unused** | Told the refund amount at the time of the notice | Refund comes from the kitchen's side (same as kitchen-at-fault cancellations) | Can absorb it; settles |
| 7 | **Payment fails at request** | Pay with another card (reuse "Pay with another card") | Nothing | none |
| 8 | **Payment fails at extend** | Retry or another card (Stripe Checkout fallback); rental stays in its current state; **nothing auto-retries** | Sees "extension failed" if in grace | none |
| 9 | **Chef disputes condition at move-out** | Dispute the claim (existing claim dispute, 72 h) with her move-in photos | Claim with receipts | Reviews and decides (existing claim flow) |
| 10 | **Chef never does move-in** | Nudges at day 1 and 3; can still do it later | Can add its own handover photo; a claim without a chef baseline is weaker and says so | none. Rule: if no baseline photos exist, a claim must show Sam's own handover photos |
| 11 | **Chef never shows (reserved, no move-in)** | Cancel (before start) | Alert after 7 days with "Release unit" | Can release; refund per the before-start rule |
| 12 | **Kitchen doesn't answer a request** | Hold released at 24 h (reuse expiry); told | Reminder at 12 h | Alerted on repeat offenders |
| 13 | **Kitchen closes or delists** | Notice and "move out by" date; she is offered another unit; unused paid time refunded | Cannot delete a listing with occupied units (reuse `deletion-guard.ts`); pause blocks new rentals only | Bulk "end all rentals at {kitchen}" with reason, 30-day notice, refunds |
| 14 | **Chef says "I moved out", items still there** | Sees "reopened: items still in the unit" with the kitchen's photo | "Items still here" with photo reopens the rental within 7 days of a clear or auto-clear; holdover resumes | Reviews if Priya contests. Needed because `autoCleanExpiredCheckout` clears on timeout. |
| 15 | **Kitchen never answers a move-out** | Auto-closes in the window (existing); she keeps her photos | Can reopen (14) | Weekly list of auto-cleared moves for audit |
| 16 | **Chef wants to extend but next renter is reserved** | "Can't extend past {date}. Ask the kitchen." (no name shown) | Can relocate Priya to another unit | Tool to move the rental |
| 17 | **Price changes mid-rental** | Frozen for the paid term. The extend screen shows the new price before paying | Edits apply to future terms only | none |
| 18 | **Chef account suspended or deleted** | n/a | Items remain; rental runs through the same holdover/removal path | Admin hold; `deletion-guard.ts` extended to storage |
| 19 | **Items are food safety hazard (spoiled, leaking)** | Sam may flag "urgent: unsafe item" | Photo + one tap sends Local Cooks an urgent notice and starts a 48 h removal order | Can authorize immediate discard with evidence |
| 20 | **Chef wants to end early** | "Move out now" (no refund of paid-through time by default) | Can refund unused time upward (More menu) | Can refund or waive |
| 21 | **Dispute: "kitchen locked me out / can't access my items"** | Report a problem on the rental (storage uses the same problem report as bookings) | Must restore access or reply | Reviews; holds kitchen payout for that term while open |
| 22 | **Payment succeeded but the rental can't start (unit gone, kitchen cancelled)** | Full refund | Told | Alerted; reuse "payment recovery needed" notice |

### c6. Money rules in one place

- **No auto-renew, no off-session charges, no retries.** The saved card may be offered as a one-tap on-session pay, always the chef's explicit tap. Checkout fallback is the same as the kitchen flow.
- **First term:** card hold, captured on Sam's approval. **Extension:** immediate capture when Priya pays. Both are charges on the platform, transferred to Sam later (payout timing is OQ4).
- **Holdover and damage:** requests Priya sees and pays; never automatic (already the rule in `overstay-penalty-service.ts` header and the damage-claim flow).
- **Refund defaults:** before start: full refund minus the real card fee if cancelled 48 h or more before start; after start: none, except kitchen or Local Cooks fault (full unused time refunded). Reuse `shared/cancellation-refund.ts` for the fee math.
- **Prepay cap:** extend in one-month steps, up to 3 months ahead. That bounds the money at risk if the kitchen has to end it, and avoids building proration.
- **Gating:** the existing `requireNoUnpaidPenalties` on `extension-checkout` is the right shape: unpaid holdover or claims block new rentals, not the chef's ability to pay or move out.

### c7. Check-in and check-out (mirror the kitchen session)

- **Move-in** (chef): checklist plus required photos (empty unit, then goods in place). Stored as `photo_before` evidence (existing `requestStorageCheckin`). Kitchen can add its own handover photo. Move-in is not an approval step, it is a record.
- **Move-out** (chef): photos of the emptied unit, then Sam clears or files a claim (existing). Window: the same 24 h inspection window as kitchens; damage report within 72 h of the move-out request (same as kitchens). Local Cooks reviews every claim before the chef is contacted (existing).
- **Evidence order for a disputed claim:** chef move-in photos, Sam's handover photo, chef move-out photos, Sam's claim photos, receipts. Same evidence builder as kitchen claims (`shared/damage-claim-evidence.ts`).
- **Reopen path** for "still there" (dead end 14) prevents a chef from ending holdover without actually leaving.

---

## (d) Reuse list

| Need | Reuse | Change needed |
|---|---|---|
| Pay-to-extend | `pending_storage_extensions`, `extension-preview/checkout`, `StorageExtensionDialog` | Remove manager approval for normal extensions; capture immediately; price by the monthly price (not per-day x days); allow one-month steps; block when a reservation or reclaim notice sits in the way |
| First rental approval, 24 h expiry, hold | `booking-payment-decision.ts`, `auth-expiry-service.ts`, `stripe-checkout-service.ts` | Allow a storage-only checkout with no kitchen parent |
| Cancellation fee math | `shared/cancellation-refund.ts`, `booking-cancellation-refund.ts` | Storage-specific clock (start date, not kitchen start); leave `used_storage` rule |
| Holdover | `overstay-penalty-service.ts` (approve, waive, request-to-pay, dispute, escalate) | Accept a rental that has a daily holdover price even if not `daily`; add "raise to chef" notice kind |
| Damage claims | `damage-claim-service.ts` (storage branch exists), `damage-claims-v2.ts`, privacy rules, 7-day booking hold | Confirm windows and caps apply to storage move-out dates |
| Move-in/out | `storage-checkout-service.ts`, `StorageCheckin/CheckoutDialog`, status trackers | Add reopen ("still there"); stop auto-clear freeing the unit silently |
| Problem reports | `commitment-problems.ts` (booking/tour) | Add a `storage` kind; storage problems hold the term's payout |
| Support console | `booking-support.ts` + `booking-support-flags.ts` + `booking-money-guard.ts` | Re-key from `kitchen_booking_id` to include standalone storage rows |
| Receipts | `booking-documents.ts`, `booking-document-pdf.ts` | New document kind for a storage term |
| Lifecycle notices | `booking-lifecycle-delivery.ts`, `advance-reminders.ts` (`storage_arrival`), `deadline-reminders.ts`, admin notice list | New kinds: ending_soon, grace, holdover, reclaim notice, reopened |
| Timers | `recurring-worker.ts` task runner (`lifecycle-task-runner.ts`) | Add ending_soon/grace/holdover sweep |
| Invitations (special price) | `kitchen-invitation*`, `/invitations` pages (new this week) | Later: extend to storage price offers (Oct 14 owner item) |
| Deletion safety | `deletion-guard.ts` | Cover storage rentals |
| Manager and admin surfaces | `ManagerStorageBookingsPage.tsx`, admin penalty pages | Turn into the occupancy board from `research-storage-availability.md`; add admin storage-rentals list |

Not reusable: the session-shaped visit-code and check-in clock, and `cancelBookingItem` (kitchen-parent only).

---

## (e) OPEN QUESTIONS for the owner

**OQ1. Renewal shape with no auto-renew.**
- A. *Rental = paid-through date; renewal = chef pays to extend (recommended).* No Stripe Billing. Matches the existing extension flow. Cost: she must act each month; reminders carry the load.
- B. Same, plus a kitchen-level "chefs can opt in to auto-renew" toggle (your Oct 14 option). Rejected today; leave it out.
- C. Fixed terms only (3/6/12 months, Church Kitchen style), no extension. Safer for kitchens, less flexible.

**OQ2. Grace and holdover rate.**
- A. 5-day grace, then holdover at the daily price x 1.0, accrues only (recommended; matches "5-day grace" and the daily rate you chose).
- B. 5-day grace, then daily price x 1.5 (current overstay penalty rate multiplier; discourages squatting; harder to explain).
- C. No grace, holdover from day 1. Harsh given no auto-charge.
Also confirm the **holdover cap**: recommend 30 days after grace, then Local Cooks opens a removal review.

**OQ3. What Priya can extend by.**
- A. One-month steps up to 3 months ahead, plus a date range at the daily price (recommended).
- B. One month at a time only.
- C. Any number of months prepaid. Highest refund and reclaim exposure.

**OQ4. When the kitchen is paid.**
- A. At capture, as the current storage extension does (simplest; kitchen owes back via recovery if the rental ends at fault).
- B. When the term ends (cleanest; kitchen waits up to a month).
- C. On move-in done or 48 h after term start, held if a problem is open (recommended; closest to "paid after the visit" for kitchens).

**OQ5. Early move-out refund.**
- A. None for the paid term; the kitchen may refund upward; kitchen or Local Cooks fault refunds unused time (recommended; matches Neighbor, TFC, self-storage).
- B. Refund whole unused months only.
- C. Pro-rata daily. Most chef-friendly, most proration code, no peer does it.

**OQ6. Deposit.**
- A. No deposit at launch; use move-in evidence, request-to-pay holdover and the booking hold for unpaid claims (recommended).
- B. One-month refundable deposit, optional per kitchen (Church Kitchen, Stashbee advice). More money held and more refund machinery.
- C. Required card-hold at move-in only. Hold expires in 5-7 days, so it does not cover the rental period.

**OQ7. Abandoned goods wording and authority.**
- A. Local Cooks only: final 10-day written notice, then discard perishables with photos, hold non-perishables 30 days, then return/donate/discard; no sale (recommended).
- B. Kitchen can discard perishables itself after Local Cooks' notice. Faster; more risk of disputes.
- C. Lien-style sale. Not recommended; no NL authority found.
Either way, **have NL counsel approve the terms** before launch.

**OQ8. Kitchen reclaim notice.**
- A. 30 days for monthly; daily ranges cannot be reclaimed; emergencies via Local Cooks (your Oct 14 answer, kept; matches Neighbor's 30-day rule).
- B. 15 days (self-storage norm).
- C. Notice equals the remaining paid time, max 30 days. Simplest to explain, harms the kitchen on a fresh month.

**OQ9. Move-in required?**
- A. Required photos and checklist; skipped for 7 days triggers a nudge and a note on any later claim (recommended).
- B. Required before the unit counts as occupied; blocks the kitchen if Priya never does it.
- C. Optional. No evidence, no baseline.

**OQ10. Existing kitchen-linked storage rows.**
- A. Keep their contract and extension flow until they end; new rentals use the new flow (recommended; Oct 14 owner answer).
- B. Convert at next extension.
- C. Hard cutover. Risky with no live storage data yet.

---

## What to build first (suggested order, for the plan, not a decision)

1. Standalone create + approval + unit capacity (`research-storage-availability.md` model), decoupled from the kitchen payment. Unblocks everything.
2. Re-key support console, money guard and flags to standalone storage rows (dead end 4 above is a hidden data-integrity risk).
3. Pay-to-extend on the new term model, reminders, grace, holdover accrual, request-to-pay.
4. Move-in/out with reopen, storage problem reports, kitchen/admin end flows, removal review.
5. "Manage my storage" (chef), storage board (kitchen), rentals list (admin), receipts, i18n.
6. One live rehearsal for each of: approve, extend, grace to holdover, reclaim, damage claim, kitchen closes. Storage has never been run live (`PHASE0_LOG.md:622`).

## Sources not opened in full

Neighbor "renter stops paying", "payment declined", Public Storage's own site, Storeganise facility terms and Law Insider clauses were read only via search summaries. Quote-level claims from those are marked Search-summary above. Primary pages reread this session: Stashbee abandoned items, Airbnb change request, Stripe collection methods (via search), plus all Oct 14 TFC and Neighbor citations carried over from `research-storage-structure.md`.

## Owner decisions (Oct 16, 2026)

- **OQ1 Renewal:** chef taps to extend (no auto-renew, no approval for extensions; first rental approved by the kitchen). Kitchen side also gets tools (owner asked to consider): "Ask the chef to move out by {date}" and "Offer an extension" (a nudge with the price; the chef still pays).
- **OQ2 Grace/holdover:** 5-day grace (extend at the normal price), then holdover at the normal daily price, accruing only; the kitchen raises it as a charge request or waives it. **Removal review after 15 days of holdover** (owner shortened from 30).
- **OQ3 Extend/prepay:** extend by days or by months. Platform maximum set by admin (**2 months**), the kitchen may set its own lower maximum (same pattern as the cancellation policy settings).
- **OQ5 Early move-out:** no refund for unused time the chef chose not to use; kitchen or Local Cooks fault refunds unused time in full; the kitchen may refund more. Owner wants help writing the storage policy (trust-building, parallel to the booking policy).
- **OQ6 Deposit:** none at launch.
- **OQ4 Kitchen payout timing, OQ7 abandoned items, OQ8 reclaim notice:** owner asked for more research. Concerns: clawback after payout if a dispute arrives; Stripe fund-holding limits and Canadian legality (may cap the max rental length); prefers the **kitchen** has authority over abandoned items with Local Cooks notifying/documenting; 30-day reclaim notice too long for short pilot rentals, and refunds should follow the booking fault rules. Research: `research-storage-money-notice-2026-10.md`.
- **Open:** OQ9 (move-in required?), OQ10 (existing kitchen-linked storage rows).

### Owner decisions, round 2 (Oct 16, 2026) — supersede OQ3's 2-month max where they differ

- **Term length: 30 days maximum.** No recurring payments: the chef pays for up to 30 days at a time and extends by paying again (by days or up to another 30), unless they move out earlier. Admin sets the platform maximum (30), a kitchen may set lower.
- **Kitchen payout:** once per paid term, at the earlier of move-in done or 48 h after the term starts; paused while a problem report or claim is open. Hold normally ~2 days, never above 30 (Stripe allows 90 for Canada — verified docs.stripe.com/connect/account-balances#holding-funds).
- **Refund/chargeback after payout:** the kitchen owes it, as with kitchen bookings today (transfer reversal if the kitchen's Stripe balance allows, otherwise recorded and netted from later payouts). Kitchen agreement must say so; notify the kitchen when it happens. Owner asked how chargebacks can be contested with evidence (see chargeback work).
- **Abandoned items:** the shorter option. After Local Cooks' final notice, the kitchen may discard perishables after 48 h and other items 7 days later, with photos and an item list; never sold. NL counsel to review wording.
- **Reclaim notice:** with a 30-day maximum the scaled rule reduces to one line: rentals of 7 days or less can't be reclaimed (emergencies via Local Cooks); longer rentals get 7 days' notice (or the time left, if less). Chef gets a full refund of unused time, borne by the kitchen. No extra penalty in the pilot.
- **Move-in:** required as part of the flow but never a dead end (photos + short checklist, nudges; missing baseline noted on any claim; kitchen handover photo counts). Owner asked for peer research on whether it's required elsewhere.
- **Existing kitchen-linked storage rows:** no production storage data — do what's cleanest (hard cutover allowed on dev test data).
