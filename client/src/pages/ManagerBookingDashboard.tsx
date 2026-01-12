import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Calendar, Clock, MapPin, ChefHat, Settings, BookOpen, 
  X, Check, Save, AlertCircle, Building2, FileText, 
  ChevronLeft, ChevronRight, Sliders, Info, Mail, User, Users, Upload, Image as ImageIcon, Globe, Phone, DollarSign, Package, Wrench, CheckCircle, Plus, Loader2, CreditCard, Menu, TrendingUp
} from "lucide-react";
import { ImageWithReplace } from "@/components/ui/image-with-replace";
import { getTimezoneOptions, DEFAULT_TIMEZONE } from "@/utils/timezone-utils";
import { Link, useLocation } from "wouter";
import CalendarComponent from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { useManagerDashboard } from "../hooks/use-manager-dashboard";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ManagerHeader from "@/components/layout/ManagerHeader";
import Footer from "@/components/layout/Footer";
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs";
import KitchenAvailabilityManagement from "./KitchenAvailabilityManagement";
import ManagerBookingsPanel from "./ManagerBookingsPanel";
import ManagerKitchenApplications from "./ManagerKitchenApplications";
import KitchenPricingManagement from "./KitchenPricingManagement";
import StorageListingManagement from "./StorageListingManagement";
import EquipmentListingManagement from "./EquipmentListingManagement";
import ChangePassword from "@/components/auth/ChangePassword";
import KitchenDashboardOverview from "@/components/dashboard/KitchenDashboardOverview";
import ManagerOnboardingWizard from "@/components/manager/ManagerOnboardingWizard";
import StripeConnectSetup from "@/components/manager/StripeConnectSetup";
import AnimatedManagerSidebar from "@/components/manager/AnimatedManagerSidebar";
import ManagerLocationsPage from "@/components/manager/ManagerLocationsPage";
import ManagerRevenueDashboard from "./ManagerRevenueDashboard";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

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
  kitchenLicenseUrl?: string;
  kitchenLicenseStatus?: string;
  kitchenLicenseApprovedBy?: number;
  kitchenLicenseApprovedAt?: string;
  kitchenLicenseFeedback?: string;
}

interface Kitchen {
  id: number;
  name: string;
  description?: string;
  imageUrl?: string;
  locationId: number;
  isActive: boolean;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  try {
    const { auth } = await import('@/lib/firebase');
    const currentUser = auth.currentUser;
    
    if (currentUser?.uid) {
      // Get fresh Firebase token
      try {
        const token = await currentUser.getIdToken();
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
          return headers;
        }
      } catch (tokenError) {
        console.error('Failed to get Firebase token:', tokenError);
      }
    }
    
    // Fallback to localStorage if Firebase auth not ready
    const storedToken = localStorage.getItem('firebaseToken');
    if (storedToken) {
      headers['Authorization'] = `Bearer ${storedToken}`;
    }
  } catch (error) {
    console.error('Error getting auth headers:', error);
    // Fallback to localStorage
    const storedToken = localStorage.getItem('firebaseToken');
    if (storedToken) {
      headers['Authorization'] = `Bearer ${storedToken}`;
    }
  }
  
  return headers;
}

type ViewType = 'my-locations' | 'overview' | 'bookings' | 'availability' | 'settings' | 'applications' | 'pricing' | 'storage-listings' | 'equipment-listings' | 'payments' | 'revenue';

export default function ManagerBookingDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, isLoadingLocations } = useManagerDashboard();
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [activeView, setActiveView] = useState<ViewType>('overview');
  const [showCreateLocation, setShowCreateLocation] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationAddress, setNewLocationAddress] = useState('');
  const [newLocationNotificationEmail, setNewLocationNotificationEmail] = useState('');
  const [newLocationNotificationPhone, setNewLocationNotificationPhone] = useState('');
  const [newLocationLicenseFile, setNewLocationLicenseFile] = useState<File | null>(null);
  const [isUploadingLicense, setIsUploadingLicense] = useState(false);
  const [isCreatingLocation, setIsCreatingLocation] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const footerRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(96); // Default header height
  const [sidebarStyle, setSidebarStyle] = useState<React.CSSProperties>({
    position: 'sticky',
    top: '96px', // Start with default header height, will be updated when measured
    left: 0,
    alignSelf: 'flex-start',
  });

  // Measure header height and track scroll position
  useEffect(() => {
    const handleScroll = () => {
      const header = headerRef.current || document.querySelector('header');
      const footer = footerRef.current || document.querySelector('footer');
      
      if (!header) return;
      
      // Measure actual header height dynamically
      const headerRect = header.getBoundingClientRect();
      const measuredHeaderHeight = headerRect.height;
      setHeaderHeight(measuredHeaderHeight); // Store for use in content padding
      const viewportHeight = window.innerHeight;
      const sidebarAvailableHeight = viewportHeight - measuredHeaderHeight;
      
      // Sidebar sticky positioning is now handled directly in the JSX
      // No need to update sidebarStyle for top position
    };

    // Measure header on mount and resize
    const measureHeader = () => {
      const header = headerRef.current || document.querySelector('header');
      if (header) {
        const headerRect = header.getBoundingClientRect();
        const measuredHeaderHeight = headerRect.height;
        setHeaderHeight(measuredHeaderHeight);
        handleScroll();
      }
    };

    // Measure immediately
    measureHeader();
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', measureHeader);
    
    // Also measure after DOM is ready
    requestAnimationFrame(() => {
      measureHeader();
    });
    
    // Measure after a short delay to catch any dynamic header changes
    const timeoutId = setTimeout(() => {
      measureHeader();
    }, 100);
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', measureHeader);
      clearTimeout(timeoutId);
    };
  }, []);

  // Check onboarding status using Firebase auth
  const { user: firebaseUser } = useFirebaseAuth();
  
  const { data: userData } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      try {
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) return null;
        const token = await currentFirebaseUser.getIdToken();
        const response = await fetch("/api/user/profile", {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        if (!response.ok) return null;
        return response.json();
      } catch (error) {
        console.error('Error fetching user profile:', error);
        return null;
      }
    },
    enabled: !!firebaseUser,
  });

  const needsOnboarding =
    userData?.role === "manager" &&
    !userData?.manager_onboarding_completed &&
    !userData?.manager_onboarding_skipped;

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
    { id: 'my-locations' as ViewType, label: 'My Locations', icon: Building2 },
    { id: 'overview' as ViewType, label: 'Overview', icon: Calendar },
    { id: 'bookings' as ViewType, label: 'Bookings', icon: BookOpen },
    { id: 'availability' as ViewType, label: 'Availability', icon: Clock },
    { id: 'pricing' as ViewType, label: 'Pricing', icon: DollarSign },
    { id: 'storage-listings' as ViewType, label: 'Storage Listings', icon: Package },
    { id: 'equipment-listings' as ViewType, label: 'Equipment Listings', icon: Wrench },
    { id: 'applications' as ViewType, label: 'Applications', icon: Users },
    { id: 'revenue' as ViewType, label: 'Revenue', icon: TrendingUp },
    { id: 'payments' as ViewType, label: 'Payments', icon: CreditCard },
    { id: 'settings' as ViewType, label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 relative">
      <AnimatedBackgroundOrbs variant="both" intensity="subtle" />
      <div ref={headerRef as React.RefObject<HTMLDivElement>}>
        <ManagerHeader />
      </div>
      <ManagerOnboardingWizard />
      <div 
        style={{
          marginTop: `${headerHeight}px`,
        }}
      >
        <main 
          className="flex-1 pb-8 relative z-10 flex min-h-0"
        >
          {/* Animated Sidebar - scroll-aware height */}
          <div 
            className="hidden lg:block z-20 flex-shrink-0" 
            style={{ 
              position: 'sticky',
              top: `${headerHeight}px`, // Stick below fixed header (viewport-relative)
              left: 0,
              alignSelf: 'flex-start',
              width: isSidebarCollapsed ? '80px' : '280px',
              transition: 'max-height 0.2s ease-out, top 0.2s ease-out, width 0.3s ease-out',
              overflowY: 'auto',
              overflowX: 'hidden',
              height: `calc(100vh - ${headerHeight}px)`,
              maxHeight: `calc(100vh - ${headerHeight}px)`,
              paddingTop: '80px',
            }}
          >
          <AnimatedManagerSidebar
            navItems={navItems}
            activeView={activeView}
            onViewChange={(view) => setActiveView(view as ViewType)}
            selectedLocation={selectedLocation ? {
              id: selectedLocation.id,
              name: selectedLocation.name,
              address: selectedLocation.address,
              logoUrl: selectedLocation.logoUrl,
            } : null}
            locations={locations.map((loc: any) => ({ id: loc.id, name: loc.name }))}
            onLocationChange={(loc) => {
              if (loc) {
                const fullLocation = locations.find((l: any) => l.id === loc.id);
                setSelectedLocation(fullLocation || null);
              } else {
                setSelectedLocation(null);
              }
            }}
            onCreateLocation={() => setShowCreateLocation(true)}
            isLoadingLocations={isLoadingLocations}
            onCollapseChange={setIsSidebarCollapsed}
          />
        </div>
        
        {/* Mobile Sidebar - Sheet/Drawer */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetContent side="left" className="w-[280px] p-0">
            <AnimatedManagerSidebar
              navItems={navItems}
              activeView={activeView}
              onViewChange={(view) => {
                setActiveView(view as ViewType);
                setMobileMenuOpen(false);
              }}
              selectedLocation={selectedLocation ? {
                id: selectedLocation.id,
                name: selectedLocation.name,
                address: selectedLocation.address,
              } : null}
              locations={locations.map((loc: any) => ({ id: loc.id, name: loc.name }))}
              onLocationChange={(loc) => {
                if (loc) {
                  const fullLocation = locations.find((l: any) => l.id === loc.id);
                  setSelectedLocation(fullLocation || null);
                } else {
                  setSelectedLocation(null);
                }
              }}
              onCreateLocation={() => {
                setShowCreateLocation(true);
                setMobileMenuOpen(false);
              }}
              isLoadingLocations={isLoadingLocations}
              isMobile={true}
            />
          </SheetContent>
        </Sheet>
        
        {/* Mobile Menu Button */}
        <div 
          className="lg:hidden fixed left-3 sm:left-4 z-30"
          style={{
            top: `${headerHeight + 8}px`, // Position below header with small gap
          }}
        >
          <Button
            variant="outline"
            size="icon"
            onClick={() => setMobileMenuOpen(true)}
            className="bg-white shadow-lg mobile-touch-target mobile-no-tap-highlight"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>

        <div 
          className="flex-1 transition-all duration-300 min-w-0"
          style={{
            paddingTop: '80px',
          }}
        >
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-7xl">
          {/* Onboarding Reminder Banner */}
          {needsOnboarding && (
            <div className="mb-4 sm:mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-3 sm:p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2 sm:gap-3">
                  <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs sm:text-sm font-semibold text-blue-900 mb-1">
                      Complete Your Setup to Activate Bookings
                    </h3>
                    <p className="text-xs sm:text-sm text-blue-700 mb-2 sm:mb-3">
                      Finish your onboarding to start accepting bookings. Upload your kitchen license
                      and get it approved by an admin to activate bookings.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* License Approval Reminder */}
          {!needsOnboarding &&
            selectedLocation &&
            selectedLocation.kitchenLicenseStatus !== "approved" && (
              <div className="mb-4 sm:mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-3 sm:p-4 shadow-sm">
                <div className="flex items-start gap-2 sm:gap-3">
                  <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xs sm:text-sm font-semibold text-yellow-900 mb-1">
                      {selectedLocation.kitchenLicenseStatus === "pending"
                        ? "License Pending Approval"
                        : selectedLocation.kitchenLicenseStatus === "rejected"
                        ? "License Rejected"
                        : "License Not Uploaded"}
                    </h3>
                    <p className="text-xs sm:text-sm text-yellow-700 mb-2">
                      {selectedLocation.kitchenLicenseStatus === "pending"
                        ? "Your kitchen license is pending admin approval. Bookings will be activated once approved."
                        : selectedLocation.kitchenLicenseStatus === "rejected"
                        ? selectedLocation.kitchenLicenseFeedback ||
                          "Your license was rejected. Please upload a new one."
                        : "Upload your kitchen license to activate bookings."}
                    </p>
                    {selectedLocation.kitchenLicenseStatus !== "pending" && (
                      <Button
                        onClick={() => setActiveView("settings")}
                        size="sm"
                        variant="outline"
                        className="border-yellow-300 text-yellow-700 hover:bg-yellow-100 min-h-[36px] sm:min-h-[40px] text-xs sm:text-sm"
                      >
                        Upload License
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

          {/* Header - Only show on non-overview pages */}
          {activeView !== 'overview' && (
            <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Booking Management</h1>
                <p className="text-sm sm:text-base text-gray-600 mt-1">Manage locations, bookings, and availability settings</p>
              </div>
            </div>
          )}

          {/* Create Location Dialog */}
          {showCreateLocation && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 sm:p-6">
              <div className="bg-white rounded-lg sm:rounded-xl shadow-xl max-w-lg w-full p-4 sm:p-6 max-h-[90vh] overflow-y-auto mobile-momentum-scroll">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {locations.length === 0 ? 'Create Your First Location' : 'Add New Location'}
                  </h3>
                  <button
                    onClick={() => {
                      setShowCreateLocation(false);
                      setNewLocationName('');
                      setNewLocationAddress('');
                      setNewLocationNotificationEmail('');
                      setNewLocationNotificationPhone('');
                      setNewLocationLicenseFile(null);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                
                {/* Info banner for additional locations */}
                {locations.length > 0 && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-amber-800">
                        <p className="font-medium mb-1">License Required for Each Location</p>
                        <p className="text-xs">Each location requires its own kitchen license approval before bookings can be accepted. You can upload the license now or later from the settings.</p>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Location Name *
                    </label>
                    <input
                      type="text"
                      value={newLocationName}
                      onChange={(e) => setNewLocationName(e.target.value)}
                      placeholder="e.g., Downtown Kitchen"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#F51042] focus:border-[#F51042]"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Address *
                    </label>
                    <input
                      type="text"
                      value={newLocationAddress}
                      onChange={(e) => setNewLocationAddress(e.target.value)}
                      placeholder="e.g., 123 Main St, St. John's, NL"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#F51042] focus:border-[#F51042]"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Notification Email
                      </label>
                      <input
                        type="email"
                        value={newLocationNotificationEmail}
                        onChange={(e) => setNewLocationNotificationEmail(e.target.value)}
                        placeholder="email@example.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#F51042] focus:border-[#F51042]"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Notification Phone
                      </label>
                      <input
                        type="tel"
                        value={newLocationNotificationPhone}
                        onChange={(e) => setNewLocationNotificationPhone(e.target.value)}
                        placeholder="(709) 555-1234"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#F51042] focus:border-[#F51042]"
                      />
                    </div>
                  </div>
                  
                  {/* Kitchen License Upload */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Kitchen License {locations.length > 0 ? '*' : '(Optional - can add later)'}
                    </label>
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-[#F51042] transition-colors">
                      {newLocationLicenseFile ? (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-[#F51042]" />
                            <span className="text-sm text-gray-700">{newLocationLicenseFile.name}</span>
                          </div>
                          <button
                            onClick={() => setNewLocationLicenseFile(null)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <label className="cursor-pointer flex flex-col items-center gap-2">
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                if (file.size > 10 * 1024 * 1024) {
                                  toast({
                                    title: "File Too Large",
                                    description: "Please upload a file smaller than 10MB",
                                    variant: "destructive",
                                  });
                                  return;
                                }
                                setNewLocationLicenseFile(file);
                              }
                            }}
                            className="hidden"
                          />
                          <Upload className="h-8 w-8 text-gray-400" />
                          <span className="text-sm font-medium text-[#F51042]">Click to upload license</span>
                          <span className="text-xs text-gray-500">PDF, JPG, or PNG (max 10MB)</span>
                        </label>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Required for booking activation. Will be reviewed by admin.
                    </p>
                  </div>
                  
                  <div className="flex gap-2 pt-2">
                    <Button
                      onClick={async () => {
                        if (!newLocationName.trim() || !newLocationAddress.trim()) {
                          toast({
                            title: "Missing Information",
                            description: "Please fill in location name and address",
                            variant: "destructive",
                          });
                          return;
                        }
                        
                        setIsCreatingLocation(true);
                        try {
                          const currentFirebaseUser = auth.currentUser;
                          if (!currentFirebaseUser) {
                            throw new Error("Firebase user not available");
                          }
                          
                          const token = await currentFirebaseUser.getIdToken();
                          
                          // Upload license file if provided
                          let licenseUrl: string | undefined;
                          if (newLocationLicenseFile) {
                            setIsUploadingLicense(true);
                            const formData = new FormData();
                            formData.append("file", newLocationLicenseFile);
                            
                            const uploadResponse = await fetch("/api/upload-file", {
                              method: "POST",
                              headers: {
                                'Authorization': `Bearer ${token}`,
                              },
                              credentials: "include",
                              body: formData,
                            });
                            
                            if (!uploadResponse.ok) {
                              throw new Error("Failed to upload license file");
                            }
                            
                            const uploadResult = await uploadResponse.json();
                            licenseUrl = uploadResult.url;
                            setIsUploadingLicense(false);
                          }
                          
                          // Create the location
                          const response = await fetch(`/api/manager/locations`, {
                            method: "POST",
                            headers: {
                              'Authorization': `Bearer ${token}`,
                              'Content-Type': 'application/json',
                            },
                            credentials: "include",
                            body: JSON.stringify({
                              name: newLocationName.trim(),
                              address: newLocationAddress.trim(),
                              notificationEmail: newLocationNotificationEmail.trim() || undefined,
                              notificationPhone: newLocationNotificationPhone.trim() || undefined,
                            }),
                          });
                          
                          if (!response.ok) {
                            const error = await response.json();
                            throw new Error(error.error || "Failed to create location");
                          }
                          
                          const newLocation = await response.json();
                          
                          // Update location with license if uploaded
                          if (licenseUrl) {
                            const updateResponse = await fetch(`/api/manager/locations/${newLocation.id}`, {
                              method: "PUT",
                              headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json',
                              },
                              credentials: "include",
                              body: JSON.stringify({
                                kitchenLicenseUrl: licenseUrl,
                                kitchenLicenseStatus: 'pending',
                              }),
                            });
                            
                            if (!updateResponse.ok) {
                              console.error("Failed to update license, but location was created");
                            }
                          }
                          
                          queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
                          toast({
                            title: "Location Created",
                            description: licenseUrl 
                              ? `${newLocation.name} has been created. License submitted for approval.`
                              : `${newLocation.name} has been created. Upload a license to activate bookings.`,
                          });
                          
                          setNewLocationName('');
                          setNewLocationAddress('');
                          setNewLocationNotificationEmail('');
                          setNewLocationNotificationPhone('');
                          setNewLocationLicenseFile(null);
                          setShowCreateLocation(false);
                          setSelectedLocation(newLocation);
                        } catch (error: any) {
                          toast({
                            title: "Error",
                            description: error.message || "Failed to create location",
                            variant: "destructive",
                          });
                        } finally {
                          setIsCreatingLocation(false);
                          setIsUploadingLicense(false);
                        }
                      }}
                      disabled={isCreatingLocation || isUploadingLicense}
                      className="flex-1 bg-[#F51042] hover:bg-rose-600 text-white"
                    >
                      {isUploadingLicense ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          Uploading License...
                        </>
                      ) : isCreatingLocation ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-1" />
                          Create Location
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowCreateLocation(false);
                        setNewLocationName('');
                        setNewLocationAddress('');
                        setNewLocationNotificationEmail('');
                        setNewLocationNotificationPhone('');
                        setNewLocationLicenseFile(null);
                      }}
                      disabled={isCreatingLocation || isUploadingLicense}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <div className="w-full">
              {/* Show onboarding prompt if manager has no locations */}
              {locations.length === 0 && !isLoadingLocations ? (
                <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg border border-gray-200 p-6 sm:p-8 md:p-12 text-center">
                  <Building2 className="h-12 w-12 sm:h-16 sm:w-16 text-gray-300 mx-auto mb-3 sm:mb-4" />
                  <h3 className="text-xl sm:text-2xl font-semibold text-gray-900 mb-2">No Locations Yet</h3>
                  <p className="text-sm sm:text-base text-gray-600 mb-4 sm:mb-6 max-w-md mx-auto px-4">
                    You need to complete the setup wizard to create your first location and start accepting bookings.
                  </p>
                </div>
              ) : (
                <>
                  {activeView === 'my-locations' && (
                    <ManagerLocationsPage
                      locations={locations}
                      isLoading={isLoadingLocations}
                      onCreateLocation={() => setShowCreateLocation(true)}
                      onSelectLocation={(loc) => {
                        setSelectedLocation(loc as Location);
                        setActiveView('overview');
                      }}
                    />
                  )}
                  
                  {activeView === 'overview' && (
                    <KitchenDashboardOverview 
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
                  
                  {activeView === 'pricing' && (
                    <KitchenPricingManagement embedded={true} />
                  )}
                  
                  {activeView === 'storage-listings' && (
                    <StorageListingManagement embedded={true} />
                  )}
                  
                  {activeView === 'equipment-listings' && (
                    <EquipmentListingManagement embedded={true} />
                  )}
                  
                  {activeView === 'applications' && (
                    <ManagerKitchenApplications embedded={true} />
                  )}
                  
                  {activeView === 'revenue' && (
                    <ManagerRevenueDashboard 
                      selectedLocation={selectedLocation}
                      locations={locations}
                      onNavigate={(view) => setActiveView(view as ViewType)}
                    />
                  )}
                  
                  {activeView === 'payments' && (
                    <div className="space-y-6">
                      <div>
                        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Payment Setup</h2>
                        <p className="text-sm sm:text-base text-gray-600">
                          Connect your Stripe account to receive payments directly for kitchen bookings.
                        </p>
                      </div>
                      <StripeConnectSetup />
                    </div>
                  )}
                  
                  {activeView === 'settings' && selectedLocation && (
                    <SettingsView 
                      location={(locationDetails || selectedLocation) as Location}
                      onUpdateSettings={updateLocationSettings}
                      isUpdating={updateLocationSettings.isPending}
                    />
                  )}

                  {activeView === 'availability' && !selectedLocation && (
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-8 md:p-12 text-center">
                      <Calendar className="h-12 w-12 sm:h-16 sm:w-16 text-gray-300 mx-auto mb-3 sm:mb-4" />
                      <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
                      <p className="text-sm sm:text-base text-gray-500">Choose a location to manage availability</p>
                    </div>
                  )}

                  {activeView === 'settings' && !selectedLocation && (
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-8 md:p-12 text-center">
                      <Settings className="h-12 w-12 sm:h-16 sm:w-16 text-gray-300 mx-auto mb-3 sm:mb-4" />
                      <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
                      <p className="text-sm sm:text-base text-gray-500">Choose a location to manage settings</p>
                    </div>
                  )}
                </>
              )}
          </div>
          </div>
        </div>
        </main>
      </div>
      <Footer ref={footerRef} />
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
      // Get Firebase token for authentication
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      const token = await currentFirebaseUser.getIdToken();
      const headers: HeadersInit = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
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
  const queryClient = useQueryClient();
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
  const [uploadingKitchenId, setUploadingKitchenId] = useState<number | null>(null);
  const [kitchenDescriptions, setKitchenDescriptions] = useState<Record<number, string>>({});
  const [updatingKitchenId, setUpdatingKitchenId] = useState<number | null>(null);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [isUploadingLicense, setIsUploadingLicense] = useState(false);
  const [showCreateKitchen, setShowCreateKitchen] = useState(false);
  const [newKitchenName, setNewKitchenName] = useState('');
  const [newKitchenDescription, setNewKitchenDescription] = useState('');
  const [isCreatingKitchen, setIsCreatingKitchen] = useState(false);
  const timezoneOptions = getTimezoneOptions();

  // Fetch kitchens for this location
  const { data: kitchens = [], isLoading: isLoadingKitchens } = useQuery<Kitchen[]>({
    queryKey: ['managerKitchens', location.id],
    queryFn: async () => {
      // Get Firebase token for authentication
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      const token = await currentFirebaseUser.getIdToken();
      const headers: HeadersInit = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      const response = await fetch(`/api/manager/kitchens/${location.id}`, {
        headers,
        credentials: "include",
      });
      if (!response.ok) throw new Error('Failed to fetch kitchens');
      return response.json();
    },
    enabled: !!location.id,
  });

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

  // Initialize kitchen descriptions when kitchens are loaded
  useEffect(() => {
    if (kitchens.length > 0) {
      const descriptions: Record<number, string> = {};
      kitchens.forEach((kitchen) => {
        descriptions[kitchen.id] = kitchen.description || '';
      });
      setKitchenDescriptions(descriptions);
    }
  }, [kitchens]);

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


  // Handle kitchen description update
  const handleKitchenDescriptionUpdate = async (kitchenId: number, description: string) => {
    setUpdatingKitchenId(kitchenId);
    try {
      // Get Firebase token for authentication
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      const token = await currentFirebaseUser.getIdToken();
      const headers: HeadersInit = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      
      const updateResponse = await fetch(`/api/manager/kitchens/${kitchenId}`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify({ description }),
      });
      
      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        throw new Error(errorData.error || 'Failed to update kitchen description');
      }
      
      // Refresh the kitchens list
      queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
      
      toast({
        title: "Success",
        description: "Kitchen description updated successfully",
      });
    } catch (error: any) {
      console.error('Kitchen description update error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update kitchen description",
        variant: "destructive",
      });
    } finally {
      setUpdatingKitchenId(null);
    }
  };

  // Handle kitchen image upload
  const handleKitchenImageUpload = async (kitchenId: number, file: File) => {
    setUploadingKitchenId(kitchenId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const uploadResponse = await fetch('/api/upload-file', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      
      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json();
        throw new Error(errorData.error || 'Failed to upload image');
      }
      
      const uploadResult = await uploadResponse.json();
      const uploadedUrl = uploadResult.url;
      
      // Update the kitchen with the new image URL
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      const token = await currentFirebaseUser.getIdToken();
      const headers: HeadersInit = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      
      const updateResponse = await fetch(`/api/manager/kitchens/${kitchenId}/image`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify({ imageUrl: uploadedUrl }),
      });
      
      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        throw new Error(errorData.error || 'Failed to update kitchen image');
      }
      
      // Refresh the kitchens list
      queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
      
      toast({
        title: "Success",
        description: "Kitchen image uploaded successfully",
      });
      
      return uploadedUrl;
    } catch (error: any) {
      console.error('Kitchen image upload error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to upload kitchen image",
        variant: "destructive",
      });
      throw error;
    } finally {
      setUploadingKitchenId(null);
    }
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

  // Handle kitchen license upload
  const handleLicenseUpload = async (file: File) => {
    setIsUploadingLicense(true);
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
        throw new Error(errorData.error || 'Failed to upload license');
      }
      
      const result = await response.json();
      const licenseUrl = result.url;
      
      // Update location with new license URL and reset status to pending
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      const token = await currentFirebaseUser.getIdToken();
      const updateResponse = await fetch(`/api/manager/locations/${location.id}`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        },
        credentials: 'include',
        body: JSON.stringify({
          kitchenLicenseUrl: licenseUrl,
          kitchenLicenseStatus: 'pending',
        }),
      });
      
      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        throw new Error(errorData.error || 'Failed to update license');
      }
      
      // Refresh location data
      queryClient.invalidateQueries({ queryKey: ['/api/manager/locations'] });
      
      toast({
        title: "License Uploaded",
        description: "Your license has been submitted for admin approval.",
      });
      
      setLicenseFile(null);
      return licenseUrl;
    } catch (error: any) {
      console.error('License upload error:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload license",
        variant: "destructive",
      });
      throw error;
    } finally {
      setIsUploadingLicense(false);
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
          {/* Setup & Onboarding Section */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Setup & Onboarding</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Complete or update your location setup, upload kitchen license, and configure your preferences.
                </p>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 md:p-6 space-y-4 shadow-md">
              <div>
                <p className="text-sm text-gray-700 mb-4">
                  Use the onboarding wizard to set up your location details, upload your kitchen license, and configure notification preferences.
                </p>
              </div>
            </div>
          </div>

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

          {/* Kitchen License Section */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-orange-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Kitchen License</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Upload or update your kitchen license. Bookings will be activated once approved by an admin.
                </p>
              </div>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 md:p-6 space-y-4 shadow-md">
              {location.kitchenLicenseUrl && location.kitchenLicenseStatus !== "rejected" ? (
                <div className={`border rounded-lg p-4 ${
                  location.kitchenLicenseStatus === "approved" 
                    ? "bg-green-50 border-green-200" 
                    : "bg-yellow-50 border-yellow-200"
                }`}>
                  <div className={`flex items-center gap-2 ${
                    location.kitchenLicenseStatus === "approved" 
                      ? "text-green-800" 
                      : "text-yellow-800"
                  }`}>
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-medium">License Uploaded</span>
                  </div>
                  <p className={`text-sm mt-1 ${
                    location.kitchenLicenseStatus === "approved" 
                      ? "text-green-700" 
                      : "text-yellow-700"
                  }`}>
                    Status: {location.kitchenLicenseStatus || "pending"}
                  </p>
                  {location.kitchenLicenseStatus === "approved" && (
                    <p className="text-xs text-green-600 mt-1">
                      ✓ Your license has been approved! Bookings are now active.
                    </p>
                  )}
                  {location.kitchenLicenseStatus === "pending" && (
                    <p className="text-xs text-yellow-600 mt-1">
                      ⏳ Your license is pending admin approval. Bookings will be activated once approved.
                    </p>
                  )}
                  <a
                    href={location.kitchenLicenseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-700 mt-2 inline-block"
                  >
                    View Current License →
                  </a>
                </div>
              ) : location.kitchenLicenseStatus === "rejected" ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2 text-red-800 mb-2">
                    <AlertCircle className="h-5 w-5" />
                    <span className="font-medium">License Rejected</span>
                  </div>
                  {location.kitchenLicenseFeedback && (
                    <p className="text-sm text-red-700 mb-3">
                      <strong>Admin Feedback:</strong> {location.kitchenLicenseFeedback}
                    </p>
                  )}
                  <p className="text-sm text-red-700 mb-3">
                    Please upload a new license document to resubmit for approval.
                  </p>
                </div>
              ) : null}

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      if (file.size > 10 * 1024 * 1024) {
                        toast({
                          title: "File Too Large",
                          description: "Please upload a file smaller than 10MB",
                          variant: "destructive",
                        });
                        return;
                      }
                      setLicenseFile(file);
                      handleLicenseUpload(file).catch((error) => {
                        console.error('License upload failed:', error);
                      });
                    }
                  }}
                  disabled={isUploadingLicense}
                  className="hidden"
                  id="license-upload"
                />
                <label
                  htmlFor="license-upload"
                  className={`cursor-pointer flex flex-col items-center gap-2 ${isUploadingLicense ? 'opacity-50' : ''}`}
                >
                  {isUploadingLicense ? (
                    <>
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
                      <span className="text-sm text-gray-600">Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-gray-400" />
                      <span className="text-sm font-medium text-orange-600">
                        {location.kitchenLicenseStatus === "rejected" 
                          ? "Click to upload new license" 
                          : "Click to upload license"}
                      </span>
                      <span className="text-xs text-gray-500">PDF, JPG, or PNG (max 10MB)</span>
                    </>
                  )}
                </label>
                {licenseFile && !isUploadingLicense && (
                  <div className="mt-3 flex items-center justify-center gap-2 text-sm text-gray-700">
                    <FileText className="h-4 w-4" />
                    <span>{licenseFile.name}</span>
                  </div>
                )}
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

            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 md:p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Logo Image
                </label>
                <div className="max-w-md">
                  <ImageWithReplace
                    imageUrl={logoUrl || undefined}
                    onImageChange={(newUrl) => {
                      if (newUrl) {
                        setLogoUrl(newUrl);
                        // Auto-save when logo changes
                        handleSave(newUrl);
                      } else {
                        setLogoUrl('');
                        handleSave('');
                      }
                    }}
                    onRemove={() => {
                      setLogoUrl('');
                      handleSave('');
                    }}
                    alt="Location logo"
                    className="w-full h-32 object-contain rounded-lg"
                    containerClassName="w-full"
                    aspectRatio="16/9"
                    fieldName="logo"
                    maxSize={4.5 * 1024 * 1024}
                    allowedTypes={['image/jpeg', 'image/jpg', 'image/png', 'image/webp']}
                  />
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  Logo will appear in the manager header next to Local Cooks logo
                </p>
              </div>
            </div>
          </div>


          {/* Kitchen Images Section */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <ChefHat className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Kitchen Images</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Upload images for each kitchen space. These will be displayed on the chef landing page to help chefs see your facilities.
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-gray-700">Kitchens</h4>
                {!showCreateKitchen && (
                  <Button
                    size="sm"
                    onClick={() => setShowCreateKitchen(true)}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Kitchen
                  </Button>
                )}
              </div>
              
              {showCreateKitchen && (
                <div className="bg-white rounded-lg border border-amber-300 p-4 mb-4">
                  <h5 className="text-sm font-semibold text-gray-900 mb-3">Create New Kitchen</h5>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Kitchen Name *
                      </label>
                      <input
                        type="text"
                        value={newKitchenName}
                        onChange={(e) => setNewKitchenName(e.target.value)}
                        placeholder="e.g., Main Kitchen"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description (Optional)
                      </label>
                      <textarea
                        value={newKitchenDescription}
                        onChange={(e) => setNewKitchenDescription(e.target.value)}
                        placeholder="Describe your kitchen..."
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-none"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={async () => {
                          if (!newKitchenName.trim()) {
                            toast({
                              title: "Missing Information",
                              description: "Please enter a kitchen name",
                              variant: "destructive",
                            });
                            return;
                          }
                          setIsCreatingKitchen(true);
                          try {
                            const currentFirebaseUser = auth.currentUser;
                            if (!currentFirebaseUser) {
                              throw new Error("Firebase user not available");
                            }
                            
                            const token = await currentFirebaseUser.getIdToken();
                            const response = await fetch(`/api/manager/kitchens`, {
                              method: "POST",
                              headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json',
                              },
                              credentials: "include",
                              body: JSON.stringify({
                                locationId: location.id,
                                name: newKitchenName.trim(),
                                description: newKitchenDescription.trim() || undefined,
                              }),
                            });
                            
                            if (!response.ok) {
                              const error = await response.json();
                              throw new Error(error.error || "Failed to create kitchen");
                            }
                            
                            const newKitchen = await response.json();
                            queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
                            toast({
                              title: "Kitchen Created",
                              description: `${newKitchen.name} has been created successfully.`,
                            });
                            
                            setNewKitchenName('');
                            setNewKitchenDescription('');
                            setShowCreateKitchen(false);
                          } catch (error: any) {
                            toast({
                              title: "Error",
                              description: error.message || "Failed to create kitchen",
                              variant: "destructive",
                            });
                          } finally {
                            setIsCreatingKitchen(false);
                          }
                        }}
                        disabled={isCreatingKitchen}
                        className="bg-amber-600 hover:bg-amber-700 text-white"
                      >
                        {isCreatingKitchen ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <Plus className="h-4 w-4 mr-1" />
                            Create Kitchen
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowCreateKitchen(false);
                          setNewKitchenName('');
                          setNewKitchenDescription('');
                        }}
                        disabled={isCreatingKitchen}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              
              {isLoadingKitchens ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
                </div>
              ) : kitchens.length === 0 && !showCreateKitchen ? (
                <div className="text-center py-4">
                  <p className="text-sm text-gray-500 mb-3">No kitchens found for this location</p>
                  <Button
                    size="sm"
                    onClick={() => setShowCreateKitchen(true)}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Create Your First Kitchen
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {kitchens.map((kitchen) => (
                    <div key={kitchen.id} className="bg-white rounded-lg border border-amber-200 p-4">
                      <div className="flex items-start gap-4">
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-900 mb-2">{kitchen.name}</h4>
                          <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700">
                              Description
                            </label>
                            <textarea
                              value={kitchenDescriptions[kitchen.id] !== undefined 
                                ? kitchenDescriptions[kitchen.id] 
                                : kitchen.description || ''}
                              onChange={(e) => {
                                setKitchenDescriptions(prev => ({
                                  ...prev,
                                  [kitchen.id]: e.target.value
                                }));
                              }}
                              onBlur={(e) => {
                                const newDescription = e.target.value.trim();
                                const currentDescription = kitchen.description || '';
                                if (newDescription !== currentDescription) {
                                  handleKitchenDescriptionUpdate(kitchen.id, newDescription);
                                }
                              }}
                              placeholder="Enter a description for this kitchen (e.g., 'Modern commercial kitchen with professional equipment')"
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-none"
                              rows={3}
                              disabled={updatingKitchenId === kitchen.id}
                            />
                            {updatingKitchenId === kitchen.id && (
                              <p className="text-xs text-amber-600">Saving...</p>
                            )}
                          </div>
                        </div>
                        <div className="w-48">
                          <ImageWithReplace
                            imageUrl={(kitchen as any).imageUrl || undefined}
                            onImageChange={async (newUrl) => {
                              if (newUrl) {
                                // Update the kitchen with the new image URL
                                const currentFirebaseUser = auth.currentUser;
                                if (!currentFirebaseUser) {
                                  throw new Error("Firebase user not available");
                                }
                                
                                const token = await currentFirebaseUser.getIdToken();
                                const headers: HeadersInit = {
                                  'Authorization': `Bearer ${token}`,
                                  'Content-Type': 'application/json',
                                };
                                
                                const updateResponse = await fetch(`/api/manager/kitchens/${kitchen.id}/image`, {
                                  method: 'PUT',
                                  headers,
                                  credentials: 'include',
                                  body: JSON.stringify({ imageUrl: newUrl }),
                                });
                                
                                if (!updateResponse.ok) {
                                  const errorData = await updateResponse.json();
                                  throw new Error(errorData.error || 'Failed to update kitchen image');
                                }
                                
                                // Refresh the kitchens list
                                queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
                                
                                toast({
                                  title: "Success",
                                  description: "Kitchen image updated successfully",
                                });
                              } else {
                                // Remove image
                                const currentFirebaseUser = auth.currentUser;
                                if (!currentFirebaseUser) {
                                  throw new Error("Firebase user not available");
                                }
                                
                                const token = await currentFirebaseUser.getIdToken();
                                const headers: HeadersInit = {
                                  'Authorization': `Bearer ${token}`,
                                  'Content-Type': 'application/json',
                                };
                                
                                const updateResponse = await fetch(`/api/manager/kitchens/${kitchen.id}/image`, {
                                  method: 'PUT',
                                  headers,
                                  credentials: 'include',
                                  body: JSON.stringify({ imageUrl: null }),
                                });
                                
                                if (!updateResponse.ok) {
                                  const errorData = await updateResponse.json();
                                  throw new Error(errorData.error || 'Failed to remove kitchen image');
                                }
                                
                                queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
                              }
                            }}
                            onRemove={async () => {
                              const currentFirebaseUser = auth.currentUser;
                              if (!currentFirebaseUser) {
                                throw new Error("Firebase user not available");
                              }
                              
                              const token = await currentFirebaseUser.getIdToken();
                              const headers: HeadersInit = {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json',
                              };
                              
                              const updateResponse = await fetch(`/api/manager/kitchens/${kitchen.id}/image`, {
                                method: 'PUT',
                                headers,
                                credentials: 'include',
                                body: JSON.stringify({ imageUrl: null }),
                              });
                              
                              if (!updateResponse.ok) {
                                const errorData = await updateResponse.json();
                                throw new Error(errorData.error || 'Failed to remove kitchen image');
                              }
                              
                              queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
                            }}
                            alt={kitchen.name}
                            className="w-full h-32 object-cover rounded-lg"
                            containerClassName="w-full"
                            aspectRatio="16/9"
                            fieldName="kitchenImage"
                            maxSize={4.5 * 1024 * 1024}
                            allowedTypes={['image/jpeg', 'image/jpg', 'image/png', 'image/webp']}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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

