import { logger } from "@/lib/logger";
import { useState, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { useKitchenBookings } from "@/hooks/use-kitchen-bookings";
import { useStoragePricing } from "@/hooks/use-storage-pricing";
import { formatCurrency, formatHourSlotRange } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { formatCancellationWindowText } from "@/lib/cancellation-policy";
import { BookingStorageSelector } from "./BookingStorageSelector";
import { BookingPriceSummary, FeesInfoPopover } from "./BookingPriceSummary";
import { useUnpaidPenaltiesCheck } from "@/hooks/use-unpaid-penalties";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar as UICalendar } from "@/components/ui/calendar";
import { SmartImage } from "@/components/ui/smart-image";
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper";
import { findPersistedBookingForKitchens, notifyBookingPrefsChanged } from "@/lib/persisted-booking-prefs";
import { resolveEquipmentIcon, resolveStorageIcon } from "@/lib/kitchen-inventory-icons";
import { chefOutlineCtaClass, chefPrimaryCtaClass } from "@/lib/chef-cta";
import { Icon } from "@iconify/react";
import { tt } from "@/i18n/common-ns";
import { bt } from "@/i18n/booking-ns";

/** Inline storage cards before "Show all" — 12 fills a 2-col grid (6 rows). */
const STORAGE_PREVIEW_COUNT = 12;

function kitchenCoverUrl(kitchen: {
  imageUrl?: string | null;
  image_url?: string | null;
  galleryImages?: string[] | null;
  gallery_images?: string[] | null;
  locationBrandImageUrl?: string | null;
  location_brand_image_url?: string | null;
} | null): string | null {
  if (!kitchen) return null;
  return (
    kitchen.imageUrl ||
    kitchen.image_url ||
    kitchen.galleryImages?.[0] ||
    kitchen.gallery_images?.[0] ||
    kitchen.locationBrandImageUrl ||
    kitchen.location_brand_image_url ||
    null
  );
}

/** Compact Airbnb-style kitchen thumb for confirm summary; ChefHat if missing/broken. */
function ConfirmKitchenThumbnail({
  src,
  alt,
}: {
  src: string | null;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-lg border border-[#F51042]/15 bg-white/80">
        <Icon icon="mdi:chef-hat" className="h-5 w-5 text-[#F51042]" aria-hidden />
        <span className="sr-only">{alt}</span>
      </div>
    );
  }
  return (
    <div className="h-14 w-14 sm:h-16 sm:w-16 shrink-0 overflow-hidden rounded-lg border border-[#F51042]/15 bg-white/80">
      <SmartImage
        src={src}
        alt={alt}
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function equipmentName(equipment: any) {
  return String(equipment.equipmentType || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function InventoryPreviewList({
  title,
  subtitle,
  items,
  rental,
}: {
  title: string;
  subtitle: string;
  items: any[];
  rental: boolean;
}) {
  return (
    <section>
      <div className="mb-1">
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <ul className="grid min-w-0 grid-cols-1 gap-x-6 sm:grid-cols-2">
        {items.map((equipment) => (
          <li key={equipment.id} className="flex min-w-0 items-center gap-2.5 border-b border-gray-100 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFF3F5] text-[#F51042]">
              <Icon
                icon={resolveEquipmentIcon(equipment.equipmentType, equipment.category)}
                width={18}
                height={18}
                aria-hidden
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-gray-900">
                {equipmentName(equipment)}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {rental ? `${formatCurrency(equipment.sessionRate || 0)} per session` : "Included"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function cancellationPolicyCopy(
  kitchen: any,
  t: (key: string, options?: Record<string, unknown>) => string,
  fallbackHours = 24
): string {
  const location = kitchen?.location;
  const hours =
    location?.cancellationPolicyHours ??
    location?.cancellation_policy_hours ??
    fallbackHours;
  const custom =
    location?.cancellationPolicyMessage ??
    location?.cancellation_policy_message;
  const windowText = formatCancellationWindowText(
    hours,
    custom,
    t("cancellationPolicyDefaultMessage", {
      hours,
      defaultValue: `Bookings cannot be cancelled within ${hours} hours of the scheduled time.`,
    })
  );
  return `${windowText} ${t("cancellationPolicyRefundRules", {
    defaultValue:
      "Cancel before the kitchen manager approves your booking for a full release (nothing is charged). After approval, refunds return your payment except Stripe’s card processing fee, which Stripe does not return. The kitchen sets the cancellation window; refund amounts follow Local Cooks platform rules.",
  })}`;
}

/** Persistent place context carried from preview through every booking step. */
function BookingPlaceContext({
  kitchen,
  locationName,
  locationAddress,
  compact = false,
  onPolicyOpen,
}: {
  kitchen: any;
  locationName: string;
  locationAddress?: string;
  compact?: boolean;
  onPolicyOpen: () => void;
}) {
  const { t } = useTranslation(["booking", "kitchen"]);
  if (!kitchen) return null;

  const imageAlt = String(t("sheetKitchenImageAlt", {
    name: kitchen.name,
    defaultValue: `${kitchen.name} kitchen`,
  }));
  if (compact) {
    return (
      <div className="space-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <ConfirmKitchenThumbnail src={kitchenCoverUrl(kitchen)} alt={imageAlt} />
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-[#F51042]">
              {t("sheetBookingAtLabel", "Booking at")}
            </p>
            <h1 className="truncate text-base font-semibold text-gray-900">{kitchen.name}</h1>
            <p className="truncate text-xs text-muted-foreground">{locationName}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onPolicyOpen}
          className="flex w-full items-center gap-2 border-t border-gray-200/80 pt-2.5 text-left text-[11px] font-medium text-gray-700 transition-colors hover:text-[#F51042]"
        >
          <Icon icon="mdi:shield-check-outline" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F51042]" aria-hidden />
          <span className="flex-1">{t("sheetCancellationPolicyTitle", "Cancellation policy")}</span>
          <Icon icon="mdi:chevron-right" className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <section
      aria-label={t("sheetSelectedKitchenSummary", "Selected kitchen summary")}
      className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="grid gap-2 p-2">
        <div className="relative h-24 w-full overflow-hidden rounded-xl bg-gray-100">
            <div className="flex h-full w-full items-center justify-center bg-[#F51042]/5">
              <Icon icon="mdi:chef-hat" className="h-8 w-8 text-[#F51042]" aria-hidden />
            </div>
            <SmartImage
              src={kitchenCoverUrl(kitchen) || ""}
              alt={imageAlt}
              className="absolute inset-0 h-full w-full object-cover"
              hideOnError
            />
        </div>
        <div className="rounded-xl bg-gray-50/80 p-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#F51042]">
              {t("sheetBookingAtLabel", "Booking at")}
            </p>
            <h2 className="mt-1 truncate text-base font-semibold leading-tight text-gray-900">
              {kitchen.name}
            </h2>
            <p className="mt-1 truncate text-xs font-medium text-gray-600">{locationName}</p>
            {locationAddress && (
              <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <Icon icon="mdi:map-marker-outline" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{locationAddress}</span>
              </p>
            )}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onPolicyOpen}
        className="flex w-full items-center gap-2.5 border-t border-gray-100 bg-gray-50/70 px-3.5 py-2.5 text-left transition-colors hover:bg-[#FFF7F8]"
      >
          <Icon icon="mdi:shield-check-outline" className="mt-0.5 h-4 w-4 shrink-0 text-[#F51042]" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-900">
              {t("sheetCancellationPolicyTitle", "Cancellation policy")}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {t("sheetViewCancellationPolicy", "View cancellation and refund terms")}
            </p>
          </div>
          <Icon icon="mdi:chevron-right" className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      </button>
    </section>
  );
}

export interface KitchenBookingFlowProps {
  locationId: number;
  locationName: string;
  locationAddress?: string;
  /** Prefer this kitchen (e.g. from kitchen preview). Skips kitchen picking. */
  kitchenId?: number | string;
  onCancel: () => void;
  onComplete?: (bookingId?: number) => void;
}

type BookingStep = "calendar" | "slots" | "equipment" | "storage" | "confirm";

type StepMeta = { key: BookingStep; label: string; subtext: string };

/** Matches kitchen preview / prefs panel — fixed 32px cells → true circular selection. */
const BOOKING_CALENDAR_CLASS_NAMES = {
  months: "flex w-full flex-col space-y-0",
  month: "w-full space-y-2",
  caption: "relative flex w-full items-center justify-center pt-0.5",
  caption_label: "text-xs font-medium",
  nav_button:
    "inline-flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent p-0 opacity-50 shadow-none hover:opacity-100",
  nav_button_previous: "absolute left-0",
  nav_button_next: "absolute right-0",
  table: "w-full table-fixed border-collapse",
  head_cell:
    "w-[14.28%] pb-0.5 text-center text-[0.65rem] font-normal text-muted-foreground",
  row: "mt-0.5",
  cell: cn(
    "relative z-0 h-8 p-0 text-center text-xs",
    "[&:has([aria-selected])]:before:absolute [&:has([aria-selected])]:before:left-1/2 [&:has([aria-selected])]:before:top-1/2 [&:has([aria-selected])]:before:h-8 [&:has([aria-selected])]:before:w-8 [&:has([aria-selected])]:before:-translate-x-1/2 [&:has([aria-selected])]:before:-translate-y-1/2 [&:has([aria-selected])]:before:-z-10 [&:has([aria-selected])]:before:rounded-full [&:has([aria-selected])]:before:border-2 [&:has([aria-selected])]:before:border-[#F51042]"
  ),
  day: "mx-auto flex h-8 w-8 max-w-[32px] items-center justify-center rounded-full bg-transparent p-0 text-xs font-normal text-gray-900 transition-colors hover:bg-gray-100 aria-selected:opacity-100",
  day_selected:
    "bg-transparent text-gray-900 hover:bg-transparent focus:bg-transparent",
  day_disabled:
    "pointer-events-none text-gray-300 opacity-40 line-through decoration-gray-300/80",
};

/** Two-month booking picker — side-by-side from sm up. */
const BOOKING_CALENDAR_TWO_MONTH_CLASS_NAMES = {
  ...BOOKING_CALENDAR_CLASS_NAMES,
  months: "flex w-full flex-col gap-4 sm:flex-row sm:gap-6 sm:space-y-0",
  month: "w-full min-w-0 flex-1 space-y-2",
};

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

export default function KitchenBookingFlow({
  locationId,
  locationName,
  locationAddress,
  kitchenId: preferredKitchenId,
  onCancel,
  onComplete,
}: KitchenBookingFlowProps) {
  const { t, i18n } = useTranslation(["booking", "kitchen"]);
  const { kitchens, createBooking, isLoadingKitchens } = useKitchenBookings();
  const { toast } = useToast();

  // Filter kitchens to only those in this location
  const locationKitchens = useMemo(() => {
    return kitchens.filter((kitchen: any) => {
      const kitchenLocationId = kitchen.location?.id || kitchen.locationId || kitchen.location_id;
      return kitchenLocationId === locationId;
    });
  }, [kitchens, locationId]);

  // State
  const [selectedKitchen, setSelectedKitchen] = useState<any | null>(null);
  const [currentStep, setCurrentStep] = useState<BookingStep>("calendar");
  /** When true, date was prefilled — hide Date from the step rail and start after it. */
  const [hideDateStep, setHideDateStep] = useState(false);
  /** False until kitchen + any restored prefs settle — avoids date-step flash. */
  const [isFlowReady, setIsFlowReady] = useState(false);
  const initRef = useRef(false);

  // Payment state
  const [isRedirectingToCheckout, setIsRedirectingToCheckout] = useState(false);
  const [isProcessingBooking, setIsProcessingBooking] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  
  // Penalty check
  const { data: penaltyData } = useUnpaidPenaltiesCheck(true);

  // Calendar state
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [dateAvailability, setDateAvailability] = useState<Record<string, boolean>>({});
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);

  // Slots state
  const [allSlots, setAllSlots] = useState<Array<{
    time: string;
    available: number;
    capacity: number;
    isFullyBooked: boolean;
  }>>([]);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [pendingTimeSlots, setPendingTimeSlots] = useState<string[]>([]);
  const [timeModalOpen, setTimeModalOpen] = useState(false);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [maxSlotsPerChef, setMaxSlotsPerChef] = useState<number>(2);

  // Pricing state
  const [kitchenPricing, setKitchenPricing] = useState<{
    hourlyRate: number | null;
    currency: string;
    minimumBookingHours: number;
    platformCommissionRate: number;
  } | null>(null);
  const [estimatedPrice, setEstimatedPrice] = useState<{
    basePrice: number;
    tax: number;
    totalPrice: number;
    durationHours: number;
  } | null>(null);

  // Add-ons state
  const [storageListings, setStorageListings] = useState<any[]>([]);
  const [equipmentListings, setEquipmentListings] = useState<{
    all: any[];
    included: any[];
    rental: any[];
  }>({ all: [], included: [], rental: [] });
  const [isLoadingAddons, setIsLoadingAddons] = useState(false);
  const [selectedStorage, setSelectedStorage] = useState<Array<{
    storageListingId: number;
    startDate: Date;
    endDate: Date;
  }>>([]);
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<number[]>([]);
  const [notes, setNotes] = useState<string>("");
  const [equipmentModalOpen, setEquipmentModalOpen] = useState(false);
  const [equipmentInventoryModal, setEquipmentInventoryModal] = useState<"included" | "rental" | null>(null);
  const [storageModalOpen, setStorageModalOpen] = useState(false);
  const [cancellationPolicyOpen, setCancellationPolicyOpen] = useState(false);
  const [pendingEquipmentIds, setPendingEquipmentIds] = useState<number[]>([]);
  const [discardModal, setDiscardModal] = useState<"equipment" | "storage" | "time" | null>(null);
  const [confirmDatePopoverOpen, setConfirmDatePopoverOpen] = useState(false);
  const storageStepRef = useRef<HTMLDivElement>(null);

  // Storage pricing
  const storagePricing = useStoragePricing(selectedStorage, storageListings);

  // Equipment pricing
  const equipmentPricing = useMemo(() => {
    if (!selectedEquipmentIds.length || !equipmentListings.rental.length) {
      return { items: [], subtotal: 0 };
    }

    const items = selectedEquipmentIds
      .map((eqId) => {
        const eq = equipmentListings.rental.find((e: any) => e.id === eqId);
        if (!eq) return null;
        const rate = eq.sessionRate || 0;
        return { id: eq.id, name: `${eq.equipmentType}${eq.brand ? ` (${eq.brand})` : ''}`, rate };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return { items, subtotal: items.reduce((sum, item) => sum + item.rate, 0) };
  }, [selectedEquipmentIds, equipmentListings.rental]);

  const pendingEquipmentSubtotal = useMemo(
    () => pendingEquipmentIds.reduce((sum, id) => {
      const equipment = equipmentListings.rental.find((item: any) => item.id === id);
      return sum + (equipment?.sessionRate || 0);
    }, 0),
    [pendingEquipmentIds, equipmentListings.rental]
  );

  // Combined pricing
  const combinedSubtotal = useMemo(() => {
    const kitchenBase = estimatedPrice?.basePrice || 0;
    const storageBaseCents = storagePricing.subtotal || 0;
    const equipmentBaseCents = equipmentPricing.subtotal || 0;
    return kitchenBase + storageBaseCents + equipmentBaseCents;
  }, [estimatedPrice?.basePrice, storagePricing.subtotal, equipmentPricing.subtotal]);

  const tax = useMemo(() => {
    if (combinedSubtotal <= 0) return 0;
    const taxRatePercent = selectedKitchen?.taxRatePercent || 0;
    return Math.round((combinedSubtotal * taxRatePercent) / 100);
  }, [combinedSubtotal, selectedKitchen?.taxRatePercent]);

  const serviceFee = useMemo(() => {
    if (combinedSubtotal <= 0) return 0;
    return Math.round(combinedSubtotal * (kitchenPricing?.platformCommissionRate ?? 0));
  }, [combinedSubtotal, kitchenPricing?.platformCommissionRate]);

  const grandTotal = useMemo(() => combinedSubtotal + tax + serviceFee, [combinedSubtotal, tax, serviceFee]);

  const currentYear = calendarMonth.getFullYear();
  const currentMonth = calendarMonth.getMonth();

  const toLocalDateString = (d: Date) => {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Initialize kitchen selection once kitchens are available
  useEffect(() => {
    if (initRef.current) return;
    if (locationKitchens.length === 0) return;

    const preferred =
      preferredKitchenId != null
        ? locationKitchens.find((k: any) => String(k.id) === String(preferredKitchenId))
        : null;
    const persisted = findPersistedBookingForKitchens(
      (preferred ? [preferred.id] : locationKitchens.map((k: any) => k.id)) as Array<string | number>
    );
    const kitchen =
      preferred ||
      (persisted
        ? locationKitchens.find((k: any) => String(k.id) === persisted.kitchenId)
        : null) ||
      locationKitchens[0];

    if (!kitchen) return;

    initRef.current = true;
    const restoreForKitchen = findPersistedBookingForKitchens([kitchen.id]);
    // Hide Date in the rail immediately when prefs exist so the stepper doesn't flash it.
    if (restoreForKitchen?.dateIso) {
      setHideDateStep(true);
    }
    void handleKitchenSelect(
      kitchen,
      restoreForKitchen
        ? { dateIso: restoreForKitchen.dateIso, slots: restoreForKitchen.slots }
        : undefined
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / kitchens / preferredKitchenId gate only
  }, [locationKitchens, preferredKitchenId]);

  // Load slots when date changes
  useEffect(() => {
    if (selectedKitchen && selectedDate) {
      loadAvailableSlots(selectedKitchen.id, toLocalDateString(selectedDate));
    }
  }, [selectedKitchen, selectedDate]);

  // Load month availability for the date step (two months) and confirm popover (one month)
  useEffect(() => {
    if (!selectedKitchen) return;
    if (currentStep === "calendar") {
      const next = new Date(currentYear, currentMonth + 1, 1);
      void loadMonthsAvailability(selectedKitchen.id, [
        { year: currentYear, month: currentMonth },
        { year: next.getFullYear(), month: next.getMonth() },
      ]);
      return;
    }
    if (confirmDatePopoverOpen) {
      void loadMonthsAvailability(selectedKitchen.id, [
        { year: currentYear, month: currentMonth },
      ]);
    }
  }, [selectedKitchen, currentYear, currentMonth, currentStep, confirmDatePopoverOpen]);

  const loadMonthsAvailability = async (
    kitchenId: number,
    months: Array<{ year: number; month: number }>
  ) => {
    setIsLoadingAvailability(true);
    // Clear so the loader shows and we never mix stale months into the new window
    setDateAvailability({});

    try {
      let authHeader: string | undefined;
      try {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth?.currentUser;
        if (currentUser) {
          const token = await currentUser.getIdToken();
          authHeader = `Bearer ${token}`;
        }
      } catch (e) {
        const token = localStorage.getItem('firebaseToken');
        if (token) authHeader = `Bearer ${token}`;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);

      const chunks = await Promise.all(
        months.map(async ({ year, month }) => {
          const response = await fetch(
            `/api/chef/kitchens/${kitchenId}/month-availability?year=${year}&month=${month}`,
            {
              credentials: "include",
              headers,
              cache: "no-store",
            }
          );
          if (!response.ok) {
            throw new Error(`Failed to load month availability (status ${response.status})`);
          }
          const serverAvailability: Record<string, boolean> = await response.json();
          const availability: Record<string, boolean> = {};
          const daysInMonth = getDaysInMonth(year, month);
          for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateStr = toLocalDateString(date);
            availability[dateStr] =
              date >= todayDate && serverAvailability[dateStr] === true;
          }
          return availability;
        })
      );

      setDateAvailability(Object.assign({}, ...chunks));
    } catch (error) {
      logger.error('Error loading month availability:', error);
      setDateAvailability({});
    } finally {
      setIsLoadingAvailability(false);
    }
  };

  // Calculate price when slots change
  useEffect(() => {
    if (!selectedSlots.length || !selectedKitchen || !kitchenPricing) {
      setEstimatedPrice(null);
      return;
    }

    const durationHours = Math.max(selectedSlots.length, kitchenPricing.minimumBookingHours ?? 0);

    if (kitchenPricing.hourlyRate && kitchenPricing.hourlyRate > 0) {
      const basePrice = kitchenPricing.hourlyRate * durationHours;
      const taxRatePercent = selectedKitchen?.taxRatePercent || 0;
      const taxAmount = Math.round((basePrice * taxRatePercent) / 100);
      const totalPrice = basePrice + taxAmount;

      setEstimatedPrice({ basePrice, tax: taxAmount, totalPrice, durationHours });
    } else {
      setEstimatedPrice({ basePrice: 0, tax: 0, totalPrice: 0, durationHours: 0 });
    }
  }, [selectedSlots, selectedKitchen, kitchenPricing]);

  const loadAvailableSlots = async (kitchenId: number, date: string) => {
    setIsLoadingSlots(true);
    try {
      let authHeader: string | undefined;
      try {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth?.currentUser;
        if (currentUser) {
          const token = await currentUser.getIdToken();
          authHeader = `Bearer ${token}`;
        }
      } catch (e) {
        const token = localStorage.getItem('firebaseToken');
        if (token) authHeader = `Bearer ${token}`;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      // Fetch policy
      try {
        const policyRes = await fetch(`/api/chef/kitchens/${kitchenId}/policy?date=${date}`, {
          credentials: "include",
          headers,
          cache: 'no-store',
        });
        if (policyRes.ok) {
          const policy = await policyRes.json();
          if (policy && typeof policy.maxSlotsPerChef === 'number' && policy.maxSlotsPerChef > 0) {
            setMaxSlotsPerChef(policy.maxSlotsPerChef);
          } else {
            setMaxSlotsPerChef(2);
          }
        } else {
          setMaxSlotsPerChef(2);
        }
      } catch {
        setMaxSlotsPerChef(2);
      }

      // Fetch slots
      const response = await fetch(`/api/chef/kitchens/${kitchenId}/slots?date=${date}`, {
        credentials: "include",
        headers,
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(bt("failedToFetchSlots"));
      }

      const slots = await response.json();
      const now = new Date();
      const [year, month, day] = date.split('-').map(Number);
      const selectedDateObj = new Date(year, month - 1, day);

      // Get minimum booking window from location (0 = no restriction)
      const minimumBookingWindowHours = selectedKitchen?.location?.minimumBookingWindowHours ?? 0;

      const filteredSlots = slots.filter((slot: any) => {
        const [slotHours, slotMins] = slot.time.split(':').map(Number);
        const slotTime = new Date(selectedDateObj);
        slotTime.setHours(slotHours, slotMins, 0, 0);

        // Filter out past times (applies to any date)
        if (slotTime <= now) return false;

        // Enforce minimum booking window across ALL dates (not just today)
        // e.g., a 48-hour window must also filter tomorrow's slots that are within range
        if (minimumBookingWindowHours > 0) {
          const hoursUntilSlot = (slotTime.getTime() - now.getTime()) / (1000 * 60 * 60);
          if (hoursUntilSlot < minimumBookingWindowHours) return false;
        }
        return true;
      });

      setAllSlots(filteredSlots);
      // Don't auto-navigate - user clicks "Select Time Slots" button to proceed

      if (slots.length === 0) {
        toast({
          title: t("toastKitchenClosedTitle", "Kitchen closed"),
          description: t("toastKitchenClosedDesc", "This date has no operating hours set."),
          variant: "destructive",
        });
      }
    } catch (error) {
      logger.error("Error loading slots:", error);
      setAllSlots([]);
      toast({
        title: t("toastGenericErrorTitle", "Error"),
        description: t("toastLoadSlotsFailedDesc", "Failed to load time slots. Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsLoadingSlots(false);
    }
  };

  const fetchKitchenAddons = async (kitchenId: number, authHeader?: string) => {
    setIsLoadingAddons(true);
    const empty = {
      storage: [] as any[],
      equipment: { all: [] as any[], included: [] as any[], rental: [] as any[] },
    };
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      // Fetch storage
      const storageRes = await fetch(`/api/chef/kitchens/${kitchenId}/storage-listings`, {
        credentials: "include",
        headers,
        cache: 'no-store',
      });

      let storageData: any[] = [];
      if (storageRes.ok) {
        storageData = await storageRes.json();
        setStorageListings(storageData);
      } else {
        setStorageListings([]);
      }

      // Fetch equipment
      const equipmentRes = await fetch(`/api/chef/kitchens/${kitchenId}/equipment-listings`, {
        credentials: "include",
        headers,
        cache: 'no-store',
      });

      let equipment = empty.equipment;
      if (equipmentRes.ok) {
        const equipmentData = await equipmentRes.json();
        const normalizeEquipment = (eq: any) => ({
          ...eq,
          sessionRate: eq.sessionRate || 0,
          hourlyRate: eq.hourlyRate || 0,
          dailyRate: eq.dailyRate || 0,
        });

        equipment = {
          all: [...(equipmentData.included || []), ...(equipmentData.rental || [])].map(normalizeEquipment),
          included: (equipmentData.included || []).map(normalizeEquipment),
          rental: (equipmentData.rental || []).map(normalizeEquipment),
        };
        setEquipmentListings(equipment);
      } else {
        setEquipmentListings(empty.equipment);
      }

      return { storage: storageData, equipment };
    } catch (error) {
      logger.error('Error fetching kitchen addons:', error);
      setStorageListings([]);
      setEquipmentListings(empty.equipment);
      return empty;
    } finally {
      setIsLoadingAddons(false);
    }
  };

  const stepAfterTime = (hasEquipment: boolean, hasStorage: boolean): BookingStep => {
    if (hasEquipment) return "equipment";
    if (hasStorage) return "storage";
    return "confirm";
  };

  const handleKitchenSelect = async (
    kitchen: any,
    restore?: {
      dateIso: string;
      slots: string[];
      step?: BookingStep;
    }
  ) => {
    setIsFlowReady(false);
    setSelectedKitchen(kitchen);
    setSelectedDate(null);
    setSelectedSlots([]);
    setAllSlots([]);
    setSelectedStorage([]);
    setSelectedEquipmentIds([]);

    // Fetch pricing
    try {
      let authHeader: string | undefined;
      try {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth?.currentUser;
        if (currentUser) {
          const token = await currentUser.getIdToken();
          authHeader = `Bearer ${token}`;
        }
      } catch (e) {
        const token = localStorage.getItem('firebaseToken');
        if (token) authHeader = `Bearer ${token}`;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      const response = await fetch(`/api/chef/kitchens/${kitchen.id}/pricing`, {
        credentials: "include",
        headers,
        cache: 'no-store',
      });

      if (response.ok) {
        const pricing = await response.json();
        let hourlyRateCents = pricing.hourlyRate;
        if (typeof hourlyRateCents === 'string') {
          hourlyRateCents = parseFloat(hourlyRateCents);
        }
        setKitchenPricing({
          hourlyRate: hourlyRateCents,
          currency: pricing.currency || 'CAD',
          minimumBookingHours: pricing.minimumBookingHours ?? 0,
          platformCommissionRate: Math.max(0, Number(pricing.platformCommissionRate) || 0),
        });
      } else {
        setKitchenPricing({ hourlyRate: null, currency: 'CAD', minimumBookingHours: 0, platformCommissionRate: 0 });
      }

      // Fetch addons
      const addons = await fetchKitchenAddons(kitchen.id, authHeader);

      if (restore?.dateIso) {
        const [y, m, d] = restore.dateIso.split("-").map(Number);
        const restoredDate = new Date(y, m - 1, d);
        setSelectedDate(restoredDate);
        setCalendarMonth(new Date(y, m - 1, 1));
        if (restore.slots?.length) {
          setSelectedSlots([...restore.slots].sort());
        }
        setHideDateStep(true);
        // Date already chosen — start at time (or next step if slots also prefilled).
        setCurrentStep(
          restore.step ??
            (restore.slots?.length
              ? stepAfterTime(addons.equipment.all.length > 0, addons.storage.length > 0)
              : "slots")
        );
      } else {
        setHideDateStep(false);
        setCurrentStep("calendar");
      }
    } catch (error) {
      logger.error('Error fetching kitchen data:', error);
      setKitchenPricing({ hourlyRate: null, currency: 'CAD', minimumBookingHours: 0, platformCommissionRate: 0 });
      setHideDateStep(false);
      setCurrentStep("calendar");
    } finally {
      setIsFlowReady(true);
    }
  };

  const handleDateClick = (date: Date | undefined) => {
    if (!date) return;
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    if (normalized < today) return;
    if (!isDayAvailable(normalized)) return;
    setSelectedDate(normalized);
    setSelectedSlots([]);
  };

  const isDayAvailable = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    if (d < today) return false;
    return dateAvailability[toLocalDateString(d)] === true;
  };

  const updateSlotSelection = (
    setter: Dispatch<SetStateAction<string[]>>,
    slot: { time: string; available: number; capacity: number; isFullyBooked: boolean }
  ) => {
    if (slot.isFullyBooked) {
      toast({
        title: t("toastSlotFullyBookedTitle", "Slot Fully Booked"),
        description: t("toastSlotFullyBookedDesc", "This time slot is already at maximum capacity."),
        variant: "destructive",
      });
      return;
    }

    const minHours = kitchenPricing?.minimumBookingHours ?? 0;

    setter(prev => {
      // Deselect: if clicking an already-selected slot, remove it (and any auto-filled slots)
      if (prev.includes(slot.time)) {
        // If minimum hours apply, clear all slots (they were auto-selected as a block)
        if (minHours > 1) {
          return [];
        }
        return prev.filter(s => s !== slot.time);
      }

      // Select: auto-fill consecutive slots if minimum booking hours apply
      if (minHours > 1 && prev.length === 0) {
        // Find consecutive available slots starting from the clicked slot
        const clickedIndex = allSlots.findIndex(s => s.time === slot.time);
        if (clickedIndex === -1) return prev;

        const slotsToSelect: string[] = [];
        for (let i = clickedIndex; i < allSlots.length && slotsToSelect.length < minHours; i++) {
          if (!allSlots[i].isFullyBooked) {
            slotsToSelect.push(allSlots[i].time);
          } else {
            break; // Stop at fully booked slots
          }
        }

        // Check if we can fit within the daily limit
        if (slotsToSelect.length > maxSlotsPerChef) {
          toast({
            title: t("toastCannotMeetMinTitle", "Cannot meet minimum"),
            description: t("toastCannotMeetMinDesc", { minHours, maxSlots: maxSlotsPerChef, defaultValue: `This kitchen requires ${minHours} consecutive hours, but the daily limit is ${maxSlotsPerChef} hours.` }),
            variant: "destructive",
          });
          return prev;
        }

        if (slotsToSelect.length < minHours) {
          toast({
            title: t("toastNotEnoughSlotsTitle", "Not enough available slots"),
            description: t("toastNotEnoughSlotsDesc", { minHours, available: slotsToSelect.length, defaultValue: `This kitchen requires a minimum of ${minHours} consecutive hours. Only ${slotsToSelect.length} available from this time.` }),
            variant: "destructive",
          });
          return prev;
        }

        toast({
          title: t("toastAutoSelectedTitle", { minHours, defaultValue: `${minHours} hours auto-selected` }),
          description: t("toastAutoSelectedDesc", { minHours, defaultValue: `This kitchen has a ${minHours}-hour minimum booking. ${minHours} consecutive slots have been selected.` }),
        });

        return slotsToSelect.sort();
      }

      // Normal selection (no minimum or already have slots selected)
      if (prev.length < maxSlotsPerChef) {
        return [...prev, slot.time].sort();
      } else {
        toast({
          title: t("toastLimitReachedTitle", "Limit reached"),
          description: t("toastLimitReachedDesc", { count: maxSlotsPerChef, defaultValue: `You can select up to ${maxSlotsPerChef} hour slot${maxSlotsPerChef > 1 ? 's' : ''} for this day.` }),
          variant: "destructive",
        });
        return prev;
      }
    });
  };

  const handleSlotClick = (slot: { time: string; available: number; capacity: number; isFullyBooked: boolean }) => {
    updateSlotSelection(setSelectedSlots, slot);
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatSlotRange = (slotStartTime: string) => {
    return formatHourSlotRange(slotStartTime, i18n.language);
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(i18n.language, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const hasEquipment = equipmentListings.all.length > 0;
  const hasStorage = storageListings.length > 0;

  // Step configuration — date first; kitchen is auto-selected (not a step).
  // When a date was already chosen (preview), hide the Date step entirely.
  // Omit equipment/storage when this kitchen has none.
  const steps = useMemo(() => {
    const all: StepMeta[] = [
      {
        key: "calendar",
        label: t("sheetStepDate", "Date"),
        subtext: t("sheetStepDateSubtext", "Pick your kitchen day"),
      },
      {
        key: "slots",
        label: t("sheetStepTime", "Time"),
        subtext: t("sheetStepTimeSubtext", "Choose consecutive hours"),
      },
      {
        key: "equipment",
        label: t("sheetStepEquipment", "Equipment"),
        subtext: t("sheetStepEquipmentSubtext", "Add included or rental gear"),
      },
      {
        key: "storage",
        label: t("sheetStepStorage", "Storage"),
        subtext: t("sheetStepStorageSubtext", "Reserve fridge or dry storage"),
      },
      {
        key: "confirm",
        label: t("sheetStepConfirm", "Confirm"),
        subtext: t("sheetStepConfirmSubtext", "Review and pay"),
      },
    ];
    return all.filter((s) => {
      if (s.key === "calendar" && hideDateStep) return false;
      if (s.key === "equipment" && !hasEquipment) return false;
      if (s.key === "storage" && !hasStorage) return false;
      return true;
    });
  }, [hideDateStep, hasEquipment, hasStorage, t]);

  const stepOrder = steps.map((s) => s.key);
  const currentStepIndex = Math.max(0, stepOrder.indexOf(currentStep));

  const goToStepRelative = (from: BookingStep, delta: 1 | -1): BookingStep | null => {
    const idx = stepOrder.indexOf(from);
    if (idx < 0) return null;
    return stepOrder[idx + delta] ?? null;
  };

  // Get booking time range helper
  const getBookingTimeRange = () => {
    if (selectedSlots.length === 0) return '';
    const sortedSlots = [...selectedSlots].sort();
    const startTime = sortedSlots[0];
    const lastSlotStart = sortedSlots[sortedSlots.length - 1];
    const [lastHours, lastMinutes] = lastSlotStart.split(':').map(Number);
    const endHour = lastHours + 1;
    const endTimeStr = `${endHour.toString().padStart(2, '0')}:${lastMinutes.toString().padStart(2, '0')}`;
    return `${formatTime(startTime)} - ${formatTime(endTimeStr)}`;
  };

  // Redirect to Stripe Checkout
  const redirectToStripeCheckout = async () => {
    if (!selectedKitchen || !selectedDate || selectedSlots.length === 0) return;

    // Enforce minimum booking hours (0 = no restriction)
    const minHours = kitchenPricing?.minimumBookingHours ?? 0;
    if (minHours > 0 && selectedSlots.length < minHours) {
      toast({
        title: t("toastMinBookingRequiredTitle", "Minimum Booking Required"),
        description: t("toastMinBookingRequiredDesc", { minHours, selected: selectedSlots.length, defaultValue: `This kitchen requires a minimum of ${minHours} hour${minHours > 1 ? 's' : ''} per booking. You have selected ${selectedSlots.length}.` }),
        variant: "destructive",
      });
      return;
    }

    // Check for unpaid penalties first
    if (penaltyData?.hasUnpaidPenalties) {
      const totalOwed = (penaltyData.totalOwedCents / 100).toFixed(2);
      toast({
        title: t("toastUnpaidPenaltiesTitle", "Booking Blocked - Unpaid Penalties"),
        description: t("toastUnpaidPenaltiesDesc", { count: penaltyData.totalCount, amount: `$${totalOwed}`, defaultValue: `You have ${penaltyData.totalCount} unpaid penalty(ies) totaling $${totalOwed}. Please resolve these before making new bookings.` }),
        variant: "destructive",
      });
      return;
    }

    setIsRedirectingToCheckout(true);
    try {
      const sortedSlots = [...selectedSlots].sort();
      const startTime = sortedSlots[0];
      // Calculate endTime from the last slot (each slot is 1 hour)
      const lastSlot = sortedSlots[sortedSlots.length - 1];
      const [lastH, lastM] = lastSlot.split(':').map(Number);
      const endTotalMins = lastH * 60 + lastM + 60; // Add 1 hour to last slot start
      const endHours = Math.floor(endTotalMins / 60);
      const endMins = endTotalMins % 60;
      const endTime = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`;

      const bookingDateStr = toLocalDateString(selectedDate);
      const [year, month, day] = bookingDateStr.split('-').map(Number);
      const bookingDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;
      const token = currentUser ? await currentUser.getIdToken() : '';

      const response = await fetch('/api/chef/bookings/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          kitchenId: selectedKitchen.id,
          bookingDate: bookingDate.toISOString(),
          startTime,
          endTime,
          selectedSlots: sortedSlots.map(slot => {
            const [h, m] = slot.split(':').map(Number);
            const endMins = h * 60 + m + 60;
            const endH = Math.floor(endMins / 60);
            const endM = endMins % 60;
            return {
              startTime: slot,
              endTime: `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`
            };
          }),
          specialNotes: notes,
          selectedStorage: selectedStorage.length > 0 ? selectedStorage.map((s: any) => ({
            storageListingId: s.storageListingId,
            startDate: s.startDate instanceof Date ? s.startDate.toISOString() : s.startDate,
            endDate: s.endDate instanceof Date ? s.endDate.toISOString() : s.endDate,
          })) : undefined,
          selectedEquipmentIds: selectedEquipmentIds.length > 0 ? selectedEquipmentIds : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create checkout session');
      }

      const data = await response.json();
      
      // Redirect to Stripe Checkout
      if (data.sessionUrl) {
        window.location.href = data.sessionUrl;
      } else {
        throw new Error(tt("noCheckoutUrl"));
      }
    } catch (error: any) {
      toast({
        title: t("toastCheckoutFailedTitle", "Checkout Failed"),
        description: error.message || t("toastCheckoutFailedDefaultDesc", "Failed to start checkout. Please try again."),
        variant: "destructive",
      });
      setIsRedirectingToCheckout(false);
    }
  };


  // Handle free booking submission
  const handleFreeBookingSubmit = async () => {
    if (!selectedKitchen || !selectedDate || selectedSlots.length === 0) return;

    // Enforce minimum booking hours (0 = no restriction)
    const minHours = kitchenPricing?.minimumBookingHours ?? 0;
    if (minHours > 0 && selectedSlots.length < minHours) {
      toast({
        title: t("toastMinBookingRequiredTitle", "Minimum Booking Required"),
        description: t("toastMinBookingRequiredDesc", { minHours, selected: selectedSlots.length, defaultValue: `This kitchen requires a minimum of ${minHours} hour${minHours > 1 ? 's' : ''} per booking. You have selected ${selectedSlots.length}.` }),
        variant: "destructive",
      });
      return;
    }

    // Check for unpaid penalties first
    if (penaltyData?.hasUnpaidPenalties) {
      const totalOwed = (penaltyData.totalOwedCents / 100).toFixed(2);
      toast({
        title: t("toastUnpaidPenaltiesTitle", "Booking Blocked - Unpaid Penalties"),
        description: t("toastUnpaidPenaltiesDesc", { count: penaltyData.totalCount, amount: `$${totalOwed}`, defaultValue: `You have ${penaltyData.totalCount} unpaid penalty(ies) totaling $${totalOwed}. Please resolve these before making new bookings.` }),
        variant: "destructive",
      });
      return;
    }

    setIsProcessingBooking(true);

    const sortedSlots = [...selectedSlots].sort();
    const startTime = sortedSlots[0];
    // Calculate endTime from the last slot (each slot is 1 hour)
    const lastSlot = sortedSlots[sortedSlots.length - 1];
    const [lastH, lastM] = lastSlot.split(':').map(Number);
    const endTotalMins = lastH * 60 + lastM + 60; // Add 1 hour to last slot start
    const endHours = Math.floor(endTotalMins / 60);
    const endMins = endTotalMins % 60;
    const endTime = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`;

    const bookingDateStr = toLocalDateString(selectedDate);
    const [year, month, day] = bookingDateStr.split('-').map(Number);
    const bookingDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

    createBooking.mutate(
      {
        kitchenId: selectedKitchen.id,
        bookingDate: bookingDate.toISOString(),
        startTime,
        endTime,
        selectedSlots: sortedSlots.map(slot => {
          const [h, m] = slot.split(':').map(Number);
          const endMins = h * 60 + m + 60;
          const endH = Math.floor(endMins / 60);
          const endM = endMins % 60;
          return {
            startTime: slot,
            endTime: `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`
          };
        }),
        specialNotes: notes,
        selectedStorage: selectedStorage.length > 0 ? selectedStorage.map((s: any) => ({
          storageListingId: s.storageListingId,
          startDate: s.startDate instanceof Date ? s.startDate.toISOString() : s.startDate,
          endDate: s.endDate instanceof Date ? s.endDate.toISOString() : s.endDate,
        })) : undefined,
        selectedEquipmentIds: selectedEquipmentIds.length > 0 ? selectedEquipmentIds : undefined,
      },
      {
        onSuccess: (data: any) => {
          toast({
            title: t("toastBookingCreatedTitle", "Booking Created!"),
            description: t("toastBookingCreatedDesc", { count: selectedSlots.length, defaultValue: `Your ${selectedSlots.length} hour kitchen booking has been submitted successfully.` }),
          });
          setIsProcessingBooking(false);
          clearPersistedBookingPrefs();
          const bookingId = data?.id ?? data?.booking?.id;
          onComplete?.(typeof bookingId === "number" ? bookingId : undefined);
        },
        onError: (error: any) => {
          toast({
            title: t("toastBookingFailedTitle", "Booking Failed"),
            description: error.message || t("toastBookingFailedDefaultDesc", "Failed to create booking. Please try again."),
            variant: "destructive",
          });
          setIsProcessingBooking(false);
        },
      }
    );
  };

  // Content for each step - designed to fit without scrolling
  const renderStepContent = () => {
    // Loading State
    if (isLoadingKitchens) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Icon icon="mdi:loading" className="h-6 w-6 animate-spin text-primary mx-auto mb-3" aria-hidden />
            <p className="text-sm text-muted-foreground">{t("sheetLoadingKitchens", "Loading kitchens...")}</p>
          </div>
        </div>
      );
    }

    // No Kitchens
    if (locationKitchens.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <Icon icon="mdi:office-building-outline" className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-sm font-medium text-muted-foreground">{t("sheetNoKitchensAtLocation", "No kitchens available at this location")}</p>
          </div>
        </div>
      );
    }

    // Waiting for kitchen auto-select + restore (date/slots) so we don't flash Date.
    if (!selectedKitchen || !isFlowReady) {
      return (
        <div className="flex-1 flex items-center justify-center py-16">
          <div className="text-center">
            <Icon icon="mdi:loading" className="h-6 w-6 animate-spin text-primary mx-auto mb-3" aria-hidden />
            <p className="text-sm text-muted-foreground">{t("sheetLoadingKitchens", "Loading kitchens...")}</p>
          </div>
        </div>
      );
    }

    // Step: Date — kitchen-preview calendar (UICalendar + circular brand selection)
    if (currentStep === 'calendar' && selectedKitchen) {
      return (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Icon icon="mdi:calendar-month-outline" className="h-4 w-4 text-[#F51042]" aria-hidden />
                {t("sheetSelectDateTitle", "Select Date")}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {t("sheetTapDateToContinue", "Tap an available date to continue")}
              </p>
            </div>
            {selectedDate && (
              <button
                type="button"
                className="shrink-0 text-xs font-medium text-gray-500 hover:text-[#F51042]"
                onClick={() => {
                  setSelectedDate(null);
                  setSelectedSlots([]);
                }}
              >
                {t("sheetClearButton", "Clear")}
              </button>
            )}
          </div>

          <div className="relative mx-auto w-full max-w-[640px] rounded-xl border border-gray-100 bg-gray-50/40 p-2 sm:p-3">
            {isLoadingAvailability && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/60">
                <Icon icon="mdi:loading" className="h-5 w-5 animate-spin text-[#F51042]" aria-hidden />
              </div>
            )}
            <UICalendar
              mode="single"
              numberOfMonths={2}
              pagedNavigation
              selected={selectedDate ?? undefined}
              onSelect={handleDateClick}
              month={calendarMonth}
              onMonthChange={(month) => {
                setCalendarMonth(new Date(month.getFullYear(), month.getMonth(), 1));
              }}
              disabled={(date) => !isDayAvailable(date)}
              className="w-full bg-transparent p-1"
              classNames={BOOKING_CALENDAR_TWO_MONTH_CLASS_NAMES}
            />
          </div>

          {selectedDate && (
            <div className="mx-auto w-full max-w-[640px] rounded-xl border border-[#F51042]/20 bg-[#F51042]/5 px-3 py-2.5">
              <p className="text-sm font-semibold text-gray-900">
                {selectedDate.toLocaleDateString(i18n.language, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isLoadingSlots
                  ? t("sheetLoadingSlotsText", "Loading time slots…")
                  : t("sheetSlotsAvailable", {
                      count: allSlots.length,
                      defaultValue: `${allSlots.length} time slot${allSlots.length !== 1 ? "s" : ""} available`,
                    })}
              </p>
            </div>
          )}
        </div>
      );
    }

    // Step: Time Slots
    if (currentStep === 'slots' && selectedKitchen && selectedDate) {
      return (
        <div className="flex h-full min-h-[16rem] flex-col gap-4">
          <div className="flex shrink-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Icon icon="mdi:clock-outline" className="h-4 w-4 text-[#F51042]" aria-hidden />
                {t("sheetSelectTimeTitle", "Select Time")}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {formatDate(selectedDate)}
                {kitchenPricing?.minimumBookingHours && kitchenPricing.minimumBookingHours > 0
                  ? ` · ${t("sheetMinHourBadge", { minHours: kitchenPricing.minimumBookingHours, defaultValue: `Min ${kitchenPricing.minimumBookingHours}hr` })}`
                  : ""}
                {` · ${t("sheetMaxHoursBadge", { maxHours: maxSlotsPerChef, defaultValue: `Max ${maxSlotsPerChef} hours` })}`}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-gray-500 hover:text-[#F51042]"
              onClick={() => {
                setHideDateStep(false);
                setCurrentStep("calendar");
              }}
            >
              {t("sheetChangeDate", "Change date")}
            </button>
          </div>

          {isLoadingSlots ? (
            <div
              className="grid flex-1 content-center grid-cols-2 gap-2.5 sm:grid-cols-3"
              role="status"
              aria-label={t("sheetLoadingSlotsAria", "Loading available time slots")}
            >
              {Array.from({ length: 9 }).map((_, idx) => (
                <Skeleton key={idx} className="h-11 rounded-xl bg-muted/70" />
              ))}
            </div>
          ) : allSlots.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed py-10 text-center">
              <div>
                <Icon icon="mdi:clock-outline" className="h-7 w-7 text-muted-foreground/40 mx-auto mb-2" aria-hidden />
                <p className="text-sm text-muted-foreground">{t("sheetNoAvailableHours", "No available hours on this day")}</p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {kitchenPricing?.minimumBookingHours && kitchenPricing.minimumBookingHours > 1 && selectedSlots.length === 0 && (
                <div className="shrink-0 rounded-lg border bg-muted/30 px-3 py-2 flex items-start gap-2">
                  <Icon icon="mdi:clock-outline" className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" aria-hidden />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong>{t("sheetMinBookingNoticeBold", { minHours: kitchenPricing.minimumBookingHours, defaultValue: `Minimum ${kitchenPricing.minimumBookingHours}-hour booking.` })}</strong>{" "}
                    {t("sheetMinBookingNoticeDetail", { minHours: kitchenPricing.minimumBookingHours, defaultValue: `Selecting a time slot will automatically reserve ${kitchenPricing.minimumBookingHours} consecutive hours.` })}
                  </p>
                </div>
              )}
              <div className="grid flex-1 content-center grid-cols-2 gap-2.5 sm:grid-cols-3">
                {allSlots.map((slot) => {
                  const isSelected = selectedSlots.includes(slot.time);
                  const isFullyBooked = slot.isFullyBooked;
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      onClick={() => handleSlotClick(slot)}
                      disabled={isFullyBooked}
                      className={cn(
                        "flex min-h-[44px] w-full items-center justify-center rounded-xl border px-3 py-2.5 text-center text-xs font-medium transition-colors",
                        isSelected && "bg-[#F51042] text-white border-[#F51042]",
                        !isSelected && !isFullyBooked && "bg-white text-gray-700 border-gray-200 hover:border-[#F51042]/40",
                        isFullyBooked && "bg-muted/50 text-muted-foreground/50 cursor-not-allowed border-transparent line-through"
                      )}
                    >
                      <span>
                        {formatSlotRange(slot.time)}
                        {slot.capacity > 1 && !isFullyBooked ? (
                          <span className={cn("ml-1.5", isSelected ? "text-white/80" : "text-muted-foreground")}>
                            · {t("sheetSlotsLeft", { count: slot.available, defaultValue: `${slot.available} left` })}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Step: Equipment
    if (currentStep === "equipment" && selectedKitchen) {
      const includedPreview = equipmentListings.included.slice(0, 4);
      const rentalPreview = equipmentListings.rental.slice(0, 4);
      const includedRemaining = Math.max(0, equipmentListings.included.length - includedPreview.length);
      const rentalRemaining = Math.max(0, equipmentListings.rental.length - rentalPreview.length);

      return (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">{t("sheetEquipmentTitle", "Equipment")}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("sheetEquipmentBrowseDesc", "See what is included, then add any optional rentals you need.")}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className={chefPrimaryCtaClass("shrink-0")}
              onClick={() => {
                setEquipmentInventoryModal(null);
                setPendingEquipmentIds(selectedEquipmentIds);
                setEquipmentModalOpen(true);
              }}
              disabled={equipmentListings.rental.length === 0}
            >
              <Icon icon="mdi:toolbox-outline" width={17} height={17} className="mr-1.5" aria-hidden />
              {selectedEquipmentIds.length > 0 ? `Edit (${selectedEquipmentIds.length})` : t("sheetSelectEquipment", "Select equipment")}
            </Button>
          </div>

          {isLoadingAddons ? (
            <div className="flex justify-center py-12">
              <Icon icon="mdi:loading" className="h-5 w-5 animate-spin text-[#F51042]" aria-hidden />
            </div>
          ) : (
            <div className="space-y-5">
              {equipmentListings.included.length > 0 ? (
                <InventoryPreviewList
                  title={t("sheetIncludedLabel", "Included")}
                  subtitle={t("sheetIncludedEquipmentDesc", "Available with your kitchen booking at no extra charge.")}
                  items={includedPreview}
                  rental={false}
                />
              ) : null}
              {includedRemaining > 0 ? (
                <button
                  type="button"
                  className="-mt-3 inline-flex items-center pb-1 text-sm font-semibold text-[#F51042] hover:text-[#D40E38]"
                  onClick={() => {
                    setEquipmentModalOpen(false);
                    setEquipmentInventoryModal("included");
                  }}
                >
                  {t("sheetShowAllButton", { defaultValue: "Show all" })} <span className="ml-1">+{includedRemaining}</span>
                  <Icon icon="mdi:chevron-right" className="ml-1 h-4 w-4" aria-hidden />
                </button>
              ) : null}
              {equipmentListings.rental.length > 0 ? (
                <InventoryPreviewList
                  title={t("sheetOptionalRentalsLabel", "Optional rentals")}
                  subtitle={t("sheetRentalEquipmentDesc", "Available to rent for this kitchen session.")}
                  items={rentalPreview}
                  rental
                />
              ) : null}
              {rentalRemaining > 0 ? (
                <button
                  type="button"
                  className="-mt-3 inline-flex items-center pb-1 text-sm font-semibold text-[#F51042] hover:text-[#D40E38]"
                  onClick={() => {
                    setEquipmentModalOpen(false);
                    setEquipmentInventoryModal("rental");
                  }}
                >
                  {t("sheetShowAllButton", { defaultValue: "Show all" })} <span className="ml-1">+{rentalRemaining}</span>
                  <Icon icon="mdi:chevron-right" className="ml-1 h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </div>
          )}
        </div>
      );
    }

    // Step: Storage
    if (currentStep === "storage" && selectedKitchen) {
      const activeStorage = storageListings.filter((storage: any) => storage.isActive !== false);
      const storagePreview = activeStorage.slice(0, STORAGE_PREVIEW_COUNT);
      const storageRemaining = Math.max(0, activeStorage.length - storagePreview.length);
      return (
        <div ref={storageStepRef} className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">{t("sheetStorageOptionsTitle", "Storage options")}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("sheetNeedStorageDesc", "Reserve refrigerator, freezer, or dry storage for your ingredients.")}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className={chefPrimaryCtaClass("shrink-0")}
              onClick={() => setStorageModalOpen(true)}
            >
              <Icon icon="mdi:archive-plus-outline" width={17} height={17} className="mr-1.5" aria-hidden />
              {selectedStorage.length > 0 ? `Edit (${selectedStorage.length})` : t("sheetSelectStorage", "Select storage")}
            </Button>
          </div>

          {isLoadingAddons ? (
            <div className="flex justify-center py-12">
              <Icon icon="mdi:loading" className="h-5 w-5 animate-spin text-[#F51042]" aria-hidden />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {storagePreview.map((storage: any) => {
                  const selection = selectedStorage.find((item) => item.storageListingId === storage.id);
                  return (
                    <div key={storage.id} className="flex min-w-0 items-center gap-2.5 border-b border-gray-100 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFF3F5] text-[#F51042]">
                        <Icon
                          icon={resolveStorageIcon(storage.storageType, storage.name)}
                          width={18}
                          height={18}
                          aria-hidden
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{storage.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatCurrency(storage.basePrice || 0)}/day
                        </p>
                        {selection ? (
                          <p className="truncate text-xs font-medium text-gray-900">
                            {formatDate(selection.startDate)} – {formatDate(selection.endDate)}
                          </p>
                        ) : null}
                      </div>
                      {selection ? (
                        <Icon icon="mdi:check" className="h-4 w-4 shrink-0 text-[#F51042]" aria-hidden />
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {storageRemaining > 0 ? (
                <button
                  type="button"
                  className="inline-flex items-center pb-1 text-sm font-semibold text-[#F51042] hover:text-[#D40E38]"
                  onClick={() => setStorageModalOpen(true)}
                >
                  {t("sheetShowAllButton", { defaultValue: "Show all" })} +{storageRemaining}
                  <Icon icon="mdi:chevron-right" className="ml-1 inline h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </div>
          )}
        </div>
      );
    }

    // Step: Confirm — editable choices only (kitchen + price live in the left rail)
    if (currentStep === 'confirm' && selectedKitchen && selectedDate && selectedSlots.length > 0) {
      const editLinkClass =
        "inline-flex items-center gap-1 text-xs font-medium text-[#F51042] hover:text-[#d10e39] shrink-0";

      return (
        <div className="space-y-5">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {t("sheetStepConfirm", "Confirm")}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {t("sheetStepConfirmSubtext", "Review and pay")}
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border divide-y bg-white">
            <div className="flex items-start justify-between gap-3 px-4 py-3.5">
              <div className="flex min-w-0 items-start gap-2.5">
                <Icon icon="mdi:calendar-month-outline" className="mt-0.5 h-4 w-4 shrink-0 text-[#F51042]" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {t("sheetDateLabel", "Date")}
                  </p>
                  <p className="text-sm font-semibold text-gray-900">{formatDate(selectedDate)}</p>
                </div>
              </div>
              <Popover
                open={confirmDatePopoverOpen}
                onOpenChange={(open) => {
                  setConfirmDatePopoverOpen(open);
                  if (open && selectedDate) {
                    setCalendarMonth(
                      new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
                    );
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <button type="button" className={editLinkClass} aria-label={t("sheetEditDate", "Edit date")}>
                    <Icon icon="mdi:pencil-outline" className="h-3 w-3" aria-hidden />
                    {t("sheetEdit", "Edit")}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end" sideOffset={8}>
                  <div className="relative w-[300px] p-2">
                    {isLoadingAvailability && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-white/60">
                        <Icon icon="mdi:loading" className="h-5 w-5 animate-spin text-[#F51042]" aria-hidden />
                      </div>
                    )}
                    <UICalendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => {
                        if (!date) return;
                        const normalized = new Date(date);
                        normalized.setHours(0, 0, 0, 0);
                        if (!isDayAvailable(normalized)) return;
                        setConfirmDatePopoverOpen(false);
                        if (selectedDate && selectedDate.getTime() === normalized.getTime()) return;
                        setSelectedDate(normalized);
                        setSelectedSlots([]);
                        setCalendarMonth(new Date(normalized.getFullYear(), normalized.getMonth(), 1));
                        // New day needs new times — skip calendar step, go straight to slots
                        setCurrentStep("slots");
                      }}
                      month={calendarMonth}
                      onMonthChange={(month) => {
                        setCalendarMonth(new Date(month.getFullYear(), month.getMonth(), 1));
                      }}
                      disabled={(date) => !isDayAvailable(date)}
                      className="w-full bg-transparent p-1"
                      classNames={BOOKING_CALENDAR_CLASS_NAMES}
                    />
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex items-start justify-between gap-3 px-4 py-3.5">
              <div className="flex min-w-0 items-start gap-2.5">
                <Icon icon="mdi:clock-outline" className="mt-0.5 h-4 w-4 shrink-0 text-[#F51042]" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {t("sheetBookingTimeLabel", "Booking Time")}
                  </p>
                  <p className="text-sm font-semibold text-gray-900">{getBookingTimeRange()}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("sheetHoursCount", {
                      count: selectedSlots.length,
                      defaultValue: `${selectedSlots.length} hour${selectedSlots.length > 1 ? "s" : ""}`,
                    })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className={editLinkClass}
                onClick={() => {
                  setPendingTimeSlots(selectedSlots);
                  setTimeModalOpen(true);
                }}
              >
                <Icon icon="mdi:pencil-outline" className="h-3 w-3" aria-hidden />
                {t("sheetEdit", "Edit")}
              </button>
            </div>

            {hasEquipment ? (
              <div className="flex items-start justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{t("sheetEquipmentTitle", "Equipment")}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {selectedEquipmentIds.length > 0
                      ? t("sheetEquipmentLineLabel", {
                          count: selectedEquipmentIds.length,
                          defaultValue: `Equipment (${selectedEquipmentIds.length})`,
                        })
                      : t("sheetNoRentalsSelected", "No rentals selected")}
                    {selectedEquipmentIds.length > 0 ? (
                      <span className="ml-2 font-medium text-gray-900">
                        {formatCurrency(equipmentPricing.subtotal)}
                      </span>
                    ) : null}
                  </p>
                </div>
                <button
                  type="button"
                  className={editLinkClass}
                  onClick={() => {
                    setEquipmentInventoryModal(null);
                    setPendingEquipmentIds(selectedEquipmentIds);
                    setEquipmentModalOpen(true);
                  }}
                >
                  <Icon icon="mdi:pencil-outline" className="h-3 w-3" aria-hidden />
                  {t("sheetEdit", "Edit")}
                </button>
              </div>
            ) : null}

            {hasStorage ? (
              <div className="flex items-start justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{t("sheetStepStorage", "Storage")}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {selectedStorage.length > 0
                      ? t("sheetStorageLineLabel", {
                          count: selectedStorage.length,
                          defaultValue: `Storage (${selectedStorage.length})`,
                        })
                      : t("sheetNoStorageSelected", "No storage selected")}
                    {selectedStorage.length > 0 ? (
                      <span className="ml-2 font-medium text-gray-900">
                        {formatCurrency(storagePricing.subtotal)}
                      </span>
                    ) : null}
                  </p>
                </div>
                <button type="button" className={editLinkClass} onClick={() => setStorageModalOpen(true)}>
                  <Icon icon="mdi:pencil-outline" className="h-3 w-3" aria-hidden />
                  {t("sheetEdit", "Edit")}
                </button>
              </div>
            ) : null}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              {t("sheetSpecialNotesLabel", "Special Notes (Optional)")}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t("sheetSpecialNotesPlaceholder", "Any special requirements...")}
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-[#F51042] focus:ring-2 focus:ring-[#F51042]/30"
            />
          </div>
        </div>
      );
    }

    return null;
  };

  // Sticky order summary for the left rail (desktop) + mobile footer strip
  const renderPriceBreakdown = (variant: "rail" | "mobile" = "rail") => {
    const hasAddons = selectedEquipmentIds.length > 0 || selectedStorage.length > 0;
    const hasTimeSlots = selectedSlots.length > 0;
    const showDetails = selectedKitchen && (hasAddons || hasTimeSlots);

    if (variant === "mobile") {
      if (!showDetails) {
        if (!selectedKitchen || kitchenPricing?.hourlyRate == null) return null;
        return (
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="text-muted-foreground">{t("sheetPerHour", "/hour")}</span>
            <span className="font-semibold text-[#F51042]">{formatCurrency(kitchenPricing.hourlyRate)}</span>
          </div>
        );
      }
      return (
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">{t("sheetTotalLabel", "Total")}</span>
          <span className="text-lg font-semibold text-[#F51042]">
            {formatCurrency(grandTotal)} {kitchenPricing?.currency || "CAD"}
          </span>
        </div>
      );
    }

    // Desktop rail
    return (
      <div className="rounded-xl border bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <Icon icon="mdi:currency-usd" className="h-4 w-4 text-[#F51042]" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sheetOrderSummaryLabel", "Booking Summary")}
          </span>
        </div>

        {!showDetails ? (
          <div className="space-y-1">
            {selectedKitchen && kitchenPricing?.hourlyRate != null ? (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-semibold text-gray-900">{formatCurrency(kitchenPricing.hourlyRate)}</span>
                  <span className="text-xs text-muted-foreground">{t("sheetPerHour", "/hour")}</span>
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                  {t("sheetPriceHint", "Select time to see your total")}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("sheetPricePending", "Pricing appears as you book")}</p>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            {selectedDate && currentStep !== "confirm" && (
              <div className="mb-2 grid grid-cols-[0.78fr_1.22fr] gap-2 border-b pb-2">
                <div className="flex items-start gap-2.5">
                  <Icon icon="mdi:calendar-month-outline" className="mt-0.5 h-4 w-4 shrink-0 text-[#F51042]" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      {t("sheetDateLabel", "Date")}
                    </p>
                    <p className="text-sm font-semibold text-gray-900">{formatDate(selectedDate)}</p>
                  </div>
                </div>
                {selectedSlots.length > 0 && (
                  <div className="flex items-start gap-2.5">
                    <Icon icon="mdi:clock-outline" className="mt-0.5 h-4 w-4 shrink-0 text-[#F51042]" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-muted-foreground">
                        {t("sheetTimeLabel", "Time")}
                      </p>
                      <p className="line-clamp-2 text-[11px] font-medium leading-snug text-gray-900">
                        {selectedSlots.map(formatSlotRange).join(", ")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {selectedSlots.length > 0 && kitchenPricing?.hourlyRate && estimatedPrice && (
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  {t("sheetKitchenTimeItem", {
                    count: estimatedPrice.durationHours,
                    defaultValue: `${estimatedPrice.durationHours} hour${estimatedPrice.durationHours > 1 ? "s" : ""} kitchen time`,
                  })}
                </span>
                <span className="font-medium shrink-0 tabular-nums">{formatCurrency(estimatedPrice.basePrice)}</span>
              </div>
            )}
            {selectedEquipmentIds.length > 0 && (
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  {t("sheetEquipmentRentalsItem", {
                    count: selectedEquipmentIds.length,
                    defaultValue: `${selectedEquipmentIds.length} equipment`,
                  })}
                </span>
                <span className="font-medium shrink-0 tabular-nums">{formatCurrency(equipmentPricing.subtotal)}</span>
              </div>
            )}
            {selectedStorage.length > 0 && (
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  {t("sheetStorageReservationsItem", {
                    count: selectedStorage.length,
                    defaultValue: `${selectedStorage.length} storage`,
                  })}
                </span>
                <span className="font-medium shrink-0 tabular-nums">{formatCurrency(storagePricing.subtotal)}</span>
              </div>
            )}
            {(tax > 0 || serviceFee > 0) && (
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  {t("sheetTaxesAndFees", "Taxes & non-govt. fees")}
                  <FeesInfoPopover
                    tax={tax}
                    serviceFee={serviceFee}
                    taxRatePercent={selectedKitchen?.taxRatePercent || 0}
                    serviceFeeRate={kitchenPricing?.platformCommissionRate ?? 0}
                  />
                </span>
                <span className="font-medium shrink-0 tabular-nums">{formatCurrency(tax + serviceFee)}</span>
              </div>
            )}
            <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-2">
              <span className="text-sm font-semibold">{t("sheetTotalLabel", "Total")}</span>
              <span className="text-lg font-semibold text-[#F51042] tabular-nums">
                {formatCurrency(grandTotal)}{" "}
                <span className="text-xs font-medium text-muted-foreground">{kitchenPricing?.currency || "CAD"}</span>
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const clearPersistedBookingPrefs = () => {
    for (const kitchen of locationKitchens) {
      const id = kitchen?.id;
      if (id == null) continue;
      try {
        sessionStorage.removeItem(`kitchen_dates_${id}`);
        sessionStorage.removeItem(`kitchen_booking_prefs_${id}`);
        notifyBookingPrefsChanged(String(id));
      } catch {
        /* ignore */
      }
    }
  };

  const confirmCancelBooking = () => {
    clearPersistedBookingPrefs();
    setCancelConfirmOpen(false);
    onCancel();
  };

  const confirmDiscardModalChanges = () => {
    if (discardModal === "equipment") {
      setPendingEquipmentIds(selectedEquipmentIds);
      setEquipmentModalOpen(false);
    } else if (discardModal === "storage") {
      setStorageModalOpen(false);
    } else if (discardModal === "time") {
      setPendingTimeSlots(selectedSlots);
      setTimeModalOpen(false);
    }
    setDiscardModal(null);
  };

  const goToPreviousStep = () => {
    const prev = goToStepRelative(currentStep, -1);
    if (prev) setCurrentStep(prev);
  };

  const goToNextStep = () => {
    const next = goToStepRelative(currentStep, 1);
    if (next) setCurrentStep(next);
  };

  const canGoPrevious = currentStepIndex > 0;

  const previousButton = canGoPrevious ? (
    <Button
      type="button"
      variant="outline"
      className={chefOutlineCtaClass("min-h-[44px] flex-1")}
      onClick={goToPreviousStep}
      disabled={isRedirectingToCheckout || isProcessingBooking || createBooking.isPending}
    >
      <Icon icon="mdi:arrow-left" className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2" aria-hidden />
      {t("sheetPreviousButton", "Previous")}
    </Button>
  ) : null;

  const cancelButton = (
    <Button
      type="button"
      variant="ghost"
      className="min-h-[44px] shrink-0 rounded-xl"
      onClick={() => setCancelConfirmOpen(true)}
      disabled={isRedirectingToCheckout || isProcessingBooking || createBooking.isPending}
    >
      {t("sheetCancelButton", "Cancel")}
    </Button>
  );

  const continueButtonLabel = () => {
    if (currentStep === "calendar") {
      return selectedDate
        ? t("sheetSelectTimeSlotsButton", "Select Time Slots")
        : t("sheetSelectDateToContinueButton", "Select a date to continue");
    }
    if (currentStep === "slots") {
      return selectedSlots.length > 0
        ? t("sheetContinueButton", "Continue")
        : t("sheetSelectTimeSlotsToContinueButton", "Select time slots to continue");
    }
    if (currentStep === "equipment" || currentStep === "storage") {
      const next = goToStepRelative(currentStep, 1);
      if (next === "confirm") return t("sheetContinueToConfirmButton", "Continue to confirm");
      return t("sheetContinueButton", "Continue");
    }
    return t("sheetContinueButton", "Continue");
  };

  const continueDisabled =
    (currentStep === "calendar" && !selectedDate) ||
    (currentStep === "slots" && selectedSlots.length === 0) ||
    ((currentStep === "equipment" || currentStep === "storage") && isLoadingAddons);

  const renderStepActions = () => {
    if (!isFlowReady) {
      return <div className="flex gap-3">{cancelButton}</div>;
    }

    if (currentStep === "confirm") {
      return (
        <div className="space-y-3">
          <div className="lg:hidden">{renderPriceBreakdown("mobile")}</div>
          <div className="flex gap-3">
            {cancelButton}
            {previousButton}
            <Button
              className={chefPrimaryCtaClass("flex-1 min-h-[44px]")}
              onClick={grandTotal > 0 ? redirectToStripeCheckout : handleFreeBookingSubmit}
              disabled={createBooking.isPending || isRedirectingToCheckout || isProcessingBooking}
            >
              {createBooking.isPending || isRedirectingToCheckout || isProcessingBooking ? (
                <>
                  <Icon icon="mdi:loading" className="mr-1.5 sm:mr-2 h-4 w-4 animate-spin flex-shrink-0" aria-hidden />
                  <span className="truncate">{isRedirectingToCheckout ? t("sheetRedirectingButton", "Redirecting...") : t("sheetBookingEllipsisButton", "Booking...")}</span>
                </>
              ) : grandTotal > 0 ? (
                <>
                  <Icon icon="mdi:credit-card-outline" className="mr-1.5 sm:mr-2 h-4 w-4 flex-shrink-0" aria-hidden />
                  <span className="truncate">{t("sheetCheckoutButton", "Checkout")}</span>
                </>
              ) : (
                <>
                  <Icon icon="mdi:check" className="mr-1.5 sm:mr-2 h-4 w-4 flex-shrink-0" aria-hidden />
                  <span className="truncate">{t("sheetConfirmBookingButton", "Confirm Booking")}</span>
                </>
              )}
            </Button>
          </div>
        </div>
      );
    }

    if (
      currentStep === "calendar" ||
      currentStep === "slots" ||
      currentStep === "equipment" ||
      currentStep === "storage"
    ) {
      return (
        <>
          <div className="lg:hidden">{renderPriceBreakdown("mobile")}</div>
          <div className="flex gap-3">
            {cancelButton}
            {previousButton}
            <Button
              className={chefPrimaryCtaClass("min-h-[44px] flex-1")}
              onClick={goToNextStep}
              disabled={continueDisabled}
            >
              {continueButtonLabel()}
              <Icon icon="mdi:arrow-right" className="ml-2 h-4 w-4" aria-hidden />
            </Button>
          </div>
        </>
      );
    }

    return <div className="flex gap-3">{cancelButton}</div>;
  };

  return (
    <>
      <div className="space-y-4 lg:flex lg:h-[calc(100dvh-9rem)] lg:flex-col lg:space-y-0 lg:gap-4 lg:overflow-hidden">
        {/* ReUI c-stepper-10 — equal columns, title + description, line separators */}
        {isFlowReady ? (
          <Stepper
            value={currentStepIndex + 1}
            indicators={{
              completed: <Icon icon="mdi:check" className="size-3.5" aria-hidden />,
              loading: <Icon icon="mdi:loading" className="size-3.5 animate-spin" aria-hidden />,
            }}
            className="w-full rounded-xl border bg-white px-3 py-3 shadow-sm sm:px-5"
            aria-label={t("sheetBookingStepsAria", "Booking steps")}
          >
            <StepperNav className="w-full">
              {steps.map((step, index) => (
                <StepperItem key={step.key} step={index + 1} className="relative">
                  <StepperTrigger className="flex shrink-0 cursor-default justify-start gap-1.5">
                    <StepperIndicator>{index + 1}</StepperIndicator>
                    <div className="flex min-w-0 flex-col items-start gap-0.5">
                      <StepperTitle className="truncate">{step.label}</StepperTitle>
                      <StepperDescription className="hidden truncate text-xs sm:block">
                        {step.subtext}
                      </StepperDescription>
                    </div>
                  </StepperTrigger>

                  {index < steps.length - 1 ? <StepperSeparator /> : null}
                </StepperItem>
              ))}
            </StepperNav>
          </Stepper>
        ) : (
          <Skeleton className="h-[4.5rem] w-full rounded-xl" />
        )}

        <div className="flex flex-col gap-0 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-stretch lg:gap-6">
          {/* Left rail: kitchen details + sticky price (desktop) */}
          <aside className="hidden w-[340px] shrink-0 flex-col lg:flex lg:h-full">
            <div className="mb-4">
              {selectedKitchen ? (
                <BookingPlaceContext
                  kitchen={selectedKitchen}
                  locationName={locationName}
                  locationAddress={locationAddress}
                  onPolicyOpen={() => setCancellationPolicyOpen(true)}
                />
              ) : (
                <Skeleton className="h-40 w-full rounded-2xl" />
              )}
            </div>
            <div className="mt-auto pt-2">{renderPriceBreakdown("rail")}</div>
          </aside>

          {/* Main column */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-white shadow-sm lg:h-full lg:min-h-0">
            {/* Mobile kitchen context */}
            <div className="flex-shrink-0 border-b bg-gray-50/50 px-4 py-3 lg:hidden">
              {selectedKitchen ? (
                <BookingPlaceContext
                  kitchen={selectedKitchen}
                  locationName={locationName}
                  locationAddress={locationAddress}
                  compact
                  onPolicyOpen={() => setCancellationPolicyOpen(true)}
                />
              ) : (
                <Skeleton className="h-14 w-full rounded-xl" />
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
              <div className="mx-auto h-full w-full max-w-3xl lg:mx-0">{renderStepContent()}</div>
            </div>

            <div className="sticky bottom-0 flex-shrink-0 border-t bg-white px-4 py-4 sm:px-6 lg:px-8">
              <div className="mx-auto w-full max-w-3xl lg:mx-0">{renderStepActions()}</div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={timeModalOpen} onOpenChange={(open) => { if (open) setTimeModalOpen(true); }}>
        <DialogContent
          showCloseButton={false}
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          className="flex max-h-[85vh] w-[min(100vw-1.5rem,42rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        >
          <DialogHeader className="border-b border-gray-100 px-5 pb-4 pt-5 text-left">
            <DialogTitle>{t("sheetSelectTimeTitle", "Select time")}</DialogTitle>
            <DialogDescription>
              {selectedDate ? formatDate(selectedDate) : ""} · {t("sheetMaxHoursBadge", { maxHours: maxSlotsPerChef, defaultValue: `Max ${maxSlotsPerChef} hours` })}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {allSlots.map((slot) => {
                const selected = pendingTimeSlots.includes(slot.time);
                return (
                  <button
                    key={slot.time}
                    type="button"
                    disabled={slot.isFullyBooked}
                    onClick={() => updateSlotSelection(setPendingTimeSlots, slot)}
                    className={cn(
                      "flex min-h-[44px] w-full items-center justify-center rounded-xl border px-3 py-2.5 text-center text-xs font-medium transition-colors",
                      selected && "border-[#F51042] bg-[#F51042] text-white",
                      !selected && !slot.isFullyBooked && "border-gray-200 bg-white text-gray-700 hover:border-[#F51042]/40",
                      slot.isFullyBooked && "cursor-not-allowed border-transparent bg-muted/50 text-muted-foreground/50 line-through"
                    )}
                  >
                    {formatSlotRange(slot.time)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t bg-white px-5 py-4">
            <Button variant="ghost" className="rounded-xl" onClick={() => setDiscardModal("time")}>Cancel</Button>
            <p className="text-xs text-muted-foreground">{pendingTimeSlots.length} hour{pendingTimeSlots.length === 1 ? "" : "s"} selected</p>
            <Button
              disabled={pendingTimeSlots.length === 0}
              className={chefPrimaryCtaClass()}
              onClick={() => {
                setSelectedSlots([...pendingTimeSlots].sort());
                setTimeModalOpen(false);
              }}
            >
              <Icon icon="mdi:check" className="mr-2 h-4 w-4" aria-hidden /> Save time
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={equipmentInventoryModal !== null}
        onOpenChange={(open) => {
          if (!open) setEquipmentInventoryModal(null);
        }}
      >
        <DialogContent className="flex max-h-[85vh] w-[min(100vw-1.5rem,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b border-gray-100 px-5 pb-4 pt-5 text-left">
            <DialogTitle>
              {equipmentInventoryModal === "included"
                ? t("sheetIncludedEquipmentTitle", "Included equipment")
                : t("sheetOptionalRentalsLabel", "Optional rentals")}
            </DialogTitle>
            <DialogDescription>
              {equipmentInventoryModal === "included"
                ? t("sheetIncludedEquipmentDesc", "These items come with your kitchen booking at no extra charge.")
                : t("sheetRentalEquipmentDesc", "These items are available to rent for this kitchen session.")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <InventoryPreviewList
              title={equipmentInventoryModal === "included"
                ? t("sheetIncludedLabel", "Included")
                : t("sheetOptionalRentalsLabel", "Optional rentals")}
              subtitle={equipmentInventoryModal === "included"
                ? t("sheetIncludedEquipmentDesc", "Available at no extra charge.")
                : t("sheetRentalEquipmentDesc", "Available to rent for this session.")}
              items={equipmentInventoryModal === "included"
                ? equipmentListings.included
                : equipmentListings.rental}
              rental={equipmentInventoryModal === "rental"}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={equipmentModalOpen}
        onOpenChange={(open) => {
          if (open) {
            setEquipmentModalOpen(true);
            setEquipmentInventoryModal(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          className="flex max-h-[85vh] w-[min(100vw-1.5rem,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        >
          <DialogHeader className="border-b border-gray-100 px-5 pb-4 pt-5 text-left">
            <DialogTitle>{t("sheetSelectEquipment", "Select equipment")}</DialogTitle>
            <DialogDescription>
              {t(
                "sheetSelectEquipmentDesc",
                "Choose any optional rental equipment you need for this session."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <section>
              <div className="mb-3">
                <h4 className="text-sm font-semibold text-gray-900">{t("sheetOptionalRentalsLabel", "Optional rentals")}</h4>
                <p className="text-xs text-muted-foreground">Select as many as you need.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {equipmentListings.rental.map((equipment: any) => {
                  const selected = pendingEquipmentIds.includes(equipment.id);
                  return (
                    <button
                      key={equipment.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setPendingEquipmentIds((current) =>
                        selected
                          ? current.filter((id) => id !== equipment.id)
                          : [...current, equipment.id]
                      )}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border p-3 text-left transition-all",
                        selected
                          ? "border-[#F51042] bg-[#F51042]/[0.04] ring-1 ring-[#F51042]/20"
                          : "border-gray-200 hover:border-[#F51042]/40"
                      )}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF3F5] text-[#F51042]">
                        <Icon icon={resolveEquipmentIcon(equipment.equipmentType, equipment.category)} width={20} height={20} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-gray-900">{equipmentName(equipment)}</span>
                        <span className="block text-xs text-muted-foreground">{formatCurrency(equipment.sessionRate || 0)} per session</span>
                      </span>
                      <span className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                        selected ? "border-[#F51042] bg-[#F51042] text-white" : "border-gray-300"
                      )}>
                        {selected ? <Icon icon="mdi:check" className="h-3 w-3" aria-hidden /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
          <div className="space-y-3 border-t bg-white px-5 py-3">
            <BookingPriceSummary
              kitchenSubtotal={estimatedPrice?.basePrice || 0}
              equipmentSubtotal={pendingEquipmentSubtotal}
              storageSubtotal={storagePricing.subtotal || 0}
              taxRatePercent={selectedKitchen?.taxRatePercent || 0}
              serviceFeeRate={kitchenPricing?.platformCommissionRate ?? 0}
              currency={kitchenPricing?.currency || "CAD"}
              focusAddon="equipment"
            />
            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <Button variant="ghost" className="rounded-xl" onClick={() => setDiscardModal("equipment")}>Cancel</Button>
              <p className="text-xs text-muted-foreground">
                {pendingEquipmentIds.length
                  ? `${pendingEquipmentIds.length} rental${pendingEquipmentIds.length === 1 ? "" : "s"} selected`
                  : t("sheetNoRentalsSelected", "No rentals selected")}
              </p>
              <Button
                className={chefPrimaryCtaClass()}
                onClick={() => {
                  setSelectedEquipmentIds(pendingEquipmentIds);
                  setEquipmentModalOpen(false);
                }}
              >
                <Icon icon="mdi:check" className="mr-2 h-4 w-4" aria-hidden /> {t("sheetSaveSelection", "Save selection")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={storageModalOpen} onOpenChange={(open) => { if (open) setStorageModalOpen(true); }}>
        <DialogContent
          showCloseButton={false}
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          className="flex max-h-[90vh] w-[min(100vw-1.5rem,52rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
        >
          <DialogHeader className="border-b border-gray-100 px-5 pb-4 pt-5 text-left">
            <DialogTitle>{t("sheetSelectStorage", "Select storage")}</DialogTitle>
            <DialogDescription>
              {t("sheetSelectStorageDesc", "Choose storage first, then set one shared date range or different dates for each selection.")}
            </DialogDescription>
          </DialogHeader>
          <BookingStorageSelector
            storageListings={storageListings}
            selectedStorage={selectedStorage}
            onSelectionChange={setSelectedStorage}
            kitchenBookingDate={selectedDate || undefined}
            onDone={() => setStorageModalOpen(false)}
            onCancel={() => setDiscardModal("storage")}
            kitchenSubtotal={estimatedPrice?.basePrice || 0}
            equipmentSubtotal={equipmentPricing.subtotal || 0}
            taxRatePercent={selectedKitchen?.taxRatePercent || 0}
            serviceFeeRate={kitchenPricing?.platformCommissionRate ?? 0}
            currency={kitchenPricing?.currency || "CAD"}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={cancellationPolicyOpen} onOpenChange={setCancellationPolicyOpen}>
        <DialogContent className="w-[min(100vw-1.5rem,34rem)] sm:max-w-lg">
          <DialogHeader className="text-left">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFF3F5] text-[#F51042]">
              <Icon icon="mdi:shield-check-outline" className="h-5 w-5" aria-hidden />
            </div>
            <DialogTitle>{t("sheetCancellationPolicyTitle", "Cancellation policy")}</DialogTitle>
            <DialogDescription className="pt-2 text-sm leading-relaxed text-gray-600">
              {selectedKitchen
                ? cancellationPolicyCopy(selectedKitchen, (key, options) =>
                    String(t(`kitchen:${key}`, options as any))
                  )
                : ""}
            </DialogDescription>
          </DialogHeader>
          <Button className="mt-2 w-full" variant="outline" onClick={() => setCancellationPolicyOpen(false)}>
            {t("sheetClosePolicy", "Got it")}
          </Button>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardModal !== null} onOpenChange={(open) => { if (!open) setDiscardModal(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Nothing from this modal will be added unless you use its save or continue button.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscardModalChanges}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("sheetCancelConfirmTitle", "Cancel this booking?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "sheetCancelConfirmDesc",
                "Your booking progress will be cleared and you’ll start over next time."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("sheetKeepBookingButton", "Keep booking")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancelBooking}>
              {t("sheetConfirmCancelButton", "Yes, cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
