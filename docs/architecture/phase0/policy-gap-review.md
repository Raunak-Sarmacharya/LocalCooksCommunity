# Terms & Privacy vs the kitchen booking product — gap review (2026-10-15)

Input for the owner and the lawyer — not legal advice. Every "product" statement below was verified in code and/or live on dev
(see `policy-facts-booking.md`).

## 0. Which documents users actually agree to

| Document | Where | Entity / address | Dates | Audience |
|---|---|---|---|---|
| **In-app Terms & Conditions** (16 sections incl. the Damage & cleaning policy component) | `chef./kitchen.localcooks.ca/terms`, `client/src/components/legal/TermsContent*.tsx` (en/fr/uk), accepted at sign-up via `TermsAcceptanceScreen` (version + time stored: `users.terms_version`, `terms_accepted_at`, `CURRENT_POLICY_VERSION`) | Jawrophi Delivery Inc. operating as "Local Cooks", 4 Priscilla Place, Paradise NL; support@localcooks.ca | Effective "01-02-2026", updated "01-05-2026" | Kitchen Owners + Chefs ✔ |
| **In-app Privacy Policy** | `/privacy`, `PrivacyContent*.tsx` | Jawrophi Delivery Inc. | Effective "01-05-2026" | Kitchen Owners + Chefs ✔ |
| Public site Terms / Privacy | `www.localcooks.ca/terms`, `/privacy` | **Local Cooks Inc.**, 14 Suez Street, St. John's; support@**localcook.shop** | Sept 7, 2025 | Meal marketplace (Diners/Couriers) — **no kitchen bookings** |

**Owner decision (Oct 15):** brand = **Local Cooks** everywhere people read it; the registered legal entity is **Jawrophi Delivery Inc.**
(the corporate registry would not accept "Local Cooks" as the corporate name); address **4 Priscilla Place, Paradise, NL A1L 1E6**.
There is no company called "Local Cooks Inc." — the public site's legal pages must stop using it.
Correction after a code scan: `localcook.shop` is the **meal shop's** own domain (`shop.localcook.shop`), a separate product — not a typo.
`www.localcooks.ca/terms` currently shows the meal shop's terms (Sept 2025). Fix: correct the entity/address there, scope it to meal
orders, and link "Kitchen booking terms" to the platform Terms. On the kitchen platform itself, two stray shop addresses should become
`support@localcooks.ca`: the organisation e-mail in SEO structured data (`client/src/components/SEO/SEOHead.utils.ts:118`,
admin@localcook.shop) and the unsubscribe page contact (`client/src/pages/UnsubscribePage.tsx:104`, localcooks@localcook.shop).
Drafting rule: name the entity once where the law needs the contracting party — the opening "who this agreement is with" sentence,
the notices/contact section and the privacy "who we are" section ("Local Cooks, the operating name of Jawrophi Delivery Inc.") — and say
"Local Cooks" everywhere else (Airbnb pattern: "Airbnb" in the text, the contracting entity named once). Lawyer: confirm "Local Cooks" is
registered as a business (operating) name for Jawrophi Delivery Inc. if the province requires it for a name other than the corporate name.

**P0 — one legal identity and one canonical set.** Two different legal entities and addresses are published as "Local Cooks" for the
same brand, and the public site's Terms say "all orders are final and non-refundable", which contradicts kitchen booking refunds.
Owner/lawyer: confirm the contracting entity (Jawrophi Delivery Inc. o/a Local Cooks vs Local Cooks Inc.) and the address, then make
`www.localcooks.ca/terms` either the same document or clearly scoped to meal orders with a link to the kitchen terms. Use unambiguous
dates ("February 1, 2026", not "01-02-2026").

## 1. In-app Terms clauses that contradict the product (fix before relying on them)

| # | Clause (in-app Terms) | What the product does (verified) | Direction |
|---|---|---|---|
| T1 | §4.9 / §9.2 "Remit Kitchen Owner's share (e.g., 80–85%) within 5–7 business days of rental completion" / "Upon rental completion and **Chef's confirmation** (or automatic 24 hours post-rental)" | Payout = chef payment − Local Cooks service fee (may be $0; future: tied to the kitchen's subscription tier) − actual card processing fee; released when the **kitchen finishes its inspection** or automatically 24 h after the visit; Stripe then pays the kitchen's bank on its schedule. | Describe the real formula without percentages ("Local Cooks may charge a service fee; it is shown before you accept/pay"); kitchen inspection, not chef confirmation; "sent to Stripe for payout; your bank usually receives it within N business days". |
| T2 | §9.2 "if Kitchen Owner cancels … refund … **excluding** the original payment processing fee" | Kitchen-caused cancellation refunds the chef **in full, including** the processing fee (verified #158). | Match the product (it's also the trust-correct rule: Airbnb/Peerspace make the guest whole when the host cancels). |
| T3 | §9.3 "Local Cooks does NOT collect HST on behalf of Kitchen Owners … Collecting HST from Chefs (by invoicing separately …)" | Checkout charges HST at the kitchen's configured rate and passes it to the kitchen ("Includes HST you collected and remit $7.50"). | "Local Cooks collects the HST you charge as part of the chef's payment and pays it to you; you remain responsible for remitting it." (Accountant to confirm the agent/marketplace treatment.) |
| T4 | §4.7 cancellation examples ("no cancellations / non-refundable", ">7 days", "3–7 days 50%") | Kitchens choose 24/48/72 h notice and a 50% or 100% late charge on the **booking total**; refund before the deadline = everything minus the actual processing fee; frozen per booking; kitchen must answer ≥1 h before free cancellation ends. | Replace with the real options and point to the Cancellation Policy page. |
| T5 | §4.3 "Kitchen Owners **must execute a written Rental Agreement** with each Chef … specify damage deposit …" + §15.2 "If a Kitchen Rental Agreement conflicts with these Platform Terms, the Rental Agreement controls" | The platform booking (listing rules, arrival/departure instructions, frozen cancellation policy, damage-claim process) **is** the agreement; there is no damage deposit; claims go through Local Cooks review with a $250 in-app cap. | Make the confirmed booking + the kitchen's posted rules the rental agreement. A side agreement must not override platform protections (refunds, claim review, no automatic charges) — otherwise a kitchen can contract around the trust guarantees. |
| T6 | §5.4 "Chef authorizes Local Cooks to calculate and charge overstay penalties to Chef's payment method on file … Auto-charging" + §9.1 "Overstay … charged at the hourly rate (prorated)" | Kitchen overstay: the kitchen records departure and sends an extra-time charge in 30-minute blocks; the chef pays or disputes; **never charged automatically** (owner decision Oct 14). (Storage overstay is a separate product being rebuilt.) | Split kitchen overstay (no auto-charge, 30-min blocks, dispute path) from storage overstay (to be specified with the storage rebuild). |
| T7 | §12.1 "Both parties should communicate directly … Local Cooks will review the dispute and attempt to mediate but is **not obligated to intervene**. Disputes are ultimately between the parties." | Local Cooks reviews **every** damage claim first and makes the final decision within the platform (pay, reduce, close, or pay the kitchen itself); chef can dispute; 7-day unpaid → new-booking pause. | Describe the actual claims process (it is a key trust feature — Peerspace/Airbnb advertise exactly this). |
| T8 | §3.3 / §6.3 "Local Cooks will require and verify … Building occupancy permit … insurance certificates annually … additional insured endorsement present" | Local Cooks reviews the Kitchen License (manager) and the chef's Food Safety Certificate; kitchens can require chefs to upload proof of insurance (with a minimum amount) in their access application, reviewed by the **kitchen** (`tier2_insurance_*`). Local Cooks does not verify insurance or occupancy permits itself, and annual re-verification is **not built**. | Promise only what is done ("we check that a licence/certificate is on file and not expired"); list the rest as owner/kitchen responsibilities or build it. Over-promising verification creates liability. |
| T9 | §5.1 "A Booking is confirmed when Chef receives an **acceptance email**" | Confirmation is the kitchen's acceptance in the platform (email is a notice; .test addresses even bounce). | "…when the kitchen accepts in Local Cooks; we notify you in the app and by email." |
| T10 | §5.3 "Arrive no earlier than 15 minutes before" | Check-in window is a kitchen setting (default 15 min); early start only when the kitchen grants it. | Reference the kitchen's setting. |
| T11 | §14.2 "If a user has paid no fees, Local Cooks' liability is capped at **zero**" | During the pilot the service fee may be $0 → liability cap of $0 for everyone. | Lawyer: likely unenforceable/unfair-looking; consider a fixed floor (e.g. $100) like the public terms. |
| T12 | §12.2 arbitration costs "split 50/50", class waiver, applies to Chef↔Kitchen disputes | Many chefs are sole proprietors. | Lawyer: consumer-protection enforceability in NL; small-claims carve-out (the public terms have one, the in-app terms don't). |

Missing from the in-app Terms entirely (add as sections or linked policies):
- **Request-to-book and card holds** (charged only on acceptance; per-item acceptance; response deadline incl. the new "≥1 h before free
  cancellation ends" rule; withdraw free while pending).
- **Saved-card use** (Stripe requirement): when the chef asks for extra time and the kitchen approves with a charge, the saved booking
  card is charged; overstay and claims are paid only with the chef's confirmation. State this in the Terms and at checkout.
- **Extra time / early start** (who decides, free vs paid, non-refundable once added).
- **Check-in/out records** (check-in codes, condition photos and notes) and how they are used in claims.
- **Payout timing and holds**, kitchen inspection window, automatic closeout.
- **Stripe Connected Account Agreement** for kitchens (Stripe requires platforms to present it before onboarding to Express).

## 2. Privacy Policy (in-app) — good base, specific gaps

Strengths: PIPEDA-based, kitchen-specific, shares-between-users section, breach notification, OPC complaint route.

Gaps:
- **P1** Visit evidence is not named: check-in/check-out **condition photos and notes**, check-in method/time, damage-claim evidence
  (receipts, quotes, photos), extra-time requests. Add to §4.1 and §8.1 (who sees them: both sides and Local Cooks).
- **P2** Claim-review confidentiality: what the kitchen tells Local Cooks during review is **not shared with the chef** (verified live).
  Say so — it is a trust feature.
- **P3** §10 "Retention" contains a duplicated copy of §4–§8 (drafting error) and no concrete periods. Give periods per category
  (e.g. booking and payment records 7 years for tax; visit photos/claim evidence N months after closeout or claim resolution;
  documents until expiry + N months).
- **P4** Name the main processors (Stripe, Google Firebase authentication, Cloudflare R2 storage, Vercel hosting, database host,
  Inngest scheduling, Sentry error monitoring, email provider, Twilio SMS when used) — top platforms list categories with examples;
  engineering to confirm the final list. Cross-border: several are US-hosted.
- **P5** Same entity/address/date issues as §0.

## 3. Recommended structure (top-platform pattern)

1. **Terms of Service** (one, versioned, in-app acceptance — already wired).
2. Linked plain-language policies that the Terms incorporate, each drafted only from `policy-facts-booking.md` verified rows:
   **Booking & Cancellation**, **Extra time & overstay**, **Damage & cleaning claims** (already a component), **Payments, fees & payouts**,
   **Kitchen standards & verification** (what Local Cooks checks vs what kitchens/chefs are responsible for).
3. **Privacy Policy** with the P1–P5 additions.
4. Bump `CURRENT_POLICY_VERSION` on publication so every user re-accepts; show a short "what changed" summary (Airbnb/Turo pattern).
5. Lawyer review before publishing (owner confirmed).
