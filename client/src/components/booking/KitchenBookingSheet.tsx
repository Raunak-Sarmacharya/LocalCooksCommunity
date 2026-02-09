import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useKitchenBookings } from "@/hooks/use-kitchen-bookings";
import { useStoragePricing } from "@/hooks/use-storage-pricing";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { StorageSelection } from "./StorageSelection";
import { PendingOverstayPenalties } from "../chef/PendingOverstayPenalties";
import { auth } from "@/lib/firebase";
import { useUnpaidPenaltiesCheck } from "@/hooks/use-unpaid-penalties";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  Building,
  ChevronLeft,
  ChevronRight,
  Check,
  Info,
  Package,
  Wrench,
  ChefHat,
  X,
  DollarSign,
  ArrowRight,
  Loader2,
  CreditCard,
  ArrowLeft,
} from "lucide-react";

interface KitchenBookingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: number;
  locationName: string;
  locationAddress?: string;
}

function EquipmentImage({ imageUrl, alt }: { imageUrl: string; alt: string }) {
  const proxyUrl = getR2ProxyUrl(imageUrl);

  return (
    <div className="flex-shrink-0">
      <img
        src={proxyUrl}
        alt={alt}
        className="w-16 h-16 object-cover rounded-lg border border-border"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
    </div>
  );
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function getCalendarDays(year: number, month: number) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const days: (Date | null)[] = [];

  for (let i = 0; i < firstDay; i++) {
    const prevDate = new Date(year, month, -firstDay + i + 1);
    days.push(prevDate);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(year, month, day));
  }

  const remainingCells = 42 - days.length;
  for (let i = 1; i <= remainingCells; i++) {
    days.push(new Date(year, month + 1, i));
  }

  return days;
}

export default function KitchenBookingSheet({
  open,
  onOpenChange,
  locationId,
  locationName,
  locationAddress,
}: KitchenBookingSheetProps) {
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
  const [currentStep, setCurrentStep] = useState<'kitchen' | 'addons' | 'calendar' | 'slots' | 'confirm'>('kitchen');

  // Payment state
  const [isRedirectingToCheckout, setIsRedirectingToCheckout] = useState(false);
  const [isProcessingBooking, setIsProcessingBooking] = useState(false);
  
  // Penalty check
  const { data: penaltyData, isLoading: isCheckingPenalties } = useUnpaidPenaltiesCheck(open);

  // Calendar state
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
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
  const [showStorageOptions, setShowStorageOptions] = useState(false);
  const [notes, setNotes] = useState<string>("");

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

  const grandTotal = useMemo(() => combinedSubtotal + tax, [combinedSubtotal, tax]);

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  const toLocalDateString = (d: Date) => {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Reset state when sheet opens/closes
  useEffect(() => {
    if (open) {
      // Auto-select if only one kitchen
      if (locationKitchens.length === 1) {
        handleKitchenSelect(locationKitchens[0]);
      } else {
        setCurrentStep('kitchen');
      }
    } else {
      // Reset all state when closing
      setSelectedKitchen(null);
      setSelectedDate(null);
      setSelectedSlots([]);
      setAllSlots([]);
      setSelectedStorage([]);
      setSelectedEquipmentIds([]);
      setShowStorageOptions(false);
      setNotes("");
      setEstimatedPrice(null);
      setKitchenPricing(null);
      setStorageListings([]);
      setEquipmentListings({ all: [], included: [], rental: [] });
      setCurrentStep('kitchen');
      // Reset payment state
      setIsRedirectingToCheckout(false);
      setIsProcessingBooking(false);
    }
  }, [open, locationKitchens]);

  // Load slots when date changes
  useEffect(() => {
    if (selectedKitchen && selectedDate) {
      loadAvailableSlots(selectedKitchen.id, toLocalDateString(selectedDate));
    }
  }, [selectedKitchen, selectedDate]);

  // Load month availability when kitchen selected or month changes
  useEffect(() => {
    if (selectedKitchen && currentStep === 'calendar') {
      loadMonthAvailability(selectedKitchen.id, currentYear, currentMonth);
    }
  }, [selectedKitchen, currentYear, currentMonth, currentStep]);

  const loadMonthAvailability = async (kitchenId: number, year: number, month: number) => {
    setIsLoadingAvailability(true);
    const availability: Record<string, boolean> = {};
    
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

      // Get all days in the month
      const daysInMonth = getDaysInMonth(year, month);
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);

      // Fetch availability for each future date in the month (batch requests)
      const promises: Promise<void>[] = [];
      
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateStr = toLocalDateString(date);
        
        // Skip past dates
        if (date < todayDate) {
          availability[dateStr] = false;
          continue;
        }

        const promise = fetch(`/api/chef/kitchens/${kitchenId}/slots?date=${dateStr}`, {
          credentials: "include",
          headers,
          cache: 'no-store',
        })
          .then(res => res.ok ? res.json() : [])
          .then(slots => {
            availability[dateStr] = Array.isArray(slots) && slots.length > 0;
          })
          .catch(() => {
            availability[dateStr] = false;
          });
        
        promises.push(promise);
      }

      await Promise.all(promises);
      setDateAvailability(availability);
    } catch (error) {
      console.error('Error loading month availability:', error);
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
        throw new Error("Failed to fetch slots");
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
          title: "Kitchen closed",
          description: "This date has no operating hours set.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error loading slots:", error);
      setAllSlots([]);
      toast({
        title: "Error",
        description: "Failed to load time slots. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingSlots(false);
    }
  };

  const fetchKitchenAddons = async (kitchenId: number, authHeader?: string) => {
    setIsLoadingAddons(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      // Fetch storage
      const storageRes = await fetch(`/api/chef/kitchens/${kitchenId}/storage-listings`, {
        credentials: "include",
        headers,
        cache: 'no-store',
      });

      if (storageRes.ok) {
        const storageData = await storageRes.json();
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

      if (equipmentRes.ok) {
        const equipmentData = await equipmentRes.json();
        const normalizeEquipment = (eq: any) => ({
          ...eq,
          sessionRate: eq.sessionRate || 0,
          hourlyRate: eq.hourlyRate || 0,
          dailyRate: eq.dailyRate || 0,
        });

        setEquipmentListings({
          all: [...(equipmentData.included || []), ...(equipmentData.rental || [])].map(normalizeEquipment),
          included: (equipmentData.included || []).map(normalizeEquipment),
          rental: (equipmentData.rental || []).map(normalizeEquipment),
        });
      } else {
        setEquipmentListings({ all: [], included: [], rental: [] });
      }
    } catch (error) {
      console.error('Error fetching kitchen addons:', error);
      setStorageListings([]);
      setEquipmentListings({ all: [], included: [], rental: [] });
    } finally {
      setIsLoadingAddons(false);
    }
  };

  const handleKitchenSelect = async (kitchen: any) => {
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
        });
      } else {
        setKitchenPricing({ hourlyRate: null, currency: 'CAD', minimumBookingHours: 0 });
      }

      // Fetch addons
      await fetchKitchenAddons(kitchen.id, authHeader);
      setCurrentStep('addons');
    } catch (error) {
      console.error('Error fetching kitchen data:', error);
      setKitchenPricing({ hourlyRate: null, currency: 'CAD', minimumBookingHours: 0 });
    }
  };

  const handleDateClick = (date: Date) => {
    if (date < new Date(new Date().setHours(0, 0, 0, 0))) return;
    if (date.getMonth() !== currentMonth) return;
    setSelectedDate(date);
    setSelectedSlots([]);
    // Don't auto-navigate to slots - user clicks Continue button
  };

  const handleSlotClick = (slot: { time: string; available: number; capacity: number; isFullyBooked: boolean }) => {
    if (slot.isFullyBooked) {
      toast({
        title: "Slot Fully Booked",
        description: "This time slot is already at maximum capacity.",
        variant: "destructive",
      });
      return;
    }

    setSelectedSlots(prev => {
      if (prev.includes(slot.time)) {
        return prev.filter(s => s !== slot.time);
      } else if (prev.length < maxSlotsPerChef) {
        return [...prev, slot.time].sort();
      } else {
        toast({
          title: "Limit reached",
          description: `You can select up to ${maxSlotsPerChef} hour slot${maxSlotsPerChef > 1 ? 's' : ''} for this day.`,
          variant: "destructive",
        });
        return prev;
      }
    });
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      if (currentMonth === 0) {
        setCurrentMonth(11);
        setCurrentYear(currentYear - 1);
      } else {
        setCurrentMonth(currentMonth - 1);
      }
    } else {
      if (currentMonth === 11) {
        setCurrentMonth(0);
        setCurrentYear(currentYear + 1);
      } else {
        setCurrentMonth(currentMonth + 1);
      }
    }
    setSelectedDate(null);
    setSelectedSlots([]);
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatSlotRange = (slotStartTime: string) => {
    const [hours, minutes] = slotStartTime.split(':').map(Number);
    const endHour = hours + 1;
    const endTimeStr = `${endHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    return `${formatTime(slotStartTime)} - ${formatTime(endTimeStr)}`;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const calendarDays = selectedKitchen ? getCalendarDays(currentYear, currentMonth) : [];
  const isCurrentMonth = (date: Date) => date.getMonth() === currentMonth;
  const isToday = (date: Date) => date.toDateString() === today.toDateString();
  const isPast = (date: Date) => date < new Date(new Date().setHours(0, 0, 0, 0));

  const hasAddons = equipmentListings.all.length > 0 || storageListings.length > 0;

  // Step configuration
  const steps = [
    { key: 'kitchen', label: 'Kitchen' },
    { key: 'addons', label: 'Add-ons' },
    { key: 'calendar', label: 'Date' },
    { key: 'slots', label: 'Time' },
    { key: 'confirm', label: 'Confirm' },
  ] as const;

  const stepOrder = ['kitchen', 'addons', 'calendar', 'slots', 'confirm'];
  const currentStepIndex = stepOrder.indexOf(currentStep);

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
        title: "Minimum Booking Required",
        description: `This kitchen requires a minimum of ${minHours} hour${minHours > 1 ? 's' : ''} per booking. You have selected ${selectedSlots.length}.`,
        variant: "destructive",
      });
      return;
    }

    // Check for unpaid penalties first
    if (penaltyData?.hasUnpaidPenalties) {
      const totalOwed = (penaltyData.totalOwedCents / 100).toFixed(2);
      toast({
        title: "Booking Blocked - Unpaid Penalties",
        description: `You have ${penaltyData.totalCount} unpaid penalty(ies) totaling $${totalOwed}. Please resolve these before making new bookings.`,
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
        // Close the Sheet BEFORE redirecting to prevent Radix UI from leaving
        // pointer-events: none on document.body (known Radix Dialog cleanup issue)
        onOpenChange(false);
        // Small delay to let Radix clean up body styles before navigation
        await new Promise(resolve => setTimeout(resolve, 100));
        // Belt-and-suspenders: force-clear pointer-events in case Radix didn't clean up
        document.body.style.pointerEvents = '';
        window.location.href = data.sessionUrl;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (error: any) {
      toast({
        title: "Checkout Failed",
        description: error.message || "Failed to start checkout. Please try again.",
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
        title: "Minimum Booking Required",
        description: `This kitchen requires a minimum of ${minHours} hour${minHours > 1 ? 's' : ''} per booking. You have selected ${selectedSlots.length}.`,
        variant: "destructive",
      });
      return;
    }

    // Check for unpaid penalties first
    if (penaltyData?.hasUnpaidPenalties) {
      const totalOwed = (penaltyData.totalOwedCents / 100).toFixed(2);
      toast({
        title: "Booking Blocked - Unpaid Penalties",
        description: `You have ${penaltyData.totalCount} unpaid penalty(ies) totaling $${totalOwed}. Please resolve these before making new bookings.`,
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
        onSuccess: () => {
          toast({
            title: "Booking Created!",
            description: `Your ${selectedSlots.length} hour kitchen booking has been submitted successfully.`,
          });
          setIsProcessingBooking(false);
          onOpenChange(false); // Close the sheet
        },
        onError: (error: any) => {
          toast({
            title: "Booking Failed",
            description: error.message || "Failed to create booking. Please try again.",
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
            <p className="text-sm text-muted-foreground">Loading kitchens...</p>
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
            <p className="text-sm font-medium text-muted-foreground">No kitchens available at this location</p>
          </div>
        </div>
      );
    }

    // Step 1: Kitchen Selection
    if (currentStep === 'kitchen' && locationKitchens.length > 1 && !selectedKitchen) {
      return (
        <div className="flex-1 flex flex-col">
          <div className="mb-4">
            <h3 className="text-base font-medium text-foreground">Select a Kitchen</h3>
            <p className="text-sm text-muted-foreground mt-1">Choose which kitchen space you'd like to book</p>
          </div>
          <div className="space-y-2">
            {locationKitchens.map((kitchen: any) => (
              <button
                key={kitchen.id}
                className="w-full p-4 border border-border rounded-lg text-left hover:border-primary hover:bg-primary/5 transition-all duration-200 group"
                onClick={() => handleKitchenSelect(kitchen)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                      {kitchen.name}
                    </h4>
                    {kitchen.description && (
                      <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{kitchen.description}</p>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    // Step 2: Add-ons
    if (currentStep === 'addons' && selectedKitchen) {
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          {isLoadingAddons ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto pr-1 space-y-5">
              {/* Equipment Section */}
              {equipmentListings.all.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-3">Equipment</h3>
                  
                  {equipmentListings.included.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs font-medium text-green-600 mb-2">Included</p>
                      <div className="flex flex-wrap gap-1.5">
                        {equipmentListings.included.map((eq: any) => (
                          <span key={eq.id} className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-medium">
                            <Check className="h-3 w-3" />
                            {eq.equipmentType}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {equipmentListings.rental.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Optional Rentals</p>
                      <div className="grid grid-cols-2 gap-2">
                        {equipmentListings.rental.map((eq: any) => {
                          const isSelected = selectedEquipmentIds.includes(eq.id);
                          return (
                            <button
                              key={eq.id}
                              type="button"
                              onClick={() => setSelectedEquipmentIds(prev => 
                                isSelected ? prev.filter(id => id !== eq.id) : [...prev, eq.id]
                              )}
                              className={cn(
                                "p-3 border rounded-lg text-left transition-all duration-200",
                                isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                              )}
                            >
                              <div className="flex justify-between items-start">
                                <span className="text-sm font-medium">{eq.equipmentType}</span>
                                <span className="text-sm font-semibold text-primary">{formatCurrency(eq.sessionRate || 0)}</span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">per session</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Storage Section */}
              {storageListings.length > 0 && (
                <div className="pt-4 border-t">
                  {!showStorageOptions ? (
                    <button
                      type="button"
                      onClick={() => setShowStorageOptions(true)}
                      className="w-full p-4 border border-dashed border-border rounded-lg text-left hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                            <Package className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">Need storage space?</p>
                            <p className="text-xs text-muted-foreground">Reserve refrigerator or dry storage for your ingredients</p>
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                    </button>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-foreground">Storage Options</h3>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-6 px-2"
                          onClick={() => {
                            setShowStorageOptions(false);
                            setSelectedStorage([]);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                      <StorageSelection
                        storageListings={storageListings}
                        selectedStorage={selectedStorage}
                        onSelectionChange={setSelectedStorage}
                        kitchenBookingDate={selectedDate || undefined}
                      />
                    </div>
                  )}
                </div>
              )}

              {!hasAddons && (
                <div className="flex-1 flex items-center justify-center text-center py-8">
                  <div>
                    <Package className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No add-ons available for this kitchen</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // Step 3: Calendar - Enterprise-grade responsive design
    if (currentStep === 'calendar' && selectedKitchen) {
      return (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Header with month navigation - compact on mobile */}
          <div className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-foreground">Select Date</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isLoadingAvailability ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading availability...
                  </span>
                ) : 'Tap a green date to continue'}
              </p>
            </div>
            <div className="flex items-center justify-center gap-1 bg-muted/50 rounded-lg p-1 flex-shrink-0">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigateMonth('prev')}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-semibold w-[110px] text-center tabular-nums">{monthNames[currentMonth]} {currentYear}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigateMonth('next')}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Legend - horizontal scrollable on mobile, compact design */}
          <div className="flex-shrink-0 flex items-center gap-3 sm:gap-5 mb-3 overflow-x-auto pb-1 scrollbar-hide">
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className="w-4 h-4 rounded-md bg-gradient-to-br from-emerald-400 to-green-500 shadow-sm shadow-green-500/30" />
              <span className="text-xs font-medium text-foreground">Available</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className="w-4 h-4 rounded-md bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600" />
              <span className="text-xs font-medium text-muted-foreground">Closed</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className="w-4 h-4 rounded-md bg-primary ring-2 ring-primary/30 ring-offset-1" />
              <span className="text-xs font-medium text-foreground">Selected</span>
            </div>
          </div>

          {/* Calendar Grid - responsive and contained */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="bg-gradient-to-b from-muted/40 to-muted/20 rounded-xl p-2 sm:p-3 border border-border/50">
              {/* Day headers - abbreviated on mobile */}
              <div className="grid grid-cols-7 gap-0.5 sm:gap-1 mb-1.5">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
                  <div key={idx} className="text-center text-[10px] sm:text-xs font-bold text-muted-foreground/70 uppercase tracking-wide py-1">
                    <span className="sm:hidden">{day}</span>
                    <span className="hidden sm:inline">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][idx]}</span>
                  </div>
                ))}
              </div>
              
              {/* Calendar days - compact responsive grid */}
              <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
                {calendarDays.map((date, index) => {
                  if (!date) return <div key={index} className="h-8 sm:h-9" />;
                  const isCurrent = isCurrentMonth(date);
                  const isTodayDate = isToday(date);
                  const isPastDate = isPast(date);
                  const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString();
                  const dateStr = date ? toLocalDateString(date) : '';
                  const hasAvailability = dateAvailability[dateStr] === true;
                  const isUnavailable = !isPastDate && isCurrent && dateAvailability[dateStr] === false;
                  const isLoading = !isPastDate && isCurrent && dateAvailability[dateStr] === undefined;

                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => !isPastDate && isCurrent && hasAvailability && handleDateClick(date)}
                      disabled={isPastDate || !isCurrent || isUnavailable || isLoading}
                      className={cn(
                        "h-8 sm:h-9 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-200 flex items-center justify-center relative",
                        // Base hover effect for interactive dates
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                        
                        // Selected state - prominent with ring
                        isSelected && "bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-2 ring-primary/30 ring-offset-1 ring-offset-background scale-105 z-10",
                        
                        // Today indicator (not selected) - with available styling
                        !isSelected && isTodayDate && hasAvailability && "bg-gradient-to-br from-emerald-400 to-green-500 text-white shadow-md shadow-green-500/30 ring-2 ring-green-400/50 ring-offset-1",
                        !isSelected && isTodayDate && !hasAvailability && !isPastDate && "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 ring-1 ring-slate-400",
                        
                        // Available dates - vibrant green gradient with hover
                        !isSelected && !isTodayDate && isCurrent && hasAvailability && "bg-gradient-to-br from-emerald-50 to-green-100 dark:from-emerald-900/40 dark:to-green-800/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 hover:from-emerald-100 hover:to-green-200 dark:hover:from-emerald-800/50 dark:hover:to-green-700/50 hover:shadow-md hover:shadow-green-500/20 hover:scale-[1.02] active:scale-[0.98]",
                        
                        // Unavailable/closed dates - clearly disabled look
                        !isSelected && !isTodayDate && isCurrent && isUnavailable && "bg-slate-100 dark:bg-slate-800/50 text-slate-400 dark:text-slate-600 cursor-not-allowed border border-slate-200/50 dark:border-slate-700/50",
                        
                        // Loading state - subtle pulse animation
                        isLoading && "bg-slate-100 dark:bg-slate-800 text-slate-400 animate-pulse cursor-wait",
                        
                        // Not current month - very faded
                        !isCurrent && "text-slate-300 dark:text-slate-700 cursor-default",
                        
                        // Past dates - strikethrough effect
                        isPastDate && isCurrent && "text-slate-300 dark:text-slate-700 cursor-not-allowed line-through decoration-slate-400/50"
                      )}
                    >
                      {date.getDate()}
                      {/* Today dot indicator */}
                      {isTodayDate && !isSelected && (
                        <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-current opacity-60" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Selected date preview - shows when date is selected */}
          {selectedDate && (
            <div className="flex-shrink-0 mt-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <CalendarIcon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isLoadingSlots ? 'Loading time slots...' : `${allSlots.length} time slot${allSlots.length !== 1 ? 's' : ''} available`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setSelectedDate(null);
                    setSelectedSlots([]);
                  }}
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Step 4: Time Slots
    if (currentStep === 'slots' && selectedKitchen && selectedDate) {
      return (
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-medium text-foreground">Select Time</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {formatDate(selectedDate)} • Max {maxSlotsPerChef} hours
              </p>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-xs"
              onClick={() => {
                setCurrentStep('calendar');
                setSelectedDate(null);
                setSelectedSlots([]);
              }}
            >
              Change date
            </Button>
          </div>
          
          {isLoadingSlots ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : allSlots.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <Clock className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No available hours on this day</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
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
                        "py-3 px-2 border rounded-lg text-center transition-all duration-200",
                        isSelected && "bg-primary text-primary-foreground border-primary shadow-sm",
                        !isSelected && !isFullyBooked && "border-border hover:border-primary hover:bg-primary/5",
                        isFullyBooked && "bg-muted/50 text-muted-foreground/50 cursor-not-allowed border-transparent"
                      )}
                    >
                      <span className={cn("text-sm font-medium", isFullyBooked && "line-through")}>
                        {formatSlotRange(slot.time)}
                      </span>
                      {slot.capacity > 1 && !isFullyBooked && (
                        <span className={cn(
                          "block text-xs mt-0.5",
                          isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                        )}>
                          {slot.available} left
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Step 5: Confirm
    if (currentStep === 'confirm' && selectedKitchen && selectedDate && selectedSlots.length > 0) {
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          <ScrollArea className="flex-1 pr-2">
            <div className="space-y-4">
              {/* Kitchen & Date Summary */}
              <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <ChefHat className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{selectedKitchen.name}</p>
                    <p className="text-xs text-muted-foreground">{locationName}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="p-2 bg-background rounded">
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="text-sm font-medium">{formatDate(selectedDate)}</p>
                  </div>
                  <div className="p-2 bg-background rounded">
                    <p className="text-xs text-muted-foreground">Duration</p>
                    <p className="text-sm font-medium">{selectedSlots.length} hour{selectedSlots.length > 1 ? 's' : ''}</p>
                  </div>
                </div>
              </div>

              {/* Time Slots */}
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Booking Time</p>
                <p className="text-base font-semibold text-green-800">{getBookingTimeRange()}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[...selectedSlots].sort().map((slot, idx) => (
                    <span key={slot} className="px-2 py-0.5 bg-white border border-green-300 rounded text-xs font-medium text-green-800">
                      {formatSlotRange(slot)}
                    </span>
                  ))}
                </div>
              </div>

              {/* Pricing Summary */}
              <div className="p-3 bg-muted/30 border rounded-lg">
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-primary" />
                  Booking Summary
                </h4>
                
                <div className="space-y-2 text-sm">
                  {/* Kitchen Time */}
                  {kitchenPricing?.hourlyRate && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Kitchen ({selectedSlots.length}hr × {formatCurrency(kitchenPricing.hourlyRate)})
                      </span>
                      <span className="font-medium">{formatCurrency(kitchenPricing.hourlyRate * selectedSlots.length)}</span>
                    </div>
                  )}
                  
                  {/* Equipment */}
                  {equipmentPricing.items.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Equipment ({equipmentPricing.items.length} item{equipmentPricing.items.length > 1 ? 's' : ''})
                      </span>
                      <span className="font-medium">{formatCurrency(equipmentPricing.subtotal)}</span>
                    </div>
                  )}
                  
                  {/* Storage */}
                  {storagePricing.items.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Storage ({storagePricing.items.length} reservation{storagePricing.items.length > 1 ? 's' : ''})
                      </span>
                      <span className="font-medium">{formatCurrency(storagePricing.subtotal)}</span>
                    </div>
                  )}
                  
                  {/* Tax */}
                  {tax > 0 && (
                    <div className="flex justify-between pt-2 border-t">
                      <span className="text-muted-foreground">Tax</span>
                      <span className="font-medium">{formatCurrency(tax)}</span>
                    </div>
                  )}
                  
                  {/* Total */}
                  <div className="flex justify-between pt-2 border-t">
                    <span className="font-semibold">Total</span>
                    <span className="text-lg font-bold text-primary">{formatCurrency(grandTotal)} {kitchenPricing?.currency || 'CAD'}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium mb-2">Special Notes (Optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Any special requirements..."
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary resize-none"
                />
              </div>

            </div>
          </ScrollArea>
        </div>
      );
    }

    return null;
  };

  // Running total component - shows current booking value
  // Shows whenever equipment or storage is selected (persists across steps)
  const renderRunningTotal = () => {
    // Show if we have any add-ons selected (equipment/storage) OR time slots
    const hasAddons = selectedEquipmentIds.length > 0 || selectedStorage.length > 0;
    const hasTimeSlots = selectedSlots.length > 0;
    
    // Don't show if nothing selected at all
    if (!selectedKitchen || (!hasAddons && !hasTimeSlots)) return null;

    const items: { label: string; value: number }[] = [];
    
    // Kitchen time
    if (selectedSlots.length > 0 && kitchenPricing?.hourlyRate) {
      items.push({
        label: `${selectedSlots.length} hour${selectedSlots.length > 1 ? 's' : ''} kitchen time`,
        value: kitchenPricing.hourlyRate * selectedSlots.length
      });
    }

    // Equipment
    if (selectedEquipmentIds.length > 0) {
      items.push({
        label: `${selectedEquipmentIds.length} equipment rental${selectedEquipmentIds.length > 1 ? 's' : ''}`,
        value: equipmentPricing.subtotal
      });
    }

    // Storage
    if (selectedStorage.length > 0) {
      items.push({
        label: `${selectedStorage.length} storage reservation${selectedStorage.length > 1 ? 's' : ''}`,
        value: storagePricing.subtotal
      });
    }

    return (
      <div className="border-t pt-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Order Summary</span>
        </div>
        <div className="space-y-1.5">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="font-medium">{formatCurrency(item.value)}</span>
            </div>
          ))}
          {tax > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tax</span>
              <span className="font-medium">{formatCurrency(tax)}</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between pt-2 mt-2 border-t">
          <span className="text-sm font-semibold">Total</span>
          <span className="text-lg font-semibold text-primary">{formatCurrency(grandTotal)} {kitchenPricing?.currency || 'CAD'}</span>
        </div>
      </div>
    );
  };

  // Get action button for current step
  const renderActionButton = () => {
    if (currentStep === 'addons' && selectedKitchen && !isLoadingAddons) {
      return (
        <>
          {renderRunningTotal()}
          <Button className="w-full" onClick={() => setCurrentStep('calendar')}>
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </>
      );
    }

    if (currentStep === 'calendar') {
      // Show running total if add-ons selected, even without date
      const hasAddons = selectedEquipmentIds.length > 0 || selectedStorage.length > 0;
      return (
        <>
          {hasAddons && renderRunningTotal()}
          <Button 
            className="w-full" 
            onClick={() => setCurrentStep('slots')}
            disabled={!selectedDate}
          >
            {selectedDate ? 'Select Time Slots' : 'Select a date to continue'}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </>
      );
    }

    if (currentStep === 'slots') {
      return (
        <>
          {renderRunningTotal()}
          <Button 
            className="w-full" 
            onClick={() => setCurrentStep('confirm')}
            disabled={selectedSlots.length === 0}
          >
            {selectedSlots.length > 0 ? 'Review & Confirm' : 'Select time slots to continue'}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </>
      );
    }

    if (currentStep === 'confirm') {
      return (
        <div className="flex gap-3">
          <Button 
            variant="outline"
            className="flex-1" 
            onClick={() => setCurrentStep('slots')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button 
            className="flex-1" 
            onClick={grandTotal > 0 ? redirectToStripeCheckout : handleFreeBookingSubmit}
            disabled={createBooking.isPending || isRedirectingToCheckout || isProcessingBooking}
          >
            {createBooking.isPending || isRedirectingToCheckout || isProcessingBooking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isRedirectingToCheckout ? 'Redirecting to checkout...' : 'Booking...'}
              </>
            ) : grandTotal > 0 ? (
              <>
                <CreditCard className="mr-2 h-4 w-4" />
                Proceed to Checkout
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Confirm Booking
              </>
            )}
          </Button>
        </div>
      );
    }

    return null;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-2xl lg:max-w-3xl p-0 flex flex-col"
      >
        {/* Header */}
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">{locationName}</h2>
              {locationAddress && (
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                  <MapPin className="h-3 w-3" />
                  {locationAddress}
                </p>
              )}
            </div>
            {selectedKitchen && kitchenPricing?.hourlyRate && (
              <div className="text-right">
                <p className="text-lg font-semibold text-primary">{formatCurrency(kitchenPricing.hourlyRate)}</p>
                <p className="text-xs text-muted-foreground">/hour</p>
              </div>
            )}
          </div>

          {/* Progress Steps */}
          <div className="flex items-center">
            {steps.map((step, idx) => {
              const isCompleted = idx < currentStepIndex;
              const isCurrent = step.key === currentStep;

              return (
                <div key={step.key} className="flex items-center flex-1 last:flex-none">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-200",
                      isCompleted && "bg-primary text-primary-foreground",
                      isCurrent && "bg-primary text-primary-foreground ring-2 ring-primary/20",
                      !isCompleted && !isCurrent && "bg-muted text-muted-foreground"
                    )}>
                      {isCompleted ? <Check className="h-3 w-3" /> : idx + 1}
                    </div>
                    <span className={cn(
                      "text-xs font-medium hidden sm:block",
                      (isCurrent || isCompleted) ? "text-foreground" : "text-muted-foreground"
                    )}>
                      {step.label}
                    </span>
                  </div>
                  {idx < steps.length - 1 && (
                    <div className="flex-1 h-px bg-border mx-2">
                      <div className={cn(
                        "h-full bg-primary transition-all duration-300",
                        isCompleted ? "w-full" : "w-0"
                      )} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Kitchen Pill (shown after selection) */}
        {selectedKitchen && currentStep !== 'kitchen' && (
          <div className="flex-shrink-0 px-6 py-3 border-b bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center">
                  <ChefHat className="h-3.5 w-3.5 text-primary" />
                </div>
                <span className="text-sm font-medium">{selectedKitchen.name}</span>
              </div>
              {locationKitchens.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6 px-2"
                  onClick={() => {
                    setSelectedKitchen(null);
                    setCurrentStep('kitchen');
                    setSelectedDate(null);
                    setSelectedSlots([]);
                  }}
                >
                  Change
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-h-0 px-6 py-5">
          {renderStepContent()}
        </div>

        {/* Footer Action */}
        {renderActionButton() && (
          <div className="flex-shrink-0 px-6 py-4 border-t bg-background">
            {renderActionButton()}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
