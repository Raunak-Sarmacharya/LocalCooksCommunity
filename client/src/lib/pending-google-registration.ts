/**
 * Tracks a "Continue with Google" registration that has authenticated but not yet been
 * confirmed.
 *
 * WHY THIS EXISTS
 * A Google sign-in CREATES a Firebase session — and, for a new account, a Firebase Auth
 * USER — as a side effect. Between the popup and the visitor pressing Create Account
 * there is therefore a signed-in Firebase identity with no LocalCooks profile.
 *
 * Leaving that behind is not merely untidy. `/api/firebase/auth-method-hints` finds the
 * Firebase uid and resolves the address as `profile-incomplete` for ever after, so the
 * next time the visitor types their own address they are offered "Continue with Google"
 * and "Try another way" — sign-in routes for an account that does not exist and that
 * can never complete. That is the inconsistency this module exists to remove.
 *
 * So the attempt is recorded here, and `use-auth` cleans it up when it is abandoned:
 * the Firebase identity is DELETED when this attempt created it, and the session is
 * cleared otherwise.
 *
 * localStorage rather than sessionStorage on purpose: closing the tab is one of the ways
 * to abandon, and sessionStorage would not survive it.
 *
 * Deliberately NOT a general "profileless sessions are invalid" rule. Round 7
 * established that a pre-existing Firebase identity with no profile is a genuinely
 * interrupted registration and must keep its recovery route; only an attempt this flow
 * started is touched here.
 */
const STORAGE_KEY = "localcooks-pending-google-registration";

export interface PendingGoogleRegistration {
  uid: string;
  /** The address Google supplied — used to recognise the attempt from the identifier step. */
  email: string;
  /**
   * Whether THIS attempt created the Firebase identity.
   *
   * Load-bearing: a brand-new Google signup mints one and it must be deleted, whereas a
   * pre-existing identity (an interrupted registration) must only be signed out of.
   */
  createdIdentity: boolean;
  startedAt: number;
}

/**
 * The uid whose Google registration is currently ON SCREEN.
 *
 * Without this the marker is useless: it is written the moment the popup returns, and
 * the auth-state handler runs straight afterwards — so a naive "marker present ⇒
 * abandoned" check signs the visitor out in the middle of registering, which is the
 * opposite of the intent. An attempt is only abandoned once nothing is showing it any
 * more, so the register form claims the uid while it is mounted and releases it on
 * unmount.
 */
let activeUid: string | null = null;

/** Called by the register form while it is on screen in Google mode. */
export function setGoogleRegistrationActive(uid: string | null): void {
  activeUid = uid;
}

function read(): PendingGoogleRegistration | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingGoogleRegistration>;
    return typeof parsed?.uid === "string" && typeof parsed?.startedAt === "number"
      ? {
          uid: parsed.uid,
          email: typeof parsed.email === "string" ? parsed.email : "",
          // Absent on an older marker: treat it as "not ours to delete", which is the
          // safe direction — signing out leaves a recoverable identity, deleting the
          // wrong one does not.
          createdIdentity: parsed.createdIdentity === true,
          startedAt: parsed.startedAt,
        }
      : null;
  } catch {
    // A malformed marker must never break sign-in; treat it as absent.
    return null;
  }
}

/** The attempt in flight, if any. */
export function pendingGoogleRegistration(): PendingGoogleRegistration | null {
  return read();
}

/** Records that this uid is mid-registration and has not been confirmed yet. */
export function markPendingGoogleRegistration(input: {
  uid: string;
  email: string;
  createdIdentity: boolean;
}): void {
  if (typeof window === "undefined" || !input.uid) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        uid: input.uid,
        email: input.email.trim().toLowerCase(),
        createdIdentity: input.createdIdentity,
        startedAt: Date.now(),
      } satisfies PendingGoogleRegistration),
    );
  } catch {
    // Storage blocked: the flow still works, it just cannot detect an abandonment.
  }
}

/** Provisioning succeeded (or the attempt was otherwise resolved). */
export function clearPendingGoogleRegistration(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — a stale marker is harmless once the account exists.
  }
}

/**
 * Whether `uid` has a Google registration marked as in flight, regardless of whether
 * anything is currently showing it.
 *
 * The register form uses this to RE-SEED itself: the host's loading gate replaces the
 * card and unmounts the flow, so a form that has captured a Google identity loses that
 * state mid-flight. Re-deriving it from the still-live Firebase session plus this marker
 * is what lets the visitor come back to a prefilled form instead of an empty one.
 */
export function isPendingGoogleRegistration(uid: string | null | undefined): boolean {
  if (!uid) return false;
  return read()?.uid === uid;
}

/**
 * Whether `uid` is a Google registration that was started and never confirmed.
 *
 * Only the SAME uid counts: a different account signing in on this device must not
 * inherit the marker.
 */
export function isAbandonedGoogleRegistration(uid: string | null | undefined): boolean {
  if (!uid) return false;
  // Still on screen: the visitor is mid-registration, not gone.
  if (activeUid === uid) return false;
  return read()?.uid === uid;
}
