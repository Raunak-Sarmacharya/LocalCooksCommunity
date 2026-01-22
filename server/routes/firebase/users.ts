import { Router, Request, Response } from 'express';
import { requireFirebaseAuthWithUser, verifyFirebaseAuth } from '../../firebase-auth-middleware';
// import { firebaseStorage } from '../../storage-firebase'; // Legacy storage removed
// import { db } from '../../db'; // Direct DB access removed
import { UserRepository } from '../../domains/users/user.repository';
import { UserService } from '../../domains/users/user.service';
import { DomainError } from '../../shared/errors/domain-error';

const router = Router();

// Initialize Services
const userRepo = new UserRepository();
const userService = new UserService(userRepo);

// 🔥 Get Current User Profile (with Firebase Auth)
router.get('/user/profile', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        // req.neonUser is now populated by middleware with Neon user data
        // req.firebaseUser contains Firebase auth data

        // Use UserService to get complete profile (fetches fresh data + application name)
        const completeProfile = await userService.getCompleteProfile(req.neonUser!.id);

        // Map to expected response format (backward compatibility)
        // The DTO structure is already very close to what frontend expects

        // Log user data for debugging
        console.log(`[USER PROFILE] Returning profile for user ${req.neonUser!.id}`, {
            id: completeProfile.id,
            role: completeProfile.role,
            isChef: completeProfile.isChef
        });

        // Return flat structure expected by frontend
        res.json({
            id: completeProfile.id,
            username: completeProfile.username,
            role: completeProfile.role,
            isVerified: completeProfile.isVerified,
            is_verified: completeProfile.isVerified, // Alias
            hasSeenWelcome: completeProfile.has_seen_welcome,
            has_seen_welcome: completeProfile.has_seen_welcome, // Alias
            isChef: completeProfile.isChef,
            isManager: completeProfile.isManager,
            isPortalUser: completeProfile.isPortalUser,
            displayName: completeProfile.displayName,
            fullName: completeProfile.fullName,
            stripeConnectAccountId: completeProfile.stripeConnectAccountId,
            stripe_connect_account_id: completeProfile.stripeConnectAccountId, // Alias
            stripeConnectOnboardingStatus: completeProfile.stripeConnectOnboardingStatus,
            stripe_connect_onboarding_status: completeProfile.stripeConnectOnboardingStatus, // Alias

            // Legacy nested structures
            neonUser: {
                id: completeProfile.id,
                username: completeProfile.username,
                role: completeProfile.role,
                isChef: completeProfile.isChef,
                isManager: completeProfile.isManager,
                isVerified: completeProfile.isVerified,
            },
            firebaseUser: {
                uid: completeProfile.firebaseUser.uid,
                email: completeProfile.firebaseUser.email,
                emailVerified: completeProfile.firebaseUser.emailVerified,
            }
        });
    } catch (error) {
        console.error('Error getting user profile:', error);
        if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
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

        // Get user from service by Firebase UID
        const user = await userService.getUserByFirebaseUid(req.firebaseUser.uid);

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
            is_verified: user.isVerified, // DTO uses isVerified
            has_seen_welcome: user.has_seen_welcome,
            firebaseUid: user.firebaseUid
        });
    } catch (error) {
        console.error('Error getting user:', error);
        if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
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
            // Use Service to update verification
            await userService.verifyUser(neonUserId, true);
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
        if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        res.status(500).json({ error: 'Failed to sync verification status' });
    }
});

// 🔥 Set has_seen_welcome = true for current user
router.post('/user/seen-welcome', verifyFirebaseAuth, async (req: Request, res: Response) => {
    try {
        if (!req.firebaseUser) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Get user from service to find ID (since we only have firebase uid here)
        const user = await userService.getUserByFirebaseUid(req.firebaseUser.uid);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        await userService.markWelcomeSeen(user.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Error setting has_seen_welcome:', error);
        if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
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

        // Use Service for update
        await userService.updateUser(req.neonUser!.id, {
            isChef: isChef
        });

        res.json({
            success: true,
            message: 'User roles updated successfully'
        });
    } catch (error) {
        console.error('Error updating user roles:', error);
        if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ error: error.message, message: error.message });
        }
        res.status(500).json({
            error: 'Failed to update user roles',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export const usersRouter = router;
