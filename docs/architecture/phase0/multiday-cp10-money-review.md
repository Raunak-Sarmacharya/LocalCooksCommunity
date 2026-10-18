# Multi-day CP10: independent money review (Oct 18, 2026)

**Reviewer:** independent money review (read-only product code). Adversarial review of work by another model.
**Scope:** `git diff d3ef3f09^1 d3ef3f09` (merge `d3ef3f09`, “Merge multi-day CP10”) plus follow-up `5d30fac5` (copy only). Read against:
- `multiday-cp10-implementation.md`;
- owner spec row 13–14 (Discount / Invitations), row 12 (per-day payout), “Consistency with single-day bookings”, Extra time rate;
- style template `multiday-cp7-money-review.md`.

**Method:** code reading of the merge diff and live files at HEAD; wrote proof tests only in
`server/services/dated-invitation-cp10-money-review.test.ts` and ran
`npx vitest run --config vitest.config.server.ts server/services/dated-invitation-cp10-money-review.test.ts`
(8/8 passed). No product-code changes, full tsc, full suite, Stripe, live DB, deploy, or network beyond local install.

## Verdict

- Happy-path invitation money is sound: discount-only kitchen offer with a **$1 booking kitchen floor**, equipment excluded from the discount, frozen per-day kitchen split, one grouped hold, version-guarded bind, CAD manual-capture session, fee/tax/policy matching dated chef checkout, day-component allocations that conserve the charge, replay-safe fulfill + auto-accept, and `extra_time_rate_cents` snapshotted on invitation bookings (0104).
- **1 Must fix** before treating the invitation as a firm multi-day price: frozen `days_snapshot` equipment cents are display-only; quote/checkout reprice from live listings, so the chef can be charged far above the invited equipment line without a version bump.
- **2 Should fix**, **4 Notes**. No Blocker on the kitchen-discount / capture / allocation core.

## Ranked findings

### M1 (Must fix): frozen invitation equipment cents are ignored at quote and checkout

`server/services/dated-invitation-checkout.ts:56-69` (`listInvitationDays` → live `sessionRate`, then only `kitchenCents` overwritten from the snapshot);
`server/services/kitchen-invitations.ts:496-526` (`resolveInvitationEquipment` / `datedInvitationCheckoutPricing`);
compare create freeze at `kitchen-invitation-days.ts:63-67` and DTO at `kitchen-invitations.ts:441-442`.

- `days_snapshot` stores each invited day’s equipment as `{ listingId, name, cents }` at create time. Kitchen offered cents are correctly re-applied from that snapshot. Equipment cents are not: checkout rebuilds prices from the current `equipment_listings.session_rate`.
- The invitation UI/DTO therefore advertises create-time equipment prices that are not the payable contract. Tax and the 7% service fee ride the live equipment subtotal, so a listing hike moves the whole authorization.
- **Scenario (cents):** invite Mon 2h + Wed full day, mixer on Mon at **101**, kitchen list **9005**, amount discount **1000** → offered kitchen **8005**, create-time subtotal **8106**. After send, kitchen sets mixer `sessionRate` to **50000**. Chef pays with the invitation’s default equipment (no change). Quote/checkout subtotal becomes **58005**; charge **58005 + round(58005×0.15) + round(58005×0.07) = 66706**. Snapshot/DTO still show mixer **101**. Kitchen offered shares stay **8005** (correct); only equipment escapes the freeze.
- Proof: `dated-invitation-cp10-money-review.test.ts` — “M1: frozen days_snapshot equipment cents…”.
- **Fix (smallest fail-closed):** when resolving invitation checkout equipment, for each listing id present on that day’s snapshot, charge the frozen `cents` (or 409 `price_changed` if live ≠ frozen and the product wants a re-quote). Use live list only for ids the chef newly adds. Mirror the same rule in `datedInvitationCheckoutPricing` so the quote matches the session.

### S1 (Should fix): `booking.hourlyRate` / day `rateCents` snapshot the live list rate, not the invited kitchen rate

`dated-invitation-checkout.ts:59-67` (live rates into `listInvitationDays`); `dated-booking-fulfillment.ts:110` (`hourlyRate: String(first.rateCents)`);
compare single-day invitation checkout metadata at `routes/kitchen-invitations.ts:175` (`hourlyRateCents` derived from `offeredSubtotalCents`).

- Charged kitchen cents come from the frozen offer; the booking’s `hourlyRate` and each day’s `rateCents` / visit `priceSnapshot.rateCents` store whatever the kitchen’s list rate is at checkout. After a rate hike, ledger `kitchenCents` stay invited while `hourlyRate` shows the new list.
- Day refunds/payouts use allocation rows (safe). Extra time uses `extraTimeRateCents` (also snapshotted — verified OK below). Risk is any future or support path that reconstructs money from `hourlyRate × hours` instead of day allocations, plus inconsistency with single-day invitations.
- **Scenario:** invite at hourly **1001**; kitchen raises hourly to **5000** before pay. Capture kitchen lines still **8005** total offered; `kitchen_bookings.hourly_rate` becomes **5000**; `extra_time_rate_cents` becomes **5000** (hourly-kitchen rule).
- Proof: same fulfill test (“frozen offered kitchen survives a live rate hike…”).
- **Fix:** set manifest/`booking.hourlyRate` from the invitation’s effective kitchen rate (e.g. first day’s offered/list share semantics matching legacy), or store list rate explicitly under a non-money field and keep `hourlyRate` as the invited effective rate for parity with single-day.

### S2 (Should fix): `checkoutDatedInvitation` does not enforce `expiresAt` (or chef match) — route-only gate

`routes/kitchen-invitations.ts:119` (`status !== 'sent' || expiresAt <= now`);
`dated-invitation-checkout.ts:30-115` (no `expiresAt` / `row.chefId === chefId` check; bind only requires `status = 'sent'` + version).

- DB status stays `sent` after wall-clock expiry (`invitationStatusAt` is a read overlay). The HTTP route refuses expired rows; the service will still reserve, open a Stripe session, and move the row to `accepted_pending_payment` if called directly or if expiry races past the route check during session create.
- Same class of race exists on legacy single-day; CP10’s longer validate → group reserve → session path widens the window. Not a double-charge, but it can authorize past the invitation’s published expiry.
- **Scenario:** invitation `expiresAt` = T. At T−1s the route passes; session create finishes at T+5s; bind succeeds; chef has ~30 minutes on Stripe. Alternatively, any internal caller of `checkoutDatedInvitation` with an already-expired `sent` row gets a payable session.
- Proof: `dated-invitation-cp10-money-review.test.ts` — “S2: checkoutDatedInvitation does not refuse an expired…”.
- **Fix:** inside `checkoutDatedInvitation`, require `row.chefId === chefId`, `row.status === 'sent'`, and `row.expiresAt > now` before reserve; keep the version guard on bind.

### N1 (Note): first-day-only route availability marks `unavailable`; other-day failures leave `sent`

`routes/kitchen-invitations.ts:125-141` runs legacy first-day `validateBookingAvailability` before the dated branch; on failure `markUnavailable` (sent→unavailable).
`checkoutDatedInvitation` then runs full `validateBookingDays`; a closed non-first day throws `DatedInvitationRefused` and leaves status `sent` (builder intentional). Asymmetric lifecycle, not a wrong charge (nothing is held).

### N2 (Note): tax % and platform fee rate are live at checkout

Create stores `taxCents` / `serviceFeeCents` / `totalCents` on the invitation row; checkout recomputes from current `kitchens.taxRatePercent` and `platform_commission_rate` on the payable subtotal. Kitchen offer is frozen; tax/fee are not. Consistent with “re-quote fees at pay time,” but the invitation pricing panel can disagree with the Stripe total after a settings change. Fail closed on money (session amount wins).

### N3 (Note): percent discount is on kitchen list only

`offeredInvitationSubtotal(listed.listKitchenCents, discount)` then adds equipment at list. A “50% off” invite on kitchen **10000** + mixer **10000** yields offered subtotal **15000**, not **10000**. Correct per “equipment not discounted”; UI must not imply percent-of-(kitchen+equipment).

### N4 (Note): after accept, CP5–CP7 see a normal dated booking

Fulfillment writes the same `kitchen-days-v1` source, `allocateDatedCapture` parts, `payoutPartition: 'per_day'`, and `cancellation_policy_snapshot` with `deadlineBasis: 'booking_first_day'`. Invitation-originated bookings inherit prior dated money findings (e.g. CP7 keep-refund) rather than a separate invitation ledger. No CP10-specific refund/change fork found.

## Verified OK

1. **Discount-only + $1 floor (server):** `offeredInvitationSubtotal` refuses below **100** kitchen cents and any above-list result; create/preview cannot express a markup. `verifyInvitationBlock` re-checks offered ≤ list, per-day offered ≤ per-day list, offered ≥ **100**, and largest-remainder split. Proof: pure tests in the money-review file.
2. **Equipment excluded from the discount math:** offered kitchen allocated over list kitchen weights; equipment added at list into subtotal/tax/fee. Worked example **8005 + 101 → tax 1216, fee 567, total 9889**; `allocateDatedCapture` conserves with a **313** card-fee split (no 1¢ drift).
3. **Frozen kitchen split / tamper resistance:** checkout overwrites `kitchenCents` from `days_snapshot.offeredKitchenCents`; manifest `invitation` block must match `allocateCents`. Chef may only change per-day equipment ids (`invitationCheckoutDays`). Rate hike after send does not change offered kitchen lines (proof).
4. **One grouped hold + version guard:** `reserveKitchenCheckoutGroup` then bind; update requires `id + version + status='sent'`; conflict expires the session and releases the hold (proof).
5. **Replay / idempotency:** duplicate `fulfillQuotedKitchenBooking` + replayed `acceptFulfilledInvitation` → one booking, one payment row, one capture (proof + builder CP10 test).
6. **Currency:** dated invitation Checkout Session and PaymentIntent are `cad` (same as chef dated checkout).
7. **Extra time rate (0104):** fulfill sets `extraTimeRateCents: snapshotExtraTimeRateCents(kitchen)` — hourly kitchens snapshot hourly; daily-only snapshot `kitchens.extra_time_rate_cents` (proof with **2500**).
8. **Fee / tax / cancellation policy:** same `calculateCheckoutFeesAsync`, kitchen tax %, `booking_first_day` disclosure + sessions for every invited day — aligned with single-day dated checkout and legacy invitation fee arithmetic on the payable subtotal.
9. **Day ledger vs charge:** on fulfill, component allocations’ subtotal/tax/service sums equal `payment_transactions.amount` / captured intent amount (proof).

## Lead disposition

_(empty — awaiting fix round)_
