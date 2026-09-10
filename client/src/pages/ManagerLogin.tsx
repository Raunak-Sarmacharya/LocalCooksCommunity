import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";
import EnhancedLoginForm from "@/components/auth/EnhancedLoginForm";
import EnhancedRegisterForm from "@/components/auth/EnhancedRegisterForm";
import { hasVerifiedEmail } from "@/lib/auth-verification";
import EmailVerificationScreen from "@/components/auth/EmailVerificationScreen";
import LoadingOverlay from "@/components/auth/LoadingOverlay";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
// Removed sendEmailVerification from firebase/auth
// WelcomeScreen removed - managers use ManagerOnboardingWizard instead
import { motion, useReducedMotion } from "framer-motion";
import { Check, Loader2, X } from "@/components/ui/manager-icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import KitchenAuthShowcase from "@/components/auth/KitchenAuthShowcase";

export default function ManagerLogin() {
  const { t } = useTranslation("manager");

  // Managers now use Firebase authentication (like chefs)
  const [location, setLocation] = useLocation();
  const { user, loading, authPhase, refreshUserData } = useFirebaseAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"login" | "register">(() =>
    new URLSearchParams(window.location.search).get("tab") === "register" ? "register" : "login"
  );
  const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [successMessageType, setSuccessMessageType] = useState<'password-reset' | 'email-verified'>('password-reset');
  
  // ENTERPRISE FIX: Lift email verification state to parent so it persists across auth state changes
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState("");
  
  // ENTERPRISE FIX: Lift loading overlay state to parent so it persists across auth state changes
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Creating your account...");
  const [loadingSubmessage, setLoadingSubmessage] = useState("Please wait while we set up your account securely.");

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
  }, [activeTab, showEmailVerification, showSuccessMessage]);

  useLayoutEffect(() => {
    authCardRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [activeTab, showEmailVerification]);
  
  // Handle resend verification email
  const handleResendVerification = async () => {
    try {
      const currentUser = auth.currentUser;
      if (currentUser) {
        logger.info('📧 Resending Firebase verification email...');
        // Send custom verification email
        const response = await fetch('/api/firebase/send-verification-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: currentUser.email, role: 'manager' })
        });
        
        if (!response.ok) {
          throw new Error('Failed to send verification email');
        }
        logger.info('✅ Firebase verification email resent successfully');
      } else {
        logger.info('⚠️ User is signed out - verification email was sent during registration');
      }
    } catch (error: any) {
      logger.error('❌ Failed to resend Firebase verification email:', error);
      throw error;
    }
  };
  
  // Callback when registration starts (show loading overlay)
  const handleRegistrationStart = () => {
    logger.info('🔄 Registration started - showing loading overlay');
    setLoadingMessage("Creating your account...");
    setLoadingSubmessage("Please wait while we set up your account securely.");
    setShowLoadingOverlay(true);
  };
  
  // Callback when registration completes successfully
  const handleRegistrationSuccess = (email: string) => {
    logger.info('✅ Registration complete - showing email verification screen');
    // Brief delay to show success state before transitioning
    setLoadingMessage("Account created!");
    setLoadingSubmessage("Redirecting to email verification...");
    
    setTimeout(() => {
      setShowLoadingOverlay(false);
      setEmailForVerification(email);
      setShowEmailVerification(true);
    }, 800); // Show success message briefly before transitioning
  };
  
  // Callback when registration fails
  const handleRegistrationError = () => {
    logger.info('❌ Registration failed - hiding loading overlay');
    setShowLoadingOverlay(false);
  };


  // Check for success messages from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const message = urlParams.get('message');
    const verified = urlParams.get('verified');
    
    if (message === 'password-reset-success') {
      setSuccessMessageType('password-reset');
      setShowSuccessMessage(true);
      setActiveTab('login');
      
      window.history.replaceState({}, document.title, window.location.pathname);
      
      setTimeout(() => {
        setShowSuccessMessage(false);
      }, 8000);
    } else if (verified === 'true') {
      logger.info('📧 EMAIL VERIFICATION SUCCESS detected in URL');
      setSuccessMessageType('email-verified');
      setShowSuccessMessage(true);
      setActiveTab('login');
      
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
    if (!loading && !userMetaLoading && user && userMetaData && location === '/manager/login' && !hasRedirected.current) {
      const isManager = userMetaData.role === 'manager' || userMetaData.isManager;
      
      if (isManager && hasVerifiedEmail(user, userMetaData)) {
        logger.info('✅ Manager verified - redirecting to dashboard (wizard will show if needed)');
        hasRedirected.current = true;
        setLocation('/manager/dashboard');
      } else if (isManager && !hasVerifiedEmail(user, userMetaData)) {
        logger.info('📧 EMAIL VERIFICATION REQUIRED');
        // Stay on login page to show verification message
      } else if (!isManager) {
        logger.warn('⚠️ User is not a manager, redirecting...');
        hasRedirected.current = true;
        // Redirect non-managers to appropriate page
        if (userMetaData.role === 'admin') {
          setLocation('/admin');
        } else {
          setLocation('/dashboard');
        }
      }
    }
    
    // Reset redirect flag if user logs out or location changes away from login
    if (!user || location !== '/manager/login') {
      hasRedirected.current = false;
    }
  }, [loading, userMetaLoading, user, userMetaData, location, setLocation]);

  // ENTERPRISE: Show appropriate loading state based on auth phase
  // This prevents the login form from flashing during Google sign-in
  const isAuthenticating = authPhase === 'authenticating' || authPhase === 'syncing';
  
  // Show loading spinner when auth is in progress OR when login was attempted but profile hasn't loaded yet
  const isAwaitingProfile = hasAttemptedLogin && !!user && !userMetaData;
  if (loading || isInitialLoad || userMetaLoading || isAuthenticating || isAwaitingProfile) {
    // Determine the message based on auth phase
    let loadingText = "Loading...";
    if (authPhase === 'authenticating') {
      loadingText = "Signing you in...";
    } else if (authPhase === 'syncing') {
      loadingText = "Setting up your account...";
    } else if (isAwaitingProfile || userMetaLoading) {
      loadingText = "Signing you in...";
    }
    
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-gray-600">{loadingText}</p>
        </div>
      </div>
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
            <div ref={authContentRef} className="px-6 py-7 sm:px-9 sm:py-9 xl:px-11">
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
                key={showEmailVerification ? "verification" : activeTab}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
                className="w-full"
              >
                {!showEmailVerification && (
                  <div className="mb-6">
                    <h1 className="text-3xl font-bold tracking-[-0.03em] text-gray-950">
                      {activeTab === "login" ? t("welcomeBack", "Welcome back") : t("createYourAccount", "Create your account")}
                    </h1>
                    <p className="mt-2.5 max-w-sm text-sm leading-relaxed text-gray-600">
                      {activeTab === "login"
                        ? t("kitchenLoginSubtitle", "Sign in to manage your kitchen, bookings, and availability")
                        : t("kitchenRegisterSubtitle", "Create an account to list and manage your commercial kitchen")}
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
                        className="flex-shrink-0 text-green-400 transition-colors hover:text-green-600"
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
                    onGoBack={() => {
                      setShowEmailVerification(false);
                      setActiveTab("login");
                    }}
                  />
                ) : activeTab === "login" ? (
                  <EnhancedLoginForm
                    onSuccess={async () => {
                      setHasAttemptedLogin(true);
                      await queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
                      await refreshUserData();
                    }}
                    setHasAttemptedLogin={setHasAttemptedLogin}
                    animateEntrance={false}
                  />
                ) : (
                  <EnhancedRegisterForm
                    accountType="manager"
                    hideApplyingToggle
                    onSuccess={async () => {
                      logger.info("🎯 GOOGLE REGISTRATION SUCCESS - Invalidating cache and refreshing data");
                      await queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
                      setHasAttemptedLogin(true);
                      await refreshUserData();
                      queryClient.refetchQueries({ queryKey: ["/api/user/profile", user?.uid] });
                    }}
                    setHasAttemptedLogin={setHasAttemptedLogin}
                    onRegistrationStart={handleRegistrationStart}
                    onRegistrationComplete={handleRegistrationSuccess}
                    onRegistrationError={handleRegistrationError}
                    onSwitchToLogin={() => setActiveTab("login")}
                    animateEntrance={false}
                  />
                )}

                {!showEmailVerification && activeTab === "login" && (
                  <div className="mt-8 text-center">
                    <p className="text-sm text-gray-500">
                      {t("noKitchenAccount", "Don't have a kitchen account?")} {" "}
                      <Button
                        variant="link"
                        className="h-auto p-0 font-semibold text-[#F51042] hover:text-[#D90E3A]"
                        onClick={() => setActiveTab("register")}
                      >
                        {t("register", "Register")}
                      </Button>
                    </p>
                  </div>
                )}
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </>
  );
}
