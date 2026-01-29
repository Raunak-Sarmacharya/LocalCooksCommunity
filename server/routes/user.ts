import { Router, Request, Response } from "express";
import { userService } from "../domains/users/user.service";
import { requireFirebaseAuthWithUser } from "../firebase-auth-middleware";

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

export default router;
