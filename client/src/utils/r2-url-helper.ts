/**
 * Check if a URL points to a public folder (kitchens, public images)
 * Public folders don't require authentication
 */
function isPublicUrl(url: string): boolean {
  return url.includes('/public/') || url.includes('/kitchens/');
}

/**
 * Utility function to convert R2 URLs to proxy URLs for secure access
 * This ensures all R2 files are accessible even if the bucket is private
 * NOTE: For protected documents, use getAuthenticatedR2ProxyUrl instead
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

  // If it's a public R2 URL (pub-*.r2.dev), return as-is - these are publicly accessible
  if (fileUrl.includes('.r2.dev/')) {
    return fileUrl;
  }

  // Check if it's a private R2 URL or custom domain that needs proxying
  const isPrivateR2Url = fileUrl.includes('r2.cloudflarestorage.com') ||
    fileUrl.includes('files.localcooks.ca');

  // If it's a private R2 URL or custom domain, convert to proxy URL
  if (isPrivateR2Url) {
    return `/api/files/r2-proxy?url=${encodeURIComponent(fileUrl)}`;
  }

  // For other URLs (including public URLs), return as-is
  return fileUrl;
}

/**
 * Get authenticated R2 proxy URL with Firebase token
 * Use this for protected documents that require authentication
 */
export async function getAuthenticatedR2ProxyUrl(fileUrl: string | null | undefined): Promise<string> {
  if (!fileUrl) {
    return '#';
  }

  // If it's a public URL, no auth needed
  if (isPublicUrl(fileUrl)) {
    return getR2ProxyUrl(fileUrl);
  }

  // If it's already a data URL or blob URL, return as-is
  if (fileUrl.startsWith('data:') || fileUrl.startsWith('blob:')) {
    return fileUrl;
  }

  // If it's a public R2 URL (pub-*.r2.dev), return as-is
  if (fileUrl.includes('.r2.dev/')) {
    return fileUrl;
  }

  // For protected R2 URLs, fetch presigned URL with authentication
  const isPrivateR2Url = fileUrl.includes('r2.cloudflarestorage.com') ||
    fileUrl.includes('files.localcooks.ca');

  if (isPrivateR2Url) {
    try {
      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;
      if (currentUser) {
        const token = await currentUser.getIdToken();
        // Use the presigned URL endpoint which handles auth properly
        const response = await fetch(`/api/files/r2-presigned?url=${encodeURIComponent(fileUrl)}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          credentials: 'include',
        });
        
        if (response.ok) {
          const data = await response.json();
          return data.url;
        }
      }
    } catch (error) {
      console.error('Error getting authenticated R2 proxy URL:', error);
    }
    // Fallback to regular proxy URL (may fail for protected files)
    return getR2ProxyUrl(fileUrl);
  }

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

  // If it's a public R2 URL (pub-*.r2.dev), return as-is - these are publicly accessible
  if (fileUrl.includes('.r2.dev/')) {
    return fileUrl;
  }

  // For private R2 URLs or custom domain, use authenticated proxy
  if (fileUrl.includes('r2.cloudflarestorage.com') || fileUrl.includes('files.localcooks.ca')) {
    return getAuthenticatedR2ProxyUrl(fileUrl);
  }

  // For other URLs, return as-is
  return fileUrl;
}
