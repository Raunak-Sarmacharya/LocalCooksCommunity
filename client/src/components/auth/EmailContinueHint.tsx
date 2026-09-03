import { cn } from "@/lib/utils";

export type EmailContinueVariant = "sign-in" | "verify" | "reset";

const ACTION_COPY: Record<EmailContinueVariant, string> = {
  "sign-in": "Click the sign-in link in the email to continue.",
  verify: "Click the verification link in the email to continue.",
  reset: "Click the password reset link in the email to continue.",
};

/** One-line copy for alerts, toasts, and overlays. */
export function getEmailContinueMessage(variant: EmailContinueVariant): string {
  return `${ACTION_COPY[variant]} If you don't see it within a few minutes, check your spam or promotions folder.`;
}

interface EmailContinueHintProps {
  variant: EmailContinueVariant;
  className?: string;
}

/** Prominent inbox + spam reminder shown after an email is sent. */
export function EmailContinueHint({ variant, className }: EmailContinueHintProps) {
  return (
    <div
      className={cn(
        "p-4 bg-amber-50 rounded-lg border border-amber-100 text-left",
        className
      )}
    >
      <p className="text-sm text-amber-900">
        <strong>Next step:</strong> {ACTION_COPY[variant]}
      </p>
      <p className="text-sm text-amber-800 mt-1">
        If you don't see the email within a few minutes, check your spam or promotions folder.
      </p>
    </div>
  );
}
