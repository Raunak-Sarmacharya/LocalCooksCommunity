import { sendEmailVerification } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { logger } from "@/lib/logger";
import {
  getAuthIntent,
  resolveVerificationReturnPath,
} from "@/lib/auth-intent";
import { getSubdomainOriginForEnvironment } from "@shared/subdomain-utils";

export type VerificationSendChannel = "server" | "firebase";

/** Custom branded verification via server SMTP; Firebase only if that fails. */
export async function sendVerificationEmailWithFallback(options: {
  email: string;
  role?: string;
  returnUrl?: string;
}): Promise<{ channel: VerificationSendChannel }> {
  const email = options?.email?.trim();
  if (!email) {
    throw new Error("Email is required to send a verification link.");
  }
  const role = options.role || "chef";
  const returnUrl = options.returnUrl;
  const resolvedReturnUrl =
    returnUrl ||
    resolveVerificationReturnPath() ||
    getAuthIntent()?.returnPath ||
    `${window.location.pathname}${window.location.search}`;

  const response = await fetch("/api/firebase/send-verification-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      role,
      returnUrl: resolvedReturnUrl,
    }),
  });

  if (response.ok) {
    return { channel: "server" };
  }

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  const message = body.error || "Failed to send verification email";

  if (
    response.status === 429 ||
    message.toLowerCase().includes("too many")
  ) {
    throw new Error(message);
  }

  if (response.status === 404) {
    throw new Error(message);
  }

  if (
    response.status === 503 ||
    body.code === "smtp_failed" ||
    response.status >= 500
  ) {
    if (canUseFirebaseClient(email)) {
      logger.warn("Custom verification SMTP failed, trying Firebase fallback");
      await sendFirebaseVerification(email, message);
      return { channel: "firebase" };
    }
  }

  throw new Error(message);
}

function canUseFirebaseClient(email: string): boolean {
  const firebaseUser = auth.currentUser;
  return (
    !!firebaseUser?.email &&
    firebaseUser.email.toLowerCase() === email.toLowerCase()
  );
}

async function sendFirebaseVerification(
  email: string,
  serverError?: string
): Promise<void> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser?.email) {
    throw new Error(
      serverError ||
        "Could not send verification email. Please sign in and try resend."
    );
  }
  if (firebaseUser.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error(
      "Please sign in with the email you registered with, then resend."
    );
  }

  const origin = getSubdomainOriginForEnvironment(
    "chef",
    window.location.hostname,
    {
      port: window.location.port,
      protocol: window.location.protocol,
    }
  );

  await sendEmailVerification(firebaseUser, {
    url: `${origin}/auth?verified=true`,
    handleCodeInApp: false,
  });

  logger.info("Verification email sent via Firebase fallback");
}
