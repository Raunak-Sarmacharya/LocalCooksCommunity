import { useState, useEffect } from 'react';

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

        // For private R2 bucket URLs, fetch presigned URL
        setIsLoading(true);
        setError(null);

        // Use our normalized endpoint
        const endpoint = `/api/files/r2-presigned?url=${encodeURIComponent(documentUrl)}`;

        // We can use GET here as defined in the manager page logic, or POST if preferred.
        // The existing r2-presigned route in routes/files.ts is GET line 221

        fetch(endpoint, {
            method: 'GET',
            credentials: 'include',
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error('Failed to fetch presigned URL');
                }
                return response.json();
            })
            .then((data) => {
                setPresignedUrl(data.url);
            })
            .catch((err) => {
                console.error('Error fetching presigned document URL:', err);
                setError(err);
                // Fallback to original URL - user might have access or it might work via other means
                setPresignedUrl(documentUrl);
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [documentUrl]);

    return { url: presignedUrl || documentUrl || null, isLoading, error };
}
