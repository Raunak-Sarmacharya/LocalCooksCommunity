import AnimatedTabs, { AnimatedTabContent } from "@/components/auth/AnimatedTabs";
import EnhancedLoginForm from "@/components/auth/EnhancedLoginForm";
import EnhancedRegisterForm from "@/components/auth/EnhancedRegisterForm";
import VerificationDebug from "@/components/auth/VerificationDebug";
import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import WelcomeScreen from "@/pages/welcome-screen";
import { motion } from "framer-motion";
import { LogIn, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

export default function EnhancedAuthPage() {
  const [location, setLocation] = useLocation();
  const { user, loading, logout, updateUserVerification } = useFirebaseAuth();
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [userMeta, setUserMeta] = useState<any>(null);
  const [userMetaLoading, setUserMetaLoading] = useState(false);
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasCheckedUser = useRef(false);

  // Tab configuration
  const tabs = [
    { value: "login", label: "Sign In", icon: <LogIn className="w-4 h-4" /> },
    { value: "register", label: "Sign Up", icon: <UserPlus className="w-4 h-4" /> }
  ];

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

  // Check if this is an email verification redirect
  const isEmailVerificationRedirect = () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.has('verified') || window.location.href.includes('continueUrl');
    } catch {
      return false;
    }
  };

  // Handle initial load detection
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => setIsInitialLoad(false), 100);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  // Handle email verification redirect
  useEffect(() => {
    if (!loading && user && isEmailVerificationRedirect()) {
      console.log('📧 EMAIL VERIFICATION REDIRECT DETECTED - Updating verification status');
      
      const handleVerificationRedirect = async () => {
        try {
          // Call the auth hook's updateUserVerification function
          const updatedUser = await updateUserVerification();
          
          // Clean up the URL
          window.history.replaceState({}, document.title, window.location.pathname);
          
          console.log('✅ EMAIL VERIFICATION REDIRECT HANDLED:', updatedUser);
          
          // Force a refresh of user meta after verification update
          setTimeout(() => {
            hasCheckedUser.current = false;
          }, 1000);
        } catch (error) {
          console.error('❌ Error handling verification redirect:', error);
        }
      };
      
      handleVerificationRedirect();
    }
  }, [loading, user]);

  // Fetch user metadata to check welcome screen status
  useEffect(() => {
    if (!loading && user && !hasCheckedUser.current) {
      hasCheckedUser.current = true;
      
      const fetchUserMeta = async () => {
        try {
          setUserMetaLoading(true);
          const firebaseUser = auth.currentUser;
          if (!firebaseUser) {
            console.error('❌ No Firebase user available');
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
            console.log('✅ USER DATA FETCHED:', {
              id: userData.id,
              username: userData.username,
              is_verified: userData.is_verified,
              has_seen_welcome: userData.has_seen_welcome,
              role: userData.role
            });
            
            setUserMeta(userData);
            
            // **CRITICAL WELCOME SCREEN LOGIC**
            // Show welcome screen if user is verified but hasn't seen welcome
            if (userData.is_verified && !userData.has_seen_welcome) {
              console.log('🎉 WELCOME SCREEN REQUIRED - User needs onboarding');
              return; // Don't proceed with redirect, let the render logic handle welcome screen
            }
            
            // Check if user needs email verification (for email/password users)
            if (!userData.is_verified) {
              console.log('📧 EMAIL VERIFICATION REQUIRED');
              // For now, we'll redirect to dashboard anyway as verification is handled elsewhere
              // In a full implementation, you might want to show a verification screen here
            }
            
            // User is verified and has seen welcome - redirect to appropriate page
            if (hasAttemptedLogin) {
              const redirectPath = getRedirectPath();
              const targetPath = redirectPath !== '/' ? redirectPath : (userData.role === 'admin' ? '/admin' : '/dashboard');
              console.log(`🚀 REDIRECTING TO: ${targetPath}`);
              
              // Use setTimeout to ensure state is properly set before redirect
              setTimeout(() => {
                setLocation(targetPath);
              }, 500);
            }
            
          } else {
            console.error('❌ Failed to fetch user data:', response.status);
            const errorText = await response.text();
            console.error('❌ Error response:', errorText);
          }
        } catch (error) {
          console.error('❌ Error fetching user meta:', error);
        } finally {
          setUserMetaLoading(false);
        }
      };
      
      fetchUserMeta();
    } else if (!user) {
      // Reset when user logs out
      hasCheckedUser.current = false;
      setUserMeta(null);
    }
  }, [loading, user, hasAttemptedLogin, setLocation]);

  // Handle welcome screen completion
  const handleWelcomeContinue = async () => {
    try {
      console.log('🎉 WELCOME SCREEN COMPLETION STARTED');
      
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        console.error('❌ No Firebase user available for welcome completion');
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
        console.log('✅ WELCOME COMPLETION SUCCESS:', result);
        
        // Update local user meta
        if (userMeta) {
          setUserMeta({
            ...userMeta,
            has_seen_welcome: true
          });
        }
        
        // Redirect to appropriate page
        const redirectPath = getRedirectPath();
        const targetPath = redirectPath !== '/' ? redirectPath : (userMeta?.role === 'admin' ? '/admin' : '/dashboard');
        console.log(`🚀 WELCOME COMPLETE - REDIRECTING TO: ${targetPath}`);
        setLocation(targetPath);
      } else {
        console.error('⚠️ Welcome completion API failed:', response.status);
        const errorText = await response.text();
        console.error('⚠️ Error details:', errorText);
        
        // Still redirect on API failure
        const redirectPath = getRedirectPath();
        const targetPath = redirectPath !== '/' ? redirectPath : (userMeta?.role === 'admin' ? '/admin' : '/dashboard');
        console.log(`🔄 REDIRECTING DESPITE ERROR TO: ${targetPath}`);
        setLocation(targetPath);
      }
    } catch (error) {
      console.error('❌ Error completing welcome screen:', error);
      
      // Still redirect on error
      const redirectPath = getRedirectPath();
      const targetPath = redirectPath !== '/' ? redirectPath : (userMeta?.role === 'admin' ? '/admin' : '/dashboard');
      console.log(`🔄 REDIRECTING DESPITE ERROR TO: ${targetPath}`);
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
      // Check if user needs welcome screen
      if (userMeta.is_verified && !userMeta.has_seen_welcome) {
        console.log('🎉 WELCOME SCREEN REQUIRED - Not redirecting yet');
        return; // Don't redirect, show welcome screen
      }

      // User has seen welcome or doesn't need it - proceed with redirect
      const redirectPath = getRedirectPath();
      const targetPath = redirectPath !== '/' ? redirectPath : (userMeta.role === 'admin' ? '/admin' : '/dashboard');
      
      if (location !== targetPath && targetPath !== '/auth') {
        redirectTimeoutRef.current = setTimeout(() => {
          setLocation(targetPath);
        }, 300);
      }
    }

    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, [user, loading, hasAttemptedLogin, location, isInitialLoad, userMeta]);

  // Loading state
  if (loading || isInitialLoad || userMetaLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="text-center"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"
          />
          <p className="text-gray-600">Loading...</p>
        </motion.div>
      </div>
    );
  }

  // **PRIORITY 1: WELCOME SCREEN**
  // Show welcome screen if user is verified but hasn't seen welcome
  if (userMeta && userMeta.is_verified && !userMeta.has_seen_welcome) {
    console.log('🎉 RENDERING WELCOME SCREEN');
    return <WelcomeScreen onComplete={handleWelcomeContinue} />;
  }

  // Already logged in state - show if user doesn't need welcome screen
  if (user && !hasAttemptedLogin && !isInitialLoad && userMeta && userMeta.is_verified && userMeta.has_seen_welcome) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4"
      >
        <motion.div
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center"
        >
          <Logo className="h-12 mb-6 mx-auto" />
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-2xl font-bold mb-2 text-gray-900"
          >
            You're already signed in
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mb-6 text-gray-600"
          >
            Welcome back, <span className="font-semibold">{user.displayName || user.email}</span>!
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="flex flex-col gap-3"
          >
            <motion.button
              className="bg-primary text-white px-6 py-3 rounded-lg font-semibold transition-all duration-300"
              onClick={() => {
                const redirectPath = getRedirectPath();
                const targetPath = redirectPath !== '/' ? redirectPath : (userMeta.role === 'admin' ? '/admin' : '/dashboard');
                setLocation(targetPath);
              }}
              whileHover={{ scale: 1.02, backgroundColor: "hsl(var(--primary) / 0.9)" }}
              whileTap={{ scale: 0.98 }}
            >
              Go to {userMeta.role === 'admin' ? 'Admin Dashboard' : 'Dashboard'}
            </motion.button>
            <motion.button
              className="bg-gray-100 text-gray-700 px-6 py-3 rounded-lg font-semibold border border-gray-300 transition-all duration-300"
              onClick={async () => {
                await logout();
                setHasAttemptedLogin(false);
                setIsInitialLoad(true);
                setUserMeta(null);
                hasCheckedUser.current = false;
              }}
              whileHover={{ scale: 1.02, backgroundColor: "rgb(243, 244, 246)" }}
              whileTap={{ scale: 0.98 }}
            >
              Switch Account
            </motion.button>
          </motion.div>
        </motion.div>
      </motion.div>
    );
  }

  // Don't render during redirect
  if (user && hasAttemptedLogin && !isInitialLoad && userMeta && userMeta.has_seen_welcome) return null;

  const handleSuccess = () => {
    setHasAttemptedLogin(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 flex flex-col">
      {/* Show welcome screen if user is verified and hasn't seen welcome */}
      {!loading && !userMetaLoading && user && userMeta && userMeta.is_verified && !userMeta.has_seen_welcome && (
        <WelcomeScreen onContinue={handleWelcomeContinue} />
      )}

      {/* Show login/register forms if no user or user hasn't completed verification + welcome flow */}
      {(!user || !userMeta || !userMeta.is_verified || userMeta.has_seen_welcome) && (
        <>
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
              <div className="text-center mb-8">
                <Logo className="mx-auto mb-4" />
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                  Welcome to Local Cooks
                </h1>
                <p className="text-gray-600">
                  Connect with local food enthusiasts and share your culinary journey
                </p>
              </div>

              <div className="bg-white rounded-2xl shadow-xl p-8">
                <AnimatedTabs value={activeTab} onValueChange={setActiveTab} tabs={tabs}>
                  <AnimatedTabContent value="login">
                    <EnhancedLoginForm onSuccess={handleSuccess} />
                  </AnimatedTabContent>
                  <AnimatedTabContent value="register">
                    <EnhancedRegisterForm onSuccess={handleSuccess} />
                  </AnimatedTabContent>
                </AnimatedTabs>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Debug component for development */}
      <VerificationDebug />
    </div>
  );
} 