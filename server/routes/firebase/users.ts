import { Router, Request, Response } from 'express';
import { requireFirebaseAuthWithUser, verifyFirebaseAuth } from '../../firebase-auth-middleware';
import { firebaseStorage } from '../../storage-firebase';
import { db } from '../../db';
import { applications, users } from '@shared/schema';
import { desc, eq } from 'drizzle-orm';

const router = Router();

// 🔥 Get Current User Profile (with Firebase Auth)
router.get('/user/profile', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        // req.neonUser is now populated by middleware with Neon user data
        // req.firebaseUser contains Firebase auth data

        // Fetch user's full name from applications
        let userFullName = null;
        let stripeConnectAccountId = null;
        let stripeConnectOnboardingStatus = null;

        try {
            // Get full name from chef applications
            const [chefApp] = await db
                .select({ fullName: applications.fullName })
                .from(applications)
                .where(eq(applications.userId, req.neonUser!.id))
                .orderBy(desc(applications.createdAt))
                .limit(1);

            if (chefApp?.fullName) {
                userFullName = chefApp.fullName;
            }

            // Use Stripe info from req.neonUser which is already populated by middleware
            stripeConnectAccountId = req.neonUser!.stripeConnectAccountId || null;
            stripeConnectOnboardingStatus = req.neonUser!.stripeConnectOnboardingStatus || null;
        } catch (dbError) {
            console.error('Error fetching user data from Drizzle:', dbError);
        }

        // Log user data for debugging
        console.log(`[USER PROFILE] Returning profile for user ${req.neonUser!.id}:`, {
            id: req.neonUser!.id,
            username: req.neonUser!.username,
            role: req.neonUser!.role,
            isChef: req.neonUser!.isChef,
            isManager: req.neonUser!.isManager,
            rawNeonUser: req.neonUser
        });

        // Return flat structure expected by frontend
        res.json({
            id: req.neonUser!.id,
            username: req.neonUser!.username,
            role: req.neonUser!.role,
            isVerified: req.neonUser!.isVerified !== undefined ? req.neonUser!.isVerified : req.firebaseUser!.email_verified,
            is_verified: req.neonUser!.isVerified !== undefined ? req.neonUser!.isVerified : req.firebaseUser!.email_verified,
            hasSeenWelcome: req.neonUser!.has_seen_welcome || false,
            has_seen_welcome: req.neonUser!.has_seen_welcome || false,
            isChef: req.neonUser!.isChef || false,
            isManager: req.neonUser!.isManager || false,
            isPortalUser: (req.neonUser! as any).isPortalUser || false,
            displayName: userFullName || null, // User's full name from application
            fullName: userFullName || null, // Alias for compatibility
            stripeConnectAccountId: stripeConnectAccountId, // Stripe Connect account ID
            stripe_connect_account_id: stripeConnectAccountId, // Alias for compatibility
            stripeConnectOnboardingStatus: stripeConnectOnboardingStatus, // Stripe Connect onboarding status
            stripe_connect_onboarding_status: stripeConnectOnboardingStatus, // Alias for compatibility
            // Also include original structure for compatibility
            neonUser: {
                id: req.neonUser!.id,
                username: req.neonUser!.username,
                role: req.neonUser!.role,
                isChef: req.neonUser!.isChef,
                isManager: req.neonUser!.isManager,
                isVerified: req.neonUser!.isVerified,
            },
            firebaseUser: {
                uid: req.firebaseUser!.uid,
                email: req.firebaseUser!.email,
                emailVerified: req.firebaseUser!.email_verified,
            }
        });
    } catch (error) {
        console.error('Error getting user profile:', error);
        res.status(500).json({ error: 'Failed to get user profile' });
    }
});

// 🔥 Get Current User (Firebase compatible /api/user endpoint)
// IMPORTANT: This endpoint does NOT auto-create users for sign-in
router.get('/user', verifyFirebaseAuth, async (req: Request, res: Response) => {
    try {
        if (!req.firebaseUser) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Get user from database by Firebase UID
        const user = await firebaseStorage.getUserByFirebaseUid(req.firebaseUser.uid);

        if (!user) {
            // Do NOT auto-create for sign-in - return 404 to indicate user needs to register
            return res.status(404).json({
                error: 'User not found',
                message: 'This account is not registered with Local Cooks. Please create an account first.'
            });
        }

        res.json({
            id: user.id,
            username: user.username,
            role: user.role,
            is_verified: (user as any).isVerified,
            has_seen_welcome: (user as any).has_seen_welcome,
            firebaseUid: (user as any).firebaseUid
        });
    } catch (error) {
        console.error('Error getting user:', error);
        res.status(500).json({ error: 'Failed to get user data' });
    }
});

// 🔥 Sync Verification Status (Manual trigger from frontend)
router.post('/sync-verification-status', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        if (!req.firebaseUser || !req.neonUser) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const firebaseVerified = req.firebaseUser.email_verified === true;
        const neonUserId = req.neonUser.id;
        const currentDbVerified = req.neonUser.isVerified === true;

        console.log(`🔄 SYNC VERIFICATION: User ${neonUserId} (Firebase verified: ${firebaseVerified}, DB verified: ${currentDbVerified})`);

        if (firebaseVerified && !currentDbVerified) {
            await db.update(users)
                .set({ isVerified: true })
                .where(eq(users.id, neonUserId));
            console.log(`✅ SYNC SUCCESS: User ${neonUserId} marked as verified in database`);
        }

        res.json({
            success: true,
            firebaseVerified,
            databaseVerified: firebaseVerified || currentDbVerified,
            message: firebaseVerified ? 'Verification status synchronized' : 'User not yet verified in Firebase'
        });
    } catch (error) {
        console.error('❌ Error syncing verification status:', error);
        res.status(500).json({ error: 'Failed to sync verification status' });
    }
});

// 🔥 Set has_seen_welcome = true for current user
router.post('/user/seen-welcome', verifyFirebaseAuth, async (req: Request, res: Response) => {
    try {
        if (!req.firebaseUser) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Get user from database by Firebase UID
        const user = await firebaseStorage.getUserByFirebaseUid(req.firebaseUser.uid);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        await firebaseStorage.setUserHasSeenWelcome(user.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Error setting has_seen_welcome:', error);
        res.status(500).json({ error: 'Failed to update welcome status' });
    }
});

// 🔥 Get Current User Info (Firebase Auth, NO SESSIONS)
// Returns Neon user ID for client-side use (e.g., chat service)
router.get('/firebase/user/me', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        res.json({
            id: req.neonUser!.id,
            username: req.neonUser!.username,
            role: req.neonUser!.role,
            firebaseUid: req.firebaseUser!.uid,
        });
    } catch (error) {
        console.error('Error getting user info:', error);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});

// 🔥 Update User Roles (Firebase Auth, NO SESSIONS)
router.post('/firebase/user/update-roles', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const { isChef } = req.body;

        if (typeof isChef !== 'boolean') {
            return res.status(400).json({
                error: 'Invalid role data. isChef must be a boolean value'
            });
        }

        console.log(`🎯 Updating user roles: Firebase UID ${req.firebaseUser!.uid} → Neon User ID ${req.neonUser!.id} → Chef: ${isChef}`);

        await firebaseStorage.updateUserRoles(req.neonUser!.id, { isChef });

        res.json({
            success: true,
            message: 'User roles updated successfully'
        });
    } catch (error) {
        console.error('Error updating user roles:', error);
        res.status(500).json({
            error: 'Failed to update user roles',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export const usersRouter = router;
