import { Router, Request, Response } from "express";
import { userService } from "../domains/users/user.service";
import { requireFirebaseAuthWithUser } from "../firebase-auth-middleware";
import { sendEmail, generateWelcomeEmail } from "../email";
import { getFirebaseUserByEmail } from "../firebase-setup";

const router = Router();

// ===================================
// USER PROFILE & ONBOARDING ROUTES
// ===================================

/**
 * GET /api/user/profile
 * Get current user's profile with verification status sync
 */
router.get("/profile", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    let user = req.neonUser!;
    
    // CRITICAL: Update is_verified status if Firebase reports email is verified
    // This handles the case where user verifies email via Firebase but Neon DB wasn't updated
    const firebaseEmailVerified = req.firebaseUser?.email_verified;
    if (firebaseEmailVerified && !user.isVerified) {
      console.log(`📧 Updating is_verified for user ${user.id} - Firebase email verified (profile fetch)`);
      const updatedUser = await userService.updateUser(user.id, { isVerified: true });
      if (updatedUser) {
        user = updatedUser;
      }
    }
    
    // Drizzle maps is_verified -> isVerified, but legacy frontend code expects is_verified
    const responseUser = {
      ...user,
      is_verified: user.isVerified
    };
    res.json(responseUser);
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ error: "Failed to fetch user profile" });
  }
});

/**
 * POST /api/user/seen-welcome
 * Mark the welcome/onboarding screen as seen for the current user
 */
router.post("/seen-welcome", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const user = req.neonUser!;
    console.log(`🎉 Marking welcome screen as seen for user ${user.id}`);
    await userService.updateUser(user.id, { has_seen_welcome: true });
    res.json({ success: true });
  } catch (error) {
    console.error("Error setting has_seen_welcome:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/user/logout
 * Logout endpoint - Firebase Auth is stateless, so this just returns success
 * The actual logout happens client-side via Firebase signOut()
 */
router.post("/logout", async (req: Request, res: Response) => {
  // Firebase Auth is stateless (JWT-based), no server session to destroy
  // This endpoint exists for compatibility with frontend logout calls
  console.log("🚪 Logout request received (Firebase Auth is stateless)");
  res.json({ success: true, message: "Logged out successfully" });
});

/**
 * POST /api/user/sync
 * Sync Firebase user to Neon database, updating verification status if needed
 */
router.post("/sync", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    let user = req.neonUser!;
    
    // CRITICAL: Update is_verified status if Firebase reports email is verified
    // This handles the case where user verifies email via Firebase but Neon DB wasn't updated
    const firebaseEmailVerified = req.firebaseUser?.email_verified;
    if (firebaseEmailVerified && !user.isVerified) {
      console.log(`📧 Updating is_verified for user ${user.id} - Firebase email verified`);
      const updatedUser = await userService.updateUser(user.id, { isVerified: true });
      if (updatedUser) {
        user = updatedUser;
      }
    }
    
    res.json(user);
  } catch (error) {
    console.error("Error syncing user:", error);
    res.status(500).json({ error: "Failed to sync user" });
  }
});

/**
 * POST /api/user/chef-onboarding-complete
 * Mark chef onboarding as complete
 * This is an INFORMATIVE onboarding - no restrictions, just grants full dashboard access
 */
router.post("/chef-onboarding-complete", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const user = req.neonUser!;
    const { selectedPaths } = req.body;
    
    console.log(`🎓 Marking chef onboarding complete for user ${user.id}, paths: ${JSON.stringify(selectedPaths)}`);
    
    // Update user to mark chef onboarding as complete
    // Store selected paths for future reference
    await userService.updateUser(user.id, { 
      chefOnboardingCompleted: true,
      chefOnboardingPaths: selectedPaths || []
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error("Error marking chef onboarding complete:", error);
    res.status(500).json({ error: "Failed to mark onboarding complete" });
  }
});

// ===================================
// ENTERPRISE-GRADE EMAIL VERIFICATION SYNC
// ===================================

/**
 * POST /api/sync-verification-status
 * 
 * ENTERPRISE-GRADE: Sync email verification status from Firebase to Neon database
 * and send welcome email ONLY on first verification (idempotent).
 * 
 * This endpoint is called after a user clicks the email verification link in Firebase.
 * It ensures:
 * 1. Database verification status is synced with Firebase
 * 2. Welcome email is sent exactly once (tracked via welcomeEmailSentAt)
 * 3. Proper error handling and logging for debugging
 * 
 * Flow:
 * 1. User registers → isVerified=false, welcomeEmailSentAt=null
 * 2. User clicks verification link → Firebase marks email as verified
 * 3. Client calls this endpoint → We update isVerified=true AND send welcome email
 * 4. welcomeEmailSentAt is set → Future calls won't send duplicate emails
 */
router.post("/sync-verification-status", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    let user = req.neonUser!;
    const firebaseEmailVerified = req.firebaseUser?.email_verified;
    const firebaseDisplayName = req.firebaseUser?.name;
    
    console.log(`🔄 SYNC VERIFICATION STATUS for user ${user.id} (${user.username})`);
    console.log(`   - Firebase email_verified: ${firebaseEmailVerified}`);
    console.log(`   - Database isVerified: ${user.isVerified}`);
    console.log(`   - Welcome email already sent: ${user.welcomeEmailSentAt ? 'YES' : 'NO'}`);
    
    let welcomeEmailSent = false;
    let verificationUpdated = false;
    
    // CRITICAL: Only process if Firebase says email is verified
    if (firebaseEmailVerified) {
      // Check if we need to update verification status in database
      if (!user.isVerified) {
        console.log(`📧 Updating is_verified for user ${user.id} - Firebase email verified`);
        const updatedUser = await userService.updateUser(user.id, { isVerified: true });
        if (updatedUser) {
          user = updatedUser;
          verificationUpdated = true;
        }
      }
      
      // ENTERPRISE: Send welcome email ONLY if not already sent (idempotency check)
      // This prevents duplicate welcome emails on multiple sync calls
      if (!user.welcomeEmailSentAt) {
        console.log(`📧 SENDING WELCOME EMAIL to newly verified user: ${user.username}`);
        
        try {
          const displayName = firebaseDisplayName || user.username.split('@')[0];
          const welcomeEmail = generateWelcomeEmail({
            fullName: displayName,
            email: user.username
          });
          
          const emailResult = await sendEmail(welcomeEmail, {
            trackingId: `welcome_verified_${user.id}_${Date.now()}`
          });
          
          if (emailResult) {
            // Mark welcome email as sent with timestamp (idempotency)
            await userService.updateUser(user.id, { 
              welcomeEmailSentAt: new Date() 
            });
            welcomeEmailSent = true;
            console.log(`✅ Welcome email sent successfully to ${user.username}`);
          } else {
            console.error(`❌ Failed to send welcome email to ${user.username} - sendEmail returned false`);
          }
        } catch (emailError) {
          console.error(`❌ Error sending welcome email to ${user.username}:`, emailError);
          // Don't fail the sync if email fails - user is still verified
        }
      } else {
        console.log(`ℹ️ Welcome email already sent at ${user.welcomeEmailSentAt} - skipping duplicate`);
      }
    } else {
      console.log(`⚠️ Firebase email not verified - no action taken`);
    }
    
    // Return comprehensive status for debugging
    res.json({
      success: true,
      userId: user.id,
      email: user.username,
      firebaseVerified: firebaseEmailVerified,
      databaseVerified: user.isVerified,
      verificationUpdated,
      welcomeEmailSent,
      welcomeEmailPreviouslySent: !!user.welcomeEmailSentAt && !welcomeEmailSent
    });
    
  } catch (error) {
    console.error("❌ Error in sync-verification-status:", error);
    res.status(500).json({ 
      error: "Failed to sync verification status",
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ===================================
// PUBLIC EMAIL VERIFICATION SYNC (NO AUTH REQUIRED)
// ===================================

/**
 * POST /api/user/verify-email-complete
 * 
 * ENTERPRISE-GRADE: Public endpoint to sync email verification status after user
 * clicks the Firebase verification link. This endpoint does NOT require authentication
 * because the user is not signed in when they click the email verification link.
 * 
 * SECURITY:
 * - Uses Firebase Admin SDK to verify the email is actually verified in Firebase
 * - Only updates if Firebase confirms emailVerified=true
 * - Rate limiting should be applied at infrastructure level
 * 
 * This solves the critical issue where:
 * 1. User clicks verification link in email
 * 2. Firebase marks email as verified via applyActionCode()
 * 3. But user is NOT signed in, so we can't get a token to call authenticated endpoints
 * 4. This public endpoint uses Firebase Admin SDK to verify status server-side
 */
router.post("/verify-email-complete", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    
    console.log(`🔄 PUBLIC VERIFY-EMAIL-COMPLETE for email: ${email}`);
    
    // SECURITY: Use Firebase Admin SDK to verify the email is actually verified
    const firebaseUser = await getFirebaseUserByEmail(email);
    
    if (!firebaseUser) {
      console.log(`❌ Firebase user not found for email: ${email}`);
      return res.status(404).json({ error: "User not found in Firebase" });
    }
    
    console.log(`   - Firebase emailVerified: ${firebaseUser.emailVerified}`);
    console.log(`   - Firebase UID: ${firebaseUser.uid}`);
    
    if (!firebaseUser.emailVerified) {
      console.log(`⚠️ Firebase email NOT verified for: ${email}`);
      return res.status(400).json({ 
        error: "Email not verified in Firebase",
        firebaseVerified: false 
      });
    }
    
    // Find user in Neon database by email (username)
    const user = await userService.getUserByUsername(email);
    
    if (!user) {
      console.log(`❌ User not found in Neon DB for email: ${email}`);
      return res.status(404).json({ error: "User not found in database" });
    }
    
    console.log(`   - Neon user ID: ${user.id}`);
    console.log(`   - Neon isVerified: ${user.isVerified}`);
    console.log(`   - Welcome email already sent: ${user.welcomeEmailSentAt ? 'YES' : 'NO'}`);
    
    let verificationUpdated = false;
    let welcomeEmailSent = false;
    
    // Update verification status if not already verified
    if (!user.isVerified) {
      console.log(`📧 Updating is_verified for user ${user.id}`);
      await userService.updateUser(user.id, { isVerified: true });
      verificationUpdated = true;
    }
    
    // ENTERPRISE: Send welcome email ONLY if not already sent (idempotency)
    // Uses retry mechanism with exponential backoff for reliability
    if (!user.welcomeEmailSentAt) {
      console.log(`📧 SENDING WELCOME EMAIL to newly verified user: ${email}`);
      console.log(`📧 Email configuration check:`, {
        hasEmailUser: !!process.env.EMAIL_USER,
        hasEmailPass: !!process.env.EMAIL_PASS,
        hasEmailFrom: !!process.env.EMAIL_FROM,
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown'
      });
      
      const displayName = firebaseUser.displayName || email.split('@')[0];
      const welcomeEmail = generateWelcomeEmail({
        fullName: displayName,
        email: email
      });
      
      console.log(`📧 Generated welcome email:`, {
        to: welcomeEmail.to,
        subject: welcomeEmail.subject,
        hasHtml: !!welcomeEmail.html,
        hasText: !!welcomeEmail.text,
        htmlLength: welcomeEmail.html?.length || 0,
        textLength: welcomeEmail.text?.length || 0
      });
      
      // ENTERPRISE: Retry mechanism with exponential backoff
      const MAX_RETRIES = 3;
      let lastError: Error | null = null;
      
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          console.log(`📧 Welcome email attempt ${attempt}/${MAX_RETRIES} for ${email}`);
          
          const emailResult = await sendEmail(welcomeEmail, {
            trackingId: `welcome_verified_public_${user.id}_${Date.now()}_attempt${attempt}`
          });
          
          if (emailResult) {
            // Mark welcome email as sent with timestamp (idempotency)
            await userService.updateUser(user.id, { welcomeEmailSentAt: new Date() });
            welcomeEmailSent = true;
            console.log(`✅ Welcome email sent successfully to ${email} on attempt ${attempt}`);
            break; // Success - exit retry loop
          } else {
            console.error(`❌ sendEmail returned false for ${email} on attempt ${attempt}`);
            lastError = new Error('sendEmail returned false');
          }
        } catch (emailError) {
          lastError = emailError instanceof Error ? emailError : new Error(String(emailError));
          console.error(`❌ Error sending welcome email to ${email} on attempt ${attempt}:`, {
            error: lastError.message,
            stack: lastError.stack
          });
        }
        
        // Exponential backoff before retry (1s, 2s, 4s)
        if (attempt < MAX_RETRIES) {
          const backoffMs = Math.pow(2, attempt - 1) * 1000;
          console.log(`⏳ Waiting ${backoffMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
      
      // Log final status if all retries failed
      if (!welcomeEmailSent) {
        console.error(`❌ CRITICAL: All ${MAX_RETRIES} attempts to send welcome email failed for ${email}`);
        console.error(`❌ Last error:`, lastError?.message || 'Unknown error');
        // Don't fail the verification - user can still log in
        // The email can be resent manually or via a background job
      }
    } else {
      console.log(`ℹ️ Welcome email already sent at ${user.welcomeEmailSentAt} - skipping`);
    }
    
    res.json({
      success: true,
      userId: user.id,
      email: email,
      firebaseVerified: true,
      databaseVerified: true,
      verificationUpdated,
      welcomeEmailSent,
      welcomeEmailPreviouslySent: !!user.welcomeEmailSentAt && !welcomeEmailSent,
      // ENTERPRISE: Include email config status for debugging
      emailConfigStatus: {
        hasEmailUser: !!process.env.EMAIL_USER,
        hasEmailPass: !!process.env.EMAIL_PASS,
        hasEmailFrom: !!process.env.EMAIL_FROM,
        environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown'
      }
    });
    
  } catch (error) {
    console.error("❌ Error in verify-email-complete:", error);
    res.status(500).json({ 
      error: "Failed to complete email verification",
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
