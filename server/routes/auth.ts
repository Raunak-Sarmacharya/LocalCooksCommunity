import { Router, Request, Response } from "express";
import passport from "passport";
import crypto from 'crypto';
import { pool } from '../db';
import { sendEmail, generateEmailVerificationEmail } from '../email';
import { storage } from "../storage";
import bcrypt from 'bcryptjs';

const router = Router();

// Facebook authentication
router.get("/facebook", (req, res, next) => {
  console.log("Starting Facebook auth flow");
  if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
    passport.authenticate("facebook", {
      scope: ["email"],
      failureRedirect: "/login?error=facebook_auth_failed",
      state: Date.now().toString() // Add state parameter for security
    })(req, res, next);
  } else {
    console.error("Facebook OAuth credentials not configured");
    res.redirect("/login?error=facebook_not_configured");
  }
});

router.get(
  "/facebook/callback",
  (req: any, res: any, next: any) => {
    console.log("Facebook OAuth callback received:", req.query);
    // Check for error in the callback
    if (req.query.error) {
      console.error("Facebook OAuth error:", req.query.error);
      return res.redirect(`/login?error=${req.query.error}`);
    }
    next();
  },
  passport.authenticate("facebook", {
    failureRedirect: "/login?error=facebook_callback_failed",
    failWithError: true
  }),
  (req: any, res: any) => {
    // Successful authentication
    console.log("Facebook authentication successful");
    res.redirect("/");
  },
  // Error handler
  (err: any, req: any, res: any, next: any) => {
    console.error("Facebook authentication error:", err);
    res.redirect("/login?error=internal_error");
  }
);

// Instagram authentication
router.get("/instagram", (req, res, next) => {
  console.log("Starting Instagram auth flow");
  if (process.env.INSTAGRAM_CLIENT_ID && process.env.INSTAGRAM_CLIENT_SECRET) {
    passport.authenticate("instagram", {
      failureRedirect: "/login?error=instagram_auth_failed",
      state: Date.now().toString() // Add state parameter for security
    })(req, res, next);
  } else {
    console.error("Instagram OAuth credentials not configured");
    res.redirect("/login?error=instagram_not_configured");
  }
});

router.get(
  "/instagram/callback",
  (req: any, res: any, next: any) => {
    console.log("Instagram OAuth callback received:", req.query);
    // Check for error in the callback
    if (req.query.error) {
      console.error("Instagram OAuth error:", req.query.error);
      return res.redirect(`/login?error=${req.query.error}`);
    }
    next();
  },
  passport.authenticate("instagram", {
    failureRedirect: "/login?error=instagram_callback_failed",
    failWithError: true
  }),
  (req: any, res: any) => {
    // Successful authentication
    console.log("Instagram authentication successful");
    res.redirect("/");
  },
  // Error handler
  (err: any, req: any, res: any, next: any) => {
    console.error("Instagram authentication error:", err);
    res.redirect("/login?error=internal_error");
  }
);


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

    // Store verification token in database directly (bypassing storage interface for now)
    await pool.query(`
        INSERT INTO email_verification_tokens (email, token, expires_at, created_at) 
        VALUES ($1, $2, $3, NOW()) 
        ON CONFLICT (email) DO UPDATE SET token = $2, expires_at = $3, created_at = NOW()
      `, [email, verificationToken, verificationTokenExpiry]);

    // Generate verification URL
    const verificationUrl = `${process.env.BASE_URL || 'http://localhost:5000'}/auth/verify-email?token=${verificationToken}`;

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

    // Verify token and get email - using direct database query
    const result = await pool.query(
      'SELECT email FROM email_verification_tokens WHERE token = $1 AND expires_at > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid or expired verification token" });
    }

    const { email } = result.rows[0];

    // Mark email as verified - need to update Firebase user too
    await pool.query('UPDATE users SET is_verified = true, updated_at = NOW() WHERE email = $1', [email]);

    // Also update the user in the users table (using Firebase UID)
    await pool.query('UPDATE users SET is_verified = true, updated_at = NOW() WHERE email = $1', [email]);

    // Clear verification token
    await pool.query('DELETE FROM email_verification_tokens WHERE token = $1', [token]);

    console.log(`Email verified successfully: ${email}`);

    // Redirect to success page
    return res.redirect(`${process.env.BASE_URL || 'http://localhost:5000'}/auth?verified=true`);

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
    if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const user = req.user;
    await storage.setUserHasSeenWelcome(user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error setting has_seen_welcome:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
