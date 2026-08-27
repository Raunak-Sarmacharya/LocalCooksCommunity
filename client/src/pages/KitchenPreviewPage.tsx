import { logger } from "@/lib/logger";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, MapPin, Loader2, Calendar, DoorOpen,
  ChevronLeft, ChevronRight, ChevronDown, Utensils, Check, ImageOff, FileText, Clock,
  CookingPot, Warehouse, ListChecks, BadgeCheck,
  LayoutGrid, X, CheckCircle2, ClipboardList, Images, Info,
} from "lucide-react";
import { formatCurrency, formatTime } from "@/lib/formatters";
import { KitchenNextStepsDescription } from "@/components/common/KitchenNextStepsDescription";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import useEmblaCarousel from 'embla-carousel-react';
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { isChefUser } from "@/config/chef-onboarding-steps";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import {
  useChefKitchenApplicationForLocation,
  useChefKitchenApplications,
  useGlobalMyApplications,
} from "@/hooks/use-chef-kitchen-applications";
import { getKitchenDisplayStatus, isActiveKitchenApplication, kitchenLocationId, toneToBadgeVariant } from "@/components/chef/applications/status";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { LocationMap } from "@/components/ui/location-map";
import { cn } from "@/lib/utils";
import { ScheduleViewingWidget } from "@/components/chef/ScheduleViewingWidget";
import { KitchenPreviewWalkthrough } from "@/components/kitchen-application/KitchenPreviewWalkthrough";
import { getAuthHeaders } from "@/lib/api";
import { SmartImage } from "@/components/ui/smart-image";
import { Calendar as UICalendar } from "@/components/ui/calendar";
import { DateRange } from "react-day-picker";
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
          <X className="w-5 h-5" />
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
            aria-label="Previous image"
          >
            <ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8" />
          </button>
          <button
            onClick={scrollNext}
            className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 bg-white/10 hover:bg-white/20 active:bg-white/30 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 touch-manipulation z-10 text-white backdrop-blur-md"
            disabled={!canScrollNext}
            aria-label="Next image"
          >
            <ChevronRight className="w-6 h-6 sm:w-8 sm:h-8" />
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

function formatKitchenRate(kitchen: PublicKitchen): string | null {
  if (kitchen.hourlyRate == null || kitchen.hourlyRate <= 0) return null;
  const amount = formatCurrency(kitchen.hourlyRate, kitchen.currency || "CAD");
  const model = kitchen.pricingModel || "hourly";
  if (model === "daily") return `${amount}/day`;
  if (model === "hourly") return `${amount}/hr`;
  return amount;
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
            title={isAvailable ? "Available" : "Not available"}
          >
            {day.label}
          </div>
        );
      })}
    </div>
  );
}

// Image Carousel Component - Mobile Optimized
function KitchenPhotoCollage({ images, kitchenName }: { images: string[]; kitchenName: string }) {
  const { t } = useTranslation("kitchen");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const openAt = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  if (images.length === 0) {
    return (
      <div
        data-preview-tour="photos"
        className="aspect-[16/9] bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl flex flex-col items-center justify-center"
      >
        <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center mb-3">
          <ImageOff className="w-8 h-8 text-gray-400" />
        </div>
        <p className="text-gray-500 font-medium">{t("noPhotosYet", "No photos yet")}</p>
        <p className="text-gray-400 text-sm mt-1">{t("photosComingSoon", "Photos coming soon")}</p>
      </div>
    );
  }

  const PREVIEW_COUNT = 5;
  const extraCount = images.length - PREVIEW_COUNT;
  const previewImages = showAll ? images : images.slice(0, Math.min(images.length, PREVIEW_COUNT));
  const count = previewImages.length;
  const lastPreviewHasMore = !showAll && extraCount > 0;

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

  if (showAll) {
    return (
      <div>
        <div
          data-preview-tour="photos"
          className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 rounded-2xl overflow-hidden shadow-xl"
        >
          {images.map((img, index) => (
            <PhotoTile
              key={`${img}-${index}`}
              imageUrl={img}
              kitchenName={kitchenName}
              index={index}
              onClick={() => openAt(index)}
              className={cn(
                "aspect-[4/3]",
                index === 0 && "col-span-2 aspect-[16/9] sm:aspect-auto sm:row-span-2 sm:min-h-[280px]"
              )}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-3 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          Show fewer photos
        </button>
        {lightbox}
      </div>
    );
  }

  return (
    <div>
      <div
        data-preview-tour="photos"
        className={cn(
          "grid gap-1.5 overflow-hidden rounded-2xl bg-white shadow-xl",
          count === 1 && "grid-cols-1",
          count === 2 && "grid-cols-2",
          count === 3 && "grid-cols-2 grid-rows-2 sm:h-[360px]",
          count >= 4 && "grid-cols-2 sm:grid-cols-4 sm:grid-rows-2 sm:h-[380px]"
        )}
      >
        {previewImages.map((img, index) => {
          const isHero = count >= 3 && index === 0;
          const isLastWithMore = lastPreviewHasMore && index === previewImages.length - 1;

          return (
            <PhotoTile
              key={`${img}-${index}`}
              imageUrl={img}
              kitchenName={kitchenName}
              index={index}
              onClick={() => (isLastWithMore ? setShowAll(true) : openAt(index))}
              className={cn(
                count === 1 && "aspect-[16/9] min-h-[220px] sm:min-h-[360px]",
                count === 2 && "aspect-[4/3] sm:aspect-auto sm:min-h-[320px]",
                isHero && count === 3 && "row-span-2 min-h-[200px] sm:min-h-0",
                !isHero && count === 3 && "min-h-[100px] sm:min-h-0",
                isHero && count >= 4 && "col-span-2 aspect-[16/9] sm:aspect-auto sm:row-span-2 sm:min-h-0",
                !isHero && count >= 4 && "aspect-[4/3] sm:aspect-auto"
              )}
              overlay={
                isLastWithMore ? (
                  <span className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 text-white">
                    <Images className="h-5 w-5 mb-1" />
                    <span className="text-sm font-semibold">{t("viewMorePhotos", { count: extraCount, defaultValue: `View ${extraCount} more` })}</span>
                  </span>
                ) : undefined
              }
            />
          );
        })}
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">{t("clickPhotoEnlarge", "Click a photo to enlarge")}</p>
          {extraCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-800 hover:text-[#F51042]"
            >
              <Images className="h-4 w-4" />
              {t("viewAllPhotos", { count: images.length, defaultValue: `View all ${images.length} photos` })}
            </button>
          )}
        </div>
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
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
          {expanded ? t("showLess", "Show less") : t("viewAllAndMore", { itemCount, hiddenCount, defaultValue: `View all ${itemCount} · ${hiddenCount} more` })}
        </button>
      )}
    </div>
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
    <span className="shrink-0 tabular-nums text-sm text-gray-900">
      {amount}
      <span className="ml-1 text-xs font-normal text-gray-400">{unit}</span>
    </span>
  );
}

function CompactList({ children }: { children: ReactNode }) {
  return <ul className="min-w-0">{children}</ul>;
}

function IncludedEquipmentList({
  items,
  alwaysExpanded,
}: {
  items: EquipmentListing[];
  alwaysExpanded?: boolean;
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
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-gray-400">
                    {titleCaseLabel(category, t)}
                  </p>
                )}
                <CompactList>
                  {visible.map((item) => (
                    <li
                      key={item.id}
                      className="flex min-w-0 items-center gap-2.5 py-1"
                    >
                      <span className="h-1 w-1 shrink-0 rounded-full bg-[#F51042]" />
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
}: {
  name: string;
  hint?: string;
  amount?: string;
  unit?: string;
}) {
  return (
    <li className="flex min-w-0 items-baseline justify-between gap-3 py-1.5">
      <NameCell name={name} hint={hint} />
      {amount && unit ? <PriceCell amount={amount} unit={unit} /> : null}
    </li>
  );
}

function InventoryPreviewRow({
  name,
  hint,
  amount,
  unit,
  showDot = false,
}: {
  name: string;
  hint?: string;
  amount?: string;
  unit?: string;
  showDot?: boolean;
}) {
  return (
    <li className="flex h-8 min-w-0 items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2">
        {showDot ? <span className="h-1 w-1 shrink-0 rounded-full bg-[#F51042]" /> : null}
        <span className="truncate text-sm text-gray-900">{name}</span>
        {hint ? (
          <span className="hidden min-w-0 truncate text-xs text-gray-400 sm:inline">{hint}</span>
        ) : null}
      </span>
      {amount && unit ? <PriceCell amount={amount} unit={unit} /> : null}
    </li>
  );
}

function KitchenEquipmentSections({
  kitchen,
  alwaysExpanded,
  maxVisible,
}: {
  kitchen: PublicKitchen;
  alwaysExpanded?: boolean;
  maxVisible?: number;
}) {
  const { t } = useTranslation("kitchen");
  const includedAll = kitchen.equipment?.included ?? [];
  const rentalAll = kitchen.equipment?.rental ?? [];

  if (maxVisible != null) {
    const previewItems = [...includedAll, ...rentalAll].slice(0, maxVisible);
    return (
      <CompactList>
        {previewItems.map((item) => (
          <InventoryPreviewRow
            key={item.id}
            name={titleCaseLabel(item.equipmentType, t)}
            showDot
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

  return (
    <div className="space-y-5">
      {included.length > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-gray-400">
              {t("comesWithBooking", "Comes with the booking")}
            </h3>
            <span className="text-xs tabular-nums text-gray-400">{includedAll.length}</span>
          </div>
          <IncludedEquipmentList items={included} alwaysExpanded={skipToggle} />
        </div>
      )}

      {rental.length > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-gray-400">
              {t("optionalRentals", "Optional rentals")}
            </h3>
            <span className="text-xs tabular-nums text-gray-400">{rentalAll.length}</span>
          </div>
          <ExpandableInventory itemCount={rental.length} alwaysExpanded={skipToggle}>
            {(visibleCount) => (
              <CompactList>
                {rental.slice(0, visibleCount).map((item) => (
                  <PricedRow
                    key={item.id}
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
        </div>
      )}
    </div>
  );
}

function KitchenStorageSections({
  kitchen,
  maxVisible,
  alwaysExpanded = false,
}: {
  kitchen: PublicKitchen;
  maxVisible?: number;
  alwaysExpanded?: boolean;
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
            name={item.name || item.storageType}
            hint={titleCaseLabel(item.storageType, t)}
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
        <CompactList>
          {storage.slice(0, visibleCount).map((item) => (
            <PricedRow
              key={item.id}
              name={item.name || item.storageType}
              hint={titleCaseLabel(item.storageType, t)}
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
      <ChevronRight className="ml-0.5 h-4 w-4" />
    </button>
  );
}

function InventorySheet({
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[min(100vw,32rem)] flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b border-gray-100 px-5 pb-4 pt-5 pr-12 text-left">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function KitchenInventoryPair({
  kitchen,
  hasEquipment,
  hasStorage,
}: {
  kitchen: PublicKitchen;
  hasEquipment: boolean;
  hasStorage: boolean;
}) {
  const { t } = useTranslation("kitchen");
  const [openSheet, setOpenSheet] = useState<"equipment" | "storage" | null>(null);
  const both = hasEquipment && hasStorage;
  const equipmentCount =
    (kitchen.equipment?.included?.length ?? 0) + (kitchen.equipment?.rental?.length ?? 0);
  const storageCount = kitchen.storage?.length ?? 0;

  return (
    <div className="w-full">
      <div className={cn("grid items-start gap-4", both ? "sm:grid-cols-2" : "grid-cols-1")}>
        {hasEquipment && (
          <div
            className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 sm:p-5"
            data-preview-tour="equipment"
          >
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CookingPot className="h-4 w-4 text-[#F51042]" />{t("equipment", "Equipment")}</h3>
            <KitchenEquipmentSections kitchen={kitchen} maxVisible={CARD_PREVIEW_COUNT} />
            {equipmentCount > CARD_PREVIEW_COUNT && (
              <InventoryShowAllButton
                count={equipmentCount}
                label="equipment"
                onClick={() => setOpenSheet("equipment")}
              />
            )}
          </div>
        )}
        {hasStorage && (
          <div
            className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 sm:p-5"
            data-preview-tour="storage"
          >
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Warehouse className="h-4 w-4 text-[#F51042]" />{t("storage", "Storage")}</h3>
            <KitchenStorageSections kitchen={kitchen} maxVisible={CARD_PREVIEW_COUNT} />
            {storageCount > CARD_PREVIEW_COUNT && (
              <InventoryShowAllButton
                count={storageCount}
                label="storage"
                onClick={() => setOpenSheet("storage")}
              />
            )}
          </div>
        )}
      </div>

      {hasEquipment && (
        <InventorySheet
          open={openSheet === "equipment"}
          onOpenChange={(open) => setOpenSheet(open ? "equipment" : null)}
          title={t("equipment", "Equipment")}
          description={t("equipmentSheetDesc", "What comes with a booking, plus optional rentals.")}
        >
          <KitchenEquipmentSections kitchen={kitchen} alwaysExpanded />
        </InventorySheet>
      )}
      {hasStorage && (
        <InventorySheet
          open={openSheet === "storage"}
          onOpenChange={(open) => setOpenSheet(open ? "storage" : null)}
          title={t("storage", "Storage")}
          description={t("storageSheetDesc", "Cold, dry, and other storage space you can add.")}
        >
          <KitchenStorageSections kitchen={kitchen} alwaysExpanded />
        </InventorySheet>
      )}
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
          <Check className="mr-1.5 h-3.5 w-3.5 flex-shrink-0 text-[#F51042]" />
          {amenity}
        </motion.span>
      ))}
    </motion.div>
  );
}

function KitchenFactChip({
  icon: Icon,
  label,
}: {
  icon: typeof Clock;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700">
      <Icon className="h-3.5 w-3.5 text-[#F51042]" />
      {label}
    </span>
  );
}

function KitchenTourBanner({
  toursAvailable,
  isLoading,
  alreadyApplied,
  onSchedule,
}: {
  toursAvailable: boolean;
  isLoading: boolean;
  alreadyApplied?: boolean;
  onSchedule: () => void;
}) {
  const { t } = useTranslation("kitchen");
  if (isLoading) {
    return <Skeleton className="h-[148px] w-full rounded-2xl" />;
  }

  return (
    <div
      className={cn(
        "rounded-2xl border p-5 sm:p-6",
        toursAvailable
          ? "border-[#F51042]/20 bg-[#FFF8F5]"
          : "border-gray-200 bg-white"
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
            toursAvailable
              ? "bg-white ring-1 ring-[#F51042]/15"
              : "bg-[#F8F8F8] ring-1 ring-gray-200"
          )}
        >
          {toursAvailable ? (
            <DoorOpen className="h-6 w-6 text-[#F51042]" />
          ) : (
            <Clock className="h-6 w-6 text-gray-500" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t("kitchenTour", "Kitchen Tour")}
          </p>
          <h2 className="mt-1 text-base sm:text-lg font-semibold text-gray-900">
            {toursAvailable ? t("wantToSeeInPerson", "Want to see it in person first?") : t("tourDatesComingSoon", "Tour dates coming soon")}
          </h2>
          {toursAvailable ? (
            <p className="mt-1 text-sm text-gray-600 leading-relaxed">
              {alreadyApplied
                ? t("scheduleWalkthroughAlreadyApplied", "Schedule a walkthrough if you'd like a look around. Your application is already in with this kitchen.")
                : t("scheduleWalkthroughApplySeparately", "Schedule a walkthrough if you'd like a look around. You'll still apply separately before you can book cooking time.")}
            </p>
          ) : (
            <p className="mt-1 text-sm text-gray-600 leading-relaxed">
              {alreadyApplied
                ? t("tourNotPostedAlreadyApplied", "The kitchen hasn't posted tour dates yet. Your application is already in, so you can keep an eye out here.")
                : t("tourNotPostedApplyLater", "The kitchen hasn't posted tour dates yet. You can still look around here, and apply when you're ready to cook.")}
            </p>
          )}
        </div>
        {toursAvailable && (
          <Button
            className="shrink-0 w-full sm:w-auto"
            data-preview-tour="schedule"
            onClick={onSchedule}
          >
            <Calendar className="mr-2 h-4 w-4" />
            {t("scheduleTourBtn")}
          </Button>
        )}
      </div>
    </div>
  );
}

function GuestHoursCard({
  availability,
  kitchenId,
  locationId,
  kitchenName,
  kitchenRate,
  application,
  applicationLoading = false,
  locationApplicationLoading = false,
  listApplicationLoading = false,
  onProceed,
  canBook,
  alreadyApplied,
  onConfirmModalOpenChange
}: {
  availability?: PublicKitchen["availability"];
  kitchenId?: string;
  locationId?: string;
  kitchenName?: string;
  kitchenRate?: string | null;
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
  onConfirmModalOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation("kitchen");
  const { openAuthModal } = useAuthModal();
  const { user } = useFirebaseAuth();
  const isAuthenticated = !!user;
  const isFullyAuthenticated = isAuthenticated && (user?.isVerified || user?.is_verified || user?.emailVerified);
  
  const storageKey = kitchenId ? `kitchen_dates_${kitchenId}` : 'kitchen_dates_generic';
  
  const [selectedRange, setSelectedRange] = useState<DateRange | undefined>(undefined);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalMode, setConfirmModalMode] = useState<"booking" | "application">("booking");

  useEffect(() => {
    onConfirmModalOpenChange?.(showConfirmModal);
  }, [showConfirmModal, onConfirmModalOpenChange]);

  // Restore from sessionStorage on mount & auth
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.from) parsed.from = new Date(parsed.from);
        if (parsed.to) parsed.to = new Date(parsed.to);
        setSelectedRange(parsed);
      }
    } catch (e) {
      console.error("Failed to restore dates", e);
    }
  }, [storageKey, isAuthenticated]);

  // When authenticated, check if we need to show modal
  const latestDepsRef = useRef({
    applicationLoading,
    locationApplicationLoading,
    listApplicationLoading,
    alreadyApplied,
    application,
    storageKey,
    isFullyAuthenticated,
    kitchenId,
  });
  useEffect(() => {
    latestDepsRef.current = {
      applicationLoading,
      locationApplicationLoading,
      listApplicationLoading,
      alreadyApplied,
      application,
      storageKey,
      isFullyAuthenticated,
      kitchenId,
    };
  }, [applicationLoading, locationApplicationLoading, listApplicationLoading, alreadyApplied, application, storageKey, isFullyAuthenticated, kitchenId]);

  // Tracks whether the user has already triggered a modal interactively on
  // this page visit (i.e. clicked the Continue button themselves, or we
  // already opened a pending modal for them). Prevents the auto-open
  // useEffect from popping a "correct" application modal out of nowhere
  // after the user has already seen/interacted with a modal in this
  // visit and dismissed it, which users would perceive as a glitch.
  const hasInteractedRef = useRef(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (isFullyAuthenticated && !hasInteractedRef.current) {
      const pendingModal = sessionStorage.getItem(`${storageKey}_pending_modal`);
      const pendingAppModal = sessionStorage.getItem('pending_application_modal');

      if (pendingAppModal) {
        const pendingTour = sessionStorage.getItem(`viewing_booking_${kitchenId}`);
        if (!pendingTour) {
          // Open the confirm dialog once BOTH queries have settled so we
          // never flash "Continue to Apply" booking mode for a user whose
          // Step 1 record already exists. Wait on the RAW per-location +
          // list query loading flags (not the derived applicationLoading
          // which flips to false immediately if any application data is
          // cached and masks current-location races).
          const openWhenReady = () => {
            const d = latestDepsRef.current;
            if (d.locationApplicationLoading || d.listApplicationLoading) {
              timeoutId = setTimeout(openWhenReady, 120);
              return;
            }
            // If the user has already interacted with a modal since
            // page mount, don't surprise them with another open.
            if (hasInteractedRef.current) return;
            hasInteractedRef.current = true;
            const hasKitchenApp =
              d.alreadyApplied || isActiveKitchenApplication(d.application || null);
            setConfirmModalMode(hasKitchenApp ? "application" : "booking");
            setShowConfirmModal(true);
            sessionStorage.removeItem('pending_application_modal');
            sessionStorage.removeItem(`${d.storageKey}_pending_modal`);
          };
          timeoutId = setTimeout(openWhenReady, 400);
        } else {
          sessionStorage.removeItem('pending_application_modal');
        }
      } else if (pendingModal) {
        const pendingTour = sessionStorage.getItem(`viewing_booking_${kitchenId}`);
        if (!pendingTour) {
          const openWhenReady = () => {
            const d = latestDepsRef.current;
            if (d.locationApplicationLoading || d.listApplicationLoading) {
              timeoutId = setTimeout(openWhenReady, 120);
              return;
            }
            if (hasInteractedRef.current) return;
            hasInteractedRef.current = true;
            const hasKitchenApp =
              d.alreadyApplied || isActiveKitchenApplication(d.application || null);
            setConfirmModalMode(hasKitchenApp ? "application" : "booking");
            setShowConfirmModal(true);
            sessionStorage.removeItem(`${storageKey}_pending_modal`);
          };
          timeoutId = setTimeout(openWhenReady, 400);
        } else {
          sessionStorage.removeItem(`${storageKey}_pending_modal`);
        }
      }
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullyAuthenticated, storageKey]);

  // Automatically save to sessionStorage whenever selectedRange changes
  // so the intent prevails if the user navigates away using sidebar buttons
  useEffect(() => {
    if (selectedRange) {
      sessionStorage.setItem(storageKey, JSON.stringify(selectedRange));
    }
  }, [selectedRange, storageKey]);

  const isDayAvailable = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date < today) return false;
    if (!availability || availability.length === 0) return false;
    
    const day = date.getDay();
    const dayAvail = availability.find(a => a.dayOfWeek === day);
    return dayAvail && dayAvail.isAvailable;
  };

  useEffect(() => {
    if (selectedRange?.from) {
      let curr = new Date(selectedRange.from);
      curr.setHours(0, 0, 0, 0);
      let end = selectedRange.to ? new Date(selectedRange.to) : curr;
      let endCopy = new Date(end);
      endCopy.setHours(0, 0, 0, 0);
      
      let isValid = true;
      while (curr <= endCopy) {
        if (!isDayAvailable(curr)) {
          isValid = false;
          break;
        }
        curr.setDate(curr.getDate() + 1);
      }
      if (!isValid) {
        setSelectedRange(undefined);
      }
    }
  }, [selectedRange, availability]);

  const handleSelect = (range: DateRange | undefined) => {
    // Quality guard: firmly reject any selection spanning an unavailable date
    if (range?.from && range?.to) {
      let curr = new Date(range.from);
      curr.setHours(0, 0, 0, 0);
      const end = new Date(range.to);
      end.setHours(0, 0, 0, 0);
      
      let isValid = true;
      while (curr <= end) {
        if (!isDayAvailable(curr)) {
          isValid = false;
          break;
        }
        curr.setDate(curr.getDate() + 1);
      }
      
      if (!isValid) {
        // Reject the invalid range and reset to just the start date
        range = { from: range.from, to: undefined };
      }
    }

    setSelectedRange(range);
  };

  const getValidDateSegments = (from: Date, to: Date) => {
    const segments: { start: Date; end: Date }[] = [];
    let currentStart: Date | null = null;
    let currentEnd: Date | null = null;

    let currentDate = new Date(from);
    while (currentDate <= to) {
      if (isDayAvailable(currentDate)) {
        if (!currentStart) {
          currentStart = new Date(currentDate);
          currentEnd = new Date(currentDate);
        } else {
          currentEnd = new Date(currentDate);
        }
      } else {
        if (currentStart && currentEnd) {
          segments.push({ start: currentStart, end: currentEnd });
          currentStart = null;
          currentEnd = null;
        }
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    if (currentStart && currentEnd) {
      segments.push({ start: currentStart, end: currentEnd });
    }
    
    return segments;
  };

  const handleProceed = () => {
    if (selectedRange) {
      sessionStorage.setItem(storageKey, JSON.stringify(selectedRange));
    }

    if (isFullyAuthenticated) {
      // Guard against double-trigger: if the auto-open useEffect already
      // opened (or is about to open) a modal, or the user already clicked
      // Continue on this page visit, don't pop another one.
      if (hasInteractedRef.current && showConfirmModal) return;
      hasInteractedRef.current = true;

      // Clear pending flags immediately so the auto-open useEffect doesn't
      // fight with this manual open and cause spotlight flicker or a
      // later "out of nowhere" re-open.
      sessionStorage.removeItem('pending_application_modal');
      sessionStorage.removeItem(`${storageKey}_pending_modal`);

      // Wait for BOTH raw queries to settle:
      //   - useChefKitchenApplicationForLocation (location-specific row)
      //   - useChefKitchenApplications (list of ALL chef kitchen apps)
      //
      // The previous loop waited on the DERIVED `applicationLoading`
      // boolean which is:
      //   `!application && (locationApplicationLoading || listLoading)`.
      // That flips to false as soon as `application` has ANY cached data
      // (even data from a prior location in the same page session), so a
      // stale cached row would short-circuit the poll and open booking
      // mode for a user whose real Step 1 row was still loading.
      const openWhenReady = () => {
        const d = latestDepsRef.current;
        if (d.locationApplicationLoading || d.listApplicationLoading) {
          setTimeout(openWhenReady, 100);
          return;
        }
        const hasKitchenApp =
          d.alreadyApplied || isActiveKitchenApplication(d.application || null);
        setConfirmModalMode(hasKitchenApp ? "application" : "booking");
        setShowConfirmModal(true);
      };
      openWhenReady();
    } else {
      sessionStorage.setItem(`${storageKey}_pending_modal`, "true");
      sessionStorage.removeItem(`viewing_booking_${kitchenId}`);
      sessionStorage.removeItem('pending_application_modal');
      // Persist the location context so the post-verification submitter can
      // route the pending application to the kitchen-specific endpoint even
      // if the email verification redirects the user to /auth?verified=true.
      // The kitchen application API requires `locationId`, not the kitchen
      // id, so we must use the location id here.
      try {
        if (locationId || kitchenId) {
          sessionStorage.setItem(
            'pendingRegistrationKitchenContext',
            JSON.stringify({
              // Prefer the explicit locationId (the API requires locationId).
              // Fall back to kitchenId only if locationId isn't available.
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
        title: t("authModalNextStepsTitle", "Almost there!"),
        description: <KitchenNextStepsDescription type="book" />,
        defaultTab: "register",
        requireApplication: true
      });
    }
  };

  const hasSelection = !!(selectedRange?.from || selectedRange?.to);
  const formatDate = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  
  const formatSegment = (segment: { start: Date; end: Date }) => {
    if (segment.start.getTime() === segment.end.getTime()) {
      return formatDate(segment.start);
    }
    return `${formatDate(segment.start)} - ${formatDate(segment.end)}`;
  };

  const validSegments = (selectedRange?.from && selectedRange?.to) 
    ? getValidDateSegments(selectedRange.from, selectedRange.to) 
    : (selectedRange?.from && isDayAvailable(selectedRange.from)) 
      ? [{ start: selectedRange.from, end: selectedRange.from }] 
      : [];

  const bounds = useMemo(() => {
    if (!selectedRange?.from || selectedRange?.to) return { min: null, max: null };
    
    let maxDate = null;
    let minDate = null;
    
    // Find first unavailable date AFTER start
    let checkDate = new Date(selectedRange.from);
    checkDate.setHours(0, 0, 0, 0);
    checkDate.setDate(checkDate.getDate() + 1);
    for (let i = 0; i < 365; i++) {
      if (!isDayAvailable(checkDate)) {
        maxDate = new Date(checkDate);
        break;
      }
      checkDate.setDate(checkDate.getDate() + 1);
    }
    
    // Find first unavailable date BEFORE start
    checkDate = new Date(selectedRange.from);
    checkDate.setHours(0, 0, 0, 0);
    checkDate.setDate(checkDate.getDate() - 1);
    for (let i = 0; i < 365; i++) {
      if (!isDayAvailable(checkDate)) {
        minDate = new Date(checkDate);
        break;
      }
      checkDate.setDate(checkDate.getDate() - 1);
    }
    
    return { min: minDate, max: maxDate };
  }, [selectedRange?.from, selectedRange?.to, isDayAvailable]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5" data-preview-tour="hours">
      <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2 mb-1">
        <Calendar className="h-4 w-4 text-[#F51042]" />{t("selectYourDates", "Select your dates")}
      </h2>
      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        {t("pickDatesToBook", "Pick the dates you'd like to cook. You won't be charged yet.")}
      </p>
      
      <div className="border border-gray-100 rounded-lg p-1 bg-gray-50/30">
        <UICalendar
          mode="range"
          selected={selectedRange}
          onSelect={handleSelect}
          className="w-full bg-transparent"
          disabled={(date) => {
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);
            if (!isDayAvailable(d)) return true;
            if (bounds.max && d >= bounds.max) return true;
            if (bounds.min && d <= bounds.min) return true;
            return false;
          }}
        />
      </div>
      
      <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
        {selectedRange?.from && validSegments.length > 0 && (
          <div className="bg-red-50 text-red-900 px-3 py-2 rounded-md text-sm font-medium border border-red-100 flex flex-col gap-1">
            <span className="font-semibold">Eligible Booking Dates:</span>
            <span className="text-xs opacity-90 mb-1">Based on kitchen availability, your selection includes:</span>
            <ul className="list-disc pl-4 space-y-0.5 text-sm">
              {validSegments.map((seg, idx) => (
                <li key={idx}>{formatSegment(seg)}</li>
              ))}
            </ul>
          </div>
        )}
        {selectedRange?.from && validSegments.length === 0 && (
          <div className="bg-amber-50 text-amber-900 px-3 py-2 rounded-md text-sm font-medium border border-amber-100 flex flex-col gap-1">
            <span className="font-semibold">No Eligible Dates</span>
            <span className="text-xs opacity-90">Your selection does not include any days the kitchen is open.</span>
          </div>
        )}
        <div className="flex items-start gap-2 bg-blue-50/50 p-2.5 rounded-lg border border-blue-100/50">
          <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-700 leading-relaxed font-medium">
            {t("nextStepsInfo", "Next steps: Take a tour or apply. Once the kitchen manager approves you, you can book these dates.")}
          </p>
        </div>
        
        <Button 
          className="w-full bg-[#F51042] hover:bg-[#E00A38] text-white transition-all shadow-sm" 
          onClick={handleProceed}
          disabled={
            !hasSelection ||
            validSegments.length === 0 ||
            (isFullyAuthenticated && (locationApplicationLoading || listApplicationLoading))
          }
        >
          {isFullyAuthenticated && (locationApplicationLoading || listApplicationLoading)
            ? t("checkingYourApplication", "Checking your application...")
            : hasSelection && validSegments.length > 0
              ? t("continueWithSelectedDates", "Continue with selected dates") 
              : t("selectDatesToContinue", "Select dates to continue")}
        </Button>
      </div>

      <Dialog
        open={showConfirmModal}
        onOpenChange={(nextOpen) => {
          setShowConfirmModal(nextOpen);
          if (!nextOpen) {
            // User closed the confirm dialog. Clear pending-modal session
            // flags so the auto-open useEffect won't try to re-open it on
            // the next render, and so the spotlight walkthrough doesn't
            // flicker (the walkthrough waits until body has no real dialog).
            try {
              sessionStorage.removeItem('pending_application_modal');
              sessionStorage.removeItem(`${storageKey}_pending_modal`);
            } catch (e) { /* ignore */ }
          }
        }}
      >
        <DialogContent className="w-full sm:max-w-[450px] overflow-y-auto max-h-[90vh] p-4 sm:p-6">
          <DialogHeader className="mb-2">
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              {confirmModalMode === "application" ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  {t("applicationStarted", "Step 1 Complete!")}
                </>
              ) : (
                <>
                  <Calendar className="h-5 w-5 text-primary" />
                  {t("reviewSelectedDates", "Review your selected dates")}
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              {confirmModalMode === "application" ? (
                t("applicationSubmittedDesc", "Your application has been successfully submitted. We will notify you once it is approved.")
              ) : (
                <>
                  {kitchenName ? t("bookingAt", { defaultValue: `Booking at ${kitchenName}`, name: kitchenName }) : t("bookingAtKitchen", "Booking at this kitchen")}
                  {kitchenRate && ` • ${kitchenRate}`}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Selected Dates Summary (Only for booking mode) */}
            {confirmModalMode === "booking" && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 flex items-start gap-3">
                <Calendar className="h-5 w-5 text-[#F51042] mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-sm text-gray-900 mb-1">{t("selectedDates", "Selected Dates")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {validSegments.map((seg, idx) => (
                      <Badge variant="secondary" key={idx} className="bg-white border-gray-200 text-gray-700 font-medium hover:bg-gray-50">
                        {formatSegment(seg)}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {confirmModalMode === "application" && application && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 mb-6">
                <h4 className="font-semibold text-sm text-gray-900 mb-3">{t("applicationDetails", "Application Details")}</h4>
                <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">{t("name", "Name")}</p>
                    <p className="font-medium text-gray-900">{application.fullName}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">{t("email", "Email")}</p>
                    <p className="font-medium text-gray-900 truncate" title={application.email}>{application.email}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">{t("phone", "Phone")}</p>
                    <p className="font-medium text-gray-900">{application.phone || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">{t("shopName", "Shop Name")}</p>
                    <p className="font-medium text-gray-900 truncate" title={application.shopName}>{application.shopName || "N/A"}</p>
                  </div>
                  {application.shopAddress && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs">{t("shopAddress", "Address")}</p>
                      <p className="font-medium text-gray-900 truncate" title={application.shopAddress}>{application.shopAddress}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Application Submitted confirmation (when in application mode but application object is missing) */}
            {confirmModalMode === "application" && !application && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 mb-6">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-[#F51042] mt-0.5 shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm text-gray-900 mb-2">{t("applicationDetails", "Application Details")}</h4>
                    <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">{t("name", "Name")}</p>
                        <p className="font-medium text-gray-900">
                          {(user?.displayName ||
                            ((user as unknown as { firstName?: string; lastName?: string; name?: string }).firstName
                              ? `${(user as unknown as { firstName?: string }).firstName}${(user as unknown as { lastName?: string }).lastName ? ` ${(user as unknown as { lastName?: string }).lastName}` : ''}`
                              : (user as unknown as { name?: string }).name) ||
                            'N/A')}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">{t("email", "Email")}</p>
                        <p className="font-medium text-gray-900 truncate">{user?.email || 'N/A'}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("appSubmittedDuringReg", "Your Step 1 details were submitted during registration and are pending admin approval. Click View Application to review your submission.")}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Stepper / Timeline */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                {confirmModalMode === "application" ? t("yourApplicationJourney", "Your application journey") : t("yourBookingJourney", "Your booking journey")}
              </h4>
              <div className="relative pl-3 space-y-6 before:absolute before:inset-y-2 before:left-[23px] before:w-0.5 before:bg-gray-100">
                
                {/* Step 1 */}
                <div className="relative flex gap-4 items-start">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 z-10 ${alreadyApplied || canBook ? 'bg-primary/10 text-primary' : 'bg-primary text-primary-foreground shadow-sm ring-4 ring-background'}`}>
                    {alreadyApplied || canBook ? <CheckCircle2 className="h-5 w-5" /> : <span className="text-sm font-bold">1</span>}
                  </div>
                  <div className="pt-1.5">
                    <p className={`text-sm font-semibold ${alreadyApplied || canBook ? 'text-foreground' : 'text-foreground'}`}>{t("submitApplication", "Submit Application")}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {alreadyApplied || canBook 
                        ? t("youHaveSuccessfullySubmitted", "You've successfully submitted your application.")
                        : t("fillOutRequirements", "Fill out your requirements so the kitchen manager can verify you.")}
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="relative flex gap-4 items-start">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 z-10 ${canBook ? 'bg-primary/10 text-primary' : alreadyApplied ? 'bg-primary/10 text-primary shadow-sm ring-4 ring-background' : 'bg-muted text-muted-foreground ring-4 ring-background'}`}>
                    {canBook ? <CheckCircle2 className="h-5 w-5" /> : alreadyApplied ? <Clock className="h-5 w-5" /> : <span className="text-sm font-bold">2</span>}
                  </div>
                  <div className="pt-1.5">
                    <p className={`text-sm font-semibold ${canBook ? 'text-foreground' : alreadyApplied ? 'text-foreground' : 'text-muted-foreground'}`}>{t("kitchenReview", "Kitchen Review")}</p>
                    <p className={`text-sm mt-0.5 ${canBook ? 'text-muted-foreground' : alreadyApplied ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
                      {canBook 
                        ? t("applicationApproved", "Your application was approved by the kitchen.")
                        : alreadyApplied
                          ? (application?.current_tier === 1 
                              ? t("adminCurrentlyReviewing", "The platform Admin is currently reviewing your details.") 
                              : t("managerCurrentlyReviewing", "The kitchen manager is currently reviewing your details."))
                          : t("waitKitchenApproval", "Wait for the kitchen manager to approve your application.")}
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="relative flex gap-4 items-start">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 z-10 ${canBook ? 'bg-primary text-primary-foreground shadow-sm ring-4 ring-background' : 'bg-muted text-muted-foreground ring-4 ring-background'}`}>
                    <span className="text-sm font-bold">3</span>
                  </div>
                  <div className="pt-1.5">
                    <p className={`text-sm font-semibold ${canBook ? 'text-foreground' : 'text-muted-foreground'}`}>{t("bookAndPay", "Book & Pay")}</p>
                    <p className={`text-sm mt-0.5 ${canBook ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
                      {t("onceApprovedFinalize", "Once approved, finalize your schedule and pay for your booking.")}
                    </p>
                  </div>
                </div>

              </div>
            </div>

            <div className="pt-2 flex justify-end gap-3 mt-4">
              <Button variant="outline" onClick={() => setShowConfirmModal(false)}>{t("cancel", "Cancel")}</Button>
              <Button onClick={() => {
                setShowConfirmModal(false);
                if (onProceed) onProceed();
              }}>
                {canBook
                  ? t("continueToBooking", "Continue to Booking")
                  : confirmModalMode === "application"
                    ? t("viewApplication", "View Application")
                    : alreadyApplied
                      ? t("viewApplication", "View Application")
                      : t("continueToApply", "Continue to Apply")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
}

function KitchenDetailsSection({
  kitchen,
  locationAddress,
  locationName,
  locationDescription,
  layout = "tabs",
  addonsLoading = false,
}: KitchenDetailsSectionProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const isStacked = layout === "stacked";

  const allImages: string[] = useMemo(() => {
    const images: string[] = [];
    if (kitchen.imageUrl) images.push(kitchen.imageUrl);
    if (kitchen.galleryImages && Array.isArray(kitchen.galleryImages)) {
      images.push(...kitchen.galleryImages.filter(img => img && typeof img === 'string'));
    }
    return images;
  }, [kitchen.imageUrl, kitchen.galleryImages]);

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
  const hoursSummary = availableDaySummary(kitchen.availability, t);
  const aboutCopy = isStacked
    ? (kitchen.description || null)
    : (kitchen.description || locationDescription || null);
  const showFactChips = includedCount > 0 || rentalCount > 0 || storageCount > 0 || !!hoursSummary;

  const factChips = showFactChips ? (
    <div className="flex flex-wrap gap-2">
      {hoursSummary && <KitchenFactChip icon={Clock} label={hoursSummary} />}
      {includedCount > 0 && (
        <KitchenFactChip
          icon={CheckCircle2}
          label={t("includedItemsCount", { count: includedCount, defaultValue: `${includedCount} included ${includedCount === 1 ? "item" : "items"}` })}
        />
      )}
      {rentalCount > 0 && (
        <KitchenFactChip
          icon={CookingPot}
          label={t("rentalOptionsCount", { count: rentalCount, defaultValue: `${rentalCount} rental ${rentalCount === 1 ? "option" : "options"}` })}
        />
      )}
      {storageCount > 0 && (
        <KitchenFactChip
          icon={Warehouse}
          label={t("storageOptionsCount", { count: storageCount, defaultValue: `${storageCount} storage ${storageCount === 1 ? "option" : "options"}` })}
        />
      )}
    </div>
  ) : null;

  return (
    <motion.div
      key={kitchen.id}
      initial="hidden"
      animate="visible"
      exit={{ opacity: 0, y: -20 }}
      variants={fadeInUp}
      className="space-y-6"
    >
      <KitchenPhotoCollage images={allImages} kitchenName={kitchen.name} />

      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{kitchen.name}</h2>
          {rateLabel && (
            <p className="text-lg font-semibold text-[#F51042] shrink-0">{rateLabel}</p>
          )}
        </div>
        {factChips}
        {aboutCopy && isStacked && (
          <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{aboutCopy}</p>
        )}
      </div>

      {isStacked ? (
        <>
          {kitchen.amenities && kitchen.amenities.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-[#F51042]" />
                Amenities
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
            />
          )}

          {locationAddress && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#F51042]" />{t("whereItIs", "Where it is")}</h3>
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
                <LayoutGrid className="w-4 h-4 mr-2" />
                Overview
              </TabsTrigger>
              {hasEquipment && (
                <TabsTrigger 
                  value="equipment"
                  data-preview-tour="tab-equipment"
                  className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-t-lg rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-2.5 text-sm font-medium"
                >
                  <CookingPot className="w-4 h-4 mr-2" />{t("equipment", "Equipment")}<Badge variant="count" className="ml-2">
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
                  <Warehouse className="w-4 h-4 mr-2" />{t("storage", "Storage")}<Badge variant="count" className="ml-2">
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
                        <FileText className="w-4 h-4 text-[#F51042]" />
                        {kitchen.description ? "About This Kitchen" : "About This Space"}
                      </h3>
                      <p className="text-[#6B6B6B] leading-relaxed whitespace-pre-wrap">
                        {aboutCopy}
                      </p>
                    </div>
                  )}
                  
                  {kitchen.availability && kitchen.availability.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-[#F51042]" />
                        Weekly Availability
                      </h3>
                      <AvailabilityDisplay availability={kitchen.availability} />
                    </div>
                  )}
                  
                  {kitchen.amenities && Array.isArray(kitchen.amenities) && kitchen.amenities.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <ListChecks className="w-4 h-4 text-[#F51042]" />
                        Kitchen Amenities
                      </h3>
                      <KitchenAmenitiesList amenities={kitchen.amenities} />
                    </div>
                  )}
                  
                  {locationAddress && (
                    <div className="pt-4 border-t border-border/50">
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-[#F51042]" />
                        Location
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

export default function KitchenPreviewPage() {
  const { t } = useTranslation("kitchen");
  const { t: tChef } = useTranslation("chef");
  const [locationPath, navigate] = useLocation();
  const { user, loading: authLoading } = useFirebaseAuth();
  const { openAuthModal } = useAuthModal();
  const isAuthenticated = !!user;
  const useChefChrome = isChefUser(user);

  const locationIdMatch = locationPath.match(/\/kitchen-preview\/(.+)/);
  const identifier = locationIdMatch ? locationIdMatch[1] : null;

  const [selectedKitchen, setSelectedKitchen] = useState<PublicKitchen | null>(null);
  const [kitchenEquipment, setKitchenEquipment] = useState<{ included: EquipmentListing[]; rental: EquipmentListing[] } | null>(null);
  const [kitchenStorage, setKitchenStorage] = useState<StorageListing[] | null>(null);
  const [isLoadingAddons, setIsLoadingAddons] = useState(false);
  const [activeView, setActiveView] = useState("discover-kitchens");
  const [tourModalOpen, setTourModalOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [tourReplayToken, setTourReplayToken] = useState(0);

  const { data: locationData, isLoading, error } = useQuery<PublicLocation & { kitchens: PublicKitchen[], slug?: string }>({
    queryKey: [`/api/public/locations/${identifier}/details`],
    queryFn: async () => {
      const response = await fetch(`/api/public/locations/${identifier}/details`);
      if (!response.ok) throw new Error("Location not found");
      return response.json();
    },
    enabled: !!identifier,
    placeholderData: keepPreviousData,
  });

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
  const globalAppApproved = globalApplication?.status === 'approved';
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

  useEffect(() => {
    if (locationData?.kitchens?.length && !selectedKitchen) {
      setSelectedKitchen(locationData.kitchens[0]);
    }
  }, [locationData?.kitchens, selectedKitchen]);

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

  const handleGetStarted = () => {
    if (isAuthenticated) {
      if (canBook) {
        navigate(`/book-kitchen${locationId ? `?location=${locationId}` : ''}`);
      } else if (alreadyApplied) {
        // Unified "My Applications" page where both seller and kitchen
        // applications are shown together (user explicitly requested this).
        navigate(chefDashboardHref("applications"));
      } else if (locationData?.canAcceptApplications !== false) {
        navigate(`/kitchen-requirements/${locationId}`);
      }
    } else {
      openAuthModal({
        title: t("authModalBookKitchenTitle", "Almost there!"),
        description: <KitchenNextStepsDescription type="book" />,
        requireApplication: true
      });
    }
  };

  const handleBookClick = () => {
    if (canBook) {
      navigate(`/book-kitchen${locationId ? `?location=${locationId}` : ''}`);
    } else if (alreadyApplied) {
      navigate(chefDashboardHref("applications"));
    } else if (locationData?.canAcceptApplications !== false) {
      navigate(`/kitchen-requirements/${locationId}`);
    }
  };

  const handleApplyClick = () => {
    // Only navigate to application if location can accept applications
    if (locationData?.canAcceptApplications !== false) {
      if (isAuthenticated && alreadyApplied) {
        // Already applied for this kitchen: go to My Applications (unified
        // page per user request).
        navigate(chefDashboardHref("applications"));
      } else {
        navigate(`/kitchen-requirements/${locationId}`);
      }
    }
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
        <ImageOff className="h-8 w-8 text-muted-foreground" />
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
    const sidebar = !isAuthenticated
      ? { title: t("howToCookHere", "How to cook here"), subtitle: t("applyFirstThenBook", "Apply first, then book time") }
      : applicationLoading
        ? { title: t("howToCookHere", "How to cook here"), subtitle: t("checkingApplication", "Checking your application…") }
        : display?.actionKind === "book"
          ? { title: t("readyToBookTitle", "Ready to book"), subtitle: t("youAreApprovedAtKitchen", "You're approved at this kitchen") }
          : display?.actionKind === "complete-step"
            ? { title: t("yourApplicationTitle", "Your application"), subtitle: t("fewStepsLeftToBook", "A few steps left before you can book") }
            : alreadyApplied
              ? { title: t("yourApplicationTitle", "Your application"), subtitle: t("alreadyAppliedToKitchen", "You've already applied to this kitchen") }
              : canReapply
                ? { title: t("yourApplicationTitle", "Your application"), subtitle: display?.label ?? t("applicationClosed", "Application closed") }
                : { title: t("howToCookHere", "How to cook here"), subtitle: t("applyFirstThenBook", "Apply first, then book time") };

    const nextSteps = (() => {
      if (!isAuthenticated) {
        if (location.canAcceptApplications === false) {
          return (
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              {t("notAcceptingAppsNotice", "This location is not accepting new chef applications yet. You can still look around, and check back once it opens.")}
            </p>
          );
        }
        return (
          <>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              {t("createAccountThenApplyNotice", "Create an account, then apply. Once this kitchen approves you, you can book cooking time.")}
            </p>
            <ol className="mt-4 space-y-2.5 text-sm text-gray-600">
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F8F8F8] text-[11px] font-semibold text-gray-500">1</span>
                {t("applyToCookHereStep", "Apply to cook here")}
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F8F8F8] text-[11px] font-semibold text-gray-500">2</span>
                {t("afterApprovedBookSessions", "After you're approved, book sessions on the calendar")}
              </li>
            </ol>
            <Button onClick={handleGetStarted} variant="outline" className="mt-4 w-full" data-preview-tour="cta">
              {t("continueWithAccount", "Continue with an account")}
            </Button>
          </>
        );
      }

      if (applicationLoading) {
        return (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        );
      }

      if (canBook || display?.actionKind === "book") {
        return (
          <>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              {t("youAreApprovedBookNotice", "You're approved. Book a cooking session whenever you're ready.")}
            </p>
            <Button onClick={handleBookClick} className="mt-4 w-full" data-preview-tour="cta">
              <Calendar className="mr-2 h-4 w-4" />
              {t("bookThisKitchen")}
            </Button>
          </>
        );
      }

      if (display?.actionKind === "complete-step") {
        return (
          <>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              {t("finishRemainingStepsNotice", "Finish a few remaining steps, then you can start booking sessions here.")}
            </p>
            <Button onClick={handleApplyClick} className="mt-4 w-full" data-preview-tour="cta">
              {t("continueApplication")}
            </Button>
          </>
        );
      }

      if (alreadyApplied) {
        return (
          <>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              {t("youveAlreadyApplied", "You've already applied. ")}
              {display?.label === "In review"
                ? t("alreadyAppliedInReview", "The kitchen is reviewing your application. You can book sessions once you're approved.")
                : t("alreadyAppliedReviewFinished", "You can book sessions once this kitchen finishes review.")}
            </p>
            <Button
              variant="outline"
              className="mt-4 w-full"
              data-preview-tour="cta"
              onClick={() => navigate(chefDashboardHref("applications"))}
            >
              <FileText className="mr-2 h-4 w-4" />
              {t("viewApplicationBtn")}
            </Button>
          </>
        );
      }

      if (canReapply) {
        return (
          <>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              {application?.status === "rejected"
                ? t("applicationRejectedReapply", "This kitchen didn't approve your last application. You can apply again if you have updated documents.")
                : t("applicationCancelledReapply", "Your previous application was cancelled. You can apply again if you still want to cook here.")}
            </p>
            {location.canAcceptApplications !== false && (
              <Button onClick={handleApplyClick} className="mt-4 w-full" data-preview-tour="cta">
                <ClipboardList className="mr-2 h-4 w-4" />
                {t("applyAgain")}
              </Button>
            )}
          </>
        );
      }

      if (globalAppPending) {
        return (
          <>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              Your initial application is currently under review by our team.
            </p>
            <Button disabled className="mt-4 w-full" data-preview-tour="cta">
              Pending Admin Approval
            </Button>
          </>
        );
      }

      if (location.canAcceptApplications === false) {
        return (
          <p className="mt-2 text-sm text-gray-600 leading-relaxed">
            {t("notAcceptingNewChefApps")}
          </p>
        );
      }

      return (
        <>
          <p className="mt-2 text-sm text-gray-600 leading-relaxed">
            {t("applyToCookHereGeneral", "Apply to cook here. The kitchen reviews your application, then you can book sessions.")}
          </p>
          <Button onClick={handleApplyClick} className="mt-4 w-full" data-preview-tour="cta">
            {t("applyBtn", "Apply")}
          </Button>
        </>
      );
    })();

    return (
      <div className="space-y-6">
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

        <div className="flex items-start gap-3 sm:gap-4 min-w-0">
          {location.logoUrl ? (
            <SmartImage
              src={location.logoUrl}
              alt={location.name}
              className="h-12 w-12 sm:h-14 sm:w-14 rounded-xl object-cover flex-shrink-0"
            />
          ) : (
            <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-xl bg-gradient-to-br from-[#F51042] to-[#FF6B7A] flex items-center justify-center flex-shrink-0">
              <Building2 className="h-6 w-6 text-white" />
            </div>
          )}
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
                  <Clock className="h-3 w-3 mr-1" />
                  Verification in progress
                </Badge>
              )}
              {location.kitchenLicenseStatus === "approved" && (
                <Badge variant="success" className="text-xs">
                  <BadgeCheck className="h-3 w-3 mr-1" />{t("licensedKitchenBadge", "Licensed kitchen")}</Badge>
              )}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{location.address}</span>
            </p>
            {location.description && (
              <p className="mt-2 text-sm text-gray-600 leading-relaxed max-w-2xl">
                {location.description}
              </p>
            )}
            <p className="mt-2 text-sm text-gray-500">
              {t("kitchensAtThisLocationPrefix", { count: kitchens.length, defaultValue: `${kitchens.length} ${kitchens.length === 1 ? "kitchen" : "kitchens"}` })} {t("kitchensAtThisLocationSuffix", "at this location")}
              {location.canAcceptApplications === false ? ` · ${t("notAcceptingNewApplicationsYet", "Not accepting new applications yet")}` : ""}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 -ml-2 mt-2 gap-1.5 px-2 font-normal text-gray-500 hover:text-gray-900"
              onClick={() => setTourReplayToken((token) => token + 1)}
            >
              <Info className="h-4 w-4" />{t("whatButtonsDo", "What buttons do?")}</Button>
          </div>
        </div>

        {!alreadyApplied && (
          <KitchenTourBanner
            toursAvailable={toursAvailable}
            isLoading={tourStatusLoading}
            alreadyApplied={alreadyApplied}
            onSchedule={() => {
              if (!isAuthenticated) {
                openAuthModal({
                  title: t("authModalScheduleTourTitle", "Almost there!"),
                  description: <KitchenNextStepsDescription type="tour" />,
                  preAuthComponent: (
                    <ScheduleViewingWidget 
                      locationId={locationId!} 
                      locationName={locationData?.name}
                      mode="inline"
                    />
                  ),
                  defaultTab: "register"
                });
              } else {
                setTourModalOpen(true);
              }
            }}
          />
        )}

        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 sm:gap-8">
          <div className="lg:col-span-7 xl:col-span-8 space-y-5">
            {kitchens.length > 1 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Choose a kitchen
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
                        <span className={cn("block text-sm font-semibold", selected ? "text-[#F51042]" : "text-gray-900")}>
                          {kitchen.name}
                        </span>
                        {rate && <span className="block text-xs text-gray-500 mt-0.5">{rate}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
                    <Utensils className="h-10 w-10 sm:h-12 sm:w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm sm:text-base text-gray-500">{t("noKitchensListedYet", "No kitchens are listed at this location yet.")}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <aside className="lg:col-span-5 xl:col-span-4 space-y-4 lg:sticky lg:top-24 self-start">
            <GuestHoursCard
              availability={selectedKitchen?.availability}
              kitchenId={selectedKitchen?.id?.toString()}
              locationId={locationId?.toString()}
              kitchenName={selectedKitchen?.name}
              kitchenRate={selectedKitchen ? formatKitchenRate(selectedKitchen) : undefined}
              application={application}
              applicationLoading={applicationLoading}
              locationApplicationLoading={locationApplicationLoading}
              listApplicationLoading={applicationsListLoading}
              onProceed={handleGetStarted}
              canBook={canBook}
              alreadyApplied={alreadyApplied}
              onConfirmModalOpenChange={setIsConfirmModalOpen}
            />
            {isAuthenticated && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                  {alreadyApplied || canBook ? (
                    <CheckCircle2 className="h-4 w-4 text-[#F51042]" />
                  ) : (
                    <ClipboardList className="h-4 w-4 text-[#F51042]" />
                  )}
                  {sidebar.title}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">{sidebar.subtitle}</p>
                {nextSteps}
              </div>
            )}
          </aside>
        </div>

        <KitchenPreviewWalkthrough
          key={identifier ?? location.id}
          enabled={!!user && !tourModalOpen && !isConfirmModalOpen}
          replayToken={tourReplayToken}
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
            { label: t("shellDashboard"), onClick: () => navigate('/dashboard') },
            { label: t("shellDiscoverKitchens"), onClick: () => navigate('/dashboard?view=discover-kitchens') },
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
          <Loader2 className="h-8 w-8 sm:h-10 sm:w-10 animate-spin text-[#F51042] mx-auto mb-3" />
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
      <Header />
      <main className="flex-1 pt-16 sm:pt-20 pb-8 sm:pb-12">
        <div className="container mx-auto px-4 sm:px-6 max-w-7xl py-6 sm:py-8">
          {mainContent(locationData)}
        </div>
      </main>
      <Footer />
      {scheduleTourSheet}
    </div>
  );
}
