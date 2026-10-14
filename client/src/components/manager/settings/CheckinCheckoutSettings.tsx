/**
 * Kitchen arrival & departure setup: location defaults and per-field kitchen overrides.
 *
 * Two surfaces, each with its own single Save:
 *
 *  - `instructions` — embedded in the selected kitchen's Arrival & departure
 *    tab: the two required instructions and arrival timing. The kitchen page's
 *    header Save is its Save.
 *  - `tasks` — the full Customer tasks page: optional tasks and photos, saved
 *    from the pinned bar that appears with the first change.
 *
 * Each surface writes only its own fields. The PUT merges whatever is provided,
 * so an instructions save never resubmits a stale checklist, and a tasks save
 * never overwrites instructions or timing saved from the other surface.
 * Neither sends the location's legacy check-in/out flags.
 * Nothing autosaves, and the exit guards read the same dirty flag.
 */

import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { mt } from "@/i18n/manager";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MutableRefObject, Ref } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import { useToast } from "@/hooks/use-toast";
import { apiGet, apiPut } from "@/lib/api";
import { cn } from "@/lib/utils";
import { NumericInput } from "@/components/ui/numeric-input";
import { SettingsRow } from "./SettingsRow";
import { SettingsContentSkeleton } from "@/components/manager/SettingsContentSkeleton";
import { arrivalTimingsLocked, type ChecklistItem, type PhotoRequirement } from "./shared/ChecklistEditor";
import { hasTrackingNotes } from "@shared/tracking-setup";
import { kitchenChecklistSections, resolveKitchenChecklist, type KitchenChecklistSection, type KitchenChecklistOverride } from "@shared/kitchen-checklist";
import {
  KitchenCheckinCheckoutEditor,
  SetupSection,
  findUnifiedItemProblems,
  itemsToStorage,
  unifyStorageToItems,
  type UnifiedChecklistItem,
} from "./KitchenCheckinCheckoutEditor";
import { ChefPageHeader } from "@/components/chef/ui";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckinCheckoutSettingsData {
  defaults?: KitchenChecklistOverride;
  override?: KitchenChecklistOverride | null;
  overridingKitchens?: Array<{ kitchenId: number; name: string; override: KitchenChecklistOverride }>;
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
  save: () => Promise<boolean>;
}

interface CheckinCheckoutSettingsProps {
  location: {
    id: number;
    name: string;
  };
  /** Which surface to render. See the file note. Defaults to the tasks page. */
  mode?: "instructions" | "tasks";
  /**
   * Receives the surface's dirty state so its owner can show the shared save
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
  /** Instructions surface: opens the Customer tasks page. */
  onOpenTasks?: () => void;
  kitchenContext?: { id: number; name: string };
  previewKitchenContext?: { id: number; name: string };
  /** A kitchen was named but is not one of this location's kitchens. */
  kitchenMissing?: boolean;
  onReturnToKitchen?: () => void;
}

type SavedSettings = CheckinCheckoutSettingsData;
interface InstructionDraft {
  checkinInstructions: string | null;
  checkoutInstructions: string | null;
  checkinWindowMinutesBefore: number | null;
  noShowGraceMinutes: number | null;
}

const savedItems = (data: SavedSettings) => unifyStorageToItems({
  checkinItems: (Array.isArray(data.checkinItems) ? data.checkinItems : []) as ChecklistItem[],
  checkoutItems: (Array.isArray(data.checkoutItems) ? data.checkoutItems : []) as ChecklistItem[],
  checkinPhotoRequirements: (Array.isArray(data.checkinPhotoRequirements) ? data.checkinPhotoRequirements : []) as PhotoRequirement[],
  checkoutPhotoRequirements: (Array.isArray(data.checkoutPhotoRequirements) ? data.checkoutPhotoRequirements : []) as PhotoRequirement[],
});

function sameTasks(left: UnifiedChecklistItem[], right: UnifiedChecklistItem[]) {
  const problems = findUnifiedItemProblems(left);
  if (problems.empty.length || problems.unassigned.length || problems.ambiguous.length || right.some(item => item.saved?.ambiguous))
    return JSON.stringify(left) === JSON.stringify(right);
  return JSON.stringify(itemsToStorage(left)) === JSON.stringify(itemsToStorage(right));
}

const savedInstructions = (data: SavedSettings): InstructionDraft => ({
  checkinInstructions: data.checkinInstructions || null,
  checkoutInstructions: data.checkoutInstructions || null,
  checkinWindowMinutesBefore: data.timeWindowSettings?.checkinWindowMinutesBefore ?? null,
  noShowGraceMinutes: data.timeWindowSettings?.noShowGraceMinutes ?? null,
});

/** The fields of an instructions draft that differ from what is saved — and nothing else. */
function changedInstructions(draft: InstructionDraft, data: SavedSettings) {
  const saved = savedInstructions(data);
  const patch: Record<string, unknown> = {};
  if ((draft.checkinInstructions || null) !== saved.checkinInstructions) patch.checkinInstructions = draft.checkinInstructions || null;
  if ((draft.checkoutInstructions || null) !== saved.checkoutInstructions) patch.checkoutInstructions = draft.checkoutInstructions || null;
  const timing: Record<string, number | null> = {};
  if (draft.checkinWindowMinutesBefore !== saved.checkinWindowMinutesBefore) timing.checkinWindowMinutesBefore = draft.checkinWindowMinutesBefore;
  if (draft.noShowGraceMinutes !== saved.noShowGraceMinutes) timing.noShowGraceMinutes = draft.noShowGraceMinutes;
  if (Object.keys(timing).length) patch.timeWindowSettings = timing;
  return patch;
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
    // A collapsed bar must not keep its buttons in the tab order.
    el.toggleAttribute("inert", hidden);
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

export default function CheckinCheckoutSettings(props: CheckinCheckoutSettingsProps) {
  const [locationMode, setLocationMode] = useState(false);
  const [dirty, setDirty] = useState(false);
  return <div className="space-y-4">
    {props.kitchenContext && <div className="space-y-1">
      <Button type="button" variant="outline" size="sm" disabled={dirty} onClick={() => setLocationMode(current => !current)}>
        {mt(locationMode ? 'kitchenScope.editKitchen' : 'kitchenScope.editLocation', { location: props.location.name, kitchen: props.kitchenContext.name })}
      </Button>
      {dirty && <p className="text-xs text-muted-foreground">{mt('kitchenScope.saveBeforeScopeChange')}</p>}
    </div>}
    <CheckinCheckoutSettingsSurface key={`${locationMode}-${props.kitchenContext?.id ?? 'location'}`} {...props}
      kitchenContext={locationMode ? undefined : props.kitchenContext}
      previewKitchenContext={locationMode ? props.kitchenContext : undefined}
      onDirtyChange={value => { setDirty(value); props.onDirtyChange?.(value); }} />
  </div>;
}

function CheckinCheckoutSettingsSurface({
  location,
  mode = "tasks",
  onDirtyChange,
  saveRef,
  onNavigate,
  onOpenTasks,
  kitchenContext,
  previewKitchenContext,
  kitchenMissing,
  onReturnToKitchen,
}: CheckinCheckoutSettingsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const embedded = mode === "instructions";
  const settingsKey = kitchenContext ? ["kitchen-checkin-checkout-settings", kitchenContext.id] : ["checkin-checkout-settings", location.id];
  const settingsUrl = kitchenContext ? `/manager/kitchens/${kitchenContext.id}/checkin-checkout-settings` : `/manager/locations/${location.id}/checkin-checkout-settings`;
  const [scopeDraft, setScopeDraft] = useState<KitchenChecklistOverride>({});
  const scopeRef = useRef(scopeDraft);
  scopeRef.current = scopeDraft;

  // Fetch existing settings
  const { data, isLoading } = useQuery<CheckinCheckoutSettingsData>({
    queryKey: settingsKey,
    queryFn: () =>
      apiGet(settingsUrl),
    enabled: !!location.id,
  });
  const { data: previewKitchen, isLoading: previewLoading } = useQuery<CheckinCheckoutSettingsData>({
    queryKey: ["kitchen-checkin-checkout-settings", previewKitchenContext?.id],
    queryFn: () => apiGet(`/manager/kitchens/${previewKitchenContext!.id}/checkin-checkout-settings`),
    enabled: !!previewKitchenContext,
  });

  const stickyBarRef = useRef<HTMLDivElement>(null);
  // Tasks are held in a single unified list; split into server-side
  // checkinItems / checkoutItems arrays on save.
  const [items, setItems] = useState<UnifiedChecklistItem[]>([]);
  const [checkinInstructions, setCheckinInstructions] = useState<string | null>(null);
  const [checkoutInstructions, setCheckoutInstructions] = useState<string | null>(null);

  // Arrival timings (null = inherit the platform default).
  const [twCheckinWindow, setTwCheckinWindow] = useState<number | null>(null);
  const [twNoShowGrace, setTwNoShowGrace] = useState<number | null>(null);

  // Memoized so the dirty comparison does not re-run the merge on every keystroke.
  const initialUnifiedItems = useMemo<UnifiedChecklistItem[]>(() => data ? savedItems(data) : [], [data]);

  const instructionDraft = useMemo<InstructionDraft>(() => ({
    checkinInstructions,
    checkoutInstructions,
    checkinWindowMinutesBefore: twCheckinWindow,
    noShowGraceMinutes: twNoShowGrace,
  }), [checkinInstructions, checkoutInstructions, twCheckinWindow, twNoShowGrace]);
  const draftRef = useRef({ items, instructions: instructionDraft });
  draftRef.current = { items, instructions: instructionDraft };

  /**
   * Adopt fresh server data only where it cannot cost the manager a draft.
   *
   * The other surface (or another browser tab) can save this row while this one
   * is open, and that refetch must not wipe what is being typed here. The draft
   * follows the server when it is untouched since the last sync, or already
   * matches the new data (which is what a successful save of this surface looks
   * like); otherwise it is kept and stays dirty.
   */
  const syncedRef = useRef<SavedSettings | null>(null);
  useEffect(() => {
    if (!data) return;
    const previous = syncedRef.current;
    const draft = draftRef.current;
    const saved = savedInstructions(data);
    const before = previous && savedInstructions(previous);
    // Refresh untouched instruction fields even while another field has a local draft.
    const adopt = (key: keyof InstructionDraft) => !embedded || !before
      || draft.instructions[key] === before[key] || draft.instructions[key] === saved[key];
    const adoptItems = embedded || !previous || sameTasks(draft.items, savedItems(previous))
      || sameTasks(draft.items, initialUnifiedItems);
    if (adopt("checkinInstructions")) setCheckinInstructions(saved.checkinInstructions);
    if (adopt("checkoutInstructions")) setCheckoutInstructions(saved.checkoutInstructions);
    if (adopt("checkinWindowMinutesBefore")) setTwCheckinWindow(saved.checkinWindowMinutesBefore);
    if (adopt("noShowGraceMinutes")) setTwNoShowGrace(saved.noShowGraceMinutes);
    if (adoptItems) setItems(initialUnifiedItems);
    // Keep the baseline for edited fields until they have been saved.
    syncedRef.current = { ...data,
      checkinInstructions: adopt("checkinInstructions") ? saved.checkinInstructions : before!.checkinInstructions,
      checkoutInstructions: adopt("checkoutInstructions") ? saved.checkoutInstructions : before!.checkoutInstructions,
      timeWindowSettings: {
        checkinWindowMinutesBefore: adopt("checkinWindowMinutesBefore") ? saved.checkinWindowMinutesBefore : before!.checkinWindowMinutesBefore,
        noShowGraceMinutes: adopt("noShowGraceMinutes") ? saved.noShowGraceMinutes : before!.noShowGraceMinutes,
      },
      ...(!adoptItems && previous
        ? { checkinItems: previous.checkinItems, checkoutItems: previous.checkoutItems,
            checkinPhotoRequirements: previous.checkinPhotoRequirements, checkoutPhotoRequirements: previous.checkoutPhotoRequirements } : {}),
    };
  }, [data, initialUnifiedItems, embedded]);

  const instructionPatch = useMemo(() => data ? changedInstructions(instructionDraft, data) : {}, [data, instructionDraft]);
  const isDirty = !!data && (Object.keys(scopeDraft).length > 0 || (embedded
    ? Object.keys(instructionPatch).length > 0
    : !sameTasks(items, initialUnifiedItems)));

  const customized = (section: KitchenChecklistSection) => kitchenChecklistSections[section].some(field =>
    (Object.hasOwn(scopeDraft, field) ? scopeDraft[field] : data?.override?.[field]) != null);
  const scopeControl = (section: KitchenChecklistSection) => kitchenContext ? <div className="space-y-1 text-xs">
    <p className="font-medium">{mt(`kitchenScope.${section}`)}</p>
    <p className="text-muted-foreground">{mt(customized(section) ? "kitchenScope.customized" : "kitchenScope.usingDefault", { location: location.name })}</p>
    <Button type="button" variant="outline" size="sm" onClick={() => {
      const reset = customized(section);
      const patch = Object.fromEntries(kitchenChecklistSections[section].map(field => [field, reset ? null : data?.[field as keyof CheckinCheckoutSettingsData] ?? (field.endsWith('Instructions') ? '' : [])]));
      setScopeDraft(current => ({ ...current, ...patch }));
      if (reset) {
        if (section === 'arrivalInstructions') setCheckinInstructions(String(data?.defaults?.checkinInstructions ?? '') || null);
        if (section === 'departureInstructions') setCheckoutInstructions(String(data?.defaults?.checkoutInstructions ?? '') || null);
        if (section.endsWith('Tasks') && data) setItems(savedItems({ ...data, ...itemsToStorage(previewTaskItems), ...Object.fromEntries(kitchenChecklistSections[section].map(field => [field, data.defaults?.[field] ?? []])) }));
      } else if (section.endsWith('Tasks') && data) {
        setItems(previewTaskItems);
      }
    }}>{mt(customized(section) ? "kitchenScope.useDefault" : "kitchenScope.customize", { location: location.name })}</Button>
  </div> : null;

  // Inherited stages stay in the customer preview even when only the other stage is editable.
  const previewTaskItems = useMemo(() => {
    if (embedded) return initialUnifiedItems;
    if (items.some(item => item.saved?.ambiguous)) return items;
    if (!kitchenContext) return previewKitchenContext
      ? savedItems({ ...data!, ...resolveKitchenChecklist(previewKitchen?.override, itemsToStorage(items))! }) : items;
    const arrays = itemsToStorage(items);
    for (const section of ['arrivalTasks', 'departureTasks'] as const) {
      if (!customized(section)) for (const field of kitchenChecklistSections[section])
        Object.assign(arrays, { [field]: data?.defaults?.[field] ?? data?.[field] ?? [] });
    }
    return savedItems({ ...data!, ...arrays });
  }, [embedded, initialUnifiedItems, kitchenContext, items, data, scopeDraft, previewKitchenContext, previewKitchen]);
  const previewNotes = resolveKitchenChecklist(previewKitchenContext ? previewKitchen?.override : null, {
    checkinInstructions: embedded ? checkinInstructions : data?.checkinInstructions ?? null,
    checkoutInstructions: embedded ? checkoutInstructions : data?.checkoutInstructions ?? null,
  })!;

  /**
   * Problems that would silently truncate the configuration on save. Reported
   * per-row rather than as a count, so the message can name the offending item.
   * Only the tasks page writes tasks, so only it is blocked by them.
   */
  const problems = useMemo(
    () => embedded ? { empty: [], unassigned: [], ambiguous: [] } : findUnifiedItemProblems(items),
    [embedded, items],
  );

  const missingNotes = !kitchenContext && embedded && (!checkinInstructions?.trim() || !checkoutInstructions?.trim());
  const notesMissingMessage = mt("setupUx.notesMissing", { defaultValue: "Write both arrival and departure instructions before saving." });
  /*
   * The server merges a partial save into the row and, where check-in/out is on,
   * requires both saved instructions. A tasks save cannot write them, so it says
   * where to write them instead of failing on the server.
   */
  const notesNeeded = !kitchenContext && !embedded && !!data && (data.checkinEnabled || data.checkoutEnabled)
    && !hasTrackingNotes(data as unknown as Record<string, unknown>);
  const notesNeededMessage = mt("setupUx.notesFirst", { defaultValue: "Write the arrival and departure instructions under Arrival & departure first." });
  /*
   * An old row with only one of check-in/check-out on would be switched fully on
   * by the server's merge. Saving is held rather than change it behind the
   * manager's back.
   */
  const flagsMismatch = !kitchenContext && !!data && data.checkinEnabled !== data.checkoutEnabled;
  const flagsMismatchMessage = mt("setupUx.flagsMismatch", { defaultValue: "Check-in and check-out are set up differently at this location. Ask Local Cooks to review it before saving." });
  const hasProblems = problems.empty.length > 0 || problems.unassigned.length > 0 || problems.ambiguous.length > 0
    || missingNotes || notesNeeded || flagsMismatch;
  const blockingMessage = flagsMismatch ? flagsMismatchMessage
    : missingNotes ? notesMissingMessage
    : notesNeeded ? notesNeededMessage
    : mt("setupUx.saveBlocked", { defaultValue: "Fix the problems listed at the top of this page to save." });

  const saveSucceededRef = useRef(false);
  const saveSettings = useCallback(async () => {
    if (!data) throw new Error(blockingMessage);
    if (hasProblems) throw new Error(blockingMessage);
    const submittedScope = scopeRef.current;
    const submittedDraft = JSON.stringify([embedded ? instructionDraft : items, submittedScope]);

    // Only this surface's fields; see the file note.
    let patch: Record<string, unknown> = embedded ? { ...instructionPatch } : (() => {
      const { checkinItems, checkoutItems, checkinPhotoRequirements, checkoutPhotoRequirements } = itemsToStorage(items);
      return { checkinItems, checkoutItems, checkinPhotoRequirements, checkoutPhotoRequirements };
    })();

    if (kitchenContext) {
      const timing = patch.timeWindowSettings;
      delete patch.timeWindowSettings;
      patch = { ...patch, ...submittedScope };
      for (const section of (embedded ? ['arrivalInstructions', 'departureInstructions'] : ['arrivalTasks', 'departureTasks']) as KitchenChecklistSection[]) {
        for (const field of kitchenChecklistSections[section]) {
          if (!customized(section) && !Object.hasOwn(submittedScope, field)) delete patch[field];
          // Creating an instruction override uses the typed draft, even when inherited text was unchanged.
          if (customized(section) && embedded && Object.hasOwn(patch, field))
            patch[field] = field === 'checkinInstructions' ? checkinInstructions ?? '' : checkoutInstructions ?? '';
          if (customized(section) && !embedded) {
            const arrays = itemsToStorage(items);
            const current = arrays[field as keyof typeof arrays];
            if (Object.hasOwn(submittedScope, field) || JSON.stringify(current) !== JSON.stringify(data[field as keyof SavedSettings]))
              patch[field] = current;
            else delete patch[field];
          }
        }
      }
      if (timing) {
        await apiPut(`/manager/locations/${location.id}/checkin-checkout-settings`, { timeWindowSettings: timing });
        queryClient.setQueryData<CheckinCheckoutSettingsData>(settingsKey, current => current && ({ ...current,
          timeWindowSettings: { ...current.timeWindowSettings!, ...(timing as Partial<TimeWindowSettings>) } }));
        void queryClient.invalidateQueries({ queryKey: ['checkin-checkout-settings', location.id] });
      }
    }

    if (Object.keys(patch).length) {
      const updated = await apiPut(settingsUrl, patch);
      // Acknowledged fields are clean immediately; edits made during the request remain dirty.
      queryClient.setQueryData<CheckinCheckoutSettingsData>(settingsKey, current => current && ({
        ...current, ...(kitchenContext && updated ? updated : patch),
        timeWindowSettings: {
          checkinWindowMinutesBefore: current.timeWindowSettings?.checkinWindowMinutesBefore ?? null,
          noShowGraceMinutes: current.timeWindowSettings?.noShowGraceMinutes ?? null,
          ...(patch.timeWindowSettings as Partial<TimeWindowSettings> | undefined),
        },
      }));

      queryClient.invalidateQueries({
        queryKey: settingsKey,
      });
      // The shared checklist affects the publish review of every kitchen at this location.
      queryClient.invalidateQueries({ queryKey: ["kitchen-listing-readiness"] });
      queryClient.invalidateQueries({ queryKey: ["kitchen-checkin-checkout-settings"] });

      toast({
        title: mt("checklistsSaved"),
        description: mt("kitchenCheckInCheckOutChecklistsUpdatedSuccessfully"),
      });
    }
    // A successful write must not authorize leaving with edits typed during that write.
    saveSucceededRef.current = submittedDraft === JSON.stringify([embedded ? draftRef.current.instructions : draftRef.current.items, scopeRef.current]);
    if (saveSucceededRef.current && !embedded) {
      const acknowledged = queryClient.getQueryData<CheckinCheckoutSettingsData>(settingsKey);
      if (acknowledged) setItems(savedItems(acknowledged));
    }
    setScopeDraft(current => Object.fromEntries(Object.entries(current).filter(([field, value]) => value !== submittedScope[field as keyof KitchenChecklistOverride])));
  }, [
    data,
    embedded,
    instructionPatch,
    instructionDraft,
    location.id,
    items,
    hasProblems,
    blockingMessage,
    queryClient,
    toast,
    kitchenContext, settingsUrl, scopeDraft, checkinInstructions, checkoutInstructions,
  ]);
  const saveAction = useStatusButton(saveSettings);

  // Report dirty state upward, but only on transitions — the owner re-renders
  // on every keystroke otherwise.
  const lastDirtyRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastDirtyRef.current === isDirty) return;
    lastDirtyRef.current = isDirty;
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Expose save() to the owner's exit guard and header action.
  useEffect(() => {
    if (!saveRef) return;
    const handle: CheckinCheckoutHandle = { save: async () => {
      saveSucceededRef.current = false;
      /*
       * The tab renders no status button of its own — the kitchen header owns
       * that — so it calls the save directly. Going through `execute` would
       * no-op while its unseen status still reads success/error, reporting a
       * fresh Save as failed.
       */
      if (saveAction.status === "loading") return false;
      if (embedded || saveAction.status === "success" || saveAction.status === "error") {
        saveAction.reset();
        try { await saveSettings(); } catch { return false; }
        return saveSucceededRef.current;
      }
      await saveAction.execute();
      return saveSucceededRef.current;
    } };
    if (typeof saveRef === "function") saveRef(handle);
    else (saveRef as MutableRefObject<CheckinCheckoutHandle | null>).current = handle;
    return () => {
      if (typeof saveRef === "function") saveRef(null);
      else (saveRef as MutableRefObject<CheckinCheckoutHandle | null>).current = null;
    };
  }, [saveRef, saveAction.execute, saveAction.status, saveAction.reset, embedded, saveSettings]);

  // Reload / tab close on the full page. The kitchen page already covers its tabs.
  useEffect(() => {
    if (embedded || !isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [embedded, isDirty]);

  // The pinned bar is never unmounted — it is collapsed in place so the scroll
  // container cannot resize while the manager is scrolling.
  usePinchOnHide(stickyBarRef, !isDirty);

  const pageHeader = !embedded && <>
    <ChefPageHeader
      title={mt("setupUx.tasksStep", { defaultValue: "Customer tasks" })}
      description={mt("setupUx.tasksPageHelp", { defaultValue: "Add tasks customers complete at arrival or departure. You can leave the list empty. Nothing changes until you save." })}
    />
    <div className="space-y-1">
      {onReturnToKitchen && <Button variant="ghost" size="sm" onClick={onReturnToKitchen}
        className="-ml-2 h-8 rounded-lg px-2 text-muted-foreground hover:bg-muted hover:text-foreground">
        <ChevronLeft className="mr-1 size-4" />
        {kitchenContext ? mt("kitchenArrivalDepartureBack") : mt("navSpaces")}
      </Button>}
      {kitchenContext && <p className="text-sm font-medium">{kitchenContext.name} · {location.name}</p>}
      <p className="text-sm text-muted-foreground">
        {kitchenMissing
          ? mt("setupUx.kitchenMissing", { defaultValue: "That kitchen isn't at {location}. These tasks are shared by every kitchen there.", location: location.name })
          : mt(kitchenContext ? "kitchenScope.pageHelp" : "kitchenArrivalDepartureScope", { location: location.name })}
      </p>
    </div>
  </>;

  if (isLoading || (previewKitchenContext && previewLoading)) {
    return (
      <div className="space-y-6">
        {pageHeader}
        <SettingsContentSkeleton rows={6} />
      </div>
    );
  }

  const timingRow = (
    id: string,
    label: string,
    help: string,
    value: number | null,
    platformDefault: number | undefined,
    fallback: string,
    onChange: (value: number | null) => void,
  ) => (
    <SettingsRow
      id={id}
      label={label}
      hint={platformDefault !== undefined
        ? mt("platformDefaultIs", { minutes: mt("minutesShort", { count: platformDefault }) })
        : undefined}
      help={help}
      disabledReason={arrivalTimingsLocked(data) ? mt("enableStageToEditTimings") : undefined}
    >
      <NumericInput
        id={id}
        disabled={arrivalTimingsLocked(data)}
        suffix={mt("minutesUnit")}
        value={value === null ? "" : String(value)}
        placeholder={platformDefault !== undefined ? String(platformDefault) : fallback}
        onValueChange={(val) => {
          const parsed = parseInt(val, 10);
          onChange(val.trim() === "" || isNaN(parsed) ? null : Math.min(120, Math.max(0, parsed)));
        }}
        className="h-9 w-28"
      />
    </SettingsRow>
  );

  /* Arrival timings sit before the preview so the tab reads in the order a
     manager decides things; they are the same query-cached fields as Booking
     Policies and save with the instructions. */
  const timing = embedded ? (
    <SetupSection id="setup-timing" title={mt("arrivalTiming")} description={mt(arrivalTimingsLocked(data) ? "arrivalTimingLockedDescription" : "arrivalTimingDescription")}>
      <div className="divide-y rounded-lg border">
        {timingRow("checkin-window", mt("checkinOpensLabel"), mt("checkinWindowHelp"), twCheckinWindow,
          data?.platformDefaults?.checkinWindowMinutesBefore, "15", setTwCheckinWindow)}
        {timingRow("no-show-grace", mt("noShowGraceLabel"), mt("noShowGraceHelp"), twNoShowGrace,
          data?.platformDefaults?.noShowGraceMinutes, "30", setTwNoShowGrace)}
      </div>

      {/* Soft cross-link to the rest of the booking rules, for managers
          who came here looking for something else. */}
      {onNavigate && <p className="text-xs text-muted-foreground">
        {mt("bookingRulesCrossLinkHint")}{" "}
        <button
          type="button"
          onClick={() => onNavigate("settings-booking-rules")}
          className="!min-h-0 inline-flex items-center gap-0.5 rounded font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {mt("navBookingRules")}
          <ChevronRight className="size-3.5" />
        </button>
      </p>}
    </SetupSection>
  ) : undefined;

  return (
    <div className={embedded ? "space-y-4" : "space-y-6"}>
      {pageHeader}
      {!kitchenContext && !!data?.overridingKitchens?.length && <div className="text-xs text-muted-foreground space-y-1">{
        (embedded ? ['arrivalInstructions', 'departureInstructions'] : ['arrivalTasks', 'departureTasks']).map(section => {
          const names = data.overridingKitchens!.filter(row => kitchenChecklistSections[section as KitchenChecklistSection].some(field => row.override[field] != null)).map(row => row.name);
          return names.length ? <p key={section}>{mt(`kitchenScope.${section}`)} · {mt("kitchenScope.overridingKitchens", { kitchens: names.join(', ') })}</p> : null;
        })}</div>}

      {/* Anything that blocks Save is surfaced before the fields, so the manager
          sees the reason, not just a Save that will not go through. */}
      {hasProblems && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="space-y-0.5 text-xs text-destructive">
            {flagsMismatch && <p>{flagsMismatchMessage}</p>}
            {missingNotes && <p>{notesMissingMessage}</p>}
            {notesNeeded && <p>{notesNeededMessage}</p>}
            {problems.ambiguous.length > 0 && <p>{mt("setupUx.ambiguous", { defaultValue: "Saved duties contain duplicate IDs within a stage. Saving is blocked to avoid losing data. Ask Local Cooks to review this configuration." })}</p>}
            {problems.empty.length > 0 && (
              <p>{mt("checklistEmptyLabels", { count: problems.empty.length })}</p>
            )}
            {problems.unassigned.length > 0 && (
              <p>{mt("checklistUnassignedItems", { count: problems.unassigned.length })}</p>
            )}
          </div>
        </div>
      )}

      <KitchenCheckinCheckoutEditor
        instructionControls={{ checkin: scopeControl('arrivalInstructions'), checkout: scopeControl('departureInstructions') }}
        instructionReadOnly={kitchenContext ? { checkin: !customized('arrivalInstructions'), checkout: !customized('departureInstructions') } : undefined}
        taskControls={!embedded && kitchenContext ? <div className="grid gap-3 sm:grid-cols-2 mb-3">{scopeControl('arrivalTasks')}{scopeControl('departureTasks')}</div> : undefined}
        previewItems={embedded && previewKitchenContext
          ? savedItems({ ...data!, ...resolveKitchenChecklist(previewKitchen?.override, { ...data! })! }) : previewTaskItems}
        previewInstructions={previewNotes}
        previewKitchenName={(kitchenContext ?? previewKitchenContext)?.name}
        setupLocationName={location.name}
        setupMode={mode}
        onOpenTasks={onOpenTasks}
        beforeReview={timing}
        coupledStages
        // The instructions tab previews the saved tasks; only the tasks page edits them.
        items={embedded ? initialUnifiedItems : kitchenContext ? items.map(item => ({ ...item, requiredOnCheckin: item.requiredOnCheckin && customized('arrivalTasks'), requiredOnCheckout: item.requiredOnCheckout && customized('departureTasks') })).filter(item => item.requiredOnCheckin || item.requiredOnCheckout) : items}
        onItemsChange={setItems}
        // Kitchen workflows are always available; inherited task stages are read-only.
        checkinEnabled={embedded || !kitchenContext || customized('arrivalTasks')}
        onCheckinEnabledChange={() => {}}
        checkoutEnabled={embedded || !kitchenContext || customized('departureTasks')}
        onCheckoutEnabledChange={() => {}}
        onFlowToggleClick={() => {}}
        onFlowToggleMouseDown={() => {}}
        onFlowToggleKeyDown={() => {}}
        // The tasks page previews the saved instructions; only the tab edits them.
        checkinInstructions={embedded ? checkinInstructions : data?.checkinInstructions ?? null}
        onCheckinInstructionsChange={setCheckinInstructions}
        checkoutInstructions={embedded ? checkoutInstructions : data?.checkoutInstructions ?? null}
        onCheckoutInstructionsChange={setCheckoutInstructions}
      />

      {/* Pinned action bar — the Customer tasks page's only Save.
       *
       * This is the page's scroll "pincher": it is always in the layout, at a
       * fixed 58px, and only the content inside it changes. Mounting it only
       * while dirty would resize the scroll container at the exact moment an
       * edit lands, which moves content relative to the scrollbar. A
       * constant-height slot means no content change on this page can ever
       * resize the container.
       *
       * The collapse itself is a one-frame layout effect rather than a sibling
       * component, so the cause and effect are visible in one place: the height
       * is read from the DOM before the paint that reveals it, and locked to 0
       * for that frame. Both branches go through this effect, so a resize can
       * never land between them.
       *
       * It appears with the first change and says why Save is blocked, so there
       * is no second, disabled button to reconcile with it. The instructions
       * tab uses the kitchen page's header Save instead, like every other tab. */}
      {!embedded && <div
        ref={stickyBarRef}
        aria-hidden={!isDirty}
        className="sticky bottom-0 z-10 -mx-1 h-[58px] overflow-hidden"
      >
        <div className="flex h-[58px] items-center justify-between gap-3 rounded-lg border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <span
            id="setup-save-status"
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-xs",
              hasProblems ? "text-destructive" : "text-muted-foreground",
            )}
          >
            <AlertTriangle className={cn("size-3.5 shrink-0", !hasProblems && "text-amber-500")} />
            <span className="line-clamp-2">
              {hasProblems ? blockingMessage : mt("unsavedChanges")}
            </span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg px-2 text-xs hover:bg-muted"
              onClick={() => { setItems(initialUnifiedItems); setScopeDraft({}); }}
              title={mt("discardChanges")}
            >
              {/* Icon-only on phones so the status message keeps room to be read. */}
              <RotateCcw className="size-3.5 sm:hidden" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">{mt("discardChanges")}</span>
            </Button>
            <StatusButton
              status={saveAction.status}
              onClick={saveAction.execute}
              disabled={hasProblems}
              aria-describedby={hasProblems ? "setup-save-status" : undefined}
              labels={{
                idle: mt("saveChanges"),
                loading: mt("savingShort"),
                success: mt("saved"),
              }}
            />
          </div>
        </div>
      </div>}
    </div>
  );
}
