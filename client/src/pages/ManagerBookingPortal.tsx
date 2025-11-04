import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Clock, MapPin, Building2, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import CalendarComponent from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import Logo from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { slugify } from "@/utils/slugify";

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

export default function ManagerBookingPortal() {
  const [locationPath] = useLocation();
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedKitchen, setSelectedKitchen] = useState<Kitchen | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Form fields for third-party booking
  const [bookingName, setBookingName] = useState("");
  const [bookingEmail, setBookingEmail] = useState("");
  const [bookingPhone, setBookingPhone] = useState("");
  const [bookingCompany, setBookingCompany] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");

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
    if (!selectedKitchen) return;
    
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
    }
  };

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    
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

      const result = await response.json();
      
      toast({
        title: "Booking Submitted!",
        description: "Your booking request has been submitted. The kitchen manager will contact you shortly.",
      });

      // Reset form
      setSelectedSlot(null);
      setBookingName("");
      setBookingEmail("");
      setBookingPhone("");
      setBookingCompany("");
      setSpecialNotes("");
      
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
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
            </div>
            <div className="text-right">
              <h1 className="text-lg font-semibold text-gray-900">{locationData.name}</h1>
              <p className="text-sm text-gray-600">Commercial Kitchen Booking</p>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="bg-white rounded-lg shadow-lg p-6 md:p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Book a Kitchen</h2>
            <p className="text-gray-600">
              Select a kitchen, date, and time slot to submit your booking request.
            </p>
          </div>

          {/* Location Info */}
          <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">{locationData.name}</p>
                <p className="text-sm text-gray-600">{locationData.address}</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmitBooking} className="space-y-6">
            {/* Step 1: Select Kitchen */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Select Kitchen
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {kitchens?.map((kitchen) => (
                  <button
                    key={kitchen.id}
                    type="button"
                    onClick={() => {
                      setSelectedKitchen(kitchen);
                      setSelectedSlot(null);
                    }}
                    className={`p-4 border-2 rounded-lg text-left transition-all ${
                      selectedKitchen?.id === kitchen.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Building2 className="h-4 w-4 text-gray-600" />
                      <span className="font-medium text-gray-900">{kitchen.name}</span>
                    </div>
                    {kitchen.description && (
                      <p className="text-sm text-gray-600">{kitchen.description}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {selectedKitchen && (
              <>
                {/* Step 2: Select Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Select Date
                  </label>
                  <div className="flex justify-center">
                    <CalendarComponent
                      onChange={(value: any) => setSelectedDate(new Date(value))}
                      value={selectedDate}
                      minDate={new Date()}
                      className="rounded-lg border border-gray-200"
                    />
                  </div>
                </div>

                {/* Step 3: Select Time Slot */}
                {availableSlots.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Select Start Time (30-minute slots)
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {availableSlots
                        .filter(slot => slot.available)
                        .map((slot) => {
                          // Calculate end time for display (30 minutes after start)
                          const [hours, mins] = slot.time.split(':').map(Number);
                          const endTime = new Date();
                          endTime.setHours(hours, mins + 30, 0, 0);
                          const endTimeStr = `${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`;
                          
                          return (
                            <button
                              key={slot.time}
                              type="button"
                              onClick={() => setSelectedSlot(slot.time)}
                              className={`p-3 border-2 rounded-lg text-sm transition-all ${
                                selectedSlot === slot.time
                                  ? 'border-blue-500 bg-blue-50 text-blue-900'
                                  : 'border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              <Clock className="h-4 w-4 inline mr-1" />
                              {slot.time} - {endTimeStr}
                            </button>
                          );
                        })}
                    </div>
                    {availableSlots.filter(slot => slot.available).length === 0 && (
                      <p className="text-sm text-gray-500 mt-2">No available slots for this date. Please select another date.</p>
                    )}
                  </div>
                )}
                {availableSlots.length === 0 && selectedKitchen && (
                  <div className="text-center py-4">
                    <p className="text-sm text-gray-500">No available slots for this date. Please select another date.</p>
                  </div>
                )}

                {/* Step 4: Booking Details */}
                {selectedSlot && (
                  <div className="border-t pt-6 space-y-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Booking Details</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">
                          Full Name <span className="text-red-500">*</span>
                        </label>
                        <Input
                          value={bookingName}
                          onChange={(e) => setBookingName(e.target.value)}
                          placeholder="John Doe"
                          required
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">
                          Email <span className="text-red-500">*</span>
                        </label>
                        <Input
                          type="email"
                          value={bookingEmail}
                          onChange={(e) => setBookingEmail(e.target.value)}
                          placeholder="john@example.com"
                          required
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">
                          Phone
                        </label>
                        <Input
                          type="tel"
                          value={bookingPhone}
                          onChange={(e) => setBookingPhone(e.target.value)}
                          placeholder="+1 (555) 123-4567"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-1">
                          Company/Organization
                        </label>
                        <Input
                          value={bookingCompany}
                          onChange={(e) => setBookingCompany(e.target.value)}
                          placeholder="ABC Catering"
                        />
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-1">
                        Special Notes
                      </label>
                      <Textarea
                        value={specialNotes}
                        onChange={(e) => setSpecialNotes(e.target.value)}
                        placeholder="Any special requirements or notes..."
                        rows={3}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Submit Button */}
            {selectedKitchen && selectedSlot && (
              <div className="pt-6 border-t">
                <Button
                  type="submit"
                  disabled={isSubmitting || !bookingName || !bookingEmail}
                  className="w-full md:w-auto px-8"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Submit Booking Request
                    </>
                  )}
                </Button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

