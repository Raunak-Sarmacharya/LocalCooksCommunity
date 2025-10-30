import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Calendar, Clock, MapPin, ChefHat, Settings, BookOpen, 
  X, Check, Save, AlertCircle, Building2, FileText, 
  ChevronLeft, ChevronRight, Sliders, Info
} from "lucide-react";
import { Link, useLocation } from "wouter";
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
  const [activeView, setActiveView] = useState<ViewType>('overview');

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
      if (!response.ok) throw new Error('Failed to fetch locations');
      const locations = await response.json();
      return locations.find((l: Location) => l.id === selectedLocation.id) || selectedLocation;
    },
    enabled: !!selectedLocation?.id,
  });

  // Update location settings mutation
  const updateLocationSettings = useMutation({
    mutationFn: async ({ locationId, cancellationPolicyHours, cancellationPolicyMessage, defaultDailyBookingLimit }: {
      locationId: number;
      cancellationPolicyHours?: number;
      cancellationPolicyMessage?: string;
      defaultDailyBookingLimit?: number;
    }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${locationId}/cancellation-policy`, {
        method: 'PUT',
        headers,
        credentials: "include",
        body: JSON.stringify({ cancellationPolicyHours, cancellationPolicyMessage, defaultDailyBookingLimit }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update location settings');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locationDetails', selectedLocation?.id] });
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
                <ManagerBookingsPanel />
              )}
              
              {activeView === 'availability' && selectedLocation && (
                <KitchenAvailabilityManagement />
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
  
  const pendingBookings = bookings.filter((b: any) => b.status === "pending");
  const confirmedBookings = bookings.filter((b: any) => b.status === "confirmed");
  const cancelledBookings = bookings.filter((b: any) => b.status === "cancelled");

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

  const handleSave = () => {
    if (!location.id) return;
    onUpdateSettings.mutate({
      locationId: location.id,
      cancellationPolicyHours: cancellationHours,
      cancellationPolicyMessage: cancellationMessage,
      defaultDailyBookingLimit: dailyBookingLimit,
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Location Settings</h2>
          <p className="text-sm text-gray-600 mt-1">{location.name}</p>
        </div>

        <div className="p-6 space-y-6">
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

