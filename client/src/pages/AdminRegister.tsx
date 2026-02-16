import { logger } from "@/lib/logger";
import EnhancedLoginForm from "@/components/auth/EnhancedLoginForm";
import EnhancedRegisterForm from "@/components/auth/EnhancedRegisterForm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Logo from "@/components/ui/logo";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import WelcomeScreen from "@/pages/welcome-screen";
import { motion } from "framer-motion";
import { Crown, LogIn, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, Redirect } from "wouter";
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs";
import FadeInSection from "@/components/ui/FadeInSection";

export default function AdminRegister() {
  // Admins now use Firebase authentication
  const [location, setLocation] = useLocation();
  const { user, loading, logout, refreshUserData } = useFirebaseAuth();
  const [activeTab, setActiveTab] = useState<"login" | "register">("register");
  const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [userMeta, setUserMeta] = useState<any>(null);
  const [userMetaLoading, setUserMetaLoading] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [successMessageType, setSuccessMessageType] = useState<'password-reset' | 'email-verified'>('password-reset');

  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasCheckedUser = useRef(false);


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
      }, 5000);
    }
    
    if (verified === 'true') {
      setSuccessMessageType('email-verified');
      setShowSuccessMessage(true);
      setActiveTab('login');
      
      window.history.replaceState({}, document.title, window.location.pathname);
      
      setTimeout(() => {
        setShowSuccessMessage(false);
      }, 5000);
    }
  }, []);

  // Check user status and redirect if needed
  useEffect(() => {
    if (loading || isInitialLoad) return;
    
    if (user) {
      logger.info('AdminRegister - User detected:', user);
      
      // Check if user is admin
      if (user.role === 'admin') {
        logger.info('AdminRegister - Admin user detected, redirecting to admin dashboard');
        setLocation('/admin');
        return;
      }
      
      // Redirect non-admin users to their appropriate dashboards
      if (user.role === 'manager') {
        setLocation('/manager/dashboard');
      } else {
        setLocation('/dashboard');
      }
    }
  }, [user, loading, isInitialLoad, setLocation]);

  // Set initial load to false after first render
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsInitialLoad(false);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  // If user is already logged in as admin, redirect immediately
  if (!loading && user && user.role === 'admin') {
    return <Redirect to="/admin" />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-4 relative overflow-hidden">
      <AnimatedBackgroundOrbs />
      
      <div className="w-full max-w-md z-10">
        <FadeInSection>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-8 flex justify-center"
          >
            <Logo />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-slate-200/50 p-6"
          >
            <div className="text-center mb-6">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 mb-4">
                <Crown className="h-8 w-8 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">Admin Portal</h1>
              <p className="text-slate-600">Access the administrative dashboard</p>
            </div>

            {showSuccessMessage && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 p-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm"
              >
                {successMessageType === 'password-reset' 
                  ? 'Password reset successful! You can now log in with your new password.'
                  : 'Email verified successfully! You can now log in.'}
              </motion.div>
            )}

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
                  onSuccess={() => {
                    logger.info('AdminRegister - Login successful, refreshing user data');
                    refreshUserData();
                  }}
                  setHasAttemptedLogin={setHasAttemptedLogin}
                />
              </TabsContent>

              <TabsContent value="register">
                <EnhancedRegisterForm
                  onSuccess={() => {
                    logger.info('AdminRegister - Registration successful');
                    setActiveTab('login');
                  }}
                  setHasAttemptedLogin={setHasAttemptedLogin}
                />
              </TabsContent>
            </Tabs>
          </motion.div>
        </FadeInSection>
      </div>
    </div>
  );
}
