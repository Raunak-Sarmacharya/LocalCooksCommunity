import { Calendar as CalendarIcon, Clock, MapPin, X, AlertCircle, Building, ChevronLeft, ChevronRight, Check, Info } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useKitchenBookings } from "../hooks/use-kitchen-bookings";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { useToast } from "@/hooks/use-toast";
import BookingControlPanel from "@/components/booking/BookingControlPanel";

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
  const [showBookingModal, setShowBookingModal] = useState(false);

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  // Util to get local YYYY-MM-DD
  const toLocalDateString = (d: Date) => {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Load available slots when date changes
  useEffect(() => {
    if (selectedKitchen && selectedDate) {
      loadAvailableSlots(selectedKitchen.id, toLocalDateString(selectedDate));
    }
  }, [selectedKitchen, selectedDate]);

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
      const selectedDateObj = new Date(date + 'T00:00:00');
      const isToday = selectedDateObj.toDateString() === now.toDateString();
      
      // Get minimum booking window from location (default 2 hours)
      const minimumBookingWindowHours = selectedKitchen?.location?.minimumBookingWindowHours ?? 2;
      
      const filteredSlots = slots.filter((slot: any) => {
        const [slotHours, slotMins] = slot.time.split(':').map(Number);
        const slotTime = new Date(selectedDateObj);
        slotTime.setHours(slotHours, slotMins, 0, 0);
        
        // Filter out past times
        if (isToday && slotTime <= now) {
          return false;
        }
        
        // Filter out times within minimum booking window
        const hoursUntilSlot = (slotTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (hoursUntilSlot < minimumBookingWindowHours) {
          return false;
        }
        
        return true;
      });
      
      console.log(`📅 Filtered ${slots.length} slots to ${filteredSlots.length} (removed past times and times within ${minimumBookingWindowHours}h window)`);
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

  const handleKitchenSelect = (kitchen: any) => {
    setSelectedKitchen(kitchen);
    setSelectedDate(null);
    setSelectedSlots([]);
    setAllSlots([]);
    setShowBookingModal(false);
  };

  const handleDateClick = (date: Date) => {
    if (date < new Date(new Date().setHours(0, 0, 0, 0))) return; // Prevent past dates
    if (date.getMonth() !== currentMonth) return; // Only current month
    
    setSelectedDate(date);
    setSelectedSlots([]);
    setShowBookingModal(false);
  };

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

    const bookingDate = new Date(selectedDate);
    bookingDate.setHours(0, 0, 0, 0);
    
    createBooking.mutate(
      {
        kitchenId: selectedKitchen.id,
        bookingDate: bookingDate.toISOString(),
        startTime,
        endTime,
        specialNotes: notes,
      },
      {
        onSuccess: () => {
          toast({
            title: "Booking Created!",
            description: `Your ${sortedSlots.length} hour${sortedSlots.length > 1 ? 's' : ''} kitchen booking has been submitted successfully.`,
          });
          setShowBookingModal(false);
          setSelectedSlots([]);
          setNotes("");
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
      <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
        <div className="container mx-auto px-4 py-8 max-w-7xl">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900">Book a Kitchen</h1>
            <p className="text-gray-600 mt-2 text-lg">Reserve a professional kitchen space for your culinary needs</p>
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
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-2">
                <AlertCircle className="h-6 w-6 text-red-600" />
                <h3 className="text-lg font-semibold text-red-900">Error Loading Kitchens</h3>
              </div>
              <p className="text-red-700">{(kitchensQuery.error as Error)?.message || "Failed to fetch kitchens"}</p>
            </div>
          )}

          {/* No Kitchens Available */}
          {!isLoadingKitchens && !kitchensQuery.isError && kitchens.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
              <Building className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">No Kitchens Available</h2>
              <p className="text-gray-600 max-w-md mx-auto">
                There are currently no commercial kitchens available for booking. 
                Please check back later or contact support.
              </p>
            </div>
          )}

          {/* Main Content */}
          {!isLoadingKitchens && kitchens.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Column - Kitchen Selection & Calendar */}
              <div className="lg:col-span-2 space-y-6">
                {/* Step 1: Kitchen Selection */}
                {!selectedKitchen ? (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center gap-2 mb-6">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-semibold">1</div>
                      <h2 className="text-xl font-bold text-gray-900">Select a Kitchen</h2>
                    </div>
                    
                    <div className="space-y-6">
                      {Object.entries(
                        kitchens.reduce((acc: any, kitchen: any) => {
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
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ml-7">
                            {data.kitchens.map((kitchen: any) => (
                              <button
                                key={kitchen.id}
                                onClick={() => handleKitchenSelect(kitchen)}
                                className="group p-5 rounded-lg border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all text-left"
                              >
                                <h4 className="font-semibold text-gray-900 group-hover:text-blue-600 mb-2">{kitchen.name}</h4>
                                {kitchen.description && (
                                  <p className="text-sm text-gray-600 mb-3">{kitchen.description}</p>
                                )}
                                <div className="flex items-center gap-2 text-sm text-blue-600 font-medium">
                                  <CalendarIcon className="h-4 w-4" />
                                  Select Kitchen
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
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Building className="h-5 w-5 text-blue-600" />
                            <h3 className="font-semibold text-blue-900">{selectedKitchen.name}</h3>
                          </div>
                          {(selectedKitchen.location?.name || selectedKitchen.locationName) && (
                            <p className="text-sm text-blue-700">📍 {selectedKitchen.location?.name || selectedKitchen.locationName}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleKitchenSelect(null)}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          Change
                        </button>
                      </div>
                    </div>

                    {/* Step 2: Date Selection (Calendar) */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                      <div className="flex items-center gap-2 mb-6">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-semibold">2</div>
                        <h2 className="text-xl font-bold text-gray-900">Choose a Date</h2>
                      </div>

                      {/* Calendar Header */}
                      <div className="flex items-center justify-between mb-6">
                        <button
                          onClick={() => navigateMonth('prev')}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                          aria-label="Previous month"
                        >
                          <ChevronLeft className="h-5 w-5 text-gray-600" />
                        </button>
                        
                        <h3 className="text-lg font-bold text-gray-900">
                          {monthNames[currentMonth]} {currentYear}
                        </h3>
                        
                        <button
                          onClick={() => navigateMonth('next')}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                          aria-label="Next month"
                        >
                          <ChevronRight className="h-5 w-5 text-gray-600" />
                        </button>
                      </div>

                      {/* Calendar Grid */}
                      <div>
                        {/* Day headers */}
                        <div className="grid grid-cols-7 gap-2 mb-2">
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                            <div key={day} className="text-center text-xs font-semibold text-gray-600 py-2">
                              {day}
                            </div>
                          ))}
                        </div>

                        {/* Calendar days */}
                        <div className="grid grid-cols-7 gap-2">
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

                            return (
                              <button
                                key={index}
                                onClick={() => !isPastDate && isCurrent && handleDateClick(date)}
                                disabled={isPastDate || !isCurrent}
                                className={`
                                  aspect-square p-2 rounded-lg border transition-all
                                  ${bgColor} ${borderColor} ${textColor} ${cursor}
                                  ${isPastDate || !isCurrent ? 'opacity-40' : ''}
                                  relative
                                `}
                              >
                                <span className="text-sm font-medium">{date.getDate()}</span>
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
                    </div>

                    {/* Step 3: Time Slot Selection */}
                    {selectedDate && (
                      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                        <div className="flex items-center justify-between mb-6">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-semibold">3</div>
                            <h2 className="text-xl font-bold text-gray-900">Select Time Slots</h2>
                          </div>
                          {selectedSlots.length > 0 && (
                            <button
                              onClick={() => setShowBookingModal(true)}
                              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors flex items-center gap-2"
                            >
                              Continue
                              <Check className="h-4 w-4" />
                            </button>
                          )}
                        </div>

                        <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                          <p className="text-sm text-gray-700 mb-2">
                            <CalendarIcon className="inline h-4 w-4 mr-1 text-blue-600" />
                            <span className="font-semibold">{formatDate(selectedDate)}</span>
                          </p>
                          <p className="text-xs text-gray-600">
                                   💡 Daily booking limit: {maxSlotsPerChef} {maxSlotsPerChef === 1 ? 'hour' : 'hours'} per chef
                          </p>
                        </div>

                        {isLoadingSlots ? (
                          <div className="text-center py-12">
                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <p className="text-gray-600 mt-3">Loading time slots...</p>
                          </div>
                        ) : allSlots.length === 0 ? (
                          <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg text-center">
                            <Info className="h-8 w-8 text-yellow-600 mx-auto mb-3" />
                            <p className="text-gray-800 font-medium mb-2">Kitchen Closed</p>
                            <p className="text-sm text-gray-600">
                              The kitchen manager has not set operating hours for this day.
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
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
                                      relative p-4 border-2 rounded-xl transition-all font-medium text-center
                                      ${statusBg} ${statusColor} ${statusText} ${cursorStyle}
                                      ${isSelected ? 'shadow-lg scale-105' : !isFullyBooked && 'hover:scale-102'}
                                    `}
                                  >
                                    <div className="flex flex-col items-center gap-1">
                                      <div className="flex items-center gap-1">
                                        <Clock className="h-4 w-4" />
                                        <span className="text-lg font-semibold">{formatTime(slot.time)}</span>
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
                            <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                              <p className="text-xs font-semibold text-gray-700 mb-3">Availability Legend:</p>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
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
                              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium text-green-900">
                                      {selectedSlots.length} hour{selectedSlots.length > 1 ? 's' : ''} selected
                                    </p>
                                    <p className="text-xs text-green-700 mt-1">
                                      Duration: {selectedSlots.length} {selectedSlots.length === 1 ? 'hour' : 'hours'}
                                    </p>
                                  </div>
                                  <button
                                    onClick={() => setSelectedSlots([])}
                                    className="text-sm text-green-700 hover:text-green-900 font-medium underline"
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

        {/* Booking Modal */}
        {showBookingModal && selectedKitchen && selectedDate && selectedSlots.length > 0 && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowBookingModal(false);
              }
            }}
          >
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Confirm Your Booking</h2>
                <button
                  onClick={() => setShowBookingModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label="Close modal"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Kitchen */}
                <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                  <p className="text-xs text-gray-600 mb-1">Kitchen</p>
                  <p className="font-semibold text-gray-900 text-lg">{selectedKitchen.name}</p>
                  {(selectedKitchen.location?.name || selectedKitchen.locationName) && (
                    <p className="text-xs text-gray-600 mt-1">
                      📍 {selectedKitchen.location?.name || selectedKitchen.locationName}
                    </p>
                  )}
                </div>

                {/* Date & Time */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">Date</p>
                    <p className="font-medium text-gray-900">
                      {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">Duration</p>
                    <p className="font-medium text-gray-900">
                      {selectedSlots.length === 1 ? '30 min' : '1 hour'}
                    </p>
                  </div>
                </div>

                {/* Time Range */}
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-xs text-gray-600 mb-2">Selected Time Slots</p>
                  <div className="flex items-center justify-center gap-2">
                    {selectedSlots.map((slot, idx) => (
                      <div key={slot} className="flex items-center gap-2">
                        <span className="px-3 py-1.5 bg-white border border-green-300 rounded-lg font-semibold text-green-800">
                          {formatTime(slot)}
                        </span>
                        {idx < selectedSlots.length - 1 && (
                          <span className="text-green-600">→</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Special Notes */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Special Notes (Optional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="Any special requirements or notes..."
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {notes && (
                    <p className="text-xs text-gray-500 mt-1">{notes.length}/500 characters</p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowBookingModal(false)}
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleBookingSubmit}
                    disabled={createBooking.isPending}
                    className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-colors"
                  >
                    {createBooking.isPending ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Booking...
                      </span>
                    ) : (
                      "Confirm Booking"
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
