# Storage: cancellation policy, pricing/term, standalone booking UX, hold exposure (Oct 16, 2026)

Evidence tags: **[P]** primary page fetched this session; **[S]** search-summary only (verify before quoting); **[NF]** not found. Local context: `policy-facts-booking.md` section 2 (kitchen picks 24/48/72 h notice and 50%/100% late charge; refund minus actual card fee; policy frozen at booking) and the plan's OQ1 (>=48 h refund minus card fee, later none) plus Oct 16 owner decisions (30-day max term, tap-to-extend, no refund for unused time the chef skips, payout at the earlier of move-in or start+48 h).

## 1. Cancellation before start

| Platform | Rule | Who sets it |
|---|---|---|
| Stashbee (UK, monthly storage) [P] stashbee.com/help/cancellations-and-refunds-policy (dated Mar 2022) | Full refund (deposit + first month) if cancelled >=24 h before start; under 24 h: GBP 25 fee; 15-minute change-of-mind grace; waived for host fault or inaccurate listing; after start, 1 month notice (renter) / 2 months (host) | Platform-fixed. Different terms only if agreed in writing before confirmation (cl. 3.3, 4.8) |
| Neighbor [S] (neighbor.com location pages; help page returned 404) | "No cancellation fees"; some listings show free cancel within 24 h of booking; monthly runs until the renter ends it; host approves/denies requests | Mostly platform, some per-listing variation; unverified |
| SpareFoot [S] (listing pages + support KB) | Reservation is free, no payment until move-in, cancel or change any time | Per facility operator; payment happens at move-in so cancellation is moot |
| Public Storage / Extra Space / Clutter [NF] | Nothing found | - |
| Peerspace [P] intercom.help/peerspace-108cf19aff8e/en/articles/10119471 | Host-selected: Very Flexible (100% back until 24 h), Flexible (100% until 7 days, 50% minus processing fee to 24 h), Standard 30 Day, Standard 90 Day. Plus free cancel within 24 h of confirming if >=48 h before start. Peerspace keeps its fees | Host-selectable, 4 tiers, frozen at booking |
| Airbnb [P partial: airbnb.com/help/article/149 says hosts choose a policy; tier details [S]] | Hosts choose; tier lineup reported inconsistently (Flexible 24 h, Moderate 5 days, Firm/Limited since Oct 2025) | Host-selectable; guest sees it under "Things to know" before paying |
| Commissaries [P] Essential Commissary on The Food Corridor listing; [S] Union Kitchen, Volunteers of America | Month-to-month, no cancellation terms on listing; Union Kitchen: 30 days notice, applied the cycle after; VOA: quarterly billing, no refunds once billed | Each kitchen's own agreement; no common standard |

Pattern: the marketplaces that are about a booked date (Peerspace, Airbnb) let hosts pick from a few named tiers; the storage-specific marketplaces (Stashbee, Neighbor, SpareFoot) keep one platform rule: refund until a short cutoff or until move-in. Commissary storage has no standard and is mostly non-refundable once billed.

**Recommendation.** Reuse the kitchen's existing booking policy (notice hours + late charge), measured from the term start, refund minus actual card fee, snapshotted on approval. Reasons: one policy per kitchen, one sentence for chefs ("Cancel by {deadline} for a refund, minus the {fee} card fee"), no new setting for kitchens, the same cancel dialog and code path (`cancellation-refund.ts`, `cancellationSourceQuote`). Two storage-specific notes: (a) a 72 h kitchen with a start 2 days out means non-refundable at once, so show the deadline on the request screen, and a pending (unapproved) request is always free to withdraw; (b) after start, unused time is non-refundable (owner decision), same as the "checking out early" rule. The plan's fixed 48 h rule (OQ1) is the fallback if the owner wants zero kitchen configuration; the cost is a visible mismatch (a kitchen set to 72 h shows 72 h for sessions and 48 h for shelves). Optional, cheap trust builder borrowed from Peerspace/Neighbor: free cancel within 24 h of approval if the start is >=48 h away. Not needed at launch.

## 2. Pricing units, term length, card-fee drag

Peers:
- Monthly is the universal unit for commissary storage. The Food Corridor listings [S, thekitchendoor.com]: Sprout Food Hub $15/shelf dry or cold, $30 frozen per month; Cozy Kitchen $50/shelf, $100 cold cage; Hangar 76 $25 dry shelf, $50 fridge/freezer shelf; North Bay $50 dry rack, $100 cold shelf; LW Commissary $85 dry, $115 refrigerated rack; Puyallup $50 dry, $75 fridge/freezer door. No weekly or daily storage prices found at any commissary [NF]. Essential Commissary [P] bills monthly "based on the amount and type of storage".
- Self-storage: weekly is uncommon and usually with a 2-week or 1-month minimum [S: Storage King 14 days, Raine and Horne 1 month upfront]; Shurgard offers one week with 15 days notice [S]. Stashbee default minimum is one month, host-adjustable, rolling monthly, 30 days notice [S]. Neighbor is monthly, ends any month [S].
- So a 7-day or 30-day pay-up-front term is shorter than any peer. Daily/weekly is a differentiator for pilots and event chefs, not a norm.

Stripe Canada standard cards [P, stripe.com/en-ca/pricing]: 2.9% + C$0.30 domestic; +0.8% international; +2% conversion. Fee computed on pre-HST price here; with 15% HST it is about 0.4 points higher.

| Shelf price per 30 days | One 30-day charge | Weekly (4.29 charges) | Extra drag weekly | Fee % monthly / weekly |
|---|---|---|---|---|
| $20 | $0.88 | $1.87 | +$0.99 | 4.4% / 9.3% |
| $40 | $1.46 | $2.45 | +$0.99 | 3.7% / 6.1% |
| $60 | $2.04 | $3.03 | +$0.99 | 3.4% / 5.0% |

Weekly adds about C$0.30 per extra charge (~$1 per month of storage) regardless of price. It is small in dollars but doubles the percentage on a $20 shelf. If the kitchen absorbs it, a $20 shelf nets 9% less; if passed on, chefs see a visible "fee" on tiny items. Who bears the fee on a refund matters too: on a weekly charge, "minus the card fee" keeps a larger share of a $4.67 refund (about 9% plus the $0.30 floor).

Chef friction: weekly means 4 to 5 taps, 4 to 5 chances for a declined card, 3DS prompt, or forgotten tap per month, and each lapse starts the 5-day grace/holdover machinery (more support, more kitchen disputes). Monthly is one decision. Weekly suits trial and event use only.

**Recommendation:** keep platform max 30 days, let chefs pick any number of days up to the max (pricing by day with an optional cheaper 30-day price, plan OQ3 B); kitchens may set a lower max (7 days) but the default stays 30. Do not default or encourage weekly.

## 3. Standalone storage booking UX

What I could verify:
- Neighbor [S]: search by what you store, filter by size, price, indoor/outdoor; host approves or denies each request; hosts set access hours; access starts after approval; storage-only (no living or working). Property protection plan upsell at checkout.
- Stashbee [P policy + S listings]: listing pages show a monthly price and a host minimum (e.g. 60 days); "Instant Book" is a host option that accepts any paid request automatically; otherwise host accepts, and the booking is confirmed once payment is made and the host accepts.
- SpareFoot [S]: reserve free, pay at move-in at the facility.
- The Food Corridor [P Essential Commissary listing; S help center]: storage is listed under "Additional Services"; members "reserve storage, prep space and cooking equipment" through the platform, billed monthly; onboarding requires insurance certificate, ServSafe, business licence, signed user agreement, and a $300 refundable deposit. So storage is for approved members, not open to the public. The platform's own exact add-storage click path was not found [NF]. Per kitchen, eligibility varies.
- PREP, WeWork lockers, Clutter, Union Kitchen FAQ (fetch failed): not verified [NF].
- What storage listings show before payment [S]: size, price, access hours, indoor/outdoor, rules on what is allowed. Food-specific (cold/freezer temperature, labelling, what is allowed) comes from kitchen rules; no peer put this in a structured form that I could verify.

**Recommended Local Cooks flow** (fits "chef must be approved at the location first"):
1. Entry points: a "Storage" tab on the kitchen's page next to booking, and "Rent storage" in the chef's per-kitchen area; also "Add storage" after a session booking, prefilled with that kitchen. Chefs not yet approved at the kitchen see the same listings with one button, "Apply to this kitchen first", which goes through the existing approval and returns them to the shelf.
2. Eligibility: approved chef only for first rentals; hide or lock the price button, never show an empty dead end.
3. Listing card before paying: unit type (dry / cold / freezer / cage), size, price per day and per 30 days, access hours, temperature range, what is allowed and labelling rules (kitchen text, with a Local Cooks default for cold/frozen), move-in steps, the cancellation line from section 1 (same wording as bookings), and "No auto-renew: you extend by tapping".
4. Request: card hold now, charged on the kitchen's approval (as in the plan), with the 24 h response promise shown. First rental per chef-kitchen pair is approved by the kitchen; later extensions are instant taps. Optional kitchen setting "auto-approve returning chefs" can come later.

## 4. Does 7 days vs 30 days reduce refund/clawback exposure?

Short answer: only in absolute dollars per term, not in fraction; it is a small lever bought at real UX cost.

Worked example (shelf $40 per 30 days; payout at start+48 h; early move-out non-refundable):
- 30-day term: chef pays $40; kitchen is paid on day 2. Kitchen fault on day 10 (shelf unusable, cooler failure, reclaim): refund of unused time = 20/30 x 40 = $26.67, which the kitchen owes after payout (transfer reversal if balance allows, otherwise debt netted later). Worst case, fault on day 3: 27/30 x 40 = $36. A chargeback disputes the whole $40.
- 7-day term: chef pays $9.33 per term; kitchen paid on day 2. Fault on day 3: 4/7 x 9.33 = $5.33. Worst case $8.00 at day 3, chargeback $9.33. If the chef stays the whole month the kitchen collects the same $40 over 4 to 5 payouts.
- Unchanged by term length: early move-out (non-refundable, not exposure at all), fault refund as a share of the term (about 90% right after payout in both cases), the chef's total lifetime spend.
- Shorter terms help in two real ways: smaller loss in any single clawback (about 4x lower cap, so the kitchen's Stripe balance is more likely to cover it, fewer cases landing on the platform), and a chef who disappears owes at most a week of holdover. A chargeback can still target every past weekly charge for up to the card network's window, so cumulative chargeback exposure is the same.
- Costs of 7 days: about +$1 per month card fees, 4x as many payments that can fail, and the grace/holdover cases.

Recommendation: keep 30 days. Control exposure with the levers you already have: payout at the earlier of move-in or start+48 h (paused on any open problem), problem-report holds, kitchen debt recorded and notified, first-time-chef cap if desired (for example a chef's first rental at a kitchen limited to 14 days). Let kitchens lower the max to 7 days if they want less risk.

## Recommendation table

| Topic | Recommendation |
|---|---|
| Cancellation before start | Reuse kitchen booking policy (notice + late charge) from term start, refund minus actual card fee, snapshot on approval; pending request free to withdraw |
| After start | No refund of unused time the chef skips; kitchen/Local Cooks fault refunds in full |
| Term | 30-day platform max (admin), kitchen may lower; chef chooses days; optional cheaper 30-day price |
| Weekly | Not default; allowed only by kitchen lowering max to 7 |
| Standalone flow | "Storage" tab + "Rent storage" + "Add storage" after session; approved chefs only, "Apply first" for others; kitchen approves first rental |
| Pre-pay info | Size, type, price, access hours, temperature, allowed items, cancel line, no auto-renew |
| Exposure | 30 days plus payout hold on open problems; do not shorten for money reasons |

## Owner questions

1. Cancellation before start. A) reuse kitchen notice + late charge (recommended); B) fixed 48 h platform rule; C) separate storage choice per kitchen.
2. Free window after approval. A) none (recommended, simplest); B) free for 24 h if start is >=48 h away.
3. First-rental safety cap. A) none; B) 14 days for a chef's first rental at a kitchen (recommended only if kitchens ask for it); C) kitchen-chosen.
4. Kitchen may lower max to 7 days. A) yes (recommended); B) platform fixed 30.
5. Unapproved chef opens a shelf. A) "Apply first" button into existing approval (recommended); B) hide storage entirely until approved.
6. Auto-approve returning chefs for repeat rentals at the same kitchen. A) later; B) at launch; C) never.

## Gaps

Neighbor help page 404; Public Storage, Extra Space, Clutter, PREP, WeWork lockers, Union Kitchen FAQ (TLS error) not verified. Peerspace tiers are as of its help page (marked 11 months old). Stashbee policy dated 2022. Food Corridor per-kitchen terms vary; the add-storage click path was not found.
