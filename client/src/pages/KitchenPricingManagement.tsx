import { DollarSign, Clock, Save, AlertCircle, Info, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useManagerDashboard } from "../hooks/use-manager-dashboard";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Kitchen {
  id: number;
  name: string;
  description?: string;
  locationId: number;
}

interface KitchenPricing {
  hourlyRate: number | null;
  currency: string;
  minimumBookingHours: number;
  pricingModel: 'hourly' | 'daily' | 'weekly';
}

interface KitchenPricingManagementProps {
  embedded?: boolean;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = localStorage.getItem('firebaseToken');
  if (token) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }
  return {
    'Content-Type': 'application/json',
  };
}

export default function KitchenPricingManagement({ embedded = false }: KitchenPricingManagementProps = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, isLoadingLocations } = useManagerDashboard();
  
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(null);
  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  
  // Pricing form state
  const [pricing, setPricing] = useState<KitchenPricing>({
    hourlyRate: null,
    currency: 'CAD',
    minimumBookingHours: 1,
    pricingModel: 'hourly',
  });
  const [isSaving, setIsSaving] = useState(false);

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

  // Load pricing when kitchen is selected
  useEffect(() => {
    if (selectedKitchenId) {
      loadPricing();
    } else {
      setPricing({
        hourlyRate: null,
        currency: 'CAD',
        minimumBookingHours: 1,
        pricingModel: 'hourly',
      });
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
      
      // Auto-select first kitchen if only one exists
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

  const loadPricing = async () => {
    if (!selectedKitchenId) return;
    
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/kitchens/${selectedKitchenId}/pricing`, {
        headers,
        credentials: "include",
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          // No pricing set yet, use defaults
          setPricing({
            hourlyRate: null,
            currency: 'CAD',
            minimumBookingHours: 1,
            pricingModel: 'hourly',
          });
          return;
        }
        throw new Error('Failed to load pricing');
      }
      
      const data = await response.json();
      setPricing({
        hourlyRate: data.hourlyRate,
        currency: data.currency || 'CAD',
        minimumBookingHours: data.minimumBookingHours || 1,
        pricingModel: data.pricingModel || 'hourly',
      });
    } catch (error: any) {
      console.error('Error loading pricing:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to load pricing",
        variant: "destructive",
      });
    }
  };

  const savePricing = async () => {
    if (!selectedKitchenId) {
      toast({
        title: "Error",
        description: "Please select a kitchen first",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/kitchens/${selectedKitchenId}/pricing`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify(pricing),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to save pricing' }));
        throw new Error(errorData.error || 'Failed to save pricing');
      }

      const updated = await response.json();
      setPricing(updated);
      
      toast({
        title: "Success",
        description: "Kitchen pricing updated successfully",
      });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: [`/api/manager/kitchens/${selectedKitchenId}/pricing`] });
    } catch (error: any) {
      console.error('Error saving pricing:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save pricing",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const selectedKitchen = kitchens.find(k => k.id === selectedKitchenId);

  return (
    <div className="space-y-6">
      {/* Location Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Location & Kitchen</CardTitle>
          <CardDescription>Choose a location and kitchen to manage pricing</CardDescription>
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

      {/* Pricing Form */}
      {selectedKitchen && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Pricing for {selectedKitchen.name}
            </CardTitle>
            <CardDescription>
              Set hourly rates and booking requirements for this kitchen
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Pricing Model */}
            <div>
              <Label htmlFor="pricingModel">Pricing Model</Label>
              <Select
                value={pricing.pricingModel}
                onValueChange={(value: 'hourly' | 'daily' | 'weekly') => 
                  setPricing({ ...pricing, pricingModel: value })
                }
              >
                <SelectTrigger id="pricingModel" className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly Rate</SelectItem>
                  <SelectItem value="daily">Daily Rate</SelectItem>
                  <SelectItem value="weekly">Weekly Rate</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">
                Choose how you want to charge for kitchen bookings
              </p>
            </div>

            {/* Hourly Rate */}
            <div>
              <Label htmlFor="hourlyRate">
                {pricing.pricingModel === 'hourly' ? 'Hourly Rate' : 
                 pricing.pricingModel === 'daily' ? 'Daily Rate' : 'Weekly Rate'} ({pricing.currency})
              </Label>
              <div className="mt-2 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <DollarSign className="h-5 w-5 text-gray-400" />
                </div>
                <Input
                  id="hourlyRate"
                  type="number"
                  step="0.01"
                  min="0"
                  value={pricing.hourlyRate === null ? '' : pricing.hourlyRate}
                  onChange={(e) => {
                    const value = e.target.value;
                    setPricing({
                      ...pricing,
                      hourlyRate: value === '' ? null : parseFloat(value),
                    });
                  }}
                  placeholder="0.00"
                  className="pl-10"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {pricing.pricingModel === 'hourly' 
                  ? 'Amount charged per hour (e.g., 50.00 = $50/hour)'
                  : pricing.pricingModel === 'daily'
                  ? 'Amount charged per day (e.g., 200.00 = $200/day)'
                  : 'Amount charged per week (e.g., 1000.00 = $1000/week)'}
              </p>
            </div>

            {/* Currency */}
            <div>
              <Label htmlFor="currency">Currency</Label>
              <Select
                value={pricing.currency}
                onValueChange={(value) => setPricing({ ...pricing, currency: value })}
              >
                <SelectTrigger id="currency" className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CAD">CAD (Canadian Dollar)</SelectItem>
                  <SelectItem value="USD">USD (US Dollar)</SelectItem>
                  <SelectItem value="EUR">EUR (Euro)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Minimum Booking Hours */}
            <div>
              <Label htmlFor="minimumBookingHours" className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Minimum Booking Duration
              </Label>
              <Input
                id="minimumBookingHours"
                type="number"
                min="1"
                value={pricing.minimumBookingHours}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 1;
                  setPricing({ ...pricing, minimumBookingHours: value });
                }}
                className="mt-2"
              />
              <p className="text-xs text-gray-500 mt-1">
                Minimum number of hours required for a booking (e.g., 2 = minimum 2-hour booking)
              </p>
            </div>

            {/* Info Alert */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-blue-600 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-blue-900 mb-1">Pricing Information</h4>
                  <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
                    <li>Prices are stored in cents internally (e.g., $50.00 = 5000 cents) to avoid floating-point precision issues</li>
                    <li>Chefs will see the calculated total price before booking</li>
                    <li>You can update pricing at any time - existing bookings will keep their original price</li>
                    <li>Setting pricing to null/empty will make the kitchen free to book</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                onClick={savePricing}
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
                    Save Pricing
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!selectedLocationId && (
        <Card>
          <CardContent className="py-12 text-center">
            <DollarSign className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
            <p className="text-gray-500">Choose a location to manage kitchen pricing</p>
          </CardContent>
        </Card>
      )}

      {selectedLocationId && !selectedKitchenId && kitchens.length > 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <DollarSign className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Kitchen</h3>
            <p className="text-gray-500">Choose a kitchen to set pricing</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
