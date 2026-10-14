# Storage structure — external research and recommended Local Cooks shape

**Research handback — 14 October 2026.** Web research plus synthesis for the owner's six storage questions. This file was written read-only: **no application source, migration, database, payment account, hosting configuration or background workflow was changed or queried.** Public pages and vendor documentation were read without signing in to any account; no competitor login, booking or payment was attempted.

**Companion file:** availability & manager occupancy (unit count × date ranges, atomic assignment, the manager storage board, edge cases) is researched separately in **[`research-storage-availability.md`](research-storage-availability.md)** (Oct 14). This file covers terms, the listing form, lifecycle, billing and approvals.

**Names used:** *Priya* is the food-business member who rents storage; *Sam* is the kitchen manager. The company is **Local Cooks** throughout (never "admin"); "chef" is only used where it names a current database column or route (`chefId`, `/api/chef/...`).

**Evidence discipline (same convention as `design-storage-decoupling.md` and `research-booking-model-gaps.md`):**

- **Documented** — a first-party public page or vendor document explicitly states the behaviour, and the URL is cited.
- **Inferred** — a Local Cooks design lesson drawn from the evidence, not a claim about a competitor's internals.
- **Not verified** — public evidence does not establish the capability; say so rather than assume.
- **Repository evidence** — the cited current file in this working tree contains the behaviour (used only where this report touches our own code).

**Authority, in order:** (1) the owner's **final** storage answers recorded at `PHASE0_LOG.md:372-378` (billing monthly in advance; monthly price per unit + daily holdover rate; first rental approved only, auto-renew; cancel anytime, ends at period end, no partial refund, 5-day payment grace, never auto-dispose); (2) the owner's **later direction** at `PHASE0_LOG.md:930` — *"not monthly-only (needs modular terms); the listing form must be simple; research storage check-in/out, early move-out, holdover, cancellation and approval at Food Corridor/peers before deciding"*; (3) the earlier reference design `design-storage-decoupling.md` (explicitly *reference, not a decision*) and the current-state map `map-storage-current.md`; (4) the sibling fairness rules in `local-cooks-booking-policy.md` (C28/C29/C33) and the no-stuck rule (`PHASE0_LOG.md:79`).

> **Where this report disagrees with the earlier design:** `design-storage-decoupling.md` proposed `on_behalf_of` (kitchen as merchant of record) and a 15-day notice to vacate. The parent correction at `PHASE0_LOG.md:385` and the owner's final answer at `:376` supersede both: **platform-as-merchant monthly charge, cancel anytime effective at period end, no renter notice period.** This report follows the owner.

---

## 1. Findings per platform (with citations)

### 1.1 The Food Corridor (TFC) — the shared-kitchen software standard

TFC is the software behind 650+ shared-use kitchens and is the closest thing to an industry reference. Its help centre is the richest public evidence for *how a kitchen actually rents storage*.

**Storage is inventoried as named units with a count and a monthly price.**

- **Documented.** "Simply identify your smallest units of storage spaces (rack, tray, etc.) and their monthly cost, and inventory the number of units of that type of space that is rentable. … storage units are individually applied to your clients' accounts. Clients will be invoiced and billed monthly for their assigned storage units, **until the storage is updated or removed**." [TFC — Set up your Storage and Storage Fees](https://help.thefoodcorridor.com/en/articles/1413924-set-up-your-storage-and-storage-fees)
- **Documented — the listing form fields are exactly four.** "Go to your **Kitchen Settings tab > Storage Units > New Storage Unit.** Name/describe the unit of storage (rack, tray, pallet, sqft. etc), select the type, enter the inventory (number of units available to rent), and the monthly cost per unit. Click Save." [TFC — Set up your Storage and Storage Fees](https://help.thefoodcorridor.com/en/articles/1413924-set-up-your-storage-and-storage-fees)
- **Documented — assignment is per client, with quantity.** "**Clients tab > client name > Storage > Add Storage Rental. Choose the storage rental, the number of units, and add any notes > Add.** The client will be charged for their monthly storage beginning on the client's next monthly bill." [TFC — Assign Clients their Plans, Storage, and Fees](https://help.thefoodcorridor.com/en/articles/1531297-assign-clients-their-plans-storage-and-fees)

**Storage is billed monthly, in advance, automatically, and renews until removed.**

- **Documented.** Monthly bills include: "The monthly Billing Plan … Equipment booked the previous month … **Storage** … Recurring Fees." [TFC — How are Monthly Bills generated?](https://help.thefoodcorridor.com/en/articles/1413975-how-are-monthly-bills-generated)
- **Documented.** "Clients on monthly plans **pre-pay** … Other items billed on the billing date are **storage** and any monthly recurring fees." [TFC — When a Client is assigned a monthly billing plan…](https://help.thefoodcorridor.com/en/articles/1413967-when-a-client-is-assigned-a-monthly-billing-plan-will-they-be-billed-for-the-previous-month-or-the-upcoming-month)
- **Documented — storage is *always* prepaid, even for arrears kitchens.** "A few billings will still be billed as pre-payment for the upcoming month, regardless of the plan… These include: Recurring monthly kitchen fees … **Storage** assigned to the client." [TFC — Can clients pay at the end of the month…](https://help.thefoodcorridor.com/en/articles/1506349-can-clients-pay-at-the-end-of-the-month-instead-of-pre-paying)

**Renewal communication is a review window, not a surprise charge.**

- **Documented.** "Bills generate automatically, **at least 8 days before** the kitchen's billing date… At least **3 days before** the billing date, the client receives a notification that their bills are ready for review. The client has until the billing date to report any discrepancies before the amount due is charged. On the billing date, monthly bills are automatically charged to the client's payment method on file." [TFC — How are Monthly Bills generated?](https://help.thefoodcorridor.com/en/articles/1413975-how-are-monthly-bills-generated); [TFC — How does billing work?](https://help.thefoodcorridor.com/en/articles/1413985-how-does-billing-work)

**Mid-month changes are not prorated — they roll to the next bill.**

- **Documented.** "Mid-month assignments/changes … for any monthly items will first appear on the client's monthly bill the following monthly billing cycle. … The client will **not be automatically charged** for the current month for anything assigned mid-month." (Storage is explicitly named.) [TFC — Assigning or changing a client's billing plan or recurring charges mid-month](https://help.thefoodcorridor.com/en/articles/1413885-assigning-or-changing-a-client-s-billing-plan-or-recurring-charges-mid-month)

**Cancellation policy covers bookings and equipment — *not* storage.**

- **Documented.** "The cancellation policy applies to the space booked as well as any equipment that's reserved." Storage is not mentioned; storage ends by being "updated or removed." [TFC — What is a Cancellation Policy and how does it work?](https://help.thefoodcorridor.com/en/articles/1413947-what-is-a-cancellation-policy-and-how-does-it-work)

**Failed payments: email both parties, auto-retry 3× weekly, then manual.**

- **Documented.** "If a payment fails, an email is sent to the food business … The kitchen manager also receives a failed payment notification. The system will automatically re-attempt running a failed payment **3 times, on a weekly basis**. After 3 times, if the payment is still unsuccessful, the kitchen manager can re-run the past-due payment at any point." [TFC — What happens if a payment fails?](https://help.thefoodcorridor.com/en/articles/1413999-what-happens-if-a-payment-fails)
- **Documented — manager options:** change the amount due / payment plan, re-charge now, apply credit, mark paid, write off as uncollectible, or stop automatic attempts. [TFC — What can I do if a client's payment is past due?](https://help.thefoodcorridor.com/en/articles/1413995-what-can-i-do-if-a-client-s-payment-is-past-due)

**Refunds: prefer a credit; partial refunds allowed.**

- **Documented.** "First, we recommend seeing if adding a **credit** to the client's Food Corridor account will work… Any future charges (bookings, storage, etc.) will be pulled from this credit balance before charging the client's payment method." Partial refunds are supported. [TFC — How do I refund a client?](https://help.thefoodcorridor.com/en/articles/1479949-how-do-i-refund-a-client)

**Approval: the kitchen approves the client (onboarding), then assigns storage.**

- **Documented.** "Once they're kitchen-ready, **approve** them as a client so they can start booking time and paying for kitchen use. Remember to assign your clients their plans, storage, and fees…" [TFC — Onboarding Clients & Prospects](https://help.thefoodcorridor.com/en/articles/1454342-onboarding-clients-prospects-into-your-kitchen)
- **Documented.** "clients are not able to book on your calendars until you have assigned a billing plan to them." [TFC — Assign Clients their Plans, Storage, and Fees](https://help.thefoodcorridor.com/en/articles/1531297-assign-clients-their-plans-storage-and-fees)

**Term vocabulary across TFC:** three billing-plan shapes — **Hourly** (pay-as-you-cook, charged the night of the booking), **Monthly time-based** (prepaid hours), **Monthly credit-based** (prepaid credit). Storage is monthly only. [TFC — How are Hourly Plans billed?](https://help.thefoodcorridor.com/en/articles/1413965-how-are-hourly-plans-billed); [TFC — How are Monthly Plans billed?](https://help.thefoodcorridor.com/en/articles/1413886-how-are-monthly-plans-billed)

**Not verified:** TFC has no documented waitlist for storage; capacity is enforced only by the unit count the manager enters.

### 1.2 The Kitchen Door (TFC's discovery site)

- **Documented.** Kitchens are listed "for **hourly, daily, and monthly** kitchen and storage rentals." [The Kitchen Door](https://www.thekitchendoor.com/) (as quoted on [The Food Corridor](https://www.thefoodcorridor.com/))
- **Documented.** Storage is described as a *shared* resource: "You also get to share expensive resources like **cold storage**, equipment, and cleaning supplies." [The Kitchen Door](https://www.thekitchendoor.com/)
- **Not verified.** The Kitchen Door's per-listing pages do not expose a structured storage SKU (unit count, per-unit price); storage is presented at the kitchen level. Treat "daily storage" as vocabulary, not a documented per-unit daily product.

### 1.3 Neighbor.com (peer-to-peer storage marketplace)

Neighbor is the best public evidence for a **simple host listing form** and a **clean month-to-month lifecycle**.

**Listing form — short, and deliberately shallow.**

- **Documented — the publish flow.** Host provides: whether they can store a vehicle; space type; address (hidden until approval); map pin; a detailed description; **accurate size** ("use a tape measure"); when and how often renters can access their items and any preferred time of day; an optional first-month discount; a price (Smart Pricing optional, with a floor); **photos**; then submit. "Listing on Neighbor is easy and takes about **10 minutes**." [Neighbor — How to Publish a Listing](https://help.neighbor.com/en_us/how-to-publish-a-listing-By8tS89Fc); [Neighbor — Become a Host](https://www.neighbor.com/host)
- **Documented — host controls the rules.** "As a Neighbor host, you're in control over **who** rents, **what** they store, and **when** they can access your space." Hosts "designate your access hours and set your item restrictions." [Neighbor — Become a Host](https://www.neighbor.com/host)
- **Documented — host approves requests.** Hosts have **24 hours** to approve or decline a request, or it auto-expires; an optional **Instant Book** skips the approval step. [Neighbor — Hosting Basics](https://help.neighbor.com/en_us/hosting-basics-B1XBvA8RO); [Neighbor — Managing My Listing](https://help.neighbor.com/en_us/categories/managing-my-listing-H16IHvKT5)
- **Documented — what they do *not* require of a host:** no per-unit condition photos, no move-in/move-out inspection, no deposit, no proof of insurance from the host (Neighbor supplies a **$1M Host Guarantee**), and no renter goods inventory beyond the item description on the request. [Neighbor — Become a Host](https://www.neighbor.com/host); [Neighbor — Hosting Basics](https://help.neighbor.com/en_us/hosting-basics-B1XBvA8RO)

**Rental period: month-to-month only, anniversary renewal.**

- **Documented.** "All spaces on Neighbor are reserved on a **month-to-month basis**. … the reservation will automatically renew for a new monthly rental period on the **same day each successive month**." A 31st-of-month start renews on the last day of a shorter month. [Neighbor — Monthly Rental Periods & Reservation Renewals](https://help.neighbor.com/en_us/monthly-rental-periods-reservation-renewals-SkNmsMnpi)
- **Documented — minimum is one month.** There is no daily or weekly storage SKU. [Neighbor — Monthly Rental Periods…](https://help.neighbor.com/en_us/monthly-rental-periods-reservation-renewals-SkNmsMnpi)

**Cancellation: remove items, then cancel in-app; no proration.**

- **Documented.** "It is the primary responsibility of the renter to **end their reservation** through the Neighbor app or website to prevent future payments from being charged. **After the renter has removed their items** … the renter can cancel." [Neighbor — Cancellation and Refund Policy](https://help.neighbor.com/en_us/cancellation-and-refund-policy-Bkn_vj9QA)
- **Documented — refunds by timing:** pending request ended → full refund; host declines → full refund; cancel within 24h of approval → 100%; cancel ≥7 days before start → 100%; cancel ≤6 days before start → 80% of listing price (0% of service fee); cancel on/after start and >24h after approval → no refund; **cancel on the monthly renewal date → 100% of that period.** [Neighbor — Cancellation and Refund Policy](https://help.neighbor.com/en_us/cancellation-and-refund-policy-Bkn_vj9QA)
- **Documented — no proration.** "Renters are not eligible for a refund nor a prorated amount if they store for less than the standard rental month." [Neighbor — Cancellation and Refund Policy](https://help.neighbor.com/en_us/cancellation-and-refund-policy-Bkn_vj9QA)
- **Documented — host-initiated end needs 30 days' notice.** "hosts are required to give renters at least **30 days' notice** to move out." Less than 30 days → the host "will not receive the host payout for the most recent month and may be charged a **$60 early termination fee**." [Neighbor — How to Give My Renter a Notice to Vacate](https://help.neighbor.com/en_us/how-to-give-my-renter-a-notice-to-vacate-rkG8DCIRu); [Neighbor — Cancellation and Refund Policy](https://help.neighbor.com/en_us/cancellation-and-refund-policy-Bkn_vj9QA)

**Payments: charge at the start of each period, pay the host at the end.**

- **Documented.** "On the **first day of every rental period**, Neighbor automatically charges your renter's credit card. … At the **end of the rental period**, Neighbor sends your host payout." Fee 4.9% + $0.30; **Payout Protection** covers up to two months if the renter stops paying. [Neighbor — How do payouts work as a host?](https://help.neighbor.com/en_us/how-do-payouts-work-as-a-host-HJkBDAICu); [Neighbor — Hosting Basics](https://help.neighbor.com/en_us/hosting-basics-B1XBvA8RO)

**Editing while occupied:** title, description, photos, features, welcome message and access can be edited; **price cannot** — the host must message the renter, get written approval, and contact support. [Neighbor — Editing a Reserved Listing](https://help.neighbor.com/en_us/editing-a-reserved-listing-HyQmwAL0O)

### 1.4 Self-storage norms (the holdover / abandonment reference)

- **Documented — month-to-month with notice to vacate.** "15 days notice to vacate is standard. … All of our leases are **month to month**… All leases renew on the 1st of the month… One month is the minimum lease term." Move-out: "give proper notice and clean out your unit on time, and we'll close your account the day your unit is cleared." Autopay is standard; insurance or a coverage plan is required before move-in. [StorageMart — General Storage FAQs](https://www.storage-mart.com/self-storage/faqs/general)
- **Documented — month-to-month, short-term available.** "Does Storage Post offer month-to-month storage rentals? Yes! Our units can be invoiced on a month-to-month basis." "Storage Post offers short-term storage solutions." [Storage Post](https://www.storagepost.com/)
- **Documented — the nonpayment → lien path.** "When the occupant stops paying the process starts: **overlocking the unit, sending notices, and finally, if necessary, selling the contents** of the unit to partially recoup losses and return the unit back to inventory." Value-limitation clauses (e.g., a $5,000 stored-value cap) are common and statutorily protected in many states. [Self Storage Association — 2025 Legislative Agenda](https://www.selfstorage.org/Blog/ArticleID/388/SSA-Announces-2025-Legislative-Agenda)
- **Inferred.** Self-storage's late-fee/overlock/lien machinery is built for *non-food* goods and for a facility that can legally sell contents. A shared *kitchen* cannot sell perishable food, so Local Cooks should copy the **notice-and-holdover** discipline but **not** the lien-sale remedy — consistent with the owner's "abandoned goods handled manually by support" and "never auto-dispose."
- **Not verified.** No reviewed self-storage operator publishes a per-day *self-serve* storage SKU; daily is a holdover/overstay charge, not a product.

### 1.5 Commissary and shared kitchens (pricing and minimum terms)

| Kitchen | Storage offering (Documented) | Term / minimum | Source |
|---|---|---|---|
| **My Commissary Kitchen** | Dry 4 shelves 18″×24″ **$20/mo**; walk-in cooler 4 shelves **$25/mo**; freezer 1 shelf **$25/mo**; lockable dry cage **$50/mo**; lockable cooler cage **$50/mo** | Membership **$250/yr**; 12-month contract for kitchen-hour packages; licence/health permit/ServeSafe/insurance required | [mycommissarykitchen.com](https://mycommissarykitchen.com/) |
| **Chefs Touch Kitchen** (Albany, CA) | Large storage racks **$250/mo**; freezer **$75/shelf**; cooler **$100/speed rack** | **Month-to-month** agreement + deposit + building access | [chefstouchkitchen.com](https://chefstouchkitchen.com/) |
| **The Church Kitchen** (New Orleans) | $300/mo = 1 shift/wk + 1 walk-in shelf + 1 dry shelf (up to $500/mo for 3) | **6-month minimum**; refundable 1-month deposit; liability insurance; application with references; short-term "case by case" | [thechurchkitchennola.com](https://www.thechurchkitchennola.com/) |
| **Indy's Culinary Centre** | "Dry storage billed per space monthly; Refrigerated storage billed per space monthly; Freezer storage billed per space monthly; Special equipment storage billed per space monthly" | **$275/yr** membership; **$150/mo** minimum spend; licences/insurance/orientation required | [indysculinarycentre.com](https://indysculinarycentre.com/) |
| **O-Town Kitchen** | "Dry, refrigerated, and freezer storage available at **monthly rates (priced by shelf, bin, or reach-in space)**" | Application + onboarding; runs on The Food Corridor | [otownkitchen.com](https://otownkitchen.com/) |
| **Union Kitchen** (DC) | Storage is **included in membership**, not a separate SKU: "Blast chillers and walk-in cold storage"; "Shared commercial equipment, booked by the day" | Membership **$899–$3,290/mo** by equipment-days; no per-shelf storage price published | [unionkitchen.com](https://www.unionkitchen.com/) |
| **ReadySpaces** (small warehouse) | 200–5,000 sq ft units, "one all-inclusive price" | **Month-to-month**, "No long-term commitment required"; **24/7 access** | [readyspaces.com](https://readyspaces.com/) |

**Inferred.** The dominant pattern is **flat monthly price per physical unit (shelf/rack/cage/bin), priced by type (dry/cooler/freezer), independent of cooking time**, held continuously. Some operators **include** storage in a membership instead of pricing it per shelf (Union Kitchen), and some impose a **minimum commitment** (Church Kitchen 6 months; My Commissary 12-month hour packages). **No reviewed operator publishes weekly or hourly storage**, and only self-storage offers a distinct short-term/month-to-month product.

### 1.6 Peerspace (checked because it was on the list — it is *not* storage-like)

- **Documented.** Peerspace is event/creative/meeting space rental. "Reserve your Peerspace and pay **by the hour, without hidden overtime fees**." Bookings are activity/venue based (photo shoots, meetings, parties); there is no custody, storage, or month-to-month holding product. [Peerspace](https://www.peerspace.com/)
- **Inferred.** Peerspace is useful only as vocabulary evidence that **hourly + explicit overtime fees** is a familiar marketplace pattern. It is **not** a storage comparator; do not model storage custody on it.

### 1.7 Stripe (billing feasibility only)

- **Documented — three Connect subscription models.** Direct charges (connected account is merchant of record; recommended for Standard accounts); destination charges (platform charges, funds **auto-transfer** via `transfer_data[destination]`; recommended for **Express/Custom** accounts); separate charges and transfers (platform charges with `on_behalf_of`, **no automatic transfer** — create transfers separately). [Stripe — Subscriptions with Connect](https://docs.stripe.com/connect/subscriptions)
- **Documented — separate charges and transfers mechanics.** "refunding a charge has no impact on any associated transfers"; "a transfer request fails when the amount exceeds the platform's available account balance. **Stripe doesn't automatically retry failed transfer requests**"; `source_transaction` ties a transfer to a charge's availability; "We recommend using separate charges and transfers only when you're responsible for negative balances of your connected accounts." [Stripe — Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)
- **Documented — recurring collection.** Invoices with `collection_method = charge_automatically` charge a saved payment method; the lifecycle is `draft → open → paid`, with `void`/`uncollectible` and **credit notes** for refunds/credits; `invoice.payment_failed` drives recovery. [Stripe — How invoicing works](https://docs.stripe.com/invoicing/overview)
- **Documented — manual capture is single-shot and not for renewals.** "you can only perform one capture on an authorized payment for most payments"; card-not-present authorization windows are **Visa 5 days / Mastercard, Amex, Discover 7 days**. [Stripe — Place a hold on a payment method](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)
- **Repository evidence — our live setup** (from the earlier design): platform + Express connected account on **separate charges and transfers**, manual capture for kitchen bookings, payout-after-closeout planned, platform liable for negative balances (`PHASE0_LOG.md:43-47`). Stripe's own guidance therefore points at separate charges and transfers — which is what we already use.

---

## 2. Comparison table across the six concerns

Legend: **TFC** = The Food Corridor; **TKD** = The Kitchen Door; **NB** = Neighbor; **SS** = self-storage norm; **CK** = commissary kitchens; **PS** = Peerspace; **LC** = Local Cooks recommendation (see §3).

| Concern | TFC | TKD | Neighbor | Self-storage | Commissary | Peerspace | **Local Cooks (rec.)** |
|---|---|---|---|---|---|---|---|
| **1. Term options** | Hourly / monthly time / monthly credit plans; **storage monthly only** | "hourly, daily, and monthly … storage" (vocabulary) | **Monthly only**, min 1 month | **Monthly**, min 1 month; some short-term | **Monthly per shelf**; some 6–12-mo minimum | Hourly (+ overtime) | **Monthly (default) + daily (holdover/short) + optional weekly**; long-term = monthly w/ commitment; **no hourly storage** |
| **2. Listing form** | Name/describe, type, **inventory count**, monthly cost/unit | n/a | ~10-min flow: type, size, description, access hours, item restrictions, photos, price | Size/features; insurance required | Type + shelf count + monthly price | Space/amenity fields | **Name, type, size label, unit count, price/term, access, rules, photos** — one screen |
| **2b. Deliberately NOT asked** | Proration, per-unit condition photos, deposit | — | No deposit, no inspection, no host insurance, no goods inventory | (asks value cap, insurance) | (asks licences, deposit) | — | **No per-cubic-foot, no deposit, no per-unit condition photos at listing** |
| **3. Check-in/out** | Not documented as a storage step | — | No move-in/out inspection; renter cancels in-app after removing items | No inspection; vacate + clean out | Physical access via building access | — | **Move-in photo baseline + move-out clear-or-claim** (reuse our flow) |
| **3b. Early move-out** | Remove storage ("until updated or removed") | — | No proration; cancel on renewal date = full period refund | Notice to vacate; no proration | — | — | **Cancel anytime, effective period end; no partial refund** (owner) |
| **3c. Extend** | Update the storage assignment | — | Not published for storage | Switch/upgrade units | Upgrade plan | Add time | **Add units / upgrade term; auto-renews by default** |
| **3d. Holdover** | Not a separate SKU | — | Next period charged if not cancelled | **Late fee + overlock + lien** | — | Overtime fee | **Daily rate after grace; manager-reviewed; never auto-dispose** |
| **3e. Abandoned goods** | Not documented | — | Support removes renter | **Lien sale** (statutory) | — | — | **Support-managed sequence; never automatic** (owner) |
| **4. Cancellation** | Cancellation policy covers bookings/equipment, **not storage** | — | Cancel anytime in-app; host reclaim needs **30 days** | **~15-day notice**, month-end | Case-by-case | Policy per space | **Renter: cancel anytime → period end. Kitchen: 15–30 days' notice** |
| **4b. Refund for unused** | Credit preferred; partial refunds | — | **None for <1 month**; 100% if cancelled on renewal date | No proration | — | Per policy | **No mid-period refund by default; kitchen may refund upward** |
| **5. Approval** | Kitchen **approves client**, then assigns storage | — | Host approves **each request** (24h) or Instant Book; renewals auto | Gate + autopay | Application/onboarding | Host approves booking | **Kitchen approves first rental only; renewals automatic** (owner) |
| **5b. Capacity / waitlist** | **Unit count** per listing; no documented waitlist | — | Listing = one space; no waitlist | Facility inventory | Physical shelves | — | **Unit count per listing; occupancy ≤ count; no waitlist in pilot** |
| **6. Billing** | **Prepaid monthly**, auto-charge on billing date; storage always prepaid | — | Charge at **start** of each period | Autopay | Monthly invoice | Pay per booking | **Monthly in advance on saved card; auto-renew** (owner) |
| **6b. Renewal comms** | Bill ≥8 days before; notify client ≥3 days before | — | Charge at period start | Autopay reminder | Invoice | — | **Notify before each renewal (≈7 days); charge on anniversary** |
| **6c. Failed payment** | Email both; **retry 3× weekly**; then manual | — | Payout Protection 2 months | Late fee/overlock | — | — | **Retry schedule + 5-day grace → pause access + holdover** (owner) |
| **6d. Payout timing** | Kitchen's normal Stripe schedule | — | **Host paid at end of period** | — | — | — | **Transfer after period closes; at-charge interim** (owner) |

---

## 3. Recommended startup-friendly structure for Local Cooks

Design goal, straight from the owner: **simple where it costs users nothing, but not monthly-only.** The rule that keeps it simple: *the kitchen manager opts into terms; the member always sees one clear price per term; nothing is prorated.*

### 3.1 Term options (answers concern 1)

Offer **three terms**, each **optional per listing**, with **monthly as the default**:

1. **Monthly (default).** Anniversary billing — the rental starts any day and renews on that day each month (Neighbor's exact model: "renews … on the same day each successive month"). This is the shared-kitchen norm (TFC, every commissary) and the owner's chosen model.
2. **Daily.** Two jobs: (a) the **holdover** rate when goods remain past a period, and (b) an optional **short-term** rental for a member who needs a few days. Self-storage and Neighbor only expose daily as an overstay charge, so a self-serve daily SKU is a reasonable Local Cooks extension, **not** a copied feature — say so in copy.
3. **Weekly (optional).** Only if a manager wants it; price it explicitly (do **not** derive it, to avoid the ambiguity we already have with `bookingDurationUnit`). Weekly is **not** a published norm anywhere we reviewed — offer it as a manager option, not a default.

**Long-term:** do **not** build a separate long-term product. Model a long-term commitment as **monthly with a minimum term** (Church Kitchen uses 6 months; My Commissary uses 12) and, if the owner wants it later, a **discounted monthly rate** for a 3/6/12-month commitment. This reuses one billing engine.

**Hourly storage: do not offer.** No reviewed operator sells hourly *storage*; hourly is kitchen *time* (TFC, Peerspace). Storage is custody, not a session. Keeping hourly out is itself a simplification.

**How this stays simple:** the manager toggles which of `monthly / weekly / daily` a unit supports and sets one price for each enabled term; the member picks a term and sees one number; there is **no proration** (matching TFC's mid-month rule and Neighbor's no-proration rule). A member who leaves mid-period is not refunded the part-month; a member who wants less time can simply choose a shorter term next time.

### 3.2 Listing form — minimum fields (answers concern 2)

Mirror TFC's four-field core and Neighbor's shallow, photo-led flow. **One screen, sensible defaults:**

| Field | Required? | Notes / evidence |
|---|---|---|
| **Name / short description** | Yes | "Dry shelf — 18×24" (TFC: "Name/describe the unit … rack, tray, pallet, sqft") |
| **Type** | Yes | `dry` / `cold` (fridge) / `freezer` — reuse the existing enum (`map-storage-current.md` §1.1) |
| **Size label** | Optional | Free text dimensions or "4 shelves"; TFC treats size as descriptive, Neighbor asks for measured size |
| **Unit count (inventory)** | Yes | **The single most important field** — TFC: "enter the inventory (number of units available to rent)" |
| **Price per enabled term** | Yes (≥1 term) | Monthly required; weekly/daily optional. TFC: "the monthly cost per unit" |
| **Access hours** | Optional (default = kitchen access) | Neighbor: "when they can visit … and how often … any time of day"; can default to the location's access rules |
| **House rules** | Optional (default template) | Food-safety defaults: labelling, raw/ready-to-eat separation, allergen notes, no living/working in the unit (Neighbor "strictly prohibits renters from working or staying in a space"). Pre-fill from the CF-styled hygiene rules already noted in the earlier design |
| **Photos** | Recommended | Neighbor leans hard on photos; not required by TFC |

**Deliberately do NOT ask** (keeps the form short and matches peers):

- **Price per cubic foot** — a dead column today (`map-storage-current.md` §8); no reviewed operator prices kitchen storage by volume.
- **A deposit** — Neighbor takes none; TFC does not tie storage to a deposit. (Self-storage does, but that adds refund machinery; defer.)
- **Per-unit condition photos at listing time** — condition is captured at **move-in**, not at listing (see §3.3).
- **Utilities / metering** — Dephna meters utilities, but for a startup pilot this is noise; fold it into the flat price.
- **Insurance certificates at listing** — that is an **onboarding/approval** gate (TFC, My Commissary, Church Kitchen), not a listing field.
- **An hourly price.**

### 3.3 Lifecycle (answers concern 3)

```
request → kitchen approves first rental (assigns a unit)
        → first period charged (Checkout saves the card)
        → move-in check  (photo baseline)
        → active         (auto-renews monthly)
        → extend?        (add units / change term)
        → end early      (cancel anytime → effective period end)
        → move-out check (clear OR damage claim)
        → holdover       (daily rate after grace, if goods remain)
        → abandoned      (support-managed; never auto-dispose)
```

- **Move-in check.** Reuse our arrival pattern: a short checklist + **`photo_before` baseline**, auto-approved (matches today's `requestStorageCheckin`, `map-storage-current.md` §7). This is what makes a later damage claim fair. Neighbor skips this — we should not, because food businesses store goods of real value.
- **Active / renewal.** Monthly, off-session, on the anniversary date; advance the period on success.
- **Extend.** Add units or move to a longer term; renewals are automatic, so "extend" is mainly "add capacity." Reuse the existing extension plumbing but ensure a **subscription renewal and the legacy extension path can never both bill** (the double-billing risk already flagged in `design-storage-decoupling.md` §Risks).
- **End early.** Member cancels anytime; it stops the **next** renewal and the rental ends at **period end** (owner decision). **No partial refund** of the paid period (Neighbor and TFC agree). Move-out is available immediately via the move-out check even if the paid period has not ended — the member just is not refunded for the unused part.
- **Holdover / overstay.** If goods remain past the period, charge the frozen **daily holdover rate** per day until removed, after a **5-day grace** (owner). Reuse `overstay-penalty-service.ts` — but note it currently only "supports" `pricingModel === 'daily'` with frozen terms, so a monthly product **must carry an explicit daily holdover price** or every case escalates to manual (`map-storage-current.md` §6; `design-storage-decoupling.md` C7). **Never auto-charge** (the service's own rule) and **never dispose on a timer**.
- **Abandoned goods.** A written, support-run sequence: overdue → notices → grace → holdover accrues → after a saved maximum, a **manager-confirmed removal**, with food-safety-driven disposal for unsafe/perishable items and a documented notice trail. Owner decision: **handled manually by support.** (We deliberately do **not** copy self-storage lien sales — a kitchen cannot sell food.)
- **Condition / damage.** Move-out is **clear-or-claim**: Sam clears (unit freed) or files a claim with `photo_before`/`photo_after` evidence (reuse `processCheckoutClear` / `processCheckoutStartClaim`). Claims are **reviewed by Local Cooks; never auto-charged** — consistent with the existing damage-claims and overstay rules.

### 3.4 Cancellation / ending (answers concern 4)

- **Member: cancel anytime, effective at period end.** No notice period required (owner decision; matches Neighbor's "cancel any month" and avoids the 15-day friction the earlier design proposed). Cancelling before the renewal date stops the next charge.
- **Kitchen: give notice to reclaim.** If Sam needs the unit back, require **notice to the member** — recommend **15 days** (self-storage norm) or **30 days** (Neighbor's host rule), whichever the owner prefers. A short notice lets the member relocate goods and lets Local Cooks avoid a forced-removal.
- **Refunds.** No mid-period refund by default (industry norm; owner may override). The kitchen may grant a refund **upward** as goodwill — reuse the existing credit-then-refund pattern (TFC prefers a **credit**; we already have refund and credit plumbing).
- **Proration:** none. Mid-period changes roll forward, matching TFC's mid-month rule.

### 3.5 Approval, capacity, waitlists (answers concern 5)

- **Approved members only.** Reuse the existing location eligibility gate (`getApplicationStatusForBooking`; `map-storage-current.md` §3) — storage creation already runs it today.
- **Kitchen approves the first rental only; renewals are automatic** (owner decision). This matches the substance of both peers: TFC's kitchen *assigns* storage to an approved client and then bills monthly until removed; Neighbor's host approves the *initial* reservation and renewals auto-charge. There is **no per-period re-approval** anywhere we reviewed.
- **Capacity per unit.** Enforce **occupancy ≤ unit count** atomically and assign a specific `unitIndex` so two members never share a shelf. Today there is **no capacity model** — a listing is hidden wholesale while one occupant awaits removal (`map-storage-current.md` §8). This is the main thing to add.
- **Waitlist: not in the pilot.** No reviewed platform publishes a storage waitlist (Neighbor: requests are first-come and expire in 24h; TFC: the kitchen assigns). Recommend: when all units are full, show "**Join waitlist**" as a simple notify-me — a **cheap add later**, not a launch feature. Mark as **Inferred/optional**.

### 3.6 Billing, renewals, failed payments (answers concern 6)

- **Recurring auto-renew, not prepaid blocks.** Owner decision: **monthly in advance on a saved card, auto-renew**. This is exactly TFC (prepaid monthly, auto-charged on the billing date, "until the storage is updated or removed") and Neighbor (charged at the start of each period). **Prepaid blocks are worse** (harder refunds/partial use) and should stay deferred, as the earlier design also concluded.
- **First period vs renewals.** First period through a **Checkout session that saves the card** (mirrors our kitchen Checkout and reuses the session/fee code); renewals are **off-session** charges. **Never** use manual capture for renewals — Stripe allows only one capture per authorization and card-not-present holds expire in 5–7 days ([Stripe](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)).
- **Communicate renewals.** Copy TFC's review-window idea in a lighter form: notify the member **before each renewal** (proposal: ~7 days) with the amount and the next date, and let them cancel before it. TFC generates the bill ≥8 days ahead and notifies the client ≥3 days ahead; Neighbor charges at period start.
- **Failed payments.** Retry per a bounded schedule (TFC retries **3× weekly**), email both parties, then after the **5-day grace** (owner) **pause new access** (not removal) and begin the **daily holdover** charge; keep an escalation payment link. Never dispose. Neighbor's **Payout Protection** (pays the host up to two months) is the risk model to be aware of, though our platform-as-merchant model already absorbs the collection risk.
- **Billing path.** Target **Option B** from the earlier design (platform-created monthly charge + **transfer after each period closes**, matching payout-after-closeout); ship **Option C** (monthly off-session invoice on the saved card) as the smallest pilot; **do not** use auto-transfer destination charges, which would pay Sam at charge time and conflict with after-closeout payouts. Owner already accepted "**at charge until payout-after-closeout exists**" (`PHASE0_LOG.md:373`), so document the interim deviation if we ship before closeout payouts are live.

### 3.7 Payout timing

Consistent with our after-closeout model: the **platform charges the member monthly in advance** and **transfers to Sam's Express account after the period closes**, tied to the period's charge via `source_transaction`. This mirrors Neighbor (host paid at the end of each period) and satisfies the owner's "kitchen is paid after the month closes." Until payout-after-closeout is live, pay at charge and record the deviation.

---

## 4. Owner decisions (short) — with a recommended answer for each

Each row is a decision the owner should record in `PHASE0_LOG.md`. "Rec." is this research's recommendation; the evidence column points at §1/§2.

| # | Decision | Rec. | Evidence |
|---|---|---|---|
| **D1** | **Term options** — is monthly-only replaced by modular terms? | **Monthly (default) + daily + optional weekly; long-term = monthly with a minimum term; no hourly.** | §1.1 (TFC monthly), §1.3 (Neighbor monthly), §1.5 (commissary monthly), §1.6 (no hourly storage) |
| **D2** | **Listing form** — confirm the minimum fields and what we omit. | **Name, type, size label, unit count, price per enabled term, access (default), rules (default), photos. Omit per-cubic-foot, deposit, listing-time condition photos, hourly price.** | §1.1 (TFC 4 fields), §1.3 (Neighbor ~10-min flow), §3.2 |
| **D3** | **Move-in / move-out checks** — required or optional? | **Required photo baseline at move-in; clear-or-claim at move-out.** | §1.5/§3.3; existing `storage-checkout-service` |
| **D4** | **Early move-out refund** — refund the unused part? | **No mid-period refund by default; kitchen may refund upward.** | §1.3 (Neighbor no proration), §1.1 (TFC rolls forward) |
| **D5** | **Holdover** — rate, grace, and does it auto-charge? | **Daily rate from the frozen terms; 5-day grace; manager-reviewed; never auto-charge; never auto-dispose.** | owner `:374-376`; §1.4 (overlock norm) |
| **D6** | **Abandoned goods** — policy and sign-off. | **Support-run notice → grace → holdover → manager-confirmed removal; food-safety disposal only with a documented trail; legal review before enabling.** | owner `:377`; §1.4 (we do *not* copy lien sales) |
| **D7** | **Cancellation** — notice period vs cancel-anytime-at-period-end. | **Member: cancel anytime, effective period end (no notice). Kitchen reclaim: 15 or 30 days' notice — pick one.** | owner `:376`; §1.3 (Neighbor 30-day host notice), §1.4 (15-day self-storage) |
| **D8** | **Approval** — first rental only, or every period? | **First rental only; renewals automatic.** | owner `:375`; §1.1/§1.3 |
| **D9** | **Capacity & waitlist** — unit count now; waitlist later? | **Enforce unit count atomically now; no waitlist in pilot (optional "notify me" later).** | §1.1 (TFC inventory), §1.3 (no waitlist) |
| **D10** | **Billing** — recurring auto-renew vs prepaid blocks; billing path. | **Recurring monthly in advance; first period via Checkout (saves card); renewals off-session. Target Option B; pilot Option C; not destination-charge auto-transfer.** | owner `:373`; §1.7 (Stripe), §3.6 |
| **D11** | **Renewal communication** — how far ahead, and how. | **Notify ~7 days before each renewal with amount + date; charge on the anniversary.** | §1.1 (TFC ≥8/≥3 days), §1.3 (Neighbor charge at period start) |
| **D12** | **Failed payment** — grace and consequence. | **Retry schedule + email both; 5-day grace → pause new access + start holdover; escalation link; never dispose.** | owner `:376`; §1.1 (TFC 3× weekly), §1.3 (Neighbor Payout Protection) |
| **D13** | **Payout timing** — after period close, or at charge? | **Transfer after each period closes (target); at charge as documented interim until payout-after-closeout is live.** | owner `:373`; §1.3 (Neighbor end-of-period), §1.7 |
| **D14** | **Legacy rows** — keep contract? | **Keep every existing kitchen-linked storage row unchanged; new rentals are standalone.** | owner `:377`; earlier design §3.7 |

---

## 5. What can reuse our existing booking machinery

Storage is unusual only in its **term and custody**; almost everything else already exists. Reuse, don't rebuild:

| Need | Existing machinery (repository evidence) | Reuse plan |
|---|---|---|
| **Move-in check** | `requestStorageCheckin` — auto-approved, enforces manager-configured arrival duties/photos, stores `photo_before` baseline (`storage-checkout-service.ts`, `map-storage-current.md` §7) | Reuse as-is for a monthly move-in |
| **Move-out check** | `requestStorageCheckout` → manager `processCheckoutClear` (frees unit) or `processCheckoutStartClaim` (files a draft claim, attaches `photo_before`/`photo_after`) | Reuse clear-or-claim; wire "free one unit" to the new capacity model |
| **Inspection / damage claims** | Draft claim creation + photo evidence + Local Cooks review; **never auto-charge** (`design-storage-decoupling.md` §1.6; `build-damage-claims.md`) | Reuse unchanged |
| **Extensions** | `pending_storage_extensions` + manager approve + auth-then-capture (`server/routes/bookings.ts`, `server/routes/manager.ts`) | Reuse for "add units / change term"; **block it on subscription-backed rows** to avoid double billing |
| **Holdover / overstay** | `overstay-penalty-service.ts` — detect past `endDate`, grace, daily rate × penalty, manager approve/waive, off-session charge, **never auto-charge**, skip in-progress checkouts | Reuse; **add an explicit daily holdover rate to the monthly terms** so cases don't all escalate (fixes C7) |
| **Request-to-pay / off-session** | Saved `stripePaymentMethodId`/`stripeCustomerId`; escalation payment link when no card (`overstay-penalty-service.ts`) | Reuse for renewals and holdover collection |
| **Cancellation engine** | `shared/cancellation-policy.ts` already has a `storage` component and a **"used storage" non-refund** reason (`map-storage-current.md` §9) | Reuse the *refund math*; storage's clock becomes **period end**, not the kitchen start |
| **Custody invariants** | `cancelledStorageStatus` / `storageListingAwaitingRemoval` keep a unit blocked until Sam confirms removal (`booking-linked-cancellation.ts`) | Reuse so a cancelled-but-not-emptied unit is never re-let |
| **Approval gate** | `getApplicationStatusForBooking` (approved-members-only via location access) | Reuse as the eligibility check before a first rental |
| **Manager surface** | `storage-bookings` nav destination + `ManagerStorageBookingsPage`, checkout/overstay queues | Extend into an occupancy/subscription view rather than a parallel module |
| **Member surface** | (missing today) | Build the new **"Manage my storage"** first-class surface; keep the kitchen-booking storage step as a shortcut |
| **Support desk** | D11 rule: support actions for every state (`PHASE0_LOG.md:259`) | Reuse for holdover, removal, refunds, forced ending |
| **Access / visit code** | Visit-code + arrival flow is **session-shaped** | Storage access uses the location access gate; do **not** force storage through the session visit-code UI |

**Do not reuse:** the kitchen-session cancellation clock (`booking-item-cancellation.ts` computes the deadline from the kitchen start time and a hard-coded zone) and the session-shaped visit-code flow. Those are exactly the couplings the redesign must break (`design-storage-decoupling.md` §1.9, C4/C9).

---

## 6. Sources (URLs, checked 13–14 October 2026)

**The Food Corridor / Kitchen Door**
- https://www.thefoodcorridor.com/
- https://help.thefoodcorridor.com/en/collections/822946-billing
- https://help.thefoodcorridor.com/en/articles/1413924-set-up-your-storage-and-storage-fees
- https://help.thefoodcorridor.com/en/articles/1414037-how-do-i-add-storage-units-to-a-monthly-plan
- https://help.thefoodcorridor.com/en/articles/1531297-assign-clients-their-plans-storage-and-fees
- https://help.thefoodcorridor.com/en/articles/1413886-how-are-monthly-plans-billed
- https://help.thefoodcorridor.com/en/articles/1413965-how-are-hourly-plans-billed
- https://help.thefoodcorridor.com/en/articles/1413975-how-are-monthly-bills-generated
- https://help.thefoodcorridor.com/en/articles/1413985-how-does-billing-work
- https://help.thefoodcorridor.com/en/articles/1413967-when-a-client-is-assigned-a-monthly-billing-plan-will-they-be-billed-for-the-previous-month-or-the-upcoming-month
- https://help.thefoodcorridor.com/en/articles/1506349-can-clients-pay-at-the-end-of-the-month-instead-of-pre-paying
- https://help.thefoodcorridor.com/en/articles/1413885-assigning-or-changing-a-client-s-billing-plan-or-recurring-charges-mid-month
- https://help.thefoodcorridor.com/en/articles/1413947-what-is-a-cancellation-policy-and-how-does-it-work
- https://help.thefoodcorridor.com/en/articles/1413999-what-happens-if-a-payment-fails
- https://help.thefoodcorridor.com/en/articles/1413995-what-can-i-do-if-a-client-s-payment-is-past-due
- https://help.thefoodcorridor.com/en/articles/1479949-how-do-i-refund-a-client
- https://help.thefoodcorridor.com/en/articles/1454342-onboarding-clients-prospects-into-your-kitchen
- https://www.thekitchendoor.com/

**Neighbor.com**
- https://www.neighbor.com/host
- https://www.neighbor.com/how-it-works
- https://help.neighbor.com/en_us/hosting-basics-B1XBvA8RO
- https://help.neighbor.com/en_us/how-to-publish-a-listing-By8tS89Fc
- https://help.neighbor.com/en_us/editing-a-reserved-listing-HyQmwAL0O
- https://help.neighbor.com/en_us/how-to-price-your-listing-B1XnlXUyT
- https://help.neighbor.com/en_us/monthly-rental-periods-reservation-renewals-SkNmsMnpi
- https://help.neighbor.com/en_us/cancellation-and-refund-policy-Bkn_vj9QA
- https://help.neighbor.com/en_us/how-do-payouts-work-as-a-host-HJkBDAICu
- https://help.neighbor.com/en_us/how-to-give-my-renter-a-notice-to-vacate-rkG8DCIRu

**Self-storage**
- https://www.storage-mart.com/self-storage/faqs/general
- https://www.storagepost.com/
- https://www.selfstorage.org/Blog/ArticleID/388/SSA-Announces-2025-Legislative-Agenda

**Commissary / shared kitchens**
- https://mycommissarykitchen.com/
- https://chefstouchkitchen.com/
- https://www.thechurchkitchennola.com/
- https://indysculinarycentre.com/
- https://otownkitchen.com/
- https://www.unionkitchen.com/
- https://readyspaces.com/

**Peerspace**
- https://www.peerspace.com/

**Stripe**
- https://docs.stripe.com/connect/subscriptions
- https://docs.stripe.com/connect/separate-charges-and-transfers
- https://docs.stripe.com/invoicing/overview
- https://docs.stripe.com/payments/place-a-hold-on-a-payment-method

**Internal (read-only, cited above):** `design-storage-decoupling.md`, `map-storage-current.md`, `PHASE0_LOG.md` (owner storage answers `:372-378`; modular-terms direction `:930`), `local-cooks-booking-policy.md` (C28/C29/C33), `build-damage-claims.md`.

---
## Owner decisions (Oct 14) — recorded by the lead; storage is built AFTER booking
Verified independently: TFC storage = kitchen-created units ("number of units" + "monthly cost per unit"), assigned to a renter's account, billed monthly (help.thefoodcorridor.com/en/articles/1413924, /14744018).

1. **Access + decoupling:** only chefs approved for that kitchen (existing application flow) can rent storage. Storage is its own product: rentable standalone from the kitchen page / "My storage", AND offered as a shortcut during a kitchen booking. It is not tied to a kitchen session's dates or cancellation.
2. **Terms:** **monthly** (main product) + **daily for any date range** ("multi-day", e.g. 5 days, priced per day). Lead view: multi-day at a daily rate is standard (commissaries and self-storage day rates; the Neighbor minimum is 1 month). It is just a daily rate × days with a start/end date, so it adds no complexity. Show a gentle hint when a daily range costs more than a month ("A month is cheaper: $X"). **No weekly, no hourly.**
3. **Kitchen reclaim notice:** 30 days for monthly rentals; daily/multi-day rentals can't be reclaimed early by the kitchen (they end on their own); emergencies go through Local Cooks support (admin can end/relocate with a reason; chef refunded for unused time when the kitchen is at fault).
4. **Renewals — no silent auto-charge at startup:** 7 days before a monthly period ends, the chef gets **"Renew for {next month} · $X"**: a one-tap pay on the saved card (on-session). If the one-tap payment fails or the chef prefers it, it falls back to **Stripe Checkout** (manual card entry). **No automatic retries.** Kitchen discretion (like the self-check-in setting): per kitchen, "Renewals: chef confirms each month (default)" or "Let chefs turn on auto-renew" (the chef can then explicitly opt in to automatic monthly charges, with a clear consent line and a reminder email each time). Unrenewed by the period end → 5-day grace → the rental ends and move-out is due; goods still there → daily holdover via request-to-pay (never auto-charged).
5. **Admin controls (support desk):** view all storage rentals per kitchen/chef; extend/end/relocate with a reason; waive/refund (Local Cooks- or kitchen-funded); pause holdover; resolve disputes; override the kitchen renewal setting; all audited.
6. Adopted defaults from the research list (unless the owner changes them): the listing form = name, type, size label, unit count, monthly price, daily price (optional), photos, with prefilled access/rules; capacity enforced atomically by unit count; no waitlist; move-in/move-out photo check + clear-or-claim (reusing the booking flows); no mid-period refund on early move-out (the kitchen may refund more); the kitchen is paid after each period closes; existing kitchen-linked storage keeps its terms until it ends.

## Owner decisions — availability & occupancy (Oct 14, LOCKED for now)
See `research-storage-availability.md`. Locked:
- auto-assign a free unit at approval (the manager can change the unit);
- an optional kitchen-set unit label that the chef sees after assignment ("Your shelf: Freezer B2"; default "Shelf 2") — the lead's correction to the research, since the chef must find their goods;
- reserved-not-moved-in holds the unit (alert at 7 days; the manager can release it);
- out of service = pause the listing + a per-unit "needs cleaning" state;
- renters see "Available now / Available from {date} / Full";
- an optional cleaning buffer between renters, off by default;
- no waitlist;
- the manager storage board: a desktop table / 390 px cards, unit states Free · Reserved · Items stored · Renewal due · Move-out due · Holdover · Needs cleaning, a "Needs attention" filter, five alerts, an occupancy summary.

**Owner guardrail for the build:** no overkill. Only what's needed to work without friction; minimal options; never cluttered, unusable or intimidating; intuitive for food-business owners and kitchen managers. Apply the booking restraint budget (`design-booking-consolidation.md` §7) to every storage screen.

## Owner decisions — kitchen flexibility (Oct 14)
Mirror the booking-cycle control patterns, all kitchen-initiated and living in each rental's "⋯ More" menu (never up-front buttons; the board's card keeps one primary action):
- **Holdover:** the kitchen chooses Waive or Charge (can only lower the computed amount); the charge is a request-to-pay (one tap / dispute → Local Cooks), never automatic.
- **Early move-out:** always allowed; no refund by default; the kitchen can refund unused time with one tap (from its payout; capped).
- **Extend/adjust:** extend the end date Free or Charge (the chef accepts and pays if charged).
- **Special price for a particular chef:** "Invite a chef" with a custom monthly/daily price → the chef accepts and pays with one tap through the normal rental flow (shares the planned booking-invites feature).
- **One-off adjustment:** discount the next renewal or credit a period, with a shared note.
Chef sees only outcomes and offers ("PHASE0 Main Kitchen waived the holdover"; an invite card with the price + one button). The admin can do all of the above on the kitchen's behalf from the support desk (audited).
