type AuthVerificationUser = {
  emailVerified?: boolean | null;
} | null | undefined;

type ProfileVerification = {
  is_verified?: boolean | null;
  isVerified?: boolean | null;
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
