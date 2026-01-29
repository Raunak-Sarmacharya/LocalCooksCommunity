import { Router, Request, Response } from 'express';
import { upload } from '../../fileUpload';
import { requireFirebaseAuthWithUser } from '../../firebase-auth-middleware';
import { handleFileUpload } from '../../upload-handler';

const router = Router();

// 🔥 File Upload Endpoint (Firebase Auth, NO SESSIONS) - Uses Cloudflare R2
const handleUpload = [
    upload.single('file'),
    requireFirebaseAuthWithUser,
    handleFileUpload
];

// Primary endpoint
router.post('/upload', ...handleUpload);

// Alias for backward compatibility
router.post('/firebase/upload-file', ...handleUpload);

export const mediaRouter = router;
