/**
 * Kitchens Management Component
 * Manages kitchen photos, descriptions, and gallery images
 */

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChefHat, Plus, Trash2, Loader2, ImagePlus } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { StatusButton } from '@/components/ui/status-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ImageWithReplace } from '@/components/ui/image-with-replace';
import { useSessionFileUpload } from '@/hooks/useSessionFileUpload';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Kitchen {
  id: number;
  name: string;
  description?: string;
  imageUrl?: string;
  galleryImages?: string[];
  locationId: number;
  isActive: boolean;
}

interface Location {
  id: number;
  name: string;
}

interface KitchensManagementProps {
  location: Location;
}

function KitchenGalleryImages({
  kitchenId,
  galleryImages,
  locationId
}: {
  kitchenId: number;
  galleryImages: string[];
  locationId: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
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
      console.error('Gallery images update error:', error);
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
      console.error('Error deleting file from R2:', error);
    }
  };

  const handleReplaceImage = async (oldUrl: string, newUrl: string) => {
    const newGalleryImages = currentGalleryImages.map(img => img === oldUrl ? newUrl : img);
    await updateGalleryImages(newGalleryImages);

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
        body: JSON.stringify({ fileUrl: oldUrl }),
      });
    } catch (error) {
      console.error('Error deleting old file from R2:', error);
    }
  };

  return (
    <div className="space-y-4">
      {currentGalleryImages.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
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
              className="h-28 rounded-lg"
              containerClassName="w-full"
              aspectRatio="1/1"
              showReplaceButton={true}
              showRemoveButton={true}
            />
          ))}
        </div>
      )}

      <div className="group border-2 border-dashed border-gray-200 rounded-lg p-6 hover:border-primary/40 hover:bg-primary/[0.02] transition-all duration-200">
        <input
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              uploadFile(file);
              e.target.value = '';
            }
          }}
          className="hidden"
          id={`gallery-upload-${kitchenId}`}
          disabled={isUploading}
        />
        <label
          htmlFor={`gallery-upload-${kitchenId}`}
          className={`flex flex-col items-center justify-center cursor-pointer gap-2 ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
              <span className="text-sm text-muted-foreground">Uploading... {Math.round(uploadProgress)}%</span>
            </>
          ) : (
            <>
              <ImagePlus className="h-6 w-6 text-muted-foreground group-hover:text-primary/60 transition-colors" />
              <div className="text-center">
                <span className="text-sm font-medium text-gray-700">Add photo</span>
                <p className="text-xs text-muted-foreground mt-0.5">JPG, PNG, WebP · Max 4.5 MB</p>
              </div>
            </>
          )}
        </label>
      </div>
    </div>
  );
}

export default function KitchensManagement({ location }: KitchensManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [kitchenDescriptions, setKitchenDescriptions] = useState<Record<number, string>>({});
  const [updatingKitchenId, setUpdatingKitchenId] = useState<number | null>(null);
  const [showCreateKitchen, setShowCreateKitchen] = useState(false);
  const [newKitchenName, setNewKitchenName] = useState('');
  const [newKitchenDescription, setNewKitchenDescription] = useState('');
  const [isCreatingKitchen, setIsCreatingKitchen] = useState(false);

  const { data: kitchens = [], isLoading: isLoadingKitchens } = useQuery<Kitchen[]>({
    queryKey: ['managerKitchens', location.id],
    queryFn: async () => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }

      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch(`/api/manager/kitchens/${location.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: "include",
      });
      if (!response.ok) throw new Error('Failed to fetch kitchens');
      return response.json();
    },
    enabled: !!location.id,
  });

  useEffect(() => {
    if (kitchens.length > 0) {
      const descriptions: Record<number, string> = {};
      kitchens.forEach((kitchen) => {
        descriptions[kitchen.id] = kitchen.description || '';
      });
      setKitchenDescriptions(descriptions);
    }
  }, [kitchens]);

  const handleKitchenDescriptionUpdate = async (kitchenId: number, description: string) => {
    setUpdatingKitchenId(kitchenId);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }

      const token = await currentFirebaseUser.getIdToken();

      const updateResponse = await fetch(`/api/manager/kitchens/${kitchenId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ description }),
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        throw new Error(errorData.error || 'Failed to update kitchen description');
      }

      queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });

      toast({
        title: "Success",
        description: "Kitchen description updated successfully",
      });
    } catch (error: any) {
      console.error('Kitchen description update error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update kitchen description",
        variant: "destructive",
      });
    } finally {
      setUpdatingKitchenId(null);
    }
  };

  const handleCreateKitchen = async () => {
    if (!newKitchenName.trim()) {
      toast({
        title: "Name Required",
        description: "Please enter a name for the kitchen.",
        variant: "destructive",
      });
      return;
    }

    setIsCreatingKitchen(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }

      const token = await currentFirebaseUser.getIdToken();

      const response = await fetch('/api/manager/kitchens', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          locationId: location.id,
          name: newKitchenName.trim(),
          description: newKitchenDescription.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create kitchen');
      }

      queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });

      toast({
        title: "Success",
        description: "Kitchen created successfully",
      });

      setNewKitchenName('');
      setNewKitchenDescription('');
      setShowCreateKitchen(false);
    } catch (error: any) {
      console.error('Kitchen creation error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create kitchen",
        variant: "destructive",
      });
    } finally {
      setIsCreatingKitchen(false);
    }
  };

  const handleDeleteKitchen = async (kitchenId: number) => {
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) throw new Error("Not authenticated");
      
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch(`/api/manager/kitchens/${kitchenId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) throw new Error("Failed to delete kitchen");
      
      queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
      toast({ title: "Kitchen Deleted", description: "Kitchen has been successfully removed." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleKitchenImageUpdate = async (kitchenId: number, imageUrl: string | null) => {
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }

      const token = await currentFirebaseUser.getIdToken();

      const updateResponse = await fetch(`/api/manager/kitchens/${kitchenId}/image`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ imageUrl }),
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        throw new Error(errorData.error || 'Failed to update kitchen image');
      }

      queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });

      toast({
        title: "Success",
        description: imageUrl ? "Kitchen image updated successfully" : "Kitchen image removed",
      });
    } catch (error: any) {
      console.error('Kitchen image update error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update kitchen image",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ChefHat className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Kitchens</h2>
            <p className="text-sm text-muted-foreground">
              Manage photos and descriptions for {location.name}
            </p>
          </div>
        </div>
        <Button onClick={() => setShowCreateKitchen(true)} size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Kitchen
        </Button>
      </div>

      {/* Create Kitchen Form */}
      {showCreateKitchen && (
        <Card className="border-primary/20 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">New Kitchen</CardTitle>
            <CardDescription>Add a new kitchen space to this location</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="kitchen-name">Kitchen Name</Label>
              <Input
                id="kitchen-name"
                value={newKitchenName}
                onChange={(e) => setNewKitchenName(e.target.value)}
                placeholder="e.g., Main Kitchen, Prep Kitchen"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kitchen-desc">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                id="kitchen-desc"
                value={newKitchenDescription}
                onChange={(e) => setNewKitchenDescription(e.target.value)}
                placeholder="Describe this kitchen's features, equipment, and capacity"
                rows={3}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <StatusButton
                onClick={handleCreateKitchen}
                status={isCreatingKitchen ? "loading" : "idle"}
                labels={{ idle: "Create Kitchen", loading: "Creating", success: "Created" }}
              />
              <Button variant="ghost" onClick={() => setShowCreateKitchen(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Kitchen List */}
      {isLoadingKitchens ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : kitchens.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <ChefHat className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1">No kitchens yet</h3>
            <p className="text-sm text-muted-foreground text-center mb-6 max-w-sm">
              Add your first kitchen to start managing photos, descriptions, and accepting bookings.
            </p>
            <Button onClick={() => setShowCreateKitchen(true)} size="sm">
              <Plus className="mr-1.5 h-4 w-4" />
              Add Your First Kitchen
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {kitchens.map((kitchen) => (
            <Card key={kitchen.id} className="overflow-hidden shadow-sm">
              {/* Hero Image Area */}
              <div className="relative">
                <ImageWithReplace
                  imageUrl={kitchen.imageUrl || undefined}
                  onImageChange={(newUrl) => {
                    handleKitchenImageUpdate(kitchen.id, newUrl || null);
                  }}
                  onRemove={() => handleKitchenImageUpdate(kitchen.id, null)}
                  alt={kitchen.name}
                  className="w-full h-44 object-cover"
                  containerClassName="w-full"
                  aspectRatio="21/9"
                  fieldName="kitchenImage"
                  maxSize={4.5 * 1024 * 1024}
                  allowedTypes={['image/jpeg', 'image/jpg', 'image/png', 'image/webp']}
                />
              </div>

              <CardContent className="p-0">
                {/* Kitchen Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{kitchen.name}</h3>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/5 h-8 px-2"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete the kitchen &ldquo;{kitchen.name}&rdquo; and all associated bookings, availability settings, and custom overrides. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => handleDeleteKitchen(kitchen.id)}
                        >
                          Delete Kitchen
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {/* Description Section */}
                <div className="px-5 py-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Description</Label>
                  <Textarea
                    value={kitchenDescriptions[kitchen.id] ?? kitchen.description ?? ''}
                    onChange={(e) => {
                      setKitchenDescriptions(prev => ({
                        ...prev,
                        [kitchen.id]: e.target.value
                      }));
                    }}
                    onBlur={(e) => {
                      const newDescription = e.target.value.trim();
                      const currentDescription = kitchen.description || '';
                      if (newDescription !== currentDescription) {
                        handleKitchenDescriptionUpdate(kitchen.id, newDescription);
                      }
                    }}
                    placeholder="Describe this kitchen's features, equipment, and what makes it special..."
                    className="mt-2 resize-none"
                    rows={3}
                    disabled={updatingKitchenId === kitchen.id}
                  />
                  {updatingKitchenId === kitchen.id && (
                    <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Saving changes...
                    </p>
                  )}
                </div>

                <Separator />

                {/* Gallery Section */}
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Gallery</Label>
                    {(kitchen.galleryImages || []).length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {(kitchen.galleryImages || []).length} photo{(kitchen.galleryImages || []).length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <KitchenGalleryImages
                    kitchenId={kitchen.id}
                    galleryImages={kitchen.galleryImages || []}
                    locationId={location.id}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
