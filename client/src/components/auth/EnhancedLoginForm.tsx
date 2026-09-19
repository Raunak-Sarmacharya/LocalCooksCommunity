import { logger } from "@/lib/logger";
import { useTranslation } from "react-i18next";
import { useCustomAlerts } from "@/components/ui/custom-alerts";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { mapPasswordSignInError, rememberAuthMethod, type LoginChallenge } from "@/lib/login-challenge";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@iconify/react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import AnimatedButton from "./AnimatedButton";
import AnimatedInput from "./AnimatedInput";
import EmailVerificationScreen from "./EmailVerificationScreen";
import ForgotPasswordForm from "./ForgotPasswordForm";
import LoadingOverlay from "./LoadingOverlay";
import { getSellerJourneyDraft } from "@/lib/seller-journey";

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
  animateEntrance?: boolean;
  initialEmail?: string;
  initialChallenge?: LoginChallenge;
  onChallengeChange?: (challenge: LoginChallenge) => void;
  availableChallenges?: LoginChallenge[];
  accountConfirmed?: boolean;
  showChallengeSwitcher?: boolean;
  autoSendEmailLink?: boolean;
  onTryAnotherWay?: () => void;
  /** The named way out of this form — routes back to the identifier gate. */
  onUseDifferentEmail?: () => void;
}

type AuthState = "idle" | "loading" | "success" | "error" | "email-verification";
/** Which CTA owns the current authState — prevents both buttons spinning together. */

function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  return domain ? `${name.slice(0, 2)}***@${domain}` : email;
}

const containerVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      staggerChildren: 0.12,
      ease: [0.22, 1, 0.36, 1]
    },
  },
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
  },
};

export default function EnhancedLoginForm({
  onSuccess,
  onSwitchToRegister,
  setHasAttemptedLogin,
  showVerificationSuccess = false,
  animateEntrance = true,
  initialEmail,
  initialChallenge = "email-link",
  onChallengeChange,
  availableChallenges = ["email-link", "password"],
  accountConfirmed = false,
  showChallengeSwitcher = true,
  autoSendEmailLink = false,
  onTryAnotherWay,
  onUseDifferentEmail,
}: EnhancedLoginFormProps) {
  const { t } = useTranslation("auth");
  const [challenge, setChallenge] = useState<LoginChallenge>(initialChallenge);
  const loginSchema = useLoginSchema();
  const { login, sendEmailLink, resendEmailVerification } =
    useFirebaseAuth();
  const [authState, setAuthState] = useState<AuthState>("idle");
  const [showLoadingOverlay, setShowLoadingOverlay] = useState(false);
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState("");
  const [unverifiedPassword, setUnverifiedPassword] = useState("");
  const [showMagicLinkNudge, setShowMagicLinkNudge] = useState(false);
  const [emailLinkCooldown, setEmailLinkCooldown] = useState(0);
  const autoSendStartedRef = useRef(false);
  const { showAlert } = useCustomAlerts();

  const busy = authState === "loading";

  useEffect(() => {
    if (emailLinkCooldown <= 0) return;
    const timer = window.setInterval(() => setEmailLinkCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [emailLinkCooldown]);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: initialEmail || getSellerJourneyDraft()?.email || "", password: "" },
  });

  const resetAuthUi = (delayMs = 0) => {
    const clear = () => {
      setAuthState("idle");
    };
    if (delayMs > 0) setTimeout(clear, delayMs);
    else clear();
  };

  const handleEmailLinkSubmit = async (data: LoginFormData) => {
    setHasAttemptedLogin?.(true);
    setAuthState("loading");
    setShowMagicLinkNudge(false);

    const email = data.email.trim();

    try {
      await sendEmailLink(email);
      setAuthState("success");
      setShowMagicLinkNudge(true);
      setEmailLinkCooldown(30);
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

  useEffect(() => {
    if (!autoSendEmailLink || initialChallenge !== "email-link" || !initialEmail || autoSendStartedRef.current) return;
    autoSendStartedRef.current = true;
    void handleEmailLinkSubmit({ email: initialEmail, password: "" });
  }, [autoSendEmailLink, initialChallenge, initialEmail]);

  const handlePasswordSubmit = async (data: LoginFormData) => {
    const password = data.password?.trim() ?? "";
    if (!password) {
      form.setError("password", {
        message: t("passwordRequired", "Password is required"),
      });
      return;
    }

    setHasAttemptedLogin?.(true);
    setAuthState("loading");
    setShowLoadingOverlay(true);

    const email = data.email.trim();

    try {
      await Promise.all([login(email, password), new Promise((r) => setTimeout(r, 400))]);
      await rememberAuthMethod(email, "password");
      setAuthState("success");
      // Stay covered until the parent has taken over. This used to close the
      // overlay and then wait 600 ms before telling the parent, which showed
      // the login form again on top of a session that was already valid.
      await onSuccess?.();
      setShowLoadingOverlay(false);
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
    onChallengeChange?.(next);
    setAuthState("idle");
    setShowMagicLinkNudge(false);
    form.clearErrors("password");
  };

  const buttonState = () => {
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
      default: showMagicLinkNudge
        ? emailLinkCooldown > 0
          ? t("resendEmailCountdown", { defaultValue: "Resend in {seconds}s", seconds: emailLinkCooldown })
          : t("resendSignInLink", "Resend sign-in link")
        : t("btnContinueWithEmail", "Continue with email"),
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

  if (challenge === "email-link" && showMagicLinkNudge) {
    const target = form.getValues("email");
    const maskedTarget = maskEmail(target);
    /*
     * Laid out to match `EmailVerificationScreen`, which is the same moment reached by the
     * other door: brand-tinted chip, the same heading metrics, the address on ITS OWN LINE
     * rather than inside the sentence, the spam hint as two balanced sentences, and one named
     * way out below the actions.
     *
     * This state had been left behind on all five counts — a green chip where every other
     * auth state is brand-tinted, a smaller heading, the address inline so the sentence broke
     * around it, no spam hint at all once the account was confirmed, and the host's "← Back"
     * arrow as its only escape. It is the LAST thing a returning single-method account sees,
     * so it was also the worst place to look unlike the rest of the app.
     */
    return (
      <div className="w-full" aria-live="polite">
        <div className="mb-5 flex justify-center">
          <span
            aria-hidden
            className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FCE3E9]"
          >
            <Mail className="h-7 w-7 text-[#F51042]" />
          </span>
        </div>

        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold tracking-[-0.03em] text-gray-950">
            {t("signInEmailSentTitle", "Check your email")}
          </h2>
          <p className="mt-2.5 text-sm leading-relaxed text-gray-600">
            {accountConfirmed
              ? t("signInEmailWaitingLead", "We sent a secure sign-in link to")
              : t("signInEmailSentLead", "If an account exists for this email, we sent a secure sign-in link to")}
          </p>
          <p className="mt-1 break-all text-sm font-medium text-gray-950">{maskedTarget}</p>
        </div>

        <div className="space-y-3">
          <AnimatedButton
            type="button"
            state={buttonState()}
            loadingText={t("btnSendingLink", "Sending...")}
            successText={t("btnEmailSent", "Email sent")}
            errorText={t("btnTryAgain", "Try again")}
            disabled={busy || emailLinkCooldown > 0}
            onClick={() => void handleEmailLinkSubmit(form.getValues())}
          >
            {emailLinkCooldown > 0
              ? t("resendEmailCountdown", { defaultValue: "Resend in {seconds}s", seconds: emailLinkCooldown })
              : t("resendSignInLink", "Resend sign-in link")}
          </AnimatedButton>

          {onTryAnotherWay && (
            <Button
              type="button"
              variant="outline"
              onClick={onTryAnotherWay}
              disabled={busy}
              className="w-full border-slate-200"
            >
              {t("tryAnotherWay", "Try another way")}
            </Button>
          )}
        </div>

        {/* Two balanced lines, each its own sentence — the same shape the verification screen
            uses. As one paragraph this pair wrapped into a long line plus a two-word orphan. */}
        <div className="mt-5 text-center text-xs leading-relaxed text-slate-500">
          <p>{t("signInEmailOpenOnDevice", "Open the link on this device to sign in.")}</p>
          <p className="mt-1">
            {t("signInEmailSpamHint", "Nothing yet? Check your spam or promotions folder.")}
          </p>
        </div>

        {onUseDifferentEmail && (
          <p className="mt-5 text-center text-sm text-slate-600">
            {t("wrongEmailPrompt", "Wrong email?")}{" "}
            <button
              type="button"
              onClick={onUseDifferentEmail}
              // index.css forces min-height/min-width 44px on EVERY button, which would blow
              // this inline link out of its line.
              className="!min-h-0 !min-w-0 font-medium text-[#E00A38] underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {t("useDifferentEmail", "Use a different email")}
            </button>
          </p>
        )}
      </div>
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
        initial={animateEntrance ? "hidden" : false}
        animate="visible"
      >
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
          {showVerificationSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl bg-green-50 border border-green-200 p-4 flex items-start gap-3 mb-4"
            >
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-green-100 flex items-center justify-center mt-0.5">
                <Icon icon="mdi:check" className="h-3 w-3 text-green-600" aria-hidden />
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

          {/* Nudge banner — appears after magic link request to help unregistered users */}
          <AnimatePresence>
            {showMagicLinkNudge && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3 mb-2 overflow-hidden"
              >
                <Icon icon="mdi:information-outline" className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden />
                <div className="flex-1">
                  <p className="text-sm text-amber-800">
                    {t("magicLinkNudge", "Didn't receive it? Check spam or promotions, then resend when the timer ends or try another sign-in method.")}
                  </p>
                  {onSwitchToRegister && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowMagicLinkNudge(false);
                        onSwitchToRegister();
                      }}
                      className="mt-1.5 text-sm font-medium text-amber-700 hover:text-amber-900 underline underline-offset-2"
                    >
                      {t("createAccountLink", "Create an account")}
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {accountConfirmed ? (
            <motion.div variants={itemVariants} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("signingInAs", "Signing in as")}</p>
              <p className="mt-1 truncate text-sm text-slate-800">{maskEmail(form.getValues("email"))}</p>
            </motion.div>
          ) : (
            <motion.div variants={itemVariants}>
              <AnimatedInput
                label={t("emailOrUsername", "Email Address or Username")}
                type="email"
                autoComplete="email"
                icon={<Icon icon="mdi:email-outline" className="h-4 w-4" aria-hidden />}
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
                    if (showMagicLinkNudge) setShowMagicLinkNudge(false);
                  },
                })}
              />
            </motion.div>
          )}

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
                  labelRight={
                    <button
                      type="button"
                      onClick={() => switchChallenge("forgot-password")}
                      className="text-sm text-[#F51042] hover:underline font-medium"
                      disabled={authState === "loading"}
                    >
                      {t("forgotPassword", "Forgot password?")}
                    </button>
                  }
                  type="password"
                  autoComplete="current-password"
                  showPasswordToggle
                  icon={<Icon icon="mdi:lock-outline" className="h-4 w-4" aria-hidden />}
                  validationState={form.formState.errors.password ? "invalid" : "idle"}
                  error={form.formState.errors.password?.message}
                  {...form.register("password", {
                    onChange: () => {
                      if (authState === "error") setAuthState("idle");
                    },
                  })}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div variants={itemVariants}>
            <AnimatedButton
              type="submit"
              state={buttonState()}
              loadingText={getButtonText().loading}
              successText={getButtonText().success}
              errorText={getButtonText().error}
              disabled={busy || (challenge === "email-link" && showMagicLinkNudge && emailLinkCooldown > 0)}
            >
              {getButtonText().default}
            </AnimatedButton>
          </motion.div>

          {/* Always-available challenge switcher — Airbnb / NIST: no dead ends */}
          {showChallengeSwitcher && <motion.div variants={itemVariants} className="space-y-2 text-center">
            {challenge === "email-link" && availableChallenges.includes("password") ? (
              <button
                type="button"
                onClick={() => switchChallenge("password")}
                disabled={busy}
                className="w-full rounded-full border border-gray-200 bg-white py-2 text-sm font-medium text-gray-700 transition-colors hover:border-[#F51042]/40 hover:bg-[#FFF7F9] hover:text-[#F51042] disabled:opacity-50"
              >
                {t("signInWithPassword", "Sign in with password")}
              </button>
            ) : challenge === "password" && availableChallenges.includes("email-link") ? (
              <button
                type="button"
                onClick={() => switchChallenge("email-link")}
                disabled={busy}
                className="w-full rounded-full border border-gray-200 bg-white py-2 text-sm font-medium text-gray-700 transition-colors hover:border-[#F51042]/40 hover:bg-[#FFF7F9] hover:text-[#F51042] disabled:opacity-50"
              >
                {t("emailMeASignInLink", "Email me a sign-in link instead")}
              </button>
            ) : null}
            {availableChallenges.some((candidate) => candidate !== challenge) && <p className="text-xs text-gray-500 px-2">
              {challenge === "email-link"
                ? t(
                    "passwordChallengeHint",
                    "Have a password, or need to set one up?"
                  )
                : t(
                    "emailLinkChallengeHint",
                    "Prefer not to use a password? We'll email you a one-time sign-in link."
                  )}
            </p>}
          </motion.div>}

          {!showChallengeSwitcher && onTryAnotherWay && (
            <motion.button
              variants={itemVariants}
              type="button"
              onClick={onTryAnotherWay}
              disabled={busy}
              className="w-full text-sm font-medium text-[#E00A38] underline underline-offset-4 disabled:opacity-50"
            >
              {t("tryAnotherWay", "Try another way")}
            </motion.button>
          )}

          {onSwitchToRegister && (
            <motion.div variants={itemVariants} className="text-center text-sm">
              <span className="text-gray-500">{t("noAccount", "New to LocalCooks?")}</span>{" "}
              <button
                type="button"
                onClick={onSwitchToRegister}
                className="font-medium text-[#F51042] hover:underline"
              >
                {t("createAccountLink", "Create an account")}
              </button>
            </motion.div>
          )}

          {/*
            The way out of this form, named. It replaces the "← Back" arrow the host used to
            render above the card for single-method accounts: an arrow above a form reads as a
            wizard step, says nothing about where it goes, and had nowhere useful to land
            anyway (it returned to the gate this form was reached from). Wording it around the
            problem — and putting it BELOW the actions — is the same treatment the register
            step and `EmailVerificationScreen` already use.
          */}
          {onUseDifferentEmail && (
            <motion.p variants={itemVariants} className="text-center text-sm text-slate-600">
              {t("wrongEmailPrompt", "Wrong email?")}{" "}
              <button
                type="button"
                onClick={onUseDifferentEmail}
                // index.css forces min-height/min-width 44px on EVERY button, which would blow
                // this inline link out of its line.
                className="!min-h-0 !min-w-0 font-medium text-[#E00A38] underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
              >
                {t("useDifferentEmail", "Use a different email")}
              </button>
            </motion.p>
          )}
        </form>
      </motion.div>
    </>
  );
}
