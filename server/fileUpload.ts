import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { uploadToR2, isR2Configured } from './r2-storage';

// Extend Express Request type for passport-based auth (legacy routes)
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        username: string;
        role: string;
      };
    }
  }
}

// Check if we're in a serverless environment (Vercel)
// Vercel's filesystem is READ-ONLY except for /tmp
const isVercel = !!process.env.VERCEL;
const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

// Enterprise-grade storage strategy:
// - Use R2 (cloud) when configured, regardless of environment
// - This ensures team collaboration: all developers see the same files
// - Fall back to local storage only when R2 is not configured AND not on Vercel
// - On Vercel without R2: use memory storage (files must go to R2)
const useCloudStorage = isR2Configured() || isProduction || isVercel;

/**
 * Get the uploads directory path.
 * - On Vercel: use /tmp (only writable directory in serverless)
 * - Locally: use project root/uploads/documents
 * 
 * IMPORTANT: Directory is created lazily, not at module load time,
 * because Vercel's filesystem is read-only at /var/task
 */
function getUploadsDir(): string {
  if (isVercel) {
    return '/tmp/uploads/documents';
  }
  return path.join(process.cwd(), 'uploads', 'documents');
}

/**
 * Ensures the uploads directory exists.
 * Called lazily only when disk storage is actually needed.
 * This prevents crashes on Vercel where /var/task is read-only.
 */
function ensureUploadsDirExists(): void {
  // Skip directory creation if using cloud storage (memory -> R2)
  if (useCloudStorage) {
    return;
  }
  
  const dir = getUploadsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// DO NOT create directories at module load time - Vercel's /var/task is read-only
// Directory creation is now lazy via ensureUploadsDirExists()
const uploadsDir = getUploadsDir();

// Configure multer for local file storage (fallback only)
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadsDirExists(); // Create directory lazily
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: userId_documentType_timestamp_originalname
    // Check both req.user (legacy) and req.neonUser (Firebase auth)
    const userId = (req as any).neonUser?.id || req.user?.id || 'unknown';
    const timestamp = Date.now();
    const documentType = file.fieldname; // 'foodSafetyLicense' or 'foodEstablishmentCert'
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    
    const filename = `${userId}_${documentType}_${timestamp}_${baseName}${ext}`;
    cb(null, filename);
  }
});

// Memory storage for R2 uploads (keeps file in memory buffer for cloud upload)
const memoryStorage = multer.memoryStorage();

// File filter to only allow certain file types
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Allow PDF, JPG, JPEG, PNG files
  const allowedMimes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/webp'
  ];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPG, JPEG, PNG, and WebP files are allowed.'));
  }
};

// Configure multer: use memory storage when R2 is available (for cloud upload)
// Use disk storage only as fallback when R2 is not configured
console.log(` File Upload Config: R2 configured = ${isR2Configured()}, using ${useCloudStorage ? 'memory (R2)' : 'disk (local)'} storage`);

export const upload = multer({
  storage: useCloudStorage ? memoryStorage : diskStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: fileFilter
});

// Helper function to upload file to Cloudflare R2 (production) or local storage (development)
export const uploadToBlob = async (file: Express.Multer.File, userId: number, folder: string = 'documents'): Promise<string> => {
  try {
    // Use Cloudflare R2 if configured (production OR development with keys)
    const r2Available = isR2Configured();
    console.log(`📦 uploadToBlob: R2 configured = ${r2Available}, file has buffer = ${!!file.buffer}, file has path = ${!!file.path}`);
    
    if (r2Available) {
      console.log(`☁️ Uploading to Cloudflare R2...`);
      const url = await uploadToR2(file, userId, folder);
      console.log(`✅ R2 upload complete: ${url}`);
      return url;
    } else {
      // Development fallback: return local file path
      console.log(`📁 R2 not configured, using local storage`);
      const filename = file.filename || `${userId}_${Date.now()}_${file.originalname}`;
      return getFileUrl(filename);
    }
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    throw new Error('Failed to upload file to cloud storage');
  }
};

// Helper function to delete old files when user uploads new ones
export const deleteFile = (filePath: string): void => {
  try {
    const fullPath = path.join(process.cwd(), filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (error) {
    console.error('Error deleting file:', error);
  }
};

// Helper function to get file URL (environment aware)
export const getFileUrl = (filename: string): string => {
  // In production, files are stored in Cloudflare R2 and URLs are returned directly
  // This function is mainly used for development (local file storage)
  return `/api/files/documents/${filename}`;
};

// Helper function to clean up application documents when application is cancelled
export const cleanupApplicationDocuments = async (application: { 
  foodSafetyLicenseUrl?: string | null, 
  foodEstablishmentCertUrl?: string | null 
}): Promise<void> => {
  try {
    const { deleteFromR2 } = await import('./r2-storage');
    
    // Use R2 if configured
    if (isR2Configured()) {
      if (application.foodSafetyLicenseUrl) {
        await deleteFromR2(application.foodSafetyLicenseUrl);
        console.log(`Deleted food safety license file from R2: ${application.foodSafetyLicenseUrl}`);
      }
      if (application.foodEstablishmentCertUrl) {
        await deleteFromR2(application.foodEstablishmentCertUrl);
        console.log(`Deleted food establishment certificate file from R2: ${application.foodEstablishmentCertUrl}`);
      }
      return;
    }

    // Development: clean up local files
    if (application.foodSafetyLicenseUrl && application.foodSafetyLicenseUrl.startsWith('/api/files/')) {
      const filename = application.foodSafetyLicenseUrl.split('/').pop();
      if (filename) {
        const filePath = path.join(uploadsDir, filename);
        deleteFile(filePath);
        console.log(`Deleted food safety license file: ${filename}`);
      }
    }

    if (application.foodEstablishmentCertUrl && application.foodEstablishmentCertUrl.startsWith('/api/files/')) {
      const filename = application.foodEstablishmentCertUrl.split('/').pop();
      if (filename) {
        const filePath = path.join(uploadsDir, filename);
        deleteFile(filePath);
        console.log(`Deleted food establishment certificate file: ${filename}`);
      }
    }
  } catch (error) {
    console.error('Error cleaning up application documents:', error);
  }
}; 