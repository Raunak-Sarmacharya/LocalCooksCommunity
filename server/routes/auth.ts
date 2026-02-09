import { Router, Request, Response } from "express";
import crypto from 'crypto';
import { db } from '../db';
import { sendEmail, generateEmailVerificationEmail, generateWelcomeEmail, getWebsiteUrl } from '../email';
import { storage } from "../storage";
import { getAuthenticatedUser } from "./middleware";
import { emailVerificationTokens, users } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";

const router = Router();

// Facebook and Instagram auth routes removed in favor of client-side Firebase Auth

// Email verification endpoint
router.post("/send-verification-email", async (req: Request, res: Response) => {
  try {
    const { email, fullName } = req.body;

    if (!email || !fullName) {
      return res.status(400).json({ message: "Email and full name are required" });
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpiry = new Date(Date.now() + 86400000); // 24 hours from now

    // Store verification token in database using Drizzle ORM (upsert)
    await db
      .insert(emailVerificationTokens)
      .values({
        email,
        token: verificationToken,
        expiresAt: verificationTokenExpiry,
      })
      .onConflictDoUpdate({
        target: emailVerificationTokens.email,
        set: {
          token: verificationToken,
          expiresAt: verificationTokenExpiry,
          createdAt: new Date(),
        },
      });

    // Generate verification URL
    const verificationUrl = `${getWebsiteUrl()}/auth/verify-email?token=${verificationToken}`;

    // Send verification email
    const emailContent = generateEmailVerificationEmail({
      fullName,
      email,
      verificationToken,
      verificationUrl
    });

    const emailSent = await sendEmail(emailContent, {
      trackingId: `email_verification_${email}_${Date.now()}`
    });

    if (emailSent) {
      console.log(`Email verification sent to ${email}`);
      return res.status(200).json({
        message: "Verification email sent successfully"
      });
    } else {
      console.error(`Failed to send verification email to ${email}`);
      return res.status(500).json({
        message: "Error sending verification email. Please try again later."
      });
    }
  } catch (error) {
    console.error("Error sending verification email:", error);
    return res.status(500).json({
      message: "Internal server error. Please try again later."
    });
  }
});

// Email verification confirmation endpoint
router.get("/verify-email", async (req: Request, res: Response) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: "Verification token is required" });
    }

    // Verify token and get email using Drizzle ORM
    const [tokenRecord] = await db
      .select({ email: emailVerificationTokens.email })
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.token, token),
          gt(emailVerificationTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!tokenRecord) {
      return res.status(400).json({ message: "Invalid or expired verification token" });
    }

    const { email } = tokenRecord;

    // Get user to check if welcome email was already sent (idempotency)
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.username, email))
      .limit(1);

    // Mark email as verified using Drizzle ORM
    await db
      .update(users)
      .set({ isVerified: true })
      .where(eq(users.username, email));

    // Clear verification token using Drizzle ORM
    await db
      .delete(emailVerificationTokens)
      .where(eq(emailVerificationTokens.token, token));

    console.log(`Email verified successfully: ${email}`);

    // ENTERPRISE: Send welcome email ONLY if not already sent (idempotency check)
    // This prevents duplicate welcome emails if user verifies through multiple paths
    if (!existingUser?.welcomeEmailSentAt) {
      try {
        const welcomeEmail = generateWelcomeEmail({
          fullName: email.split('@')[0], // Best effort name from email since we don't have it easily here
          email,
          role: existingUser?.role as 'chef' | 'manager' | 'admin'
        });
        const emailSent = await sendEmail(welcomeEmail, {
          trackingId: `welcome_verified_legacy_${email}_${Date.now()}`
        });
        
        if (emailSent && existingUser) {
          // Mark welcome email as sent with timestamp (idempotency)
          await db
            .update(users)
            .set({ welcomeEmailSentAt: new Date() })
            .where(eq(users.username, email));
          console.log(`✅ Welcome email sent to verified user: ${email}`);
        }
      } catch (error) {
        console.error("Error sending welcome email in legacy verification:", error);
      }
    } else {
      console.log(`ℹ️ Welcome email already sent to ${email} - skipping duplicate`);
    }

    // Redirect to success page
    return res.redirect(`${getWebsiteUrl()}/auth?verified=true`);

  } catch (error) {
    console.error("Error in email verification:", error);
    return res.status(500).json({
      message: "Internal server error. Please try again later."
    });
  }
});

// Update has seen welcome endpoint
router.post('/seen-welcome', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    await storage.setUserHasSeenWelcome(user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error setting has_seen_welcome:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
