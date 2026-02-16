import { logger } from "./logger";
/**
 * Unified File Upload Handler
 * 
 * This handler consolidates all file upload logic to minimize serverless functions.
 * Supports both session-based and Firebase authentication.
 */

import { Request, Response } from 'express';
import { uploadToBlob, getFileUrl } from './fileUpload';
import { isR2Configured } from './r2-storage';
import fs from 'fs';

/**
 * Unified file upload handler
 * Works with both session-based auth (req.user) and Firebase auth (req.neonUser)
 */
export async function handleFileUpload(req: Request, res: Response): Promise<void> {
  try {
    // Get user ID from either session or Firebase auth
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
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    let fileUrl: string;
    let fileName: string;

    // Determine folder based on file fieldname or default to 'documents'
    const folder = req.file.fieldname === 'profileImage' ? 'profiles' : 
                   req.file.fieldname === 'image' ? 'images' : 
                   'documents';

    // Use Cloudflare R2 when configured (works in both production and development)
    const r2Available = isR2Configured();
    logger.info(`📦 handleFileUpload: R2 configured = ${r2Available}`);

    if (r2Available) {
      // Upload to Cloudflare R2
      try {
        logger.info(`☁️ Uploading to Cloudflare R2 (folder: ${folder})...`);
        fileUrl = await uploadToBlob(req.file, userId, folder);
        // Extract filename from URL for response
        fileName = fileUrl.split('/').pop() || req.file.originalname;
        logger.info(`✅ R2 upload complete: ${fileUrl}`);
      } catch (error) {
        logger.error('❌ Error uploading to R2:', error);
        // Clean up uploaded file on error
        if ((req.file as any).path) {
          try {
            fs.unlinkSync((req.file as any).path);
          } catch (e) {
            logger.error('Error cleaning up file:', e);
          }
        }
        res.status(500).json({ 
          error: "File upload failed",
          details: "Failed to upload file to cloud storage"
        });
        return;
      }
    } else {
      // Fallback: Use local storage (only when R2 is not configured)
      logger.info(`📁 R2 not configured, using local storage`);
      fileUrl = getFileUrl(req.file.filename || `${userId}_${Date.now()}_${req.file.originalname}`);
      fileName = req.file.filename || req.file.originalname;
    }

    // Return success response
    res.status(200).json({
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
    
    res.status(500).json({ 
      error: "File upload failed",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

/**
 * Handle multiple file uploads (for forms with multiple fields)
 */
export async function handleMultipleFileUpload(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as any).neonUser?.id || (req as any).user?.id;
    
    if (!userId) {
      // Clean up uploaded files
      if (req.files) {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        Object.values(files).flat().forEach(file => {
          if ((file as any).path) {
            try {
              fs.unlinkSync((file as any).path);
            } catch (e) {
              logger.error('Error cleaning up file:', e);
            }
          }
        });
      }
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    if (!req.files || Object.keys(req.files).length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const uploadedFiles: { [key: string]: string } = {};

    // Use Cloudflare R2 when configured (works in both production and development)
    const r2Available = isR2Configured();
    logger.info(`📦 handleMultipleFileUpload: R2 configured = ${r2Available}`);

    // Process each file
    for (const [fieldname, fileArray] of Object.entries(files)) {
      if (fileArray && fileArray.length > 0) {
        const file = fileArray[0];
        const folder = fieldname === 'profileImage' ? 'profiles' : 
                       fieldname === 'image' ? 'images' : 
                       'documents';

        try {
          if (r2Available) {
            logger.info(`☁️ Uploading ${fieldname} to R2...`);
            uploadedFiles[fieldname] = await uploadToBlob(file, userId, folder);
            logger.info(`✅ ${fieldname} uploaded: ${uploadedFiles[fieldname]}`);
          } else {
            uploadedFiles[fieldname] = getFileUrl(file.filename || `${userId}_${Date.now()}_${file.originalname}`);
          }
        } catch (error) {
          logger.error(`Error uploading ${fieldname}:`, error);
          // Clean up uploaded files on error
          Object.values(files).flat().forEach(f => {
            if ((f as any).path) {
              try {
                fs.unlinkSync((f as any).path);
              } catch (e) {
                logger.error('Error cleaning up file:', e);
              }
            }
          });
          res.status(500).json({ 
            error: "File upload failed",
            details: error instanceof Error ? error.message : "Unknown error"
          });
          return;
        }
      }
    }

    res.status(200).json({
      success: true,
      files: uploadedFiles
    });
  } catch (error) {
    logger.error("Multiple file upload error:", error);
    
    // Clean up uploaded files on error
    if (req.files) {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      Object.values(files).flat().forEach(file => {
        if ((file as any).path) {
          try {
            fs.unlinkSync((file as any).path);
          } catch (e) {
            logger.error('Error cleaning up file:', e);
          }
        }
      });
    }
    
    res.status(500).json({ 
      error: "File upload failed",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

