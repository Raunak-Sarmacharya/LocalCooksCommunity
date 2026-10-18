# Kitchen (manager) tracking revamp — plan (Oct 18, 2026)

Owner brief (Oct 18): after the booking work, kitchens must track bookings, storage, claims, revenue and payouts as well as
on the platforms we benchmark, so they want to pay for Local Cooks. **No new functionality**: reuse and polish what exists,
keep the staged dashboard (it only reveals more once a kitchen has activity, so first-time users aren't overwhelmed), and
ask the owner before removing anything that isn't useless. Decisions below are the lead's unless marked "owner".

## Research (what hosts get elsewhere)

- **Airbnb Earnings** — Upcoming and Paid tabs; filter by listing, payout method, date range; "Get report" CSV with gross
  earnings, host fees, cleaning fee, taxes withheld per earning. Today tab = reservations at a glance + suggested actions.
- **Peerspace Payouts** — list of payouts (3–7 days after the booking, after the service fee) with Download CSV.
- **Turo** — Business > Earnings; Business > Claims dashboard (claims by trip, status, actions).
- **The Food Corridor** (closest peer) — Reporting: Payment Details (per payment, platform fee), Monthly Revenue (gross,
  tax, platform fee, net), Monthly Revenue by Client, by Type; filters by client and date range (up to 3 years); charts:
  monthly revenue over time (YoY), booking hours over time, active clients by type, storage utilisation by type; booking
  reports with hours by client; CSV everywhere; QuickBooks Online sync.

Owner decisions (Oct 18): HST shown separately (kitchens remit it); CSV now, QuickBooks later; a combination of Food
Corridor reports and Airbnb's Upcoming/Paid clarity, fitted to our dashboard.

## Live audit on dev (Oct 18)

| Area | Found |
|---|---|
| Revenue | "Upcoming payouts" lists one row per day **per payment source** (KB-XHD3ZG = 12 rows, mostly $0.00); rows have no chef/day; KPIs "Completed payments 62", "Average per payment $23.72"; no paid-payout history; table + Export exists |
| Dashboard | Multi-day schedule/attention rows merge every day's slots ("Today · 8:00–9:00 p.m., 8:00–9:00 p.m."); "Pending payments $0.00" while Revenue shows $978.88 upcoming |
| Bookings list | Good grouping (Needs action / Today / Upcoming), "Day N of M"; refunded rows show only "Refund: $X" (not what the kitchen still receives); no search/filter/export |
| Storage board | Units, status, occupant, Needs action filter, actions; no rental history or per-rental earnings; a past start still reads "Reserved · Starts Oct 17" |
| Claims | Fixed today: booking link, day, chef, filed date, Open/Closed |

## Design

### 1. Revenue & payouts (rework `client/src/components/manager/revenue`, reuse table/export/date range)
- **Top numbers** (one money truth shared with the dashboard card): *Paid out* (period), *Upcoming* (scheduled, with the
  next payout date + amount), *On hold* (count + amount, each with its reason), *Net earnings* (period, after refunds).
  Drop "Completed payments" and "Average per payment" as headline numbers (keep payment count in Reports).
- **Tabs**:
  - **Upcoming** — one row per payout the kitchen will actually receive (per day for multi-day, $0 rows never shown,
    sources merged per day): expected date ("around Oct 21, 10:00 a.m." / "after you finish the inspection"), booking
    reference (link), chef, "Day 2 of 3 · Wed, Oct 21" or the single date, type (kitchen time / storage / extra time /
    claim), amount, status in plain words (scheduled, on hold — why + what to do).
  - **Paid** — one row per transfer: paid date, booking (link), day, type, amount, "View in Stripe".
  - **Reports** (Food Corridor-style, monthly, date range up to 3 years): bookings count, hours booked, kitchen time,
    equipment, storage, extra time, claims received, refunds, **HST collected**, card processing fees, net payout; by
    month, by chef, by type. Chart: monthly net over time (reuse earnings-chart).
- **CSV** on every tab, bookkeeping-shaped (one row per payment/payout; HST and fees as columns). Filters: date range,
  location/kitchen.
- Copy talks to the user: every status says what happens next and when; on-hold rows say what the kitchen can do.

### 2. Dashboard overview (polish `KitchenDashboardOverview`; keep staging)
- Fix multi-day rows: one line per **day** ("Day 1 of 2 · Today 8:00–9:00 p.m."), never merged slots.
- **This week** strip: bookings, hours booked, utilisation (% of open hours), vs last week — from existing data.
- **Calendar**: polish the existing `BookingCalendarWidget` into a week view (day/week toggle) showing bookings, tours,
  maintenance/closed blocks and storage move-ins/move-outs, colour by state, click-through to the booking/tour/rental.
- **Revenue & payouts card**: month-to-date by type (kitchen time, equipment, storage, extra time), next payout date +
  amount, on-hold count; same numbers as Revenue.
- Needs attention / recent activity: keep; make every item link to the exact booking/day/rental.

### 3. Lists
- **Bookings**: show "You receive" after refunds (and "Refunded $X" as secondary); search (chef, reference), date-range
  and status filters, CSV.
- **Storage board**: "Move-in overdue" past the start; rental history (past rentals) with earnings per rental; links to
  the chef and payouts.
- **Claims**: filters (status, date), totals (claimed, collected, pending).

## Build plan (Codex, lead review + live verification on dev)
- **R1** Revenue & payouts (server payout/transfer/report reads + client tabs + CSV + dashboard card numbers).
- **R2** Lists (bookings, storage, claims).
- **R3** Dashboard overview polish (multi-day rows, week strip, calendar week view, revenue card) — after R1 so it reuses
  the same revenue reads.
Display/reporting only: no change to charges, refunds, transfers or payout timing. Each stage: tests, one tsc, lead review,
money-display review for R1, live check on dev.

## Owner questions still open
- None blocking. Anything a stage would remove is listed for the owner before it ships.
