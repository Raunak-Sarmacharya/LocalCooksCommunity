import { useCallback, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import type { KitchenReadinessReview } from "@shared/kitchen-listing-readiness";
import { mt } from "@/i18n/manager";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export function useListingImpactConfirm() {
  const [message, setMessage] = useState<{ title: string; body: string } | null>(null);
  const resolve = useRef<((confirmed: boolean) => void) | null>(null);
  const finish = useCallback((confirmed: boolean) => {
    resolve.current?.(confirmed);
    resolve.current = null;
    setMessage(null);
  }, []);
  const confirm = useCallback(async (kitchenId: number, willRemoveRequirement: boolean) => {
    if (!willRemoveRequirement) return true;
    const review = await apiGet(`/manager/kitchens/${kitchenId}/listing-readiness`) as KitchenReadinessReview;
    if (review.listingStatus !== "active") return true;
    return new Promise<boolean>((done) => {
      resolve.current = done;
      setMessage({ title: mt("listingImpactKitchenTitle", { kitchen: review.details.kitchenName }), body: mt("listingImpactKitchenBody") });
    });
  }, []);
  const confirmLocation = useCallback(async (locationId: number, willRemoveRequirement: boolean) => {
    if (!willRemoveRequirement) return true;
    const kitchens = await apiGet(`/manager/kitchens/${locationId}`) as Array<{ listingStatus: string }>;
    const count = kitchens.filter((kitchen) => kitchen.listingStatus === "active").length;
    if (!count) return true;
    return new Promise<boolean>((done) => {
      resolve.current = done;
      setMessage({ title: mt(count === 1 ? "listingImpactLocationOneTitle" : "listingImpactLocationManyTitle", { count }),
        body: mt(count === 1 ? "listingImpactLocationOneBody" : "listingImpactLocationManyBody") });
    });
  }, []);
  const dialog = <AlertDialog open={message !== null} onOpenChange={(open) => { if (!open) finish(false); }}>
    <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{message?.title}</AlertDialogTitle>
      <AlertDialogDescription>{message?.body}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel onClick={() => finish(false)}>{mt("listingImpactKeepEditing")}</AlertDialogCancel>
        <AlertDialogAction className="bg-transparent text-destructive shadow-none hover:bg-destructive/5 hover:text-destructive" onClick={() => finish(true)}>{mt("listingImpactConfirm")}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
  return { confirm, confirmLocation, dialog };
}
