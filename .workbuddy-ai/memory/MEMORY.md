# LocalCooksCommunity — project notes

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
