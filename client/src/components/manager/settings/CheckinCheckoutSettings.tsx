/**
 * Kitchen Check-In / Check-Out Settings
 *
 * Manager-controlled check-in and check-out checklists for kitchens, including
 * per-item photo requirements and optional arrival instructions.
 *
 * Deliberately scoped to *the checklist itself*. Everything that describes
 * *when* a booking happens — the check-in window and the no-show grace period —
 * lives on the Booking Policies page, and the arrival-timing card there links
 * back to this page. Storage check-out lives on its own page.
 *
 * Save model: one page-level Save covering every field on this page. Nothing
 * here autosaves, and the exit guard is wired to the same dirty flag, so the
 * two can never disagree about whether work is at risk.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { mt } from "@/i18n/manager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MutableRefObject, Ref } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Clock,
  Loader2,
} from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPut } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsRow } from "./SettingsRow";
import type { ChecklistItem, PhotoRequirement } from "./shared/ChecklistEditor";
import {
  KitchenCheckinCheckoutEditor,
  findUnifiedItemProblems,
  itemsToStorage,
  unifyStorageToItems,
  type UnifiedChecklistItem,
} from "./KitchenCheckinCheckoutEditor";
import { ChefPageHeader } from "@/components/chef/ui";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckinCheckoutSettingsData {
  id: number | null;
  locationId: number;
  checkinEnabled: boolean;
  checkinItems: ChecklistItem[];
  checkinPhotoRequirements: PhotoRequirement[];
  checkinInstructions: string | null;
  checkoutEnabled: boolean;
  checkoutItems: ChecklistItem[];
  checkoutPhotoRequirements: PhotoRequirement[];
  checkoutInstructions: string | null;
  smartLockCheckinInstructions: string | null;
  timeWindowSettings?: TimeWindowSettings;
  platformDefaults?: PlatformTimeWindowDefaults;
}

/**
 * Manager-overridable arrival timings. `null` means "use the platform default",
 * which is shown next to the field so the effective value is never a mystery.
 */
interface TimeWindowSettings {
  checkinWindowMinutesBefore: number | null;
  noShowGraceMinutes: number | null;
}

interface PlatformTimeWindowDefaults {
  checkinWindowMinutesBefore: number;
  noShowGraceMinutes: number;
}

/** Imperative handle so the dashboard shell can trigger Save from its header. */
export interface CheckinCheckoutHandle {
  save: () => void;
}

interface CheckinCheckoutSettingsProps {
  location: {
    id: number;
    name: string;
  };
  /**
   * Receives the page's dirty state so the dashboard can show the shared save
   * action and guard navigation. Called on every transition only.
   */
  onDirtyChange?: (dirty: boolean) => void;
  saveRef?: Ref<CheckinCheckoutHandle>;
  /**
   * Navigate to another manager view. Typed to the single destination this page
   * links to, matching the convention used by `BookingRulesSettings` — the shell
   * passes `handleViewChange`, which accepts a wider union.
   */
  onNavigate?: (view: "settings-booking-rules") => void;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CheckinCheckoutSettings({
  location,
  onDirtyChange,
  saveRef,
  onNavigate,
}: CheckinCheckoutSettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch existing settings
  const { data, isLoading } = useQuery<CheckinCheckoutSettingsData>({
    queryKey: ["checkin-checkout-settings", location.id],
    queryFn: () =>
      apiGet(`/manager/locations/${location.id}/checkin-checkout-settings`),
    enabled: !!location.id,
  });

  // Fetch kitchens to determine if ANY kitchen at this location has the
  // admin-controlled smart-door capability enabled. When none do, the smart
  // lock instructions textarea and all related UI is hidden from the manager.
  const { data: kitchensAtLocation } = useQuery<
    Array<{ id: number; smartLockAvailable?: boolean; smart_lock_available?: boolean }>
  >({
    queryKey: ["manager-kitchens-smart-availability", location.id],
    queryFn: () => apiGet(`/manager/kitchens/${location.id}`),
    enabled: !!location.id,
  });

  const hasSmartLockKitchen = useMemo(() => {
    if (!kitchensAtLocation) return false;
    return kitchensAtLocation.some((k: any) =>
      Boolean(k.smartLockAvailable ?? k.smart_lock_available ?? false),
    );
  }, [kitchensAtLocation]);

  // Kitchen check-in/out local state.
  // Items are held in a single unified list; split into server-side
  // checkinItems / checkoutItems arrays on save.
  const [checkinEnabled, setCheckinEnabled] = useState(false);
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [items, setItems] = useState<UnifiedChecklistItem[]>([]);
  const [checkinInstructions, setCheckinInstructions] = useState<string | null>(null);
  const [checkoutInstructions, setCheckoutInstructions] = useState<string | null>(null);
  const [smartLockCheckinInstructions, setSmartLockCheckinInstructions] =
    useState<string | null>(null);

  // Arrival timings (null = inherit the platform default).
  const [twCheckinWindow, setTwCheckinWindow] = useState<number | null>(null);
  const [twNoShowGrace, setTwNoShowGrace] = useState<number | null>(null);

  // Memoized initial unified list derived from server data. Kept in a memo so
  // we can reuse it for the "isDirty" comparison below without re-running the
  // merge repeatedly.
  const initialUnifiedItems = useMemo<UnifiedChecklistItem[]>(() => {
    if (!data) return [];
    return unifyStorageToItems({
      checkinItems: (Array.isArray(data.checkinItems) ? data.checkinItems : []) as ChecklistItem[],
      checkoutItems: (Array.isArray(data.checkoutItems) ? data.checkoutItems : []) as ChecklistItem[],
      checkinPhotoRequirements: (Array.isArray(data.checkinPhotoRequirements)
        ? data.checkinPhotoRequirements
        : []) as PhotoRequirement[],
      checkoutPhotoRequirements: (Array.isArray(data.checkoutPhotoRequirements)
        ? data.checkoutPhotoRequirements
        : []) as PhotoRequirement[],
    });
  }, [data]);

  // Sync from server data
  useEffect(() => {
    if (data) {
      setCheckinEnabled(data.checkinEnabled);
      setCheckoutEnabled(data.checkoutEnabled);
      setCheckinInstructions(data.checkinInstructions);
      setCheckoutInstructions(data.checkoutInstructions);
      setSmartLockCheckinInstructions(data.smartLockCheckinInstructions);
      setItems(initialUnifiedItems);
      if (data.timeWindowSettings) {
        setTwCheckinWindow(data.timeWindowSettings.checkinWindowMinutesBefore);
        setTwNoShowGrace(data.timeWindowSettings.noShowGraceMinutes);
      }
    }
  }, [data, initialUnifiedItems]);

  const isDirty = useMemo(() => {
    if (!data) return false;
    return (
      checkinEnabled !== data.checkinEnabled ||
      checkoutEnabled !== data.checkoutEnabled ||
      JSON.stringify(items) !== JSON.stringify(initialUnifiedItems) ||
      (checkinInstructions || null) !== (data.checkinInstructions || null) ||
      (checkoutInstructions || null) !== (data.checkoutInstructions || null) ||
      (smartLockCheckinInstructions || null) !== (data.smartLockCheckinInstructions || null) ||
      twCheckinWindow !== (data.timeWindowSettings?.checkinWindowMinutesBefore ?? null) ||
      twNoShowGrace !== (data.timeWindowSettings?.noShowGraceMinutes ?? null)
    );
  }, [
    data,
    initialUnifiedItems,
    checkinEnabled,
    checkoutEnabled,
    items,
    checkinInstructions,
    checkoutInstructions,
    smartLockCheckinInstructions,
    twCheckinWindow,
    twNoShowGrace,
  ]);

  /**
   * Problems that would silently truncate the configuration on save. Reported
   * per-row rather than as a count, so the message can name the offending item.
   */
  const problems = useMemo(() => findUnifiedItemProblems(items), [items]);

  const hasProblems = problems.empty.length > 0 || problems.unassigned.length > 0;

  const saveAction = useStatusButton(
    useCallback(async () => {
      if (hasProblems) {
        throw new Error(mt("fixChecklistItemsBeforeSaving"));
      }

      const {
        checkinItems: outCheckinItems,
        checkoutItems: outCheckoutItems,
        checkinPhotoRequirements: outCheckinPhotos,
        checkoutPhotoRequirements: outCheckoutPhotos,
      } = itemsToStorage(items);

      await apiPut(`/manager/locations/${location.id}/checkin-checkout-settings`, {
        checkinEnabled,
        checkinItems: outCheckinItems,
        checkinPhotoRequirements: outCheckinPhotos,
        checkinInstructions: checkinInstructions || null,
        checkoutEnabled,
        checkoutItems: outCheckoutItems,
        checkoutPhotoRequirements: outCheckoutPhotos,
        checkoutInstructions: checkoutInstructions || null,
        smartLockCheckinInstructions: smartLockCheckinInstructions || null,
        timeWindowSettings: {
          checkinWindowMinutesBefore: twCheckinWindow,
          noShowGraceMinutes: twNoShowGrace,
        },
      });

      queryClient.invalidateQueries({
        queryKey: ["checkin-checkout-settings", location.id],
      });

      toast({
        title: mt("checklistsSaved"),
        description: mt("kitchenCheckInCheckOutChecklistsUpdatedSuccessfully"),
      });
    }, [
      location.id,
      items,
      checkinEnabled,
      checkoutEnabled,
      checkinInstructions,
      checkoutInstructions,
      smartLockCheckinInstructions,
      twCheckinWindow,
      twNoShowGrace,
      hasProblems,
      queryClient,
      toast,
    ]),
  );

  // Report dirty state upward, but only on transitions — the shell re-renders
  // on every keystroke otherwise.
  const lastDirtyRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastDirtyRef.current === isDirty) return;
    lastDirtyRef.current = isDirty;
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Expose save() to the shell's header action.
  useEffect(() => {
    if (!saveRef) return;
    const handle: CheckinCheckoutHandle = { save: () => void saveAction.execute() };
    if (typeof saveRef === "function") saveRef(handle);
    else (saveRef as MutableRefObject<CheckinCheckoutHandle | null>).current = handle;
  }, [saveRef, saveAction.execute]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <ChefPageHeader
          title={mt("kitchenCheckInCheckOut")}
          description={mt("configureChecklistsAndPhotoRequirementsForYourKitchens")}
        />
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">{mt("loadingSettings")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ChefPageHeader
        title={mt("kitchenCheckInCheckOut")}
        description={mt("checkinCheckoutPageDescription")}
        actions={
          isDirty ? (
            <StatusButton
              status={saveAction.status}
              onClick={saveAction.execute}
              disabled={hasProblems}
              labels={{
                idle: mt("saveChanges"),
                loading: mt("savingShort"),
                success: mt("saved"),
              }}
            />
          ) : undefined
        }
      />

      {/* Items that cannot be saved as-is — surfaced before the rows so the
          manager sees the reason, not just a disabled button. */}
      {hasProblems && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="space-y-0.5 text-xs text-destructive">
            {problems.empty.length > 0 && (
              <p>{mt("checklistEmptyLabels", { count: problems.empty.length })}</p>
            )}
            {problems.unassigned.length > 0 && (
              <p>{mt("checklistUnassignedItems", { count: problems.unassigned.length })}</p>
            )}
          </div>
        </div>
      )}

      {/* Checklist editor */}
      <KitchenCheckinCheckoutEditor
        items={items}
        onItemsChange={setItems}
        checkinEnabled={checkinEnabled}
        onCheckinEnabledChange={setCheckinEnabled}
        checkoutEnabled={checkoutEnabled}
        onCheckoutEnabledChange={setCheckoutEnabled}
        checkinInstructions={checkinInstructions}
        onCheckinInstructionsChange={setCheckinInstructions}
        checkoutInstructions={checkoutInstructions}
        onCheckoutInstructionsChange={setCheckoutInstructions}
        smartLockInstructions={smartLockCheckinInstructions}
        onSmartLockInstructionsChange={setSmartLockCheckinInstructions}
        smartLockAvailable={hasSmartLockKitchen}
      />

      {/* Arrival timings. Shown here as well as on Booking Policies — both read
          and write the same query-cached field, so a manager setting up the
          arrival experience never has to leave this page. */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <Clock className="size-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">{mt("arrivalTiming")}</CardTitle>
              <CardDescription>{mt("arrivalTimingDescription")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="divide-y p-0">
          <SettingsRow
            id="checkin-window"
            label={mt("checkinOpensLabel")}
            hint={
              data?.platformDefaults
                ? mt("platformDefaultIs", {
                    value: data.platformDefaults.checkinWindowMinutesBefore,
                  })
                : undefined
            }
            help={mt("checkinWindowHelp")}
          >
            <div className="flex items-center gap-1.5">
              <Input
                id="checkin-window"
                type="number"
                min={0}
                max={120}
                inputMode="numeric"
                value={twCheckinWindow ?? ""}
                placeholder={
                  data?.platformDefaults
                    ? String(data.platformDefaults.checkinWindowMinutesBefore)
                    : "15"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setTwCheckinWindow(v === "" ? null : Math.max(0, Math.min(120, parseInt(v, 10) || 0)));
                }}
                className="h-9 w-20 text-sm tabular-nums"
              />
              <span className="text-xs text-muted-foreground">{mt("minutesShort")}</span>
            </div>
          </SettingsRow>

          <SettingsRow
            id="no-show-grace"
            label={mt("noShowGraceLabel")}
            hint={
              data?.platformDefaults
                ? mt("platformDefaultIs", {
                    value: data.platformDefaults.noShowGraceMinutes,
                  })
                : undefined
            }
            help={mt("noShowGraceHelp")}
          >
            <div className="flex items-center gap-1.5">
              <Input
                id="no-show-grace"
                type="number"
                min={0}
                max={120}
                inputMode="numeric"
                value={twNoShowGrace ?? ""}
                placeholder={
                  data?.platformDefaults
                    ? String(data.platformDefaults.noShowGraceMinutes)
                    : "30"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  setTwNoShowGrace(v === "" ? null : Math.max(0, Math.min(120, parseInt(v, 10) || 0)));
                }}
                className="h-9 w-20 text-sm tabular-nums"
              />
              <span className="text-xs text-muted-foreground">{mt("minutesShort")}</span>
            </div>
          </SettingsRow>
        </CardContent>
      </Card>

      {/* Soft cross-link to the rest of the booking rules, for managers who came
          here looking for something else rather than to duplicate the fields. */}
      <button
        type="button"
        onClick={() => onNavigate?.("settings-booking-rules")}
        className="!min-h-0 flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted/50"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
          <Calendar className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{mt("navBookingRules")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {mt("bookingRulesCrossLinkHint")}
          </p>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {/* Sticky save bar. The header Save is the primary action and stays for
          consistency with the other settings pages, but on a page whose content
          is a long editable list it can be scrolled far out of view — so while
          something is unsaved, a pinned bar mirrors it next to the work. */}
      {isDirty && (
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="size-3.5 text-amber-500" />
            {mt("unsavedChanges")}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg px-2 text-xs hover:bg-muted"
              onClick={() => {
                setCheckinEnabled(data?.checkinEnabled ?? false);
                setCheckoutEnabled(data?.checkoutEnabled ?? false);
                setCheckinInstructions(data?.checkinInstructions ?? null);
                setCheckoutInstructions(data?.checkoutInstructions ?? null);
                setSmartLockCheckinInstructions(data?.smartLockCheckinInstructions ?? null);
                setTwCheckinWindow(data?.timeWindowSettings?.checkinWindowMinutesBefore ?? null);
                setTwNoShowGrace(data?.timeWindowSettings?.noShowGraceMinutes ?? null);
                setItems(initialUnifiedItems);
              }}
            >
              {mt("discardChanges")}
            </Button>
            <StatusButton
              status={saveAction.status}
              onClick={saveAction.execute}
              disabled={hasProblems}
              labels={{
                idle: mt("saveChanges"),
                loading: mt("savingShort"),
                success: mt("saved"),
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
