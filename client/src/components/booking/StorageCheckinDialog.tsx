import { ct } from '@/i18n/chef-ns';
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

import { useState, useEffect } from "react";
import { storageDay } from "@/lib/storage-rentals";
import { useTranslation, Trans } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LogIn, Camera } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type ChecklistItem, type PhotoRequirement } from "@/hooks/use-location-checklist";
import { tickTasks } from '@shared/visit-duties';
import { useStorageDuties } from '@/hooks/use-storage-duties';
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from "@/components/ui/app-dialog";
import { Badge } from "@/components/ui/badge";
import { PhotoRequirementUploader, flattenPhotos, areAllRequiredPhotosUploaded } from "./PhotoRequirementUploader";

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
  const { t: tStrict, i18n } = useTranslation("chef");
  const t = tStrict as unknown as (key: string, options?: Record<string, unknown>) => string;
  const [checkinNotes, setCheckinNotes] = useState("");
  // Photos keyed by requirement id (or __generic__ for fallback)
  const [uploadedPhotos, setUploadedPhotos] = useState<Record<string, string[]>>(
    {},
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  useEffect(() => { setCheckinNotes(''); setUploadedPhotos({}); setCheckedItems(new Set()); }, [storageBooking.id]);

  // Fetch manager-defined check-in checklist for the storage unit's location.
  const dutiesQuery = useStorageDuties(storageBooking.id, open);
  const section = dutiesQuery.data?.arrival;
  const storageCheckinItems: ChecklistItem[] =
    section?.enabled ? section.items as ChecklistItem[] : [];
  const storageCheckinPhotoReqs: PhotoRequirement[] =
    section?.enabled ? section.photos as PhotoRequirement[] : [];

  // A task with a photo slot is done by its photo, so only the rest get a tick box.
  const ticks = tickTasks(storageCheckinItems, storageCheckinPhotoReqs);
  // Only configured mandatory items block submission.
  const allItemsChecked = ticks.every(i => i.required === false || checkedItems.has(i.id));
  // One count for everything left: unticked tasks plus required photo slots still empty.
  const remaining = ticks.filter(i => i.required !== false && !checkedItems.has(i.id)).length
    + storageCheckinPhotoReqs.filter(photo => photo.required !== false && !uploadedPhotos[photo.id]?.some(Boolean)).length;
  const allPhotosUploaded = areAllRequiredPhotosUploaded(
    storageCheckinPhotoReqs,
    uploadedPhotos,
  );

  const isAlreadySubmitted = storageBooking.checkinStatus === "checkin_completed";

  const handleSubmitCheckin = async () => {
    if (!allPhotosUploaded) {
      toast({
        title: t("ciPhotosRequired"),
        description:
          storageCheckinPhotoReqs.length > 0
            ? t("ciPhotoEachItem")
            : t("ciPhotoAtLeastOne"),
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
      const checkinChecklistItems = storageCheckinItems.map(
        (i: ChecklistItem) => ({
          id: i.id,
          label: i.label,
          checked: checkedItems.has(i.id) || !!uploadedPhotos[i.id]?.some(Boolean),
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
          errorData.error || t("ciFailedBody"),
        );
      }

      toast({
        title: t("ciCompletedToast"),
        description: t("ciCompletedDesc"),
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
        title: t("ciFailedToast"),
        description:
          error instanceof Error ? error.message : t("ciFailedBody"),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <AppDialogHeader icon={<LogIn className="h-4 w-4" />} title={t("ciDialogTitle")} description={t("ciDialogDesc")} />
        <AppDialogBody className="space-y-4">
        {dutiesQuery.isPending && <p role="status">{ct('sweepLabel24')}</p>}
        {dutiesQuery.error && <p role="alert">{ct('sweepLabel26')}{' '}<Button variant="link" onClick={() => void dutiesQuery.refetch()}>{ct('sweepLabel27')}</Button>{' '}{ct('sweepLabel28')}</p>}
          {/* Storage Info */}
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-sm font-medium">
              {storageBooking.storageName || t("sxDefaultUnitName")}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {t("ciStartDate")} {storageDay(storageBooking.startDate.slice(0, 10), i18n.language, true)}
            </div>
            {storageBooking.storageType && (
              <Badge variant="outline" className="mt-2 text-xs">
                {storageBooking.storageType}
              </Badge>
            )}
          </div>

          {/* Already submitted status */}
          {isAlreadySubmitted && (
            <div className="rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <LogIn className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="text-xs text-muted-foreground">
                  <strong className="text-foreground">{t("ciAlreadyDone")}</strong>{t("ciAlreadyDoneBody")}
                </div>
              </div>
            </div>
          )}

          {!isAlreadySubmitted && (
            <>
              {/* Manager Instructions */}
              {section?.instructions && (
                <div className="rounded-lg border p-3">
                  <p className="text-xs font-medium mb-1">
                    {t("ciManagerInstructions")}
                  </p>
                  <p className="text-xs text-muted-foreground whitespace-pre-line">
                    {section.instructions}
                  </p>
                </div>
              )}

              {/* Checklist Items */}
              {ticks.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    {t("ciChecklistLabel")}
                  </Label>
                  {ticks.map((item: ChecklistItem, index: number) => (
                    <label
                      key={item.id}
                      className="flex min-h-11 items-start gap-3 rounded-xl border bg-background p-3 cursor-pointer hover:bg-muted/50 motion-safe:transition-colors"
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
                          {item.required === false && <span className="ml-2 text-xs text-muted-foreground">{t("kciOptional")}</span>}
                        </span>
                        {item.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">
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
                genericInstruction={t("ciGenericInstruction")}
                disabled={isSubmitting}
              />

              {/* Notes Section */}
              <div className="space-y-2">
                <Label htmlFor="checkin-notes">{t("ciNotesLabel")}</Label>
                <Textarea
                  id="checkin-notes"
                  placeholder={t("ciNotesPlaceholder")}
                  value={checkinNotes}
                  onChange={(e) => setCheckinNotes(e.target.value)}
                  rows={2}
                />
              </div>

              {/* Info Box */}
              <div className="rounded-lg border p-3">
                <div className="flex items-start gap-2">
                  <Camera className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="text-xs text-muted-foreground">
                    <strong className="text-foreground">{t("ciWhyMatters")}</strong>
                    <ul className="mt-1 space-y-1 list-disc list-inside">
                      <li>{t("ciWhyBaseline")}</li>
                      <li>
                        <Trans
                          i18nKey="ciWhyAutoLinked"
                          ns="chef"
                          components={{ em: <em /> }}
                        />
                      </li>
                      <li>{t("ciWhyProtects")}</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </AppDialogBody>

        <AppDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isAlreadySubmitted ? t("ciClose") : t("bkCommonCancel")}
          </Button>
          {!isAlreadySubmitted && (
            <Button
              onClick={handleSubmitCheckin}
              disabled={isSubmitting || !dutiesQuery.data || !allPhotosUploaded || !allItemsChecked}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("ciSubmitting")}
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4 mr-2" />
                  {t("ciCompleteBtn")}
                </>
              )}
            </Button>
          )}
          {remaining > 0 && <p role="status" className="self-center text-sm text-muted-foreground sm:order-first sm:mr-auto">{t("kciCompleteRequiredTasks", { count: remaining })}</p>}
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
