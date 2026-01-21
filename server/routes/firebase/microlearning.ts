import { Router, Request, Response } from 'express';
import { requireFirebaseAuthWithUser } from '../../firebase-auth-middleware';
import { firebaseStorage } from '../../storage-firebase';

const router = Router();

// 🔥 Microlearning Progress Endpoint (Firebase Auth, NO SESSIONS)
// 🔥 Microlearning Progress Endpoint (Firebase Auth, NO SESSIONS)
router.post('/firebase/microlearning/progress', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const { videoId, progress, completed } = req.body;
        const userId = req.neonUser!.id; // Neon user ID (numeric)

        console.log(`📺 Video progress update: Firebase UID ${req.firebaseUser!.uid} → Neon User ID ${userId}`);

        await firebaseStorage.updateVideoProgress({
            userId,
            videoId,
            progress,
            completed
        });

        res.json({ success: true, message: 'Progress updated' });
    } catch (error) {
        console.error('Error updating video progress:', error);
        res.status(500).json({ error: 'Failed to update progress' });
    }
});

// Firebase microlearning progress by userId (GET)
// Note: :userId can be either a Neon numeric ID or a Firebase UID
router.get('/firebase/microlearning/progress/:userId', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const userIdParam = req.params.userId;
        const currentUserId = req.neonUser!.id;
        const currentFirebaseUid = req.firebaseUser!.uid;

        // Determine if the request is for the current user
        // Support both Neon numeric ID and Firebase UID for compatibility
        const isNumeric = !isNaN(parseInt(userIdParam));
        const requestedUserId = isNumeric ? parseInt(userIdParam) : null;
        const isOwnData = userIdParam === currentFirebaseUid || requestedUserId === currentUserId;
        const isAdmin = req.neonUser!.role === 'admin';

        // Verify user can access this data (either their own or admin)
        if (!isOwnData && !isAdmin) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Use the current user's Neon ID for own data, or the requested ID for admin
        const targetUserId = isOwnData ? currentUserId : requestedUserId;
        if (!targetUserId) {
            return res.status(400).json({ message: 'Invalid user ID' });
        }

        const progress = await firebaseStorage.getMicrolearningProgress(targetUserId);
        const completionStatus = await firebaseStorage.getMicrolearningCompletion(targetUserId);

        // Check if user has approved application
        const applications = await firebaseStorage.getApplicationsByUserId(targetUserId);
        const hasApproval = applications.some((app: any) => app.status === 'approved');

        const isCompleted = completionStatus?.confirmed || false;
        const accessLevel = isAdmin || hasApproval || isCompleted ? 'full' : 'limited';

        res.json({
            success: true,
            progress: progress || [],
            completionConfirmed: completionStatus?.confirmed || false,
            completedAt: completionStatus?.completedAt,
            hasApprovedApplication: hasApproval,
            accessLevel: accessLevel,
            isAdmin: isAdmin
        });
    } catch (error) {
        console.error('Error fetching microlearning progress:', error);
        res.status(500).json({ message: 'Failed to fetch progress' });
    }
});

// Firebase microlearning completion endpoint
// Note: :userId can be either a Neon numeric ID or a Firebase UID
router.get('/firebase/microlearning/completion/:userId', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const userIdParam = req.params.userId;
        const currentUserId = req.neonUser!.id;
        const currentFirebaseUid = req.firebaseUser!.uid;

        // Determine if the request is for the current user
        // Support both Neon numeric ID and Firebase UID for compatibility
        const isNumeric = !isNaN(parseInt(userIdParam));
        const requestedUserId = isNumeric ? parseInt(userIdParam) : null;
        const isOwnData = userIdParam === currentFirebaseUid || requestedUserId === currentUserId;
        const isAdmin = req.neonUser!.role === 'admin';

        // Verify user can access this completion (either their own or admin)
        if (!isOwnData && !isAdmin) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Use the current user's Neon ID for own data, or the requested ID for admin
        const targetUserId = isOwnData ? currentUserId : requestedUserId;
        if (!targetUserId) {
            return res.status(400).json({ message: 'Invalid user ID' });
        }

        const completion = await firebaseStorage.getMicrolearningCompletion(targetUserId);

        if (!completion) {
            return res.status(404).json({ message: 'No completion found' });
        }

        res.json(completion);
    } catch (error) {
        console.error('Error getting microlearning completion status:', error);
        res.status(500).json({ message: 'Failed to get completion status' });
    }
});

// Firebase microlearning complete endpoint
router.post('/firebase/microlearning/complete', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const { userId, completionDate, videoProgress } = req.body;
        const currentUserId = req.neonUser!.id;

        // Verify user can complete this (either their own or admin)
        if (currentUserId !== userId && req.neonUser!.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Check if user has approved application
        const applications = await firebaseStorage.getApplicationsByUserId(userId);
        const hasApproval = applications.some((app: any) => app.status === 'approved');
        const isAdmin = req.neonUser!.role === 'admin';

        if (!hasApproval && !isAdmin) {
            return res.status(403).json({
                message: 'Application approval required to complete full certification',
                accessLevel: 'limited',
                requiresApproval: true
            });
        }

        // Verify all required videos are completed
        const requiredVideos = [
            'basics-personal-hygiene', 'basics-temperature-danger', 'basics-cross-contamination',
            'basics-allergen-awareness', 'basics-food-storage', 'basics-cooking-temps',
            'basics-cooling-reheating', 'basics-thawing', 'basics-receiving', 'basics-fifo',
            'basics-illness-reporting', 'basics-pest-control', 'basics-chemical-safety', 'basics-food-safety-plan',
            'howto-handwashing', 'howto-sanitizing', 'howto-thermometer', 'howto-cleaning-schedule',
            'howto-equipment-cleaning', 'howto-uniform-care', 'howto-wound-care', 'howto-inspection-prep'
        ];
        const completedVideos = videoProgress.filter((v: any) => v.completed).map((v: any) => v.videoId);
        const allRequired = requiredVideos.every((videoId: string) => completedVideos.includes(videoId));

        if (!allRequired) {
            return res.status(400).json({
                message: 'All required videos must be completed before certification',
                missingVideos: requiredVideos.filter(id => !completedVideos.includes(id))
            });
        }

        const user = await firebaseStorage.getUser(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const completionData = {
            userId,
            completedAt: new Date(completionDate),
            videoProgress,
            confirmed: true,
            certificateGenerated: false
        };

        await firebaseStorage.createMicrolearningCompletion(completionData);

        res.json({
            success: true,
            message: 'Microlearning completed successfully',
            completionConfirmed: true
        });
    } catch (error) {
        console.error('Error completing microlearning:', error);
        res.status(500).json({ message: 'Failed to complete microlearning' });
    }
});

// Firebase microlearning certificate endpoint
// Note: :userId can be either a Neon numeric ID or a Firebase UID
router.get('/firebase/microlearning/certificate/:userId', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const userIdParam = req.params.userId;
        const currentUserId = req.neonUser!.id;
        const currentFirebaseUid = req.firebaseUser!.uid;

        // Determine if the request is for the current user
        // Support both Neon numeric ID and Firebase UID for compatibility
        const isNumeric = !isNaN(parseInt(userIdParam));
        const requestedUserId = isNumeric ? parseInt(userIdParam) : null;
        const isOwnData = userIdParam === currentFirebaseUid || requestedUserId === currentUserId;
        const isAdmin = req.neonUser!.role === 'admin';

        // Verify user can access this certificate (either their own or admin)
        if (!isOwnData && !isAdmin) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Use the current user's Neon ID for own data, or the requested ID for admin
        const targetUserId = isOwnData ? currentUserId : requestedUserId;
        if (!targetUserId) {
            return res.status(400).json({ message: 'Invalid user ID' });
        }

        const completion = await firebaseStorage.getMicrolearningCompletion(targetUserId);
        if (!completion || !completion.confirmed) {
            return res.status(404).json({ message: 'No confirmed completion found' });
        }

        const user = await firebaseStorage.getUser(targetUserId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Return certificate URL
        const certificateUrl = `/api/certificates/microlearning-${targetUserId}-${Date.now()}.pdf`;

        res.json({
            success: true,
            certificateUrl,
            completionDate: completion.completedAt,
            message: 'Certificate for skillpass.nl food safety training preparation - Complete your official certification at skillpass.nl'
        });
    } catch (error) {
        console.error('Error getting microlearning certificate:', error);
        res.status(500).json({ message: 'Failed to get certificate' });
    }
});

export const microlearningRouter = router;
