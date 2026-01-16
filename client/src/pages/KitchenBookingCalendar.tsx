import { Calendar as CalendarIcon, Clock, MapPin, X, AlertCircle, Building, ChevronLeft, ChevronRight, Check, Info, Package, Wrench, DollarSign, ChefHat, Lock, FileText } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useKitchenBookings } from "../hooks/use-kitchen-bookings";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { useToast } from "@/hooks/use-toast";
import BookingControlPanel from "@/components/booking/BookingControlPanel";
import { StorageSelection } from "@/components/booking/StorageSelection";
import { useStoragePricing } from "@/hooks/use-storage-pricing";
import { useLocation } from "wouter";
import { useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import { usePresignedImageUrl } from "@/hooks/use-presigned-image-url";
import { useQuery } from "@tanstack/react-query";

// Component for equipment image with presigned URL
function EquipmentImage({ imageUrl, alt }: { imageUrl: string; alt: string }) {
  const presignedUrl = usePresignedImageUrl(imageUrl);
  
  return (
    <div className="flex-shrink-0">
      <img
        src={presignedUrl || imageUrl}
        alt={alt}
        className="w-20 h-20 object-cover rounded-lg border border-gray-200"
        onError={(e) => {
          console.error('Equipment image failed to load:', imageUrl);
          e.currentTarget.style.display = 'none';
        }}
      />
    </div>
  );
}

// Helper functions for calendar
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
  
  // Add empty cells for days before month starts
  for (let i = 0; i < firstDay; i++) {
    const prevDate = new Date(year, month, -firstDay + i + 1);
    days.push(prevDate);
  }
  
  // Add all days in current month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(year, month, day));
  }
  
  // Add empty cells for days after month ends
  const remainingCells = 42 - days.length; // 6 rows * 7 days
  for (let i = 1; i <= remainingCells; i++) {
    days.push(new Date(year, month + 1, i));
  }
  
  return days;
}

export default function KitchenBookingCalendar() {
  const { kitchens, bookings, isLoadingKitchens, isLoadingBookings, getAvailableSlots, createBooking, cancelBooking, kitchensQuery } = useKitchenBookings();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  // Filter kitchens by location if location parameter is provided
  // Reads location from URL query parameter fresh on each computation
  const urlParams = new URLSearchParams(window.location.search);
  const locationParam = urlParams.get('location');
  const locationFilterId = locationParam ? parseInt(locationParam) : null;
  
  const filteredKitchens = useMemo(() => {
    if (!locationFilterId) {
      // No filter - return all kitchens (existing behavior)
      return kitchens;
    }
    
    // Filter kitchens to only show those matching the location ID
    return kitchens.filter((kitchen: any) => {
      const kitchenLocationId = kitchen.location?.id || kitchen.locationId || kitchen.location_id;
      return kitchenLocationId === locationFilterId;
    });
  }, [kitchens, locationFilterId]); // Re-compute when kitchens or location filter changes
  
  // Memoize enriched bookings to prevent infinite re-renders
  // Only recalculate when bookings or kitchens data actually changes
  const enrichedBookings = useMemo(() => {
    // Early return for invalid data - always return an array to maintain reference stability
    if (!bookings || !Array.isArray(bookings)) return [];
    if (bookings.length === 0) return [];
    
    // If kitchens not loaded yet, return bookings with location data if available
    if (!kitchens || !Array.isArray(kitchens)) {
      return bookings.map((b: any) => ({
        ...b,
        // Preserve location data if it came from backend join
        location: b.location ? {
          id: b.location.id,
          name: b.location.name,
          cancellationPolicyHours: b.location.cancellationPolicyHours,
          cancellationPolicyMessage: b.location.cancellationPolicyMessage,
        } : undefined,
      }));
    }
    
    // Enrich with kitchen information while preserving location data
    return bookings.map((booking: any) => {
      if (!booking || typeof booking.kitchenId !== 'number') {
        return {
          ...booking,
          location: booking.location ? {
            id: booking.location.id,
            name: booking.location.name,
            cancellationPolicyHours: booking.location.cancellationPolicyHours,
            cancellationPolicyMessage: booking.location.cancellationPolicyMessage,
          } : undefined,
        };
      }
      
      const kitchen = kitchens.find((k) => k && k.id === booking.kitchenId) as any;
      return {
        ...booking,
        kitchenName: kitchen?.name,
        locationName: kitchen?.locationName || kitchen?.location?.name,
        // Preserve location data from backend if available, otherwise use from kitchen
        location: booking.location ? {
          id: booking.location.id,
          name: booking.location.name,
          cancellationPolicyHours: booking.location.cancellationPolicyHours,
          cancellationPolicyMessage: booking.location.cancellationPolicyMessage,
        } : (kitchen?.location ? {
          id: kitchen.location.id,
          name: kitchen.location.name,
          cancellationPolicyHours: kitchen.location.cancellationPolicyHours,
          cancellationPolicyMessage: kitchen.location.cancellationPolicyMessage,
        } : undefined),
      };
    });
  }, [bookings, kitchens]);
  
  // Memoize kitchens array for BookingControlPanel
  // Return stable empty array if not loaded
  const kitchensForPanel = useMemo(() => {
    if (!kitchens || !Array.isArray(kitchens)) return [];
    if (kitchens.length === 0) return [];
    
    return kitchens
      .map((k) => {
        if (!k) return null;
        const kitchen = k as any;
        return {
          id: kitchen.id,
          name: kitchen.name,
          locationName: kitchen.locationName || kitchen.location?.name,
        } as { id: number; name: string; locationName?: string };
      })
      .filter((k): k is { id: number; name: string; locationName?: string } => k !== null);
  }, [kitchens]);
  
  // Memoize cancel handler to prevent re-renders
  const handleCancelBooking = useCallback((bookingId: number) => {
    if (window.confirm("Are you sure you want to cancel this booking?")) {
      cancelBooking.mutate(bookingId, {
        onSuccess: () => {
          toast({
            title: "Booking Cancelled",
            description: "Your booking has been cancelled successfully.",
          });
        },
        onError: (error: any) => {
          toast({
            title: "Cancellation Failed",
            description: error.message || "Failed to cancel booking. Please try again.",
            variant: "destructive",
          });
        },
      });
    }
  }, [cancelBooking, toast]);
  
  // Step 1: Kitchen Selection
  const [selectedKitchen, setSelectedKitchen] = useState<any | null>(null);
  
  // Get location ID from selected kitchen
  const selectedLocationId = selectedKitchen?.location?.id || selectedKitchen?.locationId || null;
  
  // Check kitchen application status for the selected location
  const { application, hasApplication, canBook, isLoading: isLoadingApplication } = useChefKitchenApplicationForLocation(selectedLocationId);
  
  // Step 2: Date Selection (Calendar View)
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  
  // Step 3: Time Slot Selection (Multi-select, dynamic max per policy)
  const [allSlots, setAllSlots] = useState<Array<{
    time: string;
    available: number;
    capacity: number;
    isFullyBooked: boolean;
  }>>([]);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [maxSlotsPerChef, setMaxSlotsPerChef] = useState<number>(2);
  
  // Step 4: Booking Details
  const [notes, setNotes] = useState<string>("");
  
  // Pricing state
  const [kitchenPricing, setKitchenPricing] = useState<{
    hourlyRate: number | null;
    currency: string;
    minimumBookingHours: number;
  } | null>(null);
  const [estimatedPrice, setEstimatedPrice] = useState<{
    basePrice: number;
    serviceFee: number;
    totalPrice: number;
    durationHours: number;
  } | null>(null);
  
  // Storage and Equipment listings state
  const [storageListings, setStorageListings] = useState<any[]>([]);
  const [equipmentListings, setEquipmentListings] = useState<{
    all: any[];
    included: any[];
    rental: any[];
  }>({ all: [], included: [], rental: [] });
  const [isLoadingAddons, setIsLoadingAddons] = useState(false);
  
  // Selected add-ons for the booking
  const [selectedStorageIds, setSelectedStorageIds] = useState<number[]>([]); // Legacy - will be removed
  const [selectedStorage, setSelectedStorage] = useState<Array<{
    storageListingId: number;
    startDate: Date;
    endDate: Date;
  }>>([]);
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState<number[]>([]);
  
  // Calculate storage pricing
  const storagePricing = useStoragePricing(selectedStorage, storageListings);

  // Fetch service fee rate (public endpoint - no auth required)
  const { data: serviceFeeRateData } = useQuery({
    queryKey: ['/api/platform-settings/service-fee-rate'],
    queryFn: async () => {
      try {
        const response = await fetch('/api/platform-settings/service-fee-rate');
        if (response.ok) {
          return response.json();
        }
      } catch (error) {
        console.error('Error fetching service fee rate:', error);
      }
      // Default to 5% if unable to fetch
      return { rate: 0.05, percentage: '5.00' };
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const serviceFeeRate = serviceFeeRateData?.rate ?? 0.05; // Default to 5% if not available
  const flatFeeCents = 30;

  // Calculate equipment pricing (base prices only, no service fees)
  const equipmentPricing = useMemo(() => {
    if (!selectedEquipmentIds.length || !equipmentListings.rental.length) {
      return {
        items: [],
        subtotal: 0,
      };
    }

    const items = selectedEquipmentIds
      .map((eqId) => {
        const eq = equipmentListings.rental.find((e: any) => e.id === eqId);
        if (!eq) return null;
        
        // Use sessionRate (flat per-session fee) - API already returns in dollars
        const rate = eq.sessionRate || 0;

        return {
          id: eq.id,
          name: `${eq.equipmentType}${eq.brand ? ` (${eq.brand})` : ''}`,
          rate,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const subtotal = items.reduce((sum, item) => sum + item.rate, 0);

    return {
      items,
      subtotal,
    };
  }, [selectedEquipmentIds, equipmentListings.rental]);

  // Calculate combined subtotal (kitchen base + storage base + equipment base)
  const combinedSubtotal = useMemo(() => {
    const kitchenBase = estimatedPrice?.basePrice || 0;
    const storageBase = storagePricing.subtotal || 0; // Use subtotal (base price without service fee)
    const equipmentBase = equipmentPricing.subtotal || 0;
    return kitchenBase + storageBase + equipmentBase;
  }, [estimatedPrice?.basePrice, storagePricing.subtotal, equipmentPricing.subtotal]);

  // Calculate service fee on combined subtotal (dynamic rate + $0.30 flat fee)
  const serviceFee = useMemo(() => {
    const subtotalCents = Math.round(combinedSubtotal * 100);
    if (subtotalCents <= 0) return 0;
    const percentageFeeCents = Math.round(subtotalCents * serviceFeeRate);
    return (percentageFeeCents + flatFeeCents) / 100;
  }, [combinedSubtotal, serviceFeeRate, flatFeeCents]);

  // Calculate grand total (subtotal + service fee)
  const grandTotal = useMemo(() => {
    return combinedSubtotal + serviceFee;
  }, [combinedSubtotal, serviceFee]);

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  // Util to get local YYYY-MM-DD
  const toLocalDateString = (d: Date) => {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // No redirect - show overlay instead

  // Load available slots when date changes
  useEffect(() => {
    if (selectedKitchen && selectedDate && canBook) {
      loadAvailableSlots(selectedKitchen.id, toLocalDateString(selectedDate));
    }
  }, [selectedKitchen, selectedDate, canBook]);

  const loadAvailableSlots = async (kitchenId: number, date: string) => {
    setIsLoadingSlots(true);
    try {
      // Prefer live Firebase ID token
      let authHeader: string | undefined;
      try {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth?.currentUser;
        if (currentUser) {
          const token = await currentUser.getIdToken();
          authHeader = `Bearer ${token}`;
        }
      } catch (e) {
        // ignore, will fallback to localStorage token
      }

      if (!authHeader) {
        const token = localStorage.getItem('firebaseToken');
        if (token) authHeader = `Bearer ${token}`;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;
      
      // Fetch policy (max slots per chef)
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
        const text = await response.text().catch(() => '');
        throw new Error(text || "Failed to fetch slots");
      }
      
      const slots = await response.json();
      console.log('📅 All slots for', date, ':', slots);
      
      // Filter out past times and times within minimum booking window
      const now = new Date();
      // Parse date in local timezone to avoid timezone issues
      const [year, month, day] = date.split('-').map(Number);
      const selectedDateObj = new Date(year, month - 1, day);
      const isToday = selectedDateObj.toDateString() === now.toDateString();
      
      // Get minimum booking window from location (default 1 hour)
      const minimumBookingWindowHours = selectedKitchen?.location?.minimumBookingWindowHours ?? 1;
      
      const filteredSlots = slots.filter((slot: any) => {
        const [slotHours, slotMins] = slot.time.split(':').map(Number);
        const slotTime = new Date(selectedDateObj);
        slotTime.setHours(slotHours, slotMins, 0, 0);
        
        // Only apply filtering rules if the date is today
        if (isToday) {
          // Filter out past times
          if (slotTime <= now) {
            console.log(`   ⏰ Filtered out ${slot.time} - past time (slotTime: ${slotTime.toISOString()}, now: ${now.toISOString()})`);
            return false;
          }
          
          // Filter out times within minimum booking window (only for today)
          const hoursUntilSlot = (slotTime.getTime() - now.getTime()) / (1000 * 60 * 60);
          if (hoursUntilSlot < minimumBookingWindowHours) {
            console.log(`   ⏰ Filtered out ${slot.time} - within ${minimumBookingWindowHours}h window (${hoursUntilSlot.toFixed(2)} hours until slot)`);
            return false;
          }
          
          console.log(`   ✅ Keeping ${slot.time} - ${hoursUntilSlot.toFixed(2)} hours until slot`);
        }
        
        // For future dates, all slots are available (no time-based filtering needed)
        return true;
      });
      
      console.log(`📅 Filtered ${slots.length} slots to ${filteredSlots.length} (removed past times and times within ${minimumBookingWindowHours}h window)`);
      console.log(`   Current time: ${now.toLocaleTimeString()}, Selected date is today: ${isToday}, Minimum booking window: ${minimumBookingWindowHours}h`);
      setAllSlots(filteredSlots);
      
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
        description: (error as Error)?.message || "Failed to load time slots. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingSlots(false);
    }
  };

  // Fetch storage and equipment listings for a kitchen
  const fetchKitchenAddons = async (kitchenId: number, authHeader?: string) => {
    setIsLoadingAddons(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;
      
      // Fetch storage listings
      const storageRes = await fetch(`/api/chef/kitchens/${kitchenId}/storage-listings`, {
        credentials: "include",
        headers,
        cache: 'no-store',
      });
      
      if (storageRes.ok) {
        const storageData = await storageRes.json();
        setStorageListings(storageData);
        console.log(`✅ Loaded ${storageData.length} storage listings for kitchen ${kitchenId}`);
      } else {
        console.log(`ℹ️ No storage listings available (status: ${storageRes.status})`);
        setStorageListings([]);
      }
      
      // Fetch equipment listings
      const equipmentRes = await fetch(`/api/chef/kitchens/${kitchenId}/equipment-listings`, {
        credentials: "include",
        headers,
        cache: 'no-store',
      });
      
      if (equipmentRes.ok) {
        const equipmentData = await equipmentRes.json();
        setEquipmentListings(equipmentData);
        console.log(`✅ Loaded equipment listings for kitchen ${kitchenId}:`, {
          included: equipmentData.included?.length || 0,
          rental: equipmentData.rental?.length || 0,
        });
      } else {
        console.log(`ℹ️ No equipment listings available (status: ${equipmentRes.status})`);
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
    const locationId = kitchen?.location?.id || kitchen?.locationId;
    
    // Check application status before allowing kitchen selection
    if (locationId) {
      // Use a quick check via the hook - it will fetch in the background
      // We'll check the status after a brief moment to allow the query to run
      // For now, set the kitchen and let the useEffect handle the redirect
      setSelectedKitchen(kitchen);
      setSelectedDate(null);
      setSelectedSlots([]);
      setAllSlots([]);
      setEstimatedPrice(null);
      setSelectedStorageIds([]);
      setSelectedEquipmentIds([]);
      setStorageListings([]);
      setEquipmentListings({ all: [], included: [], rental: [] });
    } else {
      // If no location ID, still allow selection (shouldn't happen, but handle gracefully)
      setSelectedKitchen(kitchen);
      setSelectedDate(null);
      setSelectedSlots([]);
      setAllSlots([]);
      setEstimatedPrice(null);
      setSelectedStorageIds([]);
      setSelectedEquipmentIds([]);
      setStorageListings([]);
      setEquipmentListings({ all: [], included: [], rental: [] });
    }
    
    // Fetch kitchen pricing
    try {
      // Use same robust auth pattern as loadAvailableSlots - prefer fresh Firebase token
      let authHeader: string | undefined;
      try {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth?.currentUser;
        if (currentUser) {
          const token = await currentUser.getIdToken();
          authHeader = `Bearer ${token}`;
          console.log('🔑 Using fresh Firebase token for pricing fetch');
        }
      } catch (e) {
        // ignore, will fallback to localStorage token
        console.log('⚠️ Failed to get fresh token, falling back to localStorage');
      }

      if (!authHeader) {
        const token = localStorage.getItem('firebaseToken');
        if (token) {
          authHeader = `Bearer ${token}`;
          console.log('🔑 Using localStorage token for pricing fetch');
        }
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;
      
      console.log('🔍 Fetching pricing for kitchen:', kitchen.id, 'Auth header present:', !!authHeader);
      
      const response = await fetch(`/api/chef/kitchens/${kitchen.id}/pricing`, {
        credentials: "include",
        headers,
        cache: 'no-store',
      });
      
      if (response.ok) {
        const pricing = await response.json();
        console.log('✅ Kitchen pricing fetched:', pricing);
        console.log('✅ Parsed hourlyRate:', pricing.hourlyRate, 'Type:', typeof pricing.hourlyRate);
        
        // Convert to number if it's a string, and handle cents vs dollars
        let hourlyRate = pricing.hourlyRate;
        if (typeof hourlyRate === 'string') {
          hourlyRate = parseFloat(hourlyRate);
        }
        // If hourlyRate is in cents (large number), convert to dollars
        if (hourlyRate && hourlyRate > 100) {
          console.warn('⚠️ Hourly rate appears to be in cents, converting to dollars:', hourlyRate);
          hourlyRate = hourlyRate / 100;
        }
        
        setKitchenPricing({
          hourlyRate: hourlyRate || null,
          currency: pricing.currency || 'CAD',
          minimumBookingHours: pricing.minimumBookingHours || 1,
        });
        console.log('✅ Set kitchenPricing state:', { hourlyRate, currency: pricing.currency || 'CAD', minimumBookingHours: pricing.minimumBookingHours || 1 });
      } else if (response.status === 404) {
        // No pricing set yet - this is expected
        console.log('ℹ️ No pricing set for kitchen:', kitchen.id);
        setKitchenPricing({
          hourlyRate: null,
          currency: 'CAD',
          minimumBookingHours: 1,
        });
      } else {
        const errorText = await response.text();
        console.error('❌ Error fetching pricing:', response.status, response.statusText, errorText);
        // Still set pricing state so UI can show message
        setKitchenPricing({
          hourlyRate: null,
          currency: 'CAD',
          minimumBookingHours: 1,
        });
      }
    } catch (error) {
      console.error('Error fetching kitchen pricing:', error);
      setKitchenPricing({
        hourlyRate: null,
        currency: 'CAD',
        minimumBookingHours: 1,
      });
    }
    
    // Also fetch storage and equipment listings
    if (kitchen) {
      // Get auth header for the addons fetch
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
      
      await fetchKitchenAddons(kitchen.id, authHeader);
    }
  };

  const handleDateClick = (date: Date) => {
    if (date < new Date(new Date().setHours(0, 0, 0, 0))) return; // Prevent past dates
    if (date.getMonth() !== currentMonth) return; // Only current month
    
    // Only allow date selection if application is approved
    if (selectedLocationId && (!hasApplication || !canBook)) {
      return; // Overlay will handle the interaction
    }
    
    setSelectedDate(date);
    setSelectedSlots([]);
  };

  // Calculate estimated price when slots change
  useEffect(() => {
    if (!selectedSlots.length || !selectedKitchen || !kitchenPricing) {
      setEstimatedPrice(null);
      return;
    }
    
    // Each selected slot represents a 1-hour block
    // Duration = number of slots selected (in hours)
    // This is consistent with booking submission which uses: selectedSlots.length * 60 minutes
    const durationHours = Math.max(selectedSlots.length, kitchenPricing.minimumBookingHours || 1);
    
    // Only calculate price if hourly rate is set
    if (kitchenPricing.hourlyRate && kitchenPricing.hourlyRate > 0) {
      // hourlyRate should already be in dollars from the API
      // But handle case where it might still be in cents (defensive)
      let hourlyRateDollars = kitchenPricing.hourlyRate;
      if (hourlyRateDollars > 100) {
        console.warn('⚠️ Hourly rate appears to be in cents, converting:', hourlyRateDollars);
        hourlyRateDollars = hourlyRateDollars / 100;
      }
      
      const basePrice = hourlyRateDollars * durationHours;
      const baseCents = Math.round(basePrice * 100);
      const percentageFeeCents = Math.round(baseCents * serviceFeeRate);
      const serviceFee = baseCents > 0 ? (percentageFeeCents + flatFeeCents) / 100 : 0;
      const totalPrice = basePrice + serviceFee;
      
      
      setEstimatedPrice({
        basePrice,
        serviceFee,
        totalPrice,
        durationHours,
      });
    } else {
      // No pricing set, but still calculate duration for display
      setEstimatedPrice({
        basePrice: 0,
        serviceFee: 0,
        totalPrice: 0,
        durationHours,
      });
    }
  }, [selectedSlots, selectedKitchen, kitchenPricing, serviceFeeRate, flatFeeCents]);

  const handleSlotClick = (slot: { time: string; available: number; capacity: number; isFullyBooked: boolean }) => {
    // Don't allow selecting fully booked slots
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
        // Deselect if already selected
        return prev.filter(s => s !== slot.time);
      } else if (prev.length < maxSlotsPerChef) {
        // Select if below policy limit
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

  const handleBookingSubmit = async () => {
    if (!selectedKitchen || !selectedDate || selectedSlots.length === 0) return;

    // Calculate start and end time from selected 1-hour slots
    const sortedSlots = [...selectedSlots].sort();
    const startTime = sortedSlots[0];

    // Each slot represents 1 hour now
    const [startHours, startMins] = startTime.split(':').map(Number);
    const totalDurationMins = sortedSlots.length * 60;
    const endTotalMins = startHours * 60 + startMins + totalDurationMins;
    const endHours = Math.floor(endTotalMins / 60);
    const endMins = endTotalMins % 60;
    const endTime = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`;

    // Format date as YYYY-MM-DD to avoid timezone issues
    // Then create Date object with noon UTC to prevent date shifts
    const bookingDateStr = toLocalDateString(selectedDate);
    const [year, month, day] = bookingDateStr.split('-').map(Number);
    const bookingDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)); // Use noon UTC to avoid date shifts
    
    createBooking.mutate(
      {
        kitchenId: selectedKitchen.id,
        bookingDate: bookingDate.toISOString(),
        startTime,
        endTime,
        specialNotes: notes,
        // Include selected storage and equipment add-ons
        // Storage is booked separately with custom date ranges
        selectedStorage: selectedStorage.length > 0 ? selectedStorage.map(s => ({
          storageListingId: s.storageListingId,
          startDate: s.startDate.toISOString(),
          endDate: s.endDate.toISOString(),
        })) : undefined,
        selectedEquipmentIds: selectedEquipmentIds.length > 0 ? selectedEquipmentIds : undefined,
      },
      {
        onSuccess: () => {
          const addonsCount = selectedEquipmentIds.length;
          const addonsMsg = addonsCount > 0 ? ` with ${addonsCount} equipment add-on${addonsCount > 1 ? 's' : ''}` : '';
          toast({
            title: "Booking Created!",
            description: `Your ${sortedSlots.length} hour${sortedSlots.length > 1 ? 's' : ''} kitchen booking${addonsMsg} has been submitted successfully.`,
          });
          setSelectedSlots([]);
          setNotes("");
          setSelectedStorageIds([]); // Legacy cleanup
          setSelectedStorage([]);
          setSelectedEquipmentIds([]);
          // Reload available slots
          if (selectedDate) {
            loadAvailableSlots(selectedKitchen.id, toLocalDateString(selectedDate));
          }
        },
        onError: (error: any) => {
          toast({
            title: "Booking Failed",
            description: error.message || "Failed to create booking. Please try again.",
            variant: "destructive",
          });
        },
      }
    );
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

  // Format a slot as a time range (e.g., "7:00 PM - 8:00 PM")
  // Each slot represents a 1-hour block
  const formatSlotRange = (slotStartTime: string) => {
    const [hours, minutes] = slotStartTime.split(':').map(Number);
    // Calculate end time (add 1 hour)
    const endHour = hours + 1;
    const endTimeStr = `${endHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    return `${formatTime(slotStartTime)} - ${formatTime(endTimeStr)}`;
  };

  // Get the overall booking time range from selected slots
  const getBookingTimeRange = () => {
    if (selectedSlots.length === 0) return '';
    const sortedSlots = [...selectedSlots].sort();
    const startTime = sortedSlots[0];
    const lastSlotStart = sortedSlots[sortedSlots.length - 1];
    // End time is 1 hour after the last slot's start time
    const [lastHours, lastMinutes] = lastSlotStart.split(':').map(Number);
    const endHour = lastHours + 1;
    const endTimeStr = `${endHour.toString().padStart(2, '0')}:${lastMinutes.toString().padStart(2, '0')}`;
    return `${formatTime(startTime)} - ${formatTime(endTimeStr)}`;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const calendarDays = selectedKitchen ? getCalendarDays(currentYear, currentMonth) : [];
  const isCurrentMonth = (date: Date) => date.getMonth() === currentMonth;
  const isToday = (date: Date) => date.toDateString() === today.toDateString();
  const isPast = (date: Date) => date < new Date(new Date().setHours(0, 0, 0, 0));

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-8 sm:pb-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 max-w-7xl">
          {/* Header */}
          <div className="mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900">Book a Kitchen</h1>
            <p className="text-gray-600 mt-2 text-sm sm:text-base md:text-lg">Reserve a professional kitchen space for your culinary needs</p>
          </div>

          {/* Loading State */}
          {isLoadingKitchens && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="text-gray-600 mt-4">Loading kitchens...</p>
            </div>
          )}

          {/* Error State */}
          {kitchensQuery.isError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 sm:p-6">
              <div className="flex items-center gap-2 sm:gap-3 mb-2">
                <AlertCircle className="h-5 w-5 sm:h-6 sm:w-6 text-red-600 flex-shrink-0" />
                <h3 className="text-base sm:text-lg font-semibold text-red-900">Error Loading Kitchens</h3>
              </div>
              <p className="text-sm sm:text-base text-red-700">{(kitchensQuery.error as Error)?.message || "Failed to fetch kitchens"}</p>
            </div>
          )}

          {/* No Kitchens Available */}
          {!isLoadingKitchens && !kitchensQuery.isError && filteredKitchens.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 md:p-12 text-center">
              <Building className="h-12 w-12 sm:h-16 sm:w-16 text-gray-400 mx-auto mb-3 sm:mb-4" />
              <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 mb-2 px-4">
                {locationFilterId ? "No Kitchens Available at This Location" : "No Kitchens Available"}
              </h2>
              <p className="text-sm sm:text-base text-gray-600 max-w-md mx-auto px-4">
                {locationFilterId 
                  ? "There are currently no commercial kitchens available for booking at this location. Please check back later or contact support."
                  : "There are currently no commercial kitchens available for booking. Please check back later or contact support."}
              </p>
            </div>
          )}

          {/* Main Content */}
          {!isLoadingKitchens && filteredKitchens.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
              {/* Left Column - Kitchen Selection & Calendar */}
              <div className="lg:col-span-2 space-y-4 sm:space-y-6">
                {/* Step 1: Kitchen Selection */}
                {!selectedKitchen ? (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
                    <div className="flex items-center gap-2 mb-4 sm:mb-6">
                      <div className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-blue-100 text-blue-600 font-semibold text-sm sm:text-base">1</div>
                      <h2 className="text-lg sm:text-xl font-bold text-gray-900">Select a Kitchen</h2>
                    </div>
                    
                    <div className="space-y-6">
                      {Object.entries(
                        filteredKitchens.reduce((acc: any, kitchen: any) => {
                          const locationName =
                            kitchen.location?.name ||
                            kitchen.locationName ||
                            'Unknown Location';
                          if (!acc[locationName]) {
                            acc[locationName] = {
                              location: kitchen.location,
                              manager: kitchen.manager,
                              kitchens: []
                            };
                          }
                          acc[locationName].kitchens.push(kitchen);
                          return acc;
                        }, {})
                      ).map(([locationName, data]: [string, any]) => (
                        <div key={locationName} className="border-b border-gray-200 pb-6 last:border-b-0 last:pb-0">
                          {/* Location Header */}
                          <div className="mb-4">
                            <h3 className="font-semibold text-lg text-gray-900 flex items-center gap-2">
                              <MapPin className="h-5 w-5 text-blue-600" />
                              {locationName}
                            </h3>
                            {(data.location?.address || data.locationAddress) && (
                              <p className="text-sm text-gray-600 ml-7 mt-1">{data.location?.address || data.locationAddress}</p>
                            )}
                            {data.manager && (
                              <p className="text-sm text-gray-500 ml-7 mt-1">
                                <span className="font-medium">Manager:</span> {data.manager.fullName || data.manager.username}
                              </p>
                            )}
                          </div>

                          {/* Kitchen Cards */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 ml-0 sm:ml-7">
                            {data.kitchens.map((kitchen: any) => (
                              <button
                                key={kitchen.id}
                                onClick={() => handleKitchenSelect(kitchen)}
                                className="group p-4 sm:p-5 rounded-lg border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all text-left mobile-touch-target"
                              >
                                <h4 className="font-semibold text-sm sm:text-base text-gray-900 group-hover:text-blue-600 mb-1.5 sm:mb-2">{kitchen.name}</h4>
                                {kitchen.description && (
                                  <p className="text-xs sm:text-sm text-gray-600 mb-2 sm:mb-3 line-clamp-2">{kitchen.description}</p>
                                )}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 text-xs sm:text-sm text-blue-600 font-medium">
                                    <CalendarIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                    Select Kitchen
                                  </div>
                                  {/* Pricing will be loaded after selection */}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Selected Kitchen Summary */}
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 sm:p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 sm:mb-2">
                            <Building className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 flex-shrink-0" />
                            <h3 className="font-semibold text-sm sm:text-base text-blue-900 truncate">{selectedKitchen.name}</h3>
                          </div>
                          {(selectedKitchen.location?.name || selectedKitchen.locationName) && (
                            <p className="text-xs sm:text-sm text-blue-700 truncate">📍 {selectedKitchen.location?.name || selectedKitchen.locationName}</p>
                          )}
                          {kitchenPricing && kitchenPricing.hourlyRate && (
                            <p className="text-xs sm:text-sm font-semibold text-blue-900 mt-1.5 sm:mt-2">
                              ${(kitchenPricing.hourlyRate > 100 ? kitchenPricing.hourlyRate / 100 : kitchenPricing.hourlyRate).toFixed(2)} {kitchenPricing.currency}/hour
                            </p>
                          )}
                          {kitchenPricing && !kitchenPricing.hourlyRate && (
                            <p className="text-xs sm:text-sm text-blue-600 mt-1.5 sm:mt-2 italic">Pricing not set</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleKitchenSelect(null)}
                          className="text-blue-600 hover:text-blue-800 text-xs sm:text-sm font-medium flex-shrink-0 mobile-touch-target px-2 py-1"
                        >
                          Change
                        </button>
                      </div>
                    </div>

                    {/* GROUP 1: Kitchen Add-ons (Equipment) */}
                    {equipmentListings.all.length > 0 && (
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl shadow-sm border-2 border-blue-200 p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <ChefHat className="h-5 w-5 text-blue-600" />
                          <h3 className="text-lg font-semibold text-blue-900">Kitchen Add-ons</h3>
                        </div>
                        
                        {/* Equipment - Included (Free with Kitchen) */}
                        {equipmentListings.included.length > 0 && (
                          <div className="mb-6">
                            <div className="flex items-center gap-2 mb-3">
                              <Wrench className="h-4 w-4 text-green-600" />
                              <h4 className="font-medium text-gray-800">Included Equipment</h4>
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Free with booking</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {equipmentListings.included.map((equipment: any) => (
                                <div key={equipment.id} className="p-3 bg-white border border-green-200 rounded-lg">
                                  <div className="flex items-start justify-between">
                                    <div>
                                      <p className="font-medium text-gray-900">{equipment.equipmentType}</p>
                                      {equipment.brand && (
                                        <p className="text-sm text-gray-600">{equipment.brand} {equipment.model || ''}</p>
                                      )}
                                      <p className="text-xs text-gray-500 mt-1 capitalize">{equipment.category} • {equipment.condition}</p>
                                    </div>
                                    <span className="text-green-600 text-sm font-medium">✓ Included</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* Equipment - Rental (Paid Add-on) */}
                        {equipmentListings.rental.length > 0 && (
                          <div className="mb-6">
                            <div className="flex items-center gap-2 mb-3">
                              <Wrench className="h-4 w-4 text-amber-600" />
                              <h4 className="font-medium text-gray-800">Rental Equipment</h4>
                              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Paid add-on</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {equipmentListings.rental.map((equipment: any) => {
                                const isSelected = selectedEquipmentIds.includes(equipment.id);
                                // Use sessionRate (flat per-session fee)
                                const rate = equipment.sessionRate || 0;
                                
                                return (
                                  <button
                                    key={equipment.id}
                                    onClick={() => {
                                      if (isSelected) {
                                        setSelectedEquipmentIds(prev => prev.filter(id => id !== equipment.id));
                                      } else {
                                        setSelectedEquipmentIds(prev => [...prev, equipment.id]);
                                      }
                                    }}
                                    className={`p-3 border rounded-lg text-left transition-all ${
                                      isSelected 
                                        ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-200' 
                                        : 'bg-white border-gray-200 hover:border-amber-300 hover:bg-amber-50'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      {/* Equipment Image */}
                                      {equipment.photos && equipment.photos.length > 0 && (
                                        <EquipmentImage imageUrl={equipment.photos[0]} alt={equipment.equipmentType} />
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <p className="font-medium text-gray-900">{equipment.equipmentType}</p>
                                        {equipment.brand && (
                                          <p className="text-sm text-gray-600">{equipment.brand} {equipment.model || ''}</p>
                                        )}
                                        <p className="text-xs text-gray-500 mt-1 capitalize">{equipment.category} • {equipment.condition}</p>
                                        {equipment.damageDeposit > 0 && (
                                          <p className="text-xs text-gray-500 mt-1">
                                            Deposit: ${equipment.damageDeposit.toFixed(2)}
                                          </p>
                                        )}
                                      </div>
                                      <div className="text-right flex-shrink-0">
                                        <p className="font-semibold text-amber-700">
                                          ${rate?.toFixed(2) || '0.00'}/session
                                        </p>
                                        {isSelected && <span className="text-xs text-amber-600">✓ Selected</span>}
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        
                        {/* Equipment Selection Summary */}
                        {selectedEquipmentIds.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-blue-200">
                            <div className="flex items-center gap-2 text-sm text-blue-700 font-medium">
                              <Wrench className="h-4 w-4" />
                              <span>
                                Selected: {selectedEquipmentIds.length} equipment add-on{selectedEquipmentIds.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* GROUP 2: Storage Spaces (Separate Group) */}
                    {storageListings.length > 0 && (
                      <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl shadow-sm border-2 border-purple-200 p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <Package className="h-5 w-5 text-purple-600" />
                          <h3 className="text-lg font-semibold text-purple-900">Storage Spaces</h3>
                        </div>
                        
                        <StorageSelection
                          storageListings={storageListings}
                          selectedStorage={selectedStorage}
                          onSelectionChange={setSelectedStorage}
                          kitchenBookingDate={selectedDate || undefined}
                        />
                        
                        {/* Storage Selection Summary */}
                        {selectedStorage.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-purple-200">
                            <div className="flex items-center gap-2 text-sm text-purple-700 font-medium">
                              <Package className="h-4 w-4" />
                              <span>
                                Selected: {selectedStorage.length} storage space{selectedStorage.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Loading state for add-ons */}
                    {isLoadingAddons && (
                      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                        <div className="flex items-center gap-3">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                          <span className="text-gray-600">Loading available add-ons...</span>
                        </div>
                      </div>
                    )}

                    {/* Step 2: Date Selection (Calendar) */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 relative">
                      <div className="flex items-center gap-2 mb-4 sm:mb-6">
                        <div className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-blue-100 text-blue-600 font-semibold text-sm sm:text-base">2</div>
                        <h2 className="text-lg sm:text-xl font-bold text-gray-900">Choose a Date</h2>
                      </div>

                      {/* Calendar Header */}
                      <div className="flex items-center justify-between mb-4 sm:mb-6">
                        <button
                          onClick={() => navigateMonth('prev')}
                          className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors mobile-touch-target"
                          aria-label="Previous month"
                        >
                          <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5 text-gray-600" />
                        </button>
                        
                        <h3 className="text-base sm:text-lg font-bold text-gray-900 px-2">
                          {monthNames[currentMonth]} {currentYear}
                        </h3>
                        
                        <button
                          onClick={() => navigateMonth('next')}
                          className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors mobile-touch-target"
                          aria-label="Next month"
                        >
                          <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-gray-600" />
                        </button>
                      </div>

                      {/* Calendar Grid */}
                      <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                        {/* Day headers */}
                        <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2 min-w-[280px]">
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                            <div key={day} className="text-center text-[10px] sm:text-xs font-semibold text-gray-600 py-1 sm:py-2">
                              {day}
                            </div>
                          ))}
                        </div>

                        {/* Calendar days */}
                        <div className="grid grid-cols-7 gap-1 sm:gap-2 min-w-[280px]">
                          {calendarDays.map((date, index) => {
                            if (!date) return null;
                            const isCurrent = isCurrentMonth(date);
                            const isTodayDate = isToday(date);
                            const isPastDate = isPast(date);
                            const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString();

                            let bgColor = 'bg-white hover:bg-gray-50';
                            let borderColor = 'border-gray-200';
                            let textColor = isCurrent ? 'text-gray-900' : 'text-gray-400';
                            let cursor = 'cursor-pointer';

                            if (isPastDate || !isCurrent) {
                              cursor = 'cursor-not-allowed';
                              bgColor = 'bg-gray-50';
                            }

                            if (isSelected) {
                              bgColor = 'bg-blue-600';
                              borderColor = 'border-blue-600';
                              textColor = 'text-white';
                            }

                            if (isTodayDate && !isSelected) {
                              borderColor = 'border-blue-500 border-2';
                            }

                            // Disable date selection if application is not approved (overlay will handle interaction)
                            const canSelectDate = !selectedLocationId || (hasApplication && canBook && !isLoadingApplication);
                            const isDisabled = isPastDate || !isCurrent || !canSelectDate;

                            return (
                              <button
                                key={index}
                                onClick={() => !isPastDate && isCurrent && canSelectDate && handleDateClick(date)}
                                disabled={isDisabled}
                                className={`
                                  aspect-square p-1 sm:p-2 rounded-lg border transition-all
                                  ${bgColor} ${borderColor} ${textColor} ${isDisabled ? 'cursor-not-allowed' : cursor}
                                  ${isDisabled ? 'opacity-40' : ''}
                                  relative mobile-touch-target
                                `}
                              >
                                <span className="text-xs sm:text-sm font-medium">{date.getDate()}</span>
                                {isSelected && (
                                  <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2">
                                    <Check className="h-3 w-3" />
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Calendar Legend */}
                      <div className="mt-6 pt-6 border-t border-gray-200">
                        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-blue-500 rounded"></div>
                            <span>Today</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 bg-blue-600 rounded"></div>
                            <span>Selected</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 bg-gray-50 border border-gray-200 rounded opacity-40"></div>
                            <span>Unavailable</span>
                          </div>
                        </div>
                      </div>

                      {/* Overlay - Show if application is not approved */}
                      {selectedLocationId && (!isLoadingApplication && (!hasApplication || !canBook)) && (
                        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center rounded-xl">
                          <div className="text-center px-4 py-3 bg-white/95 rounded-xl shadow-lg border border-gray-200 mx-4 max-w-sm">
                            <div className="w-10 h-10 mx-auto mb-2 bg-[#F51042]/10 rounded-full flex items-center justify-center">
                              <Lock className="w-5 h-5 text-[#F51042]" />
                            </div>
                            <p className="text-sm font-semibold text-gray-800 mb-1">
                              Apply to book
                            </p>
                            <p className="text-xs text-gray-500 mb-4">
                              {!hasApplication 
                                ? "Submit an application to book this kitchen"
                                : application?.status === 'inReview'
                                ? "Your application is pending manager review"
                                : application?.status === 'rejected'
                                ? "Your application was rejected. Re-apply with updated documents"
                                : "Application approval required"}
                            </p>
                            <button
                              onClick={() => setLocation(`/apply-kitchen/${selectedLocationId}`)}
                              className="w-full px-4 py-2 bg-[#F51042] hover:bg-[#D90E3A] text-white rounded-lg font-medium transition-colors text-sm flex items-center justify-center gap-2"
                            >
                              <FileText className="w-4 h-4" />
                              {!hasApplication ? "Apply to Kitchen" : "View Application"}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Loading overlay while checking application */}
                      {selectedLocationId && isLoadingApplication && (
                        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center rounded-xl">
                          <div className="text-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#F51042] mx-auto mb-2"></div>
                            <p className="text-sm text-gray-600">Checking application status...</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Step 3: Time Slot Selection */}
                    {selectedDate && canBook && (
                      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-blue-100 text-blue-600 font-semibold text-sm sm:text-base">3</div>
                            <h2 className="text-lg sm:text-xl font-bold text-gray-900">Select Time Slots</h2>
                          </div>
                          {selectedSlots.length > 0 && (
                            <button
                              onClick={() => {
                                if (!selectedKitchen || !selectedDate) return;
                                
                                // Build query parameters
                                const params = new URLSearchParams();
                                params.set('kitchenId', selectedKitchen.id.toString());
                                params.set('date', toLocalDateString(selectedDate));
                                params.set('slots', selectedSlots.join(','));
                                
                                // Add storage if selected
                                if (selectedStorage.length > 0) {
                                  params.set('storage', encodeURIComponent(JSON.stringify(selectedStorage.map(s => ({
                                    storageListingId: s.storageListingId,
                                    startDate: s.startDate instanceof Date ? s.startDate.toISOString() : s.startDate,
                                    endDate: s.endDate instanceof Date ? s.endDate.toISOString() : s.endDate,
                                  })))));
                                }
                                
                                // Add equipment if selected
                                if (selectedEquipmentIds.length > 0) {
                                  params.set('equipment', selectedEquipmentIds.join(','));
                                }
                                
                                // Add notes if any
                                if (notes) {
                                  params.set('notes', notes);
                                }
                                
                                setLocation(`/book-kitchen/confirm?${params.toString()}`);
                              }}
                              className="w-full sm:w-auto px-4 sm:px-6 py-2.5 sm:py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors flex items-center justify-center gap-2 min-h-[44px] text-sm sm:text-base"
                            >
                              Continue
                              <Check className="h-4 w-4" />
                            </button>
                          )}
                        </div>

                        <div className="mb-3 sm:mb-4 p-3 sm:p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                          <p className="text-xs sm:text-sm text-gray-700 mb-1.5 sm:mb-2">
                            <CalendarIcon className="inline h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1 text-blue-600" />
                            <span className="font-semibold">{formatDate(selectedDate)}</span>
                          </p>
                          <p className="text-[10px] sm:text-xs text-gray-600">
                                   💡 Daily booking limit: {maxSlotsPerChef} {maxSlotsPerChef === 1 ? 'hour' : 'hours'} per chef
                          </p>
                        </div>

                        {isLoadingSlots ? (
                          <div className="text-center py-8 sm:py-12">
                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <p className="text-sm sm:text-base text-gray-600 mt-3">Loading time slots...</p>
                          </div>
                        ) : allSlots.length === 0 ? (
                          <div className="p-4 sm:p-6 bg-yellow-50 border border-yellow-200 rounded-lg text-center">
                            <Info className="h-6 w-6 sm:h-8 sm:w-8 text-yellow-600 mx-auto mb-2 sm:mb-3" />
                            <p className="text-sm sm:text-base text-gray-800 font-medium mb-1.5 sm:mb-2">Kitchen Closed</p>
                            <p className="text-xs sm:text-sm text-gray-600">
                              The kitchen manager has not set operating hours for this day.
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
                              {allSlots.map((slot) => {
                                const isSelected = selectedSlots.includes(slot.time);
                                const isFullyBooked = slot.isFullyBooked;
                                const availability = slot.available;
                                const capacity = slot.capacity;
                                
                                // Determine styling based on availability
                                let statusColor = 'border-gray-200 hover:border-blue-400 hover:bg-blue-50';
                                let statusBg = 'bg-white';
                                let statusText = 'text-gray-700';
                                let cursorStyle = 'cursor-pointer';
                                
                                if (isSelected) {
                                  statusColor = 'border-blue-600';
                                  statusBg = 'bg-blue-600';
                                  statusText = 'text-white';
                                } else if (isFullyBooked) {
                                  statusColor = 'border-red-200';
                                  statusBg = 'bg-red-50';
                                  statusText = 'text-red-500';
                                  cursorStyle = 'cursor-not-allowed';
                                } else if (availability === 1 && capacity > 1) {
                                  statusColor = 'border-orange-300';
                                  statusBg = 'bg-orange-50';
                                  statusText = 'text-orange-700';
                                } else if (availability < capacity) {
                                  statusColor = 'border-yellow-300';
                                  statusBg = 'bg-yellow-50';
                                  statusText = 'text-yellow-700';
                                }
                                
                                return (
                                  <button
                                    key={slot.time}
                                    onClick={() => handleSlotClick(slot)}
                                    disabled={isFullyBooked}
                                    className={`
                                      relative p-2.5 sm:p-4 border-2 rounded-lg sm:rounded-xl transition-all font-medium text-center
                                      ${statusBg} ${statusColor} ${statusText} ${cursorStyle}
                                      ${isSelected ? 'shadow-lg scale-105' : !isFullyBooked && 'hover:scale-102'}
                                      mobile-touch-target
                                    `}
                                  >
                                    <div className="flex flex-col items-center gap-0.5 sm:gap-1">
                                      <div className="flex flex-col items-center">
                                        <div className="flex items-center gap-1">
                                          <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                                          <span className="text-xs sm:text-sm font-semibold">{formatSlotRange(slot.time)}</span>
                                        </div>
                                        <span className="text-[10px] sm:text-xs opacity-75">(1 hour)</span>
                                      </div>
                                      
                                      {/* Capacity indicator */}
                                      {capacity > 1 && (
                                        <div className={`text-xs font-medium ${
                                          isSelected ? 'text-white' : 
                                          isFullyBooked ? 'text-red-600' : 
                                          availability === 1 ? 'text-orange-600' :
                                          availability < capacity ? 'text-yellow-600' :
                                          'text-green-600'
                                        }`}>
                                          {isFullyBooked ? 'Fully Booked' : `${availability}/${capacity} spots`}
                                        </div>
                                      )}
                                      
                                      {capacity === 1 && isFullyBooked && (
                                        <div className="text-xs font-medium text-red-600">Booked</div>
                                      )}
                                    </div>
                                    
                                    {isSelected && (
                                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                                        <Check className="h-4 w-4 text-white" />
                                      </div>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            
                            {/* Legend */}
                            <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-gray-50 border border-gray-200 rounded-lg">
                              <p className="text-[10px] sm:text-xs font-semibold text-gray-700 mb-2 sm:mb-3">Availability Legend:</p>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] sm:text-xs">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 bg-white border-2 border-gray-200 rounded"></div>
                                  <span className="text-gray-600">Available</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 bg-yellow-50 border-2 border-yellow-300 rounded"></div>
                                  <span className="text-gray-600">Limited</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 bg-orange-50 border-2 border-orange-300 rounded"></div>
                                  <span className="text-gray-600">1 Spot Left</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 bg-red-50 border-2 border-red-200 rounded"></div>
                                  <span className="text-gray-600">Fully Booked</span>
                                </div>
                              </div>
                            </div>
                            
                            {selectedSlots.length > 0 && (
                              <div className="mt-3 sm:mt-4 p-3 sm:p-4 bg-green-50 border border-green-200 rounded-lg">
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
                                  <div className="flex-1">
                                    <p className="text-xs sm:text-sm font-medium text-green-900">
                                      {selectedSlots.length} hour{selectedSlots.length > 1 ? 's' : ''} selected
                                    </p>
                                    <p className="text-[10px] sm:text-xs text-green-700 mt-0.5 sm:mt-1">
                                      Duration: {selectedSlots.length} {selectedSlots.length === 1 ? 'hour' : 'hours'}
                                    </p>
                                    {estimatedPrice && (
                                      <p className="text-xs sm:text-sm font-semibold text-green-900 mt-1.5 sm:mt-2">
                                        Estimated Total: ${estimatedPrice.totalPrice.toFixed(2)} {kitchenPricing?.currency || 'CAD'}
                                      </p>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => setSelectedSlots([])}
                                    className="text-xs sm:text-sm text-green-700 hover:text-green-900 font-medium underline mobile-touch-target py-1"
                                  >
                                    Clear Selection
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Right Column - Booking Control Panel */}
              <div className="lg:col-span-1">
                <BookingControlPanel
                  bookings={enrichedBookings}
                  isLoading={isLoadingBookings}
                  onCancelBooking={handleCancelBooking}
                  kitchens={kitchensForPanel}
                />
              </div>
            </div>
          )}
        </div>

      </main>
      <Footer />
    </div>
  );
}
