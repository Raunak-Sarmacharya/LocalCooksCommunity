import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Upload, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { useSessionFileUpload } from '@/hooks/useSessionFileUpload';
import { cn } from '@/lib/utils';
import { auth } from '@/lib/firebase';

interface ImageWithReplaceProps {
  imageUrl: string | null | undefined;
  onImageChange: (newUrl: string | null) => void;
  onRemove?: () => void;
  alt?: string;
  className?: string;
  containerClassName?: string;
  showReplaceButton?: boolean;
  showRemoveButton?: boolean;
  maxSize?: number; // in bytes
  allowedTypes?: string[];
  fieldName?: string;
  aspectRatio?: string; // e.g., "16/9", "1/1", "4/3"
}

export function ImageWithReplace({
  imageUrl,
  onImageChange,
  onRemove,
  alt = 'Image',
  className = '',
  containerClassName = '',
  showReplaceButton = true,
  showRemoveButton = true,
  maxSize = 4.5 * 1024 * 1024, // 4.5MB default
  allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  fieldName = 'image',
  aspectRatio,
}: ImageWithReplaceProps) {
  const { toast } = useToast();
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { uploadFile, isUploading, uploadProgress } = useSessionFileUpload({
    maxSize,
    allowedTypes,
    onSuccess: (response) => {
      onImageChange(response.url);
      toast({
        title: 'Image uploaded',
        description: 'Image has been successfully uploaded.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Upload failed',
        description: error,
        variant: 'destructive',
      });
    },
  });

  // Fetch presigned URL for the image
  useEffect(() => {
    const fetchImageUrl = async () => {
      if (!imageUrl) {
        setImageSrc(null);
        setIsLoading(false);
        return;
      }

      // If it's already a data URL or absolute URL that doesn't need presigning
      if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
        setImageSrc(imageUrl);
        setIsLoading(false);
        return;
      }

      // Check if it's a local development URL
      if (imageUrl.startsWith('/api/files/') || imageUrl.startsWith('/uploads/')) {
        setImageSrc(imageUrl);
        setIsLoading(false);
        return;
      }

      // Check if it's already a full URL (R2 public URL or other CDN)
      if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        // First, set the URL directly as a fallback
        setImageSrc(imageUrl);
        setIsLoading(true);
        setError(null);
        
        // Check if we're in development - skip presigned URL in dev
        const isDevelopment = window.location.hostname === 'localhost' || 
                              window.location.hostname === '127.0.0.1' ||
                              window.location.hostname.includes('localhost');
        
        // In development, just use the direct URL (no presigned URL needed)
        if (isDevelopment) {
          setIsLoading(false);
          return;
        }
        
        // Then try to get presigned URL for better security/performance (production only)
        // But don't wait for it - show the image immediately
        const fetchPresignedUrl = async () => {
          try {
            // Get Firebase auth token if available
            const currentUser = auth.currentUser;
            const headers: HeadersInit = {
              'Content-Type': 'application/json',
            };
            
            if (currentUser) {
              try {
                const token = await currentUser.getIdToken();
                headers['Authorization'] = `Bearer ${token}`;
              } catch (tokenError) {
                console.warn('Could not get auth token for presigned URL:', tokenError);
                // Continue without token - might work if R2 is public
              }
            }
            
            const response = await fetch('/api/images/presigned-url', {
              method: 'POST',
              headers,
              credentials: 'include',
              body: JSON.stringify({ imageUrl }),
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data && data.url) {
                setImageSrc(data.url);
              } else {
                // If no URL in response, keep using direct URL
                console.warn('Presigned URL response missing URL, using direct URL');
              }
            } else {
              // If presigned URL fails, try using the direct URL
              // This will work if R2 bucket is public
              const errorData = await response.json().catch(() => ({}));
              console.warn('Presigned URL fetch failed, using direct URL:', {
                status: response.status,
                error: errorData.error || 'Unknown error'
              });
              // Keep the direct URL that was already set
            }
          } catch (err) {
            console.error('Error fetching presigned URL (using direct URL):', err);
            // Keep using the direct URL that was already set
          } finally {
            setIsLoading(false);
          }
        };
        
        fetchPresignedUrl();
        return;
      }

      // For other cases, use the URL directly
      setImageSrc(imageUrl);
      setIsLoading(false);
    };

    fetchImageUrl();
  }, [imageUrl]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadFile(file);
      e.target.value = ''; // Reset input
    }
  };

  const handleRemove = () => {
    if (onRemove) {
      onRemove();
    } else {
      onImageChange(null);
    }
  };

  const aspectRatioClass = aspectRatio 
    ? `aspect-[${aspectRatio.replace('/', '-')}]` 
    : '';

  return (
    <div className={cn('relative', containerClassName)}>
      {imageUrl ? (
        <div className="relative group">
          <div className={cn('relative overflow-hidden rounded-lg border border-gray-200 bg-gray-100', aspectRatioClass, className)}>
            {isLoading || !imageSrc ? (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
              </div>
            ) : (
              <img
                src={imageSrc}
                alt={alt}
                className={cn('w-full h-full object-cover', !aspectRatio && className)}
                onError={(e) => {
                  console.error('Image failed to load:', {
                    originalUrl: imageUrl,
                    resolvedUrl: imageSrc,
                    error: 'Image load failed'
                  });
                  
                  // If presigned URL failed, try the original URL directly
                  if (imageSrc !== imageUrl && imageUrl) {
                    console.log('Retrying with original URL:', imageUrl);
                    setImageSrc(imageUrl);
                    setError(null);
                  } else {
                    setError('Failed to load image');
                    setIsLoading(false);
                  }
                }}
                onLoad={() => {
                  setError(null);
                  setIsLoading(false);
                }}
              />
            )}
            
            {/* Overlay with action buttons - visible on hover */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              {showReplaceButton && (
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept={allowedTypes.join(',')}
                    onChange={handleFileSelect}
                    className="hidden"
                    disabled={isUploading}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isUploading}
                    className="bg-white/90 hover:bg-white"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {Math.round(uploadProgress)}%
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Replace
                      </>
                    )}
                  </Button>
                </label>
              )}
              {showRemoveButton && (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={handleRemove}
                  disabled={isUploading}
                >
                  <X className="h-4 w-4 mr-2" />
                  Remove
                </Button>
              )}
            </div>
          </div>
          
          {error && (
            <div className="mt-2 text-sm text-red-600 flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>
      ) : (
        <div className={cn('border-2 border-dashed border-gray-300 rounded-lg p-4 sm:p-8 text-center hover:border-gray-400 transition-colors bg-gray-50 overflow-hidden', aspectRatioClass, className)}>
          <label className="cursor-pointer block w-full">
            <input
              type="file"
              accept={allowedTypes.join(',')}
              onChange={handleFileSelect}
              className="hidden"
              disabled={isUploading}
            />
            <div className="flex flex-col items-center justify-center space-y-3 min-h-[120px]">
              {isUploading ? (
                <>
                  <Loader2 className="h-12 w-12 text-gray-400 animate-spin" />
                  <span className="text-sm text-gray-600">
                    Uploading... {Math.round(uploadProgress)}%
                  </span>
                </>
              ) : (
                <>
                  <Upload className="h-10 w-10 sm:h-12 sm:w-12 text-gray-400 flex-shrink-0" />
                  <div className="text-sm text-gray-600 px-2">
                    <span className="font-medium block sm:inline">Click to upload</span>
                    <span className="hidden sm:inline"> or </span>
                    <span className="block sm:inline">drag and drop</span>
                  </div>
                  <p className="text-xs text-gray-500 px-2 break-words">
                    {allowedTypes.map(t => t.split('/')[1]).join(', ').toUpperCase()} (max {(maxSize / 1024 / 1024).toFixed(1)}MB)
                  </p>
                </>
              )}
            </div>
          </label>
        </div>
      )}
    </div>
  );
}
