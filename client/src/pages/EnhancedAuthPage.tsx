import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";
import EnhancedLoginForm from "@/components/auth/EnhancedLoginForm";
import EnhancedRegisterForm from "@/components/auth/EnhancedRegisterForm";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import WelcomeScreen from "@/pages/welcome-screen";
import { motion } from "framer-motion";
import { LogIn, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, Redirect } from "wouter";
import { CURRENT_POLICY_VERSION } from "@/config/policy-version";
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs";
import FadeInSection from "@/components/ui/FadeInSection";
import SEOHead from "@/components/SEO/SEOHead";
import { getChefPostAuthPath } from "@/config/chef-onboarding-steps";
import { hasVerifiedEmail } from "@/lib/auth-verification";
import LoadingOverlay from "@/components/auth/LoadingOverlay";
import ChefAuthShowcase from "@/components/auth/ChefAuthShowcase";
import { getSellerJourneyDraft } from "@/lib/seller-journey";

export default function EnhancedAuthPage() {
  const { t } = useTranslation("auth");
  const [location, setLocation] = useLocation();
  const { user, loading, logout, refreshUserData, handleEmailLinkSignIn } = useFirebaseAuth();
  const [activeTab, setActiveTab] = useState<"login" | "register">(() =>
    new URLSearchParams(window.location.search).get("tab") === "register" ? "register" : "login"
  );
  const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [userMeta, setUserMeta] = useState<any>(null);
  const [userMetaLoading, setUserMetaLoading] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [successMessageType, setSuccessMessageType] = useState<'password-reset' | 'email-verified'>('password-reset');
  const [isCompletingVerification, setIsCompletingVerification] = useState(() =>
    typeof window !== 'undefined' &&
    sessionStorage.getItem('localcooks:completing-verification') === 'true'
  );

  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasCheckedUser = useRef(false);
  const hasUserMetaRef = useRef(false); // Track if userMeta was successfully fetched (avoids stale closure)

  const [retryCount, setRetryCount] = useState(0);
  const sellerJourneyDraft =
    new URLSearchParams(window.location.search).get("journey") === "seller"
      ? getSellerJourneyDraft()
      : null;

  // Check for success messages from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const message = urlParams.get('message');
    const verified = urlParams.get('verified');
    
    if (message === 'password-reset-success') {
      setSuccessMessageType('password-reset');
      setShowSuccessMessage(true);
      setActiveTab('login'); // Switch to login tab
      
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
      setActiveTab('login'); // Switch to login tab so they can sign in
      
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

  // Handle email link sign-in on mount
  useEffect(() => {
    const handleEmailSignIn = async () => {
      try {
        await handleEmailLinkSignIn();
      } catch (error) {
        logger.error('Failed to handle email link sign-in:', error);
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

  // A hard refresh is needed to rebuild auth/profile state after Firebase email
  // verification. Keep the transition covered until the verified profile is
  // ready, so the login form never flashes between verification and welcome.
  useEffect(() => {
    if (
      isCompletingVerification &&
      !loading &&
      !userMetaLoading &&
      user &&
      userMeta &&
      hasVerifiedEmail(user, userMeta)
    ) {
      sessionStorage.removeItem('localcooks:completing-verification');
      setIsCompletingVerification(false);
    }
  }, [isCompletingVerification, loading, userMetaLoading, user, userMeta]);



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
            if (hasVerifiedEmail(user, userData) && !userData.has_seen_welcome) {
              logger.info('🎉 WELCOME SCREEN REQUIRED - User needs onboarding');
              return; // Don't proceed with redirect, let the render logic handle welcome screen
            }
            
            // Check if user needs email verification (for email/password users)
            if (!hasVerifiedEmail(user, userData)) {
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
                setLocation(targetPath);
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
  }, [loading, user, hasAttemptedLogin, retryCount, setLocation]);

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
        setLocation(targetPath);
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
        setLocation(targetPath);
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
      setLocation(targetPath);
    }
  };

  // Redirect logic for authenticated users after login attempt
  useEffect(() => {
    if (redirectTimeoutRef.current) {
      clearTimeout(redirectTimeoutRef.current);
      redirectTimeoutRef.current = null;
    }

    if (!loading && !isInitialLoad && user && hasAttemptedLogin && userMeta) {
      // Email ownership is the first gate. In particular, an authenticated
      // Firebase session exists immediately after registration; that must not
      // be mistaken for a verified session and allowed into onboarding.
      if (!hasVerifiedEmail(user, userMeta)) {
        logger.info('📧 EMAIL VERIFICATION REQUIRED - holding on auth page');
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
          setLocation(`/accept-terms?redirect=${targetPath}`);
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
          setLocation('/admin');
          return;
        } else if (userMeta.role === 'manager') {
          logger.info('🏢 Manager user - skipping welcome screen, redirecting to manager dashboard');
          setLocation('/manager/dashboard');
          return;
        } else {
          logger.info('🎉 WELCOME SCREEN REQUIRED - Not redirecting yet');
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
          setLocation(targetPath);
        }, 300);
      }
    }
  }, [loading, isInitialLoad, user, hasAttemptedLogin, userMeta, location, setLocation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  const handleSuccess = () => {
    logger.info('🎯 AUTH SUCCESS - Setting hasAttemptedLogin to true, hasUserMetaRef:', hasUserMetaRef.current);
    // Only reset hasCheckedUser if userMeta was NOT successfully fetched
    // Use ref instead of state to avoid stale closure issues
    if (!hasUserMetaRef.current) {
      logger.info('🔄 Resetting hasCheckedUser for retry (userMeta not fetched yet)');
      hasCheckedUser.current = false;
      setRetryCount(c => c + 1); // Force a re-render to trigger fetchUserMeta again
    }
    setHasAttemptedLogin(true);
  };

  if (isCompletingVerification) {
    return (
      <LoadingOverlay
        isVisible
        message={t("overlayFinishingAccount", "Finishing your account setup...")}
        submessage={t("overlayPreparingWelcome", "Your email is verified. We're preparing your welcome experience.")}
        type="loading"
      />
    );
  }

  // Skip welcome screen for admins and managers
  // Admins: Go straight to admin dashboard
  // Managers: Go to dashboard where ManagerOnboardingWizard will show
  // Only show welcome screen for chefs
  if (!loading && !userMetaLoading && user && userMeta && hasVerifiedEmail(user, userMeta) && !userMeta.has_seen_welcome) {
    if (userMeta.role === 'admin') {
      return <Redirect to="/admin" />;
    } else if (userMeta.role === 'manager') {
      return <Redirect to="/manager/dashboard" />;
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
        transition={{ duration: 0.5 }}
        className="relative flex min-h-screen bg-[#FFFDFC] lg:h-screen lg:min-h-0 lg:overflow-hidden"
      >
        <ChefAuthShowcase />
        {/* Form Section */}
        <motion.div
          initial={{ opacity: 0, x: 36 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="relative z-10 flex min-h-screen w-full flex-col justify-center bg-white px-6 py-10 sm:px-10 lg:h-screen lg:min-h-0 lg:w-[46%] lg:overflow-hidden lg:px-12 xl:px-16"
        >
          <AnimatedBackgroundOrbs variant="both" intensity="subtle" />
          <div className={`relative z-10 mx-auto w-full max-w-md ${activeTab === "register" ? "auth-register-fit" : ""}`}>
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="mb-7"
            >
              <Logo className="mb-7 h-11" />
              <motion.h1
                className="text-3xl font-bold tracking-[-0.03em] text-gray-950 sm:text-4xl"
                key={activeTab} // Re-animate on tab change
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                {activeTab === "login" ? t("welcomeBack", "Welcome back") : t("createYourAccount", "Create your account")}
              </motion.h1>
              <motion.p
                className="mt-3 max-w-sm text-gray-600 leading-relaxed"
                key={`${activeTab}-subtitle`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.1 }}
              >
                {activeTab === "login"
                  ? t("loginSubtitle", "Sign in to access your Local Cooks account and track your application status")
                  : t("registerSubtitle", "Join Local Cooks and start your culinary journey with us")}
              </motion.p>
            </motion.div>

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
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
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
                    className="flex-shrink-0 text-green-400 hover:text-green-600 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </motion.div>
            )}

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "login" | "register")} className="w-full">
              <TabsList className="mb-6 grid w-full grid-cols-2 rounded-full bg-slate-100/80 p-1">
                <TabsTrigger value="login" className="flex items-center gap-2 rounded-full">
                  <LogIn className="w-4 h-4" />
                  {t("loginTab", "Login")}
                </TabsTrigger>
                <TabsTrigger value="register" className="flex items-center gap-2 rounded-full">
                  <UserPlus className="w-4 h-4" />
                  {t("registerTab", "Register")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <EnhancedLoginForm
                  onSuccess={handleSuccess}
                  setHasAttemptedLogin={setHasAttemptedLogin}
                />
              </TabsContent>

              <TabsContent value="register">
                <EnhancedRegisterForm
                  onSuccess={handleSuccess}
                  setHasAttemptedLogin={setHasAttemptedLogin}
                  hideApplyingToggle
                  initialTermsAccepted={sellerJourneyDraft?.termsAccepted === true}
                  onSwitchToLogin={() => setActiveTab("login")}
                />
              </TabsContent>
            </Tabs>

            {/* Footer Links */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.6 }}
              className="mt-8 text-center"
            >
              <p className="text-sm text-gray-500">
                {activeTab === "login" ? t("noAccount", "Don't have an account?") : t("alreadyHaveAccount", "Already have an account?")}{" "}
                <Button
                  variant="link"
                  className="h-auto p-0 font-semibold text-[#F51042] hover:text-[#D90E3A]"
                  onClick={() => setActiveTab(activeTab === "login" ? "register" : "login")}
                >
                  {activeTab === "login" ? t("registerTab", "Register") : t("loginTab", "Login")}
                </Button>
              </p>
            </motion.div>
          </div>
        </motion.div>

      </motion.div>


    </>
  );
}
