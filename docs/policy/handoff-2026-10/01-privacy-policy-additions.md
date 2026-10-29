# Privacy Policy — additions for kitchen bookings, storage and payments

**Where:** in-app Privacy Policy at `/privacy` (`client/src/components/legal/PrivacyContent.tsx`, then `_fr` and `_uk`).
Keep the existing sections; add or replace the text below under the section numbers shown. Wording follows PIPEDA's ten fair
information principles. Structure follows top marketplaces (Airbnb, Turo, Peerspace): say what is collected *for bookings*, who on the
other side sees it, which service providers process it, and how long it is kept.

> Lawyer: NL has no general private-sector privacy statute, so PIPEDA applies. If you serve Quebec, Law 25 adds duties (see README).

---

## §2 Who we are — replace the first sentence

Local Cooks is the operating name of Jawrophi Delivery Inc., 4 Priscilla Place, Paradise, Newfoundland and Labrador A1L 1E6
("Local Cooks", "we", "us"). We are responsible for the personal information described in this policy. Our Privacy Officer can be
reached at support@localcooks.ca (subject "Privacy").

---

## §4.1 Information you provide directly — add these bullets

**When you book a kitchen or rent storage**
- The kitchen, dates and times you request, the equipment you add, the length and price, any note you write to the kitchen, and the
  cancellation policy and terms in force when you book (we keep a copy with your booking so they don't change later).
- Requests to change, add extra time to, cancel or withdraw a booking or rental, and the reason you give if you choose to.
- Invitations a kitchen sends you, and your answer.
- For storage: the listing and unit you rent, your start date and paid-through date, extensions, and move-in and move-out dates.

**Visit and move-in/move-out records**
- When you checked in and out, and how (for example, a check-in code given to you in person at the kitchen).
- Photos and notes you or the kitchen add at arrival, departure, storage move-in, handover and move-out, and the kitchen's checklist
  answers. These show the condition of the space so that a later question about damage or cleaning is decided on evidence.
- If items are left in storage after a rental ends: the list of items, photos, and the notices sent before anything is removed.

**Problems, claims and disputes**
- Problem reports (for example "I can't get in") and the messages added to them.
- Damage or cleaning claims and their evidence (photos, receipts, invoices, quotes), your response, any dispute, and Local Cooks'
  decision. Holdover charge requests for storage and disputes of them.
- Whether you attended a booking, if the kitchen reports a no-show, and your answer if you say you were there.

**Messages and feedback**
- Messages you send to a kitchen or chef through Local Cooks, and private feedback you leave after a visit.

**Kitchen-only notes about chefs**
- A kitchen can keep short private notes about chefs it works with (for example "prefers the back entrance"). Only that kitchen's team
  and Local Cooks can see them. You can ask us for access to notes about you (see §11).

---

## §4.2 Payment and payout information — replace with

**Chefs.** Card payments are processed by Stripe. Your full card number never reaches Local Cooks' servers. We receive and keep the
card brand, the last four digits, the expiry month and year, the country of the card, and the payment's status, amount, tax, fees,
refunds and any bank dispute (chargeback), including the reason the bank gives.
When you book, we ask your bank to **hold** the amount; you are charged only if the kitchen accepts. **Stripe keeps your card on file**
so you can use it again for actions you confirm yourself — for example extending a storage rental with one tap, paying for extra
time you asked for, or paying a holdover or damage charge you accepted. We never charge a saved card on our own initiative: no
automatic renewals, no automatic penalties. You can pay with a different card at any of those steps.

**Kitchens.** Payouts are made through Stripe Connect. Stripe collects and verifies the identity, business and bank details it needs
to pay you, under its own terms and privacy policy. We receive your account's status (for example "payouts enabled"), payout
amounts and dates, and the fees deducted. We do not receive your full bank account number.

**Tax records.** We keep the amounts, HST and fees for every payment, refund and payout to meet our tax and accounting obligations.

---

## §4.4 Information from other sources — new section

- **From the other side of a booking:** a kitchen may add photos, notes, a no-show report, a damage or cleaning claim or a holdover
  request about your booking or rental; a chef may add photos, notes, problem reports and disputes about a kitchen.
- **From Stripe:** payment, refund, payout and dispute results, and fraud signals.
- **From your bank, through Stripe:** chargeback notices and their reason.

---

## §5 How we use Personal Information — add these purposes

We use booking, rental, visit, payment and claim information to:
- show prices, tax and fees before you pay; place holds; charge, refund and pay out the right amounts at the right time;
- enforce the deadlines and rules you agreed to (response deadlines, refund deadlines, grace periods, holdover and removal steps,
  payout holds while a problem or claim is open, and pausing new bookings while an upheld claim stays unpaid);
- let the kitchen and the chef do the visit or rental (arrival details, check-in, move-in/move-out, extra time);
- review problems, damage and cleaning claims, holdover disputes and no-show disputes, and make decisions on evidence;
- detect and respond to fraud and bank disputes (chargebacks), including sending evidence to Stripe and your bank;
- send service messages in the app and by email (and by text message only if you turn it on) about your bookings, rentals, payments
  and payouts — these are not marketing;
- let Local Cooks staff oversee money events and safety reports (our admins are notified of every payment, refund, payout hold,
  claim and chargeback);
- keep records required by tax and accounting law.

We do not sell personal information, and we do not use booking, visit or payment information for third-party advertising.

---

## §8.1 Between Kitchen Owners and Chefs — replace with

**What a kitchen sees about a chef:** name, profile photo, contact details for chefs who booked with it, the documents the chef submitted
when applying to that kitchen (for example a food-safety certificate or proof of insurance), the chef's bookings and rentals at that
kitchen, notes and photos added at arrival, departure, move-in and move-out, problem reports on those bookings, and payment
**amounts** (never card details). A kitchen sees chefs who applied to it or booked with it — not chefs who use other kitchens.

**What a chef sees about a kitchen:** the listing (address, photos, equipment, storage, rules and prices), the kitchen's cancellation
policy, and, once a booking is confirmed, arrival details (shared 48 hours before the visit) and the kitchen's contact details for
that booking.

**Damage and cleaning claims:** the chef sees the claim, the amount and the evidence once Local Cooks has reviewed it. **What a kitchen
tells Local Cooks during that review is not shown to the chef.** The chef's dispute is seen by Local Cooks and the kitchen.

**Problem reports** are seen by the chef, the kitchen and Local Cooks.

---

## §8.2 Service providers — replace the list with

We use service providers that process personal information for us under contract and only for the purposes in this policy:

| Provider | What it does for Local Cooks | Where |
|---|---|---|
| Stripe | Card payments, card holds, saved cards, refunds, disputes, kitchen payouts (Stripe Connect) and kitchen identity verification | Canada / United States |
| Google Firebase | Sign-in and account security; messages between kitchens and chefs | United States |
| Neon | Main database | United States |
| Cloudflare R2 | Storage of photos and documents you upload | United States / global network |
| Vercel | Hosting of the Local Cooks apps | United States |
| Inngest | Scheduling of time-based steps (reminders, deadlines) | United States |
| Sentry | Error monitoring; when an error happens it may record the screen, with text and images masked | United States |
| Hostinger (email) | Sending service emails | [confirm region] |
| Twilio | Sending text messages, only if you turn them on | United States |

Stripe also acts on its own account for some purposes (for example fraud prevention and meeting financial regulations); see
stripe.com/privacy.

---

## §9 International transfers — add

Several of our providers store or process information in the United States. When that happens, the information may be accessible to
courts and authorities there under U.S. law. We use contracts and security measures so that your information gets protection
comparable to what it has in Canada.

---

## §10 Retention — replace the whole section (including the duplicated text) with

We keep personal information only as long as we need it for the purposes in this policy or as the law requires:

| Information | How long |
|---|---|
| Your account and profile | While your account is open; removed or anonymized within 30 days after you close it, except what is listed below |
| Bookings, rentals, payments, refunds, payouts, HST and fees | 7 years after the end of the year they relate to (Canadian tax rules require at least 6) |
| Arrival/departure and move-in/move-out photos, notes and checklists | 2 years after the booking or rental ends — longer if a claim, dispute or chargeback about it is still open |
| Damage, cleaning, holdover and no-show claims and their evidence, problem reports and Local Cooks' decisions | 2 years after the claim or report is closed, or longer if needed for a legal claim |
| Messages between kitchens and chefs | 2 years after your last booking or rental with that kitchen |
| Documents you upload for approval (food-safety certificate, kitchen licence, insurance) | Until they expire or are replaced, plus 12 months |
| Kitchen-only notes about a chef | Until the kitchen deletes them or closes its account |
| Records of privacy breaches | At least 24 months, as PIPEDA requires |
| Error recordings (Sentry) | Up to 90 days [confirm with your Sentry plan] |

You can't close an account while a booking or rental is in progress or money is still owed or due (for example a pending payout,
an unpaid claim or a storage rental that hasn't ended); we'll tell you what's left to finish.

---

## §11 Your rights and choices — add

- You can ask for a copy of the personal information we hold about you, including photos and notes about your bookings and rentals
  and any kitchen's notes about you. We answer within 30 days.
- You can ask us to correct information that is wrong. Records of what happened (for example a check-in time or a claim decision)
  are corrected by adding a note, not by rewriting history.
- You can turn off optional messages (such as text messages). Service messages about bookings, payments and safety can't be turned
  off while you have an active booking or rental, because they tell you about deadlines and money.
- Saved cards: you can remove a saved card yourself at any time from Payments → Saved cards; this doesn't cancel amounts you
  already agreed to pay.

---

## §12 Security — add

- Card details are handled by Stripe, which is certified to the payment card industry's highest security standard (PCI DSS Level 1).
- Staff access to booking, payment and claim records is limited to people who need it, and actions on money are recorded.
- Screen recordings used to fix errors hide text and images.
- If a breach of security safeguards creates a real risk of significant harm, we report it to the Office of the Privacy Commissioner
  of Canada and notify the people affected as soon as feasible. We keep a record of every breach for at least 24 months.
