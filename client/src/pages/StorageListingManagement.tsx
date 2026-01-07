import { Package, Save, Loader2, Plus, X, ChevronRight, ChevronLeft, Info, AlertCircle, Check, Upload, Image as ImageIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useManagerDashboard } from "../hooks/use-manager-dashboard";
import { useToast } from "@/hooks/use-toast";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Kitchen {
  id: number;
  name: string;
  description?: string;
  locationId: number;
}

interface StorageListing {
  id?: number;
  kitchenId: number;
  storageType: 'dry' | 'cold' | 'freezer';
  name: string;
  description?: string;
  // SIMPLIFIED: Daily rate pricing
  basePrice: number; // Daily rate in dollars
  minimumBookingDuration: number; // Minimum days required
  // Legacy fields - kept for backwards compatibility
  pricePerCubicFoot?: number;
  pricingModel?: 'monthly-flat' | 'per-cubic-foot' | 'hourly' | 'daily';
  bookingDurationUnit?: 'hourly' | 'daily' | 'monthly';
  currency: string; // Always CAD
  dimensionsLength?: number;
  dimensionsWidth?: number;
  dimensionsHeight?: number;
  totalVolume?: number;
  shelfCount?: number;
  shelfMaterial?: string;
  accessType?: string;
  temperatureRange?: string;
  climateControl?: boolean;
  humidityControl?: boolean;
  powerOutlets?: number;
  features?: string[];
  securityFeatures?: string[];
  certifications?: string[];
  photos?: string[];
  documents?: string[];
  houseRules?: string[];
  prohibitedItems?: string[];
  insuranceRequired?: boolean;
  isActive?: boolean; // Active status toggle
}

interface StorageListingManagementProps {
  embedded?: boolean;
}

// Photo Upload Component
function StoragePhotoUpload({ photos, onPhotosChange }: { photos: string[]; onPhotosChange: (photos: string[]) => void }) {
  const { toast } = useToast();
  const { uploadFile, isUploading, uploadProgress } = useSessionFileUpload({
    maxSize: 4.5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    onSuccess: (response) => {
      onPhotosChange([...photos, response.url]);
      toast({
        title: "Photo uploaded",
        description: "Photo has been added to your listing.",
      });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error,
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadFile(file);
      e.target.value = ''; // Reset input
    }
  };

  const removePhoto = (index: number) => {
    onPhotosChange(photos.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {/* Existing Photos */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {photos.map((photo, index) => (
            <div key={index} className="relative group">
              <img
                src={photo}
                alt={`Storage photo ${index + 1}`}
                className="w-full h-32 object-cover rounded-lg border border-gray-200"
              />
              <button
                type="button"
                onClick={() => removePhoto(index)}
                className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload Area */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-gray-400 transition-colors">
        <input
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          onChange={handleFileSelect}
          className="hidden"
          id="storage-photo-upload"
          disabled={isUploading}
        />
        <label
          htmlFor="storage-photo-upload"
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
              <span className="text-sm font-medium text-gray-700">Click to upload photos</span>
              <span className="text-xs text-gray-500 mt-1">JPG, PNG, WebP (max 4.5MB)</span>
            </>
          )}
        </label>
      </div>
    </div>
  );
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  try {
    const { auth } = await import('@/lib/firebase');
    const currentUser = auth.currentUser;
    
    if (currentUser?.uid) {
      // Include X-User-ID header as fallback
      headers['X-User-ID'] = currentUser.uid;
      
      // Get fresh Firebase token
      try {
        const token = await currentUser.getIdToken();
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      } catch (tokenError) {
        console.error('Failed to get Firebase token:', tokenError);
      }
    } else {
      // Fallback to localStorage if Firebase auth not ready
      const storedUserId = localStorage.getItem('userId');
      const storedToken = localStorage.getItem('firebaseToken');
      
      if (storedUserId) {
        headers['X-User-ID'] = storedUserId;
      }
      
      if (storedToken) {
        headers['Authorization'] = `Bearer ${storedToken}`;
      }
    }
  } catch (error) {
    console.error('Error getting auth headers:', error);
    // Fallback to localStorage
    const storedUserId = localStorage.getItem('userId');
    const storedToken = localStorage.getItem('firebaseToken');
    
    if (storedUserId) {
      headers['X-User-ID'] = storedUserId;
    }
    
    if (storedToken) {
      headers['Authorization'] = `Bearer ${storedToken}`;
    }
  }
  
  return headers;
}

export default function StorageListingManagement({ embedded = false }: StorageListingManagementProps = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, isLoadingLocations } = useManagerDashboard();
  
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(null);
  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 4;
  
  // Form state - simplified to daily pricing
  const [formData, setFormData] = useState<Partial<StorageListing>>({
    storageType: 'dry',
    basePrice: 0, // Daily rate in dollars
    minimumBookingDuration: 1, // Minimum days
    currency: 'CAD', // Always CAD
    climateControl: false,
    humidityControl: false,
    powerOutlets: 0,
    insuranceRequired: false,
    features: [],
    securityFeatures: [],
    certifications: [],
    photos: [],
    documents: [],
    houseRules: [],
    prohibitedItems: [],
  });
  
  const [isSaving, setIsSaving] = useState(false);
  const [editingListingId, setEditingListingId] = useState<number | null>(null);
  const [listings, setListings] = useState<StorageListing[]>([]);
  const [toggleDialogOpen, setToggleDialogOpen] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<{ id: number; isActive: boolean } | null>(null);

  // Auto-select location if only one exists
  useEffect(() => {
    if (!isLoadingLocations && locations.length === 1 && !selectedLocationId) {
      setSelectedLocationId(locations[0].id);
    }
  }, [locations, isLoadingLocations, selectedLocationId]);

  // Load kitchens when location is selected
  useEffect(() => {
    if (selectedLocationId) {
      loadKitchens();
    } else {
      setKitchens([]);
      setSelectedKitchenId(null);
    }
  }, [selectedLocationId]);

  // Load listings when kitchen is selected
  useEffect(() => {
    if (selectedKitchenId) {
      loadListings();
    } else {
      setListings([]);
    }
  }, [selectedKitchenId]);

  const loadKitchens = async () => {
    if (!selectedLocationId) return;
    
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/kitchens/${selectedLocationId}`, {
        headers,
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error('Failed to load kitchens');
      }
      
      const data = await response.json();
      setKitchens(data);
      
      if (data.length === 1 && !selectedKitchenId) {
        setSelectedKitchenId(data[0].id);
      }
    } catch (error: any) {
      console.error('Error loading kitchens:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to load kitchens",
        variant: "destructive",
      });
    }
  };

  const loadListings = async () => {
    if (!selectedKitchenId) return;
    
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/kitchens/${selectedKitchenId}/storage-listings`, {
        headers,
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error('Failed to load storage listings');
      }
      
      const data = await response.json();
      setListings(data);
    } catch (error: any) {
      console.error('Error loading storage listings:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to load storage listings",
        variant: "destructive",
      });
    }
  };

  const handleEdit = async (listingId: number) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/storage-listings/${listingId}`, {
        headers,
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error('Failed to load listing');
      }
      
      const data = await response.json();
      setFormData(data);
      setEditingListingId(listingId);
      setCurrentStep(1);
      setSelectedKitchenId(data.kitchenId);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load listing",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (listingId: number) => {
    if (!confirm('Are you sure you want to delete this storage listing?')) {
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/storage-listings/${listingId}`, {
        method: 'DELETE',
        headers,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error('Failed to delete listing');
      }

      toast({
        title: "Success",
        description: "Storage listing deleted successfully",
      });

      loadListings();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete listing",
        variant: "destructive",
      });
    }
  };

  const saveListing = async () => {
    if (!selectedKitchenId) {
      toast({
        title: "Error",
        description: "Please select a kitchen first",
        variant: "destructive",
      });
      return;
    }

    // Validation - simplified to daily rate pricing
    if (!formData.name || !formData.storageType || !formData.basePrice || formData.basePrice <= 0) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields (name, storage type, daily rate)",
        variant: "destructive",
      });
      return;
    }
    
    if (!formData.minimumBookingDuration || formData.minimumBookingDuration < 1) {
      toast({
        title: "Validation Error", 
        description: "Minimum rental period must be at least 1 day",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const headers = await getAuthHeaders();
      const url = editingListingId 
        ? `/api/manager/storage-listings/${editingListingId}`
        : '/api/manager/storage-listings';
      
      const method = editingListingId ? 'PUT' : 'POST';
      // Build payload with daily rate pricing model
      const payload = {
        kitchenId: selectedKitchenId,
        ...formData,
        // Set daily pricing model for backend compatibility
        pricingModel: 'daily',
        bookingDurationUnit: 'daily',
      };

      const response = await fetch(url, {
        method,
        headers,
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to save listing' }));
        throw new Error(errorData.error || 'Failed to save listing');
      }

      const saved = await response.json();
      
      toast({
        title: "Success",
        description: editingListingId ? "Storage listing updated successfully" : "Storage listing created successfully",
      });

      // Reset form
      setFormData({
        storageType: 'dry',
        basePrice: 0,
        minimumBookingDuration: 1,
        currency: 'CAD',
        climateControl: false,
        humidityControl: false,
        powerOutlets: 0,
        insuranceRequired: false,
        features: [],
        securityFeatures: [],
        certifications: [],
        photos: [],
        documents: [],
        houseRules: [],
        prohibitedItems: [],
      });
      setEditingListingId(null);
      setCurrentStep(1);
      
      loadListings();
      queryClient.invalidateQueries({ queryKey: [`/api/manager/kitchens/${selectedKitchenId}/storage-listings`] });
    } catch (error: any) {
      console.error('Error saving storage listing:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save storage listing",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const addArrayItem = (field: keyof StorageListing, value: string) => {
    if (!value.trim()) return;
    const current = (formData[field] as string[]) || [];
    setFormData({ ...formData, [field]: [...current, value.trim()] });
  };

  const removeArrayItem = (field: keyof StorageListing, index: number) => {
    const current = (formData[field] as string[]) || [];
    setFormData({ ...formData, [field]: current.filter((_, i) => i !== index) });
  };

  // Toggle active status mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/storage-listings/${id}`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify({ isActive }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to update status' }));
        throw new Error(errorData.error || 'Failed to update status');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/manager/kitchens/${selectedKitchenId}/storage-listings`] });
      loadListings(); // Reload listings to get updated status
      toast({
        title: "Status Updated",
        description: `Storage listing is now ${pendingToggle?.isActive ? 'active' : 'inactive'}`,
      });
      setToggleDialogOpen(false);
      setPendingToggle(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
      setToggleDialogOpen(false);
      setPendingToggle(null);
    },
  });

  const handleToggleActive = (listingId: number, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    
    // If deactivating, show confirmation dialog
    if (!newStatus) {
      setPendingToggle({ id: listingId, isActive: newStatus });
      setToggleDialogOpen(true);
    } else {
      // Activating - proceed immediately
      toggleActiveMutation.mutate({ id: listingId, isActive: newStatus });
    }
  };

  const confirmToggle = () => {
    if (pendingToggle) {
      toggleActiveMutation.mutate(pendingToggle);
    }
  };

  const selectedKitchen = kitchens.find(k => k.id === selectedKitchenId);

  return (
    <div className="space-y-6">
      {/* Location & Kitchen Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Location & Kitchen</CardTitle>
          <CardDescription>Choose a location and kitchen to manage storage listings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="location">Location</Label>
            {isLoadingLocations ? (
              <div className="text-sm text-gray-500 mt-2">Loading locations...</div>
            ) : locations.length === 0 ? (
              <div className="text-sm text-gray-500 mt-2">No locations available</div>
            ) : locations.length === 1 ? (
              <div className="mt-2 px-3 py-2 text-sm font-medium text-gray-900 bg-gray-50 rounded-lg border border-gray-200">
                {locations[0].name}
              </div>
            ) : (
              <Select
                value={selectedLocationId?.toString() || ""}
                onValueChange={(value) => {
                  setSelectedLocationId(parseInt(value));
                  setSelectedKitchenId(null);
                }}
              >
                <SelectTrigger id="location" className="mt-2">
                  <SelectValue placeholder="Choose location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={loc.id.toString()}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {selectedLocationId && (
            <div>
              <Label htmlFor="kitchen">Kitchen</Label>
              {kitchens.length === 0 ? (
                <div className="text-sm text-gray-500 mt-2">Loading kitchens...</div>
              ) : (
                <Select
                  value={selectedKitchenId?.toString() || ""}
                  onValueChange={(value) => setSelectedKitchenId(parseInt(value))}
                >
                  <SelectTrigger id="kitchen" className="mt-2">
                    <SelectValue placeholder="Choose kitchen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {kitchens.map((kitchen) => (
                      <SelectItem key={kitchen.id} value={kitchen.id.toString()}>
                        {kitchen.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Existing Listings */}
      {selectedKitchenId && listings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Existing Storage Listings</CardTitle>
            <CardDescription>Manage your existing storage listings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {listings.map((listing) => (
                <div key={listing.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium">{listing.name}</h4>
                      <Badge 
                        variant={listing.isActive !== false ? "default" : "secondary"}
                        className={listing.isActive !== false 
                          ? "bg-green-100 text-green-700 border-green-300" 
                          : "bg-gray-100 text-gray-600 border-gray-300"
                        }
                      >
                        {listing.isActive !== false ? '✓ Active' : '✗ Inactive'}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-500">
                      {listing.storageType} • ${listing.basePrice?.toFixed(2)}/day • Min: {listing.minimumBookingDuration || 1} days
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`toggle-${listing.id}`} className="text-sm text-gray-600">
                        {listing.isActive !== false ? 'Active' : 'Inactive'}
                      </Label>
                      <Switch
                        id={`toggle-${listing.id}`}
                        checked={listing.isActive !== false}
                        onCheckedChange={() => handleToggleActive(listing.id!, listing.isActive !== false)}
                        disabled={toggleActiveMutation.isPending}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleEdit(listing.id!)}>
                        Edit
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(listing.id!)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Form */}
      {selectedKitchenId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {editingListingId ? 'Edit Storage Listing' : 'Create New Storage Listing'}
            </CardTitle>
            <CardDescription>
              {selectedKitchen && `For ${selectedKitchen.name}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Step Indicator */}
            <div className="flex items-center justify-between mb-6">
              {[1, 2, 3, 4].map((step) => (
                <div key={step} className="flex items-center flex-1">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-full ${
                    step === currentStep ? 'bg-rose-500 text-white' :
                    step < currentStep ? 'bg-green-500 text-white' :
                    'bg-gray-200 text-gray-600'
                  }`}>
                    {step < currentStep ? <Check className="h-5 w-5" /> : step}
                  </div>
                  {step < totalSteps && (
                    <div className={`flex-1 h-1 mx-2 ${
                      step < currentStep ? 'bg-green-500' : 'bg-gray-200'
                    }`} />
                  )}
                </div>
              ))}
            </div>

            {/* Step 1: Basic Information */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Basic Information</h3>
                
                <div>
                  <Label htmlFor="name">Listing Name *</Label>
                  <Input
                    id="name"
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Walk-in Freezer - 200 sq ft"
                    className="mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description || ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe the storage space..."
                    className="mt-2"
                    rows={4}
                  />
                </div>

                <div>
                  <Label htmlFor="storageType">Storage Type *</Label>
                  <Select
                    value={formData.storageType}
                    onValueChange={(value: 'dry' | 'cold' | 'freezer') => 
                      setFormData({ ...formData, storageType: value })
                    }
                  >
                    <SelectTrigger id="storageType" className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dry">Dry Storage</SelectItem>
                      <SelectItem value="cold">Cold Storage</SelectItem>
                      <SelectItem value="freezer">Freezer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    onClick={() => setCurrentStep(2)}
                    disabled={!formData.name || !formData.storageType}
                    className="bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white"
                  >
                    Next <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Pricing - Simplified Daily Rate */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Pricing</h3>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-2">
                    <Info className="h-5 w-5 text-blue-500 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-blue-800">Simple Daily Pricing</p>
                      <p className="text-sm text-blue-600">
                        Set a daily rate and minimum rental period. Chefs will be charged the same daily rate 
                        whether they book for 7 days or 30 days.
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="basePrice">Daily Rate (CAD) *</Label>
                  <p className="text-sm text-gray-500 mb-2">Amount charged per day of storage rental</p>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-gray-500">$</span>
                    </div>
                    <Input
                      id="basePrice"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.basePrice || ''}
                      onChange={(e) => setFormData({ ...formData, basePrice: parseFloat(e.target.value) || 0 })}
                      placeholder="15.00"
                      className="pl-7 text-lg"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Example: $15/day × 7 days = $105 total
                  </p>
                </div>

                <div>
                  <Label htmlFor="minimumBookingDuration">Minimum Rental Period (Days) *</Label>
                  <p className="text-sm text-gray-500 mb-2">Chefs cannot book for less than this many days</p>
                  <Input
                    id="minimumBookingDuration"
                    type="number"
                    min="1"
                    value={formData.minimumBookingDuration || 1}
                    onChange={(e) => setFormData({ ...formData, minimumBookingDuration: parseInt(e.target.value) || 1 })}
                    className="text-lg"
                    placeholder="7"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Common minimums: 1 day (flexible), 7 days (weekly), 30 days (monthly)
                  </p>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600" />
                    <div className="text-sm text-green-800">
                      <strong>Preview:</strong> ${(formData.basePrice || 0).toFixed(2)}/day with {formData.minimumBookingDuration || 1}-day minimum
                      {formData.minimumBookingDuration && formData.basePrice && (
                        <span className="ml-2 text-green-600">
                          (min booking = ${((formData.basePrice || 0) * (formData.minimumBookingDuration || 1)).toFixed(2)})
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex justify-between gap-3 pt-4">
                  <Button variant="outline" onClick={() => setCurrentStep(1)}>
                    <ChevronLeft className="h-4 w-4 mr-2" /> Previous
                  </Button>
                  <Button
                    onClick={() => setCurrentStep(3)}
                    disabled={!formData.basePrice || formData.basePrice <= 0}
                    className="bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white"
                  >
                    Next <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Specifications */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Physical Specifications</h3>
                
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="dimensionsLength">Length (ft)</Label>
                    <Input
                      id="dimensionsLength"
                      type="number"
                      step="0.1"
                      min="0"
                      value={formData.dimensionsLength || ''}
                      onChange={(e) => setFormData({ ...formData, dimensionsLength: parseFloat(e.target.value) || undefined })}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dimensionsWidth">Width (ft)</Label>
                    <Input
                      id="dimensionsWidth"
                      type="number"
                      step="0.1"
                      min="0"
                      value={formData.dimensionsWidth || ''}
                      onChange={(e) => setFormData({ ...formData, dimensionsWidth: parseFloat(e.target.value) || undefined })}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dimensionsHeight">Height (ft)</Label>
                    <Input
                      id="dimensionsHeight"
                      type="number"
                      step="0.1"
                      min="0"
                      value={formData.dimensionsHeight || ''}
                      onChange={(e) => setFormData({ ...formData, dimensionsHeight: parseFloat(e.target.value) || undefined })}
                      className="mt-2"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="totalVolume">Total Volume (cubic ft)</Label>
                  <Input
                    id="totalVolume"
                    type="number"
                    step="0.1"
                    min="0"
                    value={formData.totalVolume || ''}
                    onChange={(e) => setFormData({ ...formData, totalVolume: parseFloat(e.target.value) || undefined })}
                    className="mt-2"
                    placeholder="Auto-calculated if dimensions provided"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="shelfCount">Shelf Count</Label>
                    <Input
                      id="shelfCount"
                      type="number"
                      min="0"
                      value={formData.shelfCount || ''}
                      onChange={(e) => setFormData({ ...formData, shelfCount: parseInt(e.target.value) || undefined })}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="shelfMaterial">Shelf Material</Label>
                    <Input
                      id="shelfMaterial"
                      value={formData.shelfMaterial || ''}
                      onChange={(e) => setFormData({ ...formData, shelfMaterial: e.target.value })}
                      placeholder="e.g., Stainless steel, Wire"
                      className="mt-2"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="accessType">Access Type</Label>
                  <Select
                    value={formData.accessType || ''}
                    onValueChange={(value) => setFormData({ ...formData, accessType: value })}
                  >
                    <SelectTrigger id="accessType" className="mt-2">
                      <SelectValue placeholder="Select access type..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="walk-in">Walk-in</SelectItem>
                      <SelectItem value="shelving-unit">Shelving Unit</SelectItem>
                      <SelectItem value="rack-system">Rack System</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {(formData.storageType === 'cold' || formData.storageType === 'freezer') && (
                  <>
                    <div>
                      <Label htmlFor="temperatureRange">Temperature Range</Label>
                      <Input
                        id="temperatureRange"
                        value={formData.temperatureRange || ''}
                        onChange={(e) => setFormData({ ...formData, temperatureRange: e.target.value })}
                        placeholder="e.g., 35-40°F"
                        className="mt-2"
                      />
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="climateControl"
                        checked={formData.climateControl || false}
                        onCheckedChange={(checked) => setFormData({ ...formData, climateControl: checked as boolean })}
                      />
                      <Label htmlFor="climateControl" className="cursor-pointer">Climate Controlled</Label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="humidityControl"
                        checked={formData.humidityControl || false}
                        onCheckedChange={(checked) => setFormData({ ...formData, humidityControl: checked as boolean })}
                      />
                      <Label htmlFor="humidityControl" className="cursor-pointer">Humidity Controlled</Label>
                    </div>
                  </>
                )}

                <div>
                  <Label htmlFor="powerOutlets">Power Outlets</Label>
                  <Input
                    id="powerOutlets"
                    type="number"
                    min="0"
                    value={formData.powerOutlets || 0}
                    onChange={(e) => setFormData({ ...formData, powerOutlets: parseInt(e.target.value) || 0 })}
                    className="mt-2"
                  />
                </div>

                <div className="flex justify-between gap-3 pt-4">
                  <Button variant="outline" onClick={() => setCurrentStep(2)}>
                    <ChevronLeft className="h-4 w-4 mr-2" /> Previous
                  </Button>
                  <Button
                    onClick={() => setCurrentStep(4)}
                    className="bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white"
                  >
                    Next <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 4: Additional Details & Save */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Additional Details</h3>
                
                {/* Photos Section */}
                <div>
                  <Label>Photos</Label>
                  <p className="text-sm text-gray-500 mb-2">Upload images of your storage space to help chefs visualize it</p>
                  <StoragePhotoUpload
                    photos={formData.photos || []}
                    onPhotosChange={(photos) => setFormData({ ...formData, photos })}
                  />
                </div>
                
                <div>
                  <Label htmlFor="features">Features</Label>
                  <div className="mt-2 space-y-2">
                    {(formData.features || []).map((feature, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input value={feature} readOnly />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeArrayItem('features', index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Input
                        id="newFeature"
                        placeholder="Add feature..."
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addArrayItem('features', (e.target as HTMLInputElement).value);
                            (e.target as HTMLInputElement).value = '';
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const input = document.getElementById('newFeature') as HTMLInputElement;
                          if (input.value) {
                            addArrayItem('features', input.value);
                            input.value = '';
                          }
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div>
                  <Label htmlFor="securityFeatures">Security Features</Label>
                  <div className="mt-2 space-y-2">
                    {(formData.securityFeatures || []).map((feature, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input value={feature} readOnly />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeArrayItem('securityFeatures', index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Input
                        id="newSecurityFeature"
                        placeholder="Add security feature..."
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addArrayItem('securityFeatures', (e.target as HTMLInputElement).value);
                            (e.target as HTMLInputElement).value = '';
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const input = document.getElementById('newSecurityFeature') as HTMLInputElement;
                          if (input.value) {
                            addArrayItem('securityFeatures', input.value);
                            input.value = '';
                          }
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="insuranceRequired"
                    checked={formData.insuranceRequired || false}
                    onCheckedChange={(checked) => setFormData({ ...formData, insuranceRequired: checked as boolean })}
                  />
                  <Label htmlFor="insuranceRequired" className="cursor-pointer">Insurance Required</Label>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="text-sm font-medium text-blue-900 mb-1">Listing Status</h4>
                      <p className="text-xs text-blue-800">
                        New listings are created as "draft" status. Submit for admin approval to make them active.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between gap-3 pt-4 border-t">
                  <Button variant="outline" onClick={() => setCurrentStep(3)}>
                    <ChevronLeft className="h-4 w-4 mr-2" /> Previous
                  </Button>
                  <Button
                    onClick={saveListing}
                    disabled={isSaving}
                    className="bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        {editingListingId ? 'Update Listing' : 'Create Listing'}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!selectedLocationId && (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
            <p className="text-gray-500">Choose a location to manage storage listings</p>
          </CardContent>
        </Card>
      )}

      {selectedLocationId && !selectedKitchenId && kitchens.length > 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Kitchen</h3>
            <p className="text-gray-500">Choose a kitchen to create storage listings</p>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialog for Deactivation */}
      <Dialog open={toggleDialogOpen} onOpenChange={setToggleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate Storage Listing?</DialogTitle>
            <DialogDescription>
              This storage listing will no longer be available for booking. Chefs will not be able to see or book this storage space.
              <br /><br />
              You can reactivate it at any time using the toggle switch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setToggleDialogOpen(false);
                setPendingToggle(null);
              }}
              disabled={toggleActiveMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmToggle}
              disabled={toggleActiveMutation.isPending}
            >
              {toggleActiveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deactivating...
                </>
              ) : (
                'Deactivate'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


