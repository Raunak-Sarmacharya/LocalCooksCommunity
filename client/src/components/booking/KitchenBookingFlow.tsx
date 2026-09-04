import { logger } from "@/lib/logger";
import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { useKitchenBookings } from "@/hooks/use-kitchen-bookings";
import { useStoragePricing } from "@/hooks/use-storage-pricing";
import { formatCurrency, formatHourSlotRange } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { StorageSelection } from "./StorageSelection";
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
import {
  MapPin,
  Building,
  Check,
  ChefHat,
  DollarSign,
  ArrowRight,
  Loader2,
  CreditCard,
  ArrowLeft,
  Calendar as CalendarIcon,
  Clock,
  Pencil,
  ChevronRight,
} from "lucide-react";
import { findPersistedBookingForKitchens, notifyBookingPrefsChanged } from "@/lib/persisted-booking-prefs";
import { resolveEquipmentIcon } from "@/lib/kitchen-inventory-icons";
import { Icon } from "@iconify/react";
import { tt } from "@/i18n/common-ns";
import { bt } from "@/i18n/booking-ns";

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

const INCLUDED_EQUIPMENT_PREVIEW = 4;

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
  day: "mx-auto flex h-8 w-8 max-w-[32px] items-center justify-center rounded-full p-0 text-xs font-normal text-gray-900 transition-colors hover:bg-gray-100 aria-selected:opacity-100",
  day_disabled:
    "pointer-events-none text-gray-300 opacity-40 line-through decoration-gray-300/80",
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
  const [includedEquipmentModalOpen, setIncludedEquipmentModalOpen] = useState(false);
  const [confirmDatePopoverOpen, setConfirmDatePopoverOpen] = useState(false);

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

  // Load month availability for the date step and the confirm-step date popover
  useEffect(() => {
    if (!selectedKitchen) return;
    if (currentStep === "calendar" || confirmDatePopoverOpen) {
      loadMonthAvailability(selectedKitchen.id, currentYear, currentMonth);
    }
  }, [selectedKitchen, currentYear, currentMonth, currentStep, confirmDatePopoverOpen]);

  const loadMonthAvailability = async (kitchenId: number, year: number, month: number) => {
    setIsLoadingAvailability(true);
    // Clear previous month's data so the loader UI shows immediately
    // and we never display stale dates from another month
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

      // Single bulk request — replaces the legacy 30 per-day fetches that
      // caused the calendar to glitch as each request resolved at a different time
      const response = await fetch(
        `/api/chef/kitchens/${kitchenId}/month-availability?year=${year}&month=${month}`,
        {
          credentials: "include",
          headers,
          cache: 'no-store',
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to load month availability (status ${response.status})`);
      }

      const serverAvailability: Record<string, boolean> = await response.json();

      // Mask out past dates client-side (server returns schedule-based availability
      // regardless of date, but past dates should never be selectable)
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      const daysInMonth = getDaysInMonth(year, month);
      const availability: Record<string, boolean> = {};

      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateStr = toLocalDateString(date);
        if (date < todayDate) {
          availability[dateStr] = false;
        } else {
          availability[dateStr] = serverAvailability[dateStr] === true;
        }
      }

      setDateAvailability(availability);
    } catch (error) {
      logger.error('Error loading month availability:', error);
      // Keep dateAvailability empty so the loader UI still hides on failure
      // but the calendar grid renders gracefully (all dates will appear closed)
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

  const handleSlotClick = (slot: { time: string; available: number; capacity: number; isFullyBooked: boolean }) => {
    if (slot.isFullyBooked) {
      toast({
        title: t("toastSlotFullyBookedTitle", "Slot Fully Booked"),
        description: t("toastSlotFullyBookedDesc", "This time slot is already at maximum capacity."),
        variant: "destructive",
      });
      return;
    }

    const minHours = kitchenPricing?.minimumBookingHours ?? 0;

    setSelectedSlots(prev => {
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
            <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-3" />
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
              <Building className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">{t("sheetNoKitchensAtLocation", "No kitchens available at this location")}</p>
          </div>
        </div>
      );
    }

    // Waiting for kitchen auto-select
    if (!selectedKitchen) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-3" />
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
                <CalendarIcon className="h-4 w-4 text-[#F51042]" />
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

          <div className="relative mx-auto w-full max-w-[300px] rounded-xl border border-gray-100 bg-gray-50/40 p-1">
            {isLoadingAvailability && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/60">
                <Loader2 className="h-5 w-5 animate-spin text-[#F51042]" />
              </div>
            )}
            <UICalendar
              mode="single"
              selected={selectedDate ?? undefined}
              onSelect={handleDateClick}
              month={calendarMonth}
              onMonthChange={(month) => {
                setCalendarMonth(new Date(month.getFullYear(), month.getMonth(), 1));
              }}
              disabled={(date) => !isDayAvailable(date)}
              className="w-full bg-transparent p-1"
              classNames={BOOKING_CALENDAR_CLASS_NAMES}
            />
          </div>

          {selectedDate && (
            <div className="mx-auto w-full max-w-[300px] rounded-xl border border-[#F51042]/20 bg-[#F51042]/5 px-3 py-2.5">
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
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#F51042]" />
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
              className="grid grid-cols-2 sm:grid-cols-3 gap-2"
              role="status"
              aria-label={t("sheetLoadingSlotsAria", "Loading available time slots")}
            >
              {Array.from({ length: 9 }).map((_, idx) => (
                <Skeleton key={idx} className="h-10 rounded-lg bg-muted/70" />
              ))}
            </div>
          ) : allSlots.length === 0 ? (
            <div className="rounded-xl border border-dashed py-10 text-center">
              <Clock className="h-7 w-7 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t("sheetNoAvailableHours", "No available hours on this day")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {kitchenPricing?.minimumBookingHours && kitchenPricing.minimumBookingHours > 1 && selectedSlots.length === 0 && (
                <div className="rounded-lg border bg-muted/30 px-3 py-2 flex items-start gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong>{t("sheetMinBookingNoticeBold", { minHours: kitchenPricing.minimumBookingHours, defaultValue: `Minimum ${kitchenPricing.minimumBookingHours}-hour booking.` })}</strong>{" "}
                    {t("sheetMinBookingNoticeDetail", { minHours: kitchenPricing.minimumBookingHours, defaultValue: `Selecting a time slot will automatically reserve ${kitchenPricing.minimumBookingHours} consecutive hours.` })}
                  </p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
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
                        "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                        isSelected && "bg-[#F51042] text-white border-[#F51042]",
                        !isSelected && !isFullyBooked && "bg-white text-gray-700 border-gray-200 hover:border-[#F51042]/40",
                        isFullyBooked && "bg-muted/50 text-muted-foreground/50 cursor-not-allowed border-transparent line-through"
                      )}
                    >
                      {formatSlotRange(slot.time)}
                      {slot.capacity > 1 && !isFullyBooked ? (
                        <span className={cn("ml-1.5", isSelected ? "text-white/80" : "text-muted-foreground")}>
                          · {t("sheetSlotsLeft", { count: slot.available, defaultValue: `${slot.available} left` })}
                        </span>
                      ) : null}
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
      const includedPreview = equipmentListings.included.slice(0, INCLUDED_EQUIPMENT_PREVIEW);
      const includedHasMore = equipmentListings.included.length > INCLUDED_EQUIPMENT_PREVIEW;

      return (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {t("sheetEquipmentTitle", "Equipment")}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {t("sheetStepEquipmentSubtext", "Add included or rental gear")}
            </p>
          </div>

          {isLoadingAddons ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-[#F51042]" />
            </div>
          ) : (
            <div className="space-y-4">
              {equipmentListings.included.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">{t("sheetIncludedLabel", "Included")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {includedPreview.map((eq: any) => (
                      <span
                        key={eq.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border bg-white text-xs font-medium text-gray-700"
                      >
                        <Check className="h-3 w-3 text-[#F51042]" />
                        {eq.equipmentType}
                      </span>
                    ))}
                  </div>
                  {includedHasMore && (
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center text-sm font-medium text-[#F51042] hover:text-[#d10e39]"
                      onClick={() => setIncludedEquipmentModalOpen(true)}
                    >
                      {t("sheetShowAllIncluded", {
                        count: equipmentListings.included.length,
                        defaultValue: `Show all ${equipmentListings.included.length} included`,
                      })}
                      <ChevronRight className="ml-0.5 h-4 w-4" />
                    </button>
                  )}
                </div>
              )}

              {equipmentListings.rental.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">{t("sheetOptionalRentalsLabel", "Optional Rentals")}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {equipmentListings.rental.map((eq: any) => {
                      const isSelected = selectedEquipmentIds.includes(eq.id);
                      return (
                        <button
                          key={eq.id}
                          type="button"
                          onClick={() => setSelectedEquipmentIds((prev) =>
                            isSelected ? prev.filter((id) => id !== eq.id) : [...prev, eq.id]
                          )}
                          className={cn(
                            "p-3 border rounded-xl text-left transition-colors",
                            isSelected
                              ? "border-[#F51042] bg-[#F51042]/5 ring-1 ring-[#F51042]/30"
                              : "border-gray-200 bg-white hover:border-[#F51042]/40"
                          )}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <span className="text-sm font-medium text-gray-900">{eq.equipmentType}</span>
                            <span className="text-sm font-semibold text-[#F51042] shrink-0">{formatCurrency(eq.sessionRate || 0)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{t("sheetPerSession", "per session")}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : equipmentListings.included.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("sheetNoOptionalRentals", "No optional rentals for this kitchen. Included equipment is listed above.")}
                </p>
              ) : null}
            </div>
          )}
        </div>
      );
    }

    // Step: Storage
    if (currentStep === "storage" && selectedKitchen) {
      return (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {t("sheetStorageOptionsTitle", "Storage Options")}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {t("sheetNeedStorageDesc", "Reserve refrigerator or dry storage for your ingredients")}
            </p>
          </div>

          {isLoadingAddons ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-[#F51042]" />
            </div>
          ) : (
            <StorageSelection
              storageListings={storageListings}
              selectedStorage={selectedStorage}
              onSelectionChange={setSelectedStorage}
              kitchenBookingDate={selectedDate || undefined}
            />
          )}
        </div>
      );
    }

    // Step: Confirm — summary + notes (price lives in sticky left rail)
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

          <div className="rounded-xl border border-[#F51042]/20 bg-[#F51042]/5 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white/80 flex items-center justify-center border border-[#F51042]/15">
                <ChefHat className="h-4 w-4 text-[#F51042]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{selectedKitchen.name}</p>
                <p className="text-xs text-muted-foreground truncate">{locationName}</p>
              </div>
            </div>

            <div className="rounded-lg bg-white/80 border border-white px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">{t("sheetDateLabel", "Date")}</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(selectedDate)}</p>
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
                      <Pencil className="h-3 w-3" />
                      {t("sheetEdit", "Edit")}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end" sideOffset={8}>
                    <div className="relative w-[300px] p-2">
                      {isLoadingAvailability && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-white/60">
                          <Loader2 className="h-5 w-5 animate-spin text-[#F51042]" />
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
            </div>

            <div className="rounded-lg bg-white/80 border border-white px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">{t("sheetBookingTimeLabel", "Booking Time")}</p>
                  <p className="text-sm font-semibold text-gray-900">{getBookingTimeRange()}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("sheetHoursCount", {
                      count: selectedSlots.length,
                      defaultValue: `${selectedSlots.length} hour${selectedSlots.length > 1 ? "s" : ""}`,
                    })}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {[...selectedSlots].sort().map((slot) => (
                      <span key={slot} className="px-2 py-0.5 rounded-md bg-white border text-[11px] font-medium text-gray-600">
                        {formatSlotRange(slot)}
                      </span>
                    ))}
                  </div>
                </div>
                <button type="button" className={editLinkClass} onClick={() => setCurrentStep("slots")}>
                  <Pencil className="h-3 w-3" />
                  {t("sheetEdit", "Edit")}
                </button>
              </div>
            </div>
          </div>

          {(hasEquipment || hasStorage) && (
            <div className="rounded-xl border divide-y">
              {hasEquipment && (
                <div className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{t("sheetEquipmentTitle", "Equipment")}</p>
                    <p className="text-muted-foreground mt-0.5">
                      {selectedEquipmentIds.length > 0
                        ? t("sheetEquipmentLineLabel", {
                            count: selectedEquipmentIds.length,
                            defaultValue: `Equipment (${selectedEquipmentIds.length})`,
                          })
                        : t("sheetNoRentalsSelected", "No rentals selected")}
                      {selectedEquipmentIds.length > 0 && (
                        <span className="ml-2 font-medium text-gray-900">
                          {formatCurrency(equipmentPricing.subtotal)}
                        </span>
                      )}
                    </p>
                  </div>
                  <button type="button" className={editLinkClass} onClick={() => setCurrentStep("equipment")}>
                    <Pencil className="h-3 w-3" />
                    {t("sheetEdit", "Edit")}
                  </button>
                </div>
              )}
              {hasStorage && (
                <div className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{t("sheetStepStorage", "Storage")}</p>
                    <p className="text-muted-foreground mt-0.5">
                      {selectedStorage.length > 0
                        ? t("sheetStorageLineLabel", {
                            count: selectedStorage.length,
                            defaultValue: `Storage (${selectedStorage.length})`,
                          })
                        : t("sheetNoStorageSelected", "No storage selected")}
                      {selectedStorage.length > 0 && (
                        <span className="ml-2 font-medium text-gray-900">
                          {formatCurrency(storagePricing.subtotal)}
                        </span>
                      )}
                    </p>
                  </div>
                  <button type="button" className={editLinkClass} onClick={() => setCurrentStep("storage")}>
                    <Pencil className="h-3 w-3" />
                    {t("sheetEdit", "Edit")}
                  </button>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-2">{t("sheetSpecialNotesLabel", "Special Notes (Optional)")}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t("sheetSpecialNotesPlaceholder", "Any special requirements...")}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#F51042]/30 focus:border-[#F51042] resize-none bg-white"
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
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="h-4 w-4 text-[#F51042]" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sheetOrderSummaryLabel", "Order Summary")}
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
          <div className="space-y-2">
            {selectedSlots.length > 0 && kitchenPricing?.hourlyRate && estimatedPrice && (
              <div className="flex justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  {t("sheetKitchenTimeItem", {
                    count: estimatedPrice.durationHours,
                    defaultValue: `${estimatedPrice.durationHours} hour${estimatedPrice.durationHours > 1 ? "s" : ""} kitchen time`,
                  })}
                </span>
                <span className="font-medium shrink-0">{formatCurrency(estimatedPrice.basePrice)}</span>
              </div>
            )}
            {selectedEquipmentIds.length > 0 && (
              <div className="flex justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  {t("sheetEquipmentRentalsItem", {
                    count: selectedEquipmentIds.length,
                    defaultValue: `${selectedEquipmentIds.length} equipment`,
                  })}
                </span>
                <span className="font-medium shrink-0">{formatCurrency(equipmentPricing.subtotal)}</span>
              </div>
            )}
            {selectedStorage.length > 0 && (
              <div className="flex justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  {t("sheetStorageReservationsItem", {
                    count: selectedStorage.length,
                    defaultValue: `${selectedStorage.length} storage`,
                  })}
                </span>
                <span className="font-medium shrink-0">{formatCurrency(storagePricing.subtotal)}</span>
              </div>
            )}
            {tax > 0 && (
              <div className="flex justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{t("sheetTaxLabel", "Tax")}</span>
                <span className="font-medium shrink-0">{formatCurrency(tax)}</span>
              </div>
            )}
            {serviceFee > 0 && (
              <div className="flex justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  {t("sheetServiceFeeLabel", {
                    percent: Math.round((kitchenPricing?.platformCommissionRate ?? 0) * 100),
                    defaultValue: "Service Fee ({{percent}}%)",
                  })}
                </span>
                <span className="font-medium shrink-0">{formatCurrency(serviceFee)}</span>
              </div>
            )}
            <div className="flex justify-between items-baseline gap-3 pt-3 mt-1 border-t">
              <span className="text-sm font-semibold">{t("sheetTotalLabel", "Total")}</span>
              <span className="text-xl font-semibold text-[#F51042]">
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
      className="min-h-[44px] flex-1"
      onClick={goToPreviousStep}
      disabled={isRedirectingToCheckout || isProcessingBooking || createBooking.isPending}
    >
      <ArrowLeft className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2" />
      {t("sheetPreviousButton", "Previous")}
    </Button>
  ) : null;

  const cancelButton = (
    <Button
      type="button"
      variant="ghost"
      className="min-h-[44px] shrink-0"
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
    if (currentStep === "confirm") {
      return (
        <div className="space-y-3">
          <div className="lg:hidden">{renderPriceBreakdown("mobile")}</div>
          <div className="flex gap-3">
            {cancelButton}
            {previousButton}
            <Button
              className="flex-1 min-h-[44px] bg-[#F51042] hover:bg-[#D40E38] text-white"
              onClick={grandTotal > 0 ? redirectToStripeCheckout : handleFreeBookingSubmit}
              disabled={createBooking.isPending || isRedirectingToCheckout || isProcessingBooking}
            >
              {createBooking.isPending || isRedirectingToCheckout || isProcessingBooking ? (
                <>
                  <Loader2 className="mr-1.5 sm:mr-2 h-4 w-4 animate-spin flex-shrink-0" />
                  <span className="truncate">{isRedirectingToCheckout ? t("sheetRedirectingButton", "Redirecting...") : t("sheetBookingEllipsisButton", "Booking...")}</span>
                </>
              ) : grandTotal > 0 ? (
                <>
                  <CreditCard className="mr-1.5 sm:mr-2 h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{t("sheetCheckoutButton", "Checkout")}</span>
                </>
              ) : (
                <>
                  <Check className="mr-1.5 sm:mr-2 h-4 w-4 flex-shrink-0" />
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
              className="min-h-[44px] flex-1 bg-[#F51042] hover:bg-[#D40E38] text-white"
              onClick={goToNextStep}
              disabled={continueDisabled}
            >
              {continueButtonLabel()}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </>
      );
    }

    return <div className="flex gap-3">{cancelButton}</div>;
  };

  const currentStepMeta = steps[currentStepIndex];

  return (
    <>
      <div className="flex flex-col lg:flex-row gap-0 lg:gap-8 lg:items-start">
        {/* Left rail: steps + sticky price (desktop) */}
        <aside className="hidden lg:flex w-[300px] shrink-0 flex-col sticky top-4 self-start max-h-[calc(100vh-6rem)]">
          <div className="mb-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
              {t("title", "Book a kitchen")}
            </p>
            <h1 className="text-xl font-semibold leading-tight text-gray-900">{locationName}</h1>
            {selectedKitchen ? (
              <div className="flex items-center gap-1.5 mt-1.5">
                <ChefHat className="h-3.5 w-3.5 text-[#F51042] shrink-0" />
                <span className="text-sm text-muted-foreground">{selectedKitchen.name}</span>
              </div>
            ) : locationAddress ? (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {locationAddress}
              </p>
            ) : null}
          </div>

          <nav aria-label={t("sheetBookingStepsAria", "Booking steps")} className="space-y-1 mb-6">
            {steps.map((step, idx) => {
              const isCompleted = idx < currentStepIndex;
              const isCurrent = step.key === currentStep;
              return (
                <div
                  key={step.key}
                  className={cn(
                    "flex gap-3 rounded-xl px-3 py-2.5 transition-colors",
                    isCurrent && "bg-white shadow-sm border border-gray-200",
                    !isCurrent && !isCompleted && "opacity-55"
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0",
                      (isCompleted || isCurrent) && "bg-[#F51042] text-white",
                      !isCompleted && !isCurrent && "bg-muted text-muted-foreground"
                    )}
                  >
                    {isCompleted ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                  </div>
                  <div className="min-w-0">
                    <p className={cn("text-sm font-medium", isCurrent ? "text-gray-900" : "text-gray-700")}>
                      {step.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{step.subtext}</p>
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="mt-auto pt-2">{renderPriceBreakdown("rail")}</div>
        </aside>

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0 rounded-2xl border bg-white shadow-sm overflow-hidden">
          {/* Mobile step header */}
          <div className="lg:hidden flex-shrink-0 border-b px-4 py-4 bg-gray-50/50">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h1 className="text-base font-semibold truncate text-gray-900">{locationName}</h1>
                {selectedKitchen && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{selectedKitchen.name}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 mb-2">
              {steps.map((step, idx) => (
                <div
                  key={step.key}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors",
                    idx <= currentStepIndex ? "bg-[#F51042]" : "bg-muted"
                  )}
                />
              ))}
            </div>
            {currentStepMeta && (
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {t("sheetStepOf", {
                    current: currentStepIndex + 1,
                    total: steps.length,
                    label: currentStepMeta.label,
                    defaultValue: `Step ${currentStepIndex + 1} of ${steps.length}: ${currentStepMeta.label}`,
                  })}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{currentStepMeta.subtext}</p>
              </div>
            )}
          </div>

          {/* Step content — no nested page scroll; step fits naturally */}
          <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
            <div className="w-full max-w-3xl mx-auto lg:mx-0">
              {renderStepContent()}
            </div>
          </div>

          <div className="flex-shrink-0 border-t bg-white px-4 sm:px-6 lg:px-8 py-4 sticky bottom-0">
            <div className="w-full max-w-3xl mx-auto lg:mx-0">
              {renderStepActions()}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={includedEquipmentModalOpen} onOpenChange={setIncludedEquipmentModalOpen}>
        <DialogContent className="flex max-h-[85vh] w-[min(100vw-1.5rem,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b border-gray-100 px-5 pb-4 pt-5 text-left">
            <DialogTitle>{t("sheetIncludedEquipmentTitle", "Included equipment")}</DialogTitle>
            <DialogDescription>
              {t(
                "sheetIncludedEquipmentDesc",
                "These items come with your kitchen booking at no extra charge."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <ul className="grid min-w-0 grid-cols-1 sm:grid-cols-2 sm:gap-x-6">
              {equipmentListings.included.map((eq: any) => {
                const name = String(eq.equipmentType || "")
                  .toLowerCase()
                  .replace(/[_-]+/g, " ")
                  .replace(/\b\w/g, (char: string) => char.toUpperCase())
                  .trim();
                const hint = [eq.brand, eq.model].filter(Boolean).join(" ");
                const showHint =
                  Boolean(hint) && !name.toLowerCase().includes(hint.toLowerCase());
                return (
                  <li key={eq.id} className="flex min-w-0 items-center gap-2.5 py-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FFF8F5] text-[#F51042]">
                      <Icon
                        icon={resolveEquipmentIcon(eq.equipmentType, eq.category)}
                        width={16}
                        height={16}
                        className="text-[#F51042]"
                        aria-hidden
                      />
                    </span>
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-sm text-gray-900">{name}</span>
                      {showHint ? (
                        <span className="hidden truncate text-xs text-gray-400 sm:inline">{hint}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </DialogContent>
      </Dialog>

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
