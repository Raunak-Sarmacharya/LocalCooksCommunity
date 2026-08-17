import { logger } from "@/lib/logger";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, MapPin, Loader2, Calendar, DoorOpen,
  ChevronLeft, ChevronRight, Utensils, Check, ImageOff, FileText, Clock,
  CookingPot, Warehouse, Snowflake, ListChecks, BadgeCheck, Refrigerator,
  DollarSign, LayoutGrid, X, CheckCircle2, ClipboardList, Images, Ruler
} from "lucide-react";
import { formatCurrency, formatTime } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect, useCallback, useMemo } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import useEmblaCarousel from 'embla-carousel-react';
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { LocationMap } from "@/components/ui/location-map";
import { cn } from "@/lib/utils";
import { ScheduleViewingWidget } from "@/components/chef/ScheduleViewingWidget";
import { getAuthHeaders } from "@/lib/api";

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
      <img
        src={proxyUrl}
        alt={`${kitchenName} photo ${index + 1}`}
        className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]"
        onError={(e) => {
          logger.error("Image failed to load:", imageUrl);
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      {overlay}
    </button>
  );
}

// LightboxCarousel Component
function LightboxCarousel({ images, initialIndex, onClose, kitchenName }: { images: string[]; initialIndex: number; onClose: () => void; kitchenName: string; }) {
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
          aria-label="Close lightbox"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative flex items-center justify-center" ref={emblaRef}>
        <div className="flex h-full w-full items-center">
          {images.map((img, index) => (
            <div key={index} className="flex-[0_0_100%] min-w-0 h-full flex items-center justify-center p-0 sm:p-8">
              <img 
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

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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

function availableDaySummary(availability?: PublicKitchen["availability"]): string | null {
  if (!availability || availability.length === 0) return null;
  const days = availability.filter((a) => a.isAvailable);
  if (days.length === 0) return "Hours not listed";
  if (days.length === 7) return "Open every day";
  return `Open ${days.map((a) => DAY_SHORT[a.dayOfWeek]).join(", ")}`;
}

// Availability Display Component (Old Eagle 35 Style)
// https://uiverse.io/CheekyTurtle/old-eagle-35
function AvailabilityDisplay({ availability }: { availability: PublicKitchen['availability'] }) {
  if (!availability) return null;

  const days = [
    { label: 'S', dayIndex: 0 },
    { label: 'M', dayIndex: 1 },
    { label: 'T', dayIndex: 2 },
    { label: 'W', dayIndex: 3 },
    { label: 'T', dayIndex: 4 },
    { label: 'F', dayIndex: 5 },
    { label: 'S', dayIndex: 6 },
  ];

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
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);

  const openAt = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  if (images.length === 0) {
    return (
      <div className="aspect-[16/9] bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl flex flex-col items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center mb-3">
          <ImageOff className="w-8 h-8 text-gray-400" />
        </div>
        <p className="text-gray-500 font-medium">No photos yet</p>
        <p className="text-gray-400 text-sm mt-1">Photos coming soon</p>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 rounded-2xl overflow-hidden shadow-xl">
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
                    <span className="text-sm font-semibold">View {extraCount} more</span>
                  </span>
                ) : undefined
              }
            />
          );
        })}
      </div>
      {images.length > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">Click a photo to enlarge</p>
          {extraCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-800 hover:text-[#F51042]"
            >
              <Images className="h-4 w-4" />
              View all {images.length} photos
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
function EquipmentCard({ 
  equipment, 
  type 
}: { 
  equipment: EquipmentListing; 
  type: 'included' | 'rental';
}) {
  const isIncluded = type === 'included';
  
  return (
    <motion.div
      variants={itemVariants}
      className="group relative rounded-xl border border-[#2C2C2C]/8 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[#F51042]/25 hover:shadow-[0_8px_24px_rgba(245,16,66,0.08)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#FFF8F5] ring-1 ring-[#F51042]/10">
              <CookingPot className="h-4 w-4 text-[#F51042]" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-sm font-semibold leading-tight text-[#1A1A1A]">
                {equipment.equipmentType}
              </h4>
              {equipment.brand && equipment.model && (
                <p className="truncate text-xs text-[#6B6B6B]">
                  {equipment.brand} {equipment.model}
                </p>
              )}
            </div>
          </div>
          {equipment.description && (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[#6B6B6B]">
              {equipment.description}
            </p>
          )}
          {equipment.category && (
            <span className="mt-2 inline-block rounded-full bg-[#FFF8F5] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#6B4A4F] ring-1 ring-[#F51042]/10">
              {equipment.category}
            </span>
          )}
        </div>
        
        <div className="flex-shrink-0 text-right">
          {isIncluded ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#F51042]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#F51042]">
              Included
            </span>
          ) : (
            <>
              {equipment.sessionRate && equipment.sessionRate > 0 ? (
                <div>
                  <p className="text-sm font-bold text-[#1A1A1A]">
                    ${equipment.sessionRate.toFixed(2)}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-[#6B6B6B]">per session</p>
                </div>
              ) : (
                <span className="text-[10px] font-medium uppercase tracking-wider text-[#6B6B6B]">Rental</span>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE CARD — brand-restrained, marketplace-clean
// ═══════════════════════════════════════════════════════════════════════════════
function StorageCard({ storage }: { storage: StorageListing }) {
  const getStorageIcon = (type: string) => {
    const t = (type || "").toLowerCase();
    if (t.includes("freez")) return Snowflake;
    if (t.includes("cold") || t.includes("refrig") || t.includes("chill") || t.includes("cooler")) {
      return Refrigerator;
    }
    return Warehouse;
  };
  
  const StorageIcon = getStorageIcon(storage.storageType);
  
  return (
    <motion.div
      variants={itemVariants}
      className="group relative rounded-xl border border-[#2C2C2C]/8 bg-white p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-[#F51042]/25 hover:shadow-[0_8px_24px_rgba(245,16,66,0.08)]"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[#FFF8F5] ring-1 ring-[#F51042]/10 transition-transform group-hover:scale-105">
          <StorageIcon className="h-6 w-6 text-[#F51042]" />
        </div>
        
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-[#1A1A1A]">
                {storage.name || storage.storageType}
              </h4>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-[#6B4A4F]">
                {storage.storageType} Storage
              </p>
            </div>
            
            {storage.basePrice !== undefined && storage.basePrice > 0 && (
              <div className="text-right">
                <p className="text-lg font-bold text-[#1A1A1A]">
                  ${storage.basePrice.toFixed(2)}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-[#6B6B6B]">
                  {storage.pricingModel === 'per-cubic-foot' || storage.pricingModel === 'per_cubic_foot' ? 'base price' : 
                   storage.pricingModel === 'daily' ? 'per day' :
                   storage.pricingModel === 'hourly' ? 'per hour' :
                   storage.pricingModel === 'monthly-flat' ? 'per month' : 'per day'}
                </p>
              </div>
            )}
          </div>
          
          {storage.description && (
            <p className="mb-3 text-sm leading-relaxed text-[#6B6B6B] line-clamp-3">
              {storage.description}
            </p>
          )}
          
          <div className="flex flex-wrap items-center gap-2">
            {storage.climateControl && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF8F5] px-2.5 py-1 text-xs text-[#6B4A4F] ring-1 ring-[#F51042]/10">
                <Snowflake className="h-3 w-3 text-[#F51042]" />
                Climate Controlled
              </span>
            )}
            
            {storage.totalVolume && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F8F8F8] px-2.5 py-1 text-xs text-[#6B6B6B] ring-1 ring-[#2C2C2C]/8">
                <Ruler className="h-3 w-3" />
                {storage.totalVolume} ft³
              </span>
            )}
            
            {storage.dimensionsLength && storage.dimensionsWidth && storage.dimensionsHeight && (
              <span className="rounded-full bg-[#F8F8F8] px-2.5 py-1 text-xs text-[#6B6B6B] ring-1 ring-[#2C2C2C]/8">
                {storage.dimensionsLength}" × {storage.dimensionsWidth}" × {storage.dimensionsHeight}"
              </span>
            )}
            
            {(storage.pricingModel === 'per_cubic_foot' || storage.pricingModel === 'per-cubic-foot') && storage.pricePerCubicFoot && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF8F5] px-2.5 py-1 text-xs text-[#F51042] ring-1 ring-[#F51042]/15">
                <DollarSign className="h-3 w-3" />
                +${storage.pricePerCubicFoot.toFixed(2)}/ft³
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
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

function KitchenEquipmentSections({ kitchen }: { kitchen: PublicKitchen }) {
  const includedCount = kitchen.equipment?.included?.length || 0;

  return (
    <div className="space-y-6">
      {kitchen.equipment?.included && kitchen.equipment.included.length > 0 && (
        <div>
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFF8F5] ring-1 ring-[#F51042]/10">
              <CheckCircle2 className="h-4 w-4 text-[#F51042]" />
            </div>
            <div>
              <h3 className="font-semibold text-[#1A1A1A]">Included with your booking</h3>
              <p className="text-xs text-[#6B6B6B]">No extra charge</p>
            </div>
            <span className="ml-auto rounded-full bg-[#F51042]/10 px-2.5 py-1 text-xs font-semibold text-[#F51042]">
              {kitchen.equipment.included.length} {kitchen.equipment.included.length === 1 ? "item" : "items"}
            </span>
          </div>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid gap-3 sm:grid-cols-2"
          >
            {kitchen.equipment.included.map((eq) => (
              <EquipmentCard key={eq.id} equipment={eq} type="included" />
            ))}
          </motion.div>
        </div>
      )}

      {kitchen.equipment?.rental && kitchen.equipment.rental.length > 0 && (
        <div>
          {includedCount > 0 && <Separator className="my-6" />}
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F8F8F8] ring-1 ring-[#2C2C2C]/8">
              <DollarSign className="h-4 w-4 text-[#6B6B6B]" />
            </div>
            <div>
              <h3 className="font-semibold text-[#1A1A1A]">Available to rent</h3>
              <p className="text-xs text-[#6B6B6B]">Optional add-on for your session</p>
            </div>
            <span className="ml-auto rounded-full bg-[#F8F8F8] px-2.5 py-1 text-xs font-medium text-[#6B6B6B] ring-1 ring-[#2C2C2C]/8">
              {kitchen.equipment.rental.length} {kitchen.equipment.rental.length === 1 ? "item" : "items"}
            </span>
          </div>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid gap-3 sm:grid-cols-2"
          >
            {kitchen.equipment.rental.map((eq) => (
              <EquipmentCard key={eq.id} equipment={eq} type="rental" />
            ))}
          </motion.div>
        </div>
      )}
    </div>
  );
}

function KitchenStorageSections({ kitchen }: { kitchen: PublicKitchen }) {
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="grid gap-4"
    >
      {kitchen.storage?.map((storage) => (
        <StorageCard key={storage.id} storage={storage} />
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
  onSchedule,
}: {
  toursAvailable: boolean;
  isLoading: boolean;
  onSchedule: () => void;
}) {
  if (isLoading) {
    return <Skeleton className="h-[120px] w-full rounded-2xl" />;
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
            Optional kitchen tour — not an application
          </p>
          <h2 className="mt-1 text-base sm:text-lg font-semibold text-gray-900">
            {toursAvailable ? "Want to see the kitchen first?" : "Tour dates coming soon"}
          </h2>
          {toursAvailable ? (
            <p className="mt-1 text-sm text-gray-600 leading-relaxed">
              Book a short in-person walkthrough. A tour does not submit an application, and it does not reserve cooking time.
            </p>
          ) : (
            <p className="mt-1 text-sm text-gray-600 leading-relaxed">
              Stay tuned for available dates. The kitchen manager has not published a tour schedule yet. You can still look around here, and apply separately if you want to cook.
            </p>
          )}
        </div>
        {toursAvailable && (
          <Button className="shrink-0 w-full sm:w-auto" onClick={onSchedule}>
            <Calendar className="mr-2 h-4 w-4" />
            Schedule a tour
          </Button>
        )}
      </div>
    </div>
  );
}

function GuestHoursCard({ availability }: { availability?: PublicKitchen["availability"] }) {
  const openDays = availability?.filter((a) => a.isAvailable) ?? [];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
        <Clock className="h-4 w-4 text-[#F51042]" />
        When you can cook
      </h2>
      <p className="text-xs text-gray-500 mt-0.5">Regular hours for this kitchen</p>
      <div className="mt-4 space-y-4">
        {availability && availability.length > 0 ? (
          <>
            <AvailabilityDisplay availability={availability} />
            {openDays.length > 0 ? (
              <div className="space-y-1.5">
                {openDays.map((a) => (
                  <div key={a.dayOfWeek} className="flex justify-between text-sm">
                    <span className="text-gray-600">{DAY_LABELS[a.dayOfWeek]}</span>
                    <span className="text-gray-900 font-medium">
                      {formatHourLabel(a.startTime)} – {formatHourLabel(a.endTime)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Hours have not been published yet.</p>
            )}
            <p className="text-xs text-gray-500 leading-relaxed">
              You pick exact session times after you&apos;re approved to book.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500">Hours have not been published yet.</p>
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
  const hoursSummary = availableDaySummary(kitchen.availability);
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
          label={`${includedCount} included ${includedCount === 1 ? "item" : "items"}`}
        />
      )}
      {rentalCount > 0 && (
        <KitchenFactChip
          icon={CookingPot}
          label={`${rentalCount} rental ${rentalCount === 1 ? "option" : "options"}`}
        />
      )}
      {storageCount > 0 && (
        <KitchenFactChip
          icon={Warehouse}
          label={`${storageCount} storage ${storageCount === 1 ? "option" : "options"}`}
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
            <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {!addonsLoading && hasEquipment && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <CookingPot className="w-4 h-4 text-[#F51042]" />
                Equipment
              </h3>
              <KitchenEquipmentSections kitchen={kitchen} />
            </div>
          )}

          {!addonsLoading && hasStorage && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2">
                <Warehouse className="w-4 h-4 text-[#F51042]" />
                Storage
              </h3>
              <p className="text-xs text-gray-500 mb-4">Secure space for ingredients and supplies</p>
              <KitchenStorageSections kitchen={kitchen} />
            </div>
          )}

          {locationAddress && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#F51042]" />
                Where it is
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
                className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-t-lg rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-2.5 text-sm font-medium"
              >
                <LayoutGrid className="w-4 h-4 mr-2" />
                Overview
              </TabsTrigger>
              {hasEquipment && (
                <TabsTrigger 
                  value="equipment" 
                  className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-t-lg rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-2.5 text-sm font-medium"
                >
                  <CookingPot className="w-4 h-4 mr-2" />
                  Equipment
                  <Badge variant="count" className="ml-2">
                    {includedCount + rentalCount}
                  </Badge>
                </TabsTrigger>
              )}
              {hasStorage && (
                <TabsTrigger 
                  value="storage" 
                  className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-t-lg rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-2.5 text-sm font-medium"
                >
                  <Warehouse className="w-4 h-4 mr-2" />
                  Storage
                  <Badge variant="count" className="ml-2">
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
  const [locationPath, navigate] = useLocation();
  const { user, loading: authLoading } = useFirebaseAuth();
  const isAuthenticated = !!user;

  const locationIdMatch = locationPath.match(/\/kitchen-preview\/(.+)/);
  const identifier = locationIdMatch ? locationIdMatch[1] : null;

  const [selectedKitchen, setSelectedKitchen] = useState<PublicKitchen | null>(null);
  const [kitchenEquipment, setKitchenEquipment] = useState<{ included: EquipmentListing[]; rental: EquipmentListing[] } | null>(null);
  const [kitchenStorage, setKitchenStorage] = useState<StorageListing[] | null>(null);
  const [isLoadingAddons, setIsLoadingAddons] = useState(false);
  const [activeView, setActiveView] = useState("discover-kitchens");
  const [tourModalOpen, setTourModalOpen] = useState(false);

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
    enabled: isAuthenticated && !!locationId,
  });
  const toursAvailable = tourStatus?.toursAvailable ?? tourStatus?.isActive ?? false;

  // Check if chef has an approved application for this location
  // Only check if user is authenticated
  const {
    application,
    hasApplication,
    canBook,
    isLoading: applicationLoading
  } = useChefKitchenApplicationForLocation(isAuthenticated && locationId ? locationId : null);

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
        // Navigate to booking page with location filter
        navigate(`/book-kitchen${locationId ? `?location=${locationId}` : ''}`);
      } else if (locationData?.canAcceptApplications !== false) {
        // Only navigate to application if location can accept applications
        navigate(`/kitchen-requirements/${locationId}`);
      }
      // If canAcceptApplications is false, do nothing (button should be disabled)
    } else {
      // Navigate to auth page with redirect
      navigate(`/auth?redirect=/kitchen-preview/${previewSlug}`);
    }
  };

  const handleBookClick = () => {
    if (canBook) {
      navigate(`/book-kitchen${locationId ? `?location=${locationId}` : ''}`);
    } else if (locationData?.canAcceptApplications !== false) {
      // Only navigate to application if location can accept applications
      navigate(`/kitchen-requirements/${locationId}`);
    }
  };

  const handleApplyClick = () => {
    // Only navigate to application if location can accept applications
    if (locationData?.canAcceptApplications !== false) {
      navigate(`/kitchen-requirements/${locationId}`);
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
      <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-2">Location Not Found</h1>
      <p className="text-sm sm:text-base text-muted-foreground mb-6">This kitchen location doesn&apos;t exist or has been removed.</p>
      <Button
        onClick={() => isAuthenticated ? navigate('/dashboard?view=discover-kitchens') : navigate('/')}
        variant="default"
      >
        {isAuthenticated ? 'Back to Discover Kitchens' : 'Back to Home'}
      </Button>
    </div>
  );

  // Main kitchen preview content — same layout for guests and signed-in chefs
  const mainContent = (locationData: PublicLocation & { kitchens: PublicKitchen[] }) => {
    const { kitchens, ...location } = locationData;
    const appStatus = application?.status;
    const currentTier = ((application as unknown as { current_tier?: number })?.current_tier ?? 1);

    const nextSteps = (() => {
      if (!isAuthenticated) {
        if (location.canAcceptApplications === false) {
          return (
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              This location is not accepting new chef applications yet. You can still look around, and check back once it opens.
            </p>
          );
        }
        return (
          <>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              Applying is how you request permission to cook here. Photos, hours, equipment, and storage are public — an account is only needed to submit an application.
            </p>
            <ol className="mt-4 space-y-2.5 text-sm text-gray-600">
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F8F8F8] text-[11px] font-semibold text-gray-500">1</span>
                Apply to this kitchen
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F8F8F8] text-[11px] font-semibold text-gray-500">2</span>
                After approval, book cooking sessions on the calendar
              </li>
            </ol>
            <Button onClick={handleGetStarted} variant="outline" className="mt-4 w-full">
              Continue with an account
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

      if (canBook) {
        return (
          <>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              You&apos;re approved to cook here. Booking reserves a cooking session on the calendar — it is not a tour.
            </p>
            <Button onClick={handleBookClick} className="mt-4 w-full">
              <Calendar className="mr-2 h-4 w-4" />
              Book this kitchen
            </Button>
          </>
        );
      }

      if (appStatus === "approved" && currentTier < 3) {
        return (
          <>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              Finish the rest of your application to unlock booking. A tour does not complete this for you.
            </p>
            <Button onClick={handleApplyClick} className="mt-4 w-full">
              Continue application
            </Button>
          </>
        );
      }

      if (appStatus === "inReview" || appStatus === "pending") {
        return (
          <p className="mt-2 text-sm text-gray-600 leading-relaxed">
            Your application is in review. Booking opens after you&apos;re approved. A tour is optional and separate from this application.
          </p>
        );
      }

      if (location.canAcceptApplications === false) {
        return (
          <p className="mt-2 text-sm text-gray-600 leading-relaxed">
            This location is not accepting new chef applications yet.
          </p>
        );
      }

      return (
        <>
          <p className="mt-2 text-sm text-gray-600 leading-relaxed">
            Applying requests permission to cook here. It is not a tour, and a tour does not apply for you.
          </p>
          <Button onClick={handleApplyClick} className="mt-4 w-full">
            <ClipboardList className="mr-2 h-4 w-4" />
            Apply to this kitchen
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
            <img
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
              {location.kitchenLicenseStatus === "pending" && (
                <Badge variant="warning" className="text-xs">
                  <Clock className="h-3 w-3 mr-1" />
                  Verification in progress
                </Badge>
              )}
              {location.kitchenLicenseStatus === "approved" && (
                <Badge variant="success" className="text-xs">
                  <BadgeCheck className="h-3 w-3 mr-1" />
                  Licensed kitchen
                </Badge>
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
              {kitchens.length} {kitchens.length === 1 ? "kitchen" : "kitchens"} at this location
              {location.canAcceptApplications === false ? " · Not accepting new applications yet" : ""}
            </p>
          </div>
        </div>

        {isAuthenticated && (
          <KitchenTourBanner
            toursAvailable={toursAvailable}
            isLoading={tourStatusLoading}
            onSchedule={() => setTourModalOpen(true)}
          />
        )}

        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 sm:gap-8">
          <div className="lg:col-span-8 xl:col-span-9 space-y-5">
            {kitchens.length > 1 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                  Choose a kitchen
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
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
                    <p className="text-sm sm:text-base text-gray-500">No kitchens are listed at this location yet.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <aside className="lg:col-span-4 xl:col-span-3 space-y-4 lg:sticky lg:top-24 self-start">
            <GuestHoursCard availability={selectedKitchen?.availability} />
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-[#F51042]" />
                How to cook here
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">Application and booking</p>
              {nextSteps}
            </div>
          </aside>
        </div>
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
    const opts = { replace: true } as const;
    if (view === 'overview') navigate('/dashboard', opts);
    else if (view === 'discover-kitchens') navigate('/dashboard?view=discover-kitchens', opts);
    else if (view === 'kitchen-applications') navigate('/dashboard?view=kitchen-applications', opts);
    else if (view === 'bookings') navigate('/dashboard?view=bookings', opts);
    else if (view === 'applications') navigate('/dashboard?view=applications', opts);
    else if (view === 'messages') navigate('/dashboard?view=messages', opts);
    else if (view === 'training') navigate('/dashboard?view=training', opts);
  };

  const scheduleTourSheet = isAuthenticated && locationId != null ? (
    <ScheduleViewingWidget
      locationId={locationId}
      locationName={locationData?.name}
      open={tourModalOpen}
      onClose={() => setTourModalOpen(false)}
    />
  ) : null;

  // If user is authenticated, wrap in ChefDashboardLayout
  if (isAuthenticated) {
    return (
      <>
        <ChefDashboardLayout
          activeView={activeView}
          onViewChange={handleViewChange}
          breadcrumbs={[
            { label: "Dashboard", onClick: () => navigate('/dashboard') },
            { label: "Discover Kitchens", onClick: () => navigate('/dashboard?view=discover-kitchens') },
            { label: locationData?.name || 'Kitchen' },
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
          <p className="text-sm sm:text-base text-gray-600">Loading kitchens...</p>
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
    </div>
  );
}
