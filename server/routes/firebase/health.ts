import { Router, Request, Response } from 'express';

const router = Router();

// 🔥 Health Check Endpoint (No Auth Required)
router.get('/firebase-health', (req: Request, res: Response) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        message: 'Firebase Auth → Neon DB bridge is working',
        architecture: 'Stateless JWT - No Sessions Required',
        auth: {
            firebaseConfigured: !!process.env.FIREBASE_PROJECT_ID,
            neonConfigured: !!process.env.DATABASE_URL,
            sessionFree: true
        }
    });
});

export const healthRouter = router;
