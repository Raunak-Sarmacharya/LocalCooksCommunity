import EmailVerificationScreen from "@/components/auth/EmailVerificationScreen";
import LoginForm from "@/components/auth/LoginForm";
import RegisterForm from "@/components/auth/RegisterForm";
import Logo from "@/components/ui/logo";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import WelcomeScreen from "@/pages/welcome-screen";
import { CheckCircle2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

// WelcomeScreen component is now imported from @/pages/welcome-screen

export default function AuthPage() {
  const [location, setLocation] = useLocation();
  const { user, loading, logout, updateUserVerification } = useFirebaseAuth();
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
            await fetch("/api/auth/send-verification-email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ 
                email: verifyEmailAddress, 
                fullName: user?.displayName || "" 
              })
            });
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
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Form Section */}
      <div className="w-full md:w-1/2 p-8 flex flex-col justify-center">
        <div className="max-w-md mx-auto w-full">
          <div className="mb-8">
            <Logo className="h-12 mb-6" />
            <h1 className="text-2xl font-bold tracking-tight">
              {activeTab === "login" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-muted-foreground mt-2">
              {activeTab === "login"
                ? "Sign in with Google or email to access your account"
                : "Sign up to track your application status"}
            </p>
          </div>

          <Tabs
            defaultValue="login"
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "login" | "register")}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 mb-8">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <LoginForm onSuccess={handleSuccess} setHasAttemptedLogin={setHasAttemptedLogin} />
            </TabsContent>
            <TabsContent value="register">
              <RegisterForm onSuccess={handleSuccess} setHasAttemptedLogin={setHasAttemptedLogin} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Hero Section */}
      <div className="w-full md:w-1/2 bg-gradient-to-br from-orange-50 to-yellow-50 p-8 flex flex-col justify-center">
        <div className="max-w-md mx-auto text-center">
          <div className="mb-8">
            <div className="w-16 h-16 mx-auto mb-4 bg-orange-100 rounded-full flex items-center justify-center">
              <Sparkles className="h-8 w-8 text-orange-600" />
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Join Local Cooks Community
            </h2>
            <p className="text-gray-600 mb-8">
              Connect with local home cooks, discover amazing meals, and become part of a trusted food community.
            </p>
          </div>

          <div className="space-y-4 text-left">
            <div className="flex items-center space-x-3">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              <span className="text-gray-700">Verified home cooks with food safety certifications</span>
            </div>
            <div className="flex items-center space-x-3">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              <span className="text-gray-700">Fresh, homemade meals in your neighborhood</span>
            </div>
            <div className="flex items-center space-x-3">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              <span className="text-gray-700">Secure payment and delivery options</span>
            </div>
            <div className="flex items-center space-x-3">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              <span className="text-gray-700">Support local entrepreneurs in your community</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}