/**
 * Dev-only: generate Firebase email action links for local E2E (no outbound email).
 * Returns a navigable URL for Playwright — never log the full URL in production paths.
 */
import { getAuth } from "firebase-admin/auth";
import { initializeFirebaseAdmin } from "./firebase-setup";
import { getEmailLinkOrigin, getFirebaseContinueUrl } from "./email";
import { userService } from "./domains/users/user.service";
import { isDevAuthBypassEnabled } from "./dev-auth-bypass-gates";

function isTooManyAuthAttempts(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const message = String((err as Error)?.message || "");
  return code === "auth/too-many-requests" || message.includes("TOO_MANY_ATTEMPTS");
}

export type DevTestAuthLinkKind = "signIn" | "verifyEmail";

export interface DevTestAuthLinkRequest {
  email: string;
  kind: DevTestAuthLinkKind;
  returnPath?: string;
  role?: "chef" | "manager" | "admin";
}

export interface DevTestAuthLinkResult {
  actionUrl: string;
  email: string;
  kind: DevTestAuthLinkKind;
}

/** Local Playwright origins — always *.localhost, never remote dev-chef.* domains. */
function getLocalE2eEmailLinkOrigin(
  userType: "chef" | "kitchen" | "admin"
): string {
  const base = process.env.BASE_URL || "http://localhost:5001";
  let port = "5001";
  try {
    port = new URL(base).port || process.env.PORT || "5001";
  } catch {
    /* ponytail: default 5001 */
  }
  const host =
    userType === "kitchen"
      ? `kitchen.localhost:${port}`
      : userType === "admin"
        ? `admin.localhost:${port}`
        : `chef.localhost:${port}`;
  return `http://${host}`;
}

function rewriteToEmailAction(generatedUrl: string, emailLinkOrigin: string): string {
  const generated = new URL(generatedUrl);
  const target = new URL(emailLinkOrigin);
  const finalOrigin =
    generated.origin !== target.origin ? emailLinkOrigin : generated.origin;
  return `${finalOrigin}/email-action${generated.search}`;
}

/**
 * Build a Firebase sign-in or verification link for automated UI tests.
 * ponytail: dev-only; callers must gate on isDevAuthBypassEnabled + local Host.
 */
export async function generateDevTestAuthLink(
  req: DevTestAuthLinkRequest
): Promise<DevTestAuthLinkResult> {
  const email = req.email.trim().toLowerCase();
  if (!email) throw new Error("email is required");

  const kind: DevTestAuthLinkKind =
    req.kind === "verifyEmail" ? "verifyEmail" : "signIn";

  const app = initializeFirebaseAdmin();
  if (!app) throw new Error("Firebase Admin not initialized");

  const auth = getAuth(app);
  const existingUser = await userService.getUserByUsername(email);
  let userRole = existingUser ? (existingUser as { role?: string }).role || "chef" : "chef";
  if (req.role === "chef" || req.role === "manager" || req.role === "admin") {
    userRole = req.role;
  }

  const returnPath =
    req.returnPath && req.returnPath.startsWith("/")
      ? req.returnPath
      : kind === "signIn"
        ? "/dashboard"
        : "/auth?verified=true";

  const isKitchenFlow =
    returnPath.includes("/kitchen-preview") ||
    returnPath.includes("/apply-kitchen") ||
    returnPath.includes("/book-kitchen");
  if (isKitchenFlow) userRole = "chef";

  const userType =
    userRole === "manager" ? "kitchen" : userRole === "admin" ? "admin" : "chef";
  const isLocalDev = process.env.NODE_ENV === "development" && !process.env.VERCEL_ENV;
  const emailLinkOrigin = isLocalDev
    ? getLocalE2eEmailLinkOrigin(userType)
    : getEmailLinkOrigin(userType);

  const continueUrlObj = new URL(getFirebaseContinueUrl(userType, returnPath));
  continueUrlObj.searchParams.set("email", email);
  const continueUrlWithEmail = continueUrlObj.toString();

  const actionCodeSettings = {
    url: continueUrlWithEmail,
    handleCodeInApp: true,
  };

  let generatedUrl: string;
  if (kind === "verifyEmail") {
    let firebaseUser;
    try {
      firebaseUser = await auth.getUserByEmail(email);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== "auth/user-not-found") throw err;
      const created = await auth.createUser({ email, emailVerified: false });
      firebaseUser = created;
    }
    if (!firebaseUser.emailVerified) {
      try {
        generatedUrl = await auth.generateEmailVerificationLink(
          email,
          actionCodeSettings
        );
      } catch (err) {
        // ponytail: dev-only fallback when registration already consumed Firebase quota
        if (isDevAuthBypassEnabled() && isTooManyAuthAttempts(err)) {
          await auth.updateUser(firebaseUser.uid, { emailVerified: true });
          const bypass = new URL(`${emailLinkOrigin}/email-action`);
          bypass.searchParams.set("mode", "verifyEmail");
          bypass.searchParams.set("e2eDevBypass", "1");
          bypass.searchParams.set("email", email);
          bypass.searchParams.set("continueUrl", continueUrlWithEmail);
          return {
            actionUrl: bypass.toString(),
            email,
            kind: "verifyEmail",
          };
        }
        throw err;
      }
    } else {
      // Already verified — still return a sign-in link so tests can proceed
      generatedUrl = await auth.generateSignInWithEmailLink(email, actionCodeSettings);
      return {
        actionUrl: rewriteToEmailAction(generatedUrl, emailLinkOrigin),
        email,
        kind: "signIn",
      };
    }
  } else {
    generatedUrl = await auth.generateSignInWithEmailLink(email, actionCodeSettings);
  }

  return {
    actionUrl: rewriteToEmailAction(generatedUrl, emailLinkOrigin),
    email,
    kind,
  };
}
