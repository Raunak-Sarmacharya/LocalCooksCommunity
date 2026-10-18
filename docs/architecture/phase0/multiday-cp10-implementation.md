# CP10 — Multi-day kitchen invitations

Status: implemented and verified locally on 2026-10-18. No migration, provider call, deploy or push was made.

## Contract

An invitation is still the kitchen's pre-approval to one chef, with the same 0091 lifecycle
(`sent → accepted_pending_payment → accepted`, plus `declined/withdrawn/expired/superseded/unavailable`),
`version`, `requestKey` idempotency and `kitchen_invitation_events` outbox.

`kitchen_invitations.days_snapshot` (jsonb, migration 0099) is the only new state:

```json
[{
  "date": "2026-11-02",
  "pricingMode": "hourly",
  "slots": [{ "startTime": "10:00", "endTime": "11:00" }],
  "windowStartTime": "08:00",
  "startTime": "10:00",
  "endTime": "11:00",
  "equipment": [{ "listingId": 10, "name": "Mixer", "cents": 101 }],
  "listKitchenCents": 2002,
  "offeredKitchenCents": 1780
}]
```

- `days_snapshot IS NULL` → legacy one-date invitation. It keeps the old scalar columns, the
  `food-corridor-v3` disclosure, `equipmentIds` and the original preview/checkout path unchanged.
- `days_snapshot` non-null → a frozen day set. The legacy scalar columns mirror the **first** day
  (`date`, `startTime`, `endTime`, `operatingWindowStartTime`, `pricingMode`, `selectedSlots`) so old
  readers keep working.
- One day set may be a single day; it is still a dated contract, but exempt from the rollout gate
  exactly like a legacy single-day invitation.

## Creating and previewing

`previewKitchenInvitation` dispatches on `days`: a non-empty array goes to `previewDatedInvitation`,
anything else stays on `previewLegacyInvitation` (extracted verbatim).

Validation is the chef checkout's validator, not a copy:

```ts
validateBookingDays({ kitchenId, chefId, days, bufferMinutes, override,
  legacySingleDay: days.length === 1 })
```

It enforces the kitchen multi-day switch, effective days-per-booking limit, the 14-day span,
notice/advance window, opening hours, occupancy, buffer, longest/shortest booking, equipment
ownership and the chef's weekly hours. `platform_settings.booking_multiday_enabled` is read through
`kitchenBookingPolicies(...).multidayCreationEnabled`; a multi-day set fails with `MULTIDAY_DISABLED`
when the gate is off, while a one-day set is exempt. Nonconsecutive days are allowed.

Pricing:

1. Price every day at list (`priceBookingDays`): hourly rate × selected slots or the daily rate,
   plus each day's equipment at list (included items are 0).
2. `offeredInvitationSubtotal(listKitchenCents, discount)` — amount or percent, integer cents,
   **booking-subtotal floor of 100 cents** (not per day), and never above list.
3. Split the offered kitchen total over the listed day prices with `allocateCents` (largest
   remainder, stable day order for ties). The split is stored per day, so no reader can re-price it.
4. Tax on `offered kitchen + equipment at list`, then the standard `calculateCheckoutFeesAsync`
   service fee — identical arithmetic to a dated chef checkout.

Expiry is `min(now + expiresInHours, first day's start − (noticeHours × 60 + 37) minutes)`, in the
kitchen timezone. The 37-minute checkout buffer is the existing rule; it is anchored to the **first**
day, not each day.

`createKitchenInvitation` and `replaceKitchenInvitation` write `daysSnapshot` when present, insert
`created`/`sent` events in the same transaction, and return `invitationDto`. Duplicate `requestKey`
returns the same invitation (unique index race is caught and re-read).

## Checkout

`POST /chef/invitations/:id/quote` uses `datedInvitationCheckoutPricing(row, equipment)`:
`equipment` is `[{ date, equipmentIds }]`, each date must be an invited day, each id must belong to
the kitchen, and the result is frozen offered kitchen + per-day equipment at list + tax + fee.

`POST /chef/invitations/:id/checkout` calls `checkoutDatedInvitation` for a day set:

1. Rebuild the day set from the snapshot and the chef's per-day equipment.
2. Revalidate with `validateBookingDays(..., authorizedContract: true, bufferMinutes: row.bufferMinutesSnapshot,
   override: savedInvitationOverride(row))`. An already-sent invitation survives a later rollout
   shutdown; inventory is checked at payment time.
3. Build one `kitchen-days-v1` manifest whose day `kitchenCents` are the frozen offered shares and
   whose `invitation` block records the invitation id/version, list and offered subtotals and the
   per-day list/offered cents. `verifyDatedQuote` re-derives the split and rejects any tampering.
4. Reserve **all** days in one grouped hold (`reserveKitchenCheckoutGroup`), create the manual-capture
   session, bind it, then move the row to `accepted_pending_payment` with a
   `id = ? AND version = ? AND status = 'sent'` guard. If the invitation was replaced/withdrawn in
   the meantime, the session is expired and the hold released, and the route returns 409
   `version_conflict` — never a payable stale session.
5. One unavailable day fails the whole validation with `dayErrors` naming that date; nothing is held,
   nothing is created, and the invitation stays `sent` (the route's earlier availability check marks
   it `unavailable` with the kitchen's message).

## Fulfillment

`fulfillQuotedKitchenBooking` still dispatches on `booking_contract`/`quote_hash` to
`fulfillDatedKitchenBooking`. For an invitation:

- `invitationForDatedCheckout` requires the invitation row, its frozen day set, matching version,
  matching list/offered totals and status `accepted_pending_payment|accepted|unavailable`.
- Eligibility is re-checked before the booking transaction; loss marks the invitation `unavailable`
  and resolves the checkout conflict (cancel/refund) instead of booking.
- The parent booking stores `invitationId`; `requested` lifecycle is skipped because the kitchen
  already approved it. Per-day visits, equipment, allocations and payout rows are the normal dated
  ones.
- After commit, `acceptFulfilledInvitation` calls `decideAuthorizedBooking(bookingId, 'confirmed', ...)`
  — the same single capture/recovery command as any kitchen. `recordFulfilledInvitation` moves the
  invitation to `accepted` with `bookingId` inside that decision transaction.
- Replayed webhooks and a replayed auto-accept return the existing booking/decision and never capture
  twice. A conflict marks the invitation unavailable with a message naming the blocking day
  (“… All invited days must be booked together, so nothing was booked.”).

## Money flow — worked example (cents)

Two invited days at a 15% tax kitchen, 7% commission:

| Item | Cents |
| --- | ---: |
| Day 1: 2 hourly slots × 1001 | 2 002 |
| Day 2: full day at daily rate | 7 003 |
| **Listed kitchen total** | **9 005** |
| Offer: $10.00 off | −1 000 |
| **Offered kitchen total** | **8 005** |
| Allocation (largest remainder) | 1 780 + 6 225 |
| Tax 15% of 8 005 (1 200.75 → half-up) | 1 201 |
| Service fee 7% of 8 005 (560.35 → half-up) | 560 |
| **Chef pays / one authorization** | **9 766** |
| Stripe estimate `round(9 766 × 2.9% + 30)` | 313 |
| Manager receives `8 005 + 1 201 − 313` | 8 893 |

A mixer at 101 cents on day 1 would raise the subtotal to 8 106, tax to 1 216, fee to 567 and the
charge to 9 889; equipment is never discounted. Capture happens once for 9 766 (or 9 889) after the
booking commits, and the day allocations conserve the captured total.

Equal listed days split with the extra cent on the earlier date; a $1.00 offer on two equal days
still yields 100 cents in total (one day may receive 0).

## UI

- `ManagerInvitationNewPage` asks `GET /manager/invitations/kitchen-rules?kitchenId=` for the same
  switch/limit/timezone as a chef's booking flow. When multi-day is on it renders the CP8 day picker
  (`UICalendar mode="multiple"`, per-day status reasons, count/span blocking), a shared default plus
  per-day `Day type / Start / Length` editors (`ui/select`, `ui/time-select`) and per-day equipment
  checkboxes. The summary shows the listed total struck through, the offer, tax, fee, total, payout,
  expiry, warnings and per-day errors. When off, the original single `DateField` form is unchanged.
- `ChefInvitationPage` lists every day with its date, hours or “Full day”, and per-day equipment
  (included vs “$X per day”); the quote and checkout send `{ equipment: [{ date, equipmentIds }] }`
  and `DATED_DISCLOSURE_VERSION`. It shows one refund deadline for all days and that the card is
  charged in full when payment completes.
- Sent/admin lists use “N days · first date”; notices list every day
  (`invWhenDays`: “Mon, Nov 2 (10:00 a.m.–12:00 p.m.) · Wed, Nov 4 (Full day), Newfoundland Time”).
- Copy added in en-CA, fr-CA and uk; ICU plurals; `node scripts/i18n-lint.mjs` passes.

## Tests

New:

- `server/services/kitchen-invitation-days.test.ts` (14): exact allocation, stable ties, $1 floor,
  equipment excluded from the discount, checkout-day override validation, and quote-block
  accept/reject for above-list, below-floor, a day above list, a non-largest-remainder split and a
  changed date set.
- `server/services/dated-invitation-cp10.test.ts` (10, PGlite): frozen day set and split, equal-price
  ties, $1 floor, nonconsecutive +14 accepted / +15 refused, per-day equipment, expiry from the first
  start, duplicate request, legacy one-date regression with the gate off, one unavailable day naming
  the date, replaced/version-bumped checkout refusal, and one booking/one capture across duplicate
  webhooks and a replayed auto-accept.
- `client/src/pages/Invitations.test.tsx` (2 new, 12 total): multi-day manager picker with per-day
  equipment and the struck listed total, and the chef's day list with per-day equipment, one refund
  deadline and the dated checkout body.

Existing suites re-run: invitation, pricing, policy, decision, recovery and day-validation files
(68 tests) and the dated/fulfillment files `dated-booking-cp4/cp6/cp7`, `dated-booking-board` and
`booking-checkout-fulfillment` (115 tests) — all pass.

## Verification

- Focused CP10: 10/10.
- Invitation + day-validation: 8 files, 68/68.
- Dated + fulfillment: 5 files, 115/115.
- Client: 12/12.
- Full server suite once (`--reporter=dot`): 4 106 tests — 4 091 passed, 1 expected fail, 12 skipped,
  2 failed, both unrelated to this change:
  - `stripe-webhook-contract.test.ts › refuses live Stripe keys` — this worktree has no `.env`, so
    `STRIPE_SECRET_KEY` is empty; it passes with `STRIPE_SECRET_KEY=sk_test_contract`.
  - `kitchen-invitation-checkout.test.ts` — 5 s test timeout under full-suite load; passes alone in
    3.0 s (and with `--no-file-parallelism`).
- `npx tsc --noEmit -p tsconfig.json`: first run surfaced 13 errors in the new preview union/typing;
  fixed, second run exited 0.
- `node scripts/i18n-lint.mjs`: OK.

## Limits and deliberate choices

- No migration: 0099 already carries `days_snapshot`; 0091 ids/version/request keys/outbox are reused.
- Above-list offers cannot be expressed through the API (a discount can only lower the price). The
  defensive checks in `offeredInvitationSubtotal` and `verifyInvitationBlock` still reject a tampered
  above-list quote.
- No partial acceptance: one unavailable day blocks the whole checkout, by design.
- A duplicate checkout that begins after the first one bound is refused with `version_conflict`; the
  session it had just created is expired and its hold released. The route also refuses any row that is
  no longer `sent` before starting a new session.
- Dates and hours are the kitchen's offer; the chef may only change equipment per day.
- Not done: no Stripe/provider calls, database writes outside PGlite, deploy, push or PR; CP11's real
  PostgreSQL parity run remains.
