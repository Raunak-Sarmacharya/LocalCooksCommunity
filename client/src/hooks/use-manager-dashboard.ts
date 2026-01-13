import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "./use-auth";
import { auth } from "@/lib/firebase";
import type { User as FirebaseUser } from "firebase/auth";

interface Location {
  id: number;
  name: string;
  address: string;
  managerId?: number;
  createdAt: string;
  updatedAt: string;
  // Kitchen license fields
  kitchenLicenseUrl?: string;
  kitchenLicenseStatus?: string;
  kitchenLicenseApprovedBy?: number;
  kitchenLicenseApprovedAt?: string;
  kitchenLicenseFeedback?: string;
  kitchenLicenseExpiry?: string;
  // Additional location fields
  logoUrl?: string;
  brandImageUrl?: string;
  notificationEmail?: string;
  notificationPhone?: string;
  timezone?: string;
  cancellationPolicyHours?: number;
  cancellationPolicyMessage?: string;
  defaultDailyBookingLimit?: number;
  minimumBookingWindowHours?: number;
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
  const { user: firebaseUser } = useFirebaseAuth();
  
  const getAuthHeaders = async (): Promise<HeadersInit> => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    
    // Get Firebase token if user is authenticated
    const currentFirebaseUser: FirebaseUser | null = auth.currentUser;
    if (currentFirebaseUser) {
      try {
        const token = await currentFirebaseUser.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      } catch (error) {
        console.error('Error getting Firebase token:', error);
      }
    }
    
    return headers;
  };

  // Get manager's locations
  const locationsQuery = useQuery<Location[]>({
    queryKey: ["/api/manager/locations"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/manager/locations", {
        credentials: "include",
        headers,
      });
      if (!response.ok) {
        let errorMessage = "Failed to fetch locations";
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
    },
  });

  // Get kitchens for a location
  const getKitchensForLocation = async (locationId: number) => {
    const headers = await getAuthHeaders();
    const response = await fetch(`/api/manager/kitchens/${locationId}`, {
      credentials: "include",
      headers,
    });
    if (!response.ok) {
      let errorMessage = "Failed to fetch kitchens";
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
      const headers = await getAuthHeaders();
      const response = await fetch("/api/manager/bookings", {
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
      return contentType && contentType.includes('application/json')
        ? await response.json()
        : [];
    },
  });

  // Get kitchen availability
  const getKitchenAvailability = async (kitchenId: number) => {
    const headers = await getAuthHeaders();
    const response = await fetch(`/api/manager/availability/${kitchenId}`, {
      credentials: "include",
      headers,
    });
    if (!response.ok) {
      let errorMessage = "Failed to fetch availability";
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

  // Set kitchen availability
  const setKitchenAvailability = async (
    kitchenId: number,
    dayOfWeek: number,
    startTime: string,
    endTime: string,
    isAvailable: boolean
  ) => {
    const headers = await getAuthHeaders();
    const response = await fetch("/api/manager/availability", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        kitchenId,
        dayOfWeek,
        startTime,
        endTime,
        isAvailable,
      }),
    });
    if (!response.ok) {
      let errorMessage = "Failed to set availability";
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


