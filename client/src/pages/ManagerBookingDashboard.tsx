import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Calendar, Clock, ChefHat, Settings,
  Check, Save, AlertCircle, FileText,
  ChevronRight, Info, Mail, Upload, Image as ImageIcon, Globe, CheckCircle, Plus, Loader2, HelpCircle, Sparkles, Trash2
} from "lucide-react";
import { ImageWithReplace } from "@/components/ui/image-with-replace";
import { useSessionFileUpload } from "@/hooks/useSessionFileUpload";
import { usePresignedDocumentUrl } from "@/hooks/use-presigned-document-url";
import { DEFAULT_TIMEZONE } from "@/utils/timezone-utils";
import { useLocation } from "wouter";
import 'react-calendar/dist/Calendar.css';
import { useManagerDashboard } from "../hooks/use-manager-dashboard";
import { useOnboardingStatus } from "@/hooks/use-onboarding-status";
import { toast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import KitchenAvailabilityManagement from "./KitchenAvailabilityManagement";
import ManagerBookingsPanel from "./ManagerBookingsPanel";
import { ManagerKitchenApplicationsContent } from "./ManagerKitchenApplications";
import KitchenPricingManagement from "./KitchenPricingManagement";
import StorageListingManagement from "./StorageListingManagement";
import EquipmentListingManagement from "./EquipmentListingManagement";
import KitchenDashboardOverview from "@/components/dashboard/KitchenDashboardOverview";
import StripeConnectSetup from "@/components/manager/StripeConnectSetup";
import { OverstayPenaltyQueue } from "@/components/manager/overstays/OverstayPenaltyQueue";
import { DamageClaimQueue } from "@/components/manager/damage-claims/DamageClaimQueue";
import { PendingStorageCheckouts } from "@/components/manager/PendingStorageCheckouts";
import ManagerLocationsPage from "@/components/manager/ManagerLocationsPage";
import ManagerRevenueDashboard from "./ManagerRevenueDashboard";
import UnifiedChatView from "@/components/chat/UnifiedChatView";
import LocationRequirementsSettings from "@/components/manager/LocationRequirementsSettings";
import {
  LicenseSettings,
  BookingRulesSettings,
  LocationSettings,
  KitchensManagement,
  NotificationsSettings,
  FacilityDocsSettings,
} from "@/components/manager/settings";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import DashboardLayout from "@/layouts/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManagerProfileSettings from "@/components/manager/ManagerProfileSettings";
import { OnboardingStatusBanner } from "@/components/manager/OnboardingStatusBanner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Helper component for authenticated document links
function AuthenticatedDocumentLink({ url, className, children }: { url: string | null | undefined; className?: string; children: React.ReactNode }) {
  const { url: presignedUrl } = usePresignedDocumentUrl(url);
  
  if (!url) return null;
  
  return (
    <a 
      href={presignedUrl || url} 
      target="_blank" 
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}

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
  kitchenLicenseExpiry?: string;
  kitchenLicenseUploadedAt?: string;
  kitchenTermsUrl?: string;
  kitchenTermsUploadedAt?: string;
  description?: string;
  customOnboardingLink?: string;
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


type ViewType = 'my-locations' | 'overview' | 'bookings' | 'availability' | 'settings' | 'applications' | 'pricing' | 'storage-listings' | 'equipment-listings' | 'payments' | 'revenue' | 'messages' | 'profile' | 'kitchens' | 'settings-license' | 'settings-booking-rules' | 'settings-facility-docs' | 'settings-location' | 'application-requirements' | 'notifications' | 'overstays' | 'damage-claims' | 'storage-checkouts';


export default function ManagerBookingDashboard() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation(); // [NEW] Used for setup navigation
  const { locations, isLoadingLocations } = useManagerDashboard();
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

  // Tab state - check URL params first, then default to 'overview'
  const [activeView, setActiveView] = useState<ViewType>(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    const validViews: ViewType[] = ['my-locations', 'overview', 'bookings', 'availability', 'settings', 'applications', 'pricing', 'storage-listings', 'equipment-listings', 'payments', 'revenue', 'messages', 'profile', 'kitchens', 'settings-license', 'settings-booking-rules', 'settings-facility-docs', 'settings-location', 'application-requirements', 'notifications', 'overstays', 'damage-claims', 'storage-checkouts'];
    if (view && validViews.includes(view as ViewType)) {
      return view as ViewType;
    }
    return 'overview';
  });

  // Handle locationId from URL for direct navigation to views like application-requirements
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const locationIdFromUrl = params.get('locationId');
    if (locationIdFromUrl && !selectedLocation && locations.length > 0) {
      const locationId = parseInt(locationIdFromUrl, 10);
      const foundLocation = locations.find((l: Location) => l.id === locationId);
      if (foundLocation) {
        setSelectedLocation(foundLocation);
      }
    }
  }, [locations, selectedLocation]);


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

  // Get manager ID from userData
  const managerId = userData?.id || null;

  // [REF] Use new hook for consolidated status
  const {
    showSetupBanner,
    showLicenseReviewBanner,
    isReadyForBookings,
    missingSteps
  } = useOnboardingStatus(selectedLocation?.id);

  // Sync activeView with URL parameters
  useEffect(() => {
    const handleLocationChange = () => {
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view');
      const validViews: ViewType[] = ['my-locations', 'overview', 'bookings', 'availability', 'settings', 'applications', 'pricing', 'storage-listings', 'equipment-listings', 'payments', 'revenue', 'messages', 'profile', 'kitchens', 'settings-license', 'settings-booking-rules', 'settings-facility-docs', 'settings-location', 'application-requirements', 'notifications', 'overstays', 'damage-claims', 'storage-checkouts'];
      if (view && validViews.includes(view as ViewType)) {
        setActiveView(view as ViewType);
      }
    };

    // Check on mount and when URL might have changed externally
    handleLocationChange();
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  // Handle Stripe Connect Return
  useEffect(() => {
    const handleStripeReturn = async () => {
      // Check if we are on the return path
      if (window.location.pathname.includes('/manager/stripe-connect/return')) {
        const params = new URLSearchParams(window.location.search);
        if (params.get('success') === 'true') {
          // Calls the backend to sync status with Stripe
          try {
            const { auth } = await import('@/lib/firebase');
            const token = await auth.currentUser?.getIdToken();
            if (token) {
              const response = await fetch('/api/manager/stripe-connect/sync', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                }
              });

              if (!response.ok) {
                const err = await response.text();
                console.error("Sync response not OK:", response.status, err);
                throw new Error(`Sync failed: ${response.status}`);
              }

              console.log("Stripe status synced successfully via return handler");
            } else {
              console.error("No token available for sync");
              throw new Error("Authentication missing");
            }
          } catch (e) {
            console.error("Failed to sync stripe status:", e);
            toast({
              title: "Sync Warning",
              description: "We couldn't automatically confirm your status. Please click 'Refresh Status' if needed.",
              variant: "destructive"
            });
            // Don't return early - still allow navigation, but maybe don't broadcast success if we aren't sure?
            // Actually, if sync failed, we shouldn't broadcast success.
            return;
          }

          // Show success message
          toast({
            title: "Stripe Connected Successfully",
            description: "Your account is now ready to receive payments.",
            variant: "default",
          });

          // Force refresh of user profile and stripe status to get the new connected status
          await queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
          await queryClient.invalidateQueries({ queryKey: ['/api/manager/stripe-connect/status'] });

          // Switch to payments view
          setActiveView('payments');

          // Clean up URL
          window.history.replaceState({}, '', '/manager/dashboard?view=payments');

          // [NEW] Broadcast success to other tabs
          const channel = new BroadcastChannel('stripe_onboarding_channel');
          channel.postMessage({ type: 'STRIPE_SETUP_COMPLETE' });
          channel.close();
        }
      }
    };

    handleStripeReturn();
  }, [toast, queryClient]);

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
        } catch (_error) {
          try {
            const text = await response.text();
            errorMessage = text || `Server returned ${response.status} ${response.statusText}`;
          } catch (_error) {
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
        } catch (_error) {
          // If response isn't JSON, try to get text
          try {
            const text = await response.text();
            errorMessage = text || `Server returned ${response.status} ${response.statusText}`;
          } catch (_error) {
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
      return { result, payload };
    },
    onSuccess: (data, variables) => {
      const { result, payload } = data;

      // Get current location data from cache before updating
      const currentLocation = queryClient.getQueryData<Location>(['locationDetails', variables.locationId]) || selectedLocation;

      // Determine which fields changed
      const changedFields: string[] = [];

      if (payload.timezone !== undefined && payload.timezone !== (currentLocation?.timezone || DEFAULT_TIMEZONE)) {
        changedFields.push('timezone');
      }
      if (payload.cancellationPolicyHours !== undefined && payload.cancellationPolicyHours !== (currentLocation?.cancellationPolicyHours ?? 24)) {
        changedFields.push('cancellationPolicy');
      }
      if (payload.cancellationPolicyMessage !== undefined && payload.cancellationPolicyMessage !== (currentLocation?.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time.")) {
        changedFields.push('cancellationPolicy');
      }
      if (payload.defaultDailyBookingLimit !== undefined && payload.defaultDailyBookingLimit !== (currentLocation?.defaultDailyBookingLimit ?? 2)) {
        changedFields.push('bookingLimits');
      }
      if (payload.minimumBookingWindowHours !== undefined && payload.minimumBookingWindowHours !== (currentLocation?.minimumBookingWindowHours ?? 1)) {
        changedFields.push('bookingLimits');
      }
      if (payload.notificationEmail !== undefined && payload.notificationEmail !== (currentLocation?.notificationEmail || '')) {
        changedFields.push('notifications');
      }
      if (payload.notificationPhone !== undefined && payload.notificationPhone !== (currentLocation?.notificationPhone || '')) {
        changedFields.push('notifications');
      }
      if (payload.logoUrl !== undefined && payload.logoUrl !== (currentLocation?.logoUrl || '')) {
        changedFields.push('logo');
      }

      // Remove duplicates
      const uniqueChangedFields = Array.from(new Set(changedFields));

      // Determine success message based on what changed
      let successMessage = "Location settings updated successfully";
      if (uniqueChangedFields.length === 1) {
        const field = uniqueChangedFields[0];
        switch (field) {
          case 'timezone':
            successMessage = "Timezone updated successfully";
            break;
          case 'cancellationPolicy':
            successMessage = "Cancellation policy updated successfully";
            break;
          case 'bookingLimits':
            successMessage = "Booking limits updated successfully";
            break;
          case 'notifications':
            successMessage = "Notification settings updated successfully";
            break;
          case 'logo':
            successMessage = "Logo updated successfully";
            break;
        }
      } else if (uniqueChangedFields.length > 1) {
        successMessage = "Settings updated successfully";
      }

      // Update the location details cache with the returned data
      if (selectedLocation?.id && result) {
        queryClient.setQueryData(['locationDetails', selectedLocation.id], (oldData: Location | null) => {
          if (oldData) {
            return { ...oldData, ...result };
          }
          return result;
        });
      }

      // Update selected location state
      if (result) {
        setSelectedLocation((prev) => {
          if (prev && prev.id === result.id) {
            return { ...prev, ...result };
          }
          return prev;
        });
      }

      // Invalidate queries to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ['locationDetails', selectedLocation?.id] });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/locations'] });

      toast({
        title: "Success",
        description: successMessage,
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



  /* New Setup Handler */
  const handleContinueSetup = () => {
    setLocation('/manager/setup');
  };

  return (
    <DashboardLayout
      activeView={activeView}
      onViewChange={(view) => setActiveView(view as ViewType)}
      locations={locations}
      selectedLocation={selectedLocation}
      onLocationChange={(loc) => setSelectedLocation(loc as Location)}
    >
      {/* Onboarding Status Banners */}
      <OnboardingStatusBanner
        showSetupBanner={showSetupBanner}
        showLicenseReviewBanner={showLicenseReviewBanner}
        isReadyForBookings={isReadyForBookings}
        missingSteps={missingSteps}
        onContinueSetup={handleContinueSetup}
      />

      {activeView === 'profile' && (
        <ManagerProfileSettings />
      )}

      {activeView === 'overview' && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Welcome back!</h1>
            <p className="text-muted-foreground">Here&apos;s what&apos;s happening at your kitchens today.</p>
          </div>



          <KitchenDashboardOverview
            selectedLocation={selectedLocation}
            locations={locations}
            onNavigate={(view: ViewType) => setActiveView(view)}
            onSelectLocation={(location) => setSelectedLocation(location)}
          />
        </div>
      )}

      {activeView === 'bookings' && (
        <ManagerBookingsPanel embedded={true} />
      )}

      {activeView === 'availability' && (
        <div className="h-[calc(100vh-100px)] -m-4 md:-m-8">
          <KitchenAvailabilityManagement
            initialLocationId={selectedLocation?.id}
          />
        </div>
      )}

      {activeView === 'applications' && (
        <ManagerKitchenApplicationsContent
          selectedLocationId={selectedLocation?.id ?? null}
          isLayoutLoading={isLoadingLocations}
          setLocation={setLocation}
          onNavigateToView={(view: string) => setActiveView(view as ViewType)}
        />
      )}

      {activeView === 'settings' && selectedLocation && (
        <SettingsView
          location={(locationDetails || selectedLocation) as Location}
          onUpdateSettings={updateLocationSettings}
          isUpdating={updateLocationSettings.isPending}
        />
      )}

      {activeView === 'settings' && !selectedLocation && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <Settings className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
          <p className="text-gray-500">Choose a location to manage settings</p>
        </div>
      )}

      {activeView === 'pricing' && (
        <KitchenPricingManagement embedded={true} />
      )}

      {activeView === 'storage-listings' && (
        <StorageListingManagement />
      )}

      {activeView === 'equipment-listings' && (
        <EquipmentListingManagement />
      )}

      {activeView === 'revenue' && (
        <ManagerRevenueDashboard
          selectedLocation={selectedLocation}
          locations={locations}
          onNavigate={(view) => setActiveView(view as ViewType)}
        />
      )}

      {activeView === 'messages' && (
        managerId ? (
          <div className="h-[calc(100vh-8rem)]">
            <UnifiedChatView userId={managerId} role="manager" />
          </div>
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#208D80] mx-auto mb-4" />
              <p className="text-gray-600">Loading your profile...</p>
            </CardContent>
          </Card>
        )
      )}

      {activeView === 'payments' && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold tracking-tight">Payments & Payouts</h2>
          <StripeConnectSetup />
        </div>
      )}

      {activeView === 'overstays' && (
        <div className="space-y-6">
          <OverstayPenaltyQueue />
        </div>
      )}

      {activeView === 'damage-claims' && (
        <div className="space-y-6">
          <DamageClaimQueue />
        </div>
      )}

      {activeView === 'storage-checkouts' && (
        <div className="space-y-6">
          <PendingStorageCheckouts />
        </div>
      )}

      {activeView === 'my-locations' && (
        <ManagerLocationsPage
          locations={locations}
          isLoading={isLoadingLocations}
          onCreateLocation={() => {}}
          onSelectLocation={(loc) => {
            setSelectedLocation(loc as Location);
            setActiveView('overview');
          }}
        />
      )}

      {/* New Settings Views - Enterprise-grade modular architecture */}
      {activeView === 'kitchens' && selectedLocation && (
        <KitchensManagement
          location={locationDetails || selectedLocation}
        />
      )}

      {activeView === 'kitchens' && !selectedLocation && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <ChefHat className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
          <p className="text-gray-500">Choose a location to manage kitchens</p>
        </div>
      )}

      {activeView === 'settings-license' && selectedLocation && (
        <LicenseSettings
          location={locationDetails || selectedLocation}
          onRefresh={() => {
            queryClient.invalidateQueries({ queryKey: ['locationDetails', selectedLocation.id] });
            queryClient.invalidateQueries({ queryKey: ['/api/manager/locations'] });
          }}
        />
      )}

      {activeView === 'settings-license' && !selectedLocation && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <Settings className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
          <p className="text-gray-500">Choose a location to manage license settings</p>
        </div>
      )}

      {activeView === 'settings-booking-rules' && selectedLocation && (
        <BookingRulesSettings
          location={locationDetails || selectedLocation}
          onSave={(updates) => updateLocationSettings.mutate(updates)}
          isSaving={updateLocationSettings.isPending}
        />
      )}

      {activeView === 'settings-booking-rules' && !selectedLocation && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <Settings className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
          <p className="text-gray-500">Choose a location to manage booking rules</p>
        </div>
      )}

      {activeView === 'settings-facility-docs' && selectedLocation && (
        <FacilityDocsSettings
          location={locationDetails || selectedLocation}
        />
      )}

      {activeView === 'settings-facility-docs' && !selectedLocation && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <Settings className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
          <p className="text-gray-500">Choose a location to manage facility documents</p>
        </div>
      )}

      {activeView === 'settings-location' && selectedLocation && (
        <LocationSettings
          location={locationDetails || selectedLocation}
          onSave={(updates) => updateLocationSettings.mutate(updates)}
          isSaving={updateLocationSettings.isPending}
        />
      )}

      {activeView === 'settings-location' && !selectedLocation && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <Settings className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
          <p className="text-gray-500">Choose a location to manage location settings</p>
        </div>
      )}

      {activeView === 'application-requirements' && selectedLocation && (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Application Requirements</h2>
            <p className="text-muted-foreground">
              Configure what information chefs need to provide when applying to your location.
            </p>
          </div>
          <LocationRequirementsSettings
            locationId={selectedLocation.id}
            locationName={selectedLocation.name}
          />
        </div>
      )}

      {activeView === 'application-requirements' && !selectedLocation && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <Settings className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
          <p className="text-gray-500">Choose a location to manage application requirements</p>
        </div>
      )}

      {activeView === 'notifications' && selectedLocation && (
        <NotificationsSettings
          location={locationDetails || selectedLocation}
          onSave={(updates) => updateLocationSettings.mutate(updates)}
          isSaving={updateLocationSettings.isPending}
        />
      )}

      {activeView === 'notifications' && !selectedLocation && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <Settings className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Location</h3>
          <p className="text-gray-500">Choose a location to manage notification settings</p>
        </div>
      )}

    </DashboardLayout>
  );
}

// [PARKED] CreateLocationSheet — Multi-location "Add New Location" is parked with Coming Soon badges.
// This component will be re-enabled when the full multi-location onboarding flow is implemented.
// See gap analysis: engine.reset(), per-location completedSteps scoping, hasPerformedInitialAutoSkip reset.
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createLocationSchema, type CreateLocationFormValues } from "@/schemas/locationSchema";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription
} from "@/components/ui/form";
import { ScrollArea } from "@/components/ui/scroll-area";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CreateLocationSheet({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (open: boolean) => void; onSuccess: () => void }) {
  const [licenseFile, setLicenseFile] = useState<File | null>(null);

  const form = useForm<CreateLocationFormValues>({
    resolver: zodResolver(createLocationSchema),
    defaultValues: {
      name: "",
      address: "",
      notificationEmail: "",
      notificationPhone: "",
    },
  });

  const onSubmit = async (data: CreateLocationFormValues) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/manager/locations', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: data.name,
          address: data.address,
          notification_email: data.notificationEmail,
          notification_phone: data.notificationPhone
        })
      });

      if (res.ok) {
        const newLoc = await res.json();

        // Handle license upload if exists
        if (licenseFile && newLoc.id) {
          const currentFirebaseUser = auth.currentUser;
          if (currentFirebaseUser) {
            const token = await currentFirebaseUser.getIdToken();
            const formData = new FormData();
            formData.append('file', licenseFile);

            const uploadRes = await fetch('/api/upload-file', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` },
              body: formData
            });

            if (uploadRes.ok) {
              const { url } = await uploadRes.json();
              await fetch(`/api/manager/locations/${newLoc.id}`, {
                method: 'PUT',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ kitchenLicenseUrl: url, kitchenLicenseStatus: 'pending' })
              });
            }
          }
        }

        toast({ title: "Location created successfully" });
        onSuccess();
        onOpenChange(false);
        form.reset();
        setLicenseFile(null);
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to create location");
      }
    } catch (error: any) {
      toast({
        title: "Error creating location",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl w-full p-0">
        <ScrollArea className="h-full">
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-1">Add New Location</h2>
            <p className="text-sm text-muted-foreground mb-6">Enter the details for your new kitchen location.</p>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Downtown Kitchen" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Input placeholder="Full address" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="notificationEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notification Email</FormLabel>
                        <FormControl>
                          <Input placeholder="bookings@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="notificationPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notification Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="+1 (555) 000-0000" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="pt-4 border-t">
                  <FormLabel className="mb-2 block">Kitchen License</FormLabel>
                  <div className="border-2 border-dashed border-border rounded-lg p-6 bg-muted/30 hover:bg-muted/50 transition-colors text-center cursor-pointer relative group">
                    <input
                      type="file"
                      id="license-upload-sheet-form"
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setLicenseFile(file);
                          toast({
                            title: "File attached",
                            description: file.name
                          });
                        }
                      }}
                    />
                    <label htmlFor="license-upload-sheet-form" className="cursor-pointer block w-full h-full">
                      <div className="flex flex-col items-center gap-2">
                        <div className="p-3 bg-background rounded-full shadow-sm group-hover:scale-110 transition-transform">
                          <Upload className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <div className="text-sm">
                          <span className="font-semibold text-primary">Click to upload</span>
                          <span className="text-muted-foreground"> or drag and drop</span>
                        </div>
                        <p className="text-xs text-muted-foreground">PDF, JPG or PNG (max. 5MB)</p>
                        {licenseFile && (
                          <div className="mt-2 flex items-center gap-2 text-sm text-green-600 font-medium bg-green-50 px-3 py-1.5 rounded-full mx-auto w-fit">
                            <Check className="h-4 w-4" />
                            {licenseFile.name}
                          </div>
                        )}
                      </div>
                    </label>
                  </div>
                  <FormDescription className="mt-2">
                    Upload your business license or food safety certificate.
                  </FormDescription>
                </div>

                <Button
                  type="submit"
                  className="w-full mt-6"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Location
                </Button>
              </form>
            </Form>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// Original settings view remains below...




// Settings View Component
interface SettingsViewProps {
  location: Location;
  onUpdateSettings: any;
  isUpdating: boolean;
}

// Component for managing kitchen gallery images
function KitchenGalleryImages({
  kitchenId,
  galleryImages,
  locationId
}: {
  kitchenId: number;
  galleryImages: string[];
  locationId: number;
}) {
  const queryClient = useQueryClient();
  const [currentGalleryImages, setCurrentGalleryImages] = useState<string[]>(galleryImages || []);

  const { uploadFile, isUploading, uploadProgress } = useSessionFileUpload({
    maxSize: 4.5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    onSuccess: async (response) => {
      const newGalleryImages = [...currentGalleryImages, response.url];
      await updateGalleryImages(newGalleryImages);
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    setCurrentGalleryImages(galleryImages || []);
  }, [galleryImages]);

  const updateGalleryImages = async (newGalleryImages: string[]) => {
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }

      const token = await currentFirebaseUser.getIdToken();
      const headers: HeadersInit = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const updateResponse = await fetch(`/api/manager/kitchens/${kitchenId}/gallery`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify({ galleryImages: newGalleryImages }),
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        throw new Error(errorData.error || 'Failed to update gallery images');
      }

      setCurrentGalleryImages(newGalleryImages);
      queryClient.invalidateQueries({ queryKey: ['managerKitchens', locationId] });

      toast({
        title: "Success",
        description: "Gallery images updated successfully",
      });
    } catch (error: any) {
      console.error('Gallery images update error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update gallery images",
        variant: "destructive",
      });
    }
  };

  const handleRemoveImage = async (imageUrl: string) => {
    const newGalleryImages = currentGalleryImages.filter(img => img !== imageUrl);
    await updateGalleryImages(newGalleryImages);

    // Delete from R2
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        return;
      }

      const token = await currentFirebaseUser.getIdToken();
      const headers: HeadersInit = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      await fetch('/api/manager/files', {
        method: 'DELETE',
        headers,
        credentials: 'include',
        body: JSON.stringify({ fileUrl: imageUrl }),
      });
    } catch (error) {
      console.error('Error deleting file from R2:', error);
      // Continue even if R2 deletion fails
    }
  };

  const handleReplaceImage = async (oldUrl: string, newUrl: string) => {
    const newGalleryImages = currentGalleryImages.map(img => img === oldUrl ? newUrl : img);
    await updateGalleryImages(newGalleryImages);

    // Delete old image from R2
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        return;
      }

      const token = await currentFirebaseUser.getIdToken();
      const headers: HeadersInit = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      await fetch('/api/manager/files', {
        method: 'DELETE',
        headers,
        credentials: 'include',
        body: JSON.stringify({ fileUrl: oldUrl }),
      });
    } catch (error) {
      console.error('Error deleting old file from R2:', error);
      // Continue even if R2 deletion fails
    }
  };

  return (
    <div className="space-y-3">
      {/* Existing Gallery Images */}
      {currentGalleryImages.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {currentGalleryImages.map((imageUrl, index) => (
            <ImageWithReplace
              key={index}
              imageUrl={imageUrl}
              onImageChange={(newUrl) => {
                if (newUrl) {
                  handleReplaceImage(imageUrl, newUrl);
                } else {
                  handleRemoveImage(imageUrl);
                }
              }}
              onRemove={() => handleRemoveImage(imageUrl)}
              alt={`Gallery image ${index + 1}`}
              className="h-32"
              containerClassName="w-full"
              aspectRatio="1/1"
              showReplaceButton={true}
              showRemoveButton={true}
            />
          ))}
        </div>
      )}

      {/* Upload Area */}
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-gray-400 transition-colors">
        <input
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              uploadFile(file);
              e.target.value = ''; // Reset input
            }
          }}
          className="hidden"
          id={`gallery-upload-${kitchenId}`}
          disabled={isUploading}
        />
        <label
          htmlFor={`gallery-upload-${kitchenId}`}
          className={`flex flex-col items-center justify-center cursor-pointer ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-8 w-8 text-gray-400 animate-spin mb-2" />
              <span className="text-sm text-gray-600">Uploading... {Math.round(uploadProgress)}%</span>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-gray-400 mb-2" />
              <span className="text-sm font-medium text-gray-700 mb-1">Click to add gallery image</span>
              <span className="text-xs text-gray-500">JPG, PNG, WebP (max 4.5MB)</span>
            </>
          )}
        </label>
      </div>
    </div>
  );
}

// Valid tab values for settings view - defined at module level for stability
const VALID_SETTINGS_TABS = ['setup', 'branding', 'notifications', 'booking-rules', 'application-requirements', 'location'] as const;
type SettingsTab = typeof VALID_SETTINGS_TABS[number];

function SettingsView({ location, onUpdateSettings, isUpdating }: SettingsViewProps) {
  const queryClient = useQueryClient();

  // Tab state - check URL params first, then default to 'setup'
  // IMPORTANT: We consume and clear the URL param after reading to prevent
  // stale navigation state on page reload
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && VALID_SETTINGS_TABS.includes(tab as SettingsTab)) {
      // Clear the tab parameter from URL to prevent it from persisting on reload
      // This is the "consume once" pattern - URL params are for navigation, not persistence
      params.delete('tab');
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname + (params.get('view') ? `?view=${params.get('view')}` : '');
      // Use replaceState to update URL without adding to history
      window.history.replaceState({}, '', newUrl);
      return tab as SettingsTab;
    }
    return 'setup';
  });

  const [cancellationHours, setCancellationHours] = useState(location.cancellationPolicyHours || 24);
  const [cancellationMessage, setCancellationMessage] = useState(
    location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time."
  );
  const [dailyBookingLimit, setDailyBookingLimit] = useState(location.defaultDailyBookingLimit || 2);
  const [minimumBookingWindowHours, setMinimumBookingWindowHours] = useState(location.minimumBookingWindowHours || 1);
  
  // Overstay penalty defaults state
  const [overstayGracePeriodDays, setOverstayGracePeriodDays] = useState<number | null>(null);
  const [overstayPenaltyRate, setOverstayPenaltyRate] = useState<number | null>(null);
  const [overstayMaxPenaltyDays, setOverstayMaxPenaltyDays] = useState<number | null>(null);
  const [overstayPolicyText, setOverstayPolicyText] = useState('');
  const [isLoadingPenaltyDefaults, setIsLoadingPenaltyDefaults] = useState(true);
  
  const [notificationEmail, setNotificationEmail] = useState(location.notificationEmail || '');
  const [notificationPhone, setNotificationPhone] = useState(location.notificationPhone || '');
  const [logoUrl, setLogoUrl] = useState(location.logoUrl || '');
  const [description, setDescription] = useState(location.description || '');
  const [customOnboardingLink, setCustomOnboardingLink] = useState(location.customOnboardingLink || '');
  // Timezone is locked to Newfoundland - always use DEFAULT_TIMEZONE
  const timezone = DEFAULT_TIMEZONE;
  const [kitchenDescriptions, setKitchenDescriptions] = useState<Record<number, string>>({});
  const [updatingKitchenId, setUpdatingKitchenId] = useState<number | null>(null);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [isUploadingLicense, setIsUploadingLicense] = useState(false);
  const [licenseExpiryDate, setLicenseExpiryDate] = useState<string>(location.kitchenLicenseExpiry || '');
  const [showCreateKitchen, setShowCreateKitchen] = useState(false);

  // Helper function to extract filename from URL
  const getDocumentFilename = (url?: string): string => {
    if (!url) return 'No document';
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || 'kitchen-license';
      // Decode URL encoding
      return decodeURIComponent(filename);
    } catch {
      // If URL parsing fails, try to extract from string
      const parts = url.split('/');
      return decodeURIComponent(parts[parts.length - 1] || 'kitchen-license');
    }
  };

  // Helper function to calculate days until expiry
  const getDaysUntilExpiry = (expiryDate?: string): number | null => {
    if (!expiryDate) return null;
    const expiry = new Date(expiryDate);
    const now = new Date();
    const diffTime = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // Helper function to check if expiry is approaching (within 30 days)
  const isExpiryApproaching = (expiryDate?: string): boolean => {
    const daysUntil = getDaysUntilExpiry(expiryDate);
    return daysUntil !== null && daysUntil > 0 && daysUntil <= 30;
  };

  // Check if license is expired
  const isLicenseExpired = location.kitchenLicenseExpiry
    ? new Date(location.kitchenLicenseExpiry) < new Date()
    : false;

  // Check if upload should be shown
  const shouldShowUpload = !location.kitchenLicenseUrl ||
    location.kitchenLicenseStatus === "rejected" ||
    location.kitchenLicenseStatus === "expired" ||
    (location.kitchenLicenseStatus === "approved" && isLicenseExpired);
  const [newKitchenName, setNewKitchenName] = useState('');
  const [newKitchenDescription, setNewKitchenDescription] = useState('');
  const [isCreatingKitchen, setIsCreatingKitchen] = useState(false);

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


  // Handle URL parameter changes for tab navigation (popstate only - for back/forward)
  // Note: Initial tab is handled in useState initializer above with consume-once pattern
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      if (tab && VALID_SETTINGS_TABS.includes(tab as SettingsTab)) {
        setActiveTab(tab as SettingsTab);
        // Clear the tab param after consuming
        params.delete('tab');
        const newUrl = params.toString()
          ? `${window.location.pathname}?${params.toString()}`
          : window.location.pathname;
        window.history.replaceState({}, '', newUrl);
      }
    };

    // Only listen for popstate (back/forward button), not initial mount
    // Initial mount is handled by useState initializer
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Fetch overstay penalty defaults from API
  const fetchOverstayPenaltyDefaults = useCallback(async () => {
    if (!location.id) return;
    
    setIsLoadingPenaltyDefaults(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }

      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch(`/api/manager/locations/${location.id}/overstay-penalty-defaults`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch overstay penalty defaults');
      }

      const data = await response.json();
      
      // Set values from API response (null means using platform defaults)
      setOverstayGracePeriodDays(data.locationDefaults.gracePeriodDays);
      setOverstayPenaltyRate(data.locationDefaults.penaltyRate ? data.locationDefaults.penaltyRate * 100 : null); // Convert to percentage for display
      setOverstayMaxPenaltyDays(data.locationDefaults.maxPenaltyDays);
      setOverstayPolicyText(data.locationDefaults.policyText || '');
    } catch (error: any) {
      console.error('Error fetching overstay penalty defaults:', error);
      toast({
        title: "Error",
        description: "Failed to load overstay penalty settings",
        variant: "destructive"
      });
    } finally {
      setIsLoadingPenaltyDefaults(false);
    }
  }, [location.id]);

  // Update state when location prop changes (e.g., after saving or switching tabs)
  useEffect(() => {
    setCancellationHours(location.cancellationPolicyHours || 24);
    setCancellationMessage(
      location.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time."
    );
    setDailyBookingLimit(location.defaultDailyBookingLimit || 2);
    setMinimumBookingWindowHours(location.minimumBookingWindowHours || 1);
    setLogoUrl(location.logoUrl || '');
    setLicenseExpiryDate(location.kitchenLicenseExpiry || '');
    // Timezone is locked to DEFAULT_TIMEZONE - no need to update state
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
    setDescription(location.description || '');
    setCustomOnboardingLink(location.customOnboardingLink || '');
    
    // Fetch overstay penalty defaults when location changes
    fetchOverstayPenaltyDefaults();
  }, [location, fetchOverstayPenaltyDefaults]);

  // Save overstay penalty defaults
  const handleSaveOverstayPenaltyDefaults = async () => {
    if (!location.id) return;

    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }

      const token = await currentFirebaseUser.getIdToken();
      
      const payload = {
        gracePeriodDays: overstayGracePeriodDays,
        penaltyRate: overstayPenaltyRate !== null ? overstayPenaltyRate / 100 : null, // Convert from percentage to decimal
        maxPenaltyDays: overstayMaxPenaltyDays,
        policyText: overstayPolicyText || null,
      };

      const response = await fetch(`/api/manager/locations/${location.id}/overstay-penalty-defaults`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save overstay penalty defaults');
      }

      toast({
        title: "Success",
        description: "Overstay penalty defaults updated successfully",
      });
    } catch (error: any) {
      console.error('Error saving overstay penalty defaults:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save overstay penalty settings",
        variant: "destructive"
      });
    }
  };

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
      description: description || undefined,
      customOnboardingLink: customOnboardingLink || undefined,
      timezone: timezone || DEFAULT_TIMEZONE,
    };

    console.log('🚀 Saving location settings:', payload);

    onUpdateSettings.mutate(payload);
  };

  const handleSaveDailyBookingLimit = () => {
    if (!location.id) return;

    const payload = {
      locationId: location.id,
      defaultDailyBookingLimit: dailyBookingLimit,
    };

    console.log('🚀 Saving daily booking limit only:', payload);

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

  // Handle kitchen license upload
  const handleLicenseUpload = async (file: File, expiryDate: string) => {
    // Validate expiration date is provided
    if (!expiryDate || expiryDate.trim() === '') {
      toast({
        title: "Expiration Date Required",
        description: "Please provide an expiration date for the license.",
        variant: "destructive",
      });
      throw new Error("Expiration date is required");
    }

    // Validate expiration date is in the future
    const expiry = new Date(expiryDate);
    if (isNaN(expiry.getTime())) {
      toast({
        title: "Invalid Date",
        description: "Please provide a valid expiration date.",
        variant: "destructive",
      });
      throw new Error("Invalid expiration date");
    }

    setIsUploadingLicense(true);
    try {
      // Get Firebase token for authentication
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }

      const token = await currentFirebaseUser.getIdToken();

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/files/upload-file', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to upload license');
      }

      const result = await response.json();
      const licenseUrl = result.url;

      // Update location with new license URL, expiration date, and reset status to pending
      // Reuse existing token from above
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
          kitchenLicenseExpiry: expiryDate,
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
      setLicenseExpiryDate('');
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

        <div className="p-6">
          <Tabs
            value={activeTab}
            onValueChange={(val) => setActiveTab(val as SettingsTab)}
            className="w-full"
          >
            {/* Settings Header with Breadcrumbs */}
            <div className="mb-6 space-y-4">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>Dashboard</span>
                <span>/</span>
                <span className="text-gray-900 font-medium">Settings</span>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Location Settings</h2>
                <p className="text-gray-600">
                  Configure your location preferences, booking rules, application requirements, and notifications.
                </p>
              </div>
            </div>

            {/* Settings Quick Access Overview */}
            <div className="mb-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* 1. Setup */}
              <div
                className="p-4 border border-gray-200 rounded-lg hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer bg-white"
                onClick={() => setActiveTab('setup')}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-indigo-100 rounded-lg">
                    <FileText className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1">Setup</h3>
                    <p className="text-sm text-gray-600">
                      Upload and manage your kitchen license document (required for bookings)
                    </p>
                  </div>
                </div>
              </div>
              {/* 2. Kitchen */}
              <div
                className="p-4 border border-gray-200 rounded-lg hover:border-green-300 hover:shadow-md transition-all cursor-pointer bg-white"
                onClick={() => setActiveTab('branding')}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <ImageIcon className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1">Kitchen</h3>
                    <p className="text-sm text-gray-600">
                      Upload photos of your kitchens to help chefs see what they're booking
                    </p>
                  </div>
                </div>
              </div>
              {/* 3. Notifications */}
              <div
                className="p-4 border border-gray-200 rounded-lg hover:border-purple-300 hover:shadow-md transition-all cursor-pointer bg-white"
                onClick={() => setActiveTab('notifications')}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Mail className="h-5 w-5 text-purple-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1">Notifications</h3>
                    <p className="text-sm text-gray-600">
                      Set the email and phone number where you&apos;ll receive booking notifications
                    </p>
                  </div>
                </div>
              </div>
              {/* 4. Booking Rules */}
              <div
                className="p-4 border border-gray-200 rounded-lg hover:border-orange-300 hover:shadow-md transition-all cursor-pointer bg-white"
                onClick={() => setActiveTab('booking-rules')}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <Clock className="h-5 w-5 text-orange-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1">Booking Rules</h3>
                    <p className="text-sm text-gray-600">
                      Configure cancellation policies and daily booking hour limits for chefs
                    </p>
                  </div>
                </div>
              </div>
              {/* 5. Application */}
              <div
                className="p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-md transition-all cursor-pointer bg-white"
                onClick={() => setActiveTab('application-requirements')}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <FileText className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1">Application</h3>
                    <p className="text-sm text-gray-600">
                      Choose which information fields are required when chefs apply to use your kitchens
                    </p>
                  </div>
                </div>
              </div>
              {/* 6. Location */}
              <div
                className="p-4 border border-gray-200 rounded-lg hover:border-cyan-300 hover:shadow-md transition-all cursor-pointer bg-white"
                onClick={() => setActiveTab('location')}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-cyan-100 rounded-lg">
                    <Globe className="h-5 w-5 text-cyan-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1">Location</h3>
                    <p className="text-sm text-gray-600">
                      View your location&apos;s timezone settings (locked to Newfoundland Time)
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 rounded-xl bg-gray-100 p-1 mb-6 gap-1">
              <TabsTrigger value="setup" className="flex items-center gap-2 rounded-lg">
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">Setup</span>
              </TabsTrigger>
              <TabsTrigger value="branding" className="flex items-center gap-2 rounded-lg">
                <ImageIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Kitchen</span>
              </TabsTrigger>
              <TabsTrigger value="notifications" className="flex items-center gap-2 rounded-lg">
                <Mail className="h-4 w-4" />
                <span className="hidden sm:inline">Notifications</span>
              </TabsTrigger>
              <TabsTrigger value="booking-rules" className="flex items-center gap-2 rounded-lg">
                <Clock className="h-4 w-4" />
                <span className="hidden sm:inline">Booking Rules</span>
              </TabsTrigger>
              <TabsTrigger value="application-requirements" className="flex items-center gap-2 rounded-lg" title="Choose which information fields are required when chefs apply to use your kitchens">
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">Application</span>
              </TabsTrigger>
              <TabsTrigger value="location" className="flex items-center gap-2 rounded-lg">
                <Globe className="h-4 w-4" />
                <span className="hidden sm:inline">Location</span>
              </TabsTrigger>
            </TabsList>

            {/* Setup Tab */}
            <TabsContent value="setup" className="space-y-6 mt-0">
              {/* Setup & Onboarding Section */}
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">Onboarding Wizard</h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Complete or update your location setup, upload kitchen license, and configure your preferences using the onboarding wizard.
                    </p>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 md:p-6 space-y-4 shadow-md">
                  <div>
                    <p className="text-sm text-gray-700 mb-4">
                      Use the onboarding wizard to set up your location details, upload your kitchen license, and configure notification preferences.
                    </p>
                    <Button
                      onClick={() => {
                        // Trigger onboarding wizard to open
                        const event = new CustomEvent('open-onboarding-from-help');
                        window.dispatchEvent(event);
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <HelpCircle className="h-4 w-4" />
                      Open Onboarding Wizard
                    </Button>
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
                  {location.kitchenLicenseUrl && location.kitchenLicenseStatus !== "rejected" && location.kitchenLicenseStatus !== "expired" ? (
                    <div className={`border rounded-lg p-4 ${location.kitchenLicenseStatus === "approved" && !isLicenseExpired
                      ? "bg-green-50 border-green-200"
                      : location.kitchenLicenseStatus === "expired" || isLicenseExpired
                        ? "bg-red-50 border-red-200"
                        : isExpiryApproaching(location.kitchenLicenseExpiry)
                          ? "bg-orange-50 border-orange-200"
                          : "bg-yellow-50 border-yellow-200"
                      }`}>
                      <div className="flex items-start justify-between mb-3">
                        <div className={`flex items-center gap-2 ${location.kitchenLicenseStatus === "approved" && !isLicenseExpired
                          ? "text-green-800"
                          : location.kitchenLicenseStatus === "expired" || isLicenseExpired
                            ? "text-red-800"
                            : isExpiryApproaching(location.kitchenLicenseExpiry)
                              ? "text-orange-800"
                              : "text-yellow-800"
                          }`}>
                          {location.kitchenLicenseStatus === "expired" || isLicenseExpired ? (
                            <AlertCircle className="h-5 w-5" />
                          ) : (
                            <CheckCircle className="h-5 w-5" />
                          )}
                          <span className="font-medium">Kitchen License Document</span>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${location.kitchenLicenseStatus === "approved" && !isLicenseExpired
                          ? "bg-green-200 text-green-800"
                          : location.kitchenLicenseStatus === "expired" || isLicenseExpired
                            ? "bg-red-200 text-red-800"
                            : location.kitchenLicenseStatus === "pending"
                              ? "bg-yellow-200 text-yellow-800"
                              : "bg-gray-200 text-gray-800"
                          }`}>
                          {location.kitchenLicenseStatus === "expired" || isLicenseExpired ? "EXPIRED" : (location.kitchenLicenseStatus || "PENDING").toUpperCase()}
                        </span>
                      </div>

                      {/* Document Information */}
                      <div className="space-y-2 mb-3">
                        <div className="flex items-center gap-2 text-sm">
                          <FileText className="h-4 w-4 text-gray-600" />
                          <span className="text-gray-700">Document:</span>
                          <span className="font-medium text-gray-900">{getDocumentFilename(location.kitchenLicenseUrl)}</span>
                        </div>
                        {location.kitchenLicenseUploadedAt && (
                          <div className="flex items-center gap-2 text-sm">
                            <Clock className="h-4 w-4 text-gray-600" />
                            <span className="text-gray-700">Uploaded:</span>
                            <span className="text-gray-900">{new Date(location.kitchenLicenseUploadedAt).toLocaleDateString()} at {new Date(location.kitchenLicenseUploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        )}
                        {location.kitchenLicenseExpiry && (
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 text-gray-600" />
                            <span className="text-gray-700">Expiration Date:</span>
                            <span className={`font-medium ${isLicenseExpired ? "text-red-700" : isExpiryApproaching(location.kitchenLicenseExpiry) ? "text-orange-700" : "text-gray-900"
                              }`}>
                              {new Date(location.kitchenLicenseExpiry).toLocaleDateString()}
                            </span>
                            {(() => {
                              const daysUntil = getDaysUntilExpiry(location.kitchenLicenseExpiry);
                              if (daysUntil !== null) {
                                if (daysUntil < 0) {
                                  return <span className="text-red-700 font-semibold">(Expired {Math.abs(daysUntil)} days ago)</span>;
                                } else if (daysUntil <= 30) {
                                  return <span className="text-orange-700 font-semibold">({daysUntil} days remaining - Renewal needed soon)</span>;
                                } else {
                                  return <span className="text-green-700">({daysUntil} days remaining)</span>;
                                }
                              }
                              return null;
                            })()}
                          </div>
                        )}
                        {location.kitchenLicenseExpiry && !isLicenseExpired && (
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 text-blue-600" />
                            <span className="text-gray-700">Next Upload Date:</span>
                            <span className="font-medium text-blue-700">{new Date(location.kitchenLicenseExpiry).toLocaleDateString()}</span>
                            <span className="text-xs text-gray-500">(Upload new license on or before this date)</span>
                          </div>
                        )}
                      </div>
                      {!location.kitchenLicenseExpiry && location.kitchenLicenseStatus === "approved" && (
                        <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                          <p className="text-xs text-yellow-700 mb-3">
                            ⚠️ Please add an expiration date for your license.
                          </p>
                          <div className="flex items-center gap-3">
                            <input
                              type="date"
                              value={licenseExpiryDate}
                              onChange={(e) => setLicenseExpiryDate(e.target.value)}
                              min={new Date().toISOString().split('T')[0]}
                              className="flex-1 max-w-md border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                            />
                            <Button
                              type="button"
                              onClick={async () => {
                                if (!licenseExpiryDate) {
                                  toast({
                                    title: "Expiration Date Required",
                                    description: "Please enter an expiration date.",
                                    variant: "destructive",
                                  });
                                  return;
                                }

                                try {
                                  const currentFirebaseUser = auth.currentUser;
                                  if (!currentFirebaseUser) {
                                    throw new Error("Firebase user not available");
                                  }

                                  const token = await currentFirebaseUser.getIdToken();
                                  const response = await fetch(`/api/manager/locations/${location.id}`, {
                                    method: 'PUT',
                                    headers: {
                                      'Authorization': `Bearer ${token}`,
                                      'Content-Type': 'application/json'
                                    },
                                    credentials: 'include',
                                    body: JSON.stringify({
                                      kitchenLicenseExpiry: licenseExpiryDate,
                                    }),
                                  });

                                  if (!response.ok) {
                                    const errorData = await response.json();
                                    throw new Error(errorData.error || 'Failed to update expiry date');
                                  }

                                  // Refresh location data
                                  queryClient.invalidateQueries({ queryKey: ['/api/manager/locations'] });
                                  queryClient.invalidateQueries({ queryKey: ['locationDetails', location.id] });

                                  toast({
                                    title: "Expiry Date Added",
                                    description: "License expiration date has been added successfully.",
                                  });
                                } catch (error: any) {
                                  console.error('Expiry date update error:', error);
                                  toast({
                                    title: "Update Failed",
                                    description: error.message || "Failed to update expiry date",
                                    variant: "destructive",
                                  });
                                }
                              }}
                              disabled={!licenseExpiryDate}
                              className="bg-orange-600 hover:bg-orange-700 text-white"
                            >
                              <Save className="h-4 w-4 mr-1" />
                              Save Expiry Date
                            </Button>
                          </div>
                        </div>
                      )}
                      {/* Status Messages */}
                      {location.kitchenLicenseStatus === "approved" && !isLicenseExpired && (
                        <div className={`mt-3 p-3 rounded-lg ${isExpiryApproaching(location.kitchenLicenseExpiry)
                          ? "bg-orange-100 border border-orange-300"
                          : "bg-green-100 border border-green-300"
                          }`}>
                          {isExpiryApproaching(location.kitchenLicenseExpiry) ? (
                            <p className="text-xs text-orange-800 font-medium">
                              ⚠️ Your license expires soon! Please prepare to upload a new license before the expiration date.
                            </p>
                          ) : (
                            <p className="text-xs text-green-800 font-medium">
                              ✓ Your license has been approved! Bookings are now active.
                            </p>
                          )}
                        </div>
                      )}
                      {(location.kitchenLicenseStatus === "expired" || isLicenseExpired) && (
                        <div className="mt-3 p-3 bg-red-100 border border-red-300 rounded-lg">
                          <p className="text-xs text-red-800 font-medium">
                            ⚠️ Your license has expired. Please upload a new license immediately to continue bookings.
                          </p>
                        </div>
                      )}
                      {location.kitchenLicenseStatus === "pending" && (
                        <div className="mt-3 p-3 bg-yellow-100 border border-yellow-300 rounded-lg">
                          <p className="text-xs text-yellow-800 font-medium">
                            ⏳ Your license is pending admin approval. Bookings will be activated once approved.
                          </p>
                        </div>
                      )}
                      <AuthenticatedDocumentLink
                        url={location.kitchenLicenseUrl || `/api/files/kitchen-license/manager/${location.id}`}
                        className="text-sm text-blue-600 hover:text-blue-700 mt-2 inline-block"
                      >
                        View Current License →
                      </AuthenticatedDocumentLink>
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
                  ) : location.kitchenLicenseStatus === "expired" || isLicenseExpired ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                      <div className="flex items-center gap-2 text-red-800 mb-2">
                        <AlertCircle className="h-5 w-5" />
                        <span className="font-medium">License Expired</span>
                      </div>
                      {location.kitchenLicenseExpiry && (
                        <p className="text-sm text-red-700 mb-2">
                          Expired on: {new Date(location.kitchenLicenseExpiry).toLocaleDateString()}
                        </p>
                      )}
                      <p className="text-sm text-red-700 mb-3">
                        Please upload a new license document with an expiration date to continue bookings.
                      </p>
                    </div>
                  ) : null}

                  {shouldShowUpload && (
                    <>
                      {/* Expiration Date Input */}
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-900 mb-2">
                          License Expiration Date <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="date"
                          value={licenseExpiryDate}
                          onChange={(e) => setLicenseExpiryDate(e.target.value)}
                          min={new Date().toISOString().split('T')[0]}
                          className="w-full max-w-md border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                          required
                        />
                        <p className="text-xs text-gray-600 mt-1">
                          Required. Enter the date when this license expires.
                        </p>
                      </div>

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
                              if (!licenseExpiryDate) {
                                toast({
                                  title: "Expiration Date Required",
                                  description: "Please enter an expiration date before uploading.",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setLicenseFile(file);
                              handleLicenseUpload(file, licenseExpiryDate).catch((error) => {
                                console.error('License upload failed:', error);
                              });
                            }
                          }}
                          disabled={isUploadingLicense || !licenseExpiryDate}
                          className="hidden"
                          id="license-upload"
                        />
                        <label
                          htmlFor="license-upload"
                          className={`cursor-pointer flex flex-col items-center gap-3 ${isUploadingLicense || !licenseExpiryDate ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          {isUploadingLicense ? (
                            <>
                              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
                              <span className="text-sm text-gray-600">Uploading...</span>
                            </>
                          ) : (
                            <>
                              <Upload className="h-8 w-8 text-gray-400" />
                              <span className="text-sm font-medium text-orange-600 mb-1">
                                {location.kitchenLicenseStatus === "rejected" || location.kitchenLicenseStatus === "expired" || isLicenseExpired
                                  ? "Click to upload new license"
                                  : "Click to upload license"}
                              </span>
                              <span className="text-xs text-gray-500">PDF, JPG, or PNG (max 10MB)</span>
                              {!licenseExpiryDate && (
                                <span className="text-xs text-red-500 mt-1">Please enter expiration date first</span>
                              )}
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
                    </>
                  )}

                  {!shouldShowUpload && location.kitchenLicenseStatus === "approved" && !isLicenseExpired && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-sm text-blue-700">
                        Your license is currently active and not expired. You can upload a new license when the current one expires.
                      </p>
                      {location.kitchenLicenseExpiry && (
                        <p className="text-xs text-blue-600 mt-1">
                          You can upload a new license starting {new Date(location.kitchenLicenseExpiry).toLocaleDateString()}.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Kitchen Terms & Policies Section */}
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">Kitchen Terms & Policies</h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Upload your kitchen-specific terms, house rules, and policies that chefs must review when applying.
                    </p>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 md:p-6 space-y-4 shadow-md">
                  {/* Show existing terms if uploaded */}
                  {location.kitchenTermsUrl && (
                    <div className="bg-white border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center gap-2 font-medium text-blue-800 mb-2">
                        <CheckCircle className="h-5 w-5 text-blue-600" />
                        <span>Terms Document Uploaded</span>
                      </div>
                      <div className="text-sm text-blue-700 space-y-1">
                        <p>Document: <span className="font-medium">{getDocumentFilename(location.kitchenTermsUrl)}</span></p>
                        {location.kitchenTermsUploadedAt && (
                          <p>Uploaded: <span className="font-medium">{new Date(location.kitchenTermsUploadedAt).toLocaleDateString()}</span></p>
                        )}
                      </div>
                      <AuthenticatedDocumentLink
                        url={location.kitchenTermsUrl}
                        className="text-sm text-blue-600 hover:text-blue-700 mt-2 inline-block"
                      >
                        View Terms Document →
                      </AuthenticatedDocumentLink>
                    </div>
                  )}

                  {/* Upload section */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      {location.kitchenTermsUrl ? 'Replace Terms Document' : 'Upload Terms Document'}
                    </label>
                    <p className="text-xs text-gray-600 mb-3">
                      Include house rules, equipment usage policies, liability waivers, and any other terms chefs should agree to.
                    </p>
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          
                          if (file.size > 10 * 1024 * 1024) {
                            toast({
                              title: "File Too Large",
                              description: "Please upload a file smaller than 10MB",
                              variant: "destructive",
                            });
                            return;
                          }

                          try {
                            const currentFirebaseUser = auth.currentUser;
                            if (!currentFirebaseUser) {
                              throw new Error("Firebase user not available");
                            }
                            const token = await currentFirebaseUser.getIdToken();

                            // Upload file
                            const formData = new FormData();
                            formData.append('file', file);
                            const uploadRes = await fetch('/api/files/upload-file', {
                              method: 'POST',
                              headers: { 'Authorization': `Bearer ${token}` },
                              body: formData,
                            });
                            if (!uploadRes.ok) throw new Error("Upload failed");
                            const { url } = await uploadRes.json();

                            // Update location with terms URL
                            const updateRes = await fetch(`/api/manager/locations/${location.id}`, {
                              method: 'PUT',
                              headers: { 
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json'
                              },
                              credentials: 'include',
                              body: JSON.stringify({ kitchenTermsUrl: url }),
                            });
                            if (!updateRes.ok) throw new Error("Update failed");

                            queryClient.invalidateQueries({ queryKey: ['/api/manager/locations'] });
                            queryClient.invalidateQueries({ queryKey: ['locationDetails', location.id] });
                            toast({ 
                              title: "Terms Uploaded", 
                              description: "Kitchen terms & policies saved successfully." 
                            });
                          } catch (err: any) {
                            toast({ 
                              title: "Error", 
                              description: err.message || "Failed to upload terms", 
                              variant: "destructive" 
                            });
                          }
                        }}
                        className="hidden"
                        id="terms-upload"
                      />
                      <label
                        htmlFor="terms-upload"
                        className="cursor-pointer flex flex-col items-center gap-3"
                      >
                        <Upload className="h-8 w-8 text-gray-400" />
                        <span className="text-sm font-medium text-blue-600 mb-1">
                          {location.kitchenTermsUrl ? "Click to replace terms" : "Click to upload terms"}
                        </span>
                        <span className="text-xs text-gray-500">PDF, JPG, PNG, or DOC (max 10MB)</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Kitchen Tab */}
            <TabsContent value="branding" className="space-y-6 mt-0">
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

              {/* Location Landing Section */}
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Globe className="h-5 w-5 text-indigo-600 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">Landing Page Content</h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Customize the information shown to chefs when they visit your kitchen landing page.
                    </p>
                  </div>
                </div>

                <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 md:p-6 space-y-4">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="description" className="text-sm font-medium text-gray-900">
                        Public Description
                      </Label>
                      <textarea
                        id="description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Welcome to our kitchen community! We offer state-of-the-art facilities for culinary professionals..."
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-h-[100px]"
                      />
                      <p className="text-xs text-gray-600 mt-1">
                        A brief overview of your location that will be displayed to chefs.
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="customOnboardingLink" className="text-sm font-medium text-gray-900">
                        Custom Onboarding Link (optional)
                      </Label>
                      <Input
                        id="customOnboardingLink"
                        value={customOnboardingLink}
                        onChange={(e) => setCustomOnboardingLink(e.target.value)}
                        placeholder="https://example.com/onboarding"
                        className="mt-1 bg-white"
                      />
                      <p className="text-xs text-gray-600 mt-1">
                        If you have your own onboarding process, provide the URL here to redirect chefs.
                      </p>
                    </div>

                    <div className="flex justify-end pt-2">
                      <Button
                        onClick={() => handleSave()}
                        disabled={isUpdating}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white"
                      >
                        {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                        Save Landing Content
                      </Button>
                    </div>
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
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="font-semibold text-gray-900">{kitchen.name}</h4>
                                 <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-4 w-4 mr-1" />
                                      Delete
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This will permanently delete the kitchen &quot;{kitchen.name}&quot; and all associated bookings, availability settings, and custom overrides. This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        className="bg-red-600 hover:bg-red-700 text-white"
                                        onClick={async () => {
                                          try {
                                            const currentFirebaseUser = auth.currentUser;
                                            if (!currentFirebaseUser) throw new Error("Not authenticated");
                                            const token = await currentFirebaseUser.getIdToken();
                                            const response = await fetch(`/api/manager/kitchens/${kitchen.id}`, {
                                              method: 'DELETE',
                                              headers: { 'Authorization': `Bearer ${token}` }
                                            });
                                            if (!response.ok) throw new Error("Failed to delete kitchen");
                                            queryClient.invalidateQueries({ queryKey: ['managerKitchens', location.id] });
                                            toast({ title: "Kitchen Deleted", description: "Kitchen has been successfully removed." });
                                          } catch (e: any) {
                                            toast({ title: "Error", description: e.message, variant: "destructive" });
                                          }
                                        }}
                                      >
                                        Delete Kitchen
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
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
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Main Image
                              </label>
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

                          {/* Gallery Images Section */}
                          <div className="mt-4 pt-4 border-t border-amber-200">
                            <label className="block text-sm font-medium text-gray-700 mb-3">
                              Gallery Images
                            </label>
                            <KitchenGalleryImages
                              kitchenId={kitchen.id}
                              galleryImages={(kitchen as any).galleryImages || []}
                              locationId={location.id}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            </TabsContent>

            {/* Notifications Tab */}
            <TabsContent value="notifications" className="space-y-6 mt-0">
              {/* Notification Email Section */}
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Mail className="h-5 w-5 text-purple-600 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">Notification Settings</h3>
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
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Booking Rules Tab */}
            <TabsContent value="booking-rules" className="space-y-6 mt-0">
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
                      onClick={() => handleSaveDailyBookingLimit()}
                      disabled={isUpdating}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Save className="h-4 w-4" />
                      Save Changes
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
                      <strong>Example:</strong> With 1 hour, if it&apos;s 1:00 PM, chefs can only book times starting from 2:00 PM onwards.
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
                  </div>
                </div>
              </div>

              {/* Overstay Penalty Defaults Section */}
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">Storage Overstay Penalty Defaults</h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Configure default penalty settings for storage overstays at this location. These defaults apply to all storage listings unless overridden per listing.
                    </p>
                  </div>
                </div>

                <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-4">
                  {isLoadingPenaltyDefaults ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-6 w-6 animate-spin text-red-600" />
                      <span className="ml-2 text-sm text-gray-600">Loading penalty settings...</span>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-2">
                            Grace Period (Days)
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="14"
                            value={overstayGracePeriodDays ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setOverstayGracePeriodDays(val === '' ? null : parseInt(val));
                            }}
                            placeholder="Use platform default"
                            className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                          />
                          <p className="text-xs text-gray-600 mt-1">
                            Days before penalties apply (0-14). Leave empty to use platform default.
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-2">
                            Penalty Rate (%)
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="50"
                            step="1"
                            value={overstayPenaltyRate ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setOverstayPenaltyRate(val === '' ? null : parseInt(val));
                            }}
                            placeholder="Use platform default"
                            className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                          />
                          <p className="text-xs text-gray-600 mt-1">
                            % of daily rate per day (0-50%). Leave empty to use platform default.
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-2">
                            Max Penalty Days
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="90"
                            value={overstayMaxPenaltyDays ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setOverstayMaxPenaltyDays(val === '' ? null : parseInt(val));
                            }}
                            placeholder="Use platform default"
                            className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                          />
                          <p className="text-xs text-gray-600 mt-1">
                            Max days to charge penalties (1-90). Leave empty to use platform default.
                          </p>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-900 mb-2">
                          Policy Text (Optional)
                        </label>
                        <textarea
                          value={overstayPolicyText}
                          onChange={(e) => setOverstayPolicyText(e.target.value)}
                          rows={3}
                          className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                          placeholder="Custom policy text shown to chefs regarding overstay penalties..."
                        />
                        <p className="text-xs text-gray-600 mt-1">
                          Optional custom message shown to chefs about your overstay policy.
                        </p>
                      </div>

                      <div className="flex gap-3 pt-2">
                        <button
                          onClick={() => handleSaveOverstayPenaltyDefaults()}
                          disabled={isUpdating}
                          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <Save className="h-4 w-4" />
                          Save Penalty Defaults
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Application Requirements Tab */}
            <TabsContent value="application-requirements" className="space-y-6 mt-0">
              <LocationRequirementsSettings
                locationId={location.id}
                locationName={location.name}
              />
            </TabsContent>

            {/* Location Tab */}
            <TabsContent value="location" className="space-y-6 mt-0">
              {/* Timezone Section */}
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Globe className="h-5 w-5 text-cyan-600 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">Timezone Settings</h3>
                    <p className="text-sm text-gray-600 mb-4">
                      The timezone for this location is locked to Newfoundland Time. All booking times will be interpreted according to this timezone.
                    </p>
                  </div>
                </div>

                <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Location Timezone
                    </label>
                    <div className="w-full max-w-md border border-gray-300 rounded-lg px-4 py-2 bg-gray-50 text-gray-700 flex items-center gap-2">
                      <Globe className="h-4 w-4 text-gray-400" />
                      <span>Newfoundland Time (GMT-3:30)</span>
                      <span className="ml-auto text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded">Locked</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">
                      All booking times for this location will be interpreted in Newfoundland Time. This affects when bookings are considered "past", "upcoming", or "active".
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
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

