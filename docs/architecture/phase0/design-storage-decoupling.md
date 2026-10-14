# Storage decoupling: current state, research and target design

**Design handback — 14 October 2026.** Read-only review of the current working tree and public sources. This is a product/engineering design for owner review, not implementation authorization and not a production-readiness assessment. Exactly this file was written; no application source, migration, database, payment account, hosting configuration or background workflow was changed or queried. Public pages and documentation were read without signing in to any account.

**Names used:** *Priya* is the food-business member who rents storage; *Sam* is the kitchen manager. The company is **Local Cooks** throughout (never "admin"); "chef" is only used where it names the current database column or route (`chefId`, `/api/chef/...`).

**Evidence discipline (as in `research-booking-model-gaps.md`):** **Repository evidence** means the cited current file contains the behavior. **Documented** means a first-party public page or vendor doc explicitly states it. **Inferred** is a Local Cooks design lesson, not a claim about a competitor's internals. **Not verified** means public evidence or the reviewed code does not establish the capability. File:line references identify the inspected working tree; rerun the cited reads before implementing. No browser, API, database or provider rehearsal was performed for this report.

**Authority, in order:** (1) owner decisions in `PHASE0_LOG.md`, especially the Oct14 storage decision at `PHASE0_LOG.md:42` ("Storage must be redesigned decoupled from kitchen sessions … monthly subscriptions per unit, daily holdover, a 'Manage my storage' module — to be verified, not assumed"); (2) the owner's fairness rules, the no-stuck rule (`PHASE0_LOG.md:79`) and the D11 support requirement (`PHASE0_LOG.md:259`); (3) the sibling designs this must stay consistent with — `research-booking-model-gaps.md` §A8 (storage gaps), `design-checkin-checkout.md` (custody and move-out pattern), `local-cooks-booking-policy.md` (situation matrix C28/C29/C33), `lifecycle-walkthrough.md` (settlement reality).

**Owner's own research, to be verified (not assumed):** (a) top shared-kitchen platforms treat storage as a recurring flat monthly subscription per shelf/unit (dry, fridge, freezer), held 24/7 and independent of cooking sessions; (b) short-term "holdover" storage is a separate daily fee; (c) only approved members can rent storage, but once approved they can keep storage on days without a session; (d) the dashboard has two modules — "Book a kitchen session" and "Manage my storage" (active subscriptions / daily holds). Verdict up front, in detail in §2: **(a) confirmed; (b) partly confirmed (overstay/daily-charge norm is well established, a distinct self-serve "daily holdover" product is not universally published); (c) confirmed in substance; (d) not verifiable as a literal competitor module — treat as a design direction, not a copied feature.**

---

## 1. Current state (exhaustive, file:line)

### 1.1 Schema

Storage lives in five tables plus a quote cache:

- **`storage_listings`** (`shared/schema.ts:1179-1240`). Belongs to a kitchen (`kitchenId`, `:1181`), `storageType` dry/cold/freezer (`:1182`), descriptive physical fields including `shelfCount` (`:1191`), pricing `pricingModel` (`:1204`), `basePrice` in cents (`:1205`), `pricePerCubicFoot` (`:1206`), `minimumBookingDuration` (`:1208`), `bookingDurationUnit` (`:1209`), moderation `status` (`:1213`), `isActive` (`:1219`), `availabilityCalendar` jsonb (`:1220`, commented "Blocked dates, maintenance windows"), and per-listing overstay overrides (`:1233-1236`). There is **no unit count / capacity / quantity column** — nothing enumerates how many of a listing exist.
- **`storage_bookings`** (`shared/schema.ts:1412-1464`). `storageListingId` (`:1417`), frozen `overstayTerms` jsonb (`:1418`), **nullable** `kitchenBookingId` (`:1419`, comment "NULLABLE - storage can be booked independently"), `chefId` (`:1420`), `startDate`/`endDate` (`:1421-1422`), `status` (`:1423`), `totalPrice` in cents (`:1424`), `pricingModel` (`:1425`, comment "Always 'daily' now"), `paymentStatus` (`:1426`), `paymentIntentId` (`:1427`, comment "shared across bundled items in same kitchen booking"), `serviceFee` (`:1428`), saved-card fields for penalties `stripePaymentMethodId`/`stripeCustomerId` (`:1431-1432`), the checkout workflow fields (`:1436-1446`), the symmetric check-in/move-in fields (`:1449-1454`), and chef cancellation-request fields (`:1457-1460`).
- **`storage_overstay_quotes`** (`shared/schema.ts:1466-1472`): a cache of accepted overstay terms keyed by member and listing, consumed at checkout fulfillment.
- **`pending_storage_extensions`** (`shared/schema.ts:1889-1910`): a separate Stripe Checkout session and payment intent per extension (`:1898-1899`), status flow `pending → paid/authorized → approved/rejected → completed` (`:1900-1901`), manager decision fields (`:1903-1906`).
- **`storage_overstay_records`** (`shared/schema.ts:1933-1994`) and **`storage_overstay_history`** (`shared/schema.ts:1998-2009`): the manager-controlled penalty workflow. `overstayStatusEnum` is at `:1917-1928`.
- The `bookingTypeEnum` includes `storage` (`shared/schema.ts:65`), and the kitchen booking carries a denormalized `storageItems` jsonb snapshot (`shared/schema.ts:565`).

**Contradiction to record:** the schema header comment says storage "can ONLY be booked as part of a kitchen booking (not standalone) … no standalone storage booking endpoints" (`shared/schema.ts:1392-1393`), yet `kitchenBookingId` is nullable (`:1419`), the insert schema marks it optional "for standalone storage bookings" (`:1477`), and the cancellation service explicitly handles a missing parent ("Local Cooks must review this historical standalone booking", `server/services/booking-item-cancellation.ts:16`). The codebase is therefore *partly* prepared for standalone storage, but no live creation path produces it. That gap is the seam this design widens deliberately.

### 1.2 How storage is booked, and how it couples to kitchen sessions

Storage is created **only inside a kitchen booking**, in three related paths:

1. **Fresh kitchen booking with explicit storage dates** — `booking.service.ts:146-199`. For each `selectedStorage` entry it computes `priceCents` (see §1.3) and inserts a `storage_bookings` row with `kitchenBookingId: booking.id`, `status: 'pending'`, `totalPrice`, `pricingModel: listing.pricingModel || 'daily'` (`:172-183`). It also pushes a denormalized entry into `storageItemsForJson` (`:186-195`).
2. **Fresh kitchen booking fallback** (`selectedStorageIds`, no dates) — `booking.service.ts:203-258`: same-day booking, flat price, `kitchenBookingId: booking.id`, `status: 'pending'` (`:226-237`).
3. **Quoted checkout fulfillment** — `booking-checkout-fulfillment.ts:49-65`: on a paid/authorized kitchen Checkout, it inserts one `storage_bookings` row per quoted listing with `kitchenBookingId: parent.id` (`:59`), `paymentIntentId: intent.id` (`:60`, **the shared PaymentIntent**), frozen `overstayTerms` from an accepted quote (`:61`), and a `pending` status. It refuses if the listing is awaiting removal (`:50-52`) and records per-component allocations on the payment transaction (`:81-85`).

Eligibility is inherited from the kitchen booking: creation runs `getApplicationStatusForBooking` and throws if `!canBook` (`booking.service.ts:107-108`), so storage is implicitly **approved-members-only via location access** (matching `PHASE0_LOG.md:119`: access is approved per location).

**Approval coupling:** a storage row starts `pending` and becomes `confirmed` **only when Sam confirms the parent kitchen booking**, inside `decideAuthorizedBooking`/`reconcileBookingDecision` (`server/services/booking-payment-decision.ts:67-71,185-187`). There is no independent storage-approval step; confirming or cancelling the kitchen booking confirms or cancels the storage items in the same decision. Partial approval is supported by rejecting individual storage items (`booking-payment-decision.ts:77-98`), and rejected items are marked on the parent snapshot (`:194`).

**Cancellation coupling:** `cancelBookingItem('storage', …)` (`server/services/booking-item-cancellation.ts:12-49`) requires a parent kitchen booking (`:16`), takes the parent row lock, and **computes the cancellation deadline from the kitchen booking's start time and policy** (`:25-28`, hard-coded `America/St_Johns`). Paid items become `cancellation_requested` and wait on Sam (`:32-35`). The chef route mirrors this and returns dead code for the standalone branch (`server/routes/bookings.ts:394-413`). A storage item therefore cannot be cancelled on its own terms — its clock is the kitchen session's clock.

### 1.3 Pricing models

The enum supports four models (`shared/schema.ts:46`): `monthly-flat`, `per-cubic-foot`, `hourly`, `daily`. Actual charging today:

- Explicit-date path (`booking.service.ts:159-168`): `days = ceil((end − start)/day)`, floored by `minimumBookingDuration`; `priceCents = basePrice × effectiveDays`; **`hourly`** overrides to `basePrice × ceil(hours)`; **`monthly-flat` charges `basePrice` once, not per month** (`:166-168`).
- Fallback path (`booking.service.ts:215-222`): `hourly` uses session duration; everything else is a single flat `basePrice`.
- The booking row records `pricingModel` but the column comment asserts "Always 'daily' now" (`shared/schema.ts:1425`), and `bookingDurationUnit` is **not interpreted** in the pricing math (it is read as days). This matches the gap already recorded in `research-booking-model-gaps.md:97-99`.

So "monthly" exists as vocabulary only; there is no recurring billing, no calendar-month multiplier, and no proration.

### 1.4 Extension flow and its payment

The extension is a **separate purchase with its own PaymentIntent** (not the kitchen PaymentIntent):

- `POST /chef/storage-bookings/:id/extension-preview` (`server/routes/bookings.ts:757-873`) checks ownership, blocks `pending`/`cancelled`/`completed` (`:779-790`), blocks any active overstay (`:792-812`), then prices `basePricePerDay × ceil(extensionDays)` floored by the minimum (`:824-855`) with the **kitchen's tax rate** (`:841-853`).
- `POST /chef/storage-bookings/:id/extension-checkout` (`:876-1073`) recomputes the same price plus the platform commission (`:968-978`) and creates a **Stripe Checkout session** with `metadata.type = 'storage_extension'` (`:1012-1043`). It deliberately does **not** pre-create the extension row (comment at `:1008-1010`).
- The webhook creates `pending_storage_extensions` and the payment transaction only after payment (`server/routes/webhooks.ts:1436-1499`), saving the card for off-session penalties (`updateStorageBookingStripeIds`, `:1383-1431`).
- Sam approves with **auth-then-capture**: if the extension is `authorized`, `capturePaymentIntent` runs at approval (`server/routes/manager.ts:6770-6812`), then `extendStorageBooking` moves the end date (`:6826-6829`), the extension is marked `completed` (`:6832-6839`), and any active overstay records are auto-resolved as `extended` (`:6850-6877`).
- A legacy `PUT /extend` exists but only echoes a booking after verifying a `completed` extension reference — it never mutates terms from a client flag (`server/routes/bookings.ts:1245-1303`).
- Pending-extension reads lazily expire aged authorizations (`server/routes/bookings.ts:1111-1128`).

### 1.5 Overstay penalties

`server/services/overstay-penalty-service.ts`:

- `detectOverstays` (`:120-450`) scans `confirmed`/`completed` bookings past `endDate` (`:154-159`), **skips any booking whose checkout is in progress** (`:168-177`), computes calendar days overdue in the location zone (`:180-189`), and reads grace/rate/max from frozen terms or location/listing defaults (`:191-205`).
- **Penalties are never auto-charged** — the file's own rule (`:8-13`). The formula is `dailyRate × (1 + penaltyRate) × penaltyDays`, capped by `maxPenaltyDays` (`:209-217`), and only "supported" when the frozen terms are `daily` with an accepted timestamp; otherwise the record is forced to `escalated` for manual review (`:206,226,320`).
- Sam can `approve`/`waive`/`adjust` (`processManagerDecision`, `:612`; routes at `server/routes/manager.ts:7434,7495`), then `charge` (`:7553`). `chargeApprovedPenalty` (`:759-…`) is **off-session** against the saved card (`:819-846`) and routes the charge to the manager's Connect account (`:848-879`); it is disabled by an admin switch (`:760`) and falls back to an escalation payment link when no card exists (`:843-845`).
- `resolveOverstay` can resolve as `removed` only with a manager confirming physical removal (`:1327-1341`). Disputes are member-initiated within a window and move the record to `escalated` (`disputeOverstayPenalty`, `:1391-1409`).

Overstay defaults are set at the location (`shared/schema.ts:393-397`; routes `server/routes/manager.ts:8291,8360`) and overridden per listing (`shared/schema.ts:1233-1236`; route `:8185`).

**Design-relevant limitation:** because penalties require `pricingModel === 'daily'` with accepted frozen terms (`overstay-penalty-service.ts:206,801`), a *monthly* storage product has **no defined daily holdover rate** today and would land in manual review. Any monthly model must supply an explicit daily holdover price.

### 1.6 Check-in, check-out and custody

`server/services/storage-checkout-service.ts`:

- **Move-in (check-in)** is **auto-approved** with no manager step (`requestStorageCheckin`, `:286-417`; auto-approve comment `:367`, `:404-406`). It requires the booking to be confirmed and started, and enforces manager-configured arrival duties/photos (`:352-359`); check-in photos are kept as `photo_before` baseline evidence for later claims (`:396-402`, `storeCheckinPhotosAsEvidence` `:1402-1413`).
- **Check-out** is a chef-initiated request (`requestStorageCheckout`, `:136-271`) that requires a completed check-in when arrival duties are enabled (`:206-212`), then sets `checkout_requested` (`:236-248`).
- **Manager review** is clear-or-claim with **no deny/reclean** (`processCheckoutApproval`, `:762-805`): `processCheckoutClear` marks the booking `completed` and queues `storage_removed`/clearance (`:810-880`); `processCheckoutStartClaim` files a draft damage claim and moves to `checkout_claim_filed` (`:887-1033`), auto-attaching checkout photos as `photo_after` (`:964-990`) and check-in photos as `photo_before` (`:992-1007`).
- **Auto-clear** closes an unanswered checkout after an admin review window, lazily on read (`autoCleanExpiredCheckout`, `:1054-1098`) and by a bounded worker sweep (`processExpiredCheckoutReviews`, `:1105-1182`).

**Custody invariants** live in `server/services/booking-linked-cancellation.ts`: `cancelledStorageStatus` keeps an occupied booking in `cancellation_requested` rather than freeing it (`:6-10`), and `storageListingAwaitingRemoval` is true while any booking on the listing is occupied and not manager-cleared (`:12-19`). That flag is used to **hide the whole listing from members** (`server/routes/storage-listings.ts:245-248,276-279`; `inventory.repository.ts:52`) and to refuse a new booking at fulfillment (`booking-checkout-fulfillment.ts:50-52`). Net effect: a listing behaves like **single-occupancy** while a prior occupant is awaiting removal — a coarse occupancy gate, not true capacity counting. `resolveOverstay('removed')` is the manager's confirmation that physically empties the unit (`overstay-penalty-service.ts:1327-1341`).

### 1.7 Payment coupling

- The **initial** storage booking shares the kitchen booking's PaymentIntent (`shared/schema.ts:1427`; set at `booking-checkout-fulfillment.ts:60`). Storage has no charge of its own at booking time; money is captured with the kitchen capture on confirmation (`booking-payment-decision.ts:84-85,137`), and storage's payment status is written from the same decision (`:185-187`).
- The **extension** has its own PaymentIntent (`pending_storage_extensions`, `shared/schema.ts:1898-1899`).
- The **overstay penalty** has its own off-session PaymentIntent (`overstay-penalty-service.ts:759-879`).
- Our account model (from the log) is **separate charges and transfers**: the platform charges and later transfers to the manager's Express account; refunds come from the platform balance; kitchen bookings use **manual capture at confirmation** and manager payout is planned **after closeout** (`PHASE0_LOG.md:43-47,295`; `lifecycle-walkthrough.md`).

### 1.8 UI entry points

**Member (Priya):**
- The only way to *acquire* storage is the kitchen booking flow's storage step (`client/src/components/booking/KitchenBookingFlow.tsx:299` step, `:785-837` fetch, `:1636-1705` card, `:2525-2544` modal) with the multi-select picker `client/src/components/booking/BookingStorageSelector.tsx:65-425`.
- "Manage" storage is **embedded inside the bookings tab**, not a module: `ApplicantDashboard.tsx:760-761` mounts `PendingStorageExtensions`, then `ChefBookingsView` renders the "storage" table (`ChefBookingsView.tsx:809-1156` columns/actions, storage query `:1205-1218`, table `:2004-2085`) and the dialogs `StorageExtensionDialog`, `StorageCheckinDialog`, `StorageCheckoutDialog`, `CheckinStatusTracker`, `CheckoutStatusTracker` (`:2095-2160`). Overstay penalties live under Issues & Refunds (`client/src/components/chef/IssuesAndRefunds.tsx:92-93`; `PendingOverstayPenalties.tsx:66-260`).
- There is **no standalone "Manage my storage" destination and no "storage browse" surface**; the member must start from a kitchen booking. `BookingControlPanel.tsx` and `StorageSelection.tsx` contain a parallel storage UI but are reachable only from the unrouted `KitchenBookingCalendar.tsx` (orphaned).

**Manager (Sam):**
- A real nav destination `storage-bookings` (`client/src/components/app-sidebar.tsx:48`) opening `ManagerBookingDashboard` view `storage-bookings` (`:1317-1334`) → `ManagerStorageBookingsPage.tsx:31-231`.
- Storage **listings** are a tab inside My Kitchens (`KitchensManagement.tsx:683-684,742` → `StorageListingManagement.tsx:346-1343`), also embedded in onboarding (`CreateKitchenStep.tsx:33`).
- Extension approvals (`StorageExtensionApprovals.tsx:36-321`), checkout reviews (`PendingStorageCheckouts.tsx:450-1016`), check-in history (`PendingStorageCheckins.tsx:383-504`), overstay queue (`OverstayPenaltyQueue.tsx:549-912`), and storage check-in/check-out setup (`StorageCheckinCheckoutSettings.tsx:78,173-174`).
- Manager overstay/checkout/extension endpoints are also aggregated by `use-manager-overview-activity.ts:46-50`.

### 1.9 Every coupling point to kitchen sessions (and what breaks if decoupled)

| # | Coupling | Where | Breaks if decoupled |
|---|---|---|---|
| C1 | Creation requires a parent kitchen booking | `booking.service.ts:172-237`, `booking-checkout-fulfillment.ts:58-64` | No path exists to create storage without a kitchen booking; needs a new create endpoint + approval. |
| C2 | Confirmation only via the kitchen payment decision | `booking-payment-decision.ts:185-187` | Standalone storage would never reach `confirmed`; needs its own approval + capture. |
| C3 | Shared PaymentIntent with the kitchen booking | `shared/schema.ts:1427`, `booking-checkout-fulfillment.ts:60` | Refunds/partial capture/allocations assume one intent per kitchen booking; standalone needs its own intent/subscription. |
| C4 | Cancellation clock = kitchen start + kitchen policy, hard-coded zone | `booking-item-cancellation.ts:25-28`; `server/routes/bookings.ts:406-412` | Storage has no independent notice-to-vacate; needs its own end-of-period rules. |
| C5 | `storageItems` jsonb snapshot on the parent | `shared/schema.ts:565`; `booking-payment-decision.ts:194`; `booking-linked-cancellation.ts:27-35` | Manager/parent views read storage from the parent; standalone rows must be surfaced without a parent. |
| C6 | `cancelledStorageStatus`/`storageListingAwaitingRemoval` assume kitchen-linked cancellation | `booking-linked-cancellation.ts:6-19` | A standalone cancellation must still reserve the unit until removal is confirmed. |
| C7 | Overstay "supported" only for daily + frozen terms | `overstay-penalty-service.ts:206,226,801` | Monthly storage has no daily holdover price; every overstay escalates to manual. |
| C8 | No unit inventory/capacity; listings hidden wholesale while awaiting removal | `server/routes/storage-listings.ts:245-248`; `inventory.repository.ts:52` | Cannot run multiple members per listing or enforce "N units"; a new capacity model is required. |
| C9 | Extension is priced/paid/approved as a session-shaped add-on | `server/routes/bookings.ts:757-1073`; `server/routes/manager.ts:6706-6877` | A subscription renewal replaces most extension use; extension logic must not double-bill renewals. |
| C10 | Manager UI/approvals are built around kitchen-linked items | `ManagerStorageBookingsPage.tsx:142-151`; `PendingStorageCheckouts.tsx` | Needs a standalone occupancy/subscription view. |
| C11 | Member has no standalone storage destination | `ApplicantDashboard.tsx:760-761`; `ChefBookingsView.tsx:2004-2085` | "Manage my storage" must become a first-class surface. |

---

## 2. Research (with URLs), and verification of the owner's claims

Public pages were checked 13–14 October 2026. Numerical examples describe those businesses; they are not selected Local Cooks settings. No competitor login or booking was attempted.

### 2.1 Recurring monthly storage per unit — **owner claim (a): CONFIRMED**

- **Documented — The Food Corridor (software).** Its product page advertises reserving "kitchen areas, reservable equipment, and dry and cold storage", and billing that "Automatically invoice[s] bookings, fees, and storage" under "Customize Membership Plans, Monthly, Hourly, and/or Credit-based". This is explicit support for storage as a recurring/monthly billed item, not a session add-on. [The Food Corridor](https://www.thefoodcorridor.com/).
- **Documented — O-Town Kitchen (uses The Food Corridor).** "Storage Options: Dry, refrigerated, and freezer storage available at **monthly rates (priced by shelf, bin, or reach-in space)**." [O-Town Kitchen](https://otownkitchen.com/).
- **Documented — My Commissary Kitchen (concrete per-unit monthly prices).** Dry storage 4 shelves 18″×24″ **$20/month**; walk-in cooler 4 shelves **$25/month**; freezer 1 shelf **$25/month**; lockable dry cage 4 shelves 18″×36″ **$50/month**; lockable cooler cage **$50/month**; plus an annual membership. These are flat monthly prices per physical unit, independent of kitchen hours. [My Commissary Kitchen](https://mycommissarykitchen.com/).
- **Documented — Dephna (London).** "Our cold storage units are available for **£400 per month**, plus VAT and metered utilities." [Dephna](https://www.dephna.com/).
- **Documented — The Kitchen Door (discovery).** The Food Corridor states The Kitchen Door lets entrepreneurs "search… for hourly, daily, and **monthly** kitchen and storage rentals"; the site itself describes shared "cold storage" as a shared resource. [The Kitchen Door](https://www.thekitchendoor.com/); [The Food Corridor](https://www.thefoodcorridor.com/).
- **Documented — Chicago Shared Kitchen.** Offers "800 sq ft walk-in freezer with pallet positions", "Racked dry storage", and "Flexible lease terms (month-to-month OK)" — month-to-month storage tenure is the norm. [Chicago Shared Kitchen](https://chicagosharedkitchen.com/).
- **Inferred:** flat monthly per-unit pricing (dry/fridge/freezer), independent of cooking sessions and held continuously, is the shared-kitchen norm. Local Cooks' current session-shaped storage is therefore the outlier, not the standard.

### 2.2 Daily "holdover" as a separate fee — **owner claim (b): PARTLY CONFIRMED**

- **Documented — the underlying norm.** Self-storage is universally **month-to-month** with renewal on a billing date and a **notice-to-vacate period** (commonly ~10–15 days) before the next period; a tenant who remains past the period is charged for continued occupancy rather than being silently cut off. Examples: month-to-month leases renewing on the 1st with a **15-day notice to vacate** ([StorageMart FAQ](https://www.storage-mart.com/self-storage/faqs/general)); vacate "before your monthly rental due date" ([American Storage](https://www.americanstorageamarillo.com/faq-self.html)); **14 days notice before month end** ([Stor-Age](https://stor-age.co.za/benefits-of-self-storage)).
- **Documented — Local Cooks already implements the daily-overstay version** of this norm: `detectOverstays` charges a **daily** rate × penalty for each day past the end date (`overstay-penalty-service.ts:209-217`).
- **Not verified:** a distinct *self-serve* "buy a day of storage" product is not published by the shared kitchens reviewed (they list monthly only). The honest framing is: **daily charging for overstaying a period is the established norm; a standalone one-day storage SKU is a reasonable, owner-chosen extension, not a copied feature.**
- **Inferred:** model "daily holdover" as a per-day charge applied when goods remain past the period (and, optionally, as a self-serve day-pass), reusing the existing daily-rate plumbing.

### 2.3 Approved members only, storage kept on days without a session — **owner claim (c): CONFIRMED in substance**

- **Documented — onboarding precedes rental.** The Food Corridor sells "Effortless Onboarding and Compliance … built-in document collection … insurance" as the gate before renting ([The Food Corridor](https://www.thefoodcorridor.com/)); O-Town requires an application and onboarding ([O-Town Kitchen](https://otownkitchen.com/)); My Commissary requires a business licence, health permit and insurance before booking ([My Commissary Kitchen](https://mycommissarykitchen.com/)). So members are approved before they rent.
- **Documented — storage is independent of sessions.** Storage appears as its own monthly line item (O-Town, My Commissary) and TFC bills "storage" alongside monthly plans, not only with bookings ([The Food Corridor](https://www.thefoodcorridor.com/)). Holding storage on non-cooking days is implied by a flat monthly unit price.
- **Repository evidence — Local Cooks already gates on approval:** storage creation runs the location eligibility check (`booking.service.ts:107-108`), and access is approved per location (`PHASE0_LOG.md:119`).

### 2.4 Two dashboard modules — **owner claim (d): NOT VERIFIABLE as a literal feature**

- **Not verified:** no reviewed first-party page shows a member dashboard literally split into "Book a kitchen session" and "Manage my storage". The pattern is **Inferred** as a sound information architecture: separate *acquire time* from *manage ongoing custody*. Treat it as a Local Cooks design direction.
- **Repository evidence:** today the member has neither a dedicated booking module nor a storage module — storage is a step inside booking and a table inside the bookings tab (`ChefBookingsView.tsx:2004-2085`). Sam *does* already have a `storage-bookings` nav destination (`app-sidebar.tsx:48`).

### 2.5 Food-safety and custody context

- **Documented — shared-kitchen storage hygiene.** Hong Kong's Centre for Food Safety guidance for shared-use kitchens: keep raw food separate from cooked/ready-to-eat food to prevent cross-contamination; chilled food at 4 °C, frozen at −18 °C; store food away from chemicals; keep records and supervision. [CFS shared-use kitchens](https://www.cfs.gov.hk/english/multimedia/multimedia_pub/multimedia_pub_fsf_225_04.html).
- **Inferred:** a shared storage unit needs labelling (owner, contents, date), separation of allergens/raw, temperature discipline, and a written rule for goods left past a period. This belongs in the listing's house rules and the member-facing contract.

### 2.6 Stripe capability (for §3.2)

- **Documented — three Connect subscription models.** Direct charges (connected account is merchant of record), destination charges (platform charges, funds auto-transfer via `transfer_data[destination]`; platform is merchant of record unless `on_behalf_of` is set; refunds/chargebacks hit the **platform** balance), and separate charges and transfers (create the subscription on the platform with `on_behalf_of`, **no automatic transfer**, create transfers separately). Destination charges are Stripe's recommendation for Express accounts; separate charges and transfers are recommended when the platform is responsible for negative balances. [Stripe — subscriptions with Connect](https://docs.stripe.com/connect/subscriptions).
- **Documented — separate charges and transfers.** The charge is on the platform and decoupled from transfers; the platform can split one charge across multiple connected accounts; the platform balance is debited for Stripe fees, refunds and chargebacks; **refunding a charge does not touch transfers** (the platform must reverse transfers); a transfer fails if it exceeds the platform's available balance and is **not** auto-retried; `source_transaction` ties a transfer to a charge's availability. [Stripe — separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers).
- **Documented — off-session collection.** Invoices can "automatically charge a customer's saved payment method"; a subscription finalizes an invoice immediately when `collection_method` is `charge_automatically`, and `invoice.payment_failed` drives recovery. [Stripe — invoicing overview](https://docs.stripe.com/invoicing/overview); [Stripe — subscription invoices](https://support.stripe.com/questions/when-is-an-invoice-open-for-modification).
- **Documented — manual capture for one-time holds.** Most payments allow one capture and must be captured before the authorization deadline. [Stripe — place a hold](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method).
- **Repository evidence — our live setup:** platform + Express connected account with `transfers` active, `debit_negative_balances` true, daily payouts with a 7-day delay, `losses.payments = application`; separate charges and transfers; kitchen bookings authorize at request and capture on confirmation; payout-after-closeout is planned, not built (`PHASE0_LOG.md:43-47,295`).

---

## 3. Design for Local Cooks

### 3.0 The model in one page

Storage becomes **its own product**: a member rents a specific **unit** (a dry shelf, a fridge shelf, a freezer shelf, or a rack) at a kitchen, on a **flat monthly price**, held continuously (24/7 access subject to the kitchen's access rules), **independent of any cooking session**. Sam approves the first rental (the unit must be physically free and Priya must be an approved member). Priya is billed **monthly in advance** on a saved card; Sam is paid **after each period closes**. Priya gives notice before the next renewal to leave; if her goods remain past the period she is charged a **daily holdover** until she removes them. Move-in and move-out reuse the existing arrival/departure + inspection pattern. A dedicated **"Manage my storage"** surface and a manager **storage occupancy** view replace the storage tables embedded in booking screens. Existing kitchen-linked storage rows keep their current contract unchanged.

### 3.1 Product model and data

Add a **unit/occupancy** concept and a **subscription** concept without deleting the existing tables.

- **Listing = a unit type with a count.** Add `unitCount` (integer, default 1) to `storage_listings`, and keep `storageType` (dry/cold/freezer) plus a friendly `unitLabel` (e.g., "Dry shelf — 18×24"). One listing can now represent many identical units. This closes coupling C8.
- **Storage rental = one occupied unit.** Keep `storage_bookings` as the record of an occupancy, but allow `kitchenBookingId` to be NULL (already permitted, `shared/schema.ts:1419`) and add:
  - `unitIndex` (which physical unit, so two members never share a shelf),
  - `billingModel` (`monthly` | `daily` | `monthly_with_holdover`),
  - `monthlyPriceCents`, `holdoverDailyRateCents`,
  - `currentPeriodStart`, `currentPeriodEnd`, `nextChargeAt`,
  - `noticeGivenAt`, `noticeEffectiveAt`,
  - `stripeSubscriptionId` (or `recurringPaymentIntentId`), reusing the existing `stripeCustomerId`/`stripePaymentMethodId` (`shared/schema.ts:1431-1432`).
- **Accepted terms snapshot.** Reuse the frozen-terms idea (`overstayTerms`, `shared/schema.ts:1418`; `storage_overstay_quotes`, `:1466-1472`) so a monthly contract freezes its price, holdover rate, notice period and rules at the accepted version. This is required because overstay charging currently refuses anything but frozen daily terms (`overstay-penalty-service.ts:206,801`).
- **Pricing vocabulary.** Keep `storagePricingModelEnum` (`shared/schema.ts:46`) for compatibility; introduce `monthly` as the storage default and treat `monthly-flat` as "one calendar month", with real calendar-month multiplication and proration **deferred** (see §3.8).

### 3.2 Billing: which Stripe path fits our setup

Our account is platform + Express connected accounts on **separate charges and transfers**, with manual capture for kitchen bookings and payout-after-closeout planned (`PHASE0_LOG.md:43-47`). Assessed options:

| Option | What it is | Fits our setup? | Verdict |
|---|---|---|---|
| **A. Destination-charge subscription** | Platform-created subscription with `transfer_data[destination]`; funds **auto-transfer** to the Express account; platform is merchant of record unless `on_behalf_of`. [Stripe docs](https://docs.stripe.com/connect/subscriptions) | Express is supported; but auto-transfer **conflicts** with "pay the manager after each period closes", and refunds/chargebacks debit the platform. | Not the target; acceptable only if the owner accepts paying at charge time. |
| **B. Subscription + separate transfers** | Platform-created subscription with `on_behalf_of` = Sam's Express account, **no** auto-transfer; the platform creates a **Transfer after each period closes**. [Stripe docs](https://docs.stripe.com/connect/subscriptions) | Matches our existing model and the requested settlement exactly; requires the platform to hold the month's funds and to have available balance for the transfer. | **Recommended target.** |
| **C. Monthly off-session invoice** | Platform invoice with `collection_method = charge_automatically`, charged to the saved card; then a manual Transfer. [Stripe docs](https://docs.stripe.com/invoicing/overview) | Simplest recurring path without plan objects; still needs a Stripe Customer + saved PM; less dunning tooling than Billing. | **Recommended pilot fallback** if we want the smallest build. |
| **D. Prepaid month blocks** | Member prepays N months; platform transfers as periods elapse. | Simple to charge, but worse refunds/partial use and less "not limiting". | Defer. |

**Recommendation:** first period collected through a **Stripe Checkout session that saves the card** (mirrors today's kitchen Checkout and reuses our existing session/fee code), then a **platform-created monthly subscription with `on_behalf_of` = manager Express account and manual transfers** (Option B). If the owner wants the smallest pilot, ship **Option C** (a monthly off-session invoice on the saved card) and keep Option B as the target. **Do not** use Option A: auto-transfer at charge breaks payout-after-closeout.

Precision on what our setup supports (all **Documented**, above): Express accounts can receive destination charges and can be set as `on_behalf_of` (requires a `card_payments` capability); platform balance must cover transfers and failed transfers are not auto-retried; refunds do not touch transfers and require transfer reversals; `source_transaction` lets a transfer inherit the charge's availability timing. Because our platform is **liable for negative balances** (`losses.payments = application`, `PHASE0_LOG.md:45`), Stripe's own guidance points to separate charges and transfers — which is what we already use.

**First period vs renewals:** the first month may authorize-and-capture at Sam's approval (consistent with kitchen manual capture); renewals are off-session charges. Manual capture must never be used for recurring invoices (single capture only — [Stripe](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)).

**Settlement:** transfer to Sam's Express account after each monthly period closes, from the platform balance, tied to the period's charge via `source_transaction`; keep this as a scoped extension of the planned payout-after-closeout guard, and document the pilot deviation if we ship Option A or transfer at charge time instead.

**Tax:** reuse the kitchen's `taxRatePercent` exactly as the extension path already does (`server/routes/bookings.ts:969`), so storage tax is consistent with the location's setting. Confirm with the accountant before enabling (see §5).

### 3.3 Inventory and capacity

- Enforce **occupancy ≤ unitCount** per listing, atomically (a single transaction that locks the listing, counts active occupancies, and assigns the next free `unitIndex`). This replaces the coarse `awaitingRemoval` hide (`server/routes/storage-listings.ts:245-248`).
- A listing is unavailable only when **all** units are occupied (or the listing is inactive), not when any one prior occupant awaits removal.
- Keep the `storageListingAwaitingRemoval` safeguard for the specific unit still occupied; expose it as "unit N occupied until cleared" rather than hiding the whole listing.
- Show availability as "3 of 5 dry shelves free" to members and Sam.

### 3.4 Approval rules

- **Approved members only.** Reuse the location eligibility check (`booking.service.ts:107-108`); a member who is not approved at the location cannot request storage.
- **Sam approves the first rental** (physical unit assignment), matching today's pending→confirmed (`booking-payment-decision.ts:185-187`) and the "Sam must confirm the unit is free" reality. Sam can decline with a reason; decline releases any hold.
- **Renewals do not need re-approval.** Once a monthly rental is active, periods renew automatically on the saved card until notice is given. This satisfies the owner's "keep storage on days without a session".
- Optional later setting: auto-confirm for already-approved members when capacity exists. Not in the pilot (keeps it simple and avoids double-booking a physical shelf).

### 3.5 Lifecycle: start, end, notice, failed payment, abandonment, move-in/out, refunds, settlement

- **Start.** Request → Sam approves and assigns a unit → first period charged → **move-in inspection** (reuse the arrival pattern: `requestStorageCheckin`, `storage-checkout-service.ts:286-417`, with `photo_before` baseline at `:396-402`) → active.
- **Renewal.** Charge off-session at `nextChargeAt`. On success, advance `currentPeriodStart/End`.
- **Failed payment and grace.** On `invoice.payment_failed`, retry per a bounded schedule, notify Priya, and after a short grace (proposal: 5 days) **suspend new access** (not removal) and begin the daily holdover charge. Never dispose of goods on a timer. This mirrors the no-stuck rule (`PHASE0_LOG.md:79`) and the "never infer a charge from a timer" rule (`design-checkin-checkout.md:9,105`).
- **Notice to vacate.** Priya gives notice before the next renewal (proposal: **15 days**, the self-storage norm in §2.2) or cancels at any time effective **at period end**. No mid-month refund by default; Sam may grant one upward (matching the manager-discretion-upward rule).
- **Daily holdover.** If goods remain past the period, charge the frozen `holdoverDailyRateCents` per day until removal, with a **dispute window** and manager review, reusing the overstay engine but **with the monthly rate now supplying the daily price** (fixes coupling C7).
- **Abandoned goods.** Define a written sequence: overdue → notice → grace → holdover accrues → after a saved maximum, a manager-confirmed removal, with **food-safety-driven disposal** for unsafe/perishable items. Disposal requires a documented notice trail and legal review; never automatic. (Aligns with `local-cooks-booking-policy.md:504-513`.)
- **Move-out.** Priya requests checkout (`requestStorageCheckout`, `storage-checkout-service.ts:136-271`) → Sam inspects and clears or files a claim (`:762-1033`) → the unit is freed and the listing's occupancy drops. Reuses the arrival/departure pattern as required.
- **Cancellation/refund.** Effective at period end; prepaid unused whole months refundable per policy; the current period is not prorated by default.
- **Settlement.** Transfer to Sam after each period closes (§3.2).

### 3.6 Member and manager surfaces

- **Member "Manage my storage" (new first-class surface, separate from booking).** Active subscriptions (unit, listing, kitchen, next renewal date and amount, saved card, notice button), daily holds, move-in/out status, invoices, and any holdover/dispute. This directly implements the owner's two-module dashboard.
- **"Book a kitchen session"** stays the existing flow; its storage step becomes a shortcut that offers available units and links to the storage product, not the only way to rent.
- **Manager storage view.** Units and occupancy per listing ("3 of 5 dry shelves free"), active subscriptions, pending first-rental approvals, move-in/out inspections, failed payments, holdover queue, and per-period settlement. Extend the existing `storage-bookings` destination (`app-sidebar.tsx:48`; `ManagerBookingDashboard.tsx:1317-1334`) rather than inventing a parallel one.
- Keep overstay/checkout screens (`OverstayPenaltyQueue.tsx`, `PendingStorageCheckouts.tsx`) and wire them to the subscription periods.

### 3.7 Migrating existing coupled storage bookings

- **Keep the contract.** Every existing `storage_bookings` row keeps its `kitchenBookingId`, dates, `overstayTerms`, and shared PaymentIntent. Do not rewrite or re-price historical rows (`PHASE0_LOG.md:67`; `local-cooks-booking-policy.md:7`).
- **Dual read.** Member and manager surfaces show both legacy kitchen-linked storage (as today) and new standalone subscriptions, tagged so support can tell them apart.
- **New rows are standalone.** New rentals set `kitchenBookingId = NULL` and carry subscription fields. Update the misleading schema comment (`shared/schema.ts:1392-1393`).
- **Extensions of legacy rows** keep working through the existing extension flow (`server/routes/bookings.ts:876-1073`) until those rows end; do not convert them into subscriptions mid-term.
- **Standalone cancellation** must preserve custody: keep the `cancelledStorageStatus`/`storageListingAwaitingRemoval` invariants (`booking-linked-cancellation.ts:6-19`) so a unit is not freed until Sam confirms removal.

### 3.8 Smallest version that is at par for a pilot

Ship only this, and defer the rest:

1. One new field set: `unitCount` on listings; `unitIndex`, `billingModel: 'monthly'`, `monthlyPriceCents`, `holdoverDailyRateCents`, `currentPeriodStart/End`, `nextChargeAt`, `noticeGivenAt/EffectiveAt`, `stripeSubscriptionId` on bookings.
2. Standalone create + Sam approval + capacity enforcement.
3. Monthly in-advance charge on a saved card (Option C, or B if the closeout transfer is ready).
4. Move-in/move-out reusing the existing check-in/check-out services.
5. Notice to vacate at period end + daily holdover using the frozen daily rate.
6. Member "Manage my storage" and manager occupancy view.
7. Settlement after period close (or at charge, with the deviation documented, if payout-after-closeout is not yet live).

**Defer:** proration, mid-month plan changes, prepaid blocks, volume discounts, multi-unit bundles, automated abandonment disposal, per-cubic-foot pricing, and a general membership engine.

---

## 4. Phased implementation plan (checkpoints, tests, live acceptance, migrations, risks)

Migrations below are **written but NOT applied**; each needs owner approval, consistent with the project's rule (`PHASE0_LOG.md:35,59`). Latest applied migration is `0073_clock_closeout_due_indexes.sql`; propose `0074+`.

### Phase 0 — decision gate (no code)
Owner answers §5. Record the pilot billing option (A/B/C/D) and the notice/grace/holdover numbers. **Checkpoint:** written owner decision in `PHASE0_LOG.md`.

### Phase 1 — data model and capacity (migration `0074_storage_units_and_subscriptions.sql`)
- Add `unit_count` to `storage_listings`; add the booking columns from §3.1; add a unique index on `(storage_listing_id, unit_index)` for active occupancies.
- Keep all existing columns; no destructive change. Update the schema comment.
- **Tests:** capacity counting (0/1/N units), atomic assignment under concurrency, legacy rows unaffected, nullable parent still resolves.
- **Live acceptance (local, synthetic):** create a 2-unit listing; verify the third rental is refused; verify an awaiting-removal occupant blocks only its unit.

### Phase 2 — standalone create + approval
- New endpoint: request a storage rental (approved member only), Sam approve/decline, assign unit.
- **Tests:** eligibility gate, duplicate-unit race, decline releases hold, audit trail.
- **Live acceptance:** Priya requests, Sam approves, row is standalone with `kitchenBookingId = NULL`.

### Phase 3 — recurring billing and settlement
- First period via Checkout (saves card); subscription/off-session renewals; `invoice.payment_failed` handling; transfer after period close.
- **Tests:** off-session success, failed payment → grace → suspension, no double charge with legacy extension, transfer idempotency, refund does not touch transfers (per Stripe docs), failed transfer is not auto-retried.
- **Live acceptance (sandbox):** monthly charge on 4242, one forced failure → grace, transfer lands on the Express account after period close.

### Phase 4 — lifecycle: move-in/out, notice, holdover
- Reuse `requestStorageCheckin`/`requestStorageCheckout`/manager clear-or-claim; add notice-to-vacate and daily holdover with the frozen rate.
- **Tests:** move-in baseline evidence, move-out frees exactly one unit, holdover daily accrual + dispute, notice effective at period end, no disposal on a timer.
- **Live acceptance:** full cycle move-in → renew → notice → holdover day → move-out → unit free.

### Phase 5 — surfaces and migration
- Member "Manage my storage"; manager occupancy/subscriptions view; dual read of legacy + new.
- **Tests:** legacy rows render with parent, standalone rows render without, no regression to kitchen booking flow, i18n EN/FR/UK, mobile width.
- **Live acceptance:** Priya sees both modules; Sam sees occupancy and pending approvals; a legacy kitchen-linked storage booking still shows and extends unchanged.

### Phase 6 — pilot rehearsal
- One end-to-end synthetic run plus a failed-payment and a holdover variant; confirm both participants' views and Local Cooks recovery.

### Risks
- **Holding funds for a month** on the platform balance (Stripe/legal/treasury). Mitigation: Option B with `source_transaction`, or Option A with documented deviation.
- **Capacity races** double-booking a physical shelf. Mitigation: atomic assign + unique index.
- **Abandoned-food handling** is legally sensitive. Mitigation: no automatic disposal; documented notice trail; legal review.
- **Failed payment collection** on a saved card (no card, expired card). Mitigation: grace + suspension + escalation link, reusing the existing penalty escalation pattern (`overstay-penalty-service.ts:843-845`).
- **Double billing** between a subscription renewal and the legacy extension path. Mitigation: block extension for subscription-backed rows.
- **Migration of coupled rows.** Mitigation: dual read, no rewrite, keep PaymentIntent and terms.
- **Tax/registration** for recurring storage. Mitigation: accountant/legal sign-off before enabling.

---

## 5. Owner questions (short)

1. **Billing path:** approve **Option B** (subscription + transfer after each period closes, matches payout-after-closeout) as the target, with **Option C** (monthly off-session invoice) as the smallest pilot — or accept **Option A** (pay at charge) for simplicity?
2. **Pricing unit:** is a flat **monthly price per unit** (dry / fridge / freezer / rack) correct, and do you want a separate **daily holdover rate** per unit (recommended) or the same monthly price ÷ 30?
3. **Approval:** should Sam approve **only the first rental** (renewals automatic), or approve **every period**? (Recommended: first rental only.)
4. **Notice and grace:** approve **15 days' notice to vacate before renewal**, a **5-day payment grace**, and a maximum holdover before the abandoned-goods process begins?
5. **Abandoned goods:** what is the lawful disposal policy for food left past the maximum, and who signs off (counsel/accountant)? Local Cooks should never dispose automatically.
6. **Settlement timing:** confirm the manager is paid **after each period closes** (requires the deferred-settlement guard) or **at charge time** for the pilot.
7. **Legacy rows:** confirm existing kitchen-linked storage keeps its current contract and extension flow until it ends (recommended), rather than being converted to subscriptions mid-term.
