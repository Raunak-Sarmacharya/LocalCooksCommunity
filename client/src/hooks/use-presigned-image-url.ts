import { logger } from "@/lib/logger";
import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';

/**
 * Hook to fetch presigned URL for an image from the bucket
 * Returns the presigned URL or falls back to the original URL
 */
export function usePresignedImageUrl(imageUrl: string | null | undefined): string | null {
  const [presignedUrl, setPresignedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!imageUrl) {
      setPresignedUrl(null);
      return;
    }

    // If it's already a data URL or blob URL, use it directly
    if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
      setPresignedUrl(imageUrl);
      return;
    }

    // Check if it's a local development URL
    if (imageUrl.startsWith('/api/files/') || imageUrl.startsWith('/uploads/')) {
      setPresignedUrl(imageUrl);
      return;
    }

    // For R2 bucket URLs, fetch presigned URL
    setIsLoading(true);

    // Get Firebase auth token for authenticated requests
    const fetchPresignedUrl = async () => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        // Add Firebase auth token if user is authenticated
        const currentUser = auth.currentUser;
        if (currentUser) {
          try {
            const token = await currentUser.getIdToken();
            if (token) {
              headers['Authorization'] = `Bearer ${token}`;
            }
          } catch (tokenError) {
            logger.warn('Could not get Firebase token for presigned URL request:', tokenError);
          }
        }

        const response = await fetch('/api/files/images/presigned-url', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ imageUrl }),
        });

        if (!response.ok) {
          throw new Error('Failed to fetch presigned URL');
        }

        const data = await response.json();
        setPresignedUrl(data.url);
      } catch (error) {
        logger.error('Error fetching presigned URL:', error);
        // Fallback to original URL
        setPresignedUrl(imageUrl);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPresignedUrl();
  }, [imageUrl]);

  return presignedUrl || imageUrl || null;
}
