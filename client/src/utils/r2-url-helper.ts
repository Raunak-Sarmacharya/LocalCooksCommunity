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

  // If it's a local file URL, return as-is
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
