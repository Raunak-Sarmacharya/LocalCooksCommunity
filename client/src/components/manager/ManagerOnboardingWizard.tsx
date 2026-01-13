import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Building2,
  FileText,
  Settings,
  CheckCircle,
  X,
  ChevronRight,
  ChevronLeft,
  Upload,
  AlertCircle,
  Loader2,
  Package,
  Wrench,
  Plus,
  Info,
  Sparkles,
  ArrowRight,
  HelpCircle,
} from "lucide-react";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface OnboardingStep {
  id: number;
  title: string;
  description: string;
  icon: React.ReactNode;
}

interface Location {
  id: number;
  name: string;
  address: string;
  notificationEmail?: string;
  notificationPhone?: string;
  kitchenLicenseUrl?: string;
  kitchenLicenseStatus?: string;
  kitchenLicenseApprovedBy?: number;
  kitchenLicenseApprovedAt?: string;
  kitchenLicenseFeedback?: string;
  kitchenLicenseExpiry?: string;
}

export default function ManagerOnboardingWizard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, isLoadingLocations } = useManagerDashboard();
  const [currentStep, setCurrentStep] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [uploadingLicense, setUploadingLicense] = useState(false);
  const [licenseExpiryDate, setLicenseExpiryDate] = useState<string>('');
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [notificationPhone, setNotificationPhone] = useState("");
  
  // Kitchen creation form state
  const [showCreateKitchen, setShowCreateKitchen] = useState(false);
  const [kitchenFormData, setKitchenFormData] = useState({
    name: '',
    description: '',
    hourlyRate: '',
    currency: 'CAD',
    minimumBookingHours: '1',
  });
  const [creatingKitchen, setCreatingKitchen] = useState(false);
  
  // Storage listing form state
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(null);
  const [kitchens, setKitchens] = useState<any[]>([]);
  const [existingStorageListings, setExistingStorageListings] = useState<any[]>([]);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [existingEquipmentListings, setExistingEquipmentListings] = useState<any[]>([]);
  const [isLoadingEquipment, setIsLoadingEquipment] = useState(false);
  const [storageFormData, setStorageFormData] = useState({
    storageType: 'dry' as 'dry' | 'cold' | 'freezer',
    name: '',
    description: '',
    basePrice: 0,
    minimumBookingDuration: 1,
  });
  
  // Equipment listing form state
  const [equipmentFormData, setEquipmentFormData] = useState({
    category: 'cooking' as 'food-prep' | 'cooking' | 'refrigeration' | 'cleaning' | 'specialty',
    name: '',
    description: '',
    condition: 'good' as 'excellent' | 'good' | 'fair' | 'needs_repair',
    availabilityType: 'rental' as 'included' | 'rental',
    sessionRate: 0,
  });

  const steps: OnboardingStep[] = [
    {
      id: 0,
      title: "Welcome",
      description: "Learn about the setup process",
      icon: <Sparkles className="h-6 w-6" />,
    },
    {
      id: 1,
      title: "Location & Contact",
      description: "Set up your location details and notification preferences",
      icon: <Building2 className="h-6 w-6" />,
    },
    {
      id: 2,
      title: "Kitchen License",
      description: "Upload your kitchen license for admin approval",
      icon: <FileText className="h-6 w-6" />,
    },
    {
      id: 3,
      title: "Create Kitchen",
      description: "Set up your first kitchen space",
      icon: <Settings className="h-6 w-6" />,
    },
    {
      id: 4,
      title: "Storage Listings",
      description: "Add storage options (optional - can add later)",
      icon: <Package className="h-6 w-6" />,
    },
    {
      id: 5,
      title: "Equipment Listings",
      description: "Add equipment options (optional - can add later)",
      icon: <Wrench className="h-6 w-6" />,
    },
  ];

  // Check if user is a manager using Firebase auth (with session fallback for backward compatibility)
  const { user: firebaseUser } = useFirebaseAuth();
  
  // Try Firebase auth first
  const { data: firebaseUserData } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) return null;
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch("/api/user/profile", {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!firebaseUser,
  });

  // Firebase Auth only - no session fallback
  const userData = firebaseUserData;

  const isManager = userData?.role === "manager";
  const stepsCompleted = userData?.manager_onboarding_steps_completed || {};
  
  // Check if locations exist to determine which steps to show
  const hasExistingLocation = !isLoadingLocations && locations.length > 0;
  
  // Get selected location
  const selectedLocation = locations.find((loc) => loc.id === selectedLocationId) as Location | undefined;
  
  // Check if selected location has a valid (non-rejected, non-expired) license uploaded
  const hasLicense = selectedLocation?.kitchenLicenseUrl && 
    selectedLocation?.kitchenLicenseStatus !== "rejected" && 
    selectedLocation?.kitchenLicenseStatus !== "expired" &&
    !(selectedLocation?.kitchenLicenseExpiry && new Date(selectedLocation.kitchenLicenseExpiry) < new Date());
  
  // Filter steps based on location existence and license status
  // If location exists:
  //   - Skip Welcome (0) and Location & Contact (1)
  //   - Only skip Kitchen License (2) if license is already uploaded
  //   - Always show Create Kitchen (3), Storage (4), Equipment (5)
  const visibleSteps = hasExistingLocation 
    ? hasLicense
      ? steps.filter(step => step.id >= 3) // Skip Welcome, Location & Contact, and License (already uploaded)
      : steps.filter(step => step.id === 0 || step.id >= 2) // Skip Welcome and Location & Contact, but show License
    : steps; // Show all steps for new locations
  
  // Helper function to map visible step index to actual step ID
  const getActualStepId = (visibleIndex: number): number => {
    if (visibleIndex < 0 || visibleIndex >= visibleSteps.length) return -1;
    return visibleSteps[visibleIndex].id;
  };
  
  // Helper function to get visible index from actual step ID
  const getVisibleIndex = (actualStepId: number): number => {
    return visibleSteps.findIndex(step => step.id === actualStepId);
  };
  
  // Helper function to get current visible step index
  const getCurrentVisibleIndex = (): number => {
    const actualStepId = getActualStepId(currentStep);
    return getVisibleIndex(actualStepId);
  };
  
  // Track previous location count and location IDs to detect new locations
  const [previousLocationCount, setPreviousLocationCount] = useState(0);
  const [previousLocationIds, setPreviousLocationIds] = useState<number[]>([]);
  const [locationOnboardingStatus, setLocationOnboardingStatus] = useState<Record<number, { hasKitchen: boolean; needsOnboarding: boolean }>>({});
  
  // Check if a location needs onboarding
  const checkLocationNeedsOnboarding = async (locationId: number): Promise<boolean> => {
    try {
      const { auth } = await import('@/lib/firebase');
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) return false;
      
      const token = await currentFirebaseUser.getIdToken();
      
      // Check if location has kitchens
      const kitchensResponse = await fetch(`/api/manager/kitchens/${locationId}`, {
        credentials: "include",
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (kitchensResponse.ok) {
        const kitchens = await kitchensResponse.json();
        const hasKitchen = Array.isArray(kitchens) && kitchens.length > 0;
        const needsOnboarding = !hasKitchen;
        
        // Update location onboarding status
        setLocationOnboardingStatus(prev => ({
          ...prev,
          [locationId]: { hasKitchen, needsOnboarding }
        }));
        
        return needsOnboarding;
      }
      
      // Default to needing onboarding if check fails
      setLocationOnboardingStatus(prev => ({
        ...prev,
        [locationId]: { hasKitchen: false, needsOnboarding: true }
      }));
      return true;
    } catch (error) {
      console.error("Error checking location onboarding status:", error);
      // Default to needing onboarding on error
      setLocationOnboardingStatus(prev => ({
        ...prev,
        [locationId]: { hasKitchen: false, needsOnboarding: true }
      }));
      return true;
    }
  };
  
  // Check all locations for onboarding needs when locations load
  useEffect(() => {
    if (!isLoadingLocations && locations.length > 0) {
      locations.forEach(location => {
        // Only check if we don't already have status for this location
        if (!locationOnboardingStatus[location.id]) {
          checkLocationNeedsOnboarding(location.id);
        }
      });
    }
  }, [locations, isLoadingLocations]);
  
  // Update previous location count and detect new locations
  useEffect(() => {
    if (!isLoadingLocations) {
      const currentCount = locations.length;
      const currentLocationIds = locations.map(loc => loc.id);
      
      // If location count increased, a new location was added
      if (currentCount > previousLocationCount && previousLocationCount > 0) {
        // Find the new location (one that wasn't in previous list)
        const newLocation = locations.find(loc => !previousLocationIds.includes(loc.id));
        
        if (newLocation) {
          // New location was added - check if it needs onboarding
          checkLocationNeedsOnboarding(newLocation.id).then(needsOnboarding => {
            if (needsOnboarding) {
              // Trigger onboarding for this new location
              setIsOpen(true);
              setSelectedLocationId(newLocation.id);
              const loc = newLocation as any;
              setLocationName(loc.name || "");
              setLocationAddress(loc.address || "");
              setNotificationEmail(loc.notificationEmail || "");
              setNotificationPhone(loc.notificationPhone || "");
              // Start from step 3 (Create Kitchen) since location exists
              setCurrentStep(3);
              // Mark this location as needing onboarding
              setLocationOnboardingStatus(prev => ({
                ...prev,
                [newLocation.id]: { hasKitchen: false, needsOnboarding: true }
              }));
            }
          });
        }
      }
      
      setPreviousLocationCount(currentCount);
      setPreviousLocationIds(currentLocationIds);
    }
  }, [locations, isLoadingLocations, previousLocationCount, previousLocationIds]);
  
  // Check if any location needs onboarding (for initial auto-open)
  // A location needs onboarding if it doesn't have a kitchen
  const hasLocationNeedingOnboarding = locations.some(loc => {
    const status = locationOnboardingStatus[loc.id];
    // If we haven't checked yet, assume it might need onboarding
    // If we have checked, use the status
    return status ? status.needsOnboarding : true;
  });
  
  // For location-specific onboarding: show if no locations exist OR if any location needs onboarding
  // Global onboarding completion only matters for the first location
  const shouldAutoOpen = 
    isManager &&
    (locations.length === 0 || 
     (!userData?.manager_onboarding_completed && !userData?.manager_onboarding_skipped && hasLocationNeedingOnboarding));
  
  // Allow manual opening from help center even if completed
  const [manualOpen, setManualOpen] = useState(false);
  
  // Initialize stepsCompleted state
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>(stepsCompleted);
  
  // Initialize currentStep based on location existence and auto-select location
  useEffect(() => {
    if (!isLoadingLocations) {
      if (hasExistingLocation) {
        // Auto-select first location if none selected
        if (!selectedLocationId && locations.length > 0) {
          setSelectedLocationId(locations[0].id);
          const loc = locations[0] as any;
          setLocationName(loc.name || "");
          setLocationAddress(loc.address || "");
          setNotificationEmail(loc.notificationEmail || "");
          setNotificationPhone(loc.notificationPhone || "");
        }
        // If location exists and we're on an early step, jump to appropriate step
        // If license is missing, go to step 2 (License), otherwise step 3 (Create Kitchen)
        if (currentStep < 2) {
          const loc = locations[0] as any;
          if (!loc?.kitchenLicenseUrl || loc?.kitchenLicenseStatus === "rejected") {
            setCurrentStep(2); // Go to license step if missing or rejected
          } else {
            setCurrentStep(3); // Go to kitchen step if license exists
          }
        }
      }
    }
  }, [isLoadingLocations, hasExistingLocation, locations, selectedLocationId, currentStep]);

  // Listen for manual open from help center
  useEffect(() => {
    const handleOpenFromHelp = () => {
      if (isManager) {
        setManualOpen(true);
        setIsOpen(true);
      }
    };
    window.addEventListener('open-onboarding-from-help', handleOpenFromHelp);
    return () => {
      window.removeEventListener('open-onboarding-from-help', handleOpenFromHelp);
    };
  }, [isManager]);

  // Auto-open for new managers or locations needing onboarding (only if not manually opened)
  useEffect(() => {
    if (shouldAutoOpen && !isLoadingLocations && !manualOpen) {
      // Find a location that needs onboarding
      const locationNeedingOnboarding = locations.find(loc => {
        const status = locationOnboardingStatus[loc.id];
        return status?.needsOnboarding === true;
      });
      
      if (locationNeedingOnboarding || locations.length === 0) {
        setIsOpen(true);
        
        if (locationNeedingOnboarding) {
          // Select the location that needs onboarding
          setSelectedLocationId(locationNeedingOnboarding.id);
          const loc = locationNeedingOnboarding as any;
          setLocationName(loc.name || "");
          setLocationAddress(loc.address || "");
          setNotificationEmail(loc.notificationEmail || "");
          setNotificationPhone(loc.notificationPhone || "");
          // Start from step 3 (Create Kitchen) since location exists
          setCurrentStep(3);
        } else if (locations.length === 1) {
          // No locations exist or only one location - select it
          setSelectedLocationId(locations[0].id);
          const loc = locations[0] as any;
          setLocationName(loc.name || "");
          setLocationAddress(loc.address || "");
          setNotificationEmail(loc.notificationEmail || "");
          setNotificationPhone(loc.notificationPhone || "");
        }
        
        // If location exists, start from appropriate step based on license status
        if (hasExistingLocation && currentStep < 2) {
          const loc = locations.find(l => l.id === selectedLocationId) || locations[0];
          if (loc && (!loc.kitchenLicenseUrl || loc.kitchenLicenseStatus === "rejected")) {
            setCurrentStep(2); // Go to license step if missing or rejected
          } else {
            setCurrentStep(3); // Go to kitchen step if license exists
          }
        }
      }
    }
  }, [shouldAutoOpen, isLoadingLocations, locations, manualOpen, hasExistingLocation, currentStep, locationOnboardingStatus]);


  // Load kitchens when location is selected
  useEffect(() => {
    if (selectedLocationId) {
      const loadKitchens = async () => {
        try {
          // Get Firebase token for authentication
          const { auth } = await import('@/lib/firebase');
          const currentFirebaseUser = auth.currentUser;
          if (!currentFirebaseUser) {
            throw new Error("Firebase user not available");
          }
          
          const token = await currentFirebaseUser.getIdToken();
          const response = await fetch(`/api/manager/kitchens/${selectedLocationId}`, {
            credentials: "include",
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
          if (response.ok) {
            const data = await response.json();
            const kitchensData = Array.isArray(data) ? data : [];
            setKitchens(kitchensData);
            
            // Update location onboarding status based on kitchens
            const hasKitchen = kitchensData.length > 0;
            setLocationOnboardingStatus(prev => ({
              ...prev,
              [selectedLocationId]: { hasKitchen, needsOnboarding: !hasKitchen }
            }));
            
            if (kitchensData.length === 1 && !selectedKitchenId) {
              setSelectedKitchenId(kitchensData[0].id);
            }
            if (kitchensData.length === 0) {
              setShowCreateKitchen(true);
            }
          }
        } catch (error) {
          console.error("Error loading kitchens:", error);
        }
      };
      loadKitchens();
    }
  }, [selectedLocationId]);

  // Load storage listings when kitchen is selected and we're on storage step
  useEffect(() => {
    if (selectedKitchenId && currentStep === 4) {
      const loadStorageListings = async () => {
        setIsLoadingStorage(true);
        try {
          const { auth } = await import('@/lib/firebase');
          const currentFirebaseUser = auth.currentUser;
          if (!currentFirebaseUser) return;
          
          const token = await currentFirebaseUser.getIdToken();
          const response = await fetch(`/api/manager/kitchens/${selectedKitchenId}/storage-listings`, {
            credentials: "include",
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
          if (response.ok) {
            const data = await response.json();
            setExistingStorageListings(Array.isArray(data) ? data : []);
          } else {
            setExistingStorageListings([]);
          }
        } catch (error) {
          console.error("Error loading storage listings:", error);
          setExistingStorageListings([]);
        } finally {
          setIsLoadingStorage(false);
        }
      };
      loadStorageListings();
    } else if (currentStep !== 4) {
      // Clear storage listings when not on storage step
      setExistingStorageListings([]);
    }
  }, [selectedKitchenId, currentStep]);

  // Load equipment listings when kitchen is selected and we're on equipment step
  useEffect(() => {
    if (selectedKitchenId && currentStep === 5) {
      const loadEquipmentListings = async () => {
        setIsLoadingEquipment(true);
        try {
          const { auth } = await import('@/lib/firebase');
          const currentFirebaseUser = auth.currentUser;
          if (!currentFirebaseUser) return;
          
          const token = await currentFirebaseUser.getIdToken();
          const response = await fetch(`/api/manager/kitchens/${selectedKitchenId}/equipment-listings`, {
            credentials: "include",
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
          if (response.ok) {
            const data = await response.json();
            setExistingEquipmentListings(Array.isArray(data) ? data : []);
          } else {
            setExistingEquipmentListings([]);
          }
        } catch (error) {
          console.error("Error loading equipment listings:", error);
          setExistingEquipmentListings([]);
        } finally {
          setIsLoadingEquipment(false);
        }
      };
      loadEquipmentListings();
    } else if (currentStep !== 5) {
      // Clear equipment listings when not on equipment step
      setExistingEquipmentListings([]);
    }
  }, [selectedKitchenId, currentStep]);

  const createKitchenMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; hourlyRate?: string; currency?: string; minimumBookingHours?: string }) => {
      if (!selectedLocationId) {
        throw new Error("No location selected");
      }
      
      // Get Firebase token for authentication
      const { auth } = await import('@/lib/firebase');
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      const token = await currentFirebaseUser.getIdToken();
      
      // Create the kitchen first
      const response = await fetch(`/api/manager/kitchens`, {
        method: "POST",
        headers: { 
          'Authorization': `Bearer ${token}`,
          "Content-Type": "application/json" 
        },
        credentials: "include",
        body: JSON.stringify({
          locationId: selectedLocationId,
          name: data.name,
          description: data.description || undefined,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create kitchen");
      }
      const kitchen = await response.json();
      
      // Set pricing if provided
      if (data.hourlyRate && data.hourlyRate.trim() !== '') {
        const hourlyRateNum = parseFloat(data.hourlyRate);
        if (!isNaN(hourlyRateNum) && hourlyRateNum > 0) {
          const pricingResponse = await fetch(`/api/manager/kitchens/${kitchen.id}/pricing`, {
            method: "PUT",
            headers: { 
              'Authorization': `Bearer ${token}`,
              "Content-Type": "application/json" 
            },
            credentials: "include",
            body: JSON.stringify({
              hourlyRate: hourlyRateNum,
              currency: data.currency || 'CAD',
              minimumBookingHours: parseInt(data.minimumBookingHours || '1') || 1,
            }),
          });
          if (!pricingResponse.ok) {
            console.warn("Kitchen created but failed to set pricing:", await pricingResponse.text());
            // Don't throw error - kitchen was created successfully, pricing can be set later
          }
        }
      }
      
      return kitchen;
    },
    onSuccess: (data) => {
      // Reload kitchens and select the new one
      setKitchens([...kitchens, data]);
      setSelectedKitchenId(data.id);
      setShowCreateKitchen(false);
      setKitchenFormData({ name: '', description: '', hourlyRate: '', currency: 'CAD', minimumBookingHours: '1' });
      
      // Update location onboarding status - location no longer needs onboarding
      if (selectedLocationId) {
        setLocationOnboardingStatus(prev => ({
          ...prev,
          [selectedLocationId]: { hasKitchen: true, needsOnboarding: false }
        }));
      }
      
      toast({
        title: "Kitchen Created",
        description: "Kitchen created successfully. You can now add storage and equipment listings.",
      });
    },
  });

  const updateLocationMutation = useMutation({
    mutationFn: async (data: any) => {
      // Get Firebase token for authentication
      const { auth } = await import('@/lib/firebase');
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      const token = await currentFirebaseUser.getIdToken();
      
      // If no location exists, create one first
      if (!selectedLocationId || locations.length === 0) {
        const response = await fetch(`/api/manager/locations`, {
          method: "POST",
          headers: { 
            'Authorization': `Bearer ${token}`,
            "Content-Type": "application/json" 
          },
          credentials: "include",
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to create location");
        }
        const newLocation = await response.json();
        setSelectedLocationId(newLocation.id);
        return newLocation;
      } else {
        // Update existing location
        const response = await fetch(`/api/manager/locations/${selectedLocationId}`, {
          method: "PUT",
          headers: { 
            'Authorization': `Bearer ${token}`,
            "Content-Type": "application/json" 
          },
          credentials: "include",
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to update location");
        }
        return response.json();
      }
    },
    onSuccess: (data) => {
      // If we just created a location, set it as selected
      const wasFirstLocation = locations.length === 0;
      if (data.id && !selectedLocationId) {
        setSelectedLocationId(data.id);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      
      // Mark new location as needing onboarding (no kitchen yet)
      if (data.id) {
        setLocationOnboardingStatus(prev => ({
          ...prev,
          [data.id]: { hasKitchen: false, needsOnboarding: true }
        }));
        
        // If this was a new location (not the first), trigger onboarding for it
        if (!wasFirstLocation) {
          // Set the new location as selected
          setSelectedLocationId(data.id);
          const loc = data as any;
          setLocationName(loc.name || "");
          setLocationAddress(loc.address || "");
          setNotificationEmail(loc.notificationEmail || "");
          setNotificationPhone(loc.notificationPhone || "");
          // Open onboarding wizard
          setIsOpen(true);
          // Start from step 2 (Kitchen License) since location was just created and needs license
          setCurrentStep(2);
        }
      }
    },
  });

  const uploadLicenseMutation = useMutation({
    mutationFn: async (file: File) => {
      setUploadingLicense(true);
      try {
        // Get Firebase token for authentication
        const { auth } = await import('@/lib/firebase');
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) {
          throw new Error("Firebase user not available");
        }
        
        const token = await currentFirebaseUser.getIdToken();
        
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/upload-file", {
          method: "POST",
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          credentials: "include",
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to upload license");
        }

        const result = await response.json();
        return result.url;
      } finally {
        setUploadingLicense(false);
      }
    },
  });

  const completeOnboardingMutation = useMutation({
    mutationFn: async (skipped: boolean) => {
      // Get Firebase token for authentication
      const { auth } = await import('@/lib/firebase');
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error("Firebase user not available");
      }
      
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch("/api/manager/complete-onboarding", {
        method: "POST",
        headers: { 
          'Authorization': `Bearer ${token}`,
          "Content-Type": "application/json" 
        },
        credentials: "include",
        body: JSON.stringify({ skipped }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to complete onboarding");
      }
      return { skipped };
    },
    onSuccess: (data) => {
      const skipped = data.skipped;
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      setIsOpen(false);
      toast({
        title: skipped ? "Onboarding Skipped" : "Onboarding Completed",
        description: skipped
          ? "You can complete setup later from your dashboard."
          : "Your location is set up! Waiting for license approval to activate bookings.",
      });
    },
    onError: (error: Error) => {
      console.error("Error completing onboarding:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to complete onboarding. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Track step completion (with optional location ID for location-specific tracking)
  const trackStepCompletion = async (stepId: number, locationId?: number) => {
    try {
      const { auth } = await import('@/lib/firebase');
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) return;
      
      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch("/api/manager/onboarding/step", {
        method: "POST",
        headers: { 
          'Authorization': `Bearer ${token}`,
          "Content-Type": "application/json" 
        },
        credentials: "include",
        body: JSON.stringify({ 
          stepId,
          locationId: locationId || selectedLocationId || undefined
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setCompletedSteps(data.stepsCompleted || {});
        queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      }
    } catch (error) {
      console.error("Error tracking step completion:", error);
      // Don't block user flow if tracking fails
    }
  };

  const handleNext = async () => {
    if (currentStep === 0) {
      // Welcome step - just move to next
      // Track step completion first, then move to next step
      try {
        await trackStepCompletion(0);
      } catch (error) {
        console.error("Error tracking step 0:", error);
        // Don't block user flow if tracking fails
      }
      setCurrentStep(1);
      return;
    }

    // If location exists, automatically mark skipped steps as completed
    if (hasExistingLocation) {
      // Mark step 1 as completed (Location & Contact) since location exists
      if (!completedSteps['step_1']) await trackStepCompletion(1);
      // Only mark step 2 (License) as completed if license is already uploaded
      if (hasLicense && !completedSteps['step_2']) await trackStepCompletion(2);
    }

    if (currentStep === 1) {
      // Validate basic info - only for new locations
      if (hasExistingLocation) {
        // Skip to license step if location exists but no license
        setCurrentStep(2);
        return;
      }
      // Validate basic info
      if (!locationName || !locationAddress) {
        toast({
          title: "Missing Information",
          description: "Please fill in location name and address",
          variant: "destructive",
        });
        return;
      }

      // Update location with basic info and notification settings
      try {
        const updatedLocation = await updateLocationMutation.mutateAsync({
          name: locationName,
          address: locationAddress,
          notificationEmail,
          notificationPhone,
        });
        await trackStepCompletion(1);
        // Always go to license step (2) after creating/updating location
        setCurrentStep(2);
      } catch (error: any) {
        toast({
          title: "Error",
          description: error.message || "Failed to save location information",
          variant: "destructive",
        });
      }
    } else if (currentStep === 2) {
      // Upload license if provided
      if (licenseFile) {
        // Validate expiration date is provided when uploading a file
        if (!licenseExpiryDate) {
          toast({
            title: "Missing Information",
            description: "Please enter the license expiration date",
            variant: "destructive",
          });
          return;
        }
        try {
          const licenseUrl = await uploadLicenseMutation.mutateAsync(licenseFile);
          await updateLocationMutation.mutateAsync({
            kitchenLicenseUrl: licenseUrl,
            kitchenLicenseStatus: "pending",
            kitchenLicenseExpiry: licenseExpiryDate,
          });
          toast({
            title: "License Uploaded",
            description: "Your license has been submitted for admin approval.",
          });
          // Reset license fields after successful upload
          setLicenseFile(null);
          setLicenseExpiryDate('');
        } catch (error: any) {
          toast({
            title: "Upload Failed",
            description: error.message || "Failed to upload license",
            variant: "destructive",
          });
          return;
        }
      } else if (licenseExpiryDate && !licenseFile) {
        // If expiration date is entered but no file, just save the expiration date
        try {
          await updateLocationMutation.mutateAsync({
            kitchenLicenseExpiry: licenseExpiryDate,
          });
        } catch (error: any) {
          toast({
            title: "Error",
            description: error.message || "Failed to save expiration date",
            variant: "destructive",
          });
          return;
        }
      }
      await trackStepCompletion(2);
      setCurrentStep(3);
    } else if (currentStep === 3) {
      // Kitchen creation step - can skip if kitchen already exists
      if (kitchens.length > 0 || selectedKitchenId) {
        setCurrentStep(4);
      } else if (!showCreateKitchen) {
        // If no kitchen exists and not showing create form, prompt to create
        toast({
          title: "Kitchen Required",
          description: "Please create a kitchen to continue, or click 'Skip for Now' to complete setup later.",
          variant: "destructive",
        });
        return;
      } else {
        // Kitchen form is showing, move to next step
        await trackStepCompletion(3);
        setCurrentStep(4);
      }
    } else if (currentStep === 4) {
      // Storage listings step - optional, can skip
      await trackStepCompletion(4);
      setCurrentStep(5);
    } else if (currentStep === 5) {
      // Equipment listings step - optional, can skip
      await trackStepCompletion(5);
      setCurrentStep(6);
    } else if (currentStep === 6) {
      // Complete onboarding - this should not be reached as we use handleCompleteSetup
      // But keep it as fallback
      try {
        await completeOnboardingMutation.mutateAsync(false);
      } catch (error: any) {
        // Error is already handled by onError in the mutation
        console.error("Error in handleNext for step 6:", error);
      }
    }
  };

  // Dedicated handler for completing setup on step 6
  const handleCompleteSetup = async () => {
    if (currentStep === 6 && !completeOnboardingMutation.isPending) {
      try {
        await completeOnboardingMutation.mutateAsync(false);
      } catch (error: any) {
        // Error is already handled by onError in the mutation
        console.error("Error completing setup:", error);
      }
    }
  };

  const handleSkip = async () => {
    // If on step 6 (final step), complete onboarding with skipped flag
    if (currentStep === 6) {
      if (
        window.confirm(
          "Are you sure you want to skip onboarding? You can complete it later, but bookings will be disabled until your license is approved."
        )
      ) {
        await completeOnboardingMutation.mutateAsync(true);
      }
      return;
    }

    // If on the final visible step (but not step 6), complete onboarding
    const finalStepId = visibleSteps.length > 0 ? visibleSteps[visibleSteps.length - 1].id : 6;
    if (currentStep === finalStepId) {
      if (
        window.confirm(
          "Are you sure you want to skip onboarding? You can complete it later, but bookings will be disabled until your license is approved."
        )
      ) {
        await completeOnboardingMutation.mutateAsync(true);
      }
      return;
    }

    // For all other steps, find the next visible step
    const currentVisibleIndex = getVisibleIndex(currentStep);
    if (currentVisibleIndex >= 0 && currentVisibleIndex < visibleSteps.length - 1) {
      await trackStepCompletion(currentStep);
      const nextStepId = visibleSteps[currentVisibleIndex + 1].id;
      setCurrentStep(nextStepId);
    }
  };

  const handleBack = () => {
    // Find the previous visible step
    const currentVisibleIndex = getVisibleIndex(currentStep);
    if (currentVisibleIndex > 0) {
      const prevStepId = visibleSteps[currentVisibleIndex - 1].id;
      setCurrentStep(prevStepId);
    } else if (currentStep > 0 && !hasExistingLocation) {
      // Fallback for when location doesn't exist - go back one step
      setCurrentStep(currentStep - 1);
    }
  };


  // Always render for managers, but only show dialog when open
  if (!isManager) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0 bg-gradient-to-br from-[#FFF8F5] via-white to-[#FFFAF8]">
        <div className="bg-gradient-to-r from-[#F51042] via-rose-500 to-[#F51042] px-6 py-5 rounded-t-lg shadow-lg">
          <DialogHeader className="text-white">
            <DialogTitle className="text-2xl font-bold text-white">
              {hasExistingLocation 
                ? selectedLocation 
                  ? `Set Up ${selectedLocation.name}` 
                  : "Add Equipment & Storage"
                : currentStep === 0 
                  ? "Welcome to Local Cooks Community!" 
                  : "Let's Set Up Your Kitchen"}
            </DialogTitle>
            <DialogDescription className="text-rose-100">
              {hasExistingLocation
                ? selectedLocation
                  ? `Complete setup for ${selectedLocation.name} - add kitchen, storage, and equipment`
                  : "Add equipment and storage listings to your existing location"
                : currentStep === 0 
                  ? "We'll guide you through setting up your kitchen space in just a few steps"
                  : "Complete these steps to activate bookings for your location"}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 py-6">
          {/* Progress Indicator */}
          <div className="flex items-start justify-between mb-8 relative">
            {/* Icon row - all icons on same horizontal line */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-0" style={{ height: '3.5rem' }}>
              {visibleSteps.map((step, index) => (
                <div key={`icon-${step.id}`} className="flex-1 flex items-center justify-center relative">
                  <div
                    className={`relative w-14 h-14 rounded-full flex items-center justify-center border-3 transition-all duration-300 ${
                      currentStep > step.id || completedSteps[`step_${step.id}`]
                        ? "bg-gradient-to-br from-green-500 to-emerald-600 border-green-500 text-white shadow-lg shadow-green-500/30"
                        : currentStep === step.id
                        ? "bg-gradient-to-br from-[#F51042] to-rose-500 border-[#F51042] text-white shadow-lg shadow-[#F51042]/40 ring-4 ring-rose-200"
                        : "bg-white border-gray-300 text-gray-400 shadow-sm"
                    }`}
                    style={{ borderWidth: '3px' }}
                  >
                    {currentStep > step.id || completedSteps[`step_${step.id}`] ? (
                      <CheckCircle className="h-7 w-7" />
                    ) : (
                      <div className="transition-transform duration-300">
                        {step.icon}
                      </div>
                    )}
                    {currentStep === step.id && (
                      <div className="absolute -inset-1 bg-rose-400 rounded-full animate-ping opacity-20"></div>
                    )}
                  </div>
                  {index < visibleSteps.length - 1 && (
                    <div className="absolute left-1/2 right-0 h-1" style={{ top: '50%', transform: 'translateY(-50%)', marginLeft: '1.75rem' }}>
                      <div className={`absolute inset-0 rounded-full transition-all duration-500 ${
                        currentStep > step.id || completedSteps[`step_${step.id}`] 
                          ? "bg-gradient-to-r from-green-500 to-green-400" 
                          : "bg-gray-200"
                      }`}></div>
                      {currentStep > step.id || completedSteps[`step_${step.id}`] ? (
                        <div className="absolute inset-0 bg-gradient-to-r from-green-400 to-green-300 rounded-full animate-pulse"></div>
                      ) : null}
                      {currentStep === step.id && (
                        <div className="absolute inset-0 bg-gradient-to-r from-[#F51042] to-rose-500 rounded-full animate-pulse opacity-50"></div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            {/* Label row - positioned below icons */}
            <div className="flex items-start justify-between w-full mt-20">
              {visibleSteps.map((step) => (
                <div key={`label-${step.id}`} className="flex-1 flex flex-col items-center justify-center px-1">
                  <div
                    className={`text-xs font-semibold leading-tight text-center ${
                      currentStep >= step.id ? "text-gray-900" : "text-gray-400"
                    }`}
                    style={{ 
                      maxWidth: '100px',
                      width: '100%',
                    }}
                  >
                    {step.title.includes(' & ') ? (
                      // Handle "Location & Contact" - split at " & "
                      (() => {
                        const parts = step.title.split(' & ');
                        return (
                          <>
                            <div className="block text-center">{parts[0]}</div>
                            <div className="block text-center">& {parts[1]}</div>
                          </>
                        );
                      })()
                    ) : step.title.split(' ').length === 2 ? (
                      // Handle two-word titles like "Kitchen License", "Create Kitchen", etc.
                      (() => {
                        const words = step.title.split(' ');
                        return (
                          <>
                            <div className="block text-center">{words[0]}</div>
                            <div className="block text-center">{words[1]}</div>
                          </>
                        );
                      })()
                    ) : (
                      // Single word titles like "Welcome"
                      <div className="block text-center">{step.title}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

        {/* Step Content */}
        <div className="space-y-6">
          {currentStep === 0 && !hasExistingLocation && (
            <div className="space-y-6">
              <div className="relative bg-gradient-to-br from-[#FFE8DD] via-[#FFF8F5] to-white border-2 border-rose-200/50 rounded-2xl p-8 shadow-xl overflow-hidden">
                {/* Decorative elements */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#F51042]/10 rounded-full blur-3xl"></div>
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-rose-200/20 rounded-full blur-3xl"></div>
                
                <div className="relative z-10">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="p-3 bg-gradient-to-br from-[#F51042] to-rose-500 rounded-2xl shadow-lg shadow-[#F51042]/30">
                      <Sparkles className="h-8 w-8 text-white" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-gray-900">Getting Started</h3>
                      <p className="text-gray-600 mt-1">
                        We'll help you set up your kitchen space so chefs can start booking
                      </p>
                    </div>
                  </div>
                  
                  <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 mb-6 border border-rose-200">
                    <p className="text-gray-700 font-medium">
                      ⏱️ This process takes about <span className="text-[#F51042] font-semibold">5-10 minutes</span>
                    </p>
                  </div>
                  
                  <div className="space-y-3 mt-6">
                    <div className="flex items-start gap-4 p-4 bg-white/90 backdrop-blur-sm rounded-xl border border-rose-100 hover:shadow-md hover:border-rose-200 transition-all duration-200 group">
                      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-[#F51042] to-rose-500 flex items-center justify-center text-white font-bold shadow-lg shadow-[#F51042]/30 group-hover:scale-110 transition-transform">
                        1
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-gray-900 mb-1">Location & Contact Info</h4>
                        <p className="text-sm text-gray-600">Tell us about your kitchen location and how to reach you</p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 p-4 bg-white/90 backdrop-blur-sm rounded-xl border border-rose-100 hover:shadow-md hover:border-rose-200 transition-all duration-200 group">
                      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-[#F51042] to-rose-500 flex items-center justify-center text-white font-bold shadow-lg shadow-[#F51042]/30 group-hover:scale-110 transition-transform">
                        2
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-gray-900 mb-1">Kitchen License</h4>
                        <p className="text-sm text-gray-600">Upload your license (required for bookings to be activated)</p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 p-4 bg-white/90 backdrop-blur-sm rounded-xl border border-rose-100 hover:shadow-md hover:border-rose-200 transition-all duration-200 group">
                      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-[#F51042] to-rose-500 flex items-center justify-center text-white font-bold shadow-lg shadow-[#F51042]/30 group-hover:scale-110 transition-transform">
                        3
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-gray-900 mb-1">Create Your Kitchen</h4>
                        <p className="text-sm text-gray-600">Set up your first kitchen space (you can add more later)</p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 p-4 bg-white/90 backdrop-blur-sm rounded-xl border border-gray-200 hover:shadow-md transition-all duration-200 group">
                      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center text-white font-bold shadow-lg group-hover:scale-110 transition-transform">
                        4
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-gray-900 mb-1">Storage Listings <span className="text-xs font-normal text-gray-500">(Optional)</span></h4>
                        <p className="text-sm text-gray-600">Add storage options that chefs can book</p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4 p-4 bg-white/90 backdrop-blur-sm rounded-xl border border-gray-200 hover:shadow-md transition-all duration-200 group">
                      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center text-white font-bold shadow-lg group-hover:scale-110 transition-transform">
                        5
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-gray-900 mb-1">Equipment Listings <span className="text-xs font-normal text-gray-500">(Optional)</span></h4>
                        <p className="text-sm text-gray-600">Add equipment options - you can skip and add these later</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 p-5 bg-white/95 backdrop-blur-sm rounded-xl border-2 border-rose-200 shadow-lg">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-rose-100 rounded-lg">
                        <Info className="h-5 w-5 text-[#F51042] flex-shrink-0" />
                      </div>
                      <div className="text-sm text-gray-700">
                        <p className="font-bold mb-2 text-gray-900">Understanding the Structure:</p>
                        <ul className="space-y-2">
                          <li className="flex items-start gap-2">
                            <span className="text-[#F51042] font-bold mt-0.5">•</span>
                            <span><strong className="text-gray-900">Location</strong> - Your business address (e.g., "Downtown Kitchen")</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-[#F51042] font-bold mt-0.5">•</span>
                            <span><strong className="text-gray-900">Kitchen</strong> - A specific kitchen space within your location</span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-[#F51042] font-bold mt-0.5">•</span>
                            <span><strong className="text-gray-900">Listings</strong> - Storage and equipment that chefs can book</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 1 && !hasExistingLocation && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">Location & Contact Information</h3>
                <p className="text-sm text-gray-600">
                  Tell us about your kitchen location and how you'd like to receive booking notifications.
                </p>
              </div>
              
              <div className="bg-gradient-to-r from-rose-50 to-pink-50 border-2 border-rose-200/50 rounded-xl p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-rose-100 rounded-lg">
                    <HelpCircle className="h-5 w-5 text-[#F51042] flex-shrink-0" />
                  </div>
                  <div className="text-sm text-gray-700">
                    <p className="font-bold mb-2 text-gray-900">What is a Location?</p>
                    <p>Your location is your business address. This is what chefs will see when searching for kitchen spaces. You can have multiple kitchens within one location.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="location-name" className="flex items-center gap-2">
                    Location Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="location-name"
                    type="text"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder="e.g., Main Street Kitchen"
                    className="mt-1"
                  />
                  <p className="text-xs text-gray-500 mt-1">The name of your kitchen business or location</p>
                </div>
                
                <div>
                  <Label htmlFor="location-address" className="flex items-center gap-2">
                    Full Address <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="location-address"
                    type="text"
                    value={locationAddress}
                    onChange={(e) => setLocationAddress(e.target.value)}
                    placeholder="e.g., 123 Main St, St. John's, NL A1B 2C3"
                    className="mt-1"
                  />
                  <p className="text-xs text-gray-500 mt-1">Complete street address where your kitchen is located</p>
                </div>
                
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Notification Preferences (Optional)</h4>
                  <p className="text-xs text-gray-600 mb-4">
                    Configure where you'll receive booking notifications. If left empty, notifications will be sent to your account email.
                  </p>
                  
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="notification-email">Notification Email</Label>
                      <Input
                        id="notification-email"
                        type="email"
                        value={notificationEmail}
                        onChange={(e) => setNotificationEmail(e.target.value)}
                        placeholder="notifications@example.com"
                        className="mt-1"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Email address for booking confirmations, cancellations, and updates
                      </p>
                    </div>
                    
                    <div>
                      <Label htmlFor="notification-phone">Notification Phone (SMS)</Label>
                      <Input
                        id="notification-phone"
                        type="tel"
                        value={notificationPhone}
                        onChange={(e) => setNotificationPhone(e.target.value)}
                        placeholder="(709) 555-1234"
                        className="mt-1"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Phone number for SMS notifications (optional)
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (!hasExistingLocation || !hasLicense) && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">Kitchen License</h3>
                <p className="text-sm text-gray-600">
                  Upload your kitchen operating license for admin approval. This is required to activate bookings.
                </p>
              </div>
              
              <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-200/50 rounded-xl p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                  </div>
                  <div>
                    <p className="text-sm text-amber-900 font-bold mb-2">
                      License Required for Booking Activation
                    </p>
                    <p className="text-xs text-amber-800 mb-3 leading-relaxed">
                      Your kitchen license must be approved by an admin before bookings can be activated. 
                      You can skip this step and upload later, but bookings will remain disabled until approved.
                    </p>
                    <div className="bg-white/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-amber-200">
                      <p className="text-xs text-amber-900">
                        <strong className="font-semibold">Accepted formats:</strong> PDF, JPG, PNG (max 10MB)
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {selectedLocation?.kitchenLicenseUrl && selectedLocation?.kitchenLicenseStatus !== "rejected" && selectedLocation?.kitchenLicenseStatus !== "expired" ? (
                  (() => {
                    const isLicenseExpired = selectedLocation.kitchenLicenseExpiry 
                      ? new Date(selectedLocation.kitchenLicenseExpiry) < new Date()
                      : false;
                    const isApprovedAndNotExpired = selectedLocation.kitchenLicenseStatus === "approved" && !isLicenseExpired;
                    
                    return (
                      <div className={`border rounded-lg p-4 ${
                        isApprovedAndNotExpired
                          ? "bg-green-50 border-green-200" 
                          : "bg-yellow-50 border-yellow-200"
                      }`}>
                        <div className={`flex items-center gap-2 ${
                          isApprovedAndNotExpired
                            ? "text-green-800" 
                            : "text-yellow-800"
                        }`}>
                          <CheckCircle className="h-5 w-5" />
                          <span className="font-medium">License Uploaded</span>
                        </div>
                        <p className={`text-sm mt-1 ${
                          isApprovedAndNotExpired
                            ? "text-green-700" 
                            : "text-yellow-700"
                        }`}>
                          Status: {selectedLocation.kitchenLicenseStatus || "pending"}
                        </p>
                        
                        {/* Show uploaded license file */}
                        {selectedLocation.kitchenLicenseUrl && (
                          <div className="mt-3 flex items-center gap-2">
                            <FileText className="h-4 w-4 text-gray-600" />
                            <a
                              href={selectedLocation.kitchenLicenseUrl.includes('r2.cloudflarestorage.com') 
                                ? `/api/files/r2-proxy?url=${encodeURIComponent(selectedLocation.kitchenLicenseUrl)}`
                                : selectedLocation.kitchenLicenseUrl || `/api/files/kitchen-license/manager/${selectedLocation.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-[#F51042] hover:underline"
                            >
                              View uploaded license
                            </a>
                          </div>
                        )}
                        
                        {/* Show expiration date */}
                        {selectedLocation.kitchenLicenseExpiry && (
                          <p className={`text-sm mt-2 ${
                            isApprovedAndNotExpired
                              ? "text-green-700" 
                              : "text-yellow-700"
                          }`}>
                            Expiration Date: {new Date(selectedLocation.kitchenLicenseExpiry).toLocaleDateString()}
                            {isLicenseExpired ? (
                              <span className="ml-2 font-semibold text-red-600">
                                (Expired {Math.floor((new Date().getTime() - new Date(selectedLocation.kitchenLicenseExpiry).getTime()) / (1000 * 60 * 60 * 24))} days ago)
                              </span>
                            ) : selectedLocation.kitchenLicenseStatus === "approved" ? (
                              <span className="ml-2 text-green-600">
                                (Expires in {Math.ceil((new Date(selectedLocation.kitchenLicenseExpiry).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} days)
                              </span>
                            ) : null}
                          </p>
                        )}
                        
                        {isApprovedAndNotExpired && (
                          <p className="text-xs text-green-600 mt-2">
                            ✓ Your license has been approved! Bookings are now active.
                          </p>
                        )}
                        {selectedLocation.kitchenLicenseStatus === "pending" && (
                          <p className="text-xs text-yellow-600 mt-2">
                            ⏳ Your license is pending admin approval. Bookings will be activated once approved.
                          </p>
                        )}
                        
                        {/* Only show upload option if expired */}
                        {isLicenseExpired && (
                          <div className="mt-4 pt-4 border-t border-gray-200">
                            <p className="text-sm text-red-700 mb-3">
                              ⚠️ Your license has expired. Please upload a new license to continue bookings.
                            </p>
                            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
                              <label className="cursor-pointer block text-center">
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
                                    }
                                  }}
                                  className="hidden"
                                />
                                <span className="text-sm text-[#F51042] hover:text-rose-600 font-medium">
                                  Click to upload new license
                                </span>
                                <p className="text-xs text-gray-500 mt-1">
                                  PDF, JPG, or PNG (max 10MB)
                                </p>
                              </label>
                              {licenseFile && (
                                <div className="mt-3 flex items-center justify-center gap-2 text-sm text-gray-700">
                                  <FileText className="h-4 w-4" />
                                  <span>{licenseFile.name}</span>
                                </div>
                              )}
                            </div>
                            <div className="mt-4">
                              <Label htmlFor="expired-license-expiry-date">
                                License Expiration Date <span className="text-red-500">*</span>
                              </Label>
                              <Input
                                id="expired-license-expiry-date"
                                type="date"
                                value={licenseExpiryDate}
                                onChange={(e) => setLicenseExpiryDate(e.target.value)}
                                min={new Date().toISOString().split('T')[0]}
                                className="mt-1"
                                required
                              />
                              <p className="text-xs text-gray-500 mt-1">
                                Enter the expiration date of your new kitchen license
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : selectedLocation?.kitchenLicenseStatus === "rejected" || selectedLocation?.kitchenLicenseStatus === "expired" ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-red-800 mb-2">
                      <AlertCircle className="h-5 w-5" />
                      <span className="font-medium">
                        {selectedLocation.kitchenLicenseStatus === "expired" ? "License Expired" : "License Rejected"}
                      </span>
                    </div>
                    {selectedLocation.kitchenLicenseFeedback && (
                      <p className="text-sm text-red-700 mb-3">
                        <strong>Admin Feedback:</strong> {selectedLocation.kitchenLicenseFeedback}
                      </p>
                    )}
                    {selectedLocation.kitchenLicenseExpiry && selectedLocation.kitchenLicenseStatus === "expired" && (
                      <p className="text-sm text-red-700 mb-2">
                        Expired on: {new Date(selectedLocation.kitchenLicenseExpiry).toLocaleDateString()}
                        <span className="ml-2 font-semibold">
                          ({Math.floor((new Date().getTime() - new Date(selectedLocation.kitchenLicenseExpiry).getTime()) / (1000 * 60 * 60 * 24))} days ago)
                        </span>
                      </p>
                    )}
                    {/* Show uploaded license file if exists */}
                    {selectedLocation.kitchenLicenseUrl && (
                      <div className="mb-3 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-gray-600" />
                        <a
                          href={selectedLocation.kitchenLicenseUrl.includes('r2.cloudflarestorage.com') 
                            ? `/api/files/r2-proxy?url=${encodeURIComponent(selectedLocation.kitchenLicenseUrl)}`
                            : selectedLocation.kitchenLicenseUrl || `/api/files/kitchen-license/manager/${selectedLocation.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-[#F51042] hover:underline"
                        >
                          View current license
                        </a>
                      </div>
                    )}
                    <p className="text-sm text-red-700 mb-3">
                      Please upload a new license document to resubmit for approval.
                    </p>
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                      <div className="text-center">
                        <Upload className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                        <label className="cursor-pointer">
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
                              }
                            }}
                            className="hidden"
                          />
                          <span className="text-sm text-[#F51042] hover:text-rose-600 font-medium mb-2">
                            Click to upload new license
                          </span>
                          <p className="text-xs text-gray-500">
                            PDF, JPG, or PNG (max 10MB)
                          </p>
                        </label>
                        {licenseFile && (
                          <div className="mt-3 flex items-center justify-center gap-2 text-sm text-gray-700">
                            <FileText className="h-4 w-4" />
                            <span>{licenseFile.name}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    {/* License Expiration Date for rejected license re-upload */}
                    <div className="mt-4">
                      <Label htmlFor="rejected-license-expiry-date">
                        License Expiration Date <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="rejected-license-expiry-date"
                        type="date"
                        value={licenseExpiryDate}
                        onChange={(e) => setLicenseExpiryDate(e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                        className="mt-1"
                        required
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Enter the expiration date of your kitchen license
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 bg-gradient-to-br from-gray-50 to-white hover:border-rose-400 hover:bg-rose-50/30 transition-all duration-200 cursor-pointer group">
                      <div className="text-center">
                        <div className="mb-4 flex justify-center">
                          <div className="p-4 bg-rose-100 rounded-2xl group-hover:bg-rose-200 group-hover:scale-110 transition-all duration-200">
                            <Upload className="h-10 w-10 text-[#F51042]" />
                          </div>
                        </div>
                        <label className="cursor-pointer block">
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
                              }
                            }}
                            className="hidden"
                          />
                          <span className="text-base text-[#F51042] hover:text-rose-600 font-semibold block mb-3">
                            Click to upload license
                          </span>
                          <p className="text-sm text-gray-500">
                            PDF, JPG, or PNG (max 10MB)
                          </p>
                        </label>
                        {licenseFile && (
                          <div className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-gray-700 bg-white rounded-lg px-4 py-2 border border-gray-200 shadow-sm">
                            <FileText className="h-4 w-4 text-[#F51042]" />
                            <span>{licenseFile.name}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* License Expiration Date - always visible as a proper field */}
                    <div>
                      <Label htmlFor="license-expiry-date">
                        License Expiration Date <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="license-expiry-date"
                        type="date"
                        value={licenseExpiryDate}
                        onChange={(e) => setLicenseExpiryDate(e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                        className="mt-1"
                        required
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Enter the expiration date of your kitchen license
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">
                  {hasExistingLocation 
                    ? selectedLocation 
                      ? `Create Kitchen for ${selectedLocation.name}`
                      : "Create Kitchen"
                    : "Create Your First Kitchen"}
                </h3>
                <p className="text-sm text-gray-600">
                  A kitchen is a specific space within your location where chefs can book time. You can add more kitchens later.
                </p>
              </div>

              {/* Location selector if multiple locations exist */}
              {hasExistingLocation && locations.length > 1 && (
                <div className="space-y-2">
                  <Label htmlFor="location-select">Select Location</Label>
                    <Select
                      value={selectedLocationId?.toString() || ""}
                      onValueChange={(value) => {
                        const locationId = parseInt(value);
                        setSelectedLocationId(locationId);
                        const loc = locations.find(l => l.id === locationId);
                        if (loc) {
                          setLocationName(loc.name || "");
                          setLocationAddress(loc.address || "");
                          setNotificationEmail(loc.notificationEmail || "");
                          setNotificationPhone(loc.notificationPhone || "");
                        }
                        // Check onboarding status for the newly selected location
                        checkLocationNeedsOnboarding(locationId);
                        // Reset kitchens when location changes
                        setKitchens([]);
                        setSelectedKitchenId(null);
                      }}
                    >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select a location" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((location) => (
                        <SelectItem key={location.id} value={location.id.toString()}>
                          {location.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="bg-gradient-to-r from-rose-50 to-pink-50 border-2 border-rose-200/50 rounded-xl p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-rose-100 rounded-lg">
                    <HelpCircle className="h-5 w-5 text-[#F51042] flex-shrink-0" />
                  </div>
                  <div className="text-sm text-gray-700">
                    <p className="font-bold mb-2 text-gray-900">How do Kitchens work?</p>
                    <p>Each kitchen space can have its own storage and equipment listings. If you have multiple kitchen spaces at your location, create separate kitchens for each one.</p>
                  </div>
                </div>
              </div>

              {kitchens.length > 0 ? (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-green-800">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Kitchen Created!</span>
                    </div>
                    <p className="text-sm text-green-700 mt-1">
                      You have {kitchens.length} kitchen{kitchens.length > 1 ? 's' : ''} set up. You can add more from your dashboard later.
                    </p>
                  </div>
                  
                  {kitchens.length === 1 && (
                    <div className="border rounded-lg p-4 bg-gray-50">
                      <p className="text-sm font-medium text-gray-900 mb-1">Current Kitchen:</p>
                      <p className="text-sm text-gray-700">{kitchens[0].name}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {showCreateKitchen ? (
                    <div className="border rounded-lg p-4 bg-gray-50">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Create Kitchen</h4>
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor="kitchen-name">
                            Kitchen Name <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="kitchen-name"
                            value={kitchenFormData.name}
                            onChange={(e) => setKitchenFormData({ ...kitchenFormData, name: e.target.value })}
                            placeholder="e.g., Main Kitchen"
                            className="mt-1"
                          />
                          <p className="text-xs text-gray-500 mt-1">Give your kitchen a descriptive name</p>
                        </div>
                        <div>
                          <Label htmlFor="kitchen-description">Description (Optional)</Label>
                          <Textarea
                            id="kitchen-description"
                            value={kitchenFormData.description}
                            onChange={(e) => setKitchenFormData({ ...kitchenFormData, description: e.target.value })}
                            placeholder="Describe your kitchen space, size, features..."
                            rows={3}
                            className="mt-1"
                          />
                          <p className="text-xs text-gray-500 mt-1">Help chefs understand what makes your kitchen special</p>
                        </div>
                        <div className="border-t pt-3 mt-3">
                          <h5 className="text-sm font-semibold text-gray-900 mb-3">Pricing Information</h5>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label htmlFor="kitchen-hourly-rate">
                                Hourly Rate <span className="text-red-500">*</span>
                              </Label>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-sm text-gray-500">$</span>
                                <Input
                                  id="kitchen-hourly-rate"
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={kitchenFormData.hourlyRate}
                                  onChange={(e) => setKitchenFormData({ ...kitchenFormData, hourlyRate: e.target.value })}
                                  placeholder="0.00"
                                  className="flex-1"
                                />
                              </div>
                              <p className="text-xs text-gray-500 mt-1">Price per hour for kitchen bookings</p>
                            </div>
                            <div>
                              <Label htmlFor="kitchen-currency">Currency</Label>
                              <Select
                                value={kitchenFormData.currency}
                                onValueChange={(value) => setKitchenFormData({ ...kitchenFormData, currency: value })}
                              >
                                <SelectTrigger className="mt-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="CAD">CAD ($)</SelectItem>
                                  <SelectItem value="USD">USD ($)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="mt-3">
                            <Label htmlFor="kitchen-minimum-hours">Minimum Booking Hours</Label>
                            <Input
                              id="kitchen-minimum-hours"
                              type="number"
                              min="1"
                              value={kitchenFormData.minimumBookingHours}
                              onChange={(e) => setKitchenFormData({ ...kitchenFormData, minimumBookingHours: e.target.value })}
                              className="mt-1"
                            />
                            <p className="text-xs text-gray-500 mt-1">Minimum number of hours required for a booking</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={async () => {
                              if (!kitchenFormData.name.trim()) {
                                toast({
                                  title: "Missing Information",
                                  description: "Please enter a kitchen name",
                                  variant: "destructive",
                                });
                                return;
                              }
                              if (!kitchenFormData.hourlyRate || parseFloat(kitchenFormData.hourlyRate) <= 0) {
                                toast({
                                  title: "Missing Information",
                                  description: "Please enter a valid hourly rate",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setCreatingKitchen(true);
                              try {
                                await createKitchenMutation.mutateAsync(kitchenFormData);
                              } finally {
                                setCreatingKitchen(false);
                              }
                            }}
                            disabled={creatingKitchen || createKitchenMutation.isPending}
                          >
                            {creatingKitchen || createKitchenMutation.isPending ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Creating...
                              </>
                            ) : (
                              <>
                                <Plus className="h-4 w-4 mr-2" />
                                Create Kitchen
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowCreateKitchen(false);
                              setKitchenFormData({ name: '', description: '', hourlyRate: '', currency: 'CAD', minimumBookingHours: '1' });
                            }}
                            disabled={creatingKitchen || createKitchenMutation.isPending}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                      <Settings className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                      <p className="text-sm font-medium text-gray-900 mb-1">No kitchen created yet</p>
                      <p className="text-xs text-gray-600 mb-4">
                        Create your first kitchen to start adding storage and equipment listings
                      </p>
                      <Button
                        onClick={() => setShowCreateKitchen(true)}
                        className="w-full"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create Your First Kitchen
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {currentStep === 4 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">Storage Listings (Optional)</h3>
                <p className="text-sm text-gray-600">
                  Add storage options that chefs can book. This step is optional - you can skip and add listings later from your dashboard.
                </p>
              </div>
              
              <div className="bg-gradient-to-r from-rose-50 to-pink-50 border-2 border-rose-200/50 rounded-xl p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-rose-100 rounded-lg">
                    <Info className="h-5 w-5 text-[#F51042] flex-shrink-0" />
                  </div>
                  <div className="text-sm text-gray-700">
                    <p className="font-bold mb-2 text-gray-900">What are Storage Listings?</p>
                    <p>Storage listings allow chefs to book dry storage, cold storage, or freezer space at your kitchen. You can add multiple storage options with different sizes and prices.</p>
                  </div>
                </div>
              </div>

              {kitchens.length === 0 ? (
                <div className="space-y-4">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-800 mb-3">
                      No kitchens found for this location. Create your first kitchen to get started.
                    </p>
                  </div>
                  
                  {showCreateKitchen ? (
                    <div className="border rounded-lg p-4 bg-gray-50">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Create Kitchen</h4>
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor="kitchen-name">Kitchen Name *</Label>
                          <Input
                            id="kitchen-name"
                            value={kitchenFormData.name}
                            onChange={(e) => setKitchenFormData({ ...kitchenFormData, name: e.target.value })}
                            placeholder="e.g., Main Kitchen"
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label htmlFor="kitchen-description">Description (Optional)</Label>
                          <Textarea
                            id="kitchen-description"
                            value={kitchenFormData.description}
                            onChange={(e) => setKitchenFormData({ ...kitchenFormData, description: e.target.value })}
                            placeholder="Describe your kitchen..."
                            rows={3}
                            className="mt-1"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={async () => {
                              if (!kitchenFormData.name.trim()) {
                                toast({
                                  title: "Missing Information",
                                  description: "Please enter a kitchen name",
                                  variant: "destructive",
                                });
                                return;
                              }
                              if (!kitchenFormData.hourlyRate || parseFloat(kitchenFormData.hourlyRate) <= 0) {
                                toast({
                                  title: "Missing Information",
                                  description: "Please enter a valid hourly rate",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setCreatingKitchen(true);
                              try {
                                await createKitchenMutation.mutateAsync(kitchenFormData);
                              } finally {
                                setCreatingKitchen(false);
                              }
                            }}
                            disabled={creatingKitchen || createKitchenMutation.isPending}
                          >
                            {creatingKitchen || createKitchenMutation.isPending ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Creating...
                              </>
                            ) : (
                              <>
                                <Plus className="h-4 w-4 mr-2" />
                                Create Kitchen
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowCreateKitchen(false);
                              setKitchenFormData({ name: '', description: '', hourlyRate: '', currency: 'CAD', minimumBookingHours: '1' });
                            }}
                            disabled={creatingKitchen || createKitchenMutation.isPending}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Button
                      onClick={() => setShowCreateKitchen(true)}
                      className="w-full"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Create Your First Kitchen
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="kitchen-select">Select Kitchen</Label>
                    <Select
                      value={selectedKitchenId?.toString() || ""}
                      onValueChange={(value) => setSelectedKitchenId(parseInt(value))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select a kitchen" />
                      </SelectTrigger>
                      <SelectContent>
                        {kitchens.map((kitchen) => (
                          <SelectItem key={kitchen.id} value={kitchen.id.toString()}>
                            {kitchen.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {!selectedKitchenId ? (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <p className="text-sm text-yellow-800">
                        Please select a kitchen to view or add storage listings.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Show existing storage listings */}
                      {isLoadingStorage ? (
                        <div className="flex items-center justify-center p-4">
                          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                          <span className="ml-2 text-sm text-gray-600">Loading existing storage listings...</span>
                        </div>
                      ) : existingStorageListings.length > 0 ? (
                        <div className="border rounded-lg p-4 bg-green-50 border-green-200">
                          <div className="flex items-center gap-2 mb-3">
                            <CheckCircle className="h-5 w-5 text-green-600" />
                            <h4 className="font-semibold text-gray-900">
                              Existing Storage Listings ({existingStorageListings.length})
                            </h4>
                          </div>
                          <div className="space-y-2">
                            {existingStorageListings.map((listing) => (
                              <div key={listing.id} className="bg-white rounded-lg p-3 border border-green-200">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <p className="font-medium text-gray-900">{listing.name}</p>
                                    <p className="text-xs text-gray-600 capitalize mt-1">
                                      {listing.storageType} Storage
                                      {listing.basePrice ? ` • $${parseFloat(listing.basePrice).toFixed(2)}/day` : ''}
                                    </p>
                                    {listing.description && (
                                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{listing.description}</p>
                                    )}
                                  </div>
                                  <div className="ml-2">
                                    {listing.isActive ? (
                                      <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Active</span>
                                    ) : (
                                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">Inactive</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-xs text-gray-600 mt-3">
                            💡 You can add more storage listings below or manage them from your dashboard.
                          </p>
                        </div>
                      ) : null}

                      <div className="space-y-3 border rounded-lg p-4 bg-gray-50">
                      <div>
                        <Label htmlFor="storage-type">Storage Type</Label>
                        <Select
                          value={storageFormData.storageType}
                          onValueChange={(value: 'dry' | 'cold' | 'freezer') =>
                            setStorageFormData({ ...storageFormData, storageType: value })
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="dry">Dry Storage</SelectItem>
                            <SelectItem value="cold">Cold Storage</SelectItem>
                            <SelectItem value="freezer">Freezer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="storage-name">Storage Name *</Label>
                        <Input
                          id="storage-name"
                          value={storageFormData.name}
                          onChange={(e) => setStorageFormData({ ...storageFormData, name: e.target.value })}
                          placeholder="e.g., Main Dry Storage"
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <Label htmlFor="storage-description">Description</Label>
                        <Textarea
                          id="storage-description"
                          value={storageFormData.description}
                          onChange={(e) => setStorageFormData({ ...storageFormData, description: e.target.value })}
                          placeholder="Describe the storage space..."
                          rows={3}
                          className="mt-1"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="storage-price">Daily Rate (CAD) *</Label>
                          <Input
                            id="storage-price"
                            type="number"
                            min="0"
                            step="0.01"
                            value={storageFormData.basePrice}
                            onChange={(e) => setStorageFormData({ ...storageFormData, basePrice: parseFloat(e.target.value) || 0 })}
                            placeholder="0.00"
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label htmlFor="storage-min-days">Minimum Days *</Label>
                          <Input
                            id="storage-min-days"
                            type="number"
                            min="1"
                            value={storageFormData.minimumBookingDuration}
                            onChange={(e) => setStorageFormData({ ...storageFormData, minimumBookingDuration: parseInt(e.target.value) || 1 })}
                            placeholder="1"
                            className="mt-1"
                          />
                        </div>
                      </div>

                      <Button
                        onClick={async () => {
                          if (!storageFormData.name || !selectedKitchenId) {
                            toast({
                              title: "Missing Information",
                              description: "Please fill in storage name",
                              variant: "destructive",
                            });
                            return;
                          }
                          try {
                            // Get Firebase token for authentication
                            const currentFirebaseUser = auth.currentUser;
                            if (!currentFirebaseUser) {
                              throw new Error("Firebase user not available");
                            }
                            
                            const token = await currentFirebaseUser.getIdToken();
                            const response = await fetch(`/api/manager/storage-listings`, {
                              method: "POST",
                              headers: { 
                                'Authorization': `Bearer ${token}`,
                                "Content-Type": "application/json" 
                              },
                              credentials: "include",
                              body: JSON.stringify({
                                kitchenId: selectedKitchenId,
                                name: storageFormData.name,
                                storageType: storageFormData.storageType,
                                description: storageFormData.description || null,
                                basePrice: storageFormData.basePrice, // API expects dollars, will convert to cents
                                pricingModel: 'daily', // Required field
                                minimumBookingDuration: storageFormData.minimumBookingDuration,
                                bookingDurationUnit: 'daily',
                                photos: [],
                                currency: "CAD",
                                isActive: true,
                              }),
                            });
                            if (!response.ok) {
                              const error = await response.json();
                              throw new Error(error.error || "Failed to create storage listing");
                            }
                            toast({
                              title: "Storage Listing Created",
                              description: "You can add more listings from your dashboard later.",
                            });
                            // Reload existing storage listings
                            const refreshResponse = await fetch(`/api/manager/kitchens/${selectedKitchenId}/storage-listings`, {
                              credentials: "include",
                              headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json',
                              },
                            });
                            if (refreshResponse.ok) {
                              const refreshData = await refreshResponse.json();
                              setExistingStorageListings(Array.isArray(refreshData) ? refreshData : []);
                            }
                            // Reset form
                            setStorageFormData({
                              storageType: 'dry',
                              name: '',
                              description: '',
                              basePrice: 0,
                              minimumBookingDuration: 1,
                            });
                          } catch (error: any) {
                            toast({
                              title: "Error",
                              description: error.message || "Failed to create storage listing",
                              variant: "destructive",
                            });
                          }
                        }}
                        className="w-full"
                        disabled={!storageFormData.name || !selectedKitchenId}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Storage Listing
                      </Button>
                      </div>
                    </div>
                  )}

                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-xs text-gray-600">
                      💡 <strong>Tip:</strong> You can skip this step and add storage listings later from your dashboard. Adding at least one listing helps chefs understand your offerings.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentStep === 5 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-1">Equipment Listings (Optional)</h3>
                <p className="text-sm text-gray-600">
                  Add equipment that chefs can use or rent. This step is optional - you can skip and add listings later from your dashboard.
                </p>
              </div>
              
              <div className="bg-gradient-to-r from-rose-50 to-pink-50 border-2 border-rose-200/50 rounded-xl p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-rose-100 rounded-lg">
                    <Info className="h-5 w-5 text-[#F51042] flex-shrink-0" />
                  </div>
                  <div className="text-sm text-gray-700">
                    <p className="font-bold mb-2 text-gray-900">What are Equipment Listings?</p>
                    <p>Equipment listings let chefs know what equipment is available. You can offer equipment as included with bookings or as paid add-ons (rentals).</p>
                  </div>
                </div>
              </div>

              {kitchens.length === 0 ? (
                <div className="space-y-4">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-800 mb-3">
                      No kitchens found for this location. Create your first kitchen to get started.
                    </p>
                  </div>
                  
                  {showCreateKitchen ? (
                    <div className="border rounded-lg p-4 bg-gray-50">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Create Kitchen</h4>
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor="equipment-kitchen-name">Kitchen Name *</Label>
                          <Input
                            id="equipment-kitchen-name"
                            value={kitchenFormData.name}
                            onChange={(e) => setKitchenFormData({ ...kitchenFormData, name: e.target.value })}
                            placeholder="e.g., Main Kitchen"
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label htmlFor="equipment-kitchen-description">Description (Optional)</Label>
                          <Textarea
                            id="equipment-kitchen-description"
                            value={kitchenFormData.description}
                            onChange={(e) => setKitchenFormData({ ...kitchenFormData, description: e.target.value })}
                            placeholder="Describe your kitchen..."
                            rows={3}
                            className="mt-1"
                          />
                        </div>
                        <div className="border-t pt-3 mt-3">
                          <h5 className="text-sm font-semibold text-gray-900 mb-3">Pricing Information</h5>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <Label htmlFor="equipment-kitchen-hourly-rate">
                                Hourly Rate <span className="text-red-500">*</span>
                              </Label>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-sm text-gray-500">$</span>
                                <Input
                                  id="equipment-kitchen-hourly-rate"
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={kitchenFormData.hourlyRate}
                                  onChange={(e) => setKitchenFormData({ ...kitchenFormData, hourlyRate: e.target.value })}
                                  placeholder="0.00"
                                  className="flex-1"
                                />
                              </div>
                              <p className="text-xs text-gray-500 mt-1">Price per hour for kitchen bookings</p>
                            </div>
                            <div>
                              <Label htmlFor="equipment-kitchen-currency">Currency</Label>
                              <Select
                                value={kitchenFormData.currency}
                                onValueChange={(value) => setKitchenFormData({ ...kitchenFormData, currency: value })}
                              >
                                <SelectTrigger className="mt-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="CAD">CAD ($)</SelectItem>
                                  <SelectItem value="USD">USD ($)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="mt-3">
                            <Label htmlFor="equipment-kitchen-minimum-hours">Minimum Booking Hours</Label>
                            <Input
                              id="equipment-kitchen-minimum-hours"
                              type="number"
                              min="1"
                              value={kitchenFormData.minimumBookingHours}
                              onChange={(e) => setKitchenFormData({ ...kitchenFormData, minimumBookingHours: e.target.value })}
                              className="mt-1"
                            />
                            <p className="text-xs text-gray-500 mt-1">Minimum number of hours required for a booking</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={async () => {
                              if (!kitchenFormData.name.trim()) {
                                toast({
                                  title: "Missing Information",
                                  description: "Please enter a kitchen name",
                                  variant: "destructive",
                                });
                                return;
                              }
                              if (!kitchenFormData.hourlyRate || parseFloat(kitchenFormData.hourlyRate) <= 0) {
                                toast({
                                  title: "Missing Information",
                                  description: "Please enter a valid hourly rate",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setCreatingKitchen(true);
                              try {
                                await createKitchenMutation.mutateAsync(kitchenFormData);
                              } finally {
                                setCreatingKitchen(false);
                              }
                            }}
                            disabled={creatingKitchen || createKitchenMutation.isPending}
                          >
                            {creatingKitchen || createKitchenMutation.isPending ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Creating...
                              </>
                            ) : (
                              <>
                                <Plus className="h-4 w-4 mr-2" />
                                Create Kitchen
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowCreateKitchen(false);
                              setKitchenFormData({ name: '', description: '', hourlyRate: '', currency: 'CAD', minimumBookingHours: '1' });
                            }}
                            disabled={creatingKitchen || createKitchenMutation.isPending}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Button
                      onClick={() => setShowCreateKitchen(true)}
                      className="w-full"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Create Your First Kitchen
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="equipment-kitchen-select">Select Kitchen</Label>
                    <Select
                      value={selectedKitchenId?.toString() || ""}
                      onValueChange={(value) => setSelectedKitchenId(parseInt(value))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select a kitchen" />
                      </SelectTrigger>
                      <SelectContent>
                        {kitchens.map((kitchen) => (
                          <SelectItem key={kitchen.id} value={kitchen.id.toString()}>
                            {kitchen.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {!selectedKitchenId ? (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <p className="text-sm text-yellow-800">
                        Please select a kitchen to view or add equipment listings.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Show existing equipment listings */}
                      {isLoadingEquipment ? (
                        <div className="flex items-center justify-center p-4">
                          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                          <span className="ml-2 text-sm text-gray-600">Loading existing equipment listings...</span>
                        </div>
                      ) : existingEquipmentListings.length > 0 ? (
                        <div className="border rounded-lg p-4 bg-green-50 border-green-200">
                          <div className="flex items-center gap-2 mb-3">
                            <CheckCircle className="h-5 w-5 text-green-600" />
                            <h4 className="font-semibold text-gray-900">
                              Existing Equipment Listings ({existingEquipmentListings.length})
                            </h4>
                          </div>
                          <div className="space-y-2">
                            {existingEquipmentListings.map((listing) => (
                              <div key={listing.id} className="bg-white rounded-lg p-3 border border-green-200">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <p className="font-medium text-gray-900">{listing.name}</p>
                                    <p className="text-xs text-gray-600 capitalize mt-1">
                                      {listing.category || listing.equipmentType}
                                      {listing.availabilityType === 'rental' && listing.sessionRate 
                                        ? ` • $${parseFloat(listing.sessionRate).toFixed(2)}/session`
                                        : listing.availabilityType === 'included' 
                                          ? ' • Included'
                                          : ''}
                                    </p>
                                    {listing.description && (
                                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{listing.description}</p>
                                    )}
                                  </div>
                                  <div className="ml-2 flex flex-col gap-1">
                                    {listing.isActive ? (
                                      <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Active</span>
                                    ) : (
                                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">Inactive</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-xs text-gray-600 mt-3">
                            💡 You can add more equipment listings below or manage them from your dashboard.
                          </p>
                        </div>
                      ) : null}

                      <div className="space-y-3 border rounded-lg p-4 bg-gray-50">
                        <div>
                          <Label htmlFor="equipment-category">Category</Label>
                        <Select
                          value={equipmentFormData.category}
                          onValueChange={(value: 'food-prep' | 'cooking' | 'refrigeration' | 'cleaning' | 'specialty') =>
                            setEquipmentFormData({ ...equipmentFormData, category: value })
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="food-prep">Food Prep</SelectItem>
                            <SelectItem value="cooking">Cooking</SelectItem>
                            <SelectItem value="refrigeration">Refrigeration</SelectItem>
                            <SelectItem value="cleaning">Cleaning</SelectItem>
                            <SelectItem value="specialty">Specialty</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="equipment-availability">Availability Type</Label>
                        <Select
                          value={equipmentFormData.availabilityType}
                          onValueChange={(value: 'included' | 'rental') =>
                            setEquipmentFormData({ ...equipmentFormData, availabilityType: value })
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="included">Included (Free with kitchen booking)</SelectItem>
                            <SelectItem value="rental">Rental (Paid add-on)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="equipment-name">Equipment Name *</Label>
                        <Input
                          id="equipment-name"
                          value={equipmentFormData.name}
                          onChange={(e) => setEquipmentFormData({ ...equipmentFormData, name: e.target.value })}
                          placeholder="e.g., Commercial Oven"
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <Label htmlFor="equipment-description">Description</Label>
                        <Textarea
                          id="equipment-description"
                          value={equipmentFormData.description}
                          onChange={(e) => setEquipmentFormData({ ...equipmentFormData, description: e.target.value })}
                          placeholder="Describe the equipment..."
                          rows={3}
                          className="mt-1"
                        />
                      </div>

                      {equipmentFormData.availabilityType === 'rental' && (
                        <div>
                          <Label htmlFor="equipment-rate">Session Rate (CAD) *</Label>
                          <Input
                            id="equipment-rate"
                            type="number"
                            min="0"
                            step="0.01"
                            value={equipmentFormData.sessionRate}
                            onChange={(e) => setEquipmentFormData({ ...equipmentFormData, sessionRate: parseFloat(e.target.value) || 0 })}
                            placeholder="0.00"
                            className="mt-1"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            Flat rate charged once per kitchen booking session
                          </p>
                        </div>
                      )}

                      <div>
                        <Label htmlFor="equipment-condition">Condition</Label>
                        <Select
                          value={equipmentFormData.condition}
                          onValueChange={(value: 'excellent' | 'good' | 'fair' | 'needs_repair') =>
                            setEquipmentFormData({ ...equipmentFormData, condition: value })
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="excellent">Excellent</SelectItem>
                            <SelectItem value="good">Good</SelectItem>
                            <SelectItem value="fair">Fair</SelectItem>
                            <SelectItem value="needs_repair">Needs Repair</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <Button
                        onClick={async () => {
                          if (!equipmentFormData.name || !selectedKitchenId) {
                            toast({
                              title: "Missing Information",
                              description: "Please fill in equipment name",
                              variant: "destructive",
                            });
                            return;
                          }
                          if (equipmentFormData.availabilityType === 'rental' && equipmentFormData.sessionRate <= 0) {
                            toast({
                              title: "Missing Information",
                              description: "Please enter a session rate for rental equipment",
                              variant: "destructive",
                            });
                            return;
                          }
                          try {
                            // Get Firebase token for authentication
                            const currentFirebaseUser = auth.currentUser;
                            if (!currentFirebaseUser) {
                              throw new Error("Firebase user not available");
                            }
                            
                            const token = await currentFirebaseUser.getIdToken();
                            const response = await fetch(`/api/manager/equipment-listings`, {
                              method: "POST",
                              headers: { 
                                'Authorization': `Bearer ${token}`,
                                "Content-Type": "application/json" 
                              },
                              credentials: "include",
                              body: JSON.stringify({
                                kitchenId: selectedKitchenId,
                                name: equipmentFormData.name,
                                equipmentType: equipmentFormData.category, // API expects equipmentType
                                category: equipmentFormData.category,
                                description: equipmentFormData.description || null,
                                condition: equipmentFormData.condition,
                                availabilityType: equipmentFormData.availabilityType,
                                sessionRate: equipmentFormData.availabilityType === 'rental' ? equipmentFormData.sessionRate : 0, // API expects dollars, will convert to cents
                                photos: [],
                                currency: "CAD",
                                pricingModel: equipmentFormData.availabilityType === 'rental' ? 'hourly' : null,
                                isActive: true,
                                status: 'draft',
                              }),
                            });
                            if (!response.ok) {
                              const error = await response.json();
                              throw new Error(error.error || "Failed to create equipment listing");
                            }
                            toast({
                              title: "Equipment Listing Created",
                              description: "You can add more listings from your dashboard later.",
                            });
                            // Reload existing equipment listings
                            const refreshResponse = await fetch(`/api/manager/kitchens/${selectedKitchenId}/equipment-listings`, {
                              credentials: "include",
                              headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json',
                              },
                            });
                            if (refreshResponse.ok) {
                              const refreshData = await refreshResponse.json();
                              setExistingEquipmentListings(Array.isArray(refreshData) ? refreshData : []);
                            }
                            // Reset form
                            setEquipmentFormData({
                              category: 'cooking',
                              name: '',
                              description: '',
                              condition: 'good',
                              availabilityType: 'rental',
                              sessionRate: 0,
                            });
                          } catch (error: any) {
                            toast({
                              title: "Error",
                              description: error.message || "Failed to create equipment listing",
                              variant: "destructive",
                            });
                          }
                        }}
                        className="w-full"
                        disabled={!equipmentFormData.name || !selectedKitchenId || (equipmentFormData.availabilityType === 'rental' && equipmentFormData.sessionRate <= 0)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Equipment Listing
                      </Button>
                      </div>
                    </div>
                  )}

                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-xs text-gray-600">
                      💡 <strong>Tip:</strong> You can skip this step and add equipment listings later from your dashboard. Adding at least one listing helps chefs understand your offerings.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentStep === 6 && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
                <h3 className="text-xl font-semibold mb-2">You're All Set!</h3>
                <p className="text-sm text-gray-600">
                  Your kitchen setup is complete. Here's what happens next:
                </p>
              </div>

              <div className="space-y-3">
                <div className={`border rounded-lg p-4 ${
                  selectedLocation?.kitchenLicenseStatus === "approved" 
                    ? "bg-green-50 border-green-200" 
                    : selectedLocation?.kitchenLicenseUrl
                    ? "bg-yellow-50 border-yellow-200"
                    : "bg-orange-50 border-orange-200"
                }`}>
                  <div className="flex items-start gap-3">
                    {selectedLocation?.kitchenLicenseStatus === "approved" ? (
                      <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-gray-900 mb-1">License Status</p>
                      {selectedLocation?.kitchenLicenseStatus === "approved" ? (
                        <p className="text-sm text-green-700">
                          ✓ Your license is approved! Bookings are now active and chefs can start booking your kitchen.
                        </p>
                      ) : selectedLocation?.kitchenLicenseUrl ? (
                        <p className="text-sm text-yellow-700">
                          ⏳ Your license is pending admin approval. Bookings will be activated once approved. 
                          You'll receive an email notification when your license is reviewed.
                        </p>
                      ) : (
                        <p className="text-sm text-orange-700">
                          ⚠️ Upload your kitchen license to activate bookings. You can do this from your dashboard settings.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Setup Summary</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-gray-700">Location information saved</span>
                    </div>
                    {selectedLocation?.kitchenLicenseUrl ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-gray-700">License uploaded</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-yellow-600" />
                        <span className="text-gray-600">License not uploaded (can add later)</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-gray-700">Notification preferences configured</span>
                    </div>
                    {kitchens.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <span className="text-gray-700">{kitchens.length} kitchen{kitchens.length > 1 ? 's' : ''} created</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-yellow-600" />
                        <span className="text-gray-600">No kitchen created yet (can add later)</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Info className="h-4 w-4 text-gray-400" />
                      <span className="text-gray-500">Storage & equipment listings (optional - can add later)</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="bg-gradient-to-r from-rose-50 to-pink-50 border-2 border-rose-200/50 rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 mb-2">What's Next?</h4>
                <p className="text-xs text-gray-700 mb-3">
                  You can manage everything from your dashboard:
                </p>
                <ul className="text-xs text-gray-700 space-y-1.5 list-disc list-inside">
                  <li>Add more kitchens, storage, and equipment listings with photos</li>
                  <li>Manage bookings, availability, and pricing</li>
                  <li>Update your location settings and license</li>
                  <li>View chef profiles and manage access</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="bg-gradient-to-br from-[#FFE8DD]/30 to-white border-t border-rose-200/50 px-6 py-4 rounded-b-lg">
          <div className="flex items-center justify-between">
            {currentStep === 6 ? (
              <Button
                variant="outline"
                onClick={() => setIsOpen(false)}
                disabled={completeOnboardingMutation.isPending}
                className="border-gray-300 hover:bg-gray-100"
              >
                Close
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={handleSkip}
                disabled={completeOnboardingMutation.isPending}
                className="border-gray-300 hover:bg-gray-100"
              >
                Skip for Now
              </Button>
            )}
            <div className="flex gap-3">
              {(() => {
                const currentVisibleIndex = getVisibleIndex(currentStep);
                const hasPreviousStep = currentVisibleIndex > 0;
                return hasPreviousStep && (
                  <Button variant="outline" onClick={handleBack} className="border-gray-300 hover:bg-gray-100">
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Back
                  </Button>
                );
              })()}
              <Button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (currentStep === 6) {
                    handleCompleteSetup();
                  } else {
                    handleNext();
                  }
                }}
                disabled={
                  updateLocationMutation.isPending ||
                  uploadLicenseMutation.isPending ||
                  completeOnboardingMutation.isPending
                }
                className="bg-gradient-to-r from-[#F51042] to-rose-500 hover:from-rose-500 hover:to-[#F51042] text-white shadow-lg shadow-[#F51042]/30 hover:shadow-xl hover:shadow-[#F51042]/40 transition-all duration-200 px-6"
              >
                {(() => {
                  const currentVisibleIndex = getVisibleIndex(currentStep);
                  const finalVisibleIndex = visibleSteps.length - 1;
                  // Step 6 is always the final step, regardless of visibleSteps
                  const isFinalStep = currentStep === 6 || currentVisibleIndex === finalVisibleIndex;
                  
                  if (isFinalStep) {
                    return (
                      <>
                        {completeOnboardingMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Completing...
                          </>
                        ) : (
                          <>
                            Complete Setup
                            <CheckCircle className="h-4 w-4 ml-2" />
                          </>
                        )}
                      </>
                    );
                  } else {
                    return (
                      <>
                        {currentStep === 0 && !hasExistingLocation ? "Get Started" : "Next"}
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </>
                    );
                  }
                })()}
              </Button>
            </div>
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

