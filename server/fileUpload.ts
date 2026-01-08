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

// Check if we're in production (Vercel)
const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

// Ensure uploads directory exists (for development)
const uploadsDir = path.join(process.cwd(), 'uploads', 'documents');
if (!isProduction && !fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: userId_documentType_timestamp_originalname
    const userId = req.user?.id || 'unknown';
    const timestamp = Date.now();
    const documentType = file.fieldname; // 'foodSafetyLicense' or 'foodEstablishmentCert'
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    
    const filename = `${userId}_${documentType}_${timestamp}_${baseName}${ext}`;
    cb(null, filename);
  }
});

// Memory storage for production (Cloudflare R2)
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

// Configure multer based on environment
export const upload = multer({
  storage: isProduction ? memoryStorage : storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: fileFilter
});

// Helper function to upload file to Cloudflare R2 (production) or local storage (development)
export const uploadToBlob = async (file: Express.Multer.File, userId: number, folder: string = 'documents'): Promise<string> => {
  try {
    // In production, use Cloudflare R2 if configured, otherwise fall back to local
    if (isProduction && isR2Configured()) {
      return await uploadToR2(file, userId, folder);
    } else {
      // Development: return local file path
      const filename = file.filename || `${userId}_${Date.now()}_${file.originalname}`;
      return getFileUrl(filename);
    }
  } catch (error) {
    console.error('Error uploading file:', error);
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
    
    // In production with R2, delete from R2
    if (isProduction && isR2Configured()) {
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