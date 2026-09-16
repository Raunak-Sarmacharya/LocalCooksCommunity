import { logger } from "@/lib/logger";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Upload, X, Loader2, Image as ImageIcon } from "lucide-react";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { cn } from "@/lib/utils";
import { auth } from "@/lib/firebase";
import { resolveImageUrl } from "@/lib/resolve-image-url";
import { SmartImage } from "@/components/ui/smart-image";

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
    const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { uploadFile, isUploading, uploadProgress } = useSessionFileUpload({
    maxSize,
    allowedTypes,
    onSuccess: (response) => {
      onImageChange(response.url);
      toast.success('Image uploaded', {
        description: 'Image has been successfully uploaded.'
      });
    },
    onError: (error) => {
      toast.error('Upload failed', {
        description: error
      });
    },
  });

  // Resolve the stored reference into a URL the browser can load.
  useEffect(() => {
    setImageSrc(resolveImageUrl(imageUrl));
    setIsLoading(false);
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
            {!imageSrc ? (
              <div className="absolute inset-0 image-shimmer" aria-hidden="true" />
            ) : (
              <SmartImage
                src={imageSrc}
                alt={alt}
                className={cn('w-full h-full object-cover', !aspectRatio && className)}
                onError={(e) => {
                  logger.error('Image failed to load:', {
                    originalUrl: imageUrl,
                    resolvedUrl: imageSrc,
                    error: 'Image load failed'
                  });

                  // If presigned URL failed, try the original URL directly
                  if (imageSrc !== imageUrl && imageUrl) {
                    logger.info('Retrying with original URL:', imageUrl);
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

            <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-2 bg-gradient-to-t from-black/65 to-transparent p-3 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              {showReplaceButton && (
                <label className="inline-flex h-9 cursor-pointer items-center rounded-md bg-white px-3 text-sm font-medium text-slate-900 shadow-sm transition-colors hover:bg-slate-100">
                  <input
                    type="file"
                    accept={allowedTypes.join(',')}
                    onChange={handleFileSelect}
                    className="hidden"
                    disabled={isUploading}
                  />
                  {isUploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{Math.round(uploadProgress)}%</> : <><Upload className="mr-2 h-4 w-4" />Replace</>}
                </label>
              )}
              {showRemoveButton && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleRemove}
                  disabled={isUploading}
                  className="bg-white text-destructive shadow-sm hover:bg-destructive hover:text-destructive-foreground"
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
