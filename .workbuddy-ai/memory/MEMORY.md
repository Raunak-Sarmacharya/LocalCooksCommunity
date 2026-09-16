# LocalCooksCommunity — project notes

## Identity & verification (email is the primary identifier)
- **`users` has no `email` column** — `users.username` **is** the confirmed email (NOT NULL UNIQUE). `GET /api/user/profile` returns `email`, `emailVerified`, `emailVerifiedAt`, `pendingEmail`, `pendingEmailSentAt`, `pendingEmailExpiresAt`, `resendAvailableInSeconds` (`server/email-verification.ts`). Use these; don't guess from `username`.
- **Gate is email-only**: `requiresEmailVerification()` (client) / `hasVerifiedEmailClaim(req)` (server). Missing phone never blocks; admins exempt. Code `EMAIL_VERIFICATION_REQUIRED` (apply/tour also `EMAIL_NOT_VERIFIED`). `hasVerifiedEmail` needs **both** Firebase `emailVerified` **and** DB `is_verified`.
- **Branded verification links are server-owned**: `POST /api/user/email/verification/start` → `/email-verify?token=…` → `POST …/confirm` — Firebase Admin's link generator needs the email already on a Firebase user (phone-first accounts have none), and client `verifyBeforeUpdateEmail` needs a recent sign-in. Only a SHA-256 digest is stored. The confirmed address is replaced only **after** the new one is proven (in-flight state = `verified-changing`).
- **Firebase caches `email_verified` in the ID token up to an hour** — `reload()` + `getIdToken(true)` first (`fetchEmailVerificationStatus()` does this).
- State machine `client/src/lib/email-verification-state.ts` (pure, tested). Deep link `?view=profile&focus=email` (+ `&tab=account` for managers).

## Auth / registration
- Only three methods: email verification, Google, phone OTP. No user-chosen password at signup. Email path: `adminAuth.createUser({ email, password, emailVerified })` with a server-generated placeholder password, then `accounts:signInWithPassword` — **its `signInProvider` is `"password"`, NOT `"emailLink"`**.
- `POST /api/user/sync-password` (`server/routes/user.ts` ~176) mirrors a chosen password into Neon (non-blocking).
- Password tab: `components/auth/ChangePassword.tsx` + `password-form-mode.ts` → `resolvePasswordFormMode()` → `loading | change | set-link | set-update`, rendered in `ChefProfileSettings`, `ManagerProfile`, `ManagerProfileSettings`, `Admin`. **Known bug:** it only special-cases `signInProvider === "emailLink"`, so email-verification/phone users wrongly get `change`. `ManagerChangePassword.tsx` is separate, not wired to the helper.

## Design tokens (`client/src/index.css`)
- Brand red `--primary` / `--sidebar-primary` = `hsl(348 85% 59%)`.
- **Gotcha:** `--accent` is pure white, same as `--popover` → `hover:bg-accent` invisible. Use `hover:bg-muted`.
- **`Button` globally applies `chefPrimaryCtaClass`/`chefOutlineCtaClass`** (`lib/chef-cta.ts`) to `default`/`outline`: pill + layered shadow + red glow + `hover:-translate-y-0.5` (kitchen-preview marketing CTA). `button.tsx` renders `cn(buttonVariants(...), ctaClass, className)` — **`className` is last so it can cancel the CTA** (`rounded-lg shadow-none hover:shadow-none hover:translate-y-0`). In dashboard chrome prefer `variant="ghost"`, and override its invisible `hover:bg-accent` with `hover:bg-muted`.
- **`index.css` (~line 700) forces `min-height: 44px` on EVERY `<button>`**, unlayered and at all widths, and `min-height/min-width: 44px` again under 480px. Specificity (0,3,1) — it out-specifies a plain utility and the built CSS has **no `@layer` wrappers**, so `min-h-0` will NOT win. Any small icon button (`w-8 h-8 rounded-full`) renders as a **32×44 oval** unless you reset it with `!min-h-0 !min-w-0` (Tailwind **v3** uses the `!` **prefix**). `switch.tsx` uses an inline `minHeight` for the same reason. **`dialog.tsx`'s close button still has this bug** (unfixed).

## Icons
- Manager icons: `components/ui/manager-icons.tsx` wraps `@iconify/react` `Icon`. **Only `mdi` is bundled** — other collections need a network fetch that fails here.
- Brand marks from `react-icons/si` (bundled). Stripe = `SiStripe`. Do NOT use `client/public/stripe-logo.png` (wordmark).
- `vite.config.ts` root is `client/` → `client/public/*` served at site root. Repo-root `public/` is NOT the publicDir.

## i18n
- Manager `mt(key)` (`client/src/i18n/manager.ts`); chef `useTranslation("chef")`; shared `tt(key)` (`i18n/common-ns`) for common keys like `notAuthenticated`, `failedToUpdateGeneric`.
- Locales `shared/i18n/locales/{en-CA,fr-CA,uk}/<ns>.json` — **all three must stay in key parity**. ICU single braces `{count}`, never `{{...}}`; `client/src/i18n/locales.test.ts` parses every message containing `{`.
- `npm run i18n:lint` — **18 pre-existing issues, not yours**: fr/uk missing `chooseTermsAndConditions`, `replace`, `bookingPoliciesUnsavedChangesDescription`, `goodMorning|goodAfternoon|goodEvening`, `greetingNamed`; fr/uk empty `howPayoutsWorkServiceFeeNote`; en-CA missing used `notAuthenticated`, `failedToUpdateProfile` (the last two are linter quirks — they live in `common.json`). Also `rcOverstayPenalty` (fr/uk kitchen).

## Manager dashboard navigation
- `ManagerBookingDashboard.tsx` owns `activeView` + `handleViewChange()` (pushes `?view=`). `app-sidebar.tsx` holds `navData` + `SETUP_STEP_VIEWS`. Onboarding: `use-onboarding-status.ts`.
- **My Kitchens** = sidebar `navSpaces` ("My Kitchens") → view key `kitchens`. Tabs are URL-driven by `?section=` via `lib/manager-kitchens-navigation.ts`; `DEFAULT_KITCHEN_SECTION` must match the first tab. Legacy `?view=pricing|equipment-listings|storage-listings` map onto the same sections.

## My Kitchens page (`manager/settings/KitchensManagement.tsx`)
- Tab order **Details & Pricing → Photos → Storage → Equipment**; keep `TabsTrigger` and `TabsContent` source order in sync.
- Kitchen switcher = `DropdownMenu` in the page header, rendered whenever ≥1 kitchen exists. It is the **only** place a lone kitchen's name appears, and it owns "Add kitchen".
  **`modal={false}` is required** — Radix menus are modal by default and `@radix-ui/react-menu` then sets `disableOutsideScroll: true`, wrapping the menu in `react-remove-scroll` so `<body>` gets `overflow: hidden` and the page scrollbar vanishes while open. Non-modal keeps dismissal/Escape/keyboard nav (they come from `DismissableLayer`/`RovingFocusGroup`).
- Tabs are an **underline bar, not a segmented control** (`TAB_TRIGGER`/`TAB_ICON` override the shared `Tabs` primitive). Padding must stay **symmetric** — tailwind-merge only lets a later `py-*` cancel the primitive's `py-1.5`, so `pb-3 pt-1` leaves both rules live and CSS source order wins. Always check `cn(base, override)` output.
- Add-kitchen dialog: `CurrencyInput` for the rate, `DialogFooter` cancel-then-create, submit gated on `newKitchenIncomplete` (parsed rate > 0) — testing the raw string lets `"abc"` through to a server 400.
- **Details & Pricing tab lives in `settings/KitchenDetailsPricing.tsx`** (forwardRef, `saveAllChanges`, reports dirty up). Three cards: Details (name + description + smart lock), Pricing, Danger zone. `KitchenPricingContent` is restyled to the row pattern and rendered *by that child*. `StorageListingContent`/`EquipmentListingContent` are untouched embedded bodies.
- **Save model: one page-level Save** in `ChefPageHeader`, rendered only while dirty (`showSaveAction = kitchensDirty || saveAction.status !== "idle"`). The smart-lock `Switch` saves on change instead — booleans don't batch.
- `KitchensManagement` takes `saveRef` (plain `Ref<KitchensHandle>` prop + `useImperativeHandle`) instead of `forwardRef`, to avoid a 630-line re-indent of a file that already suffers silent-edit failures. Shell wiring mirrors Booking Policies: `kitchensSaveRef` / `bypassKitchensGuard` / `kitchensDirty` / `pendingKitchensView`.
- **Tab and kitchen switches are also guarded** — Radix unmounts inactive `TabsContent`, so switching tabs destroys the form state. Dirty is masked as `activeSection === DEFAULT_KITCHEN_SECTION && detailsDirty` so a stale flag can't survive a tab switch.
- Currency is **CAD only** (`CURRENCY` constant in `KitchenPricingManagement.tsx`); the CAD/USD/EUR `Select` is gone. All kitchens were already CAD — no migration needed.

## Kitchen data model & delete
- **`kitchen_bookings.kitchen_id` is the ONLY FK to `kitchens` that is `ON DELETE NO ACTION`**; all 11 siblings cascade. So a plain `DELETE FROM kitchens` **aborts for any kitchen that has ever been booked** → 500 → manager saw only "Failed to delete kitchen". `KitchenRepository.delete` now deletes `kitchenBookings` then the kitchen inside a `db.transaction` — one choke point fixing both the manager route and `server/routes/admin.ts:1857`. No schema change needed.
- Deleting bookings cascades to `access_code_audit`/`storage_bookings`/`equipment_bookings` (and their children). `damage_claims` is `SET NULL` for both booking FKs, so claims survive delinked.
- **Two different "minimum" settings — do not merge:** `kitchens.minimum_booking_hours` = per-kitchen booking *duration* (`PUT /kitchens/:id/pricing`, in the pricing card); `locations.minimum_booking_window_hours` = per-location advance-notice *window* (`PUT /locations/:id/cancellation-policy`, in Booking Policies). Server cross-validates that a kitchen's minimum duration cannot exceed the location's `defaultDailyBookingLimit`.
- `GET /manager/kitchens/:kitchenId/delete-impact` → `{ bookings: n }` drives the delete dialog's precise warning. Two segments after `/kitchens`, so no conflict with `GET /kitchens/:locationId`.
- `putKitchenDetails` accepts `name` (always did — the UI never exposed it) and now validates it (non-empty after trim, ≤120 chars); before, an empty rename would have blanked the kitchen.

## Shared settings row primitive
- `settings/SettingsRow.tsx` exports `SettingsRow` + `RowHelp` (the ⓘ popover). `layout` = `inline` (label left, control right, sized to content) or `stacked` (label above, control below, for textareas). Extracted out of `BookingRulesSettings.tsx`; use it for new settings rows rather than hand-rolling `divide-y` rows.

## Booking Policies (was "Booking Rules")
- UI says **Booking Policies**; view key stays `settings-booking-rules`, tab param `?tab=booking-rules`, i18n **key names** unchanged — deep links depend on them. Don't rename.
- `settings/BookingRulesSettings.tsx` (filename unchanged) exposes `saveAllChanges()`. Saves via `PUT /api/manager/locations/:id/cancellation-policy`. Save button renders only when dirty.
- Kitchen Terms & Conditions lives here too. Upload `POST /api/files/upload-file` → `PUT /api/manager/locations/:id` `{kitchenTermsUrl}` (self-contained; the cancellation-policy endpoint field-whitelists and excludes it).
- `AuthenticatedDocumentLink` → `manager/settings/AuthenticatedDocumentLink.tsx` (3 older dupes remain). `getDocumentFilename()` in `client/src/lib/formatters.ts`.

## Manager settings UI conventions
- Layout: `ChefPageHeader` + cards + `StatusButton`. `StatusButton` **swallows thrown errors** — re-throw after toasting. `useStatusButton(fn)` shows success when `fn` resolves, so a saver that returns `false` instead of throwing will falsely show success.
- **Never use `components/ui/field.tsx`** — Tailwind v4 syntax, project is v3.4.17, inert.
- One label per setting (no group title + field label).

## Contact information UI (profile → Account details)
- `components/profile/ContactVerificationRow.tsx` exports `ContactInfoCard` (divided list), `ContactVerificationRow`, `ContactStatusPill`, type `ContactTone` (`verified | action | pending | empty`). `EmailVerificationCard.tsx` + `PhoneSignInSettings.tsx` both render through it; both take `embedded?: boolean`.
- **Email and phone are always siblings in one `ContactInfoCard`**, never in the profile field grid. Editing expands inline; the row's shape never changes.
- **Three-line structure is fixed**: `value` → `secondary` (one-line status) → `description`. No state may omit `secondary` (use "Verified"/"Link sent"/"Not added"/"Not verified"/"Change pending"/"Code sent").
- Verified icon is the **same on both rows**: `Check` from lucide — not `CheckCircle2` for phone (draws a second circle, breaks the match). `Mail`/`Phone` only for unverified/empty; `Clock` for pending.
- Phone flows: linked → `verified`; `confirmation` → `pending`; local `isAdding` → phone input + SMS consent; else `empty`.
- Three hosts must stay in sync: `ChefProfileSettings.tsx`, `ManagerProfileSettings.tsx`, `pages/ManagerProfile.tsx` (legacy, still live at `/manager/profile`). `Section` in `ChefProfileSettings.tsx` has `flush` (no body padding + `overflow-hidden`).

## Dead code
- `SettingsView` (~1549 in `ManagerBookingDashboard.tsx`) and `LocationSettingsView.tsx` hold booking-rules UI that is **never rendered**.
- `chef/ChefOverview.tsx` never rendered; its `overview*` keys are duplicated in `chef.json` and `kitchen.json`. Live greeting: `chef/dashboard/OverviewTabContent.tsx` (`ovGood*`).
- `KitchenPricingManagement.tsx`'s **default export** (wraps `KitchenPricingContent` in `ManagerPageLayout`) is imported nowhere — only the named `KitchenPricingContent` is used.

## Greetings
- Name always `user.displayName` (legacy `fullName` unused). `welcomeBack*` (manager) unused. "Now" = device local time; no timer, so the greeting only refreshes on re-render.
- Time-of-day boundaries duplicated in **two** places: `KitchenDashboardOverview.tsx` (`goodMorning`, manager ns) and `chef/dashboard/OverviewTabContent.tsx` (`ovGood*`, chef ns). Update both (grep `getHours()`).

## Tooling
- **The database is Supabase** (`aws-1-ca-central-1.pooler.supabase.com:6543`) via `DATABASE_URL` in `.env`. There is **no Supabase MCP tool** here — for schema/FK/data questions run a throwaway Node script with `dotenv` + `pg` (both installed), do **read-only** `information_schema`/`pg_constraint` queries, then delete the script. The Drizzle schema alone is not authoritative (`kitchen_bookings` predates `migrations/`).
- **Migrations are NOT applied automatically** (no migrate step in `vercel-build.mjs`/`server/index.ts`; run by hand or via `db:apply-*`). Adding a `migrations/*.sql` file alone changes nothing at runtime — prefer fixing behaviour in code, or apply deliberately.
- **`npx vitest run` baseline: 8 failed / 1352 passed, all pre-existing.** 13 `client/src/lib/*.test.ts` files are **script-style** tests (they `console.log("ok")` and exit) so vitest says "No test suite found"; `SellerApplication.test.tsx` fails 7 (imports only `chef.json`); `BookingRulesSettings.test.tsx` fails 1 because `getByLabelText("cancellationWindow")` matches both the `<Label>` and the help button's `aria-label` (predates the `SettingsRow` extraction). To attribute a failure, revert **just** the suspect file (`cp` aside → `git checkout HEAD -- <file>` → run → copy back) — never `git stash`.
- `graphify-out/` = knowledge graph (`graphify query|path|explain` per `.cursor/rules/graphify.mdc`). **graphify is NOT on PATH**; ponytail is only a `.cursor/rules` persona rule.
- Tests slow (~2 min). Don't run `tsc --noEmit` (~4–5.5 min) and vitest together.
- **Never run `tsc` / `npm run build`** (build = `tsc -b && vite build`). User forbade it. Syntax + import check with esbuild instead — **must pass `--bundle` to validate `@/` paths** (`--bundle=false` only parses one file and silently accepts a bad import):
  `./node_modules/.bin/esbuild <files> --bundle --packages=external --alias:@=./client/src --alias:@shared=./shared --alias:@assets=./attached_assets --loader:.tsx=tsx --loader:.ts=ts --jsx=automatic '--external:*.css' --outdir=/tmp/x`
  Quote the `--external:` globs or zsh errors. `import.meta` warnings under iife output are expected noise.
- **`npx <tool>` rewrites `package-lock.json`** — check `git status`, revert if unintended.
- `npm run dev` can fail with `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` after a lockfile change. Fix: `mv node_modules/.vite node_modules/.vite.stale-<ts>`. Dev port **5001**.
- `npx eslint` fails environment-wide (`zod-validation-error` has no `./v4`) — pre-existing.
- **Two tsconfigs**: `tsconfig.json` (noEmit, client+server+shared) and `tsconfig.server.json` (outDir `dist`, server+shared, does **not** exclude `*.test.ts`). Check both. Always `rm -f node_modules/typescript/tsbuildinfo` first — `incremental: true` + stale `tsBuildInfoFile` silently hides errors.
- **The Edit tool silently no-ops on this repo's files under lock races** (`EBUSY`, IDE has the file open) while still reporting success. On `KitchensManagement.tsx` this happened repeatedly. **Always re-read or grep the anchor back after an edit.**

## Deployment
- **Vercel** (`vercel.json`, `vercel-build.mjs`). Hosts `localcooks.ca`, `chef.localcooks.ca`, `kitchen.localcooks.ca`, `admin.localcooks.ca` + `dev-*` variants — all live. Firebase Hosting site `formauth-9e620` is not the app.

## Working style
- Worktree is usually **dirty** — always `git status` before editing; finish prior work first.
- User prefers: no assumptions; stop and ask when a fact is unverified; "top developer" UI quality with a minimal diff.
- **Verify against the published app, never the local dev server.** After any UI change, open the published app, click the affected screen, confirm, then edit local files. A page behind auth (manager/chef) **cannot** be verified locally — say so plainly instead of claiming it works.
- **UNRESOLVED contradiction:** this file says both "never run `tsc`" (Tooling) and "clean `tsc --noEmit` (both configs) is the bar for done". The user was asked and hasn't answered. Until they do, respect the prohibition and treat `esbuild --bundle` + focused vitest files as the bar — but that means **type errors are not caught**. When a change involves refs, generics or type-only imports, review those spots by hand and state plainly that `tsc` was not run.
