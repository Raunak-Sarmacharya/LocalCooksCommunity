import { mt } from "@/i18n/manager";
/**
 * Booking Policies Settings Component
 *
 * Manages the cancellation policy, daily booking limit and minimum booking window
 * for a location, plus the kitchen terms & conditions chefs must accept when booking.
 *
 * Layout notes:
 * - The policy fields are saved explicitly; the save action only appears while there
 *   are unsaved edits, so the page is quiet at rest.
 * - Terms upload saves immediately on its own (different endpoint), hence its own card.
 */

import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { FileText, ExternalLink, ClipboardCheck, ArrowRight } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { apiGet } from "@/lib/api";
import { tt } from "@/i18n/common-ns";
import { getDocumentFilename } from "@/lib/formatters";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NumericInput } from "@/components/ui/numeric-input";
import { ChefPageHeader } from "@/components/chef/ui";
import { SettingsFileUpload } from "./SettingsFileUpload";
import { AuthenticatedDocumentLink } from "./AuthenticatedDocumentLink";
import { SettingsRow } from "./SettingsRow";
import { arrivalTimingsLocked } from "./shared/ChecklistEditor";

interface Location {
  id: number;
  name: string;
  cancellationPolicyHours?: number;
  defaultDailyBookingLimit?: number;
  minimumBookingWindowHours?: number;
  kitchenTermsUrl?: string | null;
  kitchenTermsUploadedAt?: string | null;
}

interface BookingRulesSettingsProps {
  location: Location;
  onSave: (updates: any) => Promise<unknown>;
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
}

/** Shape of the arrival-timing values, which are owned by the check-in/check-out endpoint. */
interface ArrivalTimings {
  /** Present on the same payload; drives whether the timings below are editable. */
  checkinEnabled?: boolean;
  checkoutEnabled?: boolean;
  timeWindowSettings?: {
    checkinWindowMinutesBefore: number | null;
    noShowGraceMinutes: number | null;
  };
  platformDefaults?: {
    checkinWindowMinutesBefore: number;
    noShowGraceMinutes: number;
  };
}

export interface BookingPoliciesHandle {
  /** Persist pending edits. Resolves `true` when the save succeeded. */
  saveAllChanges: () => Promise<boolean>;
}

const BookingRulesSettings = forwardRef<BookingPoliciesHandle, BookingRulesSettingsProps>(
  function BookingRulesSettings({ location, onSave, onDirtyChange, onNavigate, hideArrivalTimings = false, hideTerms = false }, ref) {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Cancellation Policy State
    const [cancellationHours, setCancellationHours] = useState(location.cancellationPolicyHours || 24);

    // Daily Booking Limit State
    const [dailyBookingLimit, setDailyBookingLimit] = useState(location.defaultDailyBookingLimit || 2);

    // Minimum Booking Window State
    const [minimumBookingWindowHours, setMinimumBookingWindowHours] = useState(location.minimumBookingWindowHours ?? 1);

    // Terms & Conditions State
    const [termsFile, setTermsFile] = useState<File | null>(null);
    const [isReplacingTerms, setIsReplacingTerms] = useState(false);

    // Arrival timings. These live on the locations table but the check-in/check-out
    // endpoint owns them, so read them (plus the platform defaults shown as hints)
    // from there rather than from the locations list. Sharing the query key with
    // that page means one cache entry, not two.
    const { data: arrivalSettings } = useQuery<ArrivalTimings>({
      queryKey: ["checkin-checkout-settings", location.id],
      queryFn: () => apiGet(`/manager/locations/${location.id}/checkin-checkout-settings`),
      enabled: !!location.id,
    });

    const [checkinWindow, setCheckinWindow] = useState<number | null>(null);
    const [noShowGrace, setNoShowGrace] = useState<number | null>(null);

    const isRulesDirty = cancellationHours !== (location.cancellationPolicyHours || 24)
      || dailyBookingLimit !== (location.defaultDailyBookingLimit || 2)
      || minimumBookingWindowHours !== (location.minimumBookingWindowHours ?? 1)
      || checkinWindow !== (arrivalSettings?.timeWindowSettings?.checkinWindowMinutesBefore ?? null)
      || noShowGrace !== (arrivalSettings?.timeWindowSettings?.noShowGraceMinutes ?? null);

    const hasTerms = Boolean(location.kitchenTermsUrl);
    const showTermsUpload = !hasTerms || isReplacingTerms;

    // Suffix follows the value: "1 hour" vs "24 hours". Uses ICU plurals so
    // locales with more than two forms (uk) resolve correctly.
    const hourUnit = (value: number) => mt("hourUnit", { count: value });

    // Update state when location changes
    useEffect(() => {
      setCancellationHours(location.cancellationPolicyHours || 24);
      setDailyBookingLimit(location.defaultDailyBookingLimit || 2);
      setMinimumBookingWindowHours(location.minimumBookingWindowHours ?? 1);
    }, [location]);

    // Seed the arrival timings once their own query resolves. Safe to key off the
    // object because queries here never refetch on window focus (see
    // lib/queryClient.ts), so this cannot wipe an edit in progress.
    useEffect(() => {
      if (!arrivalSettings) return;
      setCheckinWindow(arrivalSettings.timeWindowSettings?.checkinWindowMinutesBefore ?? null);
      setNoShowGrace(arrivalSettings.timeWindowSettings?.noShowGraceMinutes ?? null);
    }, [arrivalSettings]);

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
        defaultDailyBookingLimit: dailyBookingLimit,
        minimumBookingWindowHours: minimumBookingWindowHours,
        // null clears the per-location override so the platform default applies.
        checkinWindowMinutesBefore: checkinWindow,
        noShowGraceMinutes: noShowGrace,
      });
      // The timings are served by the check-in/check-out endpoint, so refresh that
      // cache too or the page would keep rendering the pre-save values.
      queryClient.invalidateQueries({ queryKey: ["checkin-checkout-settings", location.id] });
    }, [
      onSave,
      location.id,
      cancellationHours,
      dailyBookingLimit,
      minimumBookingWindowHours,
      checkinWindow,
      noShowGrace,
      queryClient,
    ]);

    const saveRulesAction = useStatusButton(saveRules);

    // Used by the unsaved-changes guard to save before leaving.
    useImperativeHandle(ref, () => ({
      saveAllChanges: async () => {
        try {
          await saveRules();
          return true;
        } catch {
          return false;
        }
      },
    }), [saveRules]);

    const uploadTerms = useCallback(async () => {
      if (!termsFile) return;
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error(tt("firebaseUserNotAvailable"));
        const token = await currentUser.getIdToken();
        const formData = new FormData();
        formData.append("file", termsFile);
        const uploadResponse = await fetch("/api/files/upload-file", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
          body: formData,
        });
        if (!uploadResponse.ok) throw new Error((await uploadResponse.json().catch(() => ({}))).error || tt("failedToUploadTermsDoc"));
        const uploaded = await uploadResponse.json();
        const updateResponse = await fetch(`/api/manager/locations/${location.id}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ kitchenTermsUrl: uploaded.url }),
        });
        if (!updateResponse.ok) throw new Error((await updateResponse.json().catch(() => ({}))).error || tt("failedToUploadTermsDoc"));
        setTermsFile(null);
        queryClient.invalidateQueries({ queryKey: ["locationDetails", location.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
        toast({ title: mt("termsUploaded"), description: mt("yourTermsAndConditionsHaveBeenUploadedSuccessfully") });
      } catch (error) {
        toast({ title: mt("uploadFailed"), description: error instanceof Error ? error.message : tt("failedToUploadTermsDoc"), variant: "destructive" });
        // Re-throw so the StatusButton can show its error state.
        throw error;
      }
    }, [termsFile, location.id, queryClient, toast]);

    const termsUploadAction = useStatusButton(uploadTerms);

    const closeTermsUpload = () => {
      setTermsFile(null);
      setIsReplacingTerms(false);
    };

    // Keep the action mounted through its success animation, even after the
    // refetched location clears the dirty flag.
    const showSaveAction = isRulesDirty || saveRulesAction.status !== "idle";

    return (
      <div className="space-y-6">
        <ChefPageHeader
          title={mt("navBookingRules")}
          description={mt("configureCancellationPoliciesBookingLimitsAndPenaltiesForYou")}
          actions={
            // One save for the whole page, in a stable spot near the title and
            // only while something is unsaved — the page now spans three cards,
            // so an in-card action would sit next to only one of them.
            showSaveAction ? (
              <StatusButton
                status={saveRulesAction.status}
                onClick={saveRulesAction.execute}
                labels={{ idle: mt("saveChanges"), loading: mt("savingShort"), success: mt("saved") }}
              />
            ) : undefined
          }
        />

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-lg">{mt("bookingPoliciesLimits")}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            <SettingsRow
              id="cancellation-hours"
              label={mt("cancellationWindow")}
              hint={mt("minimumHoursBeforeCancellationAllowed")}
              help={mt("cancellationRefundPlatformNote")}
            >
              <NumericInput
                id="cancellation-hours"
                suffix={hourUnit(cancellationHours)}
                value={String(cancellationHours)}
                onValueChange={(val) => setCancellationHours(parseInt(val) || 0)}
                className="w-32"
              />
            </SettingsRow>

            <SettingsRow
              id="daily-limit"
              label={mt("dailyBookingLimit")}
              hint={mt("maximumHoursAChefCanBookInASingleDay124Hours")}
              help={mt("youCanOverrideThisLimitForSpecificDatesInTheAvailabilityCale")}
            >
              <NumericInput
                id="daily-limit"
                suffix={hourUnit(dailyBookingLimit)}
                value={String(dailyBookingLimit)}
                onValueChange={(val) => setDailyBookingLimit(parseInt(val) || 2)}
                className="w-32"
              />
            </SettingsRow>

            <SettingsRow
              id="min-window"
              label={mt("minimumBookingWindow")}
              hint={mt("chefsMustBookAtLeastHours")}
              help={mt("exampleWith1HourIfItS100PMChefsCanOnlyBookTimesStartingFrom2")}
            >
              <NumericInput
                id="min-window"
                suffix={hourUnit(minimumBookingWindowHours)}
                value={String(minimumBookingWindowHours)}
                onValueChange={(val) => {
                  const parsed = parseInt(val, 10);
                  setMinimumBookingWindowHours(isNaN(parsed) ? 0 : Math.min(168, Math.max(0, parsed)));
                }}
                className="w-32"
              />
            </SettingsRow>
          </CardContent>
        </Card>

        {!hideArrivalTimings && (
          <>
        {/* Arrival timing. These two values also appear on the check-in/check-out
            page, which is intentional — both pages read and write the same
            query-cached field, so a manager never has to leave the page they are
            already on to set when arrival opens. Locked (and explained) on both
            pages whenever neither flow is switched on. */}
        <Card>
          <CardHeader className="p-4 pb-3">
            <CardTitle className="text-lg">{mt("arrivalTiming")}</CardTitle>
            <CardDescription>
              {arrivalTimingsLocked(arrivalSettings ?? undefined)
                ? mt("arrivalTimingLockedDescription")
                : mt("arrivalTimingDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            <SettingsRow
              id="checkin-window"
              label={mt("checkinOpensLabel")}
              disabledReason={
                arrivalTimingsLocked(arrivalSettings ?? undefined)
                  ? mt("enableStageToEditTimings")
                  : undefined
              }
              hint={
                arrivalSettings?.platformDefaults
                  ? mt("platformDefaultIs", {
                      minutes: mt("minutesShort", {
                        count: arrivalSettings.platformDefaults.checkinWindowMinutesBefore,
                      }),
                    })
                  : undefined
              }
              help={mt("checkinWindowHelp")}
            >
              <NumericInput
                id="checkin-window"
                disabled={arrivalTimingsLocked(arrivalSettings ?? undefined)}
                suffix={mt("minutesUnit")}
                value={checkinWindow === null ? "" : String(checkinWindow)}
                onValueChange={(val) => {
                  const parsed = parseInt(val, 10);
                  setCheckinWindow(
                    val.trim() === "" || isNaN(parsed) ? null : Math.min(120, Math.max(0, parsed)),
                  );
                }}
                className="w-32"
              />
            </SettingsRow>

            <SettingsRow
              id="no-show-grace"
              label={mt("noShowGraceLabel")}
              disabledReason={
                arrivalTimingsLocked(arrivalSettings ?? undefined)
                  ? mt("enableStageToEditTimings")
                  : undefined
              }
              hint={
                arrivalSettings?.platformDefaults
                  ? mt("platformDefaultIs", {
                      minutes: mt("minutesShort", {
                        count: arrivalSettings.platformDefaults.noShowGraceMinutes,
                      }),
                    })
                  : undefined
              }
              help={mt("noShowGraceHelp")}
            >
              <NumericInput
                id="no-show-grace"
                disabled={arrivalTimingsLocked(arrivalSettings ?? undefined)}
                suffix={mt("minutesUnit")}
                value={noShowGrace === null ? "" : String(noShowGrace)}
                onValueChange={(val) => {
                  const parsed = parseInt(val, 10);
                  setNoShowGrace(
                    val.trim() === "" || isNaN(parsed) ? null : Math.min(120, Math.max(0, parsed)),
                  );
                }}
                className="w-32"
              />
            </SettingsRow>

            {onNavigate && (
              <div className="flex justify-end px-4 py-3">
                <button
                  type="button"
                  onClick={() => onNavigate("settings-checkin-checkout")}
                  className="inline-flex items-center gap-1.5 rounded-md text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ClipboardCheck className="h-4 w-4" />
                  {mt("goToCheckinChecklist")}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </CardContent>
        </Card>

          </>
        )}

        {!hideTerms && (
          <>
        {/* Terms & Conditions — saves on upload, independent of the policy save action */}
        <Card>
          <CardHeader className="p-4 pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-lg">{mt("termsConditions")}</CardTitle>
                <CardDescription>{mt("uploadTermsThatChefsMustAgreeToWhenBooking")}</CardDescription>
              </div>
              {hasTerms && !isReplacingTerms && (
                <Button variant="outline" size="sm" onClick={() => setIsReplacingTerms(true)}>
                  {mt("replace")}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            {hasTerms && (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {getDocumentFilename(location.kitchenTermsUrl) || mt("termsConditions")}
                  </p>
                  {location.kitchenTermsUploadedAt && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {mt("uploaded")} {new Date(location.kitchenTermsUploadedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <AuthenticatedDocumentLink
                  url={location.kitchenTermsUrl}
                  className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline"
                >
                  {mt("viewDocument")}
                  <ExternalLink className="h-3.5 w-3.5" />
                </AuthenticatedDocumentLink>
              </div>
            )}

            {showTermsUpload && (
              <div className="space-y-3">
                <SettingsFileUpload
                  id="terms-upload"
                  accept=".pdf"
                  file={termsFile}
                  label={mt("chooseTermsAndConditions")}
                  hint={mt("pDFOnlyMax5MB")}
                  disabled={termsUploadAction.status === "loading"}
                  onChange={setTermsFile}
                />
                {(termsFile || termsUploadAction.status !== "idle") && (
                  <div className="flex justify-end gap-2">
                    {hasTerms && (
                      <Button variant="ghost" onClick={closeTermsUpload} disabled={termsUploadAction.status === "loading"}>
                        {mt("cancel")}
                      </Button>
                    )}
                    <StatusButton
                      status={termsUploadAction.status}
                      onClick={termsUploadAction.execute}
                      labels={{
                        idle: hasTerms ? mt("replace") : mt("uploadTerms"),
                        loading: mt("uploading"),
                        success: mt("saved"),
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
          </>
        )}
      </div>
    );
  },
);

BookingRulesSettings.displayName = "BookingRulesSettings";

export default BookingRulesSettings;
