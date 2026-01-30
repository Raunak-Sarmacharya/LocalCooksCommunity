import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useState, useEffect } from "react";

interface Booking {
  id: number;
  chefId: number;
  kitchenId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  selectedSlots?: Array<string | { startTime: string; endTime: string }>; // Discrete time slots
  status: "pending" | "confirmed" | "cancelled";
  specialNotes?: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateBookingData {
  kitchenId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  selectedSlots?: Array<{ startTime: string; endTime: string }>; // Array of discrete 1-hour time slots
  specialNotes?: string;
  paymentIntentId?: string;
  selectedStorage?: Array<{
    storageListingId: number;
    startDate: string; // ISO date string
    endDate: string;   // ISO date string
  }>;
  selectedEquipmentIds?: number[];
}

interface Kitchen {
  id: number;
  locationId: number;
  name: string;
  description?: string;
  isActive: boolean;
  taxRatePercent?: number;
}

// Helper function to get Firebase auth headers
async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const { auth } = await import('@/lib/firebase');
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        'Authorization': `Bearer ${token}`,
      };
    }
  } catch (error) {
    console.error('Error getting Firebase token:', error);
  }
  return {};
}

export function useKitchenBookings() {
  const queryClient = useQueryClient();
  
  // Track auth initialization state to prevent queries from running before auth is ready
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [hasAuthUser, setHasAuthUser] = useState(false);

  // Wait for Firebase auth to initialize before enabling queries
  // onAuthStateChanged fires immediately with current auth state, then on changes
  useEffect(() => {
    // Set up auth state listener - this fires immediately with current state
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // Auth is ready once this callback fires (even if user is null)
      setIsAuthReady(true);
      setHasAuthUser(!!user);
    });

    // Cleanup listener on unmount
    return () => unsubscribe();
  }, []);

  // Get chef's bookings with real-time polling
  const bookingsQuery = useQuery<Booking[]>({
    queryKey: ["/api/chef/bookings"],
    // Only fetch when auth is ready and user is authenticated
    enabled: isAuthReady && hasAuthUser,
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/bookings", {
        credentials: "include",
        headers,
      });
      if (!response.ok) {
        let errorMessage = "Failed to fetch bookings";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (jsonError) {
          try {
            const text = await response.text();
            errorMessage = text || `Server returned ${response.status} ${response.statusText}`;
          } catch (textError) {
            errorMessage = `Server returned ${response.status} ${response.statusText}`;
          }
        }
        throw new Error(errorMessage);
      }
      
      const contentType = response.headers.get('content-type');
      let rawData;
      if (contentType && contentType.includes('application/json')) {
        rawData = await response.json();
      } else {
        const text = await response.text();
        rawData = text ? JSON.parse(text) : [];
      }
      
      // Normalize snake_case to camelCase (matching pattern used elsewhere in app)
      // This ensures compatibility regardless of what Drizzle returns
      // IMPORTANT: Preserve location object with cancellation policy information
      const normalizedBookings = (Array.isArray(rawData) ? rawData : []).map((booking: any) => ({
        id: booking.id,
        chefId: booking.chef_id || booking.chefId,
        kitchenId: booking.kitchen_id || booking.kitchenId,
        bookingDate: booking.booking_date || booking.bookingDate,
        startTime: booking.start_time || booking.startTime,
        endTime: booking.end_time || booking.endTime,
        selectedSlots: booking.selected_slots || booking.selectedSlots || [], // Discrete time slots for non-contiguous bookings
        status: booking.status,
        specialNotes: booking.special_notes || booking.specialNotes,
        createdAt: booking.created_at || booking.createdAt,
        updatedAt: booking.updated_at || booking.updatedAt,
        // Preserve location data with cancellation policy
        location: booking.location ? {
          id: booking.location.id,
          name: booking.location.name,
          cancellationPolicyHours: booking.location.cancellationPolicyHours ?? booking.location.cancellation_policy_hours ?? 24,
          cancellationPolicyMessage: booking.location.cancellationPolicyMessage || booking.location.cancellation_policy_message || `Bookings cannot be cancelled within ${booking.location.cancellationPolicyHours ?? booking.location.cancellation_policy_hours ?? 24} hours of the scheduled time.`,
        } : undefined,
        // Preserve other location-related fields
        locationName: booking.locationName || booking.location_name,
        locationTimezone: booking.locationTimezone || booking.location_timezone,
        kitchenName: booking.kitchenName || booking.kitchen_name,
      }));
      
      return normalizedBookings;
    },
    // Real-time polling configuration - similar to other parts of the app
    refetchInterval: (data) => {
      if (!data || !Array.isArray(data)) return 10000; // 10 seconds if no data

      // Check if there are pending bookings (manager might be reviewing)
      const hasPendingBookings = data.some((b: Booking) => b.status === "pending");

      // Check if there are upcoming confirmed bookings (manager might cancel/reschedule)
      const hasUpcomingBookings = data.some((b: Booking) => {
        const bookingDate = new Date(`${b.bookingDate}T${b.startTime}`);
        return bookingDate >= new Date() && b.status === "confirmed";
      });

      if (hasPendingBookings) {
        // Very frequent updates when bookings are pending (manager might approve/reject)
        return 5000; // 5 seconds - very aggressive for immediate updates
      } else if (hasUpcomingBookings) {
        // Moderate frequency for upcoming bookings (manager might modify)
        return 15000; // 15 seconds
      } else {
        // Less frequent when no active bookings
        return 30000; // 30 seconds
      }
    },
    refetchIntervalInBackground: true, // Keep refetching even when tab is not active
    refetchOnWindowFocus: true, // Refetch when user comes back to the tab
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnReconnect: true, // Refetch when network reconnects
    staleTime: 0, // Consider data stale immediately - always check for updates
    gcTime: 10000, // Keep in cache for only 10 seconds
  });

  // Get all available kitchens
  const kitchensQuery = useQuery<Kitchen[]>({
    queryKey: ["/api/chef/kitchens"],
    // Only fetch when auth is ready and user is authenticated
    enabled: isAuthReady && hasAuthUser,
    queryFn: async () => {
      const headers = await getAuthHeaders();
      
      const response = await fetch("/api/chef/kitchens", {
        credentials: "include",
        headers,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to fetch kitchens. Status:', response.status);
        console.error('❌ Error response:', errorText);
        throw new Error(`Failed to fetch kitchens: ${response.status} ${response.statusText}`);
      }
      
      const kitchens = await response.json();
      
      // If backend doesn't provide location names, fetch them separately
      const needsLocationFetch = Array.isArray(kitchens) && kitchens.length > 0 && 
        !kitchens[0].locationName && !kitchens[0].location;
      
      if (needsLocationFetch) {
        // Fetch all locations from chef endpoint
        const locationsResponse = await fetch("/api/chef/locations", {
          credentials: "include",
          headers,
        });
        
        const locations = locationsResponse.ok ? await locationsResponse.json() : [];
        
        // Enrich kitchens with location data
        return (Array.isArray(kitchens) ? kitchens : []).map((k: any) => {
          const locationId = k.locationId ?? k.location_id;
          const location = locations.find((loc: any) => loc.id === locationId);
          
          return {
            ...k,
            taxRatePercent: k.taxRatePercent ?? k.tax_rate_percent,
            locationId,
            locationName: location?.name,
            locationAddress: location?.address,
            location: location ? {
              id: location.id,
              name: location.name,
              address: location.address,
            } : undefined,
          };
        });
      }
      
      // Normalize: ensure location object exists using flattened fields if needed
      const normalized = (Array.isArray(kitchens) ? kitchens : []).map((k: any) => {
        const location = k.location || ((k.locationName || k.locationAddress) ? {
          id: k.locationId ?? k.location_id,
          name: k.locationName ?? k.location_name,
          address: k.locationAddress ?? k.location_address,
        } : undefined);
        
        return {
          ...k,
          taxRatePercent: k.taxRatePercent ?? k.tax_rate_percent,
          location,
        };
      });
      
      return normalized;
    },
    // Add refetch options to retry when auth becomes available
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // Get available time slots for a kitchen on a specific date
  const getAvailableSlots = async (kitchenId: number, date: string): Promise<string[]> => {
    const headers = await getAuthHeaders();
    const response = await fetch(
      `/api/chef/kitchens/${kitchenId}/availability?date=${date}`,
      { credentials: "include", headers }
    );
    if (!response.ok) {
      let errorMessage = "Failed to fetch available slots";
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch (jsonError) {
        try {
          const text = await response.text();
          errorMessage = text || `Server returned ${response.status} ${response.statusText}`;
        } catch (textError) {
          errorMessage = `Server returned ${response.status} ${response.statusText}`;
        }
      }
      throw new Error(errorMessage);
    }
    const contentType = response.headers.get('content-type');
    return contentType && contentType.includes('application/json')
      ? await response.json()
      : [];
  };

  // Create a booking
  const createBooking = useMutation({
    mutationFn: async (data: CreateBookingData) => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/bookings", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...headers,
        },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        let errorMessage = "Failed to create booking";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (jsonError) {
          try {
            const text = await response.text();
            errorMessage = text || `Server returned ${response.status} ${response.statusText}`;
          } catch (textError) {
            errorMessage = `Server returned ${response.status} ${response.statusText}`;
          }
        }
        throw new Error(errorMessage);
      }
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chef/bookings"] });
    },
  });

  // Cancel a booking
  const cancelBooking = useMutation({
    mutationFn: async (bookingId: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/chef/bookings/${bookingId}/cancel`, {
        method: "PUT",
        credentials: "include",
        headers,
      });
      if (!response.ok) {
        let errorMessage = "Failed to cancel booking";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (jsonError) {
          try {
            const text = await response.text();
            errorMessage = text || `Server returned ${response.status} ${response.statusText}`;
          } catch (textError) {
            errorMessage = `Server returned ${response.status} ${response.statusText}`;
          }
        }
        throw new Error(errorMessage);
      }
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chef/bookings"] });
    },
  });

  return {
    bookings: bookingsQuery.data ?? [],
    isLoadingBookings: bookingsQuery.isLoading,
    kitchens: kitchensQuery.data ?? [],
    isLoadingKitchens: kitchensQuery.isLoading,
    kitchensQuery, // Expose the full query object for error handling
    getAvailableSlots,
    createBooking,
    cancelBooking,
    refetchBookings: bookingsQuery.refetch,
  };
}


