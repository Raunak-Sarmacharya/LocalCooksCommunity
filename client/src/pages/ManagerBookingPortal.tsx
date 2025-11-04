import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar as CalendarIcon, Clock, MapPin, Building2, CheckCircle, AlertCircle, Loader2, ChevronLeft, ChevronRight, Check, Info, X } from "lucide-react";
import { useLocation } from "wouter";
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface AvailableSlot {
  time: string;
  available: boolean;
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
  
  // Step 3: Time Slot Selection
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  
  // Step 4: Booking Details
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookingName, setBookingName] = useState("");
  const [bookingEmail, setBookingEmail] = useState("");
  const [bookingPhone, setBookingPhone] = useState("");
  const [bookingCompany, setBookingCompany] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");
  const [showBookingModal, setShowBookingModal] = useState(false);

  // Extract location slug from URL (e.g., /portal/:locationSlug)
  const locationSlugMatch = locationPath.match(/\/portal\/([^/]+)/);
  const locationSlug = locationSlugMatch ? locationSlugMatch[1] : null;

  // Fetch location details by slug
  const { data: locationData, isLoading: loadingLocation } = useQuery<Location>({
    queryKey: [`/api/public/locations/${locationSlug}`],
    queryFn: async () => {
      const response = await fetch(`/api/public/locations/${locationSlug}`);
      if (!response.ok) throw new Error('Location not found');
      return response.json();
    },
    enabled: !!locationSlug,
  });

  // Fetch kitchens for location
  const { data: kitchens, isLoading: loadingKitchens } = useQuery<Kitchen[]>({
    queryKey: [`/api/public/locations/${locationSlug}/kitchens`],
    queryFn: async () => {
      const response = await fetch(`/api/public/locations/${locationSlug}/kitchens`);
      if (!response.ok) throw new Error('Failed to fetch kitchens');
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

  const loadAvailableSlots = async () => {
    if (!selectedKitchen || !selectedDate) return;
    
    setIsLoadingSlots(true);
    const dateStr = selectedDate.toISOString().split('T')[0];
    try {
      const response = await fetch(
        `/api/public/kitchens/${selectedKitchen.id}/availability?date=${dateStr}`
      );
      if (!response.ok) throw new Error('Failed to load availability');
      const data = await response.json();
      setAvailableSlots(data.slots || []);
    } catch (error) {
      console.error('Error loading slots:', error);
      setAvailableSlots([]);
      toast({
        title: "Error",
        description: "Failed to load available time slots. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingSlots(false);
    }
  };

  const handleKitchenSelect = (kitchen: Kitchen | null) => {
    setSelectedKitchen(kitchen);
    setSelectedDate(null);
    setSelectedSlot(null);
    setAvailableSlots([]);
    setShowBookingModal(false);
  };

  const handleDateClick = (date: Date) => {
    if (date < new Date(new Date().setHours(0, 0, 0, 0))) return; // Prevent past dates
    if (date.getMonth() !== currentMonth) return; // Only current month
    
    setSelectedDate(date);
    setSelectedSlot(null);
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
    setSelectedSlot(null);
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

  const handleSubmitBooking = async () => {
    if (!selectedKitchen || !selectedSlot || !selectedDate) {
      toast({
        title: "Missing Information",
        description: "Please select a kitchen, date, and time slot.",
        variant: "destructive",
      });
      return;
    }

    if (!bookingName || !bookingEmail) {
      toast({
        title: "Missing Information",
        description: "Please provide your name and email.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      // Calculate end time (30 minutes after start time)
      const [startHours, startMins] = selectedSlot.split(':').map(Number);
      const startTime = selectedSlot;
      const endTimeDate = new Date(selectedDate);
      endTimeDate.setHours(startHours, startMins + 30, 0, 0);
      const endTime = `${endTimeDate.getHours().toString().padStart(2, '0')}:${endTimeDate.getMinutes().toString().padStart(2, '0')}`;
      
      const bookingDate = selectedDate.toISOString().split('T')[0];
      
      const response = await fetch('/api/public/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: locationData?.id,
          kitchenId: selectedKitchen.id,
          bookingDate,
          startTime,
          endTime,
          bookingName,
          bookingEmail,
          bookingPhone,
          bookingCompany,
          specialNotes,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to submit booking');
      }

      toast({
        title: "Booking Submitted!",
        description: "Your booking request has been submitted. The kitchen manager will contact you shortly.",
      });

      // Reset form
      setShowBookingModal(false);
      setSelectedSlot(null);
      setBookingName("");
      setBookingEmail("");
      setBookingPhone("");
      setBookingCompany("");
      setSpecialNotes("");
      
      // Reload slots to reflect the booking
      if (selectedDate) {
        loadAvailableSlots();
      }
      
    } catch (error: any) {
      toast({
        title: "Booking Failed",
        description: error.message || "Failed to submit booking. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  const toLocalDateString = (d: Date) => {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

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
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600 font-bold text-lg">3</div>
                        <CardTitle className="text-2xl">Select Time Slot</CardTitle>
                      </div>
                      <CardDescription>Choose your preferred 30-minute time slot</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                        <p className="text-sm text-gray-700 mb-1">
                          <CalendarIcon className="inline h-4 w-4 mr-1 text-blue-600" />
                          <span className="font-semibold">{formatDate(selectedDate)}</span>
                        </p>
                      </div>

                      {isLoadingSlots ? (
                        <div className="text-center py-12">
                          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
                          <p className="text-gray-600">Loading time slots...</p>
                        </div>
                      ) : availableSlots.length === 0 ? (
                        <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg text-center">
                          <Info className="h-8 w-8 text-yellow-600 mx-auto mb-3" />
                          <p className="text-gray-800 font-medium mb-2">Kitchen Closed</p>
                          <p className="text-sm text-gray-600">
                            The kitchen manager has not set operating hours for this day.
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                          {availableSlots
                            .filter(slot => slot.available)
                            .map((slot) => {
                              const isSelected = selectedSlot === slot.time;
                              const [hours, mins] = slot.time.split(':').map(Number);
                              const endTime = new Date();
                              endTime.setHours(hours, mins + 30, 0, 0);
                              const endTimeStr = `${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`;
                              
                              return (
                                <button
                                  key={slot.time}
                                  type="button"
                                  onClick={() => {
                                    setSelectedSlot(slot.time);
                                    setShowBookingModal(true);
                                  }}
                                  className={`
                                    relative p-4 border-2 rounded-xl transition-all font-medium text-center
                                    ${isSelected 
                                      ? 'bg-blue-600 border-blue-600 text-white shadow-lg scale-105' 
                                      : 'bg-white border-gray-200 hover:border-blue-400 hover:bg-blue-50 text-gray-700 hover:scale-102'
                                    }
                                    cursor-pointer
                                  `}
                                >
                                  <div className="flex flex-col items-center gap-1">
                                    <div className="flex items-center gap-1">
                                      <Clock className="h-4 w-4" />
                                      <span className="text-lg font-semibold">{formatTime(slot.time)}</span>
                                    </div>
                                    <span className="text-xs opacity-80">
                                      - {formatTime(endTimeStr)}
                                    </span>
                                    {isSelected && (
                                      <div className="absolute top-1 right-1">
                                        <Check className="h-4 w-4" />
                                      </div>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                        </div>
                      )}
                      {availableSlots.filter(slot => slot.available).length === 0 && availableSlots.length > 0 && (
                        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-center">
                          <AlertCircle className="h-6 w-6 text-red-600 mx-auto mb-2" />
                          <p className="text-sm text-red-800 font-medium">All slots are fully booked for this date</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

              </>
            )}
          </div>

          {/* Right Column - Booking Summary */}
          {selectedKitchen && selectedDate && selectedSlot && (
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
                    <p className="text-sm font-medium text-gray-600 mb-1">Time</p>
                    <p className="text-base font-semibold text-gray-900">
                      {formatTime(selectedSlot)} - {(() => {
                        const [hours, mins] = selectedSlot.split(':').map(Number);
                        const endTime = new Date();
                        endTime.setHours(hours, mins + 30, 0, 0);
                        return formatTime(`${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`);
                      })()}
                    </p>
                  </div>

                  <div className="pt-4 border-t">
                    <p className="text-xs text-gray-500">
                      Your booking request will be reviewed by the kitchen manager. You will receive a confirmation email shortly.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Booking Modal */}
        {showBookingModal && selectedKitchen && selectedDate && selectedSlot && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowBookingModal(false);
              }
            }}
          >
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Confirm Your Booking</h2>
                <button
                  onClick={() => setShowBookingModal(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Close modal"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-6">
                {/* Kitchen */}
                <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                  <p className="text-xs text-gray-600 mb-1">Kitchen</p>
                  <p className="font-semibold text-gray-900 text-lg">{selectedKitchen.name}</p>
                  {selectedKitchen.description && (
                    <p className="text-xs text-gray-600 mt-1">{selectedKitchen.description}</p>
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
                    <p className="font-medium text-gray-900">30 minutes</p>
                  </div>
                </div>

                {/* Time Range */}
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-xs text-gray-600 mb-2">Selected Time Slot</p>
                  <div className="flex items-center justify-center gap-2">
                    <span className="px-4 py-2 bg-white border border-green-300 rounded-lg font-semibold text-green-800 text-lg">
                      {formatTime(selectedSlot)} - {(() => {
                        const [hours, mins] = selectedSlot.split(':').map(Number);
                        const endTime = new Date();
                        endTime.setHours(hours, mins + 30, 0, 0);
                        return formatTime(`${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`);
                      })()}
                    </span>
                  </div>
                </div>

                {/* Booking Details Form */}
                <div className="border-t pt-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Booking Details</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <Input
                        value={bookingName}
                        onChange={(e) => setBookingName(e.target.value)}
                        placeholder="John Doe"
                        required
                        className="h-11"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">
                        Email <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="email"
                        value={bookingEmail}
                        onChange={(e) => setBookingEmail(e.target.value)}
                        placeholder="john@example.com"
                        required
                        className="h-11"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">
                        Phone
                      </label>
                      <Input
                        type="tel"
                        value={bookingPhone}
                        onChange={(e) => setBookingPhone(e.target.value)}
                        placeholder="+1 (555) 123-4567"
                        className="h-11"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">
                        Company/Organization
                      </label>
                      <Input
                        value={bookingCompany}
                        onChange={(e) => setBookingCompany(e.target.value)}
                        placeholder="ABC Catering"
                        className="h-11"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Special Notes (Optional)
                    </label>
                    <Textarea
                      value={specialNotes}
                      onChange={(e) => setSpecialNotes(e.target.value)}
                      placeholder="Any special requirements or notes..."
                      rows={4}
                      maxLength={500}
                      className="w-full"
                    />
                    {specialNotes && (
                      <p className="text-xs text-gray-500 mt-1">{specialNotes.length}/500 characters</p>
                    )}
                  </div>
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
                    onClick={handleSubmitBooking}
                    disabled={isSubmitting || !bookingName || !bookingEmail}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
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
