import { useState, useEffect } from 'react';

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
    
    fetch('/api/images/presigned-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ imageUrl }),
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
      .catch((error) => {
        console.error('Error fetching presigned URL:', error);
        // Fallback to original URL
        setPresignedUrl(imageUrl);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [imageUrl]);

  return presignedUrl || imageUrl || null;
}
