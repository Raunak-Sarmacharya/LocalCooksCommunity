import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";
import { useCustomAlerts } from "@/components/ui/custom-alerts";
import { useFirebaseAuth } from "@/hooks/use-auth";
import {
  mapPasswordSignInError,
  type LoginChallenge,
} from "@/lib/login-challenge";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { Lock, Mail } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import AnimatedButton from "./AnimatedButton";
import { getEmailContinueMessage } from "./EmailContinueHint";
import AnimatedInput from "./AnimatedInput";
import EmailVerificationScreen from "./EmailVerificationScreen";
import ForgotPasswordForm from "./ForgotPasswordForm";
import LoadingOverlay from "./LoadingOverlay";

function useLoginSchema() {
  const { t } = useTranslation("auth");
  return z.object({
    email: z.string().email(t("emailRequired", "Please enter a valid email address")),
    password: z.string().optional(),
  });
}

type LoginFormData = z.infer<ReturnType<typeof useLoginSchema>>;

interface EnhancedLoginFormProps {
  onSuccess?: () => void;
  onSwitchToRegister?: () => void;
  setHasAttemptedLogin?: (v: boolean) => void;
  showVerificationSuccess?: boolean;
}

type AuthState = "idle" | "loading" | "success" | "error" | "email-verification";
/** Which CTA owns the current authState — prevents both buttons spinning together. */
type PendingMethod = null | "google" | "form";

const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function EnhancedLoginForm({
  onSuccess,
  onSwitchToRegister,
  setHasAttemptedLogin,
  showVerificationSuccess = false,
}: EnhancedLoginFormProps) {
  const { t } = useTranslation("auth");
  const [challenge, setChallenge] = useState<LoginChallenge>("email-link");
  const loginSchema = useLoginSchema();
  const { login, signInWithGoogle, sendEmailLink, resendEmailVerification } =
    useFirebaseAuth();
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [pendingMethod, setPendingMethod] = useState<PendingMethod>(null);
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState("");
  const [unverifiedPassword, setUnverifiedPassword] = useState("");
  const { showAlert } = useCustomAlerts();

  const busy = pendingMethod !== null && authState === "loading";

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const resetAuthUi = (delayMs = 0) => {
    const clear = () => {
      setAuthState("idle");
      setPendingMethod(null);
    };
    if (delayMs > 0) setTimeout(clear, delayMs);
    else clear();
  };

  const handleEmailLinkSubmit = async (data: LoginFormData) => {
    setHasAttemptedLogin?.(true);
    setPendingMethod("form");
    setAuthState("loading");

    const email = data.email.trim();

    try {
      await sendEmailLink(email);
      setAuthState("success");
      showAlert({
        title: t("signInEmailSentTitle", "Check your email"),
        description: t("signInEmailSentDesc", getEmailContinueMessage("sign-in")),
        type: "success",
      });
      resetAuthUi(4000);
    } catch (e: unknown) {
      setShowLoadingOverlay(false);
      setAuthState("error");
      const message = e instanceof Error ? e.message : "";
      let errorMessage = t(
        "errSignInGeneric",
        "Unable to send sign-in email at this time. Please try again later."
      );
      if (message.includes("too-many-requests")) {
        errorMessage = t(
          "errTooManyAttempts",
          "Too many attempts. Please wait a few minutes before trying again."
        );
      } else if (message.includes("network-request-failed")) {
        errorMessage = t(
          "errNetworkFailed",
          "Network error. Please check your connection and try again."
        );
      }
      showAlert({
        title: t("signInFailedTitle", "Sign In Failed"),
        description: errorMessage,
        type: "error",
      });
      resetAuthUi(2000);
    }
  };

  const handlePasswordSubmit = async (data: LoginFormData) => {
    const password = data.password?.trim() ?? "";
    if (!password) {
      form.setError("password", {
        message: t("passwordRequired", "Password is required"),
      });
      return;
    }

    setHasAttemptedLogin?.(true);
    setPendingMethod("form");
    setAuthState("loading");
    setShowLoadingOverlay(true);

    const email = data.email.trim();

    try {
      await Promise.all([login(email, password), new Promise((r) => setTimeout(r, 400))]);
      setAuthState("success");
      setShowLoadingOverlay(false);
      setTimeout(() => {
        onSuccess?.();
      }, 600);
    } catch (e: unknown) {
      setShowLoadingOverlay(false);
      setAuthState("error");
      const message = e instanceof Error ? e.message : String(e);
      const mapped = mapPasswordSignInError(message);

      if (mapped.descKey === "errEmailNotVerified") {
        setEmailForVerification(email);
        setUnverifiedPassword(password);
        setShowEmailVerification(true);
      }

      showAlert({
        title: t(mapped.titleKey, mapped.titleFallback),
        description: t(mapped.descKey, mapped.descFallback),
        type: "error",
      });
      resetAuthUi(2000);
    }
  };

  const handleSubmit = async (data: LoginFormData) => {
    if (challenge === "password") {
      await handlePasswordSubmit(data);
    } else {
      await handleEmailLinkSubmit(data);
    }
  };

  const handleGoogleSignIn = async () => {
    setHasAttemptedLogin?.(true);
    setPendingMethod("google");
    setAuthState("loading");
    setShowLoadingOverlay(true);

    try {
      await Promise.all([signInWithGoogle(), new Promise((r) => setTimeout(r, 800))]);
      setAuthState("success");
      setShowLoadingOverlay(false);
      setTimeout(() => {
        onSuccess?.();
      }, 1000);
    } catch (e: unknown) {
      setShowLoadingOverlay(false);
      setAuthState("error");
      const message = e instanceof Error ? e.message : "";
      let errorMessage = t(
        "errGoogleGeneric",
        "Unable to sign in with Google at this time. Please try again later."
      );
      if (message.includes("popup-closed-by-user")) {
        errorMessage = t("errPopupClosed", "Sign-in was cancelled. Please try again.");
      } else if (message.includes("popup-blocked")) {
        errorMessage = t(
          "errPopupBlocked",
          "Pop-up blocked. Please allow pop-ups for this site and try again."
        );
      } else if (message.includes("network-request-failed")) {
        errorMessage = t(
          "errNetworkFailed",
          "Network error. Please check your connection and try again."
        );
      } else if (message.includes("not registered")) {
        errorMessage = t(
          "errGoogleNotRegistered",
          "This Google account is not registered. Please register first or try signing in with email and password."
        );
      }
      showAlert({
        title: t("googleSignInFailedTitle", "Google Sign In Failed"),
        description: errorMessage,
        type: "error",
      });
      resetAuthUi(2000);
    }
  };

  const handleResendVerification = async () => {
    try {
      await resendEmailVerification(emailForVerification, unverifiedPassword);
    } catch (err) {
      logger.error("Failed to resend verification from form:", err);
      throw err;
    }
  };

  const switchChallenge = (next: LoginChallenge) => {
    setChallenge(next);
    setAuthState("idle");
    setPendingMethod(null);
    form.clearErrors("password");
  };

  const stateFor = (method: "google" | "form") => {
    if (pendingMethod !== method) return "idle" as const;
    if (authState === "loading") return "loading" as const;
    if (authState === "success") return "success" as const;
    if (authState === "error") return "error" as const;
    return "idle" as const;
  };

  const getButtonText = () => {
    if (challenge === "password") {
      return {
        default: t("btnSignIn", "Sign In"),
        loading: t("btnSigningYouIn", "Signing you in..."),
        success: t("btnSignedIn", "Signed in!"),
        error: t("btnTryAgain", "Try again"),
      };
    }
    return {
      default: t("btnContinueWithEmail", "Continue with email"),
      loading: t("btnSendingLink", "Sending..."),
      success: t("btnEmailSent", "Email sent"),
      error: t("btnTryAgain", "Try again"),
    };
  };

  if (showEmailVerification) {
    return (
      <EmailVerificationScreen
        email={emailForVerification}
        onResend={handleResendVerification}
        mode="verification"
        onGoBack={() => {
          setShowEmailVerification(false);
          setAuthState("idle");
          switchChallenge("password");
        }}
      />
    );
  }

  if (challenge === "forgot-password") {
    return (
      <ForgotPasswordForm
        embedded
        initialEmail={form.getValues("email")}
        onGoBack={() => switchChallenge("password")}
        onSuccess={() => {
          /* stay on success UI inside ForgotPasswordForm */
        }}
      />
    );
  }

  return (
    <>
      <LoadingOverlay
        isVisible={showLoadingOverlay}
        message={
          authState === "loading"
            ? t("btnSigningYouIn", "Signing you in...")
            : t("btnSignedIn", "Signed in!")
        }
        submessage={
          authState === "loading"
            ? t("overlayVerifyCredentials", "Please wait while we verify your credentials securely.")
            : t("overlayRedirectingDashboard", "Redirecting to your dashboard...")
        }
        type={authState === "success" ? "success" : "loading"}
      />

      <motion.div
        className="w-full max-w-md mx-auto mt-4"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={itemVariants} className="mb-6">
          <AnimatedButton
            state={stateFor("google")}
            loadingText={t("btnSigningInWithGoogle", "Signing in with Google...")}
            successText={t("btnSignedIn", "Signed in!")}
            errorText={t("btnTryAgain", "Try again")}
            onClick={handleGoogleSignIn}
            variant="google"
            disabled={busy}
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span>{t("continueWithGoogle", "Continue with Google")}</span>
            </div>
          </AnimatedButton>
        </motion.div>

        <motion.div variants={itemVariants} className="flex items-center my-6">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="mx-3 text-gray-400 text-xs uppercase tracking-wider">
            {t("orDivider", "or")}
          </span>
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
                <svg
                  className="w-3 h-3 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="3"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-green-800">
                  {t("emailVerifiedSuccessTitle", "Email verified successfully!")}
                </p>
                <p className="text-xs text-green-600 mt-1">
                  {t(
                    "emailVerifiedSuccessBody",
                    "Your account is now verified. Please sign in with your credentials to continue."
                  )}
                </p>
              </div>
            </motion.div>
          )}

          <motion.div variants={itemVariants}>
            <AnimatedInput
              label={t("emailOrUsername", "Email Address or Username")}
              type="email"
              autoComplete="email"
              icon={<Mail className="w-4 h-4" />}
              validationState={
                form.formState.errors.email
                  ? "invalid"
                  : form.watch("email") && !form.formState.errors.email
                    ? "valid"
                    : "idle"
              }
              error={form.formState.errors.email?.message}
              {...form.register("email", {
                onChange: () => {
                  if (authState === "error") setAuthState("idle");
                },
              })}
            />
          </motion.div>

          <AnimatePresence initial={false}>
            {challenge === "password" && (
              <motion.div
                key="password-field"
                variants={itemVariants}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <AnimatedInput
                  label={t("password", "Password")}
                  type="password"
                  autoComplete="current-password"
                  showPasswordToggle
                  icon={<Lock className="w-4 h-4" />}
                  validationState={form.formState.errors.password ? "invalid" : "idle"}
                  error={form.formState.errors.password?.message}
                  {...form.register("password", {
                    onChange: () => {
                      if (authState === "error") setAuthState("idle");
                    },
                  })}
                />
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => switchChallenge("forgot-password")}
                    className="text-sm text-[#F51042] hover:underline font-medium"
                    disabled={authState === "loading"}
                  >
                    {t("forgotPassword", "Forgot password?")}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div variants={itemVariants}>
            <AnimatedButton
              type="submit"
              state={stateFor("form")}
              loadingText={getButtonText().loading}
              successText={getButtonText().success}
              errorText={getButtonText().error}
              disabled={busy}
            >
              {getButtonText().default}
            </AnimatedButton>
          </motion.div>

          {/* Always-available challenge switcher — Airbnb / NIST: no dead ends */}
          <motion.div variants={itemVariants} className="space-y-2 text-center">
            {challenge === "email-link" ? (
              <button
                type="button"
                onClick={() => switchChallenge("password")}
                disabled={busy}
                className="w-full text-sm font-medium text-gray-700 hover:text-gray-900 py-2 rounded-lg border border-gray-200 hover:border-gray-300 bg-white transition-colors disabled:opacity-50"
              >
                {t("signInWithPassword", "Sign in with password")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => switchChallenge("email-link")}
                disabled={busy}
                className="w-full text-sm font-medium text-gray-700 hover:text-gray-900 py-2 rounded-lg border border-gray-200 hover:border-gray-300 bg-white transition-colors disabled:opacity-50"
              >
                {t("emailMeASignInLink", "Email me a sign-in link instead")}
              </button>
            )}
            <p className="text-xs text-gray-500 px-2">
              {challenge === "email-link"
                ? t(
                    "passwordChallengeHint",
                    "Have a password, or need to set one up? Use password sign-in or forgot password."
                  )
                : t(
                    "emailLinkChallengeHint",
                    "Prefer not to use a password? We'll email you a one-time sign-in link."
                  )}
            </p>
          </motion.div>

          {onSwitchToRegister && (
            <motion.div variants={itemVariants} className="mt-6 text-center text-sm">
              <span className="text-gray-500">
                {t("noAccount", "Don't have an account?")}
              </span>{" "}
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
