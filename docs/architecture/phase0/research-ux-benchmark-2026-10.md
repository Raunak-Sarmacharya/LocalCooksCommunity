# UX benchmark: booking screens, flow, and what makes a kitchen pay (2026-10)

Scope: screens, flow, host-pays drivers. Policy and money findings are in `research-booking-standards.md` and `research-booking-model-gaps.md` and are not repeated.
Method: vendor help centers and pricing pages fetched 2026-10-21. Pages were read as text, so no screenshots were seen. Anything about pixel layout or mobile layout is "unverified" unless a source says it. Third-party pages are labeled as such.

Source shorthand:
- TFC = The Food Corridor. TFC-help = https://help.thefoodcorridor.com/en/
- PS-help = https://intercom.help/peerspace-108cf19aff8e/en/articles/<id>
- ABNB = https://www.airbnb.com/help/article/<id>

---

## 1. The Food Corridor (TFC)

### 1.1 What a kitchen operator pays
Source: https://www.thefoodcorridor.com/pricing/ (USD, with CAD shown on the same page).

| Plan | USD/mo | CAD/mo | Renters | Kitchen Door listing | Free first month |
|---|---|---|---|---|---|
| Starter | 129 | 179 | up to 5 active | "Verified" | not listed |
| Annual (billed yearly, "Save 10%") | 206 | 264 | unlimited | "Preferred" | yes |
| Professional | 229 | 293 | unlimited | "Preferred" | yes |
| Multiple Locations | custom | custom | custom | custom | custom |

- Platform fee: 4% on all plans. On Professional and Annual it drops to 2% for renters paying by bank transfer (ACH/PAD) or manual (cash/cheque). Starter stays 4% flat.
- Small-card surcharge: US cards under $30 add $0.30. Canadian cards under $40 add $0.40.
- The kitchen chooses to absorb the fee or pass it to the renter as an invoice line.
- No long-term contract, 30 days' notice to deactivate. No onboarding fee. One free 1:1 onboarding call, extra calls $70.
- Add-ons: Onboarding Flows $19/mo (0-5 checklists assigned), $29 (6-10), $39 (11+), CAD $27/$41/$55. QuickBooks connection $30/mo, US only.
- Included on all plans, as listed on the pricing page: scheduling, customizable rates, automatic billing, metrics and reporting, client management, equipment reservations, storage management, document management, sign-in/out, leads listing, messaging, client support.
- Discrepancy: Capterra/Software Advice list Starter at $49/mo (e.g. https://www.softwareadvice.com/cafm/the-food-corridor-profile/). The vendor page says $129. Treat the vendor page as current; the $49 is a stale third-party figure.
- A third-party comparison (older, via search snippet) says TFC charged "$179/month plus 4 percent". That matches today's CAD Starter. Unverified as a primary source.

Read: the tier split is by renter count and by marketplace placement (Verified vs Preferred), plus a 2-point fee break for non-card payment. Operators are paying for a lead channel (The Kitchen Door) as much as for software.

### 1.2 Features TFC markets as the reason to pay
Source: https://www.thefoodcorridor.com/ (homepage), plus the kitchen admin tab list in TFC-help articles/1413937-what-is-the-function-of-each-tab.

| Marketed benefit | Homepage wording / what it is |
|---|---|
| Calendar | "Streamline Scheduling to Optimize Your Kitchen": reserve kitchen areas, reservable equipment, dry and cold storage |
| Onboarding | "Quickly Onboard New Renters": built-in document collection, claims 3X faster onboarding |
| Compliance | Automated expiration reminders, in-app insurance (FLIP integration) |
| Billing | "Bill Automatically. Get Paid On Time.": automatic invoices for bookings, fees and storage; online payments; QuickBooks sync |
| Membership plans | "Customize Membership Plans, Monthly, Hourly, and/or Credit-based" |
| Reporting | "Reports & Insights": top renters, busiest days, space utilization |
| Leads | Inquiries from The Kitchen Door in one dashboard, with invites and reminders |
| Marketplace perks for renters | Partner discounts on insurance, compliance, bookkeeping, POS |

The homepage did not mention access control or recurring bookings. Recurring bookings are real in the product (section 1.3). Capterra lists "access controls/permissions" (https://www.capterra.com/p/210722/The-Food-Corridor/); TFC's own version is a per-renter 4-digit PIN and a digital sign-in sheet (TFC-help articles/1812934).

Kitchen admin navigation (TFC-help articles/1413937):
- Scheduling: approve/decline requests, space and equipment calendars, create bookings, daily summary.
- Clients: client list, invites, sign-in sheet. Each client profile has General settings, Statement, Fees/Credits, Storage, Recurring Charges, Documents, Bookings, messaging.
- Onboarding (under Clients): track applicants, message them, approve. Plans and recurring fees can be assigned only after approval.
- Leads (under Clients): Kitchen Door intake form submissions. Leads have no account, so contact is by email.
- Documents: filter by missing, expired, soon-to-expire. FLIP integration.
- Billing: pending monthly and daily bills, outstanding balances, expected overages, past statements, link to Stripe dashboard.
- Reporting: payments, bookings, storage, clients, sign-ins. QuickBooks export.
- Kitchen Settings: calendars, onboarding flows, billing plans, storage inventory, standard fees/credits, required documents, cancellation policy, tax rate, notifications, billing date.

Help center has 9 collections (Billing is the largest at 52 articles) (https://help.thefoodcorridor.com/en/). Support is Mon-Fri 9-5 MT per a search snippet of articles/14727078. Unverified beyond that snippet.

### 1.3 Renter (chef) side
Booking flow, from TFC-help articles/1413904-how-do-i-book-in-my-kitchen:
1. Log in, open the Calendars tab.
2. Click a calendar name to see the space description and approved bookings. Daily View shows approved bookings for the whole kitchen.
3. Drag across the wanted slot, or "Create New Booking" and pick space, date, time.
4. Optional "Add Equipment": set its own time range, add items with +. Repeat for equipment needed at another time.
5. Repeat setting: never, daily, weekly, monthly, plus an end date.
6. Review (trash icon removes equipment). Click "Create Booking".
7. The request goes to the kitchen to approve or decline. The renter is notified and tracks Submitted/Approved/Declined on the Bookings tab.

Things the article does not show: a price on the booking screen, or cancellation terms at booking. Unverified whether either appears. Pricing handled by "different hourly rates for a booking" article exists (title only, scheduling collection).

Approval model (TFC-help articles/1413992 and 1413916):
- Default: admin approves or declines every request. Pending requests in the next 30 days show under Scheduling > Submitted Bookings. Further out, open the specific calendar; request-colour (typically red) bookings need approval.
- Per-renter "Auto Approve" toggle (Clients > name > Settings > Edit). Suggested once a renter has a standard schedule or has been trained.
- Renter edits (articles/1524649): with auto-approve, "Update Booking" saves at once; without, "Request Change" goes to the admin and approving replaces the booking. Edit rules depend on the kitchen's cancellation-policy window (inside the window: extend and add equipment only; cannot shorten or move). After the booking day: no edits.

Renter account sections (TFC-help articles/1812934): Bookings (all statuses, plus booked vs paid hours for prepaid monthly plans, plus the 4-digit PIN and sign-in sheet), Calendars, Billing, Documents (reminders at 45, 14, 3 days before expiry), Reporting (bookings, invoices, sign-ins), Community (message other renters), Settings (profile, onboarding checklist, notifications, payment method, resources).

Invoices (TFC-help articles/14759929-how-to-check-your-bill): Billing section lists monthly invoices with status (paid, pending, outstanding). Statement shows recurring plan charges, hours used and overage, fees/credits, total due. Email when an invoice is ready. Itemised detail under Reporting > "Billed Line Items". Autopay by card or ACH on the due date (search snippet of articles/14759929 and 1414002, unverified at article level). Hourly pay-as-you-go renters are charged on the day of the booking (search snippet, unverified at article level).

Recurring: scheduling collection has "How long do recurring bookings last?" and "How do I create recurring bookings with an end date?" (https://help.thefoodcorridor.com/en/collections/822962-scheduling). TFC does not sync to Google Calendar or iCal (article title "Why doesn't The Food Corridor sync with Google Calendar or iCal?", same collection).

Operators describe their own onboarding order: account, payment method, documents, approval, then first booking, sometimes after a 15-minute orientation (search snippets of kitchen onboarding templates, e.g. https://www.thefoodcorridor.com/wp-content/uploads/2022/10/Client-Onboarding-Email-Template-1.pdf). Unverified as TFC product behavior; it is operator practice.

---

## 2. Other kitchen-side peers (short)

| Peer | Cost to kitchen | Headline features | Source |
|---|---|---|---|
| The Kitchen Door | Pricing not found. Listing is free per TFC homepage; "Verified" vs "Preferred" placement tied to TFC plan. Leads land in TFC Leads Manager | Directory plus lead intake form | https://www.thefoodcorridor.com/ , https://www.thefoodcorridor.com/pricing/ |
| Spacebring | Business $178/mo, 6-month minimum, 100 monthly active users, 1 location; extra users $85 per 50; extra location $100; mobile app add-on $113/mo | Automated monthly invoicing, admin-approved sign-ups so only trained users book, per-room rules and prep time, equipment booking, community feed and events, access control and accounting integrations, occupancy analytics, white-label app | https://www.spacebring.com/pricing , https://www.spacebring.com/solutions/shared-kitchen-management-software |
| Cookitoo | Free to list, 20% commission per rental booking (2018 article, may be stale) | Listings show hourly price, equipment, times; search by equipment, storage, location, price | https://thespoon.tech/cookitoo-brings-rental-kitchen-marketplace-from-down-under-to-the-bay-area |
| Cookhouse | Unverified. Search shows a Malaysian physical operator, not software. Likely the wrong entity for the owner's question | n/a | n/a |
| PREP (prepto) | Unverified. Only PREP ATL (a physical Georgia kitchen, 2020 sheet) was found, not a software product | n/a | https://www.prepatl.com/wp-content/uploads/2020/04/PREP-Catering-Kitchen-Pricing-2020.pdf |

Operators' own pricing context: TFC's pricing-models guide reports 45% of operators offer two or more billing options, volume discounts are the most common incentive (62%), and monthly plans are mostly prepaid with no rollover (54%) (https://www.thefoodcorridor.com/toolkit-guide/pricing-models/).

---

## 3. Guest booking flow, step by step

Legend: "unverified" means the source did not describe the screen.

### 3.1 Peerspace

| Step | Screen content | Primary action | Price display | Cancellation display |
|---|---|---|---|---|
| Search / listing | Listing page with photos (host minimum 10, 20+ recommended), About the Space, amenities, host rules, FAQs. Host must state what the price includes (PS-help 10119525, listing requirements) | Enter dates, times, attendee count | Hosts are told to use an all-inclusive hourly rate; variable and attendee pricing and cleaning fee apply automatically (PS-help 10119469) | Cancellation tier per listing: Very Flexible full refund to 24h; Flexible full refund to 7 days, 50% between 7 days and 24h (search snippet of PS-help articles 10119471, 10119475) |
| Date / time | Same listing page; blocked times greyed out and cannot be requested (PS-help 10119400) | "Start Booking" | Exact guest fee shown "during booking" once dates and times are entered (PS-help 10119157, https://www.peerspace.com/legal/terms/fees-overview) | unverified |
| Add-ons | Add-ons step exists (host invite-to-book flow goes "Continue to Add-ons" then "Continue to review booking", PS-help 10119469). Guest-side add-on screen layout: unverified | Select add-ons | Service fee is collected on add-ons too (search snippet, Peerspace add-on rules) | unverified |
| Review / confirm | Event details form, then "Request to Book". Peerspace says the request is "financially binding" and agreeing means accepting the Services Agreement including the Cancellation and Refund Policy (PS-help 10119133) | "Request to Book" | Total shown before acceptance: "The total price for a Booking will be presented prior to your acceptance." (fees overview) | Linked policy, not described as a per-booking summary: unverified |
| Payment | Hold may be placed at request; full total charged when host accepts (fees overview). PS-help 10119400-era article says "charged in full when they request"; the fees overview is the primary source, so hold-then-charge is the better reading | none (automatic) | Fees may be adjusted if booking changes | n/a |
| Post-request status | Host has 2 business days (PS-help 10119524) or 48h per Peerspace blog (https://www.peerspace.com/resources/accepting-booking-requests/). Expiry or decline releases the hold. Guest can message with no commitment. Instant Book listings skip approval except within 24h of start (PS-help 10119400) | Wait / message host | n/a | n/a |

Mobile layout: Peerspace has iOS and Android host apps (https://apps.apple.com/app/id823879288). Guest-side mobile layout: unverified.

Note on host-initiated changes: host sends "Invite to Book" with custom price, hours, add-ons; guest has seven days (PS-help 10119469). Another article says seven business days (PS-help 10119524). Minor conflict inside the vendor's own docs.

### 3.2 Airbnb

| Step | Screen content | Primary action | Price display | Cancellation display |
|---|---|---|---|---|
| Search / listing | Search results, map and listing page show a total price including fees, excluding taxes (US: toggle disabled, always total) (ABNB 3365, 3610) | Pick a listing | Total on search card; taxes added at checkout | Policy on listing page, the confirm-and-pay step, and the confirmation email (ABNB 4052 via search result) |
| Date selection | Dates and guests on listing | Reserve / Request to book | unverified at this step | unverified |
| Add-ons | Not a standard step for homes. Unverified | n/a | n/a | n/a |
| Review / confirm | Checkout page with a "Price breakdown" link showing nightly rate, service fee, discounts, taxes (ABNB 3365). Guest service fee 14.1% to 16.5% of subtotal, viewable in the breakdown (ABNB 104) | Confirm and pay / send request | Itemised on demand, total up front | "Free cancellation before [date]" label: exact wording unverified; the help centre says the policy shows at confirm-and-pay |
| Payment | Request to book: charged only if host accepts (outside India). Declined or unanswered after 24h: full refund, may take up to 15 days to arrive (ABNB 85) | n/a | n/a | n/a |
| Post-request status | Host typically responds within 24h. Guest can withdraw a request before acceptance (ABNB 85) | Wait or withdraw | n/a | n/a |

Mobile layout: only stated detail is that the date-multi-select for hosts works by tap-hold-swipe (ABNB 447/2060 via search). Guest mobile screens: unverified.

### 3.3 Food Corridor (renter side)
See 1.3. The steps are calendar-first (pick space, drag a time range, add equipment with its own time range, set repeat, submit). There is no search or listing stage inside the product because renters arrive via The Kitchen Door or an operator invite. Price, fees, and policy display on the booking screen: unverified.

### 3.4 Pattern summary
- Airbnb: price shown total-first, itemised on demand, charge only on acceptance for request-to-book.
- Peerspace: price confirmed before acceptance, hold then charge, binding request.
- TFC: no money shown in the documented booking steps; billing happens on the statement. A marketplace-style trust flow does not exist there.

---

## 4. Host side

### 4.1 Peerspace
Sources: PS-help 10119524 (receiving a request), 10119527 (response metrics), 10119400 (calendar), https://www.peerspace.com/resources/your-monthly-space-stats-explained/ , search snippet of PS-help 10119442.
- Request inbox: notification by email or text including booking details and expected payout. Accept or decline from the bookings page. Messaging in the Inbox thread. Message templates available. Layout of the screen itself: unverified.
- Request review: information named in the sources is booking details, cancellation policy, payment process, guest fee, host service fee, and expected payout. The host service fee is "shown on each booking request the host receives" (search snippet of PS-help 10119442; range 15% to 20% in that snippet). Actions: accept, decline, message, or "invite to book" with changed price/date/add-ons. Hierarchy of fields on screen: unverified.
- Deadline: 2 business days or 48h. Expired requests lower response rate and search visibility.
- Calendar: Calendar page with a space dropdown and "Block Time" per date; title is private; blocked time is greyed out for guests. Sync with Google Calendar, iCal, Outlook (search snippet). Instant Book toggle in Listings > Edit > Instant Book Settings.
- Reservation detail: unverified.
- Payouts: ACH direct deposit via Stripe, typically within 7 days after the reservation ends (PS-help 10119524); additional charges submitted within 72h after the event are usually paid separately. "Payout History" in the account (search snippet). Monthly stats email: completed bookings, earnings, review scores, response time.

### 4.2 Airbnb
- Request: accept or decline within 24h, counts as a response either way; expiry counts as non-response (ABNB 430, 2414). Booking inquiries add pre-approve, special offer, message, decline.
- What the request screen shows about the guest: not stated in help text, so unverified. Airbnb markets reservation screening and guest ID verification as pre-trip safeguards (https://www.airbnb.com/resources/hosting-homes/a/how-airbnb-protects-hosts-5).
- Calendar: per-listing calendar; available nights white, blocked nights struck through; selecting a blocked night shows whether you or Airbnb blocked it; multi-select by tap-hold-swipe on mobile (ABNB 447, 2060 via search). Multi-calendar view: unverified.
- Reservation detail: Today page lists current/upcoming reservations. Open one to print details. Past ones via Earnings > Paid, filter by date/listing/type, then "Details" next to the confirmation code (ABNB 418). Airbnb also describes private notes on reservations (https://www.airbnb.com/resources/hosting-homes/a/new-hosting-tools-to-help-grow-your-business-738, via search snippet).
- Payouts: Menu > Earnings, Upcoming vs Paid tabs, CSV export filtered by listing/payout method/date with service fee, cleaning fee, gross earnings, taxes withheld (ABNB 418).

### 4.3 Food Corridor host (for contrast)
The admin is not an inbox but a management console: Scheduling (requests plus calendars), Clients (the per-renter record is the hub: statement, fees, storage, recurring charges, documents, bookings), Billing, Reporting. Information hierarchy: renter-centric, not booking-centric. Source: TFC-help articles/1413937.

---

## 5. Trust signals

| Signal | Peerspace | Airbnb | Food Corridor |
|---|---|---|---|
| Host identity | Stripe verification, verified phone and email, photo, last names never public (PS-help 10119525) | Not detailed in sources fetched | Kitchen Door "Verified" (Starter) vs "Preferred" (higher plans) placement (pricing page) |
| Guest/renter identity | unverified | Guest identity verification against government ID, background checks where law permits, watchlist screening (https://www.airbnb.com/resources/hosting-homes/a/how-airbnb-protects-hosts-5) | Kitchen approves each renter via onboarding checklist; documents collected; per-renter PIN |
| Reviews | Mutual; each review marked as booked vs attended; categorised by space; "Verified" label when interaction confirmed; automated screening (PS-help 10119541 via search; Trustpilot-quoted policy) | Hosts and guests have 14 days post-checkout; reviews hidden until both submit or window closes (third-party: https://www.hostfully.com/blog/airbnb-review-policy/, unverified at Airbnb help level) | Reviews not found. Renter profiles include a Business Profile and Community tab |
| Response time | Response time and response rate shown on each listing; 90%+ rate makes a host eligible for Power Host (PS-help 10119527) | Response rate within 24h; Superhost needs 90% response, under 1% cancel, 4.8 rating, 10 stays (ABNB 829 via search) | Not found |
| Badges | Power Host medal on listing and host profile, priority support | Superhost | Verified/Preferred listing tag |
| Insurance / guarantee | $1,000,000 general liability and $25,000 property damage guarantee on on-platform bookings (PS-help 10119343) | AirCover for Hosts, $3M damage protection per host materials (Airbnb host page above; 2022-era figures, check current) | FLIP insurance integration; renter syncs a food liability policy; expiry reminders at 45/14/3 days (pricing home, TFC-help 1812934) |
| Policy summary | Cancellation tier named per listing; Services Agreement accepted at request | Policy on listing, at confirm-and-pay and in the confirmation email | Cancellation policy set by the kitchen in Kitchen Settings and enforced in the edit/cancel rules |
| Receipts | unverified | Printable per-reservation details and payout receipts, CSV export (ABNB 418) | Statements, "Billed Line Items", invoices by email |
| Off-platform deterrence | Zero tolerance, payout retention and removal (PS-help 10119343) | n/a | Billing and renter relationship stay with the kitchen; TFC is a tool, not the counterparty |

---

## 6. What Local Cooks must have to justify a kitchen subscription

Ranked by how directly each ties to a kitchen deciding to keep paying monthly. "TS" = table stakes, "DIFF" = differentiator. Peers are those that were documented doing it in this study. Where a peer does it but only per a third-party listing, that is noted.

1. Renter qualification gate before the first booking (TS for shared kitchens). Application/onboarding checklist, document collection, expiry reminders, admin approve step, per-renter auto-approve. Peers: TFC (Onboarding, Documents, Auto Approve), Spacebring (admin-approved sign-ups). This is the strongest "the platform does my admin" story in the TFC material. Local Cooks equivalent: approval before visit plus insurance/licence documents with expiry alerts.
2. A calendar the kitchen trusts (TS). Per-space calendars, equipment on the same booking with its own time range, block-off time, no double booking, daily view. Peers: TFC, Peerspace (block time, Google/iCal/Outlook sync), Airbnb, Spacebring. Gap in TFC to exploit: no Google/iCal sync (TFC-help). Two-way calendar sync is a cheap DIFF against TFC.
3. Request inbox with a clear deadline and one-screen decision (TS). Booking details, renter profile and compliance status, expected payout, accept/decline/message, visible deadline. Peers: Peerspace, Airbnb, TFC (Submitted Bookings with 30-day window). Hierarchy to use: who, when, how much I get, compliance status, then actions.
4. Automatic billing and a statement the kitchen can reconcile (TS). Itemised line items (hours, equipment, storage, fees), status per line, export. Peers: TFC (statements, Billed Line Items, QuickBooks), Spacebring (monthly invoicing), Airbnb (CSV earnings), Peerspace (Payout History). Accounting export is the moment kitchens stop leaving.
5. Per-renter hub page (DIFF vs marketplaces, TS vs TFC). One record per chef: documents, bookings, storage, recurring charges, statements, messages. Peers: TFC (client profile). Peerspace and Airbnb do not have this because they are guest-centric. It is what turns a marketplace into a management product.
6. Recurring and membership bookings (TS for shared kitchens). Weekly/monthly repeat with end date; monthly plans with booked-vs-paid hours; overage handling. Peers: TFC, Spacebring (monthly invoicing), operators' prepaid plans (TFC pricing guide). Not offered by Peerspace/Airbnb as a core flow. Check Local Cooks' multi-day model covers repeats before claiming.
7. Storage as a bookable, billed resource (DIFF vs Peerspace/Airbnb, TS vs TFC). Peers: TFC (dry/cold storage, storage invoicing). Local Cooks already decoupled storage; show it in the same statement.
8. Lead and demand channel (DIFF, biggest reason TFC kitchens pay). TFC ties its tiers to Kitchen Door "Verified/Preferred" placement and a leads dashboard. Local Cooks has the marketplace itself, so the claim is "bookings come to you", with a visible utilisation report to prove it. Peers: TFC, Cookitoo (20% commission, 2018), Peerspace/Airbnb (commission model).
9. Response-time and reliability signals on the kitchen listing (DIFF vs TFC, TS vs Peerspace/Airbnb). Response rate, Power-Host-style badge. Gives kitchens a visible reward for using the product. Peers: Peerspace (response time/rate, Power Host), Airbnb (Superhost).
10. Utilisation and revenue reporting (TS). Top renters, busiest days, space utilisation, payments, sign-ins. Peers: TFC, Spacebring (occupancy analytics), Peerspace (monthly stats email), Airbnb (earnings export).
11. Access and check-in log (TS for TFC kitchens, DIFF vs marketplaces). Digital sign-in/out sheet, per-renter PIN, reconciliation of sign-in vs booked time. Peers: TFC (PIN, sign-in sheet, "reconcile sign-in times with bookings" article), Spacebring (access-control integrations).
12. Insurance on the renter record (TS). Peers: TFC (FLIP integration), Peerspace ($1M liability, $25k property damage), Airbnb (AirCover). Show expiry on the request screen.
13. Price and policy visible before the renter commits, charge only on approval (TS, renter-trust, indirectly host-retention). Peers: Airbnb (charge on acceptance, itemised breakdown), Peerspace (hold then charge, total shown before acceptance). TFC's documented booking steps show neither price nor policy: unverified. A plain price summary on the request screen would beat TFC.
14. Mutual reviews or a private renter reliability record (DIFF). Peers: Peerspace, Airbnb. TFC: none found. Lowest priority for subscription value but cheap trust.
15. Cost position (the pricing anchor). TFC Starter $129 USD / $179 CAD, Professional $229 USD / $293 CAD, plus 4% (2% for bank/manual on higher tiers). Spacebring $178. A Local Cooks subscription should be explained against these numbers, noting TFC's price includes lead listing and Spacebring's does not.

Recommended sequence for the pitch to kitchens: items 1, 4, 5 and 2 first (what operators replace spreadsheets and email with), then 6 and 7 (what TFC also sells), then 8 (what only a live marketplace gives).

---

## Claims marked unverified

- Booking screen contents on TFC (price, policy shown to renter), and whether renters see cancellation terms at booking.
- TFC recurring-booking detail beyond article titles; TFC help support hours; autopay and "charged on booking day" wording (search snippets only).
- Any TFC reviews/ratings feature (none found).
- Cookhouse and PREP (prepto) as software products with pricing. The entities found were physical kitchens.
- The Kitchen Door standalone pricing (none found; pricing is via TFC tiers).
- Cookitoo's current commission (2018 article).
- Peerspace: guest-side add-on screen, exact guest fee line layout, guest-side mobile layout, host request screen layout, reservation detail page, guest identity verification, whether the charge happens at request or acceptance (fees overview says hold then charge on accept; one article says charged at request).
- Peerspace host fee 15-20% (search snippet of PS-help 10119442; a third-party says flat 15%).
- Peerspace Moderate/Strict cancellation tiers.
- Airbnb: exact "free cancellation before" label at checkout; what the host sees on a reservation request; multi-calendar view; guest-side mobile layout; Airbnb review mechanics (only third-party sources fetched); AirCover figure is from 2022-era materials.
- Capterra "access controls" listing and the $49 Starter price (conflicts with vendor page).
