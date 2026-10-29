import { ct } from '@/i18n/chef-ns';
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

import { useState, useEffect } from "react";
import { storageDay } from "@/lib/storage-rentals";
import { localToday } from "@shared/storage-rental";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle, Clock, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type ChecklistItem, type PhotoRequirement } from "@/hooks/use-location-checklist";
import { auth } from "@/lib/firebase";
import { tickTasks } from '@shared/visit-duties';
import { useStorageDuties } from '@/hooks/use-storage-duties';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from "@/components/ui/app-dialog";
import { Badge } from "@/components/ui/badge";
import { PhotoRequirementUploader, flattenPhotos, areAllRequiredPhotosUploaded } from "./PhotoRequirementUploader";

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
  const { t: tStrict, i18n } = useTranslation("chef");
  const t = tStrict as unknown as (key: string, options?: Record<string, unknown>) => string;
  const [checkoutNotes, setCheckoutNotes] = useState("");
  // Photos keyed by requirement id (or __generic__ for fallback)
  const [uploadedPhotos, setUploadedPhotos] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  useEffect(() => { setCheckoutNotes(''); setUploadedPhotos({}); setCheckedItems(new Set()); }, [storageBooking.id]);

  // Fetch manager-defined checklist for storage checkout
  const dutiesQuery = useStorageDuties(storageBooking.id, open);
  const section = dutiesQuery.data?.departure;
  const storageCheckoutItems: ChecklistItem[] = section ? section.enabled ? section.items as ChecklistItem[] : [] : [];
  const storageCheckoutPhotoReqs: PhotoRequirement[] = section?.enabled ? section.photos as PhotoRequirement[] : [];
  // A task with a photo slot is done by its photo, so only the rest get a tick box.
  const ticks = tickTasks(storageCheckoutItems, storageCheckoutPhotoReqs);
  // Only configured mandatory items block submission.
  const allItemsChecked = ticks.every(i => i.required === false || checkedItems.has(i.id));
  // One count for everything left: unticked tasks plus required photo slots still empty.
  const remaining = ticks.filter(i => i.required !== false && !checkedItems.has(i.id)).length
    + storageCheckoutPhotoReqs.filter(photo => photo.required !== false && !uploadedPhotos[photo.id]?.some(Boolean)).length;
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
        checked: checkedItems.has(i.id) || !!uploadedPhotos[i.id]?.some(Boolean),
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
        throw new Error(errorData.error || ct('sweepText26'));
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <AppDialogHeader icon={<CheckCircle className="h-4 w-4" />} title={t("coDialogTitle")} description={t("coDialogDesc")} />
        <AppDialogBody className="space-y-4">
        {dutiesQuery.isPending && <p role="status">{ct('sweepLabel25')}</p>}
        {dutiesQuery.error && <p role="alert">{ct('sweepLabel26')}{' '}<Button variant="link" onClick={() => void dutiesQuery.refetch()}>{ct('sweepLabel27')}</Button>{' '}{ct('sweepLabel28')}</p>}
          {/* Storage Info */}
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-sm font-medium">{storageBooking.storageName || t("sxDefaultUnitName")}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {t("coEndDate")} {storageDay(storageBooking.endDate.slice(0, 10), i18n.language, true)}
            </div>
            {/* Leaving before the paid end: the existing rule (unused days aren't refunded), said where the chef decides. */}
            {storageBooking.endDate.slice(0, 10) > localToday(new Date(), "America/St_Johns") && <div className="mt-1 text-xs text-muted-foreground">{t("coEarlyNoRefund")}</div>}
            {storageBooking.storageType && (
              <Badge variant="outline" className="mt-2 text-xs">
                {storageBooking.storageType}
              </Badge>
            )}
          </div>

          {/* Manager Instructions */}
          {section?.instructions && (
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium mb-1">{t("ciManagerInstructions")}</p>
              <p className="text-xs text-muted-foreground whitespace-pre-line">{section.instructions}</p>
            </div>
          )}

          {/* Checklist Items */}
          {ticks.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("coMoveOutChecklist")}</Label>
              {ticks.map((item: ChecklistItem, index: number) => (
                <label key={item.id} className="flex min-h-11 items-start gap-3 rounded-xl border bg-background p-3 cursor-pointer hover:bg-muted/50 motion-safe:transition-colors">
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
                      {item.required === false && <span className="ml-2 text-xs text-muted-foreground">{t("kciOptional")}</span>}
                    </span>
                    {item.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
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
        </AppDialogBody>

        <AppDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("bkCommonCancel")}
          </Button>
          <Button
            onClick={handleSubmitCheckout}
            disabled={isSubmitting || !dutiesQuery.data || !allPhotosUploaded || !allItemsChecked}
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
          {remaining > 0 && <p role="status" className="self-center text-sm text-muted-foreground sm:order-first sm:mr-auto">{t("kciCompleteRequiredTasks", { count: remaining })}</p>}
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
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
