import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Calendar, Clock, MapPin, ChefHat, Settings, BookOpen, 
  X, Check, Save, AlertCircle, Building2, FileText, 
  ChevronLeft, ChevronRight, Sliders, Info, Mail
} from "lucide-react";
import { Link, useLocation } from "wouter";
import CalendarComponent from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { useManagerDashboard } from "../hooks/use-manager-dashboard";
import { useToast } from "@/hooks/use-toast";
import ManagerHeader from "@/components/layout/ManagerHeader";
import Footer from "@/components/layout/Footer";
import KitchenAvailabilityManagement from "./KitchenAvailabilityManagement";
import ManagerBookingsPanel from "./ManagerBookingsPanel";

interface Location {
  id: number;
  name: string;
  address: string;
  cancellationPolicyHours?: number;
  cancellationPolicyMessage?: string;
  defaultDailyBookingLimit?: number;
  notificationEmail?: string;
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

type ViewType = 'overview' | 'bookings' | 'availability' | 'settings';

export default function ManagerBookingDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, isLoadingLocations } = useManagerDashboard();
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [activeView, setActiveView] = useState<ViewType>('bookings');

  // Auto-select location if only one exists
  useEffect(() => {
    if (!isLoadingLocations && locations.length === 1 && !selectedLocation) {
      setSelectedLocation(locations[0]);
    }
  }, [locations, isLoadingLocations, selectedLocation]);

  // Fetch location details with cancellation policy
  const { data: locationDetails } = useQuery<Location>({
    queryKey: ['locationDetails', selectedLocation?.id],
    queryFn: async () => {
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
    mutationFn: async ({ locationId, cancellationPolicyHours, cancellationPolicyMessage, defaultDailyBookingLimit, notificationEmail }: {
      locationId: number;
      cancellationPolicyHours?: number;
      cancellationPolicyMessage?: string;
      defaultDailyBookingLimit?: number;
      notificationEmail?: string;
    }) => {
      const payload = { cancellationPolicyHours, cancellationPolicyMessage, defaultDailyBookingLimit, notificationEmail };
      console.log('📡 Sending PUT request to:', `/api/manager/locations/${locationId}/cancellation-policy`);
      console.log('📡 Request body:', payload);
      
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
    { id: 'settings' as ViewType, label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <ManagerHeader />
      <main className="flex-1 pt-24 pb-8">
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
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
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
              <nav className="bg-white rounded-lg shadow-sm border border-gray-200 p-2">
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
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
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
              
              {activeView === 'settings' && selectedLocation && (
                <SettingsView 
                  location={locationDetails || selectedLocation}
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
  const { bookings, isLoadingBookings } = useManagerDashboard();
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  
  const pendingBookings = bookings.filter((b: any) => b.status === "pending");
  const confirmedBookings = bookings.filter((b: any) => b.status === "confirmed");
  const cancelledBookings = bookings.filter((b: any) => b.status === "cancelled");

  // Group bookings by date
  const bookingsByDate = useMemo(() => {
    const grouped: { [key: string]: any[] } = {};
    bookings.forEach((booking: any) => {
      const dateStr = new Date(booking.bookingDate).toISOString().split('T')[0];
      if (!grouped[dateStr]) {
        grouped[dateStr] = [];
      }
      grouped[dateStr].push(booking);
    });
    return grouped;
  }, [bookings]);

  // Get bookings for a specific date
  const getBookingsForDate = (date: Date): any[] => {
    const dateStr = date.toISOString().split('T')[0];
    return bookingsByDate[dateStr] || [];
  };

  // Format date to YYYY-MM-DD for comparison
  const formatDateKey = (date: Date): string => {
    return date.toISOString().split('T')[0];
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
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
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

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
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

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
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
          <h2 className="text-xl font-semibold text-gray-900">Booking Calendar</h2>
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
          <CalendarComponent
            onChange={setSelectedDate}
            value={selectedDate}
            tileContent={tileContent}
            tileClassName={tileClassName}
            className="w-full border-0"
            locale="en-US"
          />
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
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Bookings for {selectedDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </h3>
            <button
              onClick={() => setSelectedDate(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {getBookingsForDate(selectedDate).length === 0 ? (
            <p className="text-gray-500">No bookings on this date</p>
          ) : (
            <div className="space-y-3">
              {getBookingsForDate(selectedDate).map((booking: any) => (
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
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          booking.status === 'pending'
                            ? 'bg-yellow-100 text-yellow-800'
                            : booking.status === 'confirmed'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {booking.status.toUpperCase()}
                        </span>
                        <span className="text-sm font-medium text-gray-900">
                          {booking.startTime?.slice(0, 5)} - {booking.endTime?.slice(0, 5)}
                        </span>
                      </div>
                      {booking.kitchenName && (
                        <p className="text-sm text-gray-600">Kitchen: {booking.kitchenName}</p>
                      )}
                      {booking.specialNotes && (
                        <p className="text-sm text-gray-500 mt-1">{booking.specialNotes}</p>
                      )}
                    </div>
                    <button
                      onClick={() => onNavigate('bookings')}
                      className="ml-4 px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              ))}
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
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors text-left w-full"
          >
            <BookOpen className="h-5 w-5 text-blue-600" />
            <div>
              <p className="font-medium text-gray-900">Review Bookings</p>
              <p className="text-sm text-gray-600">Manage pending requests</p>
            </div>
          </button>
          <button
            onClick={() => onNavigate('availability')}
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors text-left w-full"
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
  const [cancellationHours, setCancellationHours] = useState(location.cancellationPolicyHours || 24);
  const [cancellationMessage, setCancellationMessage] = useState(
    location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time."
  );
  const [dailyBookingLimit, setDailyBookingLimit] = useState(location.defaultDailyBookingLimit || 2);
  const [notificationEmail, setNotificationEmail] = useState(location.notificationEmail || '');

  // Update state when location prop changes (e.g., after saving or switching tabs)
  useEffect(() => {
    setCancellationHours(location.cancellationPolicyHours || 24);
    setCancellationMessage(
      location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time."
    );
    setDailyBookingLimit(location.defaultDailyBookingLimit || 2);
    // Show the actual notificationEmail from the database, not the username
    // notificationEmail should be what's saved in notification_email column
    const savedEmail = location.notificationEmail || '';
    console.log('SettingsView: Loading notificationEmail from location:', {
      locationId: location.id,
      notificationEmail: savedEmail,
      fullLocation: location
    });
    setNotificationEmail(savedEmail);
  }, [location]);

  const handleSave = () => {
    if (!location.id) return;
    
    const payload = {
      locationId: location.id,
      cancellationPolicyHours: cancellationHours,
      cancellationPolicyMessage: cancellationMessage,
      defaultDailyBookingLimit: dailyBookingLimit,
      notificationEmail: notificationEmail || undefined,
    };
    
    console.log('🚀 Saving location settings:', payload);
    
    onUpdateSettings.mutate(payload);
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

            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-4">
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

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={isUpdating}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save className="h-4 w-4" />
                  Save Changes
                </button>
                <button
                  onClick={() => {
                    setNotificationEmail(location.notificationEmail || '');
                    setCancellationHours(location.cancellationPolicyHours || 24);
                    setCancellationMessage(location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time.");
                    setDailyBookingLimit(location.defaultDailyBookingLimit || 2);
                  }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Reset
                </button>
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
                  onClick={handleSave}
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
                  onClick={handleSave}
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
    </div>
  );
}

