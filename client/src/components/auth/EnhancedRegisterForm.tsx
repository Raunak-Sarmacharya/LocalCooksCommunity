import { useCustomAlerts } from '@/components/ui/custom-alerts';
import { useFirebaseAuth } from "@/hooks/use-auth";
import { checkEmailExistsInFirebase } from "@/utils/firebase-check";
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

export default function EnhancedRegisterForm({ onSuccess, setHasAttemptedLogin }: EnhancedRegisterFormProps) {
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
    setShowLoadingOverlay(true);

    try {
      // Step 1: Check if user already exists in Firebase or NeonDB
      console.log(`🔍 Checking if email exists: ${data.email}`);
      
      // First try server-side check
      const checkResponse = await fetch('/api/check-user-exists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: data.email,
        }),
      });

      let canRegister = true;
      let checkData = null;

      if (checkResponse.ok) {
        checkData = await checkResponse.json();
        console.log('📊 Server-side check result:', checkData);

        if (!checkData.canRegister) {
          canRegister = false;
        }
      } else {
        console.warn('📊 Server-side check failed, trying client-side Firebase check');
      }

      // If server-side check failed or Firebase had errors, try client-side check
      if (!checkData || checkData.firebase?.error) {
        console.log(`🔍 Performing client-side Firebase check for: ${data.email}`);
        
        try {
          const clientFirebaseCheck = await checkEmailExistsInFirebase(data.email);
          console.log('🔥 Client-side Firebase check result:', clientFirebaseCheck);
          
          if (clientFirebaseCheck.exists) {
            canRegister = false;
            console.log(`❌ Client-side check: Email exists in Firebase`);
          } else {
            console.log(`✅ Client-side check: Email does not exist in Firebase`);
          }
        } catch (clientError) {
          console.warn('🔥 Client-side Firebase check also failed:', clientError);
          // Continue with registration attempt as last resort
        }
      }

      // Block registration if email exists
      if (!canRegister) {
        setShowLoadingOverlay(false);
        setAuthState('error');
        
        if (checkData?.status === 'exists_firebase' || checkData?.firebase?.exists) {
          setFormError('This email is already registered. Please try logging in instead.');
        } else if (checkData?.status === 'exists_neon') {
          setFormError('This email is already registered in our system. Please try logging in instead.');
        } else if (checkData?.status === 'exists_both') {
          setFormError('This email is already registered. Please try logging in instead.');
        } else {
          setFormError('This email is already in use. Please use a different email or try logging in.');
        }
        return;
      }

      // Step 2: Proceed with Firebase registration
      console.log(`✅ Email available, proceeding with Firebase registration: ${data.email}`);
      
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
      setEmailForVerification(data.email);
      setShowEmailVerification(true);

    } catch (e: any) {
      setShowLoadingOverlay(false);
      setAuthState('error');
      
      // Handle Firebase-specific errors with user-friendly messages via custom alerts
      let errorTitle = "Registration Failed";
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
    setHasAttemptedLogin?.(true);
    setFormError(null);
    setAuthState('loading');
    setShowLoadingOverlay(true);

    try {
      await Promise.all([
        signInWithGoogle(true), // Pass true for registration
        new Promise(resolve => setTimeout(resolve, 800))
      ]);

      setAuthState('success');
      setShowLoadingOverlay(false);
      
      setTimeout(() => {
        if (onSuccess) onSuccess();
      }, 1000);

    } catch (e: any) {
      setShowLoadingOverlay(false);
      setAuthState('error');
      
      // Handle Google registration errors with user-friendly messages via custom alerts
      let errorTitle = "Google Registration Failed";
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
    // This will be handled by EmailVerificationScreen calling resendFirebaseVerification
    // from useFirebaseAuth hook
    console.log('Resend verification requested - will be handled by Firebase');
    return Promise.resolve();
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
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
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