# Multi-day ranges, manager invitations and "one more hour": design

Read-only design, 2026-10-13 (Oct14 owner decisions). No source, database, Stripe, Vercel or Inngest was touched. Nothing here authorizes a migration or a deploy. File:line refers to the current working tree, which other builders are changing: re-read before implementing. "Documented" = a first-party page says it (fetched Oct13). "Inferred" = my design lesson. "Not verified" = could not be established.

## 0. Decisions in one screen

1. **Multi-day v1 = N consecutive operating days, each a full operating day at the daily rate.** It is not continuous possession. The kitchen is closed between days. (Owner's rule "refuse if any day already has an hourly booking" is exactly the existing full-day rule applied per day.)
2. **Data model: ONE booking, N daily visits.** One approval, one payment authorization and capture, one policy snapshot, one reference code. Each day is a row in `kitchen_booking_visits` with its own date. Not N linked bookings.
3. **Check-in/check-out is per day, not once per range** (section B6). Each day is its own visit with its own arrival window, departure, inspection, visit code, closeout clock and claim. Taps stay optional evidence, so it adds little friction. Payout waits for the last day.
4. **All or nothing** everywhere: one hold group, one manager decision, one atomic fulfillment. A declined or failed range never leaves a partial booking.
5. **Cancellation money is computed per day** (each day's own cutoff and its allocated share of the payment). Whole-booking cancel only in v1; single-day cancel is a Local Cooks support action.
6. **Settings:** `maxConsecutiveDays` (1 = off, the default) and `minConsecutiveDays` (applies only when a range of 2+ days is picked). Location default plus optional kitchen override, same pattern as hours-per-day.
7. **Invitations:** manager offers a discount on the kitchen price only to one approved customer for specific dates; the customer pays through normal checkout at that price; the invitation is the manager's pre-approval, so the booking confirms on payment. The payload is a list of days from day one, so it carries ranges when multi-day lands.
8. **Extension: defer the paid self-service "add an hour"** until after clock closeout, the cancellation engine, invitations and multi-day. Ship only a no-money "Need more time? Ask the manager" entry that clearly extends nothing. Exact rules for the later version are in section D.
9. **Order:** invitations first (single visit, lowest risk), then multi-day, then extension (section E).

## A. Current-state facts

**A1. Daily means one operating day.**
- A full-day request must contain every operating slot: `shared/operating-hours.ts:141-143`. It is refused if the operating date already has any non-cancelled booking: `server/domains/bookings/booking.service.ts:512-516`. Overnight tails of the previous day are caught by the overlap check at `:518-523`.
- Daily price is one flat `dailyRate`: `shared/kitchen-booking-rate.ts:33-42`; checkout `server/routes/bookings.ts:3166`. A daily booking bypasses the hours-per-day cap: `bookings.ts:3108`.
- The operating window can cross midnight; the operating date is the date the window opens (`operating-hours.ts:110`, `:89-99`). Maximum window is 23 h (`isValidOperatingWindow`, `:178-186`). Adjacent-day windows may not overlap: `shared/operating-schedule.ts:17-36`.

**A2. Hourly and daily on one calendar.**
- A kitchen can have both rates: `shared/schema.ts:493-494`; `hasKitchenRate` `kitchen-booking-rate.ts:29`. The customer picks a mode per booking: `bookings.ts:3056-3066`.
- Availability is hourly-slot occupancy. A day is bookable as a full day only if every slot is free. The calendar's month map is a plain `Record<date, boolean>` meaning "at least one slot is free": `booking.service.ts:849-853`, route `server/routes/kitchens.ts:304-324`. It carries **no reason** and is the wrong test for a full day.
- Client: `KitchenBookingFlow.tsx:975-980` (`isDayAvailable`), single-date `UICalendar` `:1355-1368`. `react-day-picker` is `^8.10.1` (`package.json:163`), which supports range mode.

**A3. Hold and lock model.**
- Holds are rows in `kitchen_checkout_holds` (`schema.ts:527-537`): one `operating_date`, one slot list, `stripe_session_id` unique, 37 min (`kitchen-checkout-holds.ts:7`) against a 32-min Checkout expiry (`stripe-checkout-service.ts:341`).
- Every writer takes a **kitchen-wide advisory lock first** (`holds.ts:37`), then the day lock (`:38`). So all writers for one kitchen already serialize. Locking N days needs no deadlock ordering.
- Reserve `:81-110`; fulfill `:123-142` (hold must match session, date, window, slots); conflict scan `:59-79` loads all non-cancelled bookings and expands `occupiedIntervals(booking)`, which is **single-date**.

**A4. Checkout and fulfillment.**
- Route `bookings.ts:3041-3330`. The booking is created later from Stripe session metadata (`stripe-checkout-service.ts:277-322`). Manual capture: `:355`. Metadata values are capped at 500 characters (`checkout-metadata.ts:34-39`).
- Fulfillment `booking-checkout-fulfillment.ts:16-99`: one transaction (`:35-90`); on a hold or inventory failure the authorization is cancelled or refunded (`:93-98`). Equipment rows take `startDate = endDate = bookingDate` (`:69-71`). Component allocations use largest remainder (`:81-85`).
- The manager decision reads session metadata and captures: `server/services/booking-payment-decision.ts:21-64`.

**A5. One date everywhere.**
- `kitchen_bookings.booking_date` plus `start_time`/`end_time` (`schema.ts:547-552`). `kitchen_booking_visits` has **no date** (`schema.ts:636-662`); rows exist only when a booking has 2+ blocks (`server/services/kitchen-booking-visits.ts:30`).
- Visit windows are derived from `booking.bookingDate`: `server/services/kitchen-visit-lifecycle.ts:73-77,108-110`. The closeout snapshot is built from one date (`shared/clock-closeout.ts:37-54`). Visits are **matched to evidence by start/end time only** (`clock-closeout.ts:68`; `shared/booking-attendance.ts:27`; `server/services/clock-closeout.ts:29`). Two days with the same hours would collide.
- `instructions_updated` "upcoming" logic assumes the first block: `server/services/kitchen-instructions-updated.ts:32-40`. `bookingDate` appears 287 times in 32 server files.
- Damage claims already attach to a visit (`kitchenBookingVisitId`, `kitchen-visit-lifecycle.ts:162-167`).
- `resolveCapturedKitchenRate` returns **one** daily rate as the kitchen subtotal for a daily booking (`kitchen-booking-rate.ts:83-86`). A 3-day booking would show one day's price on invoices and details: `bookings.ts:1817`, `manager.ts:4524`, `invoice-service.ts:126`.

**A6. Settings that exist.**
- Hours per request: `defaultDailyBookingLimit` at the location (`schema.ts:366`) with a nullable kitchen override (`:490`); `minimumBookingHours` kitchen-only (`:496`); notice `minimumBookingWindowHours` (`:367,489`); resolver `shared/kitchen-booking-policies.ts:18-24`.
- Manager routes: kitchen `manager.ts:3287-3331` (null = inherit), location apply-to-all `:3339-3374`. UI `KitchenWorkspaceControls.tsx:36-85` with "reset to location default".
- The customer-facing limit is `maxSlotsPerChef` (`kitchens.ts:136-140`). It caps one request, not a per-person daily total.
- **No maximum advance horizon exists** for kitchen bookings (`research-booking-model-gaps.md` A6, P0-3).
- Day-of-week closures: weekly schedule plus `kitchen_date_overrides` (closed or custom hours, `schema.ts:514-524`), checked at `booking.service.ts:453-485`.

**A7. Time zone.** Locations have a zone (`schema.ts:370`) but availability, DST and notice code hardcode `America/St_Johns` (`booking.service.ts:506,869`; `bookings.ts:3112`). A DST-ambiguous hour makes that whole day unavailable for self-service: `shared/booking-dst.ts:34-44`, used at `booking.service.ts:507-509`.

**A8. Access and the planned visit code.**
- Eligibility: `server/services/location-booking-eligibility.ts:7-13`, `chef.service.ts:94-148`. Access is per location (`schema.ts:790-796`).
- The visit code is **proposed, not built** (no `visit_code` symbol anywhere in source). Design: `visit-code-checkpoint-proposal.md` and `manager-visit-preparation.md:28-44`. It is visit-specific and kitchen-issued, keyed to one canonical arrival target, with staffed and self-service modes, 5 wrong attempts per target and revision, new confirmations only. The proposal notes ordinary bookings have no visit row (`:31`). Multi-day bookings will always have rows.
- Confirmed-booking changes are retired (`research-booking-model-gaps.md` A10). Tours have an offer/email pattern (`server/email.ts:7019-7147`, `tour-delivery-service.ts`). Manager-created external bookings exist (`routes/portal.ts`, research A12) but are not an invitation product.

## B. Multi-day design

### B1. Definition (v1)
Customer picks a start day and an end day. Every day in between is a full operating day, booked at the daily rate. Rules:
- Calendar-consecutive. A closed day (weekly closure, override, DST-ambiguous day) breaks the range; the picker explains it. "Skip closed days" is a later option.
- Needs `dailyRate > 0`. Hourly multi-day (same hours every day) is **not** v1: it brings partial-day conflicts and a different price model. The day-list payload keeps room for it.
- Day 1 obeys minimum notice; the last day must be inside the (future) maximum horizon. Adding that horizon (P0-3) is a prerequisite or companion; do not ship ranges without it.

### B2. One booking with N daily visits (recommended) versus N linked bookings

| Concern | One booking + N visits (recommended) | N linked bookings |
|---|---|---|
| Payment | Native: one `payment_intent_id`, one `payment_transactions` row, one capture. | Fulfillment dedupes by intent (`booking-checkout-fulfillment.ts:23`) and the cancellation context assumes one reservation source per booking (`booking-cancellation-refund.ts:20-54`). Splitting one authorization across N rows is new money code. |
| Approval | One decision, all or nothing for free. | Needs a wrapper to keep the N decisions atomic; partial states (2 confirmed, 1 pending) become possible. |
| Policy | One frozen snapshot. | N copies that can drift. |
| Closeout, inspection, claim, attendance | Already per visit (claims `kitchenBookingVisitId`; reducer iterates visits). | Works unchanged per booking. |
| Cancellation per day | Needs per-unit quoting (the cancellation engine is not built yet, so specify it now). Add-on scoped quoting with frozen allocations already exists (`booking-cancellation-refund.ts:56-116`). | Native per booking, but a whole-range cancel is N operations plus N refund shares of one fee. |
| Code churn | Moderate and contained: visit dates, date-aware visit keys, an occupancy expansion, price display. | Low in lifecycle code, high in payment and customer UX (N bookings in lists, N emails). |

I considered the second option seriously: it touches fewer lifecycle files. It is rejected because the hard, risky parts (one payment, atomic approval, refunds) are money paths, and the lifecycle parts are mechanical. The code already has "one booking and payment, several independent visit lifecycles" (`schema.ts:606-607`). Multi-day is that model with a date on each visit.

**Schema (draft, migration 0074, do not apply):**
- `kitchen_booking_visits.operating_date text not null` (backfill from the booking date), unique `(booking_id, operating_date, block_index)`.
- `kitchen_bookings.day_count int not null default 1`. `booking_date` stays the first operating day; the last day is derived from the visits. Single-day bookings are untouched.
- `kitchen_checkout_holds.group_id text null`: **one hold row per day sharing a group id**, with the Stripe session on the lead row. Every existing hold reader (`getActiveKitchenHolds`, month and slot availability) already iterates rows, so ranges just work. Reserve, bind, fulfill and release gain a group variant.
- Visit rows are created for every day when `day_count > 1`, at fulfillment, inside the same transaction.

**Required code changes, by risk:**
- Visit key must become date-aware: `SavedVisitClock.key` already exists and is opaque (`clock-closeout.ts:8`); change matching at `clock-closeout.ts:68`, `booking-attendance.ts:27`, `services/clock-closeout.ts:29`, and the lifecycle date math (`kitchen-visit-lifecycle.ts:73-77,108-110`) to key on date + start + end.
- Occupancy: conflict scans (`holds.ts:59-79`, `booking.service.ts:518-523, 575-600`) expand a `day_count > 1` booking from its visits.
- Pricing: add a `dayCount` input to `resolveCapturedKitchenRate` and its three callers (A5).
- Reminders and instruction notices must evaluate "upcoming" per day (`kitchen-instructions-updated.ts:32-40`, `advance-reminders.ts`).
- Stripe metadata carries `range_start`, `range_end`, `day_count`, `hold_id`; the day list lives on the hold rows (14 days is about 154 characters if ever inlined, under the 500 limit).
- Line items: "Kitchen, 3 full days" at N x daily; equipment is per session so N x rate (one equipment row spanning the dates); storage keeps its own dates and pricing, defaulting to the range but independently editable.

### B3. Availability for a range
One authoritative function `validateRangeAvailability(kitchenId, startDate, dayCount, mode)`, called by the picker endpoint, the hold reservation, fulfillment and invitations (never forked). For each day it reuses the existing single-day full-day checks (override, weekly window, slot grid, DST, bookings, holds) and returns a per-day status with a reason:
`bookable | closed | blackout/maintenance | hourly_booking | held_for_checkout | clock_change | notice | beyond_horizon | not_open_to_you`.
The whole range is valid only if every day is `bookable`. "Hourly booking" covers any partial-day hourly overlap. The reserve step re-runs the check inside the kitchen lock before inserting N hold rows. A day that turns unavailable between selection and payment fails the reserve (409 with the reason), or at fulfillment cancels the authorization (existing `:93-98`). **No partial range is ever created.** The per-day statuses also feed the picker (B5).

DST and overnight: day boundaries come from the location zone (replace the hardcoded zone for this path). A day containing an ambiguous hour is refused exactly as today, so a range crossing the November clock change shows that day as "clock change, contact the manager". Overnight windows are handled by the existing absolute-interval math (`operating-hours.ts:89-99`); consecutive windows never overlap (A1).

### B4. Manager settings
- Fields: `max_consecutive_booking_days` and `min_consecutive_booking_days` on `locations` (not null; defaults 1 and 2) and nullable overrides on `kitchens`. Add both to `resolveKitchenBookingPolicies`.
- Validation: max 1 to 14 (cap is an owner question); when max >= 2, 2 <= min <= max. Requires a positive daily rate; otherwise the control is disabled with "Add a daily rate to offer multi-day bookings".
- Semantics: max 1 = off (no change for existing kitchens). Min applies only to ranges ("Shortest multi-day booking"); a single full day always stays bookable.
- Routes: extend `manager.ts:3287-3331` and `:3339-3374` (the allow-lists and ranges at `:3298-3302`, `:3344-3348`).
- UI: a "Multi-day bookings" card in `BookingRulesSettings.tsx` with the same "Using {location} default · Customize for this kitchen" and reset control as hours-per-day. Copy: "Customers can book up to {n} consecutive full days in one request. Each day is a separate visit with its own arrival and departure."
- Serving it: add the effective values to the booking-rules response next to `maxSlotsPerChef` (`kitchens.ts:136-140`, `:689-720`).

### B5. Customer range picker
- In the existing "full day" mode, the calendar switches to `mode="range"` (`min`/`max` props from the effective settings). One calendar, no new step.
- Disabled days show the reason on focus/tap (tooltip on desktop, a line under the calendar on mobile): "Booked by the hour that day", "Closed", "Maintenance", "Clock change", "Too soon", "Beyond the booking window". Needs the per-day status endpoint (A2 gap). The existing `[date] → boolean` map is kept for hourly mode.
- If the range would be blocked by one day, the picker offers the longest bookable run from the start ("Oct 14 to 15 is available").
- Summary card under the calendar: dates in the kitchen's zone label, "3 days x $X", add-ons, tax, service fee if any, total, plus the cancellation line for the **first** day and a note that later days follow their own dates. States plainly: "Each day is a separate visit. The kitchen isn't reserved between days."
- Keyboard and screen-reader behaviour must announce start, end and disabled reasons; mobile uses one month at a time.

### B6. Check-in and check-out across days (the part Airbnb gets differently)

**Facts that shape it.** A stay at a dwelling or a car trip is continuous: one check-in, one check-out, the guest holds the asset overnight. A kitchen booking is a daytime shift: the kitchen closes each night, staff or other work may follow, food-safety clean-down happens daily, and overnight storage is a separate paid product (`research-booking-model-gaps.md` A8). Inventory is also not continuous: the booking blocks each operating window only.

**What peers do (honest picture).** The nearest products are repeat bookings. Skedda check-in works per booking and "for repeat bookings works analogously to the single booking case", with windows relative to each scheduled start; multi-day check-in is **not documented** ([check-in](https://support.skedda.com/en/articles/5242690-check-in)). Skedda locks in cancellation per occurrence ([lock-in](https://support.skedda.com/en/articles/105751-lock-in-cancellation-end-early-policy)). The Food Corridor documents a personal PIN sign-in/out and daily/weekly/monthly repeats, but not whether sign-in is per shift ([sign-in](https://help.thefoodcorridor.com/en/articles/1414030-how-do-i-digitally-sign-in-out-at-my-kitchen)). Peerspace, Giggster and Splacer publish no multi-day check-in rule I could verify; Peerspace mentions only cleaning "on consecutive days of a multi-day booking" ([add-ons](https://support.peerspace.com/en/articles/10119383-what-types-of-add-ons-can-i-charge-for)). Public municipal kitchen forms use a pre- and post-rental checklist per rental (weak, inferred). Conclusion: **no major marketplace documents a "range of daytime shifts with one arrival and one departure" product.** The continuous model comes from lodging and vehicles.

**Options compared.**

| | A. Per-day visit (recommended) | B. One arrival, one departure | C. Hybrid |
|---|---|---|---|
| Fit with daily kitchen reality (clean-down, closed nights) | Best | Poor | Medium |
| Evidence and claims | Condition recorded each morning and evening | One inspection after the range; issues from day 1 surface late | Per-day light, final full |
| Friction | 2 taps/day (optional, see below) | Lowest | Low |
| Reuse of built system | Full: visits, closeout, claims, code, reminders | Needs a "booking spans days" exception everywhere | Two code paths |
| Visit code (planned) | One target per day | One long-lived code, weaker security | Mixed |
Fairness note against my own recommendation: blame between customers is **not** a reason for per-day inspection (one customer holds every day). The real reasons are food safety and daily clean-down, early detection by the manager, fit with the existing per-visit machinery, and bounded closeout clocks.

**Rules (A).**
1. Each day is a visit with its own arrival window (opens the configured minutes before that day's start), scheduled end, grace, departure, inspection and claim. Saved instants per day live in the closeout snapshot; the reducer keys visits by date.
2. Taps stay optional evidence, exactly as the clock-closeout design: a missed day-2 tap never blocks, never cancels later days, and is "attendance unknown". Closeout is clock-driven per day.
3. Days are **independent**. Day 2 arrival does not require day 1 inspection to be cleared (that would let a slow manager block a customer). Day 1 departure is not required to open day 2.
4. Instructions and customer tasks are the kitchen's live ones each day (no per-booking lock, per the Oct13 decision). Required tasks apply every day by default. Lighter intermediate days is an owner question.
5. One customer-facing "Today's visit" card (Day 2 of 3) with that day's times, instructions and a single arrival/departure action; the booking page lists all days with status. The manager Today board shows "Day 2 of 3" per customer with that day's code and inspection.
6. Inspection per day uses the existing clock rule (auto-closes 24 h after the later of scheduled end and departure as "no inspection recorded"). The manager can inspect or file a claim for any day; a claim holds payout only for its booking.
7. **Payout and the final booking status wait for the last day's closeout** (policy timer S = "last end for a series", `local-cooks-booking-policy.md:132`).
8. Between days nothing is promised. Customer copy: "Your booking covers each day's operating hours. The kitchen isn't reserved to you overnight. Use storage for anything you need kept." Food left behind follows the kitchen's departure instructions and house rules.

**Visit code interplay (planned, not built).**
- The code is keyed to one canonical target (`visit-code-checkpoint-proposal.md:31`). For a multi-day booking that target is the **day's visit row**; the booking always has rows, so there is no ambiguity.
- Staffed: staff issue the day's code. Self-service: the manager can switch on self check-in for the whole booking in one action, stored as per-visit modes, each revocable.
- Five wrong attempts and rotation apply per day target. A code from day 1 never authorizes day 2 (derive the keyed code from target + revision). The door or lock credential stays a separate system.
- Cancellation, closure or reassignment revokes all remaining days' challenges (the proposal already revokes on those events).
- **Interface requirement for the in-flight and next builders (cheap now, costly later):** the code checkpoint must resolve its target as "visit row when one exists, else the booking"; the closeout and attendance reducers must key visits by an opaque key rather than start/end; new code must not read `bookingDate` as "the" date.
- **Needs the parent's/owner's confirmation:** one code per day (what I recommend, and what "visit-specific" implies) versus one code valid for the whole range (less handover friction, weaker). See F4.

### B7. Cancellation, refunds and payment
- One authorization and one capture at manager confirmation, as today. The authorization amount is the whole range, so very high totals raise decline risk; show the full total before payment.
- **Per-day tiers (recommended).** Each day has its own cutoff from its own start. Each day gets an allocated share of the payment (subtotal, tax, service fee and the actual Stripe fee F by largest remainder, the same method as `capturedComponentAllocations`). Refund per day = round-half-up(day pool x tier %), where day pool = day's share of (T minus F), per the policy arithmetic (`local-cooks-booking-policy.md:120`).
- Worked example (illustrative F; not a quoted rate): Moderate, 3 days x $100 kitchen, HST 15% (T = $345.00), F = $10.35, pool = $334.65, $111.55 per day. Cancel with day 1 in 48 h (50%), day 2 in exactly 72 h (100%, the generous tier at the cutoff), day 3 in 96 h (100%): refund $55.78 + $111.55 + $111.55 = **$278.88**; retained $66.12 (F plus half of day 1).
- Today's engine uses one cutoff from one schedule (`booking-cancellation-refund.ts:63`), so **the cancellation engine must be specified with N cancellable units now**, or multi-day cannot ship.
- v1: the customer cancels the whole booking (each unstarted day is quoted by its own tier; started or used days stay paid). A single day cancelled or lost to the kitchen (R1/R2 remedies, no-show per R3) is a Local Cooks support action with an audited split that preserves history (policy guard G). This also keeps `minConsecutiveDays` coherent.
- Pending (before confirmation): cancel or decline releases the entire hold, nothing lost, exactly as today.
- Storage and equipment: equipment rows follow the days; unused days follow the preset; storage keeps its own custody contract (`booking-linked-cancellation.ts`, C33 of the policy doc).

### B8. Edge cases
- **Manager declines one day:** not possible. The manager decides the whole request. Decline offers "Decline and invite for different dates" (prefilled invitation) so a smaller range is one click. Closure created after a request is pending: the decision screen shows a "Day 2 is now closed" warning and blocks Accept; capture is never attempted on an unavailable day.
- **Day becomes unavailable mid-checkout:** reserve fails or fulfillment fails, authorization cancelled, nothing created, the customer returns to the picker with that day marked (existing safety net `:93-98`).
- **Another customer hourly-books a day in the range after the hold expires:** impossible while pending (the booking holds all N days from the moment it exists). If the customer is slow, the hold simply expires and the reserve re-checks.
- **Mid-range closure or maintenance:** the manager sees affected confirmed days before saving (P0-4); the closure does not auto-cancel; the day becomes a kitchen-cancel (R1) case for that day.
- **Max-advance and notice:** day 1 uses minimum notice; the last day uses the horizon. Manager-response deadline D uses day 1's start.
- **DST day inside the range:** refused as above. **Overnight windows:** supported.
- **Storage and equipment:** B2/B7.
- **Manager changes max-days later:** existing bookings are unaffected.

## C. Invitation design

**C1. Who and what.**
- Recipient: a customer who is currently allowed to book at the kitchen's location, using the one shared check (`readLocationBookingEligibility`, `location-booking-eligibility.ts:7-13`, plus `getApplicationStatusForBooking` for a listed kitchen and valid licence). Invitation-to-apply is out of scope. Pre-approval **never bypasses** eligibility: it is re-checked when payment starts and when the booking is created.
- The manager picks: kitchen; the days (one hourly slot range on one date, or one full day, or later a daily range), discount (`$ off` or `% off` of the **kitchen subtotal**), a note (500 chars), and an expiry preset.
- The server freezes: list kitchen price per the rates at send time, discount type and value, offered kitchen subtotal (never below a $1.00 floor, since Stripe needs a positive amount; free time stays on the external booking path), expiry, version. Customers still add storage or equipment at checkout at list price.
- **Tax and Local Cooks fee are never edited by the manager.** They are recomputed by the existing functions from the discounted subtotal (`bookings.ts:3226-3237`, `stripe-checkout-fee-service`). With a 0% fee the customer sees rent + HST. Discount cost is borne by the manager's rent (payouts use the paid subtotal unchanged). Accountant to confirm HST applies to the discounted amount (research A7 flags tax review).

**C2. Entry points.** Manager Customers detail (planned), a pending request ("Decline and invite for other dates"), and the kitchen calendar. The send form shows list price, discount, customer total and the manager's estimated proceeds from the same server preview.

**C3. Customer view.** An authenticated page `/invitation/:id` (recipient only; another account sees "This invitation was sent to a different account", no details):
- Kitchen, photo, dates and hours with the zone label ("Newfoundland Time"), the manager's note.
- Price: list kitchen price struck through, invitation price, tax, service fee if any, total. Cancellation preset and the first-day cutoff; the inside-window notice when applicable.
- **Disclosure that changes the customer's rights:** "These dates are pre-approved. Your booking is confirmed when payment completes and the cancellation policy applies from then." (Normal bookings have a free-cancel pending stage; invitations do not.)
- Countdown to expiry in kitchen time. Actions: "Review and pay $X", "Decline" (optional reason), "Ask a question" (existing booking conversation).
- Documented peers: Airbnb special offers show an itemized breakdown with taxes and fees as separate lines and expire in 24 h; Peerspace's guest gets 7 days to review and pay ([Airbnb offers](https://www.airbnb.com/help/article/35), [Peerspace invite](https://support.peerspace.com/en/articles/11642753-how-to-send-a-custom-offer-using-the-invite-to-book-feature)).

**C4. Payment flow (reuses the normal checkout).**
1. "Review and pay" re-validates: invitation `sent` and unexpired, recipient eligible, days available. It reserves the normal hold (group for a range) and creates the normal Stripe Checkout session (manual capture) with `invitation_id`, `invitation_version`, list price and discount in metadata and the kitchen line at the offered price (Stripe has no negative lines; the discount is shown as the line's description).
2. Creating the session moves the invitation to `accepted_pending_payment` (the manager cannot withdraw during the customer's payment; abandoned or expired session returns it to `sent` if not expired).
3. Fulfillment (webhook) creates the booking as today, links `invitation_id`, then **immediately runs `decideAuthorizedBooking(bookingId, 'confirmed')`** attributed to the invitation's manager ("pre-approved by invitation v n"). This reuses capture, recovery and reconciliation (`booking-payment-decision.ts:21+`), so no second manager approval and no new money path.
4. If the inventory check fails at fulfillment, the authorization is cancelled (existing), the invitation shows "dates are no longer available", and the manager is told with a one-click "Invite for other dates".
- Local test limit: real Stripe webhooks and capture need Stripe test mode on the deployed dev server (ask the owner first, per the deploy rule); everything before the webhook is testable locally.

**C5. Lifecycle.** States: `sent -> accepted_pending_payment -> accepted`, or `declined | withdrawn | expired | superseded`; "unavailable" is derived, not stored. Expiry is **evaluated on read** (`status = sent and now > expires_at`) so correctness needs no cron; a sparse tick only sends the expiry notices (Hobby CPU constraint, commit a6d500a9).
- Expiry presets: 24 h, 48 h (default), 7 days, always capped at first-day start minus the notice window minus the hold time. Peers: 24 h (Airbnb, documented), 7 days (Peerspace, documented).
- Withdraw: manager, any time while `sent` (Airbnb documents changing or withdrawing before acceptance). Replace: editing creates version n+1 and supersedes n; the old link shows "replaced by a newer invitation". Both blocked while `accepted_pending_payment`.
- Overlap: two invitations for the same dates are allowed, with a manager warning; first to pay wins (documented for Airbnb offers). **Sending reserves nothing** (Airbnb pre-approval documents no calendar block); the 37-minute hold starts when the customer begins payment. A normal booking can therefore take the dates first; the invitation then shows as unavailable.
- Eligibility lost before payment (access revoked, document expired): payment refused with the shared eligibility message; the manager is told.

**C6. Emails (tour-quality, transactional shell).** Subject line carries kitchen and dates; greeting by name; kitchen, location, dates and times with zone label; the price block (list vs invitation vs total); the manager's note; expiry in kitchen time; one button; text/plain part; viewport and lang set; the words "customer" and "Local Cooks", never "Chef" as a noun or "admin". Set: invitation sent; one reminder 24 h before expiry (only if the offer is longer than 24 h); withdrawn/replaced; expired (manager and customer); declined (manager); confirmed (both parties, the normal confirmation email with an "Invited rate" line). Delivery through an event outbox row per notice with delivery-time revalidation (the `instructions_updated` pattern, `kitchen-instructions-updated.ts`), not the booking-keyed event table because no booking exists yet.

**C7. Audit and support.** Append-only `kitchen_invitation_events` (created, sent, viewed, payment started, accepted, declined, withdrawn, expired, superseded, support action) with actor, role, timestamp, version, reason; doubles as the notice outbox. Local Cooks support (guarded command G: named actor, acting-for party, reason, revision check, notice to both): view invitations by kitchen or customer, withdraw for the manager, resend, extend expiry (within the cap), record a decline for the customer. Support never edits price or discount.

**C8. Schema (migration 0075, do not apply).** `kitchen_invitations` (id, kitchen_id, location_id, manager_id, recipient user id, status, version, replaces_id, days jsonb, pricing_mode, list/discount/offered cents, note, expires_at, hold_group_id, session_id, booking_id) with a partial unique index on active invitations per recipient, kitchen and date set; `kitchen_invitation_events`; nullable `kitchen_bookings.invitation_id`.

## D. "One more hour" (in-session extension): recommendation = defer, with a cheap interim

**Why not now.** It is not easy: (1) a **second payment source** (new authorization, capture, refund path, allocation row) against a booking whose first source is only pending; (2) a **schedule revision** that must regenerate the frozen closeout snapshot (`visitDuties.clockCloseout`), reminders, the visit code and the visit row; the clock-closeout design explicitly keeps extension hooks off until a financially committed revision exists; (3) inventory plus turnover buffer (not built); (4) a real-time deadline race with the manager. The repo already has a working two-payment pattern for storage extensions (`bookings.ts:757-1129`), but kitchen extensions are deliberately retired (research A10).

**Peers (documented).** Turo: requested any time during the trip and up to 24 h after its end; auto-approved if the car is free and within the host's notice, hours, buffer and duration settings, otherwise the host decides (12 h response); silence is not permission; charged when accepted; a message agreement is not valid ([Turo](https://help.turo.com/en_us/managing-requests-to-extend-or-shorten-a-trip-BJDjrVg45.md), read via search results). Getaround: auto-approved only for instant-booking cars when the price does not fall and the extra days are free; same card charged; fees non-refundable once accepted ([Getaround](https://getaround.com/help/articles/3efdd7e2abdc/intl)). Airbnb: Instant Book guests can extend with no request up to 72 h before checkout; otherwise an alteration request that leaves the original unchanged if declined, with payment failure reverting the change ([Airbnb alterations](https://www.airbnb.com/help/article/50)). Peerspace: no guest-initiated in-session extension is documented; the host bills overtime afterwards in 30-minute blocks within 72 h and the guest accepts or disputes within 48 h ([overtime](https://support.peerspace.com/en/articles/10119193-how-does-overtime-work)). The pattern is consistent: auto-approve only when inventory and settings allow, else the owner decides, charge only on success, never grant on silence.

**Interim (ship with the visit page, small, no money):** in the last hour of an hourly visit, "Need more time? Ask the manager." It opens the existing booking conversation (`bookings.ts:76`) with a prefilled message and the line "Asking does not extend your booking. You can use the kitchen until {end} unless the manager confirms an extension." Manager and Local Cooks see the thread. No state change.

**Exact rules for the later minimal version (EXT).**
- Hourly bookings only, today's visit only, exactly one hour. Daily bookings are excluded (the day is already whole).
- Setting per kitchen with location default: `Off | Manager approves | Auto-approve when free`; default "Manager approves".
- Request window: from visit start until 15 minutes before scheduled end (number needs approval). The added hour must be inside operating hours, free of bookings, holds, blackouts and turnover (P0-2), and DST-unambiguous.
- Price: the contracted hourly rate for one hour, kitchen's tax, service fee per setting. A new manual-capture authorization is created **on-session** before the request reaches the manager (storage-extension pattern); the saved card is not assumed to cover it.
- Decision deadline: the original scheduled end. No decision or no payment by then: request expires, authorization released, no charge, no extra time; the customer is told. The added hour is never usable before it is confirmed.
- Commit is atomic under the kitchen lock: recheck inventory, capture, then apply the revision (end time, slots, visit end, closeout instants, reminders, code window) and queue notices; capture succeeded but apply failed means refund plus an incident for Local Cooks. Idempotent per request.
- The added hour is paid-consumed time: not refundable by cancellation (the visit has started); a kitchen-caused failure follows R1/R2. In a multi-day booking it changes only that day.
- Needs before it can start: clock closeout, cancellation engine, schedule-revision primitive, turnover buffers.

## E. Implementation plan (after: arrival/departure done; clock closeout and access integrity in progress)

**Interface requirements for builders now** (additive, no scope change): visits keyed by an opaque key, not start/end; cancellation engine takes N cancellable units each with a start instant and an allocated pool; visit-code target = visit row when it exists; no new reads of `bookingDate` as "the date" (use a `bookingDays(booking)` helper once it exists); availability rules (buffers, horizon, closures) live in the one availability function.

Prerequisites on the existing order (`research-booking-model-gaps.md` D): clock closeout, reminders, cancellation engine with units, visit code, and P0-2/3/4 (buffers, horizon, closure impact). Invitations do not need the cancellation engine to exist, but must display whichever policy is active.

Local acceptance uses the harness: kitchen 54 / location 47, `CAPTURE_MAIL=1` sink, fixtures. Anything needing real Stripe webhooks, Inngest wakeups, SMTP or Vercel is marked **[deployed dev, ask first]**.

| # | Checkpoint | Size | Key tests | Live acceptance |
|---|---|---|---|---|
| INV-1 | Invitation data + service: create, validate, withdraw, replace, derived expiry; shared price preview (discount, tax, fee) | M | discount math and floor, tax/fee recomputed, eligibility, expiry boundaries, state machine, two acceptors, wrong account | Manager sends via API; customer reads; wrong account refused |
| INV-2 | Checkout from invitation + pre-approved fulfillment (auto `decideAuthorizedBooking`), hold, abandoned-payment return | M | webhook replay idempotent, payment failure returns to `sent`, inventory conflict cancels authorization, withdraw blocked mid-payment | Mocked locally; end to end **[deployed dev, ask first]** |
| INV-3 | Manager send form, list and Customers entry; customer page; emails; i18n | M | form validation, a11y labels, email content (names, zone, no "Chef"/"admin"), text part | Local browser + mail sink: send, view, decline, expire, withdraw, replace |
| INV-4 | Support actions, audit view, expiry notices on the sparse tick | S | guarded command tests, event append-only | Local SQL check of events |
| MD-1 | Settings (0074 draft) + shared day math: range to days, per-day windows, DST, overnight, price; manager UI + routes | M | validation (min<=max, needs daily rate), inheritance, NL half-hour offset, DST day refusal | Local: set at location, override on kitchen, reset |
| MD-2 | `validateRangeAvailability`, hold groups, per-day status endpoint | L | partial-day hourly conflict, hold vs hourly race, double range contention, expiry, closed/override/DST/notice/horizon reasons | Two sessions racing for overlapping ranges |
| MD-3 | Range checkout, atomic fulfillment with N visits, price display fix (`dayCount`), metadata and line items | L | atomic failure, equipment x N, storage independence, invoice/detail/manager totals | Local $-free path as far as possible; payment **[deployed dev, ask first]** |
| MD-4 | Per-day lifecycle: date-aware keys, closeout, reminders, instruction notices, code target, Today "Day i of N", customer visit page | M | same-hours days don't collide, one missed tap doesn't affect other days, payout after last day | Fixture with 3 days: day 2 arrival/departure, clock auto-close |
| MD-5 | Cancellation per day, remedies, support split-day (needs the engine) | M | worked example above, exact cutoffs, started days retained, storage kept | Cancel a fixture at three offsets |
| MD-6 | Range picker UX, disabled reasons, summary card, emails, copy, a11y, mobile | M | keyboard, screen-reader names, 390 px layout | Browser walkthrough desktop + mobile |
| INV-5 | Enable ranges in invitations | S | days list validation | One range invitation end to end |
| EXT-0 | "Need more time?" chat entry | S | copy, no state change | Local |
| EXT-1+ | Paid add-an-hour (section D) | L | race, payment, atomic revision | **[deployed dev, ask first]** |

**Migrations (drafted only, not applied; 0073 already exists for clock closeout indexes):**
- `0074_multiday_settings_and_visit_dates`: location and kitchen max/min consecutive days; `kitchen_booking_visits.operating_date` (+ backfill + unique index); `kitchen_bookings.day_count`; `kitchen_checkout_holds.group_id`.
- `0075_kitchen_invitations`: `kitchen_invitations`, `kitchen_invitation_events`, `kitchen_bookings.invitation_id`.
- A third (extension requests) is written only when EXT starts.
Each is additive and nullable or defaulted so deployed dev keeps working until the code lands (the 0072 precedent).

## F. Owner questions (only where research cannot decide)

1. **Cancellation basis for a range:** each day on its own cutoff (my recommendation; Skedda does this per occurrence but locks a series paid upfront entirely, so peers split) or one cutoff from the first day?
2. **Scope confirmation:** v1 is full operating days at the daily rate, calendar-consecutive (a closed day breaks the range), maximum ceiling 14 days, default off. OK, or are hourly multi-day or "skip closed days" needed at launch?
3. **Tasks on every day:** keep the kitchen's required tasks on each day (my default) or let managers mark intermediate days lighter?
4. **Visit code on multi-day (also for the parent, who owns the code design):** one code per day (recommended; matches "visit-specific") or one code for the whole range? And may a manager enable self check-in for all days in one action? I did not assume either.
5. **Invitations:** discount floor (my proposal: kitchen price may not drop below $1.00; free time via external bookings), default expiry 48 h, and whether anyone other than the location's manager may send them.
6. **Extension:** confirm deferral, with only the no-money "Need more time?" entry until the later checkpoints.

## G. Research notes

Documented (fetched Oct13): Airbnb special offers [help/35](https://www.airbnb.com/help/article/35) (24 h, acceptance confirms, calendar must be open, first acceptance wins, itemized taxes/fees, cannot be sent after a request exists); pre-approval [help/237](https://www.airbnb.com/help/article/237) (24 h, does not block the calendar, covers only the inquired dates, withdrawable); alterations [help/50](https://www.airbnb.com/help/article/50); trip-length min/max in listing availability settings, customizable by check-in day [help/880](https://www.airbnb.com/help/article/880) and nights auto-blocked when they fail the settings, with the host seeing the reason (search summary of [help/3612](https://www.airbnb.com/help/article/3612)). Peerspace invite [11642753](https://support.peerspace.com/en/articles/11642753-how-to-send-a-custom-offer-using-the-invite-to-book-feature) (date, time, attendees, price, add-ons, note; 7 days to review and pay; no discount field; withdrawal not stated). Skedda check-in and lock-in as above. Getaround, Turo, Peerspace overtime as in D (Turo read through search summaries, Getaround and Peerspace pages fetched directly).

Not verified: Peerspace, Giggster, Splacer multi-day range booking and any per-day check-in; The Food Corridor per-shift sign-in and a native day-block product (listings use kitchen-specific day rates, weekly or monthly plans); Turo's exact auto-approval criteria; Airbnb's multi-night cancellation tiering for a single stay (from general knowledge only). Inferred: per-day visits as the right model for daytime shifts; per-day cancellation allocation; every Local Cooks rule above.
