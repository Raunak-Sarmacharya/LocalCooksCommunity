# LocalCooksCommunity — project notes

## Identity & verification (email is the primary identifier)
- **`users` has no `email` column.** `users.username` **is** the confirmed email (`NOT NULL UNIQUE`), written by `createPublicFirebaseUser({ username: registrationEmail })`. Any email change must rewrite `username` atomically or the two stores disagree.
- `GET /api/user/profile` returns explicit `email`, `emailVerified`, `emailVerifiedAt`, `pendingEmail`, `pendingEmailSentAt`, `pendingEmailExpiresAt`, `resendAvailableInSeconds` (built by `server/email-verification.ts` → `buildEmailVerificationStatus`). Prefer these over guessing at `username` client-side.
- **The gate is email-only.** `requiresEmailVerification(authUser, profile)` (client) / `hasVerifiedEmailClaim(req)` (server). A missing phone **never** blocks an action — phone is collected at registration and verified optionally from the profile. Admins are exempt from the gate.
- `hasVerifiedEmail` requires **both** Firebase `emailVerified` **and** the DB mirror (`is_verified`), so protected state cannot get ahead of the server sync. `hasCompleteContactVerification` still exists but is **no longer a gate** — only for completeness reporting.
- Server error code for the gate: `EMAIL_VERIFICATION_REQUIRED` (replaced `CONTACT_VERIFICATION_REQUIRED`). Apply/tour routes additionally return `EMAIL_NOT_VERIFIED`.
- **Branded verification links are server-owned**: `POST /api/user/email/verification/start` → `/email-verify?token=…` → `POST …/confirm`. Reason: Firebase Admin's `generateEmailVerificationLink` **requires the email to already be on a Firebase user** (phone-first accounts have none), and client `verifyBeforeUpdateEmail` needs a *recent sign-in* they don't have. Only a SHA-256 digest is stored.
- The confirmed address is only replaced **after** the new one is proven, so an account is never left without a working email. A change in flight is a distinct state (`verified-changing`), not a transient unverified window.
- **Firebase caches `email_verified` in the ID token for up to an hour.** Anything that reads verification status must `reload()` + `getIdToken(true)` first — `fetchEmailVerificationStatus()` does this.
- Email-card state machine lives in `client/src/lib/email-verification-state.ts` (pure, tested) — extend it there rather than adding conditionals to the component.
- Deep-link contract for the email section: `?view=profile&focus=email` (+ `&tab=account` for managers). `focus=email` forces the account tab and is cleared on consume.

## Design tokens (`client/src/index.css`)
- Brand / primary red: `--primary` and `--sidebar-primary` = `hsl(348 85% 59%)`. Use `text-primary` for brand-coloured UI.
- **Gotcha:** `--accent` is `0 0% 100%` (pure white) — identical to `--popover` in *both* light and dark themes. `hover:bg-accent` is therefore invisible. Use `hover:bg-muted` for hover states.
- `--muted` = light grey (light) / dark slate (dark) → safe hover in both themes.

## Icons
- All manager UI icons come from `client/src/components/ui/manager-icons.tsx`, which wraps `@iconify/react`'s `Icon` via the local `managerIcon()` factory.
- **Only the `mdi` collection is bundled** (`addCollection(mdiIcons)`). Do NOT rely on other Iconify collections (`simple-icons:`, `logos:`, `solar:`) — they need an on-demand fetch from the Iconify API, which does **not** resolve in this environment (confirmed: `simple-icons:stripe` rendered nothing). Icons registered explicitly via `addIcon(...)` in `client/src/lib/kitchen-inventory-icons.ts` are fine.
- **Brand marks come from `react-icons/si`** (Simple Icons, bundled locally — no network). The Stripe mark is `import { SiStripe } from "react-icons/si"`, rendered with `text-stripe` (or `text-[#635BFF]`), sized `h-4 w-4` / `h-5 w-5`. Established usages: `chef/dashboard/OverviewTabContent.tsx`, `chef/seller-revenue/ChefSellerRevenue.tsx`, `chef/ChefSellerAccount.tsx`, `home/ChefServiceIllustration.tsx`. Do NOT use `client/public/stripe-logo.png` for an icon — that asset is the full **wordmark**, not the "S".
- Brand colours: `stripe: { DEFAULT: "#635BFF" }` is a Tailwind token in `tailwind.config.ts` (→ `text-stripe`), and `client/src/lib/stripe-brand.ts` exports `STRIPE_BRAND_COLOR` + `stripeLinkClassName`. Reuse those instead of hardcoding blurple.
- `vite.config.ts` sets `root: client/` with no `publicDir` override, so `client/public/*` is served at the site root (`/stripe-logo.png`). The repo-root `public/` folder is NOT the Vite publicDir.

## i18n
- Manager strings: `mt(key)` from `client/src/i18n/manager.ts`, namespace `manager`. Chef strings use `useTranslation("chef")`.
- Locales live in `shared/i18n/locales/{en-CA,fr-CA,uk}/<ns>.json`. **All three must stay in key parity** — add new keys to all of them.
- `npm run i18n:lint` flags missing / empty / hardcoded strings.
- `client/src/i18n/locales.test.ts` parses every message containing `{` with `@formatjs/icu-messageformat-parser` and forbids `{{...}}`. Use single braces: `{completed} of {total} complete`.

## Manager dashboard navigation
- `ManagerBookingDashboard.tsx` owns `activeView: ViewType` and `handleViewChange()`, which pushes `?view=` into history and guards unsaved availability edits. Prefer routing through it over raw `history.pushState`.
- `client/src/components/app-sidebar.tsx` holds `navData` plus `SETUP_STEP_VIEWS` (onboarding step id → manager view) used by the sidebar "Getting started" popover.
- Onboarding step definitions + completion logic live in `client/src/hooks/use-onboarding-status.ts`.

## Booking Policies (manager portal) — formerly "Booking Rules"
- **The page is called "Booking Policies" in the UI.** The internal view key is still `settings-booking-rules` and the tab param is still `?tab=booking-rules` — deliberately, so deep links keep working. The i18n **key names** also still say `navBookingRules` etc.; only the string **values** were renamed. Don't "fix" the key names without checking deep links.
- Component: `client/src/components/manager/settings/BookingRulesSettings.tsx` (file name intentionally unchanged). Exposes `BookingPoliciesHandle.saveAllChanges()` for the unsaved-changes guard.
- Saves via `onSave` → `PUT /api/manager/locations/:id/cancellation-policy` (field-whitelisted). The save button only renders while dirty (`showSaveAction`).
- Guard wiring lives in `ManagerBookingDashboard.tsx`: `bookingPoliciesDirty` / `pendingBookingPoliciesView` / `bypassBookingPoliciesGuard` / `bookingPoliciesRef`, mirroring the pre-existing availability guard.
- Admin-side `LocationDetailSheet.tsx` still says "Booking Rules" (out of scope by request).

## Kitchen Terms & Conditions (manager portal)
- Lives in the Booking Policies page (same component as above), moved there from `FacilityDocsSettings.tsx`. Do not re-add it to Facility Documents.
- Two-state card: no document → dropzone; document → file block (filename + "Uploaded:" date + View Document) with a "Replace" button in the card header that re-opens the dropzone.
- Upload is self-contained: `POST /api/files/upload-file` → `PUT /api/manager/locations/:id` with `{kitchenTermsUrl}`. It deliberately does **not** use `onSave`/`updateLocationSettings`, because `PUT /api/manager/locations/:id/cancellation-policy` whitelists fields and excludes `kitchenTermsUrl`.
- `GET /api/manager/locations` (`server/routes/manager.ts` ~6506) returns `kitchenTermsUrl` + `kitchenTermsUploadedAt`; both the Booking Policies and Facility Documents views get the same `locationDetails || selectedLocation` object.
- `AuthenticatedDocumentLink` (presigned-URL anchor) now lives in `client/src/components/manager/settings/AuthenticatedDocumentLink.tsx`. Three older duplicate copies still exist in `DocumentUpload.tsx`, `ManagerBookingDashboard.tsx`, `KitchenApplicationForm.tsx` — prefer importing the shared one for new code.
- `getDocumentFilename()` lives in `client/src/lib/formatters.ts`.

## Manager settings UI conventions
- House layout for a settings page: `ChefPageHeader` (optionally a dirty `Badge` in `actions`) + cards, with a `StatusButton` for saves. See `CheckinCheckoutSettings` / `StorageCheckinCheckoutSettings`.
- `StatusButton` (from `useStatusButton`) **swallows thrown errors** — re-throw after toasting if you want the error state to show. It also animates text per character, so its accessible name may lose spaces in tests.
- **Do NOT use `client/src/components/ui/field.tsx`** (`Field`/`FieldGroup`/`FieldLabel`) — it is referenced nowhere and is written in **Tailwind v4** syntax (`@md/field-group:`, `has-data-checked:`, `data-[slot=…]`) while this project is on **Tailwind v3.4.17**, so those classes are inert.
- One label per setting. A group title on the left *and* a field label above the control is the duplication that made the old Booking Rules page feel cluttered.

## Dead code — do not be fooled
- `SettingsView` in `ManagerBookingDashboard.tsx` (~1549) and `LocationSettingsView.tsx` in `components/manager/locations/` both contain their own booking-rules / kitchen-terms UI but are **never rendered**. The live paths are `BookingRulesSettings` + `FacilityDocsSettings`.
- `client/src/components/chef/ChefOverview.tsx` is **never imported or rendered**. It holds a second copy of the time-of-day greeting using the `overviewGoodMorning` / `overviewGoodAfternoon` / `overviewGoodEvening` keys — and those same `overview*` keys are duplicated across **both** `chef.json` and `kitchen.json`. The live chef greeting is `components/chef/dashboard/OverviewTabContent.tsx` (via `ApplicantDashboard`), which uses the `ovGood*` keys.

## Greeting conventions
- Person's name always comes from `user.displayName` (sidebar, manager overview greeting, chef greeting). The legacy `fullName` field is unused by the UI.
- **Both** dashboard overviews now greet by **time of day** + name, with the same boundaries: `< 12` morning, `< 17` afternoon, else evening.
  - Manager: `KitchenDashboardOverview.tsx` — `GREETING_KEYS` + `getTimeOfDay()` at module scope, keys `goodMorning` / `goodAfternoon` / `goodEvening` + `greetingNamed` (`"{greeting}, {name}"`) in the **manager** namespace.
  - Chef: `components/chef/dashboard/OverviewTabContent.tsx` — inline `getGreeting()`, keys `ovGoodMorning` / `ovGoodAfternoon` / `ovGoodEvening` in the **chef** namespace (plus a hardcoded `", " + firstName`).
  - The two are separate implementations with the same boundaries. If the boundaries ever change, update **both** (grep `getHours()`).
- Manager overview subtitle carries the **location** name (`heresWhatsHappeningWith`); chef subtitle is dynamic status copy.
- `welcomeBack` / `welcomeBackNamed` in the manager namespace are now **unused** (kept in the locale files).
- "Now" is always the **device's** local time — `getNowInTimezone()` intentionally returns `new Date()`. Only booking date/time math is timezone-converted. The greeting has no timer, so it only refreshes on re-render.

## Tooling notes
- `graphify-out/` holds the knowledge graph; per `.cursor/rules/graphify.mdc`, run `graphify query|path|explain` before grepping, and `graphify update .` after code changes. (`graphify update .` can get killed by resource limits on this machine — retry in the background.)
- Test suite is slow (~2 min for the ICU locale test); do not run `tsc --noEmit` and `vitest` concurrently — vitest workers time out. `tsc --noEmit` alone takes ~4–5.5 min here. `tsconfig.json` sets `incremental: true` with `tsBuildInfoFile: ./node_modules/typescript/tsbuildinfo` — a repeat run can finish in seconds off the cache, so delete that file to force a genuine full check.
- **`npx <tool>` rewrites `package-lock.json`** (npm normalizes `"peer": true` markers) — check `git status` afterwards and revert if you didn't mean to touch it.
- **`npm run dev` can fail at route registration with `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`** when Vite re-optimizes deps after a lockfile change: it tries to `rm -rf node_modules/.vite/deps` (~270 files, over the 50-file guard). Fix: `mv node_modules/.vite node_modules/.vite.stale-<ts>` then start the server; Vite builds a fresh cache and boots. Dev server port is **5001** in development (`server/index.ts` ~132).
- `npx eslint` currently fails environment-wide before loading the config (`zod-validation-error` does not export `./v4`) — pre-existing, not a symptom of your change.
- Pre-existing `i18n:lint` failures: `rcOverstayPenalty` missing in fr/uk `kitchen.json`, `howPayoutsWorkServiceFeeNote` empty (`" "`) in fr/uk `manager.json`, `phoneVerificationRequired` missing. All were already failing before this work.

