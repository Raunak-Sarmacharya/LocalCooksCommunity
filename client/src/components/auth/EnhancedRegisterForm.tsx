import { useCustomAlerts } from '@/components/ui/custom-alerts';
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { sendEmailVerification } from "firebase/auth";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { Lock, Mail, User } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import AnimatedButton from "./AnimatedButton";
import AnimatedInput from "./AnimatedInput";
import EmailVerificationScreen from "./EmailVerificationScreen";
import LoadingOverlay from "./LoadingOverlay";

const registerSchema = z.object({
  displayName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/\d/, "Password must contain at least one number"),
});

type RegisterFormData = z.infer<typeof registerSchema>;

interface EnhancedRegisterFormProps {
  onSuccess?: () => void;
  setHasAttemptedLogin?: (v: boolean) => void;
  onRegistrationStart?: () => void; // Called when registration starts, parent shows loading overlay
  onRegistrationComplete?: (email: string) => void; // Called when registration succeeds, parent handles verification screen
  onRegistrationError?: () => void; // Called when registration fails, parent hides loading overlay
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

export default function EnhancedRegisterForm({ onSuccess, setHasAttemptedLogin, onRegistrationStart, onRegistrationComplete, onRegistrationError }: EnhancedRegisterFormProps) {
  const { signup, signInWithGoogle, loading, error } = useFirebaseAuth();
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [formError, setFormError] = useState<string | null>(null);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState("");
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const { showAlert } = useCustomAlerts();

  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: "", email: "", password: "" },
  });

  const handleSubmit = async (data: RegisterFormData) => {
    setHasAttemptedLogin?.(true);
    setFormError(null);
    setAuthState('loading');

    // If parent provides loading overlay callback, use it (parent handles loading overlay)
    // Otherwise, use local state (backward compatibility)
    if (onRegistrationStart) {
      onRegistrationStart();
    } else {
      setShowLoadingOverlay(true);
    }

    try {
      // SECURITY FIX: Removed email existence check to prevent enumeration attacks
      // Users should attempt registration directly, and Firebase will handle duplicate detection
      console.log(`🔒 Proceeding with registration for: ${data.email} (security: no pre-check)`);

      // Step 2: Proceed with Firebase registration
      console.log(`✅ Proceeding with Firebase registration: ${data.email}`);

      await Promise.all([
        signup(data.email, data.password, data.displayName),
        new Promise(resolve => setTimeout(resolve, 1200)) // Minimum loading time for UX
      ]);

      // Firebase verification email is sent automatically by useFirebaseAuth.signup()
      console.log('✅ Registration successful - Firebase email verification handled automatically');

      // Step 3: Show email verification screen
      console.log('✅ Registration successful, showing verification screen');
      setAuthState('success');
      setShowLoadingOverlay(false);

      // If parent provides onRegistrationComplete callback, use it (parent handles verification screen)
      // Otherwise, use local state (backward compatibility)
      if (onRegistrationComplete) {
        onRegistrationComplete(data.email);
      } else {
        setEmailForVerification(data.email);
        setShowEmailVerification(true);
      }

    } catch (e: any) {
      // Hide loading overlay (parent or local)
      if (onRegistrationError) {
        onRegistrationError();
      } else {
        setShowLoadingOverlay(false);
      }
      setAuthState('error');

      // Handle Firebase-specific errors with user-friendly messages via custom alerts
      const errorTitle = "Registration Failed";
      let errorMessage = "";

      if (e.message.includes('EMAIL_EXISTS') || e.message.includes('email-already-in-use')) {
        errorMessage = 'This email is already registered. Please try signing in instead.';
      } else if (e.message.includes('weak-password')) {
        errorMessage = 'Password is too weak. Please choose a stronger password with at least 8 characters.';
      } else if (e.message.includes('invalid-email')) {
        errorMessage = 'Please enter a valid email address.';
      } else if (e.message.includes('operation-not-allowed')) {
        errorMessage = 'Email registration is currently disabled. Please contact support.';
      } else if (e.message.includes('network-request-failed')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      } else {
        errorMessage = 'Registration failed. Please try again later.';
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
    // NOTE: Don't call setHasAttemptedLogin here - only call it after successful registration
    // via onSuccess() callback. Calling it here causes the useEffect in EnhancedAuthPage to
    // run before the user profile exists, setting hasCheckedUser.current = true prematurely.
    setFormError(null);
    setAuthState('loading');
    setShowLoadingOverlay(true);

    try {
      // Start Google registration
      await signInWithGoogle(true); // Pass true for registration

      // Wait for sync to complete - poll for user profile to be available
      let attempts = 0;
      const maxAttempts = 20; // 10 seconds max (20 * 500ms)

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check if user profile is available
        try {
          const { auth } = await import('@/lib/firebase');
          const currentUser = auth.currentUser;
          if (currentUser) {
            const token = await currentUser.getIdToken();
            const response = await fetch('/api/user/profile', {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            });

            if (response.ok) {
              // User profile is available, sync is complete
              console.log('✅ User profile available, registration complete');
              break;
            }
          }
        } catch (err) {
          // Continue polling
        }

        attempts++;
      }

      if (attempts >= maxAttempts) {
        console.warn('⚠️ Registration sync timeout, but proceeding anyway');
      }

      setAuthState('success');
      setShowLoadingOverlay(false);

      // Check if manager and redirect directly, otherwise call onSuccess immediately
      // Don't delay - the parent component needs to re-render to show welcome screen
      try {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth.currentUser;
        if (currentUser) {
          const token = await currentUser.getIdToken();
          const response = await fetch('/api/user/profile', {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });

          if (response.ok) {
            const userData = await response.json();
            // If manager, redirect directly to manager dashboard
            if (userData.role === 'manager') {
              console.log('🏢 Manager registered - redirecting to manager dashboard');
              window.location.href = '/manager/dashboard';
              return;
            }
          }
        }
      } catch (err) {
        console.error('Error checking user role after registration:', err);
      }

      // Call onSuccess immediately for non-managers to trigger welcome screen
      console.log('🎯 Calling onSuccess to trigger welcome screen');
      if (onSuccess) onSuccess();

    } catch (e: any) {
      setShowLoadingOverlay(false);
      setAuthState('error');

      // Handle Google registration errors with user-friendly messages via custom alerts
      const errorTitle = "Google Registration Failed";
      let errorMessage = "";

      if (e.message.includes('popup-closed-by-user')) {
        errorMessage = 'Registration was cancelled. Please try again.';
      } else if (e.message.includes('popup-blocked')) {
        errorMessage = 'Pop-up blocked. Please allow pop-ups for this site and try again.';
      } else if (e.message.includes('network-request-failed')) {
        errorMessage = 'Network error. Please check your connection and try again.';
      } else if (e.message.includes('email-already-in-use')) {
        errorMessage = 'This Google account is already registered. Please try signing in instead.';
      } else {
        errorMessage = 'Unable to register with Google at this time. Please try again later.';
      }

      showAlert({
        title: errorTitle,
        description: errorMessage,
        type: "error"
      });
    }
  };

  const handleResendVerification = async () => {
    try {
      // Get the current Firebase user (may need to sign in temporarily)
      const currentUser = auth.currentUser;

      if (currentUser) {
        // User is still signed in, send verification directly
        console.log('📧 Resending Firebase verification email...');
        const hostname = window.location.hostname;
        const isLocalhost = hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname.endsWith('.localhost');

        if (isLocalhost) {
          // Simple verification without custom redirect - works on localhost
          await sendEmailVerification(currentUser);
        } else {
          // ENTERPRISE: Determine the correct redirect URL based on subdomain/path context
          // Production subdomains: kitchen.localcooks.ca (managers), chef.localcooks.ca (chefs), admin.localcooks.ca (admins)
          const pathname = window.location.pathname.toLowerCase();
          let redirectUrl = 'https://chef.localcooks.ca/auth?verified=true'; // Default for chefs

          // Detect role from subdomain
          if (hostname.includes('kitchen') || hostname.startsWith('kitchen.')) {
            if (pathname.includes('/manager')) {
              redirectUrl = 'https://kitchen.localcooks.ca/manager/login?verified=true';
            } else {
              redirectUrl = 'https://chef.localcooks.ca/auth?verified=true';
            }
          } else if (hostname.includes('admin') || hostname.startsWith('admin.')) {
            redirectUrl = 'https://admin.localcooks.ca/admin/login?verified=true';
          } else if (hostname.includes('chef') || hostname.startsWith('chef.')) {
            redirectUrl = 'https://chef.localcooks.ca/auth?verified=true';
          } else {
            // Fallback: detect from path
            if (pathname.includes('/admin')) {
              redirectUrl = 'https://admin.localcooks.ca/admin/login?verified=true';
            } else if (pathname.includes('/manager')) {
              redirectUrl = 'https://kitchen.localcooks.ca/manager/login?verified=true';
            }
          }

          console.log(`📧 Using redirect URL: ${redirectUrl}`);
          await sendEmailVerification(currentUser, {
            url: redirectUrl,
            handleCodeInApp: false,
          });
        }
        console.log('✅ Firebase verification email resent successfully');
      } else {
        // User is signed out - they need to use the "resend" flow
        // which requires them to enter their email again
        console.log('⚠️ User is signed out - cannot resend verification email directly');
        console.log('📧 User should check their inbox or try registering again');
        // Don't throw - just log. The email was already sent during registration.
      }
    } catch (error: any) {
      console.error('❌ Failed to resend Firebase verification email:', error);
      throw error; // Re-throw so EmailVerificationScreen can show error
    }
  };

  const getButtonState = () => {
    if (authState === 'loading') return 'loading';
    if (authState === 'success') return 'success';
    if (authState === 'error') return 'error';
    return 'idle';
  };

  const getFieldValidationState = (fieldName: keyof RegisterFormData) => {
    const error = form.formState.errors[fieldName];
    const value = form.watch(fieldName);

    if (error) return 'invalid';
    if (value && !error) return 'valid';
    return 'idle';
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
        message={authState === 'loading' ? "Creating your account..." : "Account created!"}
        submessage={authState === 'loading' ? "Please wait while we set up your account securely." : "Check your email to verify your account."}
        type={authState === 'success' ? 'success' : 'loading'}
      />

      <motion.div
        className="w-full max-w-md mx-auto"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Google Sign Up Button */}
        <motion.div variants={itemVariants} className="mb-6">
          <AnimatedButton
            state={authState === 'loading' ? 'loading' : 'idle'}
            loadingText="Creating account with Google..."
            onClick={handleGoogleSignIn}
            variant="google"
            disabled={authState === 'loading'}
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              <span>Continue with Google</span>
            </div>
          </AnimatedButton>
        </motion.div>

        {/* Divider */}
        <motion.div variants={itemVariants} className="flex items-center my-6">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="mx-3 text-gray-400 text-xs uppercase tracking-wider">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </motion.div>

        {/* Form */}
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
          {/* Error messages now handled by custom alert dialogs */}

          {/* Name Field */}
          <motion.div variants={itemVariants}>
            <AnimatedInput
              label="Full Name"
              type="text"
              icon={<User className="w-4 h-4" />}
              validationState={getFieldValidationState('displayName')}
              error={form.formState.errors.displayName?.message}
              {...form.register('displayName', {
                onChange: () => {
                  // Reset state when user starts typing
                  if (authState === 'error') {
                    setAuthState('idle');
                  }
                }
              })}
            />
          </motion.div>

          {/* Email Field */}
          <motion.div variants={itemVariants}>
            <AnimatedInput
              label="Email Address"
              type="email"
              icon={<Mail className="w-4 h-4" />}
              validationState={getFieldValidationState('email')}
              error={form.formState.errors.email?.message}
              {...form.register('email', {
                onChange: () => {
                  // Reset state when user starts typing
                  if (authState === 'error') {
                    setAuthState('idle');
                  }
                }
              })}
            />
          </motion.div>

          {/* Password Field */}
          <motion.div variants={itemVariants}>
            <AnimatedInput
              label="Password"
              type="password"
              icon={<Lock className="w-4 h-4" />}
              showPasswordToggle
              validationState={getFieldValidationState('password')}
              error={form.formState.errors.password?.message}
              {...form.register('password', {
                onChange: () => {
                  // Reset state when user starts typing
                  if (authState === 'error') {
                    setAuthState('idle');
                  }
                }
              })}
            />
          </motion.div>

          {/* Submit Button */}
          <motion.div variants={itemVariants}>
            <AnimatedButton
              type="submit"
              state={getButtonState()}
              loadingText="Creating your account..."
              successText="Account created!"
              errorText="Try again"
              disabled={authState === 'loading'}
            >
              Create Account
            </AnimatedButton>
          </motion.div>

          {/* Terms and Privacy */}
          <motion.div variants={itemVariants} className="text-center">
            <p className="text-xs text-gray-500 leading-relaxed">
              By creating an account, you agree to our{' '}
              <motion.a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 hover:underline"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Terms & Conditions
              </motion.a>
              {' '}and{' '}
              <motion.a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 hover:underline"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Privacy Policy
              </motion.a>
            </p>
          </motion.div>
        </form>
      </motion.div>
    </>
  );
} 