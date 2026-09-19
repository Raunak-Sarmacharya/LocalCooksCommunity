import type { AuthAccountState, AuthMethod } from "@shared/auth-resolution";

export function resolveAuthAccountState(firebaseUid: string | null, neonFirebaseUid: string | null): AuthAccountState {
  if (!firebaseUid && !neonFirebaseUid) return "new";
  if (firebaseUid && neonFirebaseUid === firebaseUid) return "existing";
  if (firebaseUid && !neonFirebaseUid) return "profile-incomplete";
  return "identity-conflict";
}

/**
 * Account state for a PHONE identifier.
 *
 * Deliberately not `resolveAuthAccountState`. That function asks "does the
 * Firebase identity I just found have a profile?", which is the wrong question
 * here: no phone in this project is a Firebase credential (verified 2026-09-18 —
 * 175 Firebase users, zero with a `phoneNumber`), so `getUserByPhoneNumber` never
 * matches and a Firebase-first answer would call every registered number "new" —
 * which is exactly how a chef's number reached the signup form.
 *
 * The database row is therefore decisive, and a row with no `firebase_uid` still
 * means the number belongs to an account. Passing a database uid through
 * `resolveAuthAccountState` would have reported that legacy shape as "new" and
 * offered a second registration for a number that is already taken.
 */
export function resolvePhoneAccountState(input: {
  databaseAccount: { firebaseUid: string | null } | null;
  firebaseUid: string | null;
}): AuthAccountState {
  const { databaseAccount, firebaseUid } = input;
  if (databaseAccount) {
    // A Firebase identity holding this number that maps to a DIFFERENT account
    // is a genuine conflict. Anything else means the number belongs to this
    // account, whether or not it is linked to Firebase.
    return firebaseUid && databaseAccount.firebaseUid && firebaseUid !== databaseAccount.firebaseUid
      ? "identity-conflict"
      : "existing";
  }
  return firebaseUid ? "profile-incomplete" : "new";
}

export function resolveAuthMethods(input: {
  email?: string | null;
  phoneNumber?: string | null;
  providerIds?: string[];
  /**
   * Neon `password_set_by_user`. Registration still links a Firebase password
   * provider with a generated secret — only offer password sign-in when the
   * account holder actually chose that secret. Required so callers cannot
   * silently omit it and treat placeholder passwords as real.
   */
  passwordSetByUser: boolean | null;
}): AuthMethod[] {
  const providers = new Set(input.providerIds || []);
  const methods: AuthMethod[] = [];
  if (input.email) methods.push("email-link");
  if (providers.has("password") && input.passwordSetByUser === true) methods.push("password");
  if (input.phoneNumber || providers.has("phone")) methods.push("phone");
  if (providers.has("google.com")) methods.push("google");
  return methods;
}

export function maskRecoveryEmail(email?: string | null): string | null {
  if (!email) return null;
  return email.replace(/^(.{1,2}).*(@.*)$/, (_match, start, domain) => `${start}***${domain}`);
}

/**
 * Whether the account's email is confirmed, or `null` when it cannot be judged.
 *
 * Mirrors the client's `hasVerifiedEmail`: Firebase owns the address and the
 * database flag confirms the server-side sync has caught up, so BOTH must agree.
 * Judging on either alone would let the resolution call an account verified while
 * the platform gate still blocks it — walking the visitor into a sign-in flow
 * that dead-ends at a wall.
 *
 * Only `existing` is judged. `profile-incomplete` means the Firebase identity has
 * no LocalCooks profile: a half-finished registration, not an unconfirmed
 * address, and it has its own recovery route. Reporting it as unverified would
 * divert it into a verification email with no account to attach to.
 *
 * `null` is deliberately distinct from `false` — see `AuthAccountResolution`.
 */
export function resolveEmailVerified(input: {
  state: AuthAccountState;
  firebaseEmailVerified?: boolean | null;
  neonIsVerified?: boolean | null;
}): boolean | null {
  if (input.state !== "existing") return null;
  return input.firebaseEmailVerified === true && input.neonIsVerified === true;
}

export function maskRecoveryPhone(phone?: string | null): string | null {
  const digits = phone?.replace(/\D/g, "") || "";
  return digits ? `••• ••• ${digits.slice(-4)}` : null;
}

/** Portals that ask the resolver to pre-check portal authority. */
export type AuthPortal = "manager" | "chef";

/**
 * Whether an account may use the portal that asked, or `null` when the question
 * cannot be answered (no portal named, or no account found).
 *
 * Why this is worth a round trip. The portal check used to run only AFTER
 * authentication (`ManagerLogin.finishAuthentication`). For email that is fine —
 * a password or Google sign-in is instant and sends nothing. For PHONE it is not:
 * the check would happen after we had already sent a real SMS to a real person
 * and minted a Firebase identity for an account we were about to refuse. Because
 * a phone resolves to its account before any code is sent, the verdict can be
 * reached first, so the refusal costs nothing.
 *
 * Only `manager` has a rule today. Any other portal returns `null`, so its
 * existing post-authentication check keeps working unchanged.
 */
export function resolvePortalAllowed(input: {
  portal: AuthPortal | null;
  account: { role?: string | null; isManager?: boolean | null } | null;
}): boolean | null {
  const { portal, account } = input;
  if (!portal || !account) return null;
  if (portal === "manager") {
    // `admin` is allowed deliberately. ManagerLogin's redirect effect sends an
    // admin to /admin rather than refusing them, so treating them as disallowed
    // here would refuse a flow that works today.
    return account.role === "manager" || account.isManager === true || account.role === "admin";
  }
  return null;
}
