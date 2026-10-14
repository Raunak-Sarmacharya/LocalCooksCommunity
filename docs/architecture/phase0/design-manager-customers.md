# Manager Customers, customer detail and Today: design

**Status:** proposal for owner review, 2026-10-13. Task `phase0-manager-customers-design-opus-r1-20261013` (read-only).
**Method:** repository reading at the current working tree, plus public help-centre research. No database, Stripe, Vercel or Inngest call was made. No source was edited. "Code-read" findings below are verified by reading source, not by a live or mocked test; each one names the test that should confirm it before a fix is claimed.
**Governing decisions:** `PHASE0_LOG.md` (Oct13 sections, D4–D11, ground rules), `continuation-handoff.md`, `manager-visit-preparation.md` (Manager Customers and Today proposal), `design-checkin-checkout.md` (§5 manager Today/Now board, §6 runtime), `audit-admin-support-controls.md`, `lifecycle-walkthrough.md`.
**Owner decisions applied:** access is approved per location (one application covers every kitchen there); terms are location-level only; a Customers area manages each customer individually with status and upcoming activity; customer feedback is private to Local Cooks; people are called by name (never "Chef" as a noun) and the company is "Local Cooks" (never "admin"); substantial tasks use full pages, dialogs only for short confirmations.

Vocabulary in this document: **customer** = a person with any relationship to one of the manager's locations (tour, application, access or booking). In user-facing copy the customer is always shown by name; "customer" is the area and role label only. Internal identifiers (`chefId`, `chef_kitchen_applications`) are unchanged.

---

## 0. One-page summary

**What exists.** A manager's knowledge of one person is spread across six places: the Applications page (sheet), the Bookings table, each booking's detail page, the Tours tab, Messages, and Overview counters. There is no customer list, no customer page and no per-customer notes. A complete "today" component (`TodaysKitchenBookings`) exists but is never mounted. The chat layer already models the right relationship key: one thread per **person × location** (`chef-{id}-location-{id}`).

**Correctness problems found while inventorying (fix before or with Customers):**

1. **Revocation does not stick.** Deleting the `chef_location_access` row is silently undone the next time the person tries to book, if their application is still `approved` (self-healing re-insert in `chef.service.ts:186-200` and `booking.service.ts:112-144`). The manager UI masks this only by also rejecting the application.
2. **Booking may be possible before the manager's final approval.** Submitting step-2 documents keeps the application `approved` and sets tier 2 (`chef-application.service.ts:486`; `kitchen-applications.ts:388-395`). The booking guard treats `approved && tier >= 2` as bookable and self-grants access (`chef.service.ts:186-206`, `booking.service.ts:124-131`), while every manager surface treats tier 2 as "awaiting your review". Code-read; confirm with a mocked checkout-route test.
3. **"Revoke access" in the UI is two non-atomic requests** that set the application to `rejected` (sending the *application rejected* email) and then delete the access row, behind a native `window.confirm`, with no handling of the person's future paid bookings (`ManagerKitchenApplicationsV2.tsx:462-489`).
4. **Polling cost.** The bookings table polls every 5 s while any request is pending, including in background tabs (`ManagerBookingsPanel.tsx:141-164`). Overview fires about nine independent 30-second polls plus one readiness query per kitchen (`use-manager-overview-activity.ts:46-90`). On the Hobby plan's shared 4 h/month CPU cap this is the largest avoidable manager-side cost.
5. **Customer documents are only checked at approval.** Expiry of a person's food-safety licence or establishment certificate after approval triggers no reminder, status change or booking block (only the *kitchen* licence has a sweep: `license-expiry.ts:1-20`).
6. **Account deletion purges history.** Deleting a person hard-deletes their bookings and payment-ledger rows at every manager's location (`user-deletion.service.ts:5-66`), so "former customers retained read-only" is impossible today.

**Recommendation.** Build Customers as a *read model over existing sources*, not a new workflow: one relationship row per person × location, one derived status, one canonical "next action / whose turn" function shared by the list, the customer page and Today. Add exactly two new write concepts, each behind its own migration approval: a durable access state (active / suspended / revoked with reason and notice) and private manager notes. Mount Today as the first block of Overview, fed by one aggregate query with no tight polling. Kitchen-restriction per customer is **P2 and not needed for the pilot**.

**Order (fits the owner's sequence arrival/departure → closeout → reminders → reviews → payout → policy engine):** CU0 access integrity (now, no migration) → CU1 Today (with arrival/departure) → CU2 Customers list and CU3 customer page (read-only, alongside closeout) → CU4a access state + notes (migration) → CU5 document-expiry reminders (with reminders) → CU6 feedback privacy (with reviews) → CU7 settlement in money summary (with payout) → CU4b revoke-with-refund and CU8 invite-to-book (with the policy engine). Details in §F.

---

## A. Current-state inventory

### A1. What a manager can see and do about one person today

| Need | Where it lives today | Evidence (file:line) | Gap |
|---|---|---|---|
| A list of people | No customer list. Applications page lists applications (tabs Pending / Awaiting application / Approved / Rejected); Tours tab lists tours; Messages lists threads. A person with a tour but no application only appears in Tours/Messages. | `client/src/pages/ManagerKitchenApplicationsV2.tsx:78-157` (filters); `client/src/pages/ManagerKitchenApplications.tsx:17-20` (re-exports V2, legacy body unused); `client/src/pages/ManagerBookingDashboard.tsx:1338-1347` (mount) | No single relationship list; no "needs action first"; no status vocabulary beyond application states. |
| The person's application and documents | Application detail sheet: business info, food-safety documents with status, expiry note, document viewer, Open chat, approve step 2, verify documents, revoke. | `client/src/components/manager/applications/components/ApplicationDetailPanel.tsx:121-133` (expired note), `:283` (Open chat), `:332-350` (documents), `:520-523` (revoke); viewer `DocumentViewerDialog.tsx`; server list `server/routes/firebase/kitchen-applications.ts:1766-1779`, by location `:1781-1815`, decision `:1852-2105`, document verify `:2109`, tier `:2198-2250` | Sheet, not a page; no booking/tour/money context; expiry shown only as a static note. |
| Document file access | Same-origin preview proxy; allowed for the location's manager or Local Cooks, for any application URL at any time. | `server/routes/files.ts:82-104` | No relationship-state limit (a long-revoked person's files stay viewable). |
| Approve / deny | Final approval grants `chef_location_access` and emails the person. Denial emails "rejected". Step 1 is Local Cooks only. | `kitchen-applications.ts:1881-1888` (tier gates), `:2058-2080` (grant on final approval), approval email from `:1936`, rejection from `:1997` | Works; lives in a sheet. |
| Revoke access | Menu item and sheet button → `window.confirm` → PATCH application `rejected` ("Access revoked by manager") → DELETE access row. | `client/src/components/manager/applications/columns-v2.tsx:335-344`; `ManagerKitchenApplicationsV2.tsx:462-489`; hook `client/src/hooks/use-manager-kitchen-applications.ts:213-240`; server DELETE `server/routes/manager.ts:4100-4123` (ownership guard repaired Oct 12, `PHASE0_LOG.md:131`) | Non-atomic, wrong email (application rejected), no reason/notice, no future-booking handling, no suspend; route comment `// ... delete chat ... update profile status ...` (`manager.ts:4116-4117`) shows unfinished side effects. |
| Bookings by this person | Bookings table (all people), filter by text; booking detail page per booking. Detail enriches name/phone from the application. | `client/src/pages/ManagerBookingsPanel.tsx:86-164`; `server/routes/manager.ts:3700` (`/bookings`), `:4320-4380` (details, name via application, phone only if verified at `:4374`); route `/manager/booking/:id` `client/src/App.tsx:397-403` | No per-person history; no outcome summary; 5 s background polling. |
| Today / live session | `TodaysKitchenBookings`: mobile cards + desktop table, live visit status, clear checkout, file claim, today's tours. **Never imported or rendered.** | `client/src/components/manager/TodaysKitchenBookings.tsx:149` (component), `:188-200` (15 s poll of `/bookings/upcoming`), `:221-233` (30 s tours poll), `:236-238` (browser-local midnight), `:292-294,336-338` (invalidates `/api/manager/bookings/today`, a key nothing queries), `:861` ("Filing a claim will charge the chef's payment method…"); only other reference is a comment at `client/src/components/manager/bookings/columns.tsx:124` | Unmounted; copy breaks naming rule and predates D8; wrong cache key. |
| Today's server feed | `GET /api/manager/bookings/upcoming`: all pending/confirmed bookings from yesterday onward (no upper bound), then **per booking** `ensureKitchenBookingVisits` and **per row** `getUserDisplayName`; day boundary uses `DEFAULT_TIMEZONE`. | `server/routes/manager.ts:4151-4285` (N+1 at `:4232`, `:4264`; zone at `:4160`, `:4225`) | N+1, unbounded, fixed zone, an "ensure" helper inside a GET. |
| Overview "today" | Overview computes today's sessions, pending items and an activity list from ~9 polled sources. | `client/src/components/dashboard/KitchenDashboardOverview.tsx:63-66` (browser-local `todayKey`), `:136-198`; `client/src/hooks/use-manager-overview-activity.ts:46-90` (7 sources + Stripe status + conversations, each `refetchInterval: 30_000`, plus per-kitchen readiness) | Counts, not a work board; browser zone; heavy polling. |
| Next-action rules | Pure functions for bookings, tours, overstays, licence. | `client/src/lib/manager-overview-lifecycle.ts:12-53`; `bookingNextAction` accepts `timezone` but computes end with `DEFAULT_TIMEZONE` (`:43,51`) | Client-only; zone parameter ignored. Good seed for a shared canonical function. |
| Tours | Tours tab and tour detail page; manager feedback; tour history. | `client/src/components/manager/ViewingsDashboard.tsx`; `server/routes/viewings.ts:1885` (`GET /manager`), `:1739-1880` (decision context, reschedule); schema `shared/schema.ts:2344-2380` (`kitchen_viewings`, location-level with `targetedKitchenId`) | Not linked to a person view. |
| Messages | Unified chat; one Firestore thread per person × location; eligibility = approved application **or** a qualifying tour. Booking pages can open the thread. | `server/chat-service.ts:48-62` (key `chef-{chefId}-location-{locationId}`), `:92` (metadata stores `managerId`); `server/services/shared-chat-access.ts:15-27` (eligibility), `:29-43` (`participantChatRelationships`: union of applications and tours per owned location); `server/routes/bookings.ts:75-101`; mount `ManagerBookingDashboard.tsx:1372-1385` | The relationship set the Customers list needs already exists here, but only for chat. |
| Claims and overstays | Separate pages and overview counters. | `server/routes/manager.ts:7327-7700` (overstays), `:8482-9136` (damage claims); `client/src/pages/ManagerOverstaysPage.tsx` | Not grouped by person. |
| Money per person | Revenue pages are per transaction/location. | `server/routes/manager.ts:189-969` (revenue/invoices/transactions) | No per-person summary. |
| Notes about a person | None. `kitchen_viewings.manager_notes` is legacy, Local Cooks-only; `shared_manager_notes` is a message to the person. | `shared/schema.ts:2369-2370` | No private manager notes. |
| Legacy/placeholder | `GET /chef-profiles` (legacy profile sharing), `GET /portal-applications`, `PUT /portal-applications/:id/status` returns 501. Migration 0013 calls `chef_location_access` deprecated while code treats it as authoritative. | `server/routes/manager.ts:3967-4095` (501 at `:4060`); `migrations/0013_add_chef_kitchen_applications.sql:9` | Remove or ignore in the Customers read model. |

### A2. Access model as implemented (verified by reading)

- Authoritative table: `chef_location_access (chef_id, location_id, granted_by, granted_at)`, no status columns (`shared/schema.ts:790-798`). No unique index on `(chef_id, location_id)` is declared in the repository schema or migrations; inserts rely on `onConflictDoNothing` (`chef.repository.ts:16-26`). **Verify the live index** in a later read-only DB task.
- `chef_kitchen_applications` has a unique `(chef_id, location_id)` (`migrations/0013…sql:80-84`), so **one application per person per location**: the natural relationship key.
- Booking guard (checkout `server/routes/bookings.ts:3106`, legacy create-intent `:2723`) → `chefService.getApplicationStatusForBooking` (`server/domains/users/chef.service.ts:92-146`) → `resolveApplicationAccess` (`:148-240`): access row ⇒ bookable; else application `approved && tier >= 2` ⇒ **re-insert access row** and bookable; else legacy `chef_location_profiles`. Same fallback in `booking.service.ts:105-143`.
- Revocation deletes the row only (`chef.repository.ts:28-37`). Because of the self-heal, revocation is durable only when the application is also non-approved. Local Cooks' own revoke (`server/routes/admin.ts:508-535`) deletes the row without touching the application, so **a Local Cooks revocation is undone on the person's next booking attempt** (code-read).
- Step 2 submission preserves `approved` and sets tier 2 (`chef-application.service.ts:476-487`; `kitchen-applications.ts:388-403`). Rejected/cancelled applications reset to `inReview` on resubmission (same service comment), so **denial is not final**: the person can re-apply.

### A3. Other cross-cutting facts the design depends on

- Location ownership is derived at read time from `locations.manager_id`; Local Cooks can reassign it (`server/routes/admin.ts:1543`). There is one manager per location; no team model.
- Tour feedback precedent: participants see only their own answers; conflict flags are private (`server/services/tour-feedback-service.ts:13,47`). Booking feedback/reviews do not exist yet (`lifecycle-walkthrough.md`, "No reviews").
- Support (D11) has no case view or notes yet; its proposed audit model is in `audit-admin-support-controls.md` §4.

---

## Research: how operators see their renters

"Documented" = stated in the cited page as retrieved on 2026-10-13. "Inferred" = reasonable reading, not stated, or only a title/snippet was available.

| Product | Operator view of a renter | Status |
|---|---|---|
| **The Food Corridor** (shared kitchens) | A **Clients** tab lists all food businesses with "Show Inactive"; each **client profile** has General (billing plan, per-client booking-approval setting, custom report fields, auto/manual payment, **Client Notes**), Statement (pending/due/past-due/failed/paid charges, past statements), Fees/Credits, Storage, Recurring Charges, **Documents** with expiration dates, **Bookings** (current and past by month), **Send Message**. [Function of each tab](https://help.thefoodcorridor.com/en/articles/1413937-what-is-the-function-of-each-tab) | Documented |
| | **Onboarding prospects** are separate from clients; a prospect can be flagged *Delayed*; approving moves them to Clients "and will be able to start booking time in your kitchen". [Onboarding prospects](https://help.thefoodcorridor.com/en/articles/6156959-how-do-i-manage-my-onboarding-prospects); guided checklists in [Onboarding Flows](https://thefoodcorridor.com/?p=7079) | Documented |
| | **Document expiry:** reminders to both kitchen admin and client **45, 14 and 3 days** before expiry; alert when a client uploads/updates a required document; kitchen-wide "Disallow booking until client's required documents are current"; **per-client override** of the requirement. [Kitchen and client documents](https://help.thefoodcorridor.com/en/articles/1413932-add-kitchen-and-client-documents) | Documented |
| | Per-client **auto-approve bookings** setting. [Automatically approve bookings](https://help.thefoodcorridor.com/en/articles/1413992-what-does-the-automatically-approve-bookings-setting-do) | Documented (search snippet) |
| | **Restricting which resources a client can book:** the Calendars collection lists an article titled "Restricting Access to Space Calendars"; its body could not be retrieved. [Calendars](https://help.thefoodcorridor.com/en/collections/3119939-calendars). **Client groups** with permissions: no source found. | Inferred / not verified |
| | PIN/phone sign-in/out per client. [Sign in/out](https://help.thefoodcorridor.com/en/articles/1414030-how-do-i-digitally-sign-in-out-at-my-kitchen) (already cited in `continuation-handoff.md`) | Documented |
| **Skedda** (space booking) | **User tags** act as groups; tags drive **space visibility**, **who can book** (e.g. only the Community tag), booking conditions, quotas, booking windows and approval rules; users cannot see their own tags; system users can break rules. [User tags](https://support.skedda.com/en/articles/105772-user-tags), [Booking requests & approvals](https://support.skedda.com/en/articles/11774950-booking-requests-approvals). Default: "everyone can book unless" rules prevent it. A per-user profile with history/notes is not described on these pages. | Documented (tags); profile inferred absent from these pages |
| **Peerspace** (hourly spaces) | Hosts work from an **Inbox** (threads per guest) and **Bookings** (with Past Bookings, each opening details and correspondence); **invite-to-book** is sent from an open guest thread; response time/rate is measured on inquiries. [Connect with guests](https://support.peerspace.com/en/articles/10119323-how-do-i-connect-with-guests-before-during-and-after-a-booking), [Past bookings](https://support.peerspace.com/en/articles/10119519-where-do-i-view-my-past-bookings), [Invite to book](https://support.peerspace.com/en/articles/10119469-how-do-i-use-the-invite-to-book-feature), [Response rate](https://support.peerspace.com/en/articles/10119527-what-is-my-response-time-and-response-rate). No host-side guest CRM page is documented. | Documented (inbox/bookings); CRM absence inferred |
| **Airbnb** (hosts) | **Today** tab lists current and upcoming reservations; completed under Earnings; cancelled via Messages filter. [Find reservations](https://www.airbnb.com/help/article/3037). Before booking the host sees a limited guest profile (first name, verification, reviews); full profile after booking. [Guest info shared before booking](https://www.airbnb.com/help/article/3143). Host forum posts describe Today sub-headings "Currently hosting / Arriving soon / Checking out / Upcoming" and report mis-grouping around midnight. [Forum](https://community.withairbnb.com/t5/Community-cafe/Incorrect-today-page-information/m-p/1633624) | Documented (help); sub-headings and defects anecdotal |
| **Cookhouse, CookItUp** | No product pages found under these names (searches returned Cook-Up, Cookitoo, Kitchup). Generic shared-kitchen suites (Spacebring, Optix) market member profiles, bookings and invoicing in one place. [Spacebring](https://www.spacebring.com/solutions/shared-kitchen-management-software), [Optix](https://optixapp.com/solutions-page-shared-kitchens) | Not verified; marketing only |

**What Local Cooks should take:**

1. **One profile per renter is the norm for shared-kitchen operators** (Food Corridor), combining status, documents with expiry, bookings, statement, notes and messaging. Marketplaces (Airbnb, Peerspace) are booking-centric and thread-centric instead. Local Cooks is both, so the customer page should be the operator profile, with booking and thread as deep links.
2. **Prospect vs client is a real distinction** (Food Corridor). It maps to Local Cooks' tour-only / applied / in-review / approved states.
3. **Expiry reminders to both sides plus an optional booking block** is the documented shared-kitchen practice. Local Cooks already uses 30/7/0-day reminders for the *kitchen* licence; reuse that cadence rather than invent new numbers (Food Corridor's 45/14/3 is an alternative).
4. **Resource restriction is done by groups/tags** (Skedda) and by calendar access (Food Corridor, title only). Neither is a per-person kitchen allow-list in the help pages retrieved. This supports deferring restriction (P2).
5. **Today grouped by phase** (arriving / in session / checking out) is the Airbnb host pattern; the forum defects show the grouping must come from saved instants in the location's zone, not calendar-day buckets.

---

## B. Information architecture

### B1. The relationship and its status

**Key:** one relationship per `(person, location)`. Kitchens are not part of the key (owner decision: access and terms are per location). A person with relationships at two of the same manager's locations has two relationships and one customer page with a location switcher.

**Relationship sources:** application at the location ∪ tour at the location ∪ access row ∪ any booking at a kitchen of the location. This extends `participantChatRelationships` (`shared-chat-access.ts:29-43`, applications ∪ tours) with access and bookings, so legacy rows and access granted by Local Cooks are not missed.

**Derived status (one per relationship).** Display labels are the owner's filter names; the rule column is the derivation, in priority order.

| Display status | Rule (first match wins) | Whose turn by default | Notes |
|---|---|---|---|
| **Revoked** | Access state `revoked` (after CU4a). Before CU4a: application `rejected` with a manager revocation marker and no access row. | Nobody (relationship ended) | Read-only except Restore (§B4). Future bookings shown with their remedy state. |
| **Suspended** | Access state `suspended` (CU4a). | You (decide restore/revoke) | New concept; no booking or offer while suspended. |
| **Approved** | Active access row, or application `approved` with tier ≥ 3. | Depends on activity (§B3 next action) | "Can book every kitchen at {location}". |
| **In review** | Application `approved`, tier 2, `tier2_completed_at` set (documents submitted). Also an application with a pending document replacement after approval. | **You** | This is the only state where the manager decides access. |
| **Applied** | Application `inReview` at tier 1 (Local Cooks reviewing the initial request), or `approved` tier 1 / tier 2 without submitted documents (waiting for the person's documents). | **Local Cooks** or **{Name}** | Sub-label: "Local Cooks is reviewing" / "Waiting for {Name}'s documents". |
| **Former** | Application `rejected` (denied) or `cancelled` (withdrawn), or account closed, with no future bookings. | Nobody | Read-only history. Denied people may re-apply (current service behaviour). |
| **Prospect** (secondary chip) | Tour(s) but no application. | Depends on tour state | Not in the owner's list but needed so tour-only people are visible; shown as a chip under "All", not a primary filter. |

**Needs action** is a separate boolean, not a status: true when the next action's owner is **you** (manager) or a deadline is within 24 h. It drives sort order everywhere.

**One canonical next-action function.** Move today's client helpers (`manager-overview-lifecycle.ts`) into a shared pure module, e.g. `shared/customer-next-action.ts`, called by the list endpoint, the customer page and Today, so the three surfaces never disagree. It must take the location's timezone (fixing the ignored parameter at `manager-overview-lifecycle.ts:51`). Priority:

1. Reported problem open on a current visit (commitment problem) → **You / Local Cooks**.
2. Booking request awaiting your decision, with its response deadline → **You**.
3. Departure submitted, inspection due by {time} → **You**.
4. Payment recovery pending → **Local Cooks**.
5. Documents submitted for review → **You**.
6. Cancellation request awaiting decision (legacy flow, until D5/D6 ship) → **You**.
7. Tour request / reschedule / tour feedback due → **You**.
8. Required document expires in ≤ 30 days or has expired → **{Name}** (you are informed).
9. Waiting for {Name}'s documents → **{Name}**.
10. Local Cooks reviewing the initial request → **Local Cooks**.
11. Otherwise informational: "Next booking Tue 14 Oct, 9:00–11:00 a.m. NT" or "No upcoming bookings".

### B2. Customers list

**Placement.** New manager nav item **Customers** between Bookings and Applications. Applications remains for now as the review queue; in CU3 its rows deep-link to the customer page, and later it can become the "In review" filter of Customers. Route: a dashboard view `?view=customers` (consistent with today's `ViewType`, `ManagerBookingDashboard.tsx:164`), with list state in the URL (`status`, `q`, `location`, `sort`).

**Scope.** Uses the dashboard's selected location by default. Managers with several locations get a location selector with "All locations"; in "All", each person appears **once** with per-location status chips, and the row's status/next action is the most urgent of their relationships.

**Columns (desktop):** Name (and business name) · Status chip(s) per location · Next action and whose turn · Next booking (kitchen-local date/time, zone label in words) · Last activity · Open items count (requests, inspections, claims, unread messages). No email/phone in the list (detail only).

**Filters:** status chips with counts: All · Needs action · Applied · In review · Approved · Suspended · Revoked · Former (+ Prospect chip). Counts come from the same query (one `GROUP BY`).
**Search:** name, business name, email (server-side, prefix/ILIKE on the relationship's application name and the user's email; case-insensitive).
**Sort:** default **Needs action first**, then soonest deadline, then soonest next booking, then name. Alternatives: Name, Last activity, Next booking.
**Pagination:** 50 per page, keyset cursor; the selected filter, search and location persist in the URL so Back returns to the same view.
**Empty states:** "No customers at {location} yet. People appear here when they request a tour or apply." / filtered: "No one is in review right now."
**Unread messages:** merged client-side from the existing single conversations call (`getAllConversations`, already used by Overview) by `(chefId, locationId)`; no per-row Firestore reads.

### B3. Customer detail (full page)

Route `/manager/customers/:customerId?location={locationId}` (full page, like `/manager/booking/:id`). Breadcrumb: Customers › {Name}. If the person has relationships at several of this manager's locations, a segmented location switcher sits under the header; every section below is scoped to the selected location except the header's access chips.

Sections, top to bottom (desktop uses a main column and a right rail; mobile stacks in this order):

1. **Header.** Name (from this location's application, else account display name); business name; email and phone (application contact for this location; phone only if verified, matching `manager.ts:4374`); "Customer since" (first approval) or "First contact" (first tour/application); **access status chip per location** ("Approved at Harbour Kitchens · Suspended at West End"). Primary actions live here (§B4). A person whose account is closed shows "Account closed" and no contact data.
2. **Next action** card: the canonical next action, the owner ("Your turn", "Waiting for Priya", "Local Cooks is reviewing"), the deadline in the kitchen's local time, and one primary button that opens the existing page for that task (booking review, inspection page, application review, tour). Never a dialog for the task itself.
3. **Now** (only when a visit is active today): kitchen, visit "2 of 3" if split, booked time, arrival recorded at / not recorded (neutral), departure submitted / inspection due by, assisted-entry link. Links to the booking page and inspection page. Same data contract as Today (§C).
4. **Upcoming bookings:** next 10, each with kitchen, local date/time and zone label, status (Requested — respond by …, Confirmed, Cancellation requested), add-ons, and link. "Show all".
5. **Past bookings with outcomes:** most recent 10 + cursor. Outcome is explicit and actor-specific: Completed (cleared by you / closed automatically after the review window), Cancelled by {Name} (refund $x), Cancelled by you, Declined (hold released), Request expired, Attendance reported by Local Cooks, Claim filed. Never "no-show" from a missing tap.
6. **Applications and documents:** current application with stage timeline (requested → Local Cooks approved → documents submitted → you approved); each document with status (Pending / Verified by Local Cooks / Verified by you / Needs replacement), **expiry date and countdown** (amber at ≤ 30 days, red at ≤ 7 days and expired, using the kitchen-licence cadence), View file (see §D for when files are viewable). Full-page review route for "In review" (replacing the sheet for this task).
7. **Tours:** each tour with date/time, kitchen shown, status, your own feedback if submitted. Never the person's feedback or Local Cooks' conflict flags.
8. **Messages:** last 3 messages of the person × location thread and "Open conversation" (existing messages view, deep-linked by conversation). Reply inline is P1; the thread itself stays in Messages to avoid a second chat implementation.
9. **Money summary** (this location only): Paid (captured, gross), Refunded (verified), Held (authorized requests not yet captured), Outstanding (approved claim/overstay amounts unpaid or failed). Per-booking rows link to the booking. Never card brand, last four, Stripe IDs or the person's payment method. Fee lines only when > 0 (D2). After payout work (CU7) add settlement state per booking (transferred / waiting for closeout) as a separate column.
10. **Claims and overstays:** each damage claim and storage overstay with status, amount, next actor and deadline, linking to the existing claim/overstay pages.
11. **Activity timeline:** reverse-chronological, 20 items + cursor, merged from existing histories (booking lifecycle events, attendance events, application stage timestamps, tour events, claim and overstay history, access events once CU4a lands, your notes as "Private note"). Each item shows actor ("You", "{Name}", "Local Cooks on behalf of you") and kitchen-local time. Excludes Local Cooks internal notes, support cases, feedback and email delivery internals.
12. **Private notes** (right rail on desktop, last on mobile): short notes (≤ 2,000 characters) with author and time, editable by author, soft-deleted with a trace. Banner: "Visible to you and Local Cooks support. Never shown to {Name}." (CU4a, migration.)

### B4. Manager actions per status, with guardrails

| Status | Actions available | Guardrails |
|---|---|---|
| Prospect | Message (if a qualifying tour grants chat); manage tour (existing pages). | No access action; nothing to approve. |
| Applied | Message (if eligible); view what has been submitted. | Step 1 decision is Local Cooks' (`kitchen-applications.ts:1881-1888`); show "Local Cooks is reviewing" instead of disabled buttons. |
| **In review** | **Approve** (grants booking at every kitchen of the location); **Deny** with a required message to the person; verify/reject a document; message. | Full-page review shows every required document with expiry; Approve blocked while a required document is missing, rejected or expired (existing validation `kitchen-applications.ts:1889-1906`). Short confirmation dialog states the effect ("Priya can book all 3 kitchens at Harbour Kitchens"). Deny copy is "not approved", not "revoked". |
| **Approved** | Message; **Suspend**; **Revoke**; view documents; add note; *Invite to book* (future hook, hidden until the offers feature exists); *Restrict kitchens* (P2, hidden). | See suspend/revoke rules below. |
| **Suspended** | **Restore**; **Revoke**; message; note. | Restore re-enables booking immediately and notifies the person. |
| **Revoked** | **Restore** (re-approve without a new application, with confirmation); message only while a booking remains or a claim is open; note. | Restore is logged with reason; it is the only way back in (prevents the self-heal path). |
| Former | Read-only; note. | Denied people can still re-apply through the normal flow. |

**Suspend** = temporary pause at one location. Effects: no new booking requests, checkouts or offers at that location; pending (held) requests are listed and the manager must decide each one (decline releases the hold, D4); **confirmed bookings stay valid** unless the manager cancels individual ones through the normal manager-cancellation remedy (§E2); messaging and documents stay available. Required: reason code (Documents expired · Payment issue · Kitchen rules · Safety · Other) and a message to the person (prefilled per reason, editable). Notice: email + in-app notification to the person by name, stating what is paused and what happens to each upcoming booking. Two-step on the full page, then one short confirmation dialog.

**Revoke** = end the relationship at one location. Effects: no new bookings or offers; re-application blocked until the manager restores; thread closes for new messages after the last booking and any open claim close. **Never strands a paid future booking.** The page lists every future booking and requires one explicit choice, before the action is enabled:

- **Honour existing bookings, then end access** (default). The person keeps confirmed bookings; access state is `revoked` with `effective_after = last booking end`; they cannot add more.
- **Cancel upcoming bookings with a full refund.** Available only once the manager-initiated cancellation remedy exists (policy-engine checkpoint; funding of the Stripe fee is the open owner question in `audit-admin-support-controls.md` §5 Q1). Until then this option reads "Ask Local Cooks to cancel and refund" and opens a support request prefilled with the bookings; access is still revoked for new bookings immediately.
- Pending requests: decline each (hold released) as part of the same flow.

Revoke also requires a reason code and a message to the person, and records actor, time and affected booking IDs (§F data). A paid booking is never cancelled as a side effect of an access change.

**Message:** opens the person × location thread (existing eligibility: approved application or qualifying tour, `shared-chat-access.ts:15-27`). For suspended/revoked people with remaining bookings, messaging stays open.

**Invite to book with a custom offer (future hook):** button shown only for Approved relationships when the before-confirmation offers feature ships (`manager-visit-preparation.md`, "Before-confirmation invitations and offers"). It opens a full-page offer composer prefilled with this person and location. Not part of any Customers checkpoint before the policy engine.

**Restrict to certain kitchens — P2, not needed for the pilot.** Reasons: the owner chose location-level access and terms, with kitchen differences in per-kitchen rules and instructions; the documented industry mechanism is group/tag rules (Skedda) rather than per-person allow-lists; and a restriction needs enforcement in availability listing, checkout, offers, change requests and the customer's own UI, which is a wide surface. If a concrete pilot need appears (e.g. one kitchen needs extra certification), implement as `allowed_kitchen_ids` on the access row (NULL = all), enforced in `getApplicationStatusForBooking` and availability, shown to the person ("You can book: Pastry Room, Main Kitchen"), and logged as an access event.

---

## C. Where Today fits

**Placement.** Today is the first block of the manager **Overview** and a nav destination **Today** (same component, full width), as proposed in `design-checkin-checkout.md` §5. It replaces the unmounted `TodaysKitchenBookings` (reuse its mobile card/desktop table layout and inspection hand-off, drop its dialogs-for-tasks and polling) and replaces Overview's "today" counters.

**Groups** (computed on the server from saved UTC instants and the location's zone; a visit appears in exactly one group):

| Group | Rule | Row shows | Row action |
|---|---|---|---|
| **Needs you now** | Open reported problem; inspection deadline passed or ≤ 30 min; booking request whose response deadline is today; payment recovery pending. | Name, kitchen, what is due, deadline | Opens the task page (booking review / inspection / problem). |
| **Arriving** | Confirmed visit starting today (location-local), arrival not recorded, end not passed. After start: neutral "Arrival not recorded yet". | Name, kitchen, visit n of m, local time, access/code note when that feature exists | Booking page; name → customer page. |
| **In session** | Arrival recorded, scheduled end not passed. | Name, kitchen, "until 6:00 p.m.", arrived at | Booking page; assisted departure. |
| **Needs inspection** | Departure submitted, inspection open. | Name, kitchen, departed at, "inspect by 7:00 p.m." | Inspection page (`/manager/booking/:id/inspection`). |
| **Ended, departure not recorded** | Scheduled end passed, no departure recorded, not closed. | Neutral wording; never "overstay" or "no-show". | Booking page (assisted departure / report problem). After the closeout checkpoint this group shrinks to exceptions only. |
| **Tours today** | Confirmed/pending tours at the location today. | Name, time, kitchen shown | Tour page. |

Every name links to the customer page; every row links to its booking/tour page. Empty state: "No visits at {location} today." A date stepper (yesterday / today / tomorrow) covers late-night and next-day preparation without a calendar.

**Data contract.** `GET /api/manager/today?locationId=&date=` returns `{ serverNow, timezone, date, nextChangeAt, version, groups: {...}, counts }`. One aggregate SQL statement (bookings ⨝ kitchens ⨝ locations ⨝ visits ⨝ application name ⨝ open problems), bounded to the requested local day ± the open-inspection set. No `ensureKitchenBookingVisits` in the read path (visit creation belongs to confirmation, per `design-checkin-checkout.md` §3); names come from the join, not per-row lookups. Ownership is `locations.manager_id = me` in the `WHERE`, never a client filter.

**Refresh (Hobby-friendly).** Refetch on mount, window focus/reconnect, location/date change and after any mutation on the page; schedule one timer at `nextChangeAt` (the next arrival start, session end or inspection deadline) so groups move exactly on time without polling; a visible-tab backstop of **120 s** using `If-None-Match`/ETag (304 when unchanged); no polling in hidden tabs (`refetchIntervalInBackground: false`). Inferred cost: a board open 8 h/day with the backstop is ≈ 240 small invocations/day per tab, versus ≈ 5,760/day for today's 5 s bookings poll while a request is pending and ≈ 1,000+/hour for Overview's nine 30 s polls. CU1 also removes those polls from Overview and lowers the bookings table to focus/mutation refresh plus a 120 s visible-only backstop. No new cron, worker task or SSE.

---

## D. Privacy and permission rules

1. **Scope.** Every customer, Today and document query filters by `locations.manager_id = current manager` on the server, inside the SQL, for every source table. A person's relationships at other managers' locations are invisible: no counts, no "also books elsewhere", no cross-location booking history, no shared notes. Tested with a foreign location fixture (mocked) and, if the owner approves a second synthetic manager, live.
2. **What a manager never sees.** Other managers' data; Local Cooks internal notes, support cases and actions not involving them; booking or tour feedback written by the person or Local Cooks' conflict flags (a manager sees only their own submitted feedback, following `tour-feedback-service.ts:47`); card brand, last four, Stripe customer/payment-method/charge IDs; email delivery internals; the person's other applications.
3. **Documents only while relevant.** File view allowed while the relationship is In review, Approved or Suspended, and while a claim or dispute involving the person at that location is open. After Revoked/Former: metadata only (type, status, expiry, verified by); file access removed after the last booking and claim close. This narrows the current preview route (`files.ts:100`, any time for the owning manager). Local Cooks support keeps access for D11 work.
4. **Former customers are retained read-only:** bookings, outcomes, money summary, claims, timeline and notes stay visible to the location's manager. No actions except notes and Restore (for revoked).
5. **Private notes:** owned by the **location** (they pass to a new manager on reassignment with author names preserved), visible to the location's manager and Local Cooks support, never to the person or to other managers. Copy in the note box warns that notes may have to be disclosed if the person requests their personal information (Canadian privacy law gives individuals a right of access; counsel to confirm wording). No sensitive categories (health, etc.) prompts.
6. **Deletion and retention.** Today deletion purges bookings and payment rows (`user-deletion.service.ts:5-66`). Target: when a person closes their account, **anonymize** the person (name → "Former customer", contact removed, documents deleted after the retention period) but **retain bookings, payment ledger, claims and access events** for financial record-keeping (Canadian business records are generally kept six years; counsel to confirm), shown to the manager as "Account closed". Deletion is refused while future paid bookings or open claims exist, with a path to cancel under policy first. This changes a Local Cooks-owned service and needs owner approval (§H).
7. **Local Cooks acting on behalf (D11).** Support can open any customer page read-only with a permanent "Viewing as Local Cooks" banner, and can perform the same access actions with actor = staff, acting-for = manager, reason, and notice to both; the manager's timeline shows "Local Cooks on behalf of you". Support uses explicit staff routes, never the manager's session.

---

## E. Edge cases

| # | Case | Behaviour |
|---|---|---|
| E1 | **Same person at two of this manager's locations** | One list row in "All locations" with two status chips; scoped views show only that location's relationship. Customer page has a location switcher; header shows both access chips; actions, notes, money, thread and documents are per location (separate threads exist today: `chef-{id}-location-{id}`). Suspending at one location does not affect the other. |
| E2 | **Access revoked with upcoming paid bookings** | Revoke flow forces a choice per §B4: honour then end (default), or cancel with full refund once the manager-initiated remedy exists, else "Ask Local Cooks". Never auto-cancels. Pending holds are declined explicitly. Person is told exactly which bookings remain. Today/customer page show "Access ends after 21 Oct" on those bookings. |
| E3 | **Application without a booking** | Normal: Approved with "No bookings yet". Next action informational. Optional nudge is out of scope (no marketing email without a decision). |
| E4 | **Tour without an application** | Prospect chip; customer page shows tours and (if the tour qualifies) the thread; no access actions; next action follows tour rules. |
| E5 | **Required document expires mid-booking** (CU5) | Reminders to both at 30/7/0 days (existing licence cadence). On expiry: document status → expired; **new** bookings at that location are blocked if the document is required by the location's requirements (Food Corridor pattern), with a per-person manager override recorded as an access event; **existing confirmed bookings are not auto-cancelled**; a visit in progress is never interrupted. Customer page and Today show an amber "Food safety licence expired 12 Oct" flag. Any cancellation for compliance goes through the manager-cancellation remedy or Local Cooks. |
| E6 | **Account deleted** | Today: history purged (A2/D6 gap). Target: anonymized "Former customer — account closed", history retained read-only, documents removed, thread read-only. Deletion blocked while paid future bookings/open claims exist. |
| E7 | **Manager reassigned** (Local Cooks changes `locations.manager_id`) | Read model follows the location automatically: new manager sees all relationships, history and location-owned notes; previous manager loses access immediately. Verify in CU3 that Firestore thread metadata (`chat-service.ts:92` stores `managerId`) is re-read or updated so messages route to the new manager; open bookings' pending decisions transfer. Timeline records "Location transferred to {new manager} by Local Cooks". |
| E8 | **D11: Local Cooks acts on behalf** | §D7. Support can approve/deny for the manager only with a recorded manager instruction; suspend/revoke/restore with reason and notice to both; actions show provenance in both parties' timelines. |
| E9 | **Revoked person's access re-created by self-heal** | Eliminated by CU0 (tier ≥ 3 gate) and CU4a (self-heal never overrides a non-active access state). Regression test: revoke → checkout refused. |
| E10 | **Booking attempted at tier 2 (documents submitted, not yet approved)** | Refused with "Your documents are with {location} for review" after CU0. Regression test on the checkout route. |
| E11 | **Denied person re-applies** | Allowed (current service resets to `inReview`). Appears as In review again; prior denial visible in the application timeline. A revoked person cannot re-apply until restored. |
| E12 | **Bookings that predate any application** (legacy profile access) | Relationship source includes bookings and access rows, so the person still appears; status "Approved (legacy)" until reconciled. |
| E13 | **Split visits / overnight** | Today shows "Visit 2 of 3" and groups each visit separately; the customer page lists the booking once with per-visit outcomes. |
| E14 | **Location deleted or kitchen unlisted** | Kitchen unlisted: existing bookings unaffected (current message, `chef.service.ts:102-117`); location deletion is a Local Cooks operation and already cascades; customer pages for that location become unavailable to the manager after deletion (retention per D6 is a Local Cooks concern). |
| E15 | **Same person, two simultaneous visits at one location** | Two Today rows; the customer page's Now section lists both. |

---

## F. Data and API plan

### F1. Read models (no migration)

**`GET /api/manager/customers?locationId=&status=&q=&sort=&cursor=`** — one SQL statement:

```sql
WITH loc AS (SELECT id, timezone FROM locations WHERE manager_id = $me AND ($loc IS NULL OR id = $loc)),
rel AS (
  SELECT chef_id, location_id FROM chef_kitchen_applications WHERE location_id IN (SELECT id FROM loc)
  UNION SELECT chef_id, location_id FROM kitchen_viewings      WHERE location_id IN (SELECT id FROM loc)
  UNION SELECT chef_id, location_id FROM chef_location_access  WHERE location_id IN (SELECT id FROM loc)
  UNION SELECT b.chef_id, k.location_id FROM kitchen_bookings b JOIN kitchens k ON k.id = b.kitchen_id
        WHERE k.location_id IN (SELECT id FROM loc) AND b.chef_id IS NOT NULL),
bk AS (SELECT b.chef_id, k.location_id,
         count(*) FILTER (WHERE b.status = 'pending')                 AS pending_requests,
         min(<start instant>) FILTER (WHERE b.status IN ('pending','confirmed') AND <end instant> > now()) AS next_start,
         bool_or(<any visit checkout_requested>)                      AS inspection_due,
         max(b.updated_at)                                            AS last_booking_activity
       FROM kitchen_bookings b JOIN kitchens k ON k.id = b.kitchen_id
       WHERE k.location_id IN (SELECT id FROM loc) GROUP BY 1, 2),
tr AS (... tours aggregated per chef/location ...),
cl AS (... open damage claims / overstays per chef/location ...)
SELECT rel.*, app.full_name, app.shop_name, app.status, app.current_tier, app.tier2_completed_at,
       least(app.food_safety_license_expiry, app.food_establishment_cert_expiry) AS next_doc_expiry,
       acc.chef_id IS NOT NULL AS has_access, bk.*, tr.*, cl.*
FROM rel LEFT JOIN chef_kitchen_applications app USING (chef_id, location_id)
     LEFT JOIN chef_location_access acc USING (chef_id, location_id)
     LEFT JOIN bk USING (chef_id, location_id) ... ;
```

Status and needs-action are computed in SQL via a `CASE` mirroring `shared/customer-next-action.ts` (unit tests assert the SQL and TS agree on a fixture matrix), so filtering, counts and keyset pagination happen in the database. Counts per status come from a second `GROUP BY` over the same CTE in the same round trip. Start/end instants use the location's zone (`(booking_date + start_time) AT TIME ZONE loc.timezone`), with the `operating_window_start_time` overnight rule from `shared/operating-hours`.

**`GET /api/manager/customers/:customerId?locationId=`** — one invocation, a fixed set of bounded queries keyed by `(chef_id, location_id)` run in parallel (header+relationship, upcoming ≤ 10, past ≤ 10 + cursor, active visits, application+documents, tours ≤ 10, money aggregate, claims/overstays, timeline ≤ 20 + cursor, notes). No per-booking loops. Returns 404 (not 403) when the location is not the caller's, matching the repaired guard style (`manager.ts:4111-4113`). The thread preview is fetched through the existing chat API only when the Messages section is visible.

**`GET /api/manager/today?locationId=&date=`** — §C.

**Indexes** (verify existing ones read-only first; add only what `EXPLAIN` on a seeded scratch database shows is needed): `kitchen_bookings (chef_id, kitchen_id)`, `kitchen_bookings (kitchen_id, booking_date)`, `kitchen_viewings (location_id, chef_id)`, `damage_claims (location_id, chef_id)`, `payment_transactions (chef_id, booking_type, booking_id)`, unique `chef_location_access (chef_id, location_id)` (not declared in repo; `onConflictDoNothing` needs it to be meaningful). Existing: applications unique `(chef_id, location_id)` and booking-check indexes (`0013…sql:56-84`), visits unique `(booking_id, block_index)` and review lookup (`0043…sql:25-29`).

### F2. New write concepts (each needs migration approval)

- **Access state** — add to `chef_location_access`: `status` (`active | suspended | revoked`, default `active`), `effective_after` (nullable, for "honour then end"), `reason_code`, `message_to_customer`, `status_changed_by`, `status_changed_at`, `acting_for` (`manager | local_cooks`), `revision`. Revocation **updates** instead of deleting. `resolveApplicationAccess` returns not-bookable for `suspended`/`revoked` and never self-heals over an existing row. Plus append-only `customer_access_events (id, location_id, customer_id, from_status, to_status, actor_id, actor_role, acting_for, reason_code, message, affected_booking_ids jsonb, remedy, created_at)`.
- **Private notes** — `customer_notes (id, location_id, customer_id, author_id, body ≤ 2000, created_at, edited_at, deleted_at, revision)`, index `(location_id, customer_id, created_at desc)`.
- Optional later: `allowed_kitchen_ids int[]` on the access row (P2 restriction).

Routes: `POST /api/manager/customers/:id/access` (`{ locationId, action: suspend|restore|revoke, reasonCode, message, bookingDisposition, expectedRevision }`) in one transaction with ownership, revision and booking-disposition checks; notices via the existing durable outbox; `POST/PATCH/DELETE /api/manager/customers/:id/notes`. Replace the client's two-request revoke with this single route; keep `DELETE /chef-location-access` as a compatibility wrapper that calls the same service.

### F3. Phased checkpoints

Each checkpoint is small, local first, with mocked tests and a live acceptance check on the guarded harness using synthetic manager 379 / person 380 / location 47 / kitchen 54 (and fixtures 118–126). Access-changing live tests should use a **new synthetic person** (owner-approved fixture) so 380's fixtures stay intact. No commit, push, deploy or migration without asking the owner.

| # | Checkpoint | When (owner order) | Migration | Live acceptance check |
|---|---|---|---|---|
| **CU0** | **Access integrity.** Gate `resolveApplicationAccess` and the `booking.service` fallback at tier ≥ 3 (final approval) instead of ≥ 2; single server revoke route (application stays as is, access row removed, revocation marker stored in the application feedback field until CU4a) with ownership guard, refusal when confirmed future bookings exist (lists them), and a truthful "access ended" notice instead of the rejection email; client calls it once behind a full-page confirmation step. | Now, alongside arrival/departure (bug fix) | No | Mocked: tier-2 checkout refused; revoke → checkout refused; foreign-location revoke 404. Live: synthetic person at tier 2 gets the refusal from `POST /api/chef/bookings/checkout` before any Stripe session; revoke then retry refused; SQL shows no access row, no Stripe object created. |
| **CU1** | **Today.** `GET /api/manager/today` aggregate + shared next-action module + Today block on Overview and nav; retire `TodaysKitchenBookings` and Overview's per-source polls; bookings table to focus/mutation + 120 s visible-only backstop. | With arrival/departure (uses its states) | No | Fixtures 118–126 land in the documented groups for kitchen 54 in America/St_Johns; one request per load, zero requests in a hidden tab for 5 min (browser network log), refresh at `nextChangeAt`; 390 px no horizontal overflow; names link to customer route placeholder. |
| **CU2** | **Customers list** (read-only): endpoint, nav item, filters/search/sort/pagination, unread merge. | With closeout | No (indexes only if `EXPLAIN` requires, separate approval) | Person 380 appears at location 47 with correct status and next booking; filter counts match SQL; search by name/business/email; Back preserves filters; mocked foreign-location rows never returned; query plan uses index scans on a seeded scratch DB. |
| **CU3** | **Customer page** (read-only): header, next action, Now, upcoming/past with outcomes, applications/documents with expiry countdown, tours, message preview, money summary, claims/overstays, timeline; full-page application review; Applications rows deep-link here; document file access narrowed per §D3. | With closeout | No | Page for 380 shows fixtures 117 (paid, completed), 122/123 (declined, hold released), 124/125 (closed inspection) with correct outcomes and money totals matching the ledger; no card data in the response JSON; manager reassignment and second-location cases covered by mocked tests. |
| **CU4a** | **Access state + notes**: migration, suspend/restore/revoke("honour then end"), access events, notes, notices. | After CU3 (independent of money) | **Yes** | Suspend new synthetic person → checkout refused with the suspension message; confirmed fixture booking unchanged; notice captured in SMTP sink; restore → checkout allowed; revoke with "honour then end" → `effective_after` set, new booking refused, existing visible; note visible to manager, absent from person's APIs. |
| **CU5** | **Customer document expiry**: add customer documents to the existing daily licence sweep (same 30/7/0 cadence, same `email_logs.tracking_id` idempotency), set document `expired`, block new bookings when a required document is expired, per-person override as an access event. | With reminders | Possibly (override flag) | Synthetic application with expiry in 7 days → one reminder to each side, none on the second sweep; past expiry → status expired, checkout refused, existing booking untouched. No new cron invocation. |
| **CU6** | **Feedback privacy**: when private booking feedback ships, customer page/Today/timeline include only the manager's own submissions. | With reviews | — | Participant-privacy tests: manager APIs never return the person's feedback or flags. |
| **CU7** | **Settlement in money summary**: per-booking transfer state (waiting for closeout / transferred / reversed). | With payout | — | Values match payout/transfer records for a sandbox fixture. |
| **CU4b / CU8** | **Revoke/suspend with "cancel and refund"** using the manager-initiated cancellation remedy; **Invite to book** from the customer page; optional kitchen restriction (P2) if approved. | With the policy engine | Depends | Cancel-with-refund on a sandbox booking refunds the decided amount once, notifies both, records the access event; offer flow per its own design. |

---

## G. Wireframes

### G1. Customers list — desktop

```
┌ Local Cooks · Kitchen ────────────────────────────────────────────────────────────────────────────┐
│ Today  Bookings  Customers●  Applications  Tours  Messages  Kitchens  Revenue        Harbour ▾    │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Customers                                                                    [Location: Harbour ▾] │
│ People who toured, applied or booked at Harbour Kitchens.                                          │
│                                                                                                    │
│ [Search name, business or email                    ]                     Sort: Needs action first ▾│
│ (All 42) (Needs action 5) (Applied 6) (In review 2) (Approved 27) (Suspended 1) (Revoked 1)        │
│ (Former 5) (Prospect 3)                                                                            │
│ ┌──────────────────────────┬──────────────┬──────────────────────────────┬─────────────────┬─────┐ │
│ │ Name                     │ Status       │ Next action                  │ Next booking    │Open │ │
│ ├──────────────────────────┼──────────────┼──────────────────────────────┼─────────────────┼─────┤ │
│ │● Priya Sharma            │ Approved     │ Your turn · Inspect by 7:00pm│ Today 4–6 pm    │ 2   │ │
│ │  Spice Route Catering    │              │                              │                 │     │ │
│ │● Marc Tremblay           │ In review    │ Your turn · Review documents │ —               │ 1   │ │
│ │  Tremblay Bakery         │              │                              │                 │     │ │
│ │● Dana Okafor             │ Approved     │ Your turn · Respond by 9 pm  │ Wed 15 Oct 9–11a│ 1   │ │
│ │  Ana Lima                │ Approved     │ Waiting for Ana · Licence    │ Fri 17 Oct 1–3p │ –   │ │
│ │  Lima Empanadas          │              │ expires in 6 days            │                 │     │ │
│ │  Sam Chen                │ Applied      │ Local Cooks is reviewing     │ —               │ –   │ │
│ │  …                                                                                         │ │
│ └────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ Showing 1–50 of 42                                                         [‹ Prev] [Next ›]   │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
 ● = needs action. Times are Newfoundland time (shown once in the header when all rows share a zone).
```

### G2. Customers list — mobile (390 px)

```
┌──────────────────────────────────┐
│ ☰  Customers           Harbour ▾ │
│ [Search                        ] │
│ (Needs action 5)(In review 2)(All│ ← horizontally scrollable chips
├──────────────────────────────────┤
│ ● Priya Sharma          Approved │
│   Spice Route Catering           │
│   Your turn · Inspect by 7:00 pm │
│   Next: Today 4–6 pm          ›  │
├──────────────────────────────────┤
│ ● Marc Tremblay        In review │
│   Your turn · Review documents › │
├──────────────────────────────────┤
│   Ana Lima              Approved │
│   Waiting for Ana · Licence      │
│   expires in 6 days           ›  │
├──────────────────────────────────┤
│          [ Load more ]           │
└──────────────────────────────────┘
```

### G3. Customer page — desktop

```
Customers › Priya Sharma
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Priya Sharma                                                     [Message] [Access ▾]  [⋯]       │
│ Spice Route Catering · priya@example.com · (709) 555-0142                                        │
│ ● Approved at Harbour Kitchens   ○ In review at West End        Customer since Aug 2026          │
│ [ Harbour Kitchens | West End ]   ← location switcher (only when 2+ locations)                   │
├──────────────────────────────────────────────────────────────┬───────────────────────────────────┤
│ NEXT ACTION · Your turn                                      │ PRIVATE NOTES                     │
│ Departure submitted 5:58 pm — inspect by 7:00 pm             │ Visible to you and Local Cooks    │
│ [Open inspection]                                            │ support. Never shown to Priya.    │
├──────────────────────────────────────────────────────────────┤ [Add a note…                   ]  │
│ NOW · Main Kitchen · Visit 1 of 1                            │ 12 Oct · You: prefers early slots │
│ Booked 4:00–6:00 pm · Arrived 3:57 pm · Departed 5:58 pm     │                                   │
├──────────────────────────────────────────────────────────────┤ MONEY · Harbour Kitchens          │
│ UPCOMING BOOKINGS                                            │ Paid          $412.50             │
│ Wed 15 Oct  9:00–11:00 am  Pastry Room   Confirmed        ›  │ Refunded       $28.43             │
│ Sat 18 Oct  1:00–5:00 pm   Main Kitchen  Respond by 9 pm  ›  │ Held           $61.00             │
│ [Show all]                                                   │ Outstanding     $0.00             │
├──────────────────────────────────────────────────────────────┤ [See bookings in Revenue]         │
│ PAST BOOKINGS                                                │                                   │
│ 12 Oct  5–6 pm  Main  Completed · cleared by you          ›  │ CLAIMS & OVERSTAYS                │
│ 08 Oct  2–4 pm  Main  Cancelled by Priya · refunded $28.43›  │ None open                         │
│ 03 Oct  9–10 am Main  Declined · hold released            ›  │                                   │
├──────────────────────────────────────────────────────────────┤ TOURS                             │
│ APPLICATION & DOCUMENTS                                      │ 02 Aug  Main Kitchen  Completed   │
│ Requested → Local Cooks approved → Documents → You approved  │                                   │
│ Food safety licence   Verified by you   Expires 20 Oct 2026  │ MESSAGES                          │
│                        ▲ expires in 7 days        [View file]│ Priya: Thanks! See you Wed.  2h   │
│ Establishment cert.   Verified by Local Cooks   Exp. Mar 2027│ [Open conversation]               │
├──────────────────────────────────────────────────────────────┴───────────────────────────────────┤
│ ACTIVITY                                                                                         │
│ 5:58 pm  Priya submitted departure · Main Kitchen                                                │
│ 3:57 pm  Priya recorded arrival                                                                  │
│ 11 Oct   You approved the booking for 15 Oct                                                     │
│ [Show more]                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### G4. Customer page — mobile

```
┌──────────────────────────────────┐
│ ‹ Customers                      │
│ Priya Sharma                     │
│ Spice Route Catering             │
│ ● Approved · Harbour Kitchens    │
│ [Message]          [Access ▾]    │
├──────────────────────────────────┤
│ YOUR TURN                        │
│ Inspect by 7:00 pm               │
│ [ Open inspection ]              │
├──────────────────────────────────┤
│ NOW · Main Kitchen               │
│ 4–6 pm · Arrived 3:57 · Left 5:58│
├──────────────────────────────────┤
│ Upcoming (2)                   › │
│ Past bookings (9)              › │
│ Application & documents  ▲ 1   › │
│ Tours (1)                      › │
│ Messages                       › │
│ Money: paid $412.50            › │
│ Claims & overstays: none         │
│ Activity                       › │
│ Private notes (1)              › │
└──────────────────────────────────┘
 Sections expand in place (accordion); long lists open full pages.
```

### G5. Access change — full page (revoke shown)

```
Customers › Priya Sharma › End access
┌──────────────────────────────────────────────────────────────┐
│ End Priya's access to Harbour Kitchens                        │
│ Priya won't be able to book any kitchen here.                │
│                                                              │
│ Reason  [ Kitchen rules ▾ ]                                  │
│ Message to Priya (sent by email and in the app)              │
│ [ Hi Priya, after the incident on 12 Oct we're ending …   ]  │
│                                                              │
│ Upcoming bookings (2)                                        │
│ ( ) Keep these bookings, then end access after 18 Oct        │
│ ( ) Cancel them with a full refund — ask Local Cooks         │
│ Wed 15 Oct 9–11 am Pastry Room   Paid $61.00                 │
│ Sat 18 Oct 1–5 pm  Main Kitchen  Request · hold $122.00      │
│        → this request will be declined and the hold released │
│                                                              │
│ [Cancel]                                   [Review & confirm]│
└──────────────────────────────────────────────────────────────┘
 Confirm dialog (short): "End access for Priya at Harbour Kitchens?
 2 bookings stay, 1 request is declined. Priya is notified." [Go back] [End access]
```

### G6. Today — desktop

```
┌ Today · Mon 13 Oct · Harbour Kitchens (Newfoundland time) ─────────────── [‹ Yesterday][Tomorrow ›]┐
│ NEEDS YOU NOW (2)                                                                                  │
│  Priya Sharma   Main Kitchen   Inspection due 7:00 pm (in 25 min)            [Open inspection]     │
│  Dana Okafor    Pastry Room    Booking request · respond by 9:00 pm          [Review request]      │
├────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ARRIVING (1)                         │ IN SESSION (1)                    │ NEEDS INSPECTION (1)    │
│  Ana Lima  Main  7:00–9:00 pm        │  Sam Chen  Pastry  until 8:00 pm  │  Priya Sharma  Main     │
│  Starts in 35 min                    │  Arrived 5:02 pm                  │  Departed 5:58 pm       │
├──────────────────────────────────────┴───────────────────────────────────┴─────────────────────────┤
│ ENDED, DEPARTURE NOT RECORDED (0)     TOURS TODAY (1)  Lee Park · 3:00 pm · Main Kitchen           │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
 Names → customer page. Rows → booking/tour page. "Arrival not recorded yet" is neutral wording.
```

### G7. Today — mobile

```
┌──────────────────────────────────┐
│ Today · Mon 13 Oct     Harbour ▾ │
│ Newfoundland time      ‹  ›      │
├──────────────────────────────────┤
│ NEEDS YOU NOW (2)                │
│ Priya Sharma · Main              │
│ Inspect by 7:00 pm   [Inspect]   │
│ Dana Okafor · Pastry             │
│ Respond by 9:00 pm   [Review]    │
├──────────────────────────────────┤
│ ARRIVING (1)                     │
│ Ana Lima · Main · 7–9 pm       › │
├──────────────────────────────────┤
│ IN SESSION (1)                   │
│ Sam Chen · Pastry · until 8 pm › │
├──────────────────────────────────┤
│ TOURS (1)                        │
│ Lee Park · 3:00 pm             › │
└──────────────────────────────────┘
```

---

## H. Owner questions (short)

1. **Restrict kitchens per customer for the pilot?** Recommended: **no** (P2). Kitchen differences stay in per-kitchen rules and instructions.
2. **Should managers see uploaded document files**, not just status and expiry? Recommended: **yes** while in review, approved or suspended (and during an open claim); metadata only afterwards.
3. **Private manager notes?** Recommended: **yes**, location-owned, visible to Local Cooks support, never to the person.
4. **Revoking someone with paid future bookings:** default "keep those bookings, then end access", with cancel-and-refund handled by Local Cooks until the manager-cancellation remedy exists? (Funding of the Stripe fee on kitchen-initiated cancellation is already open: `audit-admin-support-controls.md` §5 Q1.)
5. **Expired required document:** automatically block *new* bookings at that location (existing bookings untouched), with reminders at the existing 30/7/0-day licence cadence? Recommended: yes.
6. **Account deletion:** anonymize the person but keep bookings, payments and claims for record-keeping (and refuse deletion while paid future bookings or open claims exist), instead of today's purge? Recommended: yes, subject to counsel.

---

## Appendix: sources

Repository (read at the current working tree): cited inline as `path:line`.

External (retrieved 2026-10-13):
- The Food Corridor — [What is the function of each tab?](https://help.thefoodcorridor.com/en/articles/1413937-what-is-the-function-of-each-tab); [Add kitchen and client documents](https://help.thefoodcorridor.com/en/articles/1413932-add-kitchen-and-client-documents); [Manage onboarding prospects](https://help.thefoodcorridor.com/en/articles/6156959-how-do-i-manage-my-onboarding-prospects); [Automatically approve bookings](https://help.thefoodcorridor.com/en/articles/1413992-what-does-the-automatically-approve-bookings-setting-do); [Calendars collection](https://help.thefoodcorridor.com/en/collections/3119939-calendars); [Onboarding Flows](https://thefoodcorridor.com/?p=7079); [Digital sign-in/out](https://help.thefoodcorridor.com/en/articles/1414030-how-do-i-digitally-sign-in-out-at-my-kitchen); [Managing document compliance](https://www.thefoodcorridor.com/blog/managing-document-compliance/).
- Skedda — [User tags](https://support.skedda.com/en/articles/105772-user-tags); [Booking requests & approvals](https://support.skedda.com/en/articles/11774950-booking-requests-approvals); [Spaces](https://support.skedda.com/en/articles/6170041-spaces).
- Peerspace — [Connect with guests](https://support.peerspace.com/en/articles/10119323-how-do-i-connect-with-guests-before-during-and-after-a-booking); [Past bookings](https://support.peerspace.com/en/articles/10119519-where-do-i-view-my-past-bookings); [Invite to book](https://support.peerspace.com/en/articles/10119469-how-do-i-use-the-invite-to-book-feature); [Response time and rate](https://support.peerspace.com/en/articles/10119527-what-is-my-response-time-and-response-rate).
- Airbnb — [Find all your reservations as a host](https://www.airbnb.com/help/article/3037); [Guest info shared before booking](https://www.airbnb.com/help/article/3143); [Exploring your hosting tools](https://www.airbnb.ca/resources/hosting-homes/a/exploring-your-hosting-tools-738); host forum on Today grouping (anecdotal): [Incorrect today page information](https://community.withairbnb.com/t5/Community-cafe/Incorrect-today-page-information/m-p/1633624).
- Similar operator suites (marketing, inferred only): [Spacebring shared kitchens](https://www.spacebring.com/solutions/shared-kitchen-management-software); [Optix shared kitchens](https://optixapp.com/solutions-page-shared-kitchens).
- Cookhouse and CookItUp: no product documentation found; not used as evidence.
- Canadian record-keeping and privacy-access obligations (§D5–D6) are flagged for counsel and were not fetched in this task.
