import { Calendar as CalendarIcon, Clock, MapPin, X, AlertCircle, Building, ChevronLeft, ChevronRight, Check, Info } from "lucide-react";
import { useState, useEffect } from "react";
import { useKitchenBookings } from "../hooks/use-kitchen-bookings";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { useToast } from "@/hooks/use-toast";

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
  
  // Step 1: Kitchen Selection
  const [selectedKitchen, setSelectedKitchen] = useState<any | null>(null);
  
  // Step 2: Date Selection (Calendar View)
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  
  // Step 3: Time Slot Selection
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  
  // Step 4: Booking Details
  const [endTime, setEndTime] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [showBookingModal, setShowBookingModal] = useState(false);

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  // Load available slots when date changes
  useEffect(() => {
    if (selectedKitchen && selectedDate) {
      loadAvailableSlots(selectedKitchen.id, selectedDate.toISOString().split('T')[0]);
    }
  }, [selectedKitchen, selectedDate]);

  const loadAvailableSlots = async (kitchenId: number, date: string) => {
    setIsLoadingSlots(true);
    try {
      const slots = await getAvailableSlots(kitchenId, date);
      console.log('📅 Available slots for', date, ':', slots);
      setAvailableSlots(slots);
      if (slots.length === 0) {
        toast({
          title: "No slots available",
          description: "This date has no available booking slots.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error loading slots:", error);
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

  const handleKitchenSelect = (kitchen: any) => {
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

  const handleSlotClick = (slot: string) => {
    setSelectedSlot(slot);
    setEndTime("");
    setNotes("");
    setShowBookingModal(true);
  };

  const handleBookingSubmit = async () => {
    if (!selectedKitchen || !selectedDate || !selectedSlot || !endTime) return;

    // Validate end time is after start time
    if (endTime <= selectedSlot) {
      toast({
        title: "Invalid Time Range",
        description: "End time must be after start time.",
        variant: "destructive",
      });
      return;
    }

    const bookingDate = new Date(selectedDate);
    bookingDate.setHours(0, 0, 0, 0);
    
    createBooking.mutate(
      {
        kitchenId: selectedKitchen.id,
        bookingDate: bookingDate.toISOString(),
        startTime: selectedSlot,
        endTime,
        specialNotes: notes,
      },
      {
        onSuccess: () => {
          toast({
            title: "Booking Created!",
            description: "Your kitchen booking request has been submitted successfully.",
          });
          setShowBookingModal(false);
          setSelectedSlot(null);
          setEndTime("");
          setNotes("");
          // Reload available slots
          if (selectedDate) {
            loadAvailableSlots(selectedKitchen.id, selectedDate.toISOString().split('T')[0]);
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
                        <div className="flex items-center gap-2 mb-6">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 font-semibold">3</div>
                          <h2 className="text-xl font-bold text-gray-900">Select Time</h2>
                        </div>

                        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                          <p className="text-sm text-gray-600">
                            <CalendarIcon className="inline h-4 w-4 mr-1" />
                            {formatDate(selectedDate)}
                          </p>
                        </div>

                        {isLoadingSlots ? (
                          <div className="text-center py-12">
                            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <p className="text-gray-600 mt-3">Loading available slots...</p>
                          </div>
                        ) : availableSlots.length === 0 ? (
                          <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg text-center">
                            <Info className="h-8 w-8 text-yellow-600 mx-auto mb-3" />
                            <p className="text-gray-800 font-medium mb-2">No Available Slots</p>
                            <p className="text-sm text-gray-600">
                              The kitchen manager has not set availability for this day, or all slots are fully booked.
                            </p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                            {availableSlots.map((slot) => (
                              <button
                                key={slot}
                                onClick={() => handleSlotClick(slot)}
                                className={`
                                  p-3 border-2 rounded-lg transition-all font-medium
                                  ${selectedSlot === slot
                                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                                    : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-700'
                                  }
                                `}
                              >
                                <Clock className="inline h-4 w-4 mr-1" />
                                {formatTime(slot)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Right Column - My Bookings */}
              <div className="lg:col-span-1">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sticky top-4">
                  <h2 className="text-xl font-bold text-gray-900 mb-4">My Bookings</h2>
                  {isLoadingBookings ? (
                    <p className="text-gray-500 text-center py-8">Loading bookings...</p>
                  ) : bookings.length === 0 ? (
                    <div className="text-center py-8">
                      <CalendarIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500">No bookings yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[600px] overflow-y-auto">
                      {bookings.slice(0, 5).map((booking) => (
                        <div
                          key={booking.id}
                          className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                booking.status === "confirmed"
                                  ? "bg-green-100 text-green-800"
                                  : booking.status === "pending"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-gray-100 text-gray-800"
                              }`}
                            >
                              {booking.status.toUpperCase()}
                            </span>
                            {booking.status !== "cancelled" && (
                              <button
                                onClick={() => {
                                  if (window.confirm("Are you sure you want to cancel this booking?")) {
                                    cancelBooking.mutate(booking.id);
                                  }
                                }}
                                className="text-red-600 hover:text-red-800"
                                aria-label="Cancel booking"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          <p className="text-sm text-gray-900 font-medium mb-1">
                            {new Date(booking.bookingDate).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })}
                          </p>
                          <p className="text-sm text-gray-600">
                            <Clock className="inline h-3 w-3 mr-1" />
                            {formatTime(booking.startTime)} - {formatTime(booking.endTime)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
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
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Complete Booking</h2>
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
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-600 mb-1">Kitchen</p>
                  <p className="font-medium text-gray-900">{selectedKitchen.name}</p>
                </div>

                {/* Date & Start Time */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">Date</p>
                    <p className="font-medium text-gray-900">
                      {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">Start Time</p>
                    <p className="font-medium text-gray-900">{formatTime(selectedSlot)}</p>
                  </div>
                </div>

                {/* End Time */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    End Time <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    min={selectedSlot}
                    required
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 text-lg font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    step="900"
                  />
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
                    Cancel
                  </button>
                  <button
                    onClick={handleBookingSubmit}
                    disabled={!endTime || createBooking.isPending}
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
