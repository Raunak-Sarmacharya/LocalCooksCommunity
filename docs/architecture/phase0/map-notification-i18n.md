# Notification & lifecycle-notice i18n gap map (Phase 0)

READ-ONLY inventory of every place an **in-app notification row** (`chef_notifications` /
`manager_notifications`) or a **lifecycle notice title/message** is produced as **hard-coded
English** instead of through i18n. Every `file:line` was verified by reading the file (call sites
were confirmed with a repo-wide grep). Where a line is a call site the numbers are grep-derived and
may drift by a line as the tree is edited.

i18n infrastructure today: `shared/i18n/locales/{en-CA,fr-CA,uk}/*.json` (namespaces include
`booking`, `email`, `manager`, `chef`, …), server helpers `tEmail(locale, key, …)` /
`tLocale(locale, key, { ns })` (`server/i18n/outbound.ts`, `server/services/*`).

---

## 0. The notification tables and the single insert path

- **No Drizzle definition exists** for `chef_notifications` or `manager_notifications` in
  `shared/schema.ts` (grep for `chefNotifications`/`managerNotifications` returns nothing). They are
  legacy SQL tables written/read with raw SQL.
  - Only migration touch-points: FK cascade `migrations/0045_user_deletion_cascade.sql:81-82`;
    indexes `migrations/0051_notification_timestamp_indexes.sql:1-5`; deletion
    `migrations/0071_complete_user_deletion.sql`.
  - Columns (inferred from the INSERTs): `manager_notifications` = `id, manager_id, location_id,
    type, priority, title, message, metadata jsonb, action_url, action_label, is_read, read_at,
    is_archived, archived_at, created_at, expires_at`; `chef_notifications` = same minus
    `location_id`, keyed by `chef_id`. **Neither table has an i18n key column** — `title`/`message`
    are stored as final rendered strings.
- **Single generic writer:** `server/services/notification.service.ts`
  - `createNotification` → raw INSERT into `manager_notifications` `:179-195`, `chef_notifications`
    `:199-214`. No locale parameter.
  - `createManagerNotification` `:228-242`; `createChefNotification` `:247-260`.
  - Exported as `create` / `createForManager` / `createForChef` `:1403-1405`.
- **Lifecycle outbox:** `booking_lifecycle_events` (`shared/schema.ts:1476-1491`) stores the literal
  `title`/`message` (no key column). The in-app row is created inside
  `queueBookingLifecycleEvent` at `server/services/booking-lifecycle-delivery.ts:278-280`; the
  outbox row at `:312`.
- The delivery layer **does** have each recipient's locale (`users.preferredLocale`, selected at
  `booking-lifecycle-delivery.ts:152`) and already renders per-locale copy for a handful of kinds
  (payout, feedback, manager visit, running-late, cancellation, arrival). Everything else falls back
  to the caller's English `title`/`message`.

---

## 1. `server/services/notification.service.ts` — hard-coded English `notify*` helpers

All of these take **no locale** and never join `users.preferredLocale`, so the recipient's locale is
**not available** at the point of creation. `title` is at the line shown; `message` is the next line.

### Manager recipients
| Lines | Function | Current English (title / message gist) | Locale? | Suggested key |
|---|---|---|---|---|
| 285-286 | `notifyNewBooking` | `New Booking Request` / `{chef} requested to book {kitchen} on {date} from {start} to {end}. Awaiting your approval.` | No | `notify.manager.newBooking` |
| 306-307 | `notifyBookingConfirmed` | `Booking Confirmed` / `You confirmed {chef}'s booking at {kitchen} on {date}.` | No | `notify.manager.bookingConfirmed` |
| 325-328 | `notifyBookingCancelled` | `Booking Cancelled by Chef` / `Booking Cancelled` + body | No | `notify.manager.bookingCancelled.byChef` / `.byManager` |
| 362-363 | `notifyPaymentReceived` | `Payment confirmed` / `{chef}’s payment of ${amt} went through. …` | No | `notify.manager.paymentReceived` |
| 382-383 | `notifyPaymentFailed` | `Payment Failed` / `Payment of ${amt} from {chef} failed. Reason: …` | No | `notify.manager.paymentFailed` |
| 415-416 | `notifyNewApplication` | `New Access Request` / `{chef} ({email}) requested kitchen access. …` | No | `notify.manager.newApplication` |
| 433-434 | `notifyStep2ApplicationSubmitted` | `Kitchen Access Documents Submitted` / … | No | `notify.manager.step2Submitted` |
| 453-454 | `notifyApplicationApproved` | `Kitchen Access Approved` / … | No | `notify.manager.applicationApproved` |
| 484-485 | `notifyStorageExpiring` | `Storage Booking Expiring` / … | No | `notify.manager.storageExpiring` |
| 512-513 | `notifyLicenseApproved` | `Kitchen License Approved` / … | No | `notify.manager.licenseApproved` |
| 529-530 | `notifyLicenseRejected` | `Kitchen License Rejected` / … | No | `notify.manager.licenseRejected` |
| 546-547 | `notifyLicenseExpiring` | `Kitchen License Expiring Soon` / … | No | `notify.manager.licenseExpiring` |
| 576-579 | `notifyNewMessage` | `Message from {sender}` / preview | No | `notify.manager.newMessage` |
| 602-603 | `notifySystemAnnouncement` | passthrough of caller-supplied English | No | (caller-owned) |
| 937-938 | `notifyManagerStorageCheckoutRequested` | `Storage Checkout Requested` / `{chef} has requested checkout for storage "{name}". Please review.` | No | `notify.manager.storageCheckoutRequested` |
| 995-996 | `notifyManagerStorageExtensionPending` | `Storage Extension Request` / `{chef} has requested a {n}-day extension for "{name}". Payment received - awaiting your approval.` | No | `notify.manager.storageExtensionPending` |
| 1088-1089 | `notifyManagerOverstayPendingReview` | `Overstay Requires Review` / … | No | `notify.manager.overstayPendingReview` |
| 1168-1169 | `notifyManagerPenaltyReceived` | `Overstay Penalty Collected` / … | No | `notify.manager.penaltyCollected` |
| 1263-1266 | `notifyManagerClaimResponseReceived` | `Damage Claim Accepted` / `Damage Claim Disputed` / … | No | `notify.manager.claimResponse.*` |
| 1318-1323 | `notifyManagerClaimDecision` | `Damage Claim …Approved` / `Damage Claim Rejected` / … | No | `notify.manager.claimDecision.*` |
| 1364-1365 | `notifyManagerDamageClaimReceived` | `Damage Claim Payment Received` / … | No | `notify.manager.damageClaimReceived` |

### Chef recipients
| Lines | Function | Current English (title / message gist) | Locale? | Suggested key |
|---|---|---|---|---|
| 652-653 | `notifyChefBookingConfirmed` | `Booking Confirmed!` / … | No | `notify.chef.bookingConfirmed` |
| 671-674 | `notifyChefBookingCancelled` | `Booking Cancelled by Manager` / `Booking Cancelled` / … | No | `notify.chef.bookingCancelled.*` |
| 691-692 | `notifyChefKitchenCheckinReminder` | `Time to Check In!` / … | No | `notify.chef.checkinReminder` |
| 712-713 | `notifyChefStorageCheckinReminder` | `Move-In Inspection Due` / … | No | `notify.chef.storageCheckinReminder` |
| 741-746 | `notifyChefApplicationApproved` | `Application Approved!` / `Chat with your kitchen manager is ready` / `Request to apply approved!` / … | No | `notify.chef.applicationApproved.*` |
| 771-772 | `notifyChefApplicationRejected` | `Application Update` / … | No | `notify.chef.applicationRejected` |
| 788-789 | `notifyChefWelcome` | `Welcome to LocalCooks, {name}!` / … | No | `notify.chef.welcome` |
| 802-803 | `notifyChefPaymentReceived` | `Payment Confirmed` / … | No | `notify.chef.paymentReceived` |
| 821-822 | `notifyChefPaymentRefunded` | `Refund Processed` / … | No | `notify.chef.paymentRefunded` |
| 840-843 | `notifyChefMessage` | `Message from {sender}` / preview | No | `notify.chef.newMessage` |
| 858-861 | `notifySellerApplicationSubmitted` | `Seller application received` / … | No | `notify.chef.sellerApplicationSubmitted` |
| 873-876 | `notifySellerApplicationDecision` | `Seller application approved` / `Seller application not approved` / … | No | `notify.chef.sellerApplicationDecision.*` |
| 888-889 | `notifySellerDocumentRejected` | `Seller document needs replacement` / … | No | `notify.chef.sellerDocumentRejected` |
| 952-953 | `notifyChefStorageCheckoutCleared` | `Storage Checkout Complete` / `Your storage checkout for "{name}" has been cleared {clearedBy}. Thank you!` | No | `notify.chef.storageCheckoutCleared` |
| 966-967 | `notifyChefStorageCheckoutClaimFiled` | `Storage Claim Filed` / `A claim "{title}" has been filed for your storage checkout at "{name}". …` | No | `notify.chef.storageClaimFiled` |
| 1015-1016 | `notifyChefStorageExtensionApproved` | `Storage Extension Approved!` / `Your {n}-day extension for "{name}" has been approved. New end date: {date}.` | No | `notify.chef.storageExtensionApproved` |
| 1034-1035 | `notifyChefStorageExtensionRejected` | `Storage Extension Declined` / `Your extension request for "{name}" was declined.{ Reason: …} A refund will be processed.` | No | `notify.chef.storageExtensionDeclined` |
| 1067-1068 | `notifyChefOverstayDetected` | `⚠️ Storage Overstay Detected` / … | No | `notify.chef.overstayDetected` |
| 1109-1110 | `notifyChefPenaltyApproved` | `Overstay Penalty Approved` / … | No | `notify.chef.penaltyApproved` |
| 1128-1129 | `notifyChefPenaltyWaived` | `Overstay Penalty Waived` / … | No | `notify.chef.penaltyWaived` |
| 1147-1148 | `notifyChefPenaltyCharged` | `Overstay Penalty Charged` / … | No | `notify.chef.penaltyCharged` |
| 1188-1189 | `notifyChefPaymentRequired` | `⚠️ Payment Action Required` / … | No | `notify.chef.paymentRequired` |
| 1208-1209 | `notifyChefOverstayRefunded` | `Overstay Penalty Refunded` / … | No | `notify.chef.overstayRefunded` |
| 1240-1241 | `notifyChefDamageClaimFiled` | `⚠️ Damage Claim Filed` / … | No | `notify.chef.damageClaimFiled` |
| 1289-1294 | `notifyChefClaimDecision` | `Damage Claim …Approved` / `Damage Claim Rejected` / … | No | `notify.chef.claimDecision.*` |
| 1343-1344 | `notifyChefDamageClaimCharged` | `Damage Claim Charged` / … | No | `notify.chef.damageClaimCharged` |
| 1384-1385 | `notifyChefDamageClaimRefunded` | `Damage Claim Refunded` / … | No | `notify.chef.damageClaimRefunded` |

**Callers** (they pass only IDs/strings, so no locale flows in): `server/routes/webhooks.ts:1738,
3012, 3047, 3291, 3326`; `server/routes/manager.ts:6977, 7285`;
`server/routes/firebase/kitchen-applications.ts:1396, 1527, 2033, 2073`;
`server/firebase-user-sync.ts:146`; `server/services/storage-checkout-service.ts:642, 710`;
`server/services/overstay-penalty-service.ts:408, 421`.

---

## 2. `queueBookingLifecycleEvent` call sites — literal English `title`/`message`

Function defined `server/services/booking-lifecycle-delivery.ts:131-337`. The `title`/`message`
args are the fallback for both the in-app row (`:280`) and the outbox row (`:312`). **Locale is
available in the delivery layer** (`person.locale`, `:152/254/274`) but the fallback args are
English; the per-role override (`roleText`) is also English for most producers.

Hard-coded English inside the delivery layer itself:
- `:280` `actionLabel` default `'View booking'`; `'Find another time'` (`:280`, `:295`).
- `:280` `roleText?.title ?? title` / `roleText?.message ?? message` fallback path.
- `:293-295` `requestExpired` email subject/heading `roleText?.title ?? title` (English).
- `:299` actionLabel `'Update payout details'`.
- `:414` arrival in-app row `actionLabel: 'Open your visit'`.
- `:489, :493, :498-500` historical/change notes `Recorded notice: …`, `Current change state: …`.
- `:534-536` **admin** recovery row: `'Booking notice needs delivery recovery'` + body + `'Review delivery'` (admin recipient, no locale).
- `:43-46` `refreshLegacyChefConfirmation` literals: `'Your kitchen booking is confirmed'`, `'there'`, `'Total paid'`, `'Open booking'`, `'Download PDF receipt'`.

### Call sites (file:line — role — current English title)
| file:line | Kind | Role(s) | Current English title / message gist | Locale at producer? |
|---|---|---|---|---|
| `booking-cancellation-refund.ts:97-99` | cancelled (kitchen-caused) | chef (+`roleText.manager`) | `The kitchen cancelled your booking` / full-refund body; `roleText.manager` = `You cancelled as the kitchen` | No (delivery supplies locale) |
| `booking-cancellation-refund.ts:312-313` | cancelled | chef/manager | `Booking cancelled` / processing-fee body | No |
| `booking-cancellation-refund.ts:330-332` | cancelled (chef-caused) | chef (+`roleText.manager`) | `Booking cancelled` / refund-or-no-refund body | No |
| `booking-cancellation-refund.ts:464-465` | cancellation_reviewed | chef/manager | `Selected add-on cancellation accepted` / `Kitchen cancellation accepted` | No |
| `booking-cancellation-refund.ts:526-527` | refund_issued | chef | `Refund sent` / `A refund of {amt} has been sent. …` | No |
| `booking-cancellation-refund.ts:537-538` | payment_recovery_needed | chef | `Local Cooks is checking your refund` / … | No |
| `booking-payment-decision.ts:144-146` | payment_recovery_needed | chef/manager | `Local Cooks is checking your payment` / … | No |
| `booking-payment-decision.ts:189-191` | payment_recovery_needed | chef/manager | `Local Cooks is checking your payment` / race body | No |
| `booking-payment-decision.ts:232-237` | confirmed/cancelled | chef (+`roleText.manager`) | `Kitchen booking confirmed` / `Kitchen booking cancelled`; manager `Booking confirmed` | No |
| `booking-checkout-fulfillment.ts:104-107` | requested | chef/manager (+`roleText.chef`) | `New kitchen booking request`; chef `Request sent to {kitchen}` (`:25-26`) | No |
| `booking-item-cancellation.ts:42-46` | item_withdrawn / item_cancellation_requested | chef | `Storage add-on cancelled` / `Equipment add-on cancelled` (+`…cancellation requested`) | No |
| `booking-support.ts:418-419` | support_updated | participants | `Local Cooks support updated your booking` (message caller-supplied) | No |
| `booking-support-flags.ts:33-35` | support_flag_changed | manager/admin | `Booking payment flag resolved` / `Booking payment needs review` | No |
| `booking-support-flags.ts:36-38` | support_payout_failed | manager | `We couldn’t send your payout for {ref}` | No |
| `kitchen-checkout-service.ts:426-428` | checkin_recorded | chef/manager | `Arrival confirmed` | No |
| `kitchen-checkout-service.ts:561-563` | checkout_requested | chef/manager | `Ready for kitchen inspection` | No |
| `kitchen-checkout-service.ts:708-710` | checkout_claim_filed | chef/manager | `Visit concern sent for review` | No |
| `kitchen-visit-lifecycle.ts:73-75` | checkin_recorded | chef/manager | `Arrival confirmed` | No |
| `kitchen-visit-lifecycle.ts:76-78` | checkout_requested | chef/manager | `Ready for kitchen inspection` | No |
| `kitchen-visit-lifecycle.ts:81` | checkout_cleared | chef | `Kitchen inspection complete` | No |
| `kitchen-visit-lifecycle.ts:229-231` | checkout_claim_filed | chef/manager | `Visit concern sent for review` | No |
| `clock-closeout.ts:99-101` | checkout_cleared | chef/manager | `Kitchen inspection complete` | No |
| `clock-closeout.ts:148-152` | service_ended | chef (+`roleText.chef`) | `Visit finished`; chef `Your booked time has ended` | No |
| `clock-closeout.ts:158-160` | inspection_auto_closed | manager | `Inspection window closed` | No |
| `visit-assistance.ts:81-83` | visit_assisted | chef/manager | `Visit {action} time added` | No |
| `visit-code-challenge.ts:417-419` | arrival_code_reissued | chef | `Arrival details updated` (in-app row overridden by i18n arrival notice `:413-415`) | No |
| `visit-code-challenge.ts:449-451` | arrival_mode_changed | chef | `Arrival method updated` | No |
| `kitchen-instructions-updated.ts:87-88` | instructions_updated | chef | `Booking instructions updated` | No |
| `kitchen-booking-changes.ts:183-205` | kitchen_change_* | chef/manager | English `labels` map (`Waiting for the kitchen’s reply`, `Extra payment needed`, `Change confirmed`, `Change declined`, …) + `quoteMessage` `Open the booking to review …` | No |
| `storage-checkout-service.ts:847` | storage_removed | chef | `Storage removal confirmed` / `The kitchen manager confirmed that storage has been cleared.` | No |
| `scheduled-cancellations.ts:59-60` | cancellation_reviewed | chef/manager | `Kitchen cancellation accepted` | No |
| `scheduled-cancellations.ts:108-110` | storage_cancellation_reviewed | chef/manager | `Storage cancellation accepted` | No |
| `payment-refund-reconciliation.ts:65-67` | refund_issued | chef | `Refund sent` | No |
| `captured-booking-reconciliation.ts:66-68` | payment_recovery_needed | chef/manager | `Local Cooks is checking your payment` | No |
| `kitchen-payout-service.ts:70-73` | payout_on_hold | manager | `Your payout is on hold` / … | No (i18n override in delivery) |
| `kitchen-payout-service.ts:162-165` | payout_released | manager | `You’ve been paid` / `You’ve been paid ${amt} …` | No (i18n override in delivery) |
| `auth-expiry-service.ts:419-423` | cancelled (request expired) | chef (+`roleText.chef/manager`) | `Booking request expired` | No (only booking/kitchen/location fetched) |
| `routes/bookings.ts:2283-2284` | cancelled | chef/manager | `Kitchen booking request cancelled` | No |
| `routes/manager.ts:1066-1068` | cancellation_reviewed | chef/manager | `Kitchen cancellation accepted` / `Kitchen cancellation declined` | No |
| `routes/manager.ts:1221-1224` | storage_cancellation_reviewed | chef/manager | `Storage cancellation accepted` / `Storage cancellation declined` | No |
| `routes/manager.ts:4907-4909` | items_changed / status | chef/manager | `Booking items updated` / `Kitchen booking confirmed` / `Kitchen booking cancelled` | No |
| `running-late.ts:67-69` | running_late | manager | `{chef} is running late` / `{chef} is running about {duration} late. …` | No (i18n override in delivery) |
| `booking-feedback-service.ts:74-76, 100-101` | feedback_flagged / feedback_requested | chef/manager | uses `tEmail('en-CA', …)` (forced English) | Forced en-CA (delivery overrides per-locale) |
| `session-extension-notice.ts:90` | session_extension_* | chef/manager | `copy.title`/`copy.message` — **already i18n** | Yes |

---

## 3. Reminder producers (`advance-reminders.ts`, `deadline-reminders.ts`)

Both build English titles/messages that become in-app rows via
`advance-reminders.ts:576-578`.

### `server/services/advance-reminders.ts`
- In-app insert `:576-578`: `title: r.kind === 'manager_decision' ? r.title : intent.subject`,
  `message: r.message`, `actionLabel: … 'Review request' / tEmail(...) / 'View current reservation'`.
  **Locale is available** (`r.locale`) but the title/message are English.
- `intent.subject` built `:386` from English reminder titles.
- English reminder copy:
  - `:165-166` `Check-in is now available for this visit.` / `Your booked time is ending soon. …`
  - `:189` storage arrival `Your storage at {name} starts today at {location}. …`; `:193` title `Storage booking #{id}`
  - `:229` `Address: …` / `See booking details`; `:233` `… (required photo)`
  - `:236`, `:271` title `{kitchen} · {reference}`
  - `:250-254` `Arrival instructions: … Departure instructions: … Required tasks/photos: … Contact: …` / `None requested` / `Support`
  - `:314-315,319,328` tour copy `…is visiting for a confirmed kitchen tour. …` / `See tour details` / `Kitchen tour at {…}`
  - `:408-409` `titles` map: `Prepare for your kitchen visit`, `Your kitchen visit is coming up`, `Check-in is available`, `Your booked time ends soon`, `Before you leave the kitchen`, `Kitchen visit reminder`, `Review request`, `Chef has not checked in`
  - `:440-462` email bodies/headings/facts: `Before you leave`, `Ready to check in`, `Prepare for your kitchen visit`, `Your visit`, `Kitchen`, `Location`, `Starts`, `Ends`, `Reference`, `Arrival and departure instructions`, `Kitchen contact`, `Address`, `Arrival instructions`, `Departure instructions`, `Required tasks and photos`, `None requested`, `Prepare for arrival`
  - `:467-488` `renderTourReminder` headings/subjects/facts/actions: `The kitchen tour is ending soon`, `Upcoming chef visit`, `Your visiting chef is due soon`, `Before you leave`, `Prepare for your visit`, `Your kitchen tour is coming up`, `Kitchen`, `Location`, `Date`, `Time`, `Visiting chef`, `Kitchen manager`, `Reference`, `Coordinate the visit`, `Arrival and departure`, `Chef contact`, `Arrival contact`, `Manager notes`, `Arrival instructions`, `Departure instructions`, `View tour`, `Message chef`, `Message manager`
  - `:580` facts `Respond by`; actionLabel `Review request`
- Admin recovery rows `:527` (`Tour reminder needs recovery`) and `:587` (`Reservation reminder needs recovery`) — admin, no locale.

### `server/services/deadline-reminders.ts`
- `:44` `Damage claim #{id}: response due` (chef)
- `:53` `Storage penalty #{id}: dispute window` (chef)
- `:69` `Storage #{id}: {cancellation decision|inspection response} due` (manager)
- `:82` `Booking #{id}: cancellation decision due` (manager)
- `:91` `Booking #{id}: inspection response due` (manager)
- `:114` message `{title}. Please respond by {friendlyDeadline}. Open the task to respond.`
- `:13-18` `friendlyDeadline` hard-codes `'en-CA'` formatting.
- **Locale is available**: the recipient `users` row is fetched at `:101` (`person`), but
  `person.preferredLocale` is **not** attached to the `Reminder` (the `Reminder` type
  `advance-reminders.ts:28-53` has an optional `locale`, set only by booking/tour reminders).

---

## 4. Direct `notificationService.create*` sites in routes & other services

| file:line | Role | Current English (title gist) | Locale? |
|---|---|---|---|
| `routes/bookings.ts:559` | manager | `Storage Cancellation Request` / `{chef} has requested to cancel their storage booking for {name}.` | No (chef fetched `:546`, manager not) |
| `routes/bookings.ts:576` | chef | `Cancellation Request Submitted` / `Storage Booking Cancelled` | No |
| `routes/bookings.ts:2704` | manager | `Cancellation Request` / `{chef} has requested to cancel their booking at {kitchen}.` | No |
| `routes/manager.ts:1258` | chef | `Storage Cancellation Accepted` / `Your storage cancellation request has been accepted…` | No |
| `routes/manager.ts:1348` | chef | `Storage Cancellation Declined` / `…declined by the kitchen manager…` | No |
| `services/scheduled-cancellations.ts:112` | chef | `Storage Cancellation Auto-Accepted` / `Your storage cancellation request was automatically accepted…` | No |
| `services/auth-expiry-service.ts:331` | chef | `Storage extension authorization expired` / `The storage extension payment hold was released…` | No (only `email` selected) |
| `services/auth-expiry-service.ts:441` | chef | `Booking Authorization Expired` / `Your storage extension request #{id} wasn't answered in time…` | No (only `username` selected) |
| `services/outcome-delivery.ts:26-40` | chef/manager | `Damage claim #{id}: {status}` + `View current claim` | Yes (full users rows `:24`) |
| `services/outcome-delivery.ts:154-157` | admin | `Outcome notice needs delivery recovery` + `Review delivery` | No |
| `services/outcome-delivery.ts:177-182` | chef | `Storage #{id}: checkout review cleared` + `View current storage booking` | Yes (`:110`) |
| `services/outcome-delivery.ts:196-202` | chef/manager | `Storage #{id}: … recorded` + `View storage action` | Yes |
| `services/outcome-delivery.ts:225-231` | chef/manager | `Payment #{id}: {outcome}` + `View financial records` | Yes |
| `services/outcome-delivery.ts:271-283` | chef/manager | `Storage penalty #{id}: {status}` + `View current storage issue` | Yes (`:269`) |
| `services/commitment-problems.ts:66-80` | chef/manager/admin | `Safety issue reported — urgent · Booking #{id}`, `{category} problem reported · …`, `Claim or review problem` / `View problem` | Yes (full users rows `:63`) |
| `services/location-access-notices.ts:38-62` | chef | `Your access to {location} has ended` + body (caller-supplied) | No |
| `services/document-renewals.ts:84-85` | chef | `Your renewed {label} was approved` / `… was not accepted` | No |
| `services/chef-document-expiry.ts:36-37` | chef | `{doc} {stage} at {location}` | No |
| `services/tour-delivery-service.ts:154-159, 234, 357, 372, 426, 442, 675, 868, 901-902` | chef/manager/admin | many English strings incl. `Recorded tour update`, `Tour notice needs delivery recovery` (some use `tEmail(person.locale,…)` `:173-174`) | Mixed |
| `routes/notifications.ts:82-97` | manager | second, older raw INSERT into `manager_notifications` (English caller-supplied) | No |
| `routes/applications.ts:254, 500, 551, 557, 681` | manager | `Seller application awaiting review`, `Seller application under review`, `Seller application cancelled`, `{documentName} approved`, … | No |
| `routes/firebase/applications.ts:49-50, 224, 356, 406, 412` | manager | `Seller documents ready for review`, `Seller application awaiting review`, `Seller documents received`, `Seller application cancelled`, … | No |
| `routes/firebase/kitchen-applications.ts:711-712, 752-753, 913-914, 991-992` | manager/chef | `Kitchen application awaiting review`, `Kitchen documents ready for review`, `Chat with your kitchen manager is ready`, … | No |
| `functions/src/chat-notice.ts:136, 144-148` | chef/manager | `New message from {sender}` + raw INSERT into `manager_notifications`/`chef_notifications` | No |

Storage-specific ones to prioritise for the redesign:
`notifyManagerStorageCheckoutRequested` (`notification.service.ts:937-938`),
`notifyChefStorageCheckoutCleared` (`:952-953`), `notifyChefStorageCheckoutClaimFiled`
(`:966-967`), `notifyManagerStorageExtensionPending` (`:995-996`),
`notifyChefStorageExtensionApproved` (`:1015-1016`), `notifyChefStorageExtensionRejected`
(`:1034-1035`), `notifyManagerOverstayPendingReview` (`:1088-1089`),
`notifyChefOverstayDetected` (`:1067-1068`), the overstay manager/chef rows in
`overstay-penalty-service.ts:283-286` and `:1442-1445`, and the storage rows in
`outcome-delivery.ts:177-182, 196-202, 271-283`.

---

## 5. Producers that are ALREADY i18n (no action needed)

Confirmed to use `tEmail`/`tLocale` with a recipient locale:
- `server/services/cancellation-notice.ts` (3 i18n calls)
- `server/services/kitchen-payout-notice.ts` (33)
- `server/services/session-extension-notice.ts` (8)
- `server/services/damage-claim-notices.ts` (3)
- `booking-lifecycle-delivery.ts:413-415` arrival in-app row (via `currentArrivalNotice`, `tEmail`)
- `advance-reminders.ts:244-260` — chef/manager `sessionEnding`/manager-arrival prose is partly i18n, though surrounding facts are English.

---

## 6. Counts

- **`notification.service.ts` `notify*` helpers with hard-coded English:** ~48 (22 manager, 26 chef), all with **no locale in scope**.
- **`queueBookingLifecycleEvent` call sites with literal English title/message:** ~40 across 20 files (plus the delivery-layer fallbacks at `booking-lifecycle-delivery.ts:280, 293-295, 299, 414, 489-500, 534-536`).
- **Reminder copy:** `advance-reminders.ts` ~70 English strings; `deadline-reminders.ts` 6 titles + 1 message.
- **Direct `notificationService.create*` sites outside the helper set:** ~25 across routes and services (`outcome-delivery`, `commitment-problems`, `scheduled-cancellations`, `auth-expiry-service`, `routes/{manager,bookings,applications,notifications}`, `firebase/*`, `functions/src/chat-notice.ts`).
- **Total distinct hard-coded English notification/lifecycle strings:** roughly **150–180**.

---

## 7. Implementation approach

Two viable strategies; they are complementary.

### Option A — translate at creation using the recipient's saved locale (lower risk, smaller change)
- Extend the core writers to accept a locale and resolve it from `users.preferredLocale`:
  - `notification.service.ts createNotification` `:150` — add an optional `locale`/`recipientId` and
    either join `users.preferredLocale` inside the writer or require callers to pass it. Because the
    `notify*` helpers already know the recipient id (`managerId`/`chefId`), the writer can look up the
    locale in one extra query, or the helpers can be wrapped.
  - The delivery layer already has `person.locale` (`booking-lifecycle-delivery.ts:152`) — replace the
    English fallback `title`/`message` with `tEmail(person.locale, kindKey, params)` when a key is
    registered, keeping the current literal as the last-resort fallback.
- **Pros:** no schema change, no client change, smallest blast radius, works for email too.
- **Cons:** the row is frozen in the recipient's locale at creation — if they change language later,
  old notifications stay in the old language. Also, a notification shown to *both* chef and manager
  needs two rows (it already does — one per recipient), so per-role locale is fine.

### Option B — store key + params on the row, render per viewer locale (more correct, larger change)
- Add nullable `i18n_key` (text) + `i18n_params` (jsonb) columns to `chef_notifications` and
  `manager_notifications`, and `i18n_key`/`i18n_params` to `booking_lifecycle_events`
  (`shared/schema.ts:1476-1491`). Populate them alongside the existing `title`/`message`.
- Render in the API/UI: the notification read routes (`server/routes/chef-notifications.ts`,
  `server/routes/notifications.ts`) resolve the viewer's current locale and call
  `tLocale(locale, key, params)`; fall back to the stored `title`/`message` when no key is present.
- **Pros:** correct per-viewer language, supports a future language switch, keeps history readable.
- **Cons:** schema migration + API/UI render changes + backfill; both tables are legacy raw-SQL (no
  Drizzle model), so the migration must be hand-written, and every existing read path must be taught
  to prefer the key.

### Recommended sequence
1. **Quick win (Option A):** wire locale into `notification.service.ts` `createNotification` and into
   the `booking-lifecycle-delivery.ts:280` fallback, register keys for the **storage** notifications
   first (they are the redesign's focus), and add `fr-CA`/`uk` strings.
2. **Structural fix (Option B):** add `i18n_key`/`i18n_params` columns + render-at-read for the two
   notification tables and the outbox, then backfill. This is the durable answer for
   "render per viewer locale".
3. **Shared key registry:** define a single `notify.*` / `booking.notice.*` key namespace mirroring
   the `sx*`/`dcV2*` patterns already used, so producers pass `(key, params)` rather than prose.
4. **Locale availability gap:** for the ~15 producers that only select IDs (overstay-penalty-service,
   running-late, auth-expiry, manager/bookings routes), either add `users.preferredLocale` to the
   select or let the delivery/creation layer resolve it centrally — do **not** add a locale param to
   every call site by hand.
5. **Admin rows** (`booking-lifecycle-delivery.ts:534-536`, `advance-reminders.ts:527/587`,
   `outcome-delivery.ts:154`, `commitment-problems.ts`) can stay English (Local Cooks staff) but
   should be flagged explicitly so they are not mistaken for missed work.
