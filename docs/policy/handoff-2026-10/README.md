# Policy handoff — kitchen bookings, storage, payments (October 2026)

Drafted from what the product does today on dev (`docs/architecture/phase0/policy-facts-booking.md`, rows marked *verified*/*built*),
in the structure top platforms use (Airbnb: Terms + Payments Terms + linked policies + Privacy; Turo/Neighbor/Peerspace: plain-language
policy pages the Terms incorporate; The Food Corridor: separate booking/storage rules). **This is a draft for your lawyer, not legal
advice.** Your lawyer (NL consumer protection, PIPEDA, Canadian e-commerce disclosure) should approve the binding wording before you
publish.

## What goes where

| File | What it is | Where it goes |
|---|---|---|
| `01-privacy-policy-additions.md` | Exact paragraphs to add to the in-app Privacy Policy, section by section | `/privacy` (`client/src/components/legal/PrivacyContent.tsx` + `_fr` + `_uk`) — sections 4.1, 4.2, 4.4 (new), 5, 8.1, 8.2, 9, 10 (replace), 11, 12 |
| `02-booking-and-cancellation-policy.md` | Kitchen Booking & Cancellation Policy (new linked page) | New page `/policies/bookings`; linked from Terms §4.7 and §5.1, the checkout cancellation line and the booking page |
| `03-storage-rental-policy.md` | Storage Rental Policy (new linked page) | New page `/policies/storage`; linked from Terms §5.4 and §9.4, the storage request disclosure and the rental page |
| `04-payments-fees-and-payouts.md` | Payments, Fees & Payouts (new linked page) | New page `/policies/payments`; linked from Terms §4.9 and §9 |
| `05-damage-claims-and-problems.md` | Damage & Cleaning Claims + Problems (replaces the current claims component text) | Replace the text in `client/src/components/legal/DamageCleaningPolicy.tsx` (shown inside the Terms) and publish at `/policies/claims` |
| `06-terms-of-service-changes.md` | Clause-by-clause replacements for the in-app Terms where they contradict the product | `client/src/components/legal/TermsContent.tsx` (+ fr/uk) — §2.1, 4.3, 4.7, 4.9, 5.1, 5.3, 5.4, 9.1–9.4, 12.1, 14.2 |

## Changes — October 17, 2026

- **02** — new section "Booking several days": any days up to the kitchen's limit (no more than 14), all within 14 days of the
  first; one request and one card hold; the kitchen accepts all days or declines; one refund deadline before the first day; dropping
  days before and after it; started or missed days not refundable; one change request for the whole booking; what happens when the
  kitchen cancels a day (a lead decision the owner may override). The old "charged only for what it accepts" wording is replaced by
  the chef-approval rule (the kitchen asks the chef to approve a new total, nothing is charged until they accept, and the
  last-minute 3-hour guard). Added the buffer, weekly hours limit and longest-booking settings, including that full days at the daily
  rate are always bookable.
- **04** — per-day payouts for multi-day bookings (after that day's inspection or 24 hours after it), a problem on a day holding
  that day's payout, and how a partial acceptance is captured and paid.
- **06** — §4.7, §4.9, §5.1, §5.3 and §9.2 updated to match the multi-day, item-approval and per-day payout rules.
- **01, 03, 05** — unchanged.

## Publishing checklist (top-platform pattern)

1. Lawyer review of all six files (and the open points below).
2. Translate approved text into fr-CA and uk (same structure as today's legal components).
3. Add the three new pages (`/policies/bookings`, `/policies/storage`, `/policies/payments`, `/policies/claims`) and link them from the Terms,
   checkout, booking page, storage request page and footer.
4. Use unambiguous dates ("Effective November 1, 2026"), and the same legal identity everywhere: "Local Cooks, the operating name of
   Jawrophi Delivery Inc., 4 Priscilla Place, Paradise, NL A1L 1E6 · support@localcooks.ca".
5. Bump `CURRENT_POLICY_VERSION` so everyone re-accepts at next sign-in, with a short "What changed" summary (Airbnb/Turo do this).
6. Existing bookings and rentals keep the cancellation policy and terms saved with them (the product already freezes them).

## Engineering items the text depends on (do these before publishing)

| # | Item | Why |
|---|---|---|
| E1 | **Mask session replays in Sentry** (`client/src/instrument.ts`: `maskAllText: true`, `blockAllMedia: true`). Today error replays can capture names, addresses, check-in codes and photos on screen. | The privacy text promises masked replays (top platforms mask by default). |
| E2 | **Retention job**: delete or anonymize per the table in `01-privacy-policy-additions.md` §10 (photos/claim evidence, messages, documents after expiry, closed accounts). Nothing deletes on a schedule today. | PIPEDA Principle 4.5 — keep only as long as needed; the policy states periods. |
| E3 | **SMS**: Twilio is configured and some booking actions can text the phone on file. Decide keep or remove; if kept, add a "Text me booking updates" toggle (off by default) and STOP handling. | Consent + accuracy of §5 and §8.2. |
| E4 | **Kitchen Stripe Connected Account Agreement** link shown before a kitchen connects Stripe. | Stripe requires platforms to present it. |
| E5 | Remove the dormant Google Analytics / Tag Manager `dns-prefetch` lines (`client/index.html:109–110`) or, if you add analytics later, update §7 (cookies) first. | Policy says no third-party advertising/analytics trackers. |
| E6 | **Multi-day bookings** are built but still switched off on dev until the kitchen screens (CP9), whole-booking changes (CP7), invitations (CP10), extra time per day and a full live run-through are done — publish the multi-day rules only after that. **Chef approval of a declined item** is built and verified live on dev on Oct 17 (accept #200, decline #201, no answer #202). |

## Open points for you and your lawyer

1. **Retention periods** in Privacy §10 (proposed: money records 7 years; photos/evidence 2 years after the booking/rental or claim closes).
2. **SMS** (E3) — keep or remove.
3. **Chargeback pilot promise**: "a chargeback doesn't reduce the kitchen's payout for a delivered session or rental" — publish it, or keep it internal while it's a pilot.
4. **Storage disposal** wording (`03` §8) — disposal stays switched off until you approve it.
5. **Quebec**: if you will serve Quebec, Law 25 adds duties (privacy officer published, impact assessments for transfers outside Quebec).
6. **Liability cap** (Terms §14.2) — a $0 cap when fees are $0 is likely unenforceable; lawyer to set a floor.
7. **HST**: accountant to confirm the "collected for the kitchen, kitchen remits" treatment.
