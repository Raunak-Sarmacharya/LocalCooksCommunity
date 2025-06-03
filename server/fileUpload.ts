import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads', 'documents');
if (!fs.existsSync(uploadsDir)) {
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

// Configure multer
export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: fileFilter
});

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

// Helper function to get file URL
export const getFileUrl = (filename: string): string => {
  return `/api/files/documents/${filename}`;
}; 