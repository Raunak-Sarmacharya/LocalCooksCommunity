import EmailVerificationScreen from "@/components/auth/EmailVerificationScreen";
import LoginForm from "@/components/auth/LoginForm";
import RegisterForm from "@/components/auth/RegisterForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  const [showWelcome, setShowWelcome] = useState(false);
  const [userMeta, setUserMeta] = useState<any>(null);
  const [userMetaLoading, setUserMetaLoading] = useState(false);
  const [showVerifyEmail, setShowVerifyEmail] = useState(false);
  const [verifyEmailLoading, setVerifyEmailLoading] = useState(false);
  const [verifyEmailError, setVerifyEmailError] = useState<string | null>(null);
  const [verifyEmailAddress, setVerifyEmailAddress] = useState<string | null>(null);
  const redirectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasCheckedUser = useRef(false);

  // Get redirect path from URL if it exists
  const getRedirectPath = () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const redirectPath = urlParams.get('redirect') || '/';
      // Prevent redirecting back to auth page
      return redirectPath === '/auth' ? '/' : redirectPath;
    } catch {
      return '/';
    }
  };

  // Handle initial load detection
  useEffect(() => {
    if (!loading) {
      // Small delay to let Firebase auth settle
      const timer = setTimeout(() => setIsInitialLoad(false), 100);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  // Fetch user meta after login
  useEffect(() => {
    if (!loading && user) {
      // Always check user meta for authenticated users, but prevent duplicate calls
      // FORCE CHECK for users who might have been redirected here
      if (!hasCheckedUser.current || !userMeta) {
        hasCheckedUser.current = true;
        console.log('🔍 AUTH PAGE DEBUG - Fetching user meta for Firebase user:', user.uid);
        console.log('🔍 AUTH PAGE DEBUG - User object:', user);
        console.log('🔍 AUTH PAGE DEBUG - Current state:', {
          loading,
          hasUser: !!user,
          hasAttemptedLogin,
          isInitialLoad,
          showWelcome,
          showVerifyEmail
        });
        
        const fetchUserMeta = async () => {
          try {
            setUserMetaLoading(true);
            console.log('🔄 Starting user meta fetch...');
            
            // Get Firebase auth token
            const firebaseUser = auth.currentUser;
            if (!firebaseUser) {
              console.error('No Firebase user available');
              return;
            }

            const token = await firebaseUser.getIdToken();
            console.log('🔥 Firebase token obtained:', token ? 'Token exists' : 'No token');
            
            // First ensure user is synced to backend (in case it's a new user)
            try {
              console.log('🔄 Ensuring user is synced to backend...');
              console.log('🔄 Sync data:', {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                emailVerified: user.emailVerified,
                role: user.role || "applicant"
              });
              
              const syncResponse = await fetch("/api/firebase-sync-user", {
                method: "POST",
                headers: { 
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                  uid: user.uid,
                  email: user.email,
                  displayName: user.displayName,
                  emailVerified: user.emailVerified,
                  role: user.role || "applicant"
                })
              });
              
              console.log('🔄 Sync response status:', syncResponse.status);
              if (syncResponse.ok) {
                const syncResult = await syncResponse.json();
                console.log('✅ User sync completed:', syncResult);
              } else {
                const syncError = await syncResponse.text();
                console.error('❌ User sync failed:', syncError);
              }
            } catch (syncError) {
              console.log('⚠️ User sync failed, continuing:', syncError);
            }
            
            console.log('🔥 PRODUCTION DEBUG - Making Firebase API call to /api/user');
            console.log('🔥 PRODUCTION DEBUG - Token exists:', !!token);
            console.log('🔥 PRODUCTION DEBUG - Firebase user UID:', firebaseUser.uid);
            
            const response = await fetch('/api/user', {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            });
            
            console.log('🔥 PRODUCTION DEBUG - API response status:', response.status);
            console.log('🔥 PRODUCTION DEBUG - API response headers:', Object.fromEntries(response.headers.entries()));
            
            if (response.ok) {
              const userData = await response.json();
              console.log('🔍 AUTH PAGE DEBUG - User data from API:', userData);
              console.log('🔍 AUTH PAGE DEBUG - Welcome logic check:', {
                is_verified: userData.is_verified,
                has_seen_welcome: userData.has_seen_welcome,
                shouldShowWelcome: userData.is_verified && !userData.has_seen_welcome,
                is_verified_type: typeof userData.is_verified,
                has_seen_welcome_type: typeof userData.has_seen_welcome
              });
              setUserMeta(userData);
              
              // ENHANCED DEBUG: Log exact values
              console.log('🔍 DETAILED WELCOME CHECK:', {
                'userData.is_verified === true': userData.is_verified === true,
                'userData.has_seen_welcome === false': userData.has_seen_welcome === false,
                'userData.has_seen_welcome === null': userData.has_seen_welcome === null,
                'userData.has_seen_welcome === undefined': userData.has_seen_welcome === undefined,
                'Boolean(userData.is_verified)': Boolean(userData.is_verified),
                '!userData.has_seen_welcome': !userData.has_seen_welcome
              });
              
              // Check if user needs to verify email
              if (!userData.is_verified) {
                console.log('❌ User not verified, showing email verification screen');
                setVerifyEmailAddress(userData.username || userData.email || '');
                setShowVerifyEmail(true);
                return;
              }
              
              // Check if user needs to see welcome screen
              console.log('🔍 WELCOME SCREEN CHECK:', {
                is_verified: userData.is_verified,
                has_seen_welcome: userData.has_seen_welcome,
                shouldShow: userData.is_verified && !userData.has_seen_welcome,
                role: userData.role
              });
              
              // FORCE WELCOME SCREEN FOR FIRST-TIME USERS
              const shouldShowWelcome = userData.is_verified && !userData.has_seen_welcome;
              console.log('🎯 WELCOME DECISION:', shouldShowWelcome);
              
              if (shouldShowWelcome) {
                console.log('🎉 FORCING WELCOME SCREEN - User verified but hasn\'t seen welcome');
                setShowWelcome(true);
                return;
              }
              
              // User is verified and has seen welcome, redirect to appropriate dashboard
              const targetPath = userData.role === 'admin' ? '/admin' : '/dashboard';
              console.log(`✅ User verified and has seen welcome, redirecting to ${targetPath}`);
              // Small delay to ensure proper state management
              setTimeout(() => {
                setLocation(targetPath);
              }, 500);
            } else {
              console.error('❌ Failed to fetch user data:', response.status);
              const errorData = await response.text();
              console.error('❌ Error response:', errorData);
              console.error('❌ Request headers:', {
                'Authorization': `Bearer ${token.substring(0, 20)}...`,
                'Content-Type': 'application/json'
              });
            }
          } catch (error) {
            console.error('Error fetching user meta:', error);
          } finally {
            setUserMetaLoading(false);
          }
        };
        
        fetchUserMeta();
      }
    } else if (!user) {
      // Reset the check when user logs out
      hasCheckedUser.current = false;
    }
  }, [loading, user, setLocation]);

  // Redirect logic - only after initial load is complete
  useEffect(() => {
    // Clear any existing redirect timeout
    if (redirectTimeoutRef.current) {
      clearTimeout(redirectTimeoutRef.current);
      redirectTimeoutRef.current = null;
    }

    // Only handle redirects after initial load and when user is authenticated
    // CRITICAL: Don't redirect if we're still loading user meta or if welcome screen should show
    if (!loading && !isInitialLoad && user && hasAttemptedLogin && !showWelcome && !userMetaLoading && hasCheckedUser.current) {
      const redirectPath = getRedirectPath();
      // Only redirect if we're not already going to the auth page
      if (location !== redirectPath && redirectPath !== '/auth') {
        redirectTimeoutRef.current = setTimeout(() => {
          setLocation(redirectPath);
        }, 300); // Reduced timeout for better UX
      }
    }

    // Cleanup timeout on unmount
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, [user, loading, hasAttemptedLogin, location, isInitialLoad, showWelcome, userMetaLoading]);

  if (loading || isInitialLoad || userMetaLoading) {
    return <div className="flex justify-center items-center min-h-screen">Loading...</div>;
  }

  // Check for new user flag from localStorage
  const isNewUser = localStorage.getItem('localcooks_new_user') === 'true';
  const isFreshGoogleSignIn = localStorage.getItem('localcooks_fresh_google_signin') === 'true';
  
  // If this is a fresh Google sign-in, treat it as an attempted login
  useEffect(() => {
    if (isFreshGoogleSignIn && user) {
      console.log('🔥 FRESH GOOGLE SIGN-IN DETECTED - Setting hasAttemptedLogin to true');
      setHasAttemptedLogin(true);
      localStorage.removeItem('localcooks_fresh_google_signin');
    }
  }, [isFreshGoogleSignIn, user]);
  
  // HIGHEST PRIORITY: Check for welcome screen FIRST before any other logic
  if ((userMeta && userMeta.is_verified && !userMeta.has_seen_welcome) || (isNewUser && userMeta)) {
    console.log('🎉 TOP PRIORITY WELCOME SCREEN - User needs onboarding');
    console.log('🎉 WELCOME SCREEN DATA:', {
      is_verified: userMeta.is_verified,
      has_seen_welcome: userMeta.has_seen_welcome,
      user_id: userMeta.id,
      username: userMeta.username,
      isNewUser: isNewUser
    });
    
    // Clear the new user flag
    localStorage.removeItem('localcooks_new_user');
    
    return <WelcomeScreen onComplete={async () => {
      console.log('🎯 Welcome screen button clicked from top priority check');
      await handleWelcomeContinue();
    }} />;
  }

  // FORCE WELCOME SCREEN FOR TESTING - Remove this after testing
  if (userMeta && userMeta.is_verified && userMeta.has_seen_welcome === false) {
    console.log('🎉 FORCE WELCOME SCREEN - Explicit false check');
    return <WelcomeScreen onComplete={async () => {
      console.log('🎯 Welcome screen button clicked from force check');
      await handleWelcomeContinue();
    }} />;
  }

  // DEBUG: Log current state
  console.log('🔍 AUTH PAGE RENDER DEBUG:', {
    hasUser: !!user,
    hasAttemptedLogin,
    isInitialLoad,
    showWelcome,
    showVerifyEmail,
    hasCheckedUser: hasCheckedUser.current,
    userMeta: userMeta ? { 
      is_verified: userMeta.is_verified, 
      has_seen_welcome: userMeta.has_seen_welcome,
      role: userMeta.role 
    } : null
  });

  // PRIORITY 1: Show welcome screen if conditions are met
  if (userMeta && userMeta.is_verified && !userMeta.has_seen_welcome) {
    console.log('🎉 FORCE SHOWING WELCOME SCREEN - Direct condition check');
    return <WelcomeScreen onComplete={async () => {
      console.log('🎯 Welcome screen button clicked, calling handleWelcomeContinue');
      await handleWelcomeContinue();
    }} />;
  }

  // PRIORITY 2: Show welcome screen if flag is set
  if (showWelcome) {
    console.log('🎉 RENDERING WELCOME SCREEN COMPONENT');
    return <WelcomeScreen onComplete={async () => {
      console.log('🎯 Welcome screen button clicked, calling handleWelcomeContinue');
      await handleWelcomeContinue();
    }} />;
  }

  // Show verify email screen if needed
  if (showVerifyEmail && verifyEmailAddress) {
    return <EmailVerificationScreen
      email={verifyEmailAddress}
      onResend={async () => {
        setVerifyEmailError(null);
        setVerifyEmailLoading(true);
        try {
          await fetch("/api/auth/send-verification-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: verifyEmailAddress, fullName: user?.displayName || "" })
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
    />;
  }

  // If user is already logged in and did NOT just log in, show a friendly message and options
  // But only show this if we're sure the session is established (not during initial load)
  // AND they don't need to see the welcome screen
  const alreadyLoggedInCondition = user && !hasAttemptedLogin && !isInitialLoad && !showWelcome && !(userMeta && userMeta.is_verified && !userMeta.has_seen_welcome);
  
  console.log('🚨 ALREADY LOGGED IN CHECK:', {
    user: !!user,
    hasAttemptedLogin,
    isInitialLoad,
    showWelcome,
    userMeta: userMeta ? { is_verified: userMeta.is_verified, has_seen_welcome: userMeta.has_seen_welcome } : null,
    welcomeCondition: userMeta && userMeta.is_verified && !userMeta.has_seen_welcome,
    finalCondition: alreadyLoggedInCondition
  });
  
  if (alreadyLoggedInCondition) {
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
            onClick={() => setLocation(user.role === 'admin' ? '/admin' : '/dashboard')}
          >
            Go to {user.role === 'admin' ? 'Admin Dashboard' : 'Dashboard'}
          </button>
          <button
            className="bg-gray-100 text-gray-700 px-6 py-2 rounded font-semibold hover:bg-gray-200 transition border border-gray-300"
            onClick={async () => {
              await logout();
              setHasAttemptedLogin(false);
              setIsInitialLoad(true); // Reset initial load state
              // Stay on auth page instead of reloading
            }}
          >
            Switch Account
          </button>
        </div>
      </div>
    );
  }

  // Don't render anything while redirecting, but ONLY if we've checked user meta
  if (user && hasAttemptedLogin && !isInitialLoad && !showWelcome && hasCheckedUser.current) return null;

  const handleSuccess = () => {
    setHasAttemptedLogin(true);
    const redirectPath = getRedirectPath();
    // Only redirect if not going back to auth
    if (redirectPath !== '/auth') {
      // Let the useEffect handle the redirect with proper timing
    }
  };

  const handleWelcomeContinue = async () => {
    try {
      console.log('🎉 Welcome screen continue - setting has_seen_welcome to true');
      
      // Get Firebase auth token
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        console.error('❌ No Firebase user available for welcome completion');
        const targetPath = user?.role === 'admin' ? '/admin' : '/dashboard';
        setLocation(targetPath);
        return;
      }

      console.log(`📤 Sending welcome completion request for user: ${firebaseUser.uid}`);
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
        console.log('✅ Welcome screen API response:', result);
        
        // Get user role for proper redirect
        const targetPath = user?.role === 'admin' ? '/admin' : '/dashboard';
        console.log(`🚀 Welcome completion successful, redirecting to ${targetPath}`);
        setLocation(targetPath);
      } else {
        const errorText = await response.text();
        console.error('⚠️ Failed to update welcome status:', response.status, errorText);
        
        // Still redirect even if update fails
        const targetPath = user?.role === 'admin' ? '/admin' : '/dashboard';
        console.log(`🔄 Redirecting despite API failure to ${targetPath}`);
        setLocation(targetPath);
      }
    } catch (error) {
      console.error('❌ Error updating welcome status:', error);
      
      // Still redirect even if update fails
      const targetPath = user?.role === 'admin' ? '/admin' : '/dashboard';
      console.log(`🔄 Redirecting despite error to ${targetPath}`);
      setLocation(targetPath);
    }
  };

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
      <div className="w-full md:w-1/2 bg-primary p-8 flex items-center hidden md:flex">
        <div className="max-w-md mx-auto text-white">
          <h2 className="text-3xl font-bold mb-4">Join Local Cooks</h2>
          <p className="text-white/90 mb-6">
            Apply to become a verified cook and start your culinary journey with
            us. Create an account to track your application status and get
            updates on your approval process.
          </p>
          <ul className="space-y-3">
            <li className="flex items-center">
              <div className="rounded-full bg-white/20 p-1 mr-3">
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
              </div>
              Monitor your application progress
            </li>
            <li className="flex items-center">
              <div className="rounded-full bg-white/20 p-1 mr-3">
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
              </div>
              Receive updates on your status
            </li>
            <li className="flex items-center">
              <div className="rounded-full bg-white/20 p-1 mr-3">
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
              </div>
              Receive support from our team
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}