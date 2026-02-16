import { logger } from "@/lib/logger";
import EnhancedLoginForm from "@/components/auth/EnhancedLoginForm";
import EnhancedRegisterForm from "@/components/auth/EnhancedRegisterForm";
import EmailVerificationScreen from "@/components/auth/EmailVerificationScreen";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LoadingOverlay from "@/components/auth/LoadingOverlay";
import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { sendEmailVerification } from "firebase/auth";
// WelcomeScreen removed - managers use ManagerOnboardingWizard instead
import { motion } from "framer-motion";
import { Building2, Loader2, LogIn, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, Redirect } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs";
import FadeInSection from "@/components/ui/FadeInSection";

export default function ManagerLogin() {
  // Managers now use Firebase authentication (like chefs)
  const [location, setLocation] = useLocation();
  const { user, loading, authPhase, logout, refreshUserData } = useFirebaseAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [userMeta, setUserMeta] = useState<any>(null);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [successMessageType, setSuccessMessageType] = useState<'password-reset' | 'email-verified'>('password-reset');
  
  // ENTERPRISE FIX: Lift email verification state to parent so it persists across auth state changes
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState("");
  
  // ENTERPRISE FIX: Lift loading overlay state to parent so it persists across auth state changes
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Creating your account...");
  const [loadingSubmessage, setLoadingSubmessage] = useState("Please wait while we set up your account securely.");

  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasCheckedUser = useRef(false);
  
  // Handle resend verification email
  const handleResendVerification = async () => {
    try {
      const currentUser = auth.currentUser;
      if (currentUser) {
        logger.info('📧 Resending Firebase verification email...');
        const hostname = window.location.hostname;
        const isLocalhost = hostname === 'localhost' || 
                           hostname === '127.0.0.1' || 
                           hostname.endsWith('.localhost');
        
        if (isLocalhost) {
          await sendEmailVerification(currentUser);
        } else {
          // ENTERPRISE: Use production subdomain for managers
          await sendEmailVerification(currentUser, {
            url: 'https://kitchen.localcooks.ca/manager/login?verified=true',
            handleCodeInApp: false,
          });
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

  // Update userMeta state for backward compatibility
  useEffect(() => {
    if (userMetaData) {
      setUserMeta(userMetaData);
    }
  }, [userMetaData]);

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
      
      if (isManager && userMetaData.is_verified) {
        logger.info('✅ Manager verified - redirecting to dashboard (wizard will show if needed)');
        hasRedirected.current = true;
        setLocation('/manager/dashboard');
      } else if (isManager && !userMetaData.is_verified) {
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
      {/* Loading Overlay - lifted to parent for persistence across auth state changes */}
      <LoadingOverlay 
        isVisible={showLoadingOverlay}
        message={loadingMessage}
        submessage={loadingSubmessage}
        type="loading"
      />
      
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-50">
      {/* Form Section */}
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="w-full md:w-1/2 p-8 flex flex-col justify-center bg-white"
      >
        <div className="max-w-md mx-auto w-full">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mb-8"
          >
            <Logo className="h-12 mb-6" />
            <motion.h1
              className="text-3xl font-bold tracking-tight text-gray-900"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              Manager Portal
            </motion.h1>
            <motion.p
              className="text-gray-600 mt-2 leading-relaxed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              Sign in to access your commercial kitchen dashboard and manage your location
            </motion.p>
          </motion.div>

          {/* Success Messages */}
          {showSuccessMessage && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 rounded-xl bg-green-50 border border-green-200 p-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-5 h-5 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-green-800">
                    {successMessageType === 'password-reset' 
                      ? 'Password reset link sent! Check your email.' 
                      : 'Email verified! You can now sign in.'}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Auth Forms or Email Verification Screen */}
          {showEmailVerification ? (
            <EmailVerificationScreen
              email={emailForVerification}
              onResend={handleResendVerification}
              onGoBack={() => {
                setShowEmailVerification(false);
                setActiveTab('login');
              }}
            />
          ) : (
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "login" | "register")} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="login" className="flex items-center gap-2">
                  <LogIn className="w-4 h-4" />
                  Login
                </TabsTrigger>
                <TabsTrigger value="register" className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4" />
                  Register
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <EnhancedLoginForm
                  onSuccess={async () => {
                    setHasAttemptedLogin(true);
                    // Invalidate stale null profile cache so React Query refetches with the new user
                    await queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
                    await refreshUserData();
                  }}
                  setHasAttemptedLogin={setHasAttemptedLogin}
                />
              </TabsContent>

              <TabsContent value="register">
                <EnhancedRegisterForm
                  onSuccess={async () => {
                    logger.info('🎯 GOOGLE REGISTRATION SUCCESS - Invalidating cache and refreshing data');
                    // ENTERPRISE FIX: Invalidate React Query cache to force refetch of user profile
                    // This ensures the redirect logic has fresh data after Google Sign-In registration
                    await queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
                    setHasAttemptedLogin(true);
                    await refreshUserData();
                    // Force refetch after state update to ensure redirect logic has latest data
                    queryClient.refetchQueries({ queryKey: ["/api/user/profile", user?.uid] });
                  }}
                  setHasAttemptedLogin={setHasAttemptedLogin}
                  onRegistrationStart={handleRegistrationStart}
                  onRegistrationComplete={handleRegistrationSuccess}
                  onRegistrationError={handleRegistrationError}
                />
              </TabsContent>
            </Tabs>
          )}

          {/* Footer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="mt-8 text-center"
          >
            <p className="text-sm text-gray-500">
              Partner commercial kitchen access only
            </p>
          </motion.div>
        </div>
      </motion.div>

      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="w-full md:w-1/2 bg-gradient-to-br from-blue-600 to-blue-800 p-8 flex items-center hidden md:flex relative overflow-hidden"
      >
        {/* Background Pattern */}
        <motion.div
          className="absolute inset-0 opacity-10"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.1 }}
          transition={{ duration: 1, delay: 0.5 }}
        >
          <div className="absolute top-10 left-10 w-20 h-20 bg-white rounded-full" />
          <div className="absolute top-32 right-20 w-16 h-16 bg-white rounded-full" />
          <div className="absolute bottom-20 left-20 w-12 h-12 bg-white rounded-full" />
          <div className="absolute bottom-40 right-10 w-24 h-24 bg-white rounded-full" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="max-w-md mx-auto text-white relative z-10"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mb-8"
          >
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mb-6 backdrop-blur-sm">
              <Building2 className="w-8 h-8 text-white" />
            </div>
          </motion.div>
          
          <motion.h2
            className="text-4xl font-bold mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
            Manage Your Commercial Kitchen
          </motion.h2>
          
          <motion.p
            className="text-white/90 mb-8 text-lg leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            Access your partner dashboard to manage bookings, availability, and chef profiles for your commercial kitchen location.
          </motion.p>
          
          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="space-y-4"
          >
            {[
              "Manage kitchen availability and bookings",
              "Review and approve chef profiles",
              "Track booking analytics and insights",
              "Configure location settings and policies"
            ].map((item, index) => (
              <motion.li
                key={index}
                className="flex items-center"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.8 + index * 0.1 }}
              >
                <motion.div
                  className="rounded-full bg-white/20 p-2 mr-4 backdrop-blur-sm"
                  whileHover={{ scale: 1.1, backgroundColor: "rgba(255,255,255,0.3)" }}
                  transition={{ duration: 0.2 }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20,6 9,17 4,12" />
                  </svg>
                </motion.div>
                <span>{item}</span>
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>
      </motion.div>
    </div>
    </>
  );
}
