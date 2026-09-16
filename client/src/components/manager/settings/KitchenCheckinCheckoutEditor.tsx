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
 * Preview opens as a side Sheet that mirrors exactly what chefs see in
 * `KitchenCheckinTracker.tsx` — the goal being no surprises between what the
 * manager configures and what the chef eventually interacts with.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import {
  Camera,
  ClipboardCheck,
  Copy,
  GripVertical,
  Info,
  Lightbulb,
  ListChecks,
  Lock,
  LogIn,
  LogOut,
  Pencil,
  PlaylistPlus,
  Plus,
  Trash2,
  Undo2,
  X,
  Eye,
  Calendar,
  Upload,
} from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormLegend } from "@/components/ui/form-legend";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
}

export type Stage = "checkin" | "checkout";

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
 * without a matching item become items with empty prerequisites.
 */
export function unifyStorageToItems(params: {
  checkinItems: ChecklistItem[];
  checkoutItems: ChecklistItem[];
  checkinPhotoRequirements: PhotoRequirement[];
  checkoutPhotoRequirements: PhotoRequirement[];
}): UnifiedChecklistItem[] {
  const {
    checkinItems,
    checkoutItems,
    checkinPhotoRequirements,
    checkoutPhotoRequirements,
  } = params;

  const map = new Map<string, UnifiedChecklistItem>();

  const checkinPhotoIds = new Set(checkinPhotoRequirements.map((p) => p.id));
  const checkoutPhotoIds = new Set(checkoutPhotoRequirements.map((p) => p.id));

  const upsert = (
    source: ChecklistItem,
    stage: Stage,
  ): UnifiedChecklistItem => {
    const existing = map.get(source.id);
    const photoFromFlag = source.photoRequired === true;
    const photoFromLegacyArray =
      stage === "checkin"
        ? checkinPhotoIds.has(source.id)
        : checkoutPhotoIds.has(source.id);
    const photoRequired = photoFromFlag || photoFromLegacyArray;

    if (existing) {
      existing.requiredOnCheckin =
        existing.requiredOnCheckin || stage === "checkin";
      existing.requiredOnCheckout =
        existing.requiredOnCheckout || stage === "checkout";
      existing.photoRequired = existing.photoRequired || photoRequired;
      // Prefer the richer label/description if we already saw this id
      if (!existing.description && source.description) {
        existing.description = source.description;
      }
      return existing;
    }

    const next: UnifiedChecklistItem = {
      id: source.id,
      label: source.label || "",
      description: source.description,
      requiredOnCheckin: stage === "checkin",
      requiredOnCheckout: stage === "checkout",
      photoRequired,
    };
    map.set(source.id, next);
    return next;
  };

  for (const item of checkinItems || []) upsert(item, "checkin");
  for (const item of checkoutItems || []) upsert(item, "checkout");

  // Orphan photo requirements (no matching checklist item) → synthesize items
  const mergeOrphan = (photo: PhotoRequirement, which: Stage) => {
    const existing = map.get(photo.id);
    if (existing) {
      existing.photoRequired = true;
      if (which === "checkin") existing.requiredOnCheckin = true;
      else existing.requiredOnCheckout = true;
      return;
    }
    map.set(photo.id, {
      id: photo.id,
      label: photo.label || "",
      description: photo.description,
      requiredOnCheckin: which === "checkin",
      requiredOnCheckout: which === "checkout",
      photoRequired: true,
    });
  };
  for (const photo of checkinPhotoRequirements || []) mergeOrphan(photo, "checkin");
  for (const photo of checkoutPhotoRequirements || []) mergeOrphan(photo, "checkout");

  return Array.from(map.values());
}

/**
 * Split the unified list back into the server's legacy four-array shape.
 * Items with an empty label are dropped. If an item has neither flag set, it is
 * dropped (the editor prevents this state from being saved).
 */
export function itemsToStorage(items: UnifiedChecklistItem[]): {
  checkinItems: ChecklistItem[];
  checkoutItems: ChecklistItem[];
  checkinPhotoRequirements: PhotoRequirement[];
  checkoutPhotoRequirements: PhotoRequirement[];
} {
  const checkinItems: ChecklistItem[] = [];
  const checkoutItems: ChecklistItem[] = [];
  const checkinPhotoRequirements: PhotoRequirement[] = [];
  const checkoutPhotoRequirements: PhotoRequirement[] = [];

  for (const item of items) {
    if (!item.label.trim()) continue;
    if (!item.requiredOnCheckin && !item.requiredOnCheckout) continue;

    const base: ChecklistItem = {
      id: item.id,
      label: item.label.trim(),
      description: item.description?.trim() || undefined,
      required: true,
      category: "general",
      photoRequired: item.photoRequired,
    };

    if (item.requiredOnCheckin) {
      checkinItems.push(base);
      if (item.photoRequired) {
        checkinPhotoRequirements.push({
          id: item.id,
          label: item.label.trim(),
          description: item.description?.trim() || undefined,
          required: true,
        });
      }
    }

    if (item.requiredOnCheckout) {
      checkoutItems.push(base);
      if (item.photoRequired) {
        checkoutPhotoRequirements.push({
          id: item.id,
          label: item.label.trim(),
          description: item.description?.trim() || undefined,
          required: true,
        });
      }
    }
  }

  return {
    checkinItems,
    checkoutItems,
    checkinPhotoRequirements,
    checkoutPhotoRequirements,
  };
}

// ─── Validation helpers ──────────────────────────────────────────────────────

/**
 * Returns the ids of items that would be silently dropped on save, so the page
 * can block Save and point at the offending row instead of pretending the
 * configuration saved cleanly. The messages themselves are built in the parent
 * where the i18n scope lives.
 */
export function findUnifiedItemProblems(items: UnifiedChecklistItem[]): {
  empty: UnifiedChecklistItem[];
  unassigned: UnifiedChecklistItem[];
} {
  return {
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
 */
const SCOPE_STYLES: Record<
  Scope,
  { on: string; off: string; icon: typeof LogIn; labelKey: string }
> = {
  checkin: {
    on: "border-emerald-300 bg-emerald-50 text-emerald-800",
    off: "border-border bg-background text-muted-foreground hover:bg-muted",
    icon: LogIn,
    labelKey: "checkIn",
  },
  checkout: {
    on: "border-primary/40 bg-primary/10 text-primary",
    off: "border-border bg-background text-muted-foreground hover:bg-muted",
    icon: LogOut,
    labelKey: "checkOut",
  },
  photo: {
    on: "border-amber-300 bg-amber-50 text-amber-800",
    off: "border-border bg-background text-muted-foreground hover:bg-muted",
    icon: Camera,
    labelKey: "photo",
  },
};

// ─── Single checklist row ────────────────────────────────────────────────────

interface ChecklistRowProps {
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
          : "hover:border-border",
      )}
    >
      <div className="flex items-start gap-2 p-2.5">
        {/* Drag handle. The only grab surface, so the text field stays usable. */}
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
                  "mt-1 shrink-0 cursor-grab touch-none rounded text-muted-foreground/50 transition-colors",
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

        {/* Primary field + optional note */}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/60">
              {index + 1}
            </span>
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
          </div>

          {noteOpen ? (
            <div className="flex items-center gap-1.5 pl-[22px]">
              <Pencil className="size-3 shrink-0 text-muted-foreground/60" />
              <Input
                value={item.description || ""}
                onChange={(e) =>
                  onUpdate(item.id, {
                    ...item,
                    description: e.target.value || undefined,
                  })
                }
                placeholder={mt("optionalHintForChefs")}
                aria-label={mt("optionalHintForChefs")}
                autoFocus={!item.description}
                className="h-7 border-transparent bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:border-input focus-visible:border-input focus-visible:bg-background"
              />
              <button
                type="button"
                aria-label={mt("removeNote")}
                onClick={() => {
                  setNoteOpen(false);
                  onUpdate(item.id, { ...item, description: undefined });
                }}
                className="!min-h-0 !min-w-0 shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="ml-[22px] inline-flex items-center gap-1 rounded px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus className="size-3" />
              {mt("addNote")}
            </button>
          )}
        </div>

        {/* Scope chips */}
        <div
          className="flex shrink-0 items-center gap-1"
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
                        locked && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <ScopeIcon className="size-3" />
                      <span className="hidden sm:inline">{mt(config.labelKey)}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    {locked
                      ? scope === "checkin"
                        ? tt("addToCheckoutFirst")
                        : tt("addToCheckinFirst")
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
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onDuplicate(item.id)}
            aria-label={mt("duplicateItem")}
            title={mt("duplicateItem")}
          >
            <Copy className="size-3.5" />
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

// ─── Restore snackbar ────────────────────────────────────────────────────────

/**
 * Undo affordance after a delete. Deletes are instant and unconfirmed — a
 * confirmation dialog on every row is heavier than the action deserves, and a
 * five-second window with a one-tap restore covers the genuine misclick.
 */
function UndoBar({ onUndo, label }: { onUndo: () => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/60 px-3 py-2">
      <p className="min-w-0 truncate text-xs text-muted-foreground">{label}</p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onUndo}
        className="h-7 shrink-0 bg-transparent px-2 text-xs hover:bg-muted"
      >
        <Undo2 className="size-3.5 mr-1" />
        {tt("undo")}
      </Button>
    </div>
  );
}

// ─── Chef View Preview (matches KitchenCheckinTracker exactly) ───────────────

function ChefPreviewSheet({
  open,
  onOpenChange,
  stage,
  instructions,
  smartLockInstructions,
  items,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stage: Stage;
  instructions: string | null;
  smartLockInstructions: string | null;
  items: UnifiedChecklistItem[];
}) {
  // Filter items that actually apply to this stage and have a label
  const filledItems = items.filter(
    (i) =>
      i.label.trim() &&
      (stage === "checkin" ? i.requiredOnCheckin : i.requiredOnCheckout),
  );
  const filledPhotoItems = filledItems.filter((i) => i.photoRequired);
  const hasAnyContent =
    filledItems.length > 0 ||
    !!instructions ||
    (stage === "checkin" && !!smartLockInstructions);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            {stage === "checkin" ? mt("kitchenCheckInTitle") : mt("kitchenCheckOutTitle")}
          </SheetTitle>
          <SheetDescription>{mt("chefPreviewDescription")}</SheetDescription>
        </SheetHeader>

        {filledItems.length > 0 && <FormLegend className="mt-4 mb-0" />}

        <div className="py-4 space-y-3">
          {/* Manager Instructions */}
          {instructions && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs text-blue-800 font-medium mb-1">{mt("instructionsFromManager")}</p>
              <p className="text-xs text-blue-700 whitespace-pre-line">
                {instructions}
              </p>
            </div>
          )}

          {/* Smart Lock (check-in only) */}
          {stage === "checkin" && smartLockInstructions && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <Lock className="size-3.5 text-violet-600" />
                <p className="text-xs text-violet-800 font-medium">{mt("smartLockAccess")}</p>
              </div>
              <p className="text-xs text-violet-700 whitespace-pre-line">
                {smartLockInstructions}
              </p>
              <div className="flex items-center gap-2 p-2 rounded-md bg-violet-100 border border-violet-300">
                <span className="text-lg font-mono font-bold text-violet-900 tracking-[0.2em]">
                  A1B2C3
                </span>
                <span className="text-[10px] text-violet-600 ml-auto">
                  {mt("sampleCode")}
                </span>
              </div>
            </div>
          )}

          {/* Checklist Items */}
          {filledItems.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {stage === "checkin" ? mt("checklist") : mt("checkoutChecklist")}
              </Label>
              {filledItems.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-start gap-2.5 p-2 rounded-lg border bg-background"
                >
                  <Checkbox disabled className="mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm">
                      <span className="tabular-nums font-medium text-muted-foreground mr-1.5">{index + 1}.</span>
                      {item.label}
                      <span className="text-destructive ml-0.5">*</span>
                    </span>
                    {item.description && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {item.description}
                      </p>
                    )}
                    {item.photoRequired && (
                      <Badge
                        variant="outline"
                        className="mt-1 text-[10px] bg-amber-50 text-amber-800 border-amber-200"
                      >
                        <Camera className="size-2.5 mr-1" />{mt("photoRequired")}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Photo Upload Section — appears once, slots for every item that needs a photo */}
          {filledPhotoItems.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Camera className="h-4 w-4" />{mt("photosRequired")}</Label>
              <p className="text-[11px] text-muted-foreground">{mt("onePhotoPerItemChefUploadsTheseAsPartOfTheForm")}</p>
              {filledPhotoItems.map((item) => (
                <div key={`preview-photo-${item.id}`} className="space-y-1">
                  <p className="text-sm font-medium">
                    {item.label}
                    <span className="text-destructive ml-0.5">*</span>
                  </p>
                  <div className="border-2 border-dashed border-border rounded-lg p-4 flex flex-col items-center justify-center opacity-60">
                    <Upload className="h-5 w-5 text-muted-foreground mb-1" />
                    <span className="text-[11px] text-muted-foreground">{mt("chefUploadsThisPhoto")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Notes textarea */}
          <div className="space-y-1">
            <Label className="text-sm font-medium">{mt("notesOptional")}</Label>
            <Textarea
              disabled
              rows={2}
              placeholder={
                stage === "checkin"
                  ? mt("optionalCheckInNotes") : mt("checkoutNotesPlaceholder")
              }
              className="opacity-60"
            />
          </div>

          {/* Empty state */}
          {!hasAnyContent && (
            <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
              <Info className="size-5 mx-auto mb-2" />
              <p>{mt("nothingConfiguredYet")}</p>
              <p className="text-xs mt-1">{mt("addItemsToTheLeftToSeeTheChefView")}</p>
            </div>
          )}

          {/* Submit button */}
          <Button disabled className="w-full mt-2" size="lg">
            {stage === "checkin" ? (
              <LogIn className="h-4 w-4 mr-2" />
            ) : (
              <LogOut className="h-4 w-4 mr-2" />
            )}
            {stage === "checkin" ? mt("confirmCheckIn") : mt("submitCheckout")}
          </Button>
          <p className="text-[10px] text-center text-muted-foreground">
            {mt("chefSubmitGateNote")}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Stage Header ─────────────────────────────────────────────────────────────

interface StageHeaderProps {
  stage: Stage;
  enabled: boolean;
  onEnabledChange: (val: boolean) => void;
  instructions: string | null;
  onInstructionsChange: (val: string | null) => void;
  smartLockInstructions: string | null;
  onSmartLockInstructionsChange: (val: string | null) => void;
  /**
   * Admin-controlled capability gate. When false, the smart-lock instructions
   * textarea is hidden — no kitchen at this location is equipped with a smart
   * door. Only relevant to the check-in stage.
   */
  smartLockAvailable: boolean;
  itemCount: number;
  photoCount: number;
  onOpenPreview: () => void;
}

/**
 * Per-stage control panel: enable switch, instructions textarea, smart-lock
 * instructions (check-in only), counts, and preview button. The actual
 * checklist items live in the shared list below both StageHeaders so managers
 * can see and edit the whole matrix at once.
 *
 * Instructions stay collapsed behind a disclosure: most managers write nothing
 * here, and a permanently-open textarea on both panels reads as work.
 */
function StageHeader({
  stage,
  enabled,
  onEnabledChange,
  instructions,
  onInstructionsChange,
  smartLockInstructions,
  onSmartLockInstructionsChange,
  smartLockAvailable,
  itemCount,
  photoCount,
  onOpenPreview,
}: StageHeaderProps) {
  const title = stage === "checkin" ? mt("checkInStage") : mt("checkOutStage");
  const StageIcon = stage === "checkin" ? LogIn : LogOut;
  const panelClass = enabled
    ? stage === "checkin"
      ? "border-emerald-200 bg-emerald-50/40"
      : "border-primary/20 bg-primary/5"
    : "border-border bg-muted/20";
  const iconClass = stage === "checkin" ? "text-emerald-600" : "text-primary";

  const hasSmartLock = stage === "checkin" && smartLockAvailable;
  const [detailsOpen, setDetailsOpen] = useState(
    !!instructions || !!smartLockInstructions,
  );

  useEffect(() => {
    if (instructions || (hasSmartLock && smartLockInstructions)) {
      setDetailsOpen(true);
    }
  }, [instructions, smartLockInstructions, hasSmartLock]);

  const showDetails = detailsOpen || !!instructions || (hasSmartLock && !!smartLockInstructions);

  return (
    <div className={cn("rounded-lg border p-3", panelClass)}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <div
            className={cn(
              "size-8 rounded-md flex items-center justify-center bg-background border shrink-0",
              iconClass,
            )}
          >
            <StageIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold">{title}</span>
              {enabled && (
                <>
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                    {mt("itemCountLabel", { count: itemCount })}
                  </Badge>
                  {photoCount > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1.5 bg-amber-50 text-amber-800 border-amber-200"
                    >
                      <Camera className="size-2.5 mr-0.5" />
                      {mt("photoCountLabel", { count: photoCount })}
                    </Badge>
                  )}
                </>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {stage === "checkin"
                ? mt("confirmedByChefsOnArrival") : mt("confirmedByChefsBeforeLeaving")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {enabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-lg text-xs shadow-none hover:translate-y-0 hover:shadow-none"
              onClick={onOpenPreview}
            >
              <Eye className="size-3 mr-1" />{mt("preview")}</Button>
          )}
          <Switch
            checked={enabled}
            onCheckedChange={onEnabledChange}
            aria-label={
              enabled
                ? mt("disableStage", { stage: title })
                : mt("enableStage", { stage: title })
            }
          />
        </div>
      </div>

      {enabled && (
        <div className="mt-2.5">
          {showDetails ? (
            <div className="space-y-2">
              {/* Instructions */}
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Label
                    htmlFor={`${stage}-instructions`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {mt("instructionsForChefs")}{" "}
                    <span className="font-normal">{mt("optionalLabel")}</span>
                  </Label>
                  <button
                    type="button"
                    onClick={() => setDetailsOpen(false)}
                    className="!min-h-0 !min-w-0 rounded px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {mt("hide")}
                  </button>
                </div>
                <Textarea
                  id={`${stage}-instructions`}
                  value={instructions || ""}
                  onChange={(e) => onInstructionsChange(e.target.value || null)}
                  placeholder={
                    stage === "checkin"
                      ? mt("shownBeforeChefsCheckIn") : mt("shownBeforeChefsCheckOut")
                  }
                  rows={2}
                  className="mt-1 text-xs bg-background"
                />
              </div>

              {/*
                Smart-lock instructions — admin-gated capability and check-in
                only, since smart locks are irrelevant to post-booking checkout.
              */}
              {hasSmartLock && (
                <div className="rounded-md border border-violet-200 bg-violet-50/70 p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Lock className="size-3.5 text-violet-600" />
                    <Label
                      htmlFor="smart-lock-instructions"
                      className="text-xs font-medium text-violet-900"
                    >
                      {mt("smartLockInstructions")}{" "}
                      <span className="text-violet-500 font-normal">
                        {mt("optionalLabel")}
                      </span>
                    </Label>
                  </div>
                  <Textarea
                    id="smart-lock-instructions"
                    value={smartLockInstructions || ""}
                    onChange={(e) =>
                      onSmartLockInstructionsChange(e.target.value || null)
                    }
                    placeholder={mt("smartLockAccessPlaceholder")}
                    rows={2}
                    className="text-xs border-violet-200 bg-white"
                  />
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="!min-h-0 inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-solid hover:text-foreground"
            >
              <Plus className="size-3" />
              {mt("addArrivalInstructions")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Checklist list ──────────────────────────────────────────────────────────

interface ChecklistListProps {
  items: UnifiedChecklistItem[];
  onItemsChange: (next: UnifiedChecklistItem[]) => void;
  checkinEnabled: boolean;
  checkoutEnabled: boolean;
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
 */
function ChecklistList({
  items,
  onItemsChange,
  checkinEnabled,
  checkoutEnabled,
}: ChecklistListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [removed, setRemoved] = useState<{
    item: UnifiedChecklistItem;
    index: number;
  } | null>(null);

  // Refs keep the drag handlers and the stable callbacks free of `items` deps,
  // which avoids re-creating them on every keystroke.
  const itemsRef = useRef(items);
  itemsRef.current = items;
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
    undoTimerRef.current = setTimeout(() => setRemoved(null), 6000);
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

  const moveItem = useCallback((from: number, to: number) => {
    const current = itemsRef.current;
    if (to < 0 || to >= current.length || from === to) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
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
    () => new Set(items.map((i) => i.label.trim().toLowerCase())),
    [items],
  );

  const checkinCount = items.filter((i) => i.requiredOnCheckin).length;
  const checkoutCount = items.filter((i) => i.requiredOnCheckout).length;

  return (
    <div className="space-y-2.5">
      {/* Section header: title, live totals, and the two add affordances */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex min-w-0 items-center gap-2">
          <ListChecks className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{mt("checklistItems")}</span>
          {items.length > 0 && (
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              {mt("checklistTotals", {
                checkin: checkinCount,
                checkout: checkoutCount,
              })}
            </span>
          )}
        </div>
        {items.length > 0 && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-xs hover:bg-muted"
                >
                  <PlaylistPlus className="mr-1 size-3.5" />
                  {mt("addFromCommonTasks")}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="p-0">
                <PresetPicker onPick={addPreset} existingLabels={existingLabels} />
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Rows */}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed py-8 text-center">
          <ClipboardCheck className="mx-auto mb-2 size-6 text-muted-foreground/40" />
          <p className="text-sm font-medium">{mt("noChecklistItemsYet")}</p>
          <p className="mx-auto mt-0.5 max-w-sm text-xs text-muted-foreground">
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
          onUndo={undoRemove}
        />
      )}

      {/* Footer: add row + scope legend */}
      {items.length > 0 && (
        <div className="space-y-2 pt-0.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addItem}
            className="h-8 w-full rounded-lg text-xs shadow-none hover:translate-y-0 hover:shadow-none"
          >
            <Plus className="mr-1.5 size-3.5" />
            {mt("addChecklistItem")}
          </Button>
          <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
            <Lightbulb className="size-3" />
            {mt("scopeLegend")}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Editor ──────────────────────────────────────────────────────────────

export interface KitchenCheckinCheckoutEditorProps {
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
  smartLockInstructions: string | null;
  onSmartLockInstructionsChange: (val: string | null) => void;
  /**
   * Admin-controlled capability gate. When false, no smart-lock UI is shown
   * in the editor or the preview — because no kitchen at this location is
   * equipped with a smart door.
   */
  smartLockAvailable: boolean;
}

export function KitchenCheckinCheckoutEditor({
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
  smartLockInstructions,
  onSmartLockInstructionsChange,
  smartLockAvailable,
}: KitchenCheckinCheckoutEditorProps) {
  const [previewStage, setPreviewStage] = useState<Stage | null>(null);

  const checkinItemCount = useMemo(
    () => items.filter((i) => i.requiredOnCheckin).length,
    [items],
  );
  const checkoutItemCount = useMemo(
    () => items.filter((i) => i.requiredOnCheckout).length,
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

  const bothDisabled = !checkinEnabled && !checkoutEnabled;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg flex items-center justify-center bg-primary/10">
            <ClipboardCheck className="size-5 text-primary" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-lg">{mt("checkInCheckOutChecklists")}</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {mt("checkinCheckoutPageHint")}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stage panels — stacked on mobile, side-by-side on md+. Each panel
            owns its enable switch, instructions, smart-lock (check-in only),
            and preview. Items are managed in the shared list below. */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <StageHeader
            stage="checkin"
            enabled={checkinEnabled}
            onEnabledChange={onCheckinEnabledChange}
            instructions={checkinInstructions}
            onInstructionsChange={onCheckinInstructionsChange}
            smartLockInstructions={smartLockInstructions}
            onSmartLockInstructionsChange={onSmartLockInstructionsChange}
            smartLockAvailable={smartLockAvailable}
            itemCount={checkinItemCount}
            photoCount={checkinPhotoCount}
            onOpenPreview={() => setPreviewStage("checkin")}
          />
          <StageHeader
            stage="checkout"
            enabled={checkoutEnabled}
            onEnabledChange={onCheckoutEnabledChange}
            instructions={checkoutInstructions}
            onInstructionsChange={onCheckoutInstructionsChange}
            smartLockInstructions={smartLockInstructions}
            onSmartLockInstructionsChange={onSmartLockInstructionsChange}
            smartLockAvailable={false}
            itemCount={checkoutItemCount}
            photoCount={checkoutPhotoCount}
            onOpenPreview={() => setPreviewStage("checkout")}
          />
        </div>

        {/* Nothing is switched on — the list is inert, so say so once. */}
        {bothDisabled && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p>{mt("bothStagesDisabledHint")}</p>
          </div>
        )}

        {/* The shared list of items. */}
        <ChecklistList
          items={items}
          onItemsChange={onItemsChange}
          checkinEnabled={checkinEnabled}
          checkoutEnabled={checkoutEnabled}
        />
      </CardContent>

      {/* Chef-view preview — side Sheet mirroring KitchenCheckinTracker */}
      <ChefPreviewSheet
        open={previewStage !== null}
        onOpenChange={(o) => {
          if (!o) setPreviewStage(null);
        }}
        stage={previewStage || "checkin"}
        instructions={
          previewStage === "checkout" ? checkoutInstructions : checkinInstructions
        }
        // Hide smart-lock preview when the admin hasn't enabled the capability
        // on any kitchen at this location — chefs won't see it either.
        smartLockInstructions={smartLockAvailable ? smartLockInstructions : null}
        items={items}
      />
    </Card>
  );
}
