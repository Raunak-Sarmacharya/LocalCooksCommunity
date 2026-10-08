import { logger } from "../logger";
import express, { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from 'node:crypto';
import { getPresignedUrl, isR2Configured } from "../r2-storage";
import { upload, uploadToBlob } from "../fileUpload";
import { optionalFirebaseAuth, requireFirebaseAuthWithUser } from "../firebase-auth-middleware";
import { userService } from "../domains/users/user.service";
import { ChatAccessError, withParticipantChat } from '../services/participant-chat';
import { attachmentKey, storedFileUrl } from '../services/chat-file-access';
import { getAdminDb } from '../chat-service';
import { canReadPrivateFile } from '../services/private-file-access';

const router = Router();

router.post('/chat/:conversationId/upload', requireFirebaseAuthWithUser, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Choose a file' });
        const save = async () => {
            // Publish an opaque application URL, never the raw storage URL.
            req.file!.originalname = `${randomUUID()}${path.extname(req.file!.originalname)}`;
            const storageUrl = await uploadToBlob(req.file!, req.neonUser!.id, 'chat-private');
            const url = `/api/files/chat-attachments/${randomUUID()}`;
            await (await getAdminDb()).collection('chatAttachments').doc(attachmentKey(url)).set({
                url, storageUrl, conversationId: req.params.conversationId, uploaderId: req.neonUser!.id
            });
            return { url };
        };
        const result = req.neonUser!.role === 'admin' ? await save() : await withParticipantChat(
            req.neonUser!, req.firebaseUser!.uid, req.params.conversationId, async ({ live }) => {
                if (!live) throw new ChatAccessError(409, 'The other account is unavailable');
                return save();
            });
        return res.json(result);
    } catch (error) { return res.status(error instanceof ChatAccessError ? error.status : 409).json({ error: (error as Error).message }); }
});
router.get('/chat/:conversationId/file', requireFirebaseAuthWithUser, async (req, res) => {
    try {
        const url = req.query.url;
        if (typeof url !== 'string' || !storedFileUrl(url)) return res.status(400).json({ error: 'Invalid attachment' });
        const load = async (ref: FirebaseFirestore.DocumentReference) => {
            const matches = await ref.collection('messages').where('fileUrl', '==', url).limit(1).get();
            if (matches.empty) throw new ChatAccessError(404, 'Attachment Not shared in this conversation');
            const receipt = url.startsWith('/api/files/chat-attachments/')
                ? await (await getAdminDb()).collection('chatAttachments').doc(attachmentKey(url)).get() : null;
            if (receipt && (!receipt.exists || receipt.data()?.conversationId !== ref.id)) throw new ChatAccessError(404, 'Attachment not found');
            const storageUrl = receipt ? receipt.data()!.storageUrl : url;
            if (typeof storageUrl !== 'string' || !storedFileUrl(storageUrl)) throw new ChatAccessError(404, 'Attachment not found');
            if (storageUrl.startsWith('/api/files/documents/')) {
                return { bytes: await fs.promises.readFile(path.join(process.cwd(), 'uploads/documents', storageUrl.slice('/api/files/documents/'.length))), type: 'application/octet-stream' };
            }
            const upstream = await fetch(await getPresignedUrl(storageUrl), { redirect: 'error' });
            if (!upstream.ok) throw Error('Could not load attachment');
            return { bytes: Buffer.from(await upstream.arrayBuffer()), type: upstream.headers.get('content-type') || 'application/octet-stream' };
        };
        const result = req.neonUser!.role === 'admin' ? await load((await getAdminDb()).collection('conversations').doc(req.params.conversationId))
            : await withParticipantChat(req.neonUser!, req.firebaseUser!.uid, req.params.conversationId, ({ ref }) => load(ref));
        res.setHeader('Content-Type', result.type); res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Content-Disposition', 'attachment'); res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.send(result.bytes);
    } catch (error) { return res.status(error instanceof ChatAccessError ? error.status : 409).json({ error: 'Attachment unavailable. Please retry.' }); }
});

// Apply to every generic URL/signing/static path, including image extensions.
// The application-preview and chat paths above have their own exact grants.
router.use(optionalFirebaseAuth, async (req, res, next) => {
    try {
        let url = typeof req.query.url === 'string' ? req.query.url : typeof req.body?.imageUrl === 'string' ? req.body.imageUrl : null;
        if (req.path.startsWith('/images/r2/')) url = `https://files.localcooks.ca/${decodeURIComponent(req.path.slice('/images/r2/'.length))}`;
        if (req.path.startsWith('/documents/')) url = `/api/files${req.path}`;
        if (!url && typeof req.query.filename === 'string') url = `https://files.localcooks.ca/${/\.(jpg|jpeg|png|gif|webp|svg|ico)$/i.test(req.query.filename) ? 'images' : 'documents'}/${req.query.filename}`;
        if (!url) return next();
        if (!await canReadPrivateFile(req.neonUser, url)) return res.status(403).json({ error: 'File access denied' });
        return next();
    } catch (error) { logger.error('File authorization failed', error); return res.status(403).json({ error: 'File access unavailable' }); }
});

// Return an application document inline for the manager's review modal.
// The browser cannot embed R2's cross-origin signed URL, so the modal fetches
// this authenticated same-origin response and creates a local blob URL.
router.get('/kitchen-application/:applicationId/preview', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const applicationId = Number(req.params.applicationId);
        const fileUrl = req.query.url;
        if (!Number.isInteger(applicationId) || applicationId <= 0 || typeof fileUrl !== 'string') {
            return res.status(400).json({ error: 'Invalid document request' });
        }
        const { chefKitchenApplications, locations } = await import('@shared/schema');
        const { db } = await import('../db');
        const { eq } = await import('drizzle-orm');
        const [application] = await db.select({
            managerId: locations.managerId,
            foodSafetyLicenseUrl: chefKitchenApplications.foodSafetyLicenseUrl,
            foodEstablishmentCertUrl: chefKitchenApplications.foodEstablishmentCertUrl,
            tierData: chefKitchenApplications.tier_data,
        }).from(chefKitchenApplications)
            .leftJoin(locations, eq(chefKitchenApplications.locationId, locations.id))
            .where(eq(chefKitchenApplications.id, applicationId)).limit(1);
        if (!application) return res.status(404).json({ error: 'Application not found' });
        if (req.neonUser!.role !== 'admin' && application.managerId !== req.neonUser!.id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const tierFiles = (application.tierData as { tierFiles?: Record<string, string> } | null)?.tierFiles || {};
        const allowedUrls = [application.foodSafetyLicenseUrl, application.foodEstablishmentCertUrl, ...Object.values(tierFiles)];
        if (!allowedUrls.includes(fileUrl)) return res.status(404).json({ error: 'Document not found' });

        let bytes: Buffer;
        let contentType: string;
        if (fileUrl.startsWith('/api/files/documents/')) {
            const filename = fileUrl.slice('/api/files/documents/'.length);
            if (!filename || path.basename(filename) !== filename) return res.status(400).json({ error: 'Invalid document path' });
            bytes = await fs.promises.readFile(path.join(process.cwd(), 'uploads', 'documents', filename));
            contentType = /\.pdf$/i.test(filename) ? 'application/pdf' : /\.png$/i.test(filename) ? 'image/png' : /\.webp$/i.test(filename) ? 'image/webp' : 'image/jpeg';
        } else {
            const parsed = new URL(fileUrl);
            if (parsed.protocol !== 'https:' || (parsed.hostname !== 'files.localcooks.ca' && !parsed.hostname.endsWith('.r2.cloudflarestorage.com'))) {
                return res.status(400).json({ error: 'Invalid document host' });
            }
            const signedUrl = await getPresignedUrl(fileUrl);
            const upstream = await fetch(signedUrl);
            if (!upstream.ok) return res.status(502).json({ error: 'Could not load document' });
            bytes = Buffer.from(await upstream.arrayBuffer());
            contentType = /\.pdf$/i.test(parsed.pathname) ? 'application/pdf' : upstream.headers.get('content-type') || 'application/octet-stream';
        }
        if (bytes.length > 25 * 1024 * 1024) return res.status(413).json({ error: 'Document is too large to preview' });
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.send(bytes);
    } catch (error) {
        logger.error('Kitchen document preview failed:', error);
        return res.status(500).json({ error: 'Could not load document preview' });
    }
});

// HIGH-6 Security: SSRF protection — only allow our R2 domain
function isAllowedR2Url(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'files.localcooks.ca';
    } catch {
        return false;
    }
}

// ===============================
// FILE UPLOAD ROUTES
// ===============================

// Generic file upload endpoint (for use with new upload components)
// Uses Firebase Auth - supports both session and Firebase authentication
router.post("/upload-file",
    optionalFirebaseAuth, // Auth first so req.neonUser is set for multer filename generation
    upload.single('file'), // Then process file
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
                        logger.error('Error cleaning up file:', e);
                    }
                }
                return res.status(401).json({ error: "Not authenticated" });
            }

            if (!req.file) {
                return res.status(400).json({ error: "No file uploaded" });
            }

            const folder = req.body.folder || 'documents';

            // Enterprise-grade: Always use uploadToBlob which handles R2 vs local automatically
            // This ensures consistent behavior across all environments when R2 is configured
            const fileUrl = await uploadToBlob(req.file, userId, folder);
            const fileName = fileUrl.split('/').pop() || req.file.originalname;

            // Return success response with file information
            return res.status(200).json({
                success: true,
                url: fileUrl,
                fileName: fileName,
                size: req.file.size,
                type: req.file.mimetype
            });
        } catch (error) {
            logger.error("File upload error:", error);

            // Clean up uploaded file on error (development only)
            if (req.file && (req.file as any).path) {
                try {
                    fs.unlinkSync((req.file as any).path);
                } catch (e) {
                    logger.error('Error cleaning up file:', e);
                }
            }

            return res.status(500).json({
                error: "File upload failed",
                details: error instanceof Error ? error.message : "Unknown error"
            });
        }
    }
);

// ... (skipping R2 IMAGE PROXY ENDPOINT which remains unchanged) ...

// Get presigned URL for an image stored in R2 bucket
router.post("/images/presigned-url", optionalFirebaseAuth, async (req: Request, res: Response) => {
    try {
        // Firebase auth verified by middleware - req.neonUser is set if authenticated
        const user = req.neonUser;

        const { imageUrl } = req.body;

        if (!imageUrl || typeof imageUrl !== 'string') {
            return res.status(400).json({ error: "imageUrl is required" });
        }

        // Check if R2 is configured and we're in production
        const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
        const isDevelopment = process.env.NODE_ENV === 'development' || (!isProduction && !process.env.VERCEL_ENV);

        // In development, always return the original URL (no presigned URLs needed)
        if (isDevelopment) {
            logger.info('💻 Development mode: Returning original URL without presigned URL');
            return res.json({ url: imageUrl });
        }

        // In production, try to generate presigned URL
        if (isProduction) {
            try {
                // const { getPresignedUrl, isR2Configured } = await import('../r2-storage');

                if (!isR2Configured()) {
                    logger.warn('R2 not configured, returning original URL');
                    return res.json({ url: imageUrl });
                }

                // SECURITY CHECK:
                // If the image is in 'public/' or 'kitchens/' folder, allow access without strict ownership
                // If it is in 'documents/' or other protected folders, enforce ownership
                const isPublic = imageUrl.includes('/public/') || imageUrl.includes('/kitchens/');

                if (!isPublic) {
                    if (!user) {
                        return res.status(401).json({ error: "Not authenticated" });
                    }
                    logger.info(`✅ Presigned URL request from authenticated user: ${user.id} (${user.role || 'no role'})`);
                }

                const presignedUrl = await getPresignedUrl(imageUrl, 3600); // 1 hour expiry
                return res.json({ url: presignedUrl });
            } catch (error) {
                logger.error('Error generating presigned URL, falling back to original URL:', {
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
        logger.error('Error in presigned URL endpoint:', error);
        return res.status(500).json({
            error: "Failed to generate presigned URL",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// ===============================
// RESTORED ROUTES FROM PREVIOUS EXTRACTION (120-217)
// ===============================

// R2 Proxy Endpoint (For development/local use with normalizeImageUrl)
// Handles requests like /api/files/images/r2/documents%2Ffilename.jpg
// Note: optionalFirebaseAuth is already applied globally in routes.ts
router.get("/images/r2/:path(*)", async (req: Request, res: Response) => {
    try {
        const pathParam = req.params.path;
        if (!pathParam) {
            return res.status(400).send("Missing path parameter");
        }

        // Decode the path parameter - it may be URL-encoded (e.g., public%2Fkitchens%2F...)
        // This happens when normalizeImageUrl uses encodeURIComponent on the path
        const decodedPath = decodeURIComponent(pathParam);

        // SECURITY CHECK:
        // Allow public access to:
        // - Files in 'public/' or 'kitchens/' folders
        // - Image files (jpg, jpeg, png, gif, webp, svg) - these are safe to display
        // Require auth only for sensitive documents (PDFs, certificates, etc.)
        const isPublicPath = decodedPath.includes('public/') || decodedPath.includes('kitchens/');
        const isImageFile = /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i.test(decodedPath);
        const isPublic = isPublicPath || isImageFile;

        // Debug logging for auth issues
        logger.info(`[R2 Images Proxy] Auth check - neonUser: ${req.neonUser?.id || 'none'}, role: ${req.neonUser?.role || 'none'}, isPublic: ${isPublic}, path: ${decodedPath}`);

        if (!isPublic && !req.neonUser) {
            logger.info(`[R2 Images Proxy] Unauthorized access attempt for protected file: ${decodedPath}`);
            return res.status(401).send("Authentication required for protected files");
        }

        // Reconstruct the original R2 custom domain URL to satisfy getPresignedUrl logic
        // Use the decoded path to ensure proper URL construction
        const fullR2Url = `https://files.localcooks.ca/${decodedPath}`;

        logger.info(`[R2 Images Proxy] Request for: ${decodedPath} (user: ${req.neonUser?.id || 'anonymous'}, role: ${req.neonUser?.role || 'none'})`);

        // Generate a presigned URL
        const presignedUrl = await getPresignedUrl(fullR2Url); // uses 1 hour expiry by default

        // Redirect the client to the presigned URL
        res.redirect(307, presignedUrl);
    } catch (error) {
        logger.error("[R2 Images Proxy] Error:", error);
        res.status(404).send("File not found or access denied");
    }
});

// R2 Proxy Endpoint (Legacy/Simple)
// Note: optionalFirebaseAuth is already applied globally in routes.ts
router.get("/r2-proxy", async (req: Request, res: Response) => {
    try {
        const { url, filename } = req.query;

        // Handle plain filename parameter (for images stored without full URL)
        let targetUrl: string;
        if (filename && typeof filename === 'string') {
            // Plain filename - construct full R2 URL
            const isImage = /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i.test(filename);
            const folder = isImage ? 'images' : 'documents';
            targetUrl = `https://files.localcooks.ca/${folder}/${filename}`;
            logger.info(`[R2 Proxy] Resolved filename "${filename}" to: ${targetUrl}`);
        } else if (url && typeof url === 'string') {
            targetUrl = url;
        } else {
            return res.status(400).send("Missing url or filename parameter");
        }

        // HIGH-6 Security: SSRF protection — only allow our R2 domain
        if (!isAllowedR2Url(targetUrl)) {
            logger.warn(`[R2 Proxy] SSRF blocked: ${targetUrl}`);
            return res.status(400).send("Invalid URL domain");
        }

        // SECURITY CHECK:
        // Allow public access to: public/, kitchens/, and image files
        // Require auth only for sensitive documents (PDFs, certificates, etc.)
        const isPublicPath = targetUrl.includes('/public/') || targetUrl.includes('/kitchens/');
        const isImageFile = /\.(jpg|jpeg|png|gif|webp|svg|ico)(\?|$)/i.test(targetUrl);
        const isPublic = isPublicPath || isImageFile;

        logger.info(`[R2 Proxy] Auth check - neonUser: ${req.neonUser?.id || 'none'}, role: ${req.neonUser?.role || 'none'}, isPublic: ${isPublic}, isImage: ${isImageFile}`);

        if (!isPublic && !req.neonUser) {
            logger.info(`[R2 Proxy] Unauthorized access attempt for protected file: ${targetUrl}`);
            return res.status(401).send("Authentication required for protected files");
        }

        logger.info(`[R2 Proxy] Request for: ${targetUrl} (user: ${req.neonUser?.id || 'anonymous'}, role: ${req.neonUser?.role || 'none'}, public: ${isPublic})`);

        // Generate a presigned URL (valid for 1 hour)
        const presignedUrl = await getPresignedUrl(targetUrl);

        res.redirect(307, presignedUrl);
    } catch (error) {
        logger.error("[R2 Proxy] Error:", error);
        // HIGH-6 Security: Removed open redirect fallback to prevent SSRF
        res.status(500).send("Failed to proxy image");
    }
});

// Get Presigned URL Endpoint (Legacy/Simple)
// Note: optionalFirebaseAuth is already applied globally in routes.ts, no need to apply again
router.get("/r2-presigned", async (req: Request, res: Response) => {
    try {
        const { url } = req.query;

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: "Missing or invalid url parameter" });
        }

        // SECURITY CHECK:
        // Allow public access to: public/, kitchens/, and image files (jpg, jpeg, png, gif, webp, svg)
        // Require auth only for sensitive documents (PDFs, certificates, etc.)
        const isPublicPath = url.includes('/public/') || url.includes('/kitchens/');
        const isImageFile = /\.(jpg|jpeg|png|gif|webp|svg|ico)(\?|$)/i.test(url);
        const isPublic = isPublicPath || isImageFile;

        // Debug logging for auth issues
        logger.info(`[R2 Presigned] Auth check - neonUser: ${req.neonUser?.id || 'none'}, role: ${req.neonUser?.role || 'none'}, isPublic: ${isPublic}, isImage: ${isImageFile}`);

        if (!isPublic && !req.neonUser) {
            logger.info(`[R2 Presigned] Unauthorized access attempt for protected file: ${url}`);
            return res.status(401).json({ error: "Not authenticated" });
        }

        logger.info(`[R2 Presigned] Request for: ${url} (user: ${req.neonUser?.id || 'anonymous'}, role: ${req.neonUser?.role || 'none'}, public: ${isPublic})`);

        // Generate a presigned URL (valid for 1 hour)
        const presignedUrl = await getPresignedUrl(url);

        return res.json({ url: presignedUrl });
    } catch (error) {
        logger.error("[R2 Presigned] Error:", error);
        res.status(500).json({ error: "Failed to generate presigned URL" });
    }
});

// Serve uploaded documents statically (Static first)
// NOTE: On Vercel (serverless), the filesystem at /var/task is read-only and uploads don't persist.
// Static serving only works in local development. Production uses R2 with presigned URLs.
const isVercel = !!process.env.VERCEL;
if (!isVercel) {
    router.use('/documents', express.static(path.join(process.cwd(), 'uploads/documents')));
}

// FILE SERVING ROUTES (Authenticated)
// ===============================

// Serve uploaded document files
// Supports both Firebase auth and session auth
// Also supports token in query string for direct file access
router.get("/documents/:filename", optionalFirebaseAuth, async (req: Request, res: Response) => {
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
                const { verifyFirebaseToken } = await import('../firebase-setup');
                const decodedToken = await verifyFirebaseToken(req.query.token);
                if (decodedToken) {
                    const neonUser = await userService.getUserByFirebaseUid(decodedToken.uid);
                    if (neonUser) {
                        userId = neonUser.id;
                        userRole = neonUser.role || null;
                    }
                }
            } catch (error) {
                logger.error("Error verifying query token:", error);
            }
        }


        const filename = req.params.filename;

        if (!userId) {
            // Log detailed auth info for debugging
            // ... (simplified log)
            logger.info('[FILE ACCESS] Authentication failed for:', filename);

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

        logger.info('[FILE ACCESS] Authenticated user:', userId, 'role:', userRole, 'accessing:', filename);

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
                    logger.error("Error generating presigned URL:", error);
                    return res.status(500).json({ message: "Error accessing file" });
                }
            }
        }

        // Local file serving (development)
        const filePath = path.join(process.cwd(), 'uploads', 'documents', filename);

        // Check permissions based on filename prefix (userId_...)
        const filenameParts = filename.split('_');
        let fileUserId: number | null = null;
        let isPublicAccess = false;

        // AUTH CHECK:
        // 1. If user is Admin/Manager -> Allow
        // 2. If user owns the file -> Allow
        // 3. If file is a purely public asset (Kitchen Image) -> Allow (verified via DB)

        if (filenameParts[0] === 'unknown') {
            // "unknown" user ID files are tricky. Usually unsafe unless verify they are public.
            if (userRole === "admin" || userRole === "manager") {
                isPublicAccess = true;
            }
        } else {
            const userIdMatch = filenameParts[0].match(/^\d+$/);
            if (userIdMatch) {
                fileUserId = parseInt(userIdMatch[0]);
            }
        }

        const isOwner = fileUserId !== null && userId === fileUserId;
        const isAdminOrManager = userRole === "admin" || userRole === "manager";

        if (!isOwner && !isAdminOrManager) {
            // Fallback: Check if this file is actually a public kitchen image
            // Only perform this DB check if we are about to deny access
            try {
                // We need to look for this filename in the kitchens table (image_url or gallery_images)
                // The stored URL might be the full path "/api/files/documents/filename"
                const searchPattern = `%${filename}`;

                // Use dynamic import to avoid circular dependencies if any, 
                // but standard import would be better if top-level is clean.
                // Using existing imports from top of file or dynamic if safer.
                // Since this is inside an async function:
                const { kitchens } = await import('@shared/schema');
                const { db } = await import('../db');
                const { or, like, sql } = await import('drizzle-orm');

                // Check if this filename appears in any kitchen's image_url
                // Note: gallery_images is JSONB so we use specific operator
                const [kitchenMatch] = await db
                    .select({ id: kitchens.id })
                    .from(kitchens)
                    .where(
                        or(
                            like(kitchens.imageUrl, searchPattern),
                            sql`${kitchens.galleryImages} @> ${JSON.stringify([`/api/files/documents/${filename}`])}::jsonb`,
                            // also try with just filename if that's how it's stored in array
                            sql`${kitchens.galleryImages} @> ${JSON.stringify([filename])}::jsonb`
                        )
                    )
                    .limit(1);

                if (kitchenMatch) {
                    logger.info(`[FILE ACCESS] Public access granted for kitchen image: ${filename}`);
                    isPublicAccess = true;
                }
            } catch (dbError) {
                logger.error("Error checking public access:", dbError);
                // Fail safe - deny
            }
        }

        if (!isOwner && !isAdminOrManager && !isPublicAccess) {
            return res.status(403).json({ message: "Access denied" });
        }

        // Serve file
        if (fs.existsSync(filePath)) {
            // Local file serving (development or locally cached)
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
        } else {
            // File not found locally - Try R2 (Production Fallback)
            // This handles the case where files are in R2 but requested via /api/files/documents/
            const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

            // Even if not strictly production env, if we are here and file is missing locally,
            // and we passed auth, we should try R2 if configured.
            // Rely on top-level or new import
            const { getPresignedUrl, isR2Configured } = await import('../r2-storage');

            if (isR2Configured()) {
                try {
                    // Try to get R2 URL
                    // We need to pass the full "original" URL structure or just the key
                    // getPresignedUrl expects a full "fileUrl" to extract key, OR we can pass a constructed one.
                    // It extracts key from `pathname`.
                    // Let's construct a fake URL that will parse correctly to 'documents/filename'
                    const fakeUrl = `https://r2.localcooks.com/documents/${filename}`;
                    const presignedUrl = await getPresignedUrl(fakeUrl, 3600);

                    logger.info(`[FILE ACCESS] Redirecting to R2 for: ${filename}`);
                    return res.redirect(307, presignedUrl);
                } catch (r2Error) {
                    logger.error('[FILE ACCESS] R2 fallback failed:', r2Error);
                    return res.status(404).json({ message: "File not found" });
                }
            } else {
                return res.status(404).json({ message: "File not found" });
            }
        }
    } catch (error) {
        logger.error("Error serving file:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

export default router;
