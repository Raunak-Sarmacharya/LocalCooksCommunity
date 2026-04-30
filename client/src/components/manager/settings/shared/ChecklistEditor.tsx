/**
 * Shared checklist editor primitives used by both
 * CheckinCheckoutSettings (kitchen) and StorageCheckoutSettings.
 *
 * Keeps the UI consistent across settings pages and avoids
 * duplicated helper code.
 */

import { useState, useCallback } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  category: "general" | "safety" | "equipment" | "smart_lock";
  /**
   * When true, the chef must upload a photo alongside checking this item off.
   * Used by CheckinCheckoutSettings to fold photo requirements into items.
   */
  photoRequired?: boolean;
}

export interface PhotoRequirement {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  exampleUrl?: string;
}

export type PreviewType = "checkin" | "checkout" | "storage_checkout";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function generateChecklistId(): string {
  return `item_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Normalize checklist items + photo requirements before saving:
 * - Drop entries with empty labels.
 * - Force required=true and category='general' (simplified enterprise model).
 */
export function normalizeChecklist(items: ChecklistItem[]): ChecklistItem[] {
  return items
    .filter((i) => i.label.trim())
    .map((i) => ({
      ...i,
      required: true,
      category: "general" as const,
      photoRequired: i.photoRequired === true,
    }));
}

export function normalizePhotos(photos: PhotoRequirement[]): PhotoRequirement[] {
  return photos.filter((p) => p.label.trim()).map((p) => ({ ...p, required: true }));
}

// ─── Checklist Item Row ──────────────────────────────────────────────────────

function ChecklistItemRow({
  item,
  onUpdate,
  onRemove,
}: {
  item: ChecklistItem;
  onUpdate: (updated: ChecklistItem) => void;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 p-2 rounded-lg border bg-background hover:border-border/80 transition-colors">
      <ClipboardCheck className="size-3.5 text-muted-foreground shrink-0" />
      <div className="flex-1 flex flex-col sm:flex-row gap-1 sm:gap-2">
        <Input
          value={item.label}
          onChange={(e) => onUpdate({ ...item, label: e.target.value })}
          placeholder="What should the chef confirm? (e.g. 'Wipe down all counters')"
          className="h-8 text-sm font-medium flex-1"
        />
        <Input
          value={item.description || ""}
          onChange={(e) =>
            onUpdate({ ...item, description: e.target.value || undefined })
          }
          placeholder="Optional hint"
          className="h-8 text-xs text-muted-foreground flex-1"
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

// ─── Photo Requirement Row ───────────────────────────────────────────────────

function PhotoRequirementRow({
  item,
  onUpdate,
  onRemove,
}: {
  item: PhotoRequirement;
  onUpdate: (updated: PhotoRequirement) => void;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 p-2 rounded-lg border bg-background hover:border-border/80 transition-colors">
      <Camera className="size-3.5 text-muted-foreground shrink-0" />
      <div className="flex-1 flex flex-col sm:flex-row gap-1 sm:gap-2">
        <Input
          value={item.label}
          onChange={(e) => onUpdate({ ...item, label: e.target.value })}
          placeholder="What photo? (e.g. 'Kitchen countertops')"
          className="h-8 text-sm font-medium flex-1"
        />
        <Input
          value={item.description || ""}
          onChange={(e) =>
            onUpdate({ ...item, description: e.target.value || undefined })
          }
          placeholder="Optional hint"
          className="h-8 text-xs text-muted-foreground flex-1"
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

// ─── Chef View Preview ────────────────────────────────────────────────────────

function ChefViewPreview({
  title,
  instructions,
  smartLockInstructions,
  items,
  photoRequirements,
  type,
}: {
  title: string;
  instructions: string | null;
  smartLockInstructions?: string | null;
  items: ChecklistItem[];
  photoRequirements: PhotoRequirement[];
  type: PreviewType;
}) {
  const filledItems = items.filter((i) => i.label.trim());
  const filledPhotos = photoRequirements.filter((p) => p.label.trim());

  return (
    <div className="space-y-3 max-h-[70vh] overflow-y-auto">
      {/* Mock chef-sheet header */}
      <div className="flex items-center gap-2 pb-2 border-b">
        <ChefHat className="h-5 w-5 text-primary" />
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-[11px] text-muted-foreground">
            This is exactly what chefs will see
          </p>
        </div>
      </div>

      {/* Manager instructions */}
      {instructions && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="text-xs text-blue-800 font-medium mb-1">
            Instructions from Manager
          </p>
          <p className="text-xs text-blue-700 whitespace-pre-line">{instructions}</p>
        </div>
      )}

      {/* Smart lock (check-in only) */}
      {type === "checkin" && smartLockInstructions && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Lock className="size-3.5 text-violet-600" />
            <p className="text-xs text-violet-800 font-medium">Smart Lock Access</p>
          </div>
          <p className="text-xs text-violet-700 whitespace-pre-line">
            {smartLockInstructions}
          </p>
          <div className="flex items-center gap-2 p-2 rounded-md bg-violet-100 border border-violet-300">
            <span className="text-lg font-mono font-bold text-violet-900 tracking-[0.2em]">
              A1B2C3
            </span>
            <span className="text-[10px] text-violet-600 ml-auto">(sample code)</span>
          </div>
        </div>
      )}

      {/* Checklist items */}
      {filledItems.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Checklist</Label>
          {filledItems.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-2.5 p-2 rounded-lg border bg-background"
            >
              <Checkbox disabled className="mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className="text-sm">
                  {item.label}
                  <span className="text-destructive ml-0.5">*</span>
                </span>
                {item.description && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {item.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Photo requirements — each with its own upload slot */}
      {filledPhotos.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium flex items-center gap-1.5">
            <Camera className="h-4 w-4" /> Photos Required
          </Label>
          {filledPhotos.map((req) => (
            <div key={req.id} className="space-y-1">
              <div>
                <p className="text-sm font-medium">
                  {req.label}
                  <span className="text-destructive ml-0.5">*</span>
                </p>
                {req.description && (
                  <p className="text-[11px] text-muted-foreground">{req.description}</p>
                )}
              </div>
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

      {/* Empty state */}
      {filledItems.length === 0 &&
        filledPhotos.length === 0 &&
        !instructions &&
        !smartLockInstructions && (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
            <Info className="size-5 mx-auto mb-2" />
            <p>No checklist items or photos configured yet.</p>
            <p className="text-xs mt-1">Add items to the left to see the chef view.</p>
          </div>
        )}

      {/* Mock submit button */}
      <Button disabled className="w-full mt-2" size="lg">
        {type === "checkin" ? (
          <LogIn className="h-4 w-4 mr-2" />
        ) : (
          <LogOut className="h-4 w-4 mr-2" />
        )}
        {type === "checkin" ? "Confirm Check-In" : "Submit Checkout"}
      </Button>
      <p className="text-[10px] text-center text-muted-foreground">
        Chef cannot submit until all items are checked and all photos are uploaded.
      </p>
    </div>
  );
}

// ─── Checklist Section Card ───────────────────────────────────────────────────

export interface ChecklistSectionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  iconColor: string;
  enabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  items: ChecklistItem[];
  onItemsChange: (items: ChecklistItem[]) => void;
  photoRequirements: PhotoRequirement[];
  onPhotoRequirementsChange: (items: PhotoRequirement[]) => void;
  instructions: string | null;
  onInstructionsChange: (val: string | null) => void;
  smartLockInstructions?: string | null;
  onSmartLockInstructionsChange?: (val: string | null) => void;
  type: "checkin" | "checkout";
  previewType: PreviewType;
}

export function ChecklistSection({
  title,
  description,
  icon,
  iconColor,
  enabled,
  onToggleEnabled,
  items,
  onItemsChange,
  photoRequirements,
  onPhotoRequirementsChange,
  instructions,
  onInstructionsChange,
  smartLockInstructions,
  onSmartLockInstructionsChange,
  type,
  previewType,
}: ChecklistSectionProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  const addItem = useCallback(() => {
    onItemsChange([
      ...items,
      {
        id: generateChecklistId(),
        label: "",
        description: undefined,
        required: true,
        category: "general",
      },
    ]);
  }, [items, onItemsChange]);

  const updateItem = useCallback(
    (index: number, updated: ChecklistItem) => {
      const next = [...items];
      next[index] = { ...updated, required: true, category: "general" };
      onItemsChange(next);
    },
    [items, onItemsChange],
  );

  const removeItem = useCallback(
    (index: number) => {
      onItemsChange(items.filter((_, i) => i !== index));
    },
    [items, onItemsChange],
  );

  const addPhotoReq = useCallback(() => {
    onPhotoRequirementsChange([
      ...photoRequirements,
      { id: generateChecklistId(), label: "", description: undefined, required: true },
    ]);
  }, [photoRequirements, onPhotoRequirementsChange]);

  const updatePhotoReq = useCallback(
    (index: number, updated: PhotoRequirement) => {
      const next = [...photoRequirements];
      next[index] = { ...updated, required: true };
      onPhotoRequirementsChange(next);
    },
    [photoRequirements, onPhotoRequirementsChange],
  );

  const removePhotoReq = useCallback(
    (index: number) => {
      onPhotoRequirementsChange(photoRequirements.filter((_, i) => i !== index));
    },
    [photoRequirements, onPhotoRequirementsChange],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={cn(
                "size-9 rounded-lg flex items-center justify-center shrink-0",
                iconColor,
              )}
            >
              {icon}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg truncate">{title}</CardTitle>
              <CardDescription className="truncate">{description}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {enabled && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setPreviewOpen(true)}
              >
                <Eye className="size-3.5 mr-1.5" />
                Preview
              </Button>
            )}
            <Switch
              id={`enable-${type}-${previewType}`}
              checked={enabled}
              onCheckedChange={onToggleEnabled}
              aria-label={`${enabled ? "Disable" : "Enable"} ${title}`}
            />
          </div>
        </div>
        {enabled && (items.length > 0 || photoRequirements.length > 0) && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge variant="outline" className="text-[10px]">
              {items.length} checklist item{items.length !== 1 ? "s" : ""}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {photoRequirements.length} photo{photoRequirements.length !== 1 ? "s" : ""}
            </Badge>
          </div>
        )}
      </CardHeader>

      {enabled && (
        <CardContent className="space-y-4">
          {/* Instructions */}
          <div>
            <Label
              htmlFor={`${type}-${previewType}-instructions`}
              className="text-sm font-medium"
            >
              Instructions for Chefs{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id={`${type}-${previewType}-instructions`}
              value={instructions || ""}
              onChange={(e) => onInstructionsChange(e.target.value || null)}
              placeholder={`General instructions shown to chefs before ${
                type === "checkin" ? "check-in" : "check-out"
              }...`}
              rows={2}
              className="mt-1.5"
            />
          </div>

          {/* Smart Lock Instructions (checkin only) */}
          {type === "checkin" && onSmartLockInstructionsChange && (
            <div className="p-3 rounded-lg border border-violet-200 bg-violet-50/50">
              <div className="flex items-center gap-2 mb-2">
                <Lock className="size-4 text-violet-600" />
                <Label
                  htmlFor={`smart-lock-instructions-${previewType}`}
                  className="text-sm font-medium text-violet-900"
                >
                  Smart Lock Instructions{" "}
                  <span className="text-violet-500 font-normal">(optional)</span>
                </Label>
              </div>
              <Textarea
                id={`smart-lock-instructions-${previewType}`}
                value={smartLockInstructions || ""}
                onChange={(e) => onSmartLockInstructionsChange(e.target.value || null)}
                placeholder="e.g. 'Enter the 6-digit access code on the keypad next to the front door'"
                rows={2}
                className="border-violet-200 bg-white"
              />
            </div>
          )}

          {/* Checklist Items — always visible */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ClipboardCheck className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">Checklist</span>
              <span className="text-xs text-muted-foreground">
                — chefs must check each item before submitting
              </span>
            </div>
            <div className="space-y-1.5">
              {items.length === 0 && (
                <div className="text-center py-4 text-xs text-muted-foreground border border-dashed rounded-lg">
                  No items yet. Click below to add the first one.
                </div>
              )}
              {items.map((item, index) => (
                <ChecklistItemRow
                  key={item.id}
                  item={item}
                  onUpdate={(updated) => updateItem(index, updated)}
                  onRemove={() => removeItem(index)}
                />
              ))}
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
          </div>

          {/* Photo Requirements — always visible */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Camera className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">Photos Required</span>
              <span className="text-xs text-muted-foreground">
                — chefs must upload one photo per item
              </span>
            </div>
            <div className="space-y-1.5">
              {photoRequirements.length === 0 && (
                <div className="text-center py-4 text-xs text-muted-foreground border border-dashed rounded-lg">
                  No photos required yet. Click below to add the first one.
                </div>
              )}
              {photoRequirements.map((item, index) => (
                <PhotoRequirementRow
                  key={item.id}
                  item={item}
                  onUpdate={(updated) => updatePhotoReq(index, updated)}
                  onRemove={() => removePhotoReq(index)}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addPhotoReq}
                className="w-full h-8 text-xs"
              >
                <Plus className="size-3.5 mr-1.5" />
                Add Photo Requirement
              </Button>
            </div>
          </div>
        </CardContent>
      )}

      {/* Preview Dialog — shows chef view */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              Chef View Preview
            </DialogTitle>
            <DialogDescription>
              Exactly what chefs see during {title.toLowerCase()}. Updates as you edit.
            </DialogDescription>
          </DialogHeader>
          <ChefViewPreview
            title={title}
            instructions={instructions}
            smartLockInstructions={smartLockInstructions}
            items={items}
            photoRequirements={photoRequirements}
            type={previewType}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
