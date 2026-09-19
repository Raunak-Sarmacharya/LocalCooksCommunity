import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";
import AuthFlow, { type AuthFlowStep } from "@/components/auth/AuthFlow";
import { isPhoneAuthInProgress } from "@/lib/phone-registration";
import { hasVerifiedContact, hasVerifiedEmail } from "@/lib/auth-verification";
import EmailVerificationScreen from "@/components/auth/EmailVerificationScreen";
import LoadingOverlay from "@/components/auth/LoadingOverlay";
import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
// Removed sendEmailVerification from firebase/auth
// A brand-new manager meets this BEFORE the legal step — the wizard's own welcome step
// sits after it, inside the dashboard. Dismissing this records `has_seen_welcome`, which
// is what marks that wizard step complete, so the two never both appear.
import ManagerWelcomeScreen from "@/pages/manager-welcome-screen";
import { motion, useReducedMotion } from "framer-motion";
import { Check, X } from "@/components/ui/manager-icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import KitchenAuthShowcase from "@/components/auth/KitchenAuthShowcase";
import AuthLoadingScreen from "@/components/auth/AuthLoadingScreen";
import { isMissingProfileError } from "@/lib/login-challenge";
import { clearLastAccount, getLastAccount, type LastAccount } from "@/lib/last-account";
import { useMeasuredHeight } from "@/hooks/use-measured-height";
import { useAuthTransition } from "@/components/auth/AuthTransition";
import { AUTH_GATE_TIMEOUT_MS } from "@/config/auth-timing";
import { CURRENT_POLICY_VERSION } from "@/config/policy-version";
import { getSubdomainOriginForEnvironment } from "@shared/subdomain-utils";
import { clearSellerJourneyDraft } from "@/lib/seller-journey";
import { needsWelcomeScreen } from "@/lib/manager-welcome";
import { useCustomAlerts } from "@/components/ui/custom-alerts";

export default function ManagerLogin() {
  const { t } = useTranslation(["manager", "auth"]);
  const { showAlert } = useCustomAlerts();

  // Managers now use Firebase authentication (like chefs)
  const [location, setLocation] = useLocation();
  const { user, loading, authPhase, refreshUserData, signInWithGoogle, updateUserVerification, discardPendingGoogleRegistration } = useFirebaseAuth();
  const { begin: beginHandoff, end: endHandoff } = useAuthTransition();
  const queryClient = useQueryClient();
  // Read once, synchronously, so the card can be the first thing painted. This
  // is browser-local only — it must never become a lookup, or the page would
  // become an account-enumeration oracle.
  const [lastAccount, setLastAccount] = useState<LastAccount | null>(() => getLastAccount());
  const [authStep, setAuthStep] = useState<AuthFlowStep>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "register") return "register";
    // A post-verification or post-reset arrival carries its own landing step.
    // Starting on the card would flash it and then swap to the success banner.
    if (params.get("message") || params.get("verified")) return "identifier";
    return lastAccount ? "welcome-back" : "identifier";
  });
  const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);
  // Covers the gap after Google's account picker returns: signInWithGoogle sets
  // authPhase back to `ready` before finishAuthentication can raise the handoff,
  // which is the "auth form flashes for a few seconds" report.
  const [googleAuthPending, setGoogleAuthPending] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [successMessageType, setSuccessMessageType] = useState<'password-reset' | 'email-verified'>('password-reset');
  
  // ENTERPRISE FIX: Lift email verification state to parent so it persists across auth state changes
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  /**
   * True while a REGISTRATION is in flight, as opposed to a sign-in.
   *
   * The loading gate outranks the registration overlay (it returns early), so without
   * this the gate described a Google signup as "Signing you in..." — telling a visitor
   * who was creating an account that they were logging into one.
   */
  const [isRegistering, setIsRegistering] = useState(false);
  /** Shown once, when the server says this manager has not seen the welcome yet. */
  const [showWelcome, setShowWelcome] = useState(false);

  /** The welcome screen's single action: on to the terms if they are outstanding. */
  const handleWelcomeContinue = () => {
    setShowWelcome(false);
    const needsTerms =
      !user?.termsAccepted || user?.termsVersion !== CURRENT_POLICY_VERSION;
    setLocation(
      needsTerms
        ? `/accept-terms?redirect=${encodeURIComponent("/manager/dashboard")}`
        : "/manager/dashboard",
      { replace: true },
    );
  };
  const [emailForVerification, setEmailForVerification] = useState("");
  /**
   * True when the verification screen was opened by RESUMING an existing
   * unconfirmed account rather than by finishing a registration. The two paths
   * need different "go back" destinations, so the origin has to be remembered.
   */
  const [verificationResumed, setVerificationResumed] = useState(false);
  /**
   * The address a failed Google attempt was for. AuthFlow is unmounted by the
   * loading gate, so its own `email` state cannot survive to pre-fill the
   * register step; the host re-seeds it on remount instead.
   *
   * Also seeds a post-verification arrival. That link carries `verified=true` and nothing
   * else — deliberately, so an address is never put in a URL — so the visitor used to land on
   * an empty field and have to retype the address they had just proved. This browser is the
   * one that registered the account, so the remembered account IS that address.
   */
  const [attemptedIdentifier, setAttemptedIdentifier] = useState(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("verified") === "true"
      ? (lastAccount?.email ?? "")
      : "",
  );
  
  // ENTERPRISE FIX: Lift loading overlay state to parent so it persists across auth state changes
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Creating your account...");
  const [loadingSubmessage, setLoadingSubmessage] = useState("Please wait while we set up your account securely.");

  const authCardRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  /**
   * The card's height is measured, not guessed — see `useMeasuredHeight` for why
   * this is a callback ref rather than an effect, and for the two ways an effect
   * collapsed the card to a 2px sliver whenever the loading gate came up.
   */
  const [measureCard, cardHeight] = useMeasuredHeight();

  useLayoutEffect(() => {
    authCardRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [authStep, showEmailVerification]);
  
  // Handle resend verification email
  const handleResendVerification = async () => {
    // Send to the address being verified, not to whoever is signed in. On the
    // resume path the visitor is signed OUT — an unconfirmed account has no
    // session to resume — so keying this off `auth.currentUser` made "Resend"
    // silently do nothing, leaving a button that promised an email it never sent.
    const targetEmail = emailForVerification || auth.currentUser?.email;
    if (!targetEmail) {
      logger.warn('Cannot resend verification: no address to send to');
      throw new Error('No email address to verify');
    }
    try {
      logger.info('📧 Resending Firebase verification email...');
      const response = await fetch('/api/firebase/send-verification-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, role: 'manager' }),
      });

      if (!response.ok) {
        throw new Error('Failed to send verification email');
      }
      logger.info('✅ Firebase verification email resent successfully');
    } catch (error: any) {
      logger.error('❌ Failed to resend Firebase verification email:', error);
      throw error;
    }
  };
  
  // Callback when registration starts (show loading overlay)
  const handleRegistrationStart = () => {
    logger.info('🔄 Registration started - showing loading overlay');
    setIsRegistering(true);
    setLoadingMessage("Creating your account...");
    setLoadingSubmessage("Please wait while we set up your account securely.");
    setShowLoadingOverlay(true);
  };
  
  /**
   * One message for every "this account cannot manage kitchens" exit, so the
   * just-attempted and already-signed-in paths cannot drift apart.
   *
   * The copy states the situation and the fix. It deliberately does NOT print
   * the chef portal origin: a raw URL in body text is what made this read as a
   * developer message, and it leaked which environment the visitor was on.
   * Material caps a dialog at two actions — one confirming, one dismissing — so
   * the way out is a control, not a sentence.
   */
  const showWrongPortalAlert = () => {
    showAlert({
      title: t("wrongPortalTitle", {
        ns: "manager",
        defaultValue: "This account can't manage kitchens",
      }),
      description: t("wrongPortalBody", {
        ns: "manager",
        defaultValue:
          "The account you're using isn't set up for the kitchen portal. Use the account you manage your kitchens with.",
      }),
      type: "warning",
      confirmText: t("wrongPortalTryAnother", {
        ns: "manager",
        defaultValue: "Try a different account",
      }),
      secondaryText: t("wrongPortalBackHome", {
        ns: "manager",
        defaultValue: "Back to main page",
      }),
      onSecondary: () => setLocation("/"),
    });
  };

  /**
   * Returns the card to a step that depends on none of the state the loading
   * gate destroyed.
   *
   * The gate above replaces the card with AuthLoadingScreen, which UNMOUNTS
   * AuthFlow — so `email`, `methods`, `maskedEmail` and friends are gone while
   * `authStep` (owned here) survives. Any attempt that ends WITHOUT navigating
   * must therefore land on a step that needs none of it, or the visitor is left
   * on a Google hint with no address, and a "Try another way" chooser with no
   * options. The identifier gate is the only such step.
   */
  const recoverToIdentifierStep = () => {
    setAuthStep("identifier");
    setAttemptedIdentifier("");
  };

  const finishAuthentication = async (opts?: { handoffAlreadyRaised?: boolean }) => {
    setHasAttemptedLogin(true);

    // Raise the handoff before any of the work below. It lives above the
    // router, so the overlay carries across the route change and stays until
    // the destination's queries settle — instead of the login form reappearing
    // between "signed in" and "dashboard rendered".
    if (!opts?.handoffAlreadyRaised) {
      beginHandoff(
        t("btnSigningYouIn", { ns: "auth", defaultValue: "Signing you in..." }),
        t("overlayRedirectingDashboard", { ns: "auth", defaultValue: "Redirecting to your dashboard..." }),
      );
    }

    await queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
    const refreshedUser = await refreshUserData();
    if (!refreshedUser) {
      setHasAttemptedLogin(false);
      setShowLoadingOverlay(false);
      endHandoff();
      recoverToIdentifierStep();
      return;
    }

    if (!hasVerifiedContact(refreshedUser, refreshedUser)) {
      // Signed in, but the account cannot act until the address is confirmed.
      // Show the confirmation screen rather than dropping back to a stranded
      // step: there IS a live session here, so "I have verified my email" can
      // actually re-read the status.
      endHandoff();
      setEmailForVerification(refreshedUser.email ?? emailForVerification);
      setVerificationResumed(false);
      setShowEmailVerification(true);
      return;
    }

    const isManager =
      refreshedUser.role === "manager" || refreshedUser.isManager === true;
    if (!isManager) {
      // Stay on the kitchen portal. Hard-redirecting to chef.localhost is what
      // felt like "I registered as a manager and got forced into chef".
      endHandoff();
      setShowLoadingOverlay(false);
      const chefOrigin = getSubdomainOriginForEnvironment("chef", window.location.hostname, {
        port: window.location.port,
        protocol: window.location.protocol,
      });
      logger.warn("Manager login: authenticated non-manager stayed on kitchen portal", {
        role: refreshedUser.role,
        chefOrigin,
      });

      // Undo the sign-in the visitor did not intend. Without this they are left
      // *authenticated as the wrong account* while staring at a login form —
      // every later action on this portal would run as that account, and the
      // "use a different account" instruction had no way to be followed, since
      // nothing on the page could sign them out. Signing out here returns them
      // to a clean, unauthenticated state, which makes the alert's advice
      // actionable: "Continue with Google" now reopens the account picker.
      try {
        await auth.signOut();
      } catch (signOutError) {
        logger.error("Manager login: failed to sign out the rejected account", signOutError);
      }

      // The alert's "Try a different account" only means anything if the card
      // behind it is usable: reset before showing it, so dismissing the dialog
      // lands on the identifier gate instead of a Google hint whose address was
      // destroyed by the gate.
      recoverToIdentifierStep();
      showWrongPortalAlert();
      return;
    }

    // A kitchen-manager session must never be yanked to chef by a leftover
    // seller-journey draft (PendingSellerJourneySubmitter is global).
    clearSellerJourneyDraft();

    // A brand-new manager meets the welcome screen BEFORE the legal step: a warm moment
    // before a cold one. Shown only when the server says they have not seen it, so it
    // appears exactly once per account.
    if (needsWelcomeScreen(refreshedUser)) {
      endHandoff();
      setShowLoadingOverlay(false);
      setShowWelcome(true);
      return;
    }

    const needsTerms =
      !refreshedUser.termsAccepted ||
      refreshedUser.termsVersion !== CURRENT_POLICY_VERSION;
    setLocation(
      needsTerms
        ? `/accept-terms?redirect=${encodeURIComponent("/manager/dashboard")}`
        : "/manager/dashboard",
      { replace: true },
    );
  };

  const handleGoogleSignIn = async () => {
    // Keep the full-page loader up for the entire popup + sync + redirect. Do
    // NOT pre-raise the cross-route handoff here: its 6s ceiling would expire
    // while the user is still choosing an account in Google's tab, dropping the
    // loader and flashing the form. The gate below stays up via googleAuthPending
    // (which ignores the gate timeout), and finishAuthentication raises the
    // handoff only once, right before it navigates.
    setGoogleAuthPending(true);
    setHasAttemptedLogin(true);
    try {
      // Sign-IN, never registration. This used to pass `true`, which sent every
      // "Continue with Google" through the provisioning branch: picking a Google
      // account with no LocalCooks profile silently CREATED a manager account —
      // an irreversible action inferred from a sign-in attempt, and the classic
      // "silent identity forking" failure, where the user ends up operating
      // across two accounts and their saved work appears to vanish.
      //
      // With `false`, an unknown account throws `createMissingProfileError`,
      // which AuthFlow already catches and turns into the explicit register step
      // with the address pre-filled. Registration still happens — but the visitor
      // sees "Create your account", fills the form, and accepts the terms before
      // anything is provisioned. That is the Airbnb shape: sign in by default,
      // sign up on purpose.
      await signInWithGoogle(false);
      await finishAuthentication();
    } catch (error: unknown) {
      endHandoff();
      setHasAttemptedLogin(false);

      // An unknown Google account must reach the explicit register step, and
      // AuthFlow owns that routing. Re-throwing is what lets it — this catch used
      // to swallow EVERY error, so the missing-profile branch was unreachable
      // from this page: the alert fired, nothing navigated, and the visitor was
      // left on whatever step they started from.
      if (isMissingProfileError(error)) {
        const attempted = (error as { email?: unknown }).email;
        if (typeof attempted === "string") setAttemptedIdentifier(attempted);
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("popup-closed-by-user") && !message.includes("cancelled")) {
        showAlert({
          title: t("signInFailedTitle", { ns: "auth", defaultValue: "Sign In Failed" }),
          description: message || t("errSignInGeneric", { ns: "auth", defaultValue: "Unable to sign in. Please try again." }),
          type: "error",
        });
      }

      // Return to a step that needs no carried-over state. The loading gate above
      // unmounts AuthFlow, so `email`, `methods` and friends are gone by the time
      // we get here while `authStep` survived — leaving the card on a step whose
      // prerequisites no longer exist (a Google hint with no address, a chooser
      // with no options). The identifier gate depends on nothing.
      setAuthStep("identifier");
    } finally {
      setGoogleAuthPending(false);
    }
  };

  // Callback when registration completes successfully
  const handleRegistrationSuccess = async (email: string, data?: { phone?: string }) => {
    // The account exists now, so this is no longer a creation.
    setIsRegistering(false);

    // Only a registration that still has to PROVE its address belongs on the verification
    // screen.
    //
    // This used to test `auth.currentUser?.phoneNumber`, i.e. "did this registration link
    // a phone credential". That is true for a phone signup and FALSE for Google — even
    // though Google has already verified the address — so a Google signup was shown
    // "check your email" for an address it had just proved, and never reached
    // finishAuthentication. That is where the welcome screen and the terms gate live, so
    // a Google registration skipped both.
    if (!auth.currentUser?.emailVerified) {
      logger.info('✅ Registration complete - showing email verification screen');
      // Brief delay to show success state before transitioning
      setLoadingMessage("Account created!");
      setLoadingSubmessage("Redirecting to email verification...");

      setTimeout(() => {
        setShowLoadingOverlay(false);
        setEmailForVerification(email);
        setVerificationResumed(false);
        setShowEmailVerification(true);
      }, 800); // Show success message briefly before transitioning
      return;
    }

    // Address already proved (Google), so there is nothing to verify: straight on to the
    // welcome screen, and from there to the terms gate.
    await finishAuthentication();
  };
  
  // Callback when registration fails
  const handleRegistrationError = () => {
    logger.info('❌ Registration failed - hiding loading overlay');
    setIsRegistering(false);
    setShowLoadingOverlay(false);
  };

  const handleCheckVerified = async () => {
    const updatedUser = await updateUserVerification();
    if (!hasVerifiedEmail(auth.currentUser, updatedUser)) return false;

    setShowEmailVerification(false);
    await finishAuthentication();
    return true;
  };


  // Check for success messages from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const message = urlParams.get('message');
    const verified = urlParams.get('verified');
    
    if (message === 'password-reset-success') {
      setSuccessMessageType('password-reset');
      setShowSuccessMessage(true);
      setAuthStep('login');
      
      window.history.replaceState({}, document.title, window.location.pathname);
      
      setTimeout(() => {
        setShowSuccessMessage(false);
      }, 8000);
    } else if (verified === 'true') {
      logger.info('📧 EMAIL VERIFICATION SUCCESS detected in URL');
      setSuccessMessageType('email-verified');
      setShowSuccessMessage(true);
      // Deliberately does NOT set the step.
      //
      // It used to force `login`, which fought the `authStep` initializer above: that one
      // returns `identifier` for `?verified` precisely so a post-verification arrival lands
      // on the app's real entry point. Forcing `login` instead put the visitor on an EMPTY
      // sign-in form — the address is not carried by the link, so there was nothing to sign
      // in with — under a "← Back" arrow that had nowhere useful to go and that no other
      // auth state shows. The initializer's answer stands: `identifier`, with the success
      // banner above it.
      //
      // `password-reset-success` still forces `login`: there the next step genuinely is to
      // sign in with the password that was just set.
      window.history.replaceState({}, document.title, window.location.pathname);

      setTimeout(() => {
        setShowSuccessMessage(false);
      }, 10000);
    }
  }, []);

  // Handle initial load detection
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => setIsInitialLoad(false), 100);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  // Fetch user metadata to check welcome screen status
  // Use React Query to share cache with ManagerProtectedRoute
  const { data: userMetaData, isLoading: userMetaLoading } = useQuery({
    queryKey: ["/api/user/profile", user?.uid],
    queryFn: async () => {
      if (!user) return null;
      try {
        const firebaseUser = auth.currentUser;
        if (!firebaseUser) return null;
        
        const token = await firebaseUser.getIdToken();
        const response = await fetch('/api/user/profile', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          return null;
        }
        
        const userData = await response.json();
        logger.info('✅ MANAGER USER DATA FETCHED:', {
          id: userData.id,
          username: userData.username,
          is_verified: userData.is_verified,
          has_seen_welcome: userData.has_seen_welcome,
          role: userData.role,
          isManager: userData.isManager
        });
        
        return userData;
      } catch (error) {
        logger.error('Error fetching user metadata:', error);
        return null;
      }
    },
    enabled: !!user && !loading,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  // Redirect if already logged in as manager
  // Only redirect once when user data is loaded and we're on the login page
  // Use a ref to prevent multiple redirects
  const hasRedirected = useRef(false);
  
  useEffect(() => {
    // Only redirect if:
    // 1. Not loading
    // 2. User data is loaded
    // 3. We're on the login page
    // 4. Haven't redirected yet
    // 5. This page is not running an authentication attempt
    //
    // (5) is load-bearing. `finishAuthentication` owns the routing for an attempt —
    // welcome screen first, then the Terms gate, then the dashboard — and this effect
    // is a cruder duplicate of it that only knows the last hop. Because it also keys
    // off `user` and the profile query, an attempt SETTLING is exactly when it fires,
    // so it used to win the race and jump straight to `/manager/dashboard`. That route
    // sits behind `ManagerProtectedRoute`, which bounces a manager who has not accepted
    // the Terms to `/accept-terms` — so a brand-new manager landed on the Terms page
    // and the welcome screen was skipped entirely, with `has_seen_welcome` still false
    // in the database.
    //
    // The harness could not see any of this: it serves the page at `/manager-login.html`,
    // so `location === '/manager/login'` is never true there and the whole branch is dead.
    //
    // This effect is now only for a visitor who ARRIVES already signed in, which is what
    // its name and the `hasRedirected` ref were always describing.
    const midFlow = hasAttemptedLogin || showWelcome;
    if (!loading && !userMetaLoading && user && userMetaData && location === '/manager/login' && !hasRedirected.current && !midFlow) {
      const isManager = userMetaData.role === 'manager' || userMetaData.isManager;
      
      if (isManager && hasVerifiedContact(user, userMetaData)) {
        // ── The email-verification landing ────────────────────────────────────
        // The verification link's continueUrl is `/manager/login?verified=true`
        // (`server/routes.ts`), so a manager who confirms their address from the email
        // arrives HERE, already signed in and verified. Sending them straight on to
        // `/manager/dashboard` skipped the welcome screen and let `ManagerProtectedRoute`
        // bounce them to `/accept-terms` — the same failure the Google registration path
        // had, on a different door.
        //
        // The welcome screen comes before the dashboard wherever the manager enters, so
        // this branch handles the link, and also a reload or a return visit after closing
        // the tab on the welcome screen. `has_seen_welcome` stays false until they dismiss
        // it, so this cannot fire twice for one account.
        if (needsWelcomeScreen(userMetaData)) {
          logger.info('👋 Manager has not seen the welcome screen — showing it before the dashboard');
          hasRedirected.current = true;
          endHandoff();
          setShowWelcome(true);
          return;
        }

        logger.info('✅ Manager has a verified contact - continuing');
        hasRedirected.current = true;
        beginHandoff(
          t("btnSigningYouIn", { ns: "auth", defaultValue: "Signing you in..." }),
          t("overlayRedirectingDashboard", { ns: "auth", defaultValue: "Redirecting to your dashboard..." }),
        );
        setLocation('/manager/dashboard');
      } else if (isManager && !hasVerifiedContact(user, userMetaData)) {
        logger.info('📧 EMAIL OR PHONE VERIFICATION REQUIRED');
        // Stay on login page to show verification message
      } else if (!isManager) {
        logger.warn('⚠️ User is not a manager — staying on kitchen login (no chef hard-redirect)');
        hasRedirected.current = true;
        endHandoff();
        if (userMetaData.role === 'admin') {
          setLocation('/admin');
        } else {
          // Same reasoning as the attempt path: leave the card somewhere usable
          // behind the alert. `?tab=register` in particular would otherwise sit
          // on the register step with nothing carried over.
          recoverToIdentifierStep();
          showWrongPortalAlert();
        }
      }
    }
    
    // Reset redirect flag if user logs out or location changes away from login
    if (!user || location !== '/manager/login') {
      hasRedirected.current = false;
    }
  }, [loading, userMetaLoading, user, userMetaData, location, setLocation, beginHandoff, endHandoff, showAlert, t, hasAttemptedLogin, showWelcome]);

  // ENTERPRISE: Show appropriate loading state based on auth phase
  // This prevents the login form from flashing during Google sign-in
  const isAuthenticating = authPhase === 'authenticating' || authPhase === 'syncing';
  
  // Show loading spinner when auth is in progress OR when login was attempted but profile hasn't loaded yet
  const isAwaitingProfile = hasAttemptedLogin && !!user && !userMetaData;
  const isCompletingPhoneRegistration = isPhoneAuthInProgress();
  const isGateActive =
    !showEmailVerification &&
    !isCompletingPhoneRegistration &&
    (loading ||
      isInitialLoad ||
      userMetaLoading ||
      isAuthenticating ||
      isAwaitingProfile ||
      googleAuthPending);

  // Same escape hatch the chef page has. `isAwaitingProfile` in particular can
  // hold indefinitely if the profile request never resolves, and a manager
  // staring at a spinner with no way out is the worst outcome here.
  //
  // Exception: while the Google popup is open (`googleAuthPending`), the wait is
  // gated on a human picking an account, which routinely takes longer than the
  // 8s valve. Timing out then is exactly what flashed the form behind the popup,
  // so the popup keeps the loader up regardless of the timer.
  const [gateTimedOut, setGateTimedOut] = useState(false);
  useEffect(() => {
    if (!isGateActive || googleAuthPending) {
      setGateTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setGateTimedOut(true), AUTH_GATE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isGateActive, googleAuthPending]);

  if (showWelcome) {
    return <ManagerWelcomeScreen onContinue={handleWelcomeContinue} />;
  }

  if (isGateActive && (!gateTimedOut || googleAuthPending)) {
    // The copy has to describe what is ACTUALLY happening. The old version said
    // "Signing you in..." for everything that was not `syncing` — so a cold load with no
    // session (nobody signing in) and a Google SIGNUP both claimed to be logging
    // somebody in.
    const gateMessage = isRegistering
      ? t("statusCreatingAccount", { ns: "auth", defaultValue: "Creating your account..." })
      : authPhase === 'syncing'
        ? t("statusCheckingAccount", { ns: "auth", defaultValue: "Checking account..." })
        : authPhase === 'authenticating' || googleAuthPending || isAwaitingProfile
          ? t("btnSigningYouIn", { ns: "auth", defaultValue: "Signing you in..." })
          // Nothing is in flight: a cold load waiting on the session check, which may
          // well end with no session at all.
          : t("statusLoading", { ns: "auth", defaultValue: "Loading..." });

    // Is anything actually in flight, or are we simply waiting on the session check?
    const gateBusy =
      isRegistering ||
      authPhase === 'syncing' ||
      authPhase === 'authenticating' ||
      googleAuthPending ||
      isAwaitingProfile;

    return (
      <AuthLoadingScreen
        message={gateMessage}
        // Same rule as the message: with nothing in flight there are no credentials to
        // verify, so promising to do so is untrue.
        submessage={
          gateBusy
            ? t("overlayVerifyCredentials", { ns: "auth", defaultValue: "Please wait while we verify your credentials securely." })
            : t("statusPreparing", { ns: "auth", defaultValue: "Just a moment." })
        }
      />
    );
  }

  // Managers don't use WelcomeScreen - they use ManagerOnboardingWizard on dashboard
  // No welcome screen check needed here

  // Show login/register form
  return (
    <>
      <LoadingOverlay 
        isVisible={showLoadingOverlay}
        message={loadingMessage}
        submessage={loadingSubmessage}
        type="loading"
      />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex min-h-screen bg-gradient-to-br from-[#F51042] via-[#df123e] to-[#a90c31] lg:h-screen lg:min-h-0 lg:overflow-hidden"
      >
        <KitchenAuthShowcase />

        <motion.div
          initial={{ opacity: 0, x: 36 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 flex min-h-screen w-full items-center justify-center px-3 py-3 sm:px-6 sm:py-6 lg:h-screen lg:min-h-0 lg:w-[42%] lg:px-5 xl:px-8"
        >
          <motion.div
            ref={authCardRef}
            initial={false}
            animate={{ height: cardHeight ?? "auto" }}
            transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={{ scrollbarGutter: "stable", overflowAnchor: "none" }}
            className="relative z-10 max-h-[calc(100vh-1.5rem)] w-full max-w-[510px] overflow-y-auto rounded-[1.75rem] border border-white/70 bg-[#FFFDFC] shadow-[0_24px_80px_-30px_rgba(69,10,27,0.58)] sm:max-h-[calc(100vh-3rem)] lg:max-h-[calc(100vh-2.5rem)]"
          >
            <div ref={measureCard} className="px-6 py-7 sm:px-9 sm:py-9 xl:px-11">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="mb-7"
              >
                <a href="/" className="inline-flex items-center gap-2.5 transition-transform duration-300 hover:scale-[1.02]">
                  <Logo variant="brand" className="h-9 w-auto flex-shrink-0" />
                  <span className="flex flex-col justify-center">
                    <span className="font-logo text-xl font-normal leading-none tracking-tight text-[#F51042]">LocalCooks</span>
                    <span className="mt-0.5 text-[9px] font-medium uppercase leading-none tracking-wider text-gray-500/70">For kitchens</span>
                  </span>
                </a>
              </motion.div>

              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
                className="w-full"
              >
                {!showEmailVerification && authStep !== "phone-otp" && authStep !== "google-hint" && authStep !== "methods" && authStep !== "welcome-back" && (
                  <div className="mb-6">
                    <h1 className="text-3xl font-bold tracking-[-0.03em] text-gray-950">
                      {authStep === "register"
                        ? isPhoneAuthInProgress()
                          ? t("finishSigningUp", { ns: "auth", defaultValue: "Finish signing up" })
                          : t("createYourAccount", "Create your account")
                        : t("loginOrSignUp", { ns: "auth", defaultValue: "Log in or sign up" })}
                    </h1>
                    <p className="mt-2.5 max-w-sm text-sm leading-relaxed text-gray-600">
                      {authStep === "register"
                        ? t("kitchenRegisterSubtitle", "List and manage your commercial kitchen")
                        : authStep === "identifier"
                          ? t("kitchenIdentifierSubtitle", "Enter your email or phone number to continue")
                          : t("kitchenLoginSubtitle", "Sign in to manage your kitchen, bookings, and availability")}
                    </p>
                  </div>
                )}

                {showSuccessMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-green-100">
                        <Check className="h-4 w-4 text-green-600" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-green-800">
                          {successMessageType === "password-reset" ? "Password reset successful!" : "Email verified successfully!"}
                        </p>
                        <p className="mt-1 text-xs text-green-600">
                          {successMessageType === "password-reset"
                            ? "You can now sign in with your new password."
                            : "Your kitchen manager account is verified. Please sign in to continue."}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowSuccessMessage(false)}
                        className="flex-shrink-0 text-primary transition-colors hover:text-primary/80"
                        aria-label="Dismiss message"
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </motion.div>
                )}

                {showEmailVerification ? (
                  <EmailVerificationScreen
                    email={emailForVerification}
                    onResend={handleResendVerification}
                    // Only offer "I have verified my email" when there is a
                    // session to re-read. On the resume path the visitor is
                    // signed OUT — an unconfirmed account has no session — so
                    // the check could only ever report "not detected yet", even
                    // after they had verified. Omitting it makes the screen fall
                    // back to going back, which is the honest next step: sign in
                    // (the link in their inbox also returns them here with the
                    // success banner).
                    onCheckVerified={verificationResumed ? undefined : handleCheckVerified}
                    // No phone escape hatch: email is the primary identifier and
                    // must be proven before the account can be used. Phone
                    // verification is offered later, during onboarding.
                    onGoBack={() => {
                      setShowEmailVerification(false);
                      // Always the identifier gate. This used to send the
                      // registration path to the sign-in step, which carries a
                      // back control of its own — so "change email" landed on a
                      // second screen the visitor could walk backwards out of,
                      // through two half-states, to get nowhere. The gate is the
                      // one state that depends on nothing.
                      setAuthStep("identifier");
                      setVerificationResumed(false);
                    }}
                  />
                ) : (
                  <AuthFlow
                    step={authStep}
                    onStepChange={(step) => {
                      setAuthStep(step);
                      // Only the register step wants the remembered address;
                      // carrying it anywhere else would re-fill a field the
                      // visitor has deliberately moved away from.
                      if (step !== "register") setAttemptedIdentifier("");
                    }}
                    initialIdentifier={attemptedIdentifier}
                    lastAccount={lastAccount}
                    onDismissLastAccount={() => {
                      clearLastAccount();
                      setLastAccount(null);
                    }}
                    onUnverifiedAccount={(unverifiedEmail) => {
                      // Resume the flow the visitor is already in. The account
                      // exists but its address is unconfirmed, so the next step
                      // is the confirmation screen — not a passwordless sign-in
                      // link, which arrives as a different email with different
                      // copy and drops the resend / "check again" affordances.
                      setEmailForVerification(unverifiedEmail);
                      setVerificationResumed(true);
                      setShowEmailVerification(true);
                    }}
                    // Settles portal authority BEFORE a phone OTP is sent, so a
                    // chef's number is refused without an SMS leaving the
                    // building and without a Firebase identity being minted for
                    // an account we were about to reject. AuthFlow puts the card
                    // back on the gate itself; the host owns the alert.
                    portal="manager"
                    onPortalRejected={showWrongPortalAlert}
                    // Leaving the register step for the identifier step abandons a Google
                    // registration started there — and that path has no page load, so the
                    // load-time sweep cannot see it.
                    onDiscardPendingGoogleRegistration={() => void discardPendingGoogleRegistration()}
                    loginProps={{
                      onSuccess: async () => {
                        await finishAuthentication();
                      },
                      setHasAttemptedLogin: setHasAttemptedLogin,
                      animateEntrance: false,
                    }}
                    registerProps={{
                      accountType: "manager",
                      hideApplyingToggle: true,
                      onSuccess: async () => {
                        logger.info("🎯 GOOGLE REGISTRATION SUCCESS - Invalidating cache and refreshing data");
                        await finishAuthentication();
                      },
                      setHasAttemptedLogin: setHasAttemptedLogin,
                      onRegistrationStart: handleRegistrationStart,
                      onRegistrationComplete: handleRegistrationSuccess,
                      onRegistrationError: handleRegistrationError,
                      animateEntrance: false,
                    }}
                    onGoogleSignIn={handleGoogleSignIn}
                    onPhoneExistingUser={async () => {
                      await finishAuthentication();
                    }}
                  />
                )}

              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </>
  );
}
