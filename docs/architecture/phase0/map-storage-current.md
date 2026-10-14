# Storage — current-state map (Phase 0)

READ-ONLY research map of how storage works **today**. Every `file:line` below was verified by
reading the file at the time of writing; where a line is a *call site* (e.g. a client render), the
line numbers come from a repo-wide grep and may drift by a line or two as the tree is edited.

Scope covered: storage listings & pricing models, storage booking creation (add-on vs standalone),
checkout/fulfillment & captured component allocations, extensions (request/approve/capture),
overstay records & penalties, checkout/removal confirmation, inventory/availability enforcement,
cancellation interplay, payout timing, and all client surfaces. Ends with pain points and the
questions the owner must answer before a redesign (monthly per-unit subscriptions, daily holdover,
"Manage my storage").

> Historical/design context lives in `docs/architecture/phase0/design-storage-decoupling.md` and
> `build-session-extensions.md`. This file documents only what the code does now.

---

## 1. Schema

### 1.1 `storage_listings` — `shared/schema.ts:1260-1321`
| Concept | Line | Notes |
|---|---|---|
| `kitchenId` FK (listing belongs to a kitchen) | `shared/schema.ts:1262` | Storage is always owned by a kitchen, never a standalone location. |
| `storageType` (`dry` \| `cold` \| `freezer`) | `shared/schema.ts:1263`, enum at `:30` | |
| `pricingModel` | `shared/schema.ts:1285`, enum at `:47` | `['monthly-flat','per-cubic-foot','hourly','daily']` |
| `basePrice` (cents) | `shared/schema.ts:1286` | Interpretation depends on `pricingModel`. |
| `pricePerCubicFoot` (cents) | `shared/schema.ts:1287` | Declared but **never read anywhere** (see §8). |
| `minimumBookingDuration` | `shared/schema.ts:1289` | Min number of `bookingDurationUnit`. |
| `bookingDurationUnit` | `shared/schema.ts:1290` | `hourly` \| `daily` \| `monthly` (enum `bookingDurationUnitEnum`). |
| `currency` | `shared/schema.ts:1291` | Locked to CAD. |
| `status` / `isActive` | `shared/schema.ts:1294`, `:1300` | Manager-created listings are written `status:'active'` directly (see §2). |
| `availabilityCalendar` (jsonb) | `shared/schema.ts:1301` | **Declared but unused in code** (see §8). |
| Overstay config: `overstayGracePeriodDays`, `overstayPenaltyRate`, `overstayMaxPenaltyDays`, `overstayPolicyText` | `shared/schema.ts:1314-1317` | Per-listing; null inherits location/platform defaults. |
| Insert/update Zod schemas | `shared/schema.ts:1324-1395` | `insertStorageListingSchema` requires `name` ≥ 3, positive `basePrice`. |

### 1.2 `storage_bookings` — `shared/schema.ts:1493-1545`
| Concept | Line | Notes |
|---|---|---|
| Header contract comment | `shared/schema.ts:1472-1474` | "CRITICAL: Storage can ONLY be booked as part of a kitchen booking" — stale vs the code below. |
| `visitDuties` (jsonb) | `shared/schema.ts:1494` | Per-storage arrival/departure duties; also "standalone legacy". |
| `kitchenBookingId` FK **nullable** | `shared/schema.ts:1500` | Comment: "NULLABLE - storage can be booked independently". |
| `chefId`, `startDate`, `endDate`, `status` | `shared/schema.ts:1501-1504` | `bookingStatusEnum`. |
| `totalPrice` (cents) | `shared/schema.ts:1505` | "daily_rate × number_of_days". |
| `pricingModel` | `shared/schema.ts:1506` | Comment: "Always 'daily' now". |
| `paymentStatus`, `paymentIntentId` | `shared/schema.ts:1507-1508` | `paymentIntentId` "shared across bundled items in same kitchen booking". |
| `overstayTerms` (jsonb, frozen) | `shared/schema.ts:1499` | Frozen at booking time (`StorageOverstayTerms`, `shared/storage-overstay-terms.ts:1-12`). Null legacy rows require review. |
| Stripe off-session fields | `shared/schema.ts:1512-1513` | `stripePaymentMethodId`, `stripeCustomerId` for penalty charging. |
| Checkout workflow | `shared/schema.ts:1517-1527` | `checkoutStatus` (enum `:33`), `checkoutRequestedAt/ApprovedAt/ApprovedBy/Notes/PhotoUrls`, denial fields, `checkoutChecklistItems`. |
| Check-in workflow | `shared/schema.ts:1530-1535` | `checkinStatus` (enum `:36`), requested/completed, notes, photos, checklist. |
| Cancellation-request tracking | `shared/schema.ts:1538-1541` | Mirrors `kitchen_bookings`. |
| Zod schemas | `shared/schema.ts:1556-1626` | |

### 1.3 `pending_storage_extensions` — `shared/schema.ts:2015-2036`
| Concept | Line | Notes |
|---|---|---|
| `storageBookingId` FK | `shared/schema.ts:2018` | |
| `newEndDate`, `extensionDays` | `shared/schema.ts:2019-2020` | |
| `extensionBasePriceCents`, `extensionServiceFeeCents`, `extensionTotalPriceCents` | `shared/schema.ts:2021-2023` | |
| `stripeSessionId`, `stripePaymentIntentId` | `shared/schema.ts:2024-2025` | |
| `status` | `shared/schema.ts:2027` | Flow: `pending → paid → approved/rejected → completed/refunded` (comment `:2026`). |
| Manager approval fields | `shared/schema.ts:2029-2032` | `managerId`, `approvedAt`, `rejectedAt`, `rejectionReason`. |

### 1.4 `storage_overstay_records` / `storage_overstay_history` / `storage_overstay_quotes`
| Concept | Line | Notes |
|---|---|---|
| `overstayStatusEnum` | `shared/schema.ts:2043-2054` | `detected → grace_period → pending_review → penalty_approved/penalty_waived → charge_* → resolved/escalated`. |
| `storageOverstayRecords` | `shared/schema.ts:2059-2120` | Comment `:2058`: "Penalties are NEVER auto-charged - manager must approve". |
| `itemsRemovedAt` | `shared/schema.ts:2066` | Manager-confirmed physical removal; required before collection. |
| `chefDisputeDeadline`, dispute fields | `shared/schema.ts:2068-2073` | |
| `daysOverdue`, `gracePeriodEndsAt` | `shared/schema.ts:2075-2076` | |
| `calculatedPenaltyCents`, `dailyRateCents`, `penaltyRate` | `shared/schema.ts:2082-2084` | System suggestion. |
| `finalPenaltyCents`, `penaltyApprovedBy/At`, `penaltyWaived`, `waiveReason` | `shared/schema.ts:2087-2091` | Manager decision. |
| Stripe charge tracking | `shared/schema.ts:2095-2103` | Off-session charge fields. |
| Resolution + notification tracking | `shared/schema.ts:2106-2113` | `resolutionType` ∈ `extended/removed/paid/waived/escalated`. |
| `idempotencyKey` unique | `shared/schema.ts:2116` | |
| `storageOverstayHistory` | `shared/schema.ts:2124-2135` | Audit trail. |
| `storageOverstayQuotes` | `shared/schema.ts:1547-1553` | Terms quoted to the chef at checkout and re-verified at fulfillment. |

---

## 2. Storage listings: creation & pricing models

- **Listing CRUD (manager):** `server/routes/storage-listings.ts`
  - `GET /manager/kitchens/:kitchenId/storage-listings` `:27`; `GET /manager/storage-listings/:listingId` `:55`.
  - `POST /manager/storage-listings` `:87` — validates name/type/pricingModel/basePrice `:109`, null overstay overrides inherit defaults `:113-129`, and **auto-activates**: `status:'active', isActive:true` `:133-138` (comment `:131-132`: manager listings bypass admin approval).
  - `PUT /manager/storage-listings/:listingId` `:149`; `DELETE` `:189`.
  - Chef/public reads: `GET /chef/kitchens/:kitchenId/storage-listings` `:228`; `GET /public/kitchens/:kitchenId/storage-listings` `:263`.

- **Pricing models (client calculation):** `client/src/hooks/use-storage-pricing.ts:49-126`
  - `monthly-flat` — flat `basePrice`, no duration multiplier `:75-80`.
  - `hourly` — `basePrice × max(hours, minimumBookingDuration)` `:81-89`.
  - **everything else (incl. `daily` and `per-cubic-foot`)** — `basePrice × max(days, minDays)` `:90-98`.
  - `serviceFee` forced to `0` (`:100`, `:122`) because platform fee is taken via Stripe Connect.
  - **`per-cubic-foot` is not implemented** — it silently falls into the daily branch. `pricePerCubicFoot` (`schema.ts:1287`) is never read.

- **Pricing is duplicated (not shared) across three server copies:**
  - `server/domains/bookings/booking.service.ts:159-168` (+ fallback `:203-222`, comment `:220` "Flat rate (daily/monthly/per-use) - simplified for MVP").
  - `server/routes/webhooks.ts:783-792`.
  - The live fulfillment path **does not recompute**; it trusts the metadata price snapshot (`booking-checkout-fulfillment.ts:75`).
  - `server/services/pricing-service.ts` is kitchen-only (`calculateKitchenBookingPrice`); it has no storage function.

- **Storage extension pricing (separate code path):** `server/routes/bookings.ts:848-879` — `extensionDays = ceil((newEnd − currentEnd)/day)` `:849`, min-days guard `:850-856`, `basePricePerDayCents × extensionDays` `:862-863`, kitchen tax rate applied `:865-877`.

---

## 3. Storage booking creation — add-on only in practice

**There is no standalone storage booking endpoint.** `server/routes/storage-listings.ts` only manages
listings, not bookings. Every current insert sets `kitchenBookingId`; the nullable FK
(`schema.ts:1500`) and `insertStorageBookingSchema` comment "Optional - for standalone storage
bookings" (`schema.ts:1558`) are aspirational.

Three insert sites:

1. **Live / current path (webhook-driven, atomic):** `server/services/booking-checkout-fulfillment.ts`
   - `fulfillQuotedKitchenBooking` `:30`; parent kitchen booking inserted `:53-62`; storage loop `:64-80`.
   - Insert `:73-77`: `kitchenBookingId: parent.id`, `status:'pending'`, `paymentStatus`, `paymentIntentId: intent.id`, `totalPrice: String(price)`, `pricingModel: listing.pricingModel`, `overstayTerms` from the accepted quote `:70-72,76`.
   - Storage row blocked if the listing is `awaitingRemoval` `:65-67`.
2. **Legacy webhook path:** `server/routes/webhooks.ts:803-824` (direct `db.insert(storageBookings)`, sets `status:'pending'`, `paymentStatus`, `paymentIntentId` `:817-818`).
3. **Legacy service path:** `server/domains/bookings/booking.service.ts:172` and `:226` → `server/domains/bookings/booking.repository.ts:465-470` (quotes overstay terms inline). Reached from `server/routes/bookings.ts:3546` → `createKitchenBooking`; storage IDs extracted `bookings.ts:3536-3540`.

Client entry points that add storage to a kitchen booking:
- `client/src/components/booking/BookingStorageSelector.tsx` — chef multi-step picker (stages `select → date-mode → dates`, type at `:46`), rendered inside the booking flow at `client/src/components/booking/KitchenBookingFlow.tsx:2617` (dialog content `:2605-2631`).
- `client/src/components/booking/StorageSelection.tsx` — alternate inline picker, rendered only by `client/src/pages/KitchenBookingCalendar.tsx:1300`; **`KitchenBookingCalendar.tsx` is orphaned** (not imported/routed anywhere) — two parallel pickers exist.
- Kitchen-side storage data fetch: `KitchenBookingFlow.tsx:813` (`GET /api/chef/kitchens/:id/storage-listings`); `BookingConfirmationPage.tsx:163`.

---

## 4. Kitchen checkout / fulfillment & captured component allocations

- **Session creation:** `server/services/stripe-checkout-service.ts`
  - `createPendingCheckoutSession` `:118`; per-item storage line items `:187-201`; `addon_prices` snapshot `{s:[[listingId,price]],e:[...]}` `:311-321` (validation `:320` "Selected storage pricing is incomplete"); `selected_storage` + overstay quotes `:332-342`; **manual capture** (`capture_method:'manual'`, auth-then-capture) `:364`.
- **Fulfillment:** `server/services/booking-checkout-fulfillment.ts:30`
  - Terms verified via `bookingCaptureTerms(metadata, intent.amount)` `:33` (`shared/booking-capture-terms.ts:14-25`).
  - `paymentStatus` = `authorized` (hold) or `paid` `:42-43`.
  - Storage `paymentStatus`/`paymentIntentId` set at insert `:75`.
  - `paymentTransactions` ledger row `:90-98` with `metadata.storage_items` / `metadata.equipment_items`.
  - **Captured component allocations** `:99-103`:
    ```
    componentAllocationVersion: 'original-tax-largest-remainder-v1',
    capturedComponentAllocations: capturedComponentAllocations([
      { kind:'kitchen',   bookingId: parent.id, subtotalCents: terms.subtotal − Σ(storage+equipment) },
      ...storageItems.map(→ { kind:'storage',   bookingId, subtotalCents: Number(item.totalPrice) }),
      ...equipmentItems.map(→ { kind:'equipment', bookingId, subtotalCents }),
    ], terms.tax)
    ```
  - Helper: `shared/captured-component-allocations.ts:2-15` — largest-remainder integer tax split, returns `managerGrossCents`.
- **Capture-time re-allocation (manager confirms booking):** `server/services/booking-payment-decision.ts:116-129` rebuilds `components` from the confirmed storage/equipment rows (`:117-119`), re-runs `capturedComponentAllocations` (`:120-122`) and rewrites `metadata.capturedComponentAllocations` + `componentComponentVersion` (`:129`).
- **`paymentStatus`/`paymentIntentId` mutation points on `storage_bookings`:**
  - Set at creation: `booking-checkout-fulfillment.ts:75`; `webhooks.ts:817-818`.
  - Capture webhook → `paid`: `webhooks.ts:2040-2051`.
  - Failure webhook → `failed`: `webhooks.ts:2395-2413`.
  - Extension auth cancel: `webhooks.ts:2415-2428`.
- Note: `server/services/booking-checkout-guards.ts` **does not exist** (only its `.test.ts`); money guards live in `booking-money-guard.ts` (`assertBookingMoneyWritable`) and `booking-support-flags.ts` (`lockBookingMoneySources`).

---

## 5. Storage extensions (request / approve / capture)

Two distinct "extensions" exist — do not conflate them:

### 5.1 Storage *date* extensions — `pending_storage_extensions`
- **Preview:** `POST /chef/storage-bookings/:id/extension-preview` `server/routes/bookings.ts:781`; pricing `:848-879`; blocks extensions on `pending` `:803`, `cancelled` `:807`, `completed` `:812`, and on any **active overstay penalty** (`pending_review/penalty_approved/charge_pending/charge_failed/escalated`) `:818-836`.
- **Checkout:** `POST /chef/storage-bookings/:id/extension-checkout` `bookings.ts:900` → Stripe session with `metadata.type='storage_extension'` `:1049-1066`. Comment `:1032-1034`: **no `pending_storage_extensions`/`payment_transactions` rows are created here** — they are created in the webhook after payment.
- **Row creation (webhook):** `server/routes/webhooks.ts:1525` via `bookingService.createPendingStorageExtension`; status `authorized` (manual capture) or `paid` `:1524`; repo insert `server/domains/bookings/booking.repository.ts:647-675` (reference code `EXT-…` `:658`).
- **Chef list / sync:** `bookings.ts:1100` (`GET /chef/storage-extensions/pending`), `bookings.ts:1162` (`POST /storage-extensions/:id/sync`), legacy `bookings.ts:1269`.
- **Approve (manager):** `server/routes/manager.ts:6774` — captures the PI if `authorized` `:6839-6855`, sets `approved` `:6883-6891`, calls `bookingService.extendStorageBooking` `:6894` (impl `booking.service.ts:717`), sets `completed` `:6900-6907`, then auto-resolves related overstays `:6918-6952`.
- **Reject (manager):** `manager.ts:7016` — sets `rejected` `:7085-7094`, then cancel-auth `:7109-7130` or refund `:7131-7220`.
- **Webhook transitions:** `authorized→paid` `webhooks.ts:2067-2079`; `authorized→rejected` `webhooks.ts:2415-2428`.
- **Auth expiry:** `server/services/auth-expiry-service.ts:137` (updates extension), `:276-319` (expiry flow), chef notice `:331-332`.

### 5.2 Kitchen *session* extensions (extra time) — a different feature
- `server/routes/session-extensions.ts:53-65`; service `server/services/session-extensions.ts` (create `:244-317`, decision `:349-420`, capture `reconcileSessionExtension` `:529-620`). These charges are what "follow the parent booking payout" (see §10).

---

## 6. Overstay records & penalties (holdover)

Service: `server/services/overstay-penalty-service.ts` (header principles `:8-13`).

- **Detection:** `detectOverstays()` `:120-160`
  - Scans storage bookings with `endDate < now` and `status ∈ {confirmed, completed}` `:154-159`.
  - **Skips checkout-in-progress** rows `:168-177`: a `completed` booking with no manager-confirmed removal (`itemsRemovedAt`) is skipped — review expiry alone is not an overstay.
  - `itemsRemovedAt` is derived from `checkoutApprovedBy && checkoutApprovedAt && checkoutStatus ∈ {completed, checkout_claim_filed}` `:171-173`.
  - Grace period: `gracePeriodEndsAt = endDate + gracePeriodDays` `:200-201`; `isInGracePeriod` `:203`.
  - **Penalty formula** `:209-217`: `dailyPenaltyChargeCents = round(dailyRateCents × (1 + penaltyRate))`; `calculatedPenaltyCents = dailyPenaltyChargeCents × penaltyDays`, where `penaltyDays = min(daysOverdue − gracePeriodDays, maxPenaltyDays)` `:214`.
  - `dailyRateCents` only counts when the frozen terms are `daily` **and** accepted `:206-207`; otherwise `status='escalated'` `:226`.
  - Idempotency key `booking_<id>_overstay_<endDate>` `:229`; existing record update `:244-289` (status transitions only out of `detected/grace_period` `:255`).
  - Manager notification on transition `:283-286` (hard-coded English, see notification report).
- **Recurring worker:** `server/services/recurring-worker.ts:123` and `:134` call detection.
- **Grace→review notification:** `:283-286`; **chef warning/penalty emails:** `sendOverstayNotificationEmails` called `:278`.
- **Dispute review notice:** `:1442-1445` (chef, hard-coded English).
- **Overstay terms freeze:** `server/services/storage-overstay-terms-service.ts` (`quoteStorageOverstayTerms`), shape in `shared/storage-overstay-terms.ts:1-12`; frozen into `storage_bookings.overstayTerms` at booking (`booking-checkout-fulfillment.ts:76`) and used in detection `:179,192,206`.
- **Location-level defaults:** `shared/schema.ts:394-398` (`overstayGracePeriodDays`, `overstayPenaltyRate`, `overstayMaxPenaltyDays`, `overstayPolicyText`); resolution in `server/services/overstay-defaults-service.ts`.

---

## 7. Storage checkout / removal confirmation

Service: `server/services/storage-checkout-service.ts` (header contract `:4-17`: clear-or-claim, **no deny/reclean**).

- **Chef requests checkout:** `requestStorageCheckout` `:137-272`
  - Ownership `:173`; rejects `cancelled`/`completed`/`pending` `:178-186`; requires start date passed `:189-193`; rejects already-requested/approved/completed `:196-205`.
  - **Requires check-in first** `:207-213` (unless `cancellationAcceptedAt`).
  - Photo/checklist validation against manager-configured duties `:216-226`; update to `checkoutStatus:'checkout_requested'` `:235-249`.
- **Chef check-in (move-in inspection, auto-approved):** `requestStorageCheckin` `:287-418`.
- **Manager review dispatch:** `processCheckoutApproval` `:746-789` (`'approve'` → clear `:768`; legacy `'deny'` → clear `:770-774`).
- **Clear (complete):** `processCheckoutClear` `:794-864` — sets `checkoutStatus:'completed'`, `checkoutApprovedAt/By`, appends assistance history, `status:'completed'` `:833-845`; queues `storage_removed` lifecycle event `:847`; then **freezes accrued overstay time** by calling `detectOverstays()` `:852-854`.
- **Start claim:** `processCheckoutStartClaim` `:871-1017` → `createDamageClaim` `:927-937`; sets `checkout_claim_filed` `:998-1001`.
- **Auto-clear on window expiry:** `autoCleanExpiredCheckout` `:1038-1082`; cron sweep `processExpiredCheckoutReviews` `:1089-1166`; `getPendingCheckoutReviews` `:1175-1288`; `getCheckoutStatus` `:1471-1564`.
- **Overstay interaction guard:** `isCheckoutInProgress` `:1648-1666` returns true for `checkout_requested|checkout_approved|completed|checkout_claim_filed`.
- **Notifications:** manager "checkout requested" in-app `:642`; chef "claim filed" in-app `:710`; emails via `generateStorageCheckoutEmail` `:631,:701`.
- **Routes:**
  - Chef: request-checkout `bookings.ts:1335`; checkin `:1377`; checkin-photos `:1415`; checkout-photos `:1451`; duties `:1485`; checkout-status `:1546`.
  - Manager: pending `manager.ts:7715`; history `:7769`; approve-checkout (alias→clear) `:7808`; clear-checkout `:7855`; start-claim `:7946`; deny-checkout (deprecated→clear) `:8011`.
- **`kitchen-checkout-service.ts` storage paths:** only shared checklist/photo validators — `type` union includes `'storage_checkout'|'storage_checkin'` `:135`, `:208`; section config `:162-167`, `:235-240`. Imported by the storage service at `storage-checkout-service.ts:216-220` and `:354-360`. All storage review logic lives in `storage-checkout-service.ts`, **not** `kitchen-checkout-service.ts`.

---

## 8. Inventory / availability enforcement — absent

- `storage_listings.availabilityCalendar` (`schema.ts:1301`) and `pricePerCubicFoot` (`:1287`) are **declared but never referenced** outside `schema.ts` (grep confirms only schema hits).
- There is **no capacity model**: a listing has no "units"/"spaces" count. Two chefs can reserve the same listing for overlapping dates.
- The only concurrency protection is `storageListingAwaitingRemoval` (`server/services/booking-linked-cancellation.ts:13-20`), used at fulfillment to reject a listing whose prior occupant has not been cleared (`booking-checkout-fulfillment.ts:65-67`) — a *blocking* rule, not a capacity/availability rule.
- `KitchenSlotUnavailableError` / `KitchenHoldMissingError` (`kitchen-checkout-holds.ts`) cover the kitchen hold, not storage inventory.
- Net: storage is effectively **unlimited-capacity, first-come** with no date-overlap or unit-count enforcement.

---

## 9. Cancellation interplay

- **`cancelLinkedBookingDates`** — `server/services/booking-linked-cancellation.ts:22-39`
  - Revokes arrival codes `:24`; cancels linked storage using the `cancelledStorageStatus` SQL expression `:7-11` (keeps `cancellation_requested` + removal task if the occupant has checked in / started; otherwise `cancelled`) `:25-26`; cancels equipment `:27-28`; updates parent `storageItems`/`equipmentItems` snapshot to `rejected` `:30-38`.
- **New cancellation engine** — `shared/cancellation-policy.ts`
  - `CancellationComponent.kind` includes `'storage'` `:47`.
  - **"Started storage" exclusion:** in `quoteCancellation`, a component that has *started* (or is listed in `startedComponents`) gets `refundPercent = 0` unless it is a kitchen-remedy, and its `reasonCode` becomes **`used_storage`** for storage vs `session_started` for kitchen `:74-79`. i.e. storage time already consumed is non-refundable.
  - Storage kitchen/platform shares and "used storage" amounts feed the extra-refund math via `usedStorageKitchenCents` / `usedStoragePlatformCents` `:37,39-40`.
- **Item-level cancellation:** `server/services/booking-item-cancellation.ts:42-46` (title "Storage add-on cancelled"/"…requested").
- **Scheduled auto-accept:** `server/services/scheduled-cancellations.ts:108-117` ("Storage cancellation accepted", chef "Storage Cancellation Auto-Accepted").
- **Chef/manager storage-cancel routes:** `server/routes/bookings.ts:554-583`; `server/routes/manager.ts:1220-1266, 1348-1356`.
- **Storage-cancel review reminder:** `server/services/deadline-reminders.ts:54-69` (`storage_cancellation_review`).
- **Removal task retention:** `cancelledStorageStatus` and `storageListingAwaitingRemoval` (`booking-linked-cancellation.ts:7-20`) keep the unit blocked until the manager confirms removal.

---

## 10. Payout timing for storage charges

There are **two different storage-related money flows**, and they behave differently:

1. **Storage base charge (add-on) — follows the parent kitchen booking.**
   - The storage row shares the parent's `paymentIntentId` (`booking-checkout-fulfillment.ts:75`) and is a component of the parent's `paymentTransactions` row (`:99-103`).
   - Payout timing is snapshotted from `KITCHEN_PAYOUT_TIMING` at capture (`booking-checkout-fulfillment.ts:94`) or at manager confirmation for a card hold (`booking-payment-decision.ts`). The parent release engine is `server/services/kitchen-payout-service.ts` (`after_closeout` gating `:79-80`, release `:89-144`, sweep `:256-283`). **There is no storage-specific payout path** — storage base money is paid out as part of the kitchen booking's manager revenue.

2. **Storage date-extension charge — a separate charge, transferred immediately (at capture).**
   - The webhook records a standalone `paymentTransactions` row: `bookingType:'storage'`, `bookingId = storageBookingId`, its own `paymentIntentId`/`chargeId` (`webhooks.ts:1552-1578`).
   - **No `payoutTiming` is set** on this row → it is treated as legacy `at_capture` and is transferred by `transferToManagerForBooking` immediately (`webhooks.ts:1614-1642`). For manual capture, the transfer happens in the capture path (`payment_intent.succeeded`), not deferred to closeout (comment `:1581-1582`).
   - It therefore does **not** follow the parent booking's `after_closeout` schedule.

- **Kitchen session-extension charges (extra time)** *do* follow the parent — but that is a different feature:
  - `server/services/session-extension-payout.ts` — `extensionPayoutDecision` `:32-39`, `releaseSessionExtensionPayoutForSource` `:41-81`, `releaseSessionExtensionPayoutsForBooking` `:91-100`.
  - Triggered from `kitchen-payout-service.ts:140-142` after the parent transfer.
- **Manager-facing payout projection:** `readKitchenPayout` `kitchen-payout-service.ts:175-185`; `upcomingKitchenPayouts` `:231-250`.
- **Notices:** `payout_on_hold` `kitchen-payout-service.ts:70-73`; `payout_released` `:162-165` (both hard-coded English; i18n overrides applied per-locale in the delivery layer, see notification report).

---

## 11. Client surfaces (chef / manager / admin)

### Chef
| Surface | File | Key endpoints / role |
|---|---|---|
| Storage picker in booking flow | `client/src/components/booking/BookingStorageSelector.tsx` | presentational; rendered `KitchenBookingFlow.tsx:2617` |
| Alt picker (orphaned) | `client/src/components/booking/StorageSelection.tsx` | rendered only by orphaned `KitchenBookingCalendar.tsx:1300` |
| Extend storage dialog | `client/src/components/booking/StorageExtensionDialog.tsx` | `POST .../extension-preview` `:78`; `POST .../extension-checkout` `:131`; rendered `ChefBookingsView.tsx:2059`, `ExpiringStorageNotification.tsx:161`, `BookingControlPanel.tsx:1157` |
| Pending extensions card | `client/src/components/booking/PendingStorageExtensions.tsx` | `GET /api/chef/storage-extensions/pending` `:221`; `POST /api/storage-extensions/:id/sync` `:234`; rendered `ApplicantDashboard.tsx:763` |
| Expiring/expired banner | `client/src/components/booking/ExpiringStorageNotification.tsx` | `GET /api/chef/storage-bookings/expiring?days=3` `:41`; rendered `ChefBookingsView.tsx:1630`, `BookingControlPanel.tsx:556` |
| Checkout (move-out) dialog | `client/src/components/booking/StorageCheckoutDialog.tsx` | `POST .../request-checkout` `:107`; `GET .../duties` via `useStorageDuties` `:64`; rendered `ChefBookingsView.tsx:2069` |
| Check-in (move-in) dialog | `client/src/components/booking/StorageCheckinDialog.tsx` | `POST .../checkin` `:127`; rendered `ChefBookingsView.tsx:2084` |
| Status trackers | `CheckoutStatusTracker.tsx` (`.../checkout-status` `:141`), `CheckinStatusTracker.tsx` (`.../checkin-status` `:137`) | rendered `ChefBookingsView.tsx:2099/2110` |
| Chef bookings list / cancel / invoice | `client/src/components/booking/ChefBookingsView.tsx` | `GET /api/chef/storage-bookings` `:1178`; `POST /api/chef/invoices/storage/:id` `:1357`; `POST /api/chef/storage-bookings/:id/cancel` `:1401` |
| Storage booking panel | `client/src/components/booking/BookingControlPanel.tsx` | `GET /api/chef/storage-bookings` `:131` |
| Overstay penalties | `client/src/components/chef/PendingOverstayPenalties.tsx` (`GET /api/chef/overstay-penalties` `:76`, pay `:90`, dispute `:116`), `OverstayPenaltiesTable.tsx` (`GET` `:284`, pay `:298`) | rendered `ChefBookingsView.tsx:1627`, `IssuesAndRefunds.tsx:92-93` |
| Duties hook | `client/src/hooks/use-storage-duties.ts:6` | `GET /chef/storage-bookings/:id/duties` |

### Manager
| Surface | File | Key endpoints |
|---|---|---|
| Storage bookings page | `client/src/pages/ManagerStorageBookingsPage.tsx` | `GET /api/manager/storage-bookings` `:45`; availability aggregate `:54-73`; rendered `ManagerBookingDashboard.tsx:1331` (view `storage-bookings`) |
| Extension approvals | `client/src/components/manager/StorageExtensionApprovals.tsx` | `GET /api/manager/storage-extensions/pending` `:49`; approve `:62`; reject `:90`; rendered `ManagerStorageBookingsPage.tsx:228`, `ManagerBookingsPanel.tsx:721` |
| Checkout review queue | `client/src/components/manager/PendingStorageCheckouts.tsx` | `GET .../storage-checkouts/pending` `:472`; history `:488`; `POST .../clear-checkout` `:504`; `POST .../start-claim` `:549`; rendered `ManagerBookingDashboard.tsx:1416` |
| Check-in history | `client/src/components/manager/PendingStorageCheckins.tsx` | `GET .../storage-checkins/history?limit=20` `:392`; rendered `ManagerBookingDashboard.tsx:1415` |
| Overstay queue | `client/src/components/manager/overstays/OverstayPenaltyQueue.tsx` | `GET /api/manager/overstays?includeAll=true` `:568`; approve `:581`; waive `:606`; charge `:624`; resolve `:639`; rendered `ManagerOverstaysPage.tsx:23`, `ManagerBookingDashboard.tsx:1400` |
| Overstays page | `client/src/pages/ManagerOverstaysPage.tsx:16` | route `/manager/overstays` — `App.tsx:404-407` |
| Listing management | `client/src/pages/StorageListingManagement.tsx` | `POST/PUT/DELETE /manager/storage-listings` `:834/:905/:956`; named export `StorageListingContent` embedded at `KitchensManagement.tsx:742`, `CreateKitchenStep.tsx:952`; **default export is dead** |
| Visit assistance | `client/src/components/booking/VisitAssistancePanel.tsx:44` | `POST /api/manager/storage-bookings/:id/assist-visit` |
| Storage helpers | `client/src/lib/manager-storage-bookings.ts:1-49` (`inheritStorageChef` `:21-30`); templates `client/src/lib/storage-templates.ts` | |
| Settings | `components/manager/settings/StorageCheckinCheckoutSettings.tsx`, `StorageTrackingSetup.tsx` | `GET/PUT /manager/locations/:id/checkin-checkout-settings` |
| Overview aggregation | `client/src/hooks/use-manager-overview-activity.ts:46-50` | aggregates the four manager storage endpoints |

### Admin
- `client/src/components/admin/sections/AdminOverstayPenalties.tsx` (`GET /api/admin/overstay-penalties?limit=500` `:327`; history `:337`) — rendered `Admin.tsx:1201`.
- `client/src/components/admin/EscalatedPenalties.tsx` (`POST /api/admin/overstay-penalties/:id/review-dispute` `:107`) — rendered `Admin.tsx:1156`.
- `client/src/components/admin/OverstayPenaltySettings.tsx` (`GET/POST /api/admin/overstay-settings`, `/api/admin/storage-checkout-settings`).

### Notable gaps in the client surface
- **No "Manage my storage" surface exists** — the string appears only in `docs/architecture/phase0/*`. There is no first-class chef page to view all storage, change dates, or remove items other than the per-booking dialogs above.
- Two parallel storage pickers (`BookingStorageSelector` used; `StorageSelection` orphaned via `KitchenBookingCalendar.tsx`).
- `StorageListingManagement.tsx` default export is not routed.

---

## 12. Pain points / risks

1. **Pricing logic is triplicated and divergent.** Client (`use-storage-pricing.ts`), `booking.service.ts`, and `webhooks.ts` each compute price; the live path trusts a metadata snapshot. `per-cubic-foot` is advertised in the enum but priced as daily. Any new model (e.g. monthly per-unit subscription) must be implemented in ≥3 places or centralised.
2. **No inventory/capacity model.** No units count, no date-overlap check; `availabilityCalendar` and `pricePerCubicFoot` are dead columns. Overbooking the same unit is possible. The only guard is `storageListingAwaitingRemoval`.
3. **Standalone storage is half-built.** FK is nullable and Zod says "optional", but no route creates a standalone booking; the schema comment at `schema.ts:1472-1474` contradicts the live behaviour.
4. **Storage extension payout timing diverges from the parent.** Base storage follows the kitchen payout (`after_closeout`); the date-extension charge is a separate at-capture transfer. This split is easy to break and hard to reason about.
5. **Overstay vs checkout race.** Detection deliberately skips in-progress checkouts, and `processCheckoutClear` re-runs detection to "freeze" time — but `autoCleanExpiredCheckout` (window expiry) clears without manager confirmation, so a chef can avoid an overstay by letting the review window expire.
6. **`overstayTerms` legacy rows.** Null terms (`schema.ts:1499`) fall back to live listing/location config, so the penalty the chef saw may differ from what is charged for old rows; `supported` requires `daily`+`accepted` (`overstay-penalty-service.ts:206`), else the record is `escalated`.
7. **Overstay blocks extension only via a route guard** (`bookings.ts:818-836`), not a DB constraint; other paths could extend.
8. **Notification copy for every storage lifecycle event is hard-coded English** (see `map-notification-i18n.md`) — a French/Ukrainian chef sees English for storage checkout, extension, and overstay notices.
9. **No "Manage my storage".** Chefs can only act from within a booking's dialogs; there is no consolidated storage view, self-serve date change, or removal request entry point.
10. **Orphaned/duplicated UI** (`StorageSelection` via orphaned `KitchenBookingCalendar`; dead default export of `StorageListingManagement`) invites confusion and dead code.

---

## 13. Questions the owner must answer for a redesign

**Monthly per-unit subscriptions**
- Should a storage listing have a **unit count** (N spaces) with per-unit monthly pricing, or stay "one listing = one space"? Today there is no capacity field at all.
- Is `monthly-flat` meant to become a **recurring subscription** (auto-renew, monthly invoices) or remain a one-off prepaid period? The schema has no subscription/billing-cycle fields.
- How do renewals/auto-charge interact with the current `pending_storage_extensions` approval flow and with off-session penalty charging (`stripePaymentMethodId`)?
- Does a monthly subscription still require the "must be booked with a kitchen booking" rule, or is this the trigger to make storage standalone?

**Daily holdover**
- When a monthly/period booking lapses, is holdover billed **daily** (current overstay formula) or converted to a daily subscription? Today holdover = `dailyRate × (1 + penaltyRate)` after a grace period, capped at `maxPenaltyDays`, manager-approved.
- Should holdover auto-charge (the schema says penalties are **never** auto-charged — confirm that stays true for subscriptions), or continue the manual approve/waive flow?
- What is the intended behaviour when the occupant never removes items (the `itemsRemovedAt` gate) — escalation/collections?
- Should holdover block the next tenant automatically (today only `storageListingAwaitingRemoval` does, and only for the same listing)?

**"Manage my storage"**
- What is the single chef-facing surface: one storage dashboard listing all units, dates, invoices, extensions, and removal actions? Confirm it replaces the per-booking dialogs.
- Should chefs be able to change dates, add/remove units, and request removal without going through the parent kitchen booking?
- Where do i18n, per-unit pricing previews, and the extension/overstay/penalty actions live in that surface?
- Does "Manage my storage" need a manager counterpart (per-unit roster, occupancy, auto-renewing tenants), and does it need a new storage availability/inventory model to be meaningful?
