# Design consolidation spec: booking pages (chef + manager + admin) — 2026-10-14

Status: COMPLETE (review-ready). Read-only review; no source files were edited. Includes the owner's Oct 14 storage direction (§2.8: storage becomes its own product after booking; booking pages keep a single compact Storage row and a reserved "My storage" slot).

Scope: `client/src/pages/BookingDetailsPage.tsx` (chef `/booking/:id`, manager `/manager/booking/:id`), `client/src/pages/KitchenVisitPage.tsx` (chef visit screen; `KitchenCheckinTracker` + `InSessionPanel`), `client/src/pages/ManagerInspectionPage.tsx`, the manager booking dialogs, and the manager settings cards that change the booking flow. Read-only review; no source edits were made while writing this.

Supersedes nothing: it builds on `design-booking-details-page.md` (header/next-step/one-primary rules still hold) and folds in the Oct 14 live-test defects from `PHASE0_LOG.md`.

## 0. Principles (owner rules, restated as checks)

Every surface below is judged against these seven checks. They are the acceptance criteria for §5.

| # | Rule | Check an implementer/reviewer can run |
|---|---|---|
| P1 | **One "Now" area** per booking that changes with the moment. | On every state × role, the first card on the page is the Now card: one status pill, one sentence, at most ONE filled (brand) button, secondary buttons grouped in one row, nothing above it. |
| P2 | **No duplicate lines.** | A fact (check-in time, booked end, payout amount, "Visit finished", inspection deadline) appears once per page. `grep` the rendered DOM in tests for the formatted time/amount: exactly one match. |
| P3 | **Role-scoped info.** | Chef screens never show: inspection deadline, payout amount/timing, "finish the inspection", check-in code admin, "Fix the visit record". Manager screens never show: chef refund wording in the first person ("Your payment…"), "Open your visit", chef-only policy explanations. |
| P4 | **First person for the viewer's own actions.** | "You let {chef} start early", "You cancelled", "You've been paid". Third person only for the other party. |
| P5 | **Settings that change the flow preview their consequence before saving** (what changes for chefs · when it applies · current impact · how to undo) and confirm only when impactful. | Every control in §3 renders `SettingChangePreview` before its save button is enabled; the ones marked "confirm" open the confirm step. |
| P6 | **Money moments unmistakable, never repeated.** | One amount headline per payment card, one status line under it, breakdown collapsed. One combined "You've been paid" notice per booking release. |
| P7 | **Mobile 390 px.** | Stacked cards, a sticky bottom bar with primary + Message only, no horizontal scroll (`document.documentElement.scrollWidth === 390`), every tappable control ≥ 44 px (`min-h-11`). |

Vocabulary used below: **Now card** = the merged header + state block; **Visit record** = collapsible evidence/timeline section shown once a visit has started; **attention row** = a bordered row inside the Now card that needs the viewer's answer (extension request, offer, extra-time charge, damage claim, cancellation request).

## 1. Audit — every surface/state × role: current elements → problem → decision

Legend for the decision column: **keep** (as is) · **merge→X** (fold into X) · **move→X** (relocate unchanged) · **remove** · **fix** (copy/logic defect). States use the `BookingHeaderPhase` names from `client/src/lib/booking-header-state.ts`: `pending · confirmed · today · checkin_open · in_session · time_ended_in_session · checkout_review · visit_ended · completed · no_show · issue · cancellation_requested · cancelled` (cancelled covers declined/expired/withdrawn via `bookingCancelCause`).

### 1.1 Booking details page — `client/src/pages/BookingDetailsPage.tsx` (chef `/booking/:id`, manager `/manager/booking/:id`)

Render order today (main column): `CancellationRefundReview` (dialog) → `KitchenBookingChanges` → `SessionExtensionsCard` → Visit card → `BookingFeedbackCard` → `ManagerDamageClaimEntry` → `BookingDamageClaims` → When & where → person card → Add-ons → Note. Sidebar: Payment → Cancellation (`CancellationBookingCard` or inline section) → `BookingCancellationChooser` (sheet) → `BookingHistoryPanel` → Help (`CommitmentProblems` inside). Plus the sticky mobile bar.

| Element (file) | States × role where it renders | Problem | Decision |
|---|---|---|---|
| Header card: reference · booked-on · who (h1) · when line · pill · next-step · Message · primary · ⋯ (`BookingDetailsPage.tsx` lines ~1436–1510) | all × both | Good bones (design spec §Layout 1). But the state-specific content it needs (check-in code, running late, overstay actions, extension request, "Open your visit") is scattered across 2–4 cards below it, so the eye has to hunt. "Find another time" link sits inside the status block. | **keep as the top of the Now card**; absorb the state content listed in §2. |
| When line `bdHours` → "0.33 hrs" (`calculateDuration` → `bookedHours`, rounded to 2 decimals, `bdHours = "{count} hr{s}"`) | all × both | Defect D1: 20-minute booking reads "0.33 hrs"; 1.5 h reads "1.5 hrs". | **fix**: new `formatBookedDuration(minutes, locale)` → "20 min", "1 hr", "1 hr 30 min", "2 hrs" (`client/src/lib/booked-duration.ts`); used in header, When & where, and `formatVisitWhen` callers. |
| `SessionExtensionsCard` as a standalone top card titled "Extra time" (`components/booking/SessionExtensionsCard.tsx`) | confirmed/completed × both (renders when there is any request/offer/charge/history or a manager action is available) | Sits ABOVE the Visit card, so for a manager with a chef in session the page opens with "Offer more time" before "Visit". Three concerns mixed: open items needing an answer, manager tools, and history lines. Manager in `time_ended_in_session` sees "Charge for extra time" hint in the header AND the button here. | **split**: open items (request banner, offers, charges, waiting line) → **attention rows in the Now card**; "Offer more time" / "Let them start early" / "Charge for extra time" → **secondary actions in the Now card** (manager); confirmed history lines → **Visit record** list (merged with attendance history). Implement as `variant="now" \| "record"` props on the existing component; no new endpoint. |
| Chef extra-time charge copy `sxbChargeChef` "They've asked for {amount} for {billed} of extra time" | completed × chef | Defect D4: when the kitchen lowers the amount (e.g. 90 min → $15), "for 90 minutes of extra time" misreads as a rate. | **fix** copy: "You stayed {stayed} past your booking at {kitchen}. They've asked for {amount} for the extra time." (drop `{billed}`; keep it only in the manager line, which is their own number). |
| `KitchenBookingChanges` (schedule-change requests) | confirmed × both | Fine when present; invisible otherwise. | **move→Now card attention row** (pending change) ; history into Booking history (already events). |
| Visit card heading "Visit"/"Your visit" + "Open your visit" outline button | confirmed/cancellation_requested × chef (button when primary ≠ open_visit) | A second "Open your visit" exists for chefs outside the check-in window (header has none then). Two entry points to the same page in different states is confusing; before the window the visit page has nothing actionable except "Arrived early? Message". | **remove** the outline button; the Now card's secondary row carries "See arrival details" (opens `/booking/:id/visit`) before the window and the primary "Open your visit"/"Check out" inside it. |
| `ManagerInSessionBadge` ("In session · ends 5:50 p.m." chips) inside Visit card | in_session/time_ended × manager | Duplicates the header next step "{chef} is in the kitchen until {time}". | **remove** from the booking page (keep on the inspection page where there is no next-step line). |
| `BookingAttendancePanel` embedded: status line "Checked in X · checked out Y" / "No arrival…", manager "Fix the visit record" trigger + dialog, "Fix history" details, no-show chef dispute link | visitStarted × chef; all confirmed/completed × manager | Manager in session: arrival line is suppressed only while `codeShowsArrival` (no departure yet) — after checkout both this line AND `VisitCodePanel`'s "Checked in 9:28 with the check-in code" show (walkthrough gap 11). Multi-visit rows (`renderVisitRows`) print "Checked in at" a third time. | **merge→Visit record**: one `VisitTimeline` line per visit: "Checked in 9:28 a.m. with the check-in code · Checked out 10:31 a.m." (method appended once, from the visit-code target). Attendance panel keeps the dialog (`fixOpen` controlled) but renders no status text when `embedded`. `renderVisitRows` loses its time lines (keeps the per-visit pill). |
| `VisitCodePanel` embedded (code, mode row, Get a new code / Let them check in without staff, consumed line) | confirmed/completed × manager | Correct content, right place, but it shows the full code card days before the visit (the code matters from 30 min before start). Mode-change dialog lacks the consequence preview (§3). | **keep in Now card**, but **collapsed to one line** outside the window: "Check-in code · shared in person when they arrive · Show" (expands); full code + buttons only from `POLL_LEAD_MINUTES` before start until end. Dialog → §3.1. |
| `BookingPreparation` (chef "What to expect"/instructions block; `inSession` departure variant) | confirmed before arrival × chef; in_session × chef | Right content but it is the longest block on the page and sits inside "Your visit" with `CheckinPolicyTimesCard` and `RunningLateCard` below it. In session it repeats departure instructions that the visit page's in-session panel also shows. | **keep before arrival** as the Now card's body (it IS the "now" for an upcoming visit), **collapsed** to the first two lines + "Show all" when instructions are released. **remove** the in-session variant from the booking page (the visit page owns in-session). |
| `CheckinPolicyTimesCard` ("Check-in opens / Visit starts" grid + "Arrived early? Message the kitchen") | confirmed before arrival × chef | "Check-in opens {time}" is already the header next step (`bdhNextChefDetailsReady`: "…Check-in opens {time}"). Duplicate (P2). | **remove** from the booking page; keep the early-arrival link as a secondary action in the Now card ("Arrived early? Message {kitchen}"). The card stays on the visit page (one place). |
| `RunningLateCard` (chef) / `rlManagerLine` (manager, in header) | confirmed before arrival × chef (30 min before start → end); manager line while relevant | Right idea; chef card is a bordered sub-card inside "Your visit" under instructions, easy to miss when it matters (you're in a car). Manager line is correctly in the header. | **move→Now card secondary action** "Running late?" (chef) that opens the existing panel inline; once sent, the sky banner becomes the Now card's status sentence ("You told {kitchen} you're about 15 min late. Your booking still ends at {end}."). Manager line **keep** in Now card. |
| `ClockCloseoutSummary` embedded (`hideInspectionDeadline`, `hideFinished={chefInSession}`) | visitStarted × both | On the booking page it mostly prints outcome lines ("The kitchen checked the space. All good." / "No check-in was recorded…") which the header next step already covers in `completed`/`visit_ended`. | **merge→Now card sentence** (one outcome sentence per role, see §2 copy) and **remove** the component from the booking page. |
| `visitEvidence` `<details>` "Photos, checklists and notes" | single-visit with evidence × both | Good, collapsed. | **move→Visit record** (same collapsible). |
| `BookingFeedbackCard` ("How did it go?") | once feedback `available` (14-day window after closeout) × both | Renders between Visit and Damage claims regardless of state, as a full Card with its own header; on `completed` it competes with the Now card for "what should I do". | **keep**, but **only after** the Now card and only in `completed`/`no_show`/`issue` states; one-line collapsed presentation (question + stars; the sheet/form opens on tap, as today). |
| `ManagerDamageClaimEntry` ("Report damage or extra cleaning" button + visit select) | confirmed/completed × manager (always) | Shows on a confirmed booking days before the visit (the window is 72 h after the end). | **move→Now card secondary action**, shown only while `claimFilingWindow(...).allowed`. |
| `BookingDamageClaims` cards (`DamageClaimCard`) | any claim × both | Chef and manager both get a tall article (status, description, lines, evidence, timeline) in the main column; a chef with an unpaid approved claim needs it at the TOP (it blocks new bookings after 7 days), not under Visit. Copy keys `dcV2*` in en-CA contain literal `?` for apostrophes ("We?ll", "isn?t", "kitchen?s") — corruption like the earlier "there?s" case. | **move→Now card attention row** while the claim needs the viewer (chef: `submitted`/`approved`/`partially_approved`/`charge_failed` → "Pay $X" / "Dispute"; manager: `awaiting_kitchen` → "Reply"; manager `in_review` → one status sentence). Closed/paid claims → **Visit record** line "Damage claim · $X · paid Oct 16". **fix** the `?` characters in all `dcV2*` en-CA keys (and check fr-CA/uk). |
| When & where card (date, time slots, hours, kitchen, address, Add to calendar) | all × both | Repeats the header's when line, kitchen name and address (chef header subline is the address). Useful only for: full date, non-contiguous slots, Add to calendar. | **merge→header**: full date already there; put "Add to calendar" into the ⋯ menu and the Now card secondary row for upcoming states; keep a slim "Where" block (location name + address + map link) ONLY for the chef, under the person card; non-contiguous slots render in the header when line as "2:00–3:00 · 4:00–5:00 p.m.". |
| Person card (avatar, name, Message, phone once confirmed, email) | all × both | Fine. Second "Message" button on the page (header has one). | **keep**; the Message button here is the only one on desktop below the fold, acceptable. Email line small, keep. |
| Add-ons (storage rows with dates/price/chip; equipment rows; manager accept/decline for equipment cancellation) ; Note | when present | Equipment is fine. Storage is becoming its own product after this pass (owner, Oct 14): modular terms, its own move-in/move-out, "Manage my storage". Today's storage rows (dates, pricing model, `StorageCheckinDialog`/`StorageCheckoutDialog`, `PendingStorageExtensions`, `ExpiringStorageNotification`) would make the booking page the storage workflow's home, which is the wrong home. | **keep equipment**; **storage → one compact "Storage" row** per booking (name · dates · price · status chip) with no storage workflow on the booking page, reserved as the future link-out to storage details (§2.8). Note **keep**. |
| Payment card: `RefundRequestStatus` (manager) + heading + headline amount + `KitchenPayoutStatus` (manager, after_closeout) + `paymentMessage` summary with ⓘ popover + breakdown `<details>` + Download + "View cancellation and refund details" | all × both | Up to three status lines about the same money: headline "Your payout $27.32" → `KitchenPayoutStatus` "Paid after the visit. Finish the inspection…" → `paymentMessage` "The chef has paid. Your payout is sent after the visit closes." (P6). For the chef on a cancelled booking, "Your payment was refunded." + "Refunded $26.00" + breakdown refund line. | **merge** into: label + ONE amount + ONE status line (`paymentStatusLine`, precedence: refund/void → hold/sent/scheduled payout → paid). The ⓘ popover keeps the long explanation. `KitchenPayoutStatus` renders the status line (amount hidden) and `paymentMessage` is suppressed whenever `KitchenPayoutStatus` renders. Breakdown stays collapsed by default when a headline exists (already). |
| `CancellationBookingCard` ("Cancellation policy" title, policy summary, exact refund line, "Cancel booking" button) vs the inline "Cancellation" section (pending/cancellation_requested/past deadline) | chef confirmed; chef other states | Two different cards for one concept, plus "Cancel or change booking" in ⋯. Three ways to start a cancellation. | **merge** into one `CancellationCard` (sidebar, chef only): title "Cancellation", ONE sentence (pending: hold released on withdraw; confirmed before deadline: `cpDeadlineKnown`; after deadline: `cpDeadlinePast*`; requested: `cancelCopy07`), one text link "Cancel or change". The ⋯ entry stays (it is the Airbnb pattern); no filled button. |
| ⋯ menu (manager: Cancel as the kitchen, Change booking / Manage refund / Review cancellation, Visit inspection, Fix the visit record, Download payout statement, Get help; chef: Cancel or change, Download receipt/final invoice, Get help) | all × both | Reasonable. "Review cancellation" appears both as primary and in the menu in `cancellation_requested`. "Visit inspection" is also the primary in `checkout_review`/`visit_ended` (guarded) — fine. | **keep**; dedupe: omit the menu entry when it is the current primary. Add "Add to calendar" (upcoming). |
| Sticky mobile bar (Message + primary) | when either exists × both | Correct (P7). Hidden when neither exists — then the page has no sticky bar; fine. | **keep**. |
| `CommitmentProblems` inside Help card ("Report a problem") | all × both | Fine, low. | **keep**. |
| Chef `completed` next step: `bdVisitCompleteReview` "Visit complete. The kitchen reviews by {time}." | completed/checkout_review × chef | Kitchen-only information on a chef screen (P3): the inspection deadline is the kitchen's business; the chef only needs "you're done". | **fix** copy: "Visit complete. Thanks for leaving the kitchen ready." and in `checkout_review`: "Checkout submitted at {time}. You're all set — we'll let you know if the kitchen reports anything." |
| Manager `bdhNextManagerReviewBy` "{chef} checked out. Review the kitchen by {time}." (non-after_closeout) and `bdhNextManagerInspectBy` | checkout_review/visit_ended × manager | Fine. With after_closeout the payout variant is used (good). | **keep**. |

### 1.2 Chef visit page — `client/src/pages/KitchenVisitPage.tsx` → `components/booking/KitchenCheckinTracker.tsx` + `InSessionPanel.tsx`

| Element | States × chef | Problem | Decision |
|---|---|---|---|
| Header card: title ("Kitchen arrival" / "Your visit" / "Kitchen departure" / "Kitchen visit"), kitchen name, when line, "Times are shown in the kitchen's local time (…)" | all | Title changes meaning by state, which is good. The timezone sentence is a full line on every state (header already shows the zone name in the booking page). | **keep**; zone sentence → inline after the when line ("Wed, Oct 14 · 9:30–10:30 a.m. · Newfoundland Time"). |
| Status block: chip (`visitStatus_*` / "Your booked time ended" / "Visit finished" / "Cancelled") + `nextStep` sentence + "Arrival confirmed at {time}" + "Your booking still ends at {end}" + times `<dl>` (Check-in opens / Check-in time / Checkout time / Review due by / Checkout closed / Issue reported / Reported) + "Arrived early? Message…" + early-start `SessionExtensionsCard` + `RunningLateCard` | all | After check-in: "You're checked in…" sentence + "Arrival confirmed at 9:28" + dl "Check-in time 9:28" = the same time twice (P2). In `checkout_requested`: "Review due by" is the kitchen's deadline (P3). | **fix**: one status sentence that carries the time ("You checked in at 9:28 a.m. …"); drop the `arrivedAt` line and the `Check-in time` dl row when the sentence has it; **remove** "Review due by" for chefs; keep `Check-in opens` (before window) and `Checkout time` (after). |
| `InSessionPanel`: kitchen name h2 + "In session · ends {time} {zone}" + countdown + progress + Need more time? + Start check-out / Check out now + Leave early + Message kitchen + Report a problem + Get help details + Departure preview details | checked_in (incl. late checkout) | Defect D2: in `phase === "ended"` it still says "In session · ends 5:50 p.m." under the header's "Your booked time ended" chip. Kitchen name repeated from the header 40 px above. Two check-out buttons in `ending` phase ("Start check-out" + "Leave early / check out now"). | **fix**: h2 removed (the page header has the kitchen); subtitle by phase: active/ending "Ends at {time}" · ended "Ended at {time}"; in `ending`/`ended` show ONE checkout button ("Check out now"), "Leave early" only in `active`. |
| `ClockCloseoutSummary` (`hideFinished`, NOT `hideInspectionDeadline`) below the in-session panel | clockEnded or checked in | Defect D2b: prints "Inspection due by {time}" (kitchen-only, P3) and "No check-in yet". | **remove** from the visit page; the status sentence covers the ended outcomes. |
| "Choose a visit" buttons (multi-visit) | multi-visit | Fine. | **keep**. |
| Instructions section (`ArrivalModeLine`, arrival/departure instructions, "Updated by the kitchen since you booked", "Having trouble… Message kitchen") | live, released | Fine; this is the page's purpose. Before check-in it shows arrival only (good). | **keep**. |
| Check-in form; checkout form; `WhatHappensNextInfo` (3 bullets incl. "With no response in the inspection window, it closes as 'no inspection recorded'") | canCheckin / canCheckout | The 3 bullets describe the manager's process (P3-adjacent) and are hidden behind a toggle anyway. | **fix** copy to the chef's view: "The kitchen may review the space within 24 hours." (one bullet) ; keep the toggle. |
| Recorded instructions / recorded checklists (history) | after each step | Fine. | **keep** (collapsed `<details>`). |

### 1.3 Manager inspection page — `client/src/pages/ManagerInspectionPage.tsx`

| Element | States × manager | Problem | Decision |
|---|---|---|---|
| Back link + h1 "Visit inspection" + summary card (kitchen name, reference · chef, location · zone, visit select, schedule) | all | Fine (post-walkthrough). | **keep**. |
| `ManagerInSessionBadge` chips | in session | Useful here (no next-step line). | **keep**. |
| Task card (live): outcome sentence + "Inspect by {deadline} · zone" + `inspectCopy53` explainer + note textarea + buttons "All good — finish and send my payout" / "Report damage or extra cleaning" / "Help record the visit" | checkout_requested / open window | Fine. One primary (good). | **keep**; label the claim button as secondary (outline, already). |
| Done state (finished on {date}, payout sent/on hold, Back to booking, "Found a problem later?") | manager_cleared | Fine. | **keep**. |
| Evidence grid (arrival / departure) | all | Fine. | **keep**. |
| `DamageClaimSheet` in an inline section + `BookingDamageClaims` full list at the bottom | always | Claims are listed in full on the booking page AND here. | **fix**: here show only a one-line status per claim with a link "See the claim on the booking page"; the sheet stays (it is the natural place to file). |
| Support link "inspectCopy41" | all | Fine. | **keep**. |

### 1.4 Manager dialogs and sheets

| Element | Problem | Decision |
|---|---|---|
| `BookingActionDialog` (Review request: approve/decline with add-on toggles) | Fine. | **keep**. |
| `BookingManagementDialog` `mode="change"` → `ChangeBookingContent` (Cancel an add-on / Send a partial refund with consequence lines) | Good consequence pattern; reuse its sentence style in §3. | **keep**. |
| `KitchenCausedCancellation` ("Cancel as the kitchen", reason, `cpKitchenConsequence`) | Good. | **keep**. |
| `BookingAttendancePanel` dialog "Fix the visit record" (choices with hints; `fixAction='departure'` preset) | Good. | **keep**; only its inline status text changes (§1.1). |
| `DamageClaimSheet` (3 steps) | Step 3 says "Local Cooks reviews this before contacting {chef}…" and "Your payout isn't affected" — correct per the amendment. Trigger placement is the issue (§1.1). | **keep**; copy fix for `?` characters. |

### 1.5 Damage claims — where a claim appears per role (amendment: Local Cooks reviews every claim first)

| Claim status (`dcV2Status_*`) | Chef sees | Manager sees | Admin sees |
|---|---|---|---|
| `in_review` (just filed) | nothing (never notified) | Now card status sentence: "Local Cooks is reviewing your claim for $X. We'll update you within 2 business days." + Visit record line | Support desk `DamageClaimPanel` with first-review actions (Send to chef / Ask kitchen / Close / Local Cooks pays / Withdraw) |
| `awaiting_kitchen` | nothing | Now card attention row: "Local Cooks asked for more information about your claim." → **Reply** (secondary action) | panel: waiting |
| `submitted` (sent to chef) / `approved` / `partially_approved` | Now card attention row (top of page): "{kitchen} reported damage or extra cleaning: $X · Pay or dispute by {when}" → **Pay $X** (primary when no other primary) · **Dispute**; also the chef dashboard `PendingDamageClaims` list | Now card sentence: "Sent to {chef}. They have until {when} to pay or dispute. Your payout isn't affected." | panel: waiting |
| `chef_disputed` / `escalated` / `under_review` | status sentence: "Local Cooks is reviewing this with {kitchen}. Nothing has been charged." | status sentence: "{chef} disputed the claim. Local Cooks is reviewing it." | panel: final-decision actions (Uphold / Reduce / Reject / Local Cooks pays / Withdraw) |
| upheld & unpaid (`approved` with `upheldAt`) | attention row with `dcV2FinalConsequence` + **Pay $X**; after 7 days the dashboard `DamageClaimBookingHoldBanner` | status sentence: "Local Cooks upheld your claim. Waiting for {chef} to pay." | panel: Lift new-booking pause |
| `charge_succeeded` / compensated | Visit record line: "Damage claim · $X · paid {date}" | Visit record line: "Damage claim · $X · paid to you {date}" (+ Payment card line if transferred) | panel: closed |
| `rejected` / `resolved` (closed) / withdrawn | Visit record line (only if the chef was ever contacted) | Visit record line with the shared reason | panel: closed |

### 1.6 Settings that change the flow (audited for P5)

| Setting (file) | Today | Applies | Gap vs P5 |
|---|---|---|---|
| Self check-in for a visit — `VisitCodePanel` dialog "Set up self check-in?" (reason required) | Dialog body explains the chef can confirm arrival without a code and that the current code stops working. | Now, this visit (or all visits). | No "what the chef will see", no undo line, no mention the chef gets an email (`arrivalChangedSelfSubject`). |
| Auto-approve extensions — `SessionExtensionSettingsCard` switch | Saves on toggle, helper "When off, you'll get a request to approve with one tap." | Now, including a session in progress. | No preview, no confirm, no impact count, no undo. |
| Cancellation policy — `CancellationPolicyEditor` (notice 24/48/72 h, late charge 50/100 %) | `CancellationPolicySummary` preview + "Applies to new bookings only." | New bookings only (frozen snapshot per booking). | No impact ("your N upcoming bookings keep their terms"), no undo line, no confirm (impactful for chefs who see it at checkout). |
| Check-in window / no-show grace — `BookingRulesSettings` (`checkinWindowMinutesBefore`, `noShowGraceMinutes`) | Scope dialog (this kitchen / all kitchens); `policySaveExistingBookings` mentions cancellation deadlines only. | **Now, for existing bookings too** (`server/routes/bookings.ts` reads `checkinSettings.checkinWindowMinutesBefore` live). | Chefs' "Check-in opens {time}" changes silently on existing bookings. Needs preview + confirm + "we'll tell those chefs" (or at least the count). |
| Arrival/departure instructions and tasks — `KitchenCheckinCheckoutEditor` | Chef page shows "Updated by the kitchen since you booked". | Now. | Low impact; preview without confirm. |
| Manager no-check-in alert minutes — admin `LifecycleSettings` (`managerNoCheckinMinutes`) | Number row with help text. | Reminders scheduled from now on (revision hash). | Admin-only; preview line, no confirm. |
| Extra time kill switch — `SessionExtensionsPlatformSwitch` (admin) | Reason required; one sentence of state. | Now, all kitchens; in-flight payments finish. | Add impact count (open requests/offers) in the preview. |
| `damageClaimsReviewFirst` (server only, default true) | No UI. | — | When a UI is added it must use the pattern; out of scope now. |

## 2. Target information architecture per state (chef, manager) with wireframes

### 2.1 Page skeleton (both roles, all states)

```
┌─ Now card ───────────────────────────────────────────────────────────────┐
│ #KB-GNEWRD · Booked Oct 14                                               │
│ [avatar] Who (h1)                                  [Message] [PRIMARY] ⋯ │
│ Fri, Oct 16 · 2:00–3:00 p.m. · 1 hr · Newfoundland Time                  │
│ (pill)  One sentence for this moment.                                    │
│ ── attention rows (0–n; each has its own 1–2 buttons) ──────────────────  │
│ ── state body (what you need right now; collapsible when long) ────────  │
│ secondary actions row: [link] [link] [link]                              │
└──────────────────────────────────────────────────────────────────────────┘
┌─ Main (2/3) ───────────────────────────┐ ┌─ Sidebar (1/3) ──────────────┐
│ Visit record  ▸ (collapsed, after start)│ │ Payment: amount + 1 line     │
│ How did it go? (completed only)         │ │   Show breakdown ▸           │
│ {Chef | Kitchen} card (+ Where for chef)│ │ Cancellation (chef, pre-arr.)│
│ Add-ons (if any) · Note (if any)        │ │ Booking history (3 + all)    │
│                                         │ │ Help · Report a problem      │
└─────────────────────────────────────────┘ └──────────────────────────────┘
mobile (<640): Now card → Payment → Visit record → feedback → person → add-ons → note → cancellation → history → help; sticky bar [Message][PRIMARY]
```

Rules: the Now card never contains more than ONE filled button (the primary; on mobile it lives in the sticky bar instead and is not repeated in the card). Attention rows use outline buttons. Secondary actions are text/outline links in one wrapping row (≥44 px tall). The Visit record is a single `<details>` with: timeline lines, extra-time history, claim lines, photos/checklists/notes, fix history, and (manager) the "Fix the visit record" link.

### 2.2 State matrix — CHEF

| Phase | Pill | Sentence (en-CA) | Primary | Secondary row | Now body / attention rows |
|---|---|---|---|---|---|
| pending | Request pending | "Request sent. {kitchen} responds by {deadline}." (`bdRequestSentBanner`) | — | Cancel request · Add to calendar | — (Cancellation card in sidebar: `cpHold`) |
| confirmed (>24 h) | Confirmed | "Arrival details arrive {time}." / "Your arrival details are ready. Check-in opens {time}." | — | See arrival details · Add to calendar · Running late? (from −30 min) | `BookingPreparation` overview (collapsed to 2 lines + Show all once released); attention: kitchen offer of earlier start (`sxbEarlyOffer` → Accept & pay / No thanks) |
| today / checkin_open (before start) | Today | "Check-in opens {time}. Open your visit when you arrive." | **Open your visit** (only once open) | Arrived early? Message {kitchen} · Running late? | same as above; running-late sent → sentence becomes "You told {kitchen} you're about {duration} late. Your booking still ends at {end}." + "Update" link |
| checkin_open (after start, not checked in) | Today | "Check-in is open. Your booking still ends at {end}." | **Open your visit** | Running late? | |
| in_session | In session | "You're checked in. Check out by {end}." | **Check out** | Need more time? (opens visit page section) · Message {kitchen} | attention: kitchen offer (`sxbOffer`); waiting line `sxbWaiting` if a request is pending |
| time_ended_in_session | In session | "Your booking ended at {end}. Please check out now — {kitchen} may charge for the extra time." | **Check out** | Message {kitchen} | |
| checkout_review | Checkout submitted | "Checkout submitted at {time}. You're all set — we'll let you know if the kitchen reports anything." | — | — | attention: none |
| completed | Completed | "Visit complete. Thanks for leaving the kitchen ready." (+ " {kitchen} checked the space — all good." when `manager_cleared`) | **Pay $X** only if an extra-time charge or an approved claim is open | Download final invoice | attention rows: extra-time charge (`sxbChargeChef` fixed → Pay / This isn't right); damage claim (§1.5); then the feedback card below the Now card |
| visit_ended (no check-in) | Visit ended | "Your booked time ended. No check-in was recorded." | — | Message {kitchen} | |
| no_show | No-show reported | `kciStatusNoShow` | — | Message {kitchen} · Contact Local Cooks | body: the kitchen's shared message (quoted) |
| issue | Issue reported | "The kitchen reported an issue after this visit." | Pay $X (if a claim is payable) | — | attention: claim row |
| cancellation_requested | Cancellation requested | `cancelCopy07` | — | Message {kitchen} | |
| cancelled (declined/expired/withdrawn/kitchen/chef) | Declined / Expired / Cancelled | existing `bdhNext*` copy; kitchen-caused: `cpKitchenCancelledMsg` shortened to one sentence | — | Find another time (declined/expired/kitchen-caused) | Payment card shows the refund status line |

### 2.3 State matrix — MANAGER

| Phase | Pill | Sentence | Primary | Secondary row | Now body / attention rows |
|---|---|---|---|---|---|
| pending | Request pending | "Respond by {deadline} or the request expires." | **Review request** | Message {chef} | body: add-ons requested (if any) |
| confirmed | Confirmed | "{chef} is booked. Share the check-in code with them in person when they arrive." / self: "{chef} checks in on their own. Make sure they have the access instructions." | — | Let them start early (from −2 h) · Change booking · Add to calendar | body: check-in code collapsed line ("Check-in code · shared in person · Show") — expands; attention: pending schedule change (`KitchenBookingChanges`) |
| today / checkin_open (before start) | Today | "{chef} arrives today at {time}." | — | Let them start early · Message {chef} | body: check-in code OPEN (big digits + Get a new code · Let them check in without staff); running-late line `rlManagerLine` under the sentence when set |
| checkin_open (after start, not checked in) | Today | "{chef} hasn't checked in yet." (+ running-late line) | — | Message {chef} · Fix the visit record | body: code open |
| in_session | In session | "{chef} is in the kitchen until {time}. Checked in {time} with the check-in code." (one line, method appended once) | — | Offer more time · Message {chef} | attention: extension request banner (`sxbRequestBanner` → Approve · charge $X / Approve for free / Decline); waiting line for an offer sent |
| time_ended_in_session | In session | "{chef}'s booking ended at {end} and they haven't checked out yet." | — | Record when they left · Message {chef} | hint `bdhOverstayHint` under the row |
| checkout_review | Checkout to review | after_closeout: `bdhNextManagerReviewPayout` "{chef} checked out. Finish the inspection to get your {amount} now, or it's sent automatically on {date}." else `bdhNextManagerReviewBy` | **Review checkout** | Charge for extra time (if a late departure is recorded) · Report damage or extra cleaning · Message {chef} | attention: none |
| visit_ended (no check-in) | Visit ended | "The booked time ended without a check-in. If {chef} came, fix the visit record." | **Visit inspection** (if window open) | Fix the visit record · Message {chef} | |
| completed | Completed | "This visit is closed." (+ " You finished the inspection {date}." / " It closed without an inspection.") | — | Report damage or extra cleaning (while 72 h window open) · Charge for extra time (24 h, recorded departure) · Download payout statement | attention rows: claim `awaiting_kitchen` → Reply; extra-time charge waiting/disputed status line |
| no_show | No-show reported | "You reported this visit as a no-show." | — | Undo (Fix the visit record) | |
| issue | Issue reported | "Local Cooks is reviewing the issue you reported." | — | — | attention: claim status |
| cancellation_requested | Cancellation requested | "{chef} asked to cancel. Review the request." | **Review cancellation** | Message {chef} | |
| cancelled | Cancelled / Declined / Expired | existing copy | — | Manage refund (if paid) | Payment card line: "Not charged" or refund status |

Check-in code rendering rule (manager): collapsed line until `start − 30 min`; open card from then until the chef checks in or the visit ends; after check-in only the "Checked in … with the check-in code" fragment inside the sentence (nothing else repeats it).

### 2.4 Desktop wireframes (1280 px)

**Chef · confirmed, arrival details released, 2 days out**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ #KB-GNEWRD · Booked Oct 14                                                   │
│ PHASE0 Main Kitchen                                        [Message kitchen] ⋯│
│ 12 Water St, St. John's ↗                                                    │
│ Fri, Oct 16 · 2:00–3:00 p.m. · 1 hr · Newfoundland Time                      │
│ ● Confirmed   Your arrival details are ready. Check-in opens Oct 16, 1:45 p.m.│
│ ┌ What to expect ───────────────────────────────────────────────────────────┐ │
│ │ When you arrive, ask kitchen staff for your 6-digit check-in code…        │ │
│ │ Required for this visit: Wipe surfaces · Photo of stove                   │ │
│ │ Show all ▸                                                                │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│ See arrival details · Add to calendar                                        │
└──────────────────────────────────────────────────────────────────────────────┘
┌ Kitchen ───────────────────────────────┐ ┌ Payment ──────────────────────────┐
│ (PK) PHASE0 Main Kitchen               │ │ Total paid               $30.50  │
│ [Message kitchen]  +1 709 555 0100     │ │ Paid Oct 14.                      │
│ For your safety, keep messages and     │ │ Show breakdown ▸  [Download receipt]│
│ payments in Local Cooks.               │ └───────────────────────────────────┘
│ Where: 12 Water St ↗                   │ ┌ Cancellation ─────────────────────┐
└────────────────────────────────────────┘ │ Cancel by Oct 15, 2:00 p.m. for a │
┌ Add-ons ───────────────────────────────┐ │ full refund minus the $1.43 card  │
│ Walk-in cooler · $10.00 · Confirmed    │ │ processing fee. After that, you   │
└────────────────────────────────────────┘ │ pay the full price.               │
                                           │ Cancel or change                   │
                                           └───────────────────────────────────┘
                                           ┌ Booking history ──────────────────┐
                                           │ • Booking confirmed  Oct 14 3:02  │
                                           │ • Booking requested  Oct 14 2:55  │
                                           └───────────────────────────────────┘
                                           ┌ Contact Local Cooks ──────────────┐
```

**Manager · in session with an open extension request**
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ #KB-6WAXEF · Booked Oct 14                                                   │
│ (RS) Raunak S.                                             [Message chef] ⋯  │
│ Kitchen session · PHASE0 Main Kitchen                                        │
│ Wed, Oct 14 · 6:15–7:45 p.m. · 1 hr 30 min · Newfoundland Time               │
│ ● In session  Raunak is in the kitchen until 7:45 p.m. Checked in 6:17 p.m.  │
│               with the check-in code.                                        │
│ ┌ ! Raunak asked for 1 more hour (until 8:45 p.m.) · you'd get $28.75 ──────┐ │
│ │ Their card is on hold for $30.50. It's only charged if you approve.       │ │
│ │ The request closes at 7:32 p.m.                                           │ │
│ │ [Approve · charge $30.50] [Approve for free] [Decline]                    │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│ Offer more time · Fix the visit record                                       │
└──────────────────────────────────────────────────────────────────────────────┘
┌ Visit record ▸ ────────────────────────┐ ┌ Payment ──────────────────────────┐
│ (collapsed)                            │ │ Your payout              $27.32  │
└────────────────────────────────────────┘ │ Paid after the visit. Finish the  │
┌ Chef ──────────────────────────────────┐ │ inspection after Raunak checks    │
│ (RS) Raunak S. · [Message chef]        │ │ out to get it sooner. ⓘ           │
│ +1 709 555 0101 · raunak@…             │ │ Show breakdown ▸                  │
└────────────────────────────────────────┘ └───────────────────────────────────┘
```

**Manager · checkout to review (after_closeout)**
```
│ ● Checkout to review  Raunak checked out at 7:03 p.m. Finish the inspection  │
│   to get your $54.64 now, or it's sent automatically Oct 15, 7:03 p.m.       │
│                                                     [Review checkout] (red)  │
│ Charge for extra time · Report damage or extra cleaning · Message chef       │
```

**Chef · completed with a reduced extra-time charge**
```
│ ● Completed  Visit complete. Thanks for leaving the kitchen ready.            │
│ ┌ ! You stayed 1 hr 13 min past your booking at PHASE0 Main Kitchen. ───────┐ │
│ │ They've asked for $15.00 for the extra time.                              │ │
│ │ Note from PHASE0 Main Kitchen: "Cleaning ran over, no worries."           │ │
│ │ [Pay $15.00]  [This isn't right]                                          │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│ Download final invoice                                                       │
└──────────────────────────────────────────────────────────────────────────────┘
┌ How did it go? ────────────────────────┐
│ How was PHASE0 Main Kitchen? ☆☆☆☆☆     │  (private to Local Cooks)
└────────────────────────────────────────┘
```

### 2.5 Mobile wireframes (390 px)

**Chef · check-in open (sticky bar)**
```
┌──────────────────────────────┐
│ #KB-GNEWRD · Booked Oct 14   │
│ PHASE0 Main Kitchen        ⋯ │
│ 12 Water St ↗                │
│ Fri, Oct 16 · 2:00–3:00 p.m. │
│ 1 hr · Newfoundland Time     │
│ ● Today                      │
│ Check-in is open. Open your  │
│ visit when you arrive.       │
│ ┌ What to expect ──────────┐ │
│ │ Ask staff for your 6-digit│ │
│ │ check-in code… Show all ▸ │ │
│ └──────────────────────────┘ │
│ Arrived early? Message       │
│ Running late?                │
├──────────────────────────────┤
│ Payment  Total paid  $30.50  │
│ Paid Oct 14. Show breakdown ▸│
├──────────────────────────────┤
│ Kitchen · [Message] · phone  │
│ …                            │
└──────────────────────────────┘
╔══════════════════════════════╗
║ [Message kitchen] [Open your ║  ← sticky, 44 px, safe-area
║                     visit]   ║
╚══════════════════════════════╝
```

**Manager · chef still checked in after the end (overstay)**
```
┌──────────────────────────────┐
│ (RS) Raunak S.             ⋯ │
│ Kitchen session · PHASE0 …   │
│ Wed, Oct 14 · 6:15–7:45 p.m. │
│ ● In session                 │
│ Raunak's booking ended at    │
│ 7:45 p.m. and they haven't   │
│ checked out yet.             │
│ [Record when they left]      │
│ Once a departure time is on  │
│ the record, you can charge   │
│ for the extra time.          │
├──────────────────────────────┤
│ Visit record ▸               │
├──────────────────────────────┤
│ Payment  Your payout $27.32  │
│ Paid after the visit…        │
└──────────────────────────────┘
╔══════════════════════════════╗
║ [Message chef]               ║  ← no primary in this state: bar holds Message only
╚══════════════════════════════╝
```

### 2.6 Chef visit page — target per state (`KitchenCheckinTracker`)

```
header: title · kitchen · "Wed, Oct 14 · 9:30–10:30 a.m. · Newfoundland Time"
status: (chip) + ONE sentence [+ one time row only when the sentence lacks it]
task:   exactly one of
        A  arrival  — instructions (arrival only) → check-in form (code field, tasks, photos, note) → [Confirm check-in]
        B  session  — InSessionPanel: "Ends at 10:30 a.m." · countdown · progress · [Need more time?] · [Check out now] (ending/ended) · Message kitchen · Report a problem · Get help ▸ · Departure instructions ▸
        C  departure— departure instructions → checkout form → [Submit checkout]
        D  ended    — one sentence (checked out / not checked in / claim / no-show); recorded instructions + checklists ▸
```
Copy by state (replaces `nextStepMessage` + extra lines):
- before window: "Check-in opens at {time}. Come back then." + time row "Check-in opens · Oct 16, 1:45 p.m." + link "Arrived early? Message the kitchen" + early-start grant/offer row.
- window open: "Check-in is open. Follow the arrival instructions, then confirm below." (+ "Your booking still ends at {end}." once the start has passed).
- checked in: "You checked in at {time}. When you're finished, submit checkout below." (late: + " Your booking still ends at {end}.")
- ended, still checked in (late checkout open): chip "Your booked time ended" + `kciOverstayBanner` (unchanged).
- checkout submitted: "You checked out at {time}. You're all set." (no "Review due by").
- checked out & closed: "Visit complete. See your booking for the record."
- ended, no check-in: "This visit is over. No check-in was recorded."
- no-show / claim filed: existing `kciStatusNoShow` / `kciStatusClaimFiled`.
InSessionPanel: remove the kitchen-name h2; subtitle "Ends at {time}" (active/ending) / "Ended at {time}" (ended); remove `ClockCloseoutSummary` from the page; `kciIsLeaveEarly` only while `active`.

### 2.7 Manager inspection page — target
Unchanged structure. Changes: (1) claims at the bottom become one line each: "Damage claim · $X · {status} · See the claim on the booking page"; (2) `inspectCopy53` explainer moves under a "How this works ▸" details; (3) nothing else.

### 2.8 Reserved slot for storage (owner, Oct 14: storage is redesigned AFTER booking as its own product)

This spec does not design storage. It only makes sure the consolidated booking IA will not need restructuring when storage lands.

- **Booking page (both roles):** the "Add-ons" card becomes two fixed sub-blocks — **Storage** (0–n compact rows: `{name} · {start}–{end} · {price} · {chip}`) and **Equipment** (unchanged). A storage row is a plain row today; later it becomes a link to `/storage/:storageBookingId` ("Manage my storage") without moving anything else. No storage check-in/checkout, extension or expiry UI renders on the booking page; `PendingStorageExtensions`, `ExpiringStorageNotification`, `StorageCheckinDialog`/`StorageCheckoutDialog` stay where they are today (dashboard/manager panels) and are out of scope here. The Now card never carries storage attention rows; storage will have its own "Now".
- **Payment card:** keeps the existing "Storage" breakdown line (`bdStorageLine`) as one line; when storage gets separate charges, that line becomes "Storage · billed separately ↗". The breakdown builders (`@shared/booking-pricing-breakdown`) are untouched.
- **Cancellation card / chooser (chef):** today's `BookingCancellationChooser` lists storage items (`cpAddons`). Keep the behaviour, but the item list is rendered by one `AddonCancellationList` block so the storage lines can be removed in one place when storage owns its own cancellation terms.
- **Chef dashboard / navigation (`client/src/components/chef/ChefSidebar.tsx`, `ChefDashboardLayout.tsx` `activeView` union, `/dashboard?view=…`):** reserve the view id `storage` next to `bookings` ("My storage") — not rendered until the storage product ships (no empty menu entry). The breadcrumb pattern used by `BookingDetailsPage` (`shellMyBookings` → `#id`) is reused as-is for storage.
- **Manager:** the bookings table keeps its storage chip; the booking page's Storage row is the only storage touchpoint there too. Manager-side "Pending storage check-ins/outs" panels stay on the dashboard.
- **Rule for WP-A:** build the Add-ons card with `StorageRows` and `EquipmentRows` as separate components with a `linkTo?: (storageBookingId) => string` prop left unset; add nothing storage-specific to `booking-now.ts`.

## 3. Settings consequence-preview pattern (exact en-CA copy)

### 3.1 The pattern — `client/src/components/manager/settings/SettingChangePreview.tsx`

One shared component rendered between a control and its Save/Confirm button, fed by pure props so every setting reads the same way:

```tsx
<SettingChangePreview
  whatChanges="…"                      // one plain sentence, chef-facing consequence
  appliesTo="now" | "new_bookings" | "scheduled"   // → "Applies now, including N upcoming bookings." etc.
  impact={{ upcoming: 3, inSession: 1, pending: 0 }}   // counts; renders "Affects 3 upcoming bookings — we'll tell those chefs."
  undo="…"                             // one sentence
  confirm={true | false}               // true → the save button opens a confirm dialog that repeats the four lines + a checkbox "I understand chefs will be told"
/>
```

Rendering (a muted `rounded-lg bg-muted/40 p-3` block, 4 short lines with 12–14 px type):
```
What changes for chefs   {whatChanges}
When                     {appliesTo line}
Right now                {impact line}
To undo                  {undo}
```
Impact counts come from the already-loaded manager bookings list (`queryKey ['managerBookings']` / `/api/manager/bookings`): `upcoming` = confirmed with start in the future for this kitchen; `inSession` = checked_in now; `pending` = status pending. No new server route; if the list is not loaded the line reads "Checking your upcoming bookings…" and the confirm button waits. "We'll tell those chefs" is only printed when the setting's server side actually sends a notice (self check-in does: `arrivalChangedSelfSubject`; the others do not yet — print "Chefs see the new time on their booking page." instead, so the copy never promises a notice that is not sent).

Confirm step = a small `Dialog` titled with the action verb, body = the same four lines, primary = the verb ("Turn on self check-in"), secondary = "Keep as is". Only settings marked **confirm** below use it; the rest save on click with the preview visible above the button.

### 3.2 Exact copy per setting

**A. Self check-in for a visit — `VisitCodePanel` dialog (per visit; confirm; reason stays required)**
- Title: "Let {chef} check in without staff?"
- What changes for chefs: "{chef} confirms arrival in Local Cooks without a code. They'll need your access instructions to get in."
- When: "Applies now, to this visit only." (checkbox variant: "to all {n} visits of this booking")
- Right now: "We'll email {chef} the updated arrival details." 
- To undo: "Switch back to staffed any time before they arrive — a new code is issued."
- Reason field label: "Why? (saved with the change, not shown to the chef)"
- Confirm button: "Turn on self check-in" · secondary "Keep the code".
- Inverse dialog ("Switch back to staffed check-in?"): What changes: "{chef} will need a 6-digit code from your staff to check in." · When: "Applies now; the new code shows here." · Right now: "We'll email {chef} the updated arrival details." · To undo: "You can turn self check-in on again." · button "Switch to staffed".

**B. Approve extensions automatically — `SessionExtensionSettingsCard` (confirm when turning ON; plain save when turning OFF)**
- Turning on — What changes for chefs: "When the time after their booking is free, chefs at {kitchen} get extra time instantly and their saved card is charged at your hourly rate. You won't be asked."
- When: "Applies now, including a session that's in progress."
- Right now: "Affects {inSession, plural, =0 {no sessions in progress} one {1 session in progress} other {# sessions in progress}} and {upcoming} upcoming bookings. Chefs see this on their booking page."
- To undo: "Turn it off here. Requests go back to one-tap approval."
- Confirm button: "Approve automatically" · secondary "Keep approving by hand".
- Turning off (no confirm): preview only — "Chefs' requests for more time come to you to approve, decline or give free. Applies now. Nothing already approved changes."

**C. Cancellation policy — `CancellationPolicyEditor` (confirm)**
- What changes for chefs: "New bookings show: {cpSummary with the new values}. Chefs accept it at checkout."
- When: "Applies to new bookings only. Existing bookings keep the terms the chef accepted."
- Right now: "Your {upcoming} upcoming bookings keep their current terms."
- To undo: "Change it back here. Bookings made in between keep the policy they were booked under."
- Confirm button: "Save cancellation policy" · secondary "Keep current policy". (Admin override variant keeps its reason field and uses "Save kitchen override".)

**D. Check-in window / no-show grace — `BookingRulesSettings` (confirm; the existing scope dialog becomes the confirm step)**
- What changes for chefs: "Check-in opens {minutes} minutes before the booked start instead of {current}." (grace: "After the booked start, chefs have {minutes} minutes before a no-show can be reported instead of {current}.")
- When: "Applies now, to every booking at {kitchen | this location}, including upcoming ones."
- Right now: "Affects {upcoming} upcoming bookings. Chefs see the new time on their booking and visit pages." (if `upcoming` = 0: "No upcoming bookings are affected.")
- To undo: "Set it back here; the change applies the same way."
- The existing scope radios ("Save for this kitchen" / "Save for all {count} kitchens") stay inside the confirm dialog; `policySaveExistingBookings` is replaced by the lines above.

**E. Arrival / departure instructions and tasks — `KitchenCheckinCheckoutEditor` (no confirm)**
- Preview block only: What changes: "Chefs see the new instructions and tasks on their visit page." · When: "Applies now, including upcoming bookings." · Right now: "{upcoming} upcoming bookings. Their page shows 'Updated by the kitchen since you booked'." · To undo: "Edit again; the saved copy on past visits is kept as evidence."

**F. Manager no-check-in alert minutes — admin `LifecycleSettings` (no confirm)**
- Help text becomes the preview: What changes: "Kitchens get 'hasn't checked in yet' {minutes} minutes after the booked start." · When: "Applies to alerts not yet scheduled." · Right now: "Alerts already scheduled keep their time." · To undo: "Set it back; same rule."

**G. Extra time (all kitchens) kill switch — `SessionExtensionsPlatformSwitch` (confirm; reason stays required)**
- Pausing — What changes: "Chefs can't ask for more time, kitchens can't offer it or charge for extra time. Everyone sees 'Extra time is paused on Local Cooks right now.'" · When: "Applies now." · Right now: "{openRequests} open requests and offers stay as they are; payments in progress finish." · To undo: "Turn it back on here." · button "Pause extra time".

**H. `damageClaimsReviewFirst` (future admin UI)** — must use the same block: What changes: "Claims under {amount} go straight to the chef without a Local Cooks review." · When: "Applies to claims filed from now on." · Right now: "{inReview} claims in review are unaffected." · To undo: "Turn review-first back on." · confirm.

Translation: every string above is added to `manager.json` (prefix `scp` = setting consequence preview) in en-CA, fr-CA and uk via `.phase0-harness/addkeys.cjs`; ICU plurals for the counts.

## 4. Notification consolidation list

Each row: what fires today (producer file) → what should fire → how. "In-app" = `booking_lifecycle_events` outbox / notification row; "email" = the same event's email channel (one tracking id, two channels — that pair is NOT a duplicate).

| # | Today | Target | How (file) |
|---|---|---|---|
| N1 | **Three "You've been paid $X · KB-…" notices** on one closeout (booking $27.32, extension $27.32, extra-time $13.28): `recordReleasedPayout` queues one `payout_released` per `payment_transactions` row (`server/services/kitchen-payout-service.ts` → `kitchen-payout-notice.ts`). | **One** notice per booking release: title "You've been paid $67.92 · KB-6WAXEF"; body "You've been paid $67.92 for Raunak's booking on Oct 14. It's on its way to your bank."; email facts: "Booking $27.32 · Extra time (1 hr) $27.32 · Extra-time charge $13.28 · Your payout $67.92" (Local Cooks fee / card processing lines summed once). | `releaseKitchenPayout` already releases the parent then the extension rows; collect the released rows for the booking in the same tick and queue ONE event with `metadata.lines[]`; `kitchenPayoutNotice` renders lines. Rows released in a later tick (parent sent earlier) fall back to a single-line notice for that row only. |
| N2 | On chef checkout (after_closeout): `managerCheckoutPayoutTitle` "{chef} checked out — finish the inspection to get paid" AND (C4 path) `managerVisitNotice('review')` "{chef} checked out" can both be reachable in `booking-lifecycle-delivery.ts` depending on payout snapshot. | Exactly one `checkout_requested` manager notice: the payout variant when `after_closeout` & scheduled, else the plain one. | Guard in `queueBookingLifecycleEvent` (`booking-lifecycle-delivery.ts`): branch is exclusive (verify with a test for both snapshots). |
| N3 | Chef after checkout gets: toast (client) + service-end/closeout notice ("Your visit is complete…", `clock-closeout.ts` roleText) + "The kitchen checked the space. All good." (`clockManagerInspected`, on inspection) + "visit complete" email with the final-invoice link (`closeout-notice-email.ts`). | In-app: ONE "Visit complete · {kitchen}" at closeout (auto-close or inspection), carrying the inspection outcome in its body when known ("{kitchen} checked the space — all good." / "Your final invoice is ready."). Email: the one existing closeout email. No separate inspection notice to the chef unless an issue/claim was filed. | `persistBookingCloseout` / `recordKitchenInspection`: queue `visit_closed` once (idempotent on booking+visit), skip `clockManagerInspected` chef notice when it would arrive within the same closeout. |
| N4 | Chef reminders "Before you leave the kitchen" (departure, −30 min) and `sessionEndingSubject` "Your booked time ends soon" (−15 min) with near-identical content (log Oct 14 "Observed"). | Keep ONE: the −15 min "Your booked time ends at {end} · {kitchen}" with the departure checklist count. Drop the −30 min departure reminder (or keep it only when required departure tasks exist AND the booking is ≥ 3 h). | `advance-reminders.ts` reminder kinds; update `email.json` subject to include the end time. |
| N5 | Manager on approving a request gets "Booking confirmed" (lifecycle) AND "Payment confirmed — {chef}'s payment of $30.50 went through. Your payout is sent after the visit." (`webhooks.ts` → `notifyPaymentReceived`). | One manager notice on confirmation: "Booking confirmed · {chef} · {date}" whose body carries the payout line ("Paid after the visit — as soon as you finish the inspection, or automatically 24 hours after it ends."). "Payment confirmed" only when capture happens WITHOUT a confirmation notice (legacy auto-capture path). | `webhooks.ts`: skip `notifyPaymentReceived` for the manager when the capture was triggered by `decideAuthorizedBooking` (metadata flag), keep for chef receipts. |
| N6 | Extension instant-mode / approved-with-charge: `sxInstantManagerTitle` / `sxOfferAcceptedManagerTitle` AND possibly `notifyPaymentReceived` "Payment confirmed" for the extension PaymentIntent (same webhook path, `metadata.type = session_extension`). | Extension notices only; never "Payment confirmed" for extension rows. | `webhooks.ts`: early-return in `notifyPaymentReceived` when `metadata.type === 'session_extension'` (verify; add a test). |
| N7 | Chef cancellation: `cancelled` notice + `refund_issued` notice (+ email each). | One chef notice: "Your booking is cancelled · refund of $29.07 on its way (5–10 business days)" or "… no refund applies". Keep `refund_issued` only when the refund happens later than the cancellation (fee pending path `cpFeeChecking`). | `booking-cancellation-refund.ts` / `cancellation-notice.ts`: merge when both are queued in the same transaction. |
| N8 | Damage claim filed: kitchen gets confirmation; admins get email + in-app (per amendment). Chef nothing. | Keep. Make the kitchen confirmation in-app only (no email) — they just pressed the button. | `damage-claims-v2.ts` notice kinds. |
| N9 | Chef's own request produced the manager copy ("New kitchen booking request…") — fixed Oct 14 via `roleText`. | Keep the fix; add a regression test that the chef's `requested` notice title is "Request sent to {kitchen}". | `booking-lifecycle-delivery.test.ts`. |
| N10 | Reminder titles "Kitchen booking #154", raw "Visit: 2026-10-20 11:00–…" (fixed by DeepSeek batch). | Keep; titles use "{kitchen} · {reference}". | — (verify live). |
| N11 | Running-late (manager in-app + email) and the no-check-in alert (deferred to the stated ETA). | Keep as is (already coordinated). | — |
| N12 | Inspection finished: manager toast + done state + payout released notice (N1) — three money confirmations within a minute. | Toast stays (immediate feedback), done state stays (persistent), in-app notice = N1 only. No separate "Inspection finished" notice to the manager. | `recordKitchenInspection`: do not queue a manager notice for their own action. |

Client-side (`client/src/components/*NotificationCenter*`): no change required beyond the titles above.

## 5. Implementation plan — work packages, acceptance criteria, tests

Three packages, file-disjoint, runnable in parallel by three agents on the same tree. Shared constraints for all three:
- Branch `development`, local only, no commits/deploys/migrations/network. Re-read every shared file immediately before editing (other builds are active).
- **Locale files are the one shared resource.** Each package writes its new keys to its own spec `.phase0-harness/<pkg>-keys.json` and applies them with `node .phase0-harness/addkeys.cjs <spec>` (append-only, re-reads at write time) as the LAST step; prefixes are reserved per package (A: `bn*` chef.json + `vr*` booking.json; B: `kv*` chef.json; C: `scp*` manager.json + `nc*` email.json). Never hand-edit a locale JSON. Also fix the `?`-for-apostrophe corruption only in the keys your package owns (A owns `dcV2*` since it renders them).
- Tests: `npx vitest run <paths>` for client; `npx vitest run -c vitest.config.server.ts <paths>` for server (the default config excludes `server/**`). Baselines: `.phase0-harness/head-server-fails.txt`, `.phase0-harness/wt4-client-fails.txt`. `npx tsc --noEmit` clean.
- Checkpoint file `.phase0-harness/consolidation-<pkg>-checkpoint.md` with before/after per item, files, tests, gaps.
- Sequencing note: the damage-claims build (Codex) is editing `server/services/kitchen-payout-service.ts`, `damage-claims-v2.ts`, `routes/manager.ts`, `DamageClaimCards.tsx`, `DamageClaimSheet.tsx`. **WP-A must not edit `DamageClaimCards.tsx`/`DamageClaimSheet.tsx`** (it composes them via props that already exist) and **WP-C's server half (N1, N2, N8, N12) starts only after `.phase0-harness/damage-claims-checkpoint.md` reports done.** WP-C's client half can start now.

### WP-A — Booking page "Now" consolidation (client; ~2 days, Sonnet/Opus-grade)

**Files (owned):** `client/src/pages/BookingDetailsPage.tsx`; `client/src/lib/booking-header-state.ts` (+ new `client/src/lib/booking-now.ts` for the per-state Now content selector and `client/src/lib/booked-duration.ts`); new `client/src/components/booking/BookingNowCard.tsx`, `BookingVisitRecord.tsx`, `BookingPaymentCard.tsx`, `BookingCancellationCard.tsx` (replaces `CancellationBookingCard.tsx`, which is deleted); edits to `SessionExtensionsCard.tsx` (`variant` prop), `BookingAttendancePanel.tsx` (no status text when `embedded`), `ClockCloseoutSummary.tsx` (unused by the page afterwards; keep for the inspection page), `KitchenPayoutStatus.tsx` (status-line only mode), `RunningLateCard.tsx` (`inline` trigger mode), `KitchenBookingChanges.tsx` (attention-row mode), `BookingFeedbackCard.tsx` (collapsed row), `ManagerDamageClaimEntry.tsx` (secondary-action mode with the 72 h gate using `claimFilingWindow` + `recordedDepartureAt`); tests `BookingDetailsPage.header.test.tsx`, `BookingDetailsPage.pending.test.tsx`, `booking-header-state.test.ts`, new `booking-now.test.ts`, `booked-duration.test.ts`, `BookingNowCard.test.tsx`, `BookingVisitRecord.test.tsx`; locale spec `.phase0-harness/consolidation-a-keys.json`.
**Not owned:** `VisitCodePanel.tsx` (WP-C), `DamageClaim*.tsx` (Codex), anything under `server/`.

**Steps**
1. `booked-duration.ts`: `formatBookedDuration(minutes, locale)` → "20 min" / "1 hr" / "1 hr 30 min" / "2 hrs" (fr-CA "1 h 30 min", uk "1 год 30 хв" via keys). Replace `bdHours` usage in the header and When & where.
2. `booking-now.ts`: pure `bookingNowContent({ phase, role, booking, ...})` → `{ pill, sentence, primary, secondary: Action[], attention: Row[], body: 'preparation' | 'code' | null }` implementing §2.2/§2.3 exactly (copy keys listed there; reuse existing `bdh*` keys where unchanged). Unit-test every phase × role (26 cases) for: one primary max, sentence non-empty, no kitchen-only words on chef ("inspection", "payout") and no chef-only on manager ("Open your visit").
3. `BookingNowCard.tsx`: header + pill/sentence + attention rows + body + secondary row; receives the rows as children slots so the page composes `SessionExtensionsCard variant="now"`, `KitchenBookingChanges variant="now"`, `BookingDamageClaims` (chef attention only while payable; manager only `awaiting_kitchen`), `VisitCodePanel embedded collapsed={!withinLead}`, `BookingPreparation collapsed`.
4. `BookingVisitRecord.tsx`: `<details>` with the timeline (one line per visit from `visits` + visit-code `consumedMethod` + assistance), `SessionExtensionsCard variant="record"`, closed claim lines (from the same `/bookings/:id/damage-claims` query, status in a closed set), `visitEvidence`, fix history, manager "Fix the visit record" link. Shown when `visitStarted`.
5. `BookingPaymentCard.tsx`: one headline, one `paymentStatusLine` (precedence in §1.1), ⓘ popover, collapsed breakdown, actions. Delete the standalone `paymentMessage` rendering when `KitchenPayoutStatus` is present.
6. `BookingCancellationCard.tsx` (chef sidebar): one sentence + "Cancel or change" link; uses the existing `/bookings/:id/cancellation-quote` query and `cpDeadline*`/`cpHold`/`cancelCopy07` keys.
7. Remove from the page: `CheckinPolicyTimesCard`, `ClockCloseoutSummary`, `ManagerInSessionBadge`, in-session `BookingPreparation`, the "Open your visit" outline button, the When & where card (fold "Add to calendar" into secondary/⋯; chef "Where" block under the person card; non-contiguous slots into the header when line).
7b. Add-ons card → `StorageRows` + `EquipmentRows` per §2.8 (compact storage rows, `linkTo` prop unset, no storage workflow). Reserve `activeView: 'storage'` in the chef shell union without rendering a menu entry.
8. Copy fixes: `bdVisitCompleteReview` → chef-safe sentences (§1.1); `sxbChargeChef` without `{billed}`; `dcV2*` apostrophes.
9. Mobile: sticky bar unchanged; verify `scrollWidth` at 390 in a jsdom test with the longest state (manager in_session with a request banner).

**Acceptance (per state × role, assert in tests + the lead's live run at 1280/390):**
- Exactly one `[data-primary-action]` in the document (or none) and it matches §2.2/§2.3.
- Formatted check-in time appears at most once; booked end at most once; payout amount at most once; "Visit finished"/"Visit complete" at most once.
- Chef DOM never contains "inspection", "payout", "Fix the visit record"; manager DOM never contains "Open your visit".
- Header duration for 20 min / 90 min / 2 h reads "20 min" / "1 hr 30 min" / "2 hrs".
- Chef completed + reduced charge: text contains "They've asked for $15.00 for the extra time." and not "90 minutes of extra time".
- Manager completed within 72 h: "Report damage or extra cleaning" is in the secondary row; >72 h: absent. Chef with `submitted` claim: attention row with "Pay $" and "Dispute"; with `in_review`: nothing claim-related.
- Payment card (manager, after_closeout, before checkout): headline "Your payout $27.32" once + exactly one status line "Paid after the visit. Finish the inspection after {chef} checks out to get it sooner."
- No horizontal overflow at 390 px; all buttons `min-h-11`.
- Existing suites: `BookingDetailsPage.*`, `SessionExtensions.test.tsx`, `BookingAttendancePanel.test.tsx`, `KitchenPayoutStatus.test.tsx`, `RunningLateCard.test.tsx`, `BookingFeedbackCard.test.tsx` pass (updated where markup changed); client failures = baseline set only.

### WP-B — Chef visit page + manager inspection page (client; ~1 day)

**Files (owned):** `client/src/components/booking/KitchenCheckinTracker.tsx`, `InSessionPanel.tsx`, `CheckinPolicyTimesCard.tsx`, `SessionExtensionRequest.tsx` (only if copy needs it), `client/src/pages/KitchenVisitPage.tsx`, `client/src/pages/ManagerInspectionPage.tsx`; tests `KitchenVisitPage.test.tsx`, `InSessionPanel.test.tsx`, `CheckinPolicyTimesCard.test.tsx`, `ManagerInspectionPage.test.tsx`; locale spec `.phase0-harness/consolidation-b-keys.json` (`kv*`, `insp*`).
**Not owned:** `BookingDetailsPage.tsx`, `ClockCloseoutSummary.tsx` (WP-A may edit; B only stops importing it in the tracker), `DamageClaim*`.

**Steps**
1. Tracker status block per §2.6: single sentence builder `visitStatusSentence(...)` (pure, tested) carrying the time; remove `arrivedAt` line and `Check-in time` row when covered; remove "Review due by"; keep `Check-in opens` before the window and `Checkout time` after.
2. Remove `<ClockCloseoutSummary …/>` from the tracker; derive ended outcomes in the sentence builder from `clockVisit.inspection.outcome` only for chef-safe wording (never the deadline).
3. `InSessionPanel`: remove the h2; subtitle by phase ("Ends at {time}" / "Ended at {time}"); one checkout button in `ending`/`ended`; "Leave early" only in `active`.
4. Header: zone name appended to the when line; drop the "Times are shown in…" sentence.
5. `WhatHappensNextInfo` bullets → one chef-safe bullet.
6. `ManagerInspectionPage`: claims list → one line per claim with a link to `/manager/booking/:id`; `inspectCopy53` under a details toggle.

**Acceptance**
- Visit page, ended-while-checked-in fixture (`.phase0-harness/visit-stale-state.cjs` style): DOM contains "Your booked time ended" once, does NOT contain "In session" or "Inspection due"; contains "Check out now" exactly once.
- Checked-in fixture: "9:28 a.m." appears exactly once.
- Checkout-submitted fixture: no "Review due by"; sentence "You checked out at {time}. You're all set."
- Inspection page: unchanged tests pass; claim lines link to the booking page; no `DamageClaimCard` article rendered.
- `KitchenVisitPage.test.tsx` (31+), `InSessionPanel.test.tsx`, `ManagerInspectionPage.test.tsx` pass; tsc clean.

### WP-C — Settings consequence preview (client) + notification consolidation (server) (~2 days; can be split client/server between two agents)

**Files (owned, client):** new `client/src/components/manager/settings/SettingChangePreview.tsx` (+test) and `client/src/lib/setting-impact.ts` (counts from the bookings list, +test); `CancellationPolicyEditor.tsx`, `SessionExtensionSettingsCard.tsx` (both cards incl. the platform switch), `BookingRulesSettings.tsx`, `KitchenCheckinCheckoutEditor.tsx` (preview block only), `client/src/components/manager/bookings/VisitCodePanel.tsx` (dialog copy + preview; also the `collapsed` prop WP-A consumes — define it as `collapsed?: boolean` rendering the one-line summary with a "Show" button), `client/src/components/admin/LifecycleSettings.tsx` (help → preview line); tests for each; locale spec `.phase0-harness/consolidation-c-keys.json` (`scp*` in manager.json; `visitCode*` edits).
**Files (owned, server — after damage claims lands):** `server/services/kitchen-payout-service.ts` (N1 batching), `kitchen-payout-notice.ts` (lines), `booking-lifecycle-delivery.ts` (N2, N5 guard), `server/routes/webhooks.ts` (N5/N6 `notifyPaymentReceived` guards), `advance-reminders.ts` (N4), `clock-closeout.ts` (N3, N12), `booking-cancellation-refund.ts`/`cancellation-notice.ts` (N7), `damage-claims-v2.ts` (N8, kitchen confirmation in-app only); tests alongside each; `email.json` keys (`nc*`).
**Not owned:** `BookingDetailsPage.tsx`, booking components other than `VisitCodePanel.tsx`.

**Steps (client)**
1. `SettingChangePreview` per §3.1 (props, four lines, optional confirm dialog with the verb buttons).
2. `setting-impact.ts`: `settingImpact(bookings, kitchenId, now)` → `{ upcoming, inSession, pending }` from `/api/manager/bookings` rows (status, start instant via `bookingStartDateKey` + `createBookingDateTime`, `checkinStatus`).
3. Wire A–G from §3.2 with the exact copy; confirm only where marked.
4. `VisitCodePanel`: `collapsed` mode + dialog copy.

**Steps (server)** — N1, N2, N3, N4, N5, N6, N7, N8, N12 from §4, each with a unit test on the queued events (count + title). Money code paths: no change to amounts, transfers, or decision order; notice batching happens after `recordReleasedPayout` commits, keyed on booking id + release tick, idempotent (a replay must not re-notify).

**Acceptance**
- Each setting in §3.2 renders the four preview lines before its save button; the confirm dialog appears only for A, B(on), C, D, G; saving with the dialog cancelled changes nothing (test).
- Impact line reads "Affects 3 upcoming bookings…" for a fixture with 3 future confirmed bookings and "No upcoming bookings are affected." for none; "Checking your upcoming bookings…" while loading disables Save.
- Self check-in dialog: contains "They'll need your access instructions", "We'll email {chef}", "Switch back to staffed".
- Server: closeout of a booking with parent + 2 extension rows queues exactly ONE `payout_released` event whose title contains the summed amount and whose facts list three lines; a replay queues zero. Manager gets exactly one `checkout_requested` notice for both payout snapshots. Chef gets one "Visit complete" at closeout and none for the manager's own inspection notice. Extension PaymentIntents never trigger "Payment confirmed". Chef cancellation with immediate refund queues one chef notice.
- Full server suite: no new failing files vs baseline; tsc clean.

### Order and review
1. WP-A, WP-B and WP-C(client) start together. WP-C(server) starts when the damage-claims checkpoint is done.
2. The lead reviews each checkpoint, then runs the live walkthrough on dev (every state × role × 1280/390, screenshots into `.phase0-harness/consolidation-screens/`) against §0's seven checks before the pre-authorised deploy.
3. Follow-ups deliberately left out (not invented here): a storage redesign (separate map), per-recipient notification i18n (English-only in-app notices; `map-notification-i18n.md`), PDFs itemising extensions, a location-level self check-in default.

## 6. Visual quality layer (owner, Oct 14: "intuitive, but should feel premium like Airbnb, Skedda, Nexudus — it feels raw")
The §2 wireframes define STRUCTURE only. Every work package must also meet this visual bar, built from components that already exist in the repo (no new design system):
- **Hero with context:** the chef view's Now card carries the kitchen's cover photo (`ui/smart-image`, the same source as `kitchen/KitchenGridCard`) as a rounded image beside or above the title (a 16:9 thumbnail on desktop, a full-bleed top image with the card overlapping it on 390 px, like Airbnb's trip page). The manager view uses the chef's `ui/avatar` (initials fallback) at 48 px. "Where" gets a small static `ui/location-map` preview in the person/kitchen card (lazy-loaded, with a skeleton).
- **Typography & spacing:** one scale. Title 22/28 semibold; when-line 15/22 medium; sentence 15/22 regular; secondary 13/18 muted. 24 px card padding on desktop and 16 px on mobile, 16–20 px between cards, max content width ~1080 px. Tabular numerals for money and times.
- **Surfaces:** cards use the existing `ui/card` with a soft border and a subtle shadow on hover-capable devices only. Group related facts with the `reui/frame`. Attention boxes use the `reui/alert` tone (warm amber for "needs your answer", neutral for info), never raw coloured divs.
- **Status pill:** one consistent `ui/badge` variant set (pending amber, confirmed/today blue, in session green, checkout purple, completed neutral, cancelled grey), with a small leading dot. The same component is used in lists and the header.
- **Timeline:** the Visit record and booking history render as a vertical timeline (dot + line, time on the right, muted) instead of plain lists, matching Airbnb/Nexudus activity feeds.
- **Buttons:** at most one filled brand button per screen; the rest are `variant="outline"` or ghost text links with an underline on hover; 44 px minimum height; icons (lucide) at 16 px left of the label only where they aid scanning (Message, Calendar, Download).
- **Motion:** 150–200 ms ease-out for expand/collapse (`ui/collapsible`/`accordion`), a fade/slide-in for attention boxes appearing, `ui/skeleton` placeholders instead of spinners while loading; respect `prefers-reduced-motion`.
- **Mobile:** a sticky bottom bar with a frosted background (backdrop-blur) holding [Message] [Primary]; sheets (`ui/sheet`/`ui/drawer`) for all multi-field actions (extra time, cancel, claims, fix record) instead of centered dialogs.
- **Empty and loading states:** never blank; one friendly line + an icon.
- **Reference check:** before finalizing, the implementing agent compares its screenshots against public pages of Airbnb (trip/reservation details), Skedda (booking details), and Nexudus (member portal bookings), and notes in its checkpoint 3 concrete ways it matched their finish (spacing rhythm, hierarchy, restraint).
- **Acceptance:** desktop 1280 and mobile 390 screenshots of every state in the §2 matrices go to the lead; the lead shows the owner before deploying.

## 7. Restraint budget (owner, Oct 14: "must not look congested or cluttered — premium, intentional, for the target user")
Hard limits, checked in every screenshot before the lead shows the owner:
- **Above the fold (first viewport) per state:** the who/where title, the when-line, one status pill + ONE sentence, at most ONE attention box, at most ONE filled button. Nothing else competes there. On 390 px the first viewport shows the title, when, status sentence and (if any) the attention box; the primary lives in the sticky bar.
- **Max visible text links in a row: 3.** The rest go into the "⋯ More" menu.
- **Sentences:** ≤ 20 words for the status sentence; ≤ 2 lines for an attention box's body on desktop. No explanatory paragraphs on the page; explanations live behind an ⓘ popover or in the sheet that opens on action.
- **Show nothing that is zero/empty/irrelevant:** no "No note added", "No tasks to check", "0 photos", "Not applicable", empty sections, $0.00 fee lines, or labels for absent data. If a card would only hold an empty state, the card is not rendered.
- **Progressive disclosure by default:** the Visit record, payment breakdown, booking history (beyond 3), policy details, and arrival instructions (beyond 2 lines) are collapsed. Expanding never shifts the primary action off-screen.
- **One accent colour** (brand red) used only for the single primary action; status colours only in the pill; attention boxes use the soft amber surface; everything else neutral greys. No more than 3 type sizes on a card.
- **Whitespace over dividers:** separate groups with spacing (16–24 px), not borders; at most one divider per card.
- **Sidebar max 3 cards visible** (Payment, then Cancellation OR Payout status, then Help); booking history moves below the main column on desktop if the sidebar would exceed the viewport.
- **Copy voice:** speak to a busy food-business owner or kitchen manager: concrete, short, first-person for their own actions, no platform jargon (no "record", "evidence", "workflow", "session state").
- **Self-check in the checkpoint:** for every state screenshot, list the element count above the fold and confirm each limit above; flag any violation with the reason it was unavoidable.
