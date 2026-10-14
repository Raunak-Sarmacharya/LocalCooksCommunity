# Booking model gaps: research and pilot recommendations

**Research handback — 13 October 2026.** Read-only review of the current working tree and public documentation. This report is a product recommendation, not implementation authorization or a production-readiness assessment. Exactly this file was written; no application source, database, payment account, hosting configuration, or background workflow was changed or queried. Public payment documentation was read without accessing an account.

## Recommendation

The owner's concern is well founded. Hourly and daily prices answer **how time is priced**; they do not answer **how a production relationship is scheduled, changed, used and closed**. Local Cooks already has a meaningful single-visit booking foundation, including overnight hours, temporary checkout reservations, manual capture at confirmation and separate storage extensions. It lacks several of the connections that make those pieces feel like one dependable service.

For the pilot, finish the current arrival/departure → clock-based closeout → reminders → private feedback → payout-after-closeout → cancellation-engine checkpoints. Add clear duration/notice rules, protected turnover, effective-policy consistency, usable closure controls and a support exit in every state. Then introduce a narrow manager invitation with an itemized custom kitchen price **before confirmation**. Do not build a general negotiation engine.

Make bounded weekly standing bookings the first scheduling expansion if pilot customers need regular production. This is more relevant to a commercial kitchen than arbitrary month-long exclusive kitchen rental. A multi-day range should mean an explicit set of daily visits, not continuous possession of the kitchen overnight. A paid “one more hour” extension is the first confirmed amendment worth considering; it needs the same inventory, consent and financial guarantees as a larger move. Until that checkpoint passes, show an honest help path and the original end time, without implying a message grants extra use.

**Priority meanings:** P0 = required for an intuitive, supportable pilot; P1 = soon after the core is dependable; P2 = later or never unless demand justifies it. A named pilot dependency can promote a P1 feature before release. P0 does not mean every feature must be self-service: a bounded, audited support workflow can cover rare cases, provided it is actually operational.

## Evidence, authority and research limits

**Repository evidence** means the cited current file contains the behavior. **Documented** competitor behavior means a first-party public page explicitly describes it. **Inference** is a Local Cooks design lesson, not a claim about a competitor's internal architecture. **Not verified** means public evidence or the reviewed code does not establish the capability. Absence findings are scoped to the schema, relevant booking forms, routes and services reviewed; they are not a claim about every private operation or unpublished feature.

The workspace contains existing uncommitted work and concurrent Phase 0 activity. File:line references identify the inspected working tree; rerun the cited reads before implementation. Tests cited below were read as evidence of intended boundaries, not executed. No browser/API/database/provider rehearsal was performed for this report.

Authority, in order:

- Latest Oct13 owner decisions: always-on arrival/departure, optional manager-added tasks, live instructions with update notices, location defaults with kitchen overrides, future-only policy/terms versions, Flexible/Moderate/Strict presets, automatic policy refunds and upward-only discretion. `docs/architecture/phase0/PHASE0_LOG.md:6–35`.
- D11 requires reasoned, audited Local Cooks assistance for either party in every booking state. `docs/architecture/phase0/PHASE0_LOG.md:192`; see the guarded-action design at `docs/architecture/phase0/design-checkin-checkout.md:133–135`.
- The first invitation is before confirmation; acceptance must show the complete proposal and payment/policy effects. Confirmed changes remain later. `docs/architecture/phase0/manager-visit-preparation.md:16–18,43–52`.
- The eight phases remain intact, with confirmed amendments an optional phase before Phase 7 if required for launch. `docs/architecture/phase0/continuation-handoff.md:51–62`; `docs/architecture/booking-target-phases.md:107–111`.
- `docs/architecture/phase0/local-cooks-booking-policy.md:3–7,19–45,67–71` is a draft operating contract distinguishing owner decisions from pending recommendations. Its supplier-failure remedies and numerical operational clocks must retain their pending labels. The older single-policy recommendation in `docs/architecture/booking-policy-research-and-proposals.md:5–9` is superseded by the Oct13 three-preset decision.

**Owner PDF research context recovered:** the durable handoff records the earlier DeepSeek PDF indexing and Codex qualification at `docs/architecture/phase0/continuation-handoff.md:25`. The recovered extracts are `docs/architecture/booking-founder-guideline-extract.txt` (31-page founder guideline; also `.phase0-harness/founder-guideline.txt`) and `.phase0-harness/confirmed-modification-policy.txt` (17-page modification policy). No separately named DeepSeek PDF-index file was found in the scoped document/harness search; the handoff plus these extracts preserve the context. The original PDFs were not located in those searched directories, so page provenance here is the extract's page headings, not fresh PDF rendering.

Relevant PDF findings:

- Founder guideline, pages 16 and 18–20: investigate minimums, buffers, capacity, equipment and payment; preserve storage's independent multi-day lifecycle; distinguish invitation to apply, invitation to book, pending counteroffer and confirmed amendment. `docs/architecture/booking-founder-guideline-extract.txt:543–552,630–688`.
- Founder guideline, pages 20–21: preserve the original until agreement, payment and atomic application succeed; higher price means a delta, reductions follow responsibility/policy; identify who funds discounts. `docs/architecture/booking-founder-guideline-extract.txt:681–697,719–725`.
- Modification policy, pages 5–6 and 10–14: original cancellation rights survive rescheduling; same-kitchen added hours use the contracted hourly rate as a proposed rule; original agreement remains on non-response/payment failure; increases use a separate payment; reductions require cause-aware refund treatment. `.phase0-harness/confirmed-modification-policy.txt:411–444,599–619,663–719,729–749`.

These are owner-supplied hypotheses, not adopted implementation. The PDF's fixed 7% fee, generic public-review precedents, and proposed amendment cutoffs do not override the owner's configurable-zero fee, private feedback, final preset/versioning decisions, or deferred amendment scope.

## A. Current-state audit

### A1. Hourly kitchen time: one-hour blocks on the operating-day grid

Slots advance **60 minutes from the manager's opening time**. This is not necessarily a top-of-hour grid: an 08:30 opening produces 08:30, 09:30, etc. Each selected slot must be exactly one hour and match that grid; operating hours must contain whole hourly slots. Equal opening/closing time yields no slots in the slot generator, so it should not be advertised as a supported “24 hours” shorthand without resolving the contract. `shared/operating-hours.ts:17–35,114–138`.

Fresh selections must be **one consecutive range**. Adding adjacent hours and removing either end is the intended interaction. Non-consecutive selections are rejected in UI/shared validation, authoritative availability, checkout reservations and fresh session construction. `shared/consecutive-booking-slots.ts:3–30`; `server/domains/bookings/booking.service.ts:528–537`; `client/src/components/booking/KitchenBookingFlow.tsx:987–1013,1489–1495`; `server/routes/consecutive-bookings.test.ts:37–56`.

Historical `selectedSlots` can contain gaps, and historical fulfillment preserves recorded split holds rather than silently filling the gaps. The schema's split-slot example is historical shape, not current new-booking permission. `shared/schema.ts:554`; `server/routes/consecutive-bookings.test.ts:58–71`; `shared/booking-visit-blocks.ts:5–13` and `server/services/kitchen-booking-visits.ts:7–36` retain a multi-block visit model. A separated morning/evening use must currently be separate new requests.

### A2. Minimum, maximum and “per-day” limits

Kitchen `minimumBookingHours` defaults to 1; manager input supports 0–24. Zero removes the configured minimum restriction, but the slot model still requires at least one hour. A location `defaultDailyBookingLimit` defaults to 2, with an optional kitchen override. Manager input accepts limits 1–24 and checks minimum-versus-limit compatibility. `shared/schema.ts:366,492,498,962,979`; `shared/kitchen-booking-policies.ts:12–23`; `server/routes/manager.ts:3310–3327,3356–3360,5275–5288`.

The visible maximum is fetched as `maxSlotsPerChef` and enforced on the current selection. The inspected request checks compare **this request's slot count** against the effective limit. They do not establish an aggregate daily quota across several separate requests by the same person. Therefore describe it as a maximum per hourly request unless a cumulative quota is deliberately implemented. `server/routes/kitchens.ts:136–140`; `client/src/components/booking/KitchenBookingFlow.tsx:1002–1005,1095–1096`; `server/routes/bookings.ts:2737–2738,3134–3141,3447–3449`.

**Correction to an intermediate read:** the current main checkout and direct-booking route already apply `resolveKitchenBookingPolicies` to location defaults; do not report kitchen overrides as universally ignored. The remaining visible mismatch is that the form's notice filter reads `selectedKitchen.location.minimumBookingWindowHours`, whereas checkout uses the effective kitchen override. `server/routes/bookings.ts:3134–3145,3432–3440`; `client/src/components/booking/KitchenBookingFlow.tsx:729–745`. Verify serialized location data before treating this as a reproduced UI defect.

### A3. Daily kitchen booking means one complete operating day

Hourly and daily rates can coexist. The form selects one date and a pricing mode; daily price is one `dailyRate`, not hourly price times duration. Daily selections must include **all operating slots**, and a full-day request is rejected if the operating date already has a non-cancelled booking. `shared/kitchen-booking-rate.ts:1,29–41`; `client/src/components/booking/KitchenBookingFlow.tsx:645–658,965–973,1392–1430`; `shared/operating-hours.ts:141–147`; `server/domains/bookings/booking.service.ts:549–566`.

It is one **operating date**, not a date range and not necessarily midnight-to-midnight access. The kitchen booking record and Checkout metadata hold one date plus start/end and the opening-time snapshot. `shared/schema.ts:549–554`; `server/services/stripe-checkout-service.ts:282–289`. Daily pricing exempts the request from the hourly selection cap in main checkout. `server/routes/bookings.ts:3123–3141,3186–3198`.

There is no verified kitchen multi-day-range product in these paths. A text/schema enum allows `weekly` as kitchen `pricingModel`, but the actual rate helper and checkout modes are hourly/daily; there is no corresponding kitchen weekly/monthly rate calculation or recurrence series in the reviewed booking model. Do not infer product support from the enum/comment. `shared/schema.ts:499,963,980`; `shared/kitchen-booking-rate.ts:1`; `server/routes/bookings.ts:3088–3097`.

### A4. Overnight exists; arbitrary multi-day use does not

An operating window can cross midnight. Hours after midnight belong to the operating date on which the window opened; stored opening time prevents a later schedule edit from reinterpreting the itinerary. Occupancy comparisons inspect adjacent calendar dates through absolute operating intervals. `shared/operating-hours.ts:19–22,38–50,92–112`; `shared/schema.ts:552`; `server/domains/bookings/booking.service.ts:555–566`.

Thus 23:00–01:00 within a valid overnight opening is supported as one two-hour visit. The test named `consecutive-checkout-session` verifies this and rejects split slots; **it is not a consecutive-days checkout feature**. `server/services/consecutive-checkout-session.test.ts:13–24`. Weekly opening hours are availability recurrence, not recurring customer reservations. `shared/schema.ts:506–513`.

### A5. Availability, calendar capacity and temporary holds

Kitchen availability combines a weekly opening window, date-specific closed/custom-hours override, non-cancelled bookings and active Checkout holds. The slot presentation uses capacity **1** for the bookable kitchen. `server/domains/bookings/booking.service.ts:489–522,547–567,675–701,709–744`; `shared/schema.ts:506–538`.

Checkout reserves selected capacity with kitchen/day advisory locks, revalidates availability and stores a hold. Hold duration is **37 minutes**, with the comment accounting for a **32-minute Checkout expiry** and webhook delivery. Fulfillment validates the recorded hold/session/schedule and checks inventory again. These are observed implementation numbers, not a newly proposed policy. `server/services/kitchen-checkout-holds.ts:7,28–46,58–115,132–153`; `server/services/stripe-checkout-service.ts:341`.

Overlap uses strict start/end comparisons, so adjacent bookings are allowed. No kitchen booking turnover/buffer expansion was found in the inspected availability/hold logic. Tour buffer fields exist separately and do not establish kitchen-use buffers. `server/services/kitchen-checkout-holds.ts:74–78`; `shared/operating-hours.ts:66–80`; `shared/schema.ts:2312–2315`.

No waitlist was found in the inspected kitchen booking routes/schema/form. Existing Checkout holds and historical amendment holds are real reservations; they are not a general promise to hold a negotiated offer or a queue for newly freed time.

### A6. Notice and maximum advance window

Minimum notice defaults to **1 hour**, location-scoped with a nullable kitchen override; manager validation supports 0–168 hours. Checkout rejects past/too-soon operating slots. `shared/schema.ts:367,491`; `shared/kitchen-booking-policies.ts:19–23`; `server/routes/manager.ts:3310–3314`; `server/routes/bookings.ts:3144–3163`.

No kitchen booking maximum advance horizon was found in the reviewed form/request/availability paths. The calendar reads month availability, and the form rejects past/unavailable dates rather than applying a fixed future horizon. Tours have separate maximum-advance fields; those must not be credited to bookings. `client/src/components/booking/KitchenBookingFlow.tsx:965–979`; `server/domains/bookings/booking.service.ts:881–908`; `shared/schema.ts:2314–2315`.

A booking months ahead can still authorize now and capture when the manager confirms promptly; this does not require keeping a card hold alive until the visit. Recurrence is different: one authorization cannot be treated as indefinite cover for future occurrences. Public [Stripe manual-capture documentation](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) requires capture before the provider's authorization deadline and notes most payments permit one capture. No account-specific capability was verified.

### A7. Pricing and packages

Kitchen base price is explicitly chosen hourly rate × selected hours, or one daily rate. Both positive rates make both modes available; daily is not an automatic cap/discount on hourly pricing. Minimum hours constrain selection. No verified kitchen package, volume, off-peak, weekly/monthly membership or recurring-price engine was found in these paths. `shared/kitchen-booking-rate.ts:29–41`; `server/domains/bookings/booking.service.ts:85–96`; `server/routes/bookings.ts:3088–3097,3186–3198`.

Price displays must preserve actual tax and transaction fee identity. The owner allows Local Cooks' fee to be zero; the PDF's 7% cannot become a default. Discounting kitchen rent must recompute the applicable tax and configured platform fee, not let a manager overwrite the customer total. `docs/architecture/phase0/continuation-handoff.md:39–40`; `docs/architecture/phase0/manager-visit-preparation.md:47–52`.

### A8. Storage: date ranges and extensions, with unit/custody caveats

Storage already has independent start/end dates and pricing vocabulary for hourly, daily, monthly-flat and per-cubic-foot, plus minimum duration and a duration-unit field. The reviewed explicit-date creation uses elapsed hours for hourly, one flat amount for monthly-flat, and otherwise daily price × a day count floored by the minimum. This is not proof of subscriptions, calendar-month billing, prorated weekly/monthly contracts or recurring custody reservations. `shared/schema.ts:46–47,1205–1211`; `server/domains/bookings/booking.service.ts:187–215`.

In those inspected branches `minimumBookingDuration` is treated as days for non-hourly calculations/extensions without interpreting `bookingDurationUnit`. The monthly-flat branch charges once rather than multiplying calendar months. This is a semantic limitation to document and validate, not authorization for the excluded multi-day storage redesign. `server/domains/bookings/booking.service.ts:192–205`; `server/routes/bookings.ts:823–829,942–949`.

Storage extension preview and checkout check ownership, approved/non-terminal state, active overstay and increasing end date. A separate extension authorization awaits a manager; approval captures it and then applies the new end/price. Pending-extension reads also expire aged authorizations. `server/routes/bookings.ts:756–831,875–949,1075–1129`; `server/routes/manager.ts:6727–6786,6800–6859`. The compatibility `extend` route requires a completed extension reference and does not trust a client “payment confirmed” flag. `server/routes/bookings.ts:1243–1291`; `server/routes/storage-extension-availability.test.ts:31–42`.

Do not call this a proven conflict-safe storage extension system: the inspected preview/checkout/application sequence does not show a kitchen-style temporal inventory hold/atomic competing-storage check. The test file named “availability” tests ownership, minimums, stale ends and replay, not two customers contending for one storage unit. A listing `availabilityCalendar` field also does not establish enforcement. `shared/schema.ts:1222`; `server/domains/inventory/inventory.service.ts:13–34`; `server/services/booking-checkout-fulfillment.ts:49–64`.

Storage custody survives kitchen departure and sometimes cancellation. `storageListingAwaitingRemoval` protects units awaiting confirmed removal, and linked cancellation retains occupied storage as a removal case rather than simply making it vacant. `server/services/booking-linked-cancellation.ts:5–25`. Preserve that invariant in every scheduling expansion.

### A9. Equipment: coupled session add-on, not a weekly/monthly rental product

Current equipment listings distinguish included equipment and paid rentals with a flat **session rate**. Equipment bookings require a kitchen booking; there is no standalone equipment booking in that schema. `shared/schema.ts:1336–1341,1582–1599`.

Although the booking enum includes hourly/daily/weekly/monthly, current creation records a flat session charge as `pricingModel: 'daily'` with both item dates equal to the parent booking date; actual session hours are in the parent. `shared/schema.ts:53,1616`; `server/domains/bookings/booking.service.ts:306–325`; `server/services/booking-checkout-fulfillment.ts:66–72`. No supported independent equipment recurrence, quantity/time-range allocation or post-confirmation add-equipment flow was established. The fulfillment branch verifies listing ownership/existence, not a separately locked last-unit schedule. Kitchen exclusivity reduces some conflicts but cannot substitute for a future shared-resource model.

### A10. Confirmed move/extend is deliberately retired

Routes and old UI/shared models remain, but new preview/request, approve/consent, apply and Checkout are rejected. Historical requests can be read, declined/withdrawn and money reconciled; they cannot become a new itinerary. `server/routes/kitchen-booking-changes.ts:11–15,37–51`; `server/services/kitchen-booking-changes.ts:245–261,273–295,418–422,427–485`.

**Why retired, as far as evidence establishes:** explicit guard code closes these writers and preserves the original booking while historical financial obligations go to recovery. The roadmap intentionally keeps amendments outside the core release pending the version/consent/inventory/payment/policy design. `docs/architecture/booking-current-state.md:28,89`; `docs/architecture/booking-target-phases.md:107–111`. The reviewed material does not establish a more specific original retirement decision, date or defect; attributing it to a particular payment bug or owner rejection would be invented history. The existence of an old engine is not evidence it is safe to reactivate.

The retained engine also expressly refuses its equipment-change branch. `server/services/kitchen-booking-changes.ts:78`. Its historical fee/refund wording is not the newly selected cancellation policy. Reuse isolated concepts/tests only after reconciling them with current owner decisions.

### A11. Arrival, departure and extra use

Arrival/departure reporting exists. Current arrival opens by a saved/configured number of minutes before start and closes after the scheduled end; platform fallback is 15 minutes early, with location overrides. `server/services/kitchen-checkout-service.ts:78–104,359–375`. This is a **reporting window**, not a customer-specific grant of production time before the paid start. Departure, inspection and assistance also exist; clock-based no-tap closeout and the complete settlement chain remain checkpoint work. `docs/architecture/phase0/PHASE0_LOG.md:66,82`; `docs/architecture/phase0/continuation-handoff.md:64–71`.

No new early-arrival/late-departure commercial request flow or working in-session kitchen extension was found. The old `extend` path is retired. Storage overstay/penalty infrastructure is a separate custody product, not evidence of kitchen overtime billing. The latest policy draft treats proven extra kitchen use as a separate case, explicitly forbidding an automatic charge from missing checkout. `docs/architecture/phase0/local-cooks-booking-policy.md:280–289`.

### A12. Invitations, private/manual bookings and maintenance

The kitchen booking schema carries external contact, creator and `bookingType` fields mentioning external/manager-blocked use. A restricted portal route actually creates a location-scoped booking with external contact information. This establishes an operational/external record path, **not** a manager custom-price invitation that Priya can accept and pay. `shared/schema.ts:547,557–562`; `server/routes/portal.ts:346–361,392–415,428–435,459–473`; `server/domains/bookings/booking.service.ts:403–429`.

No booking offer/version/acceptance/discount writer was found in the inspected kitchen booking schema/routes; tour invitations/reschedule offers are a separate product and a UX reference only. The requested booking invitation remains a proposal. `docs/architecture/phase0/manager-visit-preparation.md:43–52`.

Kitchen date overrides already express full-day closure or custom hours and a reason such as maintenance. Availability respects closed overrides. This is useful supply infrastructure, but not proof of a complete workflow for resolving paid bookings displaced by a closure, partial-day downtime or equipment failure. `shared/schema.ts:515–525`; `server/domains/bookings/booking.service.ts:489–506`; `server/domains/kitchens/kitchen.service.ts:439–470`.

## B. Competitor evidence and transferable lessons

Public pages were checked on 13 October 2026. Product variants and help pages can disagree. Numerical examples below describe those products; they are not selected Local Cooks settings. No competitor support contact, login or booking was attempted.

### The Food Corridor: the closest operational comparator

**Documented:** managers can create a booking for a named customer or non-billable closure, repeat daily/weekly/monthly to an end date, reserve equipment over its own needed time ranges, and remove one occurrence or that occurrence plus future ones. Equipment edits are made through the parent space booking. This establishes actual recurring shifts and manager-created standing series, not just weekly opening hours. [TFC manager booking guide](https://help.thefoodcorridor.com/en/articles/2291465-booking-how-to-s-for-kitchen-admins).

**Documented:** space calendars have hourly rates, configurable minimums, opening hours and off-peak rates; scheduling increments can be 30 or 60 minutes. [Space calendar setup](https://help.thefoodcorridor.com/en/articles/1413902-set-up-your-space-calendars), [half-hour scheduling](https://help.thefoodcorridor.com/en/articles/1413974-can-clients-book-half-hour-time-slots-instead-of-full-hours).

**Documented:** automatic gaps between bookings can be enabled for cleaning/maintenance; the gap follows the selected 30/60-minute increment. Managers can override it. [Back-to-back booking buffers](https://help.thefoodcorridor.com/en/articles/2383586-how-do-i-prevent-back-to-back-bookings). The [shared-kitchen toolkit](https://www.thefoodcorridor.com/wp-content/uploads/2022/05/Shared-Kitchen-Toolkit.pdf) separately recommends policies covering one-off/recurring bookings, monthly/weekly limits, advance booking and reservation minimums. That is operating guidance, not proof of each software setting.

**Documented:** reports compare scheduled shifts with actual sign-ins and hours used with booked hours, including potential overtime. Monthly plans can bill **plan overage** monthly or after an overage booking; equipment charges can enter the next monthly bill. [Reconciliation reports](https://help.thefoodcorridor.com/en/articles/2322739-what-information-is-in-the-reporting-tab), [overage billing FAQ](https://help.thefoodcorridor.com/en/articles/12617750-overage-billing-faq). Do not equate exhausting a 40-hour monthly allowance with unauthorized physical overstay. These sources do not establish a universal automatic per-minute overtime charge based on sign-out evidence.

**Not verified:** a native whole-day/date-range price toggle exactly equivalent to Local Cooks daily mode. Managers can reserve time ranges and repeated days; that does not prove a separate daily-rate product.

**Inference:** recurring production, bounded repeat schedules, duration rules, buffers and equipment coupling are the core kitchen lessons. TFC's plan billing and operator overrides should not replace Local Cooks' marketplace consent or capture-at-confirmation model.

### The Kitchen Door, CookItUp/Cookhouse, PREP and Kitchen United

**The Kitchen Door — documented:** discovery/lead marketing with listings describing hourly/monthly rates, memberships and storage fees. Do not credit it with all TFC booking/billing features. [Official listing guide](https://help.thefoodcorridor.com/en/articles/1413900-create-your-listing-on-the-kitchen-door). **Inference:** discovery should reveal a kitchen's commercial model before onboarding, then hand off to the actual booking service.

**CookItUp — not verified:** scoped searches did not identify an unambiguous public first-party shared-kitchen booking platform under this name. Recipe products, unrelated businesses and similarly named rental kitchens are not a basis for feature claims. An exact owner-supplied URL would be needed for a stronger comparison; this does not block recommendations supported elsewhere.

**Cookhouse — documented, identity-qualified:** Cook House Commercial Kitchen Hire in Brisbane publicly offers a few hours, a day, a week or longer, with customized plans arranged by contacting its team. [Cook House rental options](https://cookhousecommercialkitchenhire.com.au/about/). Several unrelated businesses use this name. This source proves flexible commercial arrangements, not a self-service recurring engine, counteroffer workflow or particular turnover minimum. **Inference:** a small operator can fulfill unusual requests through a clear assisted process before automation.

**PREP Kitchens — documented:** hourly members buy a monthly hours allowance, then reserve a station and equipment; dedicated station members have a monthly exclusive station but still reserve shared equipment. Access can be 24/7, unused membership hours expire, and an orientation precedes production. [PREP membership and scheduling explanation](https://prepkitchens.com/how-does-prep-kitchens-work/). Its [public pricing sheet](https://www.prepkitchens.com/wp-content/uploads/2024/10/Shared-commercial-commissary-kitchen-PRICING-Sheets.pdf) separates monthly hours, overage and membership-dependent advance scheduling; quoted prices are not adopted here. Its [shared-kitchen explanation](https://blog.prepkitchens.com/how-does-a-shared-kitchen-work) describes editing/extending bookings, without enough public detail to verify consent/payment/race handling. **Inference:** repeat usage and independent shared equipment matter; membership credits are a different product from a recurring reservation. No public scheduling system at `prepinventory.com` was verified; do not treat that name as interchangeable with PREP Kitchens.

**Kitchen United — documented public limit:** the inspected [public site](https://kitchenunited.com/) markets restaurant delivery/takeout locations and a turnkey restaurant proposition. It does not document an hourly shared-kitchen request/change product. Current booking, buffer, overtime and recurrence behavior is **not verified**. Do not use historic brand prominence to imply feature parity. **Inference:** a dedicated restaurant operating agreement has limited relevance to this hourly pilot.

### Peerspace

**Documented:** hosts configure hourly minimums, variable pricing and an optional discount for 8+ hours. An extended-duration discount is distinct from a daily rate. [Base rates and minimums](https://support.peerspace.com/en/articles/10119413-what-should-my-base-rate-be), [8+ hour discount](https://support.peerspace.com/en/articles/10119426-what-is-an-8-hour-discount). Public add-on guidance expressly anticipates consecutive-day cleaning on multi-day bookings. This verifies multi-day commercial accommodation, not unrestricted continuous access or a particular date-range UI. [Multi-day cleaning and add-ons](https://support.peerspace.com/en/articles/10119383-what-types-of-add-ons-can-i-charge-for).

**Documented:** invite-to-book lets a host propose date/time, rental price and add-ons; the guest reviews and pays. The cited guide gives seven days to respond. [Custom invite-to-book](https://support.peerspace.com/en/articles/11642753-how-to-send-a-custom-offer-using-the-invite-to-book-feature). Before-event updates require guest review; an unapproved update leaves the original booking and cost active. [Adding charges to an accepted booking](https://support.peerspace.com/en/articles/10119491-how-do-i-add-charges-to-a-booking-after-it-has-been-accepted).

**Documented:** setup/cleanup must fit inside booked time. Overtime can cover early entry or late departure, in 30-minute increments at a host-chosen 1× or 1.5× rate; the guide gives 72 hours to submit and 48 hours to dispute. [Overtime rules](https://support.peerspace.com/en/articles/10119193-how-does-overtime-work), [guest preparation](https://support.peerspace.com/en/articles/10119099-how-can-i-prepare-myself-to-be-a-great-guest). Help pages differ on the pre-event update cutoff: the charge-update guide says two hours, while the overtime guide routes additions within one hour into overtime. Do not synthesize an unverified universal cutoff.

**Inference:** use itemized invites, a visible proposal-versus-confirmed distinction and a separate additional-charge process. Do not copy automated card-on-file overtime without Local Cooks' own adopted rule, evidence and mandate.

### Airbnb

**Documented:** special offers propose a custom price/dates and itemized costs; acceptance within the stated window confirms the offered booking. Pre-approval invites booking at current pricing, expires after 24 hours and does not block the calendar. [Special offers](https://www.airbnb.com/help/article/35), [pre-approval](https://www.airbnb.com/help/article/237). Airbnb's [price-change guide](https://www.airbnb.com/help/article/1505) describes special offers for pending requests, while its special-offer guide excludes already-requested listings. That public inconsistency is explicitly unresolved here.

**Documented:** either party can propose a future/current reservation alteration. The original survives decline/non-response; totals are shown before acceptance, with additional charge/refund or payment recovery as applicable. Some Instant Book reservations can add nights automatically. [Reservation alterations](https://www.airbnb.com/help/article/50), [Instant Book extensions](https://www.airbnb.com/help/article/1510).

**Documented:** Airbnb provides messaging templates for approving early check-in/late checkout, and its smart-lock guidance describes adjusting reservation times and access codes for such accommodations. [Arrival/departure quick replies](https://www.airbnb.com/resources/hosting-homes/a/using-quick-replies-to-save-time-73), [smart-lock backup codes](https://www.airbnb.com/help/article/3486). This does not establish a universal paid early/late-request button or automatic entitlement.

**Inference:** a manager's offer can carry advance approval, but acceptance still requires identity, eligibility, available inventory and payment. Give coordination requests a simple place; changes to paid use time need a recorded agreement. Do not copy nightly/long-stay cancellation transitions or automatic extensions into this approval-based pilot.

### Turo and Getaround

**Turo — documented:** trip extension/shortening goes through the platform, with availability, buffer, pickup/return hours, duration and payment constraints. Eligible changes can be accepted automatically; others require host review. Calendar/buffer conflicts can prohibit the change. [Extension/shortening requests](https://help.turo.com/managing-requests-to-extend-or-shorten-a-trip-BJDjrVg45), [extension failure reasons](https://help.turo.com/en_us/faqs-trip-extensions-guests-B1uzMQ9Qfg). Its [additional-use policy](https://help.turo.com/additional-usage-policy-or-guests-BkyC4Vx49) distinguishes an accepted extension from late return. Shortening non-refundable trips need not refund unused time; extensions can retain non-refundable treatment. Early return is therefore not inherently a commercial refund.

**Getaround — documented, international product:** drivers request a date/time change or extension and see its costs; approval/payment and availability matter. Some Connect/Instant Booking increases are automatic; other changes need owner approval. Decline leaves the original return obligation, and offline problems have a support path. [Driver extensions](https://getaround.com/help/articles/3efdd7e2abdc/intl), [owner extensions](https://getaround.com/help/articles/97d0a7a83960). These are regional car-rental rules, not a claim about a Canadian kitchen marketplace or every Getaround market.

**Inference:** paid extra time is a confirmed inventory commitment, not an editable timestamp. An early return/departure can release physical use without resetting price or policy. Protect the next customer and preserve a failure/offline exit.

### Vrbo, Giggster, Splacer and room-booking tools

**Vrbo — documented:** customers request changes to dates, guest count, check-in time or other details through their trip; hosts confirm extra charges/refunds before updating. Decline or silence leaves the original unaffected. [Change a reservation](https://help.vrbo.com/articles/How-do-I-change-my-reservation). **Inference:** assistance/message-first can be intuitive if the final commercial outcome is recorded and the original remains safe.

**Giggster — documented:** booking updates change hours/date/attendance or add-ons with counterparty approval; the original agreement remains until approved, after which charges/refunds and a regenerated agreement follow. [Renter updates](https://help.giggster.com/en/articles/2832078-how-do-i-modify-an-existing-booking-or-change-dates-as-a-renter), [confirmed add-ons](https://help.giggster.com/en/articles/8127414-how-do-i-add-an-add-on-to-a-booking-as-a-host). Current host guidance permits updates through three hours after end, with an overages-report fallback. [Host update guide](https://help.giggster.com/en/articles/8126493-how-do-i-edit-a-booking-as-a-host). Other extra-hours guidance gives an end-of-booking expiry, so those clocks must not be treated as one uniform rule. **Inference:** start with one amendment family and immutable original/amended documents; avoid its film-specific insurance and deposit assumptions.

**Splacer — not verified:** scoped public searches and attempted reads of [public terms](https://www.splacer.co/terms) and its [help centre](https://splacer.zendesk.com/hc/en-us) did not yield accessible first-party booking/change policies. No current recurrence, custom-offer, overtime or refund claim is made. This is an evidence limitation, not proof that the features do not exist or that the service is closed.

**Skedda — documented:** repeat bookings have daily/weekly/monthly/yearly frequencies, bounded end/count, exceptions and single/this-and-following/full-series edits. [Repeat bookings](https://support.skedda.com/en/articles/105723-repeat-bookings). Separate rules handle buffers, minimum/maximum duration and advance windows. [Buffers](https://support.skedda.com/en/articles/3653032-buffer-time), [booking conditions](https://support.skedda.com/en/articles/112700-booking-conditions), [advance windows](https://support.skedda.com/en/articles/105795-booking-window). Granularity can differ from minimum duration. [Time granularity](https://support.skedda.com/en/articles/6210639-basics-culture-language-time-and-currency). Each occurrence has its own cancellation lock-in. [Occurrence lock-in](https://support.skedda.com/en/articles/105751-lock-in-cancellation-end-early-policy). Its Google-sync guide explicitly excludes overnight and paid bookings, so it is not evidence of universal cross-midnight marketplace support. [Sync limitations](https://support.skedda.com/en/articles/8820611-two-way-sync-google).

**Inference:** borrow finite recurrence, per-occurrence exceptions and explicit scheduling controls. Internal desk/room override powers and unpaid calendar edits are not permission to mutate captured marketplace agreements.

## C. Ranked gaps and recommended behavior

Build sizes below are rough product/engineering judgments for one experienced full-stack engineer, including focused UI, meaningful invariant tests and recovery handling: **S** approximately 2–5 engineering days; **M** 1–2 weeks; **L** 3–5 weeks; **XL** 6+ weeks. They exclude owner decisions, migration/provider approval, waiting on reviews and a production rollout. They are not additive estimates; scheduling, quote, consent, support and notice work is shared. Existing dormant code does not reduce a financially consequential change to an S.

### Common edge-case contract for every gap

All recommendations below inherit these requirements; each record also names its distinctive risks.

1. **Consent and payment:** preserve the booked version while a proposal is pending. Before confirmation, changed price requires a fresh accepted quote/authorization and explicit disposition of the old hold. After capture, collect an increase through a separate customer-authorized adjustment; do not assume the original authorization or saved card covers it. Authorize/capture only after the required approvals, verify the financial result, then commit the itinerary. If money succeeds but the final inventory commit fails, retain the original and create a durable compensation/refund obligation. Lost responses, duplicate webhooks and authentication-required/failed payments remain recoverable states.
2. **Policy:** store original policy/terms version, confirmation time, original schedule and all amendments. Moving a booking must not create a fresh cancellation escape window. The selected company presets remain the floor; manager discretion can improve entitlement. Customer-requested removed value follows saved policy; kitchen-caused lost value follows the separately approved supplier-remedy contract. Show exact money/cutoff consequences before acceptance. Never deduct processing costs twice across original and adjustment refunds.
3. **Inventory:** enforce the same rules on listing/calendar, quote, hold, checkout, confirmation, extension and support command. Atomically protect kitchen, buffer and constrained equipment/storage. Recheck the next booking and adjacent operating date. Do not promise capacity because a stale calendar was green. Replacement holds expire independently and never release the original commitment.
4. **Coupling:** kitchen/equipment follow visit schedules; storage retains its own dates, custody and removal obligations. Show the proposed effect for each item. Essential missing equipment requires consent or a service-failure remedy, not silent removal. Avoid charging a session equipment fee twice for a same-session extension unless the accepted price explicitly says so.
5. **Time:** use saved UTC start/end instants plus the location's IANA zone, local operating date and offset where necessary. Newfoundland's half-hour offset and DST gap/fold must work. Weekly recurrence follows local wall time rather than adding 168 UTC hours. Reject nonexistent times and disambiguate repeated times. A later zone edit cannot reinterpret a paid booking. Existing hard-coded Newfoundland booking paths need consolidation before other zones or finer time units.
6. **Silence and support:** each request/proposal/payment/incident has a named next actor and bounded expiry/escalation. Manager silence does not accept a change; it preserves the original. D11 assistance records the named Local Cooks operator, requester, acting-for party, reason, evidence, expected revision and notices to both participants. A support override uses guarded domain/payment commands, never direct row edits, impersonation or an unrecorded promise of free inventory.

### P0-1 — Make the supported time and price model explicit and consistent

**Comparator:** TFC minimums/increments and Skedda granularity separate start-grid, duration and quota; Peerspace separates hourly price from duration discount. **Today:** A1–A3/A6; one-hour operating-grid range, one daily operating date, minimum and request cap, notice filtering with a possible effective-policy mismatch.

**Recommend:** display “Choose a start time and duration” even if the underlying selector stays one-hour blocks. Show minimum, maximum per visit, earliest allowed start, available hourly/day choices and the exact daily access interval before payment. Never call the request cap a daily personal quota unless it actually sums other bookings. Explain “Your booking includes setup and cleaning.” Offer an explicit price comparison when both modes are valid; do not silently change the customer's mode to a cheaper/different access contract.

**Edges:** a minimum above the maximum must block publication with a repair path; daily mode must not inherit an hourly cap; overnight labels show both calendar dates; missing/equal-hour schedule is an error, not unlimited access. Support cannot bypass safety opening restrictions casually. Payment and original policy use the quoted mode/version. **Size:** M for shared policy/read/display alignment; daily-to-hourly conversions remain outside this checkpoint.

### P0-2 — Turnover protection and cleaning responsibility

**Comparator:** TFC explicitly supports automatic buffers; Skedda treats changeover as a scheduling rule; Peerspace makes customer setup/cleanup part of booked time. **Today:** A5; exact adjacency permitted, tour buffers only.

**Recommend:** distinguish Priya's setup/cleanup inside her paid hours from Sam's staff turnover after them. Give each kitchen a visible turnover requirement, enforced by the availability engine. A pilot kitchen can select zero only deliberately when immediate handover is operationally realistic. Use a small preset set rather than unrestricted rules; owner/manager chooses actual permitted values. A buffer is unavailable inventory, not extra charged time or a cancellation extension.

**Edges:** an extension moves the old turnover interval to the new end and must protect the next booking's gap. Applying new buffers must not invalidate existing paid bookings silently. Included equipment cleaning and allergen resets may need longer gaps; blocked physical storage stays reserved independently. Across midnight/DST calculate gap in instants. D11 exceptions require evidence that turnover can be performed, with the next participant protected. **Size:** M–L because every calendar/hold/commit path must agree, not just the picker.

### P0-3 — Duration rules and a bounded advance horizon

**Comparator:** TFC/calendar minimums, PREP advance privileges and Skedda min/max/window rules. **Today:** A2/A6; minimum/cap and minimum notice exist, maximum horizon not verified.

**Recommend:** one effective rule set at location default plus kitchen override. Keep the present one-hour grid for the first pilot unless demand proves otherwise; add an explicit maximum advance horizon sized to the manager's planning/maintenance certainty. Show availability only inside it and apply the same rule server-side. Manager response deadline must fit before practical preparation/start and provider authorization expiry; do not import competitors' 24-hour/seven-day offer windows automatically.

**Edges:** at exact cutoffs use one server clock; shorten pending request deadlines for near-start bookings rather than allowing confirmation after useful service is gone. Long-ahead requests capture at confirmation, not at service. A horizon change does not cancel existing bookings. Weekly series must end inside the materialized horizon, with no perpetual hold. D11 supplies an audited exception or decline rather than indefinite pending. **Size:** M; legal/provider holding constraints are separate from the booking horizon.

### P0-4 — Blackouts, maintenance and a kitchen-not-ready remedy

**Comparator:** TFC non-billable closures, Turo calendar blocks, and kitchen operators' required maintenance gaps. **Today:** A12; full-date/custom-hours overrides exist.

**Recommend:** surface the existing closure tool in the manager schedule. Before applying a closure show affected holds, pending requests and confirmed visits; keep confirmed obligations visible as cases until explicitly resolved. A broken essential item can make a session unusable even if the kitchen is open. Provide “The kitchen isn't ready” in Priya's booking with contact and Local Cooks escalation; distinguish it from ordinary cancellation.

**Edges:** maintenance versus checkout/confirmation race; late failure during use; next booking impacted; cooling/storage access and safe removal still required. Supplier-caused removed service uses the pending approved remedy/funding decision, not the customer's voluntary cancellation deduction. An unresponsive manager escalates to Local Cooks with a response deadline and named operator. **Size:** M for a guided closure-impact workflow; L if arbitrary partial-day blocks/item-level maintenance are added. Use separate full-day/custom-hour overrides initially.

### P0-5 — Complete the booked-time journey and support exits

**Comparator:** Airbnb/Vrbo arrival coordination, TFC sign-in reconciliation, Turo/Getaround separating scheduled use from condition evidence. **Today:** A11; reporting/inspection/assistance exists, no-tap closeout and complete settlement still pending.

**Recommend:** finish the active checkpoints before expanding booking types. Arrival reporting, departure evidence, scheduled service end, inspection, claim, remedy and transfer remain distinct. Missing taps do not prove no-show/overstay and cannot hold a routine booking open indefinitely. At every pending/failure state show what is happening, whose action is due, when it expires and the assistance route. Preserve live operational instructions and frozen legal/money terms.

**Edges:** offline device, failed photos, early departure, manager absent, service failure, ambiguous provider reply and early inspection clear. Grace is not permission to occupy the next customer's time. Equipment returns follow the visit; storage removal stays separate. D11 is a guarded workflow in every state, including confirmed-change requests that automation cannot yet perform. **Size:** L–XL remaining integrated work, partly already in progress; refer to the accepted checkpoint reports, not a new estimate of all work completed.

### P1-1 — Manager-created invitation with a custom price, before confirmation

**Comparator:** Airbnb special offers/pre-approvals, Peerspace invite-to-book, TFC manager-created bookings. **Today:** A12; portal/external records and tour invites, no paid kitchen-offer acceptance product.

**Recommend:** Sam chooses an eligible person, kitchen, supported date/range, equipment/storage, kitchen-funded adjustment and expiry; sees the total and manager proceeds; sends a private versioned offer. Priya reviews the full proposal and chooses “Accept and pay $X.” The exact offer carries Sam's preapproval; if eligibility, inventory and payment are still valid, no second manager approval is needed. The implementation must preserve capture at confirmation through its own explicit transition. An invitation to apply remains distinct and cannot bypass access requirements.

**Edges:** offer withdrawn/replaced/expired; forwarded link/wrong account; eligibility expires; two recipients contend; price zero versus discount below floor; positive/zero fee; tax; manager reassignment; mandatory equipment. Recommend **no inventory reservation merely on send**, with clear subject-to-availability copy; reserve a short hold when acceptance/payment begins. Expiry/short-notice deadlines require owner-selected settings. Pending authorized requests need an explicit replacement-and-release transition; do not silently alter that hold. D11 can withdraw/assist through the same audited commands. **Size:** L. Promote to P0 if pilot acquisition depends on manager-led offers; this is the first new commercial feature.

### P1-2 — Multi-day daily ranges and repeat previous booking

**Comparator:** Peerspace documents multi-day arrangements; TFC repeats daily; Cook House accommodates longer arrangements. **Today:** A3/A4; single operating date only; storage ranges are separate.

**Recommend:** allow a finite selection of consecutive available operating dates, each with explicit start/end and daily price. Show closed dates/conflicts and an itemized total. Reserve all selected visits transactionally; give each occurrence its own arrival, departure, inspection and cancellation allocation. Do not imply overnight exclusive possession between production days. “Book again” can prefill a single visit sooner, but must obtain a fresh quote/availability/acceptance rather than copy historical payment or access secrets.

**Edges:** holiday interrupts range; different daily opening hours; first/last day hourly; equipment charged per visit versus package; storage bridges nights independently. A partial cancellation needs occurrence-level entitlement and cannot refund an arbitrary fraction of a bundled capture. Approval should explicitly cover the complete proposed set; failed acceptance should not create a surprise partial series. Deferred settlement must account for the final service and long storage obligations without exceeding permitted holding limits. D11 can split an affected visit with preserved allocation/history. **Size:** L; mixed hourly/daily range and shared single-payment allocations can be XL. Promote only for actual pilot multi-day need.

### P1-3 — Standing weekly production bookings, bounded and occurrence-based

**Comparator:** TFC recurring shifts and Skedda finite repeat rules; PREP's production memberships demonstrate repeated demand but not an identical series contract. **Today:** A4/A8/A9; weekly opening hours and monthly storage vocabulary, no kitchen reservation series.

**Recommend:** first support “Every Tuesday, 9 a.m.–1 p.m., until [date]” for a finite horizon, with a preview of every occurrence and conflicts. Sam approves the exact proposed set once; that is explicit approval of each listed visit, not automatic acceptance of unbounded future visits. Store independent occurrences under a series identifier. Permit “This visit” and “This and future visits” with an explicit preview; do not edit past use. Treat recurring schedule and subscription/credits as separate products.

**Edges:** local wall time across DST; exceptions/maintenance; skipped dates; new terms/credentials before future occurrences; different future rates; changed equipment; series versus single cancellation; manager reassignment. No silent conflict skipping or infinite inventory/card hold. For the first version use separately priced/paid occurrences or a finite prepaid set with explicit allocations; disclose what is reserved, confirmed, unpaid and paid. Rolling charge schedules require fresh payment/mandate and failure recovery design, not assumption that one manual authorization covers months. Protect storage custody across the gaps. D11 can resolve one occurrence without corrupting the series. **Size:** L–XL. This is the highest-value scheduling P1; promote to P0 only if named pilot customers rely on guaranteed weekly time.

### P1-4 — Flexible starts and finer granularity

**Comparator:** TFC allows half-hours; Skedda separates granularity and minimum. **Today:** A1; fixed one-hour increments anchored to opening.

**Recommend:** make the existing start-plus-duration experience intuitive first. Add 30-minute starts/durations only if production handover or customer feedback requires them, preserving a separate minimum paid duration. Avoid arbitrary minute starts in the pilot. A displayed half-hour start with only whole-hour charging must be explicit, not a hidden round-up.

**Edges:** slots.length no longer equals hours; money/duration validators, calendar, buffers, equipment, receipts and historical slots all need unit-aware readers. DST may make wall duration differ from elapsed duration; the charging convention must be disclosed. Existing paid bookings retain their old grid. A support-specific odd-time accommodation still reserves real inventory and records consent. **Size:** L for system-wide units; a UI presentation of the existing grid is S–M and belongs in P0-1.

### P1-5 — Confirmed changes: move, extend, shorten and equipment

**Comparator:** Airbnb/Vrbo/Giggster preserve the original during proposals; Peerspace has approved pre-event updates. **Today:** A10; new kitchen changes retired, equipment branch unavailable, storage extension separate.

**Recommend:** introduce one proposal revision at a time, with old/new schedule, line items, total paid, delta/refund, policy effects and expiry. Both parties may propose; material manager proposals need Priya's acceptance. Start with same-kitchen added time and approved equipment additions; moves/shortening follow only after the cancellation engine can price removed value. Keep the original if declined, withdrawn, expired, unavailable or unpaid. Do not make cancel-and-rebook the default for routine changes because it can lose inventory and impose avoidable processing loss.

**Edges:** customer shortening inside a cutoff is not a guaranteed refund; supplier-caused reduction follows its different remedy. A move cannot reset refund rights; use a carried-forward original cutoff and disclose any earlier new-date restriction, rather than quietly granting a new full-refund period. Refund/capture/transfer races, multiple charges, disputed original payment and failed adjustment refund require recovery. Add-equipment capacity and essential substitutions need explicit consent. Storage can retain dates or require a separate amendment, never follow a kitchen move automatically. D11 overrides must show cost bearer and altered rights before committing. **Size:** XL for the full family; a narrow increase-only family is L. This is the optional roadmap phase, not reactivation of old guards.

### P1-6 — In-session “one more hour”

**Comparator:** Turo/Getaround accepted extensions and Giggster add-hours offers; Peerspace separates late extra time from ordinary pre-event update. **Today:** A10/A11; reporting exists, extension unavailable.

**Recommend:** Priya requests a supported extra duration from the active booking; Sam can respond with an exact extension offer. Recheck kitchen, equipment and turnover after the proposed new end. Show rate, tax/fee and new end; collect Priya's explicit acceptance and successful delta payment before “Extended until 3 p.m.” is shown. Keep manager approval in the pilot; do not add Instant Book or unilateral manager edits. Recommend the contracted hourly rate for same-session additions; daily bookings need an explicitly disclosed extra-use rate before this feature can be enabled.

**Edges:** next booking arrives; equipment unavailable for added hour; payment/authentication takes past the original end; departure was already recorded; kitchen closes; manager unresponsive; daily-rate extension crosses operating date; positive/zero fee. The new inventory hold is bounded and must not steal the next booking. Pending approval/payment does not grant use after the original end. Expire safely at the saved operational deadline; if already over time, switch to an incident/extra-use case, not a retroactive fake extension. Regenerate reminders, access/visit revision and closeout/release clocks exactly once after success. Storage end does not move. D11 offline assistance still requires recorded consent and a real financial/capacity result. **Size:** L after the amendment foundation. Promote before pilot only if normal service cannot finish reliably without it.

### P1-7 — Early arrival / late departure requests

**Comparator:** Airbnb messaging/time accommodations and Vrbo reservation requests; Peerspace charges actual early/late space use. **Today:** A11; generic early reporting window, no individual extra-use request.

**Recommend:** distinguish **coordination** (“Priya expects to arrive at 8:45”) from **more booked use** (“Priya needs the kitchen from 8:45”). A short “Ask Sam about arrival” can use existing messaging in P0, explicitly pending a reply. Structured paid or free additional production access reuses the amendment/extension system; accepted free time still consumes inventory. Early departure records what happened without implying a refund.

**Edges:** supplies-only drop-off versus actual production; prep begins before booked start; previous customer/cleaner occupies space; access code opens early; no manager reply. A reporting window or “grace” cannot override the prior/next booking or turnover. Per-person accommodations must be in the booking, not a location setting changed for everyone. Price/policy/storage/equipment effects are shown where applicable. D11 distinguishes access failure from voluntary late arrival. **Size:** S for useful coordination entry/copy; M–L for structured accommodations after amendment primitives.

### P1-8 — Evidenced overtime after the fact

**Comparator:** Peerspace post-event overtime with disclosed increments/disputes; TFC scheduled/actual reconciliation; Turo separate additional usage. **Today:** A11; separate storage penalties, no verified complete kitchen extra-use billing contract.

**Recommend:** during the pilot, enable a reasoned extra-use report and Local Cooks review, with no automatic charge from a missing tap. Before collecting, adopt a structured rate/increment, evidence standard, filing/response deadline and consent/payment path. Recommend ordinary contracted rate initially rather than a punitive multiplier; actual owner selection remains open. Priya sees the period, evidence, amount and dispute/help action. Separate claim approval, payment requested and payment recovered.

**Edges:** missing/offline timestamps; approved extension already charged; cleanup versus staff delay; host caused lost time; daily rate lacks marginal price; clock change; next customer loss; chargeback or mandate missing. Avoid double-billing an extension and overstay for the same time. Use on-session payment when charge authority is absent; failed collection is a support debt, not “paid.” Do not hold all kitchen earnings or reset ordinary closeout indefinitely. Preserve stored food and lawful removal obligations. D11 can correct/waive with named actor and cost allocation. **Size:** L for charge/dispute/payment system; M for case intake using existing evidence/support. P0 is the incident/help path, not automated billing.

### P2-1 — Waitlists and long commercial holds

**Comparator:** Airbnb pre-approvals can compete without calendar blocking; Local Cooks already has short Checkout reservations. No universal comparator waitlist rule is established. **Today:** A5; 37-minute Checkout hold, no verified waitlist.

**Recommend:** preserve reliable short payment holds in P0. Later offer “Notify me if this time opens,” with no guarantee and a fresh quote/request when notified. Do not offer long exclusive negotiation holds unless paid demand justifies the capacity loss. A notification is not a reservation or card authorization.

**Edges:** multiple waiters, stale cancellation/refund release, unavailable add-ons, notice cutoff, maintenance and changed rates; unsubscribe/privacy; first acceptance wins under atomic capacity rules. No saved-card auto-charge when a slot appears. D11 can withdraw a mistaken hold, preserving a real paid obligation. **Size:** M for notifications; L for fair queuing/priority/long holds. Defer priority auctions and waitlist auto-booking.

### P2-2 — Memberships, volume discounts, monthly exclusivity and general counteroffers

**Comparator:** TFC plans/overage, PREP memberships, Peerspace long-duration discount. **Today:** A7–A9; individual kitchen prices and storage/equipment vocabulary, not a general subscription product.

**Recommend:** manager-funded one-off offers first, finite weekly reservation series second. Add prepaid credits, memberships, off-peak bands, package discounts, month-long kitchen possession or multi-round counteroffers only with observed demand and margins. Keep equipment flat session charges unless changing its commercial model solves an actual constraint.

**Edges:** unused credits/expiry, discount lost after shortening, tax at sale/use, installment failure, cancellation allocation, refunds exceeding cash paid, continuous storage, long fund holding and supplier reassignment. General negotiation creates version/expiry/support load without improving the common journey. D11 needs a clear financial ledger for every adjustment. **Size:** XL; omit from pilot. These are distinct products, not a few pricing fields.

## D. Sequencing within the existing eight phases

The roadmap has phases **0–7**; do not rename it or insert a replacement “booking overhaul.” The current local checkpoint order is the delivery order for the visit work, not a claim that cancellation/refund dependencies can be ignored until the end. Phase 7 remains the integrated release gate. `docs/architecture/booking-target-phases.md:5–7,27–111`; `docs/architecture/phase0/continuation-handoff.md:51–73`.

### Preserve the current checkpoint order

1. **Arrival/departure — Phase 1/5 input.** Finish the active kitchen override/live-instruction/task/code scope according to the latest log, retain assistance and mandatory arrival/departure with optional manager-added tasks. Check a single visit, legacy split visit and overnight; optional/required tasks; changed current instructions; failed upload/retry; correct person/manager permissions. Do not reopen the removed tracking switch or add early-use promises.
2. **Clock-based closeout — Phase 5.** Save authoritative service instants/zone and revision; end booked use without taps; bound inspection and exceptional cases independently. Check no arrival/departure, early departure, late manager response, delayed worker, DST and last visit in a set. No timer proves vacancy, no-show or liability. Extension hooks remain disabled until a financially committed schedule revision exists.
3. **Reminders — Phase 6 capabilities introduced now.** Revalidate recipients/current state and active schedule revision at delivery. Check short-notice catch-up, cancellation/closure, instruction/task changes, stale future reminders and manager non-response. Keep in-app next action if email fails. Existing observed reminder offsets are not newly approved clocks.
4. **Private feedback — Phase 5/6.** Prompt after eligible service end independently of tap/inspection/payment; participants see their own submissions, Local Cooks sees both. Check privacy, suppressed inappropriate prompts and support flags; never make feedback decide refunds automatically.
5. **Payout after closeout — Phase 5 gate.** Prove central transfer guard across all callers, saved beneficiary/model, bounded inspection/remedy/claim eligibility, funded recovery and provider/holding/contract constraints. Check old already-transferred bookings separately, no early release from manager clear, failed refund, dispute, long storage and disabled payout. Bank payout remains separate from transfer. No new settlement enrollment on this research handback.
6. **Cancellation policy engine — Phase 2/4.** Implement the final presets and future-only terms/policy versions, automatic effective cancellation and actual processing-cost arithmetic. Check exact tier boundaries, late booking disclosure, manager upward discretion, supplier-failure recommendation status, pending/failed refund and occupied storage. Without this checkpoint, shortening/moving and per-occurrence series cancellation stay unsupported.

### Add the scheduling/commercial work at clear gates

- **Phase 0 decision gate:** owner answers the short questions below; select real operating clocks/coverage and whether named pilot users require weekly/multi-day/extra-hour use. Record any promoted P1 in scope. No new source/payment/database work follows from this document alone.
- **Phase 1 listing-readiness checkpoint:** P0-1/3/4 configuration and disclosures, maintenance/contact readiness, explicit daily access definition, invalid minimum/maximum repair and location→kitchen inheritance. Verify users can explain what they are buying before Checkout.
- **Phase 2 quote/contract checkpoint:** stable rates/tax/fees/policy/terms identity, daily versus hourly comparison, versioned offer shape and any chosen turnover rules. Verify old bookings retain legal/money terms while operational instructions remain live. Resolve amendment cancellation anti-reset rules before accepting amendment writers.
- **Phase 3 capacity/payment checkpoint:** P0-2 buffers, shared effective time rules, bounded holds and definitive confirmation. Test adjacent/overnight/cross-day contention, maintenance-versus-capture, final equipment/storage unit and provider-success/inventory-failure compensation. This is required before offers or time expansion can promise availability.
- **First new commercial checkpoint, Phase 2/3/6:** P1-1 before-confirmation invitations. Start with one supported visit, existing add-ons and a manager-funded kitchen adjustment. Demonstrate Sam sends, Priya reviews/pays, exact offer confirms once; expiry/wrong user/unavailable slot/payment failure preserves honest state. Pending-request replacement is a separate demonstrated case, not assumed.
- **Scheduling expansion checkpoint, Phase 2/3/4/5/6:** if required, P1-3 bounded weekly occurrences; otherwise P1-2 finite daily ranges or single-visit “Book again.” Demonstrate conflict preview, explicit batch approval/payment allocation, individual cancellation, DST wall-time recurrence, per-visit evidence/closeout, and storage independence. Do not add subscription billing to deliver recurrence.
- **Optional modifications phase before Phase 7 if promoted:** implement the narrow increase-only version first, then P1-6 same-session extension and paid/free early/late access. Demonstrate next-booking refusal, held increment, approval, explicit payment, immutable original, final atomic schedule revision and rescheduled notices/closeout. Add moves/shortening/equipment-removal only after policy/refund consequences are proven. This follows `docs/architecture/booking-target-phases.md:109–111`, not dormant-engine activation.
- **Phase 7 integrated pilot rehearsal:** request → confirmation → preparation → arrival → scheduled end → inspection/exception → private feedback → eligible transfer → bank-state presentation; cancellation/refund and no-manager-response variants; promoted offer/series/extension flow if enabled. Verify both participants' views, Local Cooks recovery, receipts/history, meaningful concurrency/provider evidence and rollback preserving in-flight obligations. Stop at each accepted checkpoint rather than shipping all expansions together.

**Pilot release bar:** every supported journey reaches a truthful terminal/service outcome and a bounded financial recovery path. If amendments are not enabled, Priya sees the original hours and “Contact Local Cooks about a change”; any cancellation/new-request alternative displays actual refund/fee and capacity risk. Support cannot promise a paid amendment before it has safe authorized commands. Repeated manual work for normal weekly use or extra-hour requests is evidence to promote those features, not a permanent hidden operating model.

## E. Questions only the owner can answer

These questions do not reopen settled presets, live instructions, private feedback, no deposits or capture-at-confirmation. Engineering can choose implementation details once the business boundaries are known.

1. **Pilot demand:** do named pilot customers require guaranteed weekly production time, multi-day daily-rate ranges, or both? Which one is a launch requirement rather than a convenience?
2. **Meaning of a day and limit:** should a daily rate buy the entire published operating window, and should a multi-day purchase mean separate daily visits or continuous exclusive access? Is the hourly limit intended per visit or cumulatively per person per operating day?
3. **Offer authority:** may managers discount their kitchen price below the listing price, down to zero? May they discount equipment too? What minimum/margin or Local Cooks approval boundary applies? The recommended default is kitchen-funded adjustments only, with no manager override of tax or platform fee.
4. **Extra time for the pilot:** must the pilot support an in-session paid extra hour and paid/free early access, or can rare cases use a disclosed supported assistance path until the amendment checkpoint? For a daily-rate booking, what is the agreed extra-time rate?
5. **Operating promises:** who is reachable during early/overnight sessions, and what real manager/support response coverage can Local Cooks promise? That determines short-notice bookings, proposal expiry, practical notice/horizon and no-stuck escalation; engineering should not invent coverage.
6. **Turnover and overtime:** what turnaround do pilot kitchens actually need, and should proven additional production time be billed at the contracted rate during the pilot? Approve the permitted buffer choices and any extra-use rate/increment/filing/dispute rules before collecting; missing checkout remains insufficient evidence.

**Recommended decision if no pilot dependency is demonstrated:** deliver the P0 service contract, then one-visit private offers, bounded weekly reservations, and a narrow paid extension in that order. Keep monthly memberships, arbitrary-minute scheduling, long exclusive holds and a generic counteroffer engine out of the pilot.
