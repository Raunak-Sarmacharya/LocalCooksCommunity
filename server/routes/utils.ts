import { Request } from "express";

/**
 * Normalizes image URLs to ensure they work in both development and production.
 * Converts relative paths to absolute URLs when needed.
 * Handles R2 custom domain URLs by converting them to API proxy URLs.
 * 
 * @param url - The image URL to normalize (can be null, undefined, or a string)
 * @param req - Express request object to get the origin/host
 * @returns Normalized absolute URL or null if input was null/undefined
 */
export function normalizeImageUrl(url: string | null | undefined, req: Request): string | null {
    if (!url) return null;

    const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

    // Helper to get origin
    const getOrigin = (): string => {
        let protocol: string;
        let host: string;

        if (isProduction) {
            protocol = (req.get('x-forwarded-proto') || 'https').split(',')[0].trim();
            host = req.get('x-forwarded-host') || req.get('host') || req.headers.host || '';
            if (protocol !== 'https') protocol = 'https';
        } else {
            protocol = req.protocol || 'http';
            host = req.get('host') || req.headers.host || 'localhost:5001';
        }

        return `${protocol}://${host}`;
    };

    // Check if this is an R2 custom domain URL (files.localcooks.ca) that needs proxying
    // This domain doesn't have DNS configured, so we need to proxy through our API
    if (url.startsWith('https://files.localcooks.ca/')) {
        // Extract the path (e.g., "documents/221_file_1768267179125_cafeteria3.jpg")
        const r2Path = url.replace('https://files.localcooks.ca/', '');
        
        // IMPORTANT: Document URLs require authentication which browsers can't provide
        // in direct requests (e.g., <img> tags). For documents, return the original URL
        // and let the client handle it via presigned URL hooks.
        // Only proxy public paths (kitchens/, public/) that don't require auth.
        if (r2Path.startsWith('documents/') || r2Path.startsWith('documents%2F')) {
            // Return original URL - client will use usePresignedDocumentUrl hook
            return url;
        }
        
        const origin = getOrigin();
        return `${origin}/api/files/images/r2/${encodeURIComponent(r2Path)}`;
    }

    // If already an absolute URL (http:// or https://), return as-is
    if (url.startsWith('http://') || url.startsWith('https://')) {
        // Special case: Normalize R2 URLs to use our proxy
        // This ensures they go through the auth/public-fallback logic in /api/files/documents
        if (url.includes('r2.localcooks.com/documents/') || url.includes('.r2.dev/documents/')) {
            const filename = url.split('/').pop();
            if (filename) {
                const origin = getOrigin();
                return `${origin}/api/files/documents/${filename}`;
            }
        }
        return url;
    }

    // If it's a relative path, convert to absolute URL
    if (url.startsWith('/')) {
        const origin = getOrigin();
        if (!origin || origin === '://') {
            console.warn(`[normalizeImageUrl] Could not determine host for URL: ${url}`);
            return url;
        }
        return `${origin}${url}`;
    }

    // Return as-is if it doesn't match any pattern (might be a data URL or other format)
    return url;
}
