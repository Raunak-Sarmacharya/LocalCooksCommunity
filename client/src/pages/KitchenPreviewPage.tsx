import { logger } from "@/lib/logger";
import i18n from "@/i18n";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Icon } from "@iconify/react";
import { formatCurrency, formatTime } from "@/lib/formatters";
import {
  notifyBookingPrefsChanged,
  usePersistedBookingPricePreview,
  type PersistedBookingPricePreview,
} from "@/lib/persisted-booking-prefs";
import { Button } from "@/components/ui/button";
import { chefOutlineCtaClass, chefPrimaryCtaClass } from "@/lib/chef-cta";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import useEmblaCarousel from 'embla-carousel-react';
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { isChefUser } from "@/config/chef-onboarding-steps";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import { resolveChefDashboardNavigation } from "@shared/subdomain-utils";
import {
  useChefKitchenApplicationForLocation,
  useChefKitchenApplications,
  useGlobalMyApplications,
} from "@/hooks/use-chef-kitchen-applications";
import { getKitchenDisplayStatus, kitchenLocationId, toneToBadgeVariant, type KitchenActionKind, type KitchenDisplayStatus } from "@/components/chef/applications/status";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { LocationMap } from "@/components/ui/location-map";
import { cn } from "@/lib/utils";
import { ScheduleViewingWidget } from "@/components/chef/ScheduleViewingWidget";
import { KitchenPreviewWalkthrough } from "@/components/kitchen-application/KitchenPreviewWalkthrough";
import { getAuthHeaders } from "@/lib/api";
import { saveAuthIntentFromCurrentPage } from "@/lib/auth-intent";
import { pickPreviewActiveSectionId } from "@/lib/preview-scroll-spy";
import { formatCancellationWindowText } from "@/lib/cancellation-policy";
import { resolveEquipmentIcon, resolveStorageIcon } from "@/lib/kitchen-inventory-icons";
import { SmartImage } from "@/components/ui/smart-image";
import { Calendar as UICalendar } from "@/components/ui/calendar";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { kt } from "@/i18n/kitchen-ns";
import {
  evaluateTypedKitchenDate,
  parseLocalDateInput,
} from "@/lib/kitchen-typed-date";

/** Iconify icon used across kitchen preview chrome (MDI, bundled offline). */
function PreviewIcon({
  icon,
  className,
  size = 16,
}: {
  icon: string;
  className?: string;
  size?: number;
}) {
  return (
    <Icon
      icon={icon}
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden
    />
  );
}

/** Click-to-open info tip — keeps helper copy off the layout. */
function PreviewInfoTip({
  label,
  children,
  className,
  side = "top",
  align = "end",
}: {
  label: string;
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            "text-gray-400 hover:bg-gray-100 hover:text-gray-700",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042]/40",
            "touch-manipulation",
            className
          )}
          aria-label={label}
        >
          <PreviewIcon icon="mdi:information-outline" size={16} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={16}
        avoidCollisions
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="z-[100] w-auto max-w-[min(18rem,calc(100vw-2rem))] p-3 text-xs leading-relaxed text-gray-700 shadow-lg"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTERPRISE-GRADE DESIGN SYSTEM - Notion-Inspired Kitchen Preview
// ═══════════════════════════════════════════════════════════════════════════════

// Animation variants for staggered children
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 24 }
  }
};

const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }
  }
};

// Component for individual carousel image with R2 proxy URL
function PhotoTile({
  imageUrl,
  kitchenName,
  index,
  onClick,
  className,
  overlay,
}: {
  imageUrl: string;
  kitchenName: string;
  index: number;
  onClick: () => void;
  className?: string;
  overlay?: React.ReactNode;
}) {
  const proxyUrl = getR2ProxyUrl(imageUrl);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative min-h-0 overflow-hidden bg-gray-100 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-inset",
        className
      )}
    >
      <SmartImage
        src={proxyUrl}
        alt={`${kitchenName} photo ${index + 1}`}
        className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
        hideOnError
      />
      {overlay}
    </button>
  );
}

// LightboxCarousel Component
function LightboxCarousel({ images, initialIndex, onClose, kitchenName }: { images: string[]; initialIndex: number; onClose: () => void; kitchenName: string; }) {
  const { t } = useTranslation("kitchen");
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    startIndex: initialIndex,
    containScroll: 'trimSnaps',
  });
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi, onSelect]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') scrollPrev();
      if (e.key === 'ArrowRight') scrollNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, scrollPrev, scrollNext]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col touch-none"
    >
      <div className="flex items-center justify-between p-4 sm:p-6 absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/60 to-transparent">
        <div className="text-white/90 font-medium text-sm sm:text-base bg-black/40 px-3 py-1 rounded-full backdrop-blur-md">
          {selectedIndex + 1} / {images.length}
        </div>
        <button 
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors z-20 backdrop-blur-md"
          aria-label={t("closeLightbox", "Close lightbox")}
        >
          <PreviewIcon icon="mdi:close" size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative flex items-center justify-center" ref={emblaRef}>
        <div className="flex h-full w-full items-center">
          {images.map((img, index) => (
            <div key={index} className="flex-[0_0_100%] min-w-0 h-full flex items-center justify-center p-0 sm:p-8">
              <SmartImage 
                src={getR2ProxyUrl(img)} 
                alt={`${kitchenName} - Fullscreen Image ${index + 1}`}
                className="w-full h-full object-contain select-none"
                draggable={false}
              />
            </div>
          ))}
        </div>
      </div>

      {images.length > 1 && (
        <>
          <button
            onClick={scrollPrev}
            className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 bg-white/10 hover:bg-white/20 active:bg-white/30 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 touch-manipulation z-10 text-white backdrop-blur-md"
            disabled={!canScrollPrev}
            aria-label={t("previousImage", "Previous image")}
          >
            <PreviewIcon icon="mdi:chevron-left" size={28} />
          </button>
          <button
            onClick={scrollNext}
            className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 bg-white/10 hover:bg-white/20 active:bg-white/30 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 touch-manipulation z-10 text-white backdrop-blur-md"
            disabled={!canScrollNext}
            aria-label={t("nextImage", "Next image")}
          >
            <PreviewIcon icon="mdi:chevron-right" size={28} />
          </button>
        </>
      )}
    </motion.div>
  );
}

interface PublicLocation {
  id: number;
  slug?: string;
  name: string;
  address: string;
  logoUrl?: string | null;
  brandImageUrl?: string | null;
  kitchenLicenseStatus?: string | null;
  description?: string | null;
  customOnboardingLink?: string | null;
  kitchenTermsUrl?: string | null;
  cancellationPolicyHours?: number | null;
  cancellationPolicyMessage?: string | null;
  canAcceptApplications?: boolean;
  isLicenseApproved?: boolean;
}

interface EquipmentListing {
  id: number;
  category: string;
  equipmentType: string;
  brand?: string;
  model?: string;
  description?: string | null;
  availabilityType: 'included' | 'rental';
  sessionRate?: number; // Flat per-session rate in dollars (converted from cents)
  currency?: string;
}

interface StorageListing {
  id: number;
  storageType: string;
  name: string;
  description?: string;
  basePrice?: number;
  pricePerCubicFoot?: number;
  pricingModel: string;
  dimensionsLength?: number;
  dimensionsWidth?: number;
  dimensionsHeight?: number;
  totalVolume?: number;
  climateControl?: boolean;
  currency?: string;
}

interface PublicKitchen {
  id: number;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  galleryImages?: string[] | null;
  amenities?: string[] | null;
  locationId: number;
  locationName?: string | null;
  locationSlug?: string | null;
  locationAddress?: string | null;
  hourlyRate?: number | null;
  pricingModel?: string | null;
  currency?: string | null;
  equipment?: {
    included: EquipmentListing[];
    rental: EquipmentListing[];
  };
  storage?: StorageListing[];
  availability?: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isAvailable: boolean;
  }>;
}

const DAY_LABELS = ["daySunday", "dayMonday", "dayTuesday", "dayWednesday", "dayThursday", "dayFriday", "daySaturday"] as const;
const DAY_SHORT = ["daySun", "dayMon", "dayTue", "dayWed", "dayThu", "dayFri", "daySat"] as const;

function formatHourLabel(time: string): string {
  return formatTime(time.slice(0, 5));
}

function getKitchenImages(kitchen: PublicKitchen): string[] {
  const images: string[] = [];
  if (kitchen.imageUrl) images.push(kitchen.imageUrl);
  if (kitchen.galleryImages && Array.isArray(kitchen.galleryImages)) {
    images.push(...kitchen.galleryImages.filter((img) => img && typeof img === "string"));
  }
  return images;
}

function formatKitchenRate(kitchen: PublicKitchen): string | null {
  if (kitchen.hourlyRate == null || kitchen.hourlyRate <= 0) return null;
  const amount = formatCurrency(kitchen.hourlyRate, kitchen.currency || "CAD");
  const model = kitchen.pricingModel || "hourly";
  if (model === "daily") {
    return `${amount}${String(i18n.t("perDaySuffix", { ns: "kitchen", defaultValue: "/day" }))}`;
  }
  if (model === "hourly") {
    return `${amount} ${String(i18n.t("perHour", { ns: "kitchen", defaultValue: "per hour" }))}`;
  }
  return amount;
}

/** Rate + at least one operating day — otherwise date booking UX is Coming Soon. */
function kitchenReadyForDateBooking(kitchen: PublicKitchen | null | undefined): boolean {
  if (!kitchen) return false;
  if (kitchen.hourlyRate == null || Number(kitchen.hourlyRate) <= 0) return false;
  const availability = kitchen.availability;
  if (!availability?.length) return false;
  return availability.some((day) => {
    const available = day.isAvailable ?? (day as { is_available?: boolean }).is_available;
    const start = day.startTime || (day as { start_time?: string }).start_time;
    const end = day.endTime || (day as { end_time?: string }).end_time;
    return !!(available && start && end);
  });
}

/** Total + selection details above the sticky-card Request CTA (not beside it). */
function PreviewBookingTotalAboveCta({
  preview,
  className,
}: {
  preview: PersistedBookingPricePreview;
  className?: string;
}) {
  const { t } = useTranslation("kitchen");
  return (
    <div className={cn("min-w-0 space-y-0.5", className)}>
      <p className="text-lg font-bold tabular-nums text-gray-900">
        {formatCurrency(preview.estimate.totalCents, preview.currency)}
        <span className="ml-1 text-sm font-normal text-gray-500">{t("total", "total")}</span>
      </p>
      {preview.dateLabel ? (
        <p className="text-xs text-muted-foreground">{preview.dateLabel}</p>
      ) : null}
      {preview.slotsLabel ? (
        <p className="truncate text-xs text-muted-foreground">{preview.slotsLabel}</p>
      ) : null}
    </div>
  );
}

/** Dock total next to Request CTA — total + date/hours, no $/hr (avoids confusion with tour CTA). */
function DockBookingTotalBesideApply({
  preview,
  className,
}: {
  preview: PersistedBookingPricePreview;
  className?: string;
}) {
  const { t } = useTranslation("kitchen");
  const hours = preview.slots.length;
  return (
    <div className={cn("min-w-0 text-right", className)}>
      <p className="text-sm font-semibold tabular-nums text-gray-900">
        {formatCurrency(preview.estimate.totalCents, preview.currency)}
        <span className="ml-1 text-xs font-normal text-gray-500">{t("total", "total")}</span>
      </p>
      <p className="truncate text-[11px] text-muted-foreground">
        {preview.dateLabel}
        {" · "}
        {t("dockHoursCount", { count: hours, defaultValue: `${hours} hour${hours === 1 ? "" : "s"}` })}
      </p>
    </div>
  );
}

/** Single source of truth for preview primary CTA copy (hero, sticky, calendar). */
function resolvePreviewPrimaryCta(args: {
  t: (key: string, fallback?: string) => string;
  applicationLoading: boolean;
  canBook: boolean;
  alreadyApplied: boolean;
  globalAppPending: boolean;
  canAcceptApplications: boolean;
  display: KitchenDisplayStatus | null;
}): {
  label: string;
  kind: KitchenActionKind | "request" | "pending" | "loading" | "closed";
  /** Calendar proceed needs dates only when starting a new request. */
  requireDates: boolean;
  variant: "default" | "outline";
} | null {
  const { t, applicationLoading, canBook, alreadyApplied, globalAppPending, canAcceptApplications, display } =
    args;

  if (applicationLoading) {
    return {
      label: t("checkingApplication", "Checking your application…"),
      kind: "loading",
      requireDates: false,
      variant: "default",
    };
  }

  if (canBook || display?.actionKind === "book") {
    return {
      label: t("bookThisKitchen", "Book"),
      kind: "book",
      requireDates: false,
      variant: "default",
    };
  }

  if (display?.actionKind === "complete-step") {
    return {
      label: t("continueApplication", "Continue"),
      kind: "complete-step",
      requireDates: false,
      variant: "default",
    };
  }

  if (alreadyApplied && display?.actionKind !== "discover") {
    return {
      label: t("applicationInProgress", "Application in progress"),
      kind: "wait",
      requireDates: false,
      variant: "outline",
    };
  }

  if (display?.actionKind === "discover" && canAcceptApplications) {
    return {
      label: t("applyAgain", "Apply again"),
      kind: "discover",
      requireDates: true,
      variant: "default",
    };
  }

  if (globalAppPending) {
    return {
      label: t("applicationInProgress", "Application in progress"),
      kind: "pending",
      requireDates: false,
      variant: "outline",
    };
  }

  if (!canAcceptApplications) {
    return null;
  }

  return {
    label: t("requestToApply", "Request to apply"),
    kind: "request",
    requireDates: true,
    variant: "default",
  };
}

function availableDaySummary(availability: PublicKitchen["availability"] | undefined, t: any): string | null {
  if (!availability || availability.length === 0) return null;
  const days = availability.filter((a) => a.isAvailable);
  if (days.length === 0) return t("hoursNotListed", "Hours not listed");
  if (days.length === 7) return t("openEveryDay", "Open every day");
  const daysStr = days.map((a) => t(DAY_SHORT[a.dayOfWeek])).join(", ");
  return t("openDays", { days: daysStr, defaultValue: `Open ${daysStr}` });
}

// Availability Display Component (Old Eagle 35 Style)
// https://uiverse.io/CheekyTurtle/old-eagle-35
function AvailabilityDisplay({ availability }: { availability: PublicKitchen['availability'] }) {
  if (!availability) return null;

  const { t } = useTranslation("kitchen");
  const days = [0, 1, 2, 3, 4, 5, 6].map(dayIndex => ({
    label: t(DAY_SHORT[dayIndex]).charAt(0),
    dayIndex
  }));

  return (
    <div className="flex items-center justify-between w-full max-w-[280px] h-[34px] gap-1">
      {days.map((day) => {
        const isAvailable = availability.some(
          (a) => a.dayOfWeek === day.dayIndex && a.isAvailable
        );

        return (
          <div
            key={day.dayIndex}
            className={`
              w-7 h-7 flex items-center justify-center rounded-[20%] text-[11px] font-semibold transition-all duration-200
              ${isAvailable
                ? 'bg-[#F51042] bg-gradient-to-br from-[#F51042] to-[#d40d38] text-white shadow-sm scale-110'
                : 'bg-transparent border-2 border-gray-200 text-gray-300'
              }
            `}
            title={isAvailable ? t("dayAvailable", "Available") : t("dayNotAvailable", "Not available")}
          >
            {day.label}
          </div>
        );
      })}
    </div>
  );
}

// Image Carousel Component - Mobile Optimized
function KitchenPhotoCollage({
  images,
  kitchenName,
  compact = false,
  fill = false,
}: {
  images: string[];
  kitchenName: string;
  compact?: boolean;
  /** Stretch to match sibling height in a bento row */
  fill?: boolean;
}) {
  const { t } = useTranslation("kitchen");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const openAt = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  if (images.length === 0) {
    return (
      <div
        data-preview-tour="photos"
        className={cn(
          "bg-gray-100 rounded-2xl flex flex-col items-center justify-center w-full shadow-sm",
          fill ? "h-full min-h-[260px]" : compact ? "h-[200px] sm:h-[260px]" : "h-[200px] sm:h-[280px] lg:h-[320px]"
        )}
      >
        <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center mb-3">
          <PreviewIcon icon="mdi:image-off" size={32} className="text-gray-400" />
        </div>
        <p className="text-gray-500 font-medium">{t("noPhotosYet", "No photos yet")}</p>
        <p className="text-gray-400 text-sm mt-1">{t("photosComingSoon", "Photos coming soon")}</p>
      </div>
    );
  }

  const PREVIEW_COUNT = fill || compact ? 3 : 5;
  const extraCount = Math.max(0, images.length - PREVIEW_COUNT);
  const previewImages = images.slice(0, Math.min(images.length, PREVIEW_COUNT));
  const count = previewImages.length;
  const hasMore = extraCount > 0;
  // Hero + remainder in a 2-col tail: even totals leave one empty cell.
  const showSeeAllTile = count >= 4 && count % 2 === 0;
  /** One fixed collage height for every image count so 1-photo kitchens don’t jump. */
  const collageHeightClass = compact
    ? "h-[200px] sm:h-[260px]"
    : "h-[200px] sm:h-[280px] lg:h-[320px]";

  const lightbox = (
    <AnimatePresence>
      {lightboxOpen && (
        <LightboxCarousel
          images={images}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
          kitchenName={kitchenName}
        />
      )}
    </AnimatePresence>
  );

  return (
    <div className={cn(fill && "relative w-full h-full min-h-[260px] lg:min-h-[320px]")}>
      <div
        data-preview-tour="photos"
        className={cn(
          "grid gap-1.5 overflow-hidden rounded-2xl bg-white",
          count === 1 ? "shadow-sm" : "shadow-xl",
          fill && "h-full min-h-[260px] lg:absolute lg:inset-0 lg:min-h-0",
          !fill && collageHeightClass,
          count === 1 && "grid-cols-1",
          count === 2 && "grid-cols-2",
          count === 3 && "grid-cols-2 grid-rows-2",
          count >= 4 && "grid-cols-2 sm:grid-cols-4 sm:grid-rows-2"
        )}
      >
        {previewImages.map((img, index) => {
          const isHero = count >= 3 && index === 0;
          const isLastWithMore = hasMore && !showSeeAllTile && index === previewImages.length - 1;

          return (
            <PhotoTile
              key={`${img}-${index}`}
              imageUrl={img}
              kitchenName={kitchenName}
              index={index}
              onClick={() => openAt(isLastWithMore ? PREVIEW_COUNT : index)}
              className={cn(
                "h-full min-h-0",
                fill && isHero && count >= 3 && "row-span-2",
                fill && isHero && count >= 4 && "col-span-2 sm:row-span-2",
                !fill && isHero && count === 3 && "row-span-2",
                !fill && isHero && count >= 4 && "col-span-2 sm:row-span-2"
              )}
              overlay={
                isLastWithMore ? (
                  <span className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 text-white pointer-events-none">
                    <PreviewIcon icon="mdi:image-multiple" size={20} className="mb-1" />
                    <span className="text-sm font-semibold">
                      {t("viewMorePhotos", { count: extraCount, defaultValue: `View ${extraCount} more` })}
                    </span>
                  </span>
                ) : undefined
              }
            />
          );
        })}
        {showSeeAllTile && (
          <button
            type="button"
            onClick={() => openAt(0)}
            className="relative h-full min-h-0 overflow-hidden bg-gray-900 text-white text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042] focus-visible:ring-inset"
            aria-label={t("viewAllPhotos", {
              count: images.length,
              defaultValue: `View all ${images.length} photos`,
            })}
          >
            {previewImages[previewImages.length - 1] ? (
              <SmartImage
                src={getR2ProxyUrl(previewImages[previewImages.length - 1])}
                alt=""
                className="absolute inset-0 h-full w-full scale-125 object-cover opacity-50 blur-xs"
                hideOnError
              />
            ) : null}
            <span className="absolute inset-0 bg-black/55" aria-hidden />
            <span className="relative z-10 flex h-full flex-col items-center justify-center gap-1 p-3 text-center">
              <PreviewIcon icon="mdi:image-multiple" size={22} className="mb-0.5" />
              <span className="text-sm font-bold leading-tight">
                {t("seeAllPhotos", "See all photos")}
              </span>
            </span>
          </button>
        )}
      </div>
      {!fill && hasMore && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">{t("clickPhotoEnlarge", "Click a photo to enlarge")}</p>
          <button
            type="button"
            onClick={() => openAt(0)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-800 hover:text-[#F51042]"
          >
            <PreviewIcon icon="mdi:image-multiple" size={16} />
            {t("viewAllPhotos", { count: images.length, defaultValue: `View all ${images.length} photos` })}
          </button>
        </div>
      )}
      {fill && hasMore && (
        <button
          type="button"
          onClick={() => openAt(0)}
          className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/80"
        >
          <PreviewIcon icon="mdi:image-multiple" size={14} />
          {t("viewAllPhotos", { count: images.length, defaultValue: `View all ${images.length} photos` })}
        </button>
      )}
      {lightbox}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EQUIPMENT CARD — brand-restrained, marketplace-clean
// ═══════════════════════════════════════════════════════════════════════════════
const ADDON_PREVIEW_COUNT = 18;
const CARD_PREVIEW_COUNT = 6;

function titleCaseLabel(value: string, t?: any) {
  const formatted = value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
  return t ? t("dbEnum_" + value.toLowerCase(), { defaultValue: formatted }) : formatted;
}

function groupByCategory(items: EquipmentListing[]) {
  const groups = new Map<string, EquipmentListing[]>();
  for (const item of items) {
    const key = (item.category || "").trim() || "General";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return Array.from(groups.entries());
}

function ExpandableInventory({

  itemCount,
  children,
  alwaysExpanded = false,
}: {
  itemCount: number;
  children: (visibleCount: number) => ReactNode;
  alwaysExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsToggle = !alwaysExpanded && itemCount > ADDON_PREVIEW_COUNT;
  const visibleCount = !needsToggle || expanded ? itemCount : ADDON_PREVIEW_COUNT;
  const hiddenCount = itemCount - ADDON_PREVIEW_COUNT;
  const { t } = useTranslation("kitchen");

  return (
    <div>
      {children(visibleCount)}
      {needsToggle && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-[#F51042]"
        >
          <PreviewIcon icon="mdi:chevron-down" size={14} className={cn("transition-transform", expanded && "rotate-180")} />
          {expanded ? t("showLess", "Show less") : t("viewAllAndMore", { itemCount, hiddenCount, defaultValue: `View all ${itemCount} · ${hiddenCount} more` })}
        </button>
      )}
    </div>
  );
}

function InventoryTypeIcon({ icon }: { icon: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFF8F5] text-[#F51042]">
      <Icon icon={icon} width={16} height={16} className="text-[#F51042]" aria-hidden />
    </span>
  );
}

function NameCell({ name, hint }: { name: string; hint?: string }) {
  const showHint =
    Boolean(hint?.trim()) && !name.toLowerCase().includes(hint!.trim().toLowerCase());

  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate text-sm text-gray-900">{name}</span>
      {showHint ? (
        <span className="hidden truncate text-xs text-gray-400 sm:inline">{hint}</span>
      ) : null}
    </span>
  );
}

function PriceCell({ amount, unit }: { amount: string; unit: string }) {
  return (
    <span className="shrink-0 text-sm text-gray-900">
      {amount}
      <span className="ml-1 text-xs font-normal text-gray-400">{unit}</span>
    </span>
  );
}

function CompactList({ children, columns = 1 }: { children: ReactNode; columns?: 1 | 2 }) {
  return (
    <ul
      className={cn(
        "min-w-0",
        columns === 2
          ? "grid grid-cols-1 sm:grid-cols-2 sm:gap-x-6"
          : "divide-y divide-gray-100"
      )}
    >
      {children}
    </ul>
  );
}

function IncludedEquipmentList({
  items,
  alwaysExpanded,
  columns = 1,
}: {
  items: EquipmentListing[];
  alwaysExpanded?: boolean;
  columns?: 1 | 2;
}) {
  const { t } = useTranslation("kitchen");
  const groups = groupByCategory(items);
  const showGroups = groups.length > 1;
  let rendered = 0;

  return (
    <ExpandableInventory itemCount={items.length} alwaysExpanded={alwaysExpanded}>
      {(visibleCount) => (
        <div className="space-y-3">
          {groups.map(([category, groupItems]) => {
            const remaining = visibleCount - rendered;
            if (remaining <= 0) return null;
            const visible = groupItems.slice(0, remaining);
            rendered += visible.length;

            return (
              <div key={category}>
                {showGroups && (
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
                    {titleCaseLabel(category, t)}
                  </p>
                )}
                <CompactList columns={columns}>
                  {visible.map((item) => (
                    <li
                      key={item.id}
                      className="flex min-w-0 items-center gap-2.5 py-2"
                    >
                      <InventoryTypeIcon
                        icon={resolveEquipmentIcon(item.equipmentType, item.category)}
                      />
                      <NameCell
                        name={titleCaseLabel(item.equipmentType, t)}
                        hint={[item.brand, item.model].filter(Boolean).join(" ")}
                      />
                    </li>
                  ))}
                </CompactList>
              </div>
            );
          })}
        </div>
      )}
    </ExpandableInventory>
  );
}

function PricedRow({
  name,
  hint,
  amount,
  unit,
  icon,
}: {
  name: string;
  hint?: string;
  amount?: string;
  unit?: string;
  icon?: string;
}) {
  return (
    <li className="flex min-w-0 items-center justify-between gap-3 py-2">
      <span className="flex min-w-0 items-center gap-2.5">
        {icon ? <InventoryTypeIcon icon={icon} /> : null}
        <NameCell name={name} hint={hint} />
      </span>
      {amount && unit ? <PriceCell amount={amount} unit={unit} /> : null}
    </li>
  );
}

function InventoryPreviewRow({
  name,
  hint,
  amount,
  unit,
  icon,
}: {
  name: string;
  hint?: string;
  amount?: string;
  unit?: string;
  icon?: string;
}) {
  return (
    <li className="flex min-h-10 min-w-0 items-center justify-between gap-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2.5">
        {icon ? <InventoryTypeIcon icon={icon} /> : null}
        <span className="min-w-0">
          <span className="block truncate text-sm text-gray-900">{name}</span>
          {hint ? (
            <span className="hidden truncate text-xs text-gray-400 sm:block">{hint}</span>
          ) : null}
        </span>
      </span>
      {amount && unit ? <PriceCell amount={amount} unit={unit} /> : null}
    </li>
  );
}

function KitchenEquipmentSections({
  kitchen,
  alwaysExpanded,
  maxVisible,
  previewPerSection,
  section = "all",
  columns = 1,
}: {
  kitchen: PublicKitchen;
  alwaysExpanded?: boolean;
  maxVisible?: number;
  /** Cap each Included / Available-to-rent list while keeping section headers. */
  previewPerSection?: number;
  /** Show only included, only rentals, or both. */
  section?: "included" | "rental" | "all";
  columns?: 1 | 2;
}) {
  const { t } = useTranslation("kitchen");
  const includedAll = section === "rental" ? [] : kitchen.equipment?.included ?? [];
  const rentalAll = section === "included" ? [] : kitchen.equipment?.rental ?? [];

  if (maxVisible != null) {
    const previewItems = [...includedAll, ...rentalAll].slice(0, maxVisible);
    return (
      <CompactList>
        {previewItems.map((item) => (
          <InventoryPreviewRow
            key={item.id}
            icon={resolveEquipmentIcon(item.equipmentType, item.category)}
            name={titleCaseLabel(item.equipmentType, t)}
            hint={[item.brand, item.model].filter(Boolean).join(" ") || undefined}
            amount={
              item.availabilityType === "rental" && item.sessionRate && item.sessionRate > 0
                ? `$${item.sessionRate.toFixed(2)}`
                : undefined
            }
            unit={
              item.availabilityType === "rental" && item.sessionRate && item.sessionRate > 0
                ? "/session"
                : undefined
            }
          />
        ))}
      </CompactList>
    );
  }

  const included = includedAll;
  const rental = rentalAll;
  const skipToggle = !!alwaysExpanded;
  const includedPreview =
    previewPerSection != null ? included.slice(0, previewPerSection) : included;
  const rentalPreview =
    previewPerSection != null ? rental.slice(0, previewPerSection) : rental;
  const includedList = previewPerSection != null ? includedPreview : included;
  const rentalList = previewPerSection != null ? rentalPreview : rental;

  return (
    <div className="space-y-5">
      {included.length > 0 && (
        <div>
          {section === "all" && (
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-900">
                {t("comesWithBooking", "Included")}
              </h3>
              <span className="text-xs text-gray-400">{includedAll.length}</span>
            </div>
          )}
          {previewPerSection != null ? (
            <CompactList>
              {includedList.map((item) => (
                <li key={item.id} className="flex min-w-0 items-center gap-2.5 py-2">
                  <InventoryTypeIcon
                    icon={resolveEquipmentIcon(item.equipmentType, item.category)}
                  />
                  <NameCell
                    name={titleCaseLabel(item.equipmentType, t)}
                    hint={[item.brand, item.model].filter(Boolean).join(" ")}
                  />
                </li>
              ))}
            </CompactList>
          ) : (
            <IncludedEquipmentList items={included} alwaysExpanded={skipToggle} columns={columns} />
          )}
        </div>
      )}

      {rental.length > 0 && (
        <div>
          {section === "all" && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-[#F51042]/20 bg-[#FFF8F5] px-2.5 py-1.5">
              <h3 className="text-sm font-semibold text-[#F51042]">
                {t("optionalRentals", "Available to rent")}
              </h3>
              <span className="text-xs font-medium text-[#F51042]/80">
                {rentalAll.length}
              </span>
            </div>
          )}
          {previewPerSection != null ? (
            <CompactList>
              {rentalList.map((item) => (
                <PricedRow
                  key={item.id}
                  icon={resolveEquipmentIcon(item.equipmentType, item.category)}
                  name={titleCaseLabel(item.equipmentType, t)}
                  hint={[item.brand, item.model].filter(Boolean).join(" ")}
                  amount={
                    item.sessionRate && item.sessionRate > 0
                      ? `$${item.sessionRate.toFixed(2)}`
                      : undefined
                  }
                  unit={item.sessionRate && item.sessionRate > 0 ? "/session" : undefined}
                />
              ))}
            </CompactList>
          ) : (
            <ExpandableInventory itemCount={rental.length} alwaysExpanded={skipToggle}>
              {(visibleCount) => (
                <CompactList columns={columns}>
                  {rental.slice(0, visibleCount).map((item) => (
                    <PricedRow
                      key={item.id}
                      icon={resolveEquipmentIcon(item.equipmentType, item.category)}
                      name={titleCaseLabel(item.equipmentType, t)}
                      hint={[item.brand, item.model].filter(Boolean).join(" ")}
                      amount={
                        item.sessionRate && item.sessionRate > 0
                          ? `$${item.sessionRate.toFixed(2)}`
                          : undefined
                      }
                      unit={item.sessionRate && item.sessionRate > 0 ? "/session" : undefined}
                    />
                  ))}
                </CompactList>
              )}
            </ExpandableInventory>
          )}
        </div>
      )}
    </div>
  );
}

function KitchenStorageSections({
  kitchen,
  maxVisible,
  alwaysExpanded = false,
  columns = 1,
}: {
  kitchen: PublicKitchen;
  maxVisible?: number;
  alwaysExpanded?: boolean;
  columns?: 1 | 2;
}) {
  const { t } = useTranslation("kitchen");
  const storageAll = kitchen.storage ?? [];

  const unitFor = (item: StorageListing) => {
    if (item.pricingModel === "per-cubic-foot" || item.pricingModel === "per_cubic_foot") return "base";
    if (item.pricingModel === "hourly") return "/hr";
    if (item.pricingModel === "monthly-flat") return "/mo";
    return "/day";
  };

  if (maxVisible != null) {
    return (
      <CompactList>
        {storageAll.slice(0, maxVisible).map((item) => (
          <InventoryPreviewRow
            key={item.id}
            icon={resolveStorageIcon(item.storageType, item.name)}
            name={item.name || titleCaseLabel(item.storageType, t)}
            hint={item.name ? titleCaseLabel(item.storageType, t) : undefined}
            amount={
              item.basePrice !== undefined && item.basePrice > 0
                ? `$${item.basePrice.toFixed(2)}`
                : undefined
            }
            unit={
              item.basePrice !== undefined && item.basePrice > 0 ? unitFor(item) : undefined
            }
          />
        ))}
      </CompactList>
    );
  }

  const storage = storageAll;
  const skipToggle = !!alwaysExpanded;

  return (
    <ExpandableInventory itemCount={storage.length} alwaysExpanded={skipToggle}>
      {(visibleCount) => (
        <CompactList columns={columns}>
          {storage.slice(0, visibleCount).map((item) => (
            <PricedRow
              key={item.id}
              icon={resolveStorageIcon(item.storageType, item.name)}
              name={item.name || titleCaseLabel(item.storageType, t)}
              hint={item.name ? titleCaseLabel(item.storageType, t) : undefined}
              amount={
                item.basePrice !== undefined && item.basePrice > 0
                  ? `$${item.basePrice.toFixed(2)}`
                  : undefined
              }
              unit={
                item.basePrice !== undefined && item.basePrice > 0 ? unitFor(item) : undefined
              }
            />
          ))}
        </CompactList>
      )}
    </ExpandableInventory>
  );
}

function InventoryShowAllButton({
  count,
  label,
  onClick,
}: {
  count: number;
  label: string;
  onClick: () => void;
}) {
  const { t } = useTranslation("kitchen");
  return (
    <button
      type="button"
      className="mt-2 inline-flex items-center text-sm font-medium text-[#F51042] hover:text-[#d10e39]"
      onClick={onClick}
    >
      {t("showAllCount", { count, label: t(label, { defaultValue: label }), defaultValue: `Show all ${count} ${label}` })}
      <PreviewIcon icon="mdi:chevron-right" size={16} className="ml-0.5" />
    </button>
  );
}

function InventoryModal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(100vw-1.5rem,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-gray-100 px-5 pb-4 pt-5 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

function KitchenInventoryPair({
  kitchen,
  hasEquipment,
  hasStorage,
  openModal: controlledOpen,
  onOpenModalChange,
}: {
  kitchen: PublicKitchen;
  hasEquipment: boolean;
  hasStorage: boolean;
  openModal?: "equipment" | "storage" | null;
  onOpenModalChange?: (modal: "equipment" | "storage" | null) => void;
}) {
  const { t } = useTranslation("kitchen");
  const [uncontrolledOpen, setUncontrolledOpen] = useState<"equipment" | "storage" | null>(null);
  const openModal = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const setOpenModal = onOpenModalChange ?? setUncontrolledOpen;
  const included = kitchen.equipment?.included ?? [];
  const rental = kitchen.equipment?.rental ?? [];
  const storage = kitchen.storage ?? [];
  const equipmentCount = included.length + rental.length;
  const showEquipment = hasEquipment && equipmentCount > 0;
  const showStorage = hasStorage && storage.length > 0;
  const both = showEquipment && showStorage;

  return (
    <div className="w-full">
      <div
        className={cn(
          "grid items-stretch gap-4",
          both ? "sm:grid-cols-2" : "grid-cols-1"
        )}
      >
        {showEquipment && (
          <div
            id="preview-equipment"
            className="flex min-h-0 min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-4 sm:p-5 scroll-mt-32"
            data-preview-tour="equipment"
          >
            <h3 className="mb-3 flex shrink-0 items-center gap-2 text-sm font-semibold text-gray-900">
              <Icon icon="mdi:pot-steam" className="h-4 w-4 text-[#F51042]" />
              {t("equipment", "Equipment")}
              <span className="ml-auto text-xs font-normal text-gray-400">
                {equipmentCount}
              </span>
            </h3>
            <div className="min-h-0 flex-1 overflow-hidden">
              <KitchenEquipmentSections
                kitchen={kitchen}
                previewPerSection={Math.max(3, Math.ceil(CARD_PREVIEW_COUNT / 2))}
              />
            </div>
            {equipmentCount > CARD_PREVIEW_COUNT && (
              <div className="mt-auto shrink-0 pt-1">
                <InventoryShowAllButton
                  count={equipmentCount}
                  label="equipment"
                  onClick={() => setOpenModal("equipment")}
                />
              </div>
            )}
          </div>
        )}

        {showStorage && (
          <div
            id="preview-storage"
            className="flex min-h-0 min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-4 sm:p-5 scroll-mt-32"
            data-preview-tour="storage"
          >
            <h3 className="mb-3 flex shrink-0 items-center gap-2 text-sm font-semibold text-gray-900">
              <Icon icon="mdi:warehouse" className="h-4 w-4 text-[#F51042]" />
              {t("storage", "Storage")}
              <span className="ml-auto text-xs font-normal text-gray-400">
                {storage.length}
              </span>
            </h3>
            <div className="min-h-0 flex-1 overflow-hidden">
              <KitchenStorageSections kitchen={kitchen} maxVisible={CARD_PREVIEW_COUNT} />
            </div>
            {storage.length > CARD_PREVIEW_COUNT && (
              <div className="mt-auto shrink-0 pt-1">
                <InventoryShowAllButton
                  count={storage.length}
                  label="storage"
                  onClick={() => setOpenModal("storage")}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <InventoryModal
        open={openModal === "equipment"}
        onOpenChange={(open) => setOpenModal(open ? "equipment" : null)}
        title={t("equipment", "Equipment")}
        description={t(
          "equipmentSheetDesc",
          "Included with your booking, plus equipment you can rent by the session."
        )}
      >
        <KitchenEquipmentSections kitchen={kitchen} alwaysExpanded columns={2} />
      </InventoryModal>

      <InventoryModal
        open={openModal === "storage"}
        onOpenChange={(open) => setOpenModal(open ? "storage" : null)}
        title={t("storage", "Storage")}
        description={t(
          "storageSheetDesc",
          "Dry, cold, and freezer space you can add to your booking."
        )}
      >
        <KitchenStorageSections kitchen={kitchen} alwaysExpanded columns={2} />
      </InventoryModal>
    </div>
  );
}

function KitchenAmenitiesList({ amenities }: { amenities: string[] }) {
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="flex flex-wrap gap-2"
    >
      {amenities.map((amenity, index) => (
        <motion.span
          key={index}
          variants={itemVariants}
          className="inline-flex items-center rounded-full border border-[#F51042]/10 bg-[#FFF8F5] px-3 py-1.5 text-sm text-[#2C2C2C]"
        >
          <PreviewIcon icon="mdi:check" size={14} className="mr-1.5 text-[#F51042]" />
          {amenity}
        </motion.span>
      ))}
    </motion.div>
  );
}

function KitchenFactChip({
  icon,
  label,
  emphasize = false,
  onClick,
}: {
  icon: string;
  label: string;
  emphasize?: boolean;
  onClick?: () => void;
}) {
  return (
    <Badge
      variant={emphasize ? undefined : "outline"}
      className={cn(
        "text-xs",
        emphasize && "border-[#F51042]/30 bg-[#F51042]/10 text-[#F51042]",
        onClick && "cursor-pointer hover:bg-[#F51042]/15"
      )}
      onClick={onClick}
    >
      <PreviewIcon icon={icon} size={12} className="mr-1" />
      {label}
    </Badge>
  );
}

/** Soft multi-layer elevation — large blur, no hard shadow edge. */
const PREMIUM_CARD_SHADOW =
  "shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_-2px_rgba(15,23,42,0.06),0_12px_32px_-8px_rgba(15,23,42,0.1)]";
const PREMIUM_CTA_SHADOW =
  "shadow-[0_1px_2px_rgba(15,23,42,0.05),0_6px_16px_-4px_rgba(15,23,42,0.12)]";
/** Soft red glow — keep blur high / alpha modest so corners don’t read as a hard box. */
const PREMIUM_PRIMARY_SHADOW =
  "shadow-[0_2px_6px_-1px_rgba(15,23,42,0.1),0_10px_28px_-8px_rgba(245,16,66,0.38)]";

/** Apply CTA surfaces — same soft elevation as tour CTA (primary red vs quiet outline). */
function previewApplyCtaClass(variant: "default" | "outline" = "default") {
  return variant === "outline"
    ? chefOutlineCtaClass()
    : chefPrimaryCtaClass();
}

/** Dock tour CTA — solid primary when alone; outline secondary when paired with Apply. */
function previewDockTourCtaClass(
  kind: "request" | "pending" | "confirmed",
  pairedWithApply: boolean
) {
  if (kind === "confirmed") {
    return cn(
      "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 hover:text-emerald-950",
      PREMIUM_CTA_SHADOW
    );
  }
  if (kind === "pending") {
    return cn(
      "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:text-amber-950",
      PREMIUM_CTA_SHADOW
    );
  }
  if (pairedWithApply) {
    return cn(
      "border-[#F51042]/45 bg-white text-[#F51042] hover:bg-[#FFF8F5] hover:text-[#F51042]",
      PREMIUM_CTA_SHADOW
    );
  }
  return cn(
    "border-transparent bg-[#F51042] text-white hover:bg-[#E00A38] hover:text-white",
    PREMIUM_PRIMARY_SHADOW
  );
}

/** Open-days + optional tour CTA under the listing title. Rate lives on the sticky booking card. */
function RateHoursFacts({
  hoursSummary,
  extra,
}: {
  hoursSummary: string | null;
  extra?: ReactNode;
}) {
  const { t } = useTranslation("kitchen");
  if (!hoursSummary && !extra) return null;
  const count = [hoursSummary, extra].filter(Boolean).length;
  return (
    <div
      className={cn(
        "grid gap-2.5",
        count === 2
          ? "grid-cols-1 sm:grid-cols-2"
          : extra
            ? "grid-cols-1"
            : "grid-cols-1 max-w-xs"
      )}
    >
      {hoursSummary && (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
            {t("openDaysLabel", "Open days")}
          </p>
          <p className="mt-1 text-base font-semibold text-gray-900">{hoursSummary}</p>
        </div>
      )}
      {extra}
    </div>
  );
}

function ThingsToKnowSection({
  cancellationPolicyHours,
  cancellationPolicyMessage,
  kitchenTermsUrl,
}: {
  cancellationPolicyHours?: number | null;
  cancellationPolicyMessage?: string | null;
  kitchenTermsUrl?: string | null;
}) {
  const { t } = useTranslation("kitchen");
  const hours = cancellationPolicyHours ?? 24;
  const windowText = formatCancellationWindowText(
    hours,
    cancellationPolicyMessage,
    t("cancellationPolicyDefaultMessage", { hours })
  );
  const policyText = `${windowText} ${t("cancellationPolicyRefundRules")}`;
  const termsHref = kitchenTermsUrl ? getR2ProxyUrl(kitchenTermsUrl) : "/terms";

  const columns = [
    {
      icon: "mdi:calendar-remove-outline",
      title: t("thingsToKnowCancellationTitle", "Cancellation policy"),
      body: policyText,
      href: "/terms",
      linkLabel: t("thingsToKnowLearnMore", "Learn more"),
    },
    {
      icon: "mdi:file-document-outline",
      title: t("thingsToKnowTermsTitle", "Kitchen terms & policies"),
      body: kitchenTermsUrl
        ? t(
            "thingsToKnowTermsBody",
            "House rules, usage policies, and chef requirements for this kitchen."
          )
        : t(
            "thingsToKnowTermsBodyFallback",
            "Kitchen usage policies and food safety standards apply to every booking."
          ),
      href: termsHref,
      linkLabel: t("thingsToKnowLearnMore", "Learn more"),
      external: !!kitchenTermsUrl,
    },
    {
      icon: "mdi:book-open-page-variant-outline",
      title: t("thingsToKnowResourcesTitle", "Chef resources"),
      body: t(
        "thingsToKnowResourcesBody",
        "Guides on certification, licensing, insurance, and starting your food business."
      ),
      href: "/resources",
      linkLabel: t("thingsToKnowLearnMore", "Learn more"),
    },
  ] as const;

  return (
    <section id="preview-things-to-know" className="scroll-mt-32 border-t border-gray-200 pt-6 sm:pt-8">
      <h2 className="text-lg sm:text-xl font-bold text-gray-900">
        {t("thingsToKnowTitle", "Before You Book")}
      </h2>
      <div className="mt-4 grid grid-cols-1 divide-y divide-gray-200 sm:mt-5 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {columns.map((col) => (
          <div
            key={col.title}
            className="flex flex-col py-4 first:pt-0 last:pb-0 sm:px-5 sm:py-0 first:sm:pl-0 last:sm:pr-0"
          >
            <PreviewIcon icon={col.icon} size={18} className="text-gray-900" />
            <h3 className="mt-2.5 text-sm font-semibold text-gray-900">{col.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{col.body}</p>
            <a
              href={col.href}
              {...("external" in col && col.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="mt-2 text-sm font-medium text-gray-900 underline underline-offset-2 hover:text-[#F51042]"
            >
              {col.linkLabel}
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}

function GuestHoursCard({
  availability,
  kitchenId,
  locationId,
  kitchenName,
  kitchenRate,
  pricePreview,
  application,
  applicationLoading = false,
  locationApplicationLoading = false,
  listApplicationLoading = false,
  onProceed,
  canBook,
  alreadyApplied,
  equipmentListings,
  storageListings,
  bento = false,
  proceedLabel,
  requireDatesForProceed = true,
  proceedVariant = "default",
  proceedDisabled = false,
  showPrimaryCta = true,
  calendarOpen: calendarOpenProp,
  onCalendarOpenChange,
  onDatesOkChange,
  extraInfoTip,
}: {
  availability?: PublicKitchen["availability"];
  kitchenId?: string;
  locationId?: string;
  kitchenName?: string;
  kitchenRate?: string | null;
  pricePreview?: PersistedBookingPricePreview | null;
  application?: {
    fullName?: string;
    email?: string;
    phone?: string;
    shopName?: string;
    shopAddress?: string;
    status?: string;
    current_tier?: number;
  } | null;
  applicationLoading?: boolean;
  locationApplicationLoading?: boolean;
  listApplicationLoading?: boolean;
  onProceed?: () => void;
  canBook?: boolean;
  alreadyApplied?: boolean;
  equipmentListings?: { included: EquipmentListing[]; rental: EquipmentListing[] } | null;
  storageListings?: StorageListing[] | null;
  /** Compact card for photo+calendar bento row */
  bento?: boolean;
  /** Same label as hero/sticky primary CTA when dates aren't required / once dates selected. */
  proceedLabel?: string;
  requireDatesForProceed?: boolean;
  proceedVariant?: "default" | "outline";
  proceedDisabled?: boolean;
  showPrimaryCta?: boolean;
  calendarOpen?: boolean;
  onCalendarOpenChange?: (open: boolean) => void;
  onDatesOkChange?: (ok: boolean) => void;
  /** Extra status tip shown in the CTA info popover (e.g. apply-first notice). */
  extraInfoTip?: string | null;
}) {
  const { t } = useTranslation("kitchen");
  const { openAuthModal } = useAuthModal();
  const { user } = useFirebaseAuth();
  const isAuthenticated = !!user;
  
  const storageKey = kitchenId ? `kitchen_dates_${kitchenId}` : 'kitchen_dates_generic';
  const tourStorageKey = locationId ? `viewing_booking_${locationId}` : null;

  const hasRate = !!kitchenRate;
  const hasSchedule = !!(
    availability?.some((day) => {
      const available = day.isAvailable ?? (day as { is_available?: boolean }).is_available;
      const start = day.startTime || (day as { start_time?: string }).start_time;
      const end = day.endTime || (day as { end_time?: string }).end_time;
      return !!(available && start && end);
    })
  );
  const bookingDatesReady = hasRate && hasSchedule;
  
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [dateInputValue, setDateInputValue] = useState("");
  const [dateNotAvailable, setDateNotAvailable] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const [uncontrolledCalendarOpen, setUncontrolledCalendarOpen] = useState(false);
  const calendarOpen = calendarOpenProp ?? uncontrolledCalendarOpen;
  const setCalendarOpen = onCalendarOpenChange ?? setUncontrolledCalendarOpen;
  const [dateAvailability, setDateAvailability] = useState<Record<string, boolean>>({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [loadedMonthKey, setLoadedMonthKey] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const pendingTypedDateRef = useRef<string | null>(null);

  const toLocalDateString = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const monthKeyOf = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;

  const todayStr = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return toLocalDateString(today);
  })();

  const sameCalendarDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const dayHasOperatingHours = (dayAvail: NonNullable<PublicKitchen["availability"]>[number] | undefined) => {
    if (!dayAvail) return false;
    const available = dayAvail.isAvailable ?? (dayAvail as { is_available?: boolean }).is_available;
    const start = dayAvail.startTime || (dayAvail as { start_time?: string }).start_time;
    const end = dayAvail.endTime || (dayAvail as { end_time?: string }).end_time;
    return !!(available && start && end);
  };

  useEffect(() => {
    if (!kitchenId || !bookingDatesReady) return;
    let cancelled = false;
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const monthKey = `${year}-${month}`;
    const loadMonth = async () => {
      setAvailabilityLoading(true);
      try {
        const response = await fetch(
          `/api/public/kitchens/${kitchenId}/month-availability?year=${year}&month=${month}`,
          { credentials: "include", cache: "no-store" }
        );
        if (!response.ok) throw new Error(kt("failedToLoadAvailability"));
        const serverAvailability: Record<string, boolean> = await response.json();
        if (cancelled) return;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const merged: Record<string, boolean> = {};
        for (let day = 1; day <= daysInMonth; day++) {
          const date = new Date(year, month, day);
          const dateStr = toLocalDateString(date);
          merged[dateStr] = date >= today && serverAvailability[dateStr] === true;
        }
        // Accumulate months so typed dates outside the visible month stay checkable.
        setDateAvailability((prev) => ({ ...prev, ...merged }));
      } catch {
        // Keep prior months; settle typed checks via loadedMonthKey below.
      } finally {
        if (!cancelled) {
          setLoadedMonthKey(monthKey);
          setAvailabilityLoading(false);
        }
      }
    };
    void loadMonth();
    return () => {
      cancelled = true;
    };
  }, [kitchenId, calendarMonth, bookingDatesReady]);

  // Persist or clear date in sessionStorage (single day — no range).
  // Skip the initial undefined render so we don't wipe a just-saved preview date
  // before the restore effect applies it.
  const dateHydratedRef = useRef(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.from) {
          const from = new Date(parsed.from);
          from.setHours(0, 0, 0, 0);
          setSelectedDate(from);
          setDateInputValue(toLocalDateString(from));
          setCalendarMonth(new Date(from.getFullYear(), from.getMonth(), 1));
        }
      }
    } catch (e) {
      console.error("Failed to restore dates", e);
    } finally {
      dateHydratedRef.current = true;
    }
  }, [storageKey, isAuthenticated]);

  useEffect(() => {
    if (!dateHydratedRef.current) return;
    if (selectedDate) {
      sessionStorage.setItem(storageKey, JSON.stringify({ from: selectedDate }));
      if (kitchenId) notifyBookingPrefsChanged(kitchenId);
    } else if (!dateNotAvailable && !pendingTypedDateRef.current) {
      sessionStorage.removeItem(storageKey);
    }
  }, [selectedDate, storageKey, kitchenId, dateNotAvailable]);

  const isDayAvailable = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date < today) return false;

    const dateStr = toLocalDateString(date);
    if (dateStr in dateAvailability) {
      return dateAvailability[dateStr] === true;
    }

    if (Object.keys(dateAvailability).length > 0) {
      // Other months not loaded yet — treat as unavailable for calendar clicks.
      return false;
    }

    if (!availability || availability.length === 0) return false;
    const day = date.getDay();
    const dayAvail = availability.find((a) => a.dayOfWeek === day);
    return dayHasOperatingHours(dayAvail);
  };

  const commitAvailableDate = (next: Date) => {
    setSelectedDate(next);
    setDateInputValue(toLocalDateString(next));
    setDateNotAvailable(false);
    pendingTypedDateRef.current = null;
    if (kitchenId) {
      sessionStorage.removeItem(`kitchen_booking_prefs_${kitchenId}`);
      notifyBookingPrefsChanged(kitchenId);
    }
    setCalendarOpen(false);
  };

  const resolveTypedDate = (dateStr: string) => {
    const next = parseLocalDateInput(dateStr);
    if (!next) {
      setDateNotAvailable(true);
      setSelectedDate(undefined);
      pendingTypedDateRef.current = null;
      return;
    }

    if (!kitchenId) {
      if (isDayAvailable(next)) commitAvailableDate(next);
      else {
        setSelectedDate(undefined);
        setDateNotAvailable(true);
        pendingTypedDateRef.current = null;
      }
      return;
    }

    const status = evaluateTypedKitchenDate(dateStr, dateAvailability, todayStr);
    if (status === "pending") {
      // Month fetch finished without this day → unavailable.
      setSelectedDate(undefined);
      setDateNotAvailable(true);
      pendingTypedDateRef.current = null;
      return;
    }
    if (status === "available") {
      commitAvailableDate(next);
      return;
    }
    setSelectedDate(undefined);
    setDateNotAvailable(true);
    pendingTypedDateRef.current = null;
  };

  const queueTypedDate = (dateStr: string) => {
    const next = parseLocalDateInput(dateStr);
    if (!next) {
      setDateNotAvailable(true);
      setSelectedDate(undefined);
      pendingTypedDateRef.current = null;
      return;
    }

    const targetMonth = new Date(next.getFullYear(), next.getMonth(), 1);
    setCalendarMonth(targetMonth);
    pendingTypedDateRef.current = dateStr;
    setDateNotAvailable(false);

    if (!kitchenId) {
      resolveTypedDate(dateStr);
      return;
    }

    // Already have this month loaded and not mid-fetch — resolve now.
    if (loadedMonthKey === monthKeyOf(next) && !availabilityLoading) {
      resolveTypedDate(dateStr);
    }
  };

  useEffect(() => {
    if (availabilityLoading) return;
    const pending = pendingTypedDateRef.current;
    if (!pending) return;
    const next = parseLocalDateInput(pending);
    if (!next) return;
    if (kitchenId && loadedMonthKey !== monthKeyOf(next)) return;
    resolveTypedDate(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settle when the target month finishes loading
  }, [availabilityLoading, loadedMonthKey, dateAvailability, kitchenId]);

  useEffect(() => {
    // Don't clear the saved date while month availability is still loading
    if (availabilityLoading) return;
    if (pendingTypedDateRef.current) return;
    if (selectedDate && !isDayAvailable(selectedDate)) {
      setSelectedDate(undefined);
      setDateNotAvailable(true);
    }
  }, [selectedDate, availability, dateAvailability, availabilityLoading]);

  const clearDates = () => {
    setSelectedDate(undefined);
    setDateInputValue("");
    setDateNotAvailable(false);
    pendingTypedDateRef.current = null;
    sessionStorage.removeItem(storageKey);
    if (kitchenId) {
      sessionStorage.removeItem(`kitchen_booking_prefs_${kitchenId}`);
      notifyBookingPrefsChanged(kitchenId);
    }
    setCalendarOpen(true);
  };

  const handleDateInputChange = (value: string) => {
    setDateInputValue(value);
    if (!value) {
      setSelectedDate(undefined);
      setDateNotAvailable(false);
      pendingTypedDateRef.current = null;
      sessionStorage.removeItem(storageKey);
      if (kitchenId) {
        sessionStorage.removeItem(`kitchen_booking_prefs_${kitchenId}`);
        notifyBookingPrefsChanged(kitchenId);
      }
      return;
    }
    queueTypedDate(value);
  };

  const handleSelect = (day: Date | undefined) => {
    if (!day) {
      clearDates();
      return;
    }
    const next = new Date(day);
    next.setHours(0, 0, 0, 0);
    if (!isDayAvailable(next)) {
      setDateInputValue(toLocalDateString(next));
      setSelectedDate(undefined);
      setDateNotAvailable(true);
      return;
    }
    if (selectedDate && sameCalendarDay(selectedDate, next)) {
      clearDates();
      return;
    }
    commitAvailableDate(next);
  };

  const handleProceed = () => {
    if (selectedDate) {
      sessionStorage.setItem(storageKey, JSON.stringify({ from: selectedDate }));
    }

    if (isAuthenticated) {
      sessionStorage.removeItem('pending_application_modal');
      sessionStorage.removeItem(`${storageKey}_pending_modal`);
      if (onProceed) onProceed();
      return;
    }

    if (tourStorageKey) sessionStorage.removeItem(tourStorageKey);
    sessionStorage.removeItem('pending_application_modal');
    saveAuthIntentFromCurrentPage("book", locationId || kitchenId, kitchenId);
    try {
      if (locationId || kitchenId) {
        sessionStorage.setItem(
          'pendingRegistrationKitchenContext',
          JSON.stringify({
            locationId: locationId || kitchenId,
            kitchenId,
            kitchenName
          })
        );
      }
    } catch (e) {
      console.error("Failed to persist pendingRegistrationKitchenContext", e);
    }
    openAuthModal({
      title: t("requestToApply", "Request to apply"),
      defaultTab: "register",
      requireApplication: true,
      bookingContext: kitchenId
        ? {
            kitchenId,
            kitchenName,
            equipmentListings: equipmentListings
              ? { included: equipmentListings.included, rental: equipmentListings.rental }
              : null,
            storageListings: storageListings ?? null,
          }
        : undefined,
    });
  };

  const hasSelection = !!selectedDate || (!!dateInputValue && dateNotAvailable);
  const datesOk =
    bookingDatesReady && !!(selectedDate && isDayAvailable(selectedDate));
  const checkingApp =
    isAuthenticated && (locationApplicationLoading || listApplicationLoading);

  useEffect(() => {
    onDatesOkChange?.(datesOk);
  }, [datesOk, onDatesOkChange]);

  // CTAs that need a date stay behind Coming Soon until rate + schedule exist.
  const showDateGatedCta = showPrimaryCta;
  const stickyCtaLabel = checkingApp
    ? t("checkingApplication", "Checking your application…")
    : proceedLabel || t("requestToApply", "Request to apply");

  const ctaBlocked = proceedDisabled || checkingApp || (bookingDatesReady && availabilityLoading);
  const handleCtaClick = () => {
    if (ctaBlocked) return;
    if (requireDatesForProceed && !datesOk) {
      setCalendarOpen(true);
      cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    handleProceed();
  };

  const ctaButton = showDateGatedCta ? (
    <Button
      id="preview-apply"
      variant={proceedVariant === "outline" ? "outline" : "default"}
      className={cn(previewApplyCtaClass(proceedVariant), "w-full font-semibold", bento && "h-9 text-sm")}
      onClick={handleCtaClick}
      disabled={ctaBlocked}
    >
      {stickyCtaLabel}
    </Button>
  ) : null;

  const bookingInfoBody = (
    <>
      <p>
        {t(
          "pickDateToBook",
          "Select the day you'd like. You won't be charged until you complete a booking."
        )}
      </p>
      {extraInfoTip ? <p className="mt-2">{extraInfoTip}</p> : null}
    </>
  );
  const showBookingInfo = showDateGatedCta || !!extraInfoTip;

  if (!bookingDatesReady) {
    return (
      <div
        ref={cardRef}
        className={cn(
          "relative bg-white rounded-2xl border border-gray-200/70 flex flex-col w-full",
          PREMIUM_CARD_SHADOW,
          bento ? "p-3 sm:p-3.5 h-full" : "p-5"
        )}
        data-preview-tour="hours"
      >
        {extraInfoTip ? (
          <div className={cn("absolute z-10", bento ? "right-2 top-2" : "right-3 top-3")}>
            <PreviewInfoTip label={t("bookingInfoTip", "Booking info")}>
              {extraInfoTip}
            </PreviewInfoTip>
          </div>
        ) : null}
        <div
          className={cn(
            "flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50/80 px-4 py-8 text-center",
            extraInfoTip && "pr-10"
          )}
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-gray-600">
            <PreviewIcon icon="mdi:clock-outline" size={14} />
            {t("applyFlowComingSoonBadge", "Coming Soon")}
          </span>
          <p className="mt-3 text-sm font-medium text-gray-900">
            {t("bookingDatesComingSoonTitle", "Booking dates aren’t open yet")}
          </p>
          <p className="mt-1.5 max-w-[16rem] text-xs leading-relaxed text-gray-500">
            {!hasRate && !hasSchedule
              ? t(
                  "bookingDatesComingSoonNeedRateAndSchedule",
                  "This kitchen still needs an hourly rate and availability schedule before you can pick a date."
                )
              : !hasRate
                ? t(
                    "bookingDatesComingSoonNeedRate",
                    "This kitchen still needs an hourly rate before you can pick a date."
                  )
                : t(
                    "bookingDatesComingSoonNeedSchedule",
                    "This kitchen still needs an availability schedule before you can pick a date."
                  )}
          </p>
        </div>
        {showDateGatedCta ? (
          <div className="mt-4 shrink-0 space-y-2 border-t border-gray-200 pt-3" data-preview-tour="cta">
            {ctaButton}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        "relative bg-white rounded-2xl border border-gray-200/70 flex flex-col w-full",
        PREMIUM_CARD_SHADOW,
        bento ? "p-3 sm:p-3.5 h-full" : "p-5"
      )}
      data-preview-tour="hours"
    >
      {showBookingInfo ? (
        <div className={cn("absolute z-10", bento ? "right-2 top-2" : "right-3 top-3")}>
          <PreviewInfoTip label={t("bookingInfoTip", "Booking info")}>
            {showDateGatedCta ? bookingInfoBody : extraInfoTip}
          </PreviewInfoTip>
        </div>
      ) : null}

      {kitchenRate ? (
        <p
          className={cn(
            "mb-3 text-lg font-bold text-gray-900",
            showBookingInfo && "pr-9"
          )}
        >
          {kitchenRate}
        </p>
      ) : null}

      <div data-preview-tour="cta">
      <Collapsible open={calendarOpen} onOpenChange={setCalendarOpen}>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3.5 py-2.5 transition-colors",
              dateNotAvailable
                ? "border-[#F51042]/60 hover:border-[#F51042]"
                : "border-gray-300 hover:border-gray-400"
            )}
          >
            <label className="min-w-0 flex-1">
              <span className="block text-xs font-medium uppercase tracking-wider text-gray-500">
                {t("selectYourDate", "Choose your date")}
              </span>
              <input
                type="date"
                value={dateInputValue}
                min={todayStr}
                onChange={(e) => handleDateInputChange(e.target.value)}
                onFocus={() => setCalendarOpen(true)}
                aria-invalid={dateNotAvailable}
                aria-describedby={dateNotAvailable ? "preview-date-unavailable" : undefined}
                className={cn(
                  "mt-0.5 w-full min-w-0 border-0 bg-transparent p-0 text-sm outline-none",
                  "text-gray-900 [color-scheme:light]",
                  "focus-visible:ring-0"
                )}
              />
              {dateNotAvailable ? (
                <span
                  id="preview-date-unavailable"
                  className="mt-0.5 block text-xs font-medium text-[#F51042]"
                >
                  {t("dateNotAvailable", "Date is not available")}
                </span>
              ) : null}
            </label>
            <button
              type="button"
              onClick={() => setCalendarOpen(!calendarOpen)}
              className="shrink-0 rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              aria-expanded={calendarOpen}
              aria-label={
                calendarOpen
                  ? t("hideCalendar", "Hide calendar")
                  : t("showCalendar", "Show calendar")
              }
            >
              <PreviewIcon
                icon={calendarOpen ? "mdi:chevron-up" : "mdi:chevron-down"}
                size={18}
              />
            </button>
          </div>
          {hasSelection && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearDates}
              className="shrink-0 h-10 px-2 text-xs text-gray-500 hover:text-[#F51042]"
            >
              {t("clearDate", "Clear")}
            </Button>
          )}
        </div>

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-none">
          <div className="relative mt-2 rounded-lg border border-gray-300 bg-gray-50/30 p-1">
            {availabilityLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 rounded-lg">
                <PreviewIcon icon="mdi:loading" size={20} className="animate-spin text-[#F51042]" />
              </div>
            )}
            <UICalendar
              mode="single"
              selected={selectedDate}
              onSelect={handleSelect}
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              initialFocus={false}
              className="w-full bg-transparent p-1"
              classNames={{
                months: "flex flex-col space-y-0 w-full",
                month: "space-y-2 w-full",
                caption: "flex justify-center pt-0.5 relative items-center w-full",
                caption_label: "text-xs font-medium",
                nav_button:
                  "inline-flex items-center justify-center h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 rounded-md border-0 shadow-none",
                nav_button_previous: "absolute left-0",
                nav_button_next: "absolute right-0",
                table: "w-full border-collapse table-fixed",
                head_cell:
                  "text-muted-foreground font-normal text-xs text-center pb-0.5 w-[14.28%]",
                row: "mt-0.5",
                day: "h-8 w-8 max-w-[32px] mx-auto p-0 font-normal text-xs aria-selected:opacity-100 rounded-full hover:bg-gray-100 transition-colors flex items-center justify-center text-gray-900",
                day_disabled:
                  "text-gray-300 opacity-40 font-normal line-through decoration-gray-300/80 pointer-events-none",
                cell: cn(
                  "text-center text-xs p-0 relative h-8 z-0",
                  "[&:has([aria-selected])]:before:absolute [&:has([aria-selected])]:before:left-1/2 [&:has([aria-selected])]:before:top-1/2 [&:has([aria-selected])]:before:h-8 [&:has([aria-selected])]:before:w-8 [&:has([aria-selected])]:before:-translate-x-1/2 [&:has([aria-selected])]:before:-translate-y-1/2 [&:has([aria-selected])]:before:border-2 [&:has([aria-selected])]:before:border-[#F51042] [&:has([aria-selected])]:before:rounded-full [&:has([aria-selected])]:before:-z-10"
                ),
              }}
              disabled={(date) => {
                const d = new Date(date);
                d.setHours(0, 0, 0, 0);
                return !isDayAvailable(d);
              }}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {showDateGatedCta && (
        <div className="mt-4 shrink-0 space-y-2 border-t border-gray-200 pt-3">
          {pricePreview ? <PreviewBookingTotalAboveCta preview={pricePreview} /> : null}
          {ctaButton}
        </div>
      )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// KITCHEN DETAILS SECTION
// ═══════════════════════════════════════════════════════════════════════════════
interface KitchenDetailsSectionProps {
  kitchen: PublicKitchen;
  locationAddress?: string;
  locationName?: string;
  locationDescription?: string | null;
  layout?: "tabs" | "stacked";
  addonsLoading?: boolean;
  hidePhotoCollage?: boolean;
  /** When true, title/description are rendered by the parent (keeps chips → name tight). */
  hideOverview?: boolean;
  inventoryModal?: "equipment" | "storage" | null;
  onInventoryModalChange?: (modal: "equipment" | "storage" | null) => void;
}

function KitchenDetailsSection({
  kitchen,
  locationAddress,
  locationName,
  locationDescription,
  layout = "tabs",
  addonsLoading = false,
  hidePhotoCollage = false,
  hideOverview = false,
  inventoryModal,
  onInventoryModalChange,
}: KitchenDetailsSectionProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const isStacked = layout === "stacked";

  const allImages: string[] = useMemo(() => getKitchenImages(kitchen), [kitchen]);

  const hasEquipment = kitchen.equipment && (
    (kitchen.equipment.included && kitchen.equipment.included.length > 0) ||
    (kitchen.equipment.rental && kitchen.equipment.rental.length > 0)
  );
  const hasStorage = kitchen.storage && kitchen.storage.length > 0;

  const includedCount = kitchen.equipment?.included?.length || 0;
  const rentalCount = kitchen.equipment?.rental?.length || 0;
  const storageCount = kitchen.storage?.length || 0;
  const rateLabel = formatKitchenRate(kitchen);
  const { t } = useTranslation("kitchen");
  const aboutCopy = isStacked
    ? (kitchen.description || null)
    : (kitchen.description || locationDescription || null);

  return (
    <motion.div
      key={kitchen.id}
      initial="hidden"
      animate="visible"
      exit={{ opacity: 0, y: -20 }}
      variants={fadeInUp}
      className="space-y-5"
    >
      {!hidePhotoCollage && (
        <KitchenPhotoCollage images={allImages} kitchenName={kitchen.name} />
      )}

      {!hideOverview && (
        <div id="preview-overview" className="space-y-2 scroll-mt-32">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900">{kitchen.name}</h2>
            {rateLabel && !hidePhotoCollage && (
              <p className="text-base font-semibold text-[#F51042] shrink-0">{rateLabel}</p>
            )}
          </div>
          {aboutCopy && isStacked && (
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{aboutCopy}</p>
          )}
        </div>
      )}

      {isStacked ? (
        <>
          {kitchen.amenities && kitchen.amenities.length > 0 && (
            <div id="preview-amenities" className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 scroll-mt-32">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <PreviewIcon icon="mdi:format-list-checks" size={16} className="text-[#F51042]" />
                {t("amenities")}
              </h3>
              <KitchenAmenitiesList amenities={kitchen.amenities} />
            </div>
          )}

          {addonsLoading && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!addonsLoading && (hasEquipment || hasStorage) && (
            <KitchenInventoryPair
              kitchen={kitchen}
              hasEquipment={!!hasEquipment}
              hasStorage={!!hasStorage}
              openModal={inventoryModal}
              onOpenModalChange={onInventoryModalChange}
            />
          )}

          {locationAddress && (
            <div id="preview-location" className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 scroll-mt-32">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <PreviewIcon icon="mdi:map-marker" size={16} className="text-[#F51042]" />
                {t("whereItIs", "Location")}
              </h3>
              {locationName && (
                <p className="text-sm text-gray-600 mb-3">{locationAddress}</p>
              )}
              <LocationMap
                address={locationAddress}
                name={locationName || kitchen.name}
                heightClassName="h-[220px]"
              />
            </div>
          )}
        </>
      ) : (
      <Card className="border-0 shadow-lg rounded-2xl overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="border-b border-border/50 bg-muted/30 px-6 pt-4">
            <TabsList className="bg-transparent h-auto p-0 gap-1">
              <TabsTrigger 
                value="overview"
                data-preview-tour="tab-overview"
                className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-t-lg rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-2.5 text-sm font-medium"
              >
                <PreviewIcon icon="mdi:view-grid-outline" size={16} className="mr-2" />
                {t("overviewTab", "Overview")}
              </TabsTrigger>
              {hasEquipment && (
                <TabsTrigger 
                  value="equipment"
                  data-preview-tour="tab-equipment"
                  className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-t-lg rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-2.5 text-sm font-medium"
                >
                  <PreviewIcon icon="mdi:pot-steam" size={16} className="mr-2 text-[#F51042]" />{t("equipment", "Equipment")}<Badge variant="count" className="ml-2">
                    {includedCount + rentalCount}
                  </Badge>
                </TabsTrigger>
              )}
              {hasStorage && (
                <TabsTrigger 
                  value="storage"
                  data-preview-tour="tab-storage"
                  className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-t-lg rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-2.5 text-sm font-medium"
                >
                  <PreviewIcon icon="mdi:warehouse" size={16} className="mr-2 text-[#F51042]" />{t("storage", "Storage")}<Badge variant="count" className="ml-2">
                    {storageCount}
                  </Badge>
                </TabsTrigger>
              )}
            </TabsList>
          </div>
          
          <CardContent className="p-6">
            <AnimatePresence mode="wait">
              {activeTab === "overview" && (
                <TabsContent forceMount key="overview" value="overview" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
                  <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  {aboutCopy && (
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <PreviewIcon icon="mdi:file-document-outline" size={16} className="text-[#F51042]" />
                        {kitchen.description ? t("aboutThisKitchen") : t("aboutThisSpace")}
                      </h3>
                      <p className="text-[#6B6B6B] leading-relaxed whitespace-pre-wrap">
                        {aboutCopy}
                      </p>
                    </div>
                  )}
                  
                  {kitchen.availability && kitchen.availability.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <PreviewIcon icon="mdi:calendar" size={16} className="text-[#F51042]" />
                        {t("weeklyAvailability")}
                      </h3>
                      <AvailabilityDisplay availability={kitchen.availability} />
                    </div>
                  )}
                  
                  {kitchen.amenities && Array.isArray(kitchen.amenities) && kitchen.amenities.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <PreviewIcon icon="mdi:format-list-checks" size={16} className="text-[#F51042]" />
                        {t("kitchenAmenities")}
                      </h3>
                      <KitchenAmenitiesList amenities={kitchen.amenities} />
                    </div>
                  )}
                  
                  {locationAddress && (
                    <div className="pt-4 border-t border-border/50">
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <PreviewIcon icon="mdi:map-marker" size={16} className="text-[#F51042]" />
                        {t("location")}
                      </h3>
                      <LocationMap
                        address={locationAddress}
                        name={locationName || kitchen.name}
                        heightClassName="h-[220px]"
                      />
                    </div>
                  )}
                </motion.div>
                </TabsContent>
              )}
              
              {activeTab === "equipment" && hasEquipment && (
                <TabsContent forceMount key="equipment" value="equipment" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <KitchenEquipmentSections kitchen={kitchen} />
                  </motion.div>
                </TabsContent>
              )}
              
              {activeTab === "storage" && hasStorage && (
                <TabsContent forceMount key="storage" value="storage" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <KitchenStorageSections kitchen={kitchen} />
                  </motion.div>
                </TabsContent>
              )}
            </AnimatePresence>
          </CardContent>
        </Tabs>
      </Card>
      )}
    </motion.div>
  );
}

function headerOffsetPx(chefChrome: boolean, staticSiteHeader: boolean) {
  if (chefChrome) return 64;
  if (staticSiteHeader) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--header-height").trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 96;
}

const PREVIEW_DOCK_HEIGHT_PX = 56; // h-14

/** Activation line for dock scroll-spy / nav scroll — just under sticky chrome. */
function previewSpyOffsetPx(args: {
  chefChrome: boolean;
  staticSiteHeader: boolean;
  dockVisible: boolean;
}) {
  const header = headerOffsetPx(args.chefChrome, args.staticSiteHeader);
  return header + (args.dockVisible ? PREVIEW_DOCK_HEIGHT_PX : 0) + 8;
}

const PREVIEW_SPY_SECTION_IDS = [
  "preview-overview",
  "preview-amenities",
  "preview-equipment",
  "preview-storage",
  "preview-location",
  "preview-things-to-know",
] as const;

function resolvePreviewActiveSection(spyOffset: number): string | null {
  const sections: { id: string; top: number }[] = [];
  for (const id of PREVIEW_SPY_SECTION_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    sections.push({ id, top: el.getBoundingClientRect().top });
  }
  if (sections.length === 0) return null;

  // Visual order (side-by-side equipment/storage share a top).
  sections.sort((a, b) => a.top - b.top);

  const doc = document.documentElement;
  const nearBottom = window.scrollY + window.innerHeight >= doc.scrollHeight - 72;
  return pickPreviewActiveSectionId(sections, spyOffset, nearBottom);
}

function scrollToPreviewSection(id: string, offset: number) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = window.scrollY + el.getBoundingClientRect().top - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

function ctaUsableInViewport(
  el: Element | null,
  topInset: number,
  wasInView: boolean
) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const visible = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, topInset);
  if (visible <= 0) return false;
  return wasInView ? visible >= 8 : visible >= 36;
}

/** Hysteresis so the sticky tour chip does not flicker at the fold. */
function tourAnchorInView(el: Element | null, headerPx: number, wasInView: boolean) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.top >= window.innerHeight) return false;
  if (wasInView) return r.bottom > headerPx;
  return r.bottom > headerPx + 48;
}

const DOCK_EASE = [0.32, 0.72, 0, 1] as const;
const DOCK_FADE_EASE = [0.22, 1, 0.36, 1] as const;

/** Horizontal CTA chip enter/exit — matches sticky-tour softness, no layout pop. */
function DockCtaChip({
  show,
  reduceMotion,
  className,
  children,
}: {
  show: boolean;
  reduceMotion: boolean | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          key="dock-cta-chip"
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 8 }}
          transition={{
            duration: reduceMotion ? 0 : 0.28,
            ease: DOCK_FADE_EASE,
          }}
          className={cn("shrink-0 overflow-hidden", className)}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function KitchenPreviewDockNav({
  visible,
  links,
  activeId,
  cta,
  positionClass,
  contentClassName,
  onNavigate,
}: {
  visible: boolean;
  links: { id: string; label: string }[];
  activeId: string;
  cta: ReactNode;
  positionClass: string;
  contentClassName: string;
  onNavigate: (id: string) => void;
}) {
  const { t } = useTranslation("kitchen");
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={cn(
        "fixed z-50 border-b shadow-md bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        positionClass,
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none -translate-y-full opacity-0"
      )}
      aria-hidden={!visible}
    >
      <div className={cn("flex h-14 items-center gap-3 sm:gap-4", contentClassName)}>
        <nav className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5 overflow-x-auto" aria-label={t("kitchenSectionsNav", "Kitchen sections")}>
          {links.map((link) => {
            const isActive = activeId === link.id;
            return (
              <a
                key={link.id}
                href={`#${link.id}`}
                aria-current={isActive ? "location" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(link.id);
                }}
                className={cn(
                  "shrink-0 whitespace-nowrap py-2 text-sm font-medium border-b-2 transition-colors duration-200",
                  isActive
                    ? "border-[#F51042] text-gray-900"
                    : "border-transparent text-gray-500 hover:text-gray-900"
                )}
              >
                {link.label}
              </a>
            );
          })}
        </nav>
        {cta}
      </div>
    </div>,
    document.body
  );
}

export default function KitchenPreviewPage() {
  const { t } = useTranslation("kitchen");
  const { t: tChef } = useTranslation("chef");
  const [locationPath, navigate] = useLocation();
  const { user, loading: authLoading } = useFirebaseAuth();
  const { openAuthModal } = useAuthModal();
  const isAuthenticated = !!user;
  const useChefChrome = isChefUser(user);
  const staticSiteHeader = !isAuthenticated;
  const reduceMotion = useReducedMotion();

  const locationIdMatch = locationPath.match(/\/kitchen-preview\/(.+)/);
  const identifier = locationIdMatch ? locationIdMatch[1] : null;

  const [selectedKitchen, setSelectedKitchen] = useState<PublicKitchen | null>(null);
  const [kitchenEquipment, setKitchenEquipment] = useState<{ included: EquipmentListing[]; rental: EquipmentListing[] } | null>(null);
  const [kitchenStorage, setKitchenStorage] = useState<StorageListing[] | null>(null);
  const [isLoadingAddons, setIsLoadingAddons] = useState(false);
  const [activeView, setActiveView] = useState("discover-kitchens");
  const [tourModalOpen, setTourModalOpen] = useState(false);
  const [inventoryModal, setInventoryModal] = useState<"equipment" | "storage" | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [datesOk, setDatesOk] = useState(false);
  const [activeSection, setActiveSection] = useState("preview-overview");
  const [photosInView, setPhotosInView] = useState(true);
  const [tourInView, setTourInView] = useState(true);
  /** Sticky tour under apply — dock only after this scrolls away. */
  const [stickyTourInView, setStickyTourInView] = useState(true);
  const [applyInView, setApplyInView] = useState(true);

  const { preview: bookingPricePreview } = usePersistedBookingPricePreview(
    selectedKitchen?.id != null ? String(selectedKitchen.id) : undefined
  );

  const { data: locationData, isLoading, error } = useQuery<PublicLocation & { kitchens: PublicKitchen[], slug?: string }>({
    queryKey: [`/api/public/locations/${identifier}/details`],
    queryFn: async () => {
      const response = await fetch(`/api/public/locations/${identifier}/details`);
      if (!response.ok) throw new Error(kt("locationNotFound"));
      return response.json();
    },
    enabled: !!identifier,
    placeholderData: keepPreviousData,
  });

  // Wouter keeps window.scrollY across client navigations (e.g. a scrolled
  // discover list). Reset before paint, and again once real content replaces
  // the loading skeleton so the map/calendar cannot leave you mid-page.
  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration;
    try {
      window.history.scrollRestoration = "manual";
    } catch {
      /* ignore */
    }
    const reset = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };
    reset();
    const frame = window.requestAnimationFrame(reset);
    return () => {
      window.cancelAnimationFrame(frame);
      try {
        window.history.scrollRestoration = previous || "auto";
      } catch {
        /* ignore */
      }
    };
  }, [identifier, isLoading, authLoading]);

  const locationId = locationData?.id;
  const previewSlug = locationData?.slug || identifier;

  // Canonicalize numeric IDs (e.g. /kitchen-preview/94) to the location slug.
  useEffect(() => {
    if (!identifier || !locationData?.slug) return;
    let current = identifier;
    try {
      current = decodeURIComponent(identifier);
    } catch {
      // keep raw identifier
    }
    if (current !== locationData.slug) {
      navigate(`/kitchen-preview/${locationData.slug}`, { replace: true });
    }
  }, [identifier, locationData?.slug, navigate]);

  const { data: tourStatus, isLoading: tourStatusLoading } = useQuery<{
    isActive?: boolean;
    hasSchedule?: boolean;
    toursAvailable?: boolean;
  }>({
    queryKey: [`/api/viewings/location/${locationId}/is-active`],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/viewings/location/${locationId}/is-active`, {
        headers,
        credentials: "include",
      });
      if (!response.ok) return { toursAvailable: false };
      return response.json();
    },
    enabled: !!locationId,
  });
  const toursAvailable = tourStatus?.toursAvailable ?? tourStatus?.isActive ?? false;

  // Existing tour request for this location (pending / confirmed).
  type ChefViewingRow = {
    viewing?: { id: number; locationId: number; status: string; scheduledAt: string };
    id?: number;
    locationId?: number;
    status?: string;
    scheduledAt?: string;
  };
  const { data: chefViewings = [], isFetched: chefViewingsFetched } = useQuery<ChefViewingRow[]>({
    queryKey: ["/api/viewings", "chef", user?.uid],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/viewings/chef", {
        headers,
        credentials: "include",
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!isAuthenticated && !!user?.uid,
  });
  const activeLocationTour = useMemo(() => {
    if (!locationId || !chefViewings.length) return null;
    const ACTIVE = new Set(["pending", "confirmed"]);
    const rows = chefViewings
      .map((r) => r.viewing ?? r)
      .filter(
        (v): v is { id: number; locationId: number; status: string; scheduledAt: string } =>
          !!v &&
          typeof v.id === "number" &&
          Number(v.locationId) === Number(locationId) &&
          ACTIVE.has(String(v.status || "").toLowerCase())
      )
      .sort(
        (a, b) =>
          new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
      );
    return rows[0] ?? null;
  }, [chefViewings, locationId]);
  const activeTourStatus = String(activeLocationTour?.status || "").toLowerCase();
  const activeTourKind: "pending" | "confirmed" | null = !activeLocationTour
    ? null
    : activeTourStatus === "confirmed"
      ? "confirmed"
      : "pending";

  // Resume an in-progress tour draft after login. Never reopen once a tour
  // is already pending/confirmed — leftover sessionStorage used to pop the dialog
  // on every preview visit.
  useEffect(() => {
    if (!locationId) return;
    const key = `viewing_booking_${locationId}`;
    try {
      if (isAuthenticated && user?.uid && !chefViewingsFetched) return;
      if (activeLocationTour) {
        sessionStorage.removeItem(key);
        return;
      }
      if (!isAuthenticated) return;
      if (sessionStorage.getItem(key)) setTourModalOpen(true);
    } catch {
      /* ignore */
    }
  }, [locationId, isAuthenticated, user, activeLocationTour, chefViewingsFetched]);

  const {
    application: locationApplication,
    hasApplication: locationHasApplication,
    canBook: locationCanBook,
    isLoading: locationApplicationLoading,
  } = useChefKitchenApplicationForLocation(isAuthenticated && locationId ? locationId : null);
  const { applications, isLoading: applicationsListLoading } = useChefKitchenApplications();
  const { applications: globalApplications, isLoading: globalApplicationsLoading } = useGlobalMyApplications();
  const listApplication = useMemo(
    () => applications.find((app) => kitchenLocationId(app) === locationId) ?? null,
    [applications, locationId]
  );
  
  // Find the most recent global application (Step 1)
  const globalApplication = globalApplications?.[0] || null;
  const globalAppPending = globalApplication?.status === 'inReview';
  const application = locationApplication ?? listApplication;
  const hasApplication = locationHasApplication || Boolean(listApplication);
  const kitchenDisplay =
    application?.status ? getKitchenDisplayStatus(application, tChef) : null;
  const canBook = locationCanBook || kitchenDisplay?.actionKind === "book";
  // NOTE - Application model (3 distinct things, do NOT confuse them):
  //   1. Seller application  -> /applications, Sell on LocalCooks (independent)
  //   2. Global application  -> /api/firebase/applications
  //      *This* is Step 1 of the chef_kitchen_application process
  //      (admin-approved, personal/business info for the chef).
  //   3. Kitchen application -> /api/firebase/chef/kitchen-applications
  //      The chef_kitchen_application row per location with Tier 1/2/3.
  //
  // For `alreadyApplied` below we ONLY care about #3 - whether a
  // chef_kitchen_application row EXISTS for this location (from either
  // the per-location query OR the list query), regardless of status.
  // "new", "pending", "inreview", "approved", "rejected", "cancelled" -
  // each still means the chef submitted Tier 1 info (collected during the
  // booking-calendar registration flow) and should see the application
  // details / "View Application" flow instead of the "Continue to Apply"
  // booking journey. The previous check used isActiveKitchenApplication
  // which only covered inreview/approved/pending, so "new" (just
  // submitted, admin hasn't moved status) / "rejected" / "cancelled" all
  // incorrectly re-showed the booking-journey modal with "Continue to Apply".
  const perLocationHasKitchenApp = Boolean(locationApplication);
  const perListHasKitchenApp = Boolean(listApplication);
  const alreadyApplied = perLocationHasKitchenApp || perListHasKitchenApp;
  const applicationLoading =
    Boolean(isAuthenticated && locationId) &&
    !application &&
    (locationApplicationLoading || applicationsListLoading);

  // Debug logging
  useEffect(() => {
    if (isAuthenticated && locationId) {
      logger.info('[KitchenPreviewPage] Application status:', {
        hasApplication,
        canBook,
        applicationStatus: application?.status,
        isLoading: applicationLoading,
        locationId
      });
    }
  }, [isAuthenticated, locationId, hasApplication, canBook, application?.status, applicationLoading]);

  // Keep selection on the current kitchen when switching units at this location;
  // reset when the location changes or the prior kitchen is gone.
  useEffect(() => {
    const kitchens = locationData?.kitchens;
    if (!kitchens?.length) {
      setSelectedKitchen(null);
      return;
    }
    setSelectedKitchen((prev) => {
      if (prev && kitchens.some((k) => k.id === prev.id)) return prev;
      try {
        const preferred = new URLSearchParams(window.location.search).get("kitchenId");
        if (preferred) {
          const match = kitchens.find((k) => String(k.id) === preferred);
          if (match) return match;
        }
      } catch {
        /* ignore */
      }
      return kitchens[0];
    });
  }, [locationData?.id, locationData?.kitchens]);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const headerPx = headerOffsetPx(useChefChrome, staticSiteHeader);
      const photos = document.getElementById("preview-photos");
      const tour = document.getElementById("preview-tour");
      const stickyTour = document.getElementById("preview-tour-sticky");
      const apply = document.getElementById("preview-apply");
      const photosStillInView = photos
        ? photos.getBoundingClientRect().bottom > headerPx + 8
        : true;
      const dockVisible = !isAuthenticated && !photosStillInView;
      const ctaInset = headerPx + (dockVisible ? PREVIEW_DOCK_HEIGHT_PX : 0);
      const spyOffset = previewSpyOffsetPx({
        chefChrome: useChefChrome,
        staticSiteHeader,
        dockVisible,
      });

      const nextSection = resolvePreviewActiveSection(spyOffset);
      if (nextSection) {
        setActiveSection((prev) => (prev === nextSection ? prev : nextSection));
      }

      setPhotosInView(photosStillInView);
      setTourInView((wasInView) => tourAnchorInView(tour, ctaInset, wasInView));
      // Sticky tour mounts only after the fact-row tour scrolls away. Until then,
      // treat it as in-view so the dock does not show tour early.
      if (!stickyTour) {
        setStickyTourInView(true);
      } else {
        setStickyTourInView((wasInView) => tourAnchorInView(stickyTour, ctaInset, wasInView));
      }
      setApplyInView((wasInView) => ctaUsableInViewport(apply, ctaInset, wasInView));
    };
    const onScrollOrResize = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [
    identifier,
    selectedKitchen,
    kitchenEquipment,
    kitchenStorage,
    alreadyApplied,
    toursAvailable,
    tourStatusLoading,
    activeLocationTour,
    isLoading,
    useChefChrome,
    staticSiteHeader,
    calendarOpen,
    isAuthenticated,
  ]);

  useEffect(() => {
    setInventoryModal(null);
  }, [selectedKitchen?.id]);

  // Fetch equipment and storage when kitchen is selected (public — works logged out)
  useEffect(() => {
    const fetchKitchenAddons = async () => {
      if (!selectedKitchen) {
        setKitchenEquipment(null);
        setKitchenStorage(null);
        setIsLoadingAddons(false);
        return;
      }

      setIsLoadingAddons(true);
      setKitchenEquipment(null);
      setKitchenStorage(null);
      try {
        // Fetch equipment listings (public browse endpoint)
        try {
          const equipmentResponse = await fetch(`/api/public/kitchens/${selectedKitchen.id}/equipment-listings`);
          if (equipmentResponse.ok) {
            const equipmentData = await equipmentResponse.json();
            setKitchenEquipment({
              included: (equipmentData.included || []).map((e: EquipmentListing & { sessionRate?: number }) => ({
                id: e.id,
                category: e.category,
                equipmentType: e.equipmentType,
                brand: e.brand,
                model: e.model,
                description: e.description,
                availabilityType: e.availabilityType,
                sessionRate: e.sessionRate ? e.sessionRate / 100 : undefined,
                currency: e.currency || "CAD",
              })),
              rental: (equipmentData.rental || []).map((e: EquipmentListing & { sessionRate?: number }) => ({
                id: e.id,
                category: e.category,
                equipmentType: e.equipmentType,
                brand: e.brand,
                model: e.model,
                description: e.description,
                availabilityType: e.availabilityType,
                sessionRate: e.sessionRate ? e.sessionRate / 100 : undefined,
                currency: e.currency || "CAD",
              })),
            });
          } else {
            setKitchenEquipment({ included: [], rental: [] });
          }
        } catch (error) {
          logger.error(`Failed to fetch equipment for kitchen ${selectedKitchen.id}:`, error);
          setKitchenEquipment({ included: [], rental: [] });
        }

        // Fetch storage listings (public browse endpoint)
        try {
          const storageResponse = await fetch(`/api/public/kitchens/${selectedKitchen.id}/storage-listings`);
          if (storageResponse.ok) {
            const storageData = await storageResponse.json();
            setKitchenStorage((storageData || []).map((s: StorageListing & { basePrice?: number; pricePerCubicFoot?: number }) => ({
              id: s.id,
              storageType: s.storageType,
              name: s.name,
              description: s.description,
              basePrice: s.basePrice ? s.basePrice / 100 : undefined,
              pricePerCubicFoot: s.pricePerCubicFoot ? s.pricePerCubicFoot / 100 : undefined,
              pricingModel: s.pricingModel,
              dimensionsLength: s.dimensionsLength,
              dimensionsWidth: s.dimensionsWidth,
              dimensionsHeight: s.dimensionsHeight,
              totalVolume: s.totalVolume,
              climateControl: s.climateControl,
              currency: s.currency || "CAD",
            })));
          } else {
            setKitchenStorage([]);
          }
        } catch (error) {
          logger.error(`Failed to fetch storage for kitchen ${selectedKitchen.id}:`, error);
          setKitchenStorage([]);
        }
      } catch (error) {
        logger.error('Error fetching kitchen addons:', error);
        setKitchenEquipment({ included: [], rental: [] });
        setKitchenStorage([]);
      } finally {
        setIsLoadingAddons(false);
      }
    };

    fetchKitchenAddons();
  }, [selectedKitchen]);

  const goToChefApplications = useCallback(() => {
    const { path, href, sameOrigin } = resolveChefDashboardNavigation(
      "applications",
      window.location.hostname,
      window.location.port,
      import.meta.env.VITE_VERCEL_ENV
    );
    if (sameOrigin) {
      navigate(path, { replace: true });
    } else {
      window.location.href = href;
    }
  }, [navigate]);

  const goToMyTours = useCallback(() => {
    const { path, href, sameOrigin } = resolveChefDashboardNavigation(
      "viewings",
      window.location.hostname,
      window.location.port,
      import.meta.env.VITE_VERCEL_ENV
    );
    if (sameOrigin) {
      navigate(path, { replace: true });
    } else {
      window.location.href = href;
    }
  }, [navigate]);

  const openRequestToApplyModal = () => {
    if (locationData?.canAcceptApplications === false) return;
    if (alreadyApplied) {
      goToChefApplications();
      return;
    }
    const kitchenId = selectedKitchen?.id?.toString();
    saveAuthIntentFromCurrentPage("book", locationId || kitchenId, kitchenId);
    try {
      if (locationId || kitchenId) {
        sessionStorage.setItem(
          "pendingRegistrationKitchenContext",
          JSON.stringify({
            locationId: locationId || kitchenId,
            kitchenId,
            kitchenName: selectedKitchen?.name || locationData?.name,
          })
        );
      }
    } catch {
      /* ignore */
    }
    openAuthModal({
      title: t("requestToApply", "Request to apply"),
      requireApplication: true,
      defaultTab: "register",
      bookingContext: kitchenId
        ? {
            kitchenId,
            kitchenName: selectedKitchen?.name,
            equipmentListings: kitchenEquipment
              ? { included: kitchenEquipment.included, rental: kitchenEquipment.rental }
              : null,
            storageListings: kitchenStorage ?? null,
          }
        : undefined,
    });
  };

  const openBookingPage = () => {
    if (!locationId) return;
    const kitchenQuery = selectedKitchen?.id != null ? `?kitchenId=${selectedKitchen.id}` : "";
    navigate(`/book/${locationId}${kitchenQuery}`);
  };

  const handleGetStarted = () => {
    if (canBook) {
      openBookingPage();
      return;
    }
    if (alreadyApplied) {
      goToChefApplications();
      return;
    }
    openRequestToApplyModal();
  };

  const handleBookClick = () => {
    if (canBook) {
      openBookingPage();
    } else if (alreadyApplied) {
      goToChefApplications();
    } else if (locationData?.canAcceptApplications !== false) {
      openRequestToApplyModal();
    }
  };

  const handleApplyClick = () => {
    openRequestToApplyModal();
  };

  const handleScheduleTour = () => {
    if (!locationId) return;
    if (alreadyApplied) return;
    if (activeLocationTour) {
      goToMyTours();
      return;
    }
    if (!isAuthenticated) {
      saveAuthIntentFromCurrentPage("tour", locationId);
    }
    setTourModalOpen(true);
  };

  // Loading content for dashboard
  const loadingContent = (
    <div className="space-y-6">
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-3 space-y-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <div className="col-span-9">
          <Skeleton className="h-[500px] w-full rounded-xl" />
        </div>
      </div>
    </div>
  );

  // Error/Not found content
  const notFoundContent = (
    <div className="text-center py-16">
      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
        <PreviewIcon icon="mdi:image-off" size={32} className="text-muted-foreground" />
      </div>
      <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-2">{t("locationNotFound", "Location Not Found")}</h1>
      <p className="text-sm sm:text-base text-muted-foreground mb-6">{t("locationNotFoundDesc", "This kitchen location doesn't exist or has been removed.")}</p>
      <Button
        onClick={() => isAuthenticated ? navigate('/dashboard?view=discover-kitchens') : navigate('/')}
        variant="default"
      >
        {isAuthenticated ? t("backToDiscoverKitchens", "Back to Discover Kitchens") : t("backToHome", "Back to Home")}
      </Button>
    </div>
  );

  // Main kitchen preview content — same layout for guests and signed-in chefs
  const mainContent = (locationData: PublicLocation & { kitchens: PublicKitchen[] }) => {
    const { kitchens, ...location } = locationData;
    const display = kitchenDisplay;
    const canReapply = display?.actionKind === "discover";
    const ctaSpec = resolvePreviewPrimaryCta({
      t: (key, fallback) => t(key, fallback ?? key),
      applicationLoading,
      canBook,
      alreadyApplied,
      globalAppPending,
      canAcceptApplications: location.canAcceptApplications !== false,
      display,
    });
    const bookingDatesReady = kitchenReadyForDateBooking(selectedKitchen);
    const showDateGatedApplyCta = !!ctaSpec;
    const requireDatesForApply =
      bookingDatesReady && (ctaSpec?.requireDates ?? true);

    const hoursSummary = availableDaySummary(selectedKitchen?.availability, t);
    const includedCount = kitchenEquipment?.included?.length ?? 0;
    const rentalCount = kitchenEquipment?.rental?.length ?? 0;
    const storageCount = kitchenStorage?.length ?? 0;
    const amenityCount = selectedKitchen?.amenities?.length ?? 0;

    const heroHelper = (() => {
      if (applicationLoading) return null;
      if (activeLocationTour && !alreadyApplied) {
        return activeLocationTour.status === "confirmed"
          ? t(
              "tourConfirmedNotice",
              "Your tour is confirmed. See the time and details under My Tours."
            )
          : t(
              "tourPendingNotice",
              "You’ve already requested a tour here. We’re waiting on the kitchen to confirm."
            );
      }
      if (!isAuthenticated && location.canAcceptApplications === false) {
        return t(
          "notAcceptingAppsNotice",
          "This location isn’t accepting new chef applications yet. You’re welcome to look around and check back later."
        );
      }
      if (!isAuthenticated || (!alreadyApplied && !canBook && !globalAppPending && location.canAcceptApplications !== false)) {
        return t(
          "applyFirstThenBook",
          "Request to apply first — booking opens after you’re approved."
        );
      }
      if (canBook || display?.actionKind === "book") {
        return t(
          "youAreApprovedBookNotice",
          "You’re approved here. Book a cooking session whenever you’re ready."
        );
      }
      if (display?.actionKind === "complete-step") {
        return t(
          "finishRemainingStepsNotice",
          "A few steps remain, then you can start booking sessions here."
        );
      }
      if (alreadyApplied) {
        return display?.label === "In review"
          ? t(
              "alreadyAppliedInReview",
              "The kitchen is reviewing your application. You can book once you’re approved."
            )
          : t(
              "alreadyAppliedReviewFinished",
              "You can book sessions once this kitchen finishes review."
            );
      }
      if (canReapply) {
        return application?.status === "rejected"
          ? t(
              "applicationRejectedReapply",
              "Your last application wasn’t approved. You’re welcome to apply again with updated details."
            )
          : t(
              "applicationCancelledReapply",
              "Your previous application was cancelled. You can apply again if you’d still like to cook here."
            );
      }
      if (globalAppPending) {
        return t(
          "globalApplicationUnderReview",
          "Your initial application is currently under review by our team."
        );
      }
      if (location.canAcceptApplications === false) {
        return t("notAcceptingNewChefApps");
      }
      return null;
    })();

    const tourCta = (() => {
      if (alreadyApplied) return null;
      // Wait for availability + existing tours so we don't flash "Request a tour"
      // over a pending/confirmed visit.
      if (tourStatusLoading) return null;
      if (isAuthenticated && !chefViewingsFetched) return null;
      if (activeTourKind) return { kind: activeTourKind };
      if (!toursAvailable) return null;
      return { kind: "request" as const };
    })();

    const tourTitle =
      tourCta?.kind === "confirmed"
        ? t("tourConfirmedCta", "Tour confirmed")
        : tourCta?.kind === "pending"
          ? t("tourPendingCta", "Tour pending")
          : t("requestATour", "Request a tour");
    const tourHint =
      tourCta?.kind === "confirmed"
        ? t("tourConfirmedChipHint", "View time and details in My Tours")
        : tourCta?.kind === "pending"
          ? t("tourPendingChipHint", "Waiting on the kitchen — open My Tours")
          : t("requestATourHint", "Visit kitchen before applying");
    const tourOnClick =
      tourCta?.kind === "confirmed" || tourCta?.kind === "pending" ? goToMyTours : handleScheduleTour;
    const tourIcon =
      tourCta?.kind === "confirmed"
        ? "mdi:calendar-check"
        : tourCta?.kind === "pending"
          ? "mdi:calendar-clock"
          : "mdi:calendar-account";

    const tourSurfaceClass =
      tourCta?.kind === "request"
        ? cn("bg-[#F51042] text-white hover:bg-[#E00A38]", PREMIUM_PRIMARY_SHADOW)
        : tourCta?.kind === "confirmed"
          ? cn(
              "border border-emerald-200/90 bg-emerald-50 text-emerald-950 hover:bg-emerald-100/80",
              PREMIUM_CTA_SHADOW
            )
          : tourCta?.kind === "pending"
            ? cn(
                "border border-amber-200/90 bg-amber-50 text-amber-950 hover:bg-amber-100/80",
                PREMIUM_CTA_SHADOW
              )
            : "";
    const tourTitleClass =
      tourCta?.kind === "request"
        ? "text-white"
        : tourCta?.kind === "confirmed"
          ? "text-emerald-900"
          : "text-amber-900";
    const tourHintClass =
      tourCta?.kind === "request"
        ? "text-white/85"
        : tourCta?.kind === "confirmed"
          ? "text-emerald-800/80"
          : "text-amber-800/80";
    const tourIconWrapClass =
      tourCta?.kind === "request"
        ? "bg-white/20 text-white"
        : tourCta?.kind === "confirmed"
          ? "bg-emerald-600 text-white"
          : "bg-amber-500 text-white";
    const tourChevronClass =
      tourCta?.kind === "request"
        ? "text-white"
        : tourCta?.kind === "confirmed"
          ? "text-emerald-700"
          : "text-amber-700";
    const tourEyebrowClass =
      tourCta?.kind === "request"
        ? "text-white/90"
        : tourCta?.kind === "confirmed"
          ? "text-emerald-700"
          : "text-amber-700";

    const tourButton = !tourCta ? null : (
      <button
        type="button"
        data-preview-tour="schedule"
        onClick={tourOnClick}
        className={cn(
          "w-full min-w-0 rounded-xl px-4 py-3.5 text-left transition-colors",
          tourSurfaceClass
        )}
      >
        <span className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
              tourIconWrapClass
            )}
          >
            <PreviewIcon icon={tourIcon} size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn("block text-sm font-semibold", tourTitleClass)}>{tourTitle}</span>
            <span className={cn("mt-0.5 block text-xs", tourHintClass)}>{tourHint}</span>
          </span>
          <PreviewIcon icon="mdi:chevron-right" size={18} className={tourChevronClass} />
        </span>
      </button>
    );

    const tourFactCard = !tourCta ? null : (
      <button
        type="button"
        data-preview-tour="schedule"
        onClick={tourOnClick}
        className={cn(
          "flex h-full w-full flex-col justify-center rounded-xl px-4 py-3 text-left transition-colors",
          tourSurfaceClass
        )}
      >
        <p className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider", tourEyebrowClass)}>
          <PreviewIcon icon={tourIcon} size={14} />
          {tourTitle}
        </p>
        <p className={cn("mt-1 flex items-start gap-1 text-sm font-medium leading-snug", tourTitleClass)}>
          <span className="min-w-0">{tourHint}</span>
          <PreviewIcon icon="mdi:chevron-right" size={16} className={cn("mt-0.5 shrink-0", tourChevronClass)} />
        </p>
      </button>
    );

    // Dock tour only after the sticky-under-apply tour scrolls away (second position).
    const showDockTour = !!tourCta && !tourInView && !stickyTourInView;
    const showDockApply = !applyInView && showDateGatedApplyCta;
    const dockTourPairedWithApply = showDockTour && showDockApply;

    const showDockTotal = showDockApply && !!bookingPricePreview;

    const applyCtaButton = showDateGatedApplyCta && ctaSpec ? (
      <Button
        size="sm"
        variant={ctaSpec.variant === "outline" ? "outline" : "default"}
        className={cn("shrink-0 font-semibold", previewApplyCtaClass(ctaSpec.variant))}
        disabled={ctaSpec.kind === "pending" || ctaSpec.kind === "loading"}
        onClick={() => {
          if (requireDatesForApply && !datesOk) {
            setCalendarOpen(true);
            document
              .getElementById("preview-dates")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }
          handleGetStarted();
        }}
      >
        {ctaSpec.label}
      </Button>
    ) : null;

    const dockCtaSlot = (
      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        {showDockTotal && bookingPricePreview ? (
          <DockBookingTotalBesideApply
            preview={bookingPricePreview}
            className="hidden max-w-[10rem] sm:block"
          />
        ) : null}
        <DockCtaChip show={showDockApply && !!ctaSpec} reduceMotion={reduceMotion}>
          {applyCtaButton}
        </DockCtaChip>
        <DockCtaChip show={showDockTour && !!tourCta} reduceMotion={reduceMotion}>
          {tourCta ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(
                "shrink-0 font-semibold",
                previewDockTourCtaClass(tourCta.kind, dockTourPairedWithApply)
              )}
              onClick={tourOnClick}
            >
              {tourTitle}
            </Button>
          ) : null}
        </DockCtaChip>
      </div>
    );

    const amenitiesDockId = selectedKitchen?.amenities?.length
      ? "preview-amenities"
      : !isLoadingAddons && (includedCount > 0 || rentalCount > 0)
        ? "preview-equipment"
        : !isLoadingAddons && storageCount > 0
          ? "preview-storage"
          : null;

    return (
      <div className={cn("font-sans space-y-5 sm:space-y-6", "pb-24 lg:pb-0")}>
        <Helmet>
          <title>{location.name} Commercial Kitchen | Local Cooks</title>
          <meta
            name="description"
            content={
              location.description ||
              `See photos, hours, equipment, and pricing for ${location.name}.`
            }
          />
        </Helmet>

        {/* Identity above gallery */}
        <div className="flex items-start gap-3 min-w-0">
          {location.logoUrl ? (
            <SmartImage
              src={location.logoUrl}
              alt={location.name}
              className="h-10 w-10 sm:h-12 sm:w-12 rounded-lg object-cover flex-shrink-0"
            />
          ) : null}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{location.name}</h1>
              {alreadyApplied && display && (
                <Badge variant={toneToBadgeVariant(display.tone)} className="text-xs font-medium">
                  {display.label}
                </Badge>
              )}
              {location.kitchenLicenseStatus === "pending" && (
                <Badge variant="warning" className="text-xs">
                  <PreviewIcon icon="mdi:clock-outline" size={12} className="mr-1" />
                  {t("verificationInProgress")}
                </Badge>
              )}
              {location.kitchenLicenseStatus === "approved" && (
                <Badge variant="success" className="text-xs">
                  <PreviewIcon icon="mdi:shield-check" size={12} className="mr-1" />
                  {t("licensedKitchenBadge", "Licensed kitchen")}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-600">{location.address}</p>
            <p className="mt-0.5 text-sm text-gray-500">
              {t("kitchensAtThisLocationPrefix", {
                count: kitchens.length,
                defaultValue: `${kitchens.length} ${kitchens.length === 1 ? "kitchen" : "kitchens"}`,
              })}{" "}
              {t("kitchensAtThisLocationSuffix", "at this location")}
              {location.canAcceptApplications === false
                ? ` · ${t("notAcceptingNewApplicationsYet", "Not accepting new applications yet")}`
                : ""}
            </p>
          </div>
        </div>

        {/* Full-width photo gallery */}
        {selectedKitchen ? (
          <div id="preview-photos" className="scroll-mt-32">
            <KitchenPhotoCollage
              images={getKitchenImages(selectedKitchen)}
              kitchenName={selectedKitchen.name}
            />
          </div>
        ) : (
          <div id="preview-photos" className="w-full h-[200px] sm:h-[260px] lg:h-[300px] rounded-2xl bg-gray-100 scroll-mt-32" />
        )}

        {!isAuthenticated && (
          <KitchenPreviewDockNav
            visible={!photosInView}
            positionClass={
              staticSiteHeader
                ? "top-0 left-0 right-0"
                : "top-[var(--header-height)] left-0 right-0"
            }
            contentClassName="mx-auto w-full max-w-7xl px-4 sm:px-6"
            links={[
              { id: "preview-photos", label: t("photos", "Photos") },
              { id: "preview-overview", label: t("overviewTab", "Overview") },
              ...(amenitiesDockId
                ? [{ id: amenitiesDockId, label: t("amenities", "Amenities") }]
                : []),
              { id: "preview-location", label: t("whereItIs", "Location") },
              { id: "preview-things-to-know", label: t("thingsToKnowTitle", "Before You Book") },
            ]}
            activeId={
              ["preview-amenities", "preview-equipment", "preview-storage"].includes(activeSection)
                ? amenitiesDockId ?? activeSection
                : activeSection
            }
            onNavigate={(id) => {
              if (id === "preview-photos") {
                setActiveSection("preview-overview");
                window.scrollTo({ top: 0, behavior: "smooth" });
                return;
              }
              setActiveSection(id);
              scrollToPreviewSection(
                id,
                previewSpyOffsetPx({
                  chefChrome: useChefChrome,
                  staticSiteHeader,
                  dockVisible: true,
                })
              );
            }}
            cta={dockCtaSlot}
          />
        )}

        {typeof document !== "undefined"
          ? createPortal(
              <AnimatePresence initial={false}>
                {!applyInView || showDockTour ? (
                  <motion.div
                    key="preview-booking-dock"
                    initial={{ y: "100%", opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: "100%", opacity: 0 }}
                    transition={{
                      duration: reduceMotion ? 0 : 0.32,
                      ease: DOCK_EASE,
                    }}
                    className="fixed bottom-0 inset-x-0 z-40 border-t bg-white/95 py-3 shadow-[0_-8px_24px_-8px_rgba(15,23,42,0.1)] lg:hidden pb-[max(0.75rem,env(safe-area-inset-bottom))]"
                  >
                    <div className="mx-auto flex max-w-7xl items-center justify-end gap-2 px-4 sm:gap-3 sm:px-6">
                      {showDockApply ? (
                        <>
                          {showDockTotal && bookingPricePreview ? (
                            <DockBookingTotalBesideApply
                              preview={bookingPricePreview}
                              className="min-w-0 max-w-[9.5rem] sm:max-w-[11rem]"
                            />
                          ) : null}
                          <DockCtaChip show={showDateGatedApplyCta} reduceMotion={reduceMotion} className="shrink-0">
                            {applyCtaButton}
                          </DockCtaChip>
                        </>
                      ) : null}
                      <DockCtaChip
                        show={showDockTour && !!tourCta}
                        reduceMotion={reduceMotion}
                        className={!showDockApply ? "min-w-0 flex-1" : "shrink-0"}
                      >
                        {tourCta ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn(
                              "font-semibold",
                              !showDockApply && "w-full",
                              previewDockTourCtaClass(tourCta.kind, dockTourPairedWithApply)
                            )}
                            onClick={tourOnClick}
                          >
                            {tourTitle}
                          </Button>
                        ) : null}
                      </DockCtaChip>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>,
              document.body
            )
          : null}

        {/* Airbnb-style: left listing content + sticky date/CTA card on the right */}
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-x-6 gap-y-4 sm:gap-x-8 sm:gap-y-5 lg:items-start">
          <div className="order-1 lg:col-span-7 xl:col-span-8 space-y-2.5 min-w-0">
            {(hoursSummary ||
              includedCount > 0 ||
              rentalCount > 0 ||
              storageCount > 0 ||
              amenityCount > 0 ||
              tourFactCard) && (
              <div className="space-y-2.5">
                <RateHoursFacts
                  hoursSummary={hoursSummary}
                  extra={
                    tourFactCard ? (
                      <div id="preview-tour" className="h-full">
                        {tourFactCard}
                      </div>
                    ) : undefined
                  }
                />
                {(includedCount > 0 ||
                  rentalCount > 0 ||
                  storageCount > 0 ||
                  amenityCount > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {includedCount > 0 && (
                      <KitchenFactChip
                        emphasize
                        icon="mdi:check-decagram"
                        label={t("includedEquipmentCount", {
                          count: includedCount,
                          defaultValue: `${includedCount} included`,
                        })}
                        onClick={() => setInventoryModal("equipment")}
                      />
                    )}
                    {rentalCount > 0 && (
                      <KitchenFactChip
                        emphasize
                        icon="mdi:cash-plus"
                        label={t("equipmentRentalCount", {
                          count: rentalCount,
                          defaultValue: `${rentalCount} available to rent`,
                        })}
                        onClick={() => setInventoryModal("equipment")}
                      />
                    )}
                    {storageCount > 0 && (
                      <KitchenFactChip
                        emphasize
                        icon="mdi:warehouse"
                        label={t("storageOptionsCount", {
                          count: storageCount,
                          defaultValue: `${storageCount} storage ${storageCount === 1 ? "option" : "options"}`,
                        })}
                        onClick={() => setInventoryModal("storage")}
                      />
                    )}
                    {amenityCount > 0 && (
                      <KitchenFactChip
                        icon="mdi:format-list-checks"
                        label={t("amenitiesCount", {
                          count: amenityCount,
                          defaultValue: `${amenityCount} ${amenityCount === 1 ? "amenity" : "amenities"}`,
                        })}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {kitchens.length > 1 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-2">
                  {t("chooseAKitchen")}
                </p>
                <div
                  className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1"
                  data-preview-tour="kitchen-picker"
                >
                  {kitchens.map((kitchen) => {
                    const selected = selectedKitchen?.id === kitchen.id;
                    const rate = formatKitchenRate(kitchen);
                    return (
                      <button
                        key={kitchen.id}
                        type="button"
                        onClick={() => setSelectedKitchen(kitchen)}
                        className={cn(
                          "shrink-0 rounded-xl border px-4 py-2.5 text-left transition-colors",
                          selected
                            ? "border-[#F51042] bg-[#FFF8F5] shadow-sm"
                            : "border-gray-200 bg-white hover:border-gray-300"
                        )}
                      >
                        <span
                          className={cn(
                            "block text-sm font-semibold",
                            selected ? "text-[#F51042]" : "text-gray-900"
                          )}
                        >
                          {kitchen.name}
                        </span>
                        {rate && <span className="block text-xs text-gray-500 mt-0.5">{rate}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedKitchen && (
              <div id="preview-overview" className="space-y-1.5 scroll-mt-32">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900">
                  {selectedKitchen.name}
                </h2>
                {selectedKitchen.description ? (
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                    {selectedKitchen.description}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <aside
            id="preview-dates"
            className={cn(
              "order-2 lg:col-span-5 xl:col-span-4 lg:row-span-2 lg:col-start-8 xl:col-start-9 w-full min-w-0 max-w-md lg:max-w-none mx-auto lg:mx-0 self-start scroll-mt-32",
              "sticky",
              useChefChrome
                ? "top-20"
                : isAuthenticated
                  ? "top-[calc(var(--header-height)+1rem)]"
                  : staticSiteHeader
                    ? photosInView
                      ? "top-4"
                      : "top-16"
                    : photosInView
                      ? "top-[calc(var(--header-height)+1rem)]"
                      : "top-[calc(var(--header-height)+3.5rem)]"
            )}
          >
            <div className="w-full min-w-0 space-y-3">
              <GuestHoursCard
                key={selectedKitchen?.id ?? "no-kitchen"}
                availability={selectedKitchen?.availability}
                kitchenId={selectedKitchen?.id?.toString()}
                locationId={locationId?.toString()}
                kitchenName={selectedKitchen?.name}
                kitchenRate={selectedKitchen ? formatKitchenRate(selectedKitchen) : undefined}
                pricePreview={bookingPricePreview}
                application={application}
                applicationLoading={applicationLoading}
                locationApplicationLoading={locationApplicationLoading}
                listApplicationLoading={applicationsListLoading}
                onProceed={handleGetStarted}
                canBook={canBook}
                alreadyApplied={alreadyApplied}
                equipmentListings={kitchenEquipment}
                storageListings={kitchenStorage}
                proceedLabel={ctaSpec?.label}
                requireDatesForProceed={requireDatesForApply}
                proceedVariant={ctaSpec?.variant ?? "default"}
                proceedDisabled={
                  !ctaSpec || ctaSpec.kind === "pending" || ctaSpec.kind === "loading"
                }
                showPrimaryCta={showDateGatedApplyCta}
                calendarOpen={calendarOpen}
                onCalendarOpenChange={setCalendarOpen}
                onDatesOkChange={setDatesOk}
                extraInfoTip={heroHelper}
              />
              <AnimatePresence initial={false}>
                {!tourInView && tourButton ? (
                  <motion.div
                    key="sticky-tour"
                    id="preview-tour-sticky"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{
                      duration: reduceMotion ? 0 : 0.35,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="w-full min-w-0"
                  >
                    {tourButton}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </aside>

          <div className="order-3 lg:col-span-7 xl:col-span-8 min-w-0">
            <AnimatePresence mode="wait">
              {selectedKitchen ? (
                <KitchenDetailsSection
                  key={selectedKitchen.id}
                  kitchen={{
                    ...selectedKitchen,
                    equipment: kitchenEquipment || undefined,
                    storage: kitchenStorage || undefined,
                  }}
                  locationAddress={location.address}
                  locationName={location.name}
                  locationDescription={location.description}
                  layout="stacked"
                  addonsLoading={isLoadingAddons}
                  hidePhotoCollage
                  hideOverview
                  inventoryModal={inventoryModal}
                  onInventoryModalChange={setInventoryModal}
                />
              ) : (
                <motion.div
                  key="empty-state"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center justify-center h-64 sm:h-96 bg-white rounded-xl border border-gray-200"
                >
                  <div className="text-center px-4">
                    <PreviewIcon icon="mdi:silverware-fork-knife" size={48} className="mx-auto mb-3 text-gray-300" />
                    <p className="text-sm sm:text-base text-gray-500">
                      {t("noKitchensListedYet", "No kitchens are listed at this location yet.")}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <ThingsToKnowSection
          cancellationPolicyHours={location.cancellationPolicyHours}
          cancellationPolicyMessage={location.cancellationPolicyMessage}
          kitchenTermsUrl={location.kitchenTermsUrl}
        />

        <KitchenPreviewWalkthrough
          key={identifier ?? location.id}
          enabled={!!user}
        />
      </div>
    );
  };

  // Determine what content to show
  const getContent = () => {
    if (isLoading || authLoading) return loadingContent;
    if (error || !locationData) return notFoundContent;
    return mainContent(locationData);
  };

  // Handle sidebar navigation. We REPLACE the current preview-page entry so
  // the back button doesn't bounce through this kitchen preview again.
  const handleViewChange = (view: string) => {
    setActiveView(view);
    navigate(chefDashboardHref(view), { replace: true });
  };

  const scheduleTourSheet = locationId != null && !alreadyApplied ? (
    <ScheduleViewingWidget
      locationId={locationId}
      locationName={locationData?.name}
      open={tourModalOpen}
      onClose={() => setTourModalOpen(false)}
      onRequireOpen={() => setTourModalOpen(true)}
    />
  ) : null;

  // Chefs keep the dashboard sidebar; other signed-in roles use the public chrome.
  if (useChefChrome) {
    return (
      <>
        <ChefDashboardLayout
          activeView={activeView}
          onViewChange={handleViewChange}
          breadcrumbs={[
            { label: t("shellDashboard"), onClick: () => navigate('/dashboard'), navId: "overview" },
            {
              label: t("shellDiscoverKitchens"),
              onClick: () => navigate('/dashboard?view=discover-kitchens'),
              navId: "discover-kitchens",
            },
            { label: locationData?.name || t("applyFlowKitchenFallbackName") },
          ]}
        >
          {getContent()}
        </ChefDashboardLayout>
        {scheduleTourSheet}
      </>
    );
  }

  // For unauthenticated users, use public layout
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <PreviewIcon icon="mdi:loading" size={40} className="mx-auto mb-3 animate-spin text-[#F51042]" />
          <p className="text-sm sm:text-base text-gray-600">{t("loadingKitchens", "Loading kitchens...")}</p>
        </div>
      </div>
    );
  }

  if (error || !locationData) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center bg-gray-50 px-4 py-8">
          {notFoundContent}
        </div>
        <Footer />
      </div>
    );
  }

  // Public view for unauthenticated users
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header position={staticSiteHeader ? "static" : "fixed"} />
      <main className={cn("flex-1 pb-8 sm:pb-12 lg:pb-12", !staticSiteHeader && "pt-[var(--header-height)]")}>
        <div className="container mx-auto px-4 sm:px-6 max-w-7xl py-6 sm:py-8">
          {mainContent(locationData)}
        </div>
      </main>
      <Footer />
      {scheduleTourSheet}
    </div>
  );
}
