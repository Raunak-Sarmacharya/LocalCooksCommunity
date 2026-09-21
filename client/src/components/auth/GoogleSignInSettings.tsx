import { useCallback, useEffect, useState } from "react";
import { GoogleAuthProvider, linkWithPopup, onAuthStateChanged, type UserInfo } from "firebase/auth";
import { AlertCircle, Loader2 } from "lucide-react";
import { auth } from "@/lib/firebase";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import GoogleIcon from "./GoogleIcon";
import {
  ContactStatusPill,
  ContactVerificationRow,
  PRIMARY_ROW_ACTION,
  type ContactTone,
} from "@/components/profile/ContactVerificationRow";

/**
 * "Connect Google" on the profile security section.
 *
 * WHY THIS ROW EXISTS
 * Until now, whether a user could sign in with Google depended on their email DOMAIN, not on
 * anything we did. Firebase links accounts itself only when both sides are "trusted", and Google
 * counts as a trusted identity provider ONLY for `@gmail.com` addresses (Email/Password counts as
 * trusted only once the address is verified). So a verified `@gmail.com` account signing in with
 * Google links silently — with no code of ours involved — while a verified `@mun.ca` account
 * signing in with Google is REFUSED with `auth/account-exists-with-different-credential`, a code
 * the app previously could not even name.
 *
 * That made a real capability look like an accident of the address. This row makes it deliberate:
 * the account holder signs in however they already can, then connects Google here. It is the
 * documented remediation — "prompt the user to sign in with the existing provider. Then call
 * linkWithCredential(), linkWithPopup(), or linkWithRedirect() to associate the new provider" —
 * and it is the mirror of the password direction, which `ChangePassword` has always had.
 *
 * CONNECT ONLY, deliberately. Unlinking is not offered: Google may be the only way in for an
 * account, and Firebase's `unlink` has no undo. Add it only alongside a "you have another way to
 * sign in" check.
 */
function readGoogleLink(): boolean {
  // `auth` is `any` in `lib/firebase.ts` (it may be null when Firebase is unconfigured), so the
  // element type has to be named here or `provider` is implicitly `any`.
  const providers: UserInfo[] = auth.currentUser?.providerData ?? [];
  return providers.some((provider) => provider.providerId === "google.com");
}

/** The linked address, for the row's value line. */
function readGoogleAddress(): string | null {
  const providers: UserInfo[] = auth.currentUser?.providerData ?? [];
  const google = providers.find((provider) => provider.providerId === "google.com");
  return google?.email ?? auth.currentUser?.email ?? null;
}

/**
 * Every failure this can produce, mapped to something the account holder can act on.
 *
 * Returns `null` for a deliberate cancellation: closing the popup is not an error, and shouting
 * at someone who changed their mind is how a settings page becomes annoying.
 */
function messageForLinkError(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code ?? "";
  const raw = error instanceof Error ? error.message : String(error ?? "");

  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) return null;
  if (code.includes("popup-blocked")) {
    return "Your browser blocked the Google window. Allow pop-ups for this site, then try again.";
  }
  if (code.includes("provider-already-linked")) {
    return null; // Already connected — the row refreshes to say so.
  }
  if (code.includes("credential-already-in-use")) {
    return "That Google account is already connected to a different LocalCooks account. Sign in with it instead, or connect a different Google account.";
  }
  if (code.includes("account-exists-with-different-credential")) {
    return "That Google account's email already belongs to a LocalCooks account. Sign in with that account first, then connect Google from here.";
  }
  if (code.includes("email-already-in-use")) {
    return "That Google account's email is already used by another LocalCooks account.";
  }
  if (code.includes("requires-recent-login")) {
    return "For security reasons, please sign out and sign back in, then connect Google.";
  }
  if (code.includes("network-request-failed")) {
    return "Network error. Check your connection and try again.";
  }
  if (code.includes("operation-not-allowed")) {
    // A configuration problem, not the visitor's — say so instead of blaming them.
    return "Google sign-in is not enabled for this environment. Please contact support.";
  }
  if (code.includes("user-disabled")) return "This account has been disabled.";
  if (code.includes("user-mismatch") || code.includes("user-cancelled")) return null;

  logger.error("[google-link] Unmapped failure while connecting Google", { code, raw });
  return "We could not connect your Google account. Please try again.";
}

export default function GoogleSignInSettings() {
  const [linked, setLinked] = useState<boolean>(() => readGoogleLink());
  const [address, setAddress] = useState<string | null>(() => readGoogleAddress());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLinked(readGoogleLink());
    setAddress(readGoogleAddress());
  }, []);

  /**
   * Re-read on every session change, not once.
   *
   * `providerData` is the only source of truth for "is Google connected", and it is NOT known at
   * mount: on a cold load `auth.currentUser` is still null while Firebase restores the session, so
   * a read-once row would tell an account that already has Google linked — including one Firebase
   * linked BY ITSELF at sign-in, which is the `@gmail.com` case — that it is "Not connected".
   * `onAuthStateChanged` fires when the session resolves, on sign-in and on sign-out, which covers
   * every way this row's answer can change without the page being reloaded. Linking from this row
   * refreshes explicitly, because that happens on the already-resolved user.
   */
  useEffect(() => {
    refresh();
    return onAuthStateChanged(auth, () => refresh());
  }, [refresh]);

  const handleConnect = async () => {
    setError(null);
    const current = auth.currentUser;
    if (!current) {
      setError("You must be signed in to connect Google.");
      return;
    }

    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      // Always show the chooser: the account being linked is a decision, and `login_hint`
      // would quietly pre-select whatever this browser used last.
      provider.setCustomParameters({ prompt: "select_account" });

      await linkWithPopup(current, provider);
      refresh();
      toast.success("Google connected", {
        description: "You can now sign in with Google as well as your current method.",
      });
    } catch (caught) {
      const message = messageForLinkError(caught);
      if (message) {
        setError(message);
      } else {
        // Cancellation, or already-linked: re-read rather than assume.
        refresh();
      }
      logger.info("[google-link] Connect attempt finished without linking", {
        code: (caught as { code?: string } | null)?.code ?? null,
      });
    } finally {
      setBusy(false);
    }
  };

  const tone: ContactTone = linked ? "verified" : "action";
  const statusLabel = linked ? "Connected" : "Not connected";

  return (
    <ContactVerificationRow
      id="security-google"
      labelId="security-google-label"
      icon={<GoogleIcon className="size-4" aria-hidden />}
      label="Google"
      tone={tone}
      badges={<ContactStatusPill tone={tone}>{statusLabel}</ContactStatusPill>}
      value={linked ? (address ?? "Google account") : undefined}
      help={
        linked
          ? "Sign in with Google or with your current method — both reach this account."
          : "Connect Google to sign in with one tap. Your current sign-in method keeps working."
      }
      actions={
        linked ? null : (
          // The only action on the row, so it is the primary — and text-only like every
          // other row action, since the G mark is already this row's own icon.
          <Button
            type="button"
            size="sm"
            className={PRIMARY_ROW_ACTION}
            onClick={handleConnect}
            disabled={busy}
          >
            {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />}
            {busy ? "Connecting…" : "Connect Google"}
          </Button>
        )
      }
    >
      {/* Only the failure needs a line of its own. "Google is connected to this
          account." used to sit here too, under a pill that already said
          "Connected" — a third line that made the row the tallest on the page
          to repeat what the row had already told you. */}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </ContactVerificationRow>
  );
}
