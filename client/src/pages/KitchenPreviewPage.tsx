import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, MapPin, Loader2, ArrowRight, Calendar, Lock,
  ChevronLeft, ChevronRight, Utensils, Check, ImageOff, FileText, Clock,
  Wrench, Package, Snowflake, Star, Shield, Sparkles, Box, Thermometer,
  DollarSign, Info, ChefHat, Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect, useCallback, useMemo } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import useEmblaCarousel from 'embla-carousel-react';
import kitchenTableIcon from "@assets/kitchen-table.png";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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
function CarouselImage({ imageUrl, kitchenName, index }: { imageUrl: string; kitchenName: string; index: number }) {
  const proxyUrl = getR2ProxyUrl(imageUrl);

  return (
    <div className="flex-[0_0_100%] min-w-0">
      <div className="aspect-[16/9] bg-gray-100">
        <img
          src={proxyUrl}
          alt={`${kitchenName} - Image ${index + 1}`}
          className="w-full h-full object-cover"
          onError={(e) => {
            console.error('Image failed to load:', imageUrl);
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
          }}
        />
      </div>
    </div>
  );
}

interface PublicLocation {
  id: number;
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
  locationAddress?: string | null;
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

// Helper to format availability
function formatAvailability(availability?: PublicKitchen['availability']) {
  if (!availability || availability.length === 0) return null;

  const availableDays = availability.filter(a => a.isAvailable);
  if (availableDays.length === 0) return "Not available";

  if (availableDays.length === 7) return "Available 7 days a week";

  return `Available ${availableDays.length} days a week`;
}

// Helper functions for mini calendar
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function getMiniCalendarDays(year: number, month: number) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const days: (number | null)[] = [];

  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    days.push(day);
  }

  return days;
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

// ═══════════════════════════════════════════════════════════════════════════════
// PREMIUM KITCHEN SELECTION CARD - Notion-style selection with elegant transitions
// ═══════════════════════════════════════════════════════════════════════════════
function KitchenSelectionCard({
  kitchen,
  isSelected,
  onSelect
}: {
  kitchen: PublicKitchen;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const hasEquipment = kitchen.equipment && (
    (kitchen.equipment.included?.length || 0) + (kitchen.equipment.rental?.length || 0) > 0
  );
  const hasStorage = kitchen.storage && kitchen.storage.length > 0;
  
  return (
    <motion.button
      onClick={onSelect}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "w-full text-left p-3 rounded-xl border-2 transition-all duration-300 touch-manipulation relative overflow-hidden",
        isSelected
          ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
          : "border-border/60 hover:border-primary/40 hover:bg-muted/30 bg-background"
      )}
    >
      {/* Selection indicator line */}
      <motion.div
        initial={false}
        animate={{ 
          scaleY: isSelected ? 1 : 0,
          opacity: isSelected ? 1 : 0
        }}
        transition={{ duration: 0.2 }}
        className="absolute left-0 top-2 bottom-2 w-1 bg-primary rounded-r-full"
      />
      
      <div className="flex items-center gap-3">
        {/* Thumbnail with gradient overlay */}
        <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-muted">
          {kitchen.imageUrl ? (
            <>
              <img
                src={kitchen.imageUrl}
                alt={kitchen.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
              <ChefHat className="w-6 h-6 text-primary/60" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className={cn(
            "font-semibold text-sm truncate transition-colors",
            isSelected ? "text-primary" : "text-foreground"
          )}>
            {kitchen.name}
          </h3>
          
          {/* Feature indicators */}
          <div className="flex items-center gap-1.5 mt-1.5">
            {hasEquipment && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="w-5 h-5 rounded-md bg-emerald-100 flex items-center justify-center">
                      <Wrench className="w-3 h-3 text-emerald-600" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Equipment available
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {hasStorage && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="w-5 h-5 rounded-md bg-violet-100 flex items-center justify-center">
                      <Package className="w-3 h-3 text-violet-600" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Storage available
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {kitchen.availability && (
              <span className="text-[10px] text-muted-foreground ml-1">
                {formatAvailability(kitchen.availability)}
              </span>
            )}
          </div>
        </div>

        {/* Selected indicator */}
        <motion.div 
          initial={false}
          animate={{ 
            scale: isSelected ? 1 : 0.8,
            opacity: isSelected ? 1 : 0
          }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0"
        >
          <Check className="w-3.5 h-3.5 text-white" />
        </motion.div>
      </div>
    </motion.button>
  );
}

// Image Carousel Component - Mobile Optimized
function ImageCarousel({ images, kitchenName }: { images: string[]; kitchenName: string }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    dragFree: false,
    containScroll: 'trimSnaps',
    slidesToScroll: 1
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
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
    // Initialize state from embla on mount
    const initializeState = () => {
      setSelectedIndex(emblaApi.selectedScrollSnap());
      setCanScrollPrev(emblaApi.canScrollPrev());
      setCanScrollNext(emblaApi.canScrollNext());
    };
    initializeState();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi, onSelect]);

  if (images.length === 0) {
    return (
      <div className="aspect-[16/9] bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl flex flex-col items-center justify-center">
        <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center mb-4">
          <ImageOff className="w-10 h-10 text-gray-400" />
        </div>
        <p className="text-gray-500 font-medium">No images available</p>
        <p className="text-gray-400 text-sm mt-1">Photos coming soon</p>
      </div>
    );
  }

  return (
    <div className="relative group">
      {/* Main Carousel */}
      <div className="overflow-hidden rounded-xl" ref={emblaRef}>
        <div className="flex">
          {images.map((img, index) => (
            <CarouselImage key={index} imageUrl={img} kitchenName={kitchenName} index={index} />
          ))}
        </div>
      </div>

      {/* Navigation Arrows - Visible on mobile, hover on desktop */}
      {images.length > 1 && (
        <>
          <button
            onClick={scrollPrev}
            className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 w-9 h-9 sm:w-10 sm:h-10 bg-white/95 hover:bg-white active:bg-white rounded-full shadow-lg flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity disabled:opacity-30 touch-manipulation z-10"
            disabled={!canScrollPrev}
            aria-label="Previous image"
          >
            <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 text-gray-700" />
          </button>
          <button
            onClick={scrollNext}
            className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 w-9 h-9 sm:w-10 sm:h-10 bg-white/95 hover:bg-white active:bg-white rounded-full shadow-lg flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity disabled:opacity-30 touch-manipulation z-10"
            disabled={!canScrollNext}
            aria-label="Next image"
          >
            <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-gray-700" />
          </button>
        </>
      )}

      {/* Dots Indicator - Larger and more touch-friendly on mobile */}
      {images.length > 1 && (
        <div className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 sm:gap-2 z-10">
          {images.map((_, index) => (
            <button
              key={index}
              onClick={() => emblaApi?.scrollTo(index)}
              className={`rounded-full transition-all touch-manipulation ${index === selectedIndex
                ? 'bg-white w-6 sm:w-6 h-2 sm:h-2'
                : 'bg-white/50 hover:bg-white/75 w-2 h-2 sm:w-2 sm:h-2'
                }`}
              aria-label={`Go to image ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Image Counter */}
      <div className="absolute top-3 sm:top-4 right-3 sm:right-4 bg-black/60 text-white text-xs px-2 sm:px-2.5 py-1 rounded-full z-10">
        {selectedIndex + 1} / {images.length}
      </div>
    </div>
  );
}

// Mini Calendar Component - Mobile Responsive
function MiniCalendarPreview({
  isAuthenticated,
  canBook,
  canAcceptApplications,
  onBookClick,
  onApplyClick: _onApplyClick
}: {
  isAuthenticated: boolean;
  canBook: boolean;
  canAcceptApplications: boolean;
  onBookClick: () => void;
  onApplyClick: () => void;
}) {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const days = getMiniCalendarDays(currentYear, currentMonth);
  const todayDate = today.getDate();

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  return (
    <div className="relative">
      {/* Calendar Content - Fully visible */}
      <div className="p-3 sm:p-4">
        {/* Month/Year Header */}
        <div className="text-center mb-3 sm:mb-4">
          <h3 className="text-sm sm:text-base font-bold text-gray-800">
            {monthNames[currentMonth]} {currentYear}
          </h3>
        </div>

        {/* Day Headers */}
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1 mb-1.5 sm:mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
            <div key={i} className="text-[9px] sm:text-[10px] text-gray-500 font-semibold text-center py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar Days */}
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
          {days.map((day, index) => {
            if (day === null) {
              return <div key={index} className="aspect-square" />;
            }

            const isPast = day < todayDate;
            const isToday = day === todayDate;

            return (
              <div
                key={index}
                className={`
                  aspect-square flex items-center justify-center rounded-md text-[10px] sm:text-xs font-medium
                  transition-colors
                  ${isPast ? 'text-gray-300 bg-gray-50' : 'text-gray-700 bg-white'}
                  ${isToday
                    ? 'bg-[#F51042] text-white font-bold ring-2 ring-[#F51042]/30'
                    : ''
                  }
                `}
              >
                {day}
              </div>
            );
          })}
        </div>
      </div>

      {/* Overlay - Only show if not authenticated or can't book */}
      {(!isAuthenticated || !canBook) && (
        <div className="absolute inset-0 bg-white/70 z-10 flex items-center justify-center rounded-b-lg">
          <div className="text-center px-3 sm:px-4 py-2.5 sm:py-3 bg-white/90 rounded-xl shadow-lg border border-gray-100 mx-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 mx-auto mb-1.5 sm:mb-2 bg-[#F51042]/10 rounded-full flex items-center justify-center">
              <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-[#F51042]" />
            </div>
            <p className="text-xs sm:text-sm font-semibold text-gray-800">
              {!isAuthenticated ? 'Sign in to book' : !canAcceptApplications ? 'Not accepting applications' : 'Apply to book'}
            </p>
            <p className="text-[10px] sm:text-xs text-gray-500 mt-1">
              {!isAuthenticated ? 'View availability & reserve' : !canAcceptApplications ? 'License pending approval' : 'View availability & reserve'}
            </p>
          </div>
        </div>
      )}

      {/* Book Button - Only show if authenticated and can book */}
      {isAuthenticated && canBook && (
        <div className="p-3 sm:p-4 pt-0">
          <Button
            onClick={onBookClick}
            className="w-full bg-[#F51042] hover:bg-[#D90E3A] text-white font-semibold text-xs sm:text-sm py-2.5 sm:py-2 mt-3"
            size="sm"
          >
            <Calendar className="mr-2 h-3.5 w-3.5" />
            Book This Kitchen
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PREMIUM EQUIPMENT CARD - Notion-style clean design
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
      className={cn(
        "group relative p-4 rounded-xl border transition-all duration-200",
        "hover:shadow-md hover:-translate-y-0.5",
        isIncluded 
          ? "bg-gradient-to-br from-emerald-50/80 to-white border-emerald-200/60 hover:border-emerald-300" 
          : "bg-gradient-to-br from-slate-50/80 to-white border-slate-200/60 hover:border-slate-300"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
              isIncluded ? "bg-emerald-100" : "bg-slate-100"
            )}>
              <Wrench className={cn(
                "w-4 h-4",
                isIncluded ? "text-emerald-600" : "text-slate-600"
              )} />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold text-foreground text-sm leading-tight truncate">
                {equipment.equipmentType}
              </h4>
              {equipment.brand && equipment.model && (
                <p className="text-xs text-muted-foreground truncate">
                  {equipment.brand} {equipment.model}
                </p>
              )}
            </div>
          </div>
          {equipment.category && (
            <Badge variant="secondary" className="text-[10px] mt-2 capitalize">
              {equipment.category}
            </Badge>
          )}
        </div>
        
        <div className="text-right flex-shrink-0">
          {isIncluded ? (
            <div className="flex items-center gap-1 text-emerald-600">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-xs font-semibold">Included</span>
            </div>
          ) : (
            <>
              {equipment.sessionRate && equipment.sessionRate > 0 ? (
                <div>
                  <p className="text-sm font-bold text-foreground">
                    ${equipment.sessionRate.toFixed(2)}
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">per session</p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PREMIUM STORAGE CARD - Elegant display with all details
// ═══════════════════════════════════════════════════════════════════════════════
function StorageCard({ storage }: { storage: StorageListing }) {
  const getStorageIcon = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'freezer': return Snowflake;
      case 'cold': case 'refrigerator': return Thermometer;
      default: return Box;
    }
  };
  
  const getStorageColor = (type: string) => {
    switch (type?.toLowerCase()) {
      case 'freezer': return { bg: 'bg-cyan-100', text: 'text-cyan-600', border: 'border-cyan-200' };
      case 'cold': case 'refrigerator': return { bg: 'bg-blue-100', text: 'text-blue-600', border: 'border-blue-200' };
      default: return { bg: 'bg-amber-100', text: 'text-amber-600', border: 'border-amber-200' };
    }
  };
  
  const StorageIcon = getStorageIcon(storage.storageType);
  const colors = getStorageColor(storage.storageType);
  
  return (
    <motion.div
      variants={itemVariants}
      className="group relative p-5 rounded-xl bg-gradient-to-br from-violet-50/50 via-white to-white border border-violet-200/50 hover:border-violet-300 hover:shadow-lg transition-all duration-300"
    >
      <div className="flex items-start gap-4">
        <div className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105",
          colors.bg
        )}>
          <StorageIcon className={cn("w-6 h-6", colors.text)} />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <h4 className="font-semibold text-foreground text-base">
                {storage.name || storage.storageType}
              </h4>
              <p className="text-xs text-muted-foreground capitalize mt-0.5">
                {storage.storageType} Storage
              </p>
            </div>
            
            {storage.basePrice !== undefined && storage.basePrice > 0 && (
              <div className="text-right">
                <p className="text-lg font-bold text-foreground">
                  ${storage.basePrice.toFixed(2)}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {storage.pricingModel === 'per-cubic-foot' ? 'base price' : 
                   storage.pricingModel === 'daily' ? 'per day' :
                   storage.pricingModel === 'hourly' ? 'per hour' :
                   storage.pricingModel === 'monthly-flat' ? 'per month' : 'per day'}
                </p>
              </div>
            )}
          </div>
          
          {storage.description && (
            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
              {storage.description}
            </p>
          )}
          
          <div className="flex flex-wrap items-center gap-2">
            {storage.climateControl && (
              <Badge variant="outline" className={cn("text-xs gap-1", colors.border, colors.text)}>
                <Snowflake className="w-3 h-3" />
                Climate Controlled
              </Badge>
            )}
            
            {storage.totalVolume && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Box className="w-3 h-3" />
                {storage.totalVolume} ft³
              </Badge>
            )}
            
            {storage.dimensionsLength && storage.dimensionsWidth && storage.dimensionsHeight && (
              <Badge variant="secondary" className="text-xs">
                {storage.dimensionsLength}" × {storage.dimensionsWidth}" × {storage.dimensionsHeight}"
              </Badge>
            )}
            
            {storage.pricingModel === 'per_cubic_foot' && storage.pricePerCubicFoot && (
              <Badge variant="outline" className="text-xs gap-1 border-info/30 text-info">
                <DollarSign className="w-3 h-3" />
                +${storage.pricePerCubicFoot.toFixed(2)}/ft³
              </Badge>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// KITCHEN DETAILS SECTION - Enterprise-grade Notion-inspired design
// ═══════════════════════════════════════════════════════════════════════════════
function KitchenDetailsSection({ kitchen }: { kitchen: PublicKitchen }) {
  const [activeTab, setActiveTab] = useState("overview");
  
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

  return (
    <motion.div
      key={kitchen.id}
      initial="hidden"
      animate="visible"
      exit={{ opacity: 0, y: -20 }}
      variants={fadeInUp}
      className="space-y-6"
    >
      {/* Hero Image Carousel */}
      <div className="relative rounded-2xl overflow-hidden shadow-xl">
        <ImageCarousel images={allImages} kitchenName={kitchen.name} />
        
        {/* Floating kitchen name badge */}
        <div className="absolute bottom-4 left-4 right-4">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white/95 backdrop-blur-md rounded-xl p-4 shadow-lg border border-white/20"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-foreground">{kitchen.name}</h2>
                {kitchen.description && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{kitchen.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {includedCount > 0 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="success" className="gap-1">
                          <Sparkles className="w-3 h-3" />
                          {includedCount} Included
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>Equipment included with booking</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {storageCount > 0 && (
                  <Badge variant="info" className="gap-1">
                    <Package className="w-3 h-3" />
                    {storageCount} Storage
                  </Badge>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Content Tabs - Notion-style */}
      <Card className="border-0 shadow-lg rounded-2xl overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="border-b border-border/50 bg-muted/30 px-6 pt-4">
            <TabsList className="bg-transparent h-auto p-0 gap-1">
              <TabsTrigger 
                value="overview" 
                className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-t-lg rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-2.5 text-sm font-medium"
              >
                <Info className="w-4 h-4 mr-2" />
                Overview
              </TabsTrigger>
              {hasEquipment && (
                <TabsTrigger 
                  value="equipment" 
                  className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-t-lg rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary px-4 py-2.5 text-sm font-medium"
                >
                  <Wrench className="w-4 h-4 mr-2" />
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
                  <Package className="w-4 h-4 mr-2" />
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
              {/* Overview Tab */}
              <TabsContent value="overview" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
                <motion.div
                  key="overview"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  {/* Description */}
                  {kitchen.description && (
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        About This Kitchen
                      </h3>
                      <p className="text-muted-foreground leading-relaxed">
                        {kitchen.description}
                      </p>
                    </div>
                  )}
                  
                  {/* Availability */}
                  {kitchen.availability && kitchen.availability.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        Weekly Availability
                      </h3>
                      <AvailabilityDisplay availability={kitchen.availability} />
                    </div>
                  )}
                  
                  {/* Amenities */}
                  {kitchen.amenities && Array.isArray(kitchen.amenities) && kitchen.amenities.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <Star className="w-4 h-4 text-muted-foreground" />
                        Kitchen Amenities
                      </h3>
                      <motion.div 
                        variants={containerVariants}
                        initial="hidden"
                        animate="visible"
                        className="flex flex-wrap gap-2"
                      >
                        {kitchen.amenities.map((amenity, index) => (
                          <motion.span
                            key={index}
                            variants={itemVariants}
                            className="inline-flex items-center px-3 py-1.5 rounded-full text-sm bg-muted/50 text-foreground border border-border/50 hover:border-primary/30 hover:bg-primary/5 transition-colors"
                          >
                            <Check className="w-3.5 h-3.5 text-emerald-500 mr-1.5 flex-shrink-0" />
                            {amenity}
                          </motion.span>
                        ))}
                      </motion.div>
                    </div>
                  )}
                  
                  {/* Quick Stats */}
                  {(hasEquipment || hasStorage) && (
                    <div className="pt-4 border-t border-border/50">
                      <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-muted-foreground" />
                        Quick Overview
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {includedCount > 0 && (
                          <motion.div
                            whileHover={{ scale: 1.02 }}
                            className="p-4 rounded-xl bg-gradient-to-br from-emerald-50 to-white border border-emerald-200/50 cursor-pointer"
                            onClick={() => setActiveTab('equipment')}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                                <Sparkles className="w-4 h-4 text-emerald-600" />
                              </div>
                            </div>
                            <p className="text-2xl font-bold text-foreground">{includedCount}</p>
                            <p className="text-xs text-muted-foreground">Included Equipment</p>
                          </motion.div>
                        )}
                        {rentalCount > 0 && (
                          <motion.div
                            whileHover={{ scale: 1.02 }}
                            className="p-4 rounded-xl bg-gradient-to-br from-slate-50 to-white border border-slate-200/50 cursor-pointer"
                            onClick={() => setActiveTab('equipment')}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                                <Wrench className="w-4 h-4 text-slate-600" />
                              </div>
                            </div>
                            <p className="text-2xl font-bold text-foreground">{rentalCount}</p>
                            <p className="text-xs text-muted-foreground">Rental Equipment</p>
                          </motion.div>
                        )}
                        {storageCount > 0 && (
                          <motion.div
                            whileHover={{ scale: 1.02 }}
                            className="p-4 rounded-xl bg-gradient-to-br from-violet-50 to-white border border-violet-200/50 cursor-pointer"
                            onClick={() => setActiveTab('storage')}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                                <Package className="w-4 h-4 text-violet-600" />
                              </div>
                            </div>
                            <p className="text-2xl font-bold text-foreground">{storageCount}</p>
                            <p className="text-xs text-muted-foreground">Storage Options</p>
                          </motion.div>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              </TabsContent>
              
              {/* Equipment Tab */}
              {hasEquipment && (
                <TabsContent value="equipment" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
                  <motion.div
                    key="equipment"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    {/* Included Equipment */}
                    {kitchen.equipment?.included && kitchen.equipment.included.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                            <Sparkles className="w-4 h-4 text-emerald-600" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-foreground">Included with Booking</h3>
                            <p className="text-xs text-muted-foreground">No additional cost</p>
                          </div>
                          <Badge variant="success" className="ml-auto">
                            {kitchen.equipment.included.length} items
                          </Badge>
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
                    
                    {/* Rental Equipment */}
                    {kitchen.equipment?.rental && kitchen.equipment.rental.length > 0 && (
                      <div>
                        {includedCount > 0 && <Separator className="my-6" />}
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                            <DollarSign className="w-4 h-4 text-slate-600" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-foreground">Available for Rent</h3>
                            <p className="text-xs text-muted-foreground">Additional rental fees apply</p>
                          </div>
                          <Badge variant="outline" className="ml-auto text-muted-foreground">
                            {kitchen.equipment.rental.length} items
                          </Badge>
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
                  </motion.div>
                </TabsContent>
              )}
              
              {/* Storage Tab */}
              {hasStorage && (
                <TabsContent value="storage" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
                  <motion.div
                    key="storage"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                        <Package className="w-4 h-4 text-violet-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">Storage Solutions</h3>
                        <p className="text-xs text-muted-foreground">Secure storage for your ingredients and supplies</p>
                      </div>
                    </div>
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
                  </motion.div>
                </TabsContent>
              )}
            </AnimatePresence>
          </CardContent>
        </Tabs>
      </Card>
    </motion.div>
  );
}

export default function KitchenPreviewPage() {
  const [locationPath, navigate] = useLocation();
  const { user, loading: authLoading } = useFirebaseAuth();
  const isAuthenticated = !!user;

  const locationIdMatch = locationPath.match(/\/kitchen-preview\/(\d+)/);
  const locationId = locationIdMatch ? parseInt(locationIdMatch[1]) : null;

  const [selectedKitchen, setSelectedKitchen] = useState<PublicKitchen | null>(null);
  const [kitchenEquipment, setKitchenEquipment] = useState<{ included: EquipmentListing[]; rental: EquipmentListing[] } | null>(null);
  const [kitchenStorage, setKitchenStorage] = useState<StorageListing[] | null>(null);
  const [, setIsLoadingAddons] = useState(false);
  const [activeView, setActiveView] = useState("discover-kitchens");

  // Check if chef has an approved application for this location
  // Only check if user is authenticated
  const {
    application,
    hasApplication,
    canBook,
    isLoading: applicationLoading
  } = useChefKitchenApplicationForLocation(isAuthenticated ? locationId : null);

  // Debug logging
  useEffect(() => {
    if (isAuthenticated && locationId) {
      console.log('[KitchenPreviewPage] Application status:', {
        hasApplication,
        canBook,
        applicationStatus: application?.status,
        isLoading: applicationLoading,
        locationId
      });
    }
  }, [isAuthenticated, locationId, hasApplication, canBook, application?.status, applicationLoading]);

  const { data: locationData, isLoading, error } = useQuery<PublicLocation & { kitchens: PublicKitchen[] }>({
    queryKey: [`/api/public/locations/${locationId}/details`],
    queryFn: async () => {
      const response = await fetch(`/api/public/locations/${locationId}/details`);
      if (!response.ok) throw new Error("Location not found");
      return response.json();
    },
    enabled: !!locationId,
  });

  useEffect(() => {
    if (locationData?.kitchens?.length && !selectedKitchen) {
      setSelectedKitchen(locationData.kitchens[0]);
    }
  }, [locationData?.kitchens, selectedKitchen]);

  // Fetch equipment and storage when kitchen is selected
  useEffect(() => {
    const fetchKitchenAddons = async () => {
      if (!selectedKitchen) {
        setKitchenEquipment(null);
        setKitchenStorage(null);
        return;
      }

      setIsLoadingAddons(true);
      try {
        // Helper to get auth headers if authenticated
        const getAuthHeaders = async (): Promise<Record<string, string>> => {
          if (!isAuthenticated) return {};
          try {
            const { auth } = await import("@/lib/firebase");
            const currentUser = auth.currentUser;
            if (currentUser) {
              const token = await currentUser.getIdToken();
              return { Authorization: `Bearer ${token}` };
            }
          } catch (error) {
            console.error("Error getting Firebase token:", error);
          }
          return {};
        };

        const headers = await getAuthHeaders();

        // Fetch equipment listings
        try {
          const equipmentResponse = await fetch(`/api/chef/kitchens/${selectedKitchen.id}/equipment-listings`, {
            credentials: "include",
            headers,
          });
          if (equipmentResponse.ok) {
            const equipmentData = await equipmentResponse.json();
            setKitchenEquipment({
              included: (equipmentData.included || []).map((e: EquipmentListing & { sessionRate?: number }) => ({
                id: e.id,
                category: e.category,
                equipmentType: e.equipmentType,
                brand: e.brand,
                model: e.model,
                availabilityType: e.availabilityType,
                sessionRate: e.sessionRate ? e.sessionRate / 100 : undefined, // Convert cents to dollars
                currency: e.currency || "CAD",
              })),
              rental: (equipmentData.rental || []).map((e: EquipmentListing & { sessionRate?: number }) => ({
                id: e.id,
                category: e.category,
                equipmentType: e.equipmentType,
                brand: e.brand,
                model: e.model,
                availabilityType: e.availabilityType,
                sessionRate: e.sessionRate ? e.sessionRate / 100 : undefined, // Convert cents to dollars
                currency: e.currency || "CAD",
              })),
            });
          } else {
            setKitchenEquipment({ included: [], rental: [] });
          }
        } catch (error) {
          console.error(`Failed to fetch equipment for kitchen ${selectedKitchen.id}:`, error);
          setKitchenEquipment({ included: [], rental: [] });
        }

        // Fetch storage listings
        try {
          const storageResponse = await fetch(`/api/chef/kitchens/${selectedKitchen.id}/storage-listings`, {
            credentials: "include",
            headers,
          });
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
          console.error(`Failed to fetch storage for kitchen ${selectedKitchen.id}:`, error);
          setKitchenStorage([]);
        }
      } catch (error) {
        console.error('Error fetching kitchen addons:', error);
        setKitchenEquipment({ included: [], rental: [] });
        setKitchenStorage([]);
      } finally {
        setIsLoadingAddons(false);
      }
    };

    fetchKitchenAddons();
  }, [selectedKitchen, isAuthenticated]);

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
      navigate(`/auth?redirect=/kitchen-preview/${locationId}`);
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

  // Main kitchen preview content
  const mainContent = (locationData: PublicLocation & { kitchens: PublicKitchen[] }) => {
    const { kitchens, ...location } = locationData;
    
    // Calculate totals for display
    const totalEquipment = kitchens.reduce((acc, k) => 
      acc + (k.equipment?.included?.length || 0) + (k.equipment?.rental?.length || 0), 0
    );
    const totalStorage = kitchens.reduce((acc, k) => 
      acc + (k.storage?.length || 0), 0
    );

    return (
      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="space-y-6"
      >
        {/* ═══════════════════════════════════════════════════════════════════════════════
            PREMIUM LOCATION HEADER - Notion-inspired hero section
            ═══════════════════════════════════════════════════════════════════════════════ */}
        <motion.div variants={itemVariants}>
          <Card className="border-0 shadow-xl rounded-2xl overflow-hidden bg-gradient-to-br from-background via-background to-muted/20">
            <CardContent className="p-6">
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                {/* Location info */}
                <div className="flex items-start gap-4 flex-1">
                  {/* Logo with elegant shadow */}
                  <motion.div 
                    whileHover={{ scale: 1.05 }}
                    className="relative"
                  >
                    {location.logoUrl ? (
                      <img
                        src={location.logoUrl}
                        alt={location.name}
                        className="h-16 w-16 rounded-2xl object-cover shadow-lg ring-2 ring-white"
                      />
                    ) : (
                      <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary via-primary to-primary/80 flex items-center justify-center shadow-lg ring-2 ring-white">
                        <Building2 className="h-8 w-8 text-white" />
                      </div>
                    )}
                    {/* Status indicator dot */}
                    {location.kitchenLicenseStatus === 'approved' && (
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full border-2 border-white flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </motion.div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap mb-2">
                      <h1 className="text-2xl font-bold text-foreground tracking-tight">
                        {location.name}
                      </h1>
                      {location.kitchenLicenseStatus === 'approved' ? (
                        <Badge variant="success" className="gap-1">
                          <Shield className="h-3 w-3" />
                          Verified Kitchen
                        </Badge>
                      ) : location.kitchenLicenseStatus === 'pending' ? (
                        <Badge variant="warning" className="gap-1">
                          <Clock className="h-3 w-3" />
                          Pending Verification
                        </Badge>
                      ) : null}
                    </div>
                    
                    <div className="flex items-center gap-4 text-muted-foreground text-sm mb-3">
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 text-primary/60" />
                        {location.address}
                      </span>
                    </div>
                    
                    {location.description && (
                      <p className="text-muted-foreground text-sm leading-relaxed max-w-2xl">
                        {location.description}
                      </p>
                    )}
                    
                    {/* Quick stats row */}
                    <div className="flex items-center gap-4 mt-4">
                      <div className="flex items-center gap-1.5 text-sm">
                        <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
                          <ChefHat className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <span className="font-medium text-foreground">{kitchens.length}</span>
                        <span className="text-muted-foreground">Kitchen{kitchens.length !== 1 ? 's' : ''}</span>
                      </div>
                      {totalEquipment > 0 && (
                        <div className="flex items-center gap-1.5 text-sm">
                          <div className="w-6 h-6 rounded-md bg-emerald-100 flex items-center justify-center">
                            <Wrench className="w-3.5 h-3.5 text-emerald-600" />
                          </div>
                          <span className="font-medium text-foreground">{totalEquipment}</span>
                          <span className="text-muted-foreground">Equipment</span>
                        </div>
                      )}
                      {totalStorage > 0 && (
                        <div className="flex items-center gap-1.5 text-sm">
                          <div className="w-6 h-6 rounded-md bg-violet-100 flex items-center justify-center">
                            <Package className="w-3.5 h-3.5 text-violet-600" />
                          </div>
                          <span className="font-medium text-foreground">{totalStorage}</span>
                          <span className="text-muted-foreground">Storage</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Main CTA Button - respects license approval status */}
                <div className="w-full lg:w-auto">
                  {isAuthenticated && !location.canAcceptApplications && !canBook ? (
                    <Button
                      variant="secondary"
                      disabled
                      className="w-full lg:w-auto cursor-not-allowed h-12 px-6"
                    >
                      <Clock className="mr-2 h-4 w-4" />
                      Not Accepting Applications
                    </Button>
                  ) : (
                    <Button
                      onClick={handleGetStarted}
                      className="w-full lg:w-auto shadow-lg shadow-primary/25 h-12 px-6 text-base font-semibold"
                      disabled={isAuthenticated && applicationLoading}
                    >
                      {applicationLoading ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Checking...
                        </>
                      ) : isAuthenticated && canBook ? (
                        <>
                          <Calendar className="mr-2 h-5 w-5" />
                          Book Now
                        </>
                      ) : isAuthenticated && application?.status === 'approved' && ((application as unknown as { current_tier?: number })?.current_tier ?? 1) < 3 ? (
                        <>
                          <ArrowRight className="mr-2 h-5 w-5" />
                          Continue Application
                        </>
                      ) : isAuthenticated ? (
                        <>
                          <Sparkles className="mr-2 h-5 w-5" />
                          Apply to Kitchen
                        </>
                      ) : (
                        <>
                          <ArrowRight className="mr-2 h-5 w-5" />
                          Sign In to Book
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ═══════════════════════════════════════════════════════════════════════════════
            MAIN CONTENT GRID - Notion-style layout
            ═══════════════════════════════════════════════════════════════════════════════ */}
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6">
          {/* Left Sidebar - Kitchen Selection */}
          <motion.div 
            variants={itemVariants}
            className="lg:col-span-3 space-y-4 order-2 lg:order-1"
          >
            {/* Kitchen Selection Card */}
            <Card className="border-0 shadow-lg rounded-2xl overflow-hidden">
              <div className="bg-muted/30 border-b border-border/50 px-5 py-4">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <ChefHat className="w-4 h-4 text-primary" />
                  </div>
                  <h2 className="font-semibold text-foreground text-sm">
                    Select Kitchen
                  </h2>
                  <Badge variant="count" className="ml-auto">
                    {kitchens.length}
                  </Badge>
                </div>
              </div>
              <CardContent className="p-4">
                <div className="space-y-2.5">
                  {kitchens.map((kitchen, index) => (
                    <motion.div
                      key={kitchen.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <KitchenSelectionCard
                        kitchen={kitchen}
                        isSelected={selectedKitchen?.id === kitchen.id}
                        onSelect={() => setSelectedKitchen(kitchen)}
                      />
                    </motion.div>
                  ))}
                </div>

                {kitchens.length === 0 && (
                  <div className="text-center py-10 text-muted-foreground">
                    <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                      <Utensils className="h-6 w-6 text-muted-foreground/50" />
                    </div>
                    <p className="text-sm font-medium">No kitchens available</p>
                    <p className="text-xs mt-1">Check back later</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pending Approval Notice */}
            {location.kitchenLicenseStatus === 'pending' && (
              <motion.div variants={itemVariants}>
                <Card className="border-amber-200/50 bg-gradient-to-br from-amber-50 to-white rounded-2xl overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                        <Clock className="h-5 w-5 text-amber-600" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-sm font-semibold text-amber-900 mb-1">
                          Verification in Progress
                        </h3>
                        <p className="text-xs text-amber-700 leading-relaxed">
                          This kitchen&apos;s license is being verified. Bookings will be available once approved.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {/* Mini Calendar */}
            <motion.div variants={itemVariants}>
              <Card className="border-0 shadow-lg rounded-2xl overflow-hidden">
                <div className="bg-gradient-to-r from-primary to-primary/90 p-4 text-white">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    <span className="font-semibold">Availability</span>
                  </div>
                  <p className="text-xs text-white/70 mt-1">View open slots</p>
                </div>
                <CardContent className="p-0">
                  <MiniCalendarPreview
                    isAuthenticated={isAuthenticated}
                    canBook={canBook}
                    canAcceptApplications={location.canAcceptApplications !== false}
                    onBookClick={handleBookClick}
                    onApplyClick={handleApplyClick}
                  />
                </CardContent>
              </Card>
            </motion.div>

            {/* CTA Card */}
            <motion.div variants={itemVariants}>
              <Card className="border-0 shadow-lg rounded-2xl overflow-hidden bg-gradient-to-br from-background to-muted/20">
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <img
                      src={kitchenTableIcon}
                      alt="Kitchen"
                      className="h-8 w-auto flex-shrink-0"
                    />
                    <div>
                      <span className="font-semibold text-foreground text-sm block">Ready to Cook?</span>
                      <span className="text-xs text-muted-foreground">Start at {location.name}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                    Get instant access to professional kitchen spaces and bring your culinary vision to life.
                  </p>
                  {isAuthenticated && canBook ? (
                    <Button
                      onClick={handleBookClick}
                      className="w-full shadow-lg shadow-primary/20"
                      size="sm"
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      Book This Kitchen
                    </Button>
                  ) : isAuthenticated && application?.status === 'approved' && ((application as unknown as { current_tier?: number })?.current_tier ?? 1) < 3 ? (
                    <Button
                      onClick={handleApplyClick}
                      className="w-full shadow-lg shadow-primary/20"
                      size="sm"
                    >
                      <ArrowRight className="mr-2 h-4 w-4" />
                      Continue Application
                    </Button>
                  ) : isAuthenticated && !location.canAcceptApplications ? (
                    <Button
                      variant="secondary"
                      disabled
                      className="w-full cursor-not-allowed"
                      size="sm"
                    >
                      <Clock className="mr-2 h-4 w-4" />
                      Not Accepting Applications
                    </Button>
                  ) : isAuthenticated ? (
                    <Button
                      onClick={handleApplyClick}
                      className="w-full shadow-lg shadow-primary/20"
                      size="sm"
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      Apply to Kitchen
                    </Button>
                  ) : (
                    <>
                    <Button
                      onClick={handleGetStarted}
                      className="w-full shadow-lg shadow-primary/20"
                      size="sm"
                    >
                      Create Free Account
                      <ArrowRight className="ml-2 h-3.5 w-3.5" />
                    </Button>
                    <p className="text-center text-xs text-muted-foreground mt-3">
                      Already have an account?{' '}
                      <button
                        onClick={() => navigate('/auth')}
                        className="text-primary hover:underline font-medium"
                      >
                        Log in
                      </button>
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>
          </motion.div>

          {/* Main Content - Selected Kitchen Details */}
          <motion.div variants={itemVariants} className="lg:col-span-9 order-1 lg:order-2">
            <AnimatePresence mode="wait">
              {selectedKitchen ? (
                <KitchenDetailsSection
                  key={selectedKitchen.id}
                  kitchen={{
                    ...selectedKitchen,
                    equipment: kitchenEquipment || undefined,
                    storage: kitchenStorage || undefined,
                  }}
                />
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center justify-center h-64 sm:h-96 bg-card rounded-xl border shadow-lg"
                >
                  <div className="text-center px-4">
                    <Utensils className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-sm sm:text-base text-muted-foreground">Select a kitchen to view details</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </motion.div>
    );
  };

  // Determine what content to show
  const getContent = () => {
    if (isLoading || authLoading) return loadingContent;
    if (error || !locationData) return notFoundContent;
    return mainContent(locationData);
  };

  // Handle sidebar navigation
  const handleViewChange = (view: string) => {
    setActiveView(view);
    if (view === 'overview') navigate('/dashboard');
    else if (view === 'discover-kitchens') navigate('/dashboard?view=discover-kitchens');
    else if (view === 'kitchen-applications') navigate('/dashboard?view=kitchen-applications');
    else if (view === 'bookings') navigate('/dashboard?view=bookings');
    else if (view === 'applications') navigate('/dashboard?view=applications');
    else if (view === 'messages') navigate('/dashboard?view=messages');
    else if (view === 'training') navigate('/dashboard?view=training');
  };

  // If user is authenticated, wrap in ChefDashboardLayout
  if (isAuthenticated) {
    return (
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
  const { kitchens, ...location } = locationData;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />

      <main className="flex-1 pt-16 sm:pt-20 pb-8 sm:pb-12">
        {/* Location Header - Responsive */}
        <div className="bg-white border-b border-gray-200 py-4 sm:py-5">
          <div className="container mx-auto px-4 sm:px-6 max-w-7xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
              <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
                {location.logoUrl ? (
                  <img
                    src={location.logoUrl}
                    alt={location.name}
                    className="h-10 w-auto sm:h-12 rounded-lg flex-shrink-0"
                  />
                ) : (
                  <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-lg bg-gradient-to-br from-[#F51042] to-[#FF6B7A] flex items-center justify-center flex-shrink-0">
                    <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{location.name}</h1>
                    {location.description && (
                      <p className="w-full text-sm sm:text-base text-gray-600 mt-2 leading-relaxed">
                        {location.description}
                      </p>
                    )}
                    {location.kitchenLicenseStatus === 'pending' && (
                      <Badge variant="warning" className="text-xs">
                        <Clock className="h-3 w-3 mr-1" />
                        Pending Approval
                      </Badge>
                    )}
                    {location.kitchenLicenseStatus === 'approved' && (
                      <Badge variant="success" className="text-xs">
                        <Check className="h-3 w-3 mr-1" />
                        Licensed Kitchen
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-500 text-xs sm:text-sm">
                    <MapPin className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" />
                    <span className="truncate">{location.address}</span>
                  </div>
                </div>
              </div>

                <div className="flex flex-col gap-2 w-full sm:w-auto">
                  <Button
                    onClick={handleGetStarted}
                    className="bg-[#F51042] hover:bg-[#D90E3A] text-white w-full sm:w-auto text-sm sm:text-base"
                    size="sm"
                  >
                    Sign In to Book
                    <ArrowRight className="ml-2 h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </Button>
                </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="container mx-auto px-4 sm:px-6 max-w-7xl py-6 sm:py-8">
          <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 sm:gap-8">
            {/* Left Sidebar - Kitchen Selection */}
            <div className="lg:col-span-3 space-y-4 order-2 lg:order-1">
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
                <h2 className="text-xs sm:text-sm font-semibold text-gray-900 mb-3 sm:mb-4 uppercase tracking-wide">
                  Select a Kitchen
                </h2>
                <div className="space-y-2 sm:space-y-2.5">
                  {kitchens.map((kitchen) => (
                    <KitchenSelectionCard
                      key={kitchen.id}
                      kitchen={kitchen}
                      isSelected={selectedKitchen?.id === kitchen.id}
                      onSelect={() => setSelectedKitchen(kitchen)}
                    />
                  ))}
                </div>

                {kitchens.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <Utensils className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">No kitchens available</p>
                  </div>
                )}
              </div>

              {/* Mini Calendar */}
              <Card className="overflow-hidden border-gray-200">
                <div className="bg-gradient-to-r from-[#F51042] to-[#FF6B7A] p-3 text-white">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    <span className="font-semibold text-xs sm:text-sm">Availability</span>
                  </div>
                </div>
                <CardContent className="p-0">
                  <MiniCalendarPreview
                    isAuthenticated={isAuthenticated}
                    canBook={canBook}
                    canAcceptApplications={location.canAcceptApplications !== false}
                    onBookClick={handleBookClick}
                    onApplyClick={handleApplyClick}
                  />
                </CardContent>
              </Card>

              {/* CTA Card */}
              <Card className="border-gray-200 overflow-hidden">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-center gap-2 mb-2 sm:mb-3">
                    <img
                      src={kitchenTableIcon}
                      alt="Kitchen"
                      className="h-4 w-auto sm:h-5 flex-shrink-0"
                    />
                    <span className="font-semibold text-gray-900 text-xs sm:text-sm leading-tight">Start Cooking at {location.name}</span>
                  </div>
                  <p className="text-xs text-gray-600 mb-3 sm:mb-4 leading-relaxed">
                    Join LocalCooks and get instant access to professional kitchen spaces. Book your slot today and bring your culinary vision to life.
                  </p>
                  <Button
                    onClick={handleGetStarted}
                    className="w-full bg-[#F51042] hover:bg-[#D90E3A] text-white font-semibold text-xs sm:text-sm py-2.5 sm:py-2"
                    size="sm"
                  >
                    Create Free Account
                    <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Button>
                  <p className="text-center text-xs text-gray-500 mt-2 sm:mt-3">
                    Already have an account?{' '}
                    <button
                      onClick={() => navigate('/auth')}
                      className="text-[#F51042] hover:underline font-medium"
                    >
                      Log in
                    </button>
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Main Content - Selected Kitchen Details */}
            <div className="lg:col-span-9 order-1 lg:order-2">
              <AnimatePresence mode="wait">
                {selectedKitchen ? (
                  <KitchenDetailsSection
                    key={selectedKitchen.id}
                    kitchen={{
                      ...selectedKitchen,
                      equipment: kitchenEquipment || undefined,
                      storage: kitchenStorage || undefined,
                    }}
                  />
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-center h-64 sm:h-96 bg-white rounded-xl border border-gray-200"
                  >
                    <div className="text-center px-4">
                      <Utensils className="h-10 w-10 sm:h-12 sm:w-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-sm sm:text-base text-gray-500">Select a kitchen to view details</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
