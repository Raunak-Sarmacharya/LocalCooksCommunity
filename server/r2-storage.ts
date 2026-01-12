/**
 * Cloudflare R2 Storage Utility
 * 
 * Handles file uploads, downloads, and deletions to/from Cloudflare R2.
 * R2 is S3-compatible, so we use AWS SDK v3 for compatibility.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// R2 Configuration from environment variables
const R2_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME;

// Get public URL - use custom domain if provided, otherwise construct default R2 URL
function getR2PublicUrl(): string {
  if (process.env.CLOUDFLARE_R2_PUBLIC_URL) {
    return process.env.CLOUDFLARE_R2_PUBLIC_URL;
  }
  // Default R2 public URL format (requires public access to be enabled)
  if (R2_ACCOUNT_ID && R2_BUCKET_NAME) {
    return `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}`;
  }
  return '';
}

const R2_PUBLIC_URL = getR2PublicUrl();

// R2 endpoint (Cloudflare R2 uses a custom endpoint)
const R2_ENDPOINT = R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '';

// Initialize S3 client for R2
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
      throw new Error('Cloudflare R2 credentials not configured. Please set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, and CLOUDFLARE_R2_BUCKET_NAME environment variables.');
    }

    if (!R2_ENDPOINT) {
      throw new Error('R2 endpoint could not be constructed. Please check CLOUDFLARE_ACCOUNT_ID is set.');
    }

    s3Client = new S3Client({
      region: 'auto', // R2 uses 'auto' as the region
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
      // Force path style for R2 compatibility
      forcePathStyle: false,
    });
  }

  return s3Client;
}

/**
 * Upload a file to Cloudflare R2
 * @param file - Multer file object
 * @param userId - User ID for organizing files
 * @param folder - Optional folder path (e.g., 'documents', 'images', 'profiles')
 * @returns Public URL of the uploaded file
 */
export async function uploadToR2(
  file: Express.Multer.File,
  userId: number | string,
  folder: string = 'documents'
): Promise<string> {
  try {
    const client = getS3Client();
    
    // Generate unique filename
    const timestamp = Date.now();
    const documentType = file.fieldname || 'file';
    const ext = file.originalname.split('.').pop() || '';
    const baseName = file.originalname.replace(/\.[^/.]+$/, '');
    const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');
    
    const filename = `${userId}_${documentType}_${timestamp}_${sanitizedBaseName}.${ext}`;
    const key = `${folder}/${filename}`;

    // Get file buffer - handle both memory and disk storage
    let fileBuffer: Buffer;
    if (file.buffer) {
      // Memory storage (production)
      fileBuffer = file.buffer;
    } else if (file.path) {
      // Disk storage (development) - read file from disk
      const fs = await import('fs');
      fileBuffer = fs.readFileSync(file.path);
    } else {
      throw new Error('File buffer or path not available');
    }

    // Upload to R2
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME!,
      Key: key,
      Body: fileBuffer,
      ContentType: file.mimetype,
      // Make file publicly accessible (if your R2 bucket allows public access)
      // Note: You need to configure CORS and public access in Cloudflare dashboard
    });

    await client.send(command);

    // Construct public URL
    // Option 1: Use custom domain (recommended)
    // Option 2: Use R2 public URL if configured
    let publicUrl: string;
    if (R2_PUBLIC_URL) {
      publicUrl = R2_PUBLIC_URL.endsWith('/') 
        ? `${R2_PUBLIC_URL}${key}`
        : `${R2_PUBLIC_URL}/${key}`;
    } else {
      // Fallback: construct URL from endpoint and bucket
      publicUrl = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}/${key}`;
    }

    console.log(`✅ File uploaded to R2: ${key} -> ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error('❌ Error uploading to R2:', error);
    throw new Error(`Failed to upload file to R2: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Delete a file from Cloudflare R2
 * @param fileUrl - Full URL of the file to delete
 * @returns true if deleted successfully
 */
export async function deleteFromR2(fileUrl: string): Promise<boolean> {
  try {
    const client = getS3Client();
    
    // Extract key from URL
    // URL format: https://domain.com/folder/filename or https://account.r2.cloudflarestorage.com/bucket/folder/filename
    const urlObj = new URL(fileUrl);
    const key = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname;
    
    // Remove bucket name from key if present
    const keyParts = key.split('/');
    const bucketIndex = keyParts.indexOf(R2_BUCKET_NAME!);
    const actualKey = bucketIndex >= 0 
      ? keyParts.slice(bucketIndex + 1).join('/')
      : key;

    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME!,
      Key: actualKey,
    });

    await client.send(command);
    console.log(`✅ File deleted from R2: ${actualKey}`);
    return true;
  } catch (error) {
    console.error('❌ Error deleting from R2:', error);
    return false;
  }
}

/**
 * Check if a file exists in R2
 * @param fileUrl - Full URL of the file
 * @returns true if file exists
 */
export async function fileExistsInR2(fileUrl: string): Promise<boolean> {
  try {
    const client = getS3Client();
    
    // Extract key from URL
    const urlObj = new URL(fileUrl);
    const key = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname;
    const keyParts = key.split('/');
    const bucketIndex = keyParts.indexOf(R2_BUCKET_NAME!);
    const actualKey = bucketIndex >= 0 
      ? keyParts.slice(bucketIndex + 1).join('/')
      : key;

    const command = new HeadObjectCommand({
      Bucket: R2_BUCKET_NAME!,
      Key: actualKey,
    });

    await client.send(command);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get a presigned URL for temporary access to a private file
 * @param fileUrl - Full URL of the file
 * @param expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
 * @returns Presigned URL
 */
export async function getPresignedUrl(fileUrl: string, expiresIn: number = 3600): Promise<string> {
  try {
    const client = getS3Client();
    
    // Extract key from URL using robust logic
    const urlObj = new URL(fileUrl);
    let pathname = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname;
    const pathParts = pathname.split('/').filter(p => p);
    
    // Find the bucket name index
    const bucketIndex = pathParts.indexOf(R2_BUCKET_NAME!);
    
    let key: string;
    if (bucketIndex >= 0) {
      // Bucket name is in the path, key is everything after it
      // e.g., [bucket_name, images, filename] -> images/filename
      key = pathParts.slice(bucketIndex + 1).join('/');
    } else {
      // Bucket name not in path (custom domain or different URL format)
      // Try to detect if it's a custom domain by checking if pathname starts with known folders
      const knownFolders = ['documents', 'kitchen-applications', 'images', 'profiles'];
      const firstPart = pathParts[0];
      
      if (knownFolders.includes(firstPart)) {
        // Custom domain with folder structure, use entire pathname
        key = pathname;
      } else {
        // Unknown format, try using entire pathname
        key = pathname;
      }
    }
    
    // Remove leading/trailing slashes
    key = key.replace(/^\/+|\/+$/g, '');
    
    // Final validation: key should not be empty
    if (!key || key.length === 0) {
      throw new Error(`Invalid key extracted from URL: ${fileUrl}`);
    }

    console.log('🔍 R2 Presigned URL Debug:', {
      fileUrl,
      extractedKey: key,
      bucketName: R2_BUCKET_NAME,
      pathname: urlObj.pathname,
      pathParts,
      bucketIndex
    });

    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME!,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(client, command, { expiresIn });
    console.log('✅ Generated presigned URL for R2 file:', key);
    return presignedUrl;
  } catch (error) {
    console.error('❌ Error generating presigned URL:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      fileUrl,
      stack: error instanceof Error ? error.stack : undefined
    });
    throw new Error(`Failed to generate presigned URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Check if R2 is configured
 */
export function isR2Configured(): boolean {
  return !!(
    R2_ACCOUNT_ID &&
    R2_ACCESS_KEY_ID &&
    R2_SECRET_ACCESS_KEY &&
    R2_BUCKET_NAME
  );
}

