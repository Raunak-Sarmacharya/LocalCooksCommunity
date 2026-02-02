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

// [ENTERPRISE] Generate unique submission ID using crypto API or fallback
const generateSubmissionId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// Step ID mapping for backwards compatibility with legacy numeric format in database
// MUST match the order in onboarding-steps.ts
const STEP_ID_MAP: Record<string, number> = {
  'welcome': 0,
  'location': 1,
  'create-kitchen': 2,
  'availability': 3,
  'application-requirements': 4,
  'equipment-listings': 5,
  'storage-listings': 6,
  'payment-setup': 7,
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
  skipCurrentStep: () => Promise<void>; // Skip current step without completing it
  goToStep: (stepId: string) => Promise<void>;

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
    uploadedUrl: string | null;
    uploadFile: (file: File) => Promise<string | null>;
  };

  termsForm: {
    file: File | null;
    setFile: (file: File | null) => void;
    isUploading: boolean;
    uploadedUrl: string | null;
    uploadFile: (file: File) => Promise<string | null>;
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
  
  // [ENTERPRISE] Save and exit functionality - allows exiting at any step
  saveAndExit: () => Promise<void>;
  
  // [ENTERPRISE] Submission state for race condition prevention
  isSubmitting: boolean;
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
  const [licenseUploadedUrl, setLicenseUploadedUrl] = useState<string | null>(null);

  // Terms Form State
  const [termsFile, setTermsFile] = useState<File | null>(null);
  const [uploadingTerms, setUploadingTerms] = useState(false);
  const [termsUploadedUrl, setTermsUploadedUrl] = useState<string | null>(null);

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

  // [ENTERPRISE] Submission State - Prevents race conditions and duplicate submissions
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionIdRef = useRef<string | null>(null);
  const lastSubmittedLocationIdRef = useRef<number | null>(null);

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
  // REQUIRED for bookings: Location, Kitchen Space, Availability, Requirements, Payment
  // OPTIONAL: Equipment, Storage
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

    // Location is complete if location exists AND is selected AND has required files (license + terms)
    // [ENTERPRISE FIX] Check both camelCase and snake_case field names for compatibility
    // Also check dbCompletedSteps as fallback for in-session completion before data refresh
    if (selectedLocationId && locations.length > 0) {
      const loc = locations.find(l => l.id === selectedLocationId) as any;
      const hasLicense = loc?.kitchenLicenseUrl || loc?.kitchen_license_url;
      const hasTerms = loc?.kitchenTermsUrl || loc?.kitchen_terms_url;
      
      // Primary check: actual data has both URLs
      // Secondary check: dbCompletedSteps marked true (handles race condition during save)
      if ((hasLicense && hasTerms) || dbCompletedSteps['location']) {
        result['location'] = true;
      }
    } else if (dbCompletedSteps['location']) {
      // Fallback: if dbCompletedSteps says location is done but locations haven't loaded yet
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

  // ENTERPRISE FIX: Auto-redirect logic moved to ManagerProtectedRoute.tsx
  // This prevents the "flash" of dashboard content before onboarding redirect
  // The redirect now happens BEFORE dashboard renders, not after via useEffect
  // Keeping this comment for documentation purposes

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


  // Auto-select location and initialize form state from existing data
  useEffect(() => {
    if (!isLoadingLocations && hasExistingLocation && !selectedLocationId && locations.length > 0) {
      const loc = locations[0] as any;
      setSelectedLocationId(loc.id);
      setLocationName(loc.name || "");
      setLocationAddress(loc.address || "");
      setNotificationEmail(loc.notificationEmail || loc.notification_email || "");
      setNotificationPhone(loc.notificationPhone || loc.notification_phone || "");
      // Contact fields
      setContactEmail(loc.contactEmail || loc.contact_email || "");
      setContactPhone(loc.contactPhone || loc.contact_phone || "");
      setPreferredContactMethod(loc.preferredContactMethod || loc.preferred_contact_method || "email");

      // [ENTERPRISE FIX] Initialize uploaded URLs from existing location data
      // This ensures that when returning to the Business step, files already on location
      // are recognized and won't trigger re-uploads or show as missing
      const existingLicenseUrl = loc.kitchenLicenseUrl || loc.kitchen_license_url;
      const existingTermsUrl = loc.kitchenTermsUrl || loc.kitchen_terms_url;
      const existingLicenseExpiry = loc.kitchenLicenseExpiry || loc.kitchen_license_expiry;
      
      if (existingLicenseUrl) {
        setLicenseUploadedUrl(existingLicenseUrl);
      }
      if (existingTermsUrl) {
        setTermsUploadedUrl(existingTermsUrl);
      }
      if (existingLicenseExpiry) {
        // Format date for input if needed
        const expiryDate = new Date(existingLicenseExpiry);
        if (!isNaN(expiryDate.getTime())) {
          setLicenseExpiryDate(expiryDate.toISOString().split('T')[0]);
        }
      }
      
      // [ENTERPRISE FIX] Initialize lastSubmittedLocationIdRef to prevent duplicate creates
      lastSubmittedLocationIdRef.current = loc.id;

      // Reset loading flags when location switches/initializes
      setKitchensLoaded(false);
      setRequirementsLoaded(false);

      console.log('[Onboarding] Auto-selected location and initialized state:', {
        locationId: loc.id,
        hasLicenseUrl: !!existingLicenseUrl,
        hasTermsUrl: !!existingTermsUrl,
        licenseExpiry: existingLicenseExpiry
      });
    }
  }, [isLoadingLocations, hasExistingLocation, locations, selectedLocationId]);

  // Manual navigation flag to prevent auto-skip when user explicitly navigates
  const isManualNavigation = useRef(false);

  // [ENTERPRISE] Auto-skip to first incomplete required step when returning
  // This provides a seamless UX where users jump directly to what needs attention
  //
  // REQUIRED for bookings: Location, Kitchen Space, Availability, Requirements, Payment
  // OPTIONAL: Equipment, Storage

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

    // [FIX] Only perform auto-skip logic ONCE per session (on initial load)
    // This prevents jarring auto-navigation when a user completes a step actively
    // or navigates between steps manually
    if (hasPerformedInitialAutoSkip.current) {
      return;
    }

    const currentId = currentStep?.id;
    if (!currentId) return;

    // Check if current step is already completed - if so, auto-navigate to first incomplete
    const isCurrentStepComplete = completedSteps[String(currentId)];

    // Find first incomplete REQUIRED step in order
    // Required for bookings: location -> kitchen -> availability -> requirements -> payment
    const requiredStepOrder = ['location', 'create-kitchen', 'availability', 'application-requirements', 'payment-setup', 'completion-summary'];

    // If current step is complete, find the first incomplete required step and navigate there
    if (isCurrentStepComplete) {
      for (const stepId of requiredStepOrder) {
        // If this step is incomplete, navigate to it
        if (!completedSteps[stepId]) {
          console.log(`[Onboarding] Enterprise auto-skip: ${currentId} → ${stepId}`);
          hasPerformedInitialAutoSkip.current = true;
          engine.goToStep(stepId);
          return;
        }
      }

      // All required steps complete - advance to next step in sequence (even if optional)
      const currentIndex = steps.findIndex(s => s.id === currentId);
      if (currentIndex !== -1 && currentIndex < steps.length - 1) {
        const nextStep = steps[currentIndex + 1];
        if (nextStep && nextStep.id) {
          console.log(`[Onboarding] Advancing from completed required step to: ${nextStep.id}`);
          hasPerformedInitialAutoSkip.current = true;
          engine.goToStep(nextStep.id);
          return;
        }
      }
    }

    // Current step is NOT complete - user should stay here
    // Mark as performed so we don't keep checking on every render
    hasPerformedInitialAutoSkip.current = true;
    console.log(`[Onboarding] User on incomplete step: ${currentId}, staying here`);

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
      setLicenseUploadedUrl(data.url);
      return data.url;
    } finally {
      setUploadingLicense(false);
    }
  };

  // Immediate upload function for license file (called from LocationStep)
  const uploadLicenseFile = async (file: File): Promise<string | null> => {
    setUploadingLicense(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/files/upload-file", {
        method: "POST",
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setLicenseUploadedUrl(data.url);
      setLicenseFile(file);
      return data.url;
    } catch (error) {
      setLicenseFile(null);
      setLicenseUploadedUrl(null);
      throw error;
    } finally {
      setUploadingLicense(false);
    }
  };

  // Immediate upload function for terms file (called from LocationStep)
  const uploadTermsFile = async (file: File): Promise<string | null> => {
    setUploadingTerms(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/files/upload-file", {
        method: "POST",
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setTermsUploadedUrl(data.url);
      setTermsFile(file);
      return data.url;
    } catch (error) {
      setTermsFile(null);
      setTermsUploadedUrl(null);
      throw error;
    } finally {
      setUploadingTerms(false);
    }
  };

  // [ENTERPRISE] updateLocation with race condition prevention
  // - Submission deduplication via submissionIdRef
  // - Prevents double file uploads by checking uploadedUrl first
  // - Prevents duplicate location creation via lastSubmittedLocationIdRef
  // - Proper async state handling before navigation
  const updateLocation = async () => {
    if (!locationName || !locationAddress) {
      toast({ title: "Error", description: "Missing location details", variant: "destructive" });
      return;
    }

    // [GUARD 1] Prevent concurrent submissions
    if (isSubmitting) {
      console.log('[Onboarding] ⚠️ Submission already in progress, ignoring duplicate click');
      return;
    }

    // [GUARD 2] Generate unique submission ID for this request
    const thisSubmissionId = generateSubmissionId();
    submissionIdRef.current = thisSubmissionId;

    setIsSubmitting(true);

    try {
      console.log('[Onboarding] updateLocation called', { 
        submissionId: thisSubmissionId,
        licenseFile: licenseFile?.name, 
        licenseUploadedUrl,
        termsFile: termsFile?.name,
        termsUploadedUrl,
        selectedLocationId,
        lastSubmittedLocationId: lastSubmittedLocationIdRef.current,
        locationsLength: locations.length
      });

      // [FIX 1] Use already-uploaded URL if available, don't re-upload
      // Files are uploaded immediately on selection via uploadLicenseFile/uploadTermsFile
      let licenseUrl = licenseUploadedUrl;
      if (!licenseUrl && licenseFile) {
        // Only upload if not already uploaded
        if (!licenseExpiryDate) {
          toast({ title: "Error", description: "Missing license expiry", variant: "destructive" });
          setIsSubmitting(false);
          return;
        }
        licenseUrl = await uploadLicense();
        console.log('[Onboarding] License uploaded (fresh):', licenseUrl);
      } else if (licenseUrl) {
        console.log('[Onboarding] Using pre-uploaded license URL:', licenseUrl);
      }

      // [FIX 2] Use already-uploaded terms URL if available
      let termsUrl = termsUploadedUrl;
      if (!termsUrl && termsFile) {
        console.log('[Onboarding] Uploading terms file (fresh):', termsFile.name);
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
        setTermsUploadedUrl(termsUrl);
        console.log('[Onboarding] Terms uploaded (fresh):', termsUrl);
        setUploadingTerms(false);
      } else if (termsUrl) {
        console.log('[Onboarding] Using pre-uploaded terms URL:', termsUrl);
      }

      // [GUARD 3] Check if submission was superseded
      if (submissionIdRef.current !== thisSubmissionId) {
        console.log('[Onboarding] ⚠️ Submission superseded, aborting:', thisSubmissionId);
        return;
      }

      const token = await auth.currentUser?.getIdToken();

      let phone = notificationPhone;
      if (phone) {
        const p = optionalPhoneNumberSchema.safeParse(phone);
        if (!p.success) throw new Error("Invalid phone");
        phone = p.data || "";
      }

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
      
      // Include license URL (pre-uploaded or freshly uploaded)
      if (licenseUrl) {
        body.kitchenLicenseUrl = licenseUrl;
        body.kitchenLicenseStatus = "pending";
        if (licenseExpiryDate) {
          body.kitchenLicenseExpiry = licenseExpiryDate;
        }
      } else if (licenseExpiryDate) {
        body.kitchenLicenseExpiry = licenseExpiryDate;
      }

      // Include terms URL (pre-uploaded or freshly uploaded)
      if (termsUrl) {
        body.kitchenTermsUrl = termsUrl;
      }

      // [FIX 3] Robust POST vs PUT decision - check multiple sources to prevent duplicates
      // Priority: lastSubmittedLocationIdRef > selectedLocationId > first location in array
      const effectiveLocationId = 
        lastSubmittedLocationIdRef.current || 
        selectedLocationId || 
        (locations.length > 0 ? locations[0].id : null);

      const shouldCreate = !effectiveLocationId;
      const endpoint = shouldCreate
        ? `/api/manager/locations`
        : `/api/manager/locations/${effectiveLocationId}`;
      const method = shouldCreate ? "POST" : "PUT";

      console.log('[Onboarding] Request:', { 
        method, 
        endpoint, 
        effectiveLocationId,
        body: JSON.stringify(body, null, 2) 
      });

      const res = await fetch(endpoint, {
        method,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      console.log('[Onboarding] Response:', res.status, data);

      if (!res.ok) throw new Error(data.error || "Failed to save location");

      // [FIX 4] Track the created/updated location ID immediately via ref (sync)
      const savedLocationId = data.id || effectiveLocationId;
      lastSubmittedLocationIdRef.current = savedLocationId;
      
      // Also update React state (async, but ref provides immediate protection)
      if (method === "POST" || !selectedLocationId) {
        setSelectedLocationId(savedLocationId);
      }

      // [ENTERPRISE FIX] Optimistically update the query cache IMMEDIATELY
      // This ensures completedSteps sees the new URLs without waiting for refetch
      queryClient.setQueryData(["/api/manager/locations"], (oldData: any) => {
        if (!oldData) return oldData;
        
        // If it's an array of locations
        if (Array.isArray(oldData)) {
          return oldData.map((loc: any) => {
            if (loc.id === savedLocationId) {
              return {
                ...loc,
                name: locationName,
                address: locationAddress,
                kitchenLicenseUrl: licenseUrl || loc.kitchenLicenseUrl || loc.kitchen_license_url,
                kitchenTermsUrl: termsUrl || loc.kitchenTermsUrl || loc.kitchen_terms_url,
                kitchenLicenseExpiry: licenseExpiryDate || loc.kitchenLicenseExpiry,
                // Also update snake_case versions for compatibility
                kitchen_license_url: licenseUrl || loc.kitchen_license_url || loc.kitchenLicenseUrl,
                kitchen_terms_url: termsUrl || loc.kitchen_terms_url || loc.kitchenTermsUrl,
              };
            }
            return loc;
          });
        }
        return oldData;
      });

      // For new locations (POST), add to cache if not already there
      if (method === "POST") {
        queryClient.setQueryData(["/api/manager/locations"], (oldData: any) => {
          if (!oldData) return [data];
          if (Array.isArray(oldData)) {
            const exists = oldData.some((loc: any) => loc.id === savedLocationId);
            if (!exists) {
              return [...oldData, {
                ...data,
                kitchenLicenseUrl: licenseUrl,
                kitchenTermsUrl: termsUrl,
                kitchen_license_url: licenseUrl,
                kitchen_terms_url: termsUrl,
              }];
            }
          }
          return oldData;
        });
      }

      console.log('[Onboarding] ✅ Cache updated optimistically with URLs:', { licenseUrl, termsUrl, savedLocationId });

      // [ENTERPRISE FIX] Track step completion FIRST - this sets dbCompletedSteps which triggers completedSteps recalculation
      await trackStepCompletion(currentStep?.id || 'location');

      // [ENTERPRISE FIX] Allow React to process state updates before navigation
      // This ensures completedSteps memo recalculates with new dbCompletedSteps value
      await new Promise(resolve => setTimeout(resolve, 50));

      // Now refetch to ensure server data is in sync (but UI already shows complete)
      queryClient.refetchQueries({ queryKey: ["/api/manager/locations"] });

      // [GUARD 4] Final check - ensure this submission wasn't superseded
      if (submissionIdRef.current !== thisSubmissionId) {
        console.log('[Onboarding] ⚠️ Submission superseded before navigation, aborting:', thisSubmissionId);
        return;
      }

      toast({ title: "Success", description: "Location saved" });
      
      // Clear file state after successful save (files are now persisted to location)
      setLicenseFile(null);
      setTermsFile(null);
      
      next(); // Move to next step via OnboardJS

    } catch (e: any) {
      console.error('[Onboarding] Error in updateLocation:', e);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
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
    skipCurrentStep: async () => {
      // Skip to next step without marking current as complete
      if (engine) {
        isManualNavigation.current = true;
        console.log(`[Onboarding] Skipping step: ${currentStep?.id}`);
        next(); // Move to next step without completion tracking
      }
    },
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
      isUploading: uploadingLicense,
      uploadedUrl: licenseUploadedUrl,
      uploadFile: uploadLicenseFile
    },
    termsForm: {
      file: termsFile, setFile: setTermsFile,
      isUploading: uploadingTerms,
      uploadedUrl: termsUploadedUrl,
      uploadFile: uploadTermsFile
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
    
    // [ENTERPRISE] Save and Exit - Persists current step progress and navigates to dashboard
    // This allows users to exit at ANY step (including welcome) and resume later
    saveAndExit: async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) {
          console.warn('[Onboarding] No auth token for saveAndExit');
          setLocation('/manager/dashboard');
          return;
        }

        const stepId = currentStep?.id;
        console.log('[Onboarding] Save & Exit from step:', stepId);

        // 1. Mark current step as "seen" via manager onboarding step tracking
        // NOTE: has_seen_welcome is for CHEF onboarding only, not managers
        // Managers use managerOnboardingStepsCompleted in user profile
        if (stepId) {
          const response = await fetch("/api/manager/onboarding/step", {
            method: "POST",
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
              stepId: stepId, 
              locationId: selectedLocationId || undefined 
            }),
          });

          if (response.ok) {
            // [ENTERPRISE FIX] Optimistically update user profile cache IMMEDIATELY
            // This prevents ManagerProtectedRoute from seeing stale data and redirecting back
            queryClient.setQueryData(["/api/user/profile", firebaseUser?.uid], (oldData: any) => {
              if (!oldData) return oldData;
              const currentSteps = oldData.managerOnboardingStepsCompleted || {};
              return {
                ...oldData,
                managerOnboardingStepsCompleted: {
                  ...currentSteps,
                  [stepId]: true
                }
              };
            });
            
            // Also update the query without uid suffix (some components use this)
            queryClient.setQueryData(["/api/user/profile"], (oldData: any) => {
              if (!oldData) return oldData;
              const currentSteps = oldData.managerOnboardingStepsCompleted || {};
              return {
                ...oldData,
                managerOnboardingStepsCompleted: {
                  ...currentSteps,
                  [stepId]: true
                }
              };
            });

            console.log('[Onboarding] ✅ Optimistically updated user profile with step:', stepId);
          }
        }

        // 2. Allow React to process cache updates before navigation
        await new Promise(resolve => setTimeout(resolve, 50));

        // 3. Refetch in background to ensure server sync (but UI already updated)
        queryClient.refetchQueries({ queryKey: ["/api/user/profile"] });
        queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });

        toast({ 
          title: "Progress Saved", 
          description: "You can continue setup anytime from where you left off." 
        });

        // 4. Navigate to dashboard
        setLocation('/manager/dashboard');

      } catch (error) {
        console.error('[Onboarding] Error in saveAndExit:', error);
        // Still navigate even if save fails - don't trap the user
        setLocation('/manager/dashboard');
      }
    },
    
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
      setLicenseUploadedUrl(null);
      setTermsFile(null);
      setTermsUploadedUrl(null);
      setIsAddingLocation(true);
      // [ENTERPRISE] Reset submission tracking for new location flow
      lastSubmittedLocationIdRef.current = null;
      submissionIdRef.current = null;
      // setIsOpen(true); // OLD MODAL
      setLocation('/manager/setup'); // NEW FULL PAGE
    },
    
    // [ENTERPRISE] Expose submission state for UI
    isSubmitting
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
