# Map — Kitchen-booking emails (template inventory)

Read-only mapping of **every email the platform sends for kitchen bookings** (and linked
storage/equipment, document renewals, kitchen access, check-in/check-out, closeout,
reminders, problem reports, and chat-message notices for bookings), with the HTML template
family each one uses.

Scope note: tour emails are included only as the reference implementation of the "notice"
layout (they are the family exemplar the task names). Kitchen-application emails are
notice-layout but are chef-onboarding, not bookings, so they are listed once, briefly.

## 1. Template families

| Family | Builder | Where | Notes |
|---|---|---|---|
| **notice** | `renderTransactionalEmail(data)` | `server/email.ts:7168` | Logo, `<h1>` heading, greeting, message, **one primary red CTA** (`.cta-button`, `#e11d48`), "Details" facts list(s), footer `Need a hand? Contact Local Cooks`. Wraps output in `prepareEmailHtml()` (`server/email-theme.ts:49`). |
| **uniform / legacy** | `getUniformEmailStyles()` (`server/email.ts:907`) + hand-written `.email-container/.header/.content/.greeting/.message/.cta-button/.footer` markup | `server/email.ts:907-1058` | `@import` Google "Lobster" font; gradient CTA `hsl(347,91%,51%)`; status badges; hard-coded `support@localcooks.ca` in most bodies. Also wrapped in `prepareEmailHtml()`. |
| **bare** | ad-hoc inline HTML built at the call site, e.g. `<h2>..</h2><p>..</p><p><a>View booking</a></p>` | see table | No shared shell. Some are plain-text-only (no `html:` field). |
| **plain-text-only** | `sendEmail({ to, subject, text })` with **no `html`** | `outcome-delivery.ts:134`, `advance-reminders.ts:516` | Recipients get a text-only email. |

`prepareEmailHtml` injects a shared light/dark theme stylesheet and rewrites the logo URL
(`server/email-theme.ts:22-80`). Both notice and uniform shells pass through it.

## 2. (a) Notice-layout builder — exact signature and options

`server/email.ts:7168`

```ts
export function renderTransactionalEmail(data: {
  to: string; subject: string; recipientName: string; message: string;
  tour?: { tourId: number; tourDate: string | Date; durationMinutes: number };
  facts: { label: string; value: string; url?: string }[];
  actionLabel: string; actionUrl: string; note?: string;
  secondaryLink?: { label: string; url: string };
  secondaryButton?: { label: string; url: string }; heading?: string;
  actions?: { label: string; url: string }[];
  sections?: { title: string; facts: { label: string; value: string; url?: string }[];
               links?: { label: string; url: string }[] }[];
}): EmailContent
```

Fields accepted and behaviour:

- `to`, `subject`, `recipientName`, `message` — required. `message` is **HTML-escaped and
  rendered with `white-space:pre-line`** (`:7208`) — i.e. literal text, newlines preserved,
  **not** trusted HTML.
- `heading?` — `<h1>`; defaults to the subject (tour suffix stripped). `:7179,7206`.
- `facts[]` — if no `sections` is given, becomes the single section titled `Details`. Facts
  support an optional `url` (rendered as an underlined link). `:7185,7214`.
- `sections[]` — array of `{ title, facts[], links? }`; empty-fact sections are dropped;
  each section renders a bordered `<h2>` + fact table + optional link list. `:7185,7212-7215`.
- `actionLabel` + `actionUrl` — the single **primary red CTA** (`#e11d48`). `:7181,7210`.
- `secondaryButton?` — second full-width button, rendered under the primary CTA. `:7188,7211`.
- `actions[]?` — extra actions rendered as inline underlined links (message actions become
  outlined buttons via `isMessageAction`). Deduped against primary/section links. `:7186-7192,7216`.
- `secondaryLink?` — alias merged into the same `actions` pool. `:7189`.
- `note?` — grey footnote paragraph; if any action is a chat "message" action and the note
  isn't already the communication note, `LOCAL_COOKS_COMMUNICATION_NOTE` is appended. `:7193,7217`.
- `tour?` — when present, appends ` · {date}, {slot range} · TOUR-{id}` to the subject (and
  strips it from the heading). `:7176-7180`.
- Footer is fixed: `Need a hand? Contact Local Cooks` → `getSupportEmail()` (env
  `SUPPORT_EMAIL` or `support@localcooks.ca`). `:553,7218-7219`.

Plain-text part: always generated (`:7196`), ending `Need a hand? Contact <support email> / The Local Cooks Team`.

## 3. (b) Notice layout mobile responsiveness

**Yes** — table-based, fixed `max-width:640px`, with a `@media (max-width:560px)` block and a
`viewport` meta. Quoted from `server/email.ts:7197-7205`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>@media only screen and (max-width:560px){
  .email-body,.email-brand,.email-footer{padding-left:24px !important;padding-right:24px !important}
  .email-title{font-size:24px !important}
  .email-outer{padding:0 !important}
}</style>
...
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
 <tr><td class="email-outer" align="center" style="padding:16px 12px;">
 <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;">
```

`prepareEmailHtml` adds a second, broader media query (`server/email-theme.ts:38`) for the
`.lc-email` theme (also `max-width:560px`), so the notice shell carries two stacked
560px breakpoints. The uniform shell has no media query of its own — it relies solely on
`prepareEmailHtml`'s injected one plus `.email-container{max-width:640px}` (`email.ts:920`).

## 4. (c) Dev-DB `email_logs.category` strings

`email_logs.category` is free text (`shared/schema.ts:2526`, default `general`); there is **no
enum/check constraint**. `inferEmailCategory()` (`server/services/email-log-service.ts:47-71`)
uses the explicit `emailType` when provided, otherwise infers from subject/tracking id.

Explicit `emailType`/`category` values used by booking producers:

| category | set by | where |
|---|---|---|
| `booking` | `emailType:'booking'` | `booking-lifecycle-delivery.ts:327,377` |
| `advance_reminder` | intent insert `category` | `advance-reminders.ts:61,97,288,334` |
| `advance_reminder_attempt` | `emailType` on send | `advance-reminders.ts:517` |
| `chat_digest` | intent insert | `chat-notices.ts:81,138`; `local-chat-emails.ts:42` |
| `chat_digest_attempt` | `emailType` | `chat-notices.ts:117,215` |
| `location_access_notice` | intent insert | `location-access-notices.ts:16,33,41,72,104` |
| `location_access_notice_attempt` | `emailType` | `location-access-notices.ts:92` |
| `lifecycle_outcome` | intent insert | `outcome-delivery.ts`, `commitment-problems.ts:83`, `booking-cancellation-refund.ts` (via events) |
| `lifecycle_outcome_attempt` | `emailType` | `outcome-delivery.ts:136` |
| `kitchen_license_expiry` | `emailType` | `routes/license-expiry.ts:106` |
| `tour` | `emailType` | `tour-delivery-service.ts:835,856` |
| `admin_notification` | `emailType` | `admin-email-preferences.ts:36` |

Inferred categories (direct `sendEmail` with no `emailType`, from routes/services) that
booking emails land in: `booking`, `cancellation`, `checkin`, `storage`, `overstay`,
`refund`, `damage_claim`, `license`, `access`, `viewing`. (`email-log-service.ts:54-70`.)

## 5. Master inventory

Recipient roles: **chef** / **manager** / **admin**. "Producer" = where the send/queue is
initiated; "Renderer" = the function that builds the HTML.

### 5.1 Booking request & confirmation

| Trigger (event/kind) | Recipient | Subject | Producer file:line | Renderer file:line | Family | Text? | CTA? | Notes |
|---|---|---|---|---|---|---|---|---|
| Booking request received | chef | `Booking request received — {kitchen} · {ref}` | `routes/bookings.ts:3592` | `generateBookingRequestEmail` `email.ts:3841` | notice | yes | yes "View booking request" | `note` includes pre-confirmation refund policy + communication note |
| New booking request | manager | `New booking request — {kitchen} · {ref}` | `routes/bookings.ts:3885` | `generateBookingNotificationEmail` `email.ts:3539` | notice | yes | yes "Review booking request" | 100% pre-confirmation refund note |
| Booking **confirmed** | chef/manager/admin | `Your Kitchen Booking Is Confirmed for {date}` (staff: `Kitchen Booking Confirmed…`) | `booking-lifecycle-delivery.ts:210,339` (kind `confirmed`) | `generateBookingConfirmationEmail` `email.ts:3858` | uniform | yes | yes "Open booking" | ICS attachment `method=PUBLISH`; calendar links; `checkInWindow…`/no-show grace wording; `Newfoundland`/tz string in `calendar.timeLabel` |
| Legacy confirmation re-render (fallback) | chef | (original subject) | `booking-lifecycle-delivery.ts:38` | `renderTransactionalEmail` `email.ts:7168` | notice | yes | yes "Open booking" | only when a queued receipt lacks structured confirmation input |
| Booking status-change notice | manager | `You Confirmed a Booking for {date}` | **none (dead)** | `generateBookingStatusChangeNotificationEmail` `email.ts:3711` | uniform | yes | yes "Go to Your Dashboard" | imported `routes.ts:31`, `routes/manager.ts:65`, never called |
| Payment received | manager | `Payment Received - {kitchen} Booking` | **none (dead)** | `generateBookingPaymentReceivedEmail` `email.ts:3551` | uniform | yes | yes "View Booking Details" | |

### 5.2 Cancellation, refund, reschedule

| Trigger (event/kind) | Recipient | Subject | Producer file:line | Renderer file:line | Family | Text? | CTA? | Notes |
|---|---|---|---|---|---|---|---|---|
| `cancelled` (unpaid) | chef/manager/admin | `Unpaid kitchen booking cancelled` (title) | `routes/bookings.ts:2270` | lifecycle fallback `booking-lifecycle-delivery.ts:342-344` | bare | yes | yes "View booking" | `<h2>{title}</h2><p>{message}</p><p><a>View booking</a></p>` |
| `cancellation_requested` | chef/manager/admin | `Kitchen cancellation requested` | `routes/bookings.ts:2291` | lifecycle fallback `:344` | bare | yes | yes | message carries chef reason |
| `cancellation_reviewed` (accepted/declined) | participants | `Kitchen cancellation accepted/declined` | `routes/manager.ts:1037`, `booking-cancellation-refund.ts:178` | lifecycle fallback `:344` | bare | yes | yes | |
| `cancellation_reviewed` (auto-accept, cron) | participants | `Kitchen cancellation auto-accepted` | `scheduled-cancellations.ts:59` | lifecycle fallback `:344` | bare | yes | yes | |
| Cancellation **accepted** (storage add-on) | chef | `Cancellation Accepted - {kitchen}` | `routes/manager.ts:1262` | `generateCancellationAcceptedEmail` `email.ts:6153` | uniform | yes | yes "View My Bookings" | |
| Cancellation **declined** (storage add-on) | chef | `Cancellation Declined - {kitchen}` | `routes/manager.ts:1352` | `generateCancellationDeclinedEmail` `email.ts:6238` | uniform | yes | yes | |
| Booking cancellation (chef, legacy path) | chef | `Booking Cancelled - {kitchen}` | `routes/bookings.ts:573,2623` | `generateBookingCancellationEmail` `email.ts:4015` | uniform | yes | yes "View Bookings" | |
| Booking cancellation notice (manager, legacy) | manager | `Booking Cancelled - {kitchen}` | `routes/bookings.ts:588,2653` | `generateBookingCancellationNotificationEmail` `email.ts:3643` | uniform | yes | yes | |
| `refund_issued` | participants | `Cancellation refund verified` | `booking-cancellation-refund.ts:216`, `payment-refund-reconciliation.ts:65` | lifecycle fallback `:344` | bare | yes | yes | |
| `payment_recovery_needed` | participants/admin | `Cancellation refund needs verification` / `Booking payment needs Local Cooks review` | `booking-cancellation-refund.ts:227`, `booking-payment-decision.ts:137,182`, `captured-booking-reconciliation.ts:66` | lifecycle fallback `:344` | bare | yes | yes | |
| Refund processed | chef | `Refund Processed - $X CAD` | **none (dead)** | `generateBookingRefundEmail` `email.ts:6327` | uniform | yes | yes | |
| `kitchen_change_{state}` (reschedule/change quote) | participants/admin | label from state | `kitchen-booking-changes.ts:203` | lifecycle fallback + `<p>{note}</p>` prepend `booking-lifecycle-delivery.ts:345-358` | bare | yes | yes | prepends "Current change state: …" |
| `item_cancellation_requested` / `item_withdrawn` | participants | item title | `booking-item-cancellation.ts:46` | lifecycle fallback `:344` | bare | yes | yes | |
| `storage_cancellation_reviewed` | participants | `Storage cancellation accepted/auto-accepted` | `routes/manager.ts:1192`, `scheduled-cancellations.ts:108` | lifecycle fallback `:344` | bare | yes | yes | |

### 5.3 Arrival, instructions, check-in / check-out, closeout

| Trigger (event/kind) | Recipient | Subject | Producer file:line | Renderer file:line | Family | Text? | CTA? | Notes |
|---|---|---|---|---|---|---|---|---|
| `arrival_mode_changed` / `arrival_code_reissued` | chef | i18n `arrivalChanged*Subject` / `arrivalReissuedSubject` | `visit-code-challenge.ts:417,449` | `currentArrivalNotice` `booking-lifecycle-delivery.ts:110` | notice | yes | yes "Open your visit" (i18n) | rendered from current state at delivery; IANA tz via `Intl` |
| `instructions_updated` | chef | `Booking instructions updated at {kitchen}` | `kitchen-instructions-updated.ts:87` | `currentKitchenInstructionEmail` `kitchen-instructions-updated.ts:126` | notice | yes | yes "Open your visit" | diff facts (added/removed tasks) |
| `service_ended` | chef | `Your visit at {kitchen} is complete · {ref}` | `clock-closeout.ts:127` | `currentCloseoutEmail` `closeout-notice-email.ts:100` | notice | yes | yes "View booking" | visit summary, "not a payment receipt" |
| `service_ended` | manager | `{chef}’s visit at {kitchen} has ended · {ref}` | `clock-closeout.ts:127` | `currentCloseoutEmail` `closeout-notice-email.ts:112` | notice | yes | yes "Open inspection"/"View booking" | inspection-due section |
| `inspection_auto_closed` | manager | `Inspection window closed for {chef}’s visit · {ref}` | `clock-closeout.ts:134` | `currentCloseoutEmail` `closeout-notice-email.ts:84` | notice | yes | yes "View booking" | chef never told |
| `checkin_recorded` | manager | `Kitchen visit check-in recorded` | `kitchen-visit-lifecycle.ts:71` | lifecycle fallback `:344` | bare | yes | yes | `emailRecipientPolicy:'manager'` |
| `checkout_requested` | manager | `Kitchen visit needs inspection` | `kitchen-visit-lifecycle.ts:74` | lifecycle fallback `:344` | bare | yes | yes | |
| `checkout_cleared` | chef | `Kitchen visit checkout cleared` | `kitchen-visit-lifecycle.ts:77`, `clock-closeout.ts:85`, `kitchen-checkout-service.ts:593,780,846` | lifecycle fallback `:344` | bare | yes | yes | |
| `checkout_claim_filed` | participants | `Inspection handed to a draft claim` | `kitchen-visit-lifecycle.ts:219`, `kitchen-checkout-service.ts:698` | lifecycle fallback `:344` | bare | yes | yes | |
| `visit_assisted` | manager | `Manager-assisted {action} recorded` | `visit-assistance.ts:75` | lifecycle fallback `:344` | bare | yes | yes | |
| `report_no_show` / `report_attended` / `withdraw_attendance` | participants | `No-show reported` / `Attendance reported` / `Visit report withdrawn` | `booking-attendance-service.ts:123` | lifecycle fallback `:344` | bare | yes | yes | |
| `storage_removed` | chef | `Storage removal confirmed` | `storage-checkout-service.ts:863` | lifecycle fallback `:344` | bare | yes | yes | |
| `requested` (fulfilment) | participants | `Kitchen booking requested` | `booking-checkout-fulfillment.ts:86` | lifecycle fallback `:344` | bare | yes | yes | |
| Historical replay of any kind | participants | `Recorded notice: {subject}` | `booking-lifecycle-delivery.ts:360-374` | lifecycle fallback `:344`/`:368` | bare | yes | yes | strips ICS, adds "history only" note |
| Check-in confirmed | manager | `Chef Checked In - {kitchen}` | **none (dead)** | `generateKitchenCheckinManagerEmail` `email.ts:6421` | uniform | yes | yes "View Booking" | |
| Check-in confirmed | chef | `Check-In Confirmed - {kitchen}` | **none (dead)** | `generateKitchenCheckinChefEmail` `email.ts:6496` | uniform | yes | yes | |
| Checkout requested | manager | `Checkout Requested - {kitchen}` | **none (dead)** | `generateKitchenCheckoutRequestManagerEmail` `email.ts:6570` | uniform | yes | yes | |
| Check-in reminder | chef | `Reminder: Check In Today — {kitchen}` | **none (dead)** | `generateKitchenCheckinReminderEmail` `email.ts:6639` | uniform | yes | yes | |
| Storage check-in reminder | chef | `Reminder: Check In Today — {storage}` | **none (dead)** | `generateStorageCheckinReminderEmail` `email.ts:6715` | uniform | yes | yes | |
| Checkout cleared | chef | `Checkout Complete - {kitchen}` | **none (dead)** | `generateKitchenCheckoutClearedChefEmail` `email.ts:6785` | uniform | yes | yes | |
| No-show | manager | `No-Show Detected - {kitchen}` | **none (dead)** | `generateKitchenNoShowManagerEmail` `email.ts:6861` | uniform | yes | yes | |
| No-show | chef | `Booking Marked as No-Show - {kitchen}` | **none (dead)** | `generateKitchenNoShowChefEmail` `email.ts:6937` | uniform | yes | yes | |

### 5.4 Reminders

| Trigger (kind) | Recipient | Subject | Producer file:line | Renderer file:line | Family | Text? | CTA? | Notes |
|---|---|---|---|---|---|---|---|---|
| `preparation` / `arrival` / `departure` / `checkin_open` | chef & manager | i18n `visitPreparationSubject`/`visitArrivalSubject`/`managerArrivalSubject`, else `{title} · {kitchen} · {ref}` | `advance-reminders.ts:516` (dispatch) | `renderBookingVisitReminder` `advance-reminders.ts:371` | notice | yes | yes "Prepare for arrival"/i18n `visitOpen` | category `advance_reminder`/`_attempt`; IANA tz via `Intl` |
| `session_ending` | chef | i18n `sessionEndingSubject` | `advance-reminders.ts:516` | `renderSessionEndingEmail` `advance-reminders.ts:361` | notice | yes | yes | 15-min in-session alert |
| `deadline` (claim / penalty / storage_review / storage_cancellation_review / booking_review / cancellation_review) | chef or manager | `{title}` | `deadline-reminders.ts:103` → dispatch `advance-reminders.ts:516` | dispatch non-booking branch `advance-reminders.ts:516` | plain-text-only | yes | no (URL in text) | no `html` field |
| `storage_arrival` | chef | `Storage booking #{id}` | `advance-reminders.ts:158` → dispatch `:516` | dispatch non-booking branch `:516` | plain-text-only | yes | no | same-day guidance |
| Tour `preparation` / `arrival` | chef & manager | `… · {tour title} · TOUR-{id}` | `advance-reminders.ts:516` | `renderTourReminder` `advance-reminders.ts:401` | notice | yes | yes "View tour" | adjacent (tour) |

### 5.5 Problem reports & chat notices for bookings

| Trigger | Recipient | Subject | Producer file:line | Renderer file:line | Family | Text? | CTA? | Notes |
|---|---|---|---|---|---|---|---|---|
| Problem reported / claimed / replied / resolved | chef/manager/admin | `{Category} problem reported · Booking #{id}` etc. | `commitment-problems.ts:82` (via `queueProblemNotice`) | `deliverOutcomeEmails` `outcome-delivery.ts:134` | plain-text-only | yes | no (URL in text) | category `lifecycle_outcome`; rendered from current state |
| New message (initial) | chef/manager | `New message from {sender} — {location}` | `chat-notices.ts:112` | `generateChatMessageEmail` `email.ts:1609` | notice | yes | yes "Read message and reply" | category `chat_digest` |
| Unread digest / reminder | chef/manager | `Unread messages from {sender} — {location}` | `chat-notices.ts:114,213` | `generateChatDigestEmail` `email.ts:1619` | notice | yes | yes "Read messages and reply" | |

### 5.6 Storage / equipment add-ons, overstay & penalties

| Trigger | Recipient | Subject | Producer file:line | Renderer file:line | Family | Text? | CTA? | Notes |
|---|---|---|---|---|---|---|---|---|
| Storage checkout requested | manager | `Storage Checkout Request - {storage}` | `storage-checkout-service.ts:628` | inline | bare | yes | yes "Review Checkout Request" | `VITE_APP_URL` link; table markup |
| Storage checkout claim filed | chef | `Storage Checkout — Claim Filed - {storage}` | `storage-checkout-service.ts:708` | inline | bare | yes | yes "View Claim Details" | |
| Storage extension requested (payment received) | manager | `Storage Extension Request - {storage}` | `routes/webhooks.ts:1689` | `generateStorageExtensionPendingApprovalEmail` `email.ts:4433` | uniform | yes | yes "Review Extension Request" | |
| Storage extension payment received | chef | `Storage Extension Payment Received - {storage}` | `routes/webhooks.ts:1703` | `generateStorageExtensionPaymentReceivedEmail` `email.ts:4500` | uniform | yes | yes | |
| Storage extension **approved** | chef | `Storage Extension Approved - {storage}` | `routes/manager.ts:6899` **and** `:6944` | uniform `email.ts:4567` **+** inline bare `:6944` | uniform **+ bare** | yes | yes | **duplicate send** (uniform + bare) |
| Storage extension **declined** | chef | `Storage Extension Declined - {storage}` | `routes/manager.ts:7230` **and** `:7272` | uniform `email.ts:4630` **+** inline bare `:7272` | uniform **+ bare** | yes | yes | **duplicate send** |
| Overstay detected | chef | `Storage Booking Expiring …`/detected | `overstay-penalty-service.ts:2022` | `generateOverstayDetectedEmail` `email.ts:4795` | uniform | yes | yes | IANA tz not used; local `toLocaleDateString` |
| Overstay notification | manager | overstay notice | `overstay-penalty-service.ts:2041` | `generateOverstayManagerNotificationEmail` `email.ts:5105` | uniform | yes | yes | |
| Penalty charged | chef | penalty charged | `routes/webhooks.ts:2991` | `generatePenaltyChargedEmail` `email.ts:4881` | uniform | yes | yes | |
| Storage expiring warning | chef | `Storage Booking Expiring …` | **none (dead)** | `generateStorageExpiringWarningEmail` `email.ts:4701` | uniform | yes | yes | preview script only |
| Penalty approved / waived | chef | — | **none (dead)** | `generatePenaltyApprovedEmail` `email.ts:4948`, `generatePenaltyWaivedEmail` `email.ts:5027` | uniform | yes | yes | preview script only |
| Storage clearance / visit action outcome | chef/manager | `Storage #{id}: …` | `outcome-delivery.ts:173,193` | `deliverOutcomeEmails` `outcome-delivery.ts:134` | plain-text-only | yes | no | category `lifecycle_outcome` |

### 5.7 Documents, access & kitchen settings

| Trigger | Recipient | Subject | Producer file:line | Renderer file:line | Family | Text? | CTA? | Notes |
|---|---|---|---|---|---|---|---|---|
| Location access ended | chef | `Your access to {location} has ended` | `location-access-notices.ts:58` | `queueAccessNotice` `location-access-notices.ts:35` | notice | yes | yes "View your bookings" | category `location_access_notice`; `secondaryLink` `mailto:support@localcooks.ca` |
| Chef document expiring / expired | chef | `{doc} expiring/expired at {location}` | `chef-document-expiry.ts:34` | `queueAccessNotice` `location-access-notices.ts:35` | notice | yes | yes "Upload a renewed document" | tz via `accessDocumentStage` |
| Document renewal approved / rejected | chef | `Your renewed {doc} was approved/not accepted` | `document-renewals.ts:82` | `queueAccessNotice` `location-access-notices.ts:35` | notice | yes | yes "View your bookings"/"Upload a corrected document" | |
| Kitchen license expiring (30/7/lapsed) | manager | license reminder | `routes/license-expiry.ts:94` | `generateKitchenLicenseExpiringEmail` `email.ts:5527` | uniform | yes | yes | `emailType:'kitchen_license_expiry'` |
| Kitchen license approved / rejected | manager | — | `routes/admin.ts:1091,1102` | `generateKitchenLicenseApprovedEmail` `email.ts:5283`, `…RejectedEmail` `email.ts:5378` | uniform | yes | yes | |
| Chef profile requested | chef | profile request | `routes/kitchens.ts:207` | `generateChefProfileRequestEmail` `email.ts:4214` | uniform | yes | yes | kitchen access prerequisite |
| Chef location access approved | chef | — | `routes/admin.ts:481` | `generateChefLocationAccessApprovedEmail` `email.ts:4279` | uniform | yes | yes | |
| Chef kitchen access approved | chef | — | **none (dead)** | `generateChefKitchenAccessApprovedEmail` `email.ts:4330` | uniform | yes | yes | |
| Kitchen settings changed | chef & manager | — | `routes/admin.ts:1747,1766` | `generateKitchenSettingsChangeEmail` `email.ts:4150` | uniform | yes | yes | |
| Kitchen availability changed | chef | — | **none (dead)** | `generateKitchenAvailabilityChangeEmail` `email.ts:4087` | uniform | yes | yes | preview script only |
| Location notification email changed | new address | — | `routes/manager.ts:5657` | `generateLocationEmailChangedEmail` `email.ts:4381` | uniform | yes | yes | |

### 5.8 Tour emails (notice-layout exemplar — adjacent, not a booking)

`generateTourRequestedChefEmail` (`email.ts:7027`), `generateTourRequestedLocalCooksEmail`
(`:7039`), `generateTourManagerChangeEmail` (`:7046`), `generateTourRequestedManagerEmail`
(`:7066`), `generateTourConfirmedEmail` (`:7100`, notice + ICS attachment),
`generateTourRejectedChefEmail` (`:7155`) — all `renderTransactionalEmail`. Delivered by
`tour-delivery-service.ts` (`emailType:'tour'`).

Kitchen-application emails (`generateKitchenApplication*Email`, `email.ts:5208-5273`) are
also notice-layout but are chef onboarding, out of booking scope.

## 6. Counts per template family

Counting producer functions/call-sites inventoried above (booking + linked storage/equipment
+ document renewal + access + chat/reminder for bookings; tour counted separately):

| Family | Live | Dead / legacy | Total |
|---|---|---|---|
| **notice** (`renderTransactionalEmail`) | 12 | 0 | 12 |
| **uniform** (`getUniformEmailStyles`) | 19 | 16 | 35 |
| **bare** (ad-hoc inline HTML, text+html) | 5 | 0 | 5 |
| **plain-text-only** (no `html`) | 2 | 0 | 2 |
| Tour (notice) — adjacent | 6 | 0 | 6 |

Live notice (12): booking-request ×2, arrival notice, instructions-updated, closeout ×3,
booking reminders, session-ending, chat message, chat digest, access notices ×4 (counted as
one producer `queueAccessNotice`). Live uniform (19) and dead uniform (16) are enumerated in
§5.1–5.7; the 16 dead are: BookingStatusChange, BookingPaymentReceived, BookingRefund, the 8
kitchen check-in/check-out/no-show/reminder generators, StorageExpiringWarning,
PenaltyApproved, PenaltyWaived, ChefKitchenAccessApproved, KitchenAvailabilityChange.

## 7. Cross-cutting inconsistencies (migration-relevant)

1. **Two shells for the same lifecycle.** Booking *request* uses notice
   (`generateBookingRequestEmail`), but booking *confirmation* uses the legacy uniform shell
   (`generateBookingConfirmationEmail`) — same event family, different HTML.
2. **Bare fallback is the default for most lifecycle kinds.** Any `queueBookingLifecycleEvent`
   kind without a dedicated renderer emits the `<h2>/<p>/<a>` fallback
   (`booking-lifecycle-delivery.ts:344`) — no logo, no footer, no theme beyond
   `prepareEmailHtml`.
3. **Duplicate storage-extension emails.** `routes/manager.ts` sends a uniform email
   (`:6899`/`:7230`) *and* a bare inline email (`:6944`/`:7272`) for the same event.
4. **Hard-coded support address.** Uniform bodies hard-code `support@localcooks.ca`
   (`email.ts:3599,3677,4477,4544,4607,4672,…`) instead of `getSupportEmail()` (`email.ts:553`).
   The notice shell always uses `getSupportEmail()`.
5. **Hard-coded IANA timezone / tz labels.** `createBookingDateTime` defaults to
   `'America/St_Johns'` (`email.ts:26,79`); `bookingRequestFacts` prints `'· Newfoundland time'`
   (`email.ts:3532`); `booking-item-cancellation.ts:27` and `routes/bookings.ts:2240` hard-code
   `'America/St_Johns'`. Notice/reminder renderers use the location timezone via `Intl`.
6. **Sign-off drift.** Uniform uses both `Best regards,` and `Best,`; notice ends
   `Need a hand? Contact … / The Local Cooks Team`.
7. **Dead generators.** 16 uniform generators have no production call site (only
   `scripts/preview-emails.ts`), including all legacy check-in/check-out/no-show emails —
   the live path for those events is the bare fallback.
8. **Plain-text-only outcomes.** `lifecycle_outcome` and non-booking reminders send no HTML
   part at all (`outcome-delivery.ts:134`, `advance-reminders.ts:516`).

## 8. Files read

`server/email.ts`, `server/email-theme.ts`, `server/services/{booking-lifecycle-delivery,
advance-reminders,deadline-reminders,kitchen-instructions-updated,commitment-problems,
location-access-notices,document-renewals,chef-document-expiry,clock-closeout,
closeout-notice-email,chat-notices,local-chat-emails,scheduled-cancellations,
booking-cancellation-refund,booking-attendance-service,booking-item-cancellation,
kitchen-visit-lifecycle,outcome-delivery,storage-checkout-service,kitchen-checkout-service,
overstay-penalty-service,email-log-service}.ts`,
`server/routes/{bookings,manager,admin,webhooks,kitchens,license-expiry}.ts`,
`shared/schema.ts`, `migrations/0076_commitment_problem_category.sql`.
