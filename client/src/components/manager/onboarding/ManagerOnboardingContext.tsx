import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { Location, Kitchen, StorageListing, EquipmentListing } from "./types";
import { optionalPhoneNumberSchema } from "@shared/phone-validation";
import { useOnboarding } from '@onboardjs/react';
import { steps } from "@/config/onboarding-steps";
import { Link, useLocation } from "wouter";

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
  goToStep: (stepId: string) => Promise<void>; // [NEW] Direct navigation

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
  isStripeOnboardingComplete?: boolean;
  hasAvailability?: boolean;
  refreshAvailability?: () => Promise<void>; // [NEW] Trigger refresh after saving availability
  hasRequirements?: boolean;
  refreshRequirements?: () => Promise<void>;

  // Forms State
  locationForm: {
    name: string;
    address: string;
    notificationEmail: string;
    notificationPhone: string;
    contactEmail: string;
    contactPhone: string;
    preferredContactMethod: "email" | "phone" | "both";
    setName: (val: string) => void;
    setAddress: (val: string) => void;
    setNotificationEmail: (val: string) => void;
    setNotificationPhone: (val: string) => void;
    setContactEmail: (val: string) => void;
    setContactPhone: (val: string) => void;
    setPreferredContactMethod: (val: "email" | "phone" | "both") => void;
  };

  licenseForm: {
    file: File | null;
    setFile: (file: File | null) => void;
    expiryDate: string;
    setExpiryDate: (val: string) => void;
    isUploading: boolean;
  };

  termsForm: {
    file: File | null;
    setFile: (file: File | null) => void;
    isUploading: boolean;
  };

  kitchenForm: {
    data: {
      name: string;
      description: string;
      hourlyRate: string;
      currency: string;
      minimumBookingHours: string;
      imageUrl: string;
    };
    setData: (data: any) => void;
    showCreate: boolean;
    setShowCreate: (show: boolean) => void;
    isCreating: boolean;
  };

  storageForm: {
    listings: StorageListing[];
    isLoading: boolean;
    refresh: () => Promise<void>;
  };

  equipmentForm: {
    listings: EquipmentListing[];
    isLoading: boolean;
    refresh: () => Promise<void>;
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
  const [isLoadingKitchens, setIsLoadingKitchens] = useState(false);
  const [kitchensLoaded, setKitchensLoaded] = useState(false); // [FIX]
  const [requirementsLoaded, setRequirementsLoaded] = useState(false); // [FIX]

  // Location Form State
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [notificationPhone, setNotificationPhone] = useState("");
  // Contact fields (separate from notification)
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [preferredContactMethod, setPreferredContactMethod] = useState<"email" | "phone" | "both">("email");

  // License Form State
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licenseExpiryDate, setLicenseExpiryDate] = useState("");
  const [uploadingLicense, setUploadingLicense] = useState(false);

  // Terms Form State
  const [termsFile, setTermsFile] = useState<File | null>(null);
  const [uploadingTerms, setUploadingTerms] = useState(false);

  // Kitchen Form State
  const [showCreateKitchen, setShowCreateKitchen] = useState(false);
  const [creatingKitchen, setCreatingKitchen] = useState(false);
  const [kitchenFormData, setKitchenFormData] = useState({
    name: '',
    description: '',
    hourlyRate: '',
    currency: 'CAD',
    minimumBookingHours: '1',
    imageUrl: '',
  });

  // Listings State
  const [existingStorageListings, setExistingStorageListings] = useState<StorageListing[]>([]);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [existingEquipmentListings, setExistingEquipmentListings] = useState<EquipmentListing[]>([]);
  const [isLoadingEquipment, setIsLoadingEquipment] = useState(false);

  // Availability State
  const [hasAvailability, setHasAvailability] = useState(false);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);

  // Requirements State [NEW] - tracks if location_requirements record exists
  const [hasRequirements, setHasRequirements] = useState(false);
  const [isLoadingRequirements, setIsLoadingRequirements] = useState(false);

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

  // Fetch Stripe Connect status from dedicated endpoint (queries Stripe API for real status)
  const { data: stripeConnectStatus } = useQuery({
    queryKey: ['/api/manager/stripe-connect/status', firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      const token = await auth.currentUser?.getIdToken();
      if (!token) return null;
      const response = await fetch('/api/manager/stripe-connect/status', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!firebaseUser,
    staleTime: 1000 * 30, // Cache for 30 seconds
  });

  const userData = firebaseUserData;
  // Use Stripe API status (more accurate) - account is complete only when charges AND payouts are enabled
  const isStripeOnboardingComplete = stripeConnectStatus?.status === 'complete' && 
    stripeConnectStatus?.chargesEnabled && stripeConnectStatus?.payoutsEnabled;
  const [dbCompletedSteps, setDbCompletedSteps] = useState<Record<string, boolean>>({});

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
      setDbCompletedSteps(normalized);
    }
  }, [userData]);

  // Derived State - declare BEFORE useMemo that depends on it
  const hasExistingLocation = !isLoadingLocations && locations.length > 0;
  const selectedLocation = locations.find((loc) => loc.id === selectedLocationId) as Location | undefined;

  // [ENTERPRISE] Compute completedSteps based on ACTUAL DATA existence ONLY
  // This ensures the sidebar shows correct completion state based on real conditions
  // 
  // REQUIRED for bookings: Location, Kitchen Space, Requirements, Availability, Payment
  // OPTIONAL: Storage, Equipment
  //
  // NOTE: We do NOT include dbCompletedSteps here for required steps.
  // Required steps are ONLY marked complete when actual data exists.
  // Optional steps can use dbCompletedSteps for "seen" tracking.
  const completedSteps = useMemo((): Record<string, boolean> => {
    const result: Record<string, boolean> = {};

    // Welcome is complete if user has seen it OR has existing location
    // Check both snake_case and potential legacy/new field names for valid welcome flag
    // Also check dbCompletedSteps for real-time updates within session
    if (userData?.has_seen_welcome || userData?.has_seen_welcome_screen || locations.length > 0 || dbCompletedSteps['welcome']) {
      result['welcome'] = true;
    }

    // Location is complete if location exists AND is selected
    if (selectedLocationId && locations.length > 0) {
      result['location'] = true;
    }

    // Kitchen Space is complete if kitchens exist for this location
    if (kitchens.length > 0) {
      result['create-kitchen'] = true;
    }

    // Application Requirements is complete if location_requirements record exists
    // This is DATA-DRIVEN - must be saved via the Save button
    if (hasRequirements) {
      result['application-requirements'] = true;
    }

    // Availability is complete ONLY if any day is actually set available
    // This is DATA-DRIVEN - must have data in kitchen_availability table
    if (hasAvailability) {
      result['availability'] = true;
    }

    // Payment is complete if Stripe is connected
    if (isStripeOnboardingComplete) {
      result['payment-setup'] = true;
    }

    // Optional steps: Keep from dbCompletedSteps for "seen" tracking only
    if (dbCompletedSteps['storage-listings'] || existingStorageListings.length > 0) {
      result['storage-listings'] = true;
    }
    if (dbCompletedSteps['equipment-listings'] || existingEquipmentListings.length > 0) {
      result['equipment-listings'] = true;
    }

    return result;
  }, [userData, locations.length, selectedLocationId, kitchens.length,
    hasRequirements, hasAvailability, isStripeOnboardingComplete,
    dbCompletedSteps, existingStorageListings.length, existingEquipmentListings.length]);

  // Build visible steps: show all steps, but skip welcome if returning user with location
  let visibleStepsFiltered = [...steps];

  // [UX FIX] Hide welcome screen ONLY when explicitly adding a new location (secondary flow)
  // Keep it visible for the initial onboarding flow (even after location is created) for consistency
  if (isAddingLocation) {
    visibleStepsFiltered = visibleStepsFiltered.filter(step => step.id !== 'welcome');
  }

  // [FIX] Keep payment step visible even when complete - just show it as completed
  // This prevents the confusing UX where the step disappears from the sidebar

  // CRITICAL FIX: Compute the correct index in the visible steps array
  // OnboardJS currentStep is index in ORIGINAL steps array, we need index in FILTERED array
  const currentStepId = currentStep?.id;
  const currentVisibleStepIndex = visibleStepsFiltered.findIndex(step => step.id === currentStepId);

  // AUTO-SKIP: Only skip welcome step for returning users with location
  // [FIX] We no longer auto-skip payment-setup - users can view it even when complete
  // This allows them to see their completed status and access Stripe dashboard
  useEffect(() => {
    if (!currentStepId || isCompleted) return;

    // Only auto-skip welcome for returning users who are adding a new location
    // Payment step should stay visible even when complete (user can see status)
    const stepsToSkip: string[] = [];
    if (hasExistingLocation && !isAddingLocation) stepsToSkip.push('welcome');

    // Only auto-skip if current step is in the explicit skip list
    const stepIdStr = String(currentStepId);
    if (stepsToSkip.includes(stepIdStr)) {
      console.log(`[Onboarding] Auto-skipping step: ${stepIdStr}`);
      next();
    }
  }, [currentStepId, isCompleted, hasExistingLocation, isAddingLocation, next]);

  // Auto-open logic: show onboarding if manager hasn't completed it and has no locations
  useEffect(() => {
    if (userData && !isLoadingLocations) {
      const isManagerOnboardingComplete = userData.manager_onboarding_completed;
      // Only auto-open for managers who haven't completed onboarding AND have no locations
      if (!isManagerOnboardingComplete && locations.length === 0) {
        // setIsOpen(true); // OLD MODAL
        setLocation('/manager/setup');
      }
    }
  }, [userData, isLoadingLocations, locations, setIsOpen]);

  // Auto-populate email fields from account email for new users (no existing location)
  useEffect(() => {
    if (firebaseUser?.email && !isLoadingLocations && locations.length === 0 && !notificationEmail && !contactEmail) {
      const accountEmail = firebaseUser.email;
      setNotificationEmail(accountEmail);
      setContactEmail(accountEmail);
    }
  }, [firebaseUser?.email, isLoadingLocations, locations.length, notificationEmail, contactEmail]);

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
      const loc = locations[0] as any;
      setSelectedLocationId(loc.id);
      setLocationName(loc.name || "");
      setLocationAddress(loc.address || "");
      setNotificationEmail(loc.notificationEmail || "");
      setNotificationPhone(loc.notificationPhone || "");
      // Contact fields
      setContactEmail(loc.contactEmail || "");
      setContactPhone(loc.contactPhone || "");
      setPreferredContactMethod(loc.preferredContactMethod || "email");

      // Reset loading flags when location switches/initializes
      setKitchensLoaded(false);
      setRequirementsLoaded(false);

      // If we have a location, we might want to fast-forward the OnboardJS state if it's on step 0 or 1.
      // However, OnboardJS doesn't expose a direct "jump to index" easily without loop, 
      // or we rely on the persistence of OnboardJS itself.
    }
  }, [isLoadingLocations, hasExistingLocation, locations, selectedLocationId]);

  // Manual navigation flag to prevent auto-skip when user explicitly navigates
  const isManualNavigation = useRef(false);

  // [ENTERPRISE] Auto-skip to first incomplete required step when returning
  // This provides a seamless UX where users jump directly to what needs attention
  //
  // REQUIRED for bookings: Location, Kitchen Space, Availability, Payment
  // OPTIONAL: Application Requirements (chef settings), Storage, Equipment

  // Ref to track if we've already performed the initial auto-skip
  const hasPerformedInitialAutoSkip = useRef(false);

  useEffect(() => {
    if (!engine || !hasExistingLocation || isLoadingLocations || isAddingLocation) return;

    // Skip auto-advance if user manually navigated
    if (isManualNavigation.current) {
      console.log('[Onboarding] Skipping auto-advance due to manual navigation');
      isManualNavigation.current = false;
      return;
    }

    // [FIX] Wait for critical data to load before making any skip decisions
    // If we have a location selected, we MUST wait for kitchens and requirements to load
    if (selectedLocationId) {
      if (!kitchensLoaded || !requirementsLoaded) {
        return;
      }
    }

    // [FIX] Only perform auto-skip logic ONCE per session (on load)
    // This prevents jarring auto-navigation when a user completes a step actively
    if (hasPerformedInitialAutoSkip.current) {
      return;
    }

    const currentId = currentStep?.id;
    if (!currentId) return;

    // Check if current step is already completed - if so, auto-navigate to first incomplete
    const isCurrentStepComplete = completedSteps[String(currentId)];

    // Only auto-skip from these steps when they're complete
    // [FIX] Removed payment-setup from auto-skip list - users should be able to view it
    const autoSkipFromSteps = ['welcome', 'location', 'create-kitchen', 'application-requirements', 'availability'];
    if (!autoSkipFromSteps.includes(String(currentId))) return;

    // Only proceed if current step is complete
    if (!isCurrentStepComplete) return;

    // Find first incomplete REQUIRED step in order
    // Required for bookings: location -> kitchen -> requirements -> payment -> availability
    const requiredStepOrder = ['location', 'create-kitchen', 'application-requirements', 'payment-setup', 'availability', 'completion-summary'];

    for (const stepId of requiredStepOrder) {
      // If this step is incomplete, navigate to it
      if (!completedSteps[stepId]) {
        console.log(`[Onboarding] Enterprise auto-skip: ${currentId} → ${stepId}`);
        hasPerformedInitialAutoSkip.current = true; // Mark as performed
        engine.goToStep(stepId);
        return;
      }
    }

    // All required steps complete - Do not force jump to summary
    // Instead, advance to the next step in the sequence (even if optional)
    if (requiredStepOrder.includes(String(currentId)) && isCurrentStepComplete) {
      const currentIndex = steps.findIndex(s => s.id === currentId);
      // Ensure we are not at the end and the current step is actually found
      if (currentIndex !== -1 && currentIndex < steps.length - 1) {
        const nextStep = steps[currentIndex + 1];
        // Only advance if next step is valid
        if (nextStep && nextStep.id) {
          console.log(`[Onboarding] Advancing from completed required step to: ${nextStep.id}`);
          hasPerformedInitialAutoSkip.current = true; // Mark as performed
          engine.goToStep(nextStep.id);
        }
      }
    }

    // If we reached here and didn't jump, we only mark initial skip as done 
    // IF we are confident we have loaded everything and truly don't need to jump.
    // If we are still loading or waiting for data, we should NOT mark it as done yet.
    // [FIX] Also wait for selectedLocationId to be set if we have locations, 
    // otherwise loadKitchens hasn't even started!
    // We already checked kitchensLoaded/requirementsLoaded above, so if we are here, we are loaded.

    if (hasExistingLocation && Object.keys(completedSteps).length > 0) {
      hasPerformedInitialAutoSkip.current = true;
    }

  }, [engine, hasExistingLocation, isLoadingLocations, isLoadingKitchens, isLoadingRequirements, selectedLocationId, isAddingLocation, currentStep?.id,
    completedSteps, kitchensLoaded, requirementsLoaded]);

  // Load kitchens when location selected
  useEffect(() => {
    if (selectedLocationId) {
      const loadKitchens = async () => {
        setIsLoadingKitchens(true);
        // Ensure strictly false until loaded
        setKitchensLoaded(false);
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
        } finally {
          setIsLoadingKitchens(false);
          setKitchensLoaded(true);
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

  // Load Availability check [NEW]
  useEffect(() => {
    const checkAvailability = async () => {
      if (!selectedKitchenId) {
        setHasAvailability(false);
        return;
      }
      setIsLoadingAvailability(true);
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;

        const res = await fetch(`/api/manager/availability/${selectedKitchenId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
          const data = await res.json();
          // Check if any day is set to available
          const isSet = Array.isArray(data) && data.some((day: any) => day.isAvailable || day.is_available);
          setHasAvailability(isSet);
        }
      } catch (e) {
        console.error("Failed to check availability", e);
      } finally {
        setIsLoadingAvailability(false);
      }
    };
    checkAvailability();
  }, [selectedKitchenId]);

  // Load Requirements check [NEW] - checks if location_requirements record exists
  useEffect(() => {
    const checkRequirements = async () => {
      if (!selectedLocationId) {
        setHasRequirements(false);
        return;
      }
      setIsLoadingRequirements(true);
      setRequirementsLoaded(false);
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;

        const res = await fetch(`/api/manager/locations/${selectedLocationId}/requirements`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
          const data = await res.json();
          // Record exists if we get a valid response with an id > 0
          // Default requirements return id=0 or -1, so we check for positive ID
          setHasRequirements(!!data && Number(data.id) > 0);
        } else {
          setHasRequirements(false);
        }
      } catch (e) {
        console.error("Failed to check requirements", e);
        setHasRequirements(false);
      } finally {
        setIsLoadingRequirements(false);
        setRequirementsLoaded(true);
      }
    };
    checkRequirements();
  }, [selectedLocationId]);


  // Track step completion - saves to backend and optimistically updates local state
  const trackStepCompletion = useCallback(async (stepId: number | string) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      // Normalize to string ID
      const stringId = typeof stepId === 'number' ? NUMERIC_TO_STRING_MAP[stepId] : stepId;
      if (!stringId) return;

      // Optimistically update local state for immediate UI feedback
      setDbCompletedSteps((prev: Record<string, boolean>) => ({ ...prev, [stringId]: true }));

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
      const res = await fetch("/api/files/upload-file", {
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
      console.log('[Onboarding] updateLocation called', { 
        licenseFile: licenseFile?.name, 
        termsFile: termsFile?.name,
        selectedLocationId,
        locationsLength: locations.length
      });

      let licenseUrl = null;
      if (licenseFile) {
        if (!licenseExpiryDate) {
          toast({ title: "Error", description: "Missing license expiry", variant: "destructive" });
          return;
        }
        licenseUrl = await uploadLicense();
        console.log('[Onboarding] License uploaded:', licenseUrl);
      }

      // Upload terms file if provided
      let termsUrl = null;
      if (termsFile) {
        console.log('[Onboarding] Uploading terms file:', termsFile.name);
        setUploadingTerms(true);
        const token = await auth.currentUser?.getIdToken();
        const formData = new FormData();
        formData.append("file", termsFile);
        const uploadRes = await fetch("/api/files/upload-file", {
          method: "POST",
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });
        if (!uploadRes.ok) throw new Error("Failed to upload terms file");
        const uploadResult = await uploadRes.json();
        termsUrl = uploadResult.url;
        console.log('[Onboarding] Terms uploaded:', termsUrl);
        setUploadingTerms(false);
      } else {
        console.log('[Onboarding] No terms file to upload');
      }

      const token = await auth.currentUser?.getIdToken();

      let phone = notificationPhone;
      if (phone) {
        const p = optionalPhoneNumberSchema.safeParse(phone);
        if (!p.success) throw new Error("Invalid phone");
        phone = p.data || "";
      }

      // Validate contact phone if provided
      let contactPhoneValidated = contactPhone;
      if (contactPhoneValidated) {
        const cp = optionalPhoneNumberSchema.safeParse(contactPhoneValidated);
        if (!cp.success) throw new Error("Invalid contact phone");
        contactPhoneValidated = cp.data || "";
      }

      const body: any = {
        name: locationName,
        address: locationAddress,
        notificationEmail,
        notificationPhone: phone,
        contactEmail,
        contactPhone: contactPhoneValidated,
        preferredContactMethod
      };
      if (licenseUrl) {
        body.kitchenLicenseUrl = licenseUrl;
        body.kitchenLicenseStatus = "pending";
        body.kitchenLicenseExpiry = licenseExpiryDate;
      } else if (licenseExpiryDate && !licenseFile) {
        body.kitchenLicenseExpiry = licenseExpiryDate;
      }

      // Add terms URL if uploaded
      if (termsUrl) {
        body.kitchenTermsUrl = termsUrl;
      }

      console.log('[Onboarding] Request body:', JSON.stringify(body, null, 2));
      console.log('[Onboarding] termsUrl value:', termsUrl);
      console.log('[Onboarding] body.kitchenTermsUrl:', body.kitchenTermsUrl);

      const endpoint = (!selectedLocationId || locations.length === 0)
        ? `/api/manager/locations`
        : `/api/manager/locations/${selectedLocationId}`;
      const method = (!selectedLocationId || locations.length === 0) ? "POST" : "PUT";

      console.log('[Onboarding] Using endpoint:', endpoint, 'method:', method);

      const res = await fetch(endpoint, {
        method,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      console.log('[Onboarding] Response:', res.status, data);

      if (!res.ok) throw new Error(data.error || "Failed to save location");

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

      // 1. Create Kitchen
      const res = await fetch(`/api/manager/kitchens`, {
        method: "POST",
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: selectedLocationId,
          name: kitchenFormData.name,
          description: kitchenFormData.description,
          imageUrl: kitchenFormData.imageUrl || undefined
        })
      });
      if (!res.ok) throw new Error("Failed to create kitchen");
      let newKitchen = await res.json();



      // 3. Update Pricing
      if (kitchenFormData.hourlyRate) {
        const pricingRes = await fetch(`/api/manager/kitchens/${newKitchen.id}/pricing`, {
          method: "PUT",
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hourlyRate: Math.round(parseFloat(kitchenFormData.hourlyRate) * 100),
            currency: kitchenFormData.currency,
            minimumBookingHours: parseInt(kitchenFormData.minimumBookingHours) || 1
          })
        });
        
        // Merge pricing data into the kitchen object
        if (pricingRes.ok) {
          newKitchen = {
            ...newKitchen,
            hourlyRate: Math.round(parseFloat(kitchenFormData.hourlyRate) * 100),
            currency: kitchenFormData.currency,
            minimumBookingHours: parseInt(kitchenFormData.minimumBookingHours) || 1,
            imageUrl: kitchenFormData.imageUrl || newKitchen.imageUrl
          };
        }
      }

      setKitchens([...kitchens, newKitchen]);
      setSelectedKitchenId(newKitchen.id);
      setShowCreateKitchen(false);
      setKitchenFormData({ name: '', description: '', hourlyRate: '', currency: 'CAD', minimumBookingHours: '1', imageUrl: '' });

      await trackStepCompletion(currentStep?.id || 'create-kitchen');
      toast({ title: "Success", description: "Kitchen created" });
      // next(); // [FIX] Do not auto-advance. Let user click Next to avoid race conditions with checks.
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

  const [, setLocation] = useLocation();

  const value: ManagerOnboardingContextType = {
    // Adapter
    currentStepData: currentStep?.payload,
    currentStepIndex: currentVisibleStepIndex >= 0 ? currentVisibleStepIndex : 0,
    isFirstStep: currentVisibleStepIndex === 0,
    isLastStep: !!isCompleted,
    isOnboardingCompleted: !!isCompleted,
    hasExistingLocation,

    handleNext: handleNextAction,
    handleBack: () => {
      isManualNavigation.current = true;
      previous();
    },
    handleSkip: handleSkipAction,
    goToStep: async (stepId: string) => {
      if (engine) {
        isManualNavigation.current = true;
        console.log(`[Onboarding] Navigating directly to step: ${stepId}`);
        await engine.goToStep(stepId);
      }
    },

    // Missing props:
    currentStep: (state as any)?.currentStep ?? 0,
    setCurrentStep: () => { }, // No-op
    visibleSteps: visibleStepsFiltered,
    completedSteps,

    isOpen, setIsOpen,

    // Domain
    locations, selectedLocationId, setSelectedLocationId, selectedLocation,
    kitchens, selectedKitchenId, setSelectedKitchenId, isLoadingLocations,
    isStripeOnboardingComplete,
    hasAvailability,
    refreshAvailability: async () => {
      // Refetch availability status after save
      if (!selectedKitchenId) return;
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch(`/api/manager/availability/${selectedKitchenId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          const isSet = Array.isArray(data) && data.some((day: any) => day.isAvailable || day.is_available);
          setHasAvailability(isSet);
        }
      } catch (e) {
        console.error("Failed to refresh availability", e);
      }
    },
    hasRequirements,
    refreshRequirements: async () => {
      // Refetch requirements status after save
      if (!selectedLocationId) return;
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch(`/api/manager/locations/${selectedLocationId}/requirements`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setHasRequirements(!!data && !!data.id);
        }
      } catch (e) {
        console.error("Failed to refresh requirements", e);
      }
    },

    locationForm: {
      name: locationName, setName: setLocationName,
      address: locationAddress, setAddress: setLocationAddress,
      notificationEmail, setNotificationEmail,
      notificationPhone, setNotificationPhone,
      contactEmail, setContactEmail,
      contactPhone, setContactPhone,
      preferredContactMethod, setPreferredContactMethod
    },
    licenseForm: {
      file: licenseFile, setFile: setLicenseFile,
      expiryDate: licenseExpiryDate, setExpiryDate: setLicenseExpiryDate,
      isUploading: uploadingLicense
    },
    termsForm: {
      file: termsFile, setFile: setTermsFile,
      isUploading: uploadingTerms
    },
    kitchenForm: {
      data: kitchenFormData, setData: setKitchenFormData,
      showCreate: showCreateKitchen, setShowCreate: setShowCreateKitchen,
      isCreating: creatingKitchen
    },
    storageForm: { 
      listings: existingStorageListings, 
      isLoading: isLoadingStorage,
      refresh: async () => {
        if (!selectedKitchenId) return;
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        setIsLoadingStorage(true);
        try {
          const res = await fetch(`/api/manager/kitchens/${selectedKitchenId}/storage-listings`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) setExistingStorageListings(await res.json());
        } finally { setIsLoadingStorage(false); }
      }
    },
    equipmentForm: { 
      listings: existingEquipmentListings, 
      isLoading: isLoadingEquipment,
      refresh: async () => {
        if (!selectedKitchenId) return;
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        setIsLoadingEquipment(true);
        try {
          const res = await fetch(`/api/manager/kitchens/${selectedKitchenId}/equipment-listings`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) setExistingEquipmentListings(await res.json());
        } finally { setIsLoadingEquipment(false); }
      }
    },

    updateLocation, createKitchen, uploadLicense,
    startNewLocation: () => {
      setSelectedLocationId(null);
      setLocationName("");
      setLocationAddress("");
      // Auto-populate email fields from account email
      const accountEmail = firebaseUser?.email || "";
      setNotificationEmail(accountEmail);
      setNotificationPhone("");
      // Contact email auto-populated based on preferred method (default is email)
      setContactEmail(accountEmail);
      setContactPhone("");
      setPreferredContactMethod("email");
      setLicenseFile(null);
      setLicenseExpiryDate("");
      setTermsFile(null);
      setIsAddingLocation(true);
      // setIsOpen(true); // OLD MODAL
      setLocation('/manager/setup'); // NEW FULL PAGE
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
