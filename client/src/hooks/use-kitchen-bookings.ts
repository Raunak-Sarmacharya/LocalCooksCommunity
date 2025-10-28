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

export function useKitchenBookings() {
  const queryClient = useQueryClient();

  // Get chef's bookings
  const bookingsQuery = useQuery<Booking[]>({
    queryKey: ["/api/chef/bookings"],
    queryFn: async () => {
      const response = await fetch("/api/chef/bookings", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch bookings");
      return response.json();
    },
  });

  // Get all available kitchens
  const kitchensQuery = useQuery<Kitchen[]>({
    queryKey: ["/api/chef/kitchens"],
    queryFn: async () => {
      const response = await fetch("/api/chef/kitchens", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch kitchens");
      return response.json();
    },
  });

  // Get available time slots for a kitchen on a specific date
  const getAvailableSlots = async (kitchenId: number, date: string): Promise<string[]> => {
    const response = await fetch(
      `/api/chef/kitchens/${kitchenId}/availability?date=${date}`,
      { credentials: "include" }
    );
    if (!response.ok) throw new Error("Failed to fetch available slots");
    return response.json();
  };

  // Create a booking
  const createBooking = useMutation({
    mutationFn: async (data: CreateBookingData) => {
      const response = await fetch("/api/chef/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const response = await fetch(`/api/chef/bookings/${bookingId}/cancel`, {
        method: "PUT",
        credentials: "include",
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
    getAvailableSlots,
    createBooking,
    cancelBooking,
    refetchBookings: bookingsQuery.refetch,
  };
}


