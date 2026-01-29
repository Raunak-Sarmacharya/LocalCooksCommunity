import { DollarSign, Clock, Save, Info, Loader2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ManagerPageLayout } from "@/components/layout/ManagerPageLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiGet, apiPut } from "@/lib/api";

interface KitchenPricing {
  hourlyRate: number | null;
  currency: string;
  minimumBookingHours: number;
  pricingModel: 'hourly' | 'daily' | 'weekly';
  taxRatePercent: number | null;
}

interface KitchenPricingManagementProps {
  embedded?: boolean;
}


export default function KitchenPricingManagement({ embedded = false }: KitchenPricingManagementProps = {}) {
  const { toast } = useToast();

  return (
    <ManagerPageLayout
      title="Kitchen Pricing"
      description="Manage rates and booking requirements"
      showKitchenSelector={true}
    >
      {({ selectedLocationId, selectedKitchenId, isLoading }) => (
        <KitchenPricingContent
          selectedLocationId={selectedLocationId}
          selectedKitchenId={selectedKitchenId}
        />
      )}
    </ManagerPageLayout>
  );
}

// Extracted Content Component
function KitchenPricingContent({
  selectedLocationId,
  selectedKitchenId
}: {
  selectedLocationId: number | null,
  selectedKitchenId: number | null
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [kitchenName, setKitchenName] = useState<string>('');

  // Pricing form state
  const [pricing, setPricing] = useState<KitchenPricing>({
    hourlyRate: null,
    currency: 'CAD',
    minimumBookingHours: 1,
    pricingModel: 'hourly',
    taxRatePercent: null,
  });
  const [isSaving, setIsSaving] = useState(false);

  // Kitchen name is handled by the parent ManagerPageLayout
  // No need to fetch separately


  const loadPricing = useCallback(async () => {
    if (!selectedKitchenId) return;

    try {
      console.log('Loading pricing for kitchen:', selectedKitchenId);

      const data = await apiGet(`/manager/kitchens/${selectedKitchenId}/pricing`);
      console.log('Pricing loaded:', data);
      console.log('Pricing loaded:', data);

      // Ensure proper data types
      const minHours = data.minimumBookingHours;
      const validMinHours = (minHours !== undefined && minHours !== null && !isNaN(Number(minHours)) && Number(minHours) >= 1)
        ? Math.max(1, Math.floor(Number(minHours)))
        : 1;

      setPricing({
        // Convert cents to dollars for UI display
        hourlyRate: data.hourlyRate !== undefined && data.hourlyRate !== null ? Number(data.hourlyRate) / 100 : null,
        currency: data.currency || 'CAD',
        minimumBookingHours: validMinHours,
        pricingModel: data.pricingModel || 'hourly',
        taxRatePercent: data.taxRatePercent !== undefined && data.taxRatePercent !== null ? Number(data.taxRatePercent) : null,
      });
    } catch (error) {
      console.error('Error loading pricing:', error);
      toast({
        title: "Error",
        description: (error as Error).message || "Failed to load pricing",
        variant: "destructive",
      });
    }
  }, [selectedKitchenId, toast]);

  // Load pricing when kitchen is selected
  useEffect(() => {
    if (selectedKitchenId) {
      loadPricing();
    } else {
      setPricing({
        hourlyRate: null,
        taxRatePercent: null,
        currency: 'CAD',
        minimumBookingHours: 1,
        pricingModel: 'hourly',
      });
    }
  }, [selectedKitchenId, loadPricing]);


  const savePricing = async () => {
    if (!selectedKitchenId) {
      toast({
        title: "Error",
        description: "Please select a kitchen first",
        variant: "destructive",
      });
      return;
    }

    // Validate pricing data before sending
    if (pricing.hourlyRate !== null && pricing.hourlyRate !== undefined && (isNaN(pricing.hourlyRate) || pricing.hourlyRate < 0)) {
      toast({
        title: "Validation Error",
        description: "Hourly rate must be a positive number or empty",
        variant: "destructive",
      });
      return;
    }

    // Validate minimumBookingHours - must be at least 1
    const minBookingHours = Number(pricing.minimumBookingHours);
    if (isNaN(minBookingHours) || minBookingHours < 1) {
      toast({
        title: "Validation Error",
        description: "Minimum booking hours must be at least 1",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      // Prepare payload - convert dollars to cents for database storage
      const hourlyRateInCents = pricing.hourlyRate === null || pricing.hourlyRate === undefined
        ? null
        : Math.round(Number(pricing.hourlyRate) * 100); // Convert dollars to cents

      const payload = {
        hourlyRate: hourlyRateInCents,
        currency: pricing.currency || 'CAD',
        minimumBookingHours: Math.max(1, Math.floor(minBookingHours)), // Ensure it's at least 1 and an integer
        pricingModel: pricing.pricingModel || 'hourly',
        taxRatePercent: pricing.taxRatePercent,
      };

      console.log('Saving kitchen pricing:', { kitchenId: selectedKitchenId, payload });

      const updated = await apiPut(`/manager/kitchens/${selectedKitchenId}/pricing`, payload);
      console.log('Pricing saved successfully:', updated);
      console.log('Pricing saved successfully:', updated);

      // Update state with the response data (convert cents back to dollars for UI)
      setPricing({
        hourlyRate: updated.hourlyRate !== null && updated.hourlyRate !== undefined ? Number(updated.hourlyRate) / 100 : null,
        taxRatePercent: updated.taxRatePercent !== undefined && updated.taxRatePercent !== null ? Number(updated.taxRatePercent) : null,
        currency: updated.currency || 'CAD',
        minimumBookingHours: updated.minimumBookingHours || 1,
        pricingModel: updated.pricingModel || 'hourly',
      });

      toast({
        title: "Success",
        description: "Kitchen pricing updated successfully",
      });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: [`/api/manager/kitchens/${selectedKitchenId}/pricing`] });
    } catch (error) {
      console.error('Error saving pricing:', error);
      toast({
        title: "Error",
        description: (error as Error).message || "Failed to save pricing",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };


  if (!selectedKitchenId) {
    return (
      <Card className="border-dashed h-full">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground h-full">
          <DollarSign className="h-12 w-12 mb-4 opacity-20" />
          <h3 className="text-lg font-medium text-foreground mb-1">No Kitchen Selected</h3>
          <p>Select a location and kitchen from the sidebar to manage pricing.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Pricing Configuration
          </CardTitle>
          <CardDescription>
            Set hourly rates and booking requirements
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
            <p className="text-xs text-muted-foreground mt-1">
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
                <DollarSign className="h-4 w-4 text-muted-foreground" />
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
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {pricing.pricingModel === 'hourly'
                ? 'Amount charged per hour'
                : pricing.pricingModel === 'daily'
                  ? 'Amount charged per day'
                  : 'Amount charged per week'}
            </p>

          </div>

          {/* Tax Rate */}
          <div>
            <Label htmlFor="taxRatePercent">Tax Rate (%)</Label>
            <div className="mt-2 relative">
                <Input
                  id="taxRatePercent"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={pricing.taxRatePercent === null ? '' : pricing.taxRatePercent}
                  onChange={(e) => {
                    const value = e.target.value;
                    setPricing({
                      ...pricing,
                      taxRatePercent: value === '' ? null : parseFloat(value),
                    });
                  }}
                  placeholder="e.g. 13"
                />
            </div>
             <p className="text-xs text-muted-foreground mt-1">
               Percentage tax to apply to bookings (e.g., GST/HST)
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
              step="1"
              value={pricing.minimumBookingHours}
              onChange={(e) => {
                const inputValue = e.target.value;
                if (inputValue === '' || inputValue === null || inputValue === undefined) {
                  setPricing({ ...pricing, minimumBookingHours: 1 });
                  return;
                }
                const parsedValue = parseInt(inputValue, 10);
                if (!isNaN(parsedValue) && parsedValue >= 1) {
                  setPricing({ ...pricing, minimumBookingHours: parsedValue });
                } else {
                  setPricing({ ...pricing, minimumBookingHours: 1 });
                }
              }}
              onBlur={(e) => {
                const value = parseInt(e.target.value, 10);
                if (isNaN(value) || value < 1) {
                  setPricing({ ...pricing, minimumBookingHours: 1 });
                }
              }}
              className="mt-2"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Minimum number of hours required per booking
            </p>
          </div>

          {/* Info Alert */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Pricing Information</AlertTitle>
            <AlertDescription>
              <ul className="text-xs space-y-1 mt-2 list-disc list-inside">
                <li>Chefs will see the calculated total price before booking</li>
                <li>Updates apply to new bookings only</li>
              </ul>
            </AlertDescription>
          </Alert>

          {/* Save Button */}
          <div className="flex justify-end pt-4 border-t">
            <Button
              onClick={savePricing}
              disabled={isSaving}
              className="w-full sm:w-auto"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
