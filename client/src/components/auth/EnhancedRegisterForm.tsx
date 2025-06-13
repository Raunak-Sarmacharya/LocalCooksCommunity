import { useFirebaseAuth } from "@/hooks/use-auth";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Lock, Mail, User } from "lucide-react";
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
      // Minimum loading time for smooth UX
      await Promise.all([
        signup(data.email, data.password, data.displayName),
        new Promise(resolve => setTimeout(resolve, 1200)) // Slightly longer for registration
      ]);

      setAuthState('success');
      setShowLoadingOverlay(false);
      setEmailForVerification(data.email);
      setShowEmailVerification(true);

    } catch (e: any) {
      setShowLoadingOverlay(false);
      setAuthState('error');
      setFormError(e.message);
    }
  };

  const handleGoogleSignIn = async () => {
    setHasAttemptedLogin?.(true);
    setFormError(null);
    setAuthState('loading');
    setShowLoadingOverlay(true);

    try {
      await Promise.all([
        signInWithGoogle(),
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
      setFormError(e.message);
    }
  };

  const handleResendVerification = async () => {
    // This would typically call a resend verification email function
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
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 48 48">
              <g>
                <path fill="#4285F4" d="M24 9.5c3.54 0 6.7 1.22 9.19 3.23l6.85-6.85C35.64 2.36 30.18 0 24 0 14.82 0 6.73 5.48 2.69 13.44l7.98 6.2C12.13 13.13 17.62 9.5 24 9.5z"/>
                <path fill="#34A853" d="M46.1 24.55c0-1.64-.15-3.22-.43-4.74H24v9.01h12.42c-.54 2.9-2.18 5.36-4.65 7.01l7.19 5.6C43.98 37.36 46.1 31.44 46.1 24.55z"/>
                <path fill="#FBBC05" d="M10.67 28.65c-1.01-2.99-1.01-6.31 0-9.3l-7.98-6.2C.99 17.36 0 20.57 0 24c0 3.43.99 6.64 2.69 9.44l7.98-6.2z"/>
                <path fill="#EA4335" d="M24 48c6.18 0 11.64-2.04 15.54-5.56l-7.19-5.6c-2.01 1.35-4.59 2.16-8.35 2.16-6.38 0-11.87-3.63-14.33-8.94l-7.98 6.2C6.73 42.52 14.82 48 24 48z"/>
                <path fill="none" d="M0 0h48v48H0z"/>
              </g>
            </svg>
            Continue with Google
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
          {/* Error Message */}
          <AnimatePresence>
            {(formError || error) && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="rounded-lg bg-red-50 border border-red-200 p-4 flex items-center gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                <span className="text-red-700 text-sm">{formError || error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Name Field */}
          <motion.div variants={itemVariants}>
            <AnimatedInput
              label="Full Name"
              type="text"
              icon={<User className="w-4 h-4" />}
              validationState={getFieldValidationState('displayName')}
              error={form.formState.errors.displayName?.message}
              {...form.register('displayName')}
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
              {...form.register('email')}
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
              {...form.register('password')}
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
              <motion.button
                type="button"
                className="text-blue-600 hover:text-blue-700 hover:underline"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Terms of Service
              </motion.button>
              {' '}and{' '}
              <motion.button
                type="button"
                className="text-blue-600 hover:text-blue-700 hover:underline"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                Privacy Policy
              </motion.button>
            </p>
          </motion.div>
        </form>
      </motion.div>
    </>
  );
} 