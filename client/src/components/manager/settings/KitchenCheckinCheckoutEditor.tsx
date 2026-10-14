/**
 * Kitchen Check-In / Check-Out Unified Editor
 *
 * A single editable list of checklist items, each of which can be attached to
 * the Check-In flow, the Check-Out flow, or both. Each item carries its own
 * "photo required" flag, replacing the old pattern of maintaining a separate
 * photo-requirements array.
 *
 * Row design follows the pattern established by short-term-rental hosts
 * (Airbnb's checkout-tasks list): a drag handle, the task text as the primary
 * field, a free-text note revealed only when asked for, and a small set of
 * scope chips. New items can be added one at a time or picked from a preset
 * list of common tasks, which is how every mature product in this space avoids
 * an intimidating blank form.
 *
 * Kitchen setup reviews the draft inline. Shared storage keeps its dialog.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronRight,
  ClipboardCheck,
  Duplicate,
  GripVertical,
  Info,
  Lightbulb,
  ListChecks,
  Lock,
  LogIn,
  LogOut,
  MessageSquare,
  Pencil,
  PlaylistPlus,
  Plus,
  Trash2,
  X,
} from "@/components/ui/manager-icons";
import { UndoBar, UNDO_WINDOW_MS } from "@/components/manager/shared/UndoBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppDialogContent } from "@/components/ui/app-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChecklistItem, PhotoRequirement } from "./shared/ChecklistEditor";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Unified checklist item used by the manager UI. At save time this is split
 * back into `checkinItems` / `checkoutItems` arrays plus auto-generated photo
 * requirement arrays so the server contract and chef-side code stay intact.
 */
export interface UnifiedChecklistItem {
  id: string;
  label: string;
  description?: string;
  requiredOnCheckin: boolean;
  requiredOnCheckout: boolean;
  photoRequired: boolean;
  /** Original stage records keep legacy optional duties and photo-only rows intact. */
  saved?: {
    checkin: SavedStage;
    checkout: SavedStage;
    label: string;
    description?: string;
    photoRequired: boolean;
    index: number;
    ambiguous: boolean;
  };
}

export type Stage = "checkin" | "checkout";

interface SavedStage {
  item?: ChecklistItem;
  photo?: PhotoRequirement;
  itemIndex?: number;
  photoIndex?: number;
}

// ─── ID helper ────────────────────────────────────────────────────────────────

export function generateUnifiedItemId(): string {
  return `item_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ─── Preset tasks ─────────────────────────────────────────────────────────────

/**
 * Preset tasks offered by the "add from common tasks" picker.
 *
 * These are generic hospitality tasks rather than anything LocalCooks-specific,
 * which is exactly why they are offered as one-tap additions: the blank text
 * field is the single biggest source of friction on a page like this. Booking
 * context is deliberately excluded here because it already has a home on the
 * Details tab, and duplicating it would create two sources of truth.
 *
 * `key` is an i18n key rather than literal copy so the picker reads in the
 * manager's language. Once picked, the resolved text is written into the item's
 * `label`, which is the same free-text field a manager would have typed into.
 */
const PRESET_TASKS: { key: string; stages: Stage[]; photo?: boolean }[] = [
  { key: "presetTaskGatherTowels", stages: ["checkout"] },
  { key: "presetTaskTakeOutTrash", stages: ["checkout"] },
  { key: "presetTaskWashDishes", stages: ["checkout"] },
  { key: "presetTaskWipeCounters", stages: ["checkin", "checkout"] },
  { key: "presetTaskSweepAndMop", stages: ["checkout"] },
  { key: "presetTaskTurnOffLights", stages: ["checkout"] },
  { key: "presetTaskLockUp", stages: ["checkout"] },
  { key: "presetTaskReturnKeys", stages: ["checkout"] },
  { key: "presetTaskConfirmEquipment", stages: ["checkout"], photo: true },
  { key: "presetTaskPhotographKitchen", stages: ["checkout"], photo: true },
];

// ─── Storage ↔ Unified conversion helpers ─────────────────────────────────────

/**
 * Collapse server-side arrays (kitchen check-in items, kitchen check-out items,
 * and the sibling photo-requirement arrays) into a single unified list for the
 * editor. Items appearing in both arrays by id are merged; photo requirements
 * without a matching item remain photo-only records when saved.
 */
export function unifyStorageToItems(params: {
  checkinItems: ChecklistItem[];
  checkoutItems: ChecklistItem[];
  checkinPhotoRequirements: PhotoRequirement[];
  checkoutPhotoRequirements: PhotoRequirement[];
}): UnifiedChecklistItem[] {
  const map = new Map<string, UnifiedChecklistItem>();
  const add = (source: ChecklistItem | PhotoRequirement, stage: Stage, record: SavedStage) => {
    let item = map.get(source.id);
    if (!item) {
      item = {
        id: source.id, label: source.label || "", description: source.description,
        requiredOnCheckin: false, requiredOnCheckout: false, photoRequired: false,
        saved: { checkin: {}, checkout: {}, label: source.label || "", description: source.description,
          photoRequired: false, index: map.size, ambiguous: false },
      };
      map.set(source.id, item);
    }
    const saved = item.saved;
    if (!saved) return;
    const records = saved[stage];
    if ((record.item && records.item) || (record.photo && records.photo)) saved.ambiguous = true;
    Object.assign(records, record);
    if (stage === "checkin") item.requiredOnCheckin = true;
    else item.requiredOnCheckout = true;
    item.photoRequired ||= !!record.photo || record.item?.photoRequired === true;
    saved.photoRequired = item.photoRequired;
  };
  params.checkinItems.forEach((item, index) => add(item, "checkin", { item, itemIndex: index }));
  params.checkoutItems.forEach((item, index) => add(item, "checkout", { item, itemIndex: index }));
  params.checkinPhotoRequirements.forEach((photo, index) => add(photo, "checkin", { photo, photoIndex: index }));
  params.checkoutPhotoRequirements.forEach((photo, index) => add(photo, "checkout", { photo, photoIndex: index }));
  return Array.from(map.values());
}

/** Split the editor draft without changing saved customer obligations. */
export function itemsToStorage(items: UnifiedChecklistItem[]): {
  checkinItems: ChecklistItem[];
  checkoutItems: ChecklistItem[];
  checkinPhotoRequirements: PhotoRequirement[];
  checkoutPhotoRequirements: PhotoRequirement[];
} {
  if (items.some(item => item.saved?.ambiguous)) {
    throw new Error("Duplicate saved duty IDs cannot be represented by a single task row.");
  }
  // Preserve independent stage order until the manager explicitly reorders rows.
  const savedIndices = items.flatMap(item => item.saved ? [item.saved.index] : []);
  const reordered = savedIndices.some((index, position) => position > 0 && index < savedIndices[position - 1]);
  const stageArrays = (stage: Stage) => {
    const duties: { value: ChecklistItem; order: number }[] = [];
    const photos: { value: PhotoRequirement; order: number }[] = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item.label.trim() || !(stage === "checkin" ? item.requiredOnCheckin : item.requiredOnCheckout)) continue;
      const saved = item.saved;
      const original = saved?.[stage];
      const stageExisted = !!(original?.item || original?.photo);
      const photoChanged = !saved || saved.photoRequired !== item.photoRequired;
      const text = (source?: ChecklistItem | PhotoRequirement) => ({
        label: source && saved && item.label === saved.label ? source.label : item.label.trim(),
        description: source && saved && item.description === saved.description ? source.description : item.description?.trim() || undefined,
      });
      if (original?.item || !stageExisted) {
        const value: ChecklistItem = original?.item
          ? { ...original.item, ...text(original.item) }
          : { id: item.id, ...text(), required: true, category: "general", photoRequired: item.photoRequired };
        if (photoChanged) value.photoRequired = item.photoRequired;
        duties.push({ value, order: !reordered ? original?.itemIndex ?? Infinity : index });
      }
      const stagePhoto = photoChanged || !stageExisted ? item.photoRequired : !!original?.photo;
      if (stagePhoto) {
        photos.push({
          value: original?.photo ? { ...original.photo, ...text(original.photo) }
            : { id: item.id, ...text(), required: true },
          order: !reordered ? original?.photoIndex ?? Infinity : index,
        });
      }
    }
    return {
      duties: duties.sort((a, b) => a.order - b.order).map(entry => entry.value),
      photos: photos.sort((a, b) => a.order - b.order).map(entry => entry.value),
    };
  };
  const checkin = stageArrays("checkin");
  const checkout = stageArrays("checkout");
  return { checkinItems: checkin.duties, checkoutItems: checkout.duties,
    checkinPhotoRequirements: checkin.photos, checkoutPhotoRequirements: checkout.photos };
}

/**
 * Returns the ids of items that would be silently dropped on save, so the page
 * can block Save and point at the offending row instead of pretending the
 * configuration saved cleanly. The messages themselves are built in the parent
 * where the i18n scope lives.
 */
export function findUnifiedItemProblems(items: UnifiedChecklistItem[]): {
  empty: UnifiedChecklistItem[];
  unassigned: UnifiedChecklistItem[];
  ambiguous: UnifiedChecklistItem[];
} {
  return {
    ambiguous: items.filter(item => item.saved?.ambiguous),
    empty: items.filter((i) => !i.label.trim()),
    unassigned: items.filter(
      (i) => !i.requiredOnCheckin && !i.requiredOnCheckout && !!i.label.trim(),
    ),
  };
}

// ─── Scope chips ─────────────────────────────────────────────────────────────

type Scope = "checkin" | "checkout" | "photo";

/**
 * Scope chips are hand-rolled buttons rather than the shared `Toggle` primitive.
 * Two reasons: `Toggle` lights up on `data-[state=on]:bg-accent`, and `--accent`
 * is pure white in this theme, so the selected state is literally invisible; and
 * the three scopes need three different accent colours, which the primitive
 * does not model. A plain button with an explicit accent keeps the colour
 * system honest and matches the badge colours chefs see downstream.
 *
 * Every chip uses the SAME treatment in its `on` state — a filled tint plus a
 * matching ring — so no chip reads as "more selected" than another, and the
 * one-way lock (an item must belong to at least one flow) is expressed by a
 * small lock glyph on the disabled chip instead of by draining its colour.
 * Previously each scope had a different `on` recipe (emerald vs primary vs
 * amber) and the locked chip was dimmed to 60% opacity, which made a
 * legitimately-active scope look half-selected.
 */
const SCOPE_STYLES: Record<
  Scope,
  { on: string; off: string; icon: typeof LogIn; labelKey: string }
> = {
  checkin: {
    on: "border-emerald-300 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
    off: "border-border bg-background text-muted-foreground hover:bg-muted",
    icon: LogIn,
    labelKey: "checkIn",
  },
  checkout: {
    on: "border-rose-300 bg-rose-50 text-rose-800 ring-1 ring-rose-200",
    off: "border-border bg-background text-muted-foreground hover:bg-muted",
    icon: LogOut,
    labelKey: "checkOut",
  },
  photo: {
    on: "border-amber-300 bg-amber-50 text-amber-800 ring-1 ring-amber-200",
    off: "border-border bg-background text-muted-foreground hover:bg-muted",
    icon: Camera,
    labelKey: "photo",
  },
};

/**
 * Stages where the saved record stays optional for the customer. Mirrors
 * `itemsToStorage`: an existing stage record keeps its own `required` flag;
 * a newly added stage is always required.
 */
function savedOptionalStages(item: UnifiedChecklistItem): Stage[] {
  return (["checkin", "checkout"] as Stage[]).filter((stage) => {
    if (!(stage === "checkin" ? item.requiredOnCheckin : item.requiredOnCheckout)) return false;
    const original = item.saved?.[stage];
    return (original?.item ?? original?.photo)?.required === false;
  });
}

// ─── Single checklist row ────────────────────────────────────────────────────

interface ChecklistRowProps {
  /** Kitchen setup: customer wording, and saved optional duties are labelled. */
  setupUx?: boolean;
  item: UnifiedChecklistItem;
  index: number;
  /** True while this row is the one being dragged. */
  isDragging: boolean;
  onUpdate: (id: string, updated: UnifiedChecklistItem) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (index: number, step: number) => void;
  /** Starts the pointer drag; the container owns the move/up handlers. */
  onDragStart: (index: number, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  canReorderUp: boolean;
  canReorderDown: boolean;
  total: number;
}

function ChecklistRow({
  setupUx,
  item,
  index,
  isDragging,
  onUpdate,
  onRemove,
  onDuplicate,
  onMove,
  onDragStart,
  onDragMove,
  onDragEnd,
  canReorderUp,
  canReorderDown,
  total,
}: ChecklistRowProps) {
  const [noteOpen, setNoteOpen] = useState(!!item.description);
  const labelRef = useRef<HTMLInputElement>(null);

  // Keep the note editor open if a description appears from elsewhere
  useEffect(() => {
    if (item.description) setNoteOpen(true);
  }, [item.description]);

  const optionalStages = setupUx ? savedOptionalStages(item) : [];
  const detailLabel = setupUx
    ? mt("setupUx.detailLabel", { defaultValue: "Extra detail shown to the customer" })
    : mt("optionalHintForChefs");
  const isOnlyCheckin = item.requiredOnCheckin && !item.requiredOnCheckout;
  const isOnlyCheckout = item.requiredOnCheckout && !item.requiredOnCheckin;

  /** Scopes that cannot be switched off because the item would then belong to nothing. */
  const scopeLocked = (scope: Scope): boolean => {
    if (scope === "checkin") return isOnlyCheckin;
    if (scope === "checkout") return isOnlyCheckout;
    return false;
  };

  const toggleScope = (scope: Scope) => {
    if (scopeLocked(scope)) return;
    if (scope === "checkin") {
      onUpdate(item.id, { ...item, requiredOnCheckin: !item.requiredOnCheckin });
      return;
    }
    if (scope === "checkout") {
      onUpdate(item.id, {
        ...item,
        requiredOnCheckout: !item.requiredOnCheckout,
      });
      return;
    }
    onUpdate(item.id, { ...item, photoRequired: !item.photoRequired });
  };

  return (
    <div
      data-checklist-index={index}
      className={cn(
        "group relative rounded-lg border bg-card transition-colors",
        isDragging
          ? "border-primary/60 shadow-lg ring-1 ring-primary/20"
          : "hover:border-border/80 hover:bg-muted/[0.35]",
      )}
    >
      {/*
        Single top-aligned row. Everything on the left is one fixed-width rail
        (handle + number) so the text fields start at exactly the same x on every
        row, and the actions column is pinned to the top rather than centred —
        the row grows when a note is added, and a vertically-centred action set
        would drift downward as it did.
      */}
      <div className={cn("flex items-start gap-2 p-2.5", setupUx && "flex-wrap sm:flex-nowrap")}>
        {/* Drag handle. The only grab surface, so the text field stays usable. */}
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={mt("dragToReorder")}
                  onPointerDown={(event) => onDragStart(index, event)}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragEnd}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      onMove(index, -1);
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault();
                      onMove(index, 1);
                    }
                  }}
                  className={cn(
                    "shrink-0 cursor-grab touch-none rounded text-muted-foreground/40 transition-colors",
                    "hover:text-foreground focus-visible:text-foreground focus-visible:outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
                    "!min-h-0 !min-w-0 p-0.5",
                  )}
                >
                  <GripVertical className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {mt("dragOrUseArrowKeys")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <span className="w-4 shrink-0 text-center text-[11px] font-medium tabular-nums text-muted-foreground/50">
            {index + 1}
          </span>
        </div>

        {/* Primary field + optional note. Setup phones: full width beside the rail. */}
        <div className={cn("min-w-0 flex-1", setupUx && "basis-[calc(100%-3rem)] sm:basis-0")}>
          <Input
            ref={labelRef}
            value={item.label}
            onChange={(e) => onUpdate(item.id, { ...item, label: e.target.value })}
            placeholder={mt("eGWipeDownAllCounters")}
            aria-label={mt("item")}
            className={cn(
              "h-8 border-transparent bg-transparent px-2 text-sm font-medium shadow-none",
              "hover:border-input focus-visible:border-input focus-visible:bg-background",
            )}
          />

          {/*
            Note slot. Both states reserve the same 26px line and begin at the
            same left edge as the label above, so revealing a note does not
            shift the row or introduce a third indent level.
          */}
          <div className="mt-0.5 flex h-[26px] items-center gap-1 pl-2">
            {noteOpen ? (
              <>
                <Pencil className="size-3 shrink-0 text-muted-foreground/50" />
                <Input
                  value={item.description || ""}
                  onChange={(e) =>
                    onUpdate(item.id, {
                      ...item,
                      description: e.target.value || undefined,
                    })
                  }
                  placeholder={detailLabel}
                  aria-label={detailLabel}
                  autoFocus={!item.description}
                  className="h-6 border-transparent bg-transparent px-1 text-xs text-muted-foreground shadow-none hover:border-input focus-visible:border-input focus-visible:bg-background"
                />
                <button
                  type="button"
                  aria-label={mt("removeNote")}
                  title={mt("removeNote")}
                  onClick={() => {
                    setNoteOpen(false);
                    onUpdate(item.id, { ...item, description: undefined });
                  }}
                  className="!min-h-0 !min-w-0 shrink-0 rounded p-1 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                className="!min-h-0 !min-w-0 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-3" />
                {setupUx ? mt("setupUx.addDetail", { defaultValue: "Add detail" }) : mt("addNote")}
              </button>
            )}
            {optionalStages.length > 0 && (
              <Badge variant="outline" className="ml-auto h-5 shrink-0 px-1.5 text-[10px] font-medium">
                {optionalStages.length === 2
                  ? mt("setupUx.rowOptional", { defaultValue: "Optional for the customer" })
                  : optionalStages[0] === "checkin"
                    ? mt("setupUx.rowOptionalCheckin", { defaultValue: "Optional at check-in" })
                    : mt("setupUx.rowOptionalCheckout", { defaultValue: "Optional at check-out" })}
              </Badge>
            )}
          </div>
        </div>

        {/* Scope chips */}
        {/* Setup: on phones the chips and row actions share a second line under
            the task text, aligned with it, so the text field keeps its width. */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-1 pt-0.5",
            setupUx && "order-last pl-12 sm:order-none sm:pl-0",
          )}
          role="group"
          aria-label={mt("appliesTo")}
        >
          {(["checkin", "checkout", "photo"] as Scope[]).map((scope) => {
            const config = SCOPE_STYLES[scope];
            const active =
              scope === "checkin"
                ? item.requiredOnCheckin
                : scope === "checkout"
                  ? item.requiredOnCheckout
                  : item.photoRequired;
            const locked = scopeLocked(scope);
            const ScopeIcon = config.icon;

            return (
              <TooltipProvider key={scope} delayDuration={250}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-pressed={active}
                      aria-label={mt(config.labelKey)}
                      disabled={locked}
                      onClick={() => toggleScope(scope)}
                      className={cn(
                        "!min-h-0 !min-w-0 inline-flex items-center gap-1 rounded-full border px-2 py-1",
                        "text-[11px] font-medium transition-colors",
                        active ? config.on : config.off,
                        // The locked chip keeps its full active colour — it is a
                        // real, applied scope. Only the affordance changes.
                        locked && "cursor-not-allowed",
                      )}
                    >
                      <ScopeIcon className="size-3" />
                      <span className="hidden sm:inline">{mt(config.labelKey)}</span>
                      {locked && <Lock className="size-2.5 opacity-55" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    {locked
                      ? scope === "checkin"
                        ? tt("addToCheckoutFirst")
                        : tt("addToCheckinFirst")
                      : active && setupUx
                        ? scope === "checkin"
                          ? mt("setupUx.chipCheckinOn", { defaultValue: "Included at check-in. Select to remove it from check-in." })
                          : scope === "checkout"
                            ? mt("setupUx.chipCheckoutOn", { defaultValue: "Included at check-out. Select to remove it from check-out." })
                            : mt("setupUx.chipPhotoOn", { defaultValue: "This task needs a photo. Select to stop asking for one." })
                      : active
                        ? scope === "checkin"
                          ? mt("requiredWhenChefChecksIn")
                          : scope === "checkout"
                            ? mt("requiredWhenChefChecksOut")
                            : mt("chefMustUploadPhotoRemove")
                        : scope === "checkin"
                          ? mt("addToCheckInChecklist")
                          : scope === "checkout"
                            ? mt("addToCheckoutChecklist")
                            : mt("requirePhotoAlongsideTick")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>

        {/* Row actions — revealed on hover/focus so the resting row stays calm */}
        <div className={cn(
          "flex shrink-0 items-center gap-0.5 pt-0.5 transition-opacity",
          // Hover-only actions are invisible on touch, so setup keeps them visible on phones.
          setupUx
            ? "order-last ml-auto sm:order-none sm:ml-0 sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100"
            : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
        )}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onDuplicate(item.id)}
            aria-label={mt("duplicateItem")}
            title={mt("duplicateItem")}
          >
            <Duplicate className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:bg-muted hover:text-destructive"
            onClick={() => onRemove(item.id)}
            aria-label={mt("deleteItem")}
            title={mt("deleteItem")}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/*
        Keyboard reorder hint. Announced to screen readers and shown on focus so
        the list is not drag-only: WCAG 2.5.7 requires a non-drag path, and the
        handle answers ArrowUp/ArrowDown.
      */}
      <span className="sr-only">
        {canReorderUp && canReorderDown
          ? `${index + 1} of ${total}. ${mt("dragOrUseArrowKeys")}`
          : `${index + 1} of ${total}.`}
      </span>
    </div>
  );
}

// ─── Preset picker ───────────────────────────────────────────────────────────

function PresetPicker({
  onPick,
  existingLabels,
}: {
  onPick: (preset: (typeof PRESET_TASKS)[number]) => void;
  existingLabels: Set<string>;
}) {
  const available = PRESET_TASKS.filter(
    (preset) => !existingLabels.has(mt(preset.key).toLowerCase()),
  );

  return (
    <div className="min-w-[260px] space-y-1 p-1.5">
      <p className="px-1.5 pb-1 pt-0.5 text-[11px] font-medium text-muted-foreground">
        {mt("commonTasksHint")}
      </p>
      {available.length === 0 ? (
        <p className="px-1.5 py-2 text-xs text-muted-foreground">
          {mt("allCommonTasksAdded")}
        </p>
      ) : (
        available.map((preset) => {
          const stages = preset.stages.includes("checkout")
            ? preset.stages.includes("checkin")
              ? `${mt("checkIn")} + ${mt("checkOut")}`
              : mt("checkOut")
            : mt("checkIn");
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => onPick(preset)}
              className="!min-h-0 flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs transition-colors hover:border-border hover:bg-muted"
            >
              <Plus className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{mt(preset.key)}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {stages}
                {preset.photo ? " · 📷" : ""}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

// ─── Chef View Preview (matches KitchenCheckinTracker) ───────────────────────

function InlineStagePreview({ stage, instructions, items, onEdit, missingInstructions }: {
  stage: Stage;
  instructions: string | null;
  items: UnifiedChecklistItem[];
  /** Targets edited on another surface are simply not offered here. */
  onEdit: Partial<Record<ReviewEditTarget, () => void>>;
  missingInstructions?: string;
}) {
  const ambiguous = items.some(item => item.saved?.ambiguous);
  const arrays = ambiguous ? null : itemsToStorage(items);
  const duties = (stage === "checkin" ? arrays?.checkinItems : arrays?.checkoutItems) ?? [];
  const photos = (stage === "checkin" ? arrays?.checkinPhotoRequirements : arrays?.checkoutPhotoRequirements) ?? [];
  const headingId = `setup-preview-${stage}`;
  const StageIcon = stage === "checkin" ? LogIn : LogOut;
  // Same Required / Optional words the customer sees in KitchenCheckinTracker,
  // as quiet text rather than a badge per row.
  const entry = (record: ChecklistItem | PhotoRequirement) => <li key={record.id} className="flex items-start justify-between gap-3 py-1.5 text-sm">
    <div className="min-w-0">
      <p className="break-words">{record.label}</p>
      {record.description && <p className="text-xs text-muted-foreground">{record.description}</p>}
    </div>
    <span className={cn("shrink-0 pt-0.5 text-[11px]", record.required !== false ? "text-muted-foreground" : "font-medium text-amber-700")}>
      {record.required !== false
        ? mt("setupUx.requiredTask", { defaultValue: "Required" })
        : mt("setupUx.optionalLegacy", { defaultValue: "Optional" })}
    </span>
  </li>;
  const subheading = "text-xs font-medium text-muted-foreground";
  const editButton = (target: ReviewEditTarget) => onEdit[target] && <Button type="button" variant="ghost" size="sm" aria-describedby={headingId}
    onClick={onEdit[target]}
    className="!min-h-0 -mr-2 h-7 shrink-0 px-2 text-xs font-medium text-primary hover:bg-primary/5 hover:text-primary">
    {target === "instructions"
      ? mt("setupUx.editNotes", { defaultValue: "Edit instructions" })
      : mt("setupUx.editTasks", { defaultValue: "Edit tasks" })}
  </Button>;
  return <section aria-labelledby={headingId} className="min-w-0 rounded-xl border bg-background p-4 sm:p-5">
    <h4 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
      <StageIcon className="size-4 text-muted-foreground" />
      {stage === "checkin"
        ? mt("setupUx.arrivalPreview", { defaultValue: "At check-in (arrival)" })
        : mt("setupUx.departurePreview", { defaultValue: "At check-out (departure)" })}
    </h4>
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h5 className={subheading}>{mt("setupUx.previewInstructions", { defaultValue: "Instructions" })}</h5>
        {editButton("instructions")}
      </div>
      {instructions?.trim()
        ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{instructions.trim()}</p>
        : <p className="text-sm italic text-destructive">{missingInstructions ?? mt("setupUx.previewMissing", { defaultValue: "Not written yet. Required before you can save." })}</p>}
    </div>
    <div className="mt-4 space-y-1 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <h5 className={subheading}>{mt("setupUx.previewTasks", { defaultValue: "Tasks to complete" })}</h5>
        {editButton("checklist")}
      </div>
      {ambiguous ? <p role="alert" className="text-sm text-destructive">{mt("setupUx.ambiguous", { defaultValue: "Saved duties contain duplicate IDs within a stage. Saving is blocked to avoid losing data. Ask Local Cooks to review this configuration." })}</p>
        : duties.length === 0 && photos.length === 0 ? <p className="text-sm text-muted-foreground">{mt("setupUx.noTasks", { defaultValue: "No tasks. Customers see only the instructions." })}</p>
        : <>
          {duties.length > 0 && <ol className="divide-y divide-border/60">{duties.map(entry)}</ol>}
          {photos.length > 0 && <div className="pt-2">
            <h5 className={cn(subheading, "flex items-center gap-1.5")}><Camera className="size-3.5" />{mt("setupUx.photos", { defaultValue: "Photos to upload" })}</h5>
            <ul className="divide-y divide-border/60">{photos.map(entry)}</ul>
          </div>}
        </>}
    </div>
  </section>;
}

/**
 * One titled step of the kitchen setup page. Sections share one card and are
 * separated by its dividers, so the page reads as a single form instead of a
 * stack of nested boxes. `tag` states the required/optional rule next to the
 * title, where it is read first.
 */
export function SetupSection({ id, title, tag, description, actions, children, className, ...rest }: {
  id: string;
  title: string;
  tag?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "title" | "id">) {
  return <section aria-labelledby={`${id}-title`} className={cn("space-y-4 px-4 py-5 sm:px-6 sm:py-6", className)} {...rest}>
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 max-w-2xl">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`${id}-title`} className="text-base font-semibold">{title}</h3>
          {tag}
        </div>
        {description && <div className="mt-1 space-y-1 text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions}
    </div>
    {children}
  </section>;
}

/** Small neutral pill stating a section's rule ("Required" / "Optional"). */
export function SetupTag({ tone = "neutral", children }: { tone?: "neutral" | "strong"; children: React.ReactNode }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium",
    tone === "strong" ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>{children}</span>;
}

function ReviewDialog({
  open,
  onOpenChange,
  stage,
  instructions,
  items,
  onEditSection,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stage: Stage;
  instructions: string | null;
  items: UnifiedChecklistItem[];
  /**
   * Takes the manager to the section they want to change. Review surfaces are
   * where people catch their own mistakes, and Baymard's guidance is explicit
   * that they must not be forced to navigate back through the whole form to fix
   * one — so every block here has a way back.
   */
  onEditSection: (target: ReviewEditTarget) => void;
}) {
  const isCheckin = stage === "checkin";

  const flowItems = items.filter(
    (i) => i.label.trim() && (isCheckin ? i.requiredOnCheckin : i.requiredOnCheckout),
  );
  const photoItems = flowItems.filter((i) => i.photoRequired);
  const hasInstructions = !!instructions;

  const StageIcon = isCheckin ? LogIn : LogOut;

  const nothingConfigured = flowItems.length === 0 && !hasInstructions;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        The footer's close button is the labelled exit, so it stays in
        the place the eye already is rather than a chrome glyph in the corner.
        Wider than the default dialog on large screens because this is a reading
        surface, not a form — a line of prose wants a book measure, not a phone
        column, and the two-up checklist stays scannable at this width.
      */}
      <AppDialogContent
        showCloseButton={false}
        className="flex flex-col gap-0 overflow-hidden p-0 max-h-[90vh] sm:max-w-lg lg:max-w-2xl"
      >
        {/* One header block instead of a title stack plus a counts strip: the
            counts belong to the reading order, not to the chrome above it. */}
        <DialogHeader className="space-y-0 border-b px-5 py-4 text-left">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base font-medium">
                <StageIcon className="size-4 shrink-0 text-muted-foreground" />
                {isCheckin ? mt("reviewCheckinTitle") : mt("reviewCheckoutTitle")}
              </DialogTitle>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {isCheckin ? mt("reviewCheckinSubtitle") : mt("reviewCheckoutSubtitle")}
              </p>
            </div>
            {/* The one loud thing in the dialog: it answers "how much is this?"
                before a single row is read. */}
            <span className="shrink-0 pt-0.5 text-2xl font-semibold tabular-nums leading-none">
              {flowItems.length}
            </span>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {nothingConfigured ? (
            <div className="rounded-lg border border-dashed px-6 py-12 text-center">
              <ClipboardCheck className="mx-auto mb-2 size-6 text-muted-foreground/40" />
              <p className="text-sm font-medium">{mt("reviewEmptyTitle")}</p>
              <p className="mx-auto mt-1 max-w-[240px] text-[10px] leading-snug text-muted-foreground/80">
                {isCheckin ? mt("reviewEmptyHintCheckin") : mt("reviewEmptyHintCheckout")}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Notes first — they are the thing a chef reads before doing
                  anything, and they are the part most easily forgotten when
                  someone configured the page weeks ago. */}
              {hasInstructions && (
                <ReviewBlock
                  icon={<MessageSquare className="size-3.5" />}
                  title={isCheckin ? mt("arrivalInstructionsTitle") : mt("departureInstructionsTitle")}
                  onEdit={() => onEditSection("instructions")}
                >
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                    {instructions}
                  </p>
                </ReviewBlock>
              )}

              <ReviewBlock
                icon={<ListChecks className="size-3.5" />}
                title={mt("checklist")}
                onEdit={() => onEditSection("checklist")}
              >
                {flowItems.length === 0 ? (
                  <p className="text-xs italic text-muted-foreground">
                    {mt("reviewNoTasks")}
                  </p>
                ) : (
                  /* A divide-y list rather than a boxed card per row: at this
                     width the separator does the work a border was doing, and
                     the rows read as one continuous list instead of a stack of
                     controls. Row padding is what makes it scannable. */
                  <ol className="divide-y divide-border/60">
                    {flowItems.map((item, index) => (
                      <li key={item.id} className="flex items-start gap-3 py-2 first:pt-0.5 last:pb-0.5">
                        {/* A static glyph, not a Checkbox: a control here would
                            invite a click that changes nothing. */}
                        <span className="mt-px w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/60">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs leading-relaxed text-foreground">{item.label}</p>
                          {item.description && (
                            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                              {item.description}
                            </p>
                          )}
                        </div>
                        {item.photoRequired && (
                          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-amber-700">
                            <Camera className="size-2.5" />
                            {mt("reviewPhotoRequiredTag")}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </ReviewBlock>
            </div>
          )}
        </div>

        {/* One labelled exit. It replaces the primitive's floating X, so the
            way out is named rather than a glyph in the corner — and it is the
            only control in the dialog, which is what keeps a review surface
            feeling like a read rather than a form. */}
        <div className="border-t px-5 py-3">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            {mt("close")}
          </Button>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}

/** Which part of the page the review dialog should scroll back to. */
type ReviewEditTarget = "instructions" | "checklist";

/**
 * Sends the manager from the review dialog back to the field they want to fix.
 *
 * Runs a frame late on purpose. The dialog is a modal, so while it is mounted it
 * holds a focus trap and the page beneath it is inert — scrolling in the same
 * tick as the close would move the page while it is still covered, and Radix
 * restores focus on unmount, which would fight a scroll started simultaneously.
 * One frame lets the close commit first, so the movement is visible.
 */
function scrollToReviewTarget(stage: Stage, target: ReviewEditTarget) {
  requestAnimationFrame(() => {
    const panel = document.querySelector<HTMLElement>(`[data-stage-panel="${stage}"]`);
    if (!panel) return;
    const anchor =
      target === "instructions"
        ? panel.querySelector<HTMLElement>("[data-review-anchor='instructions']")
        : panel;
    (anchor ?? panel).scrollIntoView({ behavior: "smooth", block: "center" });
    // Focus the panel, not the anchor: a container is a legitimate focus target
    // and will not pull focus out of a field the manager is about to type in.
    panel.focus({ preventScroll: true });
  });
}

/**
 * One titled group inside the review dialog.
 *
 * Every block carries its own Edit affordance rather than one at the foot of
 * the dialog, because a single global "edit" forces the manager to work out
 * where the thing they want lives. Naming the destination is the whole value
 * of a review step.
 *
 * The group label is sentence-case at normal weight, not a bold uppercase
 * eyebrow. The eyebrow style fights a reading surface: five shouting labels
 * read as five competing headings, which is the opposite of scannable.
 */
function ReviewBlock({
  icon,
  title,
  onEdit,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border">
      <header className="flex items-center justify-between gap-2 px-3.5 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-muted-foreground">{icon}</span>
          <span className="truncate text-xs font-medium text-foreground">{title}</span>
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="!min-h-0 !min-w-0 shrink-0 rounded px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {mt("editInstructions")}
        </button>
      </header>
      <div className="border-t border-border/60 px-3.5 py-2.5">{children}</div>
    </section>
  );
}

// ─── Stage Header ─────────────────────────────────────────────────────────────

interface StageHeaderProps {
  setupUx?: boolean;
  coupledStages?: boolean;
  stage: Stage;
  enabled: boolean;
  onEnabledChange: (val: boolean) => void;
  instructions: string | null;
  onInstructionsChange: (val: string | null) => void;
  itemCount: number;
  photoCount: number;
  onOpenPreview: () => void;
  /**
   * Moves focus off the switch after the flow is toggled. See the note in
   * `CheckinCheckoutSettings` for why: a switch that is off-screen steals the
   * page scroll when it takes focus.
   */
  onToggleClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

function StageHeader({
  setupUx,
  coupledStages,
  stage,
  enabled,
  onEnabledChange,
  instructions,
  onInstructionsChange,
  itemCount,
  photoCount,
  onOpenPreview,
  onToggleClick,
  onToggleMouseDown,
  onToggleKeyDown,
}: StageHeaderProps) {
  const title = stage === "checkin" ? mt("checkInStage") : mt("checkOutStage");
  const StageIcon = stage === "checkin" ? LogIn : LogOut;

  const hasInstructions = !!instructions;

  /**
   * Whether the notes editor is open.
   *
   * Starts closed, always: the read state is the correct default once notes
   * exist, and the empty state is the correct default when they do not. This
   * must NOT be seeded from `instructions`, because on first mount those props
   * are still empty — the settings query has not resolved — so seeding would
   * read `false` and never correct itself, and seeding from a later value would
   * re-open the editor under the manager mid-edit.
   */
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [draft, setDraft] = useState(() => instructions ?? "");
  const [savedAt, setSavedAt] = useState(0);

  /**
   * The last committed values this component knows about, used to tell a
   * server hydration apart from a user edit.
   *
   * The previous approach inferred "is the user typing?" from
   * `draft !== instructions`, which is wrong in both directions: on first mount
   * an incoming saved note looks exactly like an unsaved edit (empty draft vs.
   * non-empty prop), so the sync effect bailed out and the editor sat there
   * showing a placeholder instead of the note. Comparing against what this
   * component last *saw committed* is unambiguous — a change in that value is
   * hydration and must be adopted; a change in the draft with a steady
   * committed value is the user typing and must be preserved.
   */
  const lastCommittedRef = useRef({
    instructions: instructions ?? "",
  });

  // Adopt committed values whenever they actually change underneath us. On the
  // very first run this is a genuine hydration (empty initial state → server
  // values), so the drafts are filled in and no edit is lost, because nothing
  // has been typed yet.
  useEffect(() => {
    const next = {
      instructions: instructions ?? "",
    };
    const prev = lastCommittedRef.current;
    if (prev.instructions === next.instructions) return;
    lastCommittedRef.current = next;
    setDraft(next.instructions);
  }, [instructions]);

  /** True once the manager has typed something the committed value lacks. */
  const notesDirty =
    draft !== (instructions ?? "");

  const commitNotes = useCallback(() => {
    const next = draft.trim();

    /**
     * Record the committed values *before* pushing them up, and synchronously.
     *
     * `onInstructionsChange` is a parent state update, so the new props do not
     * arrive until the next render — but `setDetailsOpen(false)` below takes
     * effect immediately. Without this line the sync effect would see "committed
     * changed" on the following render and reset the drafts, and the panel would
     * flash the editor back open in the window between the two. Writing the ref
     * first collapses that window to nothing: the effect sees the values it just
     * caused and correctly does nothing.
     */
    lastCommittedRef.current = { instructions: next };

    onInstructionsChange(next || null);

    setDraft(next);
    setSavedAt(Date.now());
    setDetailsOpen(false);
  }, [draft, onInstructionsChange]);

  const cancelNotes = useCallback(() => {
    setDraft(instructions ?? "");
    setDetailsOpen(false);
  }, [instructions]);

  /**
   * In edit mode Escape must mean one thing on every field: discard. Notes are
   * the only field here that cannot undo itself keystroke-by-keystroke, so it
   * needs the explicit exit. The disclosure only closes if nothing was typed —
   * otherwise the manager can lose a paragraph to a stray Escape and have no
   * way to tell where it went.
   */
  const onNotesKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (notesDirty) cancelNotes();
      else setDetailsOpen(false);
    },
    [notesDirty, cancelNotes],
  );

  if (setupUx) {
    const missing = enabled && !instructions?.trim();
    // Plain field, no inner card: the section heading already says both are required.
    return (
      <div data-stage-panel={stage} tabIndex={-1} className="flex flex-col gap-1.5 focus:outline-none">
        <Label htmlFor={`${stage}-instructions`} className="flex items-center gap-1.5 text-sm font-medium">
          {stage === "checkin" ? <LogIn className="size-4 text-muted-foreground" /> : <LogOut className="size-4 text-muted-foreground" />}
          {stage === "checkin"
            ? mt("setupUx.arrivalInstructions", { defaultValue: "Arrival instructions" })
            : mt("setupUx.departureInstructions", { defaultValue: "Departure instructions" })}
        </Label>
        <p id={`${stage}-setup-example`} className="text-xs text-muted-foreground">
          {stage === "checkin"
            ? mt("setupUx.arrivalHelp", { defaultValue: "Where to enter, how to get in if nobody is there, and who to call if access fails." })
            : mt("setupUx.departureHelp", { defaultValue: "Where to leave keys, how to lock up, and who to call if something goes wrong." })}
        </p>
        <Textarea id={`${stage}-instructions`} value={instructions ?? ""} rows={5}
          className="mt-1 min-h-[132px] resize-y"
          placeholder={stage === "checkin"
            ? mt("setupUx.arrivalExample", { defaultValue: "Example:\n1. Use the side entrance.\n2. If it is locked, call the kitchen contact listed in your booking." })
            : mt("setupUx.departureExample", { defaultValue: "Example:\n1. Leave the key on the marked hook.\n2. Close the door. If it will not lock, call the kitchen manager." })}
          required={enabled} aria-invalid={missing}
          aria-describedby={missing ? `${stage}-setup-example ${stage}-notes-help` : `${stage}-setup-example`}
          onChange={event => onInstructionsChange(event.target.value || null)} />
        {missing && <p id={`${stage}-notes-help`} className="text-xs text-destructive">
          {stage === "checkin"
            ? mt("setupUx.arrivalMissing", { defaultValue: "Write arrival instructions before saving." })
            : mt("setupUx.departureMissing", { defaultValue: "Write departure instructions before saving." })}
        </p>}
      </div>
    );
  }

  if (coupledStages) return (
    <div data-stage-panel={stage} className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <Badge variant="outline">{mt(enabled ? 'trackingNotesRequired' : 'storageTrackingOffNotesDraft')}</Badge>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${stage}-instructions`}>
          {mt(stage === 'checkin' ? 'arrivalInstructionsTitle' : 'departureInstructionsTitle')}
        </Label>
        <Textarea id={`${stage}-instructions`} value={instructions ?? ''}
          required={enabled} aria-invalid={enabled && !instructions?.trim()}
          aria-describedby={`${stage}-notes-help`}
          onChange={event => onInstructionsChange(event.target.value || null)} />
        <p id={`${stage}-notes-help`} className={enabled && !instructions?.trim() ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {mt(enabled && !instructions?.trim() ? 'storageTrackingRequiredNotes' : 'trackingNotesSaveTogether')}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">{mt('storageTrackingOptionalDuties')}</p>
    </div>
  );

  // A flow with nothing in it will do nothing for the chef, which is worth
  // saying before they save and wonder.
  const needsSetup = enabled && itemCount === 0;

  return (
    <div
      data-stage-panel={stage}
      tabIndex={-1}
      className={cn(
        "rounded-lg border p-3 transition-colors focus:outline-none",
        enabled ? "border-border bg-card" : "border-dashed border-border bg-muted/30",
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <div
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md border",
              enabled
                ? stage === "checkin"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                  : "border-primary/20 bg-primary/5 text-primary"
                : "border-border bg-background text-muted-foreground",
            )}
          >
            <StageIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold">{title}</span>
              <Badge
                variant="outline"
                className={cn(
                  "h-4 px-1.5 text-[10px] font-medium",
                  enabled
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "text-muted-foreground",
                )}
              >
                {enabled ? mt("flowOnBadge") : mt("flowOffBadge")}
              </Badge>
              {needsSetup && (
                <Badge
                  variant="outline"
                  className="h-4 border-amber-300 bg-amber-50 px-1.5 text-[10px] font-medium text-amber-800"
                >
                  <AlertTriangle className="mr-0.5 size-2.5" />
                  {mt("flowSetupNeededBadge")}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground/80">
              {enabled ? mt("flowOnDescription") : mt("flowOffDescription")}
            </p>
            {/* Be active about why nothing is happening. A dashed panel and the
                word "Off" explain the state but not the next step. */}
            {stage === "checkin" && !enabled && (
              <p className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-muted-foreground/80">
                <Info className="mt-0.5 size-3 shrink-0" />
                {mt("checkinOffArrivalTimingNote")}
              </p>
            )}
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onEnabledChange}
          onMouseDown={onToggleMouseDown}
          onClick={onToggleClick}
          onKeyDown={onToggleKeyDown}
          aria-label={enabled ? mt("disableStage", { stage: title }) : mt("enableStage", { stage: title })}
        />
      </div>

      {enabled && (
        <>
          {/* Live totals — the reason the flow is worth turning on */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="h-5 px-2 text-[11px] font-normal">
              <ListChecks className="mr-1 size-3 text-muted-foreground" />
              {mt("itemCountLabel", { count: itemCount })}
            </Badge>
            {photoCount > 0 && (
              <Badge
                variant="outline"
                className="h-5 border-amber-300 bg-amber-50 px-2 text-[11px] font-normal text-amber-800"
              >
                <Camera className="mr-1 size-3" />
                {mt("photoCountLabel", { count: photoCount })}
              </Badge>
            )}
          </div>

          <div className="mt-3 border-t pt-3" data-review-anchor="instructions" onKeyDown={onNotesKeyDown}>
            {detailsOpen ? (
              <div className="space-y-2">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor={`${stage}-instructions`}
                      className="text-sm font-semibold"
                    >
                      {stage === "checkin" ? mt("arrivalInstructionsTitle") : mt("departureInstructionsTitle")}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {mt("optionalLabel")}
                      </span>
                    </Label>
                  </div>
                  {/*
                    This is not where tasks go. A checklist item is a checkbox the
                    chef must tick before the form will submit; this box is plain
                    text shown above that list. Writing the same sentence in both
                    places shows it twice and only one of them gates the submit —
                    so the field says out loud what it is *for*.
                  */}
                  <p className="mt-1 text-[10px] leading-snug text-muted-foreground/80">
                    {stage === "checkin" ? mt("arrivalInstructionsHelp") : mt("departureInstructionsHelp")}
                  </p>
                  <Textarea
                    id={`${stage}-instructions`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={
                      stage === "checkin"
                        ? mt("arrivalInstructionsPlaceholder")
                        : mt("departureInstructionsPlaceholder")
                    }
                    rows={3}
                    className="mt-1.5 bg-background text-xs"
                  />
                </div>

                {/*
                  The commit pair. Previously the only exit was "Hide", which
                  reads as "close this" and says nothing about whether the text
                  was kept — the manager had to guess. Save makes the model
                  explicit, Cancel is the honest escape hatch, and the pair sits
                  where the eye already is after typing.

                  Save appears only after the draft changes.
                */}
                <div className="flex items-center justify-end gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={cancelNotes}
                    className="!min-h-0 !min-w-0 rounded px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {mt("cancel")}
                  </button>
                  {notesDirty && <Button
                    type="button"
                    size="sm"
                    onClick={commitNotes}
                    className="!min-h-0 h-7 gap-1.5 rounded-md px-2 text-[11px]"
                  >
                    <Check className="size-3" />
                    {mt("saveNotes")}
                  </Button>}
                </div>
              </div>
            ) : hasInstructions ? (
              /*
                The read state, which is what the manager sees most of the time.
                It is a calm summary of committed text rather than a disabled
                textarea, and it stays visible — no collapsing into a one-line
                teaser. Notes are the reason a chef gets the access details
                right, so hiding them behind a click trades a little tidiness
                for a real chance the manager forgets what they wrote.

                Edit is revealed on hover but never hidden entirely (it dims
                instead), because a purely hover-only affordance is invisible on
                touch. One label for the whole block rather than one per field:
                they commit together, so they edit together.
              */
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    {stage === "checkin" ? mt("arrivalInstructionsTitle") : mt("departureInstructionsTitle")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSavedAt(0);
                      setDetailsOpen(true);
                    }}
                    className="!min-h-0 !min-w-0 inline-flex items-center gap-1 rounded px-1 text-[11px] font-medium text-muted-foreground opacity-70 transition-opacity hover:text-foreground hover:opacity-100"
                  >
                    <Pencil className="size-3" />
                    {mt("editInstructions")}
                  </button>
                </div>

                <div className="mt-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-2">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                      {instructions}
                    </p>
                    {savedAt > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 pt-px text-[10px] font-medium text-emerald-600">
                        <Check className="size-2.5" />
                        {mt("notesSaved")}
                      </span>
                    )}
                  </div>

                </div>
              </div>
            ) : (
              /* Notes are empty. This is still the primary writing surface, so
                 the entry point is a full-width field-shaped button rather than
                 a small muted chip — it should read as "a thing you can type in
                 that is currently empty", not as a secondary toggle.

                 The label is set at the same size as every other field label on
                 the page (`text-xs` medium, matching ChecklistRow's `addNote`),
                 and the help line one step below it. Anything larger and the
                 entry point stops matching the page it lives on. */
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setDetailsOpen(true)}
                  className="!min-h-0 flex w-full items-center gap-2 rounded-md border border-dashed border-border bg-background px-2.5 py-2 text-left transition-colors hover:border-solid hover:border-primary/40 hover:bg-muted/40"
                >
                  <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">
                      {stage === "checkin" ? mt("arrivalInstructionsCta") : mt("departureInstructionsCta")}
                    </span>
                    <span className="mt-px block text-[10px] leading-snug text-muted-foreground/80">
                      {stage === "checkin" ? mt("arrivalInstructionsHelp") : mt("departureInstructionsHelp")}
                    </span>
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Review entry — deliberately the quiet action on this panel. The
              notes field above is what the manager is here to write; this only
              opens a read-back. Kept as a plain text button so it stays
              discoverable without competing with the field for attention. */}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={onOpenPreview}
              title={mt("reviewOpenHint")}
              className="!min-h-0 !min-w-0 inline-flex items-center gap-1 rounded px-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ListChecks className="size-3" />
              {stage === "checkin" ? mt("reviewCheckinCta") : mt("reviewCheckoutCta")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Checklist list ──────────────────────────────────────────────────────────

/** Which slice of the task list is visible. Purely a view — never a partition. */
type ItemFilter = "all" | "checkin" | "checkout" | "photo";

interface ChecklistListProps {
  setupUx?: boolean;
  /** The rows to render — already filtered. */
  items: UnifiedChecklistItem[];
  sourceItems: UnifiedChecklistItem[];
  /** How many rows exist in the unfiltered list, for the filtered empty state. */
  totalCount: number;
  filter: ItemFilter;
  onItemsChange: (next: UnifiedChecklistItem[]) => void;
  checkinEnabled: boolean;
  checkoutEnabled: boolean;
  onClearFilter: () => void;
}

/**
 * The editable list of checklist items.
 *
 * Reordering is pointer-based rather than library-based: `framer-motion`'s
 * `Reorder` only supports a single axis, and a purpose-built implementation is
 * a handle, a `setPointerCapture` and an `elementFromPoint` hit-test — far less
 * than the cost of a dependency. `elementFromPoint` is used instead of
 * per-row `pointerenter` because a captured pointer retargets all subsequent
 * events to the handle, so sibling enter/leave never fire.
 *
 * Every reorder also has a keyboard path (ArrowUp / ArrowDown on the focused
 * handle), because drag cannot be the only way to fix an order.
 *
 * `items` may be a filtered view, so mutations are resolved against the
 * unfiltered source by id and written back in full — a filtered drag would
 * otherwise reorder the visible slice in place and scramble the rows the
 * manager cannot see. Numbering stays absolute for the same reason.
 */
function ChecklistList({
  setupUx,
  items,
  sourceItems,
  totalCount,
  filter,
  onItemsChange,
  checkinEnabled,
  checkoutEnabled,
  onClearFilter,
}: ChecklistListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [removed, setRemoved] = useState<{
    item: UnifiedChecklistItem;
    index: number;
  } | null>(null);

  // Refs keep the drag handlers and the stable callbacks free of `items` deps,
  // which avoids re-creating them on every keystroke.
  const itemsRef = useRef(sourceItems);
  itemsRef.current = sourceItems;
  const visibleItemsRef = useRef(items);
  visibleItemsRef.current = items;
  const onItemsChangeRef = useRef(onItemsChange);
  onItemsChangeRef.current = onItemsChange;

  const dragFromRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const updateItem = useCallback((id: string, updated: UnifiedChecklistItem) => {
    onItemsChangeRef.current(
      itemsRef.current.map((i) => (i.id === id ? updated : i)),
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    const current = itemsRef.current;
    const index = current.findIndex((i) => i.id === id);
    if (index === -1) return;
    setRemoved({ item: current[index], index });
    onItemsChangeRef.current(current.filter((i) => i.id !== id));
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setRemoved(null), UNDO_WINDOW_MS);
  }, []);

  const undoRemove = useCallback(() => {
    setRemoved((pending) => {
      if (pending) {
        const next = [...itemsRef.current];
        next.splice(Math.min(pending.index, next.length), 0, pending.item);
        onItemsChangeRef.current(next);
      }
      return null;
    });
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  const duplicateItem = useCallback((id: string) => {
    const current = itemsRef.current;
    const index = current.findIndex((i) => i.id === id);
    if (index === -1) return;
    const clone: UnifiedChecklistItem = {
      ...current[index],
      id: generateUnifiedItemId(),
      saved: undefined,
    };
    const next = [...current];
    next.splice(index + 1, 0, clone);
    onItemsChangeRef.current(next);
  }, []);

  const addItem = useCallback(() => {
    // Default new items to whichever flow is enabled. If both are enabled,
    // default to check-in (most common). The chips are one tap away.
    const addToCheckin = checkinEnabled || !checkoutEnabled;
    onItemsChangeRef.current([
      ...itemsRef.current,
      {
        id: generateUnifiedItemId(),
        label: "",
        description: undefined,
        requiredOnCheckin: addToCheckin,
        requiredOnCheckout: !addToCheckin,
        photoRequired: false,
      },
    ]);
  }, [checkinEnabled, checkoutEnabled]);

  const addPreset = useCallback((preset: (typeof PRESET_TASKS)[number]) => {
    onItemsChangeRef.current([
      ...itemsRef.current,
      {
        id: generateUnifiedItemId(),
        label: mt(preset.key),
        description: undefined,
        requiredOnCheckin: preset.stages.includes("checkin"),
        requiredOnCheckout: preset.stages.includes("checkout"),
        photoRequired: !!preset.photo,
      },
    ]);
  }, []);

  /**
   * Move one row one slot, in the *unfiltered* list. Neighbours are found by id
   * so that under a filter the row swaps with the next row of the same kind
   * instead of jumping past items that are not on screen.
   */
  const moveItem = useCallback((from: number, to: number) => {
    const current = itemsRef.current;
    const dragged = visibleItemsRef.current[from];
    const over = visibleItemsRef.current[to];
    if (!dragged || !over) return;
    const fromAbs = current.findIndex((i) => i.id === dragged.id);
    const toAbs = current.findIndex((i) => i.id === over.id);
    if (fromAbs === -1 || toAbs === -1 || fromAbs === toAbs) return;
    const next = [...current];
    const [moved] = next.splice(fromAbs, 1);
    next.splice(toAbs, 0, moved);
    onItemsChangeRef.current(next);
  }, []);

  const onDragStart = useCallback(
    (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragFromRef.current = index;
      dragMovedRef.current = false;
      setDragIndex(index);
      setDragActive(true);
    },
    [],
  );

  const onDragMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const from = dragFromRef.current;
      if (from === null) return;
      const row = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest("[data-checklist-index]");
      if (!row) return;
      const target = Number(row.getAttribute("data-checklist-index"));
      if (Number.isNaN(target) || target === from) return;
      moveItem(from, target);
      dragMovedRef.current = true;
      dragFromRef.current = target;
      setDragIndex(target);
    },
    [moveItem],
  );

  const onDragEnd = useCallback(() => {
    if (!dragActive) return;
    dragFromRef.current = null;
    setDragActive(false);
    setDragIndex(null);
  }, [dragActive]);

  // A pointer released outside any row must still end the drag.
  useEffect(() => {
    if (!dragActive) return;
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", onDragEnd);
    return () => {
      window.removeEventListener("pointerup", onDragEnd);
      window.removeEventListener("pointercancel", onDragEnd);
    };
  }, [dragActive, onDragEnd]);

  const existingLabels = useMemo(
    () => new Set(sourceItems.map((i) => i.label.trim().toLowerCase())),
    [sourceItems],
  );

  const checkinCount = items.filter((i) => i.requiredOnCheckin).length;
  const checkoutCount = items.filter((i) => i.requiredOnCheckout).length;

  // Filtered to nothing: the list is not empty, it is just all hidden. Offer the
  // way back rather than showing the blank-slate "add your first task" state.
  const filteredToNothing =
    filter !== "all" && items.length === 0 && totalCount > 0;

  return (
    <div className="space-y-2.5">
      {filteredToNothing ? (
        <div className="rounded-lg border border-dashed py-8 text-center">
          <ListChecks className="mx-auto mb-2 size-6 text-muted-foreground/40" />
          <p className="text-sm font-medium">
            {mt("noTasksInFilter", { filter: mt(`filter_${filter}`) })}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClearFilter}
            className="mt-2 h-8 rounded-lg px-3 text-xs hover:bg-muted"
          >
            {mt("showAllTasks")}
          </Button>
        </div>
      ) : items.length === 0 && setupUx ? (
        // Zero tasks is a valid setup, so the empty state is one quiet line, not a call to action.
        <div className="flex flex-col gap-3 rounded-lg border border-dashed px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{mt("setupUx.emptyTitle", { defaultValue: "No tasks added" })}</span>
            {" · "}
            {mt("setupUx.emptyHint", { defaultValue: "Customers will see only your instructions." })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addItem}
              className="h-8 rounded-lg px-3 text-xs shadow-none hover:translate-y-0 hover:shadow-none">
              <Plus className="mr-1.5 size-3.5" />
              {mt("setupUx.addTask", { defaultValue: "Add a task" })}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-3 text-xs hover:bg-muted">
                  <PlaylistPlus className="mr-1.5 size-3.5" />
                  {mt("startFromCommonTasks")}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-1.5">
                <PresetPicker onPick={addPreset} existingLabels={existingLabels} />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed py-8 text-center">
          <ClipboardCheck className="mx-auto mb-2 size-6 text-muted-foreground/40" />
          <p className="text-sm font-medium">{mt("noChecklistItemsYet")}</p>
          <p className="mx-auto mt-1 max-w-sm text-[10px] leading-snug text-muted-foreground/80">
            {mt("noChecklistItemsHint")}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addItem}
              className="h-8 rounded-lg px-3 text-xs shadow-none hover:translate-y-0 hover:shadow-none"
            >
              <Plus className="mr-1.5 size-3.5" />
              {mt("addChecklistItem")}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs hover:bg-muted"
                >
                  <PlaylistPlus className="mr-1.5 size-3.5" />
                  {mt("startFromCommonTasks")}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="center" className="w-auto p-1.5">
                <PresetPicker onPick={addPreset} existingLabels={existingLabels} />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item, index) => (
            <ChecklistRow
              key={item.id}
              setupUx={setupUx}
              item={item}
              index={index}
              isDragging={dragIndex === index}
              total={items.length}
              onUpdate={updateItem}
              onRemove={removeItem}
              onDuplicate={duplicateItem}
              onMove={moveItem}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              canReorderUp={index > 0}
              canReorderDown={index < items.length - 1}
            />
          ))}
        </div>
      )}

      {/* Undo affordance — replaces a confirmation dialog for a reversible action */}
      {removed && (
        <UndoBar
          label={mt("itemRemoved", { label: removed.item.label || mt("item") })}
          seconds={Math.round(UNDO_WINDOW_MS / 1000)}
          onUndo={undoRemove}
        />
      )}

      {/* Footer: add row + scope legend. Hidden for the filtered-empty state,
          which already offers a way out. */}
      {items.length > 0 && (
        <div className="space-y-2 pt-0.5">
          <div className={setupUx ? "flex flex-wrap gap-2" : "flex flex-col sm:flex-row gap-2"}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addItem}
              className={cn("h-8 rounded-lg text-xs shadow-none hover:translate-y-0 hover:shadow-none", !setupUx && "flex-1")}
            >
              <Plus className="mr-1.5 size-3.5" />
              {setupUx ? mt("setupUx.addTask", { defaultValue: "Add a task" }) : mt("addChecklistItem")}
            </Button>
            {/* Sits beside the add button, not only in the empty state, so the
                preset list stays one tap away however long the list has grown. */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant={setupUx ? "ghost" : "outline"}
                  size="sm"
                  className={cn("h-8 rounded-lg text-xs shadow-none hover:translate-y-0 hover:shadow-none", setupUx ? "hover:bg-muted" : "flex-1")}
                >
                  <PlaylistPlus className="mr-1.5 size-3.5" />
                  {mt("startFromCommonTasks")}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-1.5">
                <PresetPicker onPick={addPreset} existingLabels={existingLabels} />
              </PopoverContent>
            </Popover>
          </div>
          {!setupUx && (
            <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <Lightbulb className="size-3" />
              {mt("scopeLegend")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Editor ──────────────────────────────────────────────────────────────

export interface KitchenCheckinCheckoutEditorProps {
  instructionControls?: Partial<Record<Stage, React.ReactNode>>;
  instructionReadOnly?: Partial<Record<Stage, boolean>>;
  taskControls?: React.ReactNode;
  previewItems?: UnifiedChecklistItem[];
  previewInstructions?: { checkinInstructions: string | null; checkoutInstructions: string | null };
  previewKitchenName?: string;
  /** Kitchen setup opts in; shared storage keeps its existing review behavior. */
  setupLocationName?: string;
  /** Kitchen setup only: rendered as its own section between tasks and the preview. */
  beforeReview?: React.ReactNode;
  /**
   * Kitchen setup only. The instructions surface edits the two notes and shows the
   * saved tasks as a summary; the tasks surface edits tasks and shows the saved notes
   * read-only. Each surface's preview is still the customer's whole view.
   */
  setupMode?: "instructions" | "tasks";
  /** Instructions surface: opens the customer tasks page. */
  onOpenTasks?: () => void;
  coupledStages?: boolean;
  title?: string;
  items: UnifiedChecklistItem[];
  onItemsChange: (next: UnifiedChecklistItem[]) => void;
  checkinEnabled: boolean;
  onCheckinEnabledChange: (val: boolean) => void;
  checkoutEnabled: boolean;
  onCheckoutEnabledChange: (val: boolean) => void;
  checkinInstructions: string | null;
  onCheckinInstructionsChange: (val: string | null) => void;
  checkoutInstructions: string | null;
  onCheckoutInstructionsChange: (val: string | null) => void;
  /** Forwarded to both flow switches — see `StageHeaderProps.onToggleClick`. */
  onFlowToggleClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onFlowToggleMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onFlowToggleKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export function KitchenCheckinCheckoutEditor({
  instructionControls,
  instructionReadOnly,
  taskControls,
  previewItems,
  previewInstructions,
  previewKitchenName,
  setupLocationName,
  beforeReview,
  setupMode,
  onOpenTasks,
  coupledStages,
  title,
  items,
  onItemsChange,
  checkinEnabled,
  onCheckinEnabledChange,
  checkoutEnabled,
  onCheckoutEnabledChange,
  checkinInstructions,
  onCheckinInstructionsChange,
  checkoutInstructions,
  onCheckoutInstructionsChange,
  onFlowToggleClick,
  onFlowToggleMouseDown,
  onFlowToggleKeyDown,
}: KitchenCheckinCheckoutEditorProps) {
  const setupUx = coupledStages && setupLocationName !== undefined;
  const hasSavedOptional = useMemo(
    () => !!setupUx && items.some((item) => savedOptionalStages(item).length > 0),
    [setupUx, items],
  );
  const editorRef = useRef<HTMLDivElement>(null);
  const [previewStage, setPreviewStage] = useState<Stage | null>(null);
  /** Which slice of the shared list is on screen. Editing is never restricted. */
  const [itemFilter, setItemFilter] = useState<ItemFilter>("all");

  /**
   * Takes the manager from the review dialog back to the thing they want to
   * change, and closes the dialog on the way. The whole point of a review
   * surface is that catching a mistake there should cost one click, not a
   * walk back through the page — leaving the dialog open would just put a
   * panel between them and the field.
   *
   * The target is scrolled to *after* the close, in a frame, because the dialog
   * is a modal: scrolling underneath it while it is still mounted does nothing
   * the manager can see, and Radix restores focus on unmount which would fight
   * a scroll started in the same tick.
   */
  const handleEditSection = useCallback((target: ReviewEditTarget) => {
    if (previewStage) scrollToReviewTarget(previewStage, target);
    setPreviewStage(null);
  }, [previewStage]);

  const editInlineSection = (stage: Stage, target: ReviewEditTarget) => {
    if (target === "checklist") setItemFilter("all");
    const anchor = editorRef.current?.querySelector<HTMLElement>(target === "instructions"
      ? `[data-stage-panel="${stage}"]` : "[data-setup-tasks]");
    anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
    (anchor?.querySelector<HTMLElement>("textarea, input") ?? anchor)?.focus({ preventScroll: true });
  };

  const checkinItemCount = useMemo(
    () => items.filter((i) => i.requiredOnCheckin).length,
    [items],
  );
  const checkoutItemCount = useMemo(
    () => items.filter((i) => i.requiredOnCheckout).length,
    [items],
  );
  const photoItemCount = useMemo(
    () => items.filter((i) => i.photoRequired).length,
    [items],
  );
  const checkinPhotoCount = useMemo(
    () => items.filter((i) => i.requiredOnCheckin && i.photoRequired).length,
    [items],
  );
  const checkoutPhotoCount = useMemo(
    () => items.filter((i) => i.requiredOnCheckout && i.photoRequired).length,
    [items],
  );

  /**
   * The filter is a view over one list, never a partition of it — a task
   * assigned to both flows must stay a single row that edits both flags, which
   * is the whole reason the list is unified in the first place.
   */
  const visibleItems = useMemo(() => {
    switch (itemFilter) {
      case "checkin":
        return items.filter((i) => i.requiredOnCheckin);
      case "checkout":
        return items.filter((i) => i.requiredOnCheckout);
      case "photo":
        return items.filter((i) => i.photoRequired);
      default:
        return items;
    }
  }, [items, itemFilter]);

  const bothDisabled = !setupUx && !checkinEnabled && !checkoutEnabled;

  const filterTabs = (
    <div
      className="flex items-center gap-0.5 rounded-full bg-muted p-0.5"
      role="group"
      aria-label={mt("filterTasks")}
    >
      {(
        [
          { id: "all", label: mt("filterAll"), count: items.length },
          // Reuse the scope-chip labels already used on every row, so the
          // filter and the chips call the same thing by the same name.
          { id: "checkin", label: mt("checkIn"), count: checkinItemCount },
          { id: "checkout", label: mt("checkOut"), count: checkoutItemCount },
          { id: "photo", label: mt("photo"), count: photoItemCount },
        ] as const
      ).map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={itemFilter === tab.id}
          onClick={() => setItemFilter(tab.id)}
          className={cn(
            "!min-h-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
            itemFilter === tab.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          <span className="tabular-nums text-[10px] opacity-60">{tab.count}</span>
        </button>
      ))}
    </div>
  );

  const stageField = (stage: Stage) => (
    <StageHeader
      setupUx={setupUx}
      coupledStages={coupledStages}
      stage={stage}
      enabled={stage === "checkin" ? checkinEnabled : checkoutEnabled}
      onEnabledChange={stage === "checkin" ? onCheckinEnabledChange : onCheckoutEnabledChange}
      instructions={stage === "checkin" ? checkinInstructions : checkoutInstructions}
      onInstructionsChange={stage === "checkin" ? onCheckinInstructionsChange : onCheckoutInstructionsChange}
      itemCount={stage === "checkin" ? checkinItemCount : checkoutItemCount}
      photoCount={stage === "checkin" ? checkinPhotoCount : checkoutPhotoCount}
      onOpenPreview={() => setPreviewStage(stage)}
      onToggleClick={onFlowToggleClick}
      onToggleMouseDown={onFlowToggleMouseDown}
      onToggleKeyDown={onFlowToggleKeyDown}
    />
  );

  const checklist = (
    <ChecklistList
      setupUx={setupUx}
      items={visibleItems}
      sourceItems={items}
      totalCount={items.length}
      filter={itemFilter}
      onItemsChange={onItemsChange}
      checkinEnabled={checkinEnabled}
      checkoutEnabled={checkoutEnabled}
      onClearFilter={() => setItemFilter("all")}
    />
  );

  const tasksSection = (
    <SetupSection
      id="setup-tasks"
      data-setup-tasks
      tabIndex={-1}
      className="focus:outline-none"
      title={mt("setupUx.tasksStep", { defaultValue: "Customer tasks" })}
      tag={<SetupTag>{mt("setupUx.optionalTag", { defaultValue: "Optional to add" })}</SetupTag>}
      description={<>
        <p>{mt("setupUx.tasksHelp", { defaultValue: "Each task you add is required at the stage you pick. Turn on Photo to also require a photo." })}</p>
        {hasSavedOptional && <p>{mt("setupUx.legacyOptionalHelp", { defaultValue: "Tasks labelled Optional were saved that way earlier and stay optional for customers. Tasks you add now are required." })}</p>}
      </>}
      actions={setupMode === "instructions"
        ? <Button type="button" variant="outline" size="sm" onClick={onOpenTasks} className="h-9 rounded-lg">
            <ListChecks className="mr-1.5 size-4" />
            {items.length
              ? mt("setupUx.editTasksAction", { defaultValue: "Edit customer tasks" })
              : mt("setupUx.addTasksAction", { defaultValue: "Add customer tasks" })}
            <ChevronRight className="ml-1 size-4" />
          </Button>
        : items.length > 0 ? filterTabs : undefined}
    >
      {taskControls}
      {setupMode === "instructions" ? (
        // The saved list is summarised here and edited on its own page.
        items.length === 0
          ? <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{mt("setupUx.emptyTitle", { defaultValue: "No tasks added" })}</span>
              {" · "}
              {mt("setupUx.emptyHint", { defaultValue: "Customers will see only your instructions." })}
            </p>
          : <ul className="flex flex-wrap gap-2 text-xs">
              {[
                { key: "checkin", Icon: LogIn, text: mt("setupUx.arrivalTaskCount", { count: checkinItemCount, defaultValue: "{count} at check-in" }) },
                { key: "checkout", Icon: LogOut, text: mt("setupUx.departureTaskCount", { count: checkoutItemCount, defaultValue: "{count} at check-out" }) },
                ...(photoItemCount ? [{ key: "photo", Icon: Camera, text: mt("setupUx.photoTaskCount", { count: photoItemCount, defaultValue: "{count} with a photo" }) }] : []),
              ].map(({ key, Icon, text }) => <li key={key} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 font-medium">
                <Icon className="size-3.5 text-muted-foreground" />{text}
              </li>)}
            </ul>
      ) : <fieldset disabled={!checkinEnabled && !checkoutEnabled}>{checklist}</fieldset>}
    </SetupSection>
  );

  /*
    Kitchen setup: one card, plain sections in reading order — what to write,
    what to ask for, when, and what the customer will see. Each section states
    its rule once beside its title; examples live in the empty fields. Saving
    is the surface's single Save, so nothing here repeats it.
  */
  if (setupUx) return (
    <Card ref={editorRef} className="overflow-hidden">
      <CardContent className="divide-y p-0">
        {setupMode !== "tasks" && <SetupSection
          id="setup-instructions"
          title={mt("setupUx.instructionsStep", { defaultValue: "Arrival and departure instructions" })}
          tag={<SetupTag tone="strong">{mt("setupUx.requiredBadge", { defaultValue: "Required" })}</SetupTag>}
          description={mt("setupUx.scope", { defaultValue: "Write both instructions before publishing. You can save with no customer tasks." })}
        >
          <div className="grid gap-5 md:grid-cols-2 md:gap-6">
            {(["checkin", "checkout"] as const).map(stage => <div key={stage} className="space-y-3">
              {instructionControls?.[stage]}
              <fieldset disabled={instructionReadOnly?.[stage]}>{stageField(stage)}</fieldset>
            </div>)}
          </div>
        </SetupSection>}

        {tasksSection}

        {beforeReview}

        <SetupSection
          id="setup-review"
          className="bg-muted/30"
          title={mt("setupUx.reviewStep", { defaultValue: "What customers will see" })}
          description={mt("setupUx.reviewHelp", { defaultValue: "Preview of your unsaved draft. Nothing changes for customers until you save." })}
        >
          {previewKitchenName && <p className="text-sm font-medium">{mt("kitchenScope.previewKitchen", { kitchen: previewKitchenName })}</p>}
          <div className="grid gap-4 md:grid-cols-2">
            {(["checkin", "checkout"] as const).map(stage => <InlineStagePreview key={stage} stage={stage}
              instructions={stage === "checkin" ? previewInstructions?.checkinInstructions ?? checkinInstructions : previewInstructions?.checkoutInstructions ?? checkoutInstructions} items={previewItems ?? items}
              missingInstructions={setupMode === "tasks"
                ? mt("setupUx.previewMissingElsewhere", { defaultValue: "Not written yet. Add it under Arrival & departure." })
                : undefined}
              onEdit={{
                instructions: setupMode === "tasks" ? undefined : () => editInlineSection(stage, "instructions"),
                checklist: setupMode === "instructions" ? onOpenTasks : () => editInlineSection(stage, "checklist"),
              }} />)}
          </div>
        </SetupSection>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg flex items-center justify-center bg-primary/10">
            <ClipboardCheck className="size-5 text-primary" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-lg">{title ?? mt("checkInCheckOutChecklists")}</CardTitle>
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground/80">
              {mt("checkinCheckoutPageHint")}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ── Tier 1: the flows ───────────────────────────────────────────────
            Only the switches and their consequences. Nothing that the manager
            edits per-item lives here, because a panel that is half settings and
            half content reads as one undifferentiated block. */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {stageField("checkin")}
          {stageField("checkout")}
        </div>

        {/* Nothing is switched on — the list is inert, so say so once. */}
        {bothDisabled && (
          <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-2.5 text-[10px] leading-snug text-muted-foreground/80">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p>{mt(coupledStages ? 'storageTrackingDisabledHint' : 'bothStagesDisabledHint')}</p>
          </div>
        )}

        {/* ── Tier 2: the tasks ───────────────────────────────────────────────
            One list, both flows. Above it sits the filter control, below it the
            totals and legend — so the manager reads "these are the tasks, this
            is how they split" in that order instead of being handed a bare list
            and left to work out what belongs to what. */}
        <div className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <ListChecks className="size-4 shrink-0 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{mt("checklistItems")}</h3>
            </div>
            {filterTabs}
          </div>

          {checklist}
        </div>
      </CardContent>

      {/* Review surface — a read-only recap of this flow, so the manager can
          read it back and confirm it is right. See ReviewDialog for why this
          replaced an interactive simulation of the chef's screen. */}
      <ReviewDialog
        open={previewStage !== null}
        onOpenChange={(o) => {
          if (!o) setPreviewStage(null);
        }}
        stage={previewStage || "checkin"}
        instructions={
          previewStage === "checkout" ? checkoutInstructions : checkinInstructions
        }
        // The review must not show a capability the chef will not get: when no
        items={items}
        onEditSection={handleEditSection}
      />
    </Card>
  );
}
