# Multi-day kitchen bookings: owner-approved spec (Oct 17, 2026)

Supersedes the multi-day parts of `design-multiday-invites-extension.md` (Oct 13) where they differ. Research:
`research-multiday-kitchens.md` (Codex) and `research-multiday-spaces.md` (DeepSeek); key claims re-checked by the lead
(Peerspace per-day deadline clause; The Food Corridor repeat + end date).

## What peers do (short)
- Kitchen platforms (The Food Corridor, Skedda at kitchens): repeat bookings with an end date; each visit cancellable on its own.
- Peerspace: several dates in one request (even nonconsecutive), one approval, charged in full on approval.
- Airbnb / Turo / Vrbo: one continuous range (lodging, vehicles).
- Nobody lets the host accept only some days. Changes are requests; the original stands if declined.

## Decisions (owner, Oct 17)
| # | Topic | Decision |
|---|---|---|
| 1 | Shape | One booking = **any days the chef taps** (consecutive or not, e.g. Mon/Wed/Fri), up to the days-per-booking limit, **all within 14 days of the first day** (keeps the single refund deadline fair). Recurring/weekly bookings are out for now. (Owner revised from consecutive-only, Oct 17.) |
| 2 | Per-day hours | Each day is either a **full day** (daily rate) or **its own hours** (hourly rate). Default: same for all days; the chef can adjust any day. Kitchen min/max hours apply per day. |
| 3 | Closed or unavailable day | Can't be tapped; the picker says why (closed, booked, maintenance, too soon, beyond the advance window). No skip rule needed. |
| 4 | Limits | New setting **days per booking**: Local Cooks cap **14**, kitchen default **7** (location default + kitchen override, same pattern as the existing advance window). Advance window already exists (admin cap 90 today = owner's choice); new locations default to **60** days ahead (was 30); existing locations keep their value. |
| 5 | Kitchen's answer | **All or nothing**, within the existing 24 h / 1 h-before-deadline rule. Declining offers to message the chef or send an invitation for other days. |
| 6 | Charging | Card held for the whole booking at request; **charged in full when the kitchen accepts** (as today). |
| 7 | Refunds | **One refund deadline for the whole booking**: the kitchen's notice period before the **first day** starts (Vrbo rule). Before it: drop any days or cancel all, refunded minus the card processing fee on that part. After it: dropped days follow the kitchen's late charge with the **existing arithmetic** (50% kitchens refund half of those days' paid share minus the card fee on that half, i.e. 50% x (share - fee share), as single-day bookings do today; 100% kitchens refund nothing). The kitchen may refund more. |
| 8 | Drop a day | Before the deadline the chef can drop **any** day (the booking may then have gaps). |
| 9 | Change | One **change request for the whole booking** (days and each day's hours, same span rule), price difference shown, kitchen approves or declines, original stays if declined. Before the deadline only (existing change rules). |
| 10 | Kitchen cancels one day | That day: full refund incl. card fee, funded exactly like today's kitchen cancellation (kitchen debited its share, **Local Cooks absorbs the card fee**, Oct 14 rule). The chef may then drop the remaining days **without the late charge**, refunded minus their card-fee share (lead decision, owner may override); offer open until the next booked day starts. Those refunds come out of the kitchen's payout for those days. |
| 11 | Equipment | Chosen for all days by default; the chef can untick an item on any day. Each day only offers equipment free that day. Price = item price x days booked. |
| 12 | Payout | **After each day**, like a single booking (inspection finished, or 24 h after that day). Each day's allocated share is transferred separately. |
| 13 | Discount | None at launch; kitchens can send an invitation with a custom price. |
| 14 | Invitations | Kitchens can invite for several days (same rules), Peerspace invite-to-book style. Price stays a discount off the listed price with the $1 floor (Oct 14 rule); no above-list offers. |

## Kitchen controls (owner, Oct 17)
Research: The Food Corridor "booking buffer" (on/off, = slot increment, admin override); Peerspace buffers 30 min/1 h/2 h
before and after, existing bookings keep theirs; Skedda quotas (hours or bookings per day/week/month, blocked with a
message, admins override).
| Setting | Rule |
|---|---|
| Allow multi-day bookings | Switch. **On for every kitchen at launch**, "Up to [7] days per booking" (cap 14). Off = one day per booking. Kitchens told in the app. |
| Buffer between bookings | Off / 1 h / 2 h, **default Off**. Kept free between two different bookings; chefs can't pick hours inside it; existing bookings unaffected; the kitchen itself can still book inside it. |
| Longest booking | Today's "Max hours per day" renamed honestly: "Longest booking: [N] hours per day" (caps one booking's hours on a day). Applies to **hourly** bookings; full days stay allowed at the daily rate (as today), and the screen says so. **No cap by default** (owner, Oct 17): up to the kitchen's opening hours unless the kitchen sets a limit; existing settings kept. |
| Limit per chef | Optional "[N] hours per week" per chef at this kitchen. Counts **the whole calendar week, Monday–Sunday in the kitchen's time zone**, including days already used (Skedda-style); cancelled hours don't count; full days count as that day's opening hours. Blocked with a clear message; the kitchen can override. |
| Trusted-chef auto-approval | Not now (owner). |

Technical (lead): a buffer setting already exists as an on/off switch (60 min); it becomes Off/1 h/2 h. Each booking keeps the buffer that applied when it was made; between two bookings the larger buffer applies (not both added).

Carried over (owner, Oct 14): each day is its own visit (arrival window, check-in code, check-out, inspection, claim);
one 6-digit code per day; the kitchen can turn on self check-in for all days in one action; required tasks every day,
low-friction from day 2 ("Same as previous visit" — days may not be adjacent); a missed tap never affects other days; arrival details 48 h before the first day.

## Not in scope now
Recurring/weekly bookings, days more than 14 days apart in one booking, partial acceptance, length discounts,
hourly "same hours" templates across weeks.

## Manager settings audit (owner, Oct 17)
Every booking setting a kitchen manager sees was reviewed for intent and peer parity. Kept: advance notice, how far ahead
(cap 90), shortest booking, cancellation policy, extra time (auto-approve), damage & cleaning info, pricing (hourly, daily,
tax %), arrival timing. Changed: longest booking (no default cap), buffer (Off/1 h/2 h), kitchen "Terms and conditions" PDF
keeps its title with a subheading that it holds house rules and can't change Local Cooks booking/refund/payment/claim rules.
Removed: the legacy "Storage Overstay Penalties" page and its dashboard items (retired storage model; its charge action was
already refused server-side), and dead unrouted location-settings screens holding stale duplicate booking fields.

## Where each setting lives (owner, Oct 17)
Model: location defaults that a kitchen can override (The Food Corridor sets cancellation and scheduling rules once per
facility, with hours/rates per space). Every field must show its source ("Location default" / "Set for this kitchen · Use
the location's rule"); editing a location default warns how many kitchens use it; "Copy these rules to your other kitchens"
when a location has 2+ kitchens. Local Cooks overrides show locked with the reason (as extra time does today).
| Level | Settings |
|---|---|
| Location only | Terms and conditions / house rules (chefs apply to and accept terms per location), application requirements, arrival timing, **tax rate (HST %)** — moved from kitchen; kitchen pages show "Set for {location}" |
| Location default + kitchen override | Advance notice, how far ahead, shortest/longest booking, buffer, multi-day on/off + limit, **cancellation policy** (chefs still see and freeze the exact policy of the kitchen they book) |
| Kitchen only | Hourly/daily rate, opening hours, equipment, extra time auto-approve, **weekly hours limit per chef** (labelled "at this kitchen") |
HST (owner): HST on the kitchen price always goes to the kitchen, which remits it. Open for the accountant: HST on the Local
Cooks service fee (if Local Cooks is GST/HST-registered) and the registration number for receipts.

## Consistency with single-day bookings (owner, Oct 17)
A multi-day booking is the same booking with more than one day: same flow, words and rules (one refund deadline, same
late-charge arithmetic, same change request, per-visit lifecycle, per-visit payout). Equipment removal and extra time are
temporarily refused on multi-day until CP6 / a later checkpoint price them per day; they then work exactly as single-day.

**Kitchen declines an equipment item (applies to single-day AND multi-day; changes today's single-day behaviour):**
research — Airbnb (host can't edit a request; sends a special offer the guest must accept), Peerspace (invite-to-book the guest
accepts); no marketplace changes a guest's booking without consent. Owner: the chef must approve first.
1. Kitchen chooses "Accept without {item}" (days stay all-or-nothing): "We'll ask the chef to confirm the new total. Nothing
   is charged until they do."
2. Chef (in-app + email): "{kitchen} can host you, but can't provide {item}. New total ${new} (was ${old}). Accept or decline
   by {time}."
3. Accept -> capture the new total only; the rest of the hold is released. Decline or no answer -> full hold released, both told.
4. Chef's answer window: 24 h, or until 1 h before the refund deadline if sooner. Days stay reserved meanwhile; the kitchen's
   list shows "Waiting for the chef". No capture happens before the chef agrees, so no card fee is lost.
5. **Last-minute guard (lead pushback, owner approved Oct 17):** if that window would leave the chef less than 3 hours, or would end after the first
   booked start, the kitchen is not offered "Accept without {item}" (server refuses with a 409; the dialog disables item
   declines): "This booking starts soon, so there isn't time to ask the chef about a change. Accept the full request, or
   decline it and message the chef." with a "Message the chef" link.
6. The chef's copy names the exact deadline in the kitchen's zone ("Accept or decline by Tue, Oct 21, 9:00 p.m. Newfoundland
   Time") and what happens without an answer ("If you don't answer, the request closes and your card hold is released.").
   Built Oct 17: `partial-acceptance-implementation.md`. Money review fix (Oct 17): the chef's deadline is
   min(offer + 24 h, first start − (notice + 1) h) with no 30-minute floor, so the 3-hour guard always decides.

## Extra time rate (owner, Oct 17)
**Done.** All extra time (chef asks / early start / stay past the end) uses one hourly “extra time rate” at 1x.
Hourly kitchens use their hourly rate; daily-only kitchens set `extra_time_rate_cents` (required then). The rate is
snapshotted on each booking at creation (`kitchen_bookings.extra_time_rate_cents`) and shown to the chef before booking.
Multi-day works like single-day for the day the chef is on, paid with that day’s installment (CP5
`partitionDatedSupplement` / `syncDayPayoutSource`). See `extra-time-rate-implementation.md`.

## Remaining before multi-day is switched on (lead, Oct 17)
CP7 whole-booking change, CP9 kitchen/admin screens + communications + documents, CP10 invitations,
**extra time per day (done, Oct 17)**, CP11 real-Postgres parity + full live run-through on
dev (chef, kitchen, Local Cooks; Stripe checked), then the owner's team tests.
