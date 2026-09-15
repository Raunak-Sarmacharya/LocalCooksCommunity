type AuthVerificationUser = {
  emailVerified?: boolean | null;
  phoneVerified?: boolean | null;
} | null | undefined;

type ProfileVerification = {
  is_verified?: boolean | null;
  isVerified?: boolean | null;
  emailVerified?: boolean | null;
  phoneVerified?: boolean | null;
} | null | undefined;

/**
 * Firebase is the authority for ownership of the email address. The database
 * flag is required as well so protected application state cannot get ahead of
 * the server-side verification sync.
 */
export function hasVerifiedEmail(
  authUser: AuthVerificationUser,
  profile: ProfileVerification
): boolean {
  return (
    authUser?.emailVerified === true &&
    (profile?.is_verified === true || profile?.isVerified === true)
  );
}

/** A stored phone number is not proof. Only Firebase's linked phone claim is. */
export function hasVerifiedPhone(
  authUser: AuthVerificationUser,
  profile?: ProfileVerification
): boolean {
  return authUser?.phoneVerified === true || profile?.phoneVerified === true;
}

/** Minimum identity proof required to create and enter an account. */
export function hasVerifiedContact(
  authUser: AuthVerificationUser,
  profile?: ProfileVerification
): boolean {
  return hasVerifiedEmail(authUser, profile) || hasVerifiedPhone(authUser, profile);
}

/**
 * The platform gate. Email is the primary identifier and the only channel we can
 * reliably reach a user on, so an unconfirmed address blocks every mutating
 * action until it is verified.
 *
 * A missing phone number never blocks anything. Phone is collected during
 * registration and verified from the profile page at the user's convenience.
 */
export function requiresEmailVerification(
  authUser: AuthVerificationUser,
  profile?: ProfileVerification
): boolean {
  return !hasVerifiedEmail(authUser, profile);
}

/**
 * Both contacts proven. NOT a gate — kept for surfaces that report overall
 * account completeness, so a missing phone can be surfaced as a nudge.
 */
export function hasCompleteContactVerification(
  authUser: AuthVerificationUser,
  profile?: ProfileVerification
): boolean {
  return hasVerifiedEmail(authUser, profile) && hasVerifiedPhone(authUser, profile);
}
