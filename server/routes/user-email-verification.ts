import { Router, type Request, type Response } from "express";
import { getAuth } from "firebase-admin/auth";

import { logger } from "../logger";
import { requireFirebaseAuthWithUser } from "../firebase-auth-middleware";
import { userService } from "../domains/users/user.service";
import { getFirebaseUserByEmail, initializeFirebaseAdmin, verifyFirebaseToken } from "../firebase-setup";
import { generateEmailVerificationEmail, generateWelcomeEmail, getEmailLinkOrigin, sendEmail } from "../email";
import {
  buildEmailVerificationStatus,
  CLEARED_PENDING_EMAIL,
  EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
  generateVerificationToken,
  hashVerificationToken,
  isValidEmail,
  normalizeEmail,
  resolveEmailLinkUserType,
  resolveTrustedLinkOrigin,
} from "../email-verification";

const router = Router();

/** Postgres unique-violation, raised when `users.username` is already taken. */
const UNIQUE_VIOLATION = "23505";

function friendlyName(req: Request, email: string): string {
  const claimed = req.firebaseUser?.name?.trim();
  if (claimed) return claimed;
  return email.split("@")[0];
}

/**
 * Resolves the uid from an optional bearer token.
 *
 * Used to tell apart "the browser that owned this session clicked the link" from "the
 * link was opened somewhere else". Returns null for absent or invalid tokens, which is
 * the normal case on a different device and must not be treated as an error.
 */
async function resolveCallerUid(req: Request): Promise<string | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const decoded = await verifyFirebaseToken(header.slice("Bearer ".length));
    return decoded?.uid ?? null;
  } catch {
    return null;
  }
}

/**
 * POST /api/user/email/verification/start
 *
 * Begins (or restarts) the loop for an address. Sends a branded, single-use
 * link. Safe to call for a first-time address or a change from a verified one —
 * the confirmed address is untouched until the link is opened, so an account is
 * never left without a working email.
 */
router.post("/start", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const user = req.neonUser!;
    const email = normalizeEmail(req.body?.email);

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: "Enter a valid email address.",
        code: "INVALID_EMAIL",
      });
    }

    const alreadyVerifiedThisAddress =
      req.firebaseUser?.email_verified === true &&
      user.username.trim().toLowerCase() === email;

    if (alreadyVerifiedThisAddress) {
      return res.status(409).json({
        error: "That email address is already verified on your account.",
        code: "ALREADY_VERIFIED",
      });
    }

    const now = Date.now();

    // Cooldown protects the sending domain, not just this account.
    const cooldownUntil = user.pendingEmailSentAt
      ? new Date(user.pendingEmailSentAt).getTime() + EMAIL_VERIFICATION_RESEND_COOLDOWN_MS
      : 0;
    if (user.pendingEmail === email && cooldownUntil > now) {
      return res.status(429).json({
        error: "A verification link was just sent. Give it a moment before requesting another.",
        code: "RESEND_COOLDOWN",
        retryAfterSeconds: Math.max(0, Math.ceil((cooldownUntil - now) / 1000)),
      });
    }

    // The address has to be free in both stores, or confirmation would fail
    // later and the user would be left holding a link that cannot work.
    const ownerInApp = await userService.getUserByUsername(email);
    if (ownerInApp && ownerInApp.firebaseUid !== user.firebaseUid) {
      return res.status(409).json({
        error: "That email address is already in use by another account.",
        code: "EMAIL_IN_USE",
      });
    }

    const ownerInFirebase = await getFirebaseUserByEmail(email);
    if (ownerInFirebase && ownerInFirebase.uid !== user.firebaseUid) {
      return res.status(409).json({
        error: "That email address is already in use by another account.",
        code: "EMAIL_IN_USE",
      });
    }

    const token = generateVerificationToken();
    const sentAt = new Date(now);
    const expiresAt = new Date(now + EMAIL_VERIFICATION_TOKEN_TTL_MS);

    const staged = await userService.updateUser(user.id, {
      pendingEmail: email,
      pendingEmailTokenHash: hashVerificationToken(token),
      pendingEmailExpiresAt: expiresAt,
      pendingEmailSentAt: sentAt,
    });

    if (!staged) {
      return res.status(500).json({
        error: "Could not start email verification. Please try again.",
        code: "PERSIST_FAILED",
      });
    }

    const userType = resolveEmailLinkUserType(user.role);
    // Land on the same route as the Firebase action-code flow (`/email-action`)
    // so every verification email we send behaves identically — that page already
    // owns the role/continueUrl handling. We pass our own single-use token instead
    // of an `oobCode`, because a phone-first account has no email on its Firebase
    // user for `generateEmailVerificationLink` to serve.
    //
    // Prefer the host the client is actually running on when it is a trusted one
    // for this role: a link generated during local development then opens against
    // local code instead of the staging deployment, whose bundle may predate the
    // token handling and answer "Invalid email action link".
    const linkOrigin =
      resolveTrustedLinkOrigin(req.body?.origin, user.role) ?? getEmailLinkOrigin(userType);
    const verificationUrl = `${linkOrigin}/email-action?mode=verifyEmail&token=${token}`;

    const delivered = await sendEmail(
      generateEmailVerificationEmail({
        fullName: friendlyName(req, email),
        email,
        verificationToken: token,
        verificationUrl,
      }),
      {
        trackingId: `email_verify_start_${user.id}_${now}`,
        emailType: "verification",
      }
    );

    if (!delivered) {
      // Leaving a pending address behind would show the user a "check your
      // inbox" state for an email that was never sent.
      await userService.updateUser(user.id, CLEARED_PENDING_EMAIL);
      return res.status(503).json({
        error: "We could not send the verification email. Please try again.",
        code: "smtp_failed",
      });
    }

    logger.info(`📧 Email verification started for user ${user.id}`);

    return res.json({
      success: true,
      ...buildEmailVerificationStatus(
        { ...user, pendingEmail: email, pendingEmailSentAt: sentAt, pendingEmailExpiresAt: expiresAt },
        req.firebaseUser?.email_verified === true,
        now
      ),
    });
  } catch (error) {
    logger.error("Error starting email verification:", error);
    return res.status(500).json({
      error: "Could not start email verification. Please try again.",
      code: "INTERNAL_ERROR",
    });
  }
});

/**
 * POST /api/user/email/verification/cancel
 *
 * Abandons an in-flight request. The confirmed address is unaffected.
 */
router.post("/cancel", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const user = req.neonUser!;
    const updated = await userService.updateUser(user.id, CLEARED_PENDING_EMAIL);

    return res.json({
      success: true,
      ...buildEmailVerificationStatus(
        updated ?? { ...user, ...CLEARED_PENDING_EMAIL },
        req.firebaseUser?.email_verified === true
      ),
    });
  } catch (error) {
    logger.error("Error cancelling email verification:", error);
    return res.status(500).json({ error: "Could not cancel. Please try again.", code: "INTERNAL_ERROR" });
  }
});

/**
 * POST /api/user/email/verification/confirm
 *
 * Public: the token in the link is the proof of ownership, exactly as Firebase's
 * own out-of-band code is. Deliberately does NOT require a session, because the
 * link is often opened on a different device from the one that requested it.
 */
router.post("/confirm", async (req: Request, res: Response) => {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (token.length !== 64) {
      return res.status(400).json({
        error: "This verification link is not valid.",
        code: "INVALID_TOKEN",
      });
    }

    const tokenHash = hashVerificationToken(token);
    const user = await userService.getUserByPendingEmailTokenHash(tokenHash);

    if (!user || !user.pendingEmail || !user.firebaseUid) {
      return res.status(410).json({
        error: "This link has already been used or replaced. Request a new one from your profile.",
        code: "TOKEN_UNKNOWN",
      });
    }

    if (!user.pendingEmailExpiresAt || new Date(user.pendingEmailExpiresAt).getTime() < Date.now()) {
      await userService.updateUser(user.id, CLEARED_PENDING_EMAIL);
      return res.status(410).json({
        error: "This verification link has expired. Request a new one from your profile.",
        code: "TOKEN_EXPIRED",
      });
    }

    const email = user.pendingEmail.trim().toLowerCase();
    const previousEmail = user.username;

    const app = initializeFirebaseAdmin();
    if (!app) {
      return res.status(503).json({
        error: "Verification is temporarily unavailable. Please try again shortly.",
        code: "FIREBASE_UNAVAILABLE",
      });
    }

    // Changing an email invalidates every Firebase session for the account — this is
    // Firebase's design, not a side effect of using the Admin SDK (its own
    // verifyAndChangeEmail flow behaves identically). So the browser that held the
    // session proves it here, by presenting its still-valid ID token *before* the
    // change lands, and receives a custom token to restore the SAME uid afterwards.
    //
    // Requiring proof is what keeps this safe: it means a link opened on an unrelated
    // device (or by whoever happens to own the address that was mistyped) cannot mint
    // a session. It gets no token, and the caller simply signs in normally.
    const callerUid = await resolveCallerUid(req);
    const mayRestoreSession = callerUid !== null && callerUid === user.firebaseUid;

    const mintSessionToken = async (): Promise<string | null> => {
      if (!mayRestoreSession) return null;
      try {
        return await getAuth(app).createCustomToken(user.firebaseUid!);
      } catch (mintError) {
        // The address is verified either way; the user can sign in again if this fails.
        logger.error(`Could not mint a session token after email change for user ${user.id}:`, mintError);
        return null;
      }
    };

    // Firebase is authoritative: only once it accepts the address do we treat the
    // account as verified.
    try {
      await getAuth(app).updateUser(user.firebaseUid, { email, emailVerified: true });
    } catch (firebaseError: any) {
      if (firebaseError?.code === "auth/email-already-exists") {
        await userService.updateUser(user.id, CLEARED_PENDING_EMAIL);
        return res.status(409).json({
          error: "That email address is already in use by another account.",
          code: "EMAIL_IN_USE",
        });
      }
      throw firebaseError;
    }

    const verifiedAt = new Date();
    let consumed;
    try {
      consumed = await userService.consumePendingEmailToken(user.id, tokenHash, {
        username: email,
        isVerified: true,
        emailVerifiedAt: verifiedAt,
        ...CLEARED_PENDING_EMAIL,
      });
    } catch (dbError: any) {
      // The address is live in Firebase but the application row rejected it —
      // most likely another account claimed it in the meantime. Roll Firebase
      // back so the two stores cannot disagree about who owns the address.
      logger.error(`Email confirmation failed to persist for user ${user.id}:`, dbError);
      try {
        await getAuth(app).updateUser(user.firebaseUid, {
          email: previousEmail,
          emailVerified: user.isVerified === true,
        });
      } catch (rollbackError) {
        logger.error(`Could not roll back Firebase email for user ${user.id}:`, rollbackError);
      }
      if (dbError?.code === UNIQUE_VIOLATION) {
        return res.status(409).json({
          error: "That email address is already in use by another account.",
          code: "EMAIL_IN_USE",
        });
      }
      throw dbError;
    }

    if (!consumed) {
      // Another request claimed the token first. If it landed on the same
      // address the outcome is identical, so answer as a success.
      const current = await userService.getUserByFirebaseUid(user.firebaseUid);
      if (current?.username.trim().toLowerCase() === email) {
        return res.json({
          success: true,
          email,
          alreadyConfirmed: true,
          uid: user.firebaseUid,
          sessionToken: await mintSessionToken(),
        });
      }
      return res.status(410).json({
        error: "This link has already been used or replaced. Request a new one from your profile.",
        code: "TOKEN_UNKNOWN",
      });
    }

    logger.info(`✅ Email verified for user ${user.id}`);

    // The welcome email is the first thing a verified address should receive, and
    // this is the one moment we know it is deliverable.
    if (!consumed.welcomeEmailSentAt) {
      try {
        const welcome = generateWelcomeEmail({
          fullName: friendlyName(req, email),
          email,
          role: (consumed.role ?? "chef") as "chef" | "manager" | "admin",
        });
        const sent = await sendEmail(welcome, {
          trackingId: `welcome_verified_${consumed.id}_${verifiedAt.getTime()}`,
        });
        if (sent) {
          await userService.updateUser(consumed.id, { welcomeEmailSentAt: verifiedAt });
        }
      } catch (welcomeError) {
        // Verification already succeeded; a failed welcome email must not undo it.
        logger.error(`Failed to send welcome email after verification for user ${user.id}:`, welcomeError);
      }
    }

    return res.json({
      success: true,
      email,
      role: consumed.role,
      emailVerifiedAt: verifiedAt.toISOString(),
      // Lets the browser that owned the session sign straight back in on the same uid,
      // so verifying an address never signs the user out. Null when the link was opened
      // elsewhere — the address is still verified, they just are not signed in here.
      uid: user.firebaseUid,
      sessionToken: await mintSessionToken(),
    });
  } catch (error) {
    logger.error("Error confirming email verification:", error);
    return res.status(500).json({
      error: "We could not confirm this email address. Please try again.",
      code: "INTERNAL_ERROR",
    });
  }
});

/**
 * GET /api/user/email/verification/status
 *
 * Polled by the profile card while a link is outstanding, so a verification
 * completed on another device is picked up without a full reload.
 */
router.get("/status", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const user = req.neonUser!;
    return res.json(
      buildEmailVerificationStatus(user, req.firebaseUser?.email_verified === true)
    );
  } catch (error) {
    logger.error("Error reading email verification status:", error);
    return res.status(500).json({ error: "Please try again.", code: "INTERNAL_ERROR" });
  }
});

export default router;
