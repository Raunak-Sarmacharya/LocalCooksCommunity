import AnimatedTabs, { AnimatedTabContent } from "@/components/auth/AnimatedTabs";
import EnhancedLoginForm from "@/components/auth/EnhancedLoginForm";
import EnhancedRegisterForm from "@/components/auth/EnhancedRegisterForm";
import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
// WelcomeScreen removed - managers use ManagerOnboardingWizard instead
import { motion } from "framer-motion";
import { Building2, LogIn, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, Redirect } from "wouter";
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs";
import FadeInSection from "@/components/ui/FadeInSection";

export default function ManagerLogin() {
  // Managers now use Firebase authentication (like chefs and delivery partners)
  const [location, setLocation] = useLocation();
  const { user, loading, logout, refreshUserData } = useFirebaseAuth();
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [userMeta, setUserMeta] = useState<any>(null);
  const [userMetaLoading, setUserMetaLoading] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [successMessageType, setSuccessMessageType] = useState<'password-reset' | 'email-verified'>('password-reset');

  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasCheckedUser = useRef(false);

  // Tab configuration
  const tabs = [
    { value: "login", label: "Login", icon: <LogIn className="w-4 h-4" /> },
    { value: "register", label: "Register", icon: <UserPlus className="w-4 h-4" /> }
  ];

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
      console.log('📧 EMAIL VERIFICATION SUCCESS detected in URL');
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
            console.log('✅ MANAGER USER DATA FETCHED:', {
              id: userData.id,
              username: userData.username,
              is_verified: userData.is_verified,
              has_seen_welcome: userData.has_seen_welcome,
              role: userData.role,
              isManager: userData.isManager
            });
            
            setUserMeta(userData);
            
            // Check if user is a manager
            if (userData.role !== 'manager' && !userData.isManager) {
              console.warn('⚠️ User is not a manager, redirecting...');
              // Redirect non-managers to appropriate page
              if (userData.role === 'admin') {
                setLocation('/admin');
              } else {
                setLocation('/dashboard');
              }
              return;
            }
            
            // Check if user needs email verification
            if (!userData.is_verified) {
              console.log('📧 EMAIL VERIFICATION REQUIRED');
              return;
            }
            
            // Managers go to dashboard - ManagerOnboardingWizard will show if needed
            // has_seen_welcome === false means they need onboarding wizard
            console.log('✅ Manager verified - redirecting to dashboard (wizard will show if needed)');
            setLocation('/manager/dashboard');
          }
        } catch (error) {
          console.error('Error fetching user metadata:', error);
        } finally {
          setUserMetaLoading(false);
        }
      };
      
      fetchUserMeta();
    }
  }, [loading, user, setLocation]);

  // Redirect if already logged in as manager
  // Managers go to dashboard - ManagerOnboardingWizard will show if needed
  if (!loading && user && userMeta) {
    const isManager = userMeta.role === 'manager' || userMeta.isManager;
    
    if (isManager) {
      return <Redirect to="/manager/dashboard" />;
    }
  }

  // Show loading state
  if (loading || isInitialLoad || userMetaLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Managers don't use WelcomeScreen - they use ManagerOnboardingWizard on dashboard
  // No welcome screen check needed here

  // Show login/register form
  return (
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

          {/* Auth Forms */}
          <div className="space-y-6">
            <AnimatedTabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={(tab) => setActiveTab(tab as "login" | "register")}
            />
            
            <AnimatedTabContent activeTab={activeTab}>
              {activeTab === "login" ? (
                <EnhancedLoginForm
                  onSuccess={() => {
                    setHasAttemptedLogin(true);
                    refreshUserData();
                  }}
                  setHasAttemptedLogin={setHasAttemptedLogin}
                />
              ) : (
                <EnhancedRegisterForm
                  onSuccess={() => {
                    setHasAttemptedLogin(true);
                    refreshUserData();
                  }}
                  setHasAttemptedLogin={setHasAttemptedLogin}
                />
              )}
            </AnimatedTabContent>
          </div>

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
  );
}
