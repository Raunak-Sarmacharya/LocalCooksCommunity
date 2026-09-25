import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";
import { useCustomAlerts } from "@/components/ui/custom-alerts";
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
import { FormLegend } from "@/components/ui/form-legend";
import EmailVerificationScreen from "./EmailVerificationScreen";
import LoadingOverlay from "./LoadingOverlay";
import { getEmailContinueMessage } from "./EmailContinueHint";
import { Icon } from "@iconify/react";
import GoogleIcon from "./GoogleIcon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { phoneNumberSchema } from "@shared/phone-validation";
import { hasVerifiedEmail } from "@/lib/auth-verification";
import { saveRegistrationName } from "@/lib/registration-identity";
import { sendVerificationEmailWithFallback } from "@/lib/send-verification-email";
import { startEmailVerification } from "@/lib/email-verification-api";
import { deleteUser, signOut, updateProfile } from "firebase/auth";
import { duplicateAccountKind } from "@/lib/registration-error";
import { isPendingGoogleRegistration, setGoogleRegistrationActive } from "@/lib/pending-google-registration";
import type { PublicRegistrationRole } from "@/hooks/use-auth";
import PhoneOtpChallenge from "./PhoneOtpChallenge";
import { getSellerJourneyDraft } from "@/lib/seller-journey";
import {
  clearPendingPhoneRegistration,
  didPhoneAuthCreateNewIdentity,
  isPhoneAuthInProgress,
  provisionPendingPhoneRegistration,
  savePendingPhoneRegistration,
} from "@/lib/phone-registration";

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
  onSuccess?: () => void | Promise<void>;
  setHasAttemptedLogin?: (v: boolean) => void;
  onRegistrationStart?: () => void; // Called when registration starts, parent shows loading overlay
  onRegistrationComplete?: (email: string, data?: RegisterFormData) => void | Promise<void>; // Called when registration succeeds
  onRegistrationError?: () => void; // Called when registration fails, parent hides loading overlay
  onSwitchToLogin?: () => void; // Switch to login tab
  forceApplying?: boolean;
  /** Hide the "I'm ready to apply" checkbox (e.g. tour-only signup). */
  hideApplyingToggle?: boolean;
  reviewAfterRegistration?: boolean;
  /** Wizard previous-step control (footer), e.g. return to booking prefs. */
  onPreviousStep?: () => void;
  /** Public account type selected by the CTA. Admin accounts are never self-registered. */
  accountType?: PublicRegistrationRole;
  /** Whether to show the terms and conditions checkbox inline in the form. */
  showTermsInline?: boolean;
  /** Consent already captured by a preceding first-party registration step. */
  initialTermsAccepted?: boolean;
  animateEntrance?: boolean;
  initialEmail?: string;
}

type AuthState = 'idle' | 'loading' | 'success' | 'error' | 'email-verification';

const containerVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      staggerChildren: 0.12,
      ease: [0.22, 1, 0.36, 1]
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1]
    }
  }
};

export default function EnhancedRegisterForm({ onSuccess, setHasAttemptedLogin, onRegistrationStart, onRegistrationComplete, onRegistrationError, onSwitchToLogin, forceApplying, hideApplyingToggle, reviewAfterRegistration, onPreviousStep, accountType = 'chef', showTermsInline = false, initialTermsAccepted = false, animateEntrance = true, initialEmail }: EnhancedRegisterFormProps) {
  const { t } = useTranslation("auth");
  const registerSchema = useRegisterSchema();
  const { user: authUser, signup, signInWithGoogle, authenticateWithGoogle, syncUserWithBackend, loading, error, updateUserVerification, refreshUserData } = useFirebaseAuth();
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [formError, setFormError] = useState<string | null>(null);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState("");
  const [showPhoneFallback, setShowPhoneFallback] = useState(false);
  const [step, setStep] = useState(1);
  const [isApplying, setIsApplying] = useState(!!forceApplying);
  const [acceptedTerms, setAcceptedTerms] = useState(initialTermsAccepted);
  /**
   * Set once "Continue with Google" has authenticated, holding the identity Google
   * gave us. While it is set the form is in Google mode: the name is prefilled but
   * still editable, the email is Google's and therefore locked, and the phone is
   * still required.
   *
   * NOTHING is provisioned until the visitor submits. That is the whole point — this
   * used to create an account, with no phone and no confirmation, the instant the
   * popup returned.
   */
  const [googleProfile, setGoogleProfile] = useState<{ email: string; displayName: string } | null>(null);
  /**
   * The name shown while in Google mode.
   *
   * Held here rather than only in react-hook-form because `AnimatedInput` renders its
   * `value` prop straight onto the input — an uncontrolled field registered with
   * `form.register` therefore does not display a value set later with `form.setValue`.
   * Both are kept in step: this drives what is on screen, the form drives validation.
   */
  const [googleName, setGoogleName] = useState("");

  // Re-seed Google mode after the host's loading gate has replaced the card and
  // unmounted this form. The Firebase session survives that (the SDK persists it) and
  // the marker still names the uid, so the identity can be rebuilt rather than lost —
  // without this the visitor comes back to an EMPTY form with no sign that Google was
  // ever used, and the account would then be created under whatever they retyped.
  useEffect(() => {
    const current = auth.currentUser;
    if (!current?.email || !isPendingGoogleRegistration(current.uid)) return;
    const displayName = current.displayName?.trim() || current.email.split('@')[0];
    setGoogleProfile({ email: current.email, displayName });
    setGoogleName(displayName);
    form.setValue('displayName', displayName, { shouldValidate: true });
    form.setValue('email', current.email, { shouldValidate: true });
    // Mount-only: afterwards the popup handler is the only writer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While this form is on screen in Google mode the attempt is NOT abandoned — the
  // visitor is mid-registration. Releasing the claim on unmount is what lets a
  // leftover marker mean "they walked away", and get the session cleared on their
  // next visit. Without this the auth-state handler signs them out the instant the
  // popup returns, mid-registration.
  useEffect(() => {
    setGoogleRegistrationActive(googleProfile ? auth.currentUser?.uid ?? null : null);
    return () => setGoogleRegistrationActive(null);
  }, [googleProfile]);
  const [phoneVerifiedUid, setPhoneVerifiedUid] = useState<string | null>(() => {
    const currentUser = auth.currentUser;
    return isPhoneAuthInProgress() && currentUser?.phoneNumber ? currentUser.uid : null;
  });

  // Sync isApplying if forceApplying prop changes
  useEffect(() => {
    if (forceApplying !== undefined) {
      setIsApplying(forceApplying);
    }
  }, [forceApplying]);

  const { showAlert } = useCustomAlerts();

  // Mobile-friendly nudge: tapping a disabled button shows an alert (tooltips are hover-only)
  const handleTermsNudge = () => {
    if (showTermsInline && !acceptedTerms) {
      showAlert({
        title: t("termsRequiredTitle", "Please accept the terms"),
        description: t(
          "termsRequiredDescription",
          "You must accept the Terms & Conditions and Privacy Policy to create an account."
        ),
        type: "warning",
      });
    }
  };

  const returnToLogin = async () => {
    if (phoneVerifiedUid) {
      const deleteTemporaryIdentity = didPhoneAuthCreateNewIdentity();
      clearPendingPhoneRegistration();
      if (auth.currentUser?.uid === phoneVerifiedUid) {
        if (deleteTemporaryIdentity) {
          await deleteUser(auth.currentUser).catch(async () => {
            await signOut(auth).catch(() => undefined);
          });
        } else {
          await signOut(auth).catch(() => undefined);
        }
      }
    }
    onSwitchToLogin?.();
  };

  const journeyDraft = new URLSearchParams(window.location.search).get("journey") === "seller" ? getSellerJourneyDraft() : null;
  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { 
      displayName: journeyDraft?.fullName || "",
      email: initialEmail || journeyDraft?.email || "",
      phone: journeyDraft?.phone || "",
      shopName: "", 
      shopAddress: "",
      businessType: "",
      experience: "",
      businessDescription: "",
      kitchenPreference: journeyDraft?.kitchenPreference || "commercial",
      foodSafetyLicense: journeyDraft ? "no" : "notSure",
      foodEstablishmentCert: journeyDraft ? "no" : "notSure",
      usageFrequency: "",
    },
  });

  // Continue seamlessly when a new phone identity was started from the sign-in tab.
  useEffect(() => {
    const currentUser = auth.currentUser;
    if (isPhoneAuthInProgress() && currentUser?.phoneNumber) {
      setPhoneVerifiedUid(currentUser.uid);
      form.setValue("phone", currentUser.phoneNumber, { shouldValidate: true });
    }
  }, [form, authUser?.uid]);

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
    if (showTermsInline && !acceptedTerms) {
      showAlert({
        title: t("termsRequiredTitle", "Please accept the terms"),
        description: t("termsRequiredDescription", "You must accept the Terms & Conditions and Privacy Policy to create an account."),
        type: "warning",
      });
      return;
    }
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

      if (googleProfile) {
        // GOOGLE MODE. The popup already established the session, so this provisions
        // against it rather than creating a second identity — and only now, once the
        // visitor has confirmed their name and supplied a phone.
        const googleUser = auth.currentUser;
        if (!googleUser || googleUser.email !== googleProfile.email) {
          throw new Error("Your Google session expired. Please continue with Google again.");
        }

        // The name is editable, and `syncUserWithBackend` reads it from the Firebase
        // user — so the edit has to be pushed there first or it would be silently
        // discarded and the account would be created under the Google name.
        await updateProfile(googleUser, { displayName: data.displayName });
        await googleUser.reload();
        saveRegistrationName(data.email, data.displayName);

        // No verification link here: Google owns the address and has already proved
        // it, so the server records it as verified from the token's claim.
        const created = await syncUserWithBackend(
          googleUser,
          accountType,
          true,
          initialTermsAccepted || (showTermsInline && acceptedTerms),
          data.phone,
        );
        if (!created) throw new Error("Could not create your account. Please try again.");

        setAuthState('success');
        await onRegistrationComplete?.(data.email, data);
        await onSuccess?.();
        setShowLoadingOverlay(false);
        return;
      }

      if (phoneVerifiedUid) {
        const phoneUser = auth.currentUser;
        if (!phoneUser || phoneUser.uid !== phoneVerifiedUid || !phoneUser.phoneNumber) {
          clearPendingPhoneRegistration();
          throw new Error("Your verified phone session expired. Please verify your phone again.");
        }
        if (data.phone !== phoneUser.phoneNumber) {
          form.setError("phone", { message: "Use the phone number you just verified." });
          throw new Error("The phone number does not match the verified number.");
        }

        await updateProfile(phoneUser, { displayName: data.displayName });
        saveRegistrationName(data.email, data.displayName);
        savePendingPhoneRegistration({
          uid: phoneUser.uid,
          phoneNumber: phoneUser.phoneNumber,
          email: data.email.trim().toLowerCase(),
          displayName: data.displayName.trim(),
          accountType,
          termsAccepted: initialTermsAccepted || (showTermsInline && acceptedTerms),
          createdAt: Date.now(),
        });

        // The phone OTP is already sufficient identity proof. Provision now so
        // an unavailable email provider can never strand a valid registration.
        const provisioned = await provisionPendingPhoneRegistration();
        if (!provisioned.completed) throw new Error("Could not finish the verified registration.");

        // Send the branded verification link now so it is already waiting in the
        // inbox by the time the dashboard gate appears. The profile card owns
        // retries, so a delivery failure here is not fatal to the registration.
        try {
          await startEmailVerification(data.email.trim().toLowerCase());
        } catch (emailError) {
          logger.warn("Phone registration completed, but the verification link could not be sent", emailError);
        }

        setAuthState("success");

        await onRegistrationComplete?.(data.email, data);
        // The overlay is deliberately left up across `onSuccess`. The parent
        // raises the cross-route handoff before it navigates, so closing here
        // would expose the login form in front of a valid new session.
        await onSuccess?.();
        setShowLoadingOverlay(false);
        return;
      }

      logger.info(`✅ Proceeding with registration: ${data.email}`);

      // Auto-generate a secure password since we are doing passwordless signup
      // Format: UUID without dashes + one capital letter + one special char to satisfy any rules
      const randomBase = crypto.randomUUID().replace(/-/g, '');
      const generatedPassword = `A1!${randomBase}`.slice(0, 16);
      logger.info('🔐 Auto-generated secure password for passwordless flow');

      await Promise.all([
        signup(data.email, generatedPassword, data.displayName, accountType, initialTermsAccepted || (showTermsInline && acceptedTerms), data.phone),
        new Promise(resolve => setTimeout(resolve, 1200)) // Minimum loading time for UX
      ]);

      logger.info('✅ Registration successful - Firebase email verification handled automatically');
      saveRegistrationName(data.email, data.displayName);

      // Step 3: Show email verification screen / success message
      setAuthState('success');

      if (reviewAfterRegistration && onRegistrationComplete) {
        setShowLoadingOverlay(false);
        await onRegistrationComplete(data.email, data);
        return;
      } else if (onRegistrationComplete) {
        setShowLoadingOverlay(false);
        await onRegistrationComplete(data.email, data);
      } else {
        // The verification screen is a destination, not a waypoint, so the
        // overlay can go here. Every branch that navigates keeps it up instead.
        setShowLoadingOverlay(false);
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
      const duplicateKind = duplicateAccountKind(e);
      const duplicateAccount = duplicateKind !== null;
      const errorTitle = duplicateAccount
        ? t("accountAlreadyExistsTitle", "Account already exists")
        : t("registrationFailedTitle", "Registration Failed");
      let errorMessage = "";

      if (duplicateKind === "phone") {
        // Name the field that actually collided. Reporting a taken phone number
        // as a taken email address points the visitor at the one input that is
        // fine, and they loop: retry the same number with yet another address.
        errorMessage = t(
          "errPhoneExists",
          "That phone number is already linked to a Local Cooks account. Sign in with it instead, or use a different number."
        );
      } else if (duplicateAccount && phoneVerifiedUid) {
        errorMessage = t(
          "errPhoneEmailExists",
          "This email already has a Local Cooks account. Sign in with your usual method instead."
        );
      } else if (duplicateAccount) {
        errorMessage = t(
          "errEmailExists",
          "An account already exists for this email address. Sign in with it instead — you can add Google to it afterwards from your profile."
        );
      } else if (e.message.includes('too-many-requests')) {
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

      if (duplicateAccount && onSwitchToLogin) {
        if (phoneVerifiedUid) await returnToLogin();
        else setTimeout(onSwitchToLogin, 350);
      }

      setTimeout(() => setAuthState('idle'), 2000);
    }
  };

  /**
   * "Continue with Google" on the register step.
   *
   * Authenticates and STOPS. Google supplies the name and the already-verified
   * address, but the visitor still has to confirm the name and supply the phone
   * number, so the account is created only when they submit the form.
   *
   * Creating it here is what produced accounts with a name and an address but no
   * phone, silently, with no confirmation step — and with no way to sign in with a
   * number later.
   */
  const handleGoogleSignIn = async () => {
    // NOTE: Don't call setHasAttemptedLogin here - only call it after successful registration
    // via onSuccess() callback. Calling it here causes the useEffect in EnhancedAuthPage to
    // run before the user profile exists, setting hasCheckedUser.current = true prematurely.
    setFormError(null);

    // Tell the host a registration is in flight, so its loading gate says "Creating your
    // account..." rather than "Signing you in..." — the gate outranks this form's own
    // overlay, so the host is the only place that copy can be fixed.
    onRegistrationStart?.();

    setAuthState('loading');
    setShowLoadingOverlay(true);

    try {
      const identity = await authenticateWithGoogle();

      if (identity.existing) {
        // This Google account already has a LocalCooks profile, so there is nothing to
        // create — hand off so the host can finish the sign-in.
        setAuthState('success');
        logger.info('✅ Google account already registered - completing as sign-in');
        await onSuccess?.();
        setShowLoadingOverlay(false);
        return;
      }

      // GOOGLE MODE. The name and address are prefilled; the phone is still empty and
      // still required, so the form cannot be submitted without one. Nothing is
      // written to the application database until that happens.
      setGoogleProfile({ email: identity.email, displayName: identity.displayName });
      setGoogleName(identity.displayName);
      form.setValue('displayName', identity.displayName, { shouldValidate: true });
      form.setValue('email', identity.email, { shouldValidate: true });
      setAuthState('idle');
      setShowLoadingOverlay(false);
      // Back on the form, so nothing is being created any more. `onRegistrationError` is
      // the host's "registration is no longer in flight" signal — no error occurred, but
      // the gate must stop claiming an account is being made.
      onRegistrationError?.();
      logger.info('🔵 Google identity captured — awaiting the phone number before creating the account');

    } catch (e: any) {
      setShowLoadingOverlay(false);
      setAuthState('error');

      // Handle Google registration errors with user-friendly messages via custom alerts
      const duplicateKind = duplicateAccountKind(e);
      const duplicateAccount = duplicateKind !== null;
      const errorTitle = duplicateAccount
        ? t("accountAlreadyExistsTitle", "Account already exists")
        : t("registrationFailedTitle", "Registration Failed");
      let errorMessage = "";

      if (duplicateKind === "phone") {
        errorMessage = t(
          "errPhoneExists",
          "That phone number is already linked to a Local Cooks account. Sign in with it instead, or use a different number."
        );
      } else if (duplicateAccount) {
        errorMessage = t(
          "errEmailExists",
          "An account already exists for this email address. Sign in with it instead — you can add Google to it afterwards from your profile."
        );
      } else if (e.message.includes('popup-closed-by-user')) {
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
      if (duplicateAccount && onSwitchToLogin) {
        setTimeout(onSwitchToLogin, 350);
      }
    }
  };


  const handleResendVerification = async () => {
    try {
      // Get the current Firebase user (may need to sign in temporarily)
      const currentUser = auth.currentUser;

      if (currentUser) {
        if (phoneVerifiedUid && currentUser.uid === phoneVerifiedUid) {
          // Phone-first accounts have no email attached to their Firebase user yet,
          // so the branded server loop owns delivery rather than
          // verifyBeforeUpdateEmail (which needs a recent sign-in and sends
          // Firebase's own template).
          await startEmailVerification(form.getValues("email").trim().toLowerCase());
          return;
        }
        // User is still signed in, send verification directly
        await sendVerificationEmailWithFallback({
          email: currentUser.email!,
          role: accountType,
        });
        logger.info('✅ Verification email resent successfully');
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

  if (showPhoneFallback) {
    return (
      <PhoneOtpChallenge
        purpose="link"
        initialPhone={form.getValues("phone")}
        autoSend
        onCancel={() => setShowPhoneFallback(false)}
        onExistingUser={() => undefined}
        onNewUser={() => undefined}
        onLinkedPhone={async () => {
          setAuthState("loading");
          setShowLoadingOverlay(true);
          try {
            await updateUserVerification();
            await refreshUserData();
            setShowPhoneFallback(false);
            setShowEmailVerification(false);
            setAuthState("success");
            await onSuccess?.();
            setShowLoadingOverlay(false);
          } catch (verificationError) {
            setShowLoadingOverlay(false);
            setAuthState("error");
            throw verificationError;
          }
        }}
      />
    );
  }

  if (showEmailVerification) {
    return (
      <>
        <LoadingOverlay
          isVisible={showLoadingOverlay}
          message={t("overlayFinishingAccount", "Finishing your account setup...")}
          submessage={t("overlayPreparingWelcome", "Your email is verified. We're preparing your welcome experience.")}
          type="loading"
        />
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
              if (phoneVerifiedUid) {
                const result = await provisionPendingPhoneRegistration();
                if (result.completed) {
                  await updateUserVerification();
                  await refreshUserData();
                  setShowEmailVerification(false);
                  setAuthState('success');
                  await onSuccess?.();
                  setShowLoadingOverlay(false);
                  return true;
                }
              }
              const updatedUser = await updateUserVerification();
              const verified = hasVerifiedEmail(auth.currentUser, updatedUser);
              if (verified) {
                setAuthState('loading');
                setShowLoadingOverlay(true);
                await refreshUserData();
                setShowEmailVerification(false);
                setAuthState('success');
                await onSuccess?.();
                setShowLoadingOverlay(false);
                return true;
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
      </>
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
        initial={animateEntrance ? "hidden" : false}
        animate="visible"
      >
        {googleProfile ? (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Google connected as <strong>{googleProfile.email}</strong>. Add your phone number below to finish creating your account.
          </div>
        ) : <motion.div variants={itemVariants} className="mb-6">
          <TooltipProvider delayDuration={0}>
            <Tooltip open={showTermsInline && !acceptedTerms ? undefined : false}>
              <TooltipTrigger asChild>
                <span className="block" tabIndex={showTermsInline && !acceptedTerms ? 0 : undefined} onClick={handleTermsNudge}>
                  <AnimatedButton
                    state={authState === 'loading' ? 'loading' : 'idle'}
                    loadingText={t("btnCreatingWithGoogle", "Creating account with Google...")}
                    onClick={handleGoogleSignIn}
                    variant="google"
                    disabled={authState === 'loading' || (showTermsInline && !acceptedTerms)}
                  >
                    <div className="flex items-center gap-3">
                      <GoogleIcon className="h-5 w-5" aria-hidden />
                      <span>{t("continueWithGoogle", "Continue with Google")}</span>
                    </div>
                  </AnimatedButton>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px] text-center">
                <p>{t("termsRequiredDescription", "Accept the Terms & Conditions and Privacy Policy to continue with Google.")}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </motion.div>}

        {/* Once phone ownership is proven, progressively disclose only the required profile fields. */}
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
          {phoneVerifiedUid && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-medium">{t("phoneVerifiedTitle", "Phone verified")}</p>
              <p className="mt-1 text-emerald-800">
                {t("phoneVerifiedFinish", "Add your full name and email to finish signing up.")}
              </p>
              <p className="mt-2 text-xs text-emerald-700">
                {t("phoneExistingAccountHint", "Already have an account? Use Log in below and continue with your usual sign-in method.")}
              </p>
            </div>
          )}
          {step === 1 && (
            <motion.div 
              initial={animateEntrance ? { opacity: 0, x: -20 } : false}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-5"
            >
              <div className="mb-2 text-sm text-gray-500 font-medium">{isApplying ? " " : " "}</div>
              {/* Name Field */}
              <AnimatedInput
                label={t("fullNameLabel", "Full Name")}
                type="text"
                required
                icon={<Icon icon="mdi:account-outline" className="h-4 w-4" aria-hidden />}
                validationState={getFieldValidationState('displayName')}
                error={form.formState.errors.displayName?.message}
                {...form.register('displayName', {
                  onChange: (event: { target: { value: string } }) => {
                    // Keep the visible value in step while in Google mode — see the
                    // note on `googleName`.
                    if (googleProfile) setGoogleName(event.target.value);
                    if (authState === 'error') setAuthState('idle');
                  }
                })}
                // Google supplies the name, but it stays EDITABLE — the visitor may
                // want it written differently from their Google profile.
                // The `key` remounts the input when the mode flips: React refuses to
                // let one element change from uncontrolled to controlled, and this is
                // exactly that transition.
                key={googleProfile ? "google-name" : "manual-name"}
                {...(googleProfile ? { value: googleName } : {})}
              />

              {/* Email Field */}
              <AnimatedInput
                label={t("emailAddressLabel", "Email Address")}
                type="email"
                required
                icon={<Icon icon="mdi:email-outline" className="h-4 w-4" aria-hidden />}
                validationState={getFieldValidationState('email')}
                error={form.formState.errors.email?.message}
                {...form.register('email', {
                  onChange: () => {
                    if (authState === 'error') setAuthState('idle');
                  }
                })}
                // Locked in Google mode. The address comes from the Google account and
                // is the one the server verifies from the token, so letting it be edited
                // would display a value that is quietly ignored — the account would be
                // created under the Google address regardless.
                // Google's address is shown but not editable — see the note above.
                // The `key` remounts the input when the mode flips (uncontrolled →
                // controlled), which React otherwise warns about.
                key={googleProfile ? "google-email" : "manual-email"}
                {...(googleProfile ? { value: googleProfile.email } : {})}
                disabled={!!googleProfile}
              />
              {googleProfile && (
                <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
                  {/* Kept short deliberately: the longer wording ("This address comes
                      from your Google account, which has already verified it." — 74
                      chars) wraps at this width, and an orphaned final word reads as a
                      layout bug. */}
                  {t(
                    "googleEmailLocked",
                    "From your Google account, which is already verified."
                  )}
                </p>
              )}
              
              {/* Phone Field */}
              <AnimatedInput
                label={t("phoneNumberLabel", "Phone Number")}
                type="tel"
                required
                icon={<Icon icon="mdi:phone-outline" className="h-4 w-4" aria-hidden />}
                validationState={getFieldValidationState('phone')}
                error={form.formState.errors.phone?.message}
                {...form.register('phone', {
                  onChange: () => {
                    if (authState === 'error') setAuthState('idle');
                  }
                })}
                disabled={!!phoneVerifiedUid}
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

              {/* Form Legend placed at the end of content for registration */}
              <FormLegend className="mt-4 mb-2" />

              {/* Acceptance sits at the point of commitment, immediately above the
                  submit button and directly under the required-field legend — not at
                  the top of the form, where it was easy to tick, scroll past and stop
                  meaning anything. `acceptedTerms` is the same state, so the Google
                  button gate and its nudge tooltip below still work unchanged. */}
              {showTermsInline && (
                <label className="mb-2 flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(event) => setAcceptedTerms(event.target.checked)}
                    className="mt-1 size-4 accent-[#F51042]"
                  />
                  <span>
                    I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-[#E00A38] underline">Terms</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-[#E00A38] underline">Privacy Policy</a>.
                  </span>
                </label>
              )}

              {/*
                A STATEMENT, not a checkbox, and never recorded on the visitor's behalf.
                Acceptance happens when the flow takes them to the terms — see the note
                in server/routes.ts: "never record acceptance merely because an account
                was created". This exists so arriving there is not a surprise: it says up
                front what creating an account means, and links to the real pages rather
                than to an acceptance dialog.

                It used to sit behind `showTermsInline`, which NO caller ever passed, so
                the manager login's Create Account section said nothing at all.
              */}
              {!showTermsInline && <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
                {t("termsCreateNotice", "By creating an account you agree to our")}{' '}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[#E00A38] underline-offset-4 hover:underline"
                >
                  {/* "Terms" rather than "Terms & Conditions": the full name pushes the
                      sentence to 78 characters, which wraps "Policy" onto a second line
                      at this width. The link still opens the real Terms & Conditions page. */}
                  {t("termsShortLink", "Terms")}
                </a>{' '}
                {/* Notice-specific keys, NOT the shared `termsAndSeparator` /
                    `privacyLink`: those carry "et notre" / "та нашою", which belong to
                    the old "I agree to the X and our Y" sentence and read as broken
                    grammar in this one. */}
                {t("termsNoticeJoin", "and")}{' '}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[#E00A38] underline-offset-4 hover:underline"
                >
                  {t("termsNoticePrivacy", "Privacy Policy")}
                </a>.
              </p>}

              {/* Step actions — Previous + Next when parent provides wizard navigation */}
              {isApplying ? (
                <div className={onPreviousStep ? "flex gap-3" : undefined}>
                  {onPreviousStep ? (
                    <button
                      type="button"
                      onClick={onPreviousStep}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <Icon icon="mdi:arrow-left" className="h-4 w-4" aria-hidden />
                      {t("btnPrevious", "Previous")}
                    </button>
                  ) : null}
                  <TooltipProvider delayDuration={0}>
                    <Tooltip open={showTermsInline && !acceptedTerms ? undefined : false}>
                      <TooltipTrigger asChild>
                        <span className={onPreviousStep ? "flex-1 block" : "block"} tabIndex={showTermsInline && !acceptedTerms ? 0 : undefined} onClick={handleTermsNudge}>
                          <AnimatedButton
                            type="button"
                            onClick={handleNextStep}
                            state="idle"
                            disabled={showTermsInline && !acceptedTerms}
                          >
                            <div className="flex items-center gap-2">
                              {t("btnNext", "Next")} <Icon icon="mdi:arrow-right" className="h-4 w-4" aria-hidden />
                            </div>
                          </AnimatedButton>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[260px] text-center">
                        <p>{t("termsTooltip", "Please accept the Terms & Conditions and Privacy Policy to continue")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              ) : (
                <TooltipProvider delayDuration={0}>
                  <Tooltip open={showTermsInline && !acceptedTerms ? undefined : false}>
                    <TooltipTrigger asChild>
                      <span className="block" tabIndex={showTermsInline && !acceptedTerms ? 0 : undefined} onClick={handleTermsNudge}>
                        <AnimatedButton
                          type="submit"
                          state={getButtonState()}
                          loadingText={t("btnCreatingAccount", "Creating account...")}
                          successText={t("btnAccountCreated", "Account created!")}
                          errorText={t("btnTryAgain", "Try again")}
                          disabled={authState === 'loading' || (showTermsInline && !acceptedTerms)}
                        >
                          {t("btnCreateAccount", "Create Account")}
                        </AnimatedButton>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[260px] text-center">
                      <p>{t("termsTooltip", "Please accept the Terms & Conditions and Privacy Policy to continue")}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </motion.div>
          )}

          {step === 2 && (
            <motion.div 
              initial={animateEntrance ? { opacity: 0, x: 20 } : false}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-5"
            >
              <div className="flex items-center gap-2 mb-2">
                <button type="button" onClick={() => setStep(1)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <Icon icon="mdi:arrow-left" className="h-4 w-4" aria-hidden />
                </button>
                <div className="text-sm text-gray-500 font-medium">Application information</div>
              </div>

              {/* Required first */}
              <div className="space-y-1">
                <label htmlFor="usageFrequency" className="block text-sm font-medium text-gray-700">
                  How often will you use the kitchen? <span className="text-red-500" aria-hidden="true">*</span>
                </label>
                <select
                  id="usageFrequency"
                  className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
                  {...form.register('usageFrequency', {
                    required: forceApplying || isApplying ? t("requiredField", "This field is required") : false,
                  })}
                  required={forceApplying || isApplying}
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
                <label htmlFor="foodSafetyLicense" className="block text-sm font-medium text-gray-700">
                  Do you have a Food Safety License? <span className="text-red-500" aria-hidden="true">*</span>
                </label>
                <select 
                  id="foodSafetyLicense"
                  className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
                  {...form.register('foodSafetyLicense')}
                  required
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
                <label htmlFor="kitchenPreference" className="block text-sm font-medium text-gray-700">
                  Kitchen Preference <span className="text-red-500" aria-hidden="true">*</span>
                </label>
                <select 
                  id="kitchenPreference"
                  className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-gray-900 bg-white"
                  {...form.register('kitchenPreference')}
                  required
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
                <label className="block text-sm font-medium text-gray-700">Business Type (Optional)</label>
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
                label="Business Description (Optional)"
                type="text"
                validationState={getFieldValidationState('businessDescription')}
                error={form.formState.errors.businessDescription?.message}
                {...form.register('businessDescription')}
              />

              <FormLegend className="mt-6 mb-4" />

              {/* See the note at the other submit site: acceptance belongs directly
                  above the submit button, under the required-field legend. */}
              {showTermsInline && (
                <label className="mb-4 flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(event) => setAcceptedTerms(event.target.checked)}
                    className="mt-1 size-4 accent-[#F51042]"
                  />
                  <span>
                    I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-[#E00A38] underline">Terms</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-[#E00A38] underline">Privacy Policy</a>.
                  </span>
                </label>
              )}

              {/* Submit Button */}
              <TooltipProvider delayDuration={0}>
                <Tooltip open={showTermsInline && !acceptedTerms ? undefined : false}>
                  <TooltipTrigger asChild>
                    <span className="block" tabIndex={showTermsInline && !acceptedTerms ? 0 : undefined} onClick={handleTermsNudge}>
                      <AnimatedButton
                        type="submit"
                        state={getButtonState()}
                        loadingText={t("btnCreatingAccount", "Creating account...")}
                        successText={t("btnAccountCreated", "Account created!")}
                        errorText={t("btnTryAgain", "Try again")}
                        disabled={authState === 'loading' || (showTermsInline && !acceptedTerms)}
                      >
                        {t("btnCreateAccount", "Create Account")}
                      </AnimatedButton>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[260px] text-center">
                    <p>{t("termsTooltip", "Please accept the Terms & Conditions and Privacy Policy to continue")}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </motion.div>
          )}

        </form>
      </motion.div>
    </>
  );
}
