import { useQuery } from "@tanstack/react-query";

interface Location {
  id: number;
  name: string;
  address: string;
  managerId?: number;
  createdAt: string;
  updatedAt: string;
}

interface Kitchen {
  id: number;
  locationId: number;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface KitchenAvailability {
  id: number;
  kitchenId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

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

export function useManagerDashboard() {
  // Get manager's locations
  const locationsQuery = useQuery<Location[]>({
    queryKey: ["/api/manager/locations"],
    queryFn: async () => {
      const response = await fetch("/api/manager/locations", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch locations");
      return response.json();
    },
  });

  // Get kitchens for a location
  const getKitchensForLocation = async (locationId: number) => {
    const response = await fetch(`/api/manager/kitchens/${locationId}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch kitchens");
    return response.json();
  };

  // Get all kitchens (across all locations for this manager)
  const kitchensQuery = useQuery<Kitchen[]>({
    queryKey: ["/api/manager/all-kitchens"],
    queryFn: async () => {
      const locations = locationsQuery.data || [];
      if (locations.length === 0) return [];
      
      const allKitchens = await Promise.all(
        locations.map(location => getKitchensForLocation(location.id))
      );
      
      return allKitchens.flat();
    },
    enabled: !!locationsQuery.data && locationsQuery.data.length > 0,
  });

  // Get all bookings for manager
  const bookingsQuery = useQuery<Booking[]>({
    queryKey: ["/api/manager/bookings"],
    queryFn: async () => {
      const response = await fetch("/api/manager/bookings", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch bookings");
      return response.json();
    },
  });

  // Get kitchen availability
  const getKitchenAvailability = async (kitchenId: number) => {
    const response = await fetch(`/api/manager/availability/${kitchenId}`, {
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch availability");
    return response.json();
  };

  // Set kitchen availability
  const setKitchenAvailability = async (
    kitchenId: number,
    dayOfWeek: number,
    startTime: string,
    endTime: string,
    isAvailable: boolean
  ) => {
    const response = await fetch("/api/manager/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        kitchenId,
        dayOfWeek,
        startTime,
        endTime,
        isAvailable,
      }),
    });
    if (!response.ok) throw new Error("Failed to set availability");
    return response.json();
  };

  return {
    locations: locationsQuery.data || [],
    isLoadingLocations: locationsQuery.isLoading,
    kitchens: kitchensQuery.data || [],
    isLoadingKitchens: kitchensQuery.isLoading,
    bookings: bookingsQuery.data || [],
    isLoadingBookings: bookingsQuery.isLoading,
    getKitchensForLocation,
    getKitchenAvailability,
    setKitchenAvailability,
    refetchBookings: bookingsQuery.refetch,
  };
}


