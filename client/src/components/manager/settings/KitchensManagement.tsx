/**
 * Kitchens Management Component
 * Manages kitchen photos, descriptions, and gallery images
 */

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChefHat, Plus, Trash2, Upload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    <div className="space-y-3">
      {currentGalleryImages.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
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
              className="h-32"
              containerClassName="w-full"
              aspectRatio="1/1"
              showReplaceButton={true}
              showRemoveButton={true}
            />
          ))}
        </div>
      )}

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-gray-400 transition-colors">
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
          className={`flex flex-col items-center justify-center cursor-pointer ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-8 w-8 text-gray-400 animate-spin mb-2" />
              <span className="text-sm text-gray-600">Uploading... {Math.round(uploadProgress)}%</span>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-gray-400 mb-2" />
              <span className="text-sm font-medium text-gray-700 mb-1">Click to add gallery image</span>
              <span className="text-xs text-gray-500">JPG, PNG, WebP (max 4.5MB)</span>
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Kitchens</h2>
          <p className="text-muted-foreground">
            Manage kitchen photos and descriptions for {location.name}.
          </p>
        </div>
        <Button onClick={() => setShowCreateKitchen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Kitchen
        </Button>
      </div>

      {/* Create Kitchen Form */}
      {showCreateKitchen && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create New Kitchen</CardTitle>
            <CardDescription>Add a new kitchen to this location</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="kitchen-name">Kitchen Name</Label>
              <Input
                id="kitchen-name"
                value={newKitchenName}
                onChange={(e) => setNewKitchenName(e.target.value)}
                placeholder="e.g., Main Kitchen, Prep Kitchen"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="kitchen-desc">Description (Optional)</Label>
              <Textarea
                id="kitchen-desc"
                value={newKitchenDescription}
                onChange={(e) => setNewKitchenDescription(e.target.value)}
                placeholder="Describe this kitchen's features and equipment"
                rows={3}
                className="mt-1.5"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreateKitchen} disabled={isCreatingKitchen}>
                {isCreatingKitchen ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Kitchen'
                )}
              </Button>
              <Button variant="outline" onClick={() => setShowCreateKitchen(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Kitchen List */}
      {isLoadingKitchens ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : kitchens.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ChefHat className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Kitchens Yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add your first kitchen to start accepting bookings.
            </p>
            <Button onClick={() => setShowCreateKitchen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Kitchen
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {kitchens.map((kitchen) => (
            <Card key={kitchen.id} className="border-amber-200 bg-amber-50/30">
              <CardContent className="p-6">
                <div className="flex gap-6">
                  <div className="flex-1 space-y-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-gray-900">{kitchen.name}</h4>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the kitchen "{kitchen.name}" and all associated bookings, availability settings, and custom overrides. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-red-600 hover:bg-red-700 text-white"
                              onClick={() => handleDeleteKitchen(kitchen.id)}
                            >
                              Delete Kitchen
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    <div>
                      <Label>Description</Label>
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
                        placeholder="Enter a description for this kitchen"
                        className="mt-1.5"
                        rows={3}
                        disabled={updatingKitchenId === kitchen.id}
                      />
                      {updatingKitchenId === kitchen.id && (
                        <p className="text-xs text-amber-600 mt-1">Saving...</p>
                      )}
                    </div>
                  </div>
                  <div className="w-48">
                    <Label className="mb-2 block">Main Image</Label>
                    <ImageWithReplace
                      imageUrl={kitchen.imageUrl || undefined}
                      onImageChange={(newUrl) => {
                        handleKitchenImageUpdate(kitchen.id, newUrl || null);
                      }}
                      onRemove={() => handleKitchenImageUpdate(kitchen.id, null)}
                      alt={kitchen.name}
                      className="w-full h-32 object-cover rounded-lg"
                      containerClassName="w-full"
                      aspectRatio="16/9"
                      fieldName="kitchenImage"
                      maxSize={4.5 * 1024 * 1024}
                      allowedTypes={['image/jpeg', 'image/jpg', 'image/png', 'image/webp']}
                    />
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-amber-200">
                  <Label className="mb-3 block">Gallery Images</Label>
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
