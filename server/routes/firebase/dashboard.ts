import { Router, Request, Response } from 'express';
import { requireFirebaseAuthWithUser } from '../../firebase-auth-middleware';
import { applicationService } from '../../domains/applications/application.service';
import { microlearningService } from '../../domains/microlearning/microlearning.service';

const router = Router();

// 🔥 Get User Dashboard Data (Firebase Auth, NO SESSIONS)
router.get('/firebase/dashboard', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        // This demonstrates the translation pattern:
        // Firebase UID → Neon User ID → Data from multiple tables

        const userId = req.neonUser!.id; // Neon user ID
        const firebaseUid = req.firebaseUser!.uid; // Firebase UID

        console.log(`🏠 Dashboard request: Firebase UID ${firebaseUid} → Neon User ID ${userId}`);

        // Fetch data from multiple sources using Neon user ID
        const [applications, microlearningProgress] = await Promise.all([
            applicationService.getApplicationsByUserId(userId),
            microlearningService.getUserProgress(userId)
        ]);

        res.json({
            user: {
                id: userId,
                username: req.neonUser!.username,
                role: req.neonUser!.role,
                firebaseUid: firebaseUid
            },
            applications,
            microlearningProgress,
        });
    } catch (error) {
        console.error('Error getting dashboard data:', error);
        res.status(500).json({ error: 'Failed to get dashboard data' });
    }
});

// 🔥 Get current user's LocalCooks platform applications (Firebase Auth)
router.get('/firebase/applications/my', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const userId = req.neonUser!.id;
        console.log(`📋 GET /api/firebase/applications/my - User ${userId}`);

        const applications = await applicationService.getApplicationsByUserId(userId);

        // Transform to include both camelCase and snake_case for frontend compatibility
        const transformed = applications.map((app: any) => ({
            ...app,
            // Add snake_case aliases for legacy frontend compatibility
            user_id: app.userId,
            full_name: app.fullName,
            created_at: app.createdAt,
            food_safety_license: app.foodSafetyLicense,
            food_safety_license_url: app.foodSafetyLicenseUrl,
        }));

        res.json(transformed);
    } catch (error) {
        console.error('Error getting user applications:', error);
        res.status(500).json({ error: 'Failed to get applications' });
    }
});

export const dashboardRouter = router;
