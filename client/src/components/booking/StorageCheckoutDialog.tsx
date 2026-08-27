/**
 * Storage Checkout Dialog
 * 
 * Chef-initiated checkout for storage bookings with photo documentation.
 * Part of the hybrid verification system:
 * 1. Chef initiates checkout (this component)
 * 2. Chef uploads photos of empty storage
 * 3. Manager verifies and approves
 * 4. Prevents unwarranted overstay penalties
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle, Clock, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocationChecklist, type ChecklistItem, type PhotoRequirement } from "@/hooks/use-location-checklist";
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

interface StorageCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storageBooking: {
    id: number;
    storageName?: string;
    storageType?: string;
    endDate: string;
    checkoutStatus?: string;
    locationId?: number;
  };
  onSuccess?: () => void;
}

export function StorageCheckoutDialog({
  open,
  onOpenChange,
  storageBooking,
  onSuccess,
}: StorageCheckoutDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t: tStrict } = useTranslation("chef");
  const t = tStrict as unknown as (key: string, options?: Record<string, unknown>) => string;
  const [checkoutNotes, setCheckoutNotes] = useState("");
  // Photos keyed by requirement id (or __generic__ for fallback)
  const [uploadedPhotos, setUploadedPhotos] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  // Fetch manager-defined checklist for storage checkout
  const { data: checklist } = useLocationChecklist(storageBooking.locationId);
  const storageCheckoutItems: ChecklistItem[] = checklist?.storageCheckoutItems || [];
  const storageCheckoutPhotoReqs: PhotoRequirement[] = checklist?.storageCheckoutPhotoRequirements || [];
  // All items are required by design.
  const allItemsChecked = storageCheckoutItems.every((i: ChecklistItem) => checkedItems.has(i.id));
  const allPhotosUploaded = areAllRequiredPhotosUploaded(storageCheckoutPhotoReqs, uploadedPhotos);

  const handleSubmitCheckout = async () => {
    if (!allPhotosUploaded) {
      toast({
        title: t("coPhotosRequired"),
        description: storageCheckoutPhotoReqs.length > 0
          ? t("ciPhotoEachItem")
          : t("coPhotoEmptyUnit"),
        variant: "destructive",
      });
      return;
    }
    if (!allItemsChecked) {
      toast({
        title: t("ciChecklistIncomplete"),
        description: t("ciChecklistBody"),
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error(t("bkNotAuthenticated"));
      }

      // Build checklist audit trail from checked items
      const checkoutChecklistItems = storageCheckoutItems.map((i: ChecklistItem) => ({
        id: i.id,
        label: i.label,
        checked: checkedItems.has(i.id),
      }))

      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch(`/api/chef/storage-bookings/${storageBooking.id}/request-checkout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          checkoutNotes: checkoutNotes.trim() || undefined,
          checkoutPhotoUrls: flattenPhotos(uploadedPhotos),
          checkoutChecklistItems: checkoutChecklistItems.length > 0 ? checkoutChecklistItems : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit checkout request');
      }

      toast({
        title: t("coSubmittedToast"),
        description: t("coSubmittedDesc"),
      });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/chef/storage-bookings'] });

      // Reset form
      setCheckoutNotes("");
      setUploadedPhotos({});
      setCheckedItems(new Set());
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast({
        title: t("coFailedToast"),
        description: error instanceof Error ? error.message : t("coFailedBody"),
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
            <CheckCircle className="h-5 w-5 text-muted-foreground" />
            {t("coDialogTitle")}
          </SheetTitle>
          <SheetDescription>
            {t("coDialogDesc")}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {/* Storage Info */}
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-sm font-medium">{storageBooking.storageName || t("sxDefaultUnitName")}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {t("coEndDate")} {new Date(storageBooking.endDate).toLocaleDateString()}
            </div>
            {storageBooking.storageType && (
              <Badge variant="outline" className="mt-2 text-xs">
                {storageBooking.storageType}
              </Badge>
            )}
          </div>

          {/* Manager Instructions */}
          {checklist?.storageCheckoutInstructions && (
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium mb-1">{t("ciManagerInstructions")}</p>
              <p className="text-xs text-muted-foreground whitespace-pre-line">{checklist.storageCheckoutInstructions}</p>
            </div>
          )}

          {/* Checklist Items */}
          {storageCheckoutItems.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("coChecklistLabel")}</Label>
              {storageCheckoutItems.map((item: ChecklistItem, index: number) => (
                <label key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg border bg-background hover:bg-muted/50 cursor-pointer transition-colors">
                  <Checkbox
                    checked={checkedItems.has(item.id)}
                    onCheckedChange={(checked) => {
                      setCheckedItems(prev => {
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
                      {item.required && <span className="text-destructive ml-0.5">*</span>}
                    </span>
                    {item.description && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{item.description}</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Per-requirement photo uploader */}
          <PhotoRequirementUploader
            requirements={storageCheckoutPhotoReqs}
            photos={uploadedPhotos}
            onPhotosChange={setUploadedPhotos}
            uploadFolder="checkout-photos"
            genericInstruction={t("coGenericInstruction")}
            disabled={isSubmitting}
          />

          {/* Notes Section */}
          <div className="space-y-2">
            <Label htmlFor="checkout-notes">{t("ciNotesLabel")}</Label>
            <Textarea
              id="checkout-notes"
              placeholder={t("coNotesPlaceholder")}
              value={checkoutNotes}
              onChange={(e) => setCheckoutNotes(e.target.value)}
              rows={2}
            />
          </div>

          {/* Info Box */}
          <StorageCheckoutInfo />
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("bkCommonCancel")}
          </Button>
          <Button
            onClick={handleSubmitCheckout}
            disabled={isSubmitting || !allPhotosUploaded || !allItemsChecked}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("ciSubmitting")}
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                {t("coSubmitBtn")}
              </>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// Collapsible info: hidden behind an info icon to reduce clutter
function StorageCheckoutInfo() {
  const [open, setOpen] = useState(false);
  const { t: tStrict } = useTranslation("chef");
  const t = tStrict as unknown as (key: string) => string;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <Info className="h-3.5 w-3.5" />
        <span>{t("coWhatsNext")}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-lg border p-3 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>{t("coNextReview")}</li>
              <li>{t("coNextComplete")}</li>
              <li>{t("coNextAutoClear")}</li>
              <li>{t("coNextNoPenalty")}</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
