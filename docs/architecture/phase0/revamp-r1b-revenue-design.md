# R1b: Revenue and payouts design pass

Stage R1 (Codex) built the data and a working page. R1b only changes the presentation. It keeps the same
`GET /api/manager/revenue/ledger` read, the same summary numbers the dashboard card shows, and the same existing
reads for Stripe payouts, payment details and invoices. Nothing touches charges, refunds, transfers, payout timing or
the server.

## Research: what we adopted

| Platform | What they do | What we took |
|---|---|---|
| **Airbnb Earnings** ([help 3632](https://www.airbnb.ca/help/article/3632)) | Upcoming and Paid sections; filters for listing, payout method and dates; "Get report" CSV with gross earnings, fees and taxes per earning; Performance chart; monthly and annual statements by listing | Upcoming/Paid tabs with counts; a CSV for every tab; a monthly chart; a period statement |
| **Peerspace** ([payouts help](https://intercom.help/peerspace-108cf19aff8e/en/articles/10119435)) | Payout history; host payouts processed by Stripe and sent by ACH within 7 days of the reservation ending | Each payout states when it will be sent; Paid shows payout history |
| **Turo Earnings** ([help](https://help.turo.com/en_us/viewing-your-earnings-HyFwSVeNq.md)) | Year-to-date total that already includes adjustments; switch views by year or vehicle; earnings shown without sales tax; CSV download | Net figures include refunds; switchable breakdown (by month, chef or type); tax kept out of the earnings line |
| **The Food Corridor** ([platform fees help](https://help.thefoodcorridor.com/en/articles/1559663-how-can-i-see-the-platform-fees)) | Payment Details (per payment: tax, fee, net, payment date, **Stripe payout date**); Monthly Revenue (gross, tax, fee, net; "taxes are transferred to your bank account and you're responsible for remitting them"); by client; by type; CSV | An earnings summary that runs earnings before HST + HST collected − card fees − refunds = net; by month, by chef, by type; HST separate and labelled "you remit this"; payment details kept under Reports |

Things none of them do well, and we now do: each row shows **what happens next, and when**. Held rows say why the
money is held and give an action button. The page also separates "sent to your Stripe account" from "arrived in your
bank" (Food Corridor only gets close, with its Stripe payout date column).

## Before (R1) and after (R1b)

| Area | R1 | R1b |
|---|---|---|
| Header | Stripe button, two native `<select>`s and the date picker all squeezed into the header actions | Page title and one-line description; the Stripe button stays in the header. Filters sit in a row of their own: shadcn Select pills, plus the date picker. Location and kitchen pickers appear only when there are two or more to choose from |
| Top numbers | Four equal cards, then a paragraph explaining which numbers follow the dates | Upcoming, On hold, Paid out, Net earnings. Each card labels its own scope: "All dates" or the date period. On hold turns amber when it holds money, with **See why**, which opens Upcoming filtered to held payouts. Empty cards say "Nothing scheduled right now." or "Nothing on hold." Two columns on phones |
| Money journey | (none) | "How your money reaches you" in three steps: chef pays Local Cooks → sent to your Stripe account → arrives in your bank. Open on desktop, folds to one line on phones |
| Upcoming | 7–8 column table; long status text squeezed into a column; mobile showed a generic stacked card | Grouped list: **On hold** first, then by expected date (date heading + day total), then "Date not confirmed yet". Each row: booking link · chef / type · day ("Day 2 of 3 · Oct 21, 2026") · kitchen / amount + status chip / one plain sentence on what happens next / action button when there is one. Filter pills: All · Scheduled · On hold, with counts. Shows 20 rows, then "Show N more" |
| Held rows | Sentence in the table cell | Amber note with the reason and next step. Buttons: **Open payment settings** (setup incomplete), **Open booking** (reported issue, damage claim, support review). No button where Local Cooks handles it (fee confirmation, allocation review) |
| Paid | Table of transfers | "Sent to your Stripe account": grouped by date sent, with a "Sent to Stripe" or "Partly reversed" chip, the sentence "Sent to your Stripe account on … Stripe deposits it to your bank on your payout schedule" and **View in Stripe**. Below that, **Bank deposits** (moved here from Reports) |
| Bank deposits | "Payout History" card in Reports showing amount, arrival date and method | Statuses in words: Arrived (date) / On the way (expected date) / Pending / Failed (what to do) / Canceled. Statement download kept. The Stripe setup alert moved with it |
| Reports | Chart plus three wide 13-column tables (month, chef, type) and a `<details>` holding payment details, invoices and payouts | **Earnings summary** card (counts, each type line, earnings before HST, + HST "you remit this", − card fees, − refunds "from your share", = net) next to the monthly chart. One **Breakdown** card with By month / By chef / By type pills, 8 key columns by default, "Show every column" for the full split, a totals row and **Download this table** (CSV). Phones get compact cards. Payment details and invoices sit in an accordion |
| CSV | One per tab | Same tab CSVs (Upcoming follows its filter), plus the breakdown CSV. Formula neutralisation is shared |

Data and copy rules hold throughout: integer cents through `formatCurrency`, every amount and date shown, sentence
case, no Stripe IDs as text, "free" never used, HST always its own line.

## Decisions

- **Sentences don't repeat the amount.** The amount sits in bold beside each sentence. Scheduled and sent sentences
  give the date and what happens next ("Goes to your Stripe account around Oct 22, 2026, 9:30 a.m., once the visit
  closes. Stripe then deposits it to your bank."). The reversal sentence keeps both amounts.
- **"Waiting for inspection" vs "Processing".** An undated row with reason `inspection` says "Sent to your Stripe
  account after the visit closes. Finish the inspection to release it sooner." The old dashboard copy already promised
  release as soon as the inspection is finished, so this adds no new rule.
- **Bank timing is never promised in days.** Stripe's schedule is per-account, so the copy says "on your Stripe payout
  schedule" and shows Stripe's own arrival date for each deposit.
- **Pill filters are pressed buttons, not Radix ToggleGroup.** `index.css` forces every
  `[data-radix-collection-item][role="radio"]` to a 16px circle. `SegmentedControl` uses `aria-pressed` buttons in a
  labelled group.
- **The dashboard card is untouched.** It reads `revenueSummaryFromLedger` from the same query, so its numbers match.
  `RevenueSummaryCards compact` still works.
- **Strings.** I added 70 `r1b*` keys in en-CA, fr-CA and uk, all edited by UTF-8 Python scripts (typographic
  apostrophes, because a straight `'` is an ICU escape). Superseded R1 keys were removed: `r1PaidStatus`,
  `r1ScheduledStatus`, `r1ScheduledStorage`, `r1ScheduledClaim`, `r1RangeExplanation`, `r1PaidReversed`. I also fixed
  the uk word for `statement`: "Заява" (application) is now "Виписка" (statement). `node scripts/i18n-lint.mjs` passes.

## For the owner to decide

1. **Location and kitchen filters are hidden when there is only one option.** Choosing "All" or the only kitchen gave
   the same result. Say if you want them always visible.
2. **Bank deposit "method" is no longer shown.** The old row showed Stripe's raw method ("standard" or "instant",
   fallback "Bank Transfer"). Arrival status replaces it. I can bring it back as a small "Instant" tag.
3. **The CSV "Stripe link" column still holds the dashboard URL,** which contains the transfer ID. It's useful for
   reconciliation (Food Corridor exports the Stripe payment ID), but it is a Stripe ID as text inside a spreadsheet.
   Keep it, or drop it?
4. **Recent invoices still lists only 5.** Unchanged from R1. Payment details covers every payment. Say if you want an
   "All invoices" view.
5. **No year-over-year chart yet.** Food Corridor charts monthly revenue against last year, and Airbnb projects
   earnings. Both need a second ledger read for the earlier period. That's still display-only, but it's new data, so I
   left it out.
6. **Bank deposits show Stripe's latest payouts regardless of the date filter or location** (account-level, as
   before). The copy says so. Filtering would need a server change.

## Verification

- Client tests: `RevenueLedger.test.tsx` now has **23 tests**, covering headline amounts and scopes, the See why jump,
  empty and calm states, compact cards and the phone grid, journey steps, grouping order, status chips and sentences,
  every hold action, the inspection-wait case, filters, show-more, Paid with the Stripe link and no ID text, reversals,
  bank deposit statuses with empty and error states, the Reports statement arithmetic, breakdown view switching, the
  every-column toggle, the phone/desktop layout classes, the breakdown CSV with totals, the tab CSVs (HST and fees
  separate, filenames, filter-aware) and formula neutralisation. Focused run: 7 files, 41 tests, all passed (revenue
  folder, page staging test, dashboard-numbers test).
- `KitchenDashboardOverview.test.tsx` fails at import (`initReactI18next` missing from its `react-i18next` mock). It
  fails the same way on the base commit 752f9cbd with R1b's files reverted, so this change didn't cause it. Left for
  the dashboard stage.
- Visual check: dev still runs the pre-R1 page (no ledger endpoint), so I rendered the real components with fixture
  data through a temporary local Vite entry (removed) at 1280px and 390px, all three tabs. No horizontal overflow at
  390px and no console errors.
- One foreground `npx tsc --noEmit -p tsconfig.json` after both code commits: **exit 0, no diagnostics** (10.5 min).
- Live dev check after deploy: `/manager/dashboard?view=revenue`, both widths.
