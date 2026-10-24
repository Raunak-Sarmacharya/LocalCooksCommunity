import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "@/components/ui/manager-icons";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { invalidateKitchenListingState } from "@/lib/manager-kitchens-navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Delete (or archive, when it has bookings) one kitchen, after the server says what that would touch. */
export function DeleteKitchenDialog({ kitchen, locationId, open, onOpenChange }: {
  kitchen: { id: number; name: string };
  locationId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteImpact, setDeleteImpact] = useState<{ bookings: number; blocked: boolean; message: string | null; willArchive: boolean } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Ask the server what this delete would actually destroy, so the confirmation
  // can name the real number instead of warning in the abstract.
  useEffect(() => {
    if (!open) {
      setDeleteImpact(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) throw new Error(tt("notAuthenticated"));
        const token = await currentFirebaseUser.getIdToken();

        const response = await fetch(`/api/manager/kitchens/${kitchen.id}/delete-impact`, {
          headers: { 'Authorization': `Bearer ${token}` },
          credentials: 'include',
        });
        if (!response.ok) throw new Error('delete-impact-unavailable');

        const data = await response.json();
        if (!cancelled) setDeleteImpact({
          bookings: Number(data.bookings ?? 0),
          blocked: Boolean(data.blocked),
          message: typeof data.message === 'string' ? data.message : null,
          willArchive: Boolean(data.willArchive),
        });
      } catch (error) {
        logger.error('Kitchen delete impact error:', error);
        if (!cancelled) setDeleteImpact(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, kitchen.id]);

  const handleDeleteKitchen = async () => {
    setIsDeleting(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) throw new Error(tt("notAuthenticated"));
      const token = await currentFirebaseUser.getIdToken();

      const response = await fetch(`/api/manager/kitchens/${kitchen.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || tt("failedToDeleteKitchen"));
      }

      const result = await response.json().catch(() => ({}));
      invalidateKitchenListingState(queryClient, kitchen.id, locationId);
      onOpenChange(false);
      toast(result.archived
        ? { title: mt("kitchenArchivedTitle"), description: mt("kitchenArchivedDescription") }
        : { title: mt("kitchenDeleted"), description: mt("kitchenHasBeenSuccessfullyRemoved") });
    } catch (error: any) {
      logger.error('Kitchen delete error:', error);
      toast({ title: mt("error"), description: error.message, variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const deleteBlocked = deleteImpact?.blocked === true;
  const deleteWarning = deleteBlocked
    ? deleteImpact?.message ?? ""
    : deleteImpact === null
      ? mt("deleteKitchenWarningUnknown")
      : deleteImpact.willArchive
        ? mt("deleteKitchenWarningBookings", { count: deleteImpact.bookings })
        : mt("deleteKitchenWarningNoBookings");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {deleteBlocked
              ? mt("deleteKitchenBlockedTitle", { name: kitchen.name })
              : mt("deleteKitchenTitle", { name: kitchen.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>{deleteWarning}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{mt("cancel")}</AlertDialogCancel>
          {!deleteBlocked && (
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteKitchen();
              }}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {deleteImpact?.willArchive ? mt("deleteKitchenArchive") : mt("deleteKitchen")}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
