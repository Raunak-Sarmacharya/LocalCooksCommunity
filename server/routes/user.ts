import { Router, Request, Response } from "express";
import { userService } from "../domains/users/user.service";
import { requireFirebaseAuthWithUser } from "../firebase-auth-middleware";
import { sendEmail, generateWelcomeEmail } from "../email";

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

export default router;
