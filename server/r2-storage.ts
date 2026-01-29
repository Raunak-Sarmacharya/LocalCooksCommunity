/**
 * Cloudflare R2 Storage Utility
 * 
 * Handles file uploads, downloads, and deletions to/from Cloudflare R2.
 * R2 is S3-compatible, so we use AWS SDK v3 for compatibility.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// R2 Configuration - read lazily to ensure dotenv has loaded
// DO NOT read process.env at module load time - it may not be populated yet
function getR2Config() {
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    bucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME,
    publicUrl: process.env.CLOUDFLARE_R2_PUBLIC_URL,
  };
}

// Get public URL - use custom domain if provided, otherwise construct default R2 URL
function getR2PublicUrl(): string {
  const config = getR2Config();
  if (config.publicUrl) {
    return config.publicUrl;
  }
  // Default R2 public URL format (requires public access to be enabled)
  if (config.accountId && config.bucketName) {
    return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}`;
  }
  return '';
}

// R2 endpoint (Cloudflare R2 uses a custom endpoint)
function getR2Endpoint(): string {
  const config = getR2Config();
  return config.accountId ? `https://${config.accountId}.r2.cloudflarestorage.com` : '';
}

// Initialize S3 client for R2
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    const config = getR2Config();
    const endpoint = getR2Endpoint();
    
    if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucketName) {
      throw new Error('Cloudflare R2 credentials not configured. Please set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, and CLOUDFLARE_R2_BUCKET_NAME environment variables.');
    }

    if (!endpoint) {
      throw new Error('R2 endpoint could not be constructed. Please check CLOUDFLARE_ACCOUNT_ID is set.');
    }

    s3Client = new S3Client({
      region: 'auto', // R2 uses 'auto' as the region
      endpoint: endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
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
    const config = getR2Config();
    const command = new PutObjectCommand({
      Bucket: config.bucketName!,
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
    const r2PublicUrl = getR2PublicUrl();
    if (r2PublicUrl) {
      publicUrl = r2PublicUrl.endsWith('/')
        ? `${r2PublicUrl}${key}`
        : `${r2PublicUrl}/${key}`;
    } else {
      // Fallback: construct URL from endpoint and bucket
      publicUrl = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${key}`;
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
 * @param fileUrl - Full URL of the file to delete (can be proxy URL or direct R2 URL)
 * @returns true if deleted successfully
 */
export async function deleteFromR2(fileUrl: string): Promise<boolean> {
  try {
    const client = getS3Client();

    // Handle proxy URLs - extract actual R2 URL from query parameter
    let actualFileUrl = fileUrl;
    if (fileUrl.includes('/api/files/r2-proxy')) {
      try {
        const urlObj = new URL(fileUrl, 'http://localhost'); // base URL for relative URLs
        const urlParam = urlObj.searchParams.get('url');
        if (urlParam) {
          actualFileUrl = decodeURIComponent(urlParam);
          console.log(`🔍 Extracted R2 URL from proxy: ${actualFileUrl}`);
        } else {
          console.error('❌ Proxy URL missing url parameter:', fileUrl);
          return false;
        }
      } catch (urlError) {
        console.error('❌ Error parsing proxy URL:', urlError);
        return false;
      }
    }

    // Extract key from URL using robust logic (same as getPresignedUrl)
    const urlObj = new URL(actualFileUrl);
    const pathname = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname;
    const pathParts = pathname.split('/').filter(p => p);

    // Find the bucket name index
    const config = getR2Config();
    const bucketIndex = pathParts.indexOf(config.bucketName!);

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
      console.error(`❌ Invalid key extracted from URL: ${fileUrl} -> ${actualFileUrl}`);
      return false;
    }

    console.log('🔍 R2 Delete Debug:', {
      originalUrl: fileUrl,
      actualFileUrl,
      extractedKey: key,
      bucketName: config.bucketName,
      pathname: urlObj.pathname,
      pathParts,
      bucketIndex
    });

    const command = new DeleteObjectCommand({
      Bucket: config.bucketName!,
      Key: key,
    });

    await client.send(command);
    console.log(`✅ File deleted from R2: ${key}`);
    return true;
  } catch (error) {
    console.error('❌ Error deleting from R2:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      fileUrl,
      stack: error instanceof Error ? error.stack : undefined
    });
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
    const config = getR2Config();

    // Extract key from URL
    const urlObj = new URL(fileUrl);
    const key = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname;
    const keyParts = key.split('/');
    const bucketIndex = keyParts.indexOf(config.bucketName!);
    const actualKey = bucketIndex >= 0
      ? keyParts.slice(bucketIndex + 1).join('/')
      : key;

    const command = new HeadObjectCommand({
      Bucket: config.bucketName!,
      Key: actualKey,
    });

    await client.send(command);
    return true;
  } catch (_error) {
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
    const config = getR2Config();

    // Extract key from URL using robust logic
    const urlObj = new URL(fileUrl);
    const pathname = urlObj.pathname.startsWith('/') ? urlObj.pathname.slice(1) : urlObj.pathname;
    const pathParts = pathname.split('/').filter(p => p);

    // Find the bucket name index
    const bucketIndex = pathParts.indexOf(config.bucketName!);

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

    // ROBUST KEY RESOLUTION:
    // Files might be in 'documents/' OR 'kitchen-applications/'.
    // We check existence to ensure we sign the correct key.

    // 1. Check original key
    try {
      await client.send(new HeadObjectCommand({ Bucket: config.bucketName!, Key: key }));
      // If successful, key exists. Use it.
    } catch (headError: unknown) {
      const err = headError as { name?: string; $metadata?: { httpStatusCode?: number }; message?: string };
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        // 2. Original key NOT found. Check remapped key if applicable.
        if (key.startsWith('documents/') &&
          (key.includes('foodSafetyLicenseFile') || key.includes('foodEstablishmentCert'))) {

          const remappedKey = key.replace('documents/', 'kitchen-applications/');
          console.log(`[R2 Storage] Key ${key} not found. Checking remapped: ${remappedKey}`);

          try {
            await client.send(new HeadObjectCommand({ Bucket: config.bucketName!, Key: remappedKey }));
            // Remapped key exists! Use it.
            key = remappedKey;
            console.log(`[R2 Storage] Using remapped key: ${key}`);
          } catch (_remapError) {
            console.log(`[R2 Storage] Remapped key also not found: ${remappedKey}`);
            // Neither found. Fallback to original key (will likely 404 client-side, but nothing else we can do)
          }
        }
      } else {
        // Other error (auth, network), log it but proceed with original key
        console.warn(`[R2 Storage] Warning: HeadObject validation failed for ${key}:`, err.message);
      }
    }

    const command = new GetObjectCommand({
      Bucket: config.bucketName!,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(client, command, { expiresIn });
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
  const config = getR2Config();
  return !!(
    config.accountId &&
    config.accessKeyId &&
    config.secretAccessKey &&
    config.bucketName
  );
}

