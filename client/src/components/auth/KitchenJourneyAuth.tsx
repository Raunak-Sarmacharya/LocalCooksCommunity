import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { hasVerifiedEmail } from "@/lib/auth-verification";
import { sendVerificationEmailWithFallback } from "@/lib/send-verification-email";
import { useFirebaseAuth } from "@/hooks/use-auth";
import AuthFlow, { type AuthFlowStep } from "./AuthFlow";
import { Button } from "@/components/ui/button";
import { kitchenJourneyEmailKey } from "@/lib/kitchen-journey-email";
import { getAuthIntent } from "@/lib/auth-intent";
import { createMissingProfileError, isMissingProfileError } from "@/lib/login-challenge";
import { isPendingGoogleRegistration, setGoogleRegistrationActive } from "@/lib/pending-google-registration";

export function useKitchenJourneyEmailVerified() {
  const { user } = useFirebaseAuth();
  return hasVerifiedEmail(
    { emailVerified: auth.currentUser?.emailVerified === true },
    { is_verified: user?.is_verified, isVerified: user?.isVerified }
  );
}

export default function KitchenJourneyAuth({ title, description = "Use your Local Cooks account or create one here. We collect your full name and phone number, and verify your email before sending a request.", initialEmail = "", initialTermsAccepted = false, subject = "request" }: { title: string; description?: string; initialEmail?: string; initialTermsAccepted?: boolean; subject?: string }) {
  const { user, loading, authenticateWithGoogle, updateUserVerification, refreshUserData, discardPendingGoogleRegistration } = useFirebaseAuth();
  const [step, setStep] = useState<AuthFlowStep>(() =>
    isPendingGoogleRegistration(auth.currentUser?.uid) ? "register" : "identifier"
  );
  const [googleRegistrationStarted, setGoogleRegistrationStarted] = useState(false);
  const pendingEmailKey = kitchenJourneyEmailKey(window.location.pathname, window.location.search);
  const [unverifiedEmail, setUnverifiedEmail] = useState(() => {
    try {
      const oldReturnPath = getAuthIntent()?.returnPath;
      return localStorage.getItem(pendingEmailKey)
        || sessionStorage.getItem(`kitchen_journey_email_${window.location.pathname}${window.location.search}`)
        || (oldReturnPath ? sessionStorage.getItem(`kitchen_journey_email_${oldReturnPath}`) : null)
        || "";
    }
    catch { return ""; }
  });
  const [signInAfterVerification, setSignInAfterVerification] = useState(
    () => new URLSearchParams(window.location.search).get("verified") === "true" && !auth.currentUser
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const verified = useKitchenJourneyEmailVerified();
  const email = user?.email || unverifiedEmail;
  const awaitingVerification = !!email && !verified && !googleRegistrationStarted && !isPendingGoogleRegistration(auth.currentUser?.uid);

  useEffect(() => () => setGoogleRegistrationActive(null), []);

  useEffect(() => {
    if (!loading && !user && new URLSearchParams(window.location.search).get("verified") === "true") {
      setSignInAfterVerification(true);
    }
  }, [loading, user]);

  const rememberUnverifiedEmail = (nextEmail: string) => {
    setUnverifiedEmail(nextEmail);
    try {
      if (nextEmail) localStorage.setItem(pendingEmailKey, nextEmail);
      else localStorage.removeItem(pendingEmailKey);
    } catch { /* storage unavailable */ }
  };

  useEffect(() => {
    if (!verified || !user || (unverifiedEmail && user.email?.toLowerCase() !== unverifiedEmail.toLowerCase())) return;
    setUnverifiedEmail("");
    try { localStorage.removeItem(pendingEmailKey); } catch { /* storage unavailable */ }
  }, [verified, user, unverifiedEmail, pendingEmailKey]);

  const checkVerification = async () => {
    setBusy(true);
    setError("");
    try {
      await auth.currentUser?.reload();
      await updateUserVerification();
      await refreshUserData({ forceToken: true });
      if (!auth.currentUser?.emailVerified) setError("Your email has not been verified yet. Open the link in your inbox and try again.");
    } catch {
      setError("We could not check your email yet. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!email) return;
    setBusy(true);
    setError("");
    try {
      await sendVerificationEmailWithFallback({
        email,
        role: "chef",
        returnUrl: `${window.location.pathname}${window.location.search}`,
      });
    } catch {
      setError("We could not send the link. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="w-full min-w-0">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">Your account</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <div className="mt-8 max-w-xl [&_.max-w-md]:max-w-xl [&_.mx-auto]:mx-0">
        {loading ? (
          <p className="text-sm text-muted-foreground" role="status">Restoring your account…</p>
        ) : awaitingVerification && !signInAfterVerification ? (
          <div className="space-y-4 rounded-2xl border bg-muted/30 p-5">
            <h2 className="text-lg font-semibold">Verify your email</h2>
            <p className="text-sm text-muted-foreground">Open the verification link sent to <strong className="text-foreground">{email}</strong>. Your {subject} has not been sent yet.</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap gap-3">
              {user && <Button disabled={busy} onClick={checkVerification}>I verified my email</Button>}
              <Button variant="outline" disabled={busy} onClick={resend}>Resend link</Button>
              {!user && <Button onClick={() => setSignInAfterVerification(true)}>I verified my email · Continue</Button>}
            </div>
          </div>
        ) : (
          <>
          {signInAfterVerification && !user && (
            <p className="mb-5 rounded-xl border bg-muted/30 p-4 text-sm">Your email is verified. Continue with {unverifiedEmail || "your account"} to finish this {subject}.</p>
          )}
          <AuthFlow
            key={signInAfterVerification ? "resume-after-verification" : "account"}
            step={step}
            initialIdentifier={unverifiedEmail || initialEmail}
            onStepChange={setStep}
            portal="chef"
            loginProps={{ onSuccess: async () => { await refreshUserData({ forceToken: true }); } }}
            registerProps={{
              showTermsInline: !initialTermsAccepted,
              initialTermsAccepted,
              hideApplyingToggle: true,
              animateEntrance: false,
              onRegistrationComplete: async (registeredEmail) => {
                rememberUnverifiedEmail(registeredEmail);
                await refreshUserData({ forceToken: true });
              },
              onSuccess: async () => { await refreshUserData({ forceToken: true }); },
            }}
            onUnverifiedAccount={rememberUnverifiedEmail}
            onDiscardPendingGoogleRegistration={() => void discardPendingGoogleRegistration()}
            onGoogleSignIn={async () => {
              setGoogleRegistrationStarted(true);
              try {
                const identity = await authenticateWithGoogle();
                if (!identity.existing) {
                  // The register form collects the required phone before provisioning.
                  // Keep the in-flight identity alive until that form claims it.
                  setGoogleRegistrationActive(auth.currentUser?.uid ?? null);
                  throw createMissingProfileError(identity.email);
                }
                setGoogleRegistrationStarted(false);
                await refreshUserData({ forceToken: false });
              } catch (googleError) {
                if (!isMissingProfileError(googleError)) setGoogleRegistrationStarted(false);
                throw googleError;
              }
            }}
            onPhoneExistingUser={async () => { await refreshUserData({ forceToken: true }); }}
          />
          </>
        )}
      </div>
    </section>
  );
}
