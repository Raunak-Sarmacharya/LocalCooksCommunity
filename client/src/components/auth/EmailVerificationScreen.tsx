import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { CheckCircle2, Clock, Loader2, Mail, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

interface EmailVerificationScreenProps {
  email: string;
  onResend: () => Promise<void>;
  onGoBack: () => void;
  onCheckVerified?: () => Promise<boolean | void>;
  resendLoading?: boolean;
  mode?: "verification" | "magic-link";
}

const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/**
 * The "we emailed you a link" screen, shared by registration, magic-link sign-in
 * and password reset.
 *
 * Rebuilt to the card's own language. It used to be a template in the middle of
 * a bespoke product: a 96px blue-gradient circle with an infinite bounce, an
 * off-palette emerald CTA, three different button treatments, an amber "Next
 * step" box that duplicated the copy above it, and enough height to make the
 * card scroll on an ordinary laptop. Everything below now matches the welcome
 * back card and the alert dialogs — brand tinted chip, one primary CTA in the
 * product red, one outline secondary, one compact line of help text.
 *
 * There is deliberately NO phone escape hatch. Email is the primary identifier
 * and the only channel we can reliably reach an account on, so registration must
 * not be completable by proving a phone instead — that would hand out a working
 * session for an account whose email is still unproven. Phone verification
 * returns later, as an additional method offered during onboarding.
 */
export default function EmailVerificationScreen({
  email,
  onResend,
  onGoBack,
  onCheckVerified,
  resendLoading = false,
  mode = "verification",
}: EmailVerificationScreenProps) {
  const [resendCount, setResendCount] = useState(0);
  const [resendDisabled, setResendDisabled] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const [resendError, setResendError] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendDisabled && resendTimer > 0) {
      timer = setInterval(() => {
        setResendTimer(prev => prev - 1);
      }, 1000);
    } else if (resendTimer === 0) {
      setResendDisabled(false);
      setResendTimer(60);
    }
    return () => clearInterval(timer);
  }, [resendDisabled, resendTimer]);

  const handleResend = async () => {
    try {
      setResendError(null);
      setResendDisabled(true);
      setResendCount(prev => prev + 1);
      await onResend();
    } catch {
      setResendError('Failed to resend the email. Please try again later.');
      setResendDisabled(false);
      setResendTimer(0);
    }
  };

  const isMagicLink = mode === "magic-link";

  return (
    <motion.div className="w-full" variants={containerVariants} initial="hidden" animate="visible">
      {/* Brand-tinted chip, matching the welcome-back avatar and the alert icons. */}
      <motion.div variants={itemVariants} className="mb-5 flex justify-center">
        <span
          aria-hidden
          className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FCE3E9]"
        >
          <Mail className="h-7 w-7 text-[#F51042]" />
        </span>
      </motion.div>

      <motion.div variants={itemVariants} className="mb-6 text-center">
        <h2 className="text-2xl font-bold tracking-[-0.03em] text-gray-950">Check your email</h2>
        <p className="mt-2.5 text-sm leading-relaxed text-gray-600">
          {isMagicLink ? "We sent a sign-in link to" : "We sent a verification link to"}
        </p>
        <p className="mt-1 break-all text-sm font-medium text-gray-950">{email}</p>
      </motion.div>

      <motion.div variants={itemVariants} className="space-y-3">
        {!isMagicLink && (
          <Button
            type="button"
            onClick={async () => {
              if (isChecking) return;
              setIsChecking(true);
              setVerificationError(null);
              try {
                if (onCheckVerified) {
                  const isVerified = await onCheckVerified();
                  if (isVerified === false) {
                    setVerificationError("We haven't detected verification yet. Open the link in your email, then try again.");
                  }
                } else {
                  onGoBack();
                }
              } catch {
                setVerificationError("We couldn't check your verification status. Please try again.");
              } finally {
                setIsChecking(false);
              }
            }}
            disabled={isChecking}
            className="w-full bg-[#E00A38] text-white hover:bg-[#C00930]"
          >
            {isChecking ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            {isChecking ? "Checking..." : "I have verified my email"}
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={handleResend}
          disabled={resendDisabled || resendLoading}
          className="w-full border-slate-200"
        >
          {resendLoading ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : resendDisabled ? (
            <>
              <Clock className="mr-2 h-4 w-4" />
              Wait {resendTimer}s to resend
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              {isMagicLink ? "Resend sign-in link" : "Resend verification email"}
            </>
          )}
        </Button>
      </motion.div>

      {(resendError || verificationError) && (
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          role="alert"
          className="mt-4 text-center text-sm text-red-600"
        >
          {resendError ?? verificationError}
        </motion.p>
      )}

      {/*
        Two balanced lines, each its own sentence. As one paragraph the pair
        wrapped into a long line plus a two-word orphan ("promotions folder."),
        which is what made it look untidy.

        It also grows and takes the brand tint once a resend has happened: if the
        visitor missed this the first time, the second attempt is exactly when it
        needs to catch the eye.
      */}
      <div
        className={
          resendCount > 0
            ? "mt-5 rounded-xl bg-[#FFF0F3] px-4 py-3 text-center text-sm leading-relaxed text-slate-700"
            : "mt-5 text-center text-xs leading-relaxed text-slate-500"
        }
      >
        {resendCount > 0 && (
          <p className="font-medium text-[#E00A38]">
            {isMagicLink ? "Sign-in link" : "Verification email"} sent again.
          </p>
        )}
        <p>{isMagicLink ? "Open the link on this device to sign in." : "Open the link in your email to continue."}</p>
        <p className="mt-1">Nothing yet? Check your spam or promotions folder.</p>
      </div>

      {/*
        The escape hatch lives BELOW the actions, worded around the problem, and
        is a plain text link rather than a back arrow.

        A "← Change email or login" control at the top reads as a wizard step,
        competes with the primary action, and — because it navigated to the
        sign-in step — landed people on a second screen with its OWN back button,
        so they could walk backwards through two half-states to get nowhere. It
        also says nothing about what the visitor actually wants, which is to fix
        the address. The destination now pre-fills it so they edit rather than
        retype.
      */}
      <p className="mt-5 text-center text-sm text-slate-600">
        Wrong email?{" "}
        <button
          type="button"
          onClick={onGoBack}
          // index.css forces min-height/min-width 44px on EVERY button, which
          // would blow this inline link out of its line.
          className="!min-h-0 !min-w-0 font-medium text-[#E00A38] underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          Use a different email
        </button>
      </p>
    </motion.div>
  );
}
