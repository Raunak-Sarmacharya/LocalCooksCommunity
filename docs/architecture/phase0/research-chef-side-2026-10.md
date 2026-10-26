# Chef side research: renter after sign-up, seller onboarding, dual-role (2026-10)

Scope: what the customer ("chef") sees after sign-up. Host side and the booking flow are in `research-ux-benchmark-2026-10.md` and are not repeated.
Method: vendor help pages fetched or searched 2026-10-26. Pages were read as text, so no screenshots were seen. Layout claims are "unverified" unless a source states them. Search-tool summaries that I could not open at the article level are marked "snippet". Third-party pages are marked "third-party".

Honest gaps up front: Neighbor's help center did not load (only listing pages were found). CookUnity, WoodSpoon, Uber Eats (Canada) and Etsy seller pages gave no usable official detail. Peerspace guest-side screens were not found. These are listed in the gaps section.

Shorthand: TFC-help = https://help.thefoodcorridor.com/en/articles/ ; ABNB = https://www.airbnb.com/help/article/ ; PS-help = https://intercom.help/peerspace-108cf19aff8e/en/articles/

---

## 1. Renter / guest side after sign-up

### 1.1 Home after login

| Product | What comes first | Source / status |
|---|---|---|
| The Food Corridor (renter) | Article does not say which screen opens first. Left nav has Bookings, Calendars, Billing, Documents, Reporting, Community, Settings (gear). | TFC-help 1812934 |
| Airbnb (guest) | Not stated in help text. Help says "click Trips and select the reservation". Past trips sit under "Past trips". | https://www.airbnb.com/help/article/90 (partial) |
| Turo (guest) | "Trips" tab lists booked trips. Each has "Manage trip". Host mode is a separate mode with Vehicles, Trips, Inbox, More. | https://help.turo.com/en_us/how-to-extend-a-trip-guests-BypBE4eVc.md ; https://help.turo.com/en_us/navigating-host-tools-and-metrics-H1pSVlEq.md |
| Peerspace (guest) | Bookings tab holds the booking and "Update Booking". Home content: unverified. | PS-help 10119168 (snippet) |
| Neighbor (renter) | Not found. Listings say you end a reservation "in the Neighbor app or website". | https://www.neighbor.com/location/8601 (listing page, snippet) |

Finding: none of the five publish a "first screen" rule. What they all do document is the trip/booking list as the hub. For TFC the hub is Bookings (it also carries the PIN and sign-in sheet).

### 1.2 "My bookings / Trips" list

| Product | Tabs / statuses | Row actions | Source |
|---|---|---|---|
| TFC | One list of submitted, approved, declined, cancelled space and equipment bookings. Prepaid-plan renters also see hours booked vs hours paid. | View, edit, cancel. "Update Booking" saves at once if auto-approve is on, otherwise "Request Change" goes to the admin. | TFC-help 1812934, 1524649 (from prior doc) |
| Airbnb | Trips list. A request shows "Pending". "Changes pending" shows a trip change request (pending, accepted, declined). Upcoming/Past/Canceled grouping is only in a third-party travel guide: unverified for Airbnb. | Withdraw a pending request, request a change, withdraw the change. | ABNB 90 ; https://www.airbnb.com/help/article/2539 (snippet) |
| Turo | Trips tab, booked trips. | "Manage trip" > "Change trip" > "Dates and location". Report issue is from the trip Details page. | Turo extend page above ; https://help.turo.com/en_us/reporting-a-late-return-H15iBExV5.md |
| Peerspace | Bookings tab. | "Update Booking": date, time, attendees, price. Goes to the other party for review. Allowed up to 1 hour before start. Pending requests can be withdrawn any time without penalty. | PS-help 10119168 (snippet), 10119475 (snippet) |
| Neighbor | Unverified. | End reservation in app or web; month-to-month; no fee to stop at end of any month; free cancel in first 24h. | listing pages (snippet) |

### 1.3 Booking detail: before, day of, during, after

| Need | Airbnb | Turo | TFC | Peerspace | Neighbor |
|---|---|---|---|---|---|
| Check-in info | Under the reservation's "Things to know". Appears only about 48 hours before check-in. If sooner and missing, message the host. (https://www.airbnb.com/help/article/3214 search summary; the opened page itself was a Brazil receipts page, so treat as snippet) | Host sends pickup and drop-off instructions after booking: in person, lockbox, or remote unlock (https://turo.com/ca/en/how-turo-works). Airport pickup details shared up to 1 hour before start (host release notes). | 4-digit PIN on the Bookings tab, used with the Sign-In Sheet (TFC-help 1812934). | Not found. Use confirmation or inbox. | Unverified. |
| Host contact | Host phone appears in the trip's message thread once confirmed (Airbnb snippet above). | In-app chat with the host (how-turo-works). | Messaging with the kitchen (TFC pricing page, prior doc). | Inbox thread. | Unverified. |
| Directions | Not found. | Not found. | Not found. | Not found. | Not found. |
| Change / cancel | Request change; cancel per host policy. | Change trip; extend up to 24h after scheduled end. | Edit rules follow the kitchen's cancellation window: inside it, extend and add equipment only. After the booking day, no edits (prior doc). | Update Booking; cancel within 24h of confirmation for a full refund if also over 48h before start (snippet). | End at month end. |
| Add time / extend | Via trip change. | Yes, before, during, or up to 24h after end. Declined for: outstanding balance, insufficient funds, car unavailable (https://help.turo.com/en_us/faqs-trip-extensions-guests-B1uzMQ9Qfg.md, snippet). | Extend allowed inside the cancellation window. | Update Booking. | Keep running. |
| Receipt | Trips > reservation > Payment info > "Get receipt". Also linked in the confirmation email. Receipts do not update after business details change (ABNB snippet). | Not found. | Billing tab: current and past charges, pending payments (TFC-help 1812934). Invoice by email (prior doc). | Not found. | Not found. |
| Report a problem | Not found in pages read. | "Report Issue" on the trip Details page. Support reviews within 48h (Turo late-return page; that article is host-side). | Chat with TFC team from Settings. Kitchen messaging. | Not found. | Not found. |
| Reviews | 14-day window, hidden until both submit (third-party, unverified at Airbnb level; from prior doc). | Not found. | Not found. | Mutual (prior doc). | Not found. |

### 1.4 Pre-arrival comms

- Airbnb: check-in details released about 48 hours before (snippet). Reminder cadence: not found.
- Turo: instructions sent after booking; airport details up to 1 hour before start (host release notes).
- TFC: no booking reminder timing found. Document expiry reminders at 45, 14 and 3 days (TFC-help 1812934). Kitchens are told when a client uploads a document.
- Peerspace, Neighbor: not found.

### 1.5 Payment methods, receipts, refunds

- TFC: Settings > Payment Method (card or ACH). Billing tab shows charges. Monthly charges are billed automatically once a month (TFC-help 1812934).
- Airbnb: refunds "usually within 15 days" (ABNB 90 page text). A pending request that is withdrawn or declined is not charged.
- Turo: extension can fail on an outstanding balance, so a balance owed blocks changes.
- Peerspace: fees kept on cancellation ("customary fees retained", snippet).

### 1.6 Onboarding to a kitchen (TFC renter view)

What is documented:
- Kitchen sets required documents (business licence, insurance, food handler card, sometimes a signed contract). Renter or kitchen can upload (TFC-help 1413932).
- Renter enters an expiry date per document. Reminders to renter and kitchen at 45, 14 and 3 days (TFC-help 1812934, 1413932, and https://help.thefoodcorridor.com/en/articles/14695455-why-am-i-getting-document-expiration-reminders).
- Kitchen option: "Disallow booking until client's required documents are current". The renter sees a message explaining why booking is blocked. Kitchen can switch this off per renter (TFC-help 1413932).
- Renter can add private documents and shared documents. Kitchen documents (policies) show in a second section.
- Renter sees the checklist in Settings > My Onboarding. Shared kitchen documents are visible to active clients and onboarding prospects.
- Insurance: if the kitchen offers FLIP, the renter applies through TFC and the policy and expiry sync.
- Operators' own order (account, payment method, documents, approval, first booking): operator practice, not product behavior (prior doc).

Not documented: a progress bar, step count, or a "what happens next" screen. Unverified.

### 1.7 Storage: rent, extend, move out

- TFC: renter Bookings and Billing show charges; storage lines appear on the statement. The renter-side storage page was not found (admin side has Storage per client, prior doc). Move-out steps: not found.
- Neighbor: month-to-month until the renter ends it in app or web; no cancellation fee at month end; free cancel in first 24h (listing pages, snippet). Notice period, move-out checklist, payment history: not found.

### Implications for Local Cooks chef side (area 1)

- The hub is a bookings list. Make it the default landing for a chef who rents. Nobody documents a better one, and TFC puts the PIN, hours-paid and edit actions on it.
- Show check-in info as its own block that fills in on a known schedule, and say when ("shown 48 hours before", as Airbnb does). Directions and host contact are undocumented everywhere. This is a chance to be better, not a pattern to copy.
- Put "Documents needed" in front when a chef is blocked from booking, with the reason in plain words and the expiry date. TFC's blocked-booking message plus 45/14/3-day reminders is the working model.
- Let the chef change a booking in the list: extend, add equipment, withdraw a pending request. Mirror TFC's rule that inside the cancellation window only extending is allowed, and show that rule next to the button.
- Receipts: one "Get receipt" action per booking and a Billing page with pending and past charges. Airbnb and TFC both do this.
- Storage needs its own row type with "ends when you end it" wording and a move-out button. Nothing public to copy beyond Neighbor's month-to-month model.

---

## 2. Selling side (home cook / small food seller)

### 2.1 Shef (official)
Source: https://intercom.help/shef/en/articles/8009562-overview-of-the-onboarding-process

| Step | Detail |
|---|---|
| 1 | Sign up on "Become a Shef". If waitlisted, stop building until contacted. |
| 2 | Pick delivery option in My Profile: drop-off location, door-to-door, or customer pickup (by location). |
| 3 | Menu: at least 7 dishes to sell, at least 3 approved to move forward. Each dish needs photos, description, ingredients, allergens, then "Submit for Review". |
| 4-5 | Profile picture and bio ("food story"). |
| 6 | Upload a food handler's certificate. Online courses are "around $10". |
| 7 | Connect a bank account through Stripe. Direct deposit, rolling, after each delivery day. |
| 8 | Review, up to 5 business days. Email and text on result. |
| 9 | Set "My Availability". Menu stays hidden from customers until days are chosen. |

First-order checklist (same page): fill containers to about 95%, label neatly, add a thank-you note for first-time customers, optional sample, plan cooking/cooling/packaging time, message support from the dashboard chat if you cannot fulfil. Repeated cancels or reschedules can fail the trial period.
Other: new onboarding paused in many US metros. Permits beyond the food handler card: not specified. Press (third-party, 2021) describes a quality assessment and audits: unverified.

### 2.2 DoorDash (merchant)
Source: https://help.doordash.com/en-ca/merchants/article/how-do-i-know-where-i-am-in-the-doordash-onboarding-process
Activations Tracker in the Merchant Portal, in order: menu creation (email when ready to edit), banking verified (fix under Settings > Bank Account), tablet shipment or POS integration where relevant, ready to activate (activate now or schedule a date with a call), live (banner). Licence and food safety documents: not found for DoorDash.

### 2.3 Uber Eats
No Canadian restaurant help page found. Uber ANZ asks restaurants for a food business verification, with accepted documents varying by region (https://www.uber.com/au/en/blog/providing-a-food-business-verification/). Applicability to Canada: unverified. Earnings page: not found.

### 2.4 Etsy
- Opening a shop: Etsy help asks the seller to read Creative Standards, Prohibited Items and seller policies, check fees, check Etsy Payments is available, and consider a business licence (https://help.etsy.com/hc/en-us/articles/115015672808-How-to-Open-an-Etsy-Shop, snippet; direct fetch blocked).
- Identity: government ID plus selfie (Persona). Setup can continue while review is pending. Status is under Shop Manager > Legal & tax information (https://help.etsy.com/hc/en-us/articles/360001980067, snippet).
- Bank: US banks verify with Plaid before the shop opens. Non-US banks can verify after the first sale. A card on file is needed for fees (snippet of Etsy help pages).
- Payment settings sit in Shop Manager > Finances > Payment settings.
- Earnings page layout: not verified.

### 2.5 Castiron (US cottage food)
Source: https://castiron.helpscoutdocs.com/article/12-how-do-i-make-money-on-castiron (snippet; the getting-started page 404'd on fetch).
Account, Stripe, build shop and listings, share link, customer orders, seller alerted and fulfils (pickup, delivery or shipping set under Shop Settings > Fulfillment). Two product types: Quote Request (custom orders, seller invoices) and Instant Checkout. First payout on a new Stripe account takes 7-14 days. Fee 10% plus card processing per TechCrunch (2022, third-party). A third-party blog says Castiron closed in late 2025: status unverified.

### 2.6 CookUnity, WoodSpoon, Homemade
- CookUnity: only job postings found. A Chef Onboarding Specialist and chef tools training exist. No official requirements. Unverified.
- WoodSpoon (third-party press, 2020-21): screening, a five-step safety checklist, onboarding session, home visit and food audition. CEO said chefs must meet NYC permit rules. Unverified, dated.
- Homemade: nothing found.

### 2.7 NL / Canada rules found (official, partial)
- Food premises in NL "must have a food premises licence". Apply to the Government Service Centre. An Environmental Health Officer reviews. (https://www.gov.nl.ca/hcs/publichealth/envhealth/foodsafetyinfo/)
- Since May 1, 2021, at least one person with current food safety training must be present when certain licensed premises operate. Which premises types: the page does not say. (same page)
- The province publishes "Standard Health Guidelines for Home Based Food Preparation Industry" and a free SkillsPass NL course for home-based food businesses. The guideline text was not readable. (https://www.gov.nl.ca/dgsnl/licences/env-health/food/premises/)
- A Food Establishment Licence may be issued to premises involved in sale or production. Whether a home kitchen needs the same licence: not confirmed.
- Third-party (https://blog.foodsafety.ca/changes-nl-food-premises-regulations-take-effect-may-1-2020 and a formpay blog): NL lists what home cooks cannot sell instead of what they can. Not confirmed against the official guideline. Unverified.
- Open: licence requirement for a home seller, exemptions, certificate validity. Needs a call to Dept. of Health and Community Services (number in the third-party search result: 709-729-3422, unverified).

### Implications for Local Cooks chef side (area 2)

- Use Shef's order: profile, menu, food handler certificate, payouts, review, availability. Hide the cook from customers until availability is set.
- Show a visible checklist with a "Submitted for review, up to N business days" state, like Shef (5 days) and DoorDash's tracker (blocked / not blocked).
- Collect: food handler certificate with expiry, and whatever NL requires for a home seller (licence or guideline compliance). Do not write the rule on screen until the Dept. of Health position is confirmed.
- Payouts via Stripe bank connect inside onboarding. Warn that the first payout can take 7-14 days (Castiron).
- First-order checklist screen (packaging, labelling, allergens, what to do if you cannot fulfil), as Shef does.
- Earnings page layout: no verified pattern from these vendors. Reuse Airbnb's Upcoming/Paid split and CSV export from the prior doc.

---

## 3. Dual-role patterns

| Product | One account? | How the switch works | Cross-promotion | Source |
|---|---|---|---|---|
| Airbnb | Yes, same app | Mobile: press and hold Profile, tap Hosting; back: press and hold Menu, tap Traveling. Web: "Switch to hosting / traveling" next to avatar. | Not found in help. | https://www.airbnb.com/help/article/3546 |
| Turo | Yes, same app | Host mode has Vehicles, Trips, Inbox, More. More leads back to guest mode, transaction history, tax info. Turo blog (snippet) says they split one shared interface into two modes. | Not found. | https://help.turo.com/en_us/navigating-host-tools-and-metrics-H1pSVlEq.md |
| Etsy | Yes, same account | Profile icon > Shop Manager for seller view; Etsy Home for buyer view. Third-party guide, no official page found. | Not found. | third-party: https://www.outfy.com/blog/?p=4971 (unverified) |
| Uber | Unclear | Official statement on one login for rider and driver not found. Driver app has a toggle between rides and deliveries (third-party). Eats courier to rideshare needs a request (Uber AU). Rider app has a Personal/Business profile switch. | Not found. | https://www.uber.com/au/en/u/switch-to-driving/ ; third-party |

Pattern: Airbnb and Turo keep one account but give the other side a separate mode with its own navigation, entered by a deliberate switch. The traveller or guest view is the default. Nobody in the sources shows a combined home page that mixes both roles.

### Implications for Local Cooks chef side (area 3)

- One account, two modes: "Rent a kitchen" and "Sell food". Do not merge them into one dashboard.
- Switch lives in the profile/menu, one tap, labelled with the mode name. Remember the last mode used.
- A chef with only one path sees a quiet "Also sell food" or "Also rent a kitchen" entry point in the switch menu. Do not interrupt their work with it.
- A chef in both modes needs a small badge in the other mode's entry when something needs action (pending request, expiring document). This is my inference, not a vendor pattern.
- Keep shared items in one place: profile, payment method, food handler certificate and insurance (one upload, used by both paths).

---

## 4. Gaps and unverified list

- Neighbor help center: did not load. Move-out, extend, receipts and payment history are not sourced.
- Peerspace guest screens: only Update Booking and cancellation rules (snippets). No check-in, receipt or report-a-problem sources.
- Airbnb: Upcoming/Past/Canceled tabs, home screen, reminder timing, directions, report a problem, review window. The article 3214 summary came from search, and the page I opened was a Brazil receipts page.
- Turo: guest receipts, reminder timing, check-in screen.
- TFC: first screen after login, storage renter page, booking reminders.
- CookUnity, WoodSpoon, Homemade, Uber Eats (Canada): no official source.
- Etsy: official opening-shop page returned 403 on fetch. Details are from search snippets of Etsy help pages.
- Castiron: current status (closed late 2025 per one third-party blog) and fees are unverified.
- NL: whether a home seller needs a premises licence, exemptions, and certificate validity are not confirmed. Do not state them to chefs until confirmed with the Department of Health and Community Services.
