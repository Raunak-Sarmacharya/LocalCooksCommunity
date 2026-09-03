import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
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
  /** Raw input string in dollars (e.g. "15.50"). Empty string = unset. Stored as string so trailing decimals survive while typing. */
  hourlyRate: string;
  currency: string;
  pricingModel: 'hourly' | 'daily' | 'weekly';
  /** Raw input string as a percentage (e.g. "13" or "13.5"). Empty string = unset. */
  taxRatePercent: string;
}

interface KitchenPricingManagementProps {
  embedded?: boolean;
}


export default function KitchenPricingManagement({ embedded = false }: KitchenPricingManagementProps = {}) {
  
  const { toast } = useToast();

  return (
    <ManagerPageLayout
      title={mt("kitchenPricing")}
      description={mt("manageRatesAndBookingRequirements")}
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

  // Pricing form state — string-based so users can type decimals freely (e.g. "5." → "5.5" → "5.50")
  const [pricing, setPricing] = useState<KitchenPricing>({
    hourlyRate: '',
    currency: 'CAD',
    pricingModel: 'hourly',
    taxRatePercent: '',
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
        // Convert cents to dollars formatted as fixed 2-decimal string for clean display
        hourlyRate: data.hourlyRate !== undefined && data.hourlyRate !== null
          ? (Number(data.hourlyRate) / 100).toFixed(2)
          : '',
        currency: data.currency || 'CAD',
        pricingModel: data.pricingModel || 'hourly',
        taxRatePercent: data.taxRatePercent !== undefined && data.taxRatePercent !== null
          ? String(Number(data.taxRatePercent))
          : '',
      });
    } catch (error) {
      logger.error('Error loading pricing:', error);
      toast({ title: mt("error"),
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
        hourlyRate: '',
        taxRatePercent: '',
        currency: 'CAD',
        pricingModel: 'hourly',
      });
    }
  }, [selectedKitchenId, loadPricing]);


  const savePricing = async () => {
    if (!selectedKitchenId) {
      toast({ title: mt("error"),
        description: mt("pleaseSelectAKitchenFirst"),
        variant: "destructive",
      });
      return;
    }

    // Parse string inputs into numbers for validation + payload
    const hourlyRateNum = pricing.hourlyRate.trim() === '' ? null : parseFloat(pricing.hourlyRate);
    const taxRateNum = pricing.taxRatePercent.trim() === '' ? null : parseFloat(pricing.taxRatePercent);

    // Validate hourly rate
    if (hourlyRateNum !== null && (isNaN(hourlyRateNum) || hourlyRateNum < 0)) {
      toast({ title: mt("validationError"),
        description: mt("hourlyRateMustBeAPositiveNumberOrEmpty"),
        variant: "destructive",
      });
      return;
    }

    // Validate tax rate
    if (taxRateNum !== null && (isNaN(taxRateNum) || taxRateNum < 0)) {
      toast({ title: mt("validationError"),
        description: mt("taxRateMustBeAPositiveNumberOrEmpty"),
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      // Prepare payload - convert dollars to cents for database storage
      const hourlyRateInCents = hourlyRateNum === null
        ? null
        : Math.round(hourlyRateNum * 100);

      const payload = {
        hourlyRate: hourlyRateInCents,
        currency: pricing.currency || 'CAD',
        pricingModel: pricing.pricingModel || 'hourly',
        taxRatePercent: taxRateNum,
      };

      logger.info('Saving kitchen pricing:', { kitchenId: selectedKitchenId, payload });

      const updated = await apiPut(`/manager/kitchens/${selectedKitchenId}/pricing`, payload);
      logger.info('Pricing saved successfully:', updated);
      logger.info('Pricing saved successfully:', updated);

      // Update state with the response data (convert cents back to dollar string for UI)
      setPricing({
        hourlyRate: updated.hourlyRate !== null && updated.hourlyRate !== undefined
          ? (Number(updated.hourlyRate) / 100).toFixed(2)
          : '',
        taxRatePercent: updated.taxRatePercent !== undefined && updated.taxRatePercent !== null
          ? String(Number(updated.taxRatePercent))
          : '',
        currency: updated.currency || 'CAD',
        pricingModel: updated.pricingModel || 'hourly',
      });

      toast({ title: mt("success"),
        description: mt("kitchenPricingUpdatedSuccessfully"),
      });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: [`/api/manager/kitchens/${selectedKitchenId}/pricing`] });
    } catch (error) {
      logger.error('Error saving pricing:', error);
      toast({ title: mt("error"),
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
          <h3 className="text-lg font-medium text-foreground mb-1">{mt("noKitchenSelected")}</h3>
          <p>{mt("selectALocationAndKitchenFromTheSidebarToManagePricing")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-top-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">{mt("pricingConfiguration")}</CardTitle>
          <CardDescription>{mt("setHourlyRatesAndBookingRequirements")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Pricing Model */}
          <div>
            <Label htmlFor="pricingModel">{mt("pricingModel")}</Label>
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
                <SelectItem value="hourly">{mt("hourlyRate")}</SelectItem>
                <SelectItem value="daily">{mt("dailyRate")}</SelectItem>
                <SelectItem value="weekly">{mt("weeklyRate")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">{mt("chooseHowYouWantToChargeForKitchenBookings")}</p>
          </div>

          {/* Hourly Rate */}
          <div>
            <Label htmlFor="hourlyRate">
              {pricing.pricingModel === 'hourly' ? mt("hourlyRate") :
                pricing.pricingModel === 'daily' ? mt("dailyRate") : mt("weeklyRate")} ({pricing.currency})
            </Label>
            <CurrencyInput
              id="hourlyRate"
              value={pricing.hourlyRate}
              onValueChange={(val) => {
                setPricing({ ...pricing, hourlyRate: val });
              }}
              placeholder="0.00"
              className="mt-2"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {pricing.pricingModel === 'hourly'
                ? mt("amountChargedPerHour")
                : pricing.pricingModel === 'daily'
                  ? mt("amountChargedPerDay")
                  : mt("amountChargedPerWeek")}
            </p>

          </div>

          {/* Tax Rate */}
          <div>
            <Label htmlFor="taxRatePercent">{mt("taxRate2")}</Label>
            <NumericInput
              id="taxRatePercent"
              allowDecimals
              suffix="%"
              value={pricing.taxRatePercent}
              onValueChange={(val) => {
                setPricing({ ...pricing, taxRatePercent: val });
              }}
              placeholder={mt("eG13")}
              className="mt-2"
            />
             <p className="text-xs text-muted-foreground mt-1">{mt("percentageTaxToApplyToBookingsEGGSTHST")}</p>
          </div>

          {/* Currency */}
          <div>
            <Label htmlFor="currency">{mt("currency")}</Label>
            <Select
              value={pricing.currency}
              onValueChange={(value) => setPricing({ ...pricing, currency: value })}
            >
              <SelectTrigger id="currency" className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CAD">{mt("cADCanadianDollar")}</SelectItem>
                <SelectItem value="USD">{mt("uSDUSDollar")}</SelectItem>
                <SelectItem value="EUR">{mt("eUREuro")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Info Alert */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>{mt("pricingInformation")}</AlertTitle>
            <AlertDescription>
              <ul className="text-xs space-y-1 mt-2 list-disc list-inside">
                <li>{mt("chefsWillSeeTheCalculatedTotalPriceBeforeBooking")}</li>
                <li>{mt("updatesApplyToNewBookingsOnly")}</li>
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
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />{mt("saving")}</>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />{mt("saveChanges")}</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
