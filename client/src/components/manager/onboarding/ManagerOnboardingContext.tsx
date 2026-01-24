import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { Location, Kitchen, StorageListing, EquipmentListing } from "./types";
import { optionalPhoneNumberSchema } from "@shared/phone-validation";
import { useOnboarding } from '@onboardjs/react';
import { steps } from "@/config/onboarding-steps";

// Step ID mapping for backwards compatibility with legacy numeric format in database
const STEP_ID_MAP: Record<string, number> = {
  'welcome': 0,
  'location': 1,
  'create-kitchen': 2,
  'application-requirements': 3,
  'payment-setup': 4,
  'availability': 5,
  'storage-listings': 6,
  'equipment-listings': 7,
  'completion-summary': 8
};

const NUMERIC_TO_STRING_MAP: Record<number, string> = Object.entries(STEP_ID_MAP)
  .reduce((acc, [str, num]) => ({ ...acc, [num]: str }), {});


// We re-export the step interface from types or core if needed, 
// but for this context we mainly need the logic.

interface ManagerOnboardingContextType {
  // OnboardJS State & Actions
  currentStepData: any; // The payload of the current step
  currentStepIndex: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  isOnboardingCompleted: boolean;
  hasExistingLocation: boolean;
  handleNext: () => Promise<void>;
  handleBack: () => void;
  handleSkip: () => Promise<void>;

  // Legacy/Derived State
  currentStep: number;
  setCurrentStep: (step: number) => void;
  visibleSteps: any[];
  completedSteps: Record<string, boolean>;

  // Dialog State (Controlled by parent or local)
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;

  // Domain Data
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
  updateLocation: () => Promise<void>;
  createKitchen: () => Promise<void>;
  uploadLicense: () => Promise<string | null>;
  startNewLocation: () => void;
}

const ManagerOnboardingContext = createContext<ManagerOnboardingContextType | undefined>(undefined);

// Internal component to consume OnboardJS hook and provide the blended context
function ManagerOnboardingLogic({ children, isOpen, setIsOpen }: { children: ReactNode, isOpen: boolean, setIsOpen: (val: boolean) => void }) {
  const {
    currentStep,
    isCompleted,
    next,
    previous,
    skip: onboardSkip,
    state,
    engine
  } = useOnboarding();

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { locations, isLoadingLocations } = useManagerDashboard();
  const { user: firebaseUser } = useFirebaseAuth();

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

  // Multi-location State
  const [isAddingLocation, setIsAddingLocation] = useState(false);

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
  const isStripeOnboardingComplete = userData?.stripe_connect_onboarding_status === 'complete' || userData?.stripeConnectOnboardingStatus === 'complete';
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>({});

  // Normalize legacy numeric step keys to string format for UI consumption
  useEffect(() => {
    if (userData?.manager_onboarding_steps_completed) {
      const rawSteps = userData.manager_onboarding_steps_completed as Record<string, boolean>;
      const normalized: Record<string, boolean> = {};

      for (const [key, value] of Object.entries(rawSteps)) {
        // Handle legacy format: step_0, step_1, step_0_location_28
        const match = key.match(/^step_(\d+)(?:_location_\d+)?$/);
        if (match) {
          const numericId = parseInt(match[1]);
          const stringId = NUMERIC_TO_STRING_MAP[numericId];
          if (stringId && !normalized[stringId]) {
            normalized[stringId] = Boolean(value);
          }
        } else {
          // Already string format (new)
          normalized[key] = Boolean(value);
        }
      }
      setCompletedSteps(normalized);
    }
  }, [userData]);

  // Derived State
  const hasExistingLocation = !isLoadingLocations && locations.length > 0;
  const selectedLocation = locations.find((loc) => loc.id === selectedLocationId) as Location | undefined;

  // Build visible steps: show all steps, but skip welcome if returning user with location
  let visibleStepsFiltered = [...steps];

  // Skip welcome screen for returning managers with existing locations (not adding new)
  if (hasExistingLocation && !isAddingLocation) {
    visibleStepsFiltered = visibleStepsFiltered.filter(step => step.id !== 'welcome');
  }

  // Skip payment setup if already completed globally
  if (isStripeOnboardingComplete) {
    visibleStepsFiltered = visibleStepsFiltered.filter(step => step.id !== 'payment-setup');
  }

  // CRITICAL FIX: Compute the correct index in the visible steps array
  // OnboardJS currentStep is index in ORIGINAL steps array, we need index in FILTERED array
  const currentStepId = currentStep?.id;
  const currentVisibleStepIndex = visibleStepsFiltered.findIndex(step => step.id === currentStepId);

  // AUTO-SKIP: If OnboardJS navigates to a step that should be hidden, skip it
  // Only skip steps that are EXPLICITLY filtered out, not due to timing issues
  useEffect(() => {
    if (!currentStepId || isCompleted) return;

    // Define which steps CAN be skipped based on current conditions
    const stepsToSkip: string[] = [];
    if (isStripeOnboardingComplete) stepsToSkip.push('payment-setup');
    if (hasExistingLocation && !isAddingLocation) stepsToSkip.push('welcome');

    // Only auto-skip if current step is in the explicit skip list
    const stepIdStr = String(currentStepId);
    if (stepsToSkip.includes(stepIdStr)) {
      console.log(`[Onboarding] Auto-skipping step: ${stepIdStr}`);
      next();
    }
  }, [currentStepId, isCompleted, isStripeOnboardingComplete, hasExistingLocation, isAddingLocation, next]);

  // Auto-open logic: show onboarding if manager hasn't completed it and has no locations
  useEffect(() => {
    if (userData && !isLoadingLocations) {
      const isManagerOnboardingComplete = userData.manager_onboarding_completed;
      // Only auto-open for managers who haven't completed onboarding AND have no locations
      if (!isManagerOnboardingComplete && locations.length === 0) {
        setIsOpen(true);
      }
    }
  }, [userData, isLoadingLocations, locations, setIsOpen]);

  // Listen for manual trigger from Help Center or other parts of the app
  useEffect(() => {
    const handleOpenRequest = () => setIsOpen(true);
    const handleNewLocationRequest = () => value.startNewLocation();

    window.addEventListener('open-onboarding-from-help', handleOpenRequest);
    window.addEventListener('start-new-location', handleNewLocationRequest);

    return () => {
      window.removeEventListener('open-onboarding-from-help', handleOpenRequest);
      window.removeEventListener('start-new-location', handleNewLocationRequest);
    }
  }, [setIsOpen]);

  // Reset multi-location state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setIsAddingLocation(false);
    }
  }, [isOpen]);


  // Auto-select location
  useEffect(() => {
    if (!isLoadingLocations && hasExistingLocation && !selectedLocationId && locations.length > 0) {
      const loc = locations[0];
      setSelectedLocationId(loc.id);
      setLocationName(loc.name || "");
      setLocationAddress(loc.address || "");
      setNotificationEmail(loc.notificationEmail || "");
      setNotificationPhone(loc.notificationPhone || "");

      // If we have a location, we might want to fast-forward the OnboardJS state if it's on step 0 or 1.
      // However, OnboardJS doesn't expose a direct "jump to index" easily without loop, 
      // or we rely on the persistence of OnboardJS itself.
    }
  }, [isLoadingLocations, hasExistingLocation, locations, selectedLocationId]);

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

      const stepId = currentStep?.id;

      if (stepId === 'storage-listings') {
        setIsLoadingStorage(true);
        try {
          const res = await fetch(`/api/manager/kitchens/${selectedKitchenId}/storage-listings`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) setExistingStorageListings(await res.json());
        } finally { setIsLoadingStorage(false); }
      } else if (stepId === 'equipment-listings') {
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


  // Track step completion - saves to backend and optimistically updates local state
  const trackStepCompletion = useCallback(async (stepId: number | string) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      // Normalize to string ID
      const stringId = typeof stepId === 'number' ? NUMERIC_TO_STRING_MAP[stepId] : stepId;
      if (!stringId) return;

      // Optimistically update local state for immediate UI feedback
      setCompletedSteps(prev => ({ ...prev, [stringId]: true }));

      const res = await fetch("/api/manager/onboarding/step", {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ stepId: stringId, locationId: selectedLocationId || undefined }),
      });

      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      }
    } catch (e) {
      console.error('[Onboarding] Failed to track step completion:', e);
    }
  }, [selectedLocationId, queryClient]);

  const uploadLicense = async (): Promise<string | null> => {
    if (!licenseFile) return null;
    setUploadingLicense(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const formData = new FormData();
      formData.append("file", licenseFile);
      const res = await fetch("/api/upload-file", {
        method: "POST",
        headers: { 'Authorization': `Bearer ${token}` },
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

      await trackStepCompletion(currentStep?.id || 'location');
      next(); // Move to next step via OnboardJS

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

      await trackStepCompletion(currentStep?.id || 'create-kitchen');
      toast({ title: "Success", description: "Kitchen created" });
      next();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setCreatingKitchen(false);
    }
  };

  // --- Event Listeners ---
  // --- Event Listeners ---
  useEffect(() => {
    if (!engine) return;

    // Listen for step completion to track progress and auto-save
    const unsubscribeStepCompleted = engine.addStepCompletedListener(async (event: any) => {
      const stepId = event.step?.id;
      console.log('✅ Step Completed:', stepId);

      // Persist step completion
      if (stepId) {
        await trackStepCompletion(stepId);
      }

      // NOTE: Location save is handled in handleNextAction, NOT here
      // to prevent double next() calls that skip steps
    });

    // Listen for flow completion
    const unsubscribeFlowCompleted = engine.addFlowCompletedListener(async () => {
      console.log('🎉 Flow Complete');
      await handleSkipAction();
    });

    return () => {
      unsubscribeStepCompleted?.();
      unsubscribeFlowCompleted?.();
    }
  }, [engine, locationName, locationAddress]); // Dependencies important for closures

  // --- Actions ---

  // Legacy handleNext kept for manual triggers if needed, but Engine handles flow now.
  // We can just proxy to next() and let the event listener handle the side effects.
  const handleNextAction = async () => {
    // Specialized logic for form validation before moving next
    const stepId = currentStep?.id;

    if (stepId === 'location') {
      await updateLocation(); // This saves AND moves next inside updateLocation currently
      // refactor updateLocation to NOT move next, but return success?
      // For now, let's keep the existing flow but ensure we don't double-fire updates.
      return;
    }

    if (stepId === 'create-kitchen' && showCreateKitchen) {
      // logic internal to createKitchen handles next()
      return;
    }

    // Default: let engine move
    next();
  };

  const handleSkipAction = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      await fetch("/api/manager/complete-onboarding", {
        method: "POST",
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipped: false })
      });
      setIsOpen(false);
      onboardSkip();
      toast({ title: "Flow Completed", description: "All set!" });
    } catch (e) {
      console.error(e);
    }
  };

  const value: ManagerOnboardingContextType = {
    // Adapter
    currentStepData: currentStep?.payload,
    currentStepIndex: currentVisibleStepIndex >= 0 ? currentVisibleStepIndex : 0,
    isFirstStep: currentVisibleStepIndex === 0,
    isLastStep: !!isCompleted,
    isOnboardingCompleted: !!isCompleted,
    hasExistingLocation,

    handleNext: handleNextAction,
    handleBack: previous,
    handleSkip: handleSkipAction,

    // Missing props:
    currentStep: (state as any)?.currentStep ?? 0,
    setCurrentStep: () => { }, // No-op
    visibleSteps: visibleStepsFiltered,
    completedSteps,

    isOpen, setIsOpen,

    // Domain
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

    updateLocation, createKitchen, uploadLicense,
    startNewLocation: () => {
      setSelectedLocationId(null);
      setLocationName("");
      setLocationAddress("");
      setNotificationEmail("");
      setNotificationPhone("");
      setLicenseFile(null);
      setLicenseExpiryDate("");
      setIsAddingLocation(true);
      setIsOpen(true);
      // Reset engine if possible, or manually navigate to 'location'?
      // Since 'location' is strictly Step 1, and 'welcome' is Step 0.
      // If we are adding location, we likely want to skip 'welcome' too?
      // For now, let's just open. If engine state persists, it might need reset.
    }
  };

  return (
    <ManagerOnboardingContext.Provider value={value}>
      {children}
    </ManagerOnboardingContext.Provider>
  );
}

// Provider moved to ManagerOnboardingProvider.tsx
export { ManagerOnboardingLogic }; // Export Logic for the Provider to use

export const useManagerOnboarding = () => {
  const context = useContext(ManagerOnboardingContext);
  if (!context) throw new Error("useManagerOnboarding must be used within Provider");
  return context;
};
