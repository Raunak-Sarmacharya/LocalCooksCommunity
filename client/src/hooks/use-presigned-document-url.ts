import { logger } from "@/lib/logger";
import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';

/**
 * Hook to fetch presigned URL for a document from the bucket
 * Returns the presigned URL or falls back to the original URL
 */
export function usePresignedDocumentUrl(documentUrl: string | null | undefined): {
    url: string | null;
    isLoading: boolean;
    error: Error | null;
} {
    const [presignedUrl, setPresignedUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (!documentUrl) {
            setPresignedUrl(null);
            return;
        }

        // If it's already a data URL or blob URL, use it directly
        if (documentUrl.startsWith('data:') || documentUrl.startsWith('blob:')) {
            setPresignedUrl(documentUrl);
            return;
        }

        // Check if it's a public R2 URL or already signed
        if (documentUrl.includes('.r2.dev/') && !documentUrl.includes('r2.cloudflarestorage.com')) {
            setPresignedUrl(documentUrl);
            return;
        }

        // Check if it's a local development URL or public file
        // Note: Our backend handles /files/documents/ routes and redirects to R2 if needed
        // But for private R2 files, we specifically want the r2-presigned endpoint
        const isPrivateR2 = documentUrl.includes('r2.cloudflarestorage.com') ||
            documentUrl.includes('files.localcooks.ca') ||
            // Check for our internal file proxy paths that typically wrap private R2 files
            (documentUrl.startsWith('/api/files/') && !documentUrl.includes('public/'));

        if (!isPrivateR2) {
            setPresignedUrl(documentUrl);
            return;
        }

        // For private R2 bucket URLs, fetch presigned URL with authentication
        setIsLoading(true);
        setError(null);

        const fetchPresignedUrl = async () => {
            try {
                const headers: Record<string, string> = {};

                // Add Firebase auth token if user is authenticated
                const currentUser = auth.currentUser;
                if (currentUser) {
                    try {
                        const token = await currentUser.getIdToken();
                        if (token) {
                            headers['Authorization'] = `Bearer ${token}`;
                        }
                    } catch (tokenError) {
                        logger.warn('Could not get Firebase token for presigned document URL request:', tokenError);
                    }
                }

                // Use our normalized endpoint
                const endpoint = `/api/files/r2-presigned?url=${encodeURIComponent(documentUrl)}`;

                const response = await fetch(endpoint, {
                    method: 'GET',
                    headers,
                    credentials: 'include',
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch presigned URL');
                }

                const data = await response.json();
                setPresignedUrl(data.url);
            } catch (err) {
                logger.error('Error fetching presigned document URL:', err);
                setError(err instanceof Error ? err : new Error('Unknown error'));
                // Fallback to original URL - user might have access or it might work via other means
                setPresignedUrl(documentUrl);
            } finally {
                setIsLoading(false);
            }
        };

        fetchPresignedUrl();
    }, [documentUrl]);

    return { url: presignedUrl || documentUrl || null, isLoading, error };
}
