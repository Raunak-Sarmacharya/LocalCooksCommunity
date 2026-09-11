import { mt } from "@/i18n/manager";
/**
 * Booking Rules Settings Component
 * Manages cancellation policy, booking limits, minimum window, and overstay penalties
 */

import { useState, useEffect, useCallback } from "react";

import { AlertCircle, Clock, Info } from "@/components/ui/manager-icons";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Location {
  id: number;
  name: string;
  cancellationPolicyHours?: number;
  defaultDailyBookingLimit?: number;
  minimumBookingWindowHours?: number;
}

interface BookingRulesSettingsProps {
  location: Location;
  onSave: (updates: any) => Promise<unknown>;
}

function RuleHelp({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3 text-xs leading-relaxed text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export default function BookingRulesSettings({ location, onSave }: BookingRulesSettingsProps) {
  
  // Cancellation Policy State
  const [cancellationHours, setCancellationHours] = useState(location.cancellationPolicyHours || 24);

  // Daily Booking Limit State
  const [dailyBookingLimit, setDailyBookingLimit] = useState(location.defaultDailyBookingLimit || 2);

  // Minimum Booking Window State
  const [minimumBookingWindowHours, setMinimumBookingWindowHours] = useState(location.minimumBookingWindowHours ?? 1);

  const isRulesDirty = cancellationHours !== (location.cancellationPolicyHours || 24)
    || dailyBookingLimit !== (location.defaultDailyBookingLimit || 2)
    || minimumBookingWindowHours !== (location.minimumBookingWindowHours ?? 1);

  // Update state when location changes
  useEffect(() => {
    setCancellationHours(location.cancellationPolicyHours || 24);
    setDailyBookingLimit(location.defaultDailyBookingLimit || 2);
    setMinimumBookingWindowHours(location.minimumBookingWindowHours ?? 1);
  }, [location]);

  const saveRulesAction = useStatusButton(
    useCallback(async () => {
      await onSave({
        locationId: location.id,
        cancellationPolicyHours: cancellationHours,
        defaultDailyBookingLimit: dailyBookingLimit,
        minimumBookingWindowHours: minimumBookingWindowHours,
      });
    }, [onSave, location.id, cancellationHours, dailyBookingLimit, minimumBookingWindowHours]),
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{mt("navBookingRules")}</h2>
        <p className="text-muted-foreground">{mt("configureCancellationPoliciesBookingLimitsAndPenaltiesForYou")}</p>
      </div>

      {/* Unified Booking Policies & Limits — Cancellation Policy + Daily Limit + Min Window */}
      <Card>
        <CardHeader className="p-4 pb-3">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600" />
            <div>
              <CardTitle className="text-lg">{mt("bookingPoliciesLimits")}</CardTitle>
              <CardDescription>{mt("cancellationPolicyDailyBookingLimitAndMinimumAdvanceNoticeOn")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {/* Cancellation Policy */}
          <div className="grid gap-4 px-4 pb-4 pt-0 lg:grid-cols-[minmax(220px,0.32fr)_1fr]">
            <div>
              <div className="flex items-center gap-1">
                <h3 className="text-sm font-semibold flex items-center gap-2"><AlertCircle className="h-4 w-4 text-blue-600" />{mt("cancellationPolicy")}</h3>
                <RuleHelp label="Cancellation and refund information">{mt("cancellationRefundPlatformNote")}</RuleHelp>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{mt("configureWhenChefsCanCancelTheirBookings")}</p>
            </div>
            <div>
              <Label htmlFor="cancellation-hours">{mt("cancellationWindow")}</Label>
              <NumericInput
                id="cancellation-hours"
                suffix={mt("hoursSuffix")}
                value={String(cancellationHours)}
                onValueChange={(val) => setCancellationHours(parseInt(val) || 0)}
                className="mt-1.5 max-w-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {mt("minimumHoursBeforeCancellationAllowed")}
              </p>
            </div>
          </div>

          {/* Daily Booking Limit */}
          <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(220px,0.32fr)_1fr]">
            <div>
              <div className="flex items-center gap-1">
                <h3 className="text-sm font-semibold flex items-center gap-2"><Clock className="h-4 w-4 text-green-600" />{mt("dailyBookingLimit")}</h3>
                <RuleHelp label="Daily booking limit information">{mt("youCanOverrideThisLimitForSpecificDatesInTheAvailabilityCale")}</RuleHelp>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{mt("maximumHoursAChefCanBookPerDay")}</p>
            </div>
            <div>
            <div>
              <Label htmlFor="daily-limit">{mt("defaultHoursPerChefPerDay")}</Label>
              <NumericInput
                id="daily-limit"
                suffix={mt("hoursSuffix")}
                value={String(dailyBookingLimit)}
                onValueChange={(val) => setDailyBookingLimit(parseInt(val) || 2)}
                className="mt-1.5 max-w-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">{mt("maximumHoursAChefCanBookInASingleDay124Hours")}</p>
            </div>
            </div>
          </div>

          {/* Minimum Booking Window */}
          <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(220px,0.32fr)_1fr]">
            <div>
              <div className="flex items-center gap-1">
                <h3 className="text-sm font-semibold flex items-center gap-2"><Clock className="h-4 w-4 text-orange-600" />{mt("minimumBookingWindow")}</h3>
                <RuleHelp label="Minimum booking window example">{mt("exampleWith1HourIfItS100PMChefsCanOnlyBookTimesStartingFrom2")}</RuleHelp>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{mt("minimumAdvanceNoticeRequiredForBookings")}</p>
            </div>
            <div>
            <div>
              <Label htmlFor="min-window">{mt("minimumHoursInAdvance")}</Label>
              <NumericInput
                id="min-window"
                suffix={mt("hoursSuffix")}
                value={String(minimumBookingWindowHours)}
                onValueChange={(val) => {
                  const parsed = parseInt(val, 10);
                  setMinimumBookingWindowHours(isNaN(parsed) ? 0 : Math.min(168, Math.max(0, parsed)));
                }}
                className="mt-1.5 max-w-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {mt("chefsMustBookAtLeastHours")}
              </p>
            </div>
            </div>
          </div>

          {/* Single save button applies to all three subsections above */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 py-4 bg-muted/30">
            <p className="text-xs text-muted-foreground">{mt("savesCancellationPolicyDailyBookingLimitAndMinimumBookingWin")}</p>
            <StatusButton
              status={saveRulesAction.status}
              onClick={saveRulesAction.execute}
              disabled={!isRulesDirty}
              labels={{ idle: mt("saveBookingRules"), loading: mt("savingShort"), success: mt("saved") }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
