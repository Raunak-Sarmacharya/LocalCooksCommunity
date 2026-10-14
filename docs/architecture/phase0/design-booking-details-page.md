# Design spec: booking details page (chef + manager) — parent-authored 2026-10-14

Page: `client/src/pages/BookingDetailsPage.tsx`, shared by the chef (`/booking/:id`) and the manager (`/manager/booking/:id`; admin uses manager-like views). Build AFTER the UX sweep (`build-ux-sweep.md`) lands. That sweep owns copy and flows on the same files; this spec owns layout and hierarchy.

## What's wrong today (the owner's points plus the lead's review)
- The **who and when are missing from the header.** The chef shows up only in "Contact the chef" (as an email) near the bottom. Date and time sit in a separate Schedule card below.
- **Tag soup.** Three uppercase chips ("Confirmed", "Not Checked In", "Paid") plus a separate "Arrival not recorded" box squeezed into the header.
- **Unclear actions.** "Manage Booking" (vague), and a red primary "Visit inspection" shown days before the visit. There is no state-based "what should I do now".
- **Messaging.** "Message chef" exists (`openBookingConversation`, `POST /api/bookings/:id/conversation`) but is buried at the bottom and hidden while the request is pending. The contact card leads with a `mailto:`.
- **Visit code.** The visit code card renders a heading with nothing under it when there is no code.
- **Headings.** Section headings are ALL CAPS ("SCHEDULE", "PAYMENT", "NOTES"), mixed with sentence-case card titles.

## Deliberately NOT changing (already top-platform level; don't over-build)
- The payment/payout card content and its breakdown order (it matches Airbnb's itemized-below-total pattern; tidy only).
- The booking history list in the sidebar (collapse it, don't redesign it).
- The Local Cooks help box.
- No progress-stepper widget. Airbnb's reservation page doesn't use one; one status plus a "next step" line carries the same information with less noise.
- One page for both roles. Role-specific blocks swap in place; no separate pages.

## Layout

**1. Header (full width, one card)**
- Top line (muted, small): `KB-GNEWRD · Booked Oct 14, 2026`.
- **Manager:** an avatar (initials) and the **chef's name** (h1), with a subline "Kitchen session · PHASE0 Main Kitchen". **Chef:** the **kitchen name** (h1), with a subline giving the address (link to maps).
- **When**, prominent: `Fri, Oct 16 · 2:00–3:00 p.m. · 1 hr · Newfoundland Time`.
- **One status pill**, semantic colour: Request pending · Confirmed · Today · In session · Checkout to review · Completed · Cancelled · Declined/Expired. Check-in and payment states move into their own cards.
- **Next-step line** right under it (one sentence, state-based; the deadline banners from Package U move here):
  - manager, pending: "Respond by Oct 15, 12:54 a.m. or the request expires.";
  - chef, confirmed: "Arrival details arrive Oct 14, 2:00 p.m.";
  - and so on.
- **Actions** (right side; on mobile a sticky bottom bar):
  - Primary (one, state-based):
    - Manager: pending → **Review request**; checkout requested → **Review checkout**; completed → none. Otherwise there is no red primary.
    - Chef: within the check-in window or in session → **Open your visit**; pending → none.
  - Secondary, always: **Message {chef | kitchen}** (opens the platform conversation; allowed while pending too, if the API permits; otherwise list it as a gap).
  - Overflow "⋯" menu: Cancel or change booking, Fix the visit record (manager, after start), Download receipt/payout statement, Get help.

**2. Main column (left, about 2/3)**
1. **Visit** card: arrival method, plus the visit code (manager) or "Open your visit" with the instruction status (chef). The record status sits in one line ("Checked in 1:07 a.m. · checkout submitted 1:07 a.m."). Empty states are never a lone heading:
   - pending: "A visit code is created when you confirm this request.";
   - legacy (no challenge): "This booking uses tap check-in; no code needed.";
   - after the visit: "Arrived 1:07 a.m. with the visit code".
   - Before confirmation, hide the card entirely if it would only hold an empty state.
2. **When & where:** date, time, duration, kitchen, address with a map link, "Add to calendar" (ICS).
3. **{Chef} / {Kitchen} card:**
   - avatar initials, name, "Member since {month year}";
   - **Message** button;
   - the phone number as an underlined `tel:` link, **only once confirmed**, with the helper "For your safety, keep messages and payments in Local Cooks." (Airbnb advice);
   - email shown small and secondary (no mailto as the primary action).
4. **Add-ons** (equipment/storage), only if present.
5. **Note from {chef}** (special notes), only if present, quoted style.

**3. Sidebar (right, about 1/3)**
1. **Payment:**
   - manager: big "Your payout $27.32", payout timing/status, an expandable breakdown (total charged, service fee, processing fee, HST collected), "Download payout statement";
   - chef: big "Total paid $30.50", an expandable breakdown, "Download receipt".
2. **Cancellation** (chef): "Free cancellation until {deadline}" or the current rule in one line, plus the "Cancel or change" link.
3. **Activity:** the latest 3 events, plus "Show all".
4. **Help:** the Local Cooks support box (unchanged).

## Visual system
- Use the existing design tokens and components (Card, Badge, Button, DropdownMenu, Avatar if present).
- Spacing: card padding 20–24 px, gaps between cards 16–24 px. One accent (brand red) for the single primary action only.
- Headings: sentence case, 16–18 px semibold; no ALL CAPS section labels.
- Status pill colours: pending amber, confirmed/today blue, in session green, checkout to review purple, completed neutral, cancelled/declined grey/red.
- Numbers: tabular for money; 12-hour times; friendly zone label once in the header, not repeated on every line.
- Mobile (≤640 px): header stacks (name, when, status, next step); the sticky bottom bar holds primary + Message; the sidebar cards flow after the main column (Payment first).

## Acceptance (the lead will verify live on dev)
For each state (pending, confirmed-upcoming, today/in-window, in session, checkout requested, completed, cancelled), and for both roles:
- the header shows who, when, one status and one next step;
- at most one primary action;
- Message is reachable in one tap;
- there are no empty headings;
- there is no horizontal scroll at 390 px.
Keep existing behaviour and tests passing; update tests whose markup changes.
