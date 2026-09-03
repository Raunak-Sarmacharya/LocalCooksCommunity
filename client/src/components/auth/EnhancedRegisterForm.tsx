import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";
import { useCustomAlerts } from '@/components/ui/custom-alerts';
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
// Removed sendEmailVerification from firebase/auth
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import AnimatedButton from "./AnimatedButton";
import AnimatedInput from "./AnimatedInput";
import EmailVerificationScreen from "./EmailVerificationScreen";
import TermsAcceptanceInline from "./TermsAcceptanceInline";
import LoadingOverlay from "./LoadingOverlay";
import { getEmailContinueMessage } from "./EmailContinueHint";
import { ArrowLeft, ArrowRight, Lock, Mail, Phone, User } from "lucide-react";
import { phoneNumberSchema } from "@shared/phone-validation";

const registerSchema = z.object({
  displayName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: phoneNumberSchema,
  shopName: z.string().optional(),
  shopAddress: z.string().optional(),
  kitchenPreference: z.enum(["commercial", "home", "notSure"]),
  foodSafetyLicense: z.enum(["yes", "no", "notSure"]),
  foodEstablishmentCert: z.enum(["yes", "no", "notSure"]),
  businessType: z.string().optional(),
  experience: z.string().optional(),
  businessDescription: z.string().optional(),
  usageFrequency: z.string().optional(),
});

function useRegisterSchema() {
  const { t } = useTranslation("auth");
  return z.object({
    displayName: z.string().min(2, t("nameMin", "Name must be at least 2 characters")),
    email: z.string().email(t("emailInvalid", "Please enter a valid email address")),
    phone: phoneNumberSchema,
    shopName: z.string().optional(),
    shopAddress: z.string().optional(),
    kitchenPreference: z.enum(["commercial", "home", "notSure"], { required_error: t("requiredField", "This field is required") }),
    foodSafetyLicense: z.enum(["yes", "no", "notSure"], { required_error: t("requiredField", "This field is required") }),
    foodEstablishmentCert: z.enum(["yes", "no", "notSure"], { required_error: t("requiredField", "This field is required") }),
    businessType: z.string().optional(),
    experience: z.string().optional(),
    businessDescription: z.string().optional(),
    usageFrequency: z.string().optional(),
  });
}

type RegisterFormData = z.infer<ReturnType<typeof useRegisterSchema>>;

interface EnhancedRegisterFormProps {
  onSuccess?: () => void;
  setHasAttemptedLogin?: (v: boolean) => void;
  onRegistrationStart?: () => void; // Called when registration starts, parent shows loading overlay
  onRegistrationComplete?: (email: string, data?: RegisterFormData) => void; // Called when registration succeeds
  onRegistrationError?: () => void; // Called when registration fails, parent hides loading overlay
  onSwitchToLogin?: () => void; // Switch to login tab
  forceApplying?: boolean;
  /** Hide the "I'm ready to apply" checkbox (e.g. tour-only signup). */
  hideApplyingToggle?: boolean;
  reviewAfterRegistration?: boolean;
  /** Wizard previous-step control (footer), e.g. return to booking prefs. */
  onPreviousStep?: () => void;
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

export default function EnhancedRegisterForm({ onSuccess, setHasAttemptedLogin, onRegistrationStart, onRegistrationComplete, onRegistrationError, onSwitchToLogin, forceApplying, hideApplyingToggle, reviewAfterRegistration, onPreviousStep }: EnhancedRegisterFormProps) {
  const { t } = useTranslation("auth");
  const registerSchema = useRegisterSchema();
  const { signup, signInWithGoogle, loading, error, updateUserVerification } = useFirebaseAuth();
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [formError, setFormError] = useState<string | null>(null);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState("");
  const [step, setStep] = useState(1);
  const [isApplying, setIsApplying] = useState(!!forceApplying);

  // Sync isApplying if forceApplying prop changes
  useEffect(() => {
    if (forceApplying !== undefined) {
      setIsApplying(forceApplying);
    }
  }, [forceApplying]);
  const { showAlert } = useCustomAlerts();

  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { 
      displayName: "", 
      email: "", 
      phone: "",
      shopName: "", 
      shopAddress: "",
      businessType: "",
      experience: "",
      businessDescription: "",
      kitchenPreference: "commercial",
      foodSafetyLicense: "notSure",
      foodEstablishmentCert: "notSure",
      usageFrequency: "",
    },
  });

  // Applying to a commercial kitchen — don't ask preference; lock to commercial.
  useEffect(() => {
    if (forceApplying || isApplying) {
      form.setValue("kitchenPreference", "commercial");
    }
  }, [forceApplying, isApplying, form]);

  const handleNextStep = async () => {
    const isStep1Valid = await form.trigger(['displayName', 'email', 'phone']);
    if (isStep1Valid) {
      setStep(2);
    }
  };

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
      logger.info(`✅ Proceeding with Magic Link registration: ${data.email}`);

      // Convert empty strings to undefined to satisfy Zod optional validations
      const cleanData = {
        fullName: data.displayName,
        email: data.email,
        phone: data.phone,
        shopName: data.shopName || undefined,
        shopAddress: data.shopAddress || undefined,
        businessType: data.businessType || undefined,
        experience: data.experience || undefined,
        businessDescription: data.businessDescription || undefined,
        kitchenPreference: data.kitchenPreference,
        foodSafetyLicense: data.foodSafetyLicense,
        foodEstablishmentCert: data.foodEstablishmentCert,
        usageFrequency: data.usageFrequency || undefined,
      };

      if (isApplying) {
        // Store application data in localStorage to submit after sign in
        window.localStorage.setItem('pendingRegistrationData', JSON.stringify(cleanData));
      }

      logger.info(`✅ Proceeding with registration: ${data.email}`);

      // Auto-generate a secure password since we are doing passwordless signup
      // Format: UUID without dashes + one capital letter + one special char to satisfy any rules
      const randomBase = crypto.randomUUID().replace(/-/g, '');
      const generatedPassword = `A1!${randomBase}`.slice(0, 16);
      logger.info('🔐 Auto-generated secure password for passwordless flow');

      await Promise.all([
        signup(data.email, generatedPassword, data.displayName),
        new Promise(resolve => setTimeout(resolve, 1200)) // Minimum loading time for UX
      ]);

      logger.info('✅ Registration successful - Firebase email verification handled automatically');

      // Step 3: Show email verification screen / success message
      setAuthState('success');
      setShowLoadingOverlay(false);

      if (reviewAfterRegistration && onRegistrationComplete) {
        onRegistrationComplete(data.email, data);
        // Hard refresh clears stale auth/modal state; pending flow restores from storage.
        window.location.reload();
        return;
      } else if (onRegistrationComplete) {
        onRegistrationComplete(data.email, data);
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
      const errorTitle = t("registrationFailedTitle", "Registration Failed");
      let errorMessage = "";

      if (e.message.includes('too-many-requests')) {
        errorMessage = t("errTooManyAttempts", "Too many attempts. Please wait a few minutes before trying again.");
      } else if (e.message.includes('network-request-failed')) {
        errorMessage = t("errNetworkFailed", "Network error. Please check your connection and try again.");
      } else {
        errorMessage = t("errRegisterGeneric", "Registration failed. Please try again later.");
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
      let needsTerms = false;
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
              const userData = await response.json();
              if (userData && userData.termsAccepted === false) {
                needsTerms = true;
              }
              // User profile is available, sync is complete
              logger.info('✅ User profile available, registration complete');
              break;
            }
          }
        } catch (err) {
          // Continue polling
        }

        attempts++;
      }

      if (attempts >= maxAttempts) {
        logger.warn('⚠️ Registration sync timeout, but proceeding anyway');
      }

      setAuthState('success');
      setShowLoadingOverlay(false);

      // ENTERPRISE FIX: Don't use hard redirect (window.location.href) for managers
      // Hard redirects cause full page reloads which lose React state and can cause
      // race conditions with Firebase auth state initialization on the target page.
      // Instead, call onSuccess() and let the parent component handle navigation
      // via React state management (useEffect with proper dependencies).
      // 
      // For Google Sign-In, users are typically already email-verified, so we
      // call onSuccess() immediately to trigger the parent's redirect logic.
      // The parent (ManagerLogin.tsx or EnhancedAuthPage.tsx) will:
      // 1. Set hasAttemptedLogin to true
      // 2. Refresh user data via React Query
      // 3. The useEffect will detect the authenticated manager and redirect
      if (needsTerms) {
        logger.info('🎯 Google registration needs terms acceptance - showing terms screen');
        if (onSuccess) onSuccess();
      } else {
        logger.info('🎯 Google registration complete - calling onSuccess to trigger parent redirect');
        if (onSuccess) onSuccess();
      }

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
        // Send custom verification email
        const response = await fetch('/api/firebase/send-verification-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: currentUser.email, role: 'chef' }) // Form handles both, backend determines actual role
        });
        
        if (!response.ok) {
          throw new Error('Failed to send verification email');
        }
        logger.info('✅ Firebase verification email resent successfully');
      } else {
        // User is signed out - they need to use the "resend" flow
        // which requires them to enter their email again
        logger.info('⚠️ User is signed out - cannot resend verification email directly');
        logger.info('📧 User should check their inbox or try registering again');
        // Don't throw - just log. The email was already sent during registration.
      }
    } catch (error: any) {
      logger.error('❌ Failed to resend Firebase verification email:', error);
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
          if (onSwitchToLogin) {
            onSwitchToLogin();
          }
        }}
        onCheckVerified={async () => {
          try {
            const updatedUser = await updateUserVerification();
            const verified =
              !!(updatedUser?.is_verified || updatedUser?.isVerified || updatedUser?.emailVerified) ||
              !!auth.currentUser?.emailVerified;
            if (verified) {
              window.location.reload();
              return;
            }
            showAlert({
              title: "Not verified yet",
              description:
                "We haven't detected your verification yet. Please click the link in your email, or wait a few seconds and try again.",
              type: "warning",
            });
          } catch (err) {
            logger.error("Error checking verification status:", err);
          }
        }}
      />
    );
  }


  return (
    <>
      <LoadingOverlay
        isVisible={showLoadingOverlay}
        message={authState === 'loading' ? t("overlayCreatingAccount", "Creating your account...") : t("overlayAccountCreated", "Account created!")}
        submessage={authState === 'loading' ? t("overlaySettingUpAccount", "Please wait while we set up your account securely.") : t("overlayCheckEmailVerify", getEmailContinueMessage("verify"))}
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
          {step === 1 && (
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-5"
            >
              <div className="mb-2 text-sm text-gray-500 font-medium">{isApplying ? "Request to apply · Basic info" : "Basic Info"}</div>
              {/* Name Field */}
              <AnimatedInput
                label={t("fullNameLabel", "Full Name")}
                type="text"
                icon={<User className="w-4 h-4" />}
                validationState={getFieldValidationState('displayName')}
                error={form.formState.errors.displayName?.message}
                {...form.register('displayName', {
                  onChange: () => {
                    if (authState === 'error') setAuthState('idle');
                  }
                })}
              />

              {/* Email Field */}
              <AnimatedInput
                label={t("emailAddressLabel", "Email Address")}
                type="email"
                icon={<Mail className="w-4 h-4" />}
                validationState={getFieldValidationState('email')}
                error={form.formState.errors.email?.message}
                {...form.register('email', {
                  onChange: () => {
                    if (authState === 'error') setAuthState('idle');
                  }
                })}
              />
              
              {/* Phone Field */}
              <AnimatedInput
                label={t("phoneNumberLabel", "Phone Number")}
                type="tel"
                icon={<Phone className="w-4 h-4" />}
                validationState={getFieldValidationState('phone')}
                error={form.formState.errors.phone?.message}
                {...form.register('phone', {
                  onChange: () => {
                    if (authState === 'error') setAuthState('idle');
                  }
                })}
              />

              {!forceApplying && !hideApplyingToggle && (
                <div className="flex items-center space-x-2 my-4">
                  <input
                    type="checkbox"
                    id="isApplying"
                    checked={isApplying}
                    onChange={(e) => setIsApplying(e.target.checked)}
                    className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                  />
                  <label htmlFor="isApplying" className="text-sm font-medium text-gray-700 cursor-pointer select-none">
                    I'm ready to apply for a kitchen
                  </label>
                </div>
              )}

              {/* Step actions — Previous + Next when parent provides wizard navigation */}
              {isApplying ? (
                <div className={onPreviousStep ? "flex gap-3" : undefined}>
                  {onPreviousStep ? (
                    <button
                      type="button"
                      onClick={onPreviousStep}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden />
                      {t("btnPrevious", "Previous")}
                    </button>
                  ) : null}
                  <AnimatedButton
                    type="button"
                    onClick={handleNextStep}
                    state="idle"
                    className={onPreviousStep ? "flex-1" : undefined}
                  >
                    <div className="flex items-center gap-2">
                      {t("btnNext", "Next")} <ArrowRight className="w-4 h-4" />
                    </div>
                  </AnimatedButton>
                </div>
              ) : (
                <AnimatedButton
                  type="submit"
                  state={getButtonState()}
                  loadingText={t("btnCreatingAccount", "Creating account...")}
                  successText={t("btnAccountCreated", "Account created!")}
                  errorText={t("btnTryAgain", "Try again")}
                  disabled={authState === 'loading'}
                >
                  {t("btnCreateAccount", "Create Account")}
                </AnimatedButton>
              )}
            </motion.div>
          )}

          {step === 2 && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-5"
            >
              <div className="flex items-center gap-2 mb-2">
                <button type="button" onClick={() => setStep(1)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="text-sm text-gray-500 font-medium">Step 2 of 2: Application Info</div>
              </div>

              {/* Required first */}
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">
                  How often will you use the kitchen? <span className="text-red-500">*</span>
                </label>
                <select
                  className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
                  {...form.register('usageFrequency', {
                    required: forceApplying ? t("requiredField", "This field is required") : false,
                  })}
                >
                  <option value="">-- Select frequency --</option>
                  <option value="weekly">Weekly</option>
                  <option value="few-times-month">A few times a month</option>
                  <option value="monthly">Monthly</option>
                  <option value="occasionally">Occasionally</option>
                  <option value="not-sure">Not sure yet</option>
                </select>
                {form.formState.errors.usageFrequency && (
                  <p className="text-sm text-red-500 mt-1">{form.formState.errors.usageFrequency.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">
                  Do you have a Food Safety License? <span className="text-red-500">*</span>
                </label>
                <select 
                  className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
                  {...form.register('foodSafetyLicense')}
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="notSure">Not sure</option>
                </select>
                {form.formState.errors.foodSafetyLicense && (
                  <p className="text-sm text-red-500 mt-1">{form.formState.errors.foodSafetyLicense.message}</p>
                )}
              </div>

              {(forceApplying || isApplying) ? null : (
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Kitchen Preference</label>
                <select 
                  className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
                  {...form.register('kitchenPreference')}
                >
                  <option value="notSure">Not sure</option>
                  <option value="commercial">Commercial Kitchen</option>
                  <option value="home">Home Kitchen</option>
                </select>
                {form.formState.errors.kitchenPreference && (
                  <p className="text-sm text-red-500 mt-1">{form.formState.errors.kitchenPreference.message}</p>
                )}
              </div>
              )}

              {/* Optional after required */}
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Type of Food Business (Optional)</label>
                <select 
                  className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
                  {...form.register('businessType')}
                >
                  <option value="">-- Select your business type --</option>
                  <option value="catering">Catering</option>
                  <option value="bakery">Bakery / Desserts</option>
                  <option value="meal-prep">Meal Prep / Delivery</option>
                  <option value="specialty">Specialty Artisan Foods</option>
                  <option value="pasta">Fresh Pasta</option>
                  <option value="sauce">Sauces / Condiments</option>
                  <option value="prepared">Prepared Foods for Retail</option>
                  <option value="other">Other / Not Sure</option>
                </select>
              </div>

              <AnimatedInput
                label="Tell Us About Your Business (Optional)"
                type="text"
                validationState={getFieldValidationState('businessDescription')}
                error={form.formState.errors.businessDescription?.message}
                {...form.register('businessDescription')}
              />

              {/* Submit Button */}
              <AnimatedButton
                type="submit"
                state={getButtonState()}
                loadingText={t("btnCreatingAccount", "Creating account...")}
                successText={t("btnAccountCreated", "Account created!")}
                errorText={t("btnTryAgain", "Try again")}
                disabled={authState === 'loading'}
              >
                {t("btnCreateAccount", "Create Account")}
              </AnimatedButton>
            </motion.div>
          )}

          {/* Terms and Privacy */}
          <motion.div variants={itemVariants} className="text-center">
            <p className="text-xs text-gray-500 leading-relaxed">
              {t("termsAgreementPrefix", "By creating an account, you agree to our")}{' '}
              <motion.a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 hover:underline"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {t("termsLink", "Terms & Conditions")}
              </motion.a>
              {' '}{t("termsAndSeparator", "and")}{' '}
              <motion.a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700 hover:underline"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {t("privacyLink", "Privacy Policy")}
              </motion.a>
            </p>
          </motion.div>
          
          {onSwitchToLogin && (
            <motion.div variants={itemVariants} className="mt-6 text-center text-sm">
              <span className="text-gray-500">{t("alreadyHaveAccount", "Already have an account?")}</span>{' '}
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="text-[#F51042] hover:underline font-medium"
              >
                {t("loginLink", "Log in")}
              </button>
            </motion.div>
          )}
        </form>
      </motion.div>
    </>
  );
} 