import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { auth } from "@/lib/firebase";
import { Progress } from "@/components/ui/progress";
import {
    ACCEPTED_IMAGE_TYPES,
    GalleryPhotoField,
} from "@/components/manager/kitchen/KitchenPhotoFields";

interface KitchenGalleryImagesProps {
    kitchenId: number;
    galleryImages: string[];
    locationId: number;
    /** The cover, drawn as the first cell of the same grid. */
    coverSlot?: React.ReactNode;
}

/**
 * A kitchen's gallery, rendered with the same field the Photos tab uses so the
 * onboarding card and the settings tab cannot drift apart.
 *
 * This wrapper owns only persistence: upload, the gallery PUT, and deleting the
 * replaced/removed object from R2.
 */
export function KitchenGalleryImages({
    kitchenId,
    galleryImages,
    locationId,
    coverSlot,
}: KitchenGalleryImagesProps) {
  
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [currentGalleryImages, setCurrentGalleryImages] = useState<string[]>(galleryImages || []);

    const { uploadFile, isUploading, uploadProgress } = useSessionFileUpload({
        maxSize: 4.5 * 1024 * 1024,
        allowedTypes: ACCEPTED_IMAGE_TYPES,
        onError: (error) => {
            toast({ title: mt("uploadFailed2"),
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
                throw new Error(tt("firebaseUserNotAvailable"));
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

            toast({ title: mt("success"),
                description: mt("galleryImagesUpdatedSuccessfully"),
            });
        } catch (error: any) {
            logger.error('Gallery images update error:', error);
            toast({ title: mt("error"),
                description: error.message || "Failed to update gallery images",
                variant: "destructive",
            });
        }
    };

    /** Drop the object from storage. Non-fatal: the gallery row is already saved. */
    const deleteFromR2 = async (imageUrl: string) => {
        try {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) return;

            const token = await currentFirebaseUser.getIdToken();
            await fetch('/api/manager/files', {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({ fileUrl: imageUrl }),
            });
        } catch (error) {
            logger.error('Error deleting file from R2:', error);
        }
    };

    /** Upload a batch, then save the gallery once rather than once per file. */
    const uploadMany = async (files: File[]) => {
        const uploaded: string[] = [];
        for (const file of files) {
            const result = await uploadFile(file, "public/kitchens");
            if (result?.url) uploaded.push(result.url);
        }
        if (uploaded.length > 0) {
            await updateGalleryImages([...currentGalleryImages, ...uploaded]);
        }
    };

    const replaceImage = async (oldUrl: string, file: File) => {
        const result = await uploadFile(file, "public/kitchens");
        if (!result?.url) return;
        await updateGalleryImages(currentGalleryImages.map(img => (img === oldUrl ? result.url : img)));
        await deleteFromR2(oldUrl);
    };

    const removeImage = async (imageUrl: string) => {
        await updateGalleryImages(currentGalleryImages.filter(img => img !== imageUrl));
        await deleteFromR2(imageUrl);
    };

    return (
        <GalleryPhotoField
            images={currentGalleryImages}
            coverSlot={coverSlot}
            onSelectFiles={(files) => void uploadMany(files)}
            onReplace={(oldUrl, file) => void replaceImage(oldUrl, file)}
            onRemove={(imageUrl) => void removeImage(imageUrl)}
            disabled={isUploading}
            progress={isUploading ? (
                <div className="mb-4 space-y-1.5">
                    <Progress value={uploadProgress} />
                    <p className="text-xs text-muted-foreground">
                        {mt("uploading")} {Math.round(uploadProgress)}%
                    </p>
                </div>
            ) : null}
        />
    );
}

export default KitchenGalleryImages;
