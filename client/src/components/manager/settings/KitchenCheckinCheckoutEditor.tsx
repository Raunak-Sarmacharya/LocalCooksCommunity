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
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
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

// ─── Chef View Preview (matches KitchenCheckinTracker) ───────────────────────

/**
 * Chef-facing preview, rendered live off the editor's own state.
 *
 * It is fully interactive — tasks tick, photo slots accept files — because the
 * two questions a manager actually has here ("what does the chef get?" and "how
 * much work is this?") are both answered faster by using the thing than by
 * reading a picture of it. Nothing is uploaded: photo URLs stay in local state
 * and the object URLs are revoked when the preview closes.
 *
 * The booking header is the only invented part — a manager has no booking in
 * front of them when configuring a kitchen — so it is labelled as sample data
 * rather than dressed up as real.
 */
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
  /** Item ids the manager has ticked while trying the preview. */
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /** Requirement id → stand-in photos, for "uploaded" demo slots. */
  const [photos, setPhotos] = useState<Record<string, string[]>>({});

  // Each open starts a fresh trial — otherwise the previous kitchen's ticks are
  // still on screen and the preview reads as real saved progress.
  useEffect(() => {
    if (!open) return;
    setChecked(new Set());
    setPhotos({});
  }, [open, stage]);

  const filledItems = items.filter(
    (i) =>
      i.label.trim() &&
      (stage === "checkin" ? i.requiredOnCheckin : i.requiredOnCheckout),
  );
  const photoItems = filledItems.filter((i) => i.photoRequired);
  const hasInstructions = !!instructions;
  const hasSmartLock = stage === "checkin" && !!smartLockInstructions;
  const hasContent = filledItems.length > 0;

  const allTasksTicked = filledItems.every((i) => checked.has(i.id));
  const allPhotosAdded = photoItems.every((i) => (photos[i.id]?.length ?? 0) > 0);
  const canSubmit = hasContent && allTasksTicked && allPhotosAdded;

  const toggleItem = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Stand-in photo. The chef-side uploader holds uploaded URLs only, so a "
   * ticked" slot is all the preview needs to show the progress state — no file
   * picker, no upload, nothing to clean up.
   */
  const addPhoto = (id: string) => {
    setPhotos((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), `preview-${Date.now()}`] }));
  };

  const stageTitle = stage === "checkin" ? mt("kitchenCheckInTitle") : mt("kitchenCheckOutTitle");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        {/* Header */}
        <SheetHeader className="border-b px-4 py-3 pr-12 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <LogIn className="size-4 text-muted-foreground" />
            {stageTitle}
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <Badge variant="outline" className="text-[11px] font-normal">
              {mt("previewBookingTime")}
            </Badge>
            <Badge variant="outline" className="border-primary/30 bg-primary/5 text-[11px] font-normal text-primary">
              <Eye className="mr-1 size-2.5" />
              {mt("previewChefPov")}
            </Badge>
          </div>
        </SheetHeader>

        {/* Trial notice — what is real here and what is not */}
        <div className="flex items-start gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] leading-snug text-muted-foreground">
          <Info className="mt-0.5 size-3 shrink-0" />
          <p>
            {mt("previewInteractiveNote")}{" "}
            <span className="text-muted-foreground/80">{mt("previewSampleDataNote")}</span>
          </p>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {!hasContent ? (
            <div className="rounded-lg border border-dashed px-6 py-12 text-center">
              <ClipboardCheck className="mx-auto mb-2 size-6 text-muted-foreground/40" />
              <p className="text-sm font-medium">{mt("previewEmptyTitle")}</p>
              <p className="mx-auto mt-1 max-w-[240px] text-[10px] leading-snug text-muted-foreground/80">
                {mt("previewEmptyHint")}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <FormLegend className="mb-0" />

              {/* Step timeline, mirroring the tracker's pre-check-in state */}
              <ol className="space-y-3">
                <PreviewStep
                  done
                  title={stage === "checkin" ? mt("previewStepCheckIn") : mt("previewStepCheckout")}
                  description={
                    stage === "checkin" ? mt("previewStepArrive") : mt("previewStepSubmitPhotos")
                  }
                  icon={<LogIn className="size-3.5" />}
                />
                <PreviewStep
                  active
                  title={mt("previewStepInProgress")}
                  description={mt("previewStepUseKitchen")}
                  icon={<Calendar className="size-3.5" />}
                />
              </ol>

              {/* Manager instructions */}
              {hasInstructions && (
                <div className="rounded-lg border p-3">
                  <p className="mb-1 text-xs font-medium">{mt("instructionsFromManager")}</p>
                  <p className="whitespace-pre-line text-xs text-muted-foreground">
                    {instructions}
                  </p>
                </div>
              )}

              {/* Smart lock, check-in only */}
              {hasSmartLock && (
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center gap-1.5">
                    <Lock className="size-3.5 text-muted-foreground" />
                    <p className="text-xs font-medium">{mt("smartLockAccess")}</p>
                  </div>
                  <p className="whitespace-pre-line text-xs text-muted-foreground">
                    {smartLockInstructions}
                  </p>
                  <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2">
                    <span className="font-mono text-lg font-bold tracking-[0.2em]">A1B2C3</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {mt("sampleCode")}
                    </span>
                  </div>
                </div>
              )}

              {/* The task list itself */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm font-medium">{mt("checklist")}</Label>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {mt("previewTaskCount", { count: filledItems.length })}
                  </Badge>
                </div>
                {filledItems.map((item, index) => {
                  const isChecked = checked.has(item.id);
                  return (
                    <label
                      key={item.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2 transition-colors",
                        isChecked ? "border-border bg-muted/40" : "bg-background hover:bg-muted/50",
                      )}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleItem(item.id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <span className={cn("text-sm", isChecked && "text-muted-foreground line-through")}>
                          <span className="mr-1.5 font-medium tabular-nums text-muted-foreground">
                            {index + 1}.
                          </span>
                          {item.label}
                          <span className="ml-0.5 text-destructive">*</span>
                        </span>
                        {item.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Photo slots — click to add a stand-in photo */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="flex items-center gap-1.5 text-sm font-medium">
                    <Camera className="size-3.5" />
                    {mt("photosRequired")}
                  </Label>
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {photoItems.length > 0
                      ? mt("previewPhotoCount", { count: photoItems.length })
                      : mt("previewNoPhotos")}
                  </Badge>
                </div>
                {photoItems.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    {mt("previewNoPhotos")}
                  </p>
                ) : (
                  photoItems.map((item) => {
                    const urls = photos[item.id] ?? [];
                    const has = urls.length > 0;
                    return (
                      <div
                        key={`preview-photo-${item.id}`}
                        className={cn(
                          "space-y-2 rounded-lg border p-3 transition-colors",
                          has ? "border-emerald-300/60 bg-emerald-50/40" : "border-border",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 truncate text-sm font-medium">
                            {item.label}
                            <span className="ml-0.5 text-destructive">*</span>
                          </p>
                          {has && (
                            <span className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-700">
                              <CheckCircle2 className="size-3" />
                              {urls.length}/3
                            </span>
                          )}
                        </div>
                        {!has && (
                          <button
                            type="button"
                            onClick={() => addPhoto(item.id)}
                            className="!min-h-0 flex w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-border px-4 py-4 transition-colors hover:border-primary/50"
                          >
                            <Upload className="mb-1 size-5 text-muted-foreground" />
                            <span className="text-[11px] text-muted-foreground">
                              {mt("chefUploadsThisPhoto")}
                            </span>
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <Label className="text-sm font-medium">{mt("previewNotesLabel")}</Label>
                <Textarea
                  rows={2}
                  placeholder={
                    stage === "checkin"
                      ? mt("optionalCheckInNotes")
                      : mt("checkoutNotesPlaceholder")
                  }
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer — the real gate, reproduced */}
        {hasContent && (
          <div className="space-y-2 border-t px-4 py-3">
            {/* There is no submit in a preview, and there should not be — the
                button exists to show the gate, so it is deliberately inert. */}
            <Button className="w-full" size="lg" disabled={!canSubmit} type="button">
              {stage === "checkin" ? (
                <LogIn className="mr-2 size-4" />
              ) : (
                <LogOut className="mr-2 size-4" />
              )}
              {stage === "checkin" ? mt("previewSubmitCheckIn") : mt("previewSubmitCheckout")}
            </Button>
            <p className="text-center text-[10px] leading-snug text-muted-foreground">
              {canSubmit ? mt("previewGateNote") : mt("previewTryHint")}
            </p>
            <p className="text-center text-[10px] leading-snug text-muted-foreground/70">
              {mt("chefSubmitGateNote")}
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** One row of the preview's step timeline. */
function PreviewStep({
  title,
  description,
  icon,
  done,
  active,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border",
          done
            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
            : active
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </li>
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
 * Per-flow control panel: the enable switch, a one-line status, the arrival
 * instructions disclosure and a preview entry point. The checklist items
 * themselves live in the shared list below both panels so managers can see and
 * edit the whole matrix at once.
 *
 * State is carried by a single `On` / `Off` badge next to a description that
 * says what that state *means* for the chef — the previous version showed
 * counts only when enabled and nothing when disabled, which left "off" reading
 * as "broken" rather than "intentionally not used". Instructions and smart-lock
 * copy are the only things hidden behind a disclosure, and they announce
 * themselves with an `Added` badge when set, so a manager can always tell at a
 * glance whether they have written something.
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

  const hasSmartLock = stage === "checkin" && smartLockAvailable;
  const hasInstructions = !!instructions;
  const hasSmartLockInstructions = hasSmartLock && !!smartLockInstructions;

  const [detailsOpen, setDetailsOpen] = useState(hasInstructions || hasSmartLockInstructions);

  useEffect(() => {
    if (hasInstructions || hasSmartLockInstructions) setDetailsOpen(true);
  }, [hasInstructions, hasSmartLockInstructions]);

  // A flow with nothing in it will do nothing for the chef, which is worth
  // saying before they save and wonder.
  const needsSetup = enabled && itemCount === 0;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
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

          {/* Instructions + smart lock, behind one disclosure.
              This is the primary writing surface on the panel — the thing a
              manager actually comes here to type — so it is the full-width,
              always-labelled field. The preview below it is only a way to
              check the work, and is sized as the secondary action. */}
          <div className="mt-3 border-t pt-3">
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
                    <button
                      type="button"
                      onClick={() => setDetailsOpen(false)}
                      className="!min-h-0 !min-w-0 rounded px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {mt("hide")}
                    </button>
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
                    value={instructions || ""}
                    onChange={(e) => onInstructionsChange(e.target.value || null)}
                    placeholder={
                      stage === "checkin"
                        ? mt("arrivalInstructionsPlaceholder")
                        : mt("departureInstructionsPlaceholder")
                    }
                    rows={3}
                    className="mt-1.5 bg-background text-xs"
                  />
                </div>

                {hasSmartLock && (
                  <div className="rounded-md border bg-muted/40 p-2.5">
                    <div className="mb-1 flex items-center gap-1.5">
                      <Lock className="size-3.5 text-muted-foreground" />
                      <Label
                        htmlFor="smart-lock-instructions"
                        className="text-xs font-medium"
                      >
                        {mt("smartLockInstructions")}{" "}
                        <span className="font-normal text-muted-foreground">
                          {mt("optionalLabel")}
                        </span>
                      </Label>
                    </div>
                    <Textarea
                      id="smart-lock-instructions"
                      value={smartLockInstructions || ""}
                      onChange={(e) => onSmartLockInstructionsChange(e.target.value || null)}
                      placeholder={mt("smartLockAccessPlaceholder")}
                      rows={2}
                      className="bg-background text-xs"
                    />
                  </div>
                )}
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
                {hasSmartLock && hasSmartLockInstructions && (
                  <Badge
                    variant="outline"
                    className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground"
                  >
                    <Lock className="mr-0.5 size-2.5" />
                    {mt("smartLockAddedBadge")}
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* Preview entry — deliberately the quiet action on this panel. The
              notes field above is what the manager is here to write; this only
              opens a check. Kept as a plain text button so it stays discoverable
              without competing with the field for attention. */}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={onOpenPreview}
              title={mt("previewChefViewHint")}
              className="!min-h-0 !min-w-0 inline-flex items-center gap-1 rounded px-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Eye className="size-3" />
              {mt("previewChefView")}
              <ArrowRight className="size-3" />
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
  /** The rows to render — already filtered. */
  items: UnifiedChecklistItem[];
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
  items,
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

  /**
   * Move one row one slot, in the *unfiltered* list. Neighbours are found by id
   * so that under a filter the row swaps with the next row of the same kind
   * instead of jumping past items that are not on screen.
   */
  const moveItem = useCallback((from: number, to: number) => {
    const current = itemsRef.current;
    const dragged = itemsRef.current[from];
    const over = itemsRef.current[to];
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
    () => new Set(items.map((i) => i.label.trim().toLowerCase())),
    [items],
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

      {/* Footer: add row + scope legend. Hidden for the filtered-empty state,
          which already offers a way out. */}
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
  /** Which slice of the shared list is on screen. Editing is never restricted. */
  const [itemFilter, setItemFilter] = useState<ItemFilter>("all");

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
          <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-2.5 text-[10px] leading-snug text-muted-foreground/80">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p>{mt("bothStagesDisabledHint")}</p>
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
          </div>

          <ChecklistList
            items={visibleItems}
            totalCount={items.length}
            filter={itemFilter}
            onItemsChange={onItemsChange}
            checkinEnabled={checkinEnabled}
            checkoutEnabled={checkoutEnabled}
            onClearFilter={() => setItemFilter("all")}
          />
        </div>
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
