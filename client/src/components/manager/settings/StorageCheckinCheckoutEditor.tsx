/**
 * Storage Check-In / Check-Out Unified Editor
 *
 * Matrix-style editor for storage move-in and move-out inspections. Mirrors
 * the Kitchen Check-In / Check-Out editor exactly so managers get one
 * consistent pattern across both surfaces:
 *
 *   - A single underlying list of checklist items.
 *   - Each item carries its own Photo flag + per-stage flags (Check-In /
 *     Check-Out) so the same item can appear on one or both flows.
 *   - At save time the unified list is split back into the server's legacy
 *     `storageCheckinItems` / `storageCheckoutItems` + photo requirement
 *     arrays via `storageInspectionItemsToArrays()`.
 *
 * This is the enterprise-grade equivalent of the Turo/Airbnb move-in /
 * move-out inspection flow applied to storage rentals.
 */

import { useCallback, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Camera,
  ClipboardCheck,
  Eye,
  Info,
  Boxes,
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
 * Unified storage checklist item. At save time this is split back into
 * `storageCheckinItems` / `storageCheckoutItems` + photo requirement arrays
 * so the server contract and chef-side code stay intact.
 */
export interface UnifiedStorageInspectionItem {
  id: string;
  label: string;
  description?: string;
  requiredOnCheckin: boolean;
  requiredOnCheckout: boolean;
  photoRequired: boolean;
}

export type StorageStage = "checkin" | "checkout";

// ─── ID helper ────────────────────────────────────────────────────────────────

export function generateStorageInspectionItemId(): string {
  return `storage_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ─── Storage ↔ Unified conversion helpers ─────────────────────────────────────

/**
 * Collapse the server's four-array shape (check-in items / check-out items +
 * their sibling photo requirements) into a single unified list for the editor.
 * Items appearing in both stages by id are merged; orphan photo requirements
 * without a matching checklist item become synthesised items so nothing is
 * silently dropped.
 */
export function unifyStorageInspectionItems(params: {
  checkinItems: ChecklistItem[];
  checkoutItems: ChecklistItem[];
  checkinPhotoRequirements: PhotoRequirement[];
  checkoutPhotoRequirements: PhotoRequirement[];
}): UnifiedStorageInspectionItem[] {
  const {
    checkinItems,
    checkoutItems,
    checkinPhotoRequirements,
    checkoutPhotoRequirements,
  } = params;

  const map = new Map<string, UnifiedStorageInspectionItem>();

  const checkinPhotoIds = new Set((checkinPhotoRequirements || []).map((p) => p.id));
  const checkoutPhotoIds = new Set((checkoutPhotoRequirements || []).map((p) => p.id));

  const upsert = (source: ChecklistItem, stage: StorageStage) => {
    const existing = map.get(source.id);
    const photoFromFlag = source.photoRequired === true;
    const photoFromLegacy =
      stage === "checkin"
        ? checkinPhotoIds.has(source.id)
        : checkoutPhotoIds.has(source.id);
    const photoRequired = photoFromFlag || photoFromLegacy;

    if (existing) {
      existing.requiredOnCheckin =
        existing.requiredOnCheckin || stage === "checkin";
      existing.requiredOnCheckout =
        existing.requiredOnCheckout || stage === "checkout";
      existing.photoRequired = existing.photoRequired || photoRequired;
      if (!existing.description && source.description) {
        existing.description = source.description;
      }
      return;
    }

    map.set(source.id, {
      id: source.id,
      label: source.label || "",
      description: source.description,
      requiredOnCheckin: stage === "checkin",
      requiredOnCheckout: stage === "checkout",
      photoRequired,
    });
  };

  for (const item of checkinItems || []) upsert(item, "checkin");
  for (const item of checkoutItems || []) upsert(item, "checkout");

  // Orphan photo requirements → synthesize items
  const mergeOrphan = (photo: PhotoRequirement, stage: StorageStage) => {
    const existing = map.get(photo.id);
    if (existing) {
      existing.photoRequired = true;
      if (stage === "checkin") existing.requiredOnCheckin = true;
      else existing.requiredOnCheckout = true;
      return;
    }
    map.set(photo.id, {
      id: photo.id,
      label: photo.label || "",
      description: photo.description,
      requiredOnCheckin: stage === "checkin",
      requiredOnCheckout: stage === "checkout",
      photoRequired: true,
    });
  };
  for (const p of checkinPhotoRequirements || []) mergeOrphan(p, "checkin");
  for (const p of checkoutPhotoRequirements || []) mergeOrphan(p, "checkout");

  return Array.from(map.values());
}

/**
 * Split the unified list back into the server's legacy four-array shape.
 * Items with an empty label, or items not assigned to any stage, are dropped
 * (the editor prevents this state from being saved).
 */
export function storageInspectionItemsToArrays(
  items: UnifiedStorageInspectionItem[],
): {
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

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateStorageInspectionItems(
  items: UnifiedStorageInspectionItem[],
): string[] {
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
      `${orphans.length} item(s) are not assigned to Check-In or Check-Out`,
    );
  }
  return errors;
}

// ─── Stage Checkbox (table cell) ──────────────────────────────────────────────

interface StageCheckboxProps {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  tooltip: string;
  disabledTooltip?: string;
  accent: "emerald" | "amber-strong" | "amber";
  ariaLabel: string;
}

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
    "amber-strong":
      "data-[state=checked]:bg-amber-600 data-[state=checked]:border-amber-600 data-[state=checked]:text-white",
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

// ─── Chef Preview Sheet ───────────────────────────────────────────────────────

function ChefPreviewSheet({
  open,
  onOpenChange,
  stage,
  instructions,
  items,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  stage: StorageStage;
  instructions: string | null;
  items: UnifiedStorageInspectionItem[];
}) {
  const filledItems = items.filter(
    (i) =>
      i.label.trim() &&
      (stage === "checkin" ? i.requiredOnCheckin : i.requiredOnCheckout),
  );
  const filledPhotoItems = filledItems.filter((i) => i.photoRequired);
  const hasAnyContent = filledItems.length > 0 || !!instructions;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-amber-600" />
            {stage === "checkin" ? "Storage Check-In" : "Storage Check-Out"}
          </SheetTitle>
          <SheetDescription>
            This is exactly what the chef sees — updates as you edit.
          </SheetDescription>
        </SheetHeader>

        <div className="py-4 space-y-3">
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

          {filledItems.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {stage === "checkin"
                  ? "Move-In Inspection"
                  : "Move-Out Inspection"}
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

          <div className="space-y-1">
            <Label className="text-sm font-medium">Notes (optional)</Label>
            <Textarea
              disabled
              rows={2}
              placeholder={
                stage === "checkin"
                  ? "Move-in notes (e.g., existing wear)..."
                  : "Move-out notes (e.g., condition on return)..."
              }
              className="opacity-60"
            />
          </div>

          {!hasAnyContent && (
            <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
              <Info className="size-5 mx-auto mb-2" />
              <p>Nothing configured yet.</p>
              <p className="text-xs mt-1">
                Add items to the left to see the chef view.
              </p>
            </div>
          )}

          <Button disabled className="w-full mt-2" size="lg">
            {stage === "checkin" ? (
              <LogIn className="h-4 w-4 mr-2" />
            ) : (
              <LogOut className="h-4 w-4 mr-2" />
            )}
            {stage === "checkin" ? "Submit Check-In" : "Submit Checkout"}
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
  stage: StorageStage;
  enabled: boolean;
  onEnabledChange: (val: boolean) => void;
  instructions: string | null;
  onInstructionsChange: (val: string | null) => void;
  itemCount: number;
  photoCount: number;
  onOpenPreview: () => void;
}

function StageHeader({
  stage,
  enabled,
  onEnabledChange,
  instructions,
  onInstructionsChange,
  itemCount,
  photoCount,
  onOpenPreview,
}: StageHeaderProps) {
  const title = stage === "checkin" ? "Check-In" : "Check-Out";
  const StageIcon = stage === "checkin" ? LogIn : LogOut;
  const panelClass = enabled
    ? stage === "checkin"
      ? "border-emerald-200 bg-emerald-50/40"
      : "border-amber-200 bg-amber-50/40"
    : "border-border bg-muted/20";
  const iconClass =
    stage === "checkin" ? "text-emerald-600" : "text-amber-600";

  return (
    <div className={cn("rounded-lg border p-3 space-y-3", panelClass)}>
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
                ? "Documented by chefs when they first access the storage unit"
                : "Documented by chefs when they return the storage unit"}
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
            aria-label={
              enabled ? `Disable Storage ${title}` : `Enable Storage ${title}`
            }
          />
        </div>
      </div>

      {enabled && (
        <div>
          <Label
            htmlFor={`storage-${stage}-instructions`}
            className="text-xs font-medium text-muted-foreground"
          >
            Instructions for Chefs{" "}
            <span className="font-normal">(optional)</span>
          </Label>
          <Textarea
            id={`storage-${stage}-instructions`}
            value={instructions || ""}
            onChange={(e) => onInstructionsChange(e.target.value || null)}
            placeholder={
              stage === "checkin"
                ? "Shown before chefs document move-in condition..."
                : "Shown before chefs submit storage checkout..."
            }
            rows={2}
            className="mt-1 text-xs bg-background"
          />
        </div>
      )}
    </div>
  );
}

// ─── Checklist Table (TanStack) ───────────────────────────────────────────────

interface ChecklistTableProps {
  items: UnifiedStorageInspectionItem[];
  onItemsChange: (next: UnifiedStorageInspectionItem[]) => void;
  checkinEnabled: boolean;
  checkoutEnabled: boolean;
}

function ChecklistTable({
  items,
  onItemsChange,
  checkinEnabled,
  checkoutEnabled,
}: ChecklistTableProps) {
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);

  const updateItem = useCallback(
    (id: string, updated: UnifiedStorageInspectionItem) => {
      const next = items.map((i) => (i.id === id ? updated : i));
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
    // Default to check-in when enabled — establishes the baseline first,
    // which is the more common onboarding workflow.
    const addToCheckin = checkinEnabled || !checkoutEnabled;
    const addToCheckout = checkoutEnabled && !addToCheckin;
    const next: UnifiedStorageInspectionItem = {
      id: generateStorageInspectionItemId(),
      label: "",
      description: undefined,
      requiredOnCheckin: addToCheckin,
      requiredOnCheckout: addToCheckout,
      photoRequired: false,
    };
    onItemsChange([...items, next]);
  }, [items, onItemsChange, checkinEnabled, checkoutEnabled]);

  const columns = useMemo<ColumnDef<UnifiedStorageInspectionItem>[]>(
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
                placeholder="e.g. Photo the empty unit from each corner"
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
                  ? "Required when the chef moves in. Click to remove."
                  : "Add to the Storage Check-In checklist"
              }
              onToggle={() =>
                updateItem(item.id, {
                  ...item,
                  requiredOnCheckin: !item.requiredOnCheckin,
                })
              }
              accent="emerald"
              ariaLabel="Required on storage check-in"
            />
          );
        },
        enableSorting: false,
      },
      {
        id: "checkout",
        accessorFn: (row) => row.requiredOnCheckout,
        header: () => (
          <div className="flex items-center justify-center gap-1 text-amber-700">
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
                  ? "Required when the chef returns storage. Click to remove."
                  : "Add to the Storage Check-Out checklist"
              }
              onToggle={() =>
                updateItem(item.id, {
                  ...item,
                  requiredOnCheckout: !item.requiredOnCheckout,
                })
              }
              accent="amber-strong"
              ariaLabel="Required on storage check-out"
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

export interface StorageCheckinCheckoutEditorProps {
  items: UnifiedStorageInspectionItem[];
  onItemsChange: (next: UnifiedStorageInspectionItem[]) => void;
  checkinEnabled: boolean;
  onCheckinEnabledChange: (val: boolean) => void;
  checkoutEnabled: boolean;
  onCheckoutEnabledChange: (val: boolean) => void;
  checkinInstructions: string | null;
  onCheckinInstructionsChange: (val: string | null) => void;
  checkoutInstructions: string | null;
  onCheckoutInstructionsChange: (val: string | null) => void;
}

export function StorageCheckinCheckoutEditor({
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
}: StorageCheckinCheckoutEditorProps) {
  const [previewStage, setPreviewStage] = useState<StorageStage | null>(null);

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
          <div className="size-9 rounded-lg flex items-center justify-center bg-amber-50">
            <Boxes className="size-5 text-amber-600" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-lg">
              Storage Check-In / Check-Out Checklists
            </CardTitle>
            <CardDescription>
              Configure what chefs document at move-in and move-out. Use the
              matrix table to assign each item to Check-In, Check-Out, or both
              — plus an optional photo requirement.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <StageHeader
            stage="checkin"
            enabled={checkinEnabled}
            onEnabledChange={onCheckinEnabledChange}
            instructions={checkinInstructions}
            onInstructionsChange={onCheckinInstructionsChange}
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
            itemCount={checkoutItemCount}
            photoCount={checkoutPhotoCount}
            onOpenPreview={() => setPreviewStage("checkout")}
          />
        </div>

        <ChecklistTable
          items={items}
          onItemsChange={onItemsChange}
          checkinEnabled={checkinEnabled}
          checkoutEnabled={checkoutEnabled}
        />
      </CardContent>

      <ChefPreviewSheet
        open={previewStage !== null}
        onOpenChange={(o) => {
          if (!o) setPreviewStage(null);
        }}
        stage={previewStage || "checkin"}
        instructions={
          previewStage === "checkout" ? checkoutInstructions : checkinInstructions
        }
        items={items}
      />
    </Card>
  );
}
