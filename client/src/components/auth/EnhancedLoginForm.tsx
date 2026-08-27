import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
  email: z.string().email("Please enter a valid email address"),
});

function useLoginSchema() {
  const { t } = useTranslation("auth");
  return z.object({
    email: z.string().email(t("emailRequired", "Please enter a valid email address")),
  });
}

type LoginFormData = z.infer<typeof loginSchema>;

interface EnhancedLoginFormProps {
  onSuccess?: () => void;
  onSwitchToRegister?: () => void;
  setHasAttemptedLogin?: (v: boolean) => void;
  showVerificationSuccess?: boolean;
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

export default function EnhancedLoginForm({ 
  onSuccess, 
  onSwitchToRegister,
  setHasAttemptedLogin, 
  showVerificationSuccess = false 
}: EnhancedLoginFormProps) {
  const { t } = useTranslation("auth");
  const loginSchema = useLoginSchema();
  const { login, signInWithGoogle, loading, error, resendEmailVerification } = useFirebaseAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState<string>('');
  const [userExists, setUserExists] = useState<boolean | null>(null);
  const [isCheckingUser, setIsCheckingUser] = useState(false);
  const { showAlert } = useCustomAlerts();

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "" },
  });

  // SECURITY FIX: Removed email existence check to prevent enumeration attacks
  // Users should attempt login directly, and the system will handle authentication
  const checkUserExistence = async (email: string) => {
    // Always set to null to prevent UI from showing existence hints
    setUserExists(null);
  };

  const { sendEmailLink } = useFirebaseAuth();

  const handleSubmit = async (data: LoginFormData) => {
    setHasAttemptedLogin?.(true);
    setFormError(null);
    setAuthState('loading');

    const email = data.email.trim();

    try {
      await sendEmailLink(email);
      setAuthState('success');
      showAlert({
        title: t("magicLinkSentTitle", "Magic Link Sent!"),
        description: t("magicLinkSentDesc", "We've sent a sign-in link to your email. Please check your inbox and click the link to sign in."),
        type: "success"
      });
      setTimeout(() => setAuthState('idle'), 4000);
    } catch (e: any) {
      setShowLoadingOverlay(false);
      setAuthState('error');
      
      const errorTitle = t("signInFailedTitle", "Sign In Failed");
      let errorMessage = t("errSignInGeneric", "Unable to send magic link at this time. Please try again later.");
      
      if (e.message.includes('too-many-requests')) {
        errorMessage = t("errTooManyAttempts", "Too many attempts. Please wait a few minutes before trying again.");
      } else if (e.message.includes('network-request-failed')) {
        errorMessage = t("errNetworkFailed", "Network error. Please check your connection and try again.");
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
        setAuthState('idle');
      }, 2000);
    }
  };


  const handleResendVerification = async () => {
    try {
      await resendEmailVerification(emailForVerification, "");
    } catch (err) {
      logger.error('Failed to resend verification from form:', err);
      throw err;
    }
  };

  const getButtonState = () => {
    if (authState === 'loading') return 'loading';
    if (authState === 'success') return 'success';
    if (authState === 'error') return 'error';
    return 'idle';
  };

  const getButtonText = () => {
    return {
      default: t("btnSendMagicLink", "Send Magic Link"),
      loading: t("btnSendingLink", "Sending..."),
      success: t("btnLinkSent", "Link Sent!"),
      error: t("btnTryAgain", "Try again")
    };
  };

  if (showEmailVerification) {
    return (
      <EmailVerificationScreen
        email={emailForVerification}
        onResend={handleResendVerification}
        mode="magic-link"
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
        message={authState === 'loading' ? t("btnSigningYouIn", "Signing you in...") : (userExists === true ? t("btnWelcomeBack", "Welcome back!") : t("btnSignedIn", "Signed in!"))}
        submessage={authState === 'loading' ? t("overlayVerifyCredentials", "Please wait while we verify your credentials securely.") : t("overlayRedirectingDashboard", "Redirecting to your dashboard...")}
        type={authState === 'success' ? 'success' : 'loading'}
      />

      <motion.div
        className="w-full max-w-md mx-auto mt-4"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Google Sign In Button */}
        <motion.div variants={itemVariants} className="mb-6">
          <AnimatedButton
            state={authState === 'loading' ? 'loading' : 'idle'}
            loadingText="Signing in with Google..."
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

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
          {showVerificationSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl bg-green-50 border border-green-200 p-4 flex items-start gap-3 mb-4"
            >
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-green-100 flex items-center justify-center mt-0.5">
                <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-green-800">Email verified successfully!</p>
                <p className="text-xs text-green-600 mt-1">Please log in to access your dashboard.</p>
              </div>
            </motion.div>
          )}

          {/* Error messages now handled by custom alert dialogs */}

          <motion.div variants={itemVariants}>
            <AnimatedInput
              label={t("emailOrUsername", "Email Address or Username")}
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
                    <span className="text-gray-500">{t("statusCheckingAccount", "Checking account...")}</span>
                  ) : userExists === true ? (
                    <span className="text-green-600">{t("statusAccountFound", "✓ Account found - welcome back!")}</span>
                  ) : userExists === false ? (
                    <span className="text-amber-600">{t("statusNoAccountFound", "⚠ No account found - you may need to register first")}</span>
                  ) : null}
                </motion.div>
              )}
            </AnimatePresence>
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


          {onSwitchToRegister && (
            <motion.div variants={itemVariants} className="mt-6 text-center text-sm">
              <span className="text-gray-500">{t("dontHaveAnAccount", "Don't have an account?")}</span>{' '}
              <button
                type="button"
                onClick={onSwitchToRegister}
                className="text-[#F51042] hover:underline font-medium"
              >
                {t("signUpLink", "Sign up")}
              </button>
            </motion.div>
          )}
        </form>
      </motion.div>
    </>
  );
} 