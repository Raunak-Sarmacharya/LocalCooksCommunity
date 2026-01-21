import { Router, Request, Response } from 'express';
import { requireFirebaseAuthWithUser } from '../../firebase-auth-middleware';
import { firebaseStorage } from '../../storage-firebase';

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
            firebaseStorage.getApplicationsByUserId(userId),
            firebaseStorage.getMicrolearningProgress(userId)
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

export const dashboardRouter = router;
