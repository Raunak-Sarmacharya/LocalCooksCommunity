# Storage availability & manager occupancy — external research and recommended Local Cooks shape

**Research handback — 14 October 2026.** Companion to `research-storage-structure.md` (terms, listing form, lifecycle, billing). This file answers the owner's Oct-14 ask that **storage availability and manager occupancy tracking be designed end to end** — there is none today (`map-storage-current.md` §8: no unit count, no date-overlap check, the same unit can be double-booked).

**Read-only.** No application source, migration, database, payment account or workflow was changed or queried. Public vendor pages were read without signing in; no competitor login, booking or payment was attempted. One vendor site (`sitelink.com`) refused our region (Cloudflare error 1009) and is noted as unreadable rather than paraphrased.

**Names used:** *Priya* is the food-business member who rents storage; *Sam* is the kitchen manager. The company is **Local Cooks**.

**Evidence discipline** (same convention as the sibling reports):

- **Documented** — a first-party public page or vendor document explicitly states the behaviour, and the URL is cited.
- **Inferred** — a Local Cooks design lesson drawn from the evidence, not a claim about a competitor's internals.
- **Not verified** — public evidence does not establish the capability; said so rather than assumed.

**Authority, in order:** (1) the owner's storage decisions recorded in `research-storage-structure.md` §"Owner decisions (Oct 14)" — approved members only; standalone + booking shortcut; **monthly (default) + daily for any date range; no weekly/hourly**; one-tap "Renew for {next month}" with a kitchen option for chef opt-in auto-renew; move-in/move-out photo check + clear-or-claim; capacity enforced atomically by unit count; no waitlist; admin controls; kitchen paid after each period closes; (2) the owner's framing in `PHASE0_LOG.md:934` — **per-unit availability (unit count × date ranges, atomic assignment, separate from the session calendar) + a manager storage board**; (3) the current-state map `map-storage-current.md` (§8 absent capacity, §11 client surfaces, §12 risks); (4) the premium/restraint constraints in `PHASE0_LOG.md:931-932` and the consolidation spec's §6/§7 (Airbnb/Skedda/Nexudus finish; must not look congested; restraint budget).

> **The one structural gap this report fills.** Every peer solves *either* continuous month-to-month custody (self-storage, TFC) *or* date-ranged resource booking (Skedda/Spacebring/Nexudus). Local Cooks storage is a **hybrid**: monthly custody **plus** daily date-ranged rentals, on **fungible units within a type**. No reviewed platform publishes that exact combination, so §3 is an **Inferred** synthesis, not a copy — say so in copy and keep the UI to the minimum the hybrid needs.

---

## 1. Findings per source (with citations)

### 1.1 The Food Corridor — count-based inventory, no map, utilization via a report

TFC is the shared-kitchen reference and the closest to Local Cooks' custody model.

**Availability is a count per type, not named units.** The manager "inventor[ies] the number of units of that type of space that is rentable", and "storage units are individually applied to your clients' accounts. Clients will be invoiced and billed monthly for their assigned storage units, **until the storage is updated or removed**." [TFC — Set up your Storage and Storage Fees](https://help.thefoodcorridor.com/en/articles/1413924-set-up-your-storage-and-storage-fees)

**Assignment is per client, by quantity, from the kitchen side.** "Go to your **Kitchen Settings tab > Storage**… Now go to your **Clients tab > Client name > Storage** and add or select the storage… click on **New Storage Unit Rental** and enter the number of units and choose type of storage." [TFC — How do I add storage units to a monthly plan?](https://help.thefoodcorridor.com/en/articles/1414037-how-do-i-add-storage-units-to-a-monthly-plan)

**Occupancy is a report, not a board.** "The system will also track your kitchen's storage **inventory and utilization**, which you can pull any time from your **Reporting Tab**." [TFC — Set up your Storage and Storage Fees](https://help.thefoodcorridor.com/en/articles/1413924-set-up-your-storage-and-storage-fees)

**TFC's storage is continuous, not date-ranged.** There is no documented start/end date or "available from" concept for storage: a unit is applied and billed monthly "until the storage is updated or removed" (same source). Storage is not covered by the booking cancellation policy ([TFC — What is a Cancellation Policy…](https://help.thefoodcorridor.com/en/articles/1413947-what-is-a-cancellation-policy-and-how-does-it-work)).

- **Inferred.** TFC's model maps to Local Cooks' **monthly** product exactly (count per type, manager-assigned, occupied until removed), but gives **no** answer for daily date-ranged availability or a visual occupancy board. We must supply those.
- **Not verified.** TFC does not publish a per-unit occupancy screen or unit map; the Reporting Tab's exact columns are behind login (a report exists — Documented; its shape — Not verified).

### 1.2 Neighbor.com — availability as a move-in *blocklist*, one listing = one space

Neighbor is the peer-to-peer marketplace whose host UX Local Cooks is closest to for the *renter-facing* side.

**Availability is a calendar of dates you cannot *move in*, not a capacity count.** "The Move-In Calendar… allows you to specify recurring or one-off dates when you are **unavailable to accommodate new renters moving into** your storage space. By setting your availability, **renters will only be able to reserve your listings with move-in dates that work for you**." Hosts use it to "avoid scheduling conflicts". [Neighbor — Managing your Move-In Calendar](https://help.neighbor.com/en_us/managing-your-move-in-calendar-ry5kOtOTJe)

**Approval is host-reviewed, and the host sees the renter, dates and items before approving.** "click on the renter's profile, review the items the renter wants to store, and read any messages" then Approve from the Listings page; **24 hours** to respond or the request auto-expires, or **Instant Book** skips approval. [Neighbor — How to Approve a Reservation Request](https://help.neighbor.com/en_us/how-to-approve-a-reservation-request-HkPmwR8RO); [Neighbor — Hosting Basics](https://help.neighbor.com/en_us/hosting-basics-B1XBvA8RO)

**Out of service = deactivate the listing.** "Find the listing… Click **Remove**… Click **Deactivate** or **Delete**… Select a reason… Confirm." Deactivated listings sit in a **Deactivated** list and can be **Reactivated** any time. [Neighbor — How to Deactivate or Delete My Listing](https://help.neighbor.com/en_us/how-to-deactivate-or-delete-my-listing-HkoEvg9cc)

- **Documented.** Neighbor has **no unit map and no per-unit count**: a listing is a single space, and availability is expressed only as blocked *move-in dates*.
- **Inferred.** "Block the move-in date" is the lightest possible availability primitive and is a good model for **daily** date-range rentals, but it cannot express "3 of 4 shelves free" or a holdover blocking the next renter — which is exactly what Local Cooks needs. Combine Neighbor's renter flow with a real unit count.

### 1.3 Self-storage software — the richest occupancy / unit-map evidence

This is where the **manager occupancy board** patterns live. Reviewed: **Stora**, **Storable (incl. storEDGE)**, **Easy Storage Solutions (Storable Easy)**.

**Units are individually tracked and auto-allocated.** "**Units allocated automatically** — Every new booking allocated so you don't have to." "Assign new customers their unit with a click, and **easily change units** as needs arise." "Flexibility for every tenant setup — **Assign multiple units to one payment** or manage them separately." [Stora — Self Storage Management Software](https://stora.co/features/self-storage-management-software)

**Availability is live and tied to real-time unit status.** "**Smart availability** — Storefront updates automatically based on real-time unit status." "**Auto availability** — switch the status of any unit type to collect bookings or leads to match if units are available or not." "**Auto deallocation** — Units free up instantly after move-out, no reminders required." [Stora](https://stora.co/features/self-storage-management-software)

**The occupancy surface is a live map with a status summary.** "**Smart maps** show live availability and occupancy, so you can run your facility smoothly from one simple view." "**Birds-eye status summary** — review your entire facility at-a-glance." "**See who's awaiting allocation, which units are empty**… from data-rich, interactive floor plans." "Point + click management — Swiftly change a unit's status, assign it to a tenant, or jump into their rental history." "Live updates — Change a unit's status and watch your map update instantly." [Stora](https://stora.co/features/self-storage-management-software); "**Facility Maps** — Build your own interactive Maps and manage your business from them." [Stora — Features](https://stora.co/features)

**Nonpayment → automatic overlock; access is a manager override.** "**Instant overlocking** — Late payments trigger automatic lockouts until payment clears." "**Manual overrides** — Block customer access at any time with a simple click." [Stora](https://stora.co/features/self-storage-management-software); [Stora — Features](https://stora.co/features)

**A per-tenant timeline shows every action.** "**Timelines** show every action—bookings, payments, and updates—all tracked automatically in one place." [Stora](https://stora.co/features/self-storage-management-software)

**The dashboard + KPI vocabulary for a rent roll / occupancy view.** "**Occupancy rate = occupied units ÷ total rentable units × 100**"; compare occupancy "among unit sizes, climate-controlled units, drive-up units"; track **RevPAF**, **move-ins and move-outs**, **delinquency rate**, **average length of stay**, **churn**, **NOI**. [Storable — KPIs for the Self-Storage Industry](https://www.storable.com/resources/self-storage-kpis/)

**The all-in-one operator dashboard, in a vendor's own words.** "**Dashboard shows rentals, occupancy, pending payments, and task list** for easy management." "Tenants can **check availability, rent units and make payments 24/7**." "Automates invoicing, payments, **late notices, late fees, gate codes, and access**." [Easy Storage Solutions (Storable Easy)](https://www.storageunitsoftware.com/)

- **Inferred.** The self-storage board is the model for Local Cooks' **manager storage board**: units as the atomic object, a live status per unit, one-tap status changes, "awaiting allocation" (reserved-not-moved-in), a per-unit timeline, and an occupancy KPI strip. We should take the *vocabulary and states*, not the facility-map machinery — a shelf has no floor plan.
- **Not verified.** Whether these tools prevent double-assignment at the database level is internal; the auto-allocation UI behaviour implies it but is not stated. SiteLink could not be read (Cloudflare 1009 — region block), so no SiteLink evidence is claimed.

### 1.4 Skedda / Spacebring / Nexudus — the date-ranged resource-booking patterns

These are the owner's named premium references and the model for **daily date ranges** and **restrained calendar UI**.

**Resources are booked on a calendar with multiple views and a floor plan.** "**Interactive floor plans with real-time availability** — users view availability and book directly from a live… map." "Toggle between the unique **Day, Month, List, Grid and Map** calendar views." [Skedda — Features](https://www.skedda.com/features)

**A full rules engine keeps bookings conflict-free and one-tap.** Booking conditions, access & visibility, custom fields, **booking windows**, **buffer time** ("15 minutes added between meetings"), **quotas** ("4 hours per employee per day"), repeat bookings, cancellation policies, **check-ins** ("confirm you've arrived"), and **booking requests** ("control which spaces require approval"). "ensuring meetings are synced, up-to-date, and **double-booking free**." [Skedda — Features](https://www.skedda.com/features)

**The admin calendar is the day-to-day surface, with drag-to-move.** "centralized admin calendar: **month view for one room, week view for all rooms**"; "**Drag a booking to a new time, room, or day**, or change when it ends, right on the calendar"; "**Link overlapping rooms** so booking a parent room automatically blocks its child spaces"; "**preparation/cleanup time**, minimum and maximum booking time"; "**Automatically release unused** meeting space with the abandoned booking protection feature." [Spacebring — Room booking](https://www.spacebring.com/features/room-booking)

**Recurring contracts + cross-location reporting.** "Automate… **contract renewals**… task reminders." Multi-location "**Centralized admin tools**"; "**Clear reporting across sites**." [Nexudus — Features](https://nexudus.com/features)

- **Inferred.** For **daily** Local Cooks rentals, the Skedda/Spacebring pattern applies directly: resource (unit) calendar, booking windows, buffer (cleaning) time, approval-for-first-booking, check-in to confirm arrival, and drag-to-relocate. For **monthly** custody it does not — a monthly shelf is an open-ended reservation, so it belongs on the storage *board*, not the session calendar (the owner already required this separation at `PHASE0_LOG.md:934`).
- **Not verified.** None of the three publishes a "N of M free" count for fungible units — they book *named* rooms/desks. Local Cooks' units are fungible, so we borrow the *rules*, not the named-resource identity.

### 1.5 Commissaries — monthly per-shelf, assigned, no self-serve availability

The commissary table in `research-storage-structure.md` §1.5 shows the dominant pattern: **flat monthly price per physical shelf/rack/cage, priced by type (dry/cooler/freezer)**, assigned by the kitchen, held continuously. None publishes a self-serve availability calendar or a daily date-range SKU.

- **Documented (from the sibling report).** Storage is assigned by the operator and billed monthly; there is no renter-facing "pick your unit and dates" flow.
- **Inferred.** Confirms Local Cooks should keep **manager assignment** as the default for monthly (matching TFC and commissaries) while offering a **request** flow for the renter.

### 1.6 What no reviewed peer does (the honest gap)

- **Not verified / absent.** No reviewed platform offers a **self-serve daily *date-range* storage SKU** with per-unit availability (self-storage and Neighbor treat daily as an overstay charge; see `research-storage-structure.md` §1.4). Local Cooks' "daily for any date range" is an **extension**, not a copy.
- **Not verified.** No peer exposes a **fungible-count availability with a date dimension** ("3 of 4 dry shelves free from 1 Nov"). TFC has a count but no dates; Neighbor and Skedda have dates but not a count of fungible units. Local Cooks needs both — hence §3's model.

---

## 2. Comparison table

Legend: **TFC** = The Food Corridor; **NB** = Neighbor; **SS** = self-storage software (Stora/Storable/Easy); **RB** = resource booking (Skedda/Spacebring/Nexudus); **CK** = commissaries; **LC** = Local Cooks recommendation (§3).

| Concern | TFC | Neighbor | Self-storage (SS) | Resource booking (RB) | Commissary (CK) | **Local Cooks (rec.)** |
|---|---|---|---|---|---|---|
| **Availability unit** | Count per type | One listing = one space | Individually tracked units | Named resources (rooms/desks) | Physical shelf | **Count per type + internal unit index (1…N)** |
| **Unit identity** | Unnamed count | The listing | Named/mapped unit | Named room/desk | Shelf | **Fungible; index internal only** ("Shelf 2 of 4") |
| **Who assigns** | Manager assigns to client | Host approves request; renter picks space | **Auto-allocate** on booking; manager can change | User books a named resource; approval rules | Manager | **Auto-assign lowest free at approval; manager may change** |
| **Overlap handling** | Continuous (no dates) | Blocked move-in dates | Real-time unit status; dealloc on move-out | Calendar + rules; double-booking-free | Continuous | **Per-unit index reserved over [start,end] (daily) or until removal (monthly)** |
| **"Available from {date}"** | Not applicable | Renter sees only allowed move-in dates | Storefront auto-updates by status | Calendar shows free slots | Not applicable | **"Available now" or "Available from {earliest free date}"** |
| **Out of service** | Update/remove the unit | Deactivate/delete listing (+reason) | Change unit status; overlock | Block resource / booking windows | Update listing | **Listing pause (whole type) + per-unit `needs_cleaning`; no per-unit maintenance in v1** |
| **Manager occupancy view** | Utilization **report** | Listings list only | **Live map + status summary + dashboard + timeline** | Admin calendar (month/week/grid/map) | None published | **Storage board: units × status, summary strip, per-unit timeline, one-tap actions** |
| **Renter view** | Assignments on their account | Listing + move-in calendar + requests | 24/7 availability + online rental | Floor plan + calendar + self-serve booking | — | **"My storage": unit, dates, next payment, access, renew, move-out request** |
| **Alerts** | Failed-payment emails | Approval/expiry notices | Delinquency, awaiting allocation, move-in/out | Check-in, reminders, abandoned-release | — | **Overdue, holdover, move-out due, reserved-not-moved-in, needs cleaning** |
| **Reserved-not-moved-in** | Assignment = active | Pending request → approved | **"Awaiting allocation"** | Booking request → approved | — | **Counts as occupied; alert if not moved in within N days** |
| **Holdover blocks next** | Unit stays applied | Not published | Overlock until payment; dealloc on move-out | Buffer time | — | **Yes: unit stays occupied until removal confirmed; offer next renter a free unit or "from {date}"** |
| **Relocate a tenant** | Update the assignment | Not published | "**easily change units**" | **Drag to another room** | — | **Manager "change unit" to a free same-type unit; audited** |

---

## 3. Recommended startup-friendly design for Local Cooks

Design goal: the owner's framing at `PHASE0_LOG.md:934` — **per-unit availability (unit count × date ranges, atomic assignment, separate from the session calendar) + a manager storage board** — finished to a **premium, uncluttered** standard (Airbnb/Skedda/Nexudus; `PHASE0_LOG.md:931-932`, consolidation §6/§7). The governing rule stays the owner's: *simple where it costs users nothing.* Concretely: **one availability number per listing, one board, one primary action per unit, no facility-map theatre.**

### 3.1 (a) Data & availability model

**Units: count + internal index, not named units.**
A storage listing (a *type* at a kitchen — dry shelf, fridge shelf, freezer shelf, rack) carries an integer **`unitCount`** (the TFC field: "inventory (number of units available to rent)"). Internally, each physical slot is a lightweight **`unitIndex` 1…N** so a specific shelf can be occupied, freed, cleaned and relocated. **Do not expose named units** (no "Unit A1") to renters: within a type the units are fungible, and named units add a picker nobody needs. Show the index only on the manager board ("Shelf 2 of 4") and in the move-in instructions.
- **Why:** TFC uses an unnamed count ([§1.1](#11-the-food-corridor--count-based-inventory-no-map-utilization-via-a-report)); self-storage names units only because its units are physically different rooms ([§1.3](#13-self-storage-software--the-richest-occupancy--unit-map-evidence)).

**A unit is occupied by a rental over a window.**
An **occupancy** row = (`listingId`, `unitIndex`, `rentalId`, `startDate`, `endDate?`). `endDate` is **null for a monthly rental** (open-ended, until move-out is confirmed) and a **date for a daily rental** (`[start, end]`, inclusive). This one shape covers both products and is the missing capacity model from `map-storage-current.md` §8.

**Overlap rule (atomic, in one transaction).**
A new rental is accepted only if, at commit time, there exists a free `unitIndex` for the listing whose occupancy rows do **not** overlap the requested window. Assign that index inside the same transaction (a `SELECT … FOR UPDATE` on the listing's occupancies, or a uniqueness/overlap constraint), so two members can never share a shelf — the double-booking risk flagged at `map-storage-current.md` §12.2.
- **Monthly overlap:** a monthly rental reserves its unit from `startDate` **until move-out is confirmed** (there is no end date), so a unit with an unremoved occupant is never re-let — matching `storageListingAwaitingRemoval` today but per-unit instead of whole-listing.
- **Daily overlap:** reserve the unit over `[start, end]`; a daily rental and a monthly rental on the same index must not overlap either.
- **Reserved-but-not-moved-in counts as occupied** (see §3.5).

**Assignment: auto-assign, manager can change.**
At approval, assign the **lowest free `unitIndex`**. The manager can **"change unit"** to any free same-type index (self-storage's "easily change units", [§1.3](#13-self-storage-software--the-richest-occupancy--unit-map-evidence)). This keeps the renter flow to "pick a type, a term, a start date" and gives the manager a one-tap fix when a shelf is unsuitable.

**Out of service.**
Two levels, and only two:
1. **Pause the whole listing** (a maintenance/health reason) — hides it from renters and blocks new assignment; existing occupants are unaffected (Neighbor's deactivate-with-reason, [§1.2](#12-neighborcom--availability-as-a-move-in-blocklist-one-listing--one-space)).
2. **Per-unit `needs_cleaning`** — a soft state between occupants (Skedda's buffer time, [§1.4](#14-skedda--spacebring--nexudus--the-date-ranged-resource-booking-patterns)). A unit in `needs_cleaning` is **not** offered as free until the manager marks it ready.

Skip per-unit "maintenance" in v1 — with a handful of shelves, pausing the type is simpler and the owner wants restraint. (Inferred.)

### 3.2 (b) Renter availability display & request flow

**What Priya sees on the kitchen's storage section — one line per type, no calendar sprawl:**

| Type | Price | Availability | Action |
|---|---|---|---|
| Dry shelf | $20/mo · $5/day | **Available now** | Request |
| Fridge shelf | $25/mo · $6/day | **Available from 1 Nov** | Request |
| Freezer shelf | $25/mo · $6/day | **Full** | (hidden unless "notify me" is on) |

- The availability string is computed from free `unitIndex` occupancy: **"Available now"** if ≥1 index is free today; **"Available from {date}"** = the earliest date a unit frees (a monthly occupant's move-out date, or a daily rental's `endDate`); **"Full"** if none free in the near term. This is the honest version of Neighbor's move-in blocklist ([§1.2](#12-neighborcom--availability-as-a-move-in-blocklist-one-listing--one-space)).
- **Do not show a unit number to the renter** and **do not show a per-day calendar** — the type line plus one availability phrase is the whole surface (restraint budget: hide empty/zero content, ≤20-word status).
- **Request flow:** pick **term** (Monthly default, or Daily with a start + end date) → see **one price** (the owner's "gentle hint when a daily range costs more than a month" applies here) → **Request**. First rental only goes to the manager for approval (owner decision); renewals are one-tap.
- **No unit picker, no seat map.** The renter never chooses a shelf; the platform assigns one (§3.1). This is the single biggest simplification versus self-storage's floor plans and Skedda's resource pickers — and it is justified because Local Cooks units are fungible.

### 3.3 (c) Manager storage board

The board is the answer to "how does Sam see what is occupied, by whom, until when, paid or not, move-out due, overdue/holdover" — the owner's end-to-end occupancy ask. It is **one destination** ("Storage"), not a parallel module (extend `ManagerStorageBookingsPage`, `map-storage-current.md` §11).

**States per unit (the whole vocabulary — seven chips, nothing more):**

| State | Meaning | Frees a unit? |
|---|---|---|
| **Free** | No occupant, ready to rent | yes |
| **Reserved** | Approved, not yet moved in | no (holds the unit) |
| **Occupied** | Items stored, in good standing | no |
| **Move-out due** | End date reached / cancel-effective reached | no (until cleared) |
| **Holdover** | Past end, goods still there, daily rate accruing | no |
| **Needs cleaning** | Emptied, awaiting Sam's "ready" | no (until marked ready) |
| **Out of service** | Listing paused, or unit removed from rotation | n/a |

**Desktop layout — a rent-roll table (self-storage vocabulary, Airbnb restraint).**
- A **summary strip** on top: `Occupied 6 / 8 · 2 move-outs this week · 1 holdover · 1 overdue` (the KPI strip, [§1.3](#13-self-storage-software--the-richest-occupancy--unit-map-evidence)) — plain numbers, no charts.
- Below it, **one row per unit**, grouped by type:
  `Shelf 2 of 4 · Fridge · Occupied · Priya N. · since 1 Sep · next $25 on 1 Nov · [⋯]`
  Status chip colour is the only colour on the row; everything else is neutral. `[⋯]` opens the one-tap action menu.
- **Filters** (a single filter row, not a sidebar): Kitchen · Type · **"Needs attention"** (Reserved > N days, Move-out due, Holdover, Overdue, Needs cleaning). "Needs attention" is the default useful filter.
- Optional **timeline** per unit (the self-storage timeline, [§1.3](#13-self-storage-software--the-richest-occupancy--unit-map-evidence)) shown in a side sheet on click, not on the board itself — keeps the board clean.

**390 px phone layout — stacked cards, one unit per card.**
- Same summary strip (condensed to one line: `6/8 occupied · 3 need action`).
- Each unit is a **card**: type + index, status chip, occupant name, the one date that matters (next payment *or* move-out due), and **one filled primary button** (the action for that state — see below). Secondary actions live behind a `⋯`.
- Filters collapse to a **segmented control**: `All · Action needed · Free`. Sticky frosted header (consolidation §6). No horizontal scroll tables.
- **Restraint budget applied:** one accent colour, whitespace instead of dividers, no empty sections, ≤3 visible links per card, a ≤20-word status sentence per unit.

**One-tap actions (state → action), matching the owner's list:**

| State | Primary one-tap action | Secondary (`⋯`) |
|---|---|---|
| Reserved | **Confirm move-in** | Message · Cancel reservation |
| Occupied | **Message occupant** | Extend · Change unit · End rental |
| Move-out due | **Confirm move-out (clear)** | Start claim (damage) · Extend |
| Holdover | **Record removal** | Send payment link · Waive (support) |
| Needs cleaning | **Mark ready** | Out of service |
| Free | **Take out of service** | Edit listing |
| Out of service | **Return to service** | — |

- "Confirm move-in/out" reuses the existing check-in/check-out flows (`map-storage-current.md` §7); "clear" frees the unit and flips it to **Needs cleaning** (then **Free**); "start claim" reuses `processCheckoutStartClaim`. **The manager's board action and the member's own check-in/check-out both drive the same state** — the board is a view over the same machine, not a second source of truth.

**Alerts (few, high-signal — no notification spam):**
1. **Overdue payment** (past the 5-day grace) — one alert per rental.
2. **Holdover started** — goods remain past the end.
3. **Move-out due today** — a daily reminder on the due date only.
4. **Reserved > N days, not moved in** — propose N = 7 (self-storage "awaiting allocation", [§1.3](#13-self-storage-software--the-richest-occupancy--unit-map-evidence)).
5. **Needs cleaning > 2 days** — a shelf sitting idle after a move-out.

Alerts surface in the board's "Needs attention" filter and (per `PHASE0_LOG.md:259`) on the support desk; they do **not** each spawn a message thread.

### 3.4 (d) Admin (support) view

Read-only, cross-kitchen, plus the support actions the owner already decided (`research-storage-structure.md` owner decision 5):
- A **global storage board** (same states) filterable by kitchen / member / status, so support can answer "where is Priya's shelf and is she paid?" in one screen.
- **Actions:** extend / end / **relocate** / waive / refund / pause holdover / resolve dispute / override the kitchen's renewal setting — all **audited** (reason required). Relocation uses the same free-unit check as the manager's "change unit".
- No admin-only occupancy concepts: admin sees exactly the manager board plus the support verbs. (Keeps one mental model; matches the support-desk rule.)

### 3.5 (e) Edge-case rules

| Case | Rule (recommended) |
|---|---|
| **Unit out of service** | Listing-level pause hides it and blocks new assignment; existing occupants unaffected. Per-unit `needs_cleaning` blocks only that index until marked ready. No per-unit maintenance in v1. |
| **Relocate a tenant** | Manager/support "change unit" to a **free same-type** index that does not conflict with the rental's remaining window; the old index goes to **Needs cleaning**; audited with a reason. |
| **Reserved but not moved in** | **Holds the unit** (counts as occupied) to prevent double-assignment. Alert at N = 7 days; if still not moved in, the manager can cancel the reservation to free the unit (or the member cancels). |
| **Holdover blocks the next renter** | A holdover unit stays occupied until **removal is confirmed** — never auto-freed (consistent with "never auto-dispose"). The next renter is offered a **different free unit** or "**Available from {removal date}**". |
| **Double-assignment prevention** | Atomic assign in a transaction with an overlap check (§3.1); the only guard today is whole-listing `storageListingAwaitingRemoval` (`map-storage-current.md` §8). |
| **Partial-month start** | No proration (owner). A monthly rental starts any day and renews on the **anniversary**; the unit is counted occupied from the start date. Availability shows the unit free until that date. |
| **Daily range vs monthly on the same unit** | Both are occupancy rows on the same index and must not overlap; the atomic check covers the mixed case. |
| **Early move-out (unit freed before period end)** | The unit is free immediately on **Confirm move-out** (→ Needs cleaning → Free); the member is **not** refunded the unused part (owner). The next renter can take it at once. |

---

## 4. (f) Open questions for the owner — with a recommended answer

Availability/occupancy-specific (the term/billing questions live in `research-storage-structure.md` §4).

| # | Question | Recommended answer | Why / evidence |
|---|---|---|---|
| **A1** | **Unit identity** — named units (A1, A2…) or an unnamed count with an internal index? | **Count + internal index.** Show "Shelf 2 of 4" only to the manager. | TFC uses an unnamed count ([§1.1](#11-the-food-corridor--count-based-inventory-no-map-utilization-via-a-report)); self-storage names units only because its units differ physically ([§1.3](#13-self-storage-software--the-richest-occupancy--unit-map-evidence)). |
| **A2** | **Assignment** — does the manager pick the unit, or the system? | **System auto-assigns the lowest free unit at approval; manager can "change unit".** | Self-storage auto-allocates then allows a change ([§1.3](#13-self-storage-software--the-richest-occupancy--unit-map-evidence)); keeps the renter flow to type + term + date. |
| **A3** | **Does a reserved-but-not-moved-in booking hold a unit?** | **Yes — it counts as occupied**; alert at **7 days**; manager can cancel to free it. | Self-storage tracks "awaiting allocation" as a real state ([§1.3](#13-self-storage-software--the-richest-occupancy--unit-map-evidence)); otherwise two members get the same shelf. |
| **A4** | **Out-of-service granularity** — per unit, or pause the whole listing? | **Pause the whole listing** for maintenance; per-unit **`needs_cleaning`** only. No per-unit maintenance in v1. | Neighbor deactivates a whole listing with a reason ([§1.2](#12-neighborcom--availability-as-a-move-in-blocklist-one-listing--one-space)); restraint budget ([§3.3](#33-c-manager-storage-board)). |
| **A5** | **"Available from {date}"** — show the exact free date, or just "Full"? | **Show "Available from {date}"** (earliest free date); use "Full" only when no unit frees within ~90 days. | Neighbor's blocklist already tells renters when they can move in ([§1.2](#12-neighborcom--availability-as-a-move-in-blocklist-one-listing--one-space)); it is the single most useful availability fact. |
| **A6** | **Manager board layout** — table (desktop) + cards (phone)? | **Yes:** rent-roll table on desktop, stacked cards at 390 px, one filled primary button per unit. | Self-storage dashboards + the consolidation §6/§7 finish ([§1.3](#13-self-storage-software--the-richest-occupancy--unit-map-evidence), `PHASE0_LOG.md:931-932`). |
| **A7** | **Is holdover a distinct board state, or folded into "Move-out due"?** | **Distinct state**, with its own alert and "Record removal" action. | Holdover is a money-accruing, blocking state (owner's daily-rate decision); folding it hides the accrual. |
| **A8** | **Cleaning buffer between occupants** — automatic, optional, or none? | **Optional per-kitchen toggle, default off**; manual "Mark ready". | Skedda's buffer time is configurable ([§1.4](#14-skedda--spacebring--nexudus--the-date-ranged-resource-booking-patterns)); a startup kitchen may not want a forced delay. |
| **A9** | **Waitlist** — build one now? | **No** (already decided); at most a hidden "notify me" when a type is Full. | No reviewed platform publishes a storage waitlist (`research-storage-structure.md` §1.1). |

---

## 5. Sources (URLs, checked 14 October 2026)

**The Food Corridor**
- https://help.thefoodcorridor.com/en/articles/1413924-set-up-your-storage-and-storage-fees
- https://help.thefoodcorridor.com/en/articles/1414037-how-do-i-add-storage-units-to-a-monthly-plan
- https://help.thefoodcorridor.com/en/articles/1531297-assign-clients-their-plans-storage-and-fees
- https://help.thefoodcorridor.com/en/articles/1413947-what-is-a-cancellation-policy-and-how-does-it-work
- https://help.thefoodcorridor.com/en/collections/822946-billing

**Neighbor.com**
- https://help.neighbor.com/en_us/managing-your-move-in-calendar-ry5kOtOTJe
- https://help.neighbor.com/en_us/how-to-approve-a-reservation-request-HkPmwR8RO
- https://help.neighbor.com/en_us/how-to-deactivate-or-delete-my-listing-HkoEvg9cc
- https://help.neighbor.com/en_us/hosting-basics-B1XBvA8RO
- https://help.neighbor.com/en_us/categories/managing-my-listing-H16IHvKT5

**Self-storage software**
- https://stora.co/features/self-storage-management-software
- https://stora.co/features
- https://www.storable.com/
- https://www.storable.com/resources/self-storage-kpis/
- https://www.storageunitsoftware.com/ (Easy Storage Solutions / Storable Easy)
- https://www.sitelink.com/ — **unreadable** (Cloudflare error 1009, region block); no SiteLink claim made

**Resource booking**
- https://www.skedda.com/features
- https://www.spacebring.com/features/room-booking
- https://nexudus.com/features

**Internal (read-only, cited above):** `research-storage-structure.md` (§1.5 commissaries, §4 owner decisions), `map-storage-current.md` (§8 absent capacity, §11 client surfaces, §12 risks), `PHASE0_LOG.md` (owner framing `:934`; premium/restraint `:931-932`; support-desk rule `:259`).
