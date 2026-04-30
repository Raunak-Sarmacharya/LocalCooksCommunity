/**
 * Storage Check-In Dialog
 *
 * Chef-initiated move-in inspection for storage bookings with photo
 * documentation. Symmetric with `StorageCheckoutDialog` — establishes the
 * baseline for any future damage claim filed at checkout (Turo/Airbnb model).
 *
 * Flow:
 *   1. Chef opens dialog from ChefBookingsView dropdown ("Check In")
 *   2. Chef completes checklist + uploads manager-defined photos
 *   3. Check-in is auto-approved — no manager review required
 *   4. Check-in photos are auto-linked as `photo_before` evidence if a
 *      damage claim is ever filed at checkout.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LogIn, Camera } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useLocationChecklist,
  type ChecklistItem,
  type PhotoRequirement,
} from "@/hooks/use-location-checklist";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  PhotoRequirementUploader,
  flattenPhotos,
  areAllRequiredPhotosUploaded,
} from "./PhotoRequirementUploader";

interface StorageCheckinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storageBooking: {
    id: number;
    storageName?: string;
    storageType?: string;
    startDate: string;
    checkinStatus?: string;
    locationId?: number;
  };
  onSuccess?: () => void;
}

export function StorageCheckinDialog({
  open,
  onOpenChange,
  storageBooking,
  onSuccess,
}: StorageCheckinDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [checkinNotes, setCheckinNotes] = useState("");
  // Photos keyed by requirement id (or __generic__ for fallback)
  const [uploadedPhotos, setUploadedPhotos] = useState<Record<string, string[]>>(
    {},
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  // Fetch manager-defined check-in checklist for the storage unit's location.
  const { data: checklist } = useLocationChecklist(storageBooking.locationId);
  const storageCheckinItems: ChecklistItem[] =
    checklist?.storageCheckinItems || [];
  const storageCheckinPhotoReqs: PhotoRequirement[] =
    checklist?.storageCheckinPhotoRequirements || [];

  // All manager-defined items are required by design, matching checkout.
  const allItemsChecked = storageCheckinItems.every((i: ChecklistItem) =>
    checkedItems.has(i.id),
  );
  const allPhotosUploaded = areAllRequiredPhotosUploaded(
    storageCheckinPhotoReqs,
    uploadedPhotos,
  );

  const isAlreadySubmitted = storageBooking.checkinStatus === "checkin_completed";

  const handleSubmitCheckin = async () => {
    if (!allPhotosUploaded) {
      toast({
        title: "Photos required",
        description:
          storageCheckinPhotoReqs.length > 0
            ? "Please upload a photo for each required item"
            : "Please upload at least one photo documenting the move-in condition",
        variant: "destructive",
      });
      return;
    }
    if (!allItemsChecked) {
      toast({
        title: "Checklist incomplete",
        description: "Please complete all checklist items",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Not authenticated");
      }

      // Build checklist audit trail from checked items
      const checkinChecklistItems = storageCheckinItems.map(
        (i: ChecklistItem) => ({
          id: i.id,
          label: i.label,
          checked: checkedItems.has(i.id),
        }),
      );

      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch(
        `/api/chef/storage-bookings/${storageBooking.id}/checkin`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            checkinNotes: checkinNotes.trim() || undefined,
            checkinPhotoUrls: flattenPhotos(uploadedPhotos),
            checkinChecklistItems:
              checkinChecklistItems.length > 0
                ? checkinChecklistItems
                : undefined,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || "Failed to complete check-in",
        );
      }

      toast({
        title: "Check-in completed",
        description:
          "Your move-in inspection is recorded. This establishes the baseline for any future claim.",
      });

      // Invalidate queries to refresh data (covers both chef + manager views)
      queryClient.invalidateQueries({ queryKey: ["/api/chef/storage-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chef/bookings"] });
      queryClient.invalidateQueries({ queryKey: ["storageBookings"] });

      // Reset form
      setCheckinNotes("");
      setUploadedPhotos({});
      setCheckedItems(new Set());
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast({
        title: "Check-in failed",
        description:
          error instanceof Error ? error.message : "Failed to submit check-in",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5 text-emerald-600" />
            Storage Check-In
          </SheetTitle>
          <SheetDescription>
            Document the move-in condition of your storage unit. These photos
            become the baseline for any damage claim at checkout.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {/* Storage Info */}
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-sm font-medium">
              {storageBooking.storageName || "Storage Unit"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Start Date: {new Date(storageBooking.startDate).toLocaleDateString()}
            </div>
            {storageBooking.storageType && (
              <Badge variant="outline" className="mt-2 text-xs">
                {storageBooking.storageType}
              </Badge>
            )}
          </div>

          {/* Already submitted status */}
          {isAlreadySubmitted && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex items-start gap-2">
                <LogIn className="h-4 w-4 text-emerald-600 mt-0.5" />
                <div className="text-xs text-emerald-800">
                  <strong>Check-in completed.</strong> Your move-in baseline
                  is recorded.
                </div>
              </div>
            </div>
          )}

          {!isAlreadySubmitted && (
            <>
              {/* Manager Instructions */}
              {checklist?.storageCheckinInstructions && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <p className="text-xs text-blue-800 font-medium mb-1">
                    Instructions from Manager
                  </p>
                  <p className="text-xs text-blue-700 whitespace-pre-line">
                    {checklist.storageCheckinInstructions}
                  </p>
                </div>
              )}

              {/* Checklist Items */}
              {storageCheckinItems.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Check-In Checklist
                  </Label>
                  {storageCheckinItems.map((item: ChecklistItem, index: number) => (
                    <label
                      key={item.id}
                      className="flex items-start gap-2.5 p-2 rounded-lg border bg-background hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={checkedItems.has(item.id)}
                        onCheckedChange={(checked) => {
                          setCheckedItems((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          });
                        }}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm">
                          <span className="tabular-nums font-medium text-muted-foreground mr-1.5">{index + 1}.</span>
                          {item.label}
                          {item.required && (
                            <span className="text-destructive ml-0.5">*</span>
                          )}
                        </span>
                        {item.description && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}

              {/* Per-requirement photo uploader */}
              <PhotoRequirementUploader
                requirements={storageCheckinPhotoReqs}
                photos={uploadedPhotos}
                onPhotosChange={setUploadedPhotos}
                uploadFolder="checkin-photos"
                genericInstruction="Upload photos documenting the move-in condition of the storage unit. These establish the baseline for any damage claim at checkout."
                disabled={isSubmitting}
              />

              {/* Notes Section */}
              <div className="space-y-2">
                <Label htmlFor="checkin-notes">Notes (optional)</Label>
                <Textarea
                  id="checkin-notes"
                  placeholder="Note any pre-existing wear or concerns for the manager..."
                  value={checkinNotes}
                  onChange={(e) => setCheckinNotes(e.target.value)}
                  rows={2}
                />
              </div>

              {/* Info Box */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <Camera className="h-4 w-4 text-emerald-600 mt-0.5" />
                  <div className="text-xs text-emerald-800">
                    <strong>Why this matters</strong>
                    <ul className="mt-1 space-y-1 list-disc list-inside">
                      <li>Your photos are the baseline for any future claim</li>
                      <li>
                        Auto-linked as <em>photo_before</em> evidence if
                        damage is claimed at checkout
                      </li>
                      <li>Protects you from being charged for prior damage</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isAlreadySubmitted ? "Close" : "Cancel"}
          </Button>
          {!isAlreadySubmitted && (
            <Button
              onClick={handleSubmitCheckin}
              disabled={isSubmitting || !allPhotosUploaded || !allItemsChecked}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4 mr-2" />
                  Complete Check-In
                </>
              )}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
