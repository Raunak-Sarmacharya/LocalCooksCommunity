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
  Check,
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
  Undo2,
  X,
} from "@/components/ui/manager-icons";
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
      <div className="flex items-start gap-2 p-2.5">
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

        {/* Primary field + optional note */}
        <div className="min-w-0 flex-1">
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
                  placeholder={mt("optionalHintForChefs")}
                  aria-label={mt("optionalHintForChefs")}
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
                {mt("addNote")}
              </button>
            )}
          </div>
        </div>

        {/* Scope chips */}
        <div
          className="flex shrink-0 items-center gap-1 pt-0.5"
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
        <div className="flex shrink-0 items-center gap-0.5 pt-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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

// ─── Restore snackbar ────────────────────────────────────────────────────────

/**
 * How long the undo affordance stays available after a delete. Shared by the
 * dismissal timer and the countdown so the two can never disagree.
 */
const UNDO_WINDOW_MS = 6000;

/**
 * Undo affordance after a delete. Deletes are instant and unconfirmed — a
 * confirmation dialog on every row is heavier than the action deserves, and a
 * five-second window with a one-tap restore covers the genuine misclick.
 *
 * It previously borrowed the checklist row's own chrome (muted fill, grey
 * border, plain text button), so it read as one more list item rather than as a
 * transient system message, and was easy to miss entirely. It now announces
 * itself with a colour the row language never uses (sky, not emerald/rose/amber),
 * and carries a live countdown ring so its five-second life is visible.
 */
function UndoBar({
  onUndo,
  label,
  seconds,
}: {
  onUndo: () => void;
  label: string;
  seconds: number;
}) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => {
    setRemaining(seconds);
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds, label]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 py-1.5 pl-3 pr-1.5 shadow-sm"
    >
      <Undo2 className="size-3.5 shrink-0 text-sky-600" />
      <p className="min-w-0 flex-1 truncate text-xs font-medium text-sky-900">{label}</p>
      <button
        type="button"
        onClick={onUndo}
        className="!min-h-0 !min-w-0 shrink-0 rounded-md border border-sky-300 bg-white px-2 py-1 text-xs font-semibold text-sky-800 transition-colors hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        {tt("undo")}
      </button>
      <span
        aria-hidden
        className="w-3 shrink-0 text-center text-[11px] tabular-nums text-sky-600"
      >
        {remaining}
      </span>
    </div>
  );
}

// ─── Chef View Preview (matches KitchenCheckinTracker) ───────────────────────

/**
 * Review surface for one flow — a read-only recap of everything the manager has
 * configured, so they can read it top to bottom and confirm it is right.
 *
 * This replaces an interactive simulation of the chef's screen. The simulation
 * was answering the wrong question: a manager here is not asking "what does
 * this look like", they are asking "did I get this right" — and that is a
 * reading task, not a clicking one. It also carried content the manager cannot
 * configure (a fabricated booking slot, a hard-coded smart-lock code), which is
 * noise dressed as information, and being interactive it let a manager tick
 * boxes and leave believing they had changed something.
 *
 * The governing principle is the one Baymard states for review steps: a review
 * page is a summary of known facts, and should introduce nothing new. So this
 * shows committed configuration only, in a fixed order, with no controls other
 * than the one action that matters — jump back to the field and change it.
 */
function ReviewSheet({
  open,
  onOpenChange,
  stage,
  instructions,
  smartLockInstructions,
  items,
  onEditSection,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stage: Stage;
  instructions: string | null;
  smartLockInstructions: string | null;
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
  const hasSmartLock = isCheckin && !!smartLockInstructions;

  const StageIcon = isCheckin ? LogIn : LogOut;

  const nothingConfigured = flowItems.length === 0 && !hasInstructions && !hasSmartLock;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/*
        `hideClose` drops the primitive's floating X and the footer's close
        button becomes the only way out, so the exit is one labelled control in
        the place the eye already is rather than a chrome glyph in the corner.
        Wider than the default sheet on large screens because this is a reading
        surface, not a form — a line of prose wants a book measure, not a phone
        column, and the two-up checklist stays scannable at this width.
      */}
      <SheetContent
        hideClose
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg lg:max-w-2xl"
      >
        {/* One header block instead of a title stack plus a counts strip: the
            counts belong to the reading order, not to the chrome above it. */}
        <SheetHeader className="space-y-0 border-b px-5 py-4 text-left">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <SheetTitle className="flex items-center gap-2 text-base font-medium">
                <StageIcon className="size-4 shrink-0 text-muted-foreground" />
                {isCheckin ? mt("reviewCheckinTitle") : mt("reviewCheckoutTitle")}
              </SheetTitle>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {isCheckin ? mt("reviewCheckinSubtitle") : mt("reviewCheckoutSubtitle")}
              </p>
            </div>
            {/* The one loud thing in the sheet: it answers "how much is this?"
                before a single row is read. */}
            <span className="shrink-0 pt-0.5 text-2xl font-semibold tabular-nums leading-none">
              {flowItems.length}
            </span>
          </div>
        </SheetHeader>

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

              {hasSmartLock && (
                <ReviewBlock
                  icon={<Lock className="size-3.5" />}
                  title={mt("smartLockInstructions")}
                  onEdit={() => onEditSection("instructions")}
                >
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                    {smartLockInstructions}
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
            only control in the sheet, which is what keeps a review surface
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
      </SheetContent>
    </Sheet>
  );
}

/** Which part of the page the review sheet should scroll back to. */
type ReviewEditTarget = "instructions" | "checklist";

/**
 * Sends the manager from the review sheet back to the field they want to fix.
 *
 * Runs a frame late on purpose. The sheet is a modal, so while it is mounted it
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
 * One titled group inside the review sheet.
 *
 * Every block carries its own Edit affordance rather than one at the foot of
 * the sheet, because a single global "edit" forces the manager to work out
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
  /**
   * Moves focus off the switch after the flow is toggled. See the note in
   * `CheckinCheckoutSettings` for why: a switch that is off-screen steals the
   * page scroll when it takes focus.
   */
  onToggleClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
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
  onToggleClick,
  onToggleMouseDown,
  onToggleKeyDown,
}: StageHeaderProps) {
  const title = stage === "checkin" ? mt("checkInStage") : mt("checkOutStage");
  const StageIcon = stage === "checkin" ? LogIn : LogOut;

  const hasSmartLock = stage === "checkin" && smartLockAvailable;
  const hasInstructions = !!instructions;
  const hasSmartLockInstructions = hasSmartLock && !!smartLockInstructions;

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

  /**
   * Notes are edited against a local draft and only pushed up on Save.
   *
   * Writing straight through to the parent would mean `hasInstructions` turns
   * true on the first keystroke, which flips this panel out of its empty state
   * and changes what Save means under the user's hands. A draft keeps the two
   * states honest: the read state shows what has been committed, the editor
   * shows what is being typed, and Save is the only thing that moves one to the
   * other.
   *
   * `smartLockDraft` rides along because it lives inside the same disclosure —
   * committing it separately would let a manager save one half of a form they
   * filled in as a unit.
   */
  const [draft, setDraft] = useState(() => instructions ?? "");
  const [smartLockDraft, setSmartLockDraft] = useState(() => smartLockInstructions ?? "");
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
    smartLock: smartLockInstructions ?? "",
  });

  // Adopt committed values whenever they actually change underneath us. On the
  // very first run this is a genuine hydration (empty initial state → server
  // values), so the drafts are filled in and no edit is lost, because nothing
  // has been typed yet.
  useEffect(() => {
    const next = {
      instructions: instructions ?? "",
      smartLock: smartLockInstructions ?? "",
    };
    const prev = lastCommittedRef.current;
    if (prev.instructions === next.instructions && prev.smartLock === next.smartLock) return;
    lastCommittedRef.current = next;
    setDraft(next.instructions);
    setSmartLockDraft(next.smartLock);
  }, [instructions, smartLockInstructions]);

  /** True once the manager has typed something the committed value lacks. */
  const notesDirty =
    draft !== (instructions ?? "") || smartLockDraft !== (smartLockInstructions ?? "");

  const commitNotes = useCallback(() => {
    const next = draft.trim();
    const nextLock = hasSmartLock ? smartLockDraft.trim() : "";

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
    lastCommittedRef.current = { instructions: next, smartLock: nextLock };

    onInstructionsChange(next || null);
    if (hasSmartLock) onSmartLockInstructionsChange(nextLock || null);

    setDraft(next);
    setSmartLockDraft(nextLock);
    setSavedAt(Date.now());
    setDetailsOpen(false);
  }, [
    draft,
    smartLockDraft,
    hasSmartLock,
    onInstructionsChange,
    onSmartLockInstructionsChange,
  ]);

  const cancelNotes = useCallback(() => {
    setDraft(instructions ?? "");
    setSmartLockDraft(smartLockInstructions ?? "");
    setDetailsOpen(false);
  }, [instructions, smartLockInstructions]);

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

          {/* Instructions + smart lock, behind one disclosure.
              This is the primary writing surface on the panel — the thing a
              manager actually comes here to type — so it is the full-width,
              always-labelled field. The preview below it is only a way to
              check the work, and is sized as the secondary action. */}
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
                      value={smartLockDraft}
                      onChange={(e) => setSmartLockDraft(e.target.value)}
                      placeholder={mt("smartLockAccessPlaceholder")}
                      rows={2}
                      className="bg-background text-xs"
                    />
                  </div>
                )}

                {/*
                  The commit pair. Previously the only exit was "Hide", which
                  reads as "close this" and says nothing about whether the text
                  was kept — the manager had to guess. Save makes the model
                  explicit, Cancel is the honest escape hatch, and the pair sits
                  where the eye already is after typing.

                  Save is disabled on an untouched draft: with nothing changed
                  there is nothing to commit, and an always-live button invites
                  a click that appears to do nothing.
                */}
                <div className="flex items-center justify-end gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={cancelNotes}
                    className="!min-h-0 !min-w-0 rounded px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {mt("cancel")}
                  </button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={commitNotes}
                    disabled={!notesDirty}
                    className="!min-h-0 h-7 gap-1.5 rounded-md px-2 text-[11px]"
                  >
                    <Check className="size-3" />
                    {mt("saveNotes")}
                  </Button>
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

                  {hasSmartLockInstructions && (
                    <div className="mt-2 flex items-start gap-1.5 border-t border-border/60 pt-2">
                      <Lock className="mt-px size-3 shrink-0 text-muted-foreground" />
                      <p className="min-w-0 flex-1 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                        {smartLockInstructions}
                      </p>
                    </div>
                  )}
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
          seconds={Math.round(UNDO_WINDOW_MS / 1000)}
          onUndo={undoRemove}
        />
      )}

      {/* Footer: add row + scope legend. Hidden for the filtered-empty state,
          which already offers a way out. */}
      {items.length > 0 && (
        <div className="space-y-2 pt-0.5">
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addItem}
              className="h-8 flex-1 rounded-lg text-xs shadow-none hover:translate-y-0 hover:shadow-none"
            >
              <Plus className="mr-1.5 size-3.5" />
              {mt("addChecklistItem")}
            </Button>
            {/* Sits beside the add button, not only in the empty state, so the
                preset list stays one tap away however long the list has grown. */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 flex-1 rounded-lg text-xs shadow-none hover:translate-y-0 hover:shadow-none"
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
  /** Forwarded to both flow switches — see `StageHeaderProps.onToggleClick`. */
  onFlowToggleClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onFlowToggleMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onFlowToggleKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
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
  onFlowToggleClick,
  onFlowToggleMouseDown,
  onFlowToggleKeyDown,
}: KitchenCheckinCheckoutEditorProps) {
  const [previewStage, setPreviewStage] = useState<Stage | null>(null);
  /** Which slice of the shared list is on screen. Editing is never restricted. */
  const [itemFilter, setItemFilter] = useState<ItemFilter>("all");

  /**
   * Takes the manager from the review sheet back to the thing they want to
   * change, and closes the sheet on the way. The whole point of a review
   * surface is that catching a mistake there should cost one click, not a
   * walk back through the page — leaving the sheet open would just put a
   * panel between them and the field.
   *
   * The target is scrolled to *after* the close, in a frame, because the sheet
   * is a modal: scrolling underneath it while it is still mounted does nothing
   * the manager can see, and Radix restores focus on unmount which would fight
   * a scroll started in the same tick.
   */
  const handleEditSection = useCallback((target: ReviewEditTarget) => {
    setPreviewStage((stage) => {
      if (stage) scrollToReviewTarget(stage, target);
      return null;
    });
  }, []);

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
            onToggleClick={onFlowToggleClick}
            onToggleMouseDown={onFlowToggleMouseDown}
            onToggleKeyDown={onFlowToggleKeyDown}
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
            onToggleClick={onFlowToggleClick}
            onToggleMouseDown={onFlowToggleMouseDown}
            onToggleKeyDown={onFlowToggleKeyDown}
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

      {/* Review surface — a read-only recap of this flow, so the manager can
          read it back and confirm it is right. See ReviewSheet for why this
          replaced an interactive simulation of the chef's screen. */}
      <ReviewSheet
        open={previewStage !== null}
        onOpenChange={(o) => {
          if (!o) setPreviewStage(null);
        }}
        stage={previewStage || "checkin"}
        instructions={
          previewStage === "checkout" ? checkoutInstructions : checkinInstructions
        }
        // The review must not show a capability the chef will not get: when no
        // kitchen here has a smart lock, it is hidden from chefs too.
        smartLockInstructions={smartLockAvailable ? smartLockInstructions : null}
        items={items}
        onEditSection={handleEditSection}
      />
    </Card>
  );
}
