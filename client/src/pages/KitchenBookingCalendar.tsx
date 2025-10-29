import { Calendar as CalendarIcon, Clock, MapPin, X, AlertCircle, Building } from "lucide-react";
import { useState } from "react";
import { useKitchenBookings } from "../hooks/use-kitchen-bookings";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { useToast } from "@/hooks/use-toast";

export default function KitchenBookingCalendar() {
  const { kitchens, bookings, isLoadingKitchens, isLoadingBookings, getAvailableSlots, createBooking, cancelBooking } = useKitchenBookings();
  const { toast } = useToast();
  const [selectedKitchen, setSelectedKitchen] = useState<any | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [endTime, setEndTime] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAvailableSlots = async (kitchenId: number, date: string) => {
    setIsLoadingSlots(true);
    setError(null);
    try {
      const slots = await getAvailableSlots(kitchenId, date);
      setAvailableSlots(slots);
    } catch (error) {
      console.error("Error loading slots:", error);
      setError("Failed to load available time slots. Please try again.");
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

  const handleKitchenChange = (kitchen: any) => {
    setSelectedKitchen(kitchen);
    loadAvailableSlots(kitchen.id, selectedDate);
  };

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    if (selectedKitchen) {
      loadAvailableSlots(selectedKitchen.id, date);
    }
  };

  const handleSlotClick = (slot: string) => {
    setSelectedSlot(slot);
    setEndTime("");
    setShowBookingForm(true);
  };

  const handleBookingSubmit = async () => {
    if (!selectedKitchen || !selectedSlot || !endTime) return;

    const bookingDate = new Date(selectedDate + "T00:00:00");
    const startTime = selectedSlot;
    
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
            title: "Booking Created",
            description: "Your kitchen booking request has been submitted successfully!",
          });
          setShowBookingForm(false);
          setSelectedSlot(null);
          setEndTime("");
          setNotes("");
          // Reload available slots to reflect the new booking
          loadAvailableSlots(selectedKitchen.id, selectedDate);
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

  const handleCancelBooking = async (bookingId: number) => {
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
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <div className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Book a Kitchen</h1>
            <p className="text-gray-600 mt-2">Select a kitchen and book from available time slots set by the kitchen manager</p>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {/* No Kitchens Available */}
          {!isLoadingKitchens && kitchens.length === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
              <Building className="h-12 w-12 text-yellow-600 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">No Kitchens Available</h2>
              <p className="text-gray-600">
                There are currently no commercial kitchens set up by managers. 
                Please check back later or contact support.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Kitchen Selection & Calendar */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Select Kitchen</h2>
            {isLoadingKitchens ? (
              <p className="text-gray-500">Loading kitchens...</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {kitchens.map((kitchen) => (
                  <button
                    key={kitchen.id}
                    onClick={() => handleKitchenChange(kitchen)}
                    className={`p-4 rounded-lg border text-left transition-colors ${
                      selectedKitchen?.id === kitchen.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <h3 className="font-semibold text-gray-900">{kitchen.name}</h3>
                    {kitchen.description && (
                      <p className="text-sm text-gray-600 mt-1">{kitchen.description}</p>
                    )}
                  </button>
                ))}
              </div>
            )}

            {selectedKitchen && (
              <div className="mt-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Select Date & Time
                </h3>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <CalendarIcon className="inline h-4 w-4 mr-1" />
                    Date
                  </label>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => handleDateChange(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>

                {isLoadingSlots ? (
                  <p className="text-gray-500">Loading available slots...</p>
                ) : availableSlots.length === 0 ? (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-gray-700 font-medium">No available slots for this date</p>
                    <p className="text-sm text-gray-600 mt-1">The kitchen manager has not set availability for this day, or all slots are booked.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {availableSlots.map((slot) => (
                      <button
                        key={slot}
                        onClick={() => handleSlotClick(slot)}
                        className="p-3 border border-gray-300 rounded-lg hover:bg-blue-50 hover:border-blue-500 transition-colors"
                      >
                        <Clock className="inline h-4 w-4 mr-1 text-gray-600" />
                        {formatTime(slot)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* My Bookings */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">My Bookings</h2>
            {isLoadingBookings ? (
              <p className="text-gray-500">Loading bookings...</p>
            ) : bookings.length === 0 ? (
              <p className="text-gray-500">No bookings yet</p>
            ) : (
              <div className="space-y-4">
                {bookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="p-4 border border-gray-200 rounded-lg"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
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
                        </div>
                        <p className="text-sm text-gray-600">
                          <CalendarIcon className="inline h-4 w-4 mr-1" />
                          {formatDate(booking.bookingDate)}
                        </p>
                        <p className="text-sm text-gray-600 mt-1">
                          <Clock className="inline h-4 w-4 mr-1" />
                          {formatTime(booking.startTime)} - {formatTime(booking.endTime)}
                        </p>
                        {booking.specialNotes && (
                          <p className="text-sm text-gray-600 mt-2">
                            <span className="font-medium">Notes:</span> {booking.specialNotes}
                          </p>
                        )}
                      </div>
                      {booking.status !== "cancelled" && (
                        <button
                          onClick={() => handleCancelBooking(booking.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Booking Form Sidebar */}
        {showBookingForm && selectedKitchen && selectedSlot && (
          <div className="bg-white rounded-lg shadow p-6 sticky top-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Complete Booking</h2>
              <button
                onClick={() => setShowBookingForm(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-700">Kitchen</p>
                <p className="text-gray-900">{selectedKitchen.name}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Date</p>
                <p className="text-gray-900">{formatDate(selectedDate)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Start Time</p>
                <p className="text-gray-900">{formatTime(selectedSlot)}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  End Time *
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  min={selectedSlot}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Special Notes (Optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="Any special requirements..."
                />
              </div>
              {createBooking.isError && (
                <div className="p-3 bg-red-100 text-red-800 rounded text-sm">
                  {createBooking.error?.message || "Failed to create booking"}
                </div>
              )}
              <button
                onClick={handleBookingSubmit}
                disabled={!endTime || createBooking.isPending}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {createBooking.isPending ? "Booking..." : "Confirm Booking"}
              </button>
            </div>
          </div>
        )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

