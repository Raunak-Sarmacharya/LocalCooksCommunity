import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";
import AuthFlow, { type AuthFlowStep } from "@/components/auth/AuthFlow";
import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import WelcomeScreen from "@/pages/welcome-screen";
import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, Redirect } from "wouter";
import { CURRENT_POLICY_VERSION } from "@/config/policy-version";
import SEOHead from "@/components/SEO/SEOHead";
import { getChefPostAuthPath } from "@/config/chef-onboarding-steps";
import { hasVerifiedContact, hasVerifiedEmail } from "@/lib/auth-verification";
import ChefAuthShowcase from "@/components/auth/ChefAuthShowcase";
import { getSellerJourneyDraft } from "@/lib/seller-journey";
import { addCollection, Icon } from "@iconify/react";
import { icons as mdiIcons } from "@iconify-json/mdi";
import { isPhoneAuthInProgress } from "@/lib/phone-registration";
import { isSignInWithEmailLink } from "firebase/auth";
import AuthLoadingScreen from "@/components/auth/AuthLoadingScreen";
import EmailVerificationScreen from "@/components/auth/EmailVerificationScreen";
import { useAuthTransition } from "@/components/auth/AuthTransition";
import { AUTH_GATE_TIMEOUT_MS } from "@/config/auth-timing";
import { sendVerificationEmailWithFallback } from "@/lib/send-verification-email";
import { clearLastAccount, getLastAccount, type LastAccount } from "@/lib/last-account";
import { useCustomAlerts } from "@/components/ui/custom-alerts";

addCollection(mdiIcons);

export default function EnhancedAuthPage() {
  const { t } = useTranslation("auth");
  const [location, setLocation] = useLocation();
  const {
    user,
    loading,
    logout,
    refreshUserData,
    handleEmailLinkSignIn,
    signInWithGoogle,
    authPhase,
    updateUserVerification,
    discardPendingGoogleRegistration,
  } = useFirebaseAuth();
  const { begin: beginHandoff, end: endHandoff } = useAuthTransition();
  // The same app-wide alert the manager portal raises its wrong-portal refusal with.
  const { showAlert } = useCustomAlerts();
  /**
   * The browser's last account, for the welcome-back card.
   *
   * Declared BEFORE `authStep` because that initializer reads it, and purely local: it must
   * never become a lookup, or this page turns into an account-enumeration oracle.
   */
  const [lastAccount, setLastAccount] = useState<LastAccount | null>(() => getLastAccount());
  const [authStep, setAuthStep] = useState<AuthFlowStep>(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "register") return "register";
    return lastAccount ? "welcome-back" : "identifier";
  });
  const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);
  /**
   * The address typed on the identifier gate, kept so it can be re-seeded when `AuthFlow`
   * REMOUNTS. `AuthFlow`'s state does not survive the loading gate while `authStep` — owned
   * here — does, so without this a chef comes back from the gate to a step whose data is gone.
   */
  const [attemptedIdentifier, setAttemptedIdentifier] = useState("");
  /**
   * True when the verification screen was opened by RESUMING an existing, unconfirmed account
   * rather than by finishing a registration. The two need different exits — see the screen's
   * `onCheckVerified` and `onGoBack`.
   */
  const [verificationResumed, setVerificationResumed] = useState(false);
  // Lifted out of EnhancedRegisterForm: the page gate used to unmount the form
  // the moment Firebase created the user, wiping the in-form verification screen
  // and leaving an empty auth form behind the loader.
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState("");
  const [awaitingEmailVerificationUi, setAwaitingEmailVerificationUi] = useState(false);
  // A magic-link callback is just a /auth URL, so the route alone cannot tell
  // that a sign-in is in flight. Track it explicitly: without this the login
  // form paints while the SDK is still exchanging the link for a session, which
  // is the "I see the login page for a second" report.
  const [emailLinkPending, setEmailLinkPending] = useState(() =>
    isSignInWithEmailLink(auth, window.location.href),
  );
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [userMeta, setUserMeta] = useState<any>(null);
  const [userMetaLoading, setUserMetaLoading] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [successMessageType, setSuccessMessageType] = useState<'password-reset' | 'email-verified'>('password-reset');
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasCheckedUser = useRef(false);
  const hasUserMetaRef = useRef(false); // Track if userMeta was successfully fetched (avoids stale closure)
  const authCardRef = useRef<HTMLDivElement>(null);
  const authContentRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState<number>();
  const reduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    const content = authContentRef.current;
    if (!content) return;
    const measure = () => setCardHeight(content.offsetHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [loading, userMetaLoading, user, userMeta]);

  const [retryCount, setRetryCount] = useState(0);
  const sellerJourneyDraft =
    new URLSearchParams(window.location.search).get("journey") === "seller"
      ? getSellerJourneyDraft()
      : null;
  const completingPhoneSignup = authStep === "register" && isPhoneAuthInProgress();

  // Whether the session is mid-transition and the form must not paint yet.
  // Computed before any early return so the safety valve can depend on it.
  const isAuthenticating = authPhase === 'authenticating' || authPhase === 'syncing';
  // Any signed-in visitor is either on their way out of this page or still
  // being checked, so "user without a profile" always means "not decided yet".
  // Keying this on hasAttemptedLogin instead left a one-render hole: the magic
  // link callback flips `emailLinkPending` off before the profile request has
  // started, and the form painted in that gap.
  const awaitingProfile = !!user && !userMeta;
  // Email verification is a destination on this page. While we are handing off
  // to that screen — or already showing it — the full-page gate must not run:
  // it unmounts AuthFlow and destroys the verification UI.
  const isAuthSettling =
    !showEmailVerification &&
    !awaitingEmailVerificationUi &&
    (loading || isInitialLoad || userMetaLoading || isAuthenticating || awaitingProfile || emailLinkPending);

  const [gateTimedOut, setGateTimedOut] = useState(false);
  useEffect(() => {
    if (!isAuthSettling) {
      setGateTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setGateTimedOut(true), AUTH_GATE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isAuthSettling]);

  useLayoutEffect(() => {
    authCardRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [authStep, showEmailVerification]);

  // Check for success messages from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const message = urlParams.get('message');
    const verified = urlParams.get('verified');
    
    if (message === 'password-reset-success') {
      setSuccessMessageType('password-reset');
      setShowSuccessMessage(true);
      setAuthStep('login'); // Switch to login tab
      
      // Clear the URL parameter
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Hide success message after 8 seconds
      setTimeout(() => {
        setShowSuccessMessage(false);
      }, 8000);
    } else if (verified === 'true') {
      logger.info('📧 EMAIL VERIFICATION SUCCESS detected in URL');
      setSuccessMessageType('email-verified');
      setShowSuccessMessage(true);
      setAuthStep('login'); // Switch to login tab so they can sign in
      
      // Clear the URL parameter
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Hide success message after 10 seconds (longer for post-verification)
      setTimeout(() => {
        setShowSuccessMessage(false);
      }, 10000);
    }
  }, []);

  // Get redirect path from URL
  const getRedirectPath = () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const redirectPath = urlParams.get('redirect') || '/';
      return redirectPath === '/auth' ? '/' : redirectPath;
    } catch {
      return '/';
    }
  };

  /**
   * Leave the auth page behind a loading screen.
   *
   * The handoff overlay is raised *before* the route changes and lives above
   * the router, so it covers the gap between "sign-in finished" and "the
   * dashboard has rendered its data" — the window in which the login form
   * used to flash back.
   */
  // `t` does not keep a stable identity while i18n resources settle, and the
  // redirect effect depends on `navigateAfterAuth`. A fresh identity on every
  // render re-runs that effect, which clears and re-arms its 300 ms timer — so
  // the timer never reaches zero and the redirect never fires. That is a real
  // way to strand someone on this page. Read `t` through a ref so the callback
  // identity depends only on values that genuinely are stable.
  const tRef = useRef(t);
  tRef.current = t;

  const navigateAfterAuth = useCallback(
    (targetPath: string) => {
      beginHandoff(
        tRef.current("btnSigningYouIn", "Signing you in..."),
        tRef.current("overlayRedirectingDashboard", "Redirecting to your dashboard..."),
      );
      setLocation(targetPath, { replace: true });
    },
    [beginHandoff, setLocation],
  );

  const handleRegistrationStart = useCallback(() => {
    // Keep the page gate off for the rest of this registration. As soon as
    // Firebase creates the user, `awaitingProfile` would otherwise swap the
    // whole page for AuthLoadingScreen and unmount the form mid-submit.
    setAwaitingEmailVerificationUi(true);
  }, []);

  const handleRegistrationComplete = useCallback(
    (email: string) => {
      // Phone-verified registrations continue through onSuccess → handleSuccess.
      if (auth.currentUser?.phoneNumber) {
        setAwaitingEmailVerificationUi(false);
        return;
      }
      endHandoff();
      setEmailForVerification(email);
      setShowEmailVerification(true);
      setAwaitingEmailVerificationUi(false);
    },
    [endHandoff],
  );

  const handleRegistrationError = useCallback(() => {
    setAwaitingEmailVerificationUi(false);
  }, []);

  const handleResendVerification = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser?.email) {
      throw new Error("No signed-in user to resend verification for.");
    }
    await sendVerificationEmailWithFallback({
      email: currentUser.email,
      role: "chef",
    });
  }, []);

  // Handle email link sign-in on mount.
  //
  // Runs once. `handleEmailLinkSignIn` is a fresh function on every render, so
  // depending on it re-ran the exchange repeatedly while the sign-in URL was
  // still in the address bar, and every retry after the first failed.
  const emailLinkHandled = useRef(false);
  useEffect(() => {
    if (emailLinkHandled.current) return;
    emailLinkHandled.current = true;

    const handleEmailSignIn = async () => {
      try {
        await handleEmailLinkSignIn();
      } catch (error) {
        logger.error('Failed to handle email link sign-in:', error);
      } finally {
        setEmailLinkPending(false);
      }
    };
    handleEmailSignIn();
  }, [handleEmailLinkSignIn]);


  // Handle initial load detection
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => setIsInitialLoad(false), 100);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  // Fetch user metadata to check welcome screen status
  useEffect(() => {
    if (!loading && user && !hasCheckedUser.current) {
      hasCheckedUser.current = true;
      
      const fetchUserMeta = async () => {
        try {
          setUserMetaLoading(true);
          const firebaseUser = auth.currentUser;
          if (!firebaseUser) {
            logger.error('❌ No Firebase user available');
            return;
          }
          
          const token = await firebaseUser.getIdToken();
          
          const response = await fetch('/api/user/profile', {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });
          
          if (response.ok) {
            const userData = await response.json();
            logger.info('✅ USER DATA FETCHED:', {
              id: userData.id,
              username: userData.username,
              is_verified: userData.is_verified,
              has_seen_welcome: userData.has_seen_welcome,
              role: userData.role,
              isChef: userData.isChef
            });
            
            setUserMeta(userData);
            hasUserMetaRef.current = true; // Mark that we successfully fetched userMeta

            
            // **CRITICAL WELCOME SCREEN LOGIC**
            // Show welcome screen if user is verified but hasn't seen welcome
            if (hasVerifiedContact(user, userData) && !userData.has_seen_welcome) {
              logger.info('🎉 WELCOME SCREEN REQUIRED - User needs onboarding');
              return; // Don't proceed with redirect, let the render logic handle welcome screen
            }
            
            // Check if user needs email verification (for email/password users)
            if (!hasVerifiedContact(user, userData)) {
              logger.info('📧 EMAIL VERIFICATION REQUIRED');
              return; // MUST RETURN HERE so it doesn't execute the redirect logic below which bounces unverified users back to login
            }
            
            // User is verified and has seen welcome - redirect to appropriate page
            if (hasAttemptedLogin) {
              const redirectPath = getRedirectPath();
              const targetPath = redirectPath !== '/' ? redirectPath : (userData.role === 'admin' ? '/admin' : '/dashboard');
              logger.info(`🚀 REDIRECTING TO: ${targetPath}`);
              
              // Use setTimeout to ensure state is properly set before redirect
              setTimeout(() => {
                navigateAfterAuth(targetPath);
              }, 500);
            }
            
          } else {
            logger.error('❌ Failed to fetch user data:', response.status);
            const errorText = await response.text();
            logger.error('❌ Error response:', errorText);
            // If profile doesn't exist yet (404), reset hasCheckedUser so we can retry
            // This handles the case where Google sign-in completes before backend sync
            if (response.status === 404) {
              logger.info('🔄 Profile not found (404) - resetting hasCheckedUser for retry');
              hasCheckedUser.current = false;
            }
          }
        } catch (error) {
          logger.error('❌ Error fetching user meta:', error);
          // Reset on error to allow retry
          hasCheckedUser.current = false;
        } finally {
          setUserMetaLoading(false);
        }
      };
      
      fetchUserMeta();
    } else if (!user) {
      // Reset when user logs out
      hasCheckedUser.current = false;
      hasUserMetaRef.current = false;
      setUserMeta(null);
    }
  }, [loading, user, hasAttemptedLogin, retryCount, navigateAfterAuth]);

  // Handle welcome screen completion
  const handleWelcomeContinue = async () => {
    try {
      logger.info('🎉 WELCOME SCREEN COMPLETION STARTED');
      
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        logger.error('❌ No Firebase user available for welcome completion');
        return;
      }

      const token = await firebaseUser.getIdToken();
      
      const response = await fetch('/api/user/seen-welcome', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const result = await response.json();
        logger.info('✅ WELCOME COMPLETION SUCCESS:', result);
        
        // Update local user meta
        if (userMeta) {
          setUserMeta({
            ...userMeta,
            has_seen_welcome: true
          });
        }
        
        // Redirect based on role:
        // - Admins go to admin dashboard
        // - Chefs go to chef-setup for the existing OnboardJS wizard
        // - Others go to dashboard
        const redirectPath = getRedirectPath();
        let targetPath = redirectPath !== '/' ? redirectPath : '/dashboard';
        
        if (redirectPath === '/' || redirectPath === '/dashboard') {
          if (userMeta?.role === 'admin') {
            targetPath = '/admin';
          } else if (userMeta?.role === 'manager') {
            targetPath = '/manager/dashboard';
          } else {
            targetPath = getChefPostAuthPath(userMeta);
          }
        }
        logger.info(`🚀 WELCOME COMPLETE - REDIRECTING TO: ${targetPath}`);
        navigateAfterAuth(targetPath);
      } else {
        logger.error('⚠️ Welcome completion API failed:', response.status);
        const errorText = await response.text();
        logger.error('⚠️ Error details:', errorText);
        
        let targetPath = '/dashboard';
        if (userMeta?.role === 'admin') {
          targetPath = '/admin';
        } else if (userMeta?.role === 'manager') {
          targetPath = '/manager/dashboard';
        } else {
          targetPath = getChefPostAuthPath(userMeta);
        }
        logger.info(`🔄 REDIRECTING DESPITE ERROR TO: ${targetPath}`);
        navigateAfterAuth(targetPath);
      }
    } catch (error) {
      logger.error('❌ Error completing welcome screen:', error);
      
      let targetPath = '/dashboard';
      if (userMeta?.role === 'admin') {
        targetPath = '/admin';
      } else if (userMeta?.role === 'manager') {
        targetPath = '/manager/dashboard';
      } else {
        targetPath = getChefPostAuthPath(userMeta);
      }
      logger.info(`🔄 REDIRECTING DESPITE ERROR TO: ${targetPath}`);
      navigateAfterAuth(targetPath);
    }
  };

  // Redirect authenticated users away from the auth page. This also handles
  // browser Back restoring /auth after a successful sign-in: hasAttemptedLogin
  // is component-local state and resets when /auth remounts, while the Firebase
  // session remains valid.
  useEffect(() => {
    if (redirectTimeoutRef.current) {
      clearTimeout(redirectTimeoutRef.current);
      redirectTimeoutRef.current = null;
    }

    if (!loading && !isInitialLoad && user && userMeta) {
      // Email ownership is the first gate. In particular, an authenticated
      // Firebase session exists immediately after registration; that must not
      // be mistaken for a verified session and allowed into onboarding.
      if (!hasVerifiedContact(user, userMeta)) {
        logger.info('📧 EMAIL VERIFICATION REQUIRED - holding on auth page');
        // We are staying, so take the cover down. Leaving it up would tell an
        // unverified chef they are being redirected to a dashboard they are
        // not going to see.
        endHandoff();
        const verifyEmail = user.email || userMeta.email || "";
        if (verifyEmail && !showEmailVerification) {
          setEmailForVerification(verifyEmail);
          setShowEmailVerification(true);
        }
        return;
      }

      // Terms acceptance gate
      const needsTermsAcceptance =
        !userMeta.termsAccepted ||
        !userMeta.termsVersion ||
        userMeta.termsVersion !== CURRENT_POLICY_VERSION;

      if (needsTermsAcceptance) {
        const redirectPath = getRedirectPath();
        let targetPath = redirectPath !== '/' ? redirectPath : '/dashboard';

        // Role-aware default redirect for terms acceptance
        if (redirectPath === '/' || redirectPath === '/dashboard') {
          if (userMeta?.role === 'admin') {
            targetPath = '/admin';
          } else if (userMeta?.role === 'manager') {
            targetPath = '/manager/dashboard';
          } else {
            targetPath = getChefPostAuthPath(userMeta);
          }
        }

        logger.info('🔒 TERMS ACCEPTANCE REQUIRED - redirecting to /accept-terms');
        redirectTimeoutRef.current = setTimeout(() => {
          navigateAfterAuth(`/accept-terms?redirect=${targetPath}`);
        }, 300);
        return;
      }

      // Skip welcome screen for admins and managers
      // Admins: Go straight to admin dashboard
      // Managers: Go to dashboard where ManagerOnboardingWizard will show
      // Other users: Show welcome screen if needed
      if (!userMeta.has_seen_welcome) {
        if (userMeta.role === 'admin') {
          logger.info('👑 Admin user - skipping welcome screen, redirecting to admin');
          navigateAfterAuth('/admin');
          return;
        } else if (userMeta.role === 'manager') {
          logger.info('🏢 Manager user - skipping welcome screen, redirecting to manager dashboard');
          navigateAfterAuth('/manager/dashboard');
          return;
        } else {
          logger.info('🎉 WELCOME SCREEN REQUIRED - Not redirecting yet');
          // The welcome screen is a destination. Drop the cover so it is not
          // hidden behind "Redirecting to your dashboard...".
          endHandoff();
          return; // Don't redirect, show welcome screen for chefs
        }
      }

      // User has completed welcome or doesn't need it - proceed with redirect
      const redirectPath = getRedirectPath();
      let targetPath = redirectPath !== '/' ? redirectPath : '/dashboard';
      
      // Smart redirect based on user roles
      if (redirectPath === '/' || redirectPath === '/dashboard') {
        if (userMeta.role === 'admin') {
          targetPath = '/admin';
        } else if (userMeta.role === 'manager') {
          targetPath = '/manager/dashboard';
        } else {
          targetPath = getChefPostAuthPath(userMeta);
        }
      }
      
      if (location !== targetPath && targetPath !== '/auth') {
        redirectTimeoutRef.current = setTimeout(() => {
          navigateAfterAuth(targetPath);
        }, 300);
      }
    }
  }, [loading, isInitialLoad, user, userMeta, location, navigateAfterAuth, endHandoff, showEmailVerification]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  /**
   * The one state that depends on NOTHING, so it is the only honest destination for a visitor
   * whose flow has lost its footing. `AuthFlow`'s state does not survive the loading gate
   * while `authStep` — owned here — does, so a step can outlive the data it needs.
   */
  const recoverToIdentifierStep = () => {
    setAuthStep("identifier");
    setAttemptedIdentifier("");
  };

  /**
   * A manager (or admin) signing in on the CHEF portal.
   *
   * Says nothing about which portal the account DOES belong to, or what role it holds — only
   * that this one is not it. The manager portal's refusal is worded the same way, for the same
   * reason: the visitor already knows their own address, so naming the other portal would tell
   * a stranger which addresses are registered and where. It is also raised BEFORE any SMS is
   * sent, so a refused number never costs a message or mints a Firebase identity.
   */
  const showWrongPortalAlert = () => {
    showAlert({
      title: t("wrongPortalTitle", "This account can't book kitchens"),
      description: t(
        "wrongPortalBody",
        "The account you're using isn't set up for the chef portal. Use the account you book with.",
      ),
      type: "warning",
      confirmText: t("wrongPortalTryAnother", "Try a different account"),
      secondaryText: t("wrongPortalBackHome", "Back to main page"),
      onSecondary: () => setLocation("/"),
    });
  };

  const handleSuccess = async () => {
    logger.info('🎯 AUTH SUCCESS - Setting hasAttemptedLogin to true, hasUserMetaRef:', hasUserMetaRef.current);
    setHasAttemptedLogin(true);

    // Cover the page before any of the work below starts. The redirect is
    // decided later, by an effect with a 300 ms timer; without raising the
    // handoff here that wait happens with the login form back on screen.
    beginHandoff(
      t("btnSigningYouIn", "Signing you in..."),
      t("overlayRedirectingDashboard", "Redirecting to your dashboard..."),
    );

    // Registration completion is authoritative. Consume the freshly returned
    // profile instead of waiting for the earlier page-local request/cache.
    const refreshedUser = await refreshUserData();
    if (refreshedUser) {
      setUserMeta(refreshedUser);
      hasUserMetaRef.current = true;
      hasCheckedUser.current = true;

      if (
        hasVerifiedContact(refreshedUser, refreshedUser) &&
        (!refreshedUser.termsAccepted || refreshedUser.termsVersion !== CURRENT_POLICY_VERSION)
      ) {
        const requestedPath = getRedirectPath();
        const targetPath = requestedPath !== "/"
          ? requestedPath
          : refreshedUser.role === "admin"
            ? "/admin"
            : refreshedUser.role === "manager"
              ? "/manager/dashboard"
              : "/dashboard";
        navigateAfterAuth(`/accept-terms?redirect=${encodeURIComponent(targetPath)}`);
      }
      return;
    }

    logger.info('🔄 Fresh profile unavailable - scheduling one bounded retry');
    // No redirect is coming from this pass, so drop the cover. If the retry
    // succeeds the redirect raises it again.
    endHandoff();
    hasCheckedUser.current = false;
    setRetryCount(c => c + 1);
  };

  const handleCheckVerified = async () => {
    const updatedUser = await updateUserVerification();
    if (!hasVerifiedEmail(auth.currentUser, updatedUser)) return false;
    setShowEmailVerification(false);
    await handleSuccess();
    return true;
  };

  // Hold one loading screen for the whole auth transition.
  //
  // This page used to render the form unconditionally, so a successful sign-in
  // showed the login screen again while the profile was still being fetched and
  // the redirect was still waiting on its 300 ms timer. `ManagerLogin` has had
  // this gate for a long time; the chef entry point never got one.
  if (isAuthSettling && !gateTimedOut) {
    // Is anything actually IN FLIGHT, or are we simply waiting on the session check?
    //
    // A plain refresh lands here with nothing in flight: no sign-in, no profile fetch, no
    // magic-link exchange. The old copy claimed "Signing you in..." for everything that was
    // not `syncing`, so a cold load with no session told the visitor we were logging them in.
    // `ManagerLogin` splits the same way (see its `gateMessage`); this mirrors it.
    //
    // Registration needs no arm of its own: `awaitingEmailVerificationUi` holds this whole
    // gate open while a signup is in progress, so `isRegistering` has no counterpart here.
    const gateBusy = isAuthenticating || userMetaLoading || awaitingProfile || emailLinkPending;

    const gateMessage = gateBusy
      ? authPhase === 'syncing'
        ? t("statusCheckingAccount", "Checking account...")
        : t("btnSigningYouIn", "Signing you in...")
      // Nothing in flight: a cold load waiting on the session check, which may well end
      // with no session at all.
      : t("statusLoading", "Loading...");

    return (
      <AuthLoadingScreen
        message={gateMessage}
        // Same rule as the message: with nothing in flight there are no credentials to
        // verify, so promising to do so is untrue.
        submessage={
          gateBusy
            ? t("overlayVerifyCredentials", "Please wait while we verify your credentials securely.")
            : t("statusPreparing", "Just a moment.")
        }
      />
    );
  }

  // Skip welcome screen for admins and managers
  // Admins: Go straight to admin dashboard
  // Managers: Go to dashboard where ManagerOnboardingWizard will show
  // Only show welcome screen for chefs
  if (!loading && !userMetaLoading && user && userMeta && hasVerifiedContact(user, userMeta) && !userMeta.has_seen_welcome) {
    if (userMeta.role === 'admin') {
      return <Redirect to="/admin" replace />;
    } else if (userMeta.role === 'manager') {
      return <Redirect to="/manager/dashboard" replace />;
    } else {
      return <WelcomeScreen onContinue={handleWelcomeContinue} />;
    }
  }

  // Show the main auth form
  return (
    <>
      <SEOHead
        title={t("seoAuthTitle", "Sign In or Register — Join LocalCooks")}
        description={t("seoAuthDesc", "Create your LocalCooks account or sign in to access commercial kitchen booking, manage your food business, and connect with the local food community in St. John's, Newfoundland.")}
        canonicalUrl="/auth"
        breadcrumbs={[
          { name: "LocalCooks", url: "https://chef.localcooks.ca/" },
          { name: "Sign In", url: "https://chef.localcooks.ca/auth" },
        ]}
      />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex min-h-screen bg-gradient-to-br from-[#F51042] via-[#df123e] to-[#a90c31] lg:h-screen lg:min-h-0 lg:overflow-hidden"
      >
        <ChefAuthShowcase />
        {/* Form Section */}
        <motion.div
          initial={{ opacity: 0, x: 36 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 flex min-h-screen w-full items-center justify-center px-3 py-3 sm:px-6 sm:py-6 lg:h-screen lg:min-h-0 lg:w-[42%] lg:px-5 xl:px-8"
        >
          <motion.div
            initial={false}
            animate={{ height: cardHeight ?? "auto" }}
            transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={{ scrollbarGutter: "stable", overflowAnchor: "none" }}
            ref={authCardRef}
            className="relative z-10 max-h-[calc(100vh-1.5rem)] w-full max-w-[510px] overflow-y-auto rounded-[1.75rem] border border-white/70 bg-[#FFFDFC] shadow-[0_24px_80px_-30px_rgba(69,10,27,0.58)] sm:max-h-[calc(100vh-3rem)] lg:max-h-[calc(100vh-2.5rem)]"
          >
            <div ref={authContentRef} className="px-6 py-7 sm:px-9 sm:py-9 xl:px-11">
            {/* Header */}
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
                  <span className="mt-0.5 text-[9px] font-medium uppercase leading-none tracking-wider text-gray-500/70">For chefs</span>
                </span>
              </a>
            </motion.div>

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
              className="w-full"
            >
              {!showEmailVerification && authStep !== "phone-otp" && authStep !== "google-hint" && authStep !== "methods" && <div className="mb-6">
              <h1 className="text-3xl font-bold tracking-[-0.03em] text-gray-950">
                {authStep === "register"
                  ? completingPhoneSignup
                    ? t("finishSigningUp", "Finish signing up")
                    : t("createYourAccount", "Create your account")
                  : t("loginOrSignUp", "Log in or sign up")}
              </h1>
              <p className="mt-2.5 max-w-sm text-sm leading-relaxed text-gray-600">
                {authStep === "register"
                  ? t("registerSubtitle", "Create an account to sell on our marketplace or book kitchen")
                  : authStep === "identifier"
                    ? t("identifierSubtitle", "Enter your email or phone number to continue")
                    : t("loginSubtitle", "Sign in to manage your storefront and kitchen bookings")}
              </p>
              </div>}

            {/* Success Message for Password Reset */}
            {showSuccessMessage && (
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-green-100 rounded-full flex items-center justify-center">
                    <Icon icon="mdi:check" className="h-4 w-4 text-green-600" aria-hidden />
                  </div>
                  <div className="flex-1">
                    {successMessageType === 'password-reset' ? (
                      <>
                        <p className="text-sm font-medium text-green-800">{t("passwordResetSuccessTitle", "Password reset successful!")}</p>
                        <p className="text-xs text-green-600 mt-1">{t("passwordResetSuccessBody", "You can now sign in with your new password.")}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-green-800">{t("emailVerifiedSuccessTitle", "Email verified successfully!")}</p>
                        <p className="text-xs text-green-600 mt-1">{t("emailVerifiedSuccessBody", "Your account is now verified. Please sign in with your credentials to continue.")}</p>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => setShowSuccessMessage(false)}
                    className="flex-shrink-0 text-primary hover:text-primary/80 transition-colors"
                  >
                    <Icon icon="mdi:close" className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </motion.div>
            )}

            {showEmailVerification ? (
              <EmailVerificationScreen
                email={emailForVerification}
                onResend={handleResendVerification}
                // Only offer "I have verified my email" when there is a session to re-read.
                // On the resume path the visitor is signed OUT — an unconfirmed account has no
                // session — so the check could only ever report "not detected yet", even after
                // they had verified. Omitting it makes the screen fall back to going back,
                // which is the honest next step: sign in with the link in their inbox.
                onCheckVerified={verificationResumed ? undefined : handleCheckVerified}
                onGoBack={() => {
                  setShowEmailVerification(false);
                  setAwaitingEmailVerificationUi(false);
                  // ALWAYS the identifier gate, never the sign-in step. The gate is the one
                  // state that depends on nothing; the sign-in step carries a back control of
                  // its own, so "use a different email" became a two-screen detour through
                  // half-states that got the visitor nowhere. The manager card's behaviour,
                  // mirrored — this was the pre-fix version on the chef side.
                  recoverToIdentifierStep();
                  setVerificationResumed(false);
                }}
              />
            ) : (
              <AuthFlow
                step={authStep}
                onStepChange={(step) => {
                  setAuthStep(step);
                  // Only the register step wants the remembered address; carrying it anywhere
                  // else would re-fill a field the visitor deliberately moved away from.
                  if (step !== "register") setAttemptedIdentifier("");
                }}
                initialIdentifier={attemptedIdentifier}
                lastAccount={lastAccount}
                onDismissLastAccount={() => {
                  clearLastAccount();
                  setLastAccount(null);
                }}
                onUnverifiedAccount={(unverifiedEmail) => {
                  // Resume the flow the visitor is already in. The account exists but its
                  // address is unconfirmed, so the next step is the confirmation screen — NOT
                  // a passwordless sign-in link, which arrives as a different email with
                  // different copy and drops the resend / "check again" affordances. This is
                  // the manager card's behaviour, mirrored.
                  setEmailForVerification(unverifiedEmail);
                  setVerificationResumed(true);
                  setShowEmailVerification(true);
                }}
                // Settles portal authority BEFORE a phone OTP is sent, so a manager's number is
                // refused without an SMS leaving the building and without a Firebase identity
                // being minted for an account we were about to reject. AuthFlow puts the card
                // back on the gate itself; the host owns the alert.
                portal="chef"
                onPortalRejected={showWrongPortalAlert}
                loginProps={{
                  onSuccess: handleSuccess,
                  setHasAttemptedLogin: setHasAttemptedLogin,
                  animateEntrance: false,
                }}
                registerProps={{
                  onSuccess: handleSuccess,
                  setHasAttemptedLogin: setHasAttemptedLogin,
                  hideApplyingToggle: true,
                  initialTermsAccepted: sellerJourneyDraft?.termsAccepted === true,
                  animateEntrance: false,
                  onRegistrationStart: handleRegistrationStart,
                  onRegistrationComplete: handleRegistrationComplete,
                  onRegistrationError: handleRegistrationError,
                }}
                // Leaving the register step for the identifier step abandons a Google
                // registration started there, and that path has no page load — so the
                // load-time sweep cannot see it.
                onDiscardPendingGoogleRegistration={() => void discardPendingGoogleRegistration()}
                onGoogleSignIn={async () => {
                  // Public Google entry is idempotent: existing users sign in;
                  // Firebase-only users are provisioned immediately as chefs.
                  await signInWithGoogle(true, "chef", sellerJourneyDraft?.termsAccepted === true);
                  await handleSuccess();
                }}
                onPhoneExistingUser={handleSuccess}
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
