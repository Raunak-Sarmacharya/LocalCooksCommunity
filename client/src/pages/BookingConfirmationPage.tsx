import { Calendar as CalendarIcon, Clock, MapPin, X, AlertCircle, Building, ChevronLeft, ChevronRight, Check, Info, Package, Wrench, DollarSign, ChefHat, ArrowLeft, CreditCard, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { useState, useEffect, useMemo, useRef } from "react";
import { useKitchenBookings } from "../hooks/use-kitchen-bookings";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useStoragePricing } from "@/hooks/use-storage-pricing";
import { useQuery } from "@tanstack/react-query";

export default function BookingConfirmationPage() {
  const [location, setLocation] = useLocation();
  const { kitchens, createBooking } = useKitchenBookings();
  const { toast } = useToast();


  
  // Get query parameters from URL
  const searchParams = new URLSearchParams(window.location.search);
  const kitchenId = searchParams.get('kitchenId') ? parseInt(searchParams.get('kitchenId')!) : null;
  const dateStr = searchParams.get('date');
  const slotsStr = searchParams.get('slots');
  const storageStr = searchParams.get('storage');
  const equipmentStr = searchParams.get('equipment');
  const notesParam = searchParams.get('notes') || '';

  // Parse data from URL - use useMemo to prevent recreating arrays on every render
  const selectedDate = useMemo(() => dateStr ? new Date(dateStr) : null, [dateStr]);
  const selectedSlots = useMemo(() => slotsStr ? slotsStr.split(',') : [], [slotsStr]);
  const selectedStorage = useMemo(() => storageStr ? JSON.parse(decodeURIComponent(storageStr)).map((s: any) => ({
    storageListingId: s.storageListingId,
    startDate: s.startDate ? new Date(s.startDate) : new Date(),
    endDate: s.endDate ? new Date(s.endDate) : new Date(),
  })) : [], [storageStr]);
  const selectedEquipmentIds = useMemo(() => equipmentStr ? equipmentStr.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [], [equipmentStr]);
  const [notes, setNotes] = useState(notesParam);

  // Find selected kitchen
  const selectedKitchen = useMemo(() => {
    if (!kitchenId || !kitchens) return null;
    return kitchens.find((k: any) => k.id === kitchenId) || null;
  }, [kitchenId, kitchens]);

  // Pricing state
  const [kitchenPricing, setKitchenPricing] = useState<{
    hourlyRate: number | null;
    currency: string;
    minimumBookingHours: number;
    taxRatePercent?: number;
  } | null>(null);

  // Payment state
  const [isRedirectingToCheckout, setIsRedirectingToCheckout] = useState(false);
  const [estimatedPrice, setEstimatedPrice] = useState<{
    basePrice: number;
    tax: number;
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
  const lastFetchedKitchenIdRef = useRef<number | null>(null);
  const lastFetchedSlotsCountRef = useRef<number>(0);

  // Load kitchen pricing and addons
  useEffect(() => {
    if (!selectedKitchen || isLoadingAddons) return; // Prevent multiple simultaneous fetches

    // Check if we've already fetched for this kitchen and slot count
    const kitchenId = selectedKitchen.id;
    const slotsCount = selectedSlots.length;
    if (lastFetchedKitchenIdRef.current === kitchenId && lastFetchedSlotsCountRef.current === slotsCount) {
      return; // Already fetched this data
    }

    let isCancelled = false; // Flag to prevent state updates if component unmounts or effect re-runs

    const loadKitchenData = async () => {
      setIsLoadingAddons(true);
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
          // ignore
        }

        if (!authHeader) {
          const token = localStorage.getItem('firebaseToken');
          if (token) authHeader = `Bearer ${token}`;
        }

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authHeader) headers['Authorization'] = authHeader;

        // Fetch pricing
        const pricingRes = await fetch(`/api/chef/kitchens/${selectedKitchen.id}/pricing`, {
          credentials: "include",
          headers,
          cache: 'no-store',
        });

        if (pricingRes.ok) {
          const pricing = await pricingRes.json();
          // API returns cents
          let hourlyRateCents = pricing.hourlyRate;
          if (typeof hourlyRateCents === 'string') {
            hourlyRateCents = parseFloat(hourlyRateCents);
          }
          const hourlyRate = hourlyRateCents || null;
          
          if (!isCancelled) {
            setKitchenPricing({
              hourlyRate,
              currency: pricing.currency || 'CAD',
              minimumBookingHours: pricing.minimumBookingHours || 1,
              taxRatePercent: pricing.taxRatePercent || 0,
            });

            // Calculate estimated price in CENTS
            if (hourlyRate && selectedSlots.length > 0) {
              const basePrice = hourlyRate * selectedSlots.length;
              // basePrice is already in cents
              
              const taxRatePercent = pricing.taxRatePercent || 0;
              const tax = Math.round((basePrice * taxRatePercent) / 100);
              
              setEstimatedPrice({
                basePrice,
                tax,
                totalPrice: basePrice + tax,
                durationHours: selectedSlots.length,
              });
            }
          }
        }

        // Fetch storage listings
        const storageRes = await fetch(`/api/chef/kitchens/${selectedKitchen.id}/storage-listings`, {
          credentials: "include",
          headers,
          cache: 'no-store',
        });

        if (storageRes.ok) {
          const storageData = await storageRes.json();
          if (!isCancelled) {
            // Keep values in cents - formatCurrency and useStoragePricing expect cents
            setStorageListings(storageData || []);
          }
        } else {
          if (!isCancelled) {
            setStorageListings([]);
          }
        }

        // Fetch equipment listings
        const equipmentRes = await fetch(`/api/chef/kitchens/${selectedKitchen.id}/equipment-listings`, {
          credentials: "include",
          headers,
          cache: 'no-store',
        });

        if (equipmentRes.ok) {
          const equipmentData = await equipmentRes.json();
          if (!isCancelled) {
            setEquipmentListings(equipmentData);
          }
        } else {
          if (!isCancelled) {
            setEquipmentListings({ all: [], included: [], rental: [] });
          }
        }
      } catch (error) {
        console.error('Error fetching kitchen data:', error);
      } finally {
        if (!isCancelled) {
          setIsLoadingAddons(false);
          // Mark as fetched
          lastFetchedKitchenIdRef.current = kitchenId;
          lastFetchedSlotsCountRef.current = slotsCount;
        }
      }
    };

    loadKitchenData();

    // Cleanup function
    return () => {
      isCancelled = true;
    };
  }, [selectedKitchen?.id, selectedSlots.length]); // Only depend on kitchen ID and slots length, not the arrays themselves

  // Calculate storage pricing
  const storagePricing = useStoragePricing(selectedStorage, storageListings);

  // Calculate equipment pricing
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

  // Calculate combined subtotal (in CENTS)
  // All values are in CENTS for consistency with formatCurrency
  const combinedSubtotal = useMemo(() => {
    const kitchenBase = estimatedPrice?.basePrice || 0; // Already in cents
    // Storage and equipment pricing are already in cents from the API
    const storageBaseCents = storagePricing.subtotal || 0;
    const equipmentBaseCents = equipmentPricing.subtotal || 0;
    return kitchenBase + storageBaseCents + equipmentBaseCents;
  }, [estimatedPrice?.basePrice, storagePricing.subtotal, equipmentPricing.subtotal]);

  // Calculate tax on combined subtotal
  const tax = useMemo(() => {
    const subtotalCents = combinedSubtotal;
    if (subtotalCents <= 0) return 0;
    
    // Tax rate is stored as a percentage
    // If not set, default to 0
    const taxRatePercent = selectedKitchen?.taxRatePercent || 0;
    
    // Calculate tax: (subtotal * taxRate) / 100
    // Result is in cents
    return Math.round((subtotalCents * taxRatePercent) / 100);
  }, [combinedSubtotal, selectedKitchen?.taxRatePercent]);

  // Calculate grand total
  const grandTotal = useMemo(() => {
    return combinedSubtotal + tax;
  }, [combinedSubtotal, tax]);

  // Helper functions
  const formatTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':');
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

  const toLocalDateString = (d: Date) => {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Format date string from URL (YYYY-MM-DD) to display format
  const formatDateFromString = (dateStr: string | null) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Redirect to Stripe Checkout
  const redirectToStripeCheckout = async () => {
    if (!selectedKitchen || !selectedDate || selectedSlots.length === 0) return;

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

      // Use dateStr directly from URL to avoid timezone issues
      const bookingDateStr = dateStr || toLocalDateString(selectedDate);
      const [year, month, day] = bookingDateStr.split('-').map(Number);
      const bookingDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

      // Get auth headers
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
          selectedSlots: [...selectedSlots].sort().map(slot => {
            const [h, m] = slot.split(':').map(Number);
            const endMins = h * 60 + m + 60;
            const endH = Math.floor(endMins / 60);
            const endM = endMins % 60;
            return {
              startTime: slot,
              endTime: `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`
            };
          }), // Pass discrete time slots with start and end times
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
        // Safety: ensure Radix UI hasn't left pointer-events:none on body
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


  // Handle booking submission for free bookings (no payment required)
  const handleBookingSubmit = async () => {
    if (!selectedKitchen || !selectedDate || selectedSlots.length === 0) return;

    const sortedSlots = [...selectedSlots].sort();
    const startTime = sortedSlots[0];
    // Calculate endTime from the last slot (each slot is 1 hour)
    const lastSlot = sortedSlots[sortedSlots.length - 1];
    const [lastH, lastM] = lastSlot.split(':').map(Number);
    const endTotalMins = lastH * 60 + lastM + 60; // Add 1 hour to last slot start
    const endHours = Math.floor(endTotalMins / 60);
    const endMins = endTotalMins % 60;
    const endTime = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`;

    // Use dateStr directly from URL to avoid timezone issues
    const bookingDateStr = dateStr || toLocalDateString(selectedDate);
    const [year, month, day] = bookingDateStr.split('-').map(Number);
    const bookingDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

    createBooking.mutate(
      {
        kitchenId: selectedKitchen.id,
        bookingDate: bookingDate.toISOString(),
        startTime,
        endTime,
        selectedSlots: [...selectedSlots].sort().map(slot => {
          const [h, m] = slot.split(':').map(Number);
          const endMins = h * 60 + m + 60;
          const endH = Math.floor(endMins / 60);
          const endM = endMins % 60;
          return {
            startTime: slot,
            endTime: `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`
          };
        }), // Pass discrete time slots with start and end times
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
          const addonsCount = selectedEquipmentIds.length;
          const addonsMsg = addonsCount > 0 ? ` with ${addonsCount} equipment add-on${addonsCount > 1 ? 's' : ''}` : '';
          toast({
            title: "Booking Created!",
            description: `Your ${selectedSlots.length} hour${selectedSlots.length > 1 ? 's' : ''} kitchen booking${addonsMsg} has been submitted successfully.`,
          });
          setLocation('/book-kitchen');
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

  const handleBack = () => {
    // Go back to booking page with preserved state
    const params = new URLSearchParams();
    if (kitchenId) params.set('kitchenId', kitchenId.toString());
    if (dateStr) params.set('date', dateStr);
    if (slotsStr) params.set('slots', slotsStr);
    if (storageStr) params.set('storage', storageStr);
    if (equipmentStr) params.set('equipment', equipmentStr);
    if (notes) params.set('notes', notes);
    setLocation(`/book-kitchen?${params.toString()}`);
  };

  // Validation
  if (!kitchenId || !selectedDate || selectedSlots.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="flex-1 pt-24 pb-8">
          <div className="max-w-4xl mx-auto px-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="text-center">
                <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Invalid Booking Data</h2>
                <p className="text-gray-600 mb-4">Missing required booking information.</p>
                <button
                  onClick={() => setLocation('/book-kitchen')}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
                >
                  Go to Booking Page
                </button>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!selectedKitchen) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="flex-1 pt-24 pb-8">
          <div className="max-w-4xl mx-auto px-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
                <p className="text-gray-600">Loading kitchen information...</p>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="flex-1 pt-24 pb-8">
        <div className="max-w-2xl mx-auto px-4">
          <div className="bg-white rounded-xl shadow-2xl w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Confirm Your Booking</h2>
              <button
                onClick={handleBack}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Kitchen */}
              <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                <p className="text-xs text-gray-600 mb-1">Kitchen</p>
                <p className="font-semibold text-gray-900 text-lg">{selectedKitchen.name}</p>
                {((selectedKitchen as any).locationName) && (
                  <p className="text-xs text-gray-600 mt-1">
                    📍 {(selectedKitchen as any).locationName}
                  </p>
                )}
              </div>

              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-600 mb-1">Date</p>
                  <p className="font-medium text-gray-900">
                    {formatDateFromString(dateStr)}
                  </p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-600 mb-1">Duration</p>
                  <p className="font-medium text-gray-900">
                    {selectedSlots.length} hour{selectedSlots.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              {/* Time Range */}
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <p className="text-xs text-gray-600 mb-2">Booking Time</p>
                <div className="text-center mb-3">
                  <span className="text-lg font-bold text-green-800">
                    {getBookingTimeRange()}
                  </span>
                  <span className="text-sm text-green-600 ml-2">
                    ({selectedSlots.length} hour{selectedSlots.length > 1 ? 's' : ''})
                  </span>
                </div>
                
                <p className="text-xs text-gray-500 mb-2 text-center">Time Blocks:</p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {[...selectedSlots].sort().map((slot, idx) => (
                    <div key={slot} className="flex items-center gap-1">
                      <span className="px-2 py-1 bg-white border border-green-300 rounded text-sm font-medium text-green-800">
                        {formatSlotRange(slot)}
                      </span>
                      {idx < selectedSlots.length - 1 && (
                        <span className="text-green-400 text-xs">+</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Complete Pricing Breakdown */}
              {selectedKitchen && (
                <div className="p-4 bg-gradient-to-br from-gray-50 to-blue-50 border-2 border-blue-200 rounded-lg">
                  <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-blue-600" />
                    Booking Summary & Pricing
                  </h3>
                  
                  <div className="space-y-4">
                    {/* GROUP 1: Kitchen Booking + Equipment Add-ons */}
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-lg border-2 border-blue-200">
                      <h3 className="text-base font-bold text-blue-900 mb-3 flex items-center gap-2">
                        <ChefHat className="h-5 w-5" />
                        Kitchen Booking & Add-ons
                      </h3>
                      
                      <div className="space-y-3">
                        {/* Kitchen Booking Pricing */}
                        {estimatedPrice && kitchenPricing && kitchenPricing.hourlyRate ? (
                          <div className="bg-white p-3 rounded-lg border border-blue-200">
                            <h4 className="text-sm font-semibold text-gray-800 mb-2">Kitchen Booking</h4>
                            <div className="space-y-1.5 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-600">Base Price ({selectedSlots.length} hour{selectedSlots.length !== 1 ? 's' : ''} × {formatCurrency(kitchenPricing.hourlyRate)}/hour):</span>
                                <span className="font-medium text-gray-900">{formatCurrency(estimatedPrice.basePrice)} {kitchenPricing.currency}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-white p-3 rounded-lg border border-blue-200">
                            <div className="text-sm text-gray-600">
                              {!kitchenPricing || !kitchenPricing.hourlyRate ? (
                                <div className="space-y-2">
                                  <p className="text-amber-600 font-medium flex items-center gap-2">
                                    <Info className="h-4 w-4" />
                                    Pricing not set for this kitchen
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    The manager needs to set an hourly rate in the Manager Dashboard → Pricing tab. 
                                    This booking will be free until pricing is configured.
                                  </p>
                                  <p className="text-xs text-gray-600 mt-2">
                                    Duration: {selectedSlots.length} hour{selectedSlots.length !== 1 ? 's' : ''}
                                  </p>
                                </div>
                              ) : (
                                <p>Calculating price...</p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Equipment Add-ons */}
                        {equipmentPricing.items.length > 0 && (
                          <div className="bg-white p-3 rounded-lg border border-amber-200">
                            <h4 className="text-sm font-semibold text-amber-800 mb-2 flex items-center gap-2">
                              <Wrench className="h-4 w-4" />
                              Equipment Add-ons
                            </h4>
                            <div className="space-y-2 text-sm">
                              {equipmentPricing.items.map((item) => {
                                // Find the full equipment object to get photos
                                const equipment = equipmentListings.rental.find((e: any) => e.id === item.id);
                                return (
                                  <div key={item.id} className="flex justify-between items-center gap-3">
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                      {/* Equipment Image */}
                                      {equipment?.photos && equipment.photos.length > 0 && (
                                        <div className="flex-shrink-0">
                                          <img
                                            src={equipment.photos[0]}
                                            alt={item.name}
                                            className="w-12 h-12 object-cover rounded border border-gray-200"
                                            onError={(e) => {
                                              e.currentTarget.style.display = 'none';
                                            }}
                                          />
                                        </div>
                                      )}
                                      <span className="text-gray-700 flex items-center gap-1">
                                        <Wrench className="h-3 w-3 text-amber-600 flex-shrink-0" />
                                        {item.name}
                                      </span>
                                    </div>
                                    <span className="font-medium text-amber-700 flex-shrink-0">{formatCurrency(item.rate)}</span>
                                  </div>
                                );
                              })}
                              <div className="pt-2 mt-2 border-t border-amber-200 flex justify-between">
                                <span className="font-semibold text-amber-800">Equipment Subtotal (base price only):</span>
                                <span className="font-bold text-amber-900">{formatCurrency(equipmentPricing.subtotal)}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* GROUP 2: Storage Bookings */}
                    {storagePricing.items.length > 0 && (
                      <div className="bg-gradient-to-br from-purple-50 to-pink-50 p-4 rounded-lg border-2 border-purple-200">
                        <h3 className="text-base font-bold text-purple-900 mb-3 flex items-center gap-2">
                          <Package className="h-5 w-5" />
                          Storage Bookings
                        </h3>
                        <div className="bg-white p-3 rounded-lg border border-purple-200">
                          <div className="space-y-2 text-sm">
                            {storagePricing.items.map((item, idx) => (
                              <div key={idx} className="pb-2 border-b border-purple-100 last:border-0 last:pb-0">
                                <div className="flex justify-between items-start mb-1 gap-3">
                                  <div className="flex items-start gap-2 flex-1 min-w-0">
                                    {/* Storage Image */}
                                    {item.listing.photos && item.listing.photos.length > 0 && (
                                      <div className="flex-shrink-0">
                                        <img
                                          src={item.listing.photos[0]}
                                          alt={item.listing.name}
                                          className="w-12 h-12 object-cover rounded border border-gray-200"
                                          onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                          }}
                                        />
                                      </div>
                                    )}
                                    <span className="text-gray-700 flex items-center gap-1">
                                      <Package className="h-3 w-3 text-purple-600 flex-shrink-0" />
                                      {item.listing.name}
                                    </span>
                                  </div>
                                  <span className="font-medium text-purple-700 flex-shrink-0">{formatCurrency(item.basePrice)}</span>
                                </div>
                                <div className="text-xs text-gray-600 ml-4">
                                  {item.days} day{item.days > 1 ? 's' : ''} × {formatCurrency(item.listing.basePrice)}/day
                                </div>
                              </div>
                            ))}
                            <div className="pt-2 mt-2 border-t border-purple-200 flex justify-between">
                              <span className="font-semibold text-purple-800">Storage Subtotal (base price only):</span>
                              <span className="font-bold text-purple-900">{formatCurrency(storagePricing.subtotal)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Combined Subtotal & Tax */}
                    {combinedSubtotal > 0 && (
                      <div className="bg-white p-3 rounded-lg border-2 border-gray-300">
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="font-semibold text-gray-900">Combined Subtotal (Kitchen + Equipment + Storage):</span>
                            <span className="font-bold text-gray-900">{formatCurrency(combinedSubtotal)} {kitchenPricing?.currency || 'CAD'}</span>
                          </div>
                          {tax > 0 && (
                            <div className="flex justify-between border-t border-gray-200 pt-2 mt-2">
                              <span className="text-gray-600">
                                {`Tax ${kitchenPricing?.taxRatePercent ? `(${kitchenPricing.taxRatePercent}%)` : ''}:`}
                              </span>
                              <span className="font-medium text-gray-900">{formatCurrency(tax)} {kitchenPricing?.currency || 'CAD'}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Grand Total */}
                    {grandTotal > 0 && (
                      <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-4 rounded-lg border-2 border-blue-800 shadow-lg">
                        <div className="flex justify-between items-center">
                          <span className="text-lg font-bold text-white">Grand Total:</span>
                          <span className="text-2xl font-extrabold text-white">
                            {formatCurrency(grandTotal)} {kitchenPricing?.currency || 'CAD'}
                          </span>
                        </div>
                        {(storagePricing.subtotal > 0 || equipmentPricing.subtotal > 0) && (
                          <p className="text-xs text-blue-100 mt-2">
                            Includes kitchen booking, storage, and equipment add-ons
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

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
                  onClick={handleBack}
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
                <button
                  onClick={grandTotal > 0 ? redirectToStripeCheckout : handleBookingSubmit}
                  disabled={createBooking.isPending || isRedirectingToCheckout}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {createBooking.isPending || isRedirectingToCheckout ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {isRedirectingToCheckout ? 'Redirecting to checkout...' : 'Booking...'}
                    </span>
                  ) : grandTotal > 0 ? (
                    <>
                      <CreditCard className="h-4 w-4" />
                      Proceed to Checkout
                    </>
                  ) : (
                    "Confirm Booking"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

