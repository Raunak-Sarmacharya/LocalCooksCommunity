# Storage: kitchen payout timing, Canadian legality, abandoned items, reclaim notice (16 Oct 2026)

Research only. No code, DB or Stripe was touched. Follows `research-storage-lifecycle-2026-10.md` (OQ4, OQ7, OQ8, section c).
Not legal advice. Items marked **COUNSEL** need an NL / federal lawyer before launch.

Evidence tags: **Documented** (primary page opened, URL given) · **Search-summary** (seen only in a search snippet or a secondary site; lower confidence) · **Inferred** (my reading) · **Not found**.

---

## 1. Stripe: how long can we hold money?

### 1.1 What Stripe says (all Documented)

| Question | Answer | Source |
|---|---|---|
| Max hold, platform balance (our model: separate charges and transfers, SCT) | Stripe says it "can hold funds in reserve for a period of time that's based on the country": **90 days for all other countries (Canada included), 2 years US, 10 days Thailand.** The table sits under "Holding funds" in the platform-balance page. It does not say exactly when the 90 days start. A forum quote of an older version says "from charge creation to payout" (Search-summary). **Inferred:** treat the clock as starting at the charge. | [Connect account balances](https://docs.stripe.com/connect/account-balances) |
| Max hold, connected account on manual payouts | Same table: "You must pay out the funds within the time period ... 90 days" for all other countries. | [Manual payouts](https://docs.stripe.com/connect/manual-payouts) |
| Does Stripe like long holds? | "We advise against platforms holding funds arbitrarily ... paying out ... as soon as they're identified." Holding is fine "when there's a clear purpose and a commitment to transfer them ... when an event occurs." Rentals are named as the typical legitimate case. "If you aren't sure about holding funds, speak with your legal advisor." | account-balances page |
| Escrow | "Stripe doesn't provide escrow services or support escrow accounts"; delayed payouts are for "when a delivery is delayed or ... a possibility of a refund." | manual-payouts page |
| `source_transaction` | Not required. It is the way to avoid a failed transfer: with it "the transfer request automatically succeeds" and "the transfer takes on the pending status of the associated charge." Transfer amount must not exceed the charge; many transfers can share one charge; **it can't be set or changed after the transfer is created**; currency must match. Without it the transfer fails if the platform's available balance is short (no auto-retry). | [Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers) |
| Transfer timing rules | No minimum or maximum written for a transfer except the 90-day reserve language above. Transfers aren't retried automatically. Async payment methods (ACH, SEPA): wait for `charge.succeeded`; Stripe won't auto-reverse a transfer if the payment later fails. Cards are not async. | same |
| Reversals | "Only possible to reverse a transfer if the connected account's available balance is greater than the reversal amount or has connected reserves enabled." Use "only for refunds or disputes related to the charge, or to correct errors." Refunds on the platform charge "have no impact on any associated transfers"; the platform must reconcile by lower later transfers or reversals. | same + [Transfer reversals API](https://docs.stripe.com/api/transfer_reversals) |
| After the kitchen has paid out to its bank | Reversal pulls from the connected account's **Stripe balance**, not its bank. If the money already left, the reversal fails unless the balance or reserve covers it. So: **no clawback from a bank account via reversal.** | inferred from the two lines above |
| Negative balance | Refunds and chargebacks on a platform charge debit the **platform** ("When charging on your platform, a refund or chargeback comes from your platform account"). If a connected balance goes negative, Stripe may auto-debit its bank (Canada is on the supported list, needs `debit_negative_balances`). After 180 days negative, Stripe sweeps the platform's reserve to zero it out. While negative, no payouts to that account. | account-balances page |
| Who is liable | Under SCT "Stripe debits dispute amounts and fees from your platform account," "with or without `on_behalf_of`." Recommended recovery: reverse the transfer when `charge.dispute.created` fires. If the chargeback is won, re-transfer the amount. | [Connect disputes](https://docs.stripe.com/connect/disputes) |
| Stripe's own advice on SCT | "We recommend using separate charges and transfers only when you're responsible for negative balances of your connected accounts." | SCT page |
| `on_behalf_of` | Makes the connected account the settlement merchant: its country, fees, statement descriptor, and `delay_days` (up to 31 via `delay_days_override`) apply to payout timing. Not needed for us (same country). It would also change who appears on the card statement. Not recommended: kitchen-as-merchant raises their dispute exposure and is what Food Corridor does. | SCT page, [Manage payout schedule](https://docs.stripe.com/connect/manage-payout-schedule) |
| `delay_days` | Applies to `on_behalf_of` / direct charges only. **It does nothing for SCT transfers.** So with SCT the only holding lever is: when we create the transfer. | manage-payout-schedule page |
| Funds segregation | Private preview (contact account manager): keeps allocated funds in a protected state before transfer. Worth asking Stripe about, ties directly to the RPAA safeguarding question in section 2. | SCT page |

### 1.2 Dispute window vs payout timing (Search-summary, not network rulebooks)

- Card chargebacks are normally allowed about **120 days** after the charge. For services not yet delivered, the window can run from the expected end of the service, capped at **540 days** from the charge. Sources: [Stripe resource on chargeback time limits](https://stripe.com/en-be/resources/more/chargeback-time-limits-in-the-uk), [Redo summary](https://redo.com/resources/articles/chargebacks/chargeback-time-limit).
- **Consequence (Inferred):** no payout timing we could use protects us from a chargeback. Even paying the kitchen at the end of a 2-month term leaves ~120 days of exposure. So the real protection against "kitchen paid, then dispute" is not waiting, it is the **right to recover** (net against future transfers, reverse while the kitchen's Stripe balance still holds it, or a claim in the kitchen agreement), plus keeping the amounts small and per-period. Waiting for evidence (move-in done) only filters out the most likely dispute type: "I never got/used the space".

### 1.3 Answers to the owner's worry (a) and (b)

- (a) Early pay then dispute: with SCT the platform pays the chargeback first and then tries to reverse. It works only if the kitchen's Stripe balance still has the money. If the kitchen's payout schedule is the default (daily automatic), the balance is usually empty a day or two later, so reversal fails, and we eat the loss or recover from future transfers. That is the same as kitchen bookings today (paid shortly after the visit). The fix is policy + contract, not a longer hold: the Kitchen Agreement should say the kitchen owes back refunds and chargebacks on its listings and Local Cooks may net them against later payouts.
- (b) Can Stripe hold funds long: Documented, 90 days max in Canada, and discouraged unless purposeful. Our proposed hold (days, per term) is far inside it.

---

## 2. Canada: do we need RPAA or FINTRAC registration?

### 2.1 What I found

| Source | Finding | Tag |
|---|---|---|
| [Bank of Canada, "Supervisory policy for online marketplaces", 19 Dec 2025](https://www.bankofcanada.ca/2025/12/supervisory-policy-for-online-marketplaces/) | A marketplace is treated as a payment service provider (PSP) if it "receives funds in a bank account it owns or controls", even when it uses other PSPs for parts of the flow. Funds that "come to rest" mean the marketplace is **holding funds on behalf of end users**, and funds still count as at rest "when a predetermined payout schedule applies, such as weekly or biweekly." Payment functions are **not** incidental when the marketplace is "directly involved in the flow of funds", even for reasons like "simplifying conflict resolution, managing fraud, or collecting fees." They may be incidental where third-party PSPs run the whole chain, the marketplace limits itself to what is strictly necessary and "does not take custody of the funds of end users." Marketplaces using third-party PSPs end to end "are generally not themselves considered PSPs." Examples of safe shapes: both parties hold accounts at the same PSP ("on-us"), or separate acquirer and payout PSPs with the marketplace only supplying data. The page sets **no time limit** on holding funds. The page does **not** discuss agent-of-payee or mandate. If a marketplace is a PSP it must register and safeguard funds so they are available to merchants if it becomes insolvent. | Documented (page fetched) |
| Bank of Canada says unsure operators should apply and describe their operation | Same page | Documented |
| Temporary holding "in transit" or ordinary processing delay alone is not a registration trigger | Bank of Canada statement relayed in a search summary | Search-summary |
| RPAA excludes payment functions "incidental" to another business; Bank decides case by case; a payment function marketed as its own line or that users reasonably expect as a payment service is not incidental | [Bennett Jones](https://www.bennettjones.com/Insights/Blogs/2024/12/Retail-Payment-Activities-Act-A-Deeper-Dive-Into-When-Registration-is-Required) | Search-summary |
| An agent of a registered PSP generally does not need to register | Bennett Jones, same | Search-summary |
| No "agent of payee" or "marketplace mandate" exclusion found in RPAA material (the US has one in state money-transmitter laws; I found nothing equivalent for Canada) | searches | **Not found** |
| FINTRAC: since a 2022 position change, providers of goods-and-services or invoice payments can be treated as "remitting or transmitting funds" (an MSB). Exclusions: receiving payment for your own goods or services, or settling a debt without forwarding payment instructions. | [DLA Piper](https://www.dlapiper.com/en/insights/publications/2022/08/fintrac-changes-due-to-truckers-convoy), [FINTRAC MSB page](https://fintrac-canafe.canada.ca/msb-esm/intro-eng11) (page not opened) | Search-summary |
| In force dates (registration open since late 2024, supervision from Sept 2025) | **My memory only, not verified this session** | Unverified |

### 2.2 Plain conclusion (Inferred, **COUNSEL**)

- Our shape is: chef pays the Local Cooks Stripe account, then we transfer the kitchen's share to the kitchen's Stripe account. Stripe is the PSP running the whole chain, we hold no Canadian bank account that the chef's money passes through (as far as I know: **confirm** that platform Stripe payouts are not sweeping chef funds into our own bank account before they are transferred to kitchens).
- That fits the "third-party PSP runs the chain" description, **but** the Bank's own text says a marketplace "directly involved in the flow of funds" is not incidental even for dispute handling or fees, and says a predetermined payout schedule still counts as funds at rest. Our platform decides *when* to transfer, which is being directly involved. Whether a balance sitting in our own Stripe account counts as "a bank account it owns or controls" is **not answered on the page I read**. It is the one real open legal question.
- Practical reading for a pilot: **probably not in scope while holds are short, tied to a concrete event (move-in/start), and Stripe runs the money; plausibly in scope if we hold for long or on our own discretion.** Not a guarantee.
- What pushes us toward scope: (1) long holds with no event (weeks to months, "escrow-style"); (2) holding for sellers as a product feature (a "balance" they see, withdraw on request); (3) funds routed through a bank account we own; (4) taking a role beyond what's necessary (e.g., splitting, pooling, running refunds from a pooled account); (5) marketing the platform as a payment or escrow service; (6) no written role agreement with kitchens (this helps only for any agent-of-payee-style argument, which I could not confirm exists in Canada). Also FINTRAC MSB risk is separate from RPAA and rests on "remitting or transmitting funds"; not resolved by anything above.
- Recommendation on duration: **pay on a short, event-driven schedule; hold normally no more than 14 days from charge; absolute cap 30 days; never rely on the 90-day Stripe limit.** The Bank gives no day count, so this is a risk-reduction choice, not a legal safe harbor. Document the reason for each hold (move-in not confirmed, open problem) and release as soon as the condition clears.
- Cheap next steps (no code): ask Stripe (account manager or support) in writing: (i) is funds-in-platform-balance under SCT treated as held by Stripe as the PSP for RPAA purposes; (ii) funds segregation preview; (iii) their view on our hold period. Then include the answer in the counsel brief. The Bank also invites unsure operators to describe their model to it.

---

## 3. How peers pay hosts on monthly or space rentals

| Platform | Host payout timing | Tag / source |
|---|---|---|
| Neighbor | Renter charged on day 1 of each period; host paid **at the end of each period** (payout through Stripe, 2-3 business days). Fee 4.9% + $0.30. | Documented: [payouts](https://help.neighbor.com/en_us/how-do-payouts-work-as-a-host-HJkBDAICu) via search result text; page body did not render when fetched |
| Stashbee | Short bookings: withdrawable the day after the booking ends. Monthly: withdrawable **at the end of each rental period**. Money lands in a Stashbee wallet first (min £10). | Documented: [how and when do I get paid](https://help.stashbee.com/en/articles/320944-how-and-when-do-i-get-paid) |
| The Food Corridor | Kitchen is merchant of record (kitchen's own Stripe), so no platform hold. **N/A** to our model. | From the Oct 14 research |
| Peerspace | Processed within **7 days after the reservation ends**; extras within 72 h after, paid separately. Conflicting third-party claims of 48 h. | Search-summary: [Peerspace help](https://intercom.help/peerspace-108cf19aff8e/en/articles/10119524) |
| Airbnb, stays under 28 nights | About 24 h after scheduled check-in. | Search-summary |
| Airbnb, 28+ nights | **Monthly installments, first about 24 h after check-in**, later ones roughly every ~30 days. Payouts may be held for review, "up to 45 days after guest check-in" (Airbnb's own help snippet). | Search-summary: [Airbnb host resource](https://www.airbnb.com/resources/hosting-homes/a/20), [help 425](https://www.airbnb.com/help/article/425) |
| Turo | 3 business days after first completed trip; later trips 3 hours after end; trips over a week get **partial payouts every 7 days**. | Search-summary: [Turo getting paid](https://help.turo.com/en_us/getting-paid-SyALrVeN9.md) |
| Spacer | Not found. | Not found |
| Sharetribe | Funds sit in the provider's Stripe balance until a payout is issued; "the hold should not exceed 90 days" (Stripe's limit); delay configured in the transaction process; requires manual payout. | Search-summary: [Sharetribe help](https://www.sharetribe.com/help/en/articles/8794582-how-stripe-payouts-work) |

Pattern: **pay after service starts, in period-sized pieces (Airbnb 24 h after check-in; Stashbee/Neighbor per period end; Turo weekly).** Nobody pays the host a multi-month total up front.

### Recommended Local Cooks rule (storage up to ~2 months)

1. **Trigger:** kitchen share becomes payable at the **earlier of move-in done, or start date + 48 h**, provided no open problem report, dispute or claim on that rental. Not at capture (differs from today's extension behavior, OQ4 option C).
2. **Periods:** split the payable amount into 30-day periods. Period 1 releases at the trigger above. Later periods release 48 h after each period starts (term up to 2 months = at most 2 releases). A term of 30 days or less is one release. This keeps the platform-held money at most about 30 days of kitchen share, well inside 14-30 days after charge for the first period; the second period is held up to ~30 days after charge (still inside the 30-day cap).
3. **Open problem or claim:** hold only the *current period's* share; release the moment it closes. Reuse the "storage problem report" kind recommended in the lifecycle doc.
4. **Create each transfer with `source_transaction`** (the charge) so it can be created even if the charge is still pending. It cannot be added later.
5. **Refunds:** the chef is refunded from the platform (Stripe refund on the charge). If the period's transfer has not been made, nothing else to do. If it has, the platform reverses the kitchen's transfer if the kitchen's available Stripe balance allows; else it nets the amount against that kitchen's next transfers, as the Kitchen Agreement authorizes. Stripe confirms refunds do not touch transfers on their own.
6. **Kitchen-at-fault early end** (lifecycle dead end 6): refund of unused periods, mostly un-released money, so nothing to claw back for periods not yet released. This is a real advantage of per-period release.
7. **Chargeback:** on `charge.dispute.created`, freeze unreleased periods for that rental, reverse released periods where the kitchen balance allows, net the rest. Win: release / re-transfer.
8. **No manual payouts on connected accounts, no `delay_days`:** neither does anything for SCT, and manual payouts add the 90-day payout obligation. Keep kitchens on default payouts.
9. **Cap:** no money for a rental held more than **30 days after the charge** without a documented open problem. Documented reason, then the lifecycle's admin queue.

---

## 4. Abandoned items where the kitchen has authority

### 4.1 Peer evidence

| Source | What it says | Tag |
|---|---|---|
| Stashbee ([abandoned items](https://help.stashbee.com/en/articles/320919-what-happens-if-a-renter-abandons-their-items)) | **Host reports to the platform and sends clear photos of the items in the space.** Stashbee lists the items on a partner auction (about one week), the winner collects, otherwise a partner removal company clears them; Stashbee pays removal up to £250. Host is told to take "a sizeable deposit." Platform controls disposal, host does not. | Documented |
| Airbnb items left behind | No official rule; community practice is host contacts guest, **guest pays shipping**, host not obliged; hosts post "no responsibility / handling fee" in house rules. | Search-summary (forum posts), no official policy found |
| Food Corridor / commissary agreements | No public clause found. Public commissary forms are health-department forms; none cover left property or disposal. | Not found |
| Self-storage / coworking | Disposal is statute-driven in the US (lien notice days vary by state); Canada: Ontario has a Repair and Storage Liens Act, NL equivalent not found. | From lifecycle doc a2 |

### 4.2 Recommended policy (kitchen acts, Local Cooks notifies and records) - **COUNSEL**

Principle: the kitchen owns the space and decides what to do with items left there; Local Cooks is the neutral record-keeper and notice sender, not the one who disposes. Because we have no confirmed NL legal power to sell, the kitchen's action is limited to **remove, store, return, or discard**, never sell.

Prerequisites (otherwise the kitchen's action is not allowed): the chef accepted the storage terms at booking that include this clause; move-in record exists, or the kitchen has its own handover photo; the term has ended and any grace/holdover has run out.

| Step | Who | What | Timing |
|---|---|---|---|
| 0 | Kitchen | Records evidence: dated photos of the unit and items, a short inventory list (what, rough quantity, perishable yes/no), optional video | Any time after the end date |
| 1 | Local Cooks | Sends a **dated written notice** to the chef (email + in-app, all three languages) with the kitchen's photos/inventory, the deadline, what will happen, and how to reply | Same day the kitchen opens the case |
| 2 | Chef | Collects, or replies to arrange a pickup | Deadline below |
| 3 | Local Cooks | Reminder and a final notice before the deadline; logs all sends (timestamp, address) | Perishables: notice 1, final at 24 h. Non-perishables: notice 1, final 3 days before deadline |
| 4 | Kitchen | After the deadline passes with no reply: **kitchen may act**. Perishables: discard for food-safety, photo before and after. Non-perishables: box, label, store at the kitchen. | After deadline |
| 5 | Kitchen | Non-perishables are held for a stated period, then may be returned, donated or discarded. Kitchen records each action with photos. | After storage period |
| 6 | Local Cooks | Keeps the full record (notices, evidence, kitchen action, any chef reply); mediates if the chef disputes; the kitchen cannot charge for items beyond the actual removal/storage cost shown | Ongoing |

Timelines I would propose for short rentals (**a judgement, not sourced**; self-storage analogues in lifecycle doc a2 use 10-30 days; Virginia: written 10-day notice before disposal, Search-summary):

- **Perishables / food-safety hazard:** 48 hours from the first notice; urgent unsafe items (leaking, spoiled) 24 hours or immediately with photos by the kitchen (lifecycle dead end 19).
- **Non-perishables:** 7 days from the first notice to collect; kitchen holds 14 more days after that before returning/donating/discarding. For a rental of 14 days or less, scale down: 3 days to collect, 7 days hold.
- Holdover charge for these days is a request-to-pay as in the lifecycle doc, not automatic.

What the kitchen is told it must not do: sell, keep for itself, use or open sealed items, discard before the deadline, or act without evidence. If it does, it carries the loss (a chef claim goes against the kitchen, with Local Cooks deciding).

**COUNSEL checklist:** (1) that a contract clause + notice is enough in NL to permit disposal of a licensee's goods; (2) the minimum notice and hold; (3) liability limits; (4) whether "donate" is safe; (5) the notice wording/language; (6) whether Local Cooks sending the notice makes it a party. Until counsel signs off, ship the notify-and-document flow only, and keep kitchen disposal behind Local Cooks approval (OQ7 option A) as an interim.

---

## 5. Kitchen-initiated early end ("reclaim notice")

### 5.1 Peer evidence

| Source | Rule | Tag |
|---|---|---|
| Neighbor | Host needs 30 days' notice; short notice means the host loses the last payout and may pay a $60 fee. | Documented earlier ([notice to vacate](https://help.neighbor.com/en_us/how-to-give-my-renter-a-notice-to-vacate-rkG8DCIRu), page body didn't render this session; I could not re-verify, and a search for it found nothing: treat as carried from the Oct 14 research) |
| Stashbee | Host must give **two months'** notice for monthly storage (one month parking), via the "End booking" button, chat notice not accepted; final payout prorated to the end date. | Documented: [host end booking](https://help.stashbee.com/en/articles/320939-as-a-host-how-do-i-end-my-booking) |
| Self-storage | Tenant 10-15 days' notice; operator ends only through lien/default process. | From lifecycle doc a1 |
| Commissary | Contract-defined; public health forms let either side cancel with notice to the other and the health department. | Search-summary |
| Coworking day/monthly passes | Not researched in this pass. | Not found |

Peers' host notice (30 days to 2 months) is for open-ended, long monthly rentals. Our rentals are days up to ~2 months and fixed-term, with no renewal.

### 5.2 Recommended rule

Notice scaled to the rental length, with the kitchen bearing the cost of cutting short (consistent with "kitchen at fault = full refund of unused time, kitchen bears it"):

| Rental length (original term) | Kitchen notice needed | Notes |
|---|---|---|
| Up to 7 days | None. A kitchen cannot end it early except by emergency path | Too short to be worth a notice |
| 8 to 31 days | min(7 days, time remaining) | |
| 32 to ~62 days | 14 days, or time remaining if less | Matches "14 days for monthly" |
| Emergency (safety, closure, legal) | Immediate via Local Cooks with a reason | Chef refunded unused time, kitchen bears it unless Local Cooks absorbs |

Money:
- **Unused paid time is refunded to the chef in full; the kitchen bears it.** Only the periods already released to the kitchen are exposed: reverse where possible, else net against future transfers (Stripe: reversal needs a positive balance, section 1). With per-period release (section 3) the unreleased periods simply are not paid out.
- If the kitchen gives full notice and the chef leaves on that date, the refund is only for time after the end date, so on a 14-day notice most of the paid time is used and the kitchen pays little.
- Short notice (kitchen gives less than the required notice but not an emergency): chef refunded all time after the end date, plus the Neighbor-style consequence: the kitchen forfeits the *next unreleased* period's share (like losing "the last payout"). **Optional; owner decision (OQ-C).**
- Chef can always leave earlier at her own request (lifecycle OQ5: no refund by default).
- This overrides lifecycle OQ8 option A (30 days for monthly), which is longer than peers' proportionality would justify for a 1-2 month rental; no peer data supports a 30-day notice on a rental that may itself be 3 weeks.

---

## 6. Recommendation table

| Topic | Recommendation |
|---|---|
| Payout trigger | Earlier of move-in done or start + 48 h; hold if a problem/claim is open |
| Payout shape | Per 30-day period; second period 48 h after it starts; transfer with `source_transaction` |
| Max hold | Normal 14 days from charge; hard cap 30 days; Stripe's 90 days (Documented) is not our target |
| Refund / dispute | Refund from platform; reverse transfer if kitchen Stripe balance allows, else net against future transfers (Kitchen Agreement must say so) |
| Manual payouts / `delay_days` / `on_behalf_of` | Don't use (do nothing under SCT, or add obligations) |
| RPAA / FINTRAC | Probably out of scope for short, event-based holds run by Stripe; not certain. Ask Stripe in writing, brief counsel |
| Abandoned items | Kitchen acts after Local Cooks notices; evidence required; 48 h perishables, 7 + 14 days non-perishables; no sale; COUNSEL |
| Reclaim notice | None up to 7 days; min(7, remaining) up to 31 days; 14 days up to ~2 months; emergency via Local Cooks |
| Kitchen-end refund | Full unused time, kitchen bears it |

## 7. Owner questions (options + recommendation)

1. **Payout trigger (replaces lifecycle OQ4).** A: at capture (fastest, most clawback risk). B: end of term (cleanest, slow for kitchen). **C: earlier of move-in done or start + 48 h, per 30-day period (recommended).**
2. **Maximum hold.** A: 14 days normal, 30 days cap (recommended). B: up to 60 days. C: Stripe's 90 days. Longer is more RPAA / FINTRAC unknowns.
3. **Kitchen liability for disputes.** A: Kitchen Agreement says the kitchen owes refunds and chargebacks on its listings, Local Cooks may net against future payouts (recommended). B: Local Cooks absorbs for the pilot (simple, platform pays).
4. **Legal check before launch.** A: get a counsel opinion on RPAA, FINTRAC and the abandoned-goods wording now (recommended). B: launch pilot with short holds and ask Stripe only. C: nothing until a regulator asks (not recommended).
5. **Abandoned items.** A: kitchen acts after Local Cooks notices, perishables 48 h, others 7 + 14 days (recommended, counsel review). B: Local Cooks acts only (lifecycle OQ7-A, safest, slowest, more work for us). C: lien-style sale (no).
6. **Reclaim notice.** A: scaled rule in 5.2 (recommended). B: flat 14 days. C: lifecycle OQ8-A, 30 days.
7. **Short-notice penalty on the kitchen.** A: refund only, no penalty (recommended for pilot). B: kitchen forfeits the next unreleased period's share.

## 8. Not verified

Neighbor payout and notice-to-vacate pages did not render when fetched (carried from earlier research or search text); Airbnb payout page body not readable (summary only); Peerspace, Turo, Airbnb timing from search snippets; Spacer and coworking not found; FINTRAC page itself not opened; chargeback windows from vendor summaries; RPAA in-force dates from memory. The Bank of Canada marketplace policy was read via a page-summary tool, not the raw text: read it directly before relying on the quoted phrases.
