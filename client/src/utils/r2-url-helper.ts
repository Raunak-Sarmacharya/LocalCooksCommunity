/**
 * Utility function to convert R2 URLs to proxy URLs for secure access
 * This ensures all R2 files are accessible even if the bucket is private
 */
export function getR2ProxyUrl(fileUrl: string | null | undefined): string {
  if (!fileUrl) {
    return '#';
  }

  // If it's already a proxy URL, return as-is
  if (fileUrl.includes('/api/files/r2-proxy')) {
    return fileUrl;
  }

  // If it's a local file URL, return as-is (will need token for auth)
  if (fileUrl.startsWith('/api/files/') || fileUrl.startsWith('/uploads/')) {
    return fileUrl;
  }

  // If it's a data URL or blob URL, return as-is
  if (fileUrl.startsWith('data:') || fileUrl.startsWith('blob:')) {
    return fileUrl;
  }

  // Check if it's an R2 URL
  const isR2Url = fileUrl.includes('r2.cloudflarestorage.com') || 
                  fileUrl.includes('cloudflare') ||
                  (fileUrl.startsWith('http') && !fileUrl.startsWith('/api/files/'));

  // If it's an R2 URL, convert to proxy URL
  if (isR2Url) {
    return `/api/files/r2-proxy?url=${encodeURIComponent(fileUrl)}`;
  }

  // For other URLs, return as-is
  return fileUrl;
}

/**
 * Get authenticated file URL with Firebase token
 * For local files, appends token as query parameter
 * For R2 files, uses proxy or presigned URL
 */
export async function getAuthenticatedFileUrl(fileUrl: string | null | undefined): Promise<string> {
  if (!fileUrl) {
    return '#';
  }

  // If it's already a data URL or blob URL, return as-is
  if (fileUrl.startsWith('data:') || fileUrl.startsWith('blob:')) {
    return fileUrl;
  }

  // If it's a local file URL, add Firebase token
  if (fileUrl.startsWith('/api/files/documents/')) {
    try {
      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;
      if (currentUser) {
        const token = await currentUser.getIdToken();
        const separator = fileUrl.includes('?') ? '&' : '?';
        return `${fileUrl}${separator}token=${encodeURIComponent(token)}`;
      }
    } catch (error) {
      console.error('Error getting Firebase token for file URL:', error);
    }
    // Fallback to original URL if token can't be obtained
    return fileUrl;
  }

  // For R2 URLs, use proxy
  if (fileUrl.includes('r2.cloudflarestorage.com') || fileUrl.includes('cloudflare')) {
    return getR2ProxyUrl(fileUrl);
  }

  // For other URLs, return as-is
  return fileUrl;
}
