# LocalCooksCommunity — project notes

## Identity & verification (email is the primary identifier)
- **`users` has no `email` column.** `users.username` **is** the confirmed email (NOT NULL UNIQUE), written by `createPublicFirebaseUser({ username: registrationEmail })`.
- `GET /api/user/profile` returns `email`, `emailVerified`, `emailVerifiedAt`, `pendingEmail`, `pendingEmailSentAt`, `pendingEmailExpiresAt`, `resendAvailableInSeconds` (`server/email-verification.ts` → `buildEmailVerificationStatus`). Use these, don't guess from `username`.
- **Gate is email-only.** `requiresEmailVerification()` (client) / `hasVerifiedEmailClaim(req)` (server). Missing phone never blocks. Admins exempt. Error code: `EMAIL_VERIFICATION_REQUIRED` (apply/tour also `EMAIL_NOT_VERIFIED`).
- `hasVerifiedEmail` needs **both** Firebase `emailVerified` **and** DB mirror `is_verified`.
- **Branded verification links are server-owned**: `POST /api/user/email/verification/start` → `/email-verify?token=…` → `POST …/confirm`. Firebase Admin `generateEmailVerificationLink` needs the email already on a Firebase user (phone-first accounts have none); client `verifyBeforeUpdateEmail` needs recent sign-in. Only a SHA-256 digest is stored.
- Confirmed address is replaced only **after** the new one is proven. In-flight change = `verified-changing`.
- **Firebase caches `email_verified` in the ID token up to an hour** — always `reload()` + `getIdToken(true)` first (`fetchEmailVerificationStatus()` does this).
- Email state machine: `client/src/lib/email-verification-state.ts` (pure, tested). Deep link: `?view=profile&focus=email` (+ `&tab=account` for managers).

## Auth / registration
- Only three methods: **email verification**, **Google**, **phone OTP**. No user-chosen password at signup.
- Email-verification path: `adminAuth.createUser({ email, password, emailVerified })` with a **server-generated placeholder password**, then client signs in via `accounts:signInWithPassword` → **its `signInProvider` is `"password"`, NOT `"emailLink"`.**
- `POST /api/user/sync-password` (`server/routes/user.ts` ~176) mirrors a chosen password into Neon (non-blocking, client-side).
- Password tab: `client/src/components/auth/ChangePassword.tsx` + pure helper `password-form-mode.ts` → `resolvePasswordFormMode()` → `loading | change | set-link | set-update`. Rendered in `ChefProfileSettings.tsx`, `ManagerProfile.tsx`, `ManagerProfileSettings.tsx`, `Admin.tsx`. `ManagerChangePassword.tsx` is separate and not wired to the helper.
- **Known bug:** the helper only special-cases `signInProvider === "emailLink"`; email-verification/phone users wrongly get `change` (asks for a password they never set).

## Design tokens (`client/src/index.css`)
- Brand red: `--primary` / `--sidebar-primary` = `hsl(348 85% 59%)`.
- **Gotcha:** `--accent` is pure white, same as `--popover` → `hover:bg-accent` invisible. Use `hover:bg-muted`.

## Icons
- Manager icons: `components/ui/manager-icons.tsx`, wraps `@iconify/react` `Icon`. **Only `mdi` is bundled** — other collections need a network fetch that fails here.
- Brand marks from `react-icons/si` (bundled). Stripe = `SiStripe`. Do NOT use `client/public/stripe-logo.png` (wordmark).
- `vite.config.ts` root is `client/` → `client/public/*` served at site root. Repo-root `public/` is NOT the publicDir.

## i18n
- Manager: `mt(key)` (`client/src/i18n/manager.ts`). Chef: `useTranslation("chef")`.
- Locales: `shared/i18n/locales/{en-CA,fr-CA,uk}/<ns>.json` — **all three must stay in key parity**.
- `npm run i18n:lint`; ICU single braces `{count}`, never `{{...}}`.
- Pre-existing lint failures (not yours): `rcOverstayPenalty` (fr/uk kitchen), `howPayoutsWorkServiceFeeNote` (fr/uk manager), `phoneVerificationRequired`.

## Manager dashboard navigation
- `ManagerBookingDashboard.tsx` owns `activeView` + `handleViewChange()` (pushes `?view=`). `app-sidebar.tsx` holds `navData` + `SETUP_STEP_VIEWS`. Onboarding: `use-onboarding-status.ts`.

## Booking Policies (was "Booking Rules")
- UI says **Booking Policies**; view key stays `settings-booking-rules`, tab param `?tab=booking-rules`, i18n **key names** unchanged — deep links depend on them. Don't rename.
- Component `settings/BookingRulesSettings.tsx` (filename unchanged), exposes `saveAllChanges()`. Saves via `PUT /api/manager/locations/:id/cancellation-policy`. Save button renders only when dirty.
- Kitchen Terms & Conditions lives here too. Upload: `POST /api/files/upload-file` → `PUT /api/manager/locations/:id` `{kitchenTermsUrl}`.
- `AuthenticatedDocumentLink` → `manager/settings/AuthenticatedDocumentLink.tsx` (3 older dupes exist). `getDocumentFilename()` in `client/src/lib/formatters.ts`.

## Manager settings UI conventions
- Layout: `ChefPageHeader` (+ dirty `Badge`) + cards + `StatusButton`. See `CheckinCheckoutSettings`.
- `StatusButton` **swallows thrown errors** — re-throw after toasting.
- **Never use `components/ui/field.tsx`** — Tailwind v4 syntax, project is v3.4.17, inert.
- One label per setting (no group title + field label).

## Dead code
- `SettingsView` (~1549 in `ManagerBookingDashboard.tsx`) and `LocationSettingsView.tsx` hold booking-rules UI that is **never rendered**.
- `chef/ChefOverview.tsx` never rendered; its `overview*` keys are duplicated in `chef.json` and `kitchen.json`. Live greeting: `chef/dashboard/OverviewTabContent.tsx` (`ovGood*`).

## Greetings
- Name always `user.displayName` (legacy `fullName` unused).
- Time-of-day boundaries duplicated in **two** places: `KitchenDashboardOverview.tsx` (`goodMorning`, manager ns) and `chef/dashboard/OverviewTabContent.tsx` (`ovGood*`, chef ns). Update both if changed (grep `getHours()`).
- `welcomeBack*` (manager) unused. "Now" = device local time; no timer.

## Tooling
- `graphify-out/` = knowledge graph (`graphify query|path|explain` per `.cursor/rules/graphify.mdc`). **graphify is NOT on PATH**; ponytail is only a `.cursor/rules` persona rule.
- Tests slow (~2 min). Don't run `tsc --noEmit` (~4–5.5 min) and vitest together.
- **Never run `tsc` / `npm run build`** (build = `tsc -b && vite build`). User forbade it.
  Syntax + import check with esbuild instead — **must pass `--bundle` to validate `@/`
  paths** (`--bundle=false` only parses one file and silently accepts a bad import):
  `./node_modules/.bin/esbuild <files> --bundle --packages=external
  --alias:@=./client/src --alias:@shared=./shared --alias:@assets=./attached_assets
  --loader:.tsx=tsx --loader:.ts=ts --jsx=automatic '--external:*.css' --outdir=/tmp/x`
  Quote the `--external:` globs or zsh errors with "no matches found".
  `import.meta` warnings under iife output are expected noise.
- **`npx <tool>` rewrites `package-lock.json`** — check `git status`, revert if unintended.
- `npm run dev` can fail with `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` after a lockfile change. Fix: `mv node_modules/.vite node_modules/.vite.stale-<ts>`. Dev port **5001**.
- `npx eslint` fails environment-wide (`zod-validation-error` has no `./v4`) — pre-existing.
- **Two tsconfigs**: `tsconfig.json` (noEmit, client+server+shared) and `tsconfig.server.json` (outDir `dist`, server+shared, does **not** exclude `*.test.ts`). Check **both**. Always `rm -f node_modules/typescript/tsbuildinfo` first — `incremental: true` + stale `tsBuildInfoFile` silently hides errors.

## Deployment
- **Vercel** (`vercel.json`, `vercel-build.mjs`). Hosts: `localcooks.ca`, `chef.localcooks.ca`, `kitchen.localcooks.ca`, `admin.localcooks.ca`, plus `dev-*` variants — all live. Firebase Hosting site `formauth-9e620` is not the app.

## Contact information UI (profile → Account details)
- Shared row shell: `client/src/components/profile/ContactVerificationRow.tsx` → exports
  `ContactInfoCard` (divided list), `ContactVerificationRow`, `ContactStatusPill`, type `ContactTone`
  (`verified | action | pending | empty` — drives icon tint, pill colour and row tint).
- `EmailVerificationCard.tsx` and `PhoneSignInSettings.tsx` both render through that row.
  Both take `embedded?: boolean` — `true` = bare row, parent supplies the `ContactInfoCard`.
- Rule: **email and phone are always siblings in one `ContactInfoCard`**, never in the
  profile field grid (that was the old asymmetry: phone `sm:col-span-2`, email 1 column).
- Editing expands inline inside the row (`children`), the row's shape never changes.
- **Three-line structure is fixed**: `value` → `secondary` (one-line status, same
  `text-sm text-muted-foreground`) → `description` (helper copy). Every row in every
  state has the same shape — verified, unverified, pending, empty. No state may omit
  the `secondary` line just because it has nothing extra to say (use the pill word or
  "Verified" / "Link sent" / "Not added" / "Not verified" / "Change pending" / "Code sent").
- Verified icon is the **same on both rows**: `Check` from lucide. Do not use
  `CheckCircle2` for phone — it draws a second circle inside the row's icon badge and
  breaks the visual match. `Mail`/`Phone` only for unverified / empty (type-specific
  identification), `Clock` for pending.
- Phone flows are 4 states: linked → `verified`; `confirmation` → `pending` (code input);
  local `isAdding` → phone input + SMS consent; else `empty` with "Add phone number".
  The reCAPTCHA div only exists while expanded — fine, `sendCode` is only reachable then.
- Three hosts must stay in sync: `ChefProfileSettings.tsx`, `ManagerProfileSettings.tsx`,
  `pages/ManagerProfile.tsx` (legacy orange-gradient page, still live at `/manager/profile`).
- `Section` in `ChefProfileSettings.tsx` gained `flush` (no body padding + `overflow-hidden`)
  so the contact list sits full-bleed inside the section card.

## Working style
- Worktree is usually **dirty** — always `git status` before editing; finish prior work first.
- User prefers: no assumptions; stop and ask when a fact is unverified.
- **Verify against the published app, never the local dev server.** After any UI change, open the published app, click the affected screen, confirm, then edit local files.
- Clean `tsc --noEmit` (both configs) is the bar for "done".
