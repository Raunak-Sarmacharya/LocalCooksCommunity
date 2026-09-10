# Kitchen Manager Onboarding and Glance-First UX Research

## Outcome

Keep the product multi-location, but make the ordinary manager experience location-first. A manager with no location is guided through one short launch flow. A manager with a location lands on today's work and sees "Add another location" only in an intentional account-level location switcher/settings surface.

The onboarding should collect the minimum information needed to make a kitchen trustworthy and bookable. Everything else remains available after launch as a visible, prioritized improvement—not another mandatory onboarding page.

## Evidence from the current code

This review follows live client, server, schema, and Chef-facing code rather than the older planning documents.

| Area | Present in data/API | Collected during onboarding | Used by Chef-facing experience | Decision |
|---|---:|---:|---:|---|
| Location name and address | Yes | Yes | Yes | Required |
| Primary and notification contacts | Yes | Yes | Operational | Required |
| Location logo | Yes, but only through the broad cancellation-policy/settings endpoint | No | Yes | Required; add to location identity |
| Public location description | Yes, but only through the broad cancellation-policy/settings endpoint | No | Yes | Required; add a short description |
| Location brand/hero image | Yes, but only through the broad settings endpoint | No | Yes | Recommended, not a launch blocker |
| Kitchen licence, expiry, and terms | Yes | Yes | Trust/readiness | Required; approval remains asynchronous |
| Kitchen name and description | Yes | Yes | Yes | Required |
| Kitchen cover image | Yes | Yes | Yes | Required |
| Kitchen gallery | Yes | No | Yes | Recommended after one cover image |
| Kitchen amenities | Yes (`features` in API, `amenities` in storage) | No | Yes | Require a small useful selection |
| Hourly price and minimum hours | Yes via a second pricing request | Yes | Yes | Required; save as one user action |
| Availability | Yes | Yes | Booking | Required |
| Application requirements | Yes | Yes | Booking | Required |
| Equipment/storage listings | Yes | Optional steps | Yes | Keep optional and move to improvements if skipped |
| Stripe setup | Yes | Yes | Payouts | Required before accepting paid bookings |
| Cancellation, booking-window, check-in, no-show, overstay, smart-lock rules | Yes across separate settings routes | No or later | Operations | Use safe defaults; configure after launch |

Important contract gaps:

- `POST /api/manager/locations` and the general location update accept identity, contacts, licence, and terms, but not logo, hero image, or public description.
- Those brand fields are accepted by `/locations/:locationId/cancellation-policy`, which has become a catch-all settings endpoint. Onboarding must not silently rely on that accidental naming. Introduce a focused profile/settings contract or deliberately coordinate the two writes with recovery.
- Kitchen creation accepts description, cover image, and `features`; onboarding currently omits features and performs pricing as a separate request.
- Current readiness checks licence, kitchen existence, availability, requirements, and Stripe. After the persisted onboarding-complete flag is set, several detailed checks are trusted instead of re-evaluated. Brand and listing quality are never evaluated.

## Minimal field model

### Launch blockers

Location:

- Business/location name
- Physical address
- Primary contact and notification destination
- Logo
- Short public description
- Kitchen licence, expiry, and terms

Kitchen:

- Kitchen name
- Short description
- Cover image
- A compact amenity selection
- Hourly rate, currency, and minimum booking time
- At least one availability window
- Application requirements
- Payout setup

Licence approval should block accepting bookings, not block finishing the setup flow. The dashboard should show the review state and the next useful action.

### Improve after launch

- Location hero image
- Two or more additional kitchen photos
- Richer amenities
- Equipment and storage listings
- Custom renter onboarding link

### Advanced operations

- Cancellation wording and notice window
- Daily booking limit and minimum booking notice
- Check-in/no-show windows
- Overstay penalties
- Smart-lock configuration
- Tax and alternate pricing models when product support is complete

These belong under Settings or the relevant kitchen detail page. They should not create more top-level navigation or more onboarding steps.

## Proposed onboarding flow

1. **Location identity** — name, address, logo, public description, contacts.
2. **Trust documents** — licence, expiry, terms, with review-state explanation.
3. **Kitchen offer** — name, description, cover image, amenities, price, minimum duration in one focused form.
4. **When it can be booked** — availability and application requirements together as one booking-readiness stage.
5. **Get paid** — Stripe setup.
6. **Review and launch** — a plain checklist separating blockers from optional improvements.

Equipment and storage are offered from the review screen as optional enhancements instead of mandatory-looking steps. Preserve every existing function; only change when and where it is presented.

## Create-kitchen experience

Replace the expanding inline card with a focused sheet or page using the same visual grammar as the Chef dashboard:

- One clear page title and one-line explanation.
- Three compact sections: Space, Booking offer, Preview.
- Cover image first; gallery is an optional follow-up.
- Amenity chips with the existing vocabulary and custom-entry escape hatch.
- Price and minimum duration together.
- Sticky summary showing photo, name, rate, minimum duration, and missing required fields.
- One submit action that creates the kitchen and saves pricing; partial failure must offer retry without duplicating the kitchen.

Reuse the existing image replacement, upload, form, card, button, and token primitives. Do not introduce another component library or a new abstraction layer.

## Glance-first manager home

The first screen answers four questions without searching:

1. What needs my attention now?
2. What is happening today/next?
3. Is the location ready to accept bookings?
4. What is the fastest next action?

Use the Chef dashboard's established grammar:

- A consistent page header.
- At most four top metrics.
- One unified **Needs attention** list, capped at three items, with direct actions.
- Today's/next booking immediately below it.
- Compact status dots/chips and semantic colors.
- Secondary analytics and setup detail below the fold.

Do not show every capability as a dashboard card. The navigation and page content remain complete, but low-frequency settings are grouped and reachable contextually.

## Readiness model

Use three independent states:

- **Setup complete**: required information has been supplied.
- **Accepting bookings**: licence approved, availability valid, requirements and payouts ready.
- **Listing quality**: recommended brand/gallery/equipment improvements, expressed as a score or task list but never confused with booking eligibility.

Re-evaluate these from server data. A historical `managerOnboardingCompleted` flag may optimize routing, but must not become the source of truth for present readiness.

## Cohesive page contract

Every manager page should use the Chef-side primitives or manager equivalents with the same contract:

- One header, optional primary action, no duplicate page titles.
- `bg-card`, semantic borders/text, shared radius, and no decorative shadows.
- Consistent empty, loading, error, and success states.
- Actions named as outcomes: **Review request**, **Set availability**, **Complete listing**.
- Location context visible in the header/switcher, not repeated in every card.
- Mobile retains the same priority order; tables collapse to purposeful cards.

## Information architecture

Keep the six manager groups already planned: Overview, Bookings, Kitchens, Operations, Insights, Settings. Surface location switching inside the header/profile context. For a manager who already has one location, hide the prominent add-location action. For a true multi-location operator, show switching first and place **Add another location** inside location management—not in daily navigation.

## Implementation sequence

1. **Contract and readiness foundation**
   - Add a focused location-profile endpoint or expand the general location endpoint for logo, hero, and description.
   - Add a server-derived readiness response with blocker and improvement categories.
   - Make kitchen creation idempotent or combine base details and pricing transactionally.
2. **Onboarding fields and flow**
   - Add logo/public description and amenity selection.
   - Merge booking readiness steps and move optional inventory to review.
   - Add retry-safe uploads and save behavior.
3. **Kitchen creation redesign**
   - Share the onboarding kitchen editor with Kitchens management.
   - Keep edit/gallery/pricing routes and functionality intact.
4. **Manager UI convergence**
   - Adopt the Chef header, status, tile, notice, spacing, and empty-state grammar page by page.
   - Convert the overview to the glance-first hierarchy.
5. **End-to-end verification**
   - Test zero-location, one-location, and multi-location managers separately.

## End-to-end acceptance matrix

| Journey | Must prove |
|---|---|
| New manager | Creates one location, uploads brand/trust assets, creates priced kitchen, sets availability/requirements, connects payouts, reaches home without duplicate records |
| Licence pending | Finishes setup, sees review status, cannot accept bookings, can complete listing improvements |
| Existing one-location manager | Lands directly in that location; no prominent add-location action; all settings remain reachable |
| Multi-location manager | Switches location safely; every query, notification, booking, and mutation stays scoped to the selected location |
| Create kitchen failure | A failed pricing/upload step retries against the same kitchen and never creates a duplicate |
| Chef discovery | Logo, description, cover/gallery, amenities, rate, and minimum duration appear on comparison and preview pages |
| Incomplete listing | Dashboard presents the highest-priority missing item with a direct deep link |
| Regression | Existing bookings, requirements, equipment, storage, policies, smart locks, notifications, payouts, and reports remain reachable and functional |

## Primary code change map

- `client/src/config/onboarding-steps.ts`
- `client/src/components/onboarding/steps/LocationStep.tsx`
- `client/src/components/onboarding/steps/CreateKitchenStep.tsx`
- `client/src/contexts/ManagerOnboardingContext.tsx`
- `client/src/hooks/use-onboarding-status.ts`
- `client/src/components/manager/KitchensManagement.tsx`
- `client/src/pages/ManagerBookingDashboard.tsx`
- `client/src/components/chef/ui.tsx` (reuse or extract role-neutral primitives)
- `server/routes/manager.ts`
- `shared/schema.ts`

