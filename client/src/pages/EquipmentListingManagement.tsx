import { Wrench, Save, Loader2, Plus, X, ChevronRight, ChevronLeft, Info, AlertCircle, Check } from "lucide-react";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useManagerDashboard } from "../hooks/use-manager-dashboard";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

interface Kitchen {
  id: number;
  name: string;
  description?: string;
  locationId: number;
}

interface EquipmentListing {
  id?: number;
  kitchenId: number;
  category: 'food-prep' | 'cooking' | 'refrigeration' | 'cleaning' | 'specialty';
  equipmentType: string;
  brand?: string;
  model?: string;
  description?: string;
  condition: 'excellent' | 'good' | 'fair' | 'needs-repair';
  age?: number;
  serviceHistory?: string;
  dimensions?: Record<string, any>;
  powerRequirements?: string;
  specifications?: Record<string, any>;
  certifications?: string[];
  safetyFeatures?: string[];
  availabilityType: 'included' | 'rental'; // included (free with kitchen) or rental (paid addon)
  // SIMPLIFIED: Single flat session rate for rental equipment
  sessionRate?: number; // Flat rate per kitchen booking session (in dollars)
  // Legacy fields - kept for backwards compatibility
  pricingModel?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  hourlyRate?: number;
  dailyRate?: number;
  weeklyRate?: number;
  monthlyRate?: number;
  minimumRentalHours?: number;
  minimumRentalDays?: number;
  currency: string; // Always CAD
  usageRestrictions?: string[];
  trainingRequired?: boolean;
  cleaningResponsibility?: 'renter' | 'host' | 'shared';
  prepTimeHours?: number;
  photos?: string[];
  manuals?: string[];
  maintenanceLog?: any[];
  damageDeposit?: number; // Only for rental
  insuranceRequired?: boolean;
  availabilityCalendar?: Record<string, any>;
}

interface EquipmentListingManagementProps {
  embedded?: boolean;
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

export default function EquipmentListingManagement({ embedded = false }: EquipmentListingManagementProps = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, isLoadingLocations } = useManagerDashboard();
  
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(null);
  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 4;
  
  // Form state
  const [formData, setFormData] = useState<Partial<EquipmentListing>>({
    category: 'cooking',
    condition: 'good',
    availabilityType: 'rental', // Default to rental
    sessionRate: 0, // Flat session rate (primary pricing field)
    currency: 'CAD', // Always CAD
    trainingRequired: false,
    prepTimeHours: 4,
    insuranceRequired: false,
    damageDeposit: 0,
    certifications: [],
    safetyFeatures: [],
    usageRestrictions: [],
    photos: [],
    manuals: [],
    maintenanceLog: [],
    dimensions: {},
    specifications: {},
  });
  
  const [isSaving, setIsSaving] = useState(false);
  const [editingListingId, setEditingListingId] = useState<number | null>(null);
  const [listings, setListings] = useState<EquipmentListing[]>([]);

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
      const response = await fetch(`/api/manager/kitchens/${selectedKitchenId}/equipment-listings`, {
        headers,
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error('Failed to load equipment listings');
      }
      
      const data = await response.json();
      setListings(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('Error loading equipment listings:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to load equipment listings",
        variant: "destructive",
      });
    }
  };

  const handleEdit = async (listingId: number) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/equipment-listings/${listingId}`, {
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
    if (!confirm('Are you sure you want to delete this equipment listing?')) {
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/equipment-listings/${listingId}`, {
        method: 'DELETE',
        headers,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error('Failed to delete listing');
      }

      toast({
        title: "Success",
        description: "Equipment listing deleted successfully",
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

    // Validation
    if (!formData.equipmentType || !formData.category || !formData.condition || !formData.availabilityType) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields (equipment type, category, condition, availability type)",
        variant: "destructive",
      });
      return;
    }

    // For rental equipment, validate session rate
    if (formData.availabilityType === 'rental') {
      if (!formData.sessionRate || formData.sessionRate <= 0) {
        toast({
          title: "Validation Error",
          description: "Session rate is required for rental equipment",
          variant: "destructive",
        });
        return;
      }
    }

    setIsSaving(true);
    try {
      const headers = await getAuthHeaders();
      const url = editingListingId 
        ? `/api/manager/equipment-listings/${editingListingId}`
        : '/api/manager/equipment-listings';
      
      const method = editingListingId ? 'PUT' : 'POST';
      const payload = {
        kitchenId: selectedKitchenId,
        ...formData,
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
        description: editingListingId ? "Equipment listing updated successfully" : "Equipment listing created successfully",
      });

      // Reset form
      setFormData({
        category: 'cooking',
        condition: 'good',
        availabilityType: 'rental',
        sessionRate: 0,
        currency: 'CAD',
        trainingRequired: false,
        prepTimeHours: 4,
        insuranceRequired: false,
        damageDeposit: 0,
        certifications: [],
        safetyFeatures: [],
        usageRestrictions: [],
        photos: [],
        manuals: [],
        maintenanceLog: [],
        dimensions: {},
        specifications: {},
      });
      setEditingListingId(null);
      setCurrentStep(1);
      
      loadListings();
      queryClient.invalidateQueries({ queryKey: [`/api/manager/equipment-listings`] });
    } catch (error: any) {
      console.error('Error saving equipment listing:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save equipment listing",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const addArrayItem = (field: keyof EquipmentListing, value: string) => {
    if (!value.trim()) return;
    const current = (formData[field] as string[]) || [];
    setFormData({ ...formData, [field]: [...current, value.trim()] });
  };

  const removeArrayItem = (field: keyof EquipmentListing, index: number) => {
    const current = (formData[field] as string[]) || [];
    setFormData({ ...formData, [field]: current.filter((_, i) => i !== index) });
  };

  const selectedKitchen = kitchens.find(k => k.id === selectedKitchenId);

  return (
    <div className="space-y-6">
      {/* Location & Kitchen Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Location & Kitchen</CardTitle>
          <CardDescription>Choose a location and kitchen to manage equipment listings</CardDescription>
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
            <CardTitle>Existing Equipment Listings</CardTitle>
            <CardDescription>Manage your existing equipment listings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {listings.map((listing) => (
                <div key={listing.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <h4 className="font-medium">{listing.equipmentType}</h4>
                    <p className="text-sm text-gray-500">
                      {listing.category} • {listing.condition} • {
                        listing.availabilityType === 'included' 
                          ? 'Included (Free with kitchen)' 
                          : `$${(listing.sessionRate || 0).toFixed(2)}/session`
                      }
                    </p>
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
              <Wrench className="h-5 w-5" />
              {editingListingId ? 'Edit Equipment Listing' : 'Create New Equipment Listing'}
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

            {/* Step 1: Category & Type */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Category & Type</h3>
                
                <div>
                  <Label htmlFor="availabilityType">Availability Type *</Label>
                  <Select
                    value={formData.availabilityType}
                    onValueChange={(value: 'included' | 'rental') => {
                      const updates: any = { availabilityType: value };
                      // If changing to included, clear pricing fields
                      if (value === 'included') {
                        updates.sessionRate = 0;
                        updates.damageDeposit = 0;
                      } else {
                        // If changing to rental, set defaults
                        updates.sessionRate = updates.sessionRate || 0;
                      }
                      setFormData({ ...formData, ...updates });
                    }}
                  >
                    <SelectTrigger id="availabilityType" className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="included">Included (Free with kitchen booking)</SelectItem>
                      <SelectItem value="rental">Rental (Paid addon during booking)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-1">
                    {formData.availabilityType === 'included' 
                      ? 'This equipment comes free with kitchen bookings - no additional charge'
                      : 'Chefs will pay to rent this equipment when booking the kitchen'}
                  </p>
                </div>

                <div>
                  <Label htmlFor="category">Category *</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value: 'food-prep' | 'cooking' | 'refrigeration' | 'cleaning' | 'specialty') => 
                      setFormData({ ...formData, category: value })
                    }
                  >
                    <SelectTrigger id="category" className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="food-prep">Food Prep</SelectItem>
                      <SelectItem value="cooking">Cooking</SelectItem>
                      <SelectItem value="refrigeration">Refrigeration</SelectItem>
                      <SelectItem value="cleaning">Cleaning</SelectItem>
                      <SelectItem value="specialty">Specialty</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="equipmentType">Equipment Type *</Label>
                  <Input
                    id="equipmentType"
                    value={formData.equipmentType || ''}
                    onChange={(e) => setFormData({ ...formData, equipmentType: e.target.value })}
                    placeholder="e.g., Stand Mixer, Commercial Oven, Walk-in Freezer"
                    className="mt-2"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="brand">Brand</Label>
                    <Input
                      id="brand"
                      value={formData.brand || ''}
                      onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                      placeholder="e.g., KitchenAid, Hobart"
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="model">Model</Label>
                    <Input
                      id="model"
                      value={formData.model || ''}
                      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                      placeholder="e.g., Professional 600"
                      className="mt-2"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description || ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe the equipment, its features, and condition..."
                    className="mt-2"
                    rows={4}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="condition">Condition *</Label>
                    <Select
                      value={formData.condition}
                      onValueChange={(value: 'excellent' | 'good' | 'fair' | 'needs-repair') => 
                        setFormData({ ...formData, condition: value })
                      }
                    >
                      <SelectTrigger id="condition" className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="excellent">Excellent</SelectItem>
                        <SelectItem value="good">Good</SelectItem>
                        <SelectItem value="fair">Fair</SelectItem>
                        <SelectItem value="needs-repair">Needs Repair</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="age">Age (years)</Label>
                    <Input
                      id="age"
                      type="number"
                      min="0"
                      value={formData.age || ''}
                      onChange={(e) => setFormData({ ...formData, age: parseInt(e.target.value) || undefined })}
                      placeholder="e.g., 5"
                      className="mt-2"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    onClick={() => {
                      // Skip pricing step if included equipment
                      if (formData.availabilityType === 'included') {
                        setCurrentStep(3);
                      } else {
                        setCurrentStep(2);
                      }
                    }}
                    disabled={!formData.equipmentType || !formData.category || !formData.condition || !formData.availabilityType}
                    className="bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white"
                  >
                    Next <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Pricing Configuration (Only for Rental Equipment) */}
            {currentStep === 2 && formData.availabilityType === 'rental' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Pricing Configuration</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Set a flat session rate for this equipment. Chefs pay this amount once per kitchen booking, regardless of booking duration.
                </p>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-2">
                    <Info className="h-5 w-5 text-blue-500 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-blue-800">Flat Session Pricing</p>
                      <p className="text-sm text-blue-600">
                        Equipment is charged as a one-time fee per kitchen booking session. 
                        For example, if a chef books the kitchen for 2 hours or 8 hours, they pay the same equipment fee.
                      </p>
                    </div>
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="sessionRate">Session Rate (CAD) *</Label>
                  <p className="text-sm text-gray-500 mb-2">Flat fee charged per kitchen booking session</p>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-gray-500">$</span>
                    </div>
                    <Input
                      id="sessionRate"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.sessionRate || ''}
                      onChange={(e) => setFormData({ ...formData, sessionRate: parseFloat(e.target.value) || 0 })}
                      placeholder="25.00"
                      className="pl-7 text-lg"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="damageDeposit">Damage Deposit (CAD)</Label>
                  <p className="text-sm text-gray-500 mb-2">Refundable deposit to cover potential damage (optional)</p>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-gray-500">$</span>
                    </div>
                    <Input
                      id="damageDeposit"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.damageDeposit || ''}
                      onChange={(e) => setFormData({ ...formData, damageDeposit: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                </div>

                <div className="flex justify-between gap-3 pt-4">
                  <Button variant="outline" onClick={() => setCurrentStep(1)}>
                    <ChevronLeft className="h-4 w-4 mr-2" /> Previous
                  </Button>
                  <Button
                    onClick={() => setCurrentStep(3)}
                    disabled={!formData.sessionRate || formData.sessionRate <= 0}
                    className="bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white"
                  >
                    Next <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2 fallback: If on step 2 but equipment is 'included', skip to step 3 */}
            {currentStep === 2 && formData.availabilityType === 'included' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Included Equipment - No Pricing Required</h3>
                <p className="text-sm text-gray-600">
                  This equipment is included with the kitchen booking at no extra charge.
                </p>
                <div className="flex justify-between gap-3 pt-4">
                  <Button variant="outline" onClick={() => setCurrentStep(1)}>
                    <ChevronLeft className="h-4 w-4 mr-2" /> Previous
                  </Button>
                  <Button
                    onClick={() => setCurrentStep(3)}
                    className="bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white"
                  >
                    Next <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Specifications & Features */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Specifications & Features</h3>
                
                <div>
                  <Label htmlFor="powerRequirements">Power Requirements</Label>
                  <Input
                    id="powerRequirements"
                    value={formData.powerRequirements || ''}
                    onChange={(e) => setFormData({ ...formData, powerRequirements: e.target.value })}
                    placeholder="e.g., 110V, 208V, 240V, 3-phase"
                    className="mt-2"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="dimWidth">Width (inches)</Label>
                    <Input
                      id="dimWidth"
                      type="number"
                      step="0.1"
                      value={formData.dimensions?.width || ''}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        dimensions: { ...formData.dimensions, width: parseFloat(e.target.value) || undefined }
                      })}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dimDepth">Depth (inches)</Label>
                    <Input
                      id="dimDepth"
                      type="number"
                      step="0.1"
                      value={formData.dimensions?.depth || ''}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        dimensions: { ...formData.dimensions, depth: parseFloat(e.target.value) || undefined }
                      })}
                      className="mt-2"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="dimHeight">Height (inches)</Label>
                    <Input
                      id="dimHeight"
                      type="number"
                      step="0.1"
                      value={formData.dimensions?.height || ''}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        dimensions: { ...formData.dimensions, height: parseFloat(e.target.value) || undefined }
                      })}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dimWeight">Weight (lbs)</Label>
                    <Input
                      id="dimWeight"
                      type="number"
                      step="0.1"
                      value={formData.dimensions?.weight || ''}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        dimensions: { ...formData.dimensions, weight: parseFloat(e.target.value) || undefined }
                      })}
                      className="mt-2"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="serviceHistory">Service History</Label>
                  <Textarea
                    id="serviceHistory"
                    value={formData.serviceHistory || ''}
                    onChange={(e) => setFormData({ ...formData, serviceHistory: e.target.value })}
                    placeholder="Describe maintenance history, recent repairs, etc."
                    className="mt-2"
                    rows={3}
                  />
                </div>

                <div>
                  <Label>Certifications</Label>
                  <div className="mt-2 space-y-2">
                    {(formData.certifications || []).map((cert, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input value={cert} readOnly className="flex-1" />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeArrayItem('certifications', index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g., NSF Certified, UL Listed"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addArrayItem('certifications', e.currentTarget.value);
                            e.currentTarget.value = '';
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const input = document.querySelector('input[placeholder*="NSF Certified"]') as HTMLInputElement;
                          if (input?.value) {
                            addArrayItem('certifications', input.value);
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
                  <Label>Safety Features</Label>
                  <div className="mt-2 space-y-2">
                    {(formData.safetyFeatures || []).map((feature, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input value={feature} readOnly className="flex-1" />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeArrayItem('safetyFeatures', index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g., Auto-shutoff, Safety guards"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addArrayItem('safetyFeatures', e.currentTarget.value);
                            e.currentTarget.value = '';
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const input = document.querySelector('input[placeholder*="Auto-shutoff"]') as HTMLInputElement;
                          if (input?.value) {
                            addArrayItem('safetyFeatures', input.value);
                            input.value = '';
                          }
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between gap-3 pt-4">
                  <Button variant="outline" onClick={() => {
                    // Go back to step 2 for rental, step 1 for included
                    if (formData.availabilityType === 'included') {
                      setCurrentStep(1);
                    } else {
                      setCurrentStep(2);
                    }
                  }}>
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

            {/* Step 4: Terms & Conditions */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Terms & Conditions</h3>
                <p className="text-sm text-gray-600 mb-4">
                  {formData.availabilityType === 'included' 
                    ? 'Configure usage terms for equipment that comes free with kitchen bookings.'
                    : 'Configure rental terms and conditions for this equipment.'}
                </p>

                <div>
                  <Label htmlFor="cleaningResponsibility">Cleaning Responsibility</Label>
                  <Select
                    value={formData.cleaningResponsibility || ''}
                    onValueChange={(value: 'renter' | 'host' | 'shared' | '') => 
                      setFormData({ ...formData, cleaningResponsibility: value || undefined })
                    }
                  >
                    <SelectTrigger id="cleaningResponsibility" className="mt-2">
                      <SelectValue placeholder="Select responsibility..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="renter">Renter (chef cleans after use)</SelectItem>
                      <SelectItem value="host">Host (we clean after return)</SelectItem>
                      <SelectItem value="shared">Shared (both parties)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="prepTimeHours">Prep Time Hours</Label>
                    <Input
                      id="prepTimeHours"
                      type="number"
                      min="0"
                      value={formData.prepTimeHours || 4}
                      onChange={(e) => setFormData({ ...formData, prepTimeHours: parseInt(e.target.value) || 4 })}
                      className="mt-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">Time needed for cleaning/prep between uses</p>
                  </div>
                  {formData.availabilityType === 'rental' && (
                    <div>
                      <Label htmlFor="damageDeposit">Damage Deposit (CAD)</Label>
                      <div className="mt-2 relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <span className="text-gray-500">$</span>
                        </div>
                        <Input
                          id="damageDeposit"
                          type="number"
                          step="0.01"
                          min="0"
                          value={formData.damageDeposit || 0}
                          onChange={(e) => setFormData({ ...formData, damageDeposit: parseFloat(e.target.value) || 0 })}
                          placeholder="0.00"
                          className="pl-7"
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Refundable deposit for rental equipment</p>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="trainingRequired"
                      checked={formData.trainingRequired || false}
                      onCheckedChange={(checked) => setFormData({ ...formData, trainingRequired: checked as boolean })}
                    />
                    <Label htmlFor="trainingRequired" className="font-normal cursor-pointer">
                      Training Required (renter must be trained before use)
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="insuranceRequired"
                      checked={formData.insuranceRequired || false}
                      onCheckedChange={(checked) => setFormData({ ...formData, insuranceRequired: checked as boolean })}
                    />
                    <Label htmlFor="insuranceRequired" className="font-normal cursor-pointer">
                      Insurance Required
                    </Label>
                  </div>
                </div>

                <div>
                  <Label>Usage Restrictions</Label>
                  <div className="mt-2 space-y-2">
                    {(formData.usageRestrictions || []).map((restriction, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input value={restriction} readOnly className="flex-1" />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => removeArrayItem('usageRestrictions', index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g., No deep frying, Must use approved cleaning products"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addArrayItem('usageRestrictions', e.currentTarget.value);
                            e.currentTarget.value = '';
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const input = document.querySelector('input[placeholder*="No deep frying"]') as HTMLInputElement;
                          if (input?.value) {
                            addArrayItem('usageRestrictions', input.value);
                            input.value = '';
                          }
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between gap-3 pt-4">
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
    </div>
  );
}

