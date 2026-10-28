import { SettingChangePreview } from './SettingChangePreview';
import { useSettingImpact } from '@/lib/setting-impact';
import { mt } from "@/i18n/manager";
/**
 * Booking rules
 *
 * When chefs can book and for how long: advance notice, how far ahead, shortest and longest
 * booking, and the optional free hour between bookings. Each row reads as label · what it means
 * for chefs (live, from the value in the control) · control.
 *
 * Saving:
 * - Kitchen tab (`onRequestSave`): the section owns ONE save at its foot, disabled until something
 *   changes; the parent asks which kitchens it applies to. The consequence preview shows above it.
 * - Location settings page (header shown): the page header keeps its save, as before.
 * - Onboarding (`hideHeader`, no `onRequestSave`): the parent saves through the imperative handle.
 *
 * Newer settings (`maxAdvanceBookingDays`, buffer, multi-day, weekly limit) render only when the
 * server sends them, so an older server never receives fields it does not know.
 */

import { useState, useEffect, useCallback, useImperativeHandle, forwardRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ClipboardCheck, ChevronRight, Loader2 } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStatusButton } from "@/hooks/use-status-button";
import { apiGet } from "@/lib/api";
import { NumericInput } from "@/components/ui/numeric-input";
import { ChefPageHeader } from "@/components/chef/ui";
import { SettingsRow } from "./SettingsRow";
import { ManagerDamagePolicySection, PolicySection } from "./PolicySection";
import { KitchenTermsSection } from "./KitchenTermsSection";
import { LocationCancellationPolicyEditor } from "./CancellationPolicyEditor";

const SELECT_CLASS = "h-11 w-full min-w-[12rem] sm:w-56";

interface Location {
  id: number;
  name: string;
  cancellationPolicyHours?: number;
  /** Null / omitted = no longest-booking hours cap. */
  defaultDailyBookingLimit?: number | null;
  minimumBookingWindowHours?: number;
  /** Days ahead chefs can book. Absent on servers that predate the setting. */
  maxAdvanceBookingDays?: number | null;
  /** Legacy boolean buffer. Prefer `bookingBufferMinutes` when present. */
  turnoverBufferEnabled?: boolean | null;
  /** Off / 1 h / 2 h buffer in minutes. Absent on servers that predate the setting. */
  bookingBufferMinutes?: number | null;
  allowMultiDayBookings?: boolean | null;
  maxBookingDays?: number | null;
  maxBookingDaysCap?: number | null;
  weeklyChefHoursLimit?: number | null;
  /** Read-only platform ceiling for `maxAdvanceBookingDays`, set by Local Cooks. */
  maxAdvanceBookingDaysCap?: number | null;
  kitchenTermsUrl?: string | null;
  kitchenTermsUploadedAt?: string | null;
  taxRatePercent?: number | string | null;
}

type PolicyOverrides = {
  cancellationPolicyHours?: number | null;
  defaultDailyBookingLimit?: number | null;
  minimumBookingWindowHours?: number | null;
  maxAdvanceBookingDays?: number | null;
  turnoverBufferEnabled?: boolean | null;
  bookingBufferMinutes?: number | null;
  allowMultiDayBookings?: boolean | null;
  maxBookingDays?: number | null;
  weeklyChefHoursLimit?: number | null;
};
export type ResettablePolicyField =
  | "cancellationPolicyHours"
  | "defaultDailyBookingLimit"
  | "minimumBookingWindowHours"
  | "maxAdvanceBookingDays"
  | "turnoverBufferEnabled"
  | "bookingBufferMinutes"
  | "allowMultiDayBookings"
  | "maxBookingDays"
  | "weeklyChefHoursLimit";

interface BookingRulesSettingsProps {
  hideHeader?: boolean;
  minimumBookingHours?: number;
  policyOverrides?: PolicyOverrides;
  kitchenName?: string;
  policyUpdating?: boolean;
  onResetPolicy?: (field: ResettablePolicyField) => void;
  location: Location;
  onSave: (updates: any) => Promise<unknown>;
  /**
   * The section's own save. The kitchen tab passes this so the save sits under the rules it
   * saves; the parent then asks which kitchens the rules apply to before calling `saveAllChanges`.
   */
  onRequestSave?: () => void;
  /** Reports unsaved-changes state so the shell can guard navigation away. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Lets the arrival-timing card link across to the check-in/check-out page. */
  onNavigate?: (view: 'settings-checkin-checkout') => void;
  /**
   * Drop the arrival-timing card entirely.
   *
   * Onboarding embeds this on the Availability step to make managers aware of
   * the policies they are setting; the arrival window belongs to the
   * check-in/check-out page, and offering it mid-setup invites the question of
   * which of the two is authoritative.
   */
  hideArrivalTimings?: boolean;
  /**
   * Drop the Terms & Conditions card.
   *
   * Onboarding collects the terms on the Business step, so showing the upload
   * again on Availability asks the manager to do the same job twice and leaves
   * them unsure which upload counts.
   */
  hideTerms?: boolean;
  /** The kitchen tab renders the damage section itself, in its own place in the order. */
  hideDamagePolicy?: boolean;
  /**
   * A caller-supplied line under the terms card's description.
   *
   * The onboarding availability step uses it to say the document is OPTIONAL and where to add it
   * later. A note built in here would be wrong on the dashboard's own Booking Policies page, where
   * "you can add this later from Booking Policies" is a loop — so the caller owns the words.
   */
  termsNote?: string;
  /** Location display name for scope / location-only copy on the kitchen tab. */
  locationName?: string;
  /** Opens location Booking policies (kitchen tab location-only rows). */
  onEditLocation?: () => void;
}

type ImpactField = {
  following: { id: number; name: string }[];
  overriding: { id: number; name: string }[];
  usedBy: number;
};

/** Shape of the arrival-timing values, which are owned by the check-in/check-out endpoint. */
interface ArrivalTimings {
  timeWindowSettings?: {
    checkinWindowMinutesBefore: number | null;
  };
  platformDefaults?: {
    checkinWindowMinutesBefore: number;
  };
}

export interface BookingPoliciesHandle {
  /** Persist pending edits. Resolves `true` when the save succeeded. */
  saveAllChanges: () => Promise<boolean>;
}

/** Upper bound when an older server sends the window but not the cap. */
const FALLBACK_WINDOW_CAP = 365;

const BookingRulesSettings = forwardRef<BookingPoliciesHandle, BookingRulesSettingsProps>(
  function BookingRulesSettings({ location, onSave, onRequestSave, onDirtyChange, onNavigate, hideArrivalTimings = false, hideTerms = false, hideDamagePolicy = false, termsNote, policyOverrides, onResetPolicy, minimumBookingHours, hideHeader = false, kitchenName, policyUpdating = false, locationName, onEditLocation }, ref) {
    const queryClient = useQueryClient();
    const { impact, impactFetching, impactError } = useSettingImpact(undefined, location.id);
    // The kitchen tab always passes its overrides; the Location page also passes onRequestSave for its own section save.
    const isKitchenMode = policyOverrides !== undefined;
    const place = locationName || location.name;
    const { data: policyImpact } = useQuery<{ fields: Record<string, ImpactField> }>({
      queryKey: ["booking-policy-impact", location.id],
      queryFn: () => apiGet(`/manager/locations/${location.id}/booking-policy-impact`),
      enabled: !!location.id && !isKitchenMode,
    });

    // Legacy location field; no longer edited here (the versioned cancellation policy replaced it) but still saved back unchanged.
    const [cancellationHours, setCancellationHours] = useState(location.cancellationPolicyHours ?? 24);
    const savedDailyLimit = location.defaultDailyBookingLimit ?? null;
    const [longestEnabled, setLongestEnabled] = useState(savedDailyLimit != null);
    const [dailyBookingLimit, setDailyBookingLimit] = useState(savedDailyLimit ?? 8);
    const [minimumBookingWindowHours, setMinimumBookingWindowHours] = useState(location.minimumBookingWindowHours ?? 1);
    const [minimumDuration, setMinimumDuration] = useState(minimumBookingHours ?? 0);
    useEffect(() => setMinimumDuration(minimumBookingHours ?? 0), [minimumBookingHours]);

    const hasWindow = location.maxAdvanceBookingDays != null;
    const hasBuffer = location.bookingBufferMinutes != null || location.turnoverBufferEnabled != null;
    const hasMultiDay = location.allowMultiDayBookings != null || location.maxBookingDays != null;
    const hasWeeklyLimit = "weeklyChefHoursLimit" in location;
    const windowCap = location.maxAdvanceBookingDaysCap ?? undefined;
    const daysCap = location.maxBookingDaysCap ?? 14;
    const savedWindow = location.maxAdvanceBookingDays ?? 30;
    const savedBufferMinutes = location.bookingBufferMinutes
      ?? (location.turnoverBufferEnabled ? 60 : 0);
    const savedAllowMultiDay = location.allowMultiDayBookings ?? true;
    const savedMaxBookingDays = location.maxBookingDays ?? 7;
    const savedWeeklyLimit = location.weeklyChefHoursLimit ?? null;
    const [windowDays, setWindowDays] = useState(savedWindow);
    const [bufferMinutes, setBufferMinutes] = useState(savedBufferMinutes);
    const [allowMultiDay, setAllowMultiDay] = useState(savedAllowMultiDay);
    const [maxBookingDays, setMaxBookingDays] = useState(savedMaxBookingDays);
    const [weeklyLimitEnabled, setWeeklyLimitEnabled] = useState(savedWeeklyLimit != null);
    const [weeklyLimitHours, setWeeklyLimitHours] = useState(savedWeeklyLimit ?? 8);
    const savedTax = location.taxRatePercent == null || location.taxRatePercent === ""
      ? "" : String(Number(location.taxRatePercent));
    const [taxRate, setTaxRate] = useState(savedTax);
    useEffect(() => setTaxRate(savedTax), [savedTax]);

    // Arrival timings. These live on the locations table but the check-in/check-out
    // endpoint owns them, so read them (plus the platform defaults shown as hints)
    // from there rather than from the locations list. Sharing the query key with
    // that page means one cache entry, not two.
    const { data: arrivalSettings } = useQuery<ArrivalTimings>({
      queryKey: ["checkin-checkout-settings", location.id],
      queryFn: () => apiGet(`/manager/locations/${location.id}/checkin-checkout-settings`),
      enabled: !!location.id && !hideArrivalTimings,
    });

    const [checkinWindow, setCheckinWindow] = useState<number | null>(null);

    const effectiveWeeklyLimit = weeklyLimitEnabled ? weeklyLimitHours : null;
    const effectiveDailyLimit = longestEnabled ? dailyBookingLimit : null;
    const changed = {
      notice: minimumBookingWindowHours !== (location.minimumBookingWindowHours ?? 1),
      window: hasWindow && windowDays !== savedWindow,
      shortest: minimumBookingHours !== undefined && minimumDuration !== minimumBookingHours,
      longest: effectiveDailyLimit !== savedDailyLimit,
      buffer: hasBuffer && bufferMinutes !== savedBufferMinutes,
      multiDay: hasMultiDay && (allowMultiDay !== savedAllowMultiDay || maxBookingDays !== savedMaxBookingDays),
      weekly: hasWeeklyLimit && effectiveWeeklyLimit !== savedWeeklyLimit,
    };
    const taxChanged = !isKitchenMode && taxRate !== savedTax;
    const rulesChanged = Object.values(changed).some(Boolean) || cancellationHours !== (location.cancellationPolicyHours ?? 24) || taxChanged;
    const timingChanged = !hideArrivalTimings && checkinWindow !== (arrivalSettings?.timeWindowSettings?.checkinWindowMinutesBefore ?? null);
    const isRulesDirty = rulesChanged || timingChanged;

    // Suffix follows the value: "1 hour" vs "24 hours". Uses ICU plurals so
    // locales with more than two forms (uk) resolve correctly.
    const hourUnit = (value: number) => mt("hourUnit", { count: value });

    const resetLocalEdits = useCallback(() => {
      setCancellationHours(location.cancellationPolicyHours ?? 24);
      const longest = location.defaultDailyBookingLimit ?? null;
      setLongestEnabled(longest != null);
      setDailyBookingLimit(longest ?? 8);
      setMinimumBookingWindowHours(location.minimumBookingWindowHours ?? 1);
      setWindowDays(location.maxAdvanceBookingDays ?? 30);
      setBufferMinutes(location.bookingBufferMinutes ?? (location.turnoverBufferEnabled ? 60 : 0));
      setAllowMultiDay(location.allowMultiDayBookings ?? true);
      setMaxBookingDays(location.maxBookingDays ?? 7);
      const weekly = location.weeklyChefHoursLimit ?? null;
      setWeeklyLimitEnabled(weekly != null);
      setWeeklyLimitHours(weekly ?? 8);
      setTaxRate(location.taxRatePercent == null || location.taxRatePercent === "" ? "" : String(Number(location.taxRatePercent)));
    }, [location]);

    // Update state when location changes
    useEffect(() => { resetLocalEdits(); }, [resetLocalEdits]);

    // Seed the arrival timings once their own query resolves. Safe to key off the
    // object because queries here never refetch on window focus (see
    // lib/queryClient.ts), so this cannot wipe an edit in progress.
    useEffect(() => {
      if (!arrivalSettings) return;
      setCheckinWindow(arrivalSettings.timeWindowSettings?.checkinWindowMinutesBefore ?? null);
    }, [arrivalSettings]);

    const discard = () => {
      resetLocalEdits();
      setMinimumDuration(minimumBookingHours ?? 0);
      setCheckinWindow(arrivalSettings?.timeWindowSettings?.checkinWindowMinutesBefore ?? null);
    };

    // Let the shell warn before navigating away with unsaved edits.
    useEffect(() => {
      onDirtyChange?.(isRulesDirty);
    }, [isRulesDirty, onDirtyChange]);

    // Cover browser refresh / tab close, which the in-app guard cannot intercept.
    useEffect(() => {
      if (!isRulesDirty) return;
      const handleBeforeUnload = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", handleBeforeUnload);
      return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [isRulesDirty]);

    const saveRules = useCallback(async () => {
      await onSave({
        locationId: location.id,
        cancellationPolicyHours: cancellationHours,
        defaultDailyBookingLimit: effectiveDailyLimit,
        minimumBookingWindowHours: minimumBookingWindowHours,
        ...(minimumBookingHours !== undefined ? { minimumBookingHours: minimumDuration } : {}),
        // Only send the newer settings to a server that told us about them.
        ...(hasWindow ? { maxAdvanceBookingDays: windowDays } : {}),
        ...(hasBuffer ? { bookingBufferMinutes: bufferMinutes } : {}),
        ...(hasMultiDay ? { allowMultiDayBookings: allowMultiDay, maxBookingDays } : {}),
        ...(hasWeeklyLimit ? { weeklyChefHoursLimit: effectiveWeeklyLimit } : {}),
        ...(!isKitchenMode ? {
          taxRatePercent: taxRate.trim() === "" ? null : Number(taxRate),
        } : {}),
      });
    }, [
      onSave, location.id, cancellationHours, effectiveDailyLimit, minimumBookingWindowHours, minimumBookingHours,
      minimumDuration, hasWindow, windowDays, hasBuffer, bufferMinutes, hasMultiDay, allowMultiDay, maxBookingDays,
      hasWeeklyLimit, effectiveWeeklyLimit, isKitchenMode, taxRate,
    ]);

    const saveTiming = useCallback(async () => {
      // null clears the per-location override so the platform default applies.
      await onSave({ locationId: location.id, checkinWindowMinutesBefore: checkinWindow });
      // The timings are served by the check-in/check-out endpoint, so refresh that cache too.
      await queryClient.invalidateQueries({ queryKey: ["checkin-checkout-settings", location.id] });
    }, [onSave, location.id, checkinWindow, queryClient]);
    const [confirmTiming, setConfirmTiming] = useState(0);

    const saveRulesAction = useStatusButton(saveRules);
    const timingPreview = <SettingChangePreview
      whatChanges={<>{checkinWindow !== (arrivalSettings?.timeWindowSettings?.checkinWindowMinutesBefore ?? null) && <span className="block">{mt('scpWindowWhat', { minutes: checkinWindow ?? arrivalSettings?.platformDefaults?.checkinWindowMinutesBefore, current: arrivalSettings?.timeWindowSettings?.checkinWindowMinutesBefore ?? arrivalSettings?.platformDefaults?.checkinWindowMinutesBefore })}</span>}</>}
      appliesTo={mt('scpTimingWhen', { kitchen: kitchenName || location.name })} impact={impact} impactFetching={impactFetching} impactError={impactError}
      rightNow={impact ? mt(impact.upcoming ? 'scpTimingImpact' : 'scpNone', { upcoming: impact.upcoming }) : undefined}
      undo={mt('scpTimingUndo')} confirm actionLabel={mt('scpSave')} onSave={saveTiming} openSignal={confirmTiming}
      align="end" secondaryAction={<Button variant="ghost" className="min-h-11" onClick={() => setCheckinWindow(arrivalSettings?.timeWindowSettings?.checkinWindowMinutesBefore ?? null)}>{mt("bpDiscard")}</Button>} />;

    // Used by the unsaved-changes guard to save before leaving.
    useImperativeHandle(ref, () => ({
      saveAllChanges: async () => {
        try {
          await saveRules();
        } catch {
          return false;
        }
        // Timing changes affect booked visits and need their own confirmation: open it rather than skip it or fail silently.
        if (timingChanged) {
          document.querySelector('[data-testid="arrival-timing-section"]')?.scrollIntoView?.({ behavior: "smooth", block: "center" });
          setConfirmTiming(count => count + 1);
          return false;
        }
        return true;
      },
    }), [saveRules, timingChanged]);

    // Keep the header action mounted through its success animation, even after the
    // refetched location clears the dirty flag.
    const showSaveAction = rulesChanged || saveRulesAction.status !== "idle";

    /** Kitchen: "Location default · Change for this kitchen" or "Set for this kitchen · Use the location's rule". */
    const scopeNote = (field: ResettablePolicyField) => {
      if (!isKitchenMode || !field) return null;
      const overridden = policyOverrides?.[field] != null;
      if (overridden && onResetPolicy) {
        return (
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>{mt("bpOverridden")}</span>
            <span aria-hidden>·</span>
            <button type="button" disabled={isRulesDirty || policyUpdating} onClick={() => onResetPolicy(field)}
              className="-my-3 inline-flex min-h-11 items-center gap-1 rounded-md px-1 font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline">
              {policyUpdating && <Loader2 className="h-3 w-3 animate-spin" />}
              {mt("kitchenPolicyReset")}
            </button>
            {isRulesDirty && <span className="basis-full">{mt("kitchenPolicyResetAfterSave")}</span>}
          </span>
        );
      }
      return (
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span>{mt("kitchenPolicyFromLocation")}</span>
          <span aria-hidden>·</span>
          <span>{mt("bpChangeForThisKitchen")}</span>
        </span>
      );
    };
    const locationUsage = (field: string, dirtyField: boolean): ReactNode => {
      if (isKitchenMode || !policyImpact?.fields?.[field]) return null;
      const info = policyImpact.fields[field];
      const followingNames = info.following.map((k) => k.name).join(", ");
      return (
        <span className="mt-1 block text-xs text-muted-foreground">
          {mt("bpUsedByKitchens", { count: info.usedBy })}
          {dirtyField && info.following.length > 0 ? (
            <span className="mt-1 block text-amber-700 dark:text-amber-400">{mt("bpLocationDefaultWarning", { kitchens: followingNames })}</span>
          ) : null}
          {dirtyField && info.overriding.length > 0 ? (
            <span className="mt-1 block">{mt("bpOverridesUnaffected", { kitchens: info.overriding.map((k) => k.name).join(", ") })}</span>
          ) : null}
        </span>
      );
    };
    const hint = (consequence: string, field?: ResettablePolicyField, dirtyField = false): ReactNode =>
      <><span className="block">{consequence}</span>{field ? scopeNote(field) : null}{field ? locationUsage(field, dirtyField) : null}</>;
    const kitchenOnlyNote = (
      <span className="mt-1 block text-xs text-muted-foreground">{mt("bpKitchenOnlyAtThisKitchen")}</span>
    );

    // One chef-facing sentence per changed rule: the same sentence the row shows, so the preview never says something new.
    const noticeLine = mt("bpNoticeValue", { count: minimumBookingWindowHours });
    const windowLine = mt("bpWindowValue", { count: windowDays });
    const shortestLine = mt("bpShortestValue", { count: minimumDuration });
    const longestLine = effectiveDailyLimit == null
      ? mt("bpLongestOff")
      : mt("bpLongestValue", { count: effectiveDailyLimit });
    const bufferLine = bufferMinutes === 0 ? mt("bpBufferOff")
      : bufferMinutes === 120 ? mt("bpBufferOnWhat2h")
      : mt("bpBufferOnWhat");
    const multiDayLine = allowMultiDay
      ? mt("bpMultiDayOnValue", { count: maxBookingDays })
      : mt("bpMultiDayOffValue");
    const weeklyLine = effectiveWeeklyLimit == null
      ? mt("bpWeeklyOff")
      : mt("bpWeeklyOnValue", { count: effectiveWeeklyLimit });
    const changeLines = [
      changed.notice && noticeLine,
      changed.window && windowLine,
      changed.shortest && shortestLine,
      changed.longest && longestLine,
      changed.multiDay && multiDayLine,
      changed.buffer && bufferLine,
      changed.weekly && weeklyLine,
      taxChanged && (taxRate.trim() === "" ? mt("bpTaxOffValue") : mt("bpTaxValue", { rate: taxRate })),
    ].filter((line): line is string => Boolean(line));

    const rulesPreview = rulesChanged && changeLines.length > 0 ? <SettingChangePreview
      whatChanges={changeLines.map((line) => <span key={line} className="block">{line}</span>)}
      appliesTo={mt("bpRulesWhen")} impact={impact} impactFetching={impactFetching} impactError={impactError}
      rightNow={impact ? mt("bpRulesImpact", { upcoming: impact.upcoming }) : undefined}
      undo={mt("bpRulesUndo")} /> : null;

    const rulesFooter = onRequestSave ? (
      <div className="space-y-3">
        {rulesPreview}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {rulesChanged && <Button variant="ghost" className="min-h-11" disabled={policyUpdating} onClick={discard}>{mt("bpDiscard")}</Button>}
          <Button className="min-h-11" variant={rulesChanged ? "default" : "outline"} disabled={!rulesChanged || policyUpdating} onClick={onRequestSave}>
            {mt("bpSaveRules")}
          </Button>
        </div>
      </div>
    ) : rulesPreview;

    return (
      <div className="space-y-8">
        {!hideHeader && <ChefPageHeader
          title={mt("navBookingRules")}
          description={mt("bpPageDescription")}
          actions={
            // One save for the whole page, in a stable spot near the title and
            // only while something is unsaved — the page spans several sections,
            // so an in-card action would sit next to only one of them.
            showSaveAction ? (
              <StatusButton
                status={saveRulesAction.status}
                onClick={saveRulesAction.execute}
                labels={{ idle: mt("scpSave"), loading: mt("savingShort"), success: mt("saved") }}
              />
            ) : undefined
          }
        />}

        <PolicySection title={mt("bpRulesTitle")} description={mt("bpRulesDescription")} footer={rulesFooter} testId="booking-rules-section">
          <div className="divide-y divide-border">
            <SettingsRow id="min-window" label={mt("bpNoticeLabel")} hint={hint(noticeLine, "minimumBookingWindowHours", changed.notice)}>
              <NumericInput id="min-window" disabled={policyUpdating} suffix={hourUnit(minimumBookingWindowHours)}
                value={String(minimumBookingWindowHours)} className="h-11 w-32"
                onValueChange={(val) => {
                  const parsed = parseInt(val, 10);
                  setMinimumBookingWindowHours(isNaN(parsed) ? 0 : Math.min(168, Math.max(0, parsed)));
                }} />
            </SettingsRow>

            {hasWindow && <SettingsRow id="booking-window" label={mt("bpWindowLabel")} hint={hint(windowLine, "maxAdvanceBookingDays", changed.window)}>
              <div className="flex flex-col items-end gap-1">
                <NumericInput id="booking-window" disabled={policyUpdating} suffix={mt("bpDaysUnit", { count: windowDays })}
                  value={String(windowDays)} className="h-11 w-32" aria-describedby={windowCap ? "booking-window-cap" : undefined}
                  onValueChange={(val) => {
                    const parsed = parseInt(val, 10);
                    // Never above the Local Cooks cap, never below 1 day: the server rejects both.
                    setWindowDays(isNaN(parsed) ? 1 : Math.min(windowCap ?? FALLBACK_WINDOW_CAP, Math.max(1, parsed)));
                  }} />
                {windowCap ? <span id="booking-window-cap" className="text-xs text-muted-foreground">{mt("bpWindowCap", { cap: windowCap })}</span> : null}
              </div>
            </SettingsRow>}

            {minimumBookingHours !== undefined && <SettingsRow id="kitchen-minimum-duration" label={mt("bpShortestLabel")}
              hint={<><span className="block">{shortestLine}</span>{kitchenOnlyNote}</>}>
              <NumericInput id="kitchen-minimum-duration" suffix={hourUnit(minimumDuration)} value={String(minimumDuration)}
                disabled={policyUpdating} className="h-11 w-32"
                onValueChange={(value) => setMinimumDuration(Math.min(24, Math.max(0, parseInt(value, 10) || 0)))} />
            </SettingsRow>}

            <SettingsRow id="daily-limit"
              label={effectiveDailyLimit == null ? mt("bpLongestLabelOff") : mt("bpLongestLabel", { count: effectiveDailyLimit })}
              hint={hint(longestLine, "defaultDailyBookingLimit", changed.longest)}
              help={mt("bpLongestHelp")}>
              <div className="flex flex-col items-end gap-2">
                <Switch id="daily-limit" checked={longestEnabled} disabled={policyUpdating}
                  onCheckedChange={setLongestEnabled} />
                {longestEnabled && <NumericInput id="daily-limit-hours" disabled={policyUpdating}
                  suffix={hourUnit(dailyBookingLimit)} value={String(dailyBookingLimit)} className="h-11 w-32"
                  onValueChange={(val) => setDailyBookingLimit(Math.min(24, Math.max(1, parseInt(val, 10) || 1)))} />}
              </div>
            </SettingsRow>

            {hasMultiDay && <>
              <SettingsRow id="allow-multiday" label={mt("bpMultiDayLabel")} help={mt("bpMultiDayHelp")}
                hint={hint(multiDayLine, "allowMultiDayBookings", changed.multiDay)}>
                <Switch id="allow-multiday" checked={allowMultiDay} disabled={policyUpdating}
                  onCheckedChange={setAllowMultiDay} />
              </SettingsRow>
              {allowMultiDay && <SettingsRow id="max-booking-days" label={mt("bpMaxDaysLabel", { count: maxBookingDays })}
                hint={hint(mt("bpMaxDaysHint"), "maxBookingDays", changed.multiDay)}>
                <div className="flex flex-col items-end gap-1">
                  <NumericInput id="max-booking-days" disabled={policyUpdating} suffix={mt("bpDaysUnit", { count: maxBookingDays })}
                    value={String(maxBookingDays)} className="h-11 w-32" aria-describedby="max-booking-days-cap"
                    onValueChange={(val) => {
                      const parsed = parseInt(val, 10);
                      setMaxBookingDays(isNaN(parsed) ? 1 : Math.min(daysCap, Math.max(1, parsed)));
                    }} />
                  <span id="max-booking-days-cap" className="text-xs text-muted-foreground">{mt("bpMaxDaysCap", { cap: daysCap })}</span>
                </div>
              </SettingsRow>}
            </>}

            {hasBuffer && <SettingsRow id="turnover-buffer" label={mt("bpBufferLabel")} help={mt("bpBufferHelp")}
              hint={hint(bufferMinutes === 0 ? mt("bpBufferOff") : bufferMinutes === 120 ? mt("bpBufferOn2h") : mt("bpBufferOn"), "bookingBufferMinutes", changed.buffer)}>
              <Select value={String(bufferMinutes)} disabled={policyUpdating}
                onValueChange={(value) => setBufferMinutes(Number(value) as 0 | 60 | 120)}>
                <SelectTrigger id="turnover-buffer" className={SELECT_CLASS}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{mt("bpBufferOptionOff")}</SelectItem>
                  <SelectItem value="60">{mt("bpBufferOption1h")}</SelectItem>
                  <SelectItem value="120">{mt("bpBufferOption2h")}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>}

            {hasWeeklyLimit && isKitchenMode && <SettingsRow id="weekly-chef-limit" label={mt("bpWeeklyLabel")} help={mt("bpWeeklyHelp")}
              hint={<><span className="block">{weeklyLine}</span>{kitchenOnlyNote}</>}>
              <div className="flex flex-col items-end gap-2">
                <Switch id="weekly-chef-limit" checked={weeklyLimitEnabled} disabled={policyUpdating}
                  onCheckedChange={setWeeklyLimitEnabled} />
                {weeklyLimitEnabled && <NumericInput id="weekly-chef-limit-hours" disabled={policyUpdating}
                  suffix={hourUnit(weeklyLimitHours)} value={String(weeklyLimitHours)} className="h-11 w-32"
                  onValueChange={(val) => setWeeklyLimitHours(Math.min(168, Math.max(1, parseInt(val, 10) || 1)))} />}
              </div>
            </SettingsRow>}

            {!isKitchenMode && <SettingsRow id="location-tax" label={mt("bpTaxLabel")}
              hint={<><span className="block">{mt("bpTaxLocationHint")}</span>
                <span className="mt-1 block text-xs">{mt("bpTaxUsedByAllKitchens", { count: (policyImpact as { kitchenCount?: number } | undefined)?.kitchenCount ?? 0 })}</span>
                {taxChanged ? <span className="mt-1 block text-amber-700 dark:text-amber-400">{mt("bpTaxFanOutWarning")}</span> : null}
              </>}>
              <NumericInput id="location-tax" allowDecimals suffix="%" value={taxRate} className="h-11 w-32"
                disabled={policyUpdating} placeholder={mt("eG13")}
                onValueChange={setTaxRate} />
            </SettingsRow>}
          </div>
        </PolicySection>

        {!isKitchenMode && <LocationCancellationPolicyEditor locationId={location.id} />}

        {!hideArrivalTimings && (
          /* Arrival timing. Also on the check-in/check-out page, which is intentional —
             both pages read and write the same query-cached field. */
          <PolicySection title={mt("arrivalTiming")} testId="arrival-timing-section" description={mt("arrivalTimingDescription")} footer={timingChanged ? timingPreview : undefined}>
            <div className="divide-y divide-border">
              <SettingsRow id="checkin-window" label={mt("checkinOpensLabel")}
                hint={arrivalSettings?.platformDefaults ? mt("platformDefaultIs", { minutes: mt("minutesShort", { count: arrivalSettings.platformDefaults.checkinWindowMinutesBefore }) }) : undefined}
                help={mt("checkinWindowHelp")}>
                <NumericInput id="checkin-window" suffix={mt("minutesUnit")}
                  value={checkinWindow === null ? "" : String(checkinWindow)} className="h-11 w-32"
                  onValueChange={(val) => {
                    const parsed = parseInt(val, 10);
                    setCheckinWindow(val.trim() === "" || isNaN(parsed) ? null : Math.min(120, Math.max(0, parsed)));
                  }} />
              </SettingsRow>
              {onNavigate && (
                <div className="flex justify-end px-4 py-2">
                  <Button variant="ghost" className="min-h-11 gap-1.5" onClick={() => onNavigate("settings-checkin-checkout")}>
                    <ClipboardCheck className="h-4 w-4" />{mt("goToCheckinChecklist")}<ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </PolicySection>
        )}

        {!hideDamagePolicy && <ManagerDamagePolicySection />}
        {!hideTerms && <KitchenTermsSection location={location} note={termsNote} readOnly={isKitchenMode}
          locationName={place} onEditLocation={onEditLocation} />}
      </div>
    );
  },
);

BookingRulesSettings.displayName = "BookingRulesSettings";

export default BookingRulesSettings;
