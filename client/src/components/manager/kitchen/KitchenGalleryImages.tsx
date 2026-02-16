import { logger } from "@/lib/logger";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2, X, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { ImageWithReplace } from "@/components/ui/image-with-replace";
import { cn } from "@/lib/utils";

interface KitchenGalleryImagesProps {
    kitchenId: number;
    galleryImages: string[];
    locationId: number;
}

export function KitchenGalleryImages({
    kitchenId,
    galleryImages,
    locationId
}: KitchenGalleryImagesProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [currentGalleryImages, setCurrentGalleryImages] = useState<string[]>(galleryImages || []);

    const { uploadFile, isUploading, uploadProgress } = useSessionFileUpload({
        maxSize: 4.5 * 1024 * 1024,
        allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
        onSuccess: async (response) => {
            const newGalleryImages = [...currentGalleryImages, response.url];
            await updateGalleryImages(newGalleryImages);
        },
        onError: (error) => {
            toast({
                title: "Upload failed",
                description: error,
                variant: "destructive",
            });
        },
    });

    useEffect(() => {
        setCurrentGalleryImages(galleryImages || []);
    }, [galleryImages]);

    const updateGalleryImages = async (newGalleryImages: string[]) => {
        try {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) {
                throw new Error("Firebase user not available");
            }

            const token = await currentFirebaseUser.getIdToken();
            const headers: HeadersInit = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            };

            const updateResponse = await fetch(`/api/manager/kitchens/${kitchenId}/gallery`, {
                method: 'PUT',
                headers,
                credentials: 'include',
                body: JSON.stringify({ galleryImages: newGalleryImages }),
            });

            if (!updateResponse.ok) {
                const errorData = await updateResponse.json();
                throw new Error(errorData.error || 'Failed to update gallery images');
            }

            setCurrentGalleryImages(newGalleryImages);
            queryClient.invalidateQueries({ queryKey: ['managerKitchens', locationId] });

            toast({
                title: "Success",
                description: "Gallery images updated successfully",
            });
        } catch (error: any) {
            logger.error('Gallery images update error:', error);
            toast({
                title: "Error",
                description: error.message || "Failed to update gallery images",
                variant: "destructive",
            });
        }
    };

    const handleRemoveImage = async (imageUrl: string) => {
        const newGalleryImages = currentGalleryImages.filter(img => img !== imageUrl);
        await updateGalleryImages(newGalleryImages);

        // Delete from R2
        try {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) return;

            const token = await currentFirebaseUser.getIdToken();
            const headers: HeadersInit = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            };

            await fetch('/api/manager/files', {
                method: 'DELETE',
                headers,
                credentials: 'include',
                body: JSON.stringify({ fileUrl: imageUrl }),
            });
        } catch (error) {
            logger.error('Error deleting file from R2:', error);
        }
    };

    const handleReplaceImage = async (oldUrl: string, newUrl: string) => {
        const newGalleryImages = currentGalleryImages.map(img => img === oldUrl ? newUrl : img);
        await updateGalleryImages(newGalleryImages);

        // Delete old image from R2
        try {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) return;

            const token = await currentFirebaseUser.getIdToken();
            const headers: HeadersInit = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            };

            await fetch('/api/manager/files', {
                method: 'DELETE',
                headers,
                credentials: 'include',
                body: JSON.stringify({ fileUrl: oldUrl }),
            });
        } catch (error) {
            logger.error('Error deleting old file from R2:', error);
        }
    };

    return (
        <div className="space-y-4">
            {/* Existing Gallery Images */}
            {currentGalleryImages.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {currentGalleryImages.map((imageUrl, index) => (
                        <ImageWithReplace
                            key={index}
                            imageUrl={imageUrl}
                            onImageChange={(newUrl) => {
                                if (newUrl) {
                                    handleReplaceImage(imageUrl, newUrl);
                                } else {
                                    handleRemoveImage(imageUrl);
                                }
                            }}
                            onRemove={() => handleRemoveImage(imageUrl)}
                            alt={`Gallery image ${index + 1}`}
                            className="h-32 object-cover rounded-lg"
                            containerClassName="w-full"
                            aspectRatio="1/1"
                            showReplaceButton={true}
                            showRemoveButton={true}
                        />
                    ))}
                </div>
            )}

            {/* Upload Area using Standardized Styles */}
            <div
                className={cn(
                    "border-2 border-dashed border-border rounded-lg p-6 hover:border-primary/50 transition-colors bg-muted/20",
                    isUploading && "opacity-50 cursor-not-allowed"
                )}
            >
                <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                            uploadFile(file, "public/kitchens");
                            e.target.value = ''; // Reset input
                        }
                    }}
                    className="hidden"
                    id={`gallery-upload-${kitchenId}`}
                    disabled={isUploading}
                />
                <label
                    htmlFor={`gallery-upload-${kitchenId}`}
                    className="flex flex-col items-center justify-center cursor-pointer"
                >
                    {isUploading ? (
                        <>
                            <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
                            <span className="text-sm text-muted-foreground font-medium">Uploading... {Math.round(uploadProgress)}%</span>
                        </>
                    ) : (
                        <>
                            <div className="p-3 bg-primary/10 rounded-full mb-3">
                                <Upload className="h-6 w-6 text-primary" />
                            </div>
                            <span className="text-sm font-medium text-foreground mb-1">Click to add gallery image</span>
                            <span className="text-xs text-muted-foreground">JPG, PNG, WebP (max 4.5MB)</span>
                        </>
                    )}
                </label>
            </div>
        </div>
    );
}
