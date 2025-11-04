import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar as CalendarIcon, Clock, MapPin, Building2, AlertCircle, Loader2, ChevronLeft, ChevronRight, Check, Info, X } from "lucide-react";
import { useLocation } from "wouter";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Location {
  id: number;
  name: string;
  address: string;
  logoUrl?: string;
}

interface Kitchen {
  id: number;
  name: string;
  description?: string;
  locationId: number;
}

interface Slot {
  time: string;
  available: number;
  capacity: number;
  isFullyBooked: boolean;
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

export default function ManagerBookingPortal() {
  const [locationPath] = useLocation();
  const { toast } = useToast();
  
  // Step 1: Kitchen Selection
  const [selectedKitchen, setSelectedKitchen] = useState<Kitchen | null>(null);
  
  // Step 2: Date Selection (Calendar View)
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  
  // Step 3: Time Slot Selection (multiple slots like chef bookings)
  const [allSlots, setAllSlots] = useState<Slot[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [maxSlotsPerChef, setMaxSlotsPerChef] = useState<number>(2);
  
  // Step 4: Booking Details
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notes, setNotes] = useState("");
  const [showBookingModal, setShowBookingModal] = useState(false);

  // Extract location slug from URL (e.g., /portal/:locationSlug)
  const locationSlugMatch = locationPath.match(/\/portal\/([^/]+)/);
  const locationSlug = locationSlugMatch ? locationSlugMatch[1] : null;

  // Fetch location details by slug (requires authentication)
  const { data: locationData, isLoading: loadingLocation } = useQuery<Location>({
    queryKey: [`/api/portal/locations/${locationSlug}`],
    queryFn: async () => {
      const response = await fetch(`/api/portal/locations/${locationSlug}`, {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required');
        }
        if (response.status === 403) {
          throw new Error('Access denied. You can only access your assigned location.');
        }
        throw new Error('Location not found');
      }
      return response.json();
    },
    enabled: !!locationSlug,
  });

  // Fetch kitchens for location (requires authentication)
  const { data: kitchens, isLoading: loadingKitchens } = useQuery<Kitchen[]>({
    queryKey: [`/api/portal/locations/${locationSlug}/kitchens`],
    queryFn: async () => {
      const response = await fetch(`/api/portal/locations/${locationSlug}/kitchens`, {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required');
        }
        if (response.status === 403) {
          throw new Error('Access denied. You can only access kitchens at your assigned location.');
        }
        throw new Error('Failed to fetch kitchens');
      }
      return response.json();
    },
    enabled: !!locationSlug && !!locationData,
  });

  // Load available slots when date and kitchen are selected
  useEffect(() => {
    if (selectedKitchen && selectedDate) {
      loadAvailableSlots();
    }
  }, [selectedKitchen, selectedDate]);

  const toLocalDateString = (d: Date) => {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const loadAvailableSlots = async () => {
    if (!selectedKitchen || !selectedDate) return;
    
    setIsLoadingSlots(true);
    setSelectedSlots([]);
    const date = toLocalDateString(selectedDate);
    
    try {
      // Fetch policy (max slots per chef)
      try {
        const policyRes = await fetch(`/api/portal/kitchens/${selectedKitchen.id}/policy?date=${date}`, {
          credentials: "include",
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
      const response = await fetch(`/api/portal/kitchens/${selectedKitchen.id}/slots?date=${date}`, {
        credentials: "include",
        cache: 'no-store',
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required');
        }
        if (response.status === 403) {
          throw new Error('Access denied. You can only access kitchens at your assigned location.');
        }
        throw new Error('Failed to load slots');
      }
      
      const slots = await response.json();
      
      // Filter out past times and times within minimum booking window
      const now = new Date();
      const [year, month, day] = date.split('-').map(Number);
      const selectedDateObj = new Date(year, month - 1, day);
      
      const filteredSlots = slots.filter((slot: Slot) => {
        const [hours, mins] = slot.time.split(':').map(Number);
        const slotTime = new Date(selectedDateObj);
        slotTime.setHours(hours, mins || 0, 0, 0);
        
        // If booking for today, check minimum booking window (1 hour default)
        if (selectedDateObj.toDateString() === now.toDateString()) {
          const hoursUntilBooking = (slotTime.getTime() - now.getTime()) / (1000 * 60 * 60);
          return hoursUntilBooking >= 1; // Minimum 1 hour in advance
        }
        
        return slotTime >= now;
      });
      
      setAllSlots(filteredSlots);
    } catch (error) {
      console.error('Error loading slots:', error);
      setAllSlots([]);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load available time slots. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingSlots(false);
    }
  };

  const handleKitchenSelect = (kitchen: Kitchen | null) => {
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

  const handleSlotClick = (slot: Slot) => {
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
    
    setIsSubmitting(true);
    
    try {
      const response = await fetch('/api/portal/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          kitchenId: selectedKitchen.id,
          bookingDate: bookingDate.toISOString(),
          startTime,
          endTime,
          specialNotes: notes,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to submit booking');
      }

      toast({
        title: "Booking Created!",
        description: `Your ${sortedSlots.length} hour${sortedSlots.length > 1 ? 's' : ''} kitchen booking has been submitted successfully.`,
      });
      
      setShowBookingModal(false);
      setSelectedSlots([]);
      setNotes("");
      
      // Reload slots to reflect the booking
      if (selectedDate) {
        loadAvailableSlots();
      }
      
    } catch (error: any) {
      toast({
        title: "Booking Failed",
        description: error.message || "Failed to create booking. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes || '00'} ${ampm}`;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  const calendarDays = selectedKitchen ? getCalendarDays(currentYear, currentMonth) : [];
  const isCurrentMonth = (date: Date) => date.getMonth() === currentMonth;
  const isToday = (date: Date) => date.toDateString() === today.toDateString();
  const isPast = (date: Date) => date < new Date(new Date().setHours(0, 0, 0, 0));

  if (!locationSlug) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Invalid Booking Portal</h1>
          <p className="text-gray-600">No location provided.</p>
        </div>
      </div>
    );
  }

  if (loadingLocation || loadingKitchens) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!locationData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Location Not Found</h1>
          <p className="text-gray-600">The requested location could not be found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {locationData.logoUrl && (
                <>
                  <img 
                    src={locationData.logoUrl} 
                    alt={`${locationData.name} logo`}
                    className="h-12 w-auto object-contain"
                  />
                  <span className="text-gray-400">×</span>
                </>
              )}
              <Logo className="h-10 w-auto" />
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{locationData.name}</h1>
                <p className="text-sm text-gray-600">Commercial Kitchen Booking</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header Section */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Book a Kitchen</h1>
          <p className="text-gray-600 text-lg">Reserve a professional kitchen space for your culinary needs</p>
        </div>

        {/* Location Info Card */}
        <div className="mb-8 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-200">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <MapPin className="h-6 w-6 text-blue-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 text-lg mb-1">{locationData.name}</h3>
              <p className="text-sm text-gray-600">{locationData.address}</p>
            </div>
          </div>
        </div>

        {/* Main Booking Flow */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Booking Steps */}
          <div className="lg:col-span-2 space-y-6">
            {/* Step 1: Kitchen Selection */}
            {!selectedKitchen ? (
              <Card className="border-2 shadow-lg">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600 font-bold text-lg">1</div>
                    <CardTitle className="text-2xl">Select a Kitchen</CardTitle>
                  </div>
                  <CardDescription>Choose from available commercial kitchens at this location</CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingKitchens ? (
                    <div className="text-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
                      <p className="text-gray-600">Loading kitchens...</p>
                    </div>
                  ) : kitchens && kitchens.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {kitchens.map((kitchen) => (
                        <button
                          key={kitchen.id}
                          onClick={() => handleKitchenSelect(kitchen)}
                          className="group p-6 rounded-xl border-2 border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all text-left"
                        >
                          <div className="flex items-center gap-3 mb-3">
                            <div className="p-2 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors">
                              <Building2 className="h-5 w-5 text-blue-600" />
                            </div>
                            <h4 className="font-semibold text-gray-900 group-hover:text-blue-600 text-lg">{kitchen.name}</h4>
                          </div>
                          {kitchen.description && (
                            <p className="text-sm text-gray-600 mb-4">{kitchen.description}</p>
                          )}
                          <div className="flex items-center gap-2 text-sm text-blue-600 font-medium">
                            <CalendarIcon className="h-4 w-4" />
                            Select Kitchen
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <Building2 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600">No kitchens available at this location.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Selected Kitchen Summary */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Building2 className="h-5 w-5 text-blue-600" />
                        <h3 className="font-semibold text-blue-900 text-lg">{selectedKitchen.name}</h3>
                      </div>
                      {selectedKitchen.description && (
                        <p className="text-sm text-blue-700">{selectedKitchen.description}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleKitchenSelect(null)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      Change
                    </Button>
                  </div>
                </div>

                {/* Step 2: Date Selection (Custom Calendar) */}
                <Card className="border-2 shadow-lg">
                  <CardHeader>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600 font-bold text-lg">2</div>
                      <CardTitle className="text-2xl">Choose a Date</CardTitle>
                    </div>
                    <CardDescription>Select your preferred booking date</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {/* Calendar Header */}
                    <div className="flex items-center justify-between mb-6">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigateMonth('prev')}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                      >
                        <ChevronLeft className="h-5 w-5 text-gray-600" />
                      </Button>
                      
                      <h3 className="text-xl font-bold text-gray-900">
                        {monthNames[currentMonth]} {currentYear}
                      </h3>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigateMonth('next')}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                      >
                        <ChevronRight className="h-5 w-5 text-gray-600" />
                      </Button>
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
                                aspect-square p-2 rounded-lg border-2 transition-all
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
                  </CardContent>
                </Card>

                {/* Step 3: Time Slot Selection */}
                {selectedDate && (
                  <Card className="border-2 shadow-lg">
                    <CardHeader>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600 font-bold text-lg">3</div>
                          <CardTitle className="text-2xl">Select Time Slots</CardTitle>
                        </div>
                        {selectedSlots.length > 0 && (
                          <Button
                            onClick={() => setShowBookingModal(true)}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            Continue
                            <Check className="h-4 w-4 ml-2" />
                          </Button>
                        )}
                      </div>
                      <CardDescription>Choose your preferred time slots (1 hour each)</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                        <p className="text-sm text-gray-700 mb-2">
                          <CalendarIcon className="inline h-4 w-4 mr-1 text-blue-600" />
                          <span className="font-semibold">{formatDate(selectedDate)}</span>
                        </p>
                        <p className="text-xs text-gray-600">
                          💡 Daily booking limit: {maxSlotsPerChef} {maxSlotsPerChef === 1 ? 'hour' : 'hours'} per user
                        </p>
                      </div>

                      {isLoadingSlots ? (
                        <div className="text-center py-12">
                          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
                          <p className="text-gray-600">Loading time slots...</p>
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
                                    
                                    {isSelected && (
                                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                                        <Check className="h-4 w-4 text-white" />
                                      </div>
                                    )}
                                  </div>
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
                    </CardContent>
                  </Card>
                )}

              </>
            )}
          </div>

          {/* Right Column - Booking Summary (if slots selected) */}
          {selectedKitchen && selectedDate && selectedSlots.length > 0 && (
            <div className="lg:col-span-1">
              <Card className="border-2 shadow-lg sticky top-24">
                <CardHeader>
                  <CardTitle>Booking Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">Kitchen</p>
                    <p className="text-base font-semibold text-gray-900">{selectedKitchen.name}</p>
                  </div>
                  
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">Date</p>
                    <p className="text-base font-semibold text-gray-900">{selectedDate && formatDate(selectedDate)}</p>
                  </div>
                  
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">Duration</p>
                    <p className="text-base font-semibold text-gray-900">
                      {selectedSlots.length} {selectedSlots.length === 1 ? 'hour' : 'hours'}
                    </p>
                  </div>

                  <div className="pt-4 border-t">
                    <p className="text-xs text-gray-500">
                      Your booking request will be reviewed by the kitchen manager.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Booking Modal - matches chef booking modal */}
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
                      {selectedSlots.length} {selectedSlots.length === 1 ? 'hour' : 'hours'}
                    </p>
                  </div>
                </div>

                {/* Time Range */}
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-xs text-gray-600 mb-2">Selected Time Slots</p>
                  <div className="flex items-center justify-center gap-2 flex-wrap">
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
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any special requirements or notes..."
                    rows={4}
                    maxLength={500}
                    className="w-full"
                  />
                  {notes && (
                    <p className="text-xs text-gray-500 mt-1">{notes.length}/500 characters</p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t">
                  <Button
                    variant="outline"
                    onClick={() => setShowBookingModal(false)}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button
                    onClick={handleBookingSubmit}
                    disabled={isSubmitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Confirm Booking
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}