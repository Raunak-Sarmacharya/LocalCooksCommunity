import { logger } from "@/lib/logger";
import { DollarSign, Save, Info, Loader2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ManagerPageLayout } from "@/components/layout/ManagerPageLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiGet, apiPut } from "@/lib/api";

interface KitchenPricing {
  hourlyRate: number | null;
  currency: string;
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
    pricingModel: 'hourly',
    taxRatePercent: null,
  });
  const [isSaving, setIsSaving] = useState(false);

  // Kitchen name is handled by the parent ManagerPageLayout
  // No need to fetch separately


  const loadPricing = useCallback(async () => {
    if (!selectedKitchenId) return;

    try {
      logger.info('Loading pricing for kitchen:', selectedKitchenId);

      const data = await apiGet(`/manager/kitchens/${selectedKitchenId}/pricing`);
      logger.info('Pricing loaded:', data);
      logger.info('Pricing loaded:', data);

      setPricing({
        // Convert cents to dollars for UI display
        hourlyRate: data.hourlyRate !== undefined && data.hourlyRate !== null ? Number(data.hourlyRate) / 100 : null,
        currency: data.currency || 'CAD',
        pricingModel: data.pricingModel || 'hourly',
        taxRatePercent: data.taxRatePercent !== undefined && data.taxRatePercent !== null ? Number(data.taxRatePercent) : null,
      });
    } catch (error) {
      logger.error('Error loading pricing:', error);
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

    setIsSaving(true);
    try {
      // Prepare payload - convert dollars to cents for database storage
      const hourlyRateInCents = pricing.hourlyRate === null || pricing.hourlyRate === undefined
        ? null
        : Math.round(Number(pricing.hourlyRate) * 100); // Convert dollars to cents

      const payload = {
        hourlyRate: hourlyRateInCents,
        currency: pricing.currency || 'CAD',
        pricingModel: pricing.pricingModel || 'hourly',
        taxRatePercent: pricing.taxRatePercent,
      };

      logger.info('Saving kitchen pricing:', { kitchenId: selectedKitchenId, payload });

      const updated = await apiPut(`/manager/kitchens/${selectedKitchenId}/pricing`, payload);
      logger.info('Pricing saved successfully:', updated);
      logger.info('Pricing saved successfully:', updated);

      // Update state with the response data (convert cents back to dollars for UI)
      setPricing({
        hourlyRate: updated.hourlyRate !== null && updated.hourlyRate !== undefined ? Number(updated.hourlyRate) / 100 : null,
        taxRatePercent: updated.taxRatePercent !== undefined && updated.taxRatePercent !== null ? Number(updated.taxRatePercent) : null,
        currency: updated.currency || 'CAD',
        pricingModel: updated.pricingModel || 'hourly',
      });

      toast({
        title: "Success",
        description: "Kitchen pricing updated successfully",
      });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: [`/api/manager/kitchens/${selectedKitchenId}/pricing`] });
    } catch (error) {
      logger.error('Error saving pricing:', error);
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
            <CurrencyInput
              id="hourlyRate"
              value={pricing.hourlyRate === null ? '' : String(pricing.hourlyRate)}
              onValueChange={(val) => {
                setPricing({
                  ...pricing,
                  hourlyRate: val === '' ? null : parseFloat(val),
                });
              }}
              placeholder="0.00"
              className="mt-2"
            />
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
            <NumericInput
              id="taxRatePercent"
              allowDecimals
              suffix="%"
              value={pricing.taxRatePercent === null ? '' : String(pricing.taxRatePercent)}
              onValueChange={(val) => {
                setPricing({
                  ...pricing,
                  taxRatePercent: val === '' ? null : parseFloat(val),
                });
              }}
              placeholder="e.g. 13"
              className="mt-2"
            />
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
