import { useCustomAlerts } from '@/components/ui/custom-alerts';
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { signInWithCustomToken } from "firebase/auth";
// SECURITY FIX: Removed email existence check import to prevent enumeration attacks
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { Lock, Mail } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import AnimatedButton from "./AnimatedButton";
import AnimatedInput from "./AnimatedInput";
import EmailVerificationScreen from "./EmailVerificationScreen";
import LoadingOverlay from "./LoadingOverlay";

const loginSchema = z.object({
  email: z.string().min(1, "Email or username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface EnhancedLoginFormProps {
  onSuccess?: () => void;
  setHasAttemptedLogin?: (v: boolean) => void;
}

type AuthState = 'idle' | 'loading' | 'success' | 'error' | 'email-verification';

const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      staggerChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
};

export default function EnhancedLoginForm({ onSuccess, setHasAttemptedLogin }: EnhancedLoginFormProps) {
  const { login, signInWithGoogle, loading, error } = useFirebaseAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [googleAuthState, setGoogleAuthState] = useState<AuthState>('idle');
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState<string>('');
  const [userExists, setUserExists] = useState<boolean | null>(null);
  const [isCheckingUser, setIsCheckingUser] = useState(false);
  const { showAlert } = useCustomAlerts();

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  // SECURITY FIX: Removed email existence check to prevent enumeration attacks
  // Users should attempt login directly, and the system will handle authentication
  const checkUserExistence = async (email: string) => {
    // Always set to null to prevent UI from showing existence hints
    setUserExists(null);
  };

  const handleSubmit = async (data: LoginFormData) => {
    setHasAttemptedLogin?.(true);
    setFormError(null);
    setAuthState('loading');

    const loginIdentifier = data.email.trim();
    const isEmailFormat = loginIdentifier.includes('@');

    // If it's not an email format (likely a username), try migration login first
    if (!isEmailFormat) {
      console.log('🔄 Username detected, trying migration login for old manager...');
      
      try {
        const migrateResponse = await fetch('/api/manager-migrate-login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: loginIdentifier,
            password: data.password
          })
        });

        if (migrateResponse.ok) {
          const migrateData = await migrateResponse.json();
          
          if (migrateData.customToken) {
            // Sign in with custom token
            const userCredential = await signInWithCustomToken(auth, migrateData.customToken);
            console.log('✅ Migration login successful');
            
            // Force token refresh to ensure it's available immediately
            if (userCredential.user) {
              await userCredential.user.getIdToken(true);
              
              // Trigger user sync with backend to ensure data is available
              // The migration endpoint already linked Firebase UID to Neon user,
              // but we need to ensure the frontend knows about it
              try {
                const token = await userCredential.user.getIdToken();
                const syncResponse = await fetch('/api/user/profile', {
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  }
                });
                
                if (syncResponse.ok) {
                  console.log('✅ User profile synced after migration login');
                } else {
                  console.warn('⚠️ User profile sync returned non-OK status:', syncResponse.status);
                }
              } catch (syncError) {
                console.error('❌ Error syncing user profile after migration:', syncError);
                // Don't fail the login if sync fails - the middleware will handle it
              }
            }
            
            setAuthState('success');
            // Wait a bit longer for auth state to fully update before redirecting
            setTimeout(() => {
              if (onSuccess) onSuccess();
            }, 2000);
            return;
          }
        } else {
          // Migration login failed - try Firebase as fallback if it's an email
          const errorData = await migrateResponse.json().catch(() => ({}));
          console.log('Migration login failed:', errorData);
        }
      } catch (migrateError) {
        console.log('Migration login error, trying Firebase as fallback:', migrateError);
      }
    }

    // Try Firebase login (for email-based accounts or as fallback)
    try {
      // Only try Firebase if it looks like an email, otherwise skip
      if (isEmailFormat) {
        await login(loginIdentifier, data.password);
        // Only set success if we reach this point without errors
        setAuthState('success');
        
        setTimeout(() => {
          if (onSuccess) onSuccess();
        }, 1000);
      } else {
        // Username format and migration failed - show error
        setAuthState('error');
        showAlert({
          title: "Sign In Failed",
          description: "Incorrect username or password. Please check your credentials and try again.",
          type: "error"
        });
        setTimeout(() => setAuthState('idle'), 2000);
      }

    } catch (e: any) {
      // If Firebase login fails, try migration login for old managers (if we haven't already)
      if (isEmailFormat && (e.message.includes('invalid-credential') || e.message.includes('wrong-password') || e.message.includes('user-not-found'))) {
        console.log('🔄 Firebase login failed, trying migration login for old manager...');
        
        try {
          // Try migration login (for old managers with username/password in Neon DB)
          // First try the email as username, then try without @ if it's an email
          const usernameAttempts = [loginIdentifier];
          if (loginIdentifier.includes('@')) {
            // Try the part before @ as username
            usernameAttempts.push(loginIdentifier.split('@')[0]);
          }
          
          for (const usernameAttempt of usernameAttempts) {
            const migrateResponse = await fetch('/api/manager-migrate-login', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                username: usernameAttempt,
                password: data.password
              })
            });

            if (migrateResponse.ok) {
              const migrateData = await migrateResponse.json();
              
              if (migrateData.customToken) {
                // Sign in with custom token
                const userCredential = await signInWithCustomToken(auth, migrateData.customToken);
                console.log('✅ Migration login successful');
                
                // Force token refresh and sync user data
                if (userCredential.user) {
                  await userCredential.user.getIdToken(true);
                  
                  // Trigger user sync with backend
                  try {
                    const token = await userCredential.user.getIdToken();
                    const syncResponse = await fetch('/api/user/profile', {
                      headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                      }
                    });
                    
                    if (syncResponse.ok) {
                      console.log('✅ User profile synced after migration login');
                    }
                  } catch (syncError) {
                    console.error('❌ Error syncing user profile after migration:', syncError);
                  }
                }
                
                setAuthState('success');
                setTimeout(() => {
                  if (onSuccess) onSuccess();
                }, 1000);
                return;
              }
            }
          }
        } catch (migrateError) {
          console.log('Migration login also failed, continuing with Firebase error handling');
        }
      }
      
      // Other Firebase errors (not credential-related)
      setShowLoadingOverlay(false);
      setAuthState('error');
      
      // Handle different Firebase error types with user-friendly messages via custom alerts
      const errorTitle = "Sign In Failed";
      let errorMessage = "";
      
      if (e.message.includes('too-many-requests')) {
        errorMessage = "Too many failed attempts. Please wait a few minutes before trying again.";
      } else if (e.message.includes('network-request-failed')) {
        errorMessage = "Network error. Please check your connection and try again.";
      } else if (e.message.includes('user-disabled')) {
        errorMessage = "This account has been disabled. Please contact support.";
      } else if (e.message.includes('invalid-credential') || e.message.includes('wrong-password') || e.message.includes('user-not-found')) {
        errorMessage = "Incorrect email/username or password. Please check your credentials and try again.";
      } else {
        errorMessage = "Unable to sign in at this time. Please try again later.";
      }
      
      showAlert({
        title: errorTitle,
        description: errorMessage,
        type: "error"
      });
      
      setTimeout(() => setAuthState('idle'), 2000);
    }
  };

  const handleGoogleSignIn = async () => {
    setHasAttemptedLogin?.(true);
    setFormError(null);
    setGoogleAuthState('loading');
    setShowLoadingOverlay(true);

    try {
      await Promise.all([
        signInWithGoogle(),
        new Promise(resolve => setTimeout(resolve, 800))
      ]);

      setGoogleAuthState('success');
      setShowLoadingOverlay(false);
      
      setTimeout(() => {
        if (onSuccess) onSuccess();
      }, 1000);

    } catch (e: any) {
      setShowLoadingOverlay(false);
      setGoogleAuthState('error');
      
      // Handle Google sign-in errors with user-friendly messages via custom alerts
      const errorTitle = "Google Sign In Failed";
      let errorMessage = "";
      
      if (e.message.includes('popup-closed-by-user')) {
        errorMessage = "Sign-in was cancelled. Please try again.";
      } else if (e.message.includes('popup-blocked')) {
        errorMessage = "Pop-up blocked. Please allow pop-ups for this site and try again.";
      } else if (e.message.includes('network-request-failed')) {
        errorMessage = "Network error. Please check your connection and try again.";
      } else if (e.message.includes('not registered')) {
        errorMessage = "This Google account is not registered. Please register first or try signing in with email and password.";
      } else {
        errorMessage = "Unable to sign in with Google at this time. Please try again later.";
      }
      
      showAlert({
        title: errorTitle,
        description: errorMessage,
        type: "error"
      });
      
      setTimeout(() => {
        setGoogleAuthState('idle');
      }, 2000);
    }
  };

  const handleResendVerification = async () => {
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 1000);
    });
  };

  const getButtonState = () => {
    if (authState === 'loading') return 'loading';
    if (authState === 'success') return 'success';
    if (authState === 'error') return 'error';
    return 'idle';
  };

  const getButtonText = () => {
    if (userExists === true) {
      return {
        default: "Welcome back!",
        loading: "Signing you in...",
        success: "Welcome back!",
        error: "Try again"
      };
    } else {
      return {
        default: "Sign In",
        loading: "Signing you in...",
        success: "Signed in!",
        error: "Try again"
      };
    }
  };

  if (showEmailVerification) {
    return (
      <EmailVerificationScreen
        email={emailForVerification}
        onResend={handleResendVerification}
        onGoBack={() => {
          setShowEmailVerification(false);
          setAuthState('idle');
        }}
      />
    );
  }

  return (
    <>
      <LoadingOverlay 
        isVisible={showLoadingOverlay}
        message={googleAuthState === 'loading' ? "Signing you in..." : (userExists === true ? "Welcome back!" : "Signed in!")}
        submessage={googleAuthState === 'loading' ? "Please wait while we verify your credentials securely." : "Redirecting to your dashboard..."}
        type={googleAuthState === 'success' ? 'success' : 'loading'}
      />

      <motion.div
        className="w-full max-w-md mx-auto"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants} className="mb-6">
          <AnimatedButton
            state={googleAuthState === 'loading' ? 'loading' : 'idle'}
            loadingText="Signing in with Google..."
            onClick={handleGoogleSignIn}
            variant="google"
            disabled={googleAuthState === 'loading'}
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span>Continue with Google</span>
            </div>
          </AnimatedButton>
        </motion.div>

        <motion.div variants={itemVariants} className="flex items-center my-6">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="mx-3 text-gray-400 text-xs uppercase tracking-wider">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </motion.div>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
          {/* Error messages now handled by custom alert dialogs */}

          <motion.div variants={itemVariants}>
            <AnimatedInput
              label="Email Address or Username"
              type="text"
              icon={<Mail className="w-4 h-4" />}
              validationState={
                form.formState.errors.email ? 'invalid' : 
                form.watch('email') && !form.formState.errors.email ? 'valid' : 'idle'
              }
              error={form.formState.errors.email?.message}
              {...form.register('email', {
                onChange: (e) => {
                  const email = e.target.value;
                  // Reset state when user starts typing
                  if (authState === 'error') {
                    setAuthState('idle');
                  }
                  if (email && email.includes('@')) {
                    checkUserExistence(email);
                  }
                }
              })}
            />
            {/* User existence status */}
            <AnimatePresence>
              {(isCheckingUser || userExists !== null) && form.watch('email') && form.watch('email').includes('@') && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="mt-2 text-xs"
                >
                  {isCheckingUser ? (
                    <span className="text-gray-500">Checking account...</span>
                  ) : userExists === true ? (
                    <span className="text-green-600">✓ Account found - welcome back!</span>
                  ) : userExists === false ? (
                    <span className="text-amber-600">⚠ No account found - you may need to register first</span>
                  ) : null}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          <motion.div variants={itemVariants}>
            <AnimatedInput
              label="Password"
              type="password"
              icon={<Lock className="w-4 h-4" />}
              showPasswordToggle
              validationState={
                form.formState.errors.password ? 'invalid' : 
                form.watch('password') && !form.formState.errors.password ? 'valid' : 'idle'
              }
              error={form.formState.errors.password?.message}
              {...form.register('password', {
                onChange: () => {
                  // Reset state when user starts typing in password
                  if (authState === 'error') {
                    setAuthState('idle');
                  }
                }
              })}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <AnimatedButton
              type="submit"
              state={getButtonState()}
              loadingText={getButtonText().loading}
              successText={getButtonText().success}
              errorText={getButtonText().error}
              disabled={authState === 'loading'}
            >
              {getButtonText().default}
            </AnimatedButton>
          </motion.div>

          <motion.div variants={itemVariants} className="text-center">
            <motion.button
              type="button"
              onClick={() => {
                // Redirect to dedicated forgot password page
                window.location.href = '/forgot-password';
              }}
              className="text-sm text-blue-600 hover:text-blue-700 hover:underline transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Forgot your password?
            </motion.button>
          </motion.div>
        </form>
      </motion.div>
    </>
  );
} 