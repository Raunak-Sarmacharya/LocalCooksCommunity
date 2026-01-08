import { Calendar as CalendarIcon, Clock, Save, Settings, Trash2, Plus, X, ChevronLeft, ChevronRight, Copy, CheckCircle2, AlertCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useManagerDashboard } from "../hooks/use-manager-dashboard";
import { useToast } from "@/hooks/use-toast";
import ManagerHeader from "@/components/layout/ManagerHeader";
import Footer from "@/components/layout/Footer";

interface DateAvailability {
  id: number;
  kitchenId: number;
  specificDate: string;
  startTime: string | null;
  endTime: string | null;
  isAvailable: boolean;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Booking {
  id: number;
  kitchenId: number;
  chefId: number;
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  // Get Firebase token for authentication
  const { auth } = await import('@/lib/firebase');
  const currentFirebaseUser = auth.currentUser;
  if (currentFirebaseUser) {
    try {
      const token = await currentFirebaseUser.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    } catch (error) {
      console.error('Error getting Firebase token:', error);
    }
  }
  
  return headers;
}

// Helper to get days in month
function getDaysInMonth(year: number, month: number) {
  const date = new Date(year, month, 1);
  const days = [];
  while (date.getMonth() === month) {
    days.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
}

// Helper to get calendar grid with previous/next month padding
function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startingDayOfWeek = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  
  const days: (Date | null)[] = [];
  
  // Add empty cells for days before month starts
  for (let i = 0; i < startingDayOfWeek; i++) {
    const prevDate = new Date(year, month, -startingDayOfWeek + i + 1);
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

interface KitchenAvailabilityManagementProps {
  embedded?: boolean;
}

export default function KitchenAvailabilityManagement({ embedded = false }: KitchenAvailabilityManagementProps = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, isLoadingLocations } = useManagerDashboard();
  
  // Initialize from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const urlLocationId = urlParams.get('location');
  const urlKitchenId = urlParams.get('kitchen');
  
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(
    urlLocationId ? parseInt(urlLocationId) : null
  );
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(
    urlKitchenId ? parseInt(urlKitchenId) : null
  );
  const [kitchens, setKitchens] = useState<any[]>([]);
  
  // Calendar navigation
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showBlockHoursSection, setShowBlockHoursSection] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    startTime: "09:00",
    endTime: "17:00",
    isAvailable: true,
    reason: "",
    maxSlotsPerChef: 2,
  });

  // Block hours form state
  const [blockHoursForm, setBlockHoursForm] = useState({
    startTime: "11:00",
    endTime: "13:00",
    reason: "",
  });


  // Auto-select location if only one exists
  useEffect(() => {
    if (!isLoadingLocations && locations.length === 1 && !selectedLocationId) {
      setSelectedLocationId(locations[0].id);
    }
  }, [locations, isLoadingLocations, selectedLocationId]);

  // Load kitchens when location is selected
  useEffect(() => {
    if (selectedLocationId) {
      (async () => {
        const headers = await getAuthHeaders();
        return fetch(`/api/manager/kitchens/${selectedLocationId}`, { credentials: "include", headers });
      })()
        .then(res => res.json())
        .then(data => {
          setKitchens(data);
          // Auto-select kitchen if only one exists or from URL if provided
          if (urlKitchenId && data.length > 0) {
            const kitchenId = parseInt(urlKitchenId);
            if (!isNaN(kitchenId)) {
              const kitchenExists = data.some((k: any) => k.id === kitchenId);
              if (kitchenExists) {
                setSelectedKitchenId(kitchenId);
              }
            }
          } else if (data.length === 1 && !selectedKitchenId) {
            // Auto-select if only one kitchen
            setSelectedKitchenId(data[0].id);
          }
        })
        .catch(() => {});
    } else {
      setKitchens([]);
      setSelectedKitchenId(null);
    }
  }, [selectedLocationId, urlKitchenId, selectedKitchenId]);

  // Fetch weekly availability schedule for selected kitchen
  const { data: weeklyAvailability = [] } = useQuery({
    queryKey: ['weeklyAvailability', selectedKitchenId],
    queryFn: async () => {
      if (!selectedKitchenId) return [];
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/availability/${selectedKitchenId}`, {
        headers,
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'Failed to fetch weekly availability');
      }
      return response.json();
    },
    enabled: !!selectedKitchenId,
    staleTime: 60000,
  });

  // Fetch date availability for selected kitchen
  const { data: dateAvailability = [], isLoading: isLoadingAvailability, error: availabilityError } = useQuery({
    queryKey: ['dateAvailability', selectedKitchenId],
    queryFn: async () => {
      if (!selectedKitchenId) return [];
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/kitchens/${selectedKitchenId}/date-overrides`, {
        headers,
        credentials: "include",
      });
      if (!response.ok) {
        // If 404, it might just mean no date overrides exist yet - that's OK
        if (response.status === 404) {
          console.log('No date overrides found - returning empty array');
          return [];
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'Failed to fetch date availability');
      }
      const data = await response.json();
      // Empty array is valid - means no date overrides set yet
      console.log(`✅ Loaded ${Array.isArray(data) ? data.length : 0} date overrides`);
      return data;
    },
    enabled: !!selectedKitchenId,
    staleTime: 30000, // Consider data fresh for 30 seconds
    retry: 2, // Retry failed requests twice
  });

  // Fetch bookings for selected kitchen
  const { data: kitchenBookings = [], isLoading: isLoadingBookings, error: bookingsError } = useQuery({
    queryKey: ['kitchenBookings', selectedKitchenId],
    queryFn: async () => {
      if (!selectedKitchenId) return [];
      const headers = await getAuthHeaders();
      console.log(`🔍 Fetching bookings for kitchen ${selectedKitchenId}`);
      
      const response = await fetch(`/api/manager/kitchens/${selectedKitchenId}/bookings`, {
        headers,
        credentials: "include",
      });
      
      console.log(`📡 Bookings API response status: ${response.status}`);
      
      if (!response.ok) {
        // If 404, it might mean no bookings exist - that's OK
        if (response.status === 404) {
          console.log('No bookings endpoint or no bookings found - returning empty array');
          return [];
        }
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ Bookings API error:', errorData);
        throw new Error(errorData.message || errorData.error || 'Failed to fetch bookings');
      }
      
      const data = await response.json();
      console.log(`✅ Loaded ${Array.isArray(data) ? data.length : 0} bookings`);
      return data;
    },
    enabled: !!selectedKitchenId,
    staleTime: 10000, // Consider data fresh for 10 seconds
    retry: 2, // Retry failed requests twice
  });

  // Create date availability mutation
  const createAvailability = useMutation({
    mutationFn: async (data: any) => {
      if (!selectedKitchenId) throw new Error('No kitchen selected');
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/kitchens/${selectedKitchenId}/date-overrides`, {
        method: 'POST',
        headers,
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        let errorMessage = 'Failed to create date availability';
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
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
      queryClient.invalidateQueries({ queryKey: ['dateAvailability', selectedKitchenId] });
      queryClient.invalidateQueries({ queryKey: ['kitchenBookings', selectedKitchenId] });
      setShowEditModal(false);
      resetForm();
      toast({
        title: "Success",
        description: "Availability saved successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update date availability mutation
  const updateAvailability = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/date-overrides/${id}`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        let errorMessage = 'Failed to update date availability';
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
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
      queryClient.invalidateQueries({ queryKey: ['dateAvailability', selectedKitchenId] });
      queryClient.invalidateQueries({ queryKey: ['kitchenBookings', selectedKitchenId] });
      setShowEditModal(false);
      resetForm();
      toast({
        title: "Success",
        description: "Availability updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete date availability mutation
  const deleteAvailability = useMutation({
    mutationFn: async (id: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/date-overrides/${id}`, {
        method: 'DELETE',
        headers,
        credentials: "include",
      });
      if (!response.ok) {
        let errorMessage = 'Failed to delete date availability';
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
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
      queryClient.invalidateQueries({ queryKey: ['dateAvailability', selectedKitchenId] });
      queryClient.invalidateQueries({ queryKey: ['kitchenBookings', selectedKitchenId] });
      toast({
        title: "Success",
        description: "Availability removed successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      startTime: "09:00",
      endTime: "17:00",
      isAvailable: true,
      reason: "",
      maxSlotsPerChef: 2,
    });
  };

  // Format a Date to local YYYY-MM-DD (avoids UTC date shifting)
  const toLocalYMD = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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
  };

  const getAvailabilityForDate = (date: Date | null): DateAvailability[] => {
    if (!date) return [];
    const dateStr = toLocalYMD(date);
    
    const matches = (dateAvailability as any[]).filter((avail: any) => {
      try {
        // Handle both camelCase and snake_case field names
        const specificDate = avail.specificDate ?? avail.specific_date;
        
        if (!specificDate) return false;
        
        // Handle both plain YYYY-MM-DD strings and date objects/ISOs
        if (typeof specificDate === 'string') {
          // If backend returned plain date (YYYY-MM-DD), compare directly
          if (/^\d{4}-\d{2}-\d{2}$/.test(specificDate)) {
            return specificDate === dateStr;
          }
          // For ISO strings like "2025-12-20T00:00:00.000Z", extract just the date part
          // This avoids timezone conversion issues
          if (specificDate.includes('T')) {
            const isoDatePart = specificDate.split('T')[0];
            return isoDatePart === dateStr;
          }
          // Fallback: parse and compare as local YMD
          const parsed = new Date(specificDate);
          return toLocalYMD(parsed) === dateStr;
        } else {
          return toLocalYMD(specificDate as Date) === dateStr;
        }
      } catch (e) {
        console.error('Error parsing date:', avail, e);
        return false;
      }
    });
    
    return matches;
  };

  const getBookingsForDate = (date: Date | null): Booking[] => {
    if (!date) return [];
    const dateStr = toLocalYMD(date);
    return (kitchenBookings as Booking[]).filter((booking: Booking) => {
      const bookingDateStr = toLocalYMD(new Date(booking.bookingDate));
      return bookingDateStr === dateStr;
    });
  };

  // Helper to get availability status for a date (open/closed + hours)
  const getDateAvailabilityStatus = (date: Date | null): { isOpen: boolean; hours: string | null; isExplicitlyClosed: boolean } => {
    if (!date) return { isOpen: false, hours: null, isExplicitlyClosed: false };
    
    const dateOverrides = getAvailabilityForDate(date);
    const dayOfWeek = date.getDay();
    
    // Check for date-specific overrides first (highest priority)
    if (dateOverrides.length > 0) {
      // Check if explicitly closed
      const closedOverride = dateOverrides.find((a: any) => !(a.isAvailable ?? a.is_available));
      if (closedOverride) {
        return { isOpen: false, hours: null, isExplicitlyClosed: true };
      }
      
      // Check for open override with hours
      const openOverride = dateOverrides.find((a: any) => 
        (a.isAvailable ?? a.is_available) && 
        (a.startTime ?? a.start_time) && 
        (a.endTime ?? a.end_time)
      );
      if (openOverride) {
        const start = (openOverride.startTime ?? (openOverride as any).start_time)?.slice(0, 5) || '';
        const end = (openOverride.endTime ?? (openOverride as any).end_time)?.slice(0, 5) || '';
        return { 
          isOpen: true, 
          hours: `${formatTimeDisplay(start)} - ${formatTimeDisplay(end)}`, 
          isExplicitlyClosed: false 
        };
      }
    }
    
    // Fall back to weekly schedule
    const daySchedule = (weeklyAvailability as any[]).find((a: any) => 
      (a.dayOfWeek ?? a.day_of_week) === dayOfWeek
    );
    
    if (daySchedule && (daySchedule.isAvailable ?? daySchedule.is_available)) {
      const start = (daySchedule.startTime ?? daySchedule.start_time)?.slice(0, 5) || '';
      const end = (daySchedule.endTime ?? daySchedule.end_time)?.slice(0, 5) || '';
      return { 
        isOpen: true, 
        hours: `${formatTimeDisplay(start)} - ${formatTimeDisplay(end)}`, 
        isExplicitlyClosed: false 
      };
    }
    
    // No schedule or explicitly closed in weekly schedule
    return { isOpen: false, hours: null, isExplicitlyClosed: false };
  };

  // Helper to format time for display (e.g., "09:00" -> "9 AM")
  const formatTimeDisplay = (timeStr: string): string => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const handleDateClick = (date: Date | null) => {
    if (!date) return;
    setSelectedDate(date);
    const existingOverrides = getAvailabilityForDate(date);
    
    // Helper to get field value (camelCase or snake_case)
    const getField = (obj: any, camelCase: string, snakeCase: string) => {
      return obj[camelCase] ?? obj[snakeCase];
    };
    
    // If there's a full-day override (no time specified), use it
    const fullDayOverride = existingOverrides.find((o: any) => 
      !getField(o, 'startTime', 'start_time') && !getField(o, 'endTime', 'end_time')
    );
    
    if (fullDayOverride) {
      setFormData({
        startTime: "09:00",
        endTime: "17:00",
        isAvailable: getField(fullDayOverride, 'isAvailable', 'is_available'),
        reason: getField(fullDayOverride, 'reason', 'reason') || "",
        maxSlotsPerChef: getField(fullDayOverride, 'maxSlotsPerChef', 'max_slots_per_chef') || 2,
      });
    } else if (existingOverrides.length > 0) {
      // Use first override if exists
      const override: any = existingOverrides[0];
      setFormData({
        startTime: getField(override, 'startTime', 'start_time') || "09:00",
        endTime: getField(override, 'endTime', 'end_time') || "17:00",
        isAvailable: getField(override, 'isAvailable', 'is_available'),
        reason: getField(override, 'reason', 'reason') || "",
        maxSlotsPerChef: getField(override, 'maxSlotsPerChef', 'max_slots_per_chef') || 2,
      });
    } else {
      resetForm();
    }
    
    setShowEditModal(true);
  };

  const formatTimeRange = (start: string, end: string) => {
    return `${start.slice(0, 5)} - ${end.slice(0, 5)}`;
  };

  const handleSaveAvailability = () => {
    if (!selectedDate || !selectedKitchenId) return;

    // Validate time range if kitchen is available
    if (formData.isAvailable) {
      if (!formData.startTime || !formData.endTime) {
        toast({
          title: "Validation Error",
          description: "Please set both start and end times",
          variant: "destructive",
        });
        return;
      }
      
      if (formData.startTime >= formData.endTime) {
        toast({
          title: "Validation Error",
          description: "End time must be after start time",
          variant: "destructive",
        });
        return;
      }
    }

    // Check for bookings if trying to close
    const bookingsOnDate = getBookingsForDate(selectedDate);
    if (!formData.isAvailable && bookingsOnDate.length > 0) {
      const confirmed = window.confirm(
        `⚠️ WARNING: This date has ${bookingsOnDate.length} confirmed booking(s).\n\n` +
        `Closing the kitchen will affect these bookings. The chefs will need to be notified.\n\n` +
        `Are you sure you want to proceed?`
      );
      if (!confirmed) return;
    }

    const dateStr = toLocalYMD(selectedDate);
    const existingOverrides = getAvailabilityForDate(selectedDate);
    const existing = existingOverrides.length > 0 ? existingOverrides[0] : null;

    if (existing && existing.id) {
      // Update existing
      updateAvailability.mutate({
        id: existing.id,
        data: {
          startTime: formData.isAvailable ? formData.startTime : null,
          endTime: formData.isAvailable ? formData.endTime : null,
          isAvailable: formData.isAvailable,
          reason: formData.reason || null,
          maxSlotsPerChef: formData.maxSlotsPerChef,
        },
      });
    } else {
      // Create new
      createAvailability.mutate({
        specificDate: dateStr,
        startTime: formData.isAvailable ? formData.startTime : null,
        endTime: formData.isAvailable ? formData.endTime : null,
        isAvailable: formData.isAvailable,
        reason: formData.reason || null,
        maxSlotsPerChef: formData.maxSlotsPerChef,
      });
    }
  };

  const handleCloseKitchen = () => {
    if (!selectedDate || !selectedKitchenId) return;
    
    const existingOverrides = getAvailabilityForDate(selectedDate);
    const existingBookings = getBookingsForDate(selectedDate);
    
    // Warn if there are bookings
    if (existingBookings.length > 0) {
      const confirmed = window.confirm(
        `⚠️ Warning: This date has ${existingBookings.length} booking(s). Closing the kitchen will prevent new bookings but existing bookings will remain. Are you sure you want to close the kitchen on this date?`
      );
      if (!confirmed) return;
    }
    
    // Create or update override to close the kitchen
    const dateStr = toLocalYMD(selectedDate);
    const overrideData = {
      specificDate: dateStr,
      isAvailable: false,
      startTime: null,
      endTime: null,
      reason: formData.reason || "Kitchen closed",
      maxSlotsPerChef: 0,
    };
    
    if (existingOverrides.length > 0) {
      // Update existing override to closed
      const existingId = existingOverrides[0].id;
      if (existingId) {
        updateAvailability.mutate({
          id: existingId,
          data: overrideData,
        });
      }
    } else {
      // Create new override to close
      createAvailability.mutate(overrideData);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getAvailableSlots = (startTime: string, endTime: string) => {
    const start = parseInt(startTime.split(':')[0]);
    const end = parseInt(endTime.split(':')[0]);
    const slots: string[] = [];
    for (let hour = start; hour < end; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
    }
    return slots;
  };

  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  
  const calendarDays = selectedKitchenId ? getCalendarDays(currentYear, currentMonth) : [];
  const isCurrentMonth = (date: Date) => date.getMonth() === currentMonth;

  const content = (
    <main className={embedded ? "flex-1 py-6" : "flex-1 pt-24 pb-8"}>
      <div className={embedded ? "px-4 py-6" : "container mx-auto px-4 py-6 max-w-7xl"}>
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900">Kitchen Availability Calendar</h1>
            <p className="text-gray-600 mt-1">Click on any date to set operating hours for your kitchen</p>
          </div>

          {isLoadingLocations ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Loading locations...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Sidebar: Location & Kitchen Selection */}
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Location</h2>
                  {locations.length === 1 ? (
                    <div className="px-3 py-2 text-sm font-medium text-gray-900 bg-gray-50 rounded-lg border border-gray-200">
                      {locations[0].name}
                    </div>
                  ) : (
                    <select
                      value={selectedLocationId || ""}
                      onChange={(e) => {
                        setSelectedLocationId(e.target.value ? parseInt(e.target.value) : null);
                        setSelectedKitchenId(null);
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">Choose location...</option>
                      {locations.map((location: any) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {selectedLocationId && (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Kitchen</h2>
                    {kitchens.length === 1 ? (
                      <div className="px-3 py-2 text-sm font-medium text-gray-900 bg-gray-50 rounded-lg border border-gray-200">
                        {kitchens[0].name}
                      </div>
                    ) : (
                      <select
                        value={selectedKitchenId || ""}
                        onChange={(e) => setSelectedKitchenId(e.target.value ? parseInt(e.target.value) : null)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">Choose kitchen...</option>
                        {kitchens.map((kitchen) => (
                          <option key={kitchen.id} value={kitchen.id}>
                            {kitchen.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {selectedKitchenId && (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wide">Legend</h3>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-green-50 border-2 border-green-300 rounded"></div>
                        <span>Open (shows hours)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-red-50 border-2 border-red-300 rounded"></div>
                        <span>Closed</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-gray-50 border border-gray-300 rounded"></div>
                        <span>Past/Other month</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                        <span>Has bookings</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Calendar View */}
              <div className="lg:col-span-3 space-y-4">
                {!selectedKitchenId ? (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12">
                    <div className="text-center">
                      <CalendarIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Kitchen</h3>
                      <p className="text-gray-500">Choose a location and kitchen to view and manage its availability calendar</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Calendar Header */}
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => navigateMonth('prev')}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <ChevronLeft className="h-5 w-5 text-gray-600" />
                        </button>
                        
                        <h2 className="text-xl font-bold text-gray-900">
                          {monthNames[currentMonth]} {currentYear}
                        </h2>
                        
                        <button
                          onClick={() => navigateMonth('next')}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <ChevronRight className="h-5 w-5 text-gray-600" />
                        </button>
                      </div>
                    </div>

                    {/* Calendar Grid */}
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                      {(availabilityError || bookingsError) && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                          <p className="text-sm text-red-800">
                            ⚠️ Error loading data: {(availabilityError as Error)?.message || (bookingsError as Error)?.message}
                          </p>
                        </div>
                      )}
                      {isLoadingAvailability || isLoadingBookings ? (
                        <div className="text-center py-12">
                          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                          <p className="text-gray-500 mt-2">Loading calendar...</p>
                        </div>
                      ) : (
                        <div className="calendar-grid">
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
                              const availabilityOverrides = getAvailabilityForDate(date);
                              const bookings = getBookingsForDate(date);
                              const hasBookings = bookings.length > 0;
                              const isCurrent = isCurrentMonth(date);
                              const isToday = date.toDateString() === today.toDateString();
                              const isPast = date < today && !isToday;

                              // Get availability status for this date
                              const availabilityStatus = getDateAvailabilityStatus(date);
                              
                              let bgColor = 'bg-white hover:bg-gray-50';
                              let borderColor = 'border-gray-200';
                              let textColor = isCurrent ? 'text-gray-900' : 'text-gray-400';

                              // Visual indicators based on availability
                              if (availabilityStatus.isExplicitlyClosed || (!availabilityStatus.isOpen && isCurrent)) {
                                // Explicitly closed or no schedule set (default closed)
                                bgColor = 'bg-red-50 hover:bg-red-100';
                                borderColor = 'border-red-300 border-2';
                              } else if (availabilityStatus.isOpen) {
                                // Open with hours
                                bgColor = 'bg-green-50 hover:bg-green-100';
                                borderColor = 'border-green-300';
                              } else {
                                // Past date or no data
                                bgColor = 'bg-gray-50 hover:bg-gray-100';
                                borderColor = 'border-gray-300';
                              }

                              if (isToday) {
                                borderColor = 'border-blue-500 border-2';
                              }

                              return (
                                <button
                                  key={index}
                                  onClick={() => !isPast && isCurrent && handleDateClick(date)}
                                  disabled={isPast || !isCurrent}
                                  className={`
                                    aspect-square p-2 rounded-lg border transition-all
                                    ${bgColor} ${borderColor} ${textColor}
                                    ${isPast || !isCurrent ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                                    relative
                                  `}
                                >
                                  <div className="text-sm font-medium">
                                    {date.getDate()}
                                  </div>
                                  {isCurrent && (
                                    <>
                                      {/* Status indicator */}
                                      <div className="text-xs mt-1 space-y-0.5 min-h-[20px] flex items-center justify-center">
                                        {availabilityStatus.isExplicitlyClosed || (!availabilityStatus.isOpen && availabilityOverrides.length === 0) ? (
                                          <div className="flex items-center justify-center gap-1">
                                            <span className="text-red-700 font-bold text-[10px] uppercase leading-tight tracking-wide">Closed</span>
                                          </div>
                                        ) : availabilityStatus.isOpen ? (
                                          <div className="flex items-center justify-center gap-1 px-1 w-full">
                                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0"></span>
                                            <span 
                                              className="text-green-700 font-semibold text-[10px] leading-tight truncate block max-w-full overflow-hidden text-ellipsis whitespace-nowrap" 
                                              title={availabilityStatus.hours || ''}
                                              style={{ maxWidth: 'calc(100% - 8px)' }}
                                            >
                                              {availabilityStatus.hours ? availabilityStatus.hours.replace(/\s/g, ' ') : 'Open'}
                                            </span>
                                          </div>
                                        ) : null}
                                      </div>
                                      {hasBookings && (
                                        <div className="absolute top-1 right-1 w-2 h-2 bg-blue-600 rounded-full" title={`${bookings.length} booking(s)`}></div>
                                      )}
                                    </>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Edit Modal */}
                    {showEditModal && selectedDate && (
                      <div 
                        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto"
                        onClick={(e) => {
                          if (e.target === e.currentTarget) {
                            setShowEditModal(false);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setShowEditModal(false);
                          }
                        }}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="modal-title"
                      >
                        <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                          {/* Modal Header */}
                          <div className="flex items-center justify-between p-6 border-b border-gray-200">
                            <div>
                              <h2 id="modal-title" className="text-xl font-bold text-gray-900">
                                {selectedDate.toLocaleDateString('en-US', { 
                                  weekday: 'long', 
                                  month: 'long', 
                                  day: 'numeric', 
                                  year: 'numeric' 
                                })}
                              </h2>
                              <p className="text-sm text-gray-500 mt-1">Set availability for this date</p>
                            </div>
                            <button
                              onClick={() => setShowEditModal(false)}
                              className="text-gray-400 hover:text-gray-600 transition-colors"
                              aria-label="Close modal"
                            >
                              <X className="h-6 w-6" />
                            </button>
                          </div>

                          {/* Modal Body */}
                          <div className="p-6 space-y-5">
                            {/* Existing Bookings Warning */}
                            {selectedDate && getBookingsForDate(selectedDate).length > 0 && (
                              <div className="p-4 bg-blue-50 border border-blue-300 rounded-lg">
                                <div className="flex items-start gap-3">
                                  <CalendarIcon className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                                  <div className="flex-1">
                                    <h4 className="font-semibold text-blue-900 mb-2">Existing Bookings</h4>
                                    <p className="text-sm text-blue-800 mb-3">
                                      This date has {getBookingsForDate(selectedDate).length} confirmed booking(s):
                                    </p>
                                    <div className="space-y-1.5">
                                      {getBookingsForDate(selectedDate).map((booking: Booking) => (
                                        <div key={booking.id} className="text-sm bg-white px-3 py-2 rounded border border-blue-200 flex items-center justify-between">
                                          <span className="font-medium text-blue-900">
                                            {formatTimeRange(booking.startTime, booking.endTime)}
                                          </span>
                                          <span className="text-xs text-blue-700 bg-blue-100 px-2 py-1 rounded">
                                            Confirmed
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                    {!formData.isAvailable && (
                                      <p className="text-sm font-medium text-orange-700 mt-3 bg-orange-50 px-3 py-2 rounded border border-orange-200">
                                        ⚠️ Warning: Closing this date will affect existing bookings. Please contact the chefs before proceeding.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Available Toggle */}
                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                              <div>
                                <p className="font-medium text-gray-900">Kitchen Status</p>
                                <p className="text-sm text-gray-500">Is the kitchen open on this date?</p>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={formData.isAvailable}
                                  onChange={(e) => setFormData({ ...formData, isAvailable: e.target.checked })}
                                  className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                              </label>
                            </div>

                            {/* Operating Hours */}
                            {formData.isAvailable ? (
                              <>
                                <div className="space-y-4">
                                  <label className="block text-sm font-medium text-gray-900">
                                    Operating Hours
                                  </label>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-2">From</label>
                                      <input
                                        type="time"
                                        value={formData.startTime}
                                        onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                                        required={formData.isAvailable}
                                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-lg font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        step="900"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-2">To</label>
                                      <input
                                        type="time"
                                        value={formData.endTime}
                                        onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                                        required={formData.isAvailable}
                                        min={formData.startTime}
                                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-lg font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        step="900"
                                      />
                                    </div>
                                  </div>
                                </div>

                                {/* Daily Booking Limit */}
                                <div className="space-y-2 bg-green-50 border-2 border-green-200 rounded-lg p-4">
                                  <label className="block text-sm font-medium text-gray-900 flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-green-600" />
                                    Daily Booking Limit
                                  </label>
                                  <input
                                    type="number"
                                    min="1"
                                    max="24"
                                    value={formData.maxSlotsPerChef}
                                    onChange={(e) => setFormData({ ...formData, maxSlotsPerChef: parseInt(e.target.value) || 2 })}
                                    className="w-full border border-green-300 rounded-lg px-4 py-2.5 text-lg font-medium focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                  />
                                  <p className="text-xs text-gray-600">
                                    Maximum hours a chef can book per day on this date (Default: 2 hours)
                                  </p>
                                </div>

                                {/* BLOCK SPECIFIC HOURS - NEW FEATURE! */}
                                <div className="border-2 border-orange-200 rounded-lg p-4 bg-orange-50">
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                      <Clock className="h-5 w-5 text-orange-600" />
                                      <h4 className="font-semibold text-gray-900">Block Specific Hours</h4>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setShowBlockHoursSection(!showBlockHoursSection)}
                                      className="text-sm text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1"
                                    >
                                      <Plus className="h-4 w-4" />
                                      {showBlockHoursSection ? 'Hide' : 'Add Block'}
                                    </button>
                                  </div>
                                  
                                  <p className="text-sm text-gray-600 mb-3">
                                    Block specific time ranges (e.g., lunch break, cleaning) while keeping the rest of the day available
                                  </p>

                                  {/* Existing Blocks */}
                                  {selectedDate && getAvailabilityForDate(selectedDate)
                                    .filter((override: any) => {
                                      const startTime = override.startTime ?? override.start_time;
                                      const endTime = override.endTime ?? override.end_time;
                                      const isAvailable = override.isAvailable ?? override.is_available;
                                      return startTime && endTime && !isAvailable;
                                    })
                                    .map((override: any) => {
                                      const id = override.id;
                                      const startTime = override.startTime ?? override.start_time;
                                      const endTime = override.endTime ?? override.end_time;
                                      const reason = override.reason;
                                      return (
                                        <div key={id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-orange-300 mb-2">
                                          <div className="flex items-center gap-3">
                                            <Clock className="h-4 w-4 text-orange-600" />
                                            <div>
                                              <p className="font-medium text-gray-900">
                                                {startTime?.slice(0, 5)} - {endTime?.slice(0, 5)}
                                              </p>
                                              {reason && (
                                                <p className="text-xs text-gray-600">{reason}</p>
                                              )}
                                            </div>
                                          </div>
                                          <button
                                            onClick={() => id && deleteAvailability.mutate(id)}
                                            className="text-red-600 hover:text-red-700 p-1"
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </button>
                                        </div>
                                      );
                                    })
                                  }

                                  {/* Add Block Form */}
                                  {showBlockHoursSection && (
                                    <div className="mt-3 p-4 bg-white rounded-lg border-2 border-orange-300 space-y-3">
                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Start Time
                                          </label>
                                          <input
                                            type="time"
                                            value={blockHoursForm.startTime}
                                            onChange={(e) => setBlockHoursForm({ ...blockHoursForm, startTime: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-sm font-medium text-gray-700 mb-1">
                                            End Time
                                          </label>
                                          <input
                                            type="time"
                                            value={blockHoursForm.endTime}
                                            onChange={(e) => setBlockHoursForm({ ...blockHoursForm, endTime: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                                          />
                                        </div>
                                      </div>
                                      <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                          Reason (Optional)
                                        </label>
                                        <input
                                          type="text"
                                          value={blockHoursForm.reason}
                                          onChange={(e) => setBlockHoursForm({ ...blockHoursForm, reason: e.target.value })}
                                          placeholder="e.g., Lunch break, Cleaning"
                                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                                        />
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (blockHoursForm.startTime >= blockHoursForm.endTime) {
                                            toast({
                                              title: "Invalid Time Range",
                                              description: "End time must be after start time",
                                              variant: "destructive",
                                            });
                                            return;
                                          }
                                          createAvailability.mutate({
                                            specificDate: toLocalYMD(selectedDate!),
                                            startTime: blockHoursForm.startTime,
                                            endTime: blockHoursForm.endTime,
                                            isAvailable: false, // Blocked time = not available
                                            reason: blockHoursForm.reason || null,
                                          });
                                          setBlockHoursForm({ startTime: "11:00", endTime: "13:00", reason: "" });
                                          setShowBlockHoursSection(false);
                                        }}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
                                      >
                                        <Plus className="h-4 w-4" />
                                        Add Blocked Hours
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* Time Slots Preview */}
                                {formData.startTime && formData.endTime && (
                                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                                    <p className="text-xs font-semibold text-blue-900 mb-3 flex items-center gap-2">
                                      <Clock className="h-3.5 w-3.5" />
                                      Available Booking Slots
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                      {getAvailableSlots(formData.startTime, formData.endTime).map((slot, idx) => (
                                        <span
                                          key={idx}
                                          className="px-3 py-1.5 bg-white text-blue-700 text-sm font-medium rounded-md border border-blue-200"
                                        >
                                          {slot}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-center">
                                <p className="text-sm font-medium text-red-800">
                                  Kitchen will be closed on this date
                                </p>
                              </div>
                            )}

                            {/* Reason */}
                            <div>
                              <label className="block text-sm font-medium text-gray-900 mb-2">
                                Note (Optional)
                              </label>
                              <input
                                type="text"
                                value={formData.reason}
                                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                                placeholder="e.g., Holiday, Special Event, Maintenance"
                                maxLength={200}
                                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              />
                              {formData.reason && (
                                <p className="text-xs text-gray-500 mt-1">
                                  {formData.reason.length}/200 characters
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Modal Footer */}
                          <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
                            <button
                              onClick={handleCloseKitchen}
                              disabled={createAvailability.isPending || updateAvailability.isPending}
                              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Close kitchen for this date - prevents all bookings"
                            >
                              <X className="h-4 w-4" />
                              Close Kitchen
                            </button>
                            
                            <div className="flex gap-3">
                              <button
                                onClick={() => setShowEditModal(false)}
                                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-white transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={handleSaveAvailability}
                                disabled={createAvailability.isPending || updateAvailability.isPending}
                                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                {(createAvailability.isPending || updateAvailability.isPending) ? (
                                  <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                    Saving...
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 className="h-4 w-4" />
                                    Save
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <ManagerHeader />
      {content}
      <Footer />
    </div>
  );
}

