import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
/**
 * Kitchens Management Component
 * Manages kitchen photos, descriptions, and gallery images
 */

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Storefront, Plus, Trash2, Loader2, ImagePlus, KeyRound, Package, Wrench, Image as Images, Clock, ClipboardCheck } from "@/components/ui/manager-icons";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageWithReplace } from "@/components/ui/image-with-replace";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { ChefPageHeader } from "@/components/chef/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EquipmentListingContent } from "@/pages/EquipmentListingManagement";
import { StorageListingContent } from "@/pages/StorageListingManagement";
import { KitchenPricingContent } from "@/pages/KitchenPricingManagement";
import { kitchenSectionFromParams, type KitchenSection } from "@/lib/manager-kitchens-navigation";
import { apiPut } from "@/lib/api";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface Kitchen {
  id: number;
  name: string;
  description?: string;
  imageUrl?: string;
  locationId: number;
  isActive: boolean;
  galleryImages?: string[];
  minimumBookingHours?: number;
  /** Admin-controlled capability gate. When false, all smart-door UI is hidden. */
  smartLockAvailable?: boolean;
  smartLockEnabled?: boolean;
}

function getInitialKitchenSection(): KitchenSection {
  return kitchenSectionFromParams(new URLSearchParams(window.location.search));
}

interface Location {
  id: number;
  name: string;
}

interface KitchensManagementProps {
  location: Location;
  onNavigate: (view: 'availability') => void;
  onConfigureRequirements: () => void;
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
        description: error.message || tt("failedToUpdateGalleryImages"),
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
      logger.error('Error deleting file from R2:', error);
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
      logger.error('Error deleting old file from R2:', error);
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
                <span className="text-sm font-medium text-gray-700">{mt("addPhoto")}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{mt("jpgPngWebpMaxSize")}</p>
              </div>
            </>
          )}
        </label>
      </div>
    </div>
  );
}

export default function KitchensManagement({ location, onNavigate, onConfigureRequirements }: KitchensManagementProps) {
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [kitchenDescriptions, setKitchenDescriptions] = useState<Record<number, string>>({});
  const [updatingKitchenId, setUpdatingKitchenId] = useState<number | null>(null);
  const [showCreateKitchen, setShowCreateKitchen] = useState(false);
  const [newKitchenName, setNewKitchenName] = useState('');
  const [newKitchenDescription, setNewKitchenDescription] = useState('');
  const [newKitchenImageUrl, setNewKitchenImageUrl] = useState('');
  const [newKitchenHourlyRate, setNewKitchenHourlyRate] = useState('');
  const [newKitchenMinimumHours, setNewKitchenMinimumHours] = useState('1');
  const [isCreatingKitchen, setIsCreatingKitchen] = useState(false);
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(null);
  const [minimumBookingHours, setMinimumBookingHours] = useState<Record<number, number>>({});
  const [savingMinimumKitchenId, setSavingMinimumKitchenId] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<KitchenSection>(getInitialKitchenSection);

  const { data: kitchens = [], isLoading: isLoadingKitchens } = useQuery<Kitchen[]>({
    queryKey: ['managerKitchens', location.id],
    queryFn: async () => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error(tt("firebaseUserNotAvailable"));
      }

      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch(`/api/manager/kitchens/${location.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: "include",
      });
      if (!response.ok) throw new Error(tt('failedToFetchKitchens'));
      return response.json();
    },
    enabled: !!location.id,
  });
  const activeKitchenId = selectedKitchenId ?? kitchens[0]?.id ?? null;

  useEffect(() => {
    if (kitchens.length > 0) {
      const descriptions: Record<number, string> = {};
      const minimums: Record<number, number> = {};
      kitchens.forEach((kitchen) => {
        descriptions[kitchen.id] = kitchen.description || '';
        minimums[kitchen.id] = kitchen.minimumBookingHours ?? 0;
      });
      setKitchenDescriptions(descriptions);
      setMinimumBookingHours(minimums);
      setSelectedKitchenId((current) => kitchens.some((kitchen) => kitchen.id === current) ? current : kitchens[0].id);
    }
  }, [kitchens]);

  const handleSectionChange = (section: string) => {
    const nextSection = section as KitchenSection;
    setActiveSection(nextSection);
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'kitchens');
    if (nextSection === 'photos') url.searchParams.delete('section');
    else url.searchParams.set('section', nextSection);
    window.history.replaceState({}, '', url);
  };

  useEffect(() => {
    const syncSectionFromUrl = () => setActiveSection(kitchenSectionFromParams(new URLSearchParams(window.location.search)));
    window.addEventListener('popstate', syncSectionFromUrl);
    return () => window.removeEventListener('popstate', syncSectionFromUrl);
  }, []);

  const handleKitchenDescriptionUpdate = async (kitchenId: number, description: string) => {
    setUpdatingKitchenId(kitchenId);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error(tt("firebaseUserNotAvailable"));
      }

      const token = await currentFirebaseUser.getIdToken();

      const updateResponse = await fetch(`/api/manager/kitchens/${kitchenId}/details`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ description }),
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update kitchen description');
      }

      queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });

      toast({ title: mt("success"),
        description: mt("kitchenDescriptionUpdatedSuccessfully"),
      });
    } catch (error: any) {
      logger.error('Kitchen description update error:', error);
      toast({ title: mt("error"),
        description: error.message || tt("failedToUpdateKitchenDescription"),
        variant: "destructive",
      });
    } finally {
      setUpdatingKitchenId(null);
    }
  };

  const handleMinimumBookingHoursUpdate = async (kitchen: Kitchen) => {
    const value = minimumBookingHours[kitchen.id] ?? 0;
    setSavingMinimumKitchenId(kitchen.id);
    try {
      await apiPut(`/manager/kitchens/${kitchen.id}/pricing`, { minimumBookingHours: value });
      await queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
      toast({ title: mt("success"), description: mt("minimumBookingDurationUpdated") });
    } catch (error: any) {
      toast({ title: mt("error"), description: error.message || tt("failedToUpdateGeneric"), variant: "destructive" });
    } finally {
      setSavingMinimumKitchenId(null);
    }
  };

  const handleCreateKitchen = async () => {
    if (!newKitchenName.trim() || !newKitchenDescription.trim() || !newKitchenImageUrl || !newKitchenHourlyRate) {
      toast({ title: mt("nameRequired"),
        description: "Complete the name, description, cover photo, and price.",
        variant: "destructive",
      });
      return;
    }

    setIsCreatingKitchen(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error(tt("firebaseUserNotAvailable"));
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
          description: newKitchenDescription.trim(),
          imageUrl: newKitchenImageUrl,
          hourlyRate: Math.round(parseFloat(newKitchenHourlyRate) * 100),
          currency: "CAD",
          minimumBookingHours: parseInt(newKitchenMinimumHours, 10) || 1,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create kitchen');
      }

      queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
      // Also refresh the all-kitchens cache used by ManagerPageLayout (Availability page sidebar)
      queryClient.invalidateQueries({ queryKey: ["/api/manager/all-kitchens"] });

      toast({ title: mt("success"),
        description: mt("kitchenCreatedSuccessfully"),
      });

      setNewKitchenName('');
      setNewKitchenDescription('');
      setNewKitchenImageUrl('');
      setNewKitchenHourlyRate('');
      setNewKitchenMinimumHours('1');
      setShowCreateKitchen(false);
    } catch (error: any) {
      logger.error('Kitchen creation error:', error);
      toast({ title: mt("error"),
        description: error.message || tt("failedToCreateKitchen"),
        variant: "destructive",
      });
    } finally {
      setIsCreatingKitchen(false);
    }
  };

  const handleDeleteKitchen = async (kitchenId: number) => {
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) throw new Error(tt("notAuthenticated"));
      
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch(`/api/manager/kitchens/${kitchenId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) throw new Error(tt("failedToDeleteKitchen"));
      
      queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
      // Also refresh the all-kitchens cache used by ManagerPageLayout (Availability page sidebar)
      queryClient.invalidateQueries({ queryKey: ["/api/manager/all-kitchens"] });
      toast({ title: mt("kitchenDeleted"), description: mt("kitchenHasBeenSuccessfullyRemoved") });
    } catch (e: any) {
      toast({ title: mt("error"), description: e.message, variant: "destructive" });
    }
  };

  const handleKitchenImageUpdate = async (kitchenId: number, imageUrl: string | null) => {
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error(tt("firebaseUserNotAvailable"));
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

      toast({ title: mt("success"),
        description: imageUrl ? mt("kitchenImageUpdatedSuccessfully") : mt("kitchenImageRemoved"),
      });
    } catch (error: any) {
      logger.error('Kitchen image update error:', error);
      toast({ title: mt("error"),
        description: error.message || tt("failedToUpdateKitchenImage"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <ChefPageHeader
        title={mt("navKitchens")}
        description={mt("managePhotosForLocation", { name: location.name })}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onConfigureRequirements}>
              <ClipboardCheck className="mr-1.5 h-4 w-4" />{mt("navApplicationRequirements")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => onNavigate('availability')}>
              <Clock className="mr-1.5 h-4 w-4" />{mt("navAvailability")}
            </Button>
            <Button onClick={() => setShowCreateKitchen(true)} size="sm">
              <Plus className="mr-1.5 h-4 w-4" />{mt("addKitchen")}
            </Button>
          </div>
        }
      />

      <Dialog open={showCreateKitchen} onOpenChange={setShowCreateKitchen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mt("newKitchen")}</DialogTitle>
            <DialogDescription>Add the essentials chefs need to understand and book this space.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="kitchen-name">{mt("kitchenName")} *</Label>
              <Input
                id="kitchen-name"
                value={newKitchenName}
                onChange={(e) => setNewKitchenName(e.target.value)}
                placeholder={mt("eGMainKitchenPrepKitchen")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kitchen-desc">{mt("description")} *</Label>
              <Textarea
                id="kitchen-desc"
                value={newKitchenDescription}
                onChange={(e) => setNewKitchenDescription(e.target.value)}
                placeholder={mt("placeholderKitchenDescription")}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Cover photo *</Label>
              <ImageWithReplace imageUrl={newKitchenImageUrl || undefined} onImageChange={(url) => setNewKitchenImageUrl(url || '')} onRemove={() => setNewKitchenImageUrl('')} fieldName="new-kitchen-cover" aspectRatio="16/9" className="h-48 rounded-lg object-cover" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="kitchen-rate">Hourly rate (CAD) *</Label><Input id="kitchen-rate" type="number" min="0" step="0.01" value={newKitchenHourlyRate} onChange={(event) => setNewKitchenHourlyRate(event.target.value)} placeholder="25.00" /></div>
              <div className="space-y-2"><Label htmlFor="kitchen-minimum">Minimum booking (hours)</Label><Input id="kitchen-minimum" type="number" min="1" max="24" step="1" value={newKitchenMinimumHours} onChange={(event) => setNewKitchenMinimumHours(event.target.value)} /></div>
            </div>
            <div className="flex gap-2 pt-1">
              <StatusButton
                onClick={handleCreateKitchen}
                status={isCreatingKitchen ? "loading" : "idle"}
                disabled={!newKitchenName.trim() || !newKitchenDescription.trim() || !newKitchenImageUrl || !newKitchenHourlyRate}
                labels={{ idle: mt("createKitchen"), loading: mt("creating"), success: mt("created") }}
              />
              <Button variant="ghost" onClick={() => setShowCreateKitchen(false)}>{mt("cancel")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Kitchen List */}
      {isLoadingKitchens ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : kitchens.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Storefront className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1">{mt("noKitchensYet")}</h3>
            <p className="text-sm text-muted-foreground text-center mb-6 max-w-sm">{mt("addYourFirstKitchenToStartManagingPhotosDescriptionsAndAccep")}</p>
            <Button onClick={() => setShowCreateKitchen(true)} size="sm">
              <Plus className="mr-1.5 h-4 w-4" />{mt("addYourFirstKitchen")}</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {kitchens.length > 1 && (
            <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1" aria-label={mt("navKitchens")}>
              {kitchens.map((kitchen) => (
                <Button key={kitchen.id} size="sm" variant="ghost" onClick={() => setSelectedKitchenId(kitchen.id)} className={cn("shrink-0 rounded-lg", activeKitchenId === kitchen.id && "bg-background text-foreground shadow-sm hover:bg-background")}>
                  {kitchen.name}
                </Button>
              ))}
            </div>
          )}
          <Tabs value={activeSection} onValueChange={handleSectionChange}>
            <TabsList className="mb-6 grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-muted-foreground sm:grid-cols-4">
              <TabsTrigger value="photos" className="rounded-lg px-4 py-2.5 data-[state=active]:bg-background">
                <Images className="mr-2 h-4 w-4" />{mt("photos")}
              </TabsTrigger>
              <TabsTrigger value="details" className="rounded-lg px-4 py-2.5 data-[state=active]:bg-background">
                <Storefront className="mr-2 h-4 w-4" />{mt("details")} &amp; {mt("navPricing")}
              </TabsTrigger>
              <TabsTrigger value="storage" className="rounded-lg px-4 py-2.5 data-[state=active]:bg-background">
                <Package className="mr-2 h-4 w-4" />{mt("navStorage")}
              </TabsTrigger>
              <TabsTrigger value="equipment" className="rounded-lg px-4 py-2.5 data-[state=active]:bg-background">
                <Wrench className="mr-2 h-4 w-4" />{mt("navEquipment")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="photos" className="mt-0">
              {kitchens.filter((kitchen) => kitchen.id === activeKitchenId).map((kitchen) => (
                <Card key={kitchen.id}>
                  <CardHeader>
                    <CardTitle>{mt("photos")}</CardTitle>
                    <p className="text-sm text-muted-foreground">Choose a clear cover photo, then add more angles to the gallery.</p>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <Label>Cover photo</Label>
                      <p className="text-xs text-muted-foreground">Shown first in search results and on your kitchen page.</p>
                      <ImageWithReplace imageUrl={kitchen.imageUrl || undefined} onImageChange={(url) => handleKitchenImageUpdate(kitchen.id, url || null)} onRemove={() => handleKitchenImageUpdate(kitchen.id, null)} alt={kitchen.name} className="h-56 object-cover" containerClassName="max-w-xl" aspectRatio="16/9" fieldName="kitchenImage" />
                    </div>
                    <Separator />
                    <div className="space-y-3">
                      <div className="flex items-center justify-between"><Label>{mt("gallery")}</Label><span className="text-xs text-muted-foreground">{(kitchen.galleryImages || []).length} photos</span></div>
                      <KitchenGalleryImages kitchenId={kitchen.id} galleryImages={kitchen.galleryImages || []} locationId={location.id} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="details" className="mt-0">
              {kitchens.filter((kitchen) => kitchen.id === activeKitchenId).map((kitchen) => (
                <Card key={kitchen.id} className="overflow-hidden">
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
                        aria-label={mt("deleteKitchen")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{mt("areYouAbsolutelySure")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete the kitchen &ldquo;{kitchen.name}&rdquo; and all associated bookings, availability settings, and custom overrides. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{mt("cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => handleDeleteKitchen(kitchen.id)}
                        >{mt("deleteKitchen")}</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {/* Description Section */}
                <div className="px-5 py-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{mt("description")}</Label>
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
                    placeholder={mt("placeholderKitchenDescriptionLong")}
                    className="mt-2 resize-none"
                    rows={3}
                    disabled={updatingKitchenId === kitchen.id}
                  />
                  {updatingKitchenId === kitchen.id && (
                    <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />{mt("savingChanges")}</p>
                  )}
                </div>

                {/*
                  Smart Door Lock section is gated by the admin-controlled
                  `smartLockAvailable` flag. When the admin has not enabled the
                  capability for this kitchen, the entire section is hidden —
                  managers will not see the toggle, provider config, or any
                  related UI anywhere in this screen.
                */}
                {kitchen.smartLockAvailable && (
                  <>
                    <Separator />
                    <div className="px-5 py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted/40">
                            <KeyRound className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <Label className="text-sm font-medium">{mt("smartDoorLock")}</Label>
                            <p className="text-xs text-muted-foreground">{mt("enableIfThisKitchenHasAKeypadOrSmartLockYouCanSetAccessCodes")}</p>
                          </div>
                        </div>
                        <button
                          role="switch"
                          aria-checked={kitchen.smartLockEnabled || false}
                          onClick={async () => {
                            const newVal = !kitchen.smartLockEnabled;
                            try {
                              const currentFirebaseUser = auth.currentUser;
                              if (!currentFirebaseUser) throw new Error(tt("notAuthenticated"));
                              const token = await currentFirebaseUser.getIdToken();
                              const response = await fetch(`/api/manager/kitchens/${kitchen.id}/details`, {
                                method: 'PUT',
                                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ smartLockEnabled: newVal })
                              });
                              if (!response.ok) throw new Error(tt('failedToUpdateGeneric'));
                              queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
                              toast({ title: newVal ? mt("smartLockEnabledToast") : mt("smartLockDisabledToast") });
                            } catch (e: any) {
                              logger.error('Smart lock toggle error:', e);
                              toast({ title: mt("failedToUpdate"), variant: "destructive" });
                            }
                          }}
                          className={cn(
                            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                            kitchen.smartLockEnabled ? "bg-blue-600" : "bg-gray-200"
                          )}
                        >
                          <span className={cn(
                            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow",
                            kitchen.smartLockEnabled ? "translate-x-6" : "translate-x-1"
                          )} />
                        </button>
                      </div>

                      {/*
                        When smart lock is enabled, the manager configures
                        the static access code + format + visibility via the
                        "Smart Lock & Access Codes" section on the Check-In /
                        Out settings page. No provider/API credentials here.
                      */}
                      {kitchen.smartLockEnabled && (
                        <p className="text-xs text-muted-foreground pl-11">
                          {mt("configureAccessCodeInCheckinSettings", { section: mt("navCheckinCheckout") })}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
                </Card>
              ))}
              <div className="mt-5">
                {kitchens.filter((kitchen) => kitchen.id === activeKitchenId).map((kitchen) => (
                  <Card key={`minimum-${kitchen.id}`} className="mb-5">
                    <CardHeader className="p-4 pb-3">
                      <CardTitle className="text-lg">{mt("minimumBookingDuration")}</CardTitle>
                      <p className="text-sm text-muted-foreground">{mt("setTheMinimumHoursRequiredPerBookingForEachKitchen")}</p>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                        <div className="w-full max-w-xs">
                          <Label htmlFor={`min-booking-duration-${kitchen.id}`}>{mt("minimumHoursPerBooking")}</Label>
                          <Input
                            id={`min-booking-duration-${kitchen.id}`}
                            type="number"
                            min="0"
                            max="24"
                            step="1"
                            value={minimumBookingHours[kitchen.id] ?? 0}
                            onChange={(event) => {
                              const parsed = parseInt(event.target.value, 10);
                              setMinimumBookingHours((current) => ({
                                ...current,
                                [kitchen.id]: Number.isNaN(parsed) ? 0 : Math.min(24, Math.max(0, parsed)),
                              }));
                            }}
                            className="mt-1.5"
                          />
                          <p className="mt-1 text-xs text-muted-foreground">0 = no restriction, maximum 24 hours.</p>
                        </div>
                        <StatusButton
                          status={savingMinimumKitchenId === kitchen.id ? "loading" : "idle"}
                          onClick={() => handleMinimumBookingHoursUpdate(kitchen)}
                          disabled={(minimumBookingHours[kitchen.id] ?? 0) === (kitchen.minimumBookingHours ?? 0)}
                          labels={{ idle: mt("saveDuration"), loading: mt("savingShort"), success: mt("saved") }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}
                <KitchenPricingContent selectedLocationId={location.id} selectedKitchenId={activeKitchenId} />
              </div>
            </TabsContent>

            <TabsContent value="equipment" className="mt-0">
              <EquipmentListingContent selectedLocationId={location.id} selectedKitchenId={activeKitchenId} />
            </TabsContent>

            <TabsContent value="storage" className="mt-0">
              <StorageListingContent selectedLocationId={location.id} selectedKitchenId={activeKitchenId} />
            </TabsContent>

          </Tabs>
        </div>
      )}
    </div>
  );
}
