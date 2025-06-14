import AnimatedTabs, { AnimatedTabContent } from "@/components/auth/AnimatedTabs";
import EnhancedLoginForm from "@/components/auth/EnhancedLoginForm";
import EnhancedRegisterForm from "@/components/auth/EnhancedRegisterForm";
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
  const { user, loading, logout } = useFirebaseAuth();
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen flex flex-col md:flex-row bg-gray-50"
    >
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
              key={activeTab} // Re-animate on tab change
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              {activeTab === "login" ? "Welcome back" : "Create your account"}
            </motion.h1>
            <motion.p
              className="text-gray-600 mt-2 leading-relaxed"
              key={`${activeTab}-subtitle`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              {activeTab === "login"
                ? "Sign in to access your Local Cooks account and track your application status"
                : "Join Local Cooks and start your culinary journey with us"}
            </motion.p>
          </motion.div>

          {/* Animated Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mb-8"
          >
            <AnimatedTabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={(tab) => setActiveTab(tab as "login" | "register")}
            />
          </motion.div>

          {/* Form Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            <AnimatedTabContent activeTab={activeTab}>
              {activeTab === "login" ? (
                <EnhancedLoginForm
                  onSuccess={handleSuccess}
                  setHasAttemptedLogin={setHasAttemptedLogin}
                />
              ) : (
                <EnhancedRegisterForm
                  onSuccess={handleSuccess}
                  setHasAttemptedLogin={setHasAttemptedLogin}
                />
              )}
            </AnimatedTabContent>
          </motion.div>

          {/* Footer Links */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="mt-8 text-center"
          >
            <p className="text-sm text-gray-500">
              {activeTab === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
              <motion.button
                className="text-blue-600 hover:text-blue-700 font-semibold hover:underline transition-colors"
                onClick={() => setActiveTab(activeTab === "login" ? "register" : "login")}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {activeTab === "login" ? "Sign up" : "Sign in"}
              </motion.button>
            </p>
          </motion.div>
        </div>
      </motion.div>

      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="w-full md:w-1/2 bg-gradient-to-br from-primary to-primary/80 p-8 flex items-center hidden md:flex relative overflow-hidden"
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
          <motion.h2
            className="text-4xl font-bold mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
            Join Local Cooks
          </motion.h2>
          <motion.p
            className="text-white/90 mb-8 text-lg leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            Apply to become a verified cook and start your culinary journey with us. Track your application status and get updates on your approval process.
          </motion.p>
          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="space-y-4"
          >
            {[
              "Monitor your application progress",
              "Receive updates on your status",
              "Access exclusive cooking resources"
            ].map((item, index) => (
              <motion.li
                key={index}
                className="flex items-center"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.8 + index * 0.1 }}
              >
                <motion.div
                  className="rounded-full bg-white/20 p-2 mr-4"
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
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                </motion.div>
                <span className="text-white/90">{item}</span>
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>
      </motion.div>
    </motion.div>
  );
} 