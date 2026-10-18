# Multi-day CP7: independent money review (Oct 18, 2026)

**Reviewer:** independent money review (read-only product code). Adversarial review of work by another model.
**Scope:** `git diff e46900cc^1 e46900cc` (merge `e46900cc`, “Merge multi-day CP7”). Read against:
- `multiday-cp7-implementation.md`;
- spec row 9 (Change), row 7 (refunds), row 12 (per-day payout), “Consistency with single-day bookings”;
- prior money-review style (`multiday-cp5-money-review.md`, `multiday-cp6-money-review.md`).

**Method:** code reading of the merge diff and live files at HEAD; ran
`npx vitest run --config vitest.config.server.ts server/services/dated-booking-cp7.test.ts server/services/dated-booking-cp7-money-review.test.ts`
(14/14 passed after S5 proof). No full tsc, Stripe, DB, deploy, or network. Proof tests only; product code untouched.
Second pass re-checked capture/refund idempotency, `applyAfterMoney` savepoint, finish/compensate, auth, quote hash, sessions-only deadline, builder limits, and keep-refund recovery; confirmed prior M1/M2/S1–S4 and added S5.

## Verdict

- Happy-path equal / negative / positive apply conserve each per-day source. Auth, quote hash, sessions-only deadline move, and superseded installment kill hold.
- **2 Must fix** before treating dated `close_keep_refund` as safe: (1) the chef can be refunded again for the same schedule cut *or* keep the LC cash and still move a full-value booking; (2) keep-refund unlocks full day entitlements the charge can no longer fund — and the **first** day’s transfer can still succeed against the residual. **5 Should fix**, **7 Notes**. No Blocker on the applied happy path; recovery `close_keep_refund` is the money hole.

## Ranked findings

### M1 (Must fix): after `close_keep_refund`, the same price-down change refunds the chef again

`server/services/dated-booking-changes.ts:134-135,219-236` (`termsOf` / `priceDatedChange`); `server/services/kitchen-booking-changes.ts:856-868` (apply savepoint); `:1025-1031` (dated keep-refund writes `outsideRefunds` with `kitchenDebitCents: 0` only); compare single-day headroom at `kitchen-booking-changes.ts:368-369`.

- Refund-then-apply failure: Stripe refund commits first; the DB transaction writes `changeGrossRefundOperations` / receipt reconciliation, then `applyAfterMoney`. Apply runs under a **savepoint**; on failure only the apply rolls back. The refund metadata and the Stripe refund remain. `refundsAllocated` is false until support acts (kitchen debit on the receipt, not yet on a day part).
- `close_keep_refund` marks that receipt Local Cooks-funded via `outsideRefunds` so CP5 can resume day payouts, and **leaves the original schedule and full active day ledger in place**. That is intentional for the stuck booking (builder report + CP7 test asserts `refundsAllocated` flips true).
- `priceDatedChange` rebuilds old totals only from **active** allocation cents. It never subtracts `outsideRefunds`, `changeGrossRefundedCents`, or `source.refundAmount`. Dated also has **no** `priorGross` cap (single-day `priceChange` uses `captured - max(priorGross, refundAmount)`). That single-day cap still allows **one** full replay of the same price-down after keep-refund (`gross = min(difference, captured - priorGross)` when `priorGross === difference`); dated has neither the weak cap nor a ledger shrink.
- **Scenario A (cents, double refund):** Mon/Wed/Fri captured **65880**, fee **1941**. Change to Tue 4h + Thu full day (new total **32940**). Refund **31969** (= **32940 − round(1941×32940/65880)**) succeeds; apply fails → `recovery_required`. Support `close_keep_refund`. Booking still revision 1 at **65880**; chef already holds **31969**. Chef requests the **same** cheaper schedule again. Quote again shows refund **31969**. Approve applies; Stripe refunds **31969** a second time (total refunded **63938**). Net left on the charge: **1942** for a **32940** booking. Local Cooks ate the first **31969** with no clawback; the second apply still kitchen-debits **30079**.
- **Scenario B (cents, keep cash + full booking):** same keep-refund seed. Chef instead requests an **equal-price** lateral move (e.g. Tue/Thu/Sat full days at the same rates: old = new = **65880**, pay **0**, refund **0**). Approve applies; schedule moves; **no clawback** of the LC-funded **31969**. Chef keeps the cash *and* three full days of kitchen time. (A later price-up is worse: chef pays only the delta on top of the kept refund.)
- Proof: `dated-booking-cp7-money-review.test.ts` — same price-down still quotes **31969**; equal-price preview quotes pay/refund **0** at **65880** while `refundAmount` stays **31969**.
- **Fix (smallest fail-closed):** in `ledger()`, if any `outsideRefunds` entry has `kitchenDebitCents === 0` (or any change-sourced outside refund), throw `datedChangeSupport` until support reconciles. Better: on keep-refund, write a settled `change-refund:<id>` allocation (and shrink “moved” the same way apply would) without moving visits, or reduce quote `oldTerms` by LC-funded outside refunds / `changeGrossRefundedCents` before computing the difference. Mirror single-day `priorGross` as defense in depth either way.

### M2 (Must fix): after `close_keep_refund`, day payouts resume for the full kitchen entitlement the charge can no longer fund

`kitchen-booking-changes.ts:1025-1031` (outsideRefunds unlock); `kitchen-day-payouts.ts:96-106` (`refundsAllocated` treats outside refund ids as allocated); `:31-40` (`dayEntitlement` ignores LC outside refunds); `:151-154` + `:233-242` (transfer uses `source_transaction` = charge; pre-create charge check only requires `amount_refunded === source.refundAmount`, **not** Σ entitlements ≤ residual).

- Keep-refund’s stated contract is “refund stands, funded by Local Cooks; the kitchen payout was not reduced further.” On a per-day source that means: chef already received **31969**, day ledger still shows full active parts, `refundsAllocated` flips true, so `refundPending` clears and installments prepare at full `dayEntitlement`.
- Transfers are funded from the original charge (`source_transaction`). After the keep-refund, Stripe residual ≈ **65880 − 31969 = 33911**. Full three-day kitchen entitlement remains **62100 − 1941 = 60159**. **60159 > 33911**.
- **Scenario (cents):** same keep-refund seed as M1. Monday installment prepares for **≈20053** (18000+2700−647). The charge check at `:234-236` passes (`amount_refunded` matches `refundAmount`). **Monday’s transfer can succeed** against the **33911** residual. Wednesday’s next **≈20053** pushes cumulative transfers past **33911**; Stripe rejects (or the second create fails closed after discovery). Friday never pays. The booking still looks fully entitled; support has no automatic path that turns the LC-funded change refund into day `managerDebitedCents`. Local Cooks “funding” the chef refund never tops up the charge, so the kitchen cannot be paid for all remaining days from that source — but **one day can already have been paid**.
- Proof: `dated-booking-cp7-money-review.test.ts` asserts `dayEntitlement === 60159`, `60159 > 33911`, and `20053 ≤ 33911 < 40106`.
- **Fix:** same fail-closed door as M1 (refuse money actions / payouts until the outside change refund is reconciled onto the day ledger), or on keep-refund write the settled `change-refund` part + `managerDebitedCents` split across days (or reduce each day’s entitlement by the LC-funded share) so Σ entitlements ≤ charge residual. Do not unlock `refundsAllocated` while live paid cents still equal the pre-refund capture.

### S1 (Should fix): draining a source’s full residual after a prior change refund can refuse with `refundReview` (1¢ fee-share rounding)

`dated-booking-changes.ts:226-229` (`kept > moved.fee`).

- Fee kept uses `Math.round(sourceFee × gross / sourceCaptured)` on the **full** original source, while `moved.fee` is only the fee left on active rows after a prior applied change refund.
- **Scenario:** first applied change refunds gross **32940**, keeps fee **971**, leaves moved fee **970** on the **32940** residual. A later change that refunds that entire residual (gross **32940** again — e.g. collapsing toward a free/near-free destination, or draining one source after a multi-source price-down) recomputes kept **971**, then `971 > 970` → `refundReview` support-only. Fail closed (no wrong money); a legitimate unwind needs support.
- Proof: `dated-booking-cp7-money-review.test.ts` (“S1”) asserts `Math.round(1941 * 32940 / 65880) === 971` and `1941 - 971 === 970`.
- **Fix:** `kept = Math.min(gross, moved.fee, Math.round(fee * gross / captured))`, or cumulative target `round(fee × Σgross / captured) − priorKept` (match cancellation-style cumulative rounding).

### S2 (Should fix): open change + CP6 day drop do not close each other

Builder note; `assertDatedStillValid` at `dated-booking-changes.ts:273-274` refuses approve with `bookingChanged`; day drop paths never consult `OPEN_KITCHEN_CHANGE_STATES`. Money guard freezes day refunds only once a change capture/refund/compensate op is `pending`, not while the change is merely `authorized`/`requested`.

- **Scenario:** change open with a card hold for +**8540**; chef drops Friday via CP6 (refund ~**21313**). Approve then fails; hold releases only on decline/expiry. Money paths refuse wrong apply (fail safe), but the chef can hold two money intents in flight and the change lingers.
- **Fix:** refuse day drops while an open change exists, or auto-withdraw the change (and release the hold) when a day refund commits.

### S3 (Should fix): change-charge (and residual move) subtotals are spread by **new absolute** day weights, not by which days increased

`dated-booking-changes.ts:333-336`; same idea in `moveLedger` for residual cents (`:371-378`).

- Equal-rate add-a-day nets out so each day still gets one day’s kitchen share (weights cancel). Uneven adds (equipment on one day, hours on another) still conserve **totals**, but early days can receive a slice of the price-up charge before later days run.
- **Scenario:** old three × **18000**; add a **2500** mixer on Wednesday only. `allocateCents(2500, [18000,18000+2500,18000])` puts hundreds of cents of the change charge onto Monday; Monday’s installment can include part of Wednesday’s add-on. Builder test’s mixed positive split (**2066/2066/287/516/2065**) shows the same absolute-weight pattern.
- Spec row 12 wants per-day payout of that day’s share. Totals are right; attribution timing is soft.
- **Fix (if owner wants strict per-day deltas):** put the entire positive difference on new/increased components only (delta weights), not on unchanged days’ absolute subtotals.

### S4 (Should fix): after `close_keep_refund`, CP6 day drops still price full day shares against the unreduced ledger

`dated-booking-cancellation.ts:196-197` (engine `captured`/`fee` = Σ current-day paid/fee only); `finish` at `:186` caps by `facts.captured - facts.refunded`; keep-refund leaves allocations undebited (`kitchen-booking-changes.ts:1025-1031`).

- **Scenario:** after M1’s keep-refund, Stripe remaining = **65880 − 31969 = 33911**. Chef drops one full day (e.g. Wednesday) before the deadline. CP6 quotes **21313** (= **21960 − 647**) and kitchen-debits that day’s share. Chef already holds **31969** (LC-funded) for a schedule cut that never applied, then gets **21313** more from the kitchen while Mon/Wed/Fri remain booked. Full three-day drop wants ~**63939** and refuses (`cannot fund`); partial drops that fit the remaining balance succeed. Fail closed on over-refund at Stripe; still stacks chef cash and kitchen debit on top of an LC-funded change refund.
- Proof: same keep-refund seed; `readDatedCancellationQuote(…, { visitIds: [2] })` returns `chefRefundCents: 21313` with entitlements still full.
- **Fix:** same as M1/M2 fail-closed (block money actions until the outside change refund is reconciled onto the day ledger), or credit unused LC-funded outside change refunds into CP6 `unusedGoodwill`-style accounting so day drops count them first.

### S5 (Should fix): after `close_keep_refund`, a larger price-down previews a refund bigger than Stripe residual

`dated-booking-changes.ts:220-226` (gross/kept from full `source.amount` / fee; no `priorGross` / `refundAmount` headroom). Compare single-day `priceChange` at `kitchen-booking-changes.ts:368-369`.

- Keep-refund leaves `refundAmount = 31969` and `changeGrossRefundedCents = 32940` on the source while the active ledger still prices **65880**. Dated quote ignores both.
- **Scenario (cents):** same keep-refund seed (Stripe residual **33911**). Chef previews a cut to Tue 4 h only (new total **10980**). Difference **54900**; kept `round(1941 × 54900 / 65880) = 1618`; preview refund **53282**. **53282 > 33911**. Approve would call Stripe for more than remains (provider reject / recovery). Same-size replay in M1 still fits the residual and can succeed; this path fails closed at the provider but the chef-facing quote is wrong and support may retry into a mess.
- Proof: `dated-booking-cp7-money-review.test.ts` (“S5”).
- **Fix:** same fail-closed door as M1, and/or cap `gross = min(remaining, moved.paid, captured - max(changeGrossRefundedCents, refundAmount))` like single-day before computing kept/refund.

### N1 (Note): day drops after a positive change are support-only — fails safe

`dated-booking-cancellation.ts:129` (`ctx.supplemental.length` → contact Local Cooks).

- Confirmed: refuses; does not invent a multi-source day refund. Spec row 8 (“drop any day before the deadline”) is unmet after a price-up change until multi-source CP6 exists. No wrong money.

### N2 (Note): self check-in is not carried — fails safe for money

`applyDatedChange` → `ensureChallengesForBooking` (`visit-code-challenge.ts:180`) always inserts `mode: 'staffed'`. Old visit codes revoked. Not a money path; kitchen must re-enable self check-in.

### N3 (Note): `change-refund:<id>` is hung on the first **old** (superseded) visit

`dated-booking-changes.ts:361-366`. CP6 `verifiedSource` treats it as `earlier()` (`dated-booking-cancellation.ts:135-136`). Entitlement 0 via `managerDebitedCents`. Odd lineage, not a double-pay. Payout `context()` throws on `scheduleState === 'superseded'` (`kitchen-day-payouts.ts:67`), so the no-entitlement installment cannot transfer.

### N4 (Note): whole-booking cancel refuses while a change money op is still `pending` (including `recovery_required`)

`kitchen-booking-changes.ts:1382-1383` (`withdrawOpenKitchenChangesInTx`). Fail closed until finish / keep-refund / compensate. Correct for money; recovery is then the only door — and keep-refund opens M1/M2/S4.

### N5 (Note): `afterApplied` runs even when capture-then-apply lands in `recovery_required` — fails safe on dated

`kitchen-booking-changes.ts:1198-1221`: on a succeeded capture, `rerun` is set after `applyAfterMoney` whether apply committed or rolled to recovery, so `afterApplied` → `releaseKitchenChangePayoutForSource` always runs. For `per_day`, that path partitions and `syncDayPayoutSource` returns early while `change.state !== 'applied'` and `dayComponents` are missing (`kitchen-day-payout-sources.ts:37-39`); the installment release also refuses until applied (`kitchen-day-payouts.ts:139-141`). No day is paid for an unapplied change charge. (Legacy non-`per_day` change payouts also defer on `state !== 'applied'`.)

### N6 (Note): open change vs day-payout race fails closed at approve

`lockedContext` takes money-source locks then the booking row (`kitchen-booking-changes.ts:115-123`), same family as CP5 day prepare. If a day installment gains `transferId` or `evidence.state === 'pending'` between request and approve, `ledger` at `dated-booking-changes.ts:104` throws `datedChangeSupport` and the schedule is not moved. Fail closed; the open change must be declined/expired (card hold released then). Related to S2’s “two money intents in flight” hygiene.

### N7 (Note): builder CP7 test encodes keep-refund payout unlock as success

`dated-booking-cp7.test.ts` (“refund then apply failure… keep-refund… frees the payouts”) asserts `refundsAllocated` becomes true with the original schedule intact. That matches the written recovery contract and is exactly what opens M1/M2/S4. Prefer `finish` for dated refund-then-apply recovery until keep-refund shrinks the day ledger.

## Verified OK

1. **Conservation (happy path):** after equal / negative / positive apply, live (`!supersededBy`) paid cents and fee shares match each source; change charge **7000/1050/490/278**; both sources sum to new total **74420** (`dated-booking-cp7.test.ts`). `allocateDatedCapture` throws if it would not conserve. Settled add-on rows stay put and are never refunded again. `moveLedger` asserts the change-refund part fits (`gross - kept === kitchenDebit`) before insert.
2. **Double money (core engine):** capture / refund use durable operation keys + Stripe idempotency; `applyAfterMoney` savepoint; finish does not re-capture/re-refund (tested); compensate uses `installmentReversals: []` on dated change charges; webhook/worker re-entry no-ops when `op.state === 'done'` or state is `applied` / operation key mismatches. `recovery_required` keeps `operation.state: 'pending'` so the worker can retry apply without a second Stripe refund (discovers existing refund). Sent / `evidence.state === 'pending'` installments → support-only at quote and approve (`ledger` `:104`). Money guard freezes non-matching ops while change capture/refund/compensate is `pending` (includes `recovery_required`). Approve vs expiry: past `decisionBy` expires first; hold gone → refuse approve. Concurrent approve+cancel: open change withdraws on whole-booking cancel unless a money op is still `pending` (N4). Concurrent approve+CP6 day drop: approve sees `bookingChanged` (S2; fail safe on apply).
3. **Refund amount (single applied negative change):** **31969** = **32940 − round(1941 × 32940 / 65880)**; kitchen **30079**, platform **1890**; matches single-day `rescheduleMoney` / per-source plan arithmetic. `installmentReversals: []`; no funding check on per-day sources. Newest source first when multiple. **Exception after keep-refund:** S5 (preview can exceed residual).
4. **Positive change:** holds/captures only **8540** once; `recordCharge` amount must equal `payCents`; orphaned change charge during capture-then-apply recovery waits for `state === 'applied'` before CP5 allocates (`kitchen-day-payout-sources.ts:37-39`); payout of that source also requires `change.state === 'applied'` (`kitchen-day-payouts.ts:139-141`). N5: `afterApplied` on recovery is covered by those waits.
5. **Payout:** old installments `noEntitlement` + `supersededBy`; `context()` throws on `scheduleState === 'superseded'`; new revision rows get fresh keys via `ensureDayPayoutRows`. Moved-away days cannot be paid. Change-charge installments use new visit ids only after apply writes `dayComponents`. N6: transfer-after-request refuses approve. **Exception:** M2 after keep-refund (first day can transfer).
6. **Refund deadline:** eligibility uses `cancellation_policy_snapshot.sessions` min start (dropped first day keeps its place until a change replaces sessions); apply replaces **only** `sessions` (0098); new deadline follows new first day (tested **2099-11-02T09:00** after move to Tue). CP6 after negative change quotes Thursday drop **21313** against the moved deadline.
7. **Authorization:** request/preview chef-only and `chefId` match (`kitchen-booking-changes.ts:466,557` + `context` `:108-109`); approve/decline manager-only and `change.managerId === row.managerId` (`:633-637`); withdraw chef-only; recovery admin-only (`:954`). `quoteHash` = sha256(`datedChangeFingerprint(…)`); mismatch → `priceChanged`. Destination re-validated at approve; old terms re-read from ledger. Fingerprint binds destination days, old/new terms, priced day list, pay/refund/feeKept/kitchenDebit/platformReturn.
8. **Builder limits:** day-drop-after-positive and self check-in both refuse / re-staff rather than mis-allocate money (N1, N2). Decline / expiry / withdraw leave original intact and release the hold group (tested).

## Lead disposition

_(empty — awaiting lead)_
