import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Star,
  Trash2,
  X,
} from "@/components/ui/manager-icons";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "@/components/ui/carousel";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { SmartImage } from "@/components/ui/smart-image";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { resolveImageUrl } from "@/lib/resolve-image-url";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  OVERLAY_ACTION,
  CoverPhotoField,
} from "@/components/manager/kitchen/KitchenPhotoFields";
import { cn } from "@/lib/utils";
import { invalidateKitchenListingState } from "@/lib/manager-kitchens-navigation";

/** Revealed on hover and — importantly — on keyboard focus. */
const OVERLAY_REVEAL =
  "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";

/** Opts a `Button` out of the chef marketing CTA surface (pill radius, layered
 *  shadow, lift on hover) so it reads as product UI rather than a promo. */
const QUICK_ACTION = "rounded-lg shadow-none hover:shadow-none hover:translate-y-0 active:translate-y-0";

interface KitchenPhotosProps {
  locationId: number;
  kitchen: {
    id: number;
    name: string;
    imageUrl?: string | null;
    galleryImages?: string[];
  };
}

/**
 * Photos tab: the kitchen's cover photo and its gallery.
 *
 * Cover and gallery are stored separately (`kitchens.image_url` and
 * `kitchens.gallery_images`) and saved by different endpoints, so they are shown
 * as two labelled groups rather than one merged grid — but the cover is badged
 * everywhere it appears, because it is the image that represents the kitchen in
 * search results and at the top of the booking page.
 *
 * Everything here saves immediately; there is no page-level Save for this tab.
 */
export default function KitchenPhotos({ locationId, kitchen }: KitchenPhotosProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [gallery, setGallery] = useState<string[]>(kitchen.galleryImages ?? []);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [slide, setSlide] = useState(0);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  /**
   * Mirrors `gallery` for the pointer handlers, which fire outside React's
   * render cycle. Written synchronously by `moveImage` as well as by the effect
   * below, because `useEffect` runs after paint and a `pointerup` arriving
   * immediately after a `pointermove` would otherwise read a stale order.
   */
  const galleryRef = useRef(gallery);
  useEffect(() => {
    galleryRef.current = gallery;
  }, [gallery]);
  // `pointerup` reaches both the grip and the window listener; these keep the
  // commit idempotent and skip saving when nothing actually moved.
  const dragActiveRef = useRef(false);
  const dragMovedRef = useRef(false);
  /**
   * Authoritative drag position. `pointermove` fires far faster than React
   * re-renders, so reading the state variable here would act on a stale index
   * and shuffle the wrong tile. The state copy only drives the highlight ring.
   */
  const dragIndexRef = useRef<number | null>(null);

  const { uploadFile, uploadProgress } = useSessionFileUpload({
    maxSize: MAX_IMAGE_BYTES,
    allowedTypes: ACCEPTED_IMAGE_TYPES,
    onError: (error) => {
      toast({ title: mt("uploadFailed2"), description: error, variant: "destructive" });
    },
  });

  // Re-seed only when the stored gallery actually changes, so a background
  // refetch cannot wipe an in-progress reorder.
  const gallerySignature = (kitchen.galleryImages ?? []).join("|");
  useEffect(() => {
    setGallery(kitchen.galleryImages ?? []);
  }, [kitchen.id, gallerySignature]);

  useEffect(() => {
    if (!carouselApi) return;
    const handleSelect = () => setSlide(carouselApi.selectedScrollSnap());
    carouselApi.on("select", handleSelect);
    handleSelect();
    return () => {
      carouselApi.off("select", handleSelect);
    };
  }, [carouselApi]);

  const coverKey = useMemo(() => resolveImageUrl(kitchen.imageUrl), [kitchen.imageUrl]);

  const refreshKitchens = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["managerKitchens", locationId] });
    /*
     * The cover photo is a REQUIRED item on the publish checklist, so replacing it here changes what the
     * status banner says. Nothing else refreshes that checklist — the banner is mounted for the whole
     * time this tab is open, and the app never refetches on focus — which is why the list used to keep
     * claiming the photo was missing until a page reload.
     */
    invalidateKitchenListingState(queryClient, kitchen.id, locationId);
  }, [queryClient, kitchen.id, locationId]);

  const authHeader = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error(tt("firebaseUserNotAvailable"));
    return { Authorization: `Bearer ${await currentUser.getIdToken()}` };
  }, []);

  /** Replace the whole gallery array. The endpoint preserves the order sent. */
  const persistGallery = useCallback(
    async (next: string[], successMessage?: string) => {
      const response = await fetch(`/api/manager/kitchens/${kitchen.id}/gallery`, {
        method: "PUT",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ galleryImages: next }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || tt("failedToUpdateGalleryImages"));
      }
      setGallery(next);
      await refreshKitchens();
      if (successMessage) {
        toast({ title: mt("success"), description: successMessage });
      }
    },
    [authHeader, kitchen.id, refreshKitchens, toast],
  );

  const setCover = useCallback(
    async (imageUrl: string | null) => {
      try {
        const response = await fetch(`/api/manager/kitchens/${kitchen.id}/image`, {
          method: "PUT",
          headers: { ...(await authHeader()), "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ imageUrl }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || tt("failedToUpdateKitchenImage"));
        }
        await refreshKitchens();
        toast({
          title: mt("success"),
          description: imageUrl ? mt("kitchenImageUpdatedSuccessfully") : mt("kitchenImageRemoved"),
        });
      } catch (error: any) {
        logger.error("Cover photo update error:", error);
        toast({ title: mt("error"), description: error.message, variant: "destructive" });
      }
    },
    [authHeader, kitchen.id, refreshKitchens, toast],
  );

  /** Upload a batch, then save the gallery once rather than once per file. */
  const uploadFiles = useCallback(
    async (files: FileList | File[] | null) => {
      const list = Array.from(files ?? []);
      if (list.length === 0) return;

      setBatch({ done: 0, total: list.length });
      const uploaded: string[] = [];
      try {
        for (let index = 0; index < list.length; index += 1) {
          setBatch({ done: index, total: list.length });
          const result = await uploadFile(list[index]);
          if (result?.url) uploaded.push(result.url);
        }
        if (uploaded.length > 0) {
          await persistGallery(
            [...galleryRef.current, ...uploaded],
            mt("photosAdded", { count: uploaded.length }),
          );
        }
      } catch (error: any) {
        logger.error("Gallery upload error:", error);
        toast({ title: mt("error"), description: error.message, variant: "destructive" });
      } finally {
        setBatch(null);
      }
    },
    [persistGallery, toast, uploadFile],
  );

  const replaceCover = useCallback(
    async (files: FileList | File[] | null) => {
      const file = Array.from(files ?? [])[0];
      if (!file) return;
      setBatch({ done: 0, total: 1 });
      try {
        const result = await uploadFile(file);
        if (result?.url) await setCover(result.url);
      } catch (error: any) {
        logger.error("Cover upload error:", error);
        toast({ title: mt("error"), description: error.message, variant: "destructive" });
      } finally {
        setBatch(null);
      }
    },
    [setCover, toast, uploadFile],
  );

  const confirmRemoval = useCallback(async () => {
    const target = pendingRemoval;
    if (!target) return;
    setPendingRemoval(null);
    try {
      await persistGallery(
        gallery.filter((url) => url !== target),
        mt("photoRemoved"),
      );
      // Drop the object from storage too. Non-fatal: the gallery is already saved.
      try {
        await fetch("/api/manager/files", {
          method: "DELETE",
          headers: { ...(await authHeader()), "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ fileUrl: target }),
        });
      } catch (error) {
        logger.error("Error deleting gallery file from R2:", error);
      }
    } catch (error: any) {
      logger.error("Gallery removal error:", error);
      toast({ title: mt("error"), description: error.message, variant: "destructive" });
    }
  }, [authHeader, gallery, pendingRemoval, persistGallery, toast]);

  const moveImage = useCallback((from: number, to: number) => {
    const current = galleryRef.current;
    if (to < 0 || to >= current.length || from === to) return;
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    galleryRef.current = next;
    setGallery(next);
  }, []);

  /**
   * Reorder to whichever tile is under the pointer.
   *
   * Hit-testing with `elementFromPoint` rather than per-tile `pointerenter`,
   * because the grip captures the pointer: once captured, enter/leave events on
   * sibling tiles never fire — and on touch the pointer is implicitly captured
   * from the start, so a `pointerenter` approach would silently do nothing.
   */
  const handleGripMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const from = dragIndexRef.current;
      if (from === null) return;
      const tile = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest("[data-photo-index]");
      if (!tile) return;
      const target = Number(tile.getAttribute("data-photo-index"));
      if (Number.isNaN(target) || target === from) return;
      moveImage(from, target);
      dragMovedRef.current = true;
      dragIndexRef.current = target;
      setDragIndex(target);
    },
    [moveImage],
  );

  const commitOrder = useCallback(async () => {
    try {
      await persistGallery(galleryRef.current);
    } catch (error: any) {
      logger.error("Gallery reorder error:", error);
      toast({ title: mt("error"), description: error.message, variant: "destructive" });
    }
  }, [persistGallery, toast]);

  const endDrag = useCallback(() => {
    if (!dragActiveRef.current) return;
    dragActiveRef.current = false;
    dragIndexRef.current = null;
    setDragIndex(null);
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      void commitOrder();
    }
  }, [commitOrder]);

  // A pointer released outside any tile must still end the drag.
  useEffect(() => {
    if (dragIndex === null) return;
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [dragIndex, endDrag]);

  /** Keyboard and touch reorder, for anyone who cannot drag. */
  const moveByStep = useCallback(
    (index: number, step: number) => {
      const to = index + step;
      if (to < 0 || to >= galleryRef.current.length) return;
      moveImage(index, to);
      void commitOrder();
    },
    [commitOrder, moveImage],
  );

  const uploadPercent =
    batch && batch.total > 0
      ? Math.min(100, ((batch.done + uploadProgress / 100) / batch.total) * 100)
      : 0;

  return (
    <div className="space-y-5">
      <input
        ref={galleryInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(event) => {
          void uploadFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={coverInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          void replaceCover(event.target.files);
          event.target.value = "";
        }}
      />

      <Card>
        <CardHeader className="p-4 pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-lg">{mt("photos")}</CardTitle>
              <CardDescription>{mt("photosCardDescription")}</CardDescription>
            </div>
            <Button
              size="sm"
              className={cn("shrink-0", QUICK_ACTION)}
              disabled={batch !== null}
              onClick={() => galleryInputRef.current?.click()}
            >
              {batch ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="mr-1.5 h-4 w-4" />
              )}
              {mt("addPhotos")}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-4 pt-0">
          {batch && (
            <div className="mb-4 space-y-1.5">
              <Progress value={uploadPercent} />
              <p className="text-xs text-muted-foreground">
                {mt("uploadingPhotoCount", { done: batch.done + 1, total: batch.total })}
              </p>
            </div>
          )}

          {/* Cover photo — the shared field, so the onboarding wizard renders
              exactly the same control. */}
          <CoverPhotoField
            value={kitchen.imageUrl}
            onSelectFile={(file) => void replaceCover([file])}
            onRemove={() => void setCover(null)}
            disabled={batch !== null}
            className="w-full sm:w-96"
          >
            <div className="min-w-0 flex-1">
              <Label>{mt("coverPhoto")}</Label>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {mt("coverPhotoHint")}
              </p>
              <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                <li className="flex gap-2">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  {mt("coverTipLandscape")}
                </li>
                <li className="flex gap-2">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  {mt("coverTipBright")}
                </li>
                <li className="flex gap-2">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  {mt("coverTipWholeSpace")}
                </li>
              </ul>
            </div>
          </CoverPhotoField>

          <Separator className="my-4" />

          {/* Gallery */}
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div>
                <Label>{mt("gallery")}</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{mt("galleryHint")}</p>
              </div>
              {gallery.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {mt("photoCount", { count: gallery.length })}
                </span>
              )}
            </div>

            {gallery.length === 0 ? (
              <button
                type="button"
                disabled={batch !== null}
                onClick={() => galleryInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void uploadFiles(event.dataTransfer.files);
                }}
                className="mt-3 flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 px-6 py-10 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <ImagePlus className="h-6 w-6" />
                <span className="text-sm font-medium text-foreground">{mt("galleryEmpty")}</span>
                <span className="text-xs">{mt("galleryEmptyHint")}</span>
              </button>
            ) : (
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
                {gallery.map((url, index) => {
                  const resolved = resolveImageUrl(url);
                  const isCover = Boolean(coverKey) && resolved === coverKey;
                  return (
                    <li
                      key={url}
                      data-photo-index={index}
                      className={cn(
                        "group relative overflow-hidden rounded-xl border bg-muted/30",
                        dragIndex === index && "ring-2 ring-primary",
                      )}
                    >
                      <button
                        type="button"
                        className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        onClick={() => {
                          setSlide(index);
                          setPreviewIndex(index);
                        }}
                      >
                        <span className="block aspect-[4/3]">
                          {resolved && (
                            <SmartImage
                              src={resolved}
                              alt={mt("galleryPhotoNumber", { number: index + 1, total: gallery.length })}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          )}
                        </span>
                      </button>

                      {isCover && (
                        <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                          <Star className="h-3 w-3" />
                          {mt("coverPhotoBadge")}
                        </span>
                      )}

                      {/* One menu instead of a row of floating buttons. Always
                          visible (a hover-only control is unreachable on touch),
                          strengthening on hover/focus. */}
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              OVERLAY_ACTION,
                              "absolute right-2 top-2 opacity-80 data-[state=open]:opacity-100 group-hover:opacity-100",
                            )}
                            aria-label={mt("photoActions")}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem
                            disabled={index === 0}
                            onSelect={() => moveByStep(index, -1)}
                            className="gap-2 focus:bg-muted focus:text-foreground"
                          >
                            <ChevronLeft className="h-4 w-4 shrink-0" />
                            {mt("movePhotoEarlier")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={index === gallery.length - 1}
                            onSelect={() => moveByStep(index, 1)}
                            className="gap-2 focus:bg-muted focus:text-foreground"
                          >
                            <ChevronRight className="h-4 w-4 shrink-0" />
                            {mt("movePhotoLater")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {!isCover && (
                            <DropdownMenuItem
                              onSelect={() => void setCover(url)}
                              className="gap-2 focus:bg-muted focus:text-foreground"
                            >
                              <Star className="h-4 w-4 shrink-0" />
                              {mt("setAsCover")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onSelect={() => setPendingRemoval(url)}
                            className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 shrink-0" />
                            {mt("removePhoto")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <button
                        type="button"
                        className={cn(OVERLAY_ACTION, "absolute bottom-2 left-2 cursor-grab active:cursor-grabbing", OVERLAY_REVEAL)}
                        style={{ touchAction: "none" }}
                        aria-label={mt("reorderPhoto")}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          // Capture so pointermove keeps arriving even when the
                          // pointer leaves the grip, and so touch does not scroll.
                          event.currentTarget.setPointerCapture(event.pointerId);
                          dragActiveRef.current = true;
                          dragMovedRef.current = false;
                          dragIndexRef.current = index;
                          setDragIndex(index);
                        }}
                        onPointerMove={handleGripMove}
                        onPointerUp={endDrag}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                          event.preventDefault();
                          moveByStep(index, event.key === "ArrowLeft" ? -1 : 1);
                        }}
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </CardContent>
      </Card>

      {/* Full-size preview */}
      <Dialog
        open={previewIndex !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewIndex(null);
        }}
      >
        <DialogContent
          className="max-w-5xl border-0 bg-transparent p-0 shadow-none"
          overlayClassName="bg-black/90"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">{mt("photoPreview")}</DialogTitle>
          {previewIndex !== null && (
            <div className="relative">
              <Carousel
                opts={{ startIndex: previewIndex, loop: false }}
                setApi={setCarouselApi}
                className="w-full"
              >
                <CarouselContent className="ml-0">
                  {gallery.map((url, index) => (
                    <CarouselItem key={url} className="pl-0">
                      <div className="flex h-[70vh] items-center justify-center">
                        <SmartImage
                          src={resolveImageUrl(url) ?? ""}
                          alt={mt("galleryPhotoNumber", { number: index + 1, total: gallery.length })}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                    </CarouselItem>
                  ))}
                </CarouselContent>
              </Carousel>

              <button
                type="button"
                className={cn(OVERLAY_ACTION, "absolute right-0 top-0")}
                aria-label={mt("closePreview")}
                onClick={() => setPreviewIndex(null)}
              >
                <X className="h-4 w-4" />
              </button>

              <p className="mt-3 text-center text-xs text-white/70">
                {mt("photoPosition", { position: slide + 1, total: gallery.length })}
              </p>

              <button
                type="button"
                className={cn(OVERLAY_ACTION, "absolute left-2 top-1/2 -translate-y-1/2")}
                aria-label={mt("previousPhoto")}
                disabled={slide === 0}
                onClick={() => carouselApi?.scrollPrev()}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                className={cn(OVERLAY_ACTION, "absolute right-2 top-1/2 -translate-y-1/2")}
                aria-label={mt("nextPhoto")}
                disabled={slide === gallery.length - 1}
                onClick={() => carouselApi?.scrollNext()}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{mt("removePhotoTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{mt("removePhotoWarning")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{mt("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void confirmRemoval();
              }}
            >
              {mt("removePhoto")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
