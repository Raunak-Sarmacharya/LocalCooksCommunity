/**
 * Kitchen Check-In / Check-Out Unified Editor
 *
 * A tabbed editor where a single underlying list of checklist items can
 * appear on the Check-In flow, the Check-Out flow, or both. Each item
 * carries its own "photo required" flag, replacing the old pattern of
 * maintaining a separate photo-requirements array.
 *
 * Preview opens as a side Sheet that mirrors exactly what chefs see in
 * `KitchenCheckinTracker.tsx` — the goal being no surprises between what
 * the manager configures and what the chef eventually interacts with.
 */

import { useCallback, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Camera,
  ClipboardCheck,
  Lock,
  Eye,
  Info,
  ChefHat,
  LogIn,
  LogOut,
  Upload,
  ArrowUpDown,
} from "lucide-react";
import {
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  ChecklistItem,
  PhotoRequirement,
} from "./shared/ChecklistEditor";

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

export function validateUnifiedItems(items: UnifiedChecklistItem[]): string[] {
  const errors: string[] = [];
  const empty = items.filter((i) => !i.label.trim());
  if (empty.length > 0) {
    errors.push(`${empty.length} checklist item(s) have empty labels`);
  }
  const orphans = items.filter(
    (i) => !i.requiredOnCheckin && !i.requiredOnCheckout && i.label.trim(),
  );
  if (orphans.length > 0) {
    errors.push(
      `${orphans.length} item(s) are not assigned to check-in or check-out`,
    );
  }
  return errors;
}

// ─── Stage Checkbox (used as a cell in the checklist table) ──────────────────

interface StageCheckboxProps {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  tooltip: string;
  disabledTooltip?: string;
  accent: "emerald" | "primary" | "amber";
  ariaLabel: string;
}

/**
 * Accent-coloured, tooltipped checkbox used inside the checklist table to
 * signal "this item is required on Check-In / Check-Out / with a photo".
 * The accent colour matches the chef-facing badge for each stage so the
 * colour system is consistent end-to-end.
 */
function StageCheckbox({
  checked,
  disabled,
  onToggle,
  tooltip,
  disabledTooltip,
  accent,
  ariaLabel,
}: StageCheckboxProps) {
  const accentClass = {
    emerald:
      "data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500 data-[state=checked]:text-white",
    primary:
      "data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-white",
    amber:
      "data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500 data-[state=checked]:text-white",
  }[accent];

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center justify-center">
            <Checkbox
              checked={checked}
              disabled={disabled}
              onCheckedChange={() => !disabled && onToggle()}
              className={cn("size-5", accentClass)}
              aria-label={ariaLabel}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] text-xs">
          {disabled && disabledTooltip ? disabledTooltip : tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
            <ChefHat className="h-5 w-5 text-primary" />
            {stage === "checkin" ? "Kitchen Check-In" : "Kitchen Check-Out"}
          </SheetTitle>
          <SheetDescription>
            This is exactly what the chef sees — updates as you edit.
          </SheetDescription>
        </SheetHeader>

        <div className="py-4 space-y-3">
          {/* Manager Instructions */}
          {instructions && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs text-blue-800 font-medium mb-1">
                Instructions from Manager
              </p>
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
                <p className="text-xs text-violet-800 font-medium">
                  Smart Lock Access
                </p>
              </div>
              <p className="text-xs text-violet-700 whitespace-pre-line">
                {smartLockInstructions}
              </p>
              <div className="flex items-center gap-2 p-2 rounded-md bg-violet-100 border border-violet-300">
                <span className="text-lg font-mono font-bold text-violet-900 tracking-[0.2em]">
                  A1B2C3
                </span>
                <span className="text-[10px] text-violet-600 ml-auto">
                  (sample code)
                </span>
              </div>
            </div>
          )}

          {/* Checklist Items */}
          {filledItems.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {stage === "checkin" ? "Checklist" : "Checkout Checklist"}
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
                        <Camera className="size-2.5 mr-1" />
                        Photo required
                      </Badge>
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
                <Camera className="h-4 w-4" /> Photos Required
              </Label>
              <p className="text-[11px] text-muted-foreground">
                One photo per item. Chef uploads these as part of the form.
              </p>
              {filledPhotoItems.map((item) => (
                <div key={`preview-photo-${item.id}`} className="space-y-1">
                  <p className="text-sm font-medium">
                    {item.label}
                    <span className="text-destructive ml-0.5">*</span>
                  </p>
                  <div className="border-2 border-dashed border-border rounded-lg p-4 flex flex-col items-center justify-center opacity-60">
                    <Upload className="h-5 w-5 text-muted-foreground mb-1" />
                    <span className="text-[11px] text-muted-foreground">
                      Chef uploads this photo
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Notes textarea */}
          <div className="space-y-1">
            <Label className="text-sm font-medium">Notes (optional)</Label>
            <Textarea
              disabled
              rows={2}
              placeholder={
                stage === "checkin"
                  ? "Optional check-in notes..."
                  : "Checkout notes (e.g., kitchen condition)..."
              }
              className="opacity-60"
            />
          </div>

          {/* Empty state */}
          {!hasAnyContent && (
            <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
              <Info className="size-5 mx-auto mb-2" />
              <p>Nothing configured yet.</p>
              <p className="text-xs mt-1">
                Add items to the left to see the chef view.
              </p>
            </div>
          )}

          {/* Submit button */}
          <Button disabled className="w-full mt-2" size="lg">
            {stage === "checkin" ? (
              <LogIn className="h-4 w-4 mr-2" />
            ) : (
              <LogOut className="h-4 w-4 mr-2" />
            )}
            {stage === "checkin" ? "Confirm Check-In" : "Submit Checkout"}
          </Button>
          <p className="text-[10px] text-center text-muted-foreground">
            Chef cannot submit until all items are checked and all photos are
            uploaded.
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
 * checklist items live in a separate shared table below both StageHeaders so
 * managers can see and edit the full matrix at once.
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
  const title = stage === "checkin" ? "Check-In" : "Check-Out";
  const StageIcon = stage === "checkin" ? LogIn : LogOut;
  const panelClass = enabled
    ? stage === "checkin"
      ? "border-emerald-200 bg-emerald-50/40"
      : "border-primary/20 bg-primary/5"
    : "border-border bg-muted/20";
  const iconClass =
    stage === "checkin" ? "text-emerald-600" : "text-primary";

  return (
    <div className={cn("rounded-lg border p-3 space-y-3", panelClass)}>
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
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4 px-1.5"
                  >
                    {itemCount} item{itemCount !== 1 ? "s" : ""}
                  </Badge>
                  {photoCount > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1.5 bg-amber-50 text-amber-800 border-amber-200"
                    >
                      <Camera className="size-2.5 mr-0.5" />
                      {photoCount} photo{photoCount !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {stage === "checkin"
                ? "Confirmed by chefs on arrival"
                : "Confirmed by chefs before leaving"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {enabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onOpenPreview}
            >
              <Eye className="size-3 mr-1" />
              Preview
            </Button>
          )}
          <Switch
            checked={enabled}
            onCheckedChange={onEnabledChange}
            aria-label={enabled ? `Disable ${title}` : `Enable ${title}`}
          />
        </div>
      </div>

      {enabled && (
        <div className="space-y-2">
          {/* Instructions */}
          <div>
            <Label
              htmlFor={`${stage}-instructions`}
              className="text-xs font-medium text-muted-foreground"
            >
              Instructions for Chefs{" "}
              <span className="font-normal">(optional)</span>
            </Label>
            <Textarea
              id={`${stage}-instructions`}
              value={instructions || ""}
              onChange={(e) => onInstructionsChange(e.target.value || null)}
              placeholder={
                stage === "checkin"
                  ? "Shown before chefs check in..."
                  : "Shown before chefs check out..."
              }
              rows={2}
              className="mt-1 text-xs bg-background"
            />
          </div>

          {/*
            Smart-lock instructions — admin-gated capability and check-in only
            since smart locks are irrelevant to post-booking checkout.
          */}
          {stage === "checkin" && smartLockAvailable && (
            <div className="p-2.5 rounded-md border border-violet-200 bg-violet-50/70">
              <div className="flex items-center gap-1.5 mb-1">
                <Lock className="size-3.5 text-violet-600" />
                <Label
                  htmlFor="smart-lock-instructions"
                  className="text-xs font-medium text-violet-900"
                >
                  Smart Lock Instructions{" "}
                  <span className="text-violet-500 font-normal">
                    (optional)
                  </span>
                </Label>
              </div>
              <Textarea
                id="smart-lock-instructions"
                value={smartLockInstructions || ""}
                onChange={(e) =>
                  onSmartLockInstructionsChange(e.target.value || null)
                }
                placeholder="e.g. 'Enter the 6-digit access code on the keypad next to the front door'"
                rows={2}
                className="text-xs border-violet-200 bg-white"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Checklist Table (TanStack) ───────────────────────────────────────────────

interface ChecklistTableProps {
  items: UnifiedChecklistItem[];
  onItemsChange: (next: UnifiedChecklistItem[]) => void;
  checkinEnabled: boolean;
  checkoutEnabled: boolean;
}

/**
 * A TanStack-powered editable table listing every checklist item in a single
 * matrix view. Each row's Check-In, Check-Out and Photo columns are actual
 * checkboxes — no more ambiguous "are these tags or toggles?" pill buttons.
 *
 * Rules:
 *   - An item must belong to at least one stage; the last stage checkbox
 *     guards against being unchecked (you must add it to the other stage
 *     first, or use the delete button).
 *   - Disabling a flow doesn't hide its column, it simply dims the relevant
 *     checkboxes so managers always see the full configuration.
 */
function ChecklistTable({
  items,
  onItemsChange,
  checkinEnabled,
  checkoutEnabled,
}: ChecklistTableProps) {
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);

  const updateItem = useCallback(
    (id: string, updated: UnifiedChecklistItem) => {
      const next = items.map((i) => (i.id === id ? updated : i));
      // Defensive: drop items that no longer belong to any stage
      onItemsChange(
        next.filter((i) => i.requiredOnCheckin || i.requiredOnCheckout),
      );
    },
    [items, onItemsChange],
  );

  const removeItem = useCallback(
    (id: string) => {
      onItemsChange(items.filter((i) => i.id !== id));
    },
    [items, onItemsChange],
  );

  const addItem = useCallback(() => {
    // Default new items to whichever flow is enabled. If both are enabled,
    // default to check-in only (most common case). Manager can toggle later.
    const addToCheckin = checkinEnabled || !checkoutEnabled;
    const addToCheckout = checkoutEnabled && !addToCheckin;
    const next: UnifiedChecklistItem = {
      id: generateUnifiedItemId(),
      label: "",
      description: undefined,
      requiredOnCheckin: addToCheckin,
      requiredOnCheckout: addToCheckout,
      photoRequired: false,
    };
    onItemsChange([...items, next]);
  }, [items, onItemsChange, checkinEnabled, checkoutEnabled]);

  const columns = useMemo<ColumnDef<UnifiedChecklistItem>[]>(
    () => [
      {
        id: "serial",
        header: () => <span className="sr-only">#</span>,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {row.index + 1}
          </span>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "label",
        header: ({ column }) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            <ClipboardCheck className="size-3.5" />
            Item
            <ArrowUpDown className="size-3" />
          </button>
        ),
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="space-y-1 min-w-[220px]">
              <Input
                value={item.label}
                onChange={(e) =>
                  updateItem(item.id, { ...item, label: e.target.value })
                }
                placeholder="e.g. Wipe down all counters"
                className="h-8 text-sm font-medium"
              />
              <Input
                value={item.description || ""}
                onChange={(e) =>
                  updateItem(item.id, {
                    ...item,
                    description: e.target.value || undefined,
                  })
                }
                placeholder="Optional hint for chefs"
                className="h-7 text-xs text-muted-foreground"
              />
            </div>
          );
        },
        enableSorting: true,
      },
      {
        id: "checkin",
        accessorFn: (row) => row.requiredOnCheckin,
        header: () => (
          <div className="flex items-center justify-center gap-1 text-emerald-700">
            <LogIn className="size-3.5" />
            <span>Check-In</span>
          </div>
        ),
        cell: ({ row }) => {
          const item = row.original;
          const onlyStage =
            item.requiredOnCheckin && !item.requiredOnCheckout;
          return (
            <StageCheckbox
              checked={item.requiredOnCheckin}
              disabled={onlyStage}
              disabledTooltip="Add to Check-Out first, or delete the item instead."
              tooltip={
                item.requiredOnCheckin
                  ? "Required when the chef checks in. Click to remove."
                  : "Add to the Check-In checklist"
              }
              onToggle={() =>
                updateItem(item.id, {
                  ...item,
                  requiredOnCheckin: !item.requiredOnCheckin,
                })
              }
              accent="emerald"
              ariaLabel="Required on check-in"
            />
          );
        },
        enableSorting: false,
      },
      {
        id: "checkout",
        accessorFn: (row) => row.requiredOnCheckout,
        header: () => (
          <div className="flex items-center justify-center gap-1 text-primary">
            <LogOut className="size-3.5" />
            <span>Check-Out</span>
          </div>
        ),
        cell: ({ row }) => {
          const item = row.original;
          const onlyStage =
            item.requiredOnCheckout && !item.requiredOnCheckin;
          return (
            <StageCheckbox
              checked={item.requiredOnCheckout}
              disabled={onlyStage}
              disabledTooltip="Add to Check-In first, or delete the item instead."
              tooltip={
                item.requiredOnCheckout
                  ? "Required when the chef checks out. Click to remove."
                  : "Add to the Check-Out checklist"
              }
              onToggle={() =>
                updateItem(item.id, {
                  ...item,
                  requiredOnCheckout: !item.requiredOnCheckout,
                })
              }
              accent="primary"
              ariaLabel="Required on check-out"
            />
          );
        },
        enableSorting: false,
      },
      {
        id: "photo",
        accessorFn: (row) => row.photoRequired,
        header: () => (
          <div className="flex items-center justify-center gap-1 text-amber-700">
            <Camera className="size-3.5" />
            <span>Photo</span>
          </div>
        ),
        cell: ({ row }) => {
          const item = row.original;
          return (
            <StageCheckbox
              checked={item.photoRequired}
              tooltip={
                item.photoRequired
                  ? "Chef must upload a photo for this item. Click to remove."
                  : "Require the chef to upload a photo alongside ticking this item"
              }
              onToggle={() =>
                updateItem(item.id, {
                  ...item,
                  photoRequired: !item.photoRequired,
                })
              }
              accent="amber"
              ariaLabel="Photo required"
            />
          );
        },
        enableSorting: false,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={() => removeItem(row.original.id)}
            aria-label="Delete item"
          >
            <Trash2 className="size-3.5" />
          </Button>
        ),
        enableSorting: false,
      },
    ],
    [updateItem, removeItem],
  );

  const table = useReactTable({
    data: items,
    columns,
    state: {
      sorting,
      globalFilter: filter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = String(filterValue).toLowerCase().trim();
      if (!q) return true;
      return (
        row.original.label.toLowerCase().includes(q) ||
        (row.original.description || "").toLowerCase().includes(q)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-3">
      {/* Table header row: title + search */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardCheck className="size-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">Checklist Items</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            — tick the columns to assign each item to a flow
          </span>
        </div>
        {items.length > 0 && (
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search items..."
            className="h-8 max-w-[220px] text-xs"
          />
        )}
      </div>

      {/* Table or empty state */}
      {items.length === 0 ? (
        <div className="text-center py-10 text-xs text-muted-foreground border border-dashed rounded-lg">
          <ClipboardCheck className="size-6 mx-auto mb-2 text-muted-foreground/40" />
          <p className="font-medium text-sm text-foreground">
            No checklist items yet
          </p>
          <p className="mt-0.5">
            Add your first item below and use the Check-In / Check-Out / Photo
            columns to assign it.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  className="bg-muted/40 hover:bg-muted/40"
                >
                  {headerGroup.headers.map((header) => {
                    const id = header.column.id;
                    const isStageCol =
                      id === "checkin" ||
                      id === "checkout" ||
                      id === "photo";
                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          "h-9 text-xs font-medium",
                          isStageCol && "text-center w-[110px]",
                          id === "actions" && "w-[48px]",
                          id === "serial" && "w-[40px] text-center",
                        )}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => {
                      const id = cell.column.id;
                      const isStageCol =
                        id === "checkin" ||
                        id === "checkout" ||
                        id === "photo";
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            "py-2",
                            id === "label" && "align-top",
                            (isStageCol || id === "actions" || id === "serial") &&
                              "text-center align-middle",
                          )}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-20 text-center text-xs text-muted-foreground"
                  >
                    No items match "{filter}".
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addItem}
        className="w-full h-8 text-xs"
      >
        <Plus className="size-3.5 mr-1.5" />
        Add Checklist Item
      </Button>
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg flex items-center justify-center bg-primary/10">
            <ClipboardCheck className="size-5 text-primary" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-lg">
              Check-In / Check-Out Checklists
            </CardTitle>
            <CardDescription>
              Configure what chefs verify at each stage. Use the matrix table
              to assign each item to Check-In, Check-Out, or both — plus an
              optional photo requirement.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stage panels — stacked on mobile, side-by-side on md+. Each panel
            owns its own enable switch, instructions, smart-lock (check-in
            only), and preview button. Items are managed in the unified table
            below. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

        {/* Unified checklist matrix — one row per item, columns for
            Check-In / Check-Out / Photo. */}
        <ChecklistTable
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
