
import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { OnboardingStep, Location, Kitchen, StorageListing, EquipmentListing } from "./types";
import { optionalPhoneNumberSchema } from "@shared/phone-validation";

// Define the steps structure
import { 
  Building2, 
  Settings, 
  Users, 
  CreditCard, 
  Package, 
  Wrench, 
  Sparkles 
} from "lucide-react";

export const STEPS: OnboardingStep[] = [
  {
    id: 0,
    title: "Welcome",
    description: "Learn about the setup process",
    icon: <Sparkles className="h-6 w-6" />,
  },
  {
    id: 1,
    title: "Location & Contact",
    description: "Set up your location details, notification preferences, and kitchen license",
    icon: <Building2 className="h-6 w-6" />,
  },
  {
    id: 2,
    title: "Create Kitchen",
    description: "Set up your first kitchen space",
    icon: <Settings className="h-6 w-6" />,
  },
  {
    id: 3,
    title: "Application Requirements",
    description: "Configure which fields are required when chefs apply to your kitchens",
    icon: <Users className="h-6 w-6" />,
  },
  {
    id: 4,
    title: "Payment Setup",
    description: "Connect Stripe to receive payments for bookings",
    icon: <CreditCard className="h-6 w-6" />,
  },
  {
    id: 5,
    title: "Storage Listings",
    description: "Add storage options (optional - can add later)",
    icon: <Package className="h-6 w-6" />,
  },
  {
    id: 6,
    title: "Equipment Listings",
    description: "Add equipment options (optional - can add later)",
    icon: <Wrench className="h-6 w-6" />,
  },
];

interface ManagerOnboardingContextType {
  // State
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  visibleSteps: OnboardingStep[];
  completedSteps: Record<string, boolean>;
  hasExistingLocation: boolean;
  
  // Data
  locations: Location[];
  selectedLocationId: number | null;
  setSelectedLocationId: (id: number | null) => void;
  selectedLocation?: Location;
  
  kitchens: Kitchen[];
  selectedKitchenId: number | null;
  setSelectedKitchenId: (id: number | null) => void;
  isLoadingLocations: boolean;
  
  // Forms State
  locationForm: {
    name: string;
    address: string;
    notificationEmail: string;
    notificationPhone: string;
    setName: (val: string) => void;
    setAddress: (val: string) => void;
    setNotificationEmail: (val: string) => void;
    setNotificationPhone: (val: string) => void;
  };
  
  licenseForm: {
    file: File | null;
    setFile: (file: File | null) => void;
    expiryDate: string;
    setExpiryDate: (val: string) => void;
    isUploading: boolean;
  };

  kitchenForm: {
    data: {
      name: string;
      description: string;
      hourlyRate: string;
      currency: string;
      minimumBookingHours: string;
    };
    setData: (data: any) => void;
    showCreate: boolean;
    setShowCreate: (show: boolean) => void;
    isCreating: boolean;
  };
  
  storageForm: {
    listings: StorageListing[];
    isLoading: boolean;
  };
  
  equipmentForm: {
    listings: EquipmentListing[];
    isLoading: boolean;
  };

  // Actions
  handleNext: () => Promise<void>;
  handleBack: () => void;
  handleSkip: () => Promise<void>;
  updateLocation: () => Promise<void>;
  createKitchen: () => Promise<void>;
  uploadLicense: () => Promise<string | null>;
}

const ManagerOnboardingContext = createContext<ManagerOnboardingContextType | undefined>(undefined);

export function ManagerOnboardingProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, isLoadingLocations } = useManagerDashboard();
  const { user: firebaseUser } = useFirebaseAuth();

  // Dialog State
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  
  // Data State
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(null);
  
  // Location Form State
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [notificationPhone, setNotificationPhone] = useState("");
  
  // License Form State
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licenseExpiryDate, setLicenseExpiryDate] = useState("");
  const [uploadingLicense, setUploadingLicense] = useState(false);

  // Kitchen Form State
  const [showCreateKitchen, setShowCreateKitchen] = useState(false);
  const [creatingKitchen, setCreatingKitchen] = useState(false);
  const [kitchenFormData, setKitchenFormData] = useState({
    name: '',
    description: '',
    hourlyRate: '',
    currency: 'CAD',
    minimumBookingHours: '1',
  });

  // Listings State
  const [existingStorageListings, setExistingStorageListings] = useState<StorageListing[]>([]);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [existingEquipmentListings, setExistingEquipmentListings] = useState<EquipmentListing[]>([]);
  const [isLoadingEquipment, setIsLoadingEquipment] = useState(false);

  // Derived State
  const hasExistingLocation = !isLoadingLocations && locations.length > 0;
  const selectedLocation = locations.find((loc) => loc.id === selectedLocationId) as Location | undefined;

  const visibleSteps = hasExistingLocation
    ? STEPS.filter(step => step.id >= 2)
    : STEPS;

  // --- Auth & Profile Queries ---
  const { data: firebaseUserData } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      const token = await auth.currentUser?.getIdToken();
      if (!token) return null;
      const response = await fetch("/api/user/profile", {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!firebaseUser,
  });

  const userData = firebaseUserData;
  const isManager = userData?.role === "manager";
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>(userData?.manager_onboarding_steps_completed || {});

  // --- Effects ---

  // Auto-select location
  useEffect(() => {
    if (!isLoadingLocations && hasExistingLocation && !selectedLocationId && locations.length > 0) {
      const loc = locations[0];
      setSelectedLocationId(loc.id);
      setLocationName(loc.name || "");
      setLocationAddress(loc.address || "");
      setNotificationEmail(loc.notificationEmail || "");
      setNotificationPhone(loc.notificationPhone || "");

      if (currentStep < 2) setCurrentStep(2);
    }
  }, [isLoadingLocations, hasExistingLocation, locations, selectedLocationId, currentStep]);

  // Load kitchens when location selected
  useEffect(() => {
    if (selectedLocationId) {
      const loadKitchens = async () => {
        try {
          const token = await auth.currentUser?.getIdToken();
          if (!token) return;
          const response = await fetch(`/api/manager/kitchens/${selectedLocationId}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (response.ok) {
            const data = await response.json();
            const kData = Array.isArray(data) ? data : [];
            setKitchens(kData);
            if (kData.length === 1 && !selectedKitchenId) setSelectedKitchenId(kData[0].id);
            if (kData.length === 0) setShowCreateKitchen(true);
          }
        } catch (e) {
          console.error("Error loading kitchens", e);
        }
      };
      loadKitchens();
    }
  }, [selectedLocationId]);

  // Load listings based on step
  useEffect(() => {
    const loadListings = async () => {
      if (!selectedKitchenId) return;
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      if (currentStep === 5) { // Storage
        setIsLoadingStorage(true);
        try {
          const res = await fetch(`/api/manager/kitchens/${selectedKitchenId}/storage-listings`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) setExistingStorageListings(await res.json());
        } finally { setIsLoadingStorage(false); }
      } else if (currentStep === 6) { // Equipment
        setIsLoadingEquipment(true);
        try {
          const res = await fetch(`/api/manager/kitchens/${selectedKitchenId}/equipment-listings`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) setExistingEquipmentListings(await res.json());
        } finally { setIsLoadingEquipment(false); }
      }
    };
    loadListings();
  }, [selectedKitchenId, currentStep]);


  // --- Actions & API Calls ---

  const trackStepCompletion = async (stepId: number) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch("/api/manager/onboarding/step", {
        method: "POST",
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ stepId, locationId: selectedLocationId || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setCompletedSteps(data.stepsCompleted || {});
        queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const uploadLicense = async (): Promise<string | null> => {
    if (!licenseFile) return null;
    setUploadingLicense(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const formData = new FormData();
      formData.append("file", licenseFile);
      const res = await fetch("/api/upload-file", {
        method: "POST",
        headers: { 'Authorization': `Bearer ${token}` }, // Form data, don't set Content-Type
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      return data.url;
    } finally {
      setUploadingLicense(false);
    }
  };

  const updateLocation = async () => {
    if (!locationName || !locationAddress) {
       toast({ title: "Error", description: "Missing location details", variant: "destructive" });
       return;
    }

    try {
      let licenseUrl = null;
      if (licenseFile) {
        if (!licenseExpiryDate) {
          toast({ title: "Error", description: "Missing license expiry", variant: "destructive" });
          return;
        }
        licenseUrl = await uploadLicense();
      }

      const token = await auth.currentUser?.getIdToken();
      
      // Validation (simplified)
      let phone = notificationPhone; 
      if (phone) {
         const p = optionalPhoneNumberSchema.safeParse(phone);
         if (!p.success) throw new Error("Invalid phone");
         phone = p.data || "";
      }

      const body: any = {
        name: locationName,
        address: locationAddress,
        notificationEmail,
        notificationPhone: phone
      };
      // Add license info
      if (licenseUrl) {
        body.kitchenLicenseUrl = licenseUrl;
        body.kitchenLicenseStatus = "pending";
        body.kitchenLicenseExpiry = licenseExpiryDate;
      } else if (licenseExpiryDate && !licenseFile) {
        body.kitchenLicenseExpiry = licenseExpiryDate;
      }

      const endpoint = (!selectedLocationId || locations.length === 0) 
        ? `/api/manager/locations`
        : `/api/manager/locations/${selectedLocationId}`;
      const method = (!selectedLocationId || locations.length === 0) ? "POST" : "PUT";

      const res = await fetch(endpoint, {
        method,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (!res.ok) throw new Error("Failed to save location");
      const data = await res.json();
      
      if (method === "POST") setSelectedLocationId(data.id);
      
      queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
      toast({ title: "Success", description: "Location saved" });
      await trackStepCompletion(1);
      setCurrentStep(2);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const createKitchen = async () => {
    if (!selectedLocationId) return;
    setCreatingKitchen(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/manager/kitchens`, {
        method: "POST",
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: selectedLocationId,
          name: kitchenFormData.name,
          description: kitchenFormData.description
        })
      });
      if (!res.ok) throw new Error("Failed to create kitchen");
      const newKitchen = await res.json();
      
      // Set pricing
      if (kitchenFormData.hourlyRate) {
        await fetch(`/api/manager/kitchens/${newKitchen.id}/pricing`, {
          method: "PUT",
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hourlyRate: Math.round(parseFloat(kitchenFormData.hourlyRate) * 100),
            currency: kitchenFormData.currency,
            minimumBookingHours: parseInt(kitchenFormData.minimumBookingHours) || 1
          })
        });
      }

      setKitchens([...kitchens, newKitchen]);
      setSelectedKitchenId(newKitchen.id);
      setShowCreateKitchen(false);
      setKitchenFormData({ name: '', description: '', hourlyRate: '', currency: 'CAD', minimumBookingHours: '1' });
      await trackStepCompletion(2);
      toast({ title: "Success", description: "Kitchen created" });
      setCurrentStep(3);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setCreatingKitchen(false);
    }
  };

  const handleNext = async () => {
    const visibleIndex = visibleSteps.findIndex(s => s.id === currentStep);
    
    // Logic mapping
    if (currentStep === 0) {
      await trackStepCompletion(0);
      setCurrentStep(1);
    } else if (currentStep === 1) {
      await updateLocation(); // This handles step increment on success
    } else if (currentStep === 2) {
      if (kitchens.length > 0 || selectedKitchenId) {
        await trackStepCompletion(2);
        setCurrentStep(3);
      } else if (!showCreateKitchen) {
         toast({ title: "Kitchen Required", description: "Please create a kitchen", variant: "destructive" });
      } else {
        // Form is showing, user needs to submit. Button inside CreateKitchenStep handles submission.
        // If we want "Next" to trigger form submission, we'd need a ref. 
        // For now, let's assume the Create button on the step moves us forward (which it does in createKitchen function above).
      }
    } else {
      // Generic Next for steps 3,4,5,6
      await trackStepCompletion(currentStep);
      
      if (visibleIndex < visibleSteps.length - 1) {
         const nextStepId = visibleSteps[visibleIndex + 1].id;
         setCurrentStep(nextStepId);
      } else {
        // Complete
        await handleSkip(); // Logic to finish
      }
    }
  };

  const handleBack = () => {
    const visibleIndex = visibleSteps.findIndex(s => s.id === currentStep);
    if (visibleIndex > 0) {
       setCurrentStep(visibleSteps[visibleIndex - 1].id);
    } else if (currentStep > 0 && !hasExistingLocation) {
       setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = async () => {
    // Complete onboarding logic
    try {
      const token = await auth.currentUser?.getIdToken();
      await fetch("/api/manager/complete-onboarding", {
         method: "POST",
         headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
         body: JSON.stringify({ skipped: false }) // OR true if actually skipping
      });
      setIsOpen(false);
      toast({ title: "Onboarding Completed", description: "You are all set!" });
    } catch (e) {
      console.error(e);
    }
  };

  const value = {
    isOpen, setIsOpen,
    currentStep, setCurrentStep,
    visibleSteps, completedSteps,
    hasExistingLocation,
    locations, selectedLocationId, setSelectedLocationId, selectedLocation,
    kitchens, selectedKitchenId, setSelectedKitchenId, isLoadingLocations,
    
    locationForm: {
      name: locationName, setName: setLocationName,
      address: locationAddress, setAddress: setLocationAddress,
      notificationEmail, setNotificationEmail,
      notificationPhone, setNotificationPhone
    },
    licenseForm: {
      file: licenseFile, setFile: setLicenseFile,
      expiryDate: licenseExpiryDate, setExpiryDate: setLicenseExpiryDate,
      isUploading: uploadingLicense
    },
    kitchenForm: {
      data: kitchenFormData, setData: setKitchenFormData,
      showCreate: showCreateKitchen, setShowCreate: setShowCreateKitchen,
      isCreating: creatingKitchen
    },
    storageForm: { listings: existingStorageListings, isLoading: isLoadingStorage },
    equipmentForm: { listings: existingEquipmentListings, isLoading: isLoadingEquipment },
    
    handleNext, handleBack, handleSkip,
    updateLocation, createKitchen, uploadLicense
  };

  return (
    <ManagerOnboardingContext.Provider value={value}>
      {children}
    </ManagerOnboardingContext.Provider>
  );
}

export const useManagerOnboarding = () => {
  const context = useContext(ManagerOnboardingContext);
  if (!context) throw new Error("useManagerOnboarding must be used within Provider");
  return context;
};
