# First-class phone authentication: integration assessment

## Decision

Local Cooks should support phone numbers as a first-class Firebase registration and sign-in method, alongside email/password, email link, and Google.

The public action should be **Continue with phone** because Firebase phone authentication is deliberately both sign-in and sign-up:

1. collect the phone and obtain authentication-SMS consent;
2. complete reCAPTCHA and confirm the OTP;
3. existing application UID: load its Neon profile and sign in;
4. unprovisioned UID: collect the required email, profile, role, and terms;
5. use `verifyBeforeUpdateEmail` so Firebase attaches the email only after its link is redeemed;
6. provision the Neon user only when the token contains both `phone_number` and `email_verified=true`.

An unknown phone must no longer be blocked, but a phone-only Firebase identity is an incomplete registration—not a Local Cooks user. Both the phone and email must be verified before backend provisioning.

## Existing phone collection

`EnhancedRegisterForm` already requires and normalizes a phone number. The number is currently placed in `cleanData` and persisted to `pendingRegistrationData` only when `isApplying`; the `signup(...)` contract does not receive it and the base `users` table has no phone identity column. An account-only registration therefore collects a phone without retaining or verifying it as account identity.

Google users may supply a phone during seller application or request-to-apply. That remains business/contact data until the user separately consents to an authentication SMS and completes the OTP.

Keep these concepts distinct even when values initially match:

- authentication phone: OTP-verified Firebase identity;
- contact phone: marketplace/seller operations;
- notification phone: consented destination for operational messages.

Changing a contact or notification number must never silently relink the authentication provider.

## Registration and identity model

The current data model assumes every Firebase identity has an email:

- `users.username` is non-null and unique;
- `/api/firebase-register-user` rejects tokens without `decodedToken.email`;
- welcome/admin emails and several display-name fallbacks assume `username` contains `@`;
- `syncFirebaseUserToNeon` throws when email is missing.

Do not generate fake emails or place an E.164 number into an email-shaped `username`. Local Cooks requires both identities for phone registrations. During the staged rollout, legacy email/Google accounts may have a null authentication phone until they explicitly link one:

```text
users
  id
  firebase_uid unique not null
  role and authorization flags
  display/profile fields
  primary_email unique not null
  phone_number nullable  # contact data only

Firebase Auth
  uid                         # sole cross-system identity key
  providers: password/google/phone
  phone_number                # authentication identity, Firebase-authoritative
```

Keep `username` as the canonical application email and do not duplicate Firebase's provider registry in Neon. The legacy `auth_phone_number` mirror is deprecated and unused for account lookup. A dedicated `user_identities` table is justified only if Local Cooks later supports a non-Firebase identity provider; Firebase already owns provider-to-UID linkage and phone uniqueness today.

Authentication and authorization remain separate: a valid Firebase phone UID is not an application account until the Neon provisioning transaction records role and terms.

## Exact UI placement

### 1. Main registration and sign-in

Add **Continue with phone** beside the existing Google and email challenges in `EnhancedLoginForm` and `EnhancedRegisterForm`.

- Login context: an existing number signs in; a new number transitions to the registration-details/terms step before Neon provisioning.
- Registration context: verify the phone first, then reveal the required email/profile fields. Verify the email before provisioning.
- Preserve pending kitchen-tour, booking, and request-to-apply intent through the OTP flow using the existing auth-intent mechanisms.

Use one reusable `PhoneAuthFlow` state machine rather than separate OTP implementations.

### 2. Email registration waiting for verification

On `EmailVerificationScreen`, add **Verify with phone instead** below the primary email action and above resend. Prefill the already-required registration phone.

This is provider linking, not a second account creation:

```text
PhoneAuthProvider.verifyPhoneNumber
  -> PhoneAuthProvider.credential
  -> linkWithCredential(auth.currentUser, credential)
  -> force-refresh token
  -> Firebase keeps the phone provider on the existing UID
```

The existing email-created Firebase user must remain the current user during this flow so the UID is preserved. If the credential belongs to another UID, stop and route to explicit account recovery; never merge automatically in the browser.

### 3. Unverified password sign-in

`use-auth.tsx` currently signs the user out before `EnhancedLoginForm` renders `EmailVerificationScreen`. Keep the just-authenticated user only while the choice is visible, allow the same linking flow, and sign out explicitly on cancel/back. Protected routes remain denied until the trusted backend verification predicate succeeds.

### 4. After sending a magic link

Replace the small `showMagicLinkNudge` success banner with the existing dedicated email-waiting screen in `magic-link` mode. Add **Continue with phone** there.

Unlike the email-registration fallback, this is the unified phone sign-in/sign-up flow. If the number is new, clearly transition to account creation and collect/confirm missing role and terms before backend provisioning. Do not silently create a fully authorized marketplace profile from a login-labelled action.

Do not add the alternative inside `EmailAction.tsx`; once that page has a valid magic link, the email arrived and Firebase is already completing the account-specific operation.

### 5. Google users after seller/request-to-apply phone collection

In `AuthModalProvider.tsx`, after a request-to-apply submission succeeds, offer the skippable action **Use this number for sign-in too**. Prefill and mask the submitted contact number, collect separate authentication-SMS consent, then link the verified credential to the current Google UID.

Also expose add/change/remove phone-provider controls in account security settings. A stored application phone alone must never enable phone sign-in.

## Client implementation

- Add a reusable phone OTP challenge with explicit states: phone, consent, sending, code, confirming, required email/profile, email verification, provisioning, success, error.
- Reuse `shared/phone-validation.ts` and the installed `input-otp` package.
- Own and clear one `RecaptchaVerifier` per mounted flow; reset after expiry or a send failure.
- After `signInWithPhoneNumber`, query the application profile by authenticated UID. A missing Neon row—not `isNewUser` alone—means onboarding must continue because an interrupted Firebase registration may no longer be considered new.
- Use `verifyBeforeUpdateEmail`; do not attach an unverified email or create a generated email/password credential.
- In `link` mode, create a credential from `verificationId` and call `linkWithCredential` on the authenticated user.
- Never persist OTPs, verification IDs, or passwords in localStorage.
- Localize Firebase Auth/SMS language and all consent/error text.
- Map throttling, quota, invalid/expired code, credential collision, reCAPTCHA, network, and provisioning errors without exposing account existence before OTP confirmation.

## Server implementation

- Extend the verified request identity with trusted `phone_number`, `email`, `email_verified`, and Firebase `sign_in_provider` claims.
- Keep email mandatory. When the trusted Firebase `sign_in_provider` is `phone`, require both normalized `phone_number` and `email_verified=true`.
- Validate the request UID against the token and derive identity fields only from the verified token/Admin SDK, never from request JSON.
- Make registration idempotent by Firebase UID and reject cross-UID email collisions; Firebase rejects phone-provider collisions.
- Provision role, flags, terms, and verification provenance in one database transaction.
- Keep Firebase as the only authentication-phone registry. `users.phone_number` remains optional contact data and never selects an account.
- Roll back a newly created Firebase phone user when Neon provisioning fails, and add reconciliation for abandoned/unprovisioned Firebase identities because client rollback cannot be the only guarantee.
- Keep authorization based on the Neon user resolved from `firebase_uid`; never grant role access to an unprovisioned Firebase session.

## Firebase and abuse controls

- Enable the Phone provider and attach Cloud Billing.
- Add all production and preview auth hosts to Authorized domains.
- Use an allowlist-only SMS region policy matching supported markets; the current application validator permits US/Canada `+1`.
- Enable reCAPTCHA Enterprise SMS defense in audit mode, monitor, then enforce.
- Use Firebase fictional phone numbers in automated integration tests; never disable app verification in production.
- Apply product-level resend cooldowns while relying on Firebase/project quotas as the authoritative limit.
- Alert on SMS spend, send failures, throttling, provisioning rollback failures, and Firebase UIDs with no Neon account.

Identity Platform blocking functions are no longer needed to reject new phone users. They remain optional for risk-based `beforeSmsSent` or `beforeUserCreated` policy, and should be added only when a concrete centralized policy requires them.

## Account collisions and linking

- New phone with no matching Firebase identity: create and provision a new account.
- Existing linked phone: sign in to its UID.
- Email account linking a phone owned by another UID: stop and initiate account recovery.
- Phone account later adding an email already owned by another UID: stop and initiate account recovery.
- Never infer that matching contact data means two accounts belong to the same person.
- Any merge must authenticate both identities and run as an audited server-side transaction with data-conflict rules.

## Acceptance criteria

- A new user verifies phone first, is then required to add and verify an email, and receives no application authorization before both checks pass.
- An existing phone user signs into the exact same Firebase UID and Neon row.
- A new UID never receives application authorization until Neon provisioning completes.
- Existing email or Google users can explicitly link a phone from profile settings without changing UID.
- Contact/notification phone edits do not alter authentication identities.
- Duplicate phone/email provider collisions never auto-merge.
- Logs and Sentry redact full phone numbers and never record OTPs.
- Tests cover new phone registration, existing sign-in, role/terms provisioning, retry/idempotency, failed rollback/reconciliation, code expiry, throttling, reCAPTCHA, linking, and collisions.

## Rollout

1. Preserve the existing required-email schema and resolve application accounts only by Firebase UID.
2. Add server phone registration/provisioning and integration tests using fictional numbers.
3. Add the shared client state machine behind a disabled feature flag.
4. Configure billing, Phone provider, Authorized domains, SMS regions, and reCAPTCHA audit mode.
5. Test phone-first registration with mandatory verified email, existing-user phone sign-in, profile linking, and failure compensation end to end.
6. Roll out gradually with spend, abuse, collision, and orphan-identity alerts.

## Primary references

- Firebase phone auth: https://firebase.google.com/docs/auth/web/phone-auth
- Firebase provider linking: https://firebase.google.com/docs/auth/web/account-linking
- Firebase email-link auth: https://firebase.google.com/docs/auth/web/email-link-auth
- Firebase Authentication limits: https://firebase.google.com/docs/auth/limits
- Identity Platform SMS regions: https://cloud.google.com/identity-platform/docs/admin/sms-regions
- Identity Platform reCAPTCHA Enterprise: https://cloud.google.com/identity-platform/docs/recaptcha-enterprise
