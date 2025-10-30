import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface Booking {
  id: number;
  chefId: number;
  kitchenId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
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
  specialNotes?: string;
}

interface Kitchen {
  id: number;
  locationId: number;
  name: string;
  description?: string;
  isActive: boolean;
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

  // Get chef's bookings with real-time polling
  const bookingsQuery = useQuery<Booking[]>({
    queryKey: ["/api/chef/bookings"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/bookings", {
        credentials: "include",
        headers,
      });
      if (!response.ok) throw new Error("Failed to fetch bookings");
      
      const rawData = await response.json();
      
      // Normalize snake_case to camelCase (matching pattern used elsewhere in app)
      // This ensures compatibility regardless of what Drizzle returns
      const normalizedBookings = (Array.isArray(rawData) ? rawData : []).map((booking: any) => ({
        id: booking.id,
        chefId: booking.chef_id || booking.chefId,
        kitchenId: booking.kitchen_id || booking.kitchenId,
        bookingDate: booking.booking_date || booking.bookingDate,
        startTime: booking.start_time || booking.startTime,
        endTime: booking.end_time || booking.endTime,
        status: booking.status,
        specialNotes: booking.special_notes || booking.specialNotes,
        createdAt: booking.created_at || booking.createdAt,
        updatedAt: booking.updated_at || booking.updatedAt,
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
          location,
        };
      });
      
      return normalized;
    },
  });

  // Get available time slots for a kitchen on a specific date
  const getAvailableSlots = async (kitchenId: number, date: string): Promise<string[]> => {
    const headers = await getAuthHeaders();
    const response = await fetch(
      `/api/chef/kitchens/${kitchenId}/availability?date=${date}`,
      { credentials: "include", headers }
    );
    if (!response.ok) throw new Error("Failed to fetch available slots");
    return response.json();
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
        const error = await response.json();
        throw new Error(error.error || "Failed to create booking");
      }
      return response.json();
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
        const error = await response.json();
        throw new Error(error.error || "Failed to cancel booking");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chef/bookings"] });
    },
  });

  return {
    bookings: bookingsQuery.data || [],
    isLoadingBookings: bookingsQuery.isLoading,
    kitchens: kitchensQuery.data || [],
    isLoadingKitchens: kitchensQuery.isLoading,
    kitchensQuery, // Expose the full query object for error handling
    getAvailableSlots,
    createBooking,
    cancelBooking,
    refetchBookings: bookingsQuery.refetch,
  };
}


