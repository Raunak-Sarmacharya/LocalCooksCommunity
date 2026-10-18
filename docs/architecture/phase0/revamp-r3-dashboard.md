# R3 — Kitchen dashboard overview revamp (Oct 18, 2026)

Stage R3 of `manager-tracking-revamp-plan.md` (section 2). Display only: no booking, payment, payout or policy logic changed.
No new server endpoints; every number comes from a read the app already makes.

## Research — what each platform does and what we took

| Platform | What the host home shows | Adopted here |
|---|---|---|
| **Airbnb** (Today tab) | Current and upcoming reservations at a glance, split into *Currently hosting / Arriving soon / Checking out / Upcoming*, plus a tip on what to do next for each reservation ([Airbnb help 3037](https://airbnb.com/help/article/3037), [Today tab](https://www.airbnb.com/d/mayhostnews)). Hosts complain when those groups are wrong ([community thread](https://community.withairbnb.com/t5/Community-cafe/Today-tab-enhancement-needed/m-p/1604012)). | A **Today** card next to **Needs attention**: today's bookings (one row per day), tours, closures and storage move-ins/outs, with "N chefs in the kitchen now" from the booking page's own phase, so it can't drift from the booking page. Every Needs attention item says what to do and opens the exact record. |
| **Peerspace** | Calendar with blocked time, booking requests with a two-business-day answer window, payout history ([help: block time](https://intercom.help/peerspace-108cf19aff8e/en/articles/10119400), [requests](https://intercom.help/peerspace-108cf19aff8e/en/articles/10119524), [payouts](https://intercom.help/peerspace-108cf19aff8e/en/articles/10119435)). | Closures and special hours (date exceptions) show on the calendar next to bookings. Requests stay at the top of Needs attention (tour decision deadline was already shown). |
| **Turo** | *Booked* (upcoming and in progress) separate from *History*; *Business > Earnings* separate from trips; calendar shows trips with availability ([Host tools](https://help.turo.com/en_us/navigating-host-tools-and-metrics-H1pSVlEq.md), [Earnings](https://help.turo.com/en_us/viewing-your-earnings-HyFwSVeNq.md)). | Schedule (Today, Upcoming, calendar) is kept apart from History (Recent activity) and money (its own card with a link to Revenue). |
| **The Food Corridor** (closest peer) | Daily view calendar, reporting on space utilisation, booking hours, revenue, outstanding payments ([site](https://www.thefoodcorridor.com/), [GetApp](https://www.getapp.com/operations-management-software/a/the-food-corridor/), [blog](https://www.thefoodcorridor.com/?p=2728)). | **This week** strip: bookings, hours booked and **utilisation % of open hours** (weekly hours minus closures, plus special hours), each against last week. Calendar has Day / Week / Month. |

## Layout decisions

Order, top to bottom (desktop is a 3-column grid; a phone at 390 px stacks in the same order):

1. **Header**: today's date, "Welcome back, {name}", and a **location switcher** (only when there are 2+ locations;
   otherwise the location name, as before).
2. **Needs attention** (2/3 width) + **Today** (1/3). Needs attention keeps every group it had; each row is a link to the
   exact record: booking page, the day's inspection (`/manager/booking/:id/inspection?visitId=` for a checkout to review),
   the storage rental (`/manager/storage/:id`), the tour/application/claim via the existing deep-link params. Multi-day
   rows say "Day 2 of 3 · Tue, Oct 20 · 8:00–9:00 a.m.". "You're all caught up" when empty (unchanged).
3. **This week** (only once there are bookings): Bookings (distinct bookings with a booked day this week; requests and
   cancellations not counted), Hours booked, Utilisation ("of 24 open hours"), each with "Last week: …". If no open
   hours are known it says "Set your open hours to see this" instead of a fake 0 %.
4. **Calendar** (rebuilt `BookingCalendarWidget`): Week view by default: 7 columns on desktop, stacked days on a phone
   (empty days hidden, today always shown). Day view: full rows (time, who, day N of M, status pill). Month view: dots on
   a phone, two chips + "+N more" on desktop; tapping a day opens it. Events: one per booked day and visit block (never
   merged), tours (requested / booked / completed), closures and special hours, storage move-in / move-out. Colours are
   the booking pill palette (`PILL` from `BookingNowCard`), so the calendar, lists and booking page use the same colours.
   Every event links to its page; closures open the availability settings. Keyboard: all events, day headers and month
   cells are links/buttons with labels; prev/next have labels; the view switch is a radio group.
5. **Revenue and payouts** (2/3) + **Listing status** (1/3). The card shows *Paid earnings* (this month, the existing
   number), *Upcoming payouts* (scheduled) with "Next payout Wed, Oct 21 · $45.00", and *On hold* (amount + count). It
   reads one `RevenueSummary` shape (`client/src/lib/manager-revenue-summary.ts`):
   `{ paidOut, upcoming { total, next { date, amount } }, onHold { count, amount }, monthToDate by type }`. Today it is
   filled by `revenueSummaryFromCurrent()` from the month's `/revenue/overview` and `/revenue/upcoming-payouts` (the
   Revenue page's own query key; filtered to the selected location's bookings). **Lead:** when R1's summary endpoint
   merges, replace that one call; "This month so far" by type appears automatically once `monthToDate` is filled.
   Note: upcoming here = scheduled only; scheduled + on hold equals the Revenue page's current "Upcoming payouts" total.
6. **Upcoming** + **Recent activity** (as before). With the Today card on screen, Upcoming starts tomorrow so nothing is
   listed twice. Reserved storage move-ins are listed.

### Staging (kept)
- No activity yet (no bookings, rentals or upcoming tours): the same four-card setup view as before (listing first when
  nothing is live, attention first when live; Upcoming card keeps its application-journey guidance), plus the revenue
  card once a kitchen is live (unchanged rule).
- Once there is activity: Today, the calendar, and the two-row layout above appear. The week strip waits for the first
  booking. Open hours / date exceptions are only read once there is activity.

## Before / after (live dev, PHASE0 Test Kitchen, Oct 18)

Before (text of the live page): Needs attention "Follow up ended bookings · Today · 2:00–3:00 p.m., 2:00–4:00 p.m., 3:00–4:00
p.m."; Upcoming "Today · 8:00–9:00 p.m., 8:00–9:00 p.m." and "Mon, Nov 2 · 10:00–11:00 a.m., 10:00–11:00 a.m., 10:00–11:00 a.m.,
10:00 a.m.–12:00 p.m., …" (every day's slots merged); "Pending payments $0.00" with $978.88 scheduled on the Revenue page; the
calendar only appeared under the lists, showed bookings only and merged slots in its day panel; no storage at all (see below).

After: one row per day with "Day N of M" and that day's own times (the Nov 2 booking becomes one row per day); Today card;
week strip; calendar with tours/closures/storage; payouts card with scheduled vs on hold and the next payout. Visual check
on dev after deploy is still to do (not deployed by this stage).

## Found while building
- **Storage had silently disappeared from the dashboard.** `useManagerOverviewActivity` still reads the legacy storage feeds,
  but their paths were set to `null` with standalone rentals (WP-ST12), so storage requests, move-outs and holdovers never
  reached Needs attention or the schedule. The overview now reads the storage board's own `/api/manager/storage-rentals`
  (same query key): requests (`pendingRequests`) and units needing action (`chipNeedsAction`, e.g. move-out due, grace,
  holdover, cleaning, removal review) go to Needs attention with a link to the rental; move-ins/outs go on the calendar.
- Tour times on the overview use the St. John's zone (existing behaviour, kept so the calendar matches the tour rows).

## Things I would remove (owner decides — all kept)
- **"Pending payments" and "Paid bookings"** in the revenue card: kept as a small footer row. "Pending payments" read
  $0.00 while payouts were scheduled, which contradicts "Upcoming payouts" next to it.
- **"Today's sessions / Next 7 days" counters** in the Upcoming card: removed from that card only because the Today card
  and the week strip now show the same facts (with day rows). Say if you want them back.
- **Upcoming list vs calendar**: they overlap; the list is kept (it's the quickest scan on a phone).
- **Dead code** (not mounted anywhere): `components/manager/TodaysKitchenBookings.tsx` (test only),
  `components/manager/dashboard/ManagerDashboardOverview.tsx` and `BookingKPIStats.tsx`; the legacy storage task code in the
  overview (its feeds are always empty).

## Missing (not built — no new functionality)
- **Money by type, month to date** (kitchen time / equipment / storage / extra time / claims) and **actual paid-out
  transfers this month**: need R1's summary; the card is ready for both.
- **A per-day link on the booking page** (`/manager/booking/:id?day=` or similar): rows open the booking (its Days
  panel); only inspections can be opened per day today.
- **Booking change requests waiting on the kitchen** have no manager list read, so they only appear in Recent activity,
  not in Needs attention.
- **Utilisation** ignores turnover buffers and counts only kitchens whose hours loaded; booked hours are the booked slots,
  not actual check-in/out times.

## Files
- `client/src/components/dashboard/KitchenDashboardOverview.tsx` — layout, staging, day rows, attention links, Today, week strip.
- `client/src/components/dashboard/BookingCalendarWidget.tsx` — rebuilt calendar (`CalendarEvent`, `CalendarEventRow`).
- `client/src/components/dashboard/RevenuePayoutsCard.tsx` — the money card.
- `client/src/lib/booking-list-status.ts` — `managerListDays()` (shares the agenda's day mapping with `managerDatedListDay`).
- `client/src/lib/manager-week-stats.ts`, `client/src/lib/manager-revenue-summary.ts` — pure numbers.
- `client/src/components/booking/BookingNowCard.tsx` — `PILL` exported (no visual change).
- 45 new `ovr*` strings in en-CA, fr-CA, uk (`manager.json`).
- Tests: `KitchenDashboardOverview.test.tsx` (+5), `BookingCalendarWidget.test.tsx` (new, 3), `lib/manager-dashboard-numbers.test.ts` (new, 7).

## Round 2 (Oct 18, 2026) — lead's live review on dev (1280 and 390)

Display only, as before. Baseline is dev running round 1 (PHASE0 Test Kitchen); these fixes are not deployed yet.

1. **Follow-ups named the wrong day.** The booking row's own `checkinStatus` and times are day 1's and go stale on a
   dated multi-day booking. On dev, bookings 207 and 209 still said `not_checked_in` with day 1's times, so the
   booking-level check flagged them as "Follow up ended bookings". The row then took its day from the agenda's
   next-day choice ("Day 2 of 2 · Fri, Oct 23"). In fact both had day 1 checked out (Today shows them as Completed).
   Booking 212's day 1 *was* waiting (`checkout_requested`) but was missed, because its booking row hadn't "ended".
   Now a dated booking's follow-ups are decided **day by day**. Each day that ended and is still open (checkout to
   review, or nothing recorded) becomes its own item: "Day N of M · date · times", linked to
   `/manager/booking/:id/inspection?visitId=<that day>`. Single-day bookings keep the old rule. Every follow-up item
   now opens the inspection; before, "ended bookings" opened the booking page. On dev today this means the two wrong
   "Follow up ended bookings" rows go away and booking 212 day 1 appears under "Kitchen check-out reviews".
2. **Today card.** Order: in the kitchen now, then next up (by start), then the day's context (closures, special
   hours, storage), then anything earlier today still open. Cancelled and finished items are folded into one line
   under the list ("2 cancelled · 2 finished", a button with `aria-expanded`) and appear when opened. The pill sits
   next to the time, and the name wraps instead of being cut off ("TestSprite ch…").
3. **Calendar.** Cancelled bookings are hidden. A **Show cancelled** switch (Radix Switch with a label, `role=switch`)
   appears in the footer only when something is cancelled. Completed, requested, booked, tours, storage and closures
   stay visible. New **Agenda** view: the first day (always shown) plus the next six days that have something on, as
   two-line rows (name, then time · state). Below 768 px the calendar **opens on Agenda**; desktop still opens on Week.
4. **View switch overlap ("Day WeekMonth").** Root cause: Radix ToggleGroup items are `role="radio"` +
   `data-radix-collection-item`, and `index.css` sizes exactly that pair to 16×16 with `!important` for the app's radio
   dots. Now plain buttons in a `role=group` with `aria-pressed`, the same fix as `EquipmentListingManagement`'s
   AvailabilityToggle. (Anything else built on ToggleGroup would hit the same rule; only this widget and that page
   used it.)
5. **Revenue card uses the Revenue page's words**: Paid out / Upcoming / On hold (`r1PaidOut`, `r1Upcoming`,
   `r1OnHold`), with "Next payout {date} · {amount}". uk "On hold" count line now says "призупинено" to match
   Revenue.

### For the owner (changed or removed from view)
- **"Pending payments" footer is no longer shown** on the dashboard card. It came from the old revenue overview's
  `pendingPayments` and read $0.00 next to "Upcoming $471.12". The data is still read (`revenue.pendingPayments`); only
  the line is gone. "Paid bookings" stays in the footer.
- **"Follow up ended bookings" now opens the day's inspection**, not the booking page.
- Cancelled bookings are no longer on the calendar unless "Show cancelled" is on, and not in the Today list unless
  the folded line is opened.
- Unused strings left in the catalogs (`overviewPaidEarnings`, `overviewPendingPayments`, `ovrOnHold`): kept because
  other surfaces may use them later. Say if you want them removed.

### Gaps noticed (not changed)
- If the Revenue ledger read fails, the card falls back to the old overview, where "Paid out" is the month's
  completed net revenue rather than transfers sent.
- The week grid's chips still shorten long names (they carry the full name in their label); the Agenda and Day views
  show full names.

### Layout check
At 390 px the calendar header wraps to two lines (Today and prev/next; then the four-way switch). Agenda replaces the
seven stacked days, and with cancelled hidden a busy day shrinks (Mon 19 on dev lists 7 events, 5 of them
cancelled by the lead's count). At 1280 the Today card keeps its 320 px slot. The fold line sits under the active rows, so a
day with cancellations no longer pushes tonight's booking below the fold. Checked with tests and by reading the code;
dev screenshots are the round-1 baseline only.

### Tests (round 2)
- `KitchenDashboardOverview.test.tsx` (+7): the follow-up names the ended day and opens its inspection; every ended
  day is listed under its own group; a checked-out day 1 with a stale booking row is not flagged (dev 209); a day-1
  checkout is listed though the booking row hasn't ended (dev 212); Today leads with tonight's booking and folds 2
  cancelled + 1 finished; the fold opens; revenue card words with no "Pending payments".
- `BookingCalendarWidget.test.tsx` (+4): segmented control with `aria-pressed` and no `role=radio`; cancelled hidden
  until the switch is on (completed/closures stay); no switch when nothing is cancelled; Agenda is the default on a
  phone, showing only days with events.
