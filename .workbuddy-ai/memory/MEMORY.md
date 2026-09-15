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

## Tooling notes
- `graphify-out/` holds the knowledge graph; per `.cursor/rules/graphify.mdc`, run `graphify query|path|explain` before grepping, and `graphify update .` after code changes. (`graphify update .` can get killed by resource limits on this machine — retry in the background.)
- Test suite is slow (~2 min for the ICU locale test); do not run `tsc --noEmit` and `vitest` concurrently — vitest workers time out.
