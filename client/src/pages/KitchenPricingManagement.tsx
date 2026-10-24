import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { DollarSign } from "@/components/ui/manager-icons";
import { useState, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { NumericInput } from "@/components/ui/numeric-input";
import { ManagerPageLayout } from "@/components/layout/ManagerPageLayout";
import { SettingsRow } from "@/components/manager/settings/SettingsRow";
import { navigateNotificationHref } from "@/lib/navigate-notification-href";
import { apiGet, apiPut } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import { describeDailyRate, formatBreakEvenHours } from "@/lib/daily-rate-hint";
import { isPositiveRate, requiresExtraTimeRate } from "@shared/kitchen-booking-rate";

/**
 * The platform bills in Canadian dollars only, so the manager never picks a
 * currency. Kept as a constant rather than a form field so the value that is
 * written can never drift from the value that is displayed.
 */
const CURRENCY = "CAD";

interface KitchenPricing {
  /** Raw input string in dollars (e.g. "15.50"). Empty string = unset. Stored as string so trailing decimals survive while typing. */
  hourlyRate: string;
  dailyRate: string;
  /** Dollars; required when daily-only. Hidden when an hourly rate is set. */
  extraTimeRate: string;
  /** Raw input string as a percentage (e.g. "13" or "13.5"). Empty string = unset. */
  taxRatePercent: string;
  /** Whole hours, 0–24. 0 means no minimum. */
  minimumBookingHours: number;
  pricingModel: 'hourly' | 'daily' | 'weekly';
}

const EMPTY_PRICING: KitchenPricing = {
  hourlyRate: '',
  dailyRate: '',
  extraTimeRate: '',
  taxRatePercent: '',
  minimumBookingHours: 0,
  pricingModel: 'hourly',
};

export interface KitchenPricingHandle {
  /** Persist pending pricing edits. Resolves `true` when the save succeeded. */
  saveAllChanges: () => Promise<boolean>;
}

interface KitchenPricingContentProps {
  hideMinimumBookingDuration?: boolean;
  selectedLocationId: number | null;
  selectedKitchenId: number | null;
  locationName?: string;
  /**
   * The location's hourly booking ceiling, or null when unknown.
   *
   * Used only to explain the daily rate — see `dailyRateHelp`.
   */
  dailyBookingLimit?: number | null;
  /** Reports unsaved-changes state so the shell can guard navigation away. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Normalise the API shape (rates in cents, tax as numeric) into form strings. */
function toForm(data: any): KitchenPricing {
  return {
    hourlyRate:
      data.hourlyRate !== undefined && data.hourlyRate !== null
        ? (Number(data.hourlyRate) / 100).toFixed(2)
        : '',
    dailyRate:
      data.dailyRate !== undefined && data.dailyRate !== null
        ? (Number(data.dailyRate) / 100).toFixed(2)
        : '',
    extraTimeRate:
      data.extraTimeRateCents !== undefined && data.extraTimeRateCents !== null
        ? (Number(data.extraTimeRateCents) / 100).toFixed(2)
        : '',
    taxRatePercent:
      data.taxRatePercent !== undefined && data.taxRatePercent !== null
        ? String(Number(data.taxRatePercent))
        : '',
    minimumBookingHours: Number(data.minimumBookingHours ?? 0),
    pricingModel: data.pricingModel || 'hourly',
  };
}

export default function KitchenPricingManagement({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <ManagerPageLayout
      title={mt("kitchenPricing")}
      description={mt("manageRatesAndBookingRequirements")}
      showKitchenSelector={true}
    >
      {({ selectedLocationId, selectedKitchenId, dailyBookingLimit }) => (
        <KitchenPricingContent
          selectedLocationId={selectedLocationId}
          selectedKitchenId={selectedKitchenId}
          dailyBookingLimit={dailyBookingLimit}
        />
      )}
    </ManagerPageLayout>
  );
}

/**
 * Pricing fields for one kitchen.
 *
 * Renders a card rather than a page: the parent supplies the heading context and
 * owns the save action, so all four values commit together through the ref
 * handle instead of each carrying its own button.
 */
export const KitchenPricingContent = forwardRef<
  KitchenPricingHandle,
  KitchenPricingContentProps
>(function KitchenPricingContent(
  { selectedLocationId, selectedKitchenId, locationName, dailyBookingLimit, onDirtyChange, hideMinimumBookingDuration = false },
  ref,
) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [pricing, setPricing] = useState<KitchenPricing>(EMPTY_PRICING);
  const [resolvedLocationName, setResolvedLocationName] = useState(locationName ?? '');
  // Snapshot of the last saved values — dirty is a comparison against this, so
  // refetches after a save do not leave the form looking edited.
  const [baseline, setBaseline] = useState<KitchenPricing>(EMPTY_PRICING);

  const isDirty =
    pricing.hourlyRate !== baseline.hourlyRate ||
    pricing.dailyRate !== baseline.dailyRate ||
    pricing.extraTimeRate !== baseline.extraTimeRate ||
    (!hideMinimumBookingDuration && pricing.minimumBookingHours !== baseline.minimumBookingHours);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  /**
   * The daily rate, explained against the hourly rate.
   *
   * The decision lives in `lib/daily-rate-hint` so it can be tested without a render; this only
   * turns the answer into words.
   *
   * Shown as a persistent line under the row, NOT behind the ⓘ. It is a number the manager has to
   * act on, and a popover is invisible to anyone who never opens it — and closes again the moment
   * they move away, leaving them to hold the figure in working memory. The ⓘ on this row carries
   * the static "what is this field" copy instead, matching the hourly row.
   */
  const dailyRateAdvisory = useMemo(():
    | { tone: "info" | "warning"; text: string }
    | undefined => {
    const hint = describeDailyRate({
      hourlyRate: pricing.hourlyRate,
      dailyRate: pricing.dailyRate,
      dailyBookingLimit,
    });
    if (hint.kind === "none") return undefined;

    const breakEven = mt("dailyRateBreakEvenHours", {
      hours: formatBreakEvenHours(hint.breakEvenHours),
    });
    if (hint.kind === "break-even") return { tone: "info", text: breakEven };

    return {
      tone: "warning",
      text: `${breakEven} ${mt("dailyRateBelowHourlyCap", {
        hours: hint.ceilingHours,
        amount: formatCurrency(hint.ceilingCostCents),
      })}`,
    };
  }, [pricing.hourlyRate, pricing.dailyRate, dailyBookingLimit]);

  const loadPricing = useCallback(async () => {
    if (!selectedKitchenId) return;

    try {
      const data = await apiGet(`/manager/kitchens/${selectedKitchenId}/pricing`);
      const form = toForm(data);
      setPricing(form);
      setBaseline(form);
      if (typeof data.locationName === 'string') setResolvedLocationName(data.locationName);
    } catch (error) {
      logger.error('Error loading pricing:', error);
      toast({
        title: mt("error"),
        description: (error as Error).message || mt("failedToLoadPricing"),
        variant: "destructive",
      });
    }
  }, [selectedKitchenId, toast]);

  useEffect(() => {
    // Reset before loading, so the previous kitchen's values can never be read as
    // this kitchen's unsaved edits while the request is in flight.
    setPricing(EMPTY_PRICING);
    setBaseline(EMPTY_PRICING);
    if (selectedKitchenId) {
      void loadPricing();
    }
  }, [selectedKitchenId, loadPricing]);

  /**
   * Persist the pricing fields. Throws on validation or transport failure so the
   * caller's status button can report it; the toast carries the detail.
   */
  const savePricing = useCallback(async () => {
    if (!selectedKitchenId) {
      toast({
        title: mt("error"),
        description: mt("pleaseSelectAKitchenFirst"),
        variant: "destructive",
      });
      throw new Error("no-kitchen");
    }

    const parseAmount = (value: string) => value.trim() === '' ? null : /^\d+(?:\.\d{1,2})?$/.test(value.trim()) ? Number(value.trim()) : NaN;
    const hourlyRateNum = parseAmount(pricing.hourlyRate);
    const dailyRateNum = parseAmount(pricing.dailyRate);
    const extraTimeRateNum = parseAmount(pricing.extraTimeRate);

    const invalid = (value: number | null) => value !== null && (!Number.isFinite(value) || value < 0);

    if (invalid(hourlyRateNum)) {
      toast({
        title: mt("validationError"),
        description: mt("hourlyRateMustBeAPositiveNumberOrEmpty"),
        variant: "destructive",
      });
      throw new Error("invalid-hourly-rate");
    }

    if (invalid(dailyRateNum)) {
      toast({
        title: mt("validationError"),
        description: mt("dailyRateMustBeAPositiveNumberOrEmpty"),
        variant: "destructive",
      });
      throw new Error("invalid-daily-rate");
    }

    if (invalid(extraTimeRateNum) || (extraTimeRateNum !== null && extraTimeRateNum <= 0)) {
      toast({
        title: mt("validationError"),
        description: mt("extraTimeRateMustBeAPositiveNumberOrEmpty"),
        variant: "destructive",
      });
      throw new Error("invalid-extra-time-rate");
    }

    if ((hourlyRateNum ?? 0) <= 0 && (dailyRateNum ?? 0) <= 0) {
      toast({
        title: mt("validationError"),
        description: mt("atLeastOneKitchenRateRequired"),
        variant: "destructive",
      });
      throw new Error("no-rate");
    }

    if (requiresExtraTimeRate(hourlyRateNum, dailyRateNum) && (extraTimeRateNum ?? 0) <= 0) {
      toast({
        title: mt("validationError"),
        description: mt("extraTimeRateRequiredForDailyOnly"),
        variant: "destructive",
      });
      throw new Error("extra-time-rate-required");
    }

    const payload = {
      // Rates travel in cents; the form holds dollars. HST is location-owned — not sent here.
      hourlyRate: hourlyRateNum === null ? null : Math.round(hourlyRateNum * 100),
      dailyRate: dailyRateNum === null ? null : Math.round(dailyRateNum * 100),
      // Hourly kitchens clear this; daily-only send the required rate.
      extraTimeRateCents: isPositiveRate(hourlyRateNum)
        ? null
        : extraTimeRateNum === null ? null : Math.round(extraTimeRateNum * 100),
      currency: CURRENCY,
      pricingModel: pricing.pricingModel || 'hourly',
      ...(!hideMinimumBookingDuration ? { minimumBookingHours: pricing.minimumBookingHours } : {}),
    };

    const updated = await apiPut(`/manager/kitchens/${selectedKitchenId}/pricing`, payload);

    const form = toForm(updated);
    setPricing(form);
    setBaseline(form);

    queryClient.invalidateQueries({ queryKey: [`/api/manager/kitchens/${selectedKitchenId}/pricing`] });
    queryClient.invalidateQueries({ queryKey: ['managerKitchens', selectedLocationId] });
    queryClient.invalidateQueries({ queryKey: ["/api/manager/all-kitchens"] });

    toast({ title: mt("success"), description: mt("kitchenPricingUpdatedSuccessfully") });
  }, [selectedKitchenId, selectedLocationId, pricing, queryClient, toast, hideMinimumBookingDuration]);

  useImperativeHandle(
    ref,
    () => ({
      saveAllChanges: async () => {
        try {
          await savePricing();
          return true;
        } catch {
          return false;
        }
      },
    }),
    [savePricing],
  );

  if (!selectedKitchenId) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-3 p-12 text-center text-muted-foreground">
          <DollarSign className="h-10 w-10 opacity-20" />
          <div>
            <h3 className="mb-1 font-medium text-foreground">{mt("noKitchenSelected")}</h3>
            <p className="text-sm">{mt("selectALocationAndKitchenFromTheSidebarToManagePricing")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        <CardTitle className="text-lg">{mt("navPricing")}</CardTitle>
        <CardDescription>{mt("pricingCardDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border p-0">
        <SettingsRow
          id="hourly-rate"
          label={mt("hourlyRate")}
          hint={mt("amountChargedPerHour")}
          help={mt("chefsWillSeeTheCalculatedTotalPriceBeforeBooking")}
        >
          <CurrencyInput
            id="hourly-rate"
            value={pricing.hourlyRate}
            onValueChange={(val) => setPricing((current) => ({ ...current, hourlyRate: val }))}
            placeholder="0.00"
            className="w-36"
          />
        </SettingsRow>

        <SettingsRow
          id="daily-rate"
          label={mt("dailyRate")}
          hint={mt("amountChargedPerDay")}
          help={mt("dailyRateHelp")}
          advisory={dailyRateAdvisory}
        >
          <CurrencyInput
            id="daily-rate"
            value={pricing.dailyRate}
            onValueChange={(val) => setPricing((current) => ({ ...current, dailyRate: val }))}
            placeholder="0.00"
            className="w-36"
          />
        </SettingsRow>

        {requiresExtraTimeRate(pricing.hourlyRate, pricing.dailyRate) ? (
          <SettingsRow
            id="extra-time-rate"
            label={mt("extraTimeRatePerHour")}
            required
            hint={mt("extraTimeRateHelp")}
          >
            <CurrencyInput
              id="extra-time-rate"
              value={pricing.extraTimeRate}
              onValueChange={(val) => setPricing((current) => ({ ...current, extraTimeRate: val }))}
              placeholder="25.00"
              className="w-36"
            />
          </SettingsRow>
        ) : isPositiveRate(pricing.hourlyRate) ? (
          <SettingsRow id="extra-time-rate" label={mt("extraTimeRatePerHour")} hint={mt("extraTimeRateHelp")}>
            <p className="text-sm text-muted-foreground">{mt("extraTimeRateSameAsHourly", { amount: formatCurrency(Math.round(Number(pricing.hourlyRate) * 100)) })}</p>
          </SettingsRow>
        ) : null}

        <SettingsRow
          id="tax-rate"
          label={mt("taxRate2")}
          hint={<>
            {mt("bpTaxSetForLocation", { rate: pricing.taxRatePercent || "0", location: resolvedLocationName || locationName || mt("thisLocation") })}
            {/* Tax is one rate for the whole location; say where it is changed and take the manager there. */}
            {selectedLocationId != null && <>{" · "}<button type="button"
              onClick={() => navigateNotificationHref(`/manager/dashboard?view=location&locationId=${selectedLocationId}&section=booking`)}
              className="!min-h-0 font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {mt("bpTaxChangeIn", { page: `${mt("navLocation")} › ${mt("locationBookingDefaults")}` })}</button></>}
          </>}
        >
          <span id="tax-rate" className="text-sm font-medium tabular-nums">
            {pricing.taxRatePercent ? mt("bpTaxReadonlyValue", { rate: pricing.taxRatePercent }) : mt("bpTaxUnset")}
          </span>
        </SettingsRow>

        {!hideMinimumBookingDuration && <SettingsRow
          id="minimum-booking"
          label={mt("minimumBookingDuration")}
          hint={mt("zeroMeansNoMinimum")}
          help={mt("setTheMinimumHoursRequiredPerBookingForEachKitchen")}
        >
          <NumericInput
            id="minimum-booking"
            suffix={mt("hoursSuffix")}
            value={String(pricing.minimumBookingHours)}
            onValueChange={(val) => {
              const parsed = parseInt(val, 10);
              setPricing((current) => ({
                ...current,
                minimumBookingHours: isNaN(parsed) ? 0 : Math.min(24, Math.max(0, parsed)),
              }));
            }}
            className="w-36"
          />
        </SettingsRow>}
      </CardContent>
    </Card>
  );
});
