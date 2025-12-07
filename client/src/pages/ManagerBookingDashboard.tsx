import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Calendar, Clock, MapPin, ChefHat, Settings, BookOpen, 
  X, Check, Save, AlertCircle, Building2, FileText, 
  ChevronLeft, ChevronRight, Sliders, Info, Mail, User, Users, Upload, Image as ImageIcon, Globe, Phone
} from "lucide-react";
import { getTimezoneOptions, DEFAULT_TIMEZONE } from "@/utils/timezone-utils";
import { Link, useLocation } from "wouter";
import CalendarComponent from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { useManagerDashboard } from "../hooks/use-manager-dashboard";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import ManagerHeader from "@/components/layout/ManagerHeader";
import Footer from "@/components/layout/Footer";
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs";
import KitchenAvailabilityManagement from "./KitchenAvailabilityManagement";
import ManagerBookingsPanel from "./ManagerBookingsPanel";
import ManagerChefProfiles from "./ManagerChefProfiles";
import ManagerPortalApplications from "./ManagerPortalApplications";
import ChangePassword from "@/components/auth/ChangePassword";

interface Location {
  id: number;
  name: string;
  address: string;
  cancellationPolicyHours?: number;
  cancellationPolicyMessage?: string;
  defaultDailyBookingLimit?: number;
  notificationEmail?: string;
  notificationPhone?: string;
  minimumBookingWindowHours?: number;
  logoUrl?: string;
  timezone?: string;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = localStorage.getItem('firebaseToken');
  if (token) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }
  return {
    'Content-Type': 'application/json',
  };
}

type ViewType = 'overview' | 'bookings' | 'availability' | 'settings' | 'chef-profiles' | 'portal-applications';

export default function ManagerBookingDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, isLoadingLocations } = useManagerDashboard();
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [activeView, setActiveView] = useState<ViewType>('overview');

  // Auto-select location if only one exists
  useEffect(() => {
    if (!isLoadingLocations && locations.length === 1 && !selectedLocation) {
      setSelectedLocation(locations[0]);
    }
  }, [locations, isLoadingLocations, selectedLocation]);

  // Fetch location details with cancellation policy
  const { data: locationDetails } = useQuery<Location | null>({
    queryKey: ['locationDetails', selectedLocation?.id],
    queryFn: async (): Promise<Location | null> => {
      if (!selectedLocation?.id) return null;
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations`, {
        headers,
        credentials: "include",
      });
      if (!response.ok) {
        let errorMessage = 'Failed to fetch locations';
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
      const locations = await response.json();
      const location = locations.find((l: any) => l.id === selectedLocation.id);
      if (location) {
        // Map snake_case to camelCase if needed
        // notification_email column from DB should be mapped to notificationEmail
        const mappedLocation = {
          ...location,
          notificationEmail: location.notificationEmail || location.notification_email || undefined,
          cancellationPolicyHours: location.cancellationPolicyHours || location.cancellation_policy_hours,
          cancellationPolicyMessage: location.cancellationPolicyMessage || location.cancellation_policy_message,
          defaultDailyBookingLimit: location.defaultDailyBookingLimit || location.default_daily_booking_limit,
        } as Location;
        
        console.log('Fetched location details:', {
          id: mappedLocation.id,
          notificationEmail: mappedLocation.notificationEmail,
          rawData: location
        });
        
        return mappedLocation;
      }
      return selectedLocation;
    },
    enabled: !!selectedLocation?.id,
  });

  // Update location settings mutation
  const updateLocationSettings = useMutation({
    mutationFn: async ({ locationId, cancellationPolicyHours, cancellationPolicyMessage, defaultDailyBookingLimit, minimumBookingWindowHours, notificationEmail, notificationPhone, logoUrl, timezone }: {
      locationId: number;
      cancellationPolicyHours?: number;
      cancellationPolicyMessage?: string;
      defaultDailyBookingLimit?: number;
      minimumBookingWindowHours?: number;
      notificationEmail?: string;
      notificationPhone?: string;
      logoUrl?: string;
      timezone?: string;
    }) => {
      const payload = { cancellationPolicyHours, cancellationPolicyMessage, defaultDailyBookingLimit, minimumBookingWindowHours, notificationEmail, notificationPhone, logoUrl, timezone };
      console.log('📡 Sending PUT request to:', `/api/manager/locations/${locationId}/cancellation-policy`);
      console.log('📡 Request body:', payload);
      console.log('📡 LogoUrl in payload:', logoUrl, 'type:', typeof logoUrl);
      
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${locationId}/cancellation-policy`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        let errorMessage = 'Failed to update location settings';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (jsonError) {
          // If response isn't JSON, try to get text
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
      let result;
      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        // If response isn't JSON, return the text or empty object
        const text = await response.text();
        result = text ? JSON.parse(text) : {};
      }
      
      console.log('✅ Save response:', result);
      return result;
    },
    onSuccess: (data) => {
      // Update the location details cache with the returned data
      if (selectedLocation?.id && data) {
        queryClient.setQueryData(['locationDetails', selectedLocation.id], (oldData: Location | null) => {
          if (oldData) {
            return { ...oldData, ...data };
          }
          return data;
        });
      }
      
      // Update selected location state
      if (data) {
        setSelectedLocation((prev) => {
          if (prev && prev.id === data.id) {
            return { ...prev, ...data };
          }
          return prev;
        });
      }
      
      // Invalidate queries to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ['locationDetails', selectedLocation?.id] });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/locations'] });
      
      toast({
        title: "Success",
        description: "Location settings updated successfully",
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

  const navItems = [
    { id: 'overview' as ViewType, label: 'Overview', icon: Calendar },
    { id: 'bookings' as ViewType, label: 'Bookings', icon: BookOpen },
    { id: 'availability' as ViewType, label: 'Availability', icon: Clock },
    { id: 'chef-profiles' as ViewType, label: 'Chef Profiles', icon: Users },
    { id: 'portal-applications' as ViewType, label: 'Portal Applications', icon: User },
    { id: 'settings' as ViewType, label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 relative">
      <AnimatedBackgroundOrbs variant="both" intensity="subtle" />
      <ManagerHeader />
      <main className="flex-1 pt-24 pb-8 relative z-10">
        <div className="container mx-auto px-4 py-6 max-w-7xl">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900">Booking Management</h1>
            <p className="text-gray-600 mt-1">Manage locations, bookings, and availability settings</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Sidebar - Navigation & Location Selection */}
            <aside className="lg:col-span-3 space-y-4">
              {/* Location Selection */}
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4 md:p-6 hover:shadow-xl transition-all duration-300">
                <label className="block text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                  Select Location
                </label>
                {isLoadingLocations ? (
                  <div className="text-sm text-gray-500">Loading...</div>
                ) : locations.length === 0 ? (
                  <div className="text-sm text-gray-500">No locations available</div>
                ) : locations.length === 1 ? (
                  <div className="px-3 py-2 text-sm font-medium text-gray-900 bg-gray-50 rounded-lg border border-gray-200">
                    {locations[0].name}
                  </div>
                ) : (
                  <select
                    value={selectedLocation?.id || ""}
                    onChange={(e) => {
                      const loc = locations.find((l: any) => l.id === parseInt(e.target.value));
                      setSelectedLocation(loc || null);
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Choose location...</option>
                    {locations.map((loc: any) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Navigation */}
              <nav className="bg-white rounded-2xl shadow-lg border border-gray-100 p-2 hover:shadow-xl transition-all duration-300">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveView(item.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                        activeView === item.id
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              {/* Quick Stats (when location selected) */}
              {selectedLocation && activeView === 'overview' && (
                <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4 md:p-6 hover:shadow-xl transition-all duration-300">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                    Quick Info
                  </h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Location:</span>
                      <span className="font-medium text-gray-900">{selectedLocation.name}</span>
                    </div>
                    {locationDetails?.cancellationPolicyHours && (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Cancel Policy:</span>
                        <span className="font-medium text-gray-900">
                          {locationDetails.cancellationPolicyHours}h
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </aside>

            {/* Main Content Area */}
            <div className="lg:col-span-9">
              {activeView === 'overview' && (
                <OverviewView 
                  selectedLocation={selectedLocation}
                  onNavigate={(view: ViewType) => setActiveView(view)}
                />
              )}
              
              {activeView === 'bookings' && (
                <ManagerBookingsPanel embedded={true} />
              )}
              
              {activeView === 'availability' && selectedLocation && (
                <KitchenAvailabilityManagement embedded={true} />
              )}
              
              {activeView === 'chef-profiles' && (
                <ManagerChefProfiles embedded={true} />
              )}
              
              {activeView === 'portal-applications' && (
                <ManagerPortalApplications embedded={true} />
              )}
              
              {activeView === 'settings' && selectedLocation && (
                <SettingsView 
                  location={(locationDetails || selectedLocation) as Location}
                  onUpdateSettings={updateLocationSettings}
                  isUpdating={updateLocationSettings.isPending}
                />
              )}

              {activeView === 'availability' && !selectedLocation && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                  <Calendar className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
                  <p className="text-gray-500">Choose a location to manage availability</p>
                </div>
              )}

              {activeView === 'settings' && !selectedLocation && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                  <Settings className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
                  <p className="text-gray-500">Choose a location to manage settings</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

// Overview View Component
function OverviewView({ selectedLocation, onNavigate }: { selectedLocation: Location | null; onNavigate: (view: ViewType) => void }) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  
  // Use the same query as ManagerBookingsPanel for consistency and real-time updates
  const { data: bookings = [], isLoading: isLoadingBookings } = useQuery({
    queryKey: ['managerBookings'],
    queryFn: async () => {
      const token = localStorage.getItem('firebaseToken');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
      };
      
      const response = await fetch('/api/manager/bookings', {
        headers,
        credentials: "include",
      });
      
      if (!response.ok) {
        let errorMessage = 'Failed to fetch bookings';
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
      return text ? JSON.parse(text) : [];
    },
    // Real-time polling - same as ManagerBookingsPanel
    refetchInterval: (data) => {
      if (!data || !Array.isArray(data)) return 10000;
      const hasPendingBookings = data.some((b: any) => b.status === "pending");
      const hasUpcomingBookings = data.some((b: any) => {
        try {
          const bookingDate = new Date(b.bookingDate);
          return bookingDate >= new Date();
        } catch {
          return false;
        }
      });
      if (hasPendingBookings) return 5000;
      if (hasUpcomingBookings) return 15000;
      return 30000;
    },
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
    staleTime: 0,
  });
  
  const pendingBookings = bookings.filter((b: any) => b.status === "pending");
  const confirmedBookings = bookings.filter((b: any) => b.status === "confirmed");
  const cancelledBookings = bookings.filter((b: any) => b.status === "cancelled");

  // Helper function to normalize date to YYYY-MM-DD format
  const normalizeDate = (date: Date | string): string => {
    try {
      const d = typeof date === 'string' ? new Date(date) : date;
      // Get date in local timezone to avoid timezone issues
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (error) {
      console.error('Error normalizing date:', error);
      return '';
    }
  };

  // Group bookings by date - handle both timestamp and date string formats
  const bookingsByDate = useMemo(() => {
    const grouped: { [key: string]: any[] } = {};
    bookings.forEach((booking: any) => {
      if (!booking.bookingDate) return;
      const dateStr = normalizeDate(booking.bookingDate);
      if (!dateStr) return;
      
      if (!grouped[dateStr]) {
        grouped[dateStr] = [];
      }
      grouped[dateStr].push(booking);
    });
    return grouped;
  }, [bookings]);

  // Get bookings for a specific date
  const getBookingsForDate = (date: Date): any[] => {
    const dateStr = normalizeDate(date);
    return bookingsByDate[dateStr] || [];
  };

  // Custom tile content with booking indicators
  const tileContent = ({ date, view }: { date: Date; view: string }) => {
    if (view !== 'month') return null;
    const dateBookings = getBookingsForDate(date);
    if (dateBookings.length === 0) return null;
    
    const pending = dateBookings.filter((b: any) => b.status === 'pending').length;
    const confirmed = dateBookings.filter((b: any) => b.status === 'confirmed').length;
    const cancelled = dateBookings.filter((b: any) => b.status === 'cancelled').length;

    return (
      <div className="absolute bottom-1 left-0 right-0 flex items-center justify-center gap-1 px-1">
        {pending > 0 && (
          <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full" title={`${pending} pending`}></div>
        )}
        {confirmed > 0 && (
          <div className="w-1.5 h-1.5 bg-green-500 rounded-full" title={`${confirmed} confirmed`}></div>
        )}
        {cancelled > 0 && (
          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full" title={`${cancelled} cancelled`}></div>
        )}
      </div>
    );
  };

  // Custom tile className for dates with bookings
  const tileClassName = ({ date, view }: { date: Date; view: string }) => {
    if (view !== 'month') return '';
    const dateBookings = getBookingsForDate(date);
    if (dateBookings.length === 0) return '';
    
    const hasPending = dateBookings.some((b: any) => b.status === 'pending');
    const hasConfirmed = dateBookings.some((b: any) => b.status === 'confirmed');
    
    if (hasPending) return 'has-pending-booking';
    if (hasConfirmed) return 'has-confirmed-booking';
    return 'has-booking';
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 md:p-8 hover:shadow-xl transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Pending Review</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{pendingBookings.length}</p>
            </div>
            <div className="p-3 bg-yellow-100 rounded-full">
              <Clock className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 md:p-8 hover:shadow-xl transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Confirmed</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{confirmedBookings.length}</p>
            </div>
            <div className="p-3 bg-green-100 rounded-full">
              <Check className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 md:p-8 hover:shadow-xl transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Bookings</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{bookings.length}</p>
            </div>
            <div className="p-3 bg-blue-100 rounded-full">
              <BookOpen className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Modern Calendar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-gray-900">Booking Calendar</h2>
            {isLoadingBookings && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
              <span>Pending</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Confirmed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
              <span>Cancelled</span>
            </div>
          </div>
        </div>
        <div className="react-calendar-wrapper">
          {isLoadingBookings && bookings.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-500">Loading bookings...</p>
              </div>
            </div>
          ) : (
            <CalendarComponent
              onChange={(value: any) => setSelectedDate(value)}
              value={selectedDate}
              tileContent={tileContent}
              tileClassName={tileClassName}
              className="w-full border-0"
              locale="en-US"
            />
          )}
        </div>
        <style>{`
          .react-calendar-wrapper .react-calendar {
            width: 100%;
            border: none;
            font-family: inherit;
          }
          .react-calendar-wrapper .react-calendar__tile {
            position: relative;
            height: 60px;
            padding: 8px;
            font-size: 14px;
          }
          .react-calendar-wrapper .react-calendar__tile--now {
            background: #eff6ff;
            color: #1e40af;
          }
          .react-calendar-wrapper .react-calendar__tile--active {
            background: #3b82f6;
            color: white;
          }
          .react-calendar-wrapper .react-calendar__tile.has-pending-booking {
            border: 2px solid #f59e0b;
          }
          .react-calendar-wrapper .react-calendar__tile.has-confirmed-booking {
            border: 2px solid #10b981;
          }
          .react-calendar-wrapper .react-calendar__tile.has-booking {
            border: 1px solid #cbd5e1;
          }
          .react-calendar-wrapper .react-calendar__navigation {
            margin-bottom: 1rem;
          }
          .react-calendar-wrapper .react-calendar__navigation button {
            font-size: 16px;
            font-weight: 600;
          }
        `}</style>
      </div>

      {/* Selected Date Details */}
      {selectedDate && (
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 md:p-8 hover:shadow-xl transition-all duration-300">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Bookings for {selectedDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </h3>
            <button
              onClick={() => setSelectedDate(null)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {isLoadingBookings ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : getBookingsForDate(selectedDate).length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No bookings on this date</p>
            </div>
          ) : (
            <div className="space-y-3">
              {getBookingsForDate(selectedDate).map((booking: any) => {
                const formatTime = (time: string) => {
                  if (!time) return '';
                  const [hours, minutes] = time.split(':');
                  const hour = parseInt(hours);
                  const ampm = hour >= 12 ? 'PM' : 'AM';
                  const displayHour = hour % 12 || 12;
                  return `${displayHour}:${minutes} ${ampm}`;
                };

                return (
                  <div
                    key={booking.id}
                    className={`p-4 rounded-lg border ${
                      booking.status === 'pending'
                        ? 'bg-yellow-50 border-yellow-200'
                        : booking.status === 'confirmed'
                        ? 'bg-green-50 border-green-200'
                        : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            booking.status === 'pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : booking.status === 'confirmed'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {booking.status.toUpperCase()}
                          </span>
                          <span className="text-sm font-medium text-gray-900 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatTime(booking.startTime)} - {formatTime(booking.endTime)}
                          </span>
                        </div>
                        {booking.kitchenName && (
                          <p className="text-sm text-gray-600 flex items-center gap-1 mb-1">
                            <ChefHat className="h-3 w-3" />
                            {booking.kitchenName}
                          </p>
                        )}
                        {booking.locationName && (
                          <p className="text-sm text-gray-600 flex items-center gap-1 mb-1">
                            <MapPin className="h-3 w-3" />
                            {booking.locationName}
                          </p>
                        )}
                        {booking.chefName && (
                          <p className="text-sm text-gray-600 flex items-center gap-1 mb-1">
                            <User className="h-3 w-3" />
                            Chef: {booking.chefName}
                          </p>
                        )}
                        {booking.specialNotes && (
                          <div className="mt-2 p-2 bg-white rounded border border-gray-200">
                            <p className="text-xs font-medium text-gray-700 mb-1">Notes:</p>
                            <p className="text-sm text-gray-600">{booking.specialNotes}</p>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => onNavigate('bookings')}
                        className="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors whitespace-nowrap"
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => onNavigate('bookings')}
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all duration-300 text-left w-full shadow-sm hover:shadow-md"
          >
            <BookOpen className="h-5 w-5 text-blue-600" />
            <div>
              <p className="font-medium text-gray-900">Review Bookings</p>
              <p className="text-sm text-gray-600">Manage pending requests</p>
            </div>
          </button>
          <button
            onClick={() => onNavigate('availability')}
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all duration-300 text-left w-full shadow-sm hover:shadow-md"
          >
            <Calendar className="h-5 w-5 text-blue-600" />
            <div>
              <p className="font-medium text-gray-900">Set Availability</p>
              <p className="text-sm text-gray-600">Configure kitchen schedules</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// Settings View Component
interface SettingsViewProps {
  location: Location;
  onUpdateSettings: any;
  isUpdating: boolean;
}

function SettingsView({ location, onUpdateSettings, isUpdating }: SettingsViewProps) {
  const { toast } = useToast();
  const [cancellationHours, setCancellationHours] = useState(location.cancellationPolicyHours || 24);
  const [cancellationMessage, setCancellationMessage] = useState(
    location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time."
  );
  const [dailyBookingLimit, setDailyBookingLimit] = useState(location.defaultDailyBookingLimit || 2);
  const [minimumBookingWindowHours, setMinimumBookingWindowHours] = useState(location.minimumBookingWindowHours || 1);
  const [notificationEmail, setNotificationEmail] = useState(location.notificationEmail || '');
  const [notificationPhone, setNotificationPhone] = useState(location.notificationPhone || '');
  const [logoUrl, setLogoUrl] = useState(location.logoUrl || '');
  const [timezone, setTimezone] = useState(location.timezone || DEFAULT_TIMEZONE);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const timezoneOptions = getTimezoneOptions();

  // Update state when location prop changes (e.g., after saving or switching tabs)
  useEffect(() => {
    setCancellationHours(location.cancellationPolicyHours || 24);
    setCancellationMessage(
      location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time."
    );
    setDailyBookingLimit(location.defaultDailyBookingLimit || 2);
    setMinimumBookingWindowHours(location.minimumBookingWindowHours || 1);
    setLogoUrl(location.logoUrl || '');
    setTimezone(location.timezone || DEFAULT_TIMEZONE);
    // Show the actual notificationEmail from the database, not the username
    // notificationEmail should be what's saved in notification_email column
    const savedEmail = location.notificationEmail || '';
    const savedPhone = location.notificationPhone || '';
    console.log('SettingsView: Loading notificationEmail and notificationPhone from location:', {
      locationId: location.id,
      notificationEmail: savedEmail,
      notificationPhone: savedPhone,
      fullLocation: location
    });
    setNotificationEmail(savedEmail);
    setNotificationPhone(savedPhone);
  }, [location]);

  const handleSave = (overrideLogoUrl?: string) => {
    if (!location.id) return;
    
    const payload = {
      locationId: location.id,
      cancellationPolicyHours: cancellationHours,
      cancellationPolicyMessage: cancellationMessage,
      defaultDailyBookingLimit: dailyBookingLimit,
      minimumBookingWindowHours: minimumBookingWindowHours,
      notificationEmail: notificationEmail || undefined,
      notificationPhone: notificationPhone || undefined,
      logoUrl: overrideLogoUrl !== undefined ? overrideLogoUrl : (logoUrl || undefined),
      timezone: timezone || DEFAULT_TIMEZONE,
    };
    
    console.log('🚀 Saving location settings:', payload);
    
    onUpdateSettings.mutate(payload);
  };

  // Handle logo file upload for session-based auth (managers)
  const handleLogoUpload = async (file: File) => {
    setIsUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/upload-file', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to upload logo');
      }
      
      const result = await response.json();
      const uploadedUrl = result.url;
      setLogoUrl(uploadedUrl);
      
      // Auto-save after upload with the uploaded URL
      handleSave(uploadedUrl);
      
      return uploadedUrl;
    } catch (error: any) {
      console.error('Logo upload error:', error);
      throw error;
    } finally {
      setIsUploadingLogo(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Location Settings</h2>
          <p className="text-sm text-gray-600 mt-1">{location.name}</p>
        </div>

        <div className="p-6 space-y-6">
          {/* Notification Email Section */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-purple-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Notification Email</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Configure where booking notifications will be sent. If left empty, notifications will go to the manager's account email.
                </p>
              </div>
            </div>

            <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 md:p-6 space-y-4 shadow-md">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={notificationEmail}
                  onChange={(e) => setNotificationEmail(e.target.value)}
                  placeholder="notifications@localcooks.com"
                  className="w-full max-w-md border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
                <p className="text-xs text-gray-600 mt-1">
                  All booking notifications for this location will be sent to this email address
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Phone Number (for SMS notifications)
                </label>
                <input
                  type="tel"
                  value={notificationPhone}
                  onChange={(e) => setNotificationPhone(e.target.value)}
                  placeholder="+1 (555) 123-4567"
                  className="w-full max-w-md border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
                <p className="text-xs text-gray-600 mt-1">
                  SMS notifications for bookings and cancellations will be sent to this phone number. If left empty, SMS will not be sent.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleSave()}
                  disabled={isUpdating}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save className="h-4 w-4" />
                  Save Changes
                </button>
                <button
                  onClick={() => {
                    setNotificationEmail(location.notificationEmail || '');
                    setNotificationPhone(location.notificationPhone || '');
                    setLogoUrl(location.logoUrl || '');
                    setCancellationHours(location.cancellationPolicyHours || 24);
                    setCancellationMessage(location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time.");
                    setDailyBookingLimit(location.defaultDailyBookingLimit || 2);
                    setMinimumBookingWindowHours(location.minimumBookingWindowHours || 1);
                  }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Booking Portal Section */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Building2 className="h-5 w-5 text-indigo-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Public Booking Portal</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Share this link with third parties to allow them to book kitchens directly. They can submit booking requests without needing an account.
                </p>
              </div>
            </div>

            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 md:p-6 space-y-4 shadow-md">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Booking Portal URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/portal/${location.name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '')}`}
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2 bg-white text-gray-900 font-mono text-sm"
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      const locationSlug = location.name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
                      const url = `${window.location.origin}/portal/${locationSlug}`;
                      navigator.clipboard.writeText(url);
                      toast({
                        title: "Copied!",
                        description: "Booking portal URL copied to clipboard",
                      });
                    }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                  >
                    Copy Link
                  </Button>
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  Share this link with third-party customers. They can book kitchens without needing to create an account.
                </p>
              </div>
            </div>
          </div>

          {/* Location Logo Section */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <ImageIcon className="h-5 w-5 text-green-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Location Logo</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Upload your kitchen location logo to display in the manager header alongside the Local Cooks logo.
                </p>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Logo Image
                </label>
                {logoUrl ? (
                  <div className="flex items-center gap-4 mb-4">
                    <img 
                      src={logoUrl} 
                      alt="Location logo" 
                      className="h-16 w-auto object-contain border border-gray-200 rounded-lg p-2 bg-white"
                    />
                    <div className="flex-1">
                      <p className="text-sm text-gray-600">Current logo</p>
                      <button
                        onClick={() => setLogoUrl('')}
                        className="text-sm text-red-600 hover:text-red-700 mt-1"
                      >
                        Remove logo
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleLogoUpload(file).catch((error) => {
                          console.error('Logo upload failed:', error);
                        });
                      }
                    }}
                    disabled={isUploadingLogo}
                    className="hidden"
                    id="logo-upload"
                  />
                  <label
                    htmlFor="logo-upload"
                    className="cursor-pointer flex flex-col items-center gap-2"
                  >
                    {isUploadingLogo ? (
                      <>
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
                        <span className="text-sm text-gray-600">Uploading...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="h-8 w-8 text-gray-400" />
                        <span className="text-sm font-medium text-green-600">Click to upload logo</span>
                        <span className="text-xs text-gray-500">PNG, JPG, WebP (max 4.5MB)</span>
                      </>
                    )}
                  </label>
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  Logo will appear in the manager header next to Local Cooks logo
                </p>
              </div>
            </div>
          </div>

          {/* Cancellation Policy Section */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Cancellation Policy</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Configure when chefs can cancel their bookings. This policy applies to all kitchens at this location.
                </p>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Cancellation Window (Hours)
                </label>
                <input
                  type="number"
                  min="0"
                  max="168"
                  value={cancellationHours}
                  onChange={(e) => setCancellationHours(parseInt(e.target.value) || 0)}
                  className="w-full max-w-xs border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-600 mt-1">
                  Minimum hours before booking time that cancellation is allowed (0 = no restrictions)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Policy Message
                </label>
                <textarea
                  value={cancellationMessage}
                  onChange={(e) => setCancellationMessage(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Bookings cannot be cancelled within {hours} hours of the scheduled time."
                />
                <p className="text-xs text-gray-600 mt-1">
                  Use {"{hours}"} as a placeholder for the cancellation window. This message will be shown to chefs when they try to cancel.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleSave()}
                  disabled={isUpdating}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save className="h-4 w-4" />
                  Save Changes
                </button>
                <button
                  onClick={() => {
                    setCancellationHours(location.cancellationPolicyHours || 24);
                    setCancellationMessage(location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time.");
                    setDailyBookingLimit(location.defaultDailyBookingLimit || 2);
                    setMinimumBookingWindowHours(location.minimumBookingWindowHours || 1);
                  }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Daily Booking Limit Section */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-green-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Daily Booking Limit</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Set the default maximum hours a chef can book per day. This applies to all kitchens at this location unless overridden for specific dates.
                </p>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Default Hours per Chef per Day
                </label>
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={dailyBookingLimit}
                  onChange={(e) => setDailyBookingLimit(parseInt(e.target.value) || 2)}
                  className="w-full max-w-xs border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-green-500 focus:border-green-500"
                />
                <p className="text-xs text-gray-600 mt-1">
                  Maximum hours a chef can book in a single day across all kitchens at this location (1-24 hours)
                </p>
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
                  <Info className="h-3 w-3 inline mr-1" />
                  <strong>Note:</strong> You can override this limit for specific dates in the Availability calendar. Date-specific overrides take precedence.
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleSave()}
                  disabled={isUpdating}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save className="h-4 w-4" />
                  Save All Settings
                </button>
                <button
                  onClick={() => {
                    setCancellationHours(location.cancellationPolicyHours || 24);
                    setCancellationMessage(location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time.");
                    setDailyBookingLimit(location.defaultDailyBookingLimit || 2);
                    setMinimumBookingWindowHours(location.minimumBookingWindowHours || 1);
                    setLogoUrl(location.logoUrl || '');
                  }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Reset All
                </button>
              </div>
            </div>
          </div>

          {/* Timezone Section */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Globe className="h-5 w-5 text-cyan-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Timezone Settings</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Set the timezone for this location. All booking times will be interpreted according to this timezone.
                </p>
              </div>
            </div>

            <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Location Timezone
                </label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full max-w-md border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                >
                  {timezoneOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-600 mt-1">
                  All booking times for this location will be interpreted in this timezone. This affects when bookings are considered "past", "upcoming", or "active".
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleSave()}
                  disabled={isUpdating}
                  className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save className="h-4 w-4" />
                  Save Changes
                </button>
                <button
                  onClick={() => {
                    setTimezone(location.timezone || DEFAULT_TIMEZONE);
                  }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Minimum Booking Window Section */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-orange-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Minimum Booking Window</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Set the minimum advance notice required for bookings. Chefs cannot book a kitchen within this time window. This prevents last-minute bookings and gives managers time to prepare.
                </p>
              </div>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Minimum Hours in Advance
                </label>
                <input
                  type="number"
                  min="0"
                  max="168"
                  value={minimumBookingWindowHours}
                  onChange={(e) => setMinimumBookingWindowHours(parseInt(e.target.value) || 1)}
                  className="w-full max-w-xs border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                />
                <p className="text-xs text-gray-600 mt-1">
                  Chefs must book at least this many hours before the booking time (0 = no restrictions, default: 1 hour)
                </p>
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
                  <Info className="h-3 w-3 inline mr-1" />
                  <strong>Example:</strong> With 1 hour, if it's 1:00 PM, chefs can only book times starting from 2:00 PM onwards.
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleSave()}
                  disabled={isUpdating}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save className="h-4 w-4" />
                  Save All Settings
                </button>
                <button
                  onClick={() => {
                    setCancellationHours(location.cancellationPolicyHours || 24);
                    setCancellationMessage(location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time.");
                    setDailyBookingLimit(location.defaultDailyBookingLimit || 2);
                    setMinimumBookingWindowHours(location.minimumBookingWindowHours || 1);
                    setLogoUrl(location.logoUrl || '');
                    setTimezone(location.timezone || DEFAULT_TIMEZONE);
                  }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Reset All
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Account Settings Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 mt-6">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Account Settings</h2>
          <p className="text-sm text-gray-600 mt-1">Manage your account password</p>
        </div>
        <div className="p-6">
          <ChangePassword role="manager" />
        </div>
      </div>
    </div>
  );
}

