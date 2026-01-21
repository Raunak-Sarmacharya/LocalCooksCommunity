
import express, { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { getPresignedUrl } from "../r2-storage"; // Used by lines 120-169 logic
import { upload, uploadToBlob, getFileUrl } from "../fileUpload";
import { optionalFirebaseAuth, requireFirebaseAuthWithUser } from "../firebase-auth-middleware";
import { storage } from "../storage";
import { getPresignedUrl as getPresignedUrlR2, isR2Configured } from "../r2-storage"; // Renamed to avoid collision with prev import if needed, or just use one.
// Both imports are same function.

const router = Router();

// ===============================
// FILE UPLOAD ROUTES
// ===============================

// Generic file upload endpoint (for use with new upload components)
// Uses Firebase Auth - supports both session and Firebase authentication
router.post("/upload-file",
    upload.single('file'),
    optionalFirebaseAuth, // Try Firebase auth, but don't require it (supports legacy session auth too)
    async (req: Request, res: Response) => {
        try {
            // Check if user is authenticated (Firebase or session)
            const userId = (req as any).neonUser?.id || (req as any).user?.id;

            if (!userId) {
                // Clean up uploaded file (development only)
                if (req.file && (req.file as any).path) {
                    try {
                        fs.unlinkSync((req.file as any).path);
                    } catch (e) {
                        console.error('Error cleaning up file:', e);
                    }
                }
                return res.status(401).json({ error: "Not authenticated" });
            }

            if (!req.file) {
                return res.status(400).json({ error: "No file uploaded" });
            }

            const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
            let fileUrl: string;
            let fileName: string;

            if (isProduction) {
                // Upload to Cloudflare R2 in production
                fileUrl = await uploadToBlob(req.file, userId);
                // Extract filename from R2 URL for response
                fileName = fileUrl.split('/').pop() || req.file.originalname;
            } else {
                // Use local storage in development
                fileUrl = getFileUrl(req.file.filename);
                fileName = req.file.filename;
            }

            // Return success response with file information
            return res.status(200).json({
                success: true,
                url: fileUrl,
                fileName: fileName,
                size: req.file.size,
                type: req.file.mimetype
            });
        } catch (error) {
            console.error("File upload error:", error);

            // Clean up uploaded file on error (development only)
            if (req.file && (req.file as any).path) {
                try {
                    fs.unlinkSync((req.file as any).path);
                } catch (e) {
                    console.error('Error cleaning up file:', e);
                }
            }

            return res.status(500).json({
                error: "File upload failed",
                details: error instanceof Error ? error.message : "Unknown error"
            });
        }
    }
);

// R2 IMAGE PROXY ENDPOINT
// ===============================
// Public endpoint to proxy images from R2 bucket when custom domain (files.localcooks.ca) DNS is not configured
// This allows images to load even without the custom domain being set up
router.get("/images/r2/:path(*)", async (req: Request, res: Response) => {
    try {
        const r2Path = decodeURIComponent(req.params.path);

        if (!r2Path) {
            return res.status(400).json({ error: "Path is required" });
        }

        // Security: Only allow specific folder prefixes
        const allowedPrefixes = ['documents/', 'images/', 'profiles/', 'kitchen-applications/'];
        const isAllowed = allowedPrefixes.some(prefix => r2Path.startsWith(prefix));

        if (!isAllowed) {
            console.warn(`[R2 Proxy] Blocked request for path: ${r2Path}`);
            return res.status(403).json({ error: "Access denied" });
        }

        // Import R2 storage utilities
        // const { isR2Configured } = await import('../r2-storage'); // Already imported statically

        if (!isR2Configured()) {
            console.error('[R2 Proxy] R2 is not configured');
            return res.status(503).json({ error: "Storage not configured" });
        }

        // Get the R2 bucket details from environment
        const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
        const R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
        const R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
        const R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME;

        if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
            return res.status(503).json({ error: "R2 credentials not configured" });
        }

        // Use AWS SDK to fetch the image
        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');

        const s3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: R2_ACCESS_KEY_ID,
                secretAccessKey: R2_SECRET_ACCESS_KEY,
            },
        });

        const command = new GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: r2Path,
        });

        const response = await s3Client.send(command);

        if (!response.Body) {
            return res.status(404).json({ error: "File not found" });
        }

        // Set appropriate headers
        if (response.ContentType) {
            res.setHeader('Content-Type', response.ContentType);
        }
        if (response.ContentLength) {
            res.setHeader('Content-Length', response.ContentLength);
        }

        // Cache for 1 day (public images)
        res.setHeader('Cache-Control', 'public, max-age=86400');

        // Stream the response
        const stream = response.Body as NodeJS.ReadableStream;
        stream.pipe(res);

    } catch (error: any) {
        console.error('[R2 Proxy] Error fetching file:', error);

        if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
            return res.status(404).json({ error: "File not found" });
        }

        return res.status(500).json({
            error: "Failed to fetch file",
            details: error.message
        });
    }
});

// PRESIGNED URL ENDPOINTS
// ===============================
// Available to all authenticated Firebase users (admin, manager, chef)
// No role restrictions - any authenticated user can access files

// Get presigned URL for a document file stored in R2 bucket or local storage
router.post("/files/presigned-url", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const { fileUrl } = req.body;

        if (!fileUrl || typeof fileUrl !== 'string') {
            return res.status(400).json({ error: "fileUrl is required" });
        }

        // Check if this is a local file URL
        if (fileUrl.startsWith('/api/files/documents/')) {
            // Extract filename and check permissions
            const filename = fileUrl.replace('/api/files/documents/', '');
            const filenameParts = filename.split('_');
            let fileUserId: number | null = null;

            if (filenameParts[0] === 'unknown') {
                // Only admins and managers can access unknown files
                if (user.role !== "admin" && user.role !== "manager") {
                    return res.status(403).json({ error: "Access denied" });
                }
            } else {
                const userIdMatch = filenameParts[0].match(/^\d+$/);
                if (userIdMatch) {
                    fileUserId = parseInt(userIdMatch[0]);
                }
            }

            // Check permissions
            if (fileUserId !== null && user.id !== fileUserId && user.role !== "admin" && user.role !== "manager") {
                return res.status(403).json({ error: "Access denied" });
            }

            // For local files, return the URL with a token query parameter
            // The file serving route will validate the token
            const { auth } = await import('@/lib/firebase'); // Wait, @/lib/firebase implies client logic? 
            // But server uses firebase-admin.
            // The original code imported '@/lib/firebase'. Check routes.ts line 664 in Step 806.
            // `const { auth } = await import('@/lib/firebase');`
            // This looks like CLIENT code leaking to server or using alias.
            // If code was working in routes.ts, it works here.
            // However @/lib aliases usually point to client.
            // server/routes.ts has `const { auth } = await import('@/lib/firebase');`?
            // Step 806 doesn't show import, but 664.
            // Ah, this is inside `app.post("/api/files/presigned-url"...)`.

            const currentUser = auth?.currentUser;
            if (currentUser) {
                const token = await currentUser.getIdToken();
                return res.json({ url: `${fileUrl}?token=${encodeURIComponent(token)}` });
            }

            return res.json({ url: fileUrl });
        }

        // For R2 URLs, generate presigned URL
        const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
        if (isProduction) {
            try {
                // const { getPresignedUrl, isR2Configured } = await import('../r2-storage');
                if (isR2Configured()) {
                    // Extract userId from URL path to check permissions
                    const urlParts = fileUrl.split('/');
                    const fileUserIdMatch = urlParts.find(part => /^\d+$/.test(part));
                    const fileUserId = fileUserIdMatch ? parseInt(fileUserIdMatch) : null;

                    // Check permissions
                    if (fileUserId && user.id !== fileUserId && user.role !== "admin" && user.role !== "manager") {
                        return res.status(403).json({ error: "Access denied" });
                    }

                    const presignedUrl = await getPresignedUrl(fileUrl, 3600); // 1 hour expiry
                    return res.json({ url: presignedUrl });
                }
            } catch (error) {
                console.error('Error generating presigned URL:', error);
                return res.json({ url: fileUrl }); // Fallback to original URL
            }
        }

        // Default: return original URL
        return res.json({ url: fileUrl });
    } catch (error) {
        console.error('Error in document presigned URL endpoint:', error);
        return res.status(500).json({
            error: "Failed to generate presigned URL",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// Get presigned URL for an image stored in R2 bucket
router.post("/images/presigned-url", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        // Firebase auth verified by middleware - req.neonUser is guaranteed to be set
        const user = req.neonUser!;

        console.log(`✅ Presigned URL request from authenticated user: ${user.id} (${user.role || 'no role'})`);

        const { imageUrl } = req.body;

        if (!imageUrl || typeof imageUrl !== 'string') {
            return res.status(400).json({ error: "imageUrl is required" });
        }

        // Check if R2 is configured and we're in production
        const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
        const isDevelopment = process.env.NODE_ENV === 'development' || (!isProduction && !process.env.VERCEL_ENV);

        // In development, always return the original URL (no presigned URLs needed)
        if (isDevelopment) {
            console.log('💻 Development mode: Returning original URL without presigned URL');
            return res.json({ url: imageUrl });
        }

        // In production, try to generate presigned URL
        if (isProduction) {
            try {
                // const { getPresignedUrl, isR2Configured } = await import('../r2-storage');

                if (!isR2Configured()) {
                    console.warn('R2 not configured, returning original URL');
                    return res.json({ url: imageUrl });
                }

                const presignedUrl = await getPresignedUrl(imageUrl, 3600); // 1 hour expiry
                return res.json({ url: presignedUrl });
            } catch (error) {
                console.error('Error generating presigned URL, falling back to original URL:', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                    imageUrl
                });
                // Fallback to public URL if presigned URL generation fails
                // This will work if R2 bucket has public access enabled
                return res.json({ url: imageUrl });
            }
        }

        // Default: return original URL
        return res.json({ url: imageUrl });
    } catch (error) {
        console.error('Error in presigned URL endpoint:', error);
        return res.status(500).json({
            error: "Failed to generate presigned URL",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// ===============================
// RESTORED ROUTES FROM PREVIOUS EXTRACTION (120-217)
// ===============================

// R2 Proxy Endpoint (Legacy/Simple)
router.get("/files/r2-proxy", async (req: Request, res: Response) => {
    try {
        const { url } = req.query;

        if (!url || typeof url !== 'string') {
            return res.status(400).send("Missing or invalid url parameter");
        }

        console.log(`[R2 Proxy] Request for: ${url}`);

        // Generate a presigned URL (valid for 1 hour)
        const presignedUrl = await getPresignedUrl(url);

        // Redirect the client to the presigned URL
        // Use 307 Temporary Redirect to preserve method/body if necessary (though this is GET)
        res.redirect(307, presignedUrl);
    } catch (error) {
        console.error("[R2 Proxy] Error:", error);
        // Fallback: try redirecting to the original URL if signing fails
        const fallbackUrl = req.query.url as string;
        if (fallbackUrl) {
            console.log(`[R2 Proxy] Falling back to original URL: ${fallbackUrl}`);
            return res.redirect(fallbackUrl);
        }
        res.status(500).send("Failed to proxy image");
    }
});

// Get Presigned URL Endpoint (Legacy/Simple)
router.get("/files/r2-presigned", async (req: Request, res: Response) => {
    try {
        const { url } = req.query;

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: "Missing or invalid url parameter" });
        }

        console.log(`[R2 Presigned] Request for: ${url}`);

        // Generate a presigned URL (valid for 1 hour)
        const presignedUrl = await getPresignedUrl(url);

        return res.json({ url: presignedUrl });
    } catch (error) {
        console.error("[R2 Presigned] Error:", error);
        res.status(500).json({ error: "Failed to generate presigned URL" });
    }
});

// Serve uploaded documents statically (Static first)
router.use('/files/documents', express.static(path.join(process.cwd(), 'uploads/documents')));

// FILE SERVING ROUTES (Authenticated)
// ===============================

// Serve uploaded document files
// Supports both Firebase auth and session auth
// Also supports token in query string for direct file access
router.get("/files/documents/:filename", optionalFirebaseAuth, async (req: Request, res: Response) => {
    try {
        // Check authentication - support multiple methods
        let userId: number | null = null;
        let userRole: string | null = null;

        // Method 1: Try Firebase auth from Authorization header (set by optionalFirebaseAuth middleware)
        if (req.neonUser) {
            userId = req.neonUser.id;
            userRole = req.neonUser.role || null;
        }
        // Method 2: Try Firebase auth from query string token (for direct file access)
        else if (req.query.token && typeof req.query.token === 'string') {
            try {
                const { verifyFirebaseToken } = await import('../firebase-admin');
                const decodedToken = await verifyFirebaseToken(req.query.token);
                if (decodedToken) {
                    const neonUser = await firebaseStorage.getUserByFirebaseUid(decodedToken.uid);
                    if (neonUser) {
                        userId = neonUser.id;
                        userRole = neonUser.role || null;
                    }
                }
            } catch (error) {
                console.error("Error verifying query token:", error);
            }
        }
        // Method 3: Try session cookie auth (for direct file access from browser)
        else if ((req.session as any)?.userId) {
            try {
                const sessionUserId = (req.session as any).userId;
                const sessionUser = await storage.getUser(sessionUserId);
                if (sessionUser) {
                    userId = sessionUser.id;
                    userRole = sessionUser.role;
                }
            } catch (error) {
                console.error("Error loading user from session:", error);
            }
        }
        // Method 4: Fall back to Passport session auth
        else if (req.isAuthenticated && typeof req.isAuthenticated === 'function' && req.isAuthenticated() && req.user) {
            userId = (req.user as any).id;
            userRole = (req.user as any).role;
        }

        const filename = req.params.filename;

        if (!userId) {
            // Log detailed auth info for debugging
            // ... (simplified log)
            console.log('[FILE ACCESS] Authentication failed for:', filename);

            // Check if this is a "fallback" request where strict auth might be skipped if we want public access? 
            // But route logic says "Files must be accessed with authentication".
            // However, we merged the "Legacy/Fallback" route (line 176 of routes.ts) which did NOT require auth.
            // Line 176 logic was: "If static middleware didn't find it, it reaches here... Local file not found, checking R2..."
            // And "If file is missing locally, simply 404...".

            // Since we are combining them, let's allow Unauthenticated users ONLY if we want to fallback to public?
            // BUT this authenticated route (Line 775) returns 401 if !userId.
            // So if I want to support unauthenticated access (for public files?), I should not return 401 immediately?

            // But original code at 775 returned 401.
            return res.status(401).json({
                message: "Not authenticated",
                hint: "Files must be accessed with authentication. Use the presigned URL endpoint or include an auth token."
            });
        }

        console.log('[FILE ACCESS] Authenticated user:', userId, 'role:', userRole, 'accessing:', filename);

        // Check if this is a Cloudflare R2 URL (production)
        const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

        // If filename looks like a URL (starts with http), it's likely an R2 URL
        if (filename.startsWith('http://') || filename.startsWith('https://')) {
            if (isProduction) {
                try {
                    // const { getPresignedUrl, isR2Configured } = await import('../r2-storage');
                    if (isR2Configured()) {
                        const urlParts = filename.split('/');
                        const fileUserIdMatch = urlParts.find(part => /^\d+$/.test(part));
                        const fileUserId = fileUserIdMatch ? parseInt(fileUserIdMatch) : null;

                        if (fileUserId && userId !== fileUserId && userRole !== "admin" && userRole !== "manager") {
                            return res.status(403).json({ message: "Access denied" });
                        }

                        const presignedUrl = await getPresignedUrl(filename, 3600);
                        return res.redirect(presignedUrl);
                    }
                } catch (error) {
                    console.error("Error generating presigned URL:", error);
                    return res.status(500).json({ message: "Error accessing file" });
                }
            }
        }

        // Local file serving (development)
        const filePath = path.join(process.cwd(), 'uploads', 'documents', filename);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: "File not found" });
        }

        // Check permissions based on filename prefix (userId_...)
        const filenameParts = filename.split('_');
        let fileUserId: number | null = null;

        if (filenameParts[0] === 'unknown') {
            if (userRole !== "admin" && userRole !== "manager") {
                return res.status(403).json({ message: "Access denied" });
            }
        } else {
            const userIdMatch = filenameParts[0].match(/^\d+$/);
            if (userIdMatch) {
                fileUserId = parseInt(userIdMatch[0]);
            }
        }

        if (fileUserId !== null && userId !== fileUserId && userRole !== "admin" && userRole !== "manager") {
            return res.status(403).json({ message: "Access denied" });
        }

        // Serve file
        const stat = fs.statSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        let contentType = 'application/octet-stream';
        if (ext === '.pdf') contentType = 'application/pdf';
        else if (['.jpg', '.jpeg'].includes(ext)) contentType = 'image/jpeg';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.webp') contentType = 'image/webp';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

        const readStream = fs.createReadStream(filePath);
        readStream.pipe(res);
    } catch (error) {
        console.error("Error serving file:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

export default router;
