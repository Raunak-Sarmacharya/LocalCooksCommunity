import EmailVerificationScreen from "@/components/auth/EmailVerificationScreen";
import LoginForm from "@/components/auth/LoginForm";
import RegisterForm from "@/components/auth/RegisterForm";
import Logo from "@/components/ui/logo";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import WelcomeScreen from "@/pages/welcome-screen";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

// WelcomeScreen component is now imported from @/pages/welcome-screen

export default function AuthPage() {
  const [location, setLocation] = useLocation();
  const { user, loading, logout, updateUserVerification, resendFirebaseVerification } = useFirebaseAuth();
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [userMeta, setUserMeta] = useState<any>(null);
  const [userMetaLoading, setUserMetaLoading] = useState(false);
  const [showVerifyEmail, setShowVerifyEmail] = useState(false);
  const [verifyEmailLoading, setVerifyEmailLoading] = useState(false);
  const [verifyEmailError, setVerifyEmailError] = useState<string | null>(null);
  const [verifyEmailAddress, setVerifyEmailAddress] = useState<string | null>(null);
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasCheckedUser = useRef(false);

  // Email verification success state
  const [showVerificationSuccess, setShowVerificationSuccess] = useState(false);

  const getRedirectPath = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const redirectParam = urlParams.get('redirect');
    
    if (redirectParam) {
      return redirectParam;
    }
    
    // Default redirect based on user role
    if (user?.role === 'admin') {
      return '/admin';
    } else {
      return '/dashboard';
    }
  };

  // Reset initial load after a delay to prevent premature redirects
  useEffect(() => {
    if (isInitialLoad) {
      const timer = setTimeout(() => {
        setIsInitialLoad(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isInitialLoad]);

  // Check for verification success in URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('verified') === 'true') {
      console.log('📧 EMAIL VERIFICATION SUCCESS detected in URL');
      setShowVerificationSuccess(true);
      
      // Clear the URL parameter
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
      
      // Auto-hide success message after 5 seconds (longer for post-verification)
      setTimeout(() => {
        setShowVerificationSuccess(false);
      }, 5000);
    }
  }, []);

  // Fetch user metadata when user is available
  useEffect(() => {
    if (user && !hasCheckedUser.current) {
      hasCheckedUser.current = true;
      
      if (!userMeta && !userMetaLoading) {
        setUserMetaLoading(true);
        
        const fetchUserMeta = async () => {
          try {
            const firebaseUser = auth.currentUser;
            if (!firebaseUser) {
              console.error('❌ No Firebase user available');
              return;
            }

            const token = await firebaseUser.getIdToken();
            console.log('🔥 FETCHING USER META - Firebase UID:', firebaseUser.uid);
            
            const response = await fetch('/api/user', {
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
              
              // Check if user needs email verification
              if (!userData.is_verified) {
                console.log('📧 EMAIL VERIFICATION REQUIRED');
                setVerifyEmailAddress(userData.username || userData.email || '');
                setShowVerifyEmail(true);
                return;
              }
              
              // User is verified and has seen welcome - redirect to dashboard
              const targetPath = userData.role === 'admin' ? '/admin' : '/dashboard';
              console.log(`🚀 REDIRECTING TO: ${targetPath}`);
              
              // Use setTimeout to ensure state is properly set before redirect
              setTimeout(() => {
                setLocation(targetPath);
              }, 500);
              
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
      }
    } else if (!user) {
      // Reset when user logs out
      hasCheckedUser.current = false;
      setUserMeta(null);
    }
  }, [loading, user, setLocation]);

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
        
        // Redirect to appropriate dashboard
        const targetPath = userMeta?.role === 'admin' ? '/admin' : '/dashboard';
        console.log(`🚀 WELCOME COMPLETE - REDIRECTING TO: ${targetPath}`);
        setLocation(targetPath);
      } else {
        console.error('⚠️ Welcome completion API failed:', response.status);
        const errorText = await response.text();
        console.error('⚠️ Error details:', errorText);
        
        // Still redirect on API failure
        const targetPath = userMeta?.role === 'admin' ? '/admin' : '/dashboard';
        console.log(`🔄 REDIRECTING DESPITE ERROR TO: ${targetPath}`);
        setLocation(targetPath);
      }
    } catch (error) {
      console.error('❌ Error completing welcome screen:', error);
      
      // Still redirect on error
      const targetPath = userMeta?.role === 'admin' ? '/admin' : '/dashboard';
      console.log(`🔄 REDIRECTING DESPITE ERROR TO: ${targetPath}`);
      setLocation(targetPath);
    }
  };

  // Loading state
  if (loading || isInitialLoad || userMetaLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // **PRIORITY 1: WELCOME SCREEN**
  // Show welcome screen if user is verified but hasn't seen welcome
  if (userMeta && userMeta.is_verified && !userMeta.has_seen_welcome) {
    console.log('🎉 RENDERING WELCOME SCREEN');
    return <WelcomeScreen onComplete={handleWelcomeContinue} />;
  }

  // **PRIORITY 2: EMAIL VERIFICATION**
  if (showVerifyEmail && verifyEmailAddress) {
    return (
      <EmailVerificationScreen
        email={verifyEmailAddress}
        onResend={async () => {
          setVerifyEmailError(null);
          setVerifyEmailLoading(true);
          try {
            // Use Firebase's built-in verification email resend
            await resendFirebaseVerification();
          } catch (e: any) {
            setVerifyEmailError("Failed to resend verification email. Please try again later.");
          } finally {
            setVerifyEmailLoading(false);
          }
        }}
        onGoBack={() => {
          setShowVerifyEmail(false);
          setHasAttemptedLogin(false);
        }}
        resendLoading={verifyEmailLoading}
      />
    );
  }

  // **EMAIL VERIFICATION SUCCESS MESSAGE**
  const VerificationSuccessMessage = () => (
    <div className="fixed top-4 right-4 z-50">
      <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 max-w-sm">
        <div className="flex-shrink-0">
          <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        </div>
        <div>
          <p className="font-semibold">Email verified successfully!</p>
          <p className="text-sm text-green-600">Please log in to access your dashboard.</p>
        </div>
      </div>
    </div>
  );

  // **PRIORITY 3: ALREADY LOGGED IN**
  // Show friendly message if user is already authenticated and doesn't need welcome/verification
  if (user && !hasAttemptedLogin && !isInitialLoad && userMeta && userMeta.is_verified && userMeta.has_seen_welcome) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Logo className="h-12 mb-6" />
        <h1 className="text-2xl font-bold mb-2">You're already logged in</h1>
        <p className="mb-6 text-gray-600">
          Welcome back, <span className="font-semibold">{user.displayName || user.email}</span>!
        </p>
        <div className="flex gap-4">
          <button
            className="bg-primary text-white px-6 py-2 rounded font-semibold hover:bg-primary/90 transition"
            onClick={() => {
              const targetPath = userMeta.role === 'admin' ? '/admin' : '/dashboard';
              setLocation(targetPath);
            }}
          >
            Go to {userMeta.role === 'admin' ? 'Admin Dashboard' : 'Dashboard'}
          </button>
          <button
            className="bg-gray-100 text-gray-700 px-6 py-2 rounded font-semibold hover:bg-gray-200 transition border border-gray-300"
            onClick={async () => {
              await logout();
              setHasAttemptedLogin(false);
              setIsInitialLoad(true);
              setUserMeta(null);
              hasCheckedUser.current = false;
            }}
          >
            Switch Account
          </button>
        </div>
      </div>
    );
  }

  const handleSuccess = () => {
    setHasAttemptedLogin(true);
  };

  // **DEFAULT: LOGIN/REGISTER FORM**
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center px-4">
      {/* Show verification success message if needed */}
      {showVerificationSuccess && <VerificationSuccessMessage />}
      
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Logo className="h-12 mx-auto mb-6" />
          <h1 className="text-3xl font-bold text-gray-900">Welcome</h1>
          <p className="text-gray-600 mt-2">Join the Local Cooks community</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-gray-50">
              <TabsTrigger value="login" className="text-sm font-medium">Sign In</TabsTrigger>
              <TabsTrigger value="register" className="text-sm font-medium">Sign Up</TabsTrigger>
            </TabsList>

            <div className="p-8">
              <TabsContent value="login" className="space-y-6 mt-0">
                <LoginForm 
                  onSuccess={handleSuccess} 
                  setHasAttemptedLogin={setHasAttemptedLogin}
                />
              </TabsContent>

              <TabsContent value="register" className="space-y-6 mt-0">
                <RegisterForm 
                  onSuccess={handleSuccess}
                  setHasAttemptedLogin={setHasAttemptedLogin}
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <div className="text-center mt-6">
          <p className="text-sm text-gray-500">
            Secure authentication powered by Firebase
          </p>
        </div>
      </div>
    </div>
  );
}