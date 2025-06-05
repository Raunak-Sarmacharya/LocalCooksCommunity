import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { put } from '@vercel/blob';

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

// Memory storage for production (Vercel Blob)
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

// Helper function to upload file to Vercel Blob (production)
export const uploadToBlob = async (file: Express.Multer.File, userId: number): Promise<string> => {
  try {
    const timestamp = Date.now();
    const documentType = file.fieldname; // 'foodSafetyLicense' or 'foodEstablishmentCert'
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    
    const filename = `${userId}_${documentType}_${timestamp}_${baseName}${ext}`;
    
    const blob = await put(filename, file.buffer, {
      access: 'public',
      contentType: file.mimetype,
    });
    
    console.log(`File uploaded to Vercel Blob: ${filename} -> ${blob.url}`);
    return blob.url;
  } catch (error) {
    console.error('Error uploading to Vercel Blob:', error);
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
  if (isProduction) {
    // In production, this should be the actual Vercel Blob URL
    // This function is mainly used for development
    return `/api/files/documents/${filename}`;
  } else {
    return `/api/files/documents/${filename}`;
  }
};

// Helper function to clean up application documents when application is cancelled
export const cleanupApplicationDocuments = (application: { 
  foodSafetyLicenseUrl?: string | null, 
  foodEstablishmentCertUrl?: string | null 
}): void => {
  try {
    // Only clean up local files in development
    if (isProduction) {
      console.log('Skipping file cleanup in production (Vercel Blob files are managed externally)');
      return;
    }

    // Clean up food safety license file
    if (application.foodSafetyLicenseUrl && application.foodSafetyLicenseUrl.startsWith('/api/files/')) {
      const filename = application.foodSafetyLicenseUrl.split('/').pop();
      if (filename) {
        const filePath = path.join(uploadsDir, filename);
        deleteFile(filePath);
        console.log(`Deleted food safety license file: ${filename}`);
      }
    }

    // Clean up food establishment certificate file
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