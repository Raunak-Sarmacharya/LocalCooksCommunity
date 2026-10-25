import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronLeft, Copy, ExternalLink, EyeOff, Loader2, MoreHorizontal, Plus, Trash2 } from "@/components/ui/manager-icons";
import { KitchenIcon } from "@/components/ui/kitchen-icon";
import { useStatusButton } from "@/hooks/use-status-button";
import { useToast } from "@/hooks/use-toast";
import { apiPost } from "@/lib/api";
import { invalidateKitchenListingState } from "@/lib/manager-kitchens-navigation";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/resolve-image-url";
import { mt } from "@/i18n/manager";
import type { KitchenReadinessReview } from "@shared/kitchen-listing-readiness";
import { DeleteKitchenDialog } from "./DeleteKitchenDialog";
import { KitchenFactsLine, ListingPill, type KitchenFacts } from "./KitchenCards";

interface KitchenEditorHeaderProps {
  kitchen: { id: number; name: string; imageUrl?: string | null; listingStatus?: "draft" | "active"; isActive?: boolean };
  locationId: number;
  locationName: string;
  review?: KitchenReadinessReview;
  facts?: KitchenFacts;
  timezone?: string;
  /** Shown when the location has several kitchens. */
  onAllKitchens?: () => void;
  onList: () => void;
  onAddKitchen: () => void;
  onOpenRequests: () => void;
  onShare?: () => void;
  onViewListing?: () => void;
  /** Save, while the open section has unsaved edits. */
  saveAction?: ReactNode;
}

const ICON_BUTTON = "!min-h-0 h-9 rounded-full";

/** Which kitchen this is, whether customers can book it, what's coming up, and the actions that belong to it. */
export function KitchenEditorHeader({ kitchen, locationId, locationName, review, facts, timezone, onAllKitchens, onList, onAddKitchen, onOpenRequests, onShare, onViewListing, saveAction }: KitchenEditorHeaderProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmTakeDown, setConfirmTakeDown] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const listed = (review?.listingStatus ?? kitchen.listingStatus) === "active";
  const hidden = review?.adminHidden === true;
  const canPublish = review?.checklist?.canPublish === true;
  // Booking facts mean nothing before a kitchen can take bookings (the cards hide them too); a taken-down kitchen
  // with bookings or requests still shows them.
  const showFacts = Boolean(facts && (listed || facts.nextBooking || facts.pendingRequests > 0));

  const takeDown = useStatusButton(async () => {
    try {
      await apiPost(`/manager/kitchens/${kitchen.id}/listing-status`, { status: "draft" });
      invalidateKitchenListingState(queryClient, kitchen.id, locationId);
      toast({ title: mt("listingStatusTakenDown"), description: mt("listingStatusTakenDownDesc") });
    } catch (error) {
      toast({ title: mt("listingStatusPublishFailed"), description: error instanceof Error ? error.message : mt("listingStatusPublishFailedDesc"), variant: "destructive" });
      throw error;
    }
  });

  return (
    <header className="space-y-4">
      {onAllKitchens && (
        <button type="button" onClick={onAllKitchens}
          className="-ml-1 inline-flex !min-h-0 items-center gap-1 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronLeft className="size-4" aria-hidden="true" />{mt("ksAllKitchens")}
        </button>
      )}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl bg-muted ring-1 ring-black/5 sm:h-[4.5rem] sm:w-24">
            {kitchen.imageUrl
              ? <img src={resolveImageUrl(kitchen.imageUrl) ?? ""} alt="" className="size-full object-cover" />
              : <span className="flex size-full items-center justify-center text-muted-foreground"><KitchenIcon className="size-6" /></span>}
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{kitchen.name}</h1>
              <ListingPill listed={listed} hidden={hidden} />
            </div>
            <p className="truncate text-sm text-muted-foreground">{locationName}</p>
            {showFacts && <KitchenFactsLine facts={facts!} timezone={timezone} onOpenRequests={onOpenRequests} className="hidden sm:flex" />}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {saveAction}
          {onViewListing && <Button variant="outline" size="sm" className={ICON_BUTTON} onClick={onViewListing}><ExternalLink className="mr-1.5 size-4" />{mt("ksViewListing")}</Button>}
          {onShare && <Button variant="outline" size="sm" className={ICON_BUTTON} onClick={onShare}><Copy className="mr-1.5 size-4" />{mt("shareKitchen")}</Button>}
          {!listed && !hidden && review && (
            <Button size="sm" className={ICON_BUTTON} variant={canPublish ? "default" : "outline"} onClick={onList}>{mt("listingStatusReviewAndGoLive")}</Button>
          )}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className={cn(ICON_BUTTON, "w-9 px-0 text-muted-foreground hover:bg-muted hover:text-foreground")} aria-label={mt("ksMoreActions")}>
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 rounded-xl p-1.5">
              <DropdownMenuItem onSelect={onAddKitchen} className="gap-2.5 rounded-lg px-3 py-2"><Plus className="size-4" />{mt("ksAddAnotherKitchen")}</DropdownMenuItem>
              {listed && <DropdownMenuItem onSelect={() => setConfirmTakeDown(true)} className="gap-2.5 rounded-lg px-3 py-2"><EyeOff className="size-4" />{mt("listingStatusTakeDown")}</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="gap-2.5 rounded-lg px-3 py-2 text-destructive focus:bg-destructive/10 focus:text-destructive"><Trash2 className="size-4" />{mt("deleteKitchen")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {showFacts && <KitchenFactsLine facts={facts!} timezone={timezone} onOpenRequests={onOpenRequests} className="sm:hidden" />}
      {hidden && <p className="flex items-start gap-2 rounded-xl bg-muted/60 px-3.5 py-2.5 text-sm text-muted-foreground"><EyeOff className="mt-0.5 size-4 shrink-0" />{mt("listingStatusHiddenDesc")}</p>}

      {/* Names the consequence rather than asking "are you sure"; the endpoint only changes listing_status. */}
      <AlertDialog open={confirmTakeDown} onOpenChange={setConfirmTakeDown}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{mt("listingTakeDownConfirmTitle", { kitchen: kitchen.name })}</AlertDialogTitle>
            <AlertDialogDescription>{mt("listingTakeDownConfirmBody")} {mt("listingPauseObligations")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={takeDown.status === "loading"}>{mt("listingTakeDownConfirmKeep")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={takeDown.status === "loading"}
              onClick={(event) => { event.preventDefault(); void takeDown.execute().finally(() => setConfirmTakeDown(false)); }}>
              {takeDown.status === "loading" && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {mt("listingStatusTakeDown")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DeleteKitchenDialog kitchen={kitchen} locationId={locationId} open={confirmDelete} onOpenChange={setConfirmDelete} />
    </header>
  );
}
