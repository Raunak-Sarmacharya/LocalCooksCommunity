import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Upload, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { useSessionFileUpload } from '@/hooks/useSessionFileUpload';
import { cn } from '@/lib/utils';

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
        return;
      }

      // If it's already a data URL or absolute URL that doesn't need presigning
      if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
        setImageSrc(imageUrl);
        return;
      }

      // Check if it's a local development URL
      if (imageUrl.startsWith('/api/files/') || imageUrl.startsWith('/uploads/')) {
        setImageSrc(imageUrl);
        return;
      }

      // For R2 bucket URLs, get presigned URL
      setIsLoading(true);
      setError(null);
      
      try {
        const response = await fetch('/api/images/presigned-url', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ imageUrl }),
        });

        if (!response.ok) {
          throw new Error('Failed to fetch image URL');
        }

        const data = await response.json();
        setImageSrc(data.url);
      } catch (err) {
        console.error('Error fetching presigned URL:', err);
        // Fallback to original URL
        setImageSrc(imageUrl);
        setError('Failed to load image');
      } finally {
        setIsLoading(false);
      }
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
      {imageSrc ? (
        <div className="relative group">
          <div className={cn('relative overflow-hidden rounded-lg border border-gray-200 bg-gray-100', aspectRatioClass, className)}>
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
              </div>
            ) : (
              <img
                src={imageSrc}
                alt={alt}
                className={cn('w-full h-full object-cover', !aspectRatio && className)}
                onError={(e) => {
                  console.error('Image failed to load:', imageUrl);
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  setError('Failed to load image');
                }}
                onLoad={() => {
                  setError(null);
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
        <div className={cn('border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 transition-colors bg-gray-50', aspectRatioClass, className)}>
          <label className="cursor-pointer">
            <input
              type="file"
              accept={allowedTypes.join(',')}
              onChange={handleFileSelect}
              className="hidden"
              disabled={isUploading}
            />
            <div className="flex flex-col items-center space-y-4">
              {isUploading ? (
                <>
                  <Loader2 className="h-12 w-12 text-gray-400 animate-spin" />
                  <span className="text-sm text-gray-600">
                    Uploading... {Math.round(uploadProgress)}%
                  </span>
                </>
              ) : (
                <>
                  <Upload className="h-12 w-12 text-gray-400" />
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">Click to upload image</span> or drag and drop
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
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
