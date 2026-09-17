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

import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { mt } from "@/i18n/manager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MutableRefObject, Ref } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Clock,
  Info,
  Loader2,
} from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPut } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { SettingsRow } from "./SettingsRow";
import type { ChecklistItem, PhotoRequirement } from "./shared/ChecklistEditor";
import { arrivalTimingsLocked } from "./shared/ChecklistEditor";
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

/**
 * Collapses the pinned bar to zero height on the frame it is hidden.
 *
 * The bar is always in the layout so the scroll container keeps a constant
 * height — see the note where it is rendered. Hiding it therefore has to happen
 * mechanically: this reads the bar's own measured height and commits it as the
 * max-height for one frame, so nothing about the bar's box changes, then
 * releases it on the next frame so the geometry is identical in every respect.
 * Revealing skips the lock entirely, because showing the bar is the one
 * transition that cannot disturb scroll.
 *
 * Runs both branches inside a single effect so no resize can be observed
 * between them.
 */
function usePinchOnHide(
  ref: React.RefObject<HTMLDivElement | null>,
  hidden: boolean,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!hidden) {
      el.style.maxHeight = "";
      return;
    }
    el.style.maxHeight = `${el.getBoundingClientRect().height}px`;
    const frame = requestAnimationFrame(() => {
      el.style.maxHeight = "0px";
    });
    return () => cancelAnimationFrame(frame);
  }, [ref, hidden]);
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
  const stickyBarRef = useRef<HTMLDivElement>(null);
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

  /**
   * Items assigned to a flow the manager has switched off.
   *
   * This is not an error — the items are saved, and the manager can turn the
   * flow on at any time — so it must not block Save or dress itself up as one.
   * It is, however, the one state where "saved successfully" and "the chef
   * sees nothing" are both true, and the manager has no way to notice from
   * this page. Warning is therefore worth the pixels; a modal is not. A
   * confirmation dialog is reserved for destructive, irreversible actions,
   * and the industry guidance is explicit that confirming routine saves
   * trains people to dismiss reflexively, which costs the warnings that
   * matter. An inline advisory says the same thing without that tax.
   *
   * Counted against the live toggles rather than the saved ones, so the
   * message describes what the next Save will actually produce.
   */
  const dormantFlows = useMemo(() => {
    const dormant = (on: boolean, scope: "checkin" | "checkout") =>
      on
        ? 0
        : items.filter(
            (i) =>
              i.label.trim() &&
              (scope === "checkin" ? i.requiredOnCheckin : i.requiredOnCheckout),
          ).length;

    return {
      checkin: dormant(checkinEnabled, "checkin"),
      checkout: dormant(checkoutEnabled, "checkout"),
    };
  }, [items, checkinEnabled, checkoutEnabled]);

  const hasDormantFlows = dormantFlows.checkin > 0 || dormantFlows.checkout > 0;

  // Arrival timings are meaningless without at least one flow to be on time for.
  const timingsLocked = arrivalTimingsLocked(data ?? undefined);

  /**
   * The timings rule is evaluated against the *live* toggles, not the saved
   * ones — so a manager who has switched check-in on but not yet saved should
   * be editing, not looking at a locked field wondering why last save's state
   * is still in charge. The fields stay writable, and the card says plainly
   * that nothing takes effect until Save, which is what the exit guard is for.
   */
  const timingsPendingSave =
    timingsLocked && !arrivalTimingsLocked({ checkinEnabled, checkoutEnabled });

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

  /**
   * Toggling a flow is done through a `<Switch>`, and clicking it focuses it.
   * When that switch is above the visible part of the scroll container — which
   * it is as soon as the manager has scrolled down past the two flow panels —
   * the browser scrolls the newly focused element into view. Measured with the
   * container at scrollTop 600 and the switch off-screen above: a plain
   * `element.click()` leaves the scroll position alone, but `element.focus()`
   * drives scrollTop to 0, a 600px jump. So focus, not the content change, is
   * the whole cause — the toggle re-renders *after* focus has already moved,
   * which is why it looks like the toggle did it.
   *
   * `preventDefault()` on mousedown stops the browser taking focus on press.
   * The event is still allowed to become a click, so `onCheckedChange` fires
   * normally. Blocking the default here rather than repairing the scroll
   * afterwards matters: once scrollTop has been clamped to 0 there is nothing
   * left for scroll anchoring to compensate with.
   *
   * Focus is then handed to the panel the manager just acted on, so the
   * focused element is a real container rather than `<body>` (a focused element
   * that unmounts would silently drop focus, which is worse for assistive
   * tech). `preventScroll` keeps that handoff from nudging the container again.
   */
  const focusAfterToggle = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const panel = event.currentTarget.closest("[data-stage-panel]");
      if (!(panel instanceof HTMLElement)) return;
      panel.focus({ preventScroll: true });
    },
    [],
  );

  /**
   * Stops the browser focusing the switch on press. See the note above — this is
   * the line that actually prevents the scroll jump. It must run on mousedown
   * and must not call `stopPropagation`, so the press still becomes a click and
   * the switch still toggles.
   */
  const preventToggleFocusScroll = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
    },
    [],
  );

  /**
   * Keyboard activation never focused the switch through a pointer press, so it
   * has no scroll to suppress — it only needs the same focus handoff that the
   * pointer path performs, keeping both routes identical.
   */
  const onFlowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === " " || event.key === "Enter") focusAfterToggle(event as unknown as React.MouseEvent<HTMLButtonElement>);
    },
    [focusAfterToggle],
  );

  // The pinned bar is never unmounted — it is collapsed in place so the scroll
  // container cannot resize while the manager is scrolling.
  usePinchOnHide(stickyBarRef, !isDirty);

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

      {/* Advisory, not an error: the configuration is valid and Save works.
          Amber rather than red so it never reads as a failure, and it names
          the flow and the count instead of asking "are you sure?" — the
          manager's next move is clear from the sentence itself. Hidden while
          a real problem is blocking Save, because two stacked banners turn
          into a wall of warnings and the blocking one is the one that matters. */}
      {!hasProblems && hasDormantFlows && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
          <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div className="space-y-0.5 text-xs text-amber-900">
            {dormantFlows.checkin > 0 && (
              <p>
                {mt("checklistDormantCheckin", {
                  count: dormantFlows.checkin,
                })}
              </p>
            )}
            {dormantFlows.checkout > 0 && (
              <p>
                {mt("checklistDormantCheckout", {
                  count: dormantFlows.checkout,
                })}
              </p>
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
        onFlowToggleClick={focusAfterToggle}
        onFlowToggleMouseDown={preventToggleFocusScroll}
        onFlowToggleKeyDown={onFlowKeyDown}
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
          arrival experience never has to leave this page. Locked entirely while
          neither flow is on, because a check-in window with no check-in is
          meaningless. */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
              <Clock className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <CardTitle className="text-lg">{mt("arrivalTiming")}</CardTitle>
                {timingsPendingSave && (
                  <Badge
                    variant="outline"
                    className="h-5 border-amber-300 bg-amber-50 px-1.5 text-[10px] font-medium text-amber-800"
                  >
                    {mt("saveToApply")}
                  </Badge>
                )}
              </div>
              <CardDescription>
                {timingsLocked
                  ? mt("arrivalTimingLockedDescription")
                  : mt("arrivalTimingDescription")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="divide-y p-0">
          <SettingsRow
            id="checkin-window"
            label={mt("checkinOpensLabel")}
            disabledReason={
              timingsLocked
                ? timingsPendingSave
                  ? mt("arrivalTimingsPendingSave")
                  : mt("enableStageToEditTimings")
                : undefined
            }
            hint={
              data?.platformDefaults
                ? mt("platformDefaultIs", {
                    minutes: mt("minutesShort", {
                      count: data.platformDefaults.checkinWindowMinutesBefore,
                    }),
                  })
                : undefined
            }
            help={mt("checkinWindowHelp")}
          >
            <NumericInput
              id="checkin-window"
              disabled={timingsLocked && !timingsPendingSave}
              suffix={mt("minutesUnit")}
              value={twCheckinWindow === null ? "" : String(twCheckinWindow)}
              placeholder={
                data?.platformDefaults
                  ? String(data.platformDefaults.checkinWindowMinutesBefore)
                  : "15"
              }
              onValueChange={(val) => {
                const parsed = parseInt(val, 10);
                setTwCheckinWindow(
                  val.trim() === "" || isNaN(parsed) ? null : Math.min(120, Math.max(0, parsed)),
                );
              }}
              className="h-9 w-28"
            />
          </SettingsRow>

          <SettingsRow
            id="no-show-grace"
            label={mt("noShowGraceLabel")}
            disabledReason={
              timingsLocked
                ? timingsPendingSave
                  ? mt("arrivalTimingsPendingSave")
                  : mt("enableStageToEditTimings")
                : undefined
            }
            hint={
              data?.platformDefaults
                ? mt("platformDefaultIs", {
                    minutes: mt("minutesShort", {
                      count: data.platformDefaults.noShowGraceMinutes,
                    }),
                  })
                : undefined
            }
            help={mt("noShowGraceHelp")}
          >
            <NumericInput
              id="no-show-grace"
              disabled={timingsLocked && !timingsPendingSave}
              suffix={mt("minutesUnit")}
              value={twNoShowGrace === null ? "" : String(twNoShowGrace)}
              placeholder={
                data?.platformDefaults
                  ? String(data.platformDefaults.noShowGraceMinutes)
                  : "30"
              }
              onValueChange={(val) => {
                const parsed = parseInt(val, 10);
                setTwNoShowGrace(
                  val.trim() === "" || isNaN(parsed) ? null : Math.min(120, Math.max(0, parsed)),
                );
              }}
              className="h-9 w-28"
            />
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

      {/* Pinned action bar.
       *
       * This is the page's scroll "pincher": it is always in the layout, at a
       * fixed 58px, and only the content inside it changes. Mounting it only
       * while dirty would resize the scroll container at the exact moment a
       * toggle fires, which moves content relative to the scrollbar and is the
       * second half of the jump this page used to have. A constant-height slot
       * means no content change on this page can ever resize the container.
       *
       * The collapse itself is a one-frame layout effect rather than a sibling
       * component, so the cause and effect are visible in one place: the height
       * is read from the DOM before the paint that reveals it, and locked to 0
       * for that frame. Both branches go through this effect, so a resize can
       * never land between them. */}
      <div
        ref={stickyBarRef}
        aria-hidden={!isDirty}
        className="sticky bottom-0 z-10 -mx-1 h-[58px] overflow-hidden"
      >
        <div className="flex h-[58px] flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
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
      </div>
    </div>
  );
}
