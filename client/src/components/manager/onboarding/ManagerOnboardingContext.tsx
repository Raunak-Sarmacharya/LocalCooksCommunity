import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import { tt } from "@/i18n/common-ns";
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { Location, Kitchen, StorageListing, EquipmentListing } from "./types";
import { optionalPhoneNumberSchema } from "@shared/phone-validation";
import { useOnboarding } from "@onboardjs/react";
import { steps } from "@/config/onboarding-steps";
import { resumeBlockedBy } from "./resume-gate";
/*
 * The step-completion rules and the normaliser they read. They used to live in this file, which is
 * why the dashboard's own reader never called them — importing a 2600-line component module to get
 * at a pure function is the wrong trade, and re-deriving them is what let the two readers disagree.
 * See `step-completion.ts` for why there is exactly one of each.
 */
import {
  isAvailabilityStepBehindUs,
  isLocationStepBehindUs,
  isRequirementsStepBehindUs,
  normalizeCompletedSteps,
  resolveStripeState,
  NUMERIC_TO_STRING_MAP,
} from "./step-completion";
import { Link, useLocation } from "wouter";

// [ENTERPRISE] Generate unique submission ID using crypto API or fallback
const generateSubmissionId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};






// We re-export the step interface from types or core if needed, 
// but for this context we mainly need the logic.

/**
 * Fields the Business step saves progressively, one part at a time.
 * Every field is optional in a draft so a part can send only what it owns.
 */
export interface LocationDraftFields {
  name: string;
  address: string;
  logoUrl: string;
  contactEmail: string;
  contactPhone: string;
  preferredContactMethod: "email" | "phone" | "both";
  notificationEmail: string;
  notificationPhone: string;
}

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

  // --- Unsaved-changes guard ---
  /** True while the current step holds edits that are not persisted yet. */
  hasUnsavedChanges: boolean;
  /** Reported by each step when its own dirty state changes. */
  setUnsavedChanges: (dirty: boolean) => void;
  /**
   * How the current step persists its own edits, so the confirmation can offer
   * "Save changes". Steps whose only save *is* navigating register nothing.
   */
  registerStepSave: (save: (() => Promise<boolean>) | null) => void;
  /** Set when a navigation was intercepted; the shell renders the dialog for it. */
  pendingLeave: { run: () => void } | null;
  clearPendingLeave: () => void;
  /** Persist the current step, then run the intercepted navigation. */
  saveAndLeave: () => Promise<void>;
  /** Run the intercepted navigation without saving. */
  discardAndLeave: () => void;
  /** True while `saveAndLeave` is persisting. */
  isSavingBeforeLeave: boolean;

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
  /**
   * Whether the manager has DONE ENOUGH with Stripe for the wizard to move on.
   *
   * True as soon as they have submitted Stripe's onboarding form (`detailsSubmitted`), which
   * is the moment the account exists and the ball is in Stripe's court. It is deliberately
   * NOT "the account can receive money" — see `isStripeConnected` for that.
   *
   * The two are separate because they answer different questions, and collapsing them into
   * one flag is what used to hard-block setup: full verification ("charges and payouts
   * enabled") takes Stripe days to a week, and a manager cannot be asked to sit on the last
   * step of onboarding until a bank check clears. Stripe is the one dependency in this whole
   * wizard that is not ours, so it is the one that must not gate "finish setup".
   */
  isStripeOnboardingComplete?: boolean;
  /**
   * Whether the Stripe account is FULLY connected — charges AND payouts enabled.
   *
   * The strict fact, and the one the dashboard's Getting Started checklist and the
   * publish/booking gates read. Finishing onboarding does not set this; only Stripe does.
   */
  isStripeConnected?: boolean;
  hasAvailability?: boolean;
  /**
   * Whether the availability STEP has been completed by being visited — as opposed to
   * `hasAvailability`, which asks whether a real open day exists.
   *
   * The step's rail tick is `hasAvailability || availabilityStepCompleted`. See the note on the
   * state itself: overloading `hasAvailability` would let the kitchen check un-tick the step.
   */
  availabilityStepCompleted?: boolean;
  /**
   * THE availability rule, in one place: "this step is behind you".
   *
   * True when a real open day exists OR the manager has been through the step and reached its
   * review — a schedule is ONE way to be done with it, accepting the pre-filled policies is
   * another, and that is the way most managers take.
   *
   * **Every surface reads THIS, never `hasAvailability` on its own.** The rule used to be
   * spelled out separately in three readers — the rail tick, the step's own `isComplete`, and
   * the setup summary — and the summary was left on the stricter `hasAvailability`-only
   * version. So a manager who skipped the schedule saw the rail tick, completed onboarding,
   * and was then told by the summary AND the dashboard banner that availability was still
   * missing (2026-09-26). Two definitions of one fact; one of them was wrong.
   */
  isAvailabilityComplete?: boolean;
  /** Mark the Availability & policies step done without a schedule. Called on reaching its review. */
  setAvailabilityStepCompleted?: (completed: boolean) => void;
  /**
   * Record a step as complete — optimistically, then durably.
   *
   * Exposed for the steps whose completion is decided by REACHING THEIR REVIEW rather than by data
   * they save. Availability and Booking Requirements both ship pre-filled: the week is optional and
   * the requirements pane carries the platform defaults, so a manager can read either review,
   * change nothing and move on — and no row is ever written for them to be counted by. The review
   * IS the decision (see `isAvailabilityStepBehindUs`), and only the step knows it was shown.
   *
   * It is the DURABLE writer on purpose. The session flag below is the other half of the same fact,
   * and it dies on reload — its own note admits it. This ticks the UI immediately AND survives
   * leaving the wizard.
   *
   * Calling it also stands auto-resume down (`isManualNavigation`), which is correct: a manager
   * standing on a review is driving, not being driven.
   */
  trackStepCompletion: (stepId: number | string) => Promise<void>;
  /**
   * Whether the Requirements step is behind the manager.
   *
   * **Every surface reads THIS, never `hasRequirements` on its own** — the same rule the
   * availability flag above carries, and it had to be learned twice. `hasRequirements` means
   * "a `location_requirements` row exists"; the step ships pre-filled, so a manager who accepts
   * the defaults writes no row and the flag stays false forever. The setup-complete page and
   * the dashboard banner both read the raw flag and kept asking for a finished step.
   *
   * The rule is `isRequirementsStepBehindUs` (exported above): a saved row OR the step's
   * completion in the durable record.
   */
  isRequirementsComplete?: boolean;
  /**
   * Whether the availability check has actually returned.
   *
   * `hasAvailability` is false until it does, so a step that decides anything from it —
   * "open on the review, this is already done" — must wait for this or it will decide on
   * a flag that has not been read yet.
   */
  availabilityLoaded?: boolean;
  /**
   * Whether the kitchen fetch has actually returned — separately from whether a kitchen exists.
   *
   * `kitchens.length > 0` answers BOTH "the fetch has landed" and "there is a kitchen", which
   * is why the kitchen step used it for its readiness signal as well as its completeness one.
   * Those are not the same question: a manager with no kitchen, whose fetch has returned
   * nothing, is loaded-but-empty, and a manager who has just saved part one of the kitchen step
   * is complete-in-the-same-commit-they-loaded. Collapsing them made the step's review open on
   * the render where part one saved, before a competing `goToPart(1)` pulled the manager back —
   * a visible flash (2026-09-26). Pass THIS as the step's readiness signal.
   */
  kitchensLoaded?: boolean;
  refreshAvailability?: () => Promise<void>; // [NEW] Trigger refresh after saving availability
  /**
   * Re-read the LOCATION after a write that changes it.
   *
   * The Availability step's policies part embeds the dashboard's own `BookingRulesSettings`, and
   * the review prints `selectedLocation` — which the context derives from the `["/api/manager/locations"]`
   * query. On the dashboard that component is wired to a mutation whose `onSuccess` invalidates that
   * query, so the reader is fresh; the step's own `saveBookingRules` is a plain fetch and touches no
   * cache, so without this the review (and the form's own `location` prop) kept the pre-save numbers
   * until a reload. Same defect shape as the kitchen step's stale review (2026-09-26).
   *
   * Invalidate — not patch — because the endpoint returns the row and there are several writers
   * (policy hours, terms upload) whose fields the caller does not all know.
   */
  refreshLocation?: () => Promise<void>;
  hasRequirements?: boolean;
  /** Whether the requirements check has actually returned. Same rule as availability. */
  requirementsLoaded?: boolean;
  refreshRequirements?: () => Promise<void>;

  // Forms State
  /**
   * The Business step's form surface.
   *
   * `description` is deliberately absent: `locations.description` was removed from the product on
   * 2026-09-20 (`shared/schema.ts`), and nothing reads a location description any more.
   */
  locationForm: {
    name: string;
    address: string;
    notificationEmail: string;
    notificationPhone: string;
    contactEmail: string;
    contactPhone: string;
    preferredContactMethod: "email" | "phone" | "both";
    logoUrl: string;
    setName: (val: string) => void;
    setAddress: (val: string) => void;
    setNotificationEmail: (val: string) => void;
    setNotificationPhone: (val: string) => void;
    setContactEmail: (val: string) => void;
    setContactPhone: (val: string) => void;
    setPreferredContactMethod: (val: "email" | "phone" | "both") => void;
    setLogoUrl: (val: string) => void;
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
      dailyRate: string;
      currency: string;
      minimumBookingHours: string;
      imageUrl: string;
      features: string[];
    };
    setData: (data: any) => void;
    showCreate: boolean;
    setShowCreate: (show: boolean) => void;
    isCreating: boolean;
  };
  /** Persist edits to an already-created kitchen. Resolves the updated kitchen. */
  updateKitchen: (
    kitchenId: number,
    data: {
      name: string;
      description: string;
      hourlyRate: string;
      dailyRate: string;
      minimumBookingHours: string;
      imageUrl: string;
    },
  ) => Promise<any>;

  storageForm: {
    listings: StorageListing[];
    isLoading: boolean;
    /** `kitchenId` is optional: omit it to refresh the currently-selected kitchen. */
    refresh: (kitchenId?: number) => Promise<void>;
  };

  equipmentForm: {
    listings: EquipmentListing[];
    isLoading: boolean;
    /** `kitchenId` is optional: omit it to refresh the currently-selected kitchen. */
    refresh: (kitchenId?: number) => Promise<void>;
  };

  // Actions
  updateLocation: () => Promise<void>;
  /**
   * Persist one part of the Business step without advancing. Resolves false on
   * failure so the caller can keep the user on the part they were editing.
   */
  saveLocationDraft: (fields: Partial<LocationDraftFields>) => Promise<boolean>;
  /**
   * Persist the whole location record WITHOUT advancing the wizard.
   *
   * The Business step's documents part saves through this and then shows its review
   * screen, so the manager sees what they set before moving on. Resolves false on
   * failure so the caller keeps them on the part they were editing.
   */
  saveLocationFull: () => Promise<boolean>;
  /**
   * Create the manager's kitchen. Resolves TRUE only when it exists afterwards.
   *
   * The kitchen step's Continue is a create-and-advance, so the caller has to be able to tell
   * success from failure — see the note on the implementation. Resolving false means the manager
   * stays on the form with what they typed.
   */
  createKitchen: () => Promise<boolean>;
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
  const [locationLogoUrl, setLocationLogoUrl] = useState("");
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
  // [ENTERPRISE FIX] Use ref to avoid stale closure issues (matching terms pattern)
  const licenseUploadedUrlRef = useRef<string | null>(null);

  // Terms Form State
  const [termsFile, setTermsFile] = useState<File | null>(null);
  const [uploadingTerms, setUploadingTerms] = useState(false);
  const [termsUploadedUrl, setTermsUploadedUrl] = useState<string | null>(null);
  // [ENTERPRISE FIX] Use ref to avoid stale closure issues when reading URL in updateLocation
  const termsUploadedUrlRef = useRef<string | null>(null);

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
    dailyRate: '',
    features: [],
  });

  // Listings State
  const [existingStorageListings, setExistingStorageListings] = useState<StorageListing[]>([]);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [existingEquipmentListings, setExistingEquipmentListings] = useState<EquipmentListing[]>([]);
  const [isLoadingEquipment, setIsLoadingEquipment] = useState(false);

  // Availability State
  const [hasAvailability, setHasAvailability] = useState(false);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [availabilityLoaded, setAvailabilityLoaded] = useState(false); // [FIX] Track when availability check completes
  /**
   * The manager has been through the Availability & policies step, whether or not they set a
   * weekly schedule.
   *
   * Deliberately NOT folded into `hasAvailability`. That flag is DATA-DERIVED and the
   * `checkAvailability` effect re-runs whenever the kitchen list changes, setting it back to
   * false when nothing is open — so a "the manager accepted the policy defaults and moved on"
   * fact stored there would silently un-tick the step the next time a kitchen was added.
   * Overloading one flag with both meanings is the two-definitions shape this codebase keeps
   * getting bitten by.
   *
   * What it does NOT mean: that the kitchen is bookable. `hasAvailability` stays the only thing
   * that answers that, and it is what the dashboard's Getting Started checklist and the publish
   * readiness gate read. Onboarding ticks on a visit; going live still requires real hours.
   */
  const [availabilityStepCompleted, setAvailabilityStepCompleted] = useState(false);

  // Requirements State [NEW] - tracks if location_requirements record exists
  const [hasRequirements, setHasRequirements] = useState(false);
  const [isLoadingRequirements, setIsLoadingRequirements] = useState(false);

  // Multi-location State
  // [MULTI-LOCATION FIX] Initialize from URL param to survive context unmount/remount across route changes
  // When startNewLocation() navigates from /manager/dashboard to /manager/setup, the context
  // is destroyed and recreated (each route has its own ManagerProtectedRoute wrapper).
  // The URL param is the only signal that survives this transition.
  const [isAddingLocation, setIsAddingLocation] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('newLocation') === 'true';
    }
    return false;
  });

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
  // The two Stripe facts, both derived in `resolveStripeState` (see its note above).
  // `isStripeConnected` is the strict one the dashboard reads; `isStripeOnboardingComplete`
  // is the one this wizard gates on, and it is satisfied as soon as the manager has
  // submitted Stripe's form — so setup is not held open for Stripe's own review queue.
  const { connected: isStripeConnected, initiated: isStripeOnboardingComplete } =
    resolveStripeState(stripeConnectStatus);
  const [dbCompletedSteps, setDbCompletedSteps] = useState<Record<string, boolean>>({});

  /**
   * THE availability rule — see the context type for the full note.
   *
   * Derived here (after `dbCompletedSteps`, which it reads) so the rail tick, the step's own
   * "open on the review" decision and the setup summary cannot disagree. They did: the summary
   * was left reading `hasAvailability` alone, so a manager who skipped the schedule got a tick,
   * finished onboarding, and was then told by the summary AND the dashboard that availability
   * was still missing.
   *
   * The third term is the DURABLE one. `availabilityStepCompleted` is React state, so it dies
   * with the context — and the context remounts on the redirect that follows the payment step.
   * The manager saw the tick, went to payment, came back, and the tick had vanished, so the
   * step demanded the review all over again. The engine already POSTs the step's completion to
   * `/api/manager/onboarding/step` when the manager leaves the review, so `dbCompletedSteps`
   * holds it — reading it back is what makes "this step is behind you" outlast the component
   * that recorded it.
   */
  const isAvailabilityComplete = isAvailabilityStepBehindUs({
    hasAvailability,
    availabilityStepCompleted,
    dbCompletedSteps,
  });

  /*
   * The same three-signal shape, for the step after Availability.
   *
   * Declared here rather than inline at the checklist row so the rule has exactly one owner:
   * the rail tick, the stepper and anything added later all read this value, instead of each
   * re-deriving "is requirements done" from `hasRequirements` and drifting.
   */
  const isRequirementsComplete = isRequirementsStepBehindUs({
    hasRequirements,
    dbCompletedSteps,
  });

  // Normalize legacy numeric step keys to string format for UI consumption
  useEffect(() => {
    /*
     * The field is `managerOnboardingStepsCompleted` — camelCase, because Drizzle names the
     * column that way and `/api/user/profile` spreads the row straight out (`...safeUser`). The
     * snake_case spelling read here never matched anything, so this effect did nothing and
     * `dbCompletedSteps` stayed empty for the whole session. That is the mechanism behind "the
     * tick was there, and then it was gone": the step's completion was only ever held in React
     * state, and a remount (the redirect after the payment step does exactly that) lost it.
     *
     * Both spellings are accepted so a future shape change cannot silently empty this again.
     */
    const normalized = normalizeCompletedSteps(
      (userData?.managerOnboardingStepsCompleted ??
        userData?.manager_onboarding_steps_completed) as Record<string, boolean> | undefined,
    );
    /*
     * `null` means there was nothing to normalise. Keep what we already had rather than clearing
     * every tick because the profile query blinked — the old inline loop had the same guard, and it
     * is the difference between "no data yet" and "no steps done".
     *
     * The loop itself lives in `step-completion.ts` now, because the dashboard's reader needs the
     * identical normalisation and re-deriving it is how the two came to disagree.
     */
    if (normalized) setDbCompletedSteps(normalized);
  }, [userData]);

  // Derived State - declare BEFORE useMemo that depends on it
  const hasExistingLocation = !isLoadingLocations && locations.length > 0;
  const selectedLocation = locations.find((loc) => loc.id === selectedLocationId) as Location | undefined;

  // [ENTERPRISE] Compute completedSteps based on ACTUAL DATA existence ONLY
  // This ensures the sidebar shows correct completion state based on real conditions
  //
  // REQUIRED for bookings: Location, Kitchen listing, Availability, Requirements, Payment
  // (Equipment and Storage are optional parts OF the kitchen listing, not steps — they
  // never had a completion row here beyond "seen" tracking, which is gone with them.)
  //
  // NOTE: We do NOT include dbCompletedSteps here for required steps.
  // Required steps are ONLY marked complete when actual data exists.
  const completedSteps = useMemo((): Record<string, boolean> => {
    const result: Record<string, boolean> = {};

    /*
     * Welcome is complete when the manager has a location (they are past setup), or when they have
     * actually finished THIS step — recorded when they leave it.
     *
     * It deliberately does NOT read `has_seen_welcome`. That flag belongs to the standalone welcome
     * SCREEN, which is a different thing: a screen shown before the terms gate that introduces the
     * product. This is the wizard's own first STEP, which lists what setup involves and offers
     * "Let's start" / "Maybe later".
     *
     * Reading the SCREEN's flag here marked the STEP complete before the manager had ever seen it, so
     * the wizard skipped straight past it. And because that skip ran in an effect, the step was
     * painted for a frame first — which is the flash. It also made "Maybe later" unreachable, since
     * the manager was never given the chance to press it.
     *
     * `has_seen_welcome_screen` was the same mistake under a legacy name.
     */
    if (locations.length > 0 || dbCompletedSteps['welcome']) {
      result['welcome'] = true;
    }

    // Location is complete if location exists AND is selected AND carries the kitchen licence.
    //
    // It used to require the terms document as well. That upload moved to the Availability step
    // (2026-09-20), so keeping it here would mean the Business step could NEVER complete: the
    // manager uploads the licence, finishes the step, and the checklist never ticks it and its
    // review never opens. The licence is the only document this step still collects.
    // [ENTERPRISE FIX] Check both camelCase and snake_case field names for compatibility
    // Also check dbCompletedSteps as fallback for in-session completion before data refresh
    /*
     * The Business & licence step, decided by the rule that OWNS it.
     *
     * The log is kept — it is the fastest way to answer "why is this step ticked?" from a console —
     * but it is not part of the decision. The decision is `isLocationStepBehindUs`, so this surface
     * cannot restate it differently from the next one.
     */
    if (selectedLocationId && locations.length > 0) {
      const loc = locations.find(l => l.id === selectedLocationId) as any;
      logger.info('[completedSteps] Location check:', {
        selectedLocationId,
        locFound: !!loc,
        hasLicense: !!(loc?.kitchenLicenseUrl || loc?.kitchen_license_url),
        kitchenLicenseUrl: loc?.kitchenLicenseUrl,
        kitchen_license_url: loc?.kitchen_license_url,
        dbCompletedSteps: dbCompletedSteps['location']
      });
    }

    if (
      isLocationStepBehindUs({
        isLoadingLocations,
        selectedLocationId,
        locations,
        dbCompletedSteps,
        isAddingLocation,
      })
    ) {
      result['location'] = true;
    }

    // Kitchen Space is complete if kitchens exist for this location
    if (kitchens.length > 0) {
      result['create-kitchen'] = true;
    }

    // Application Requirements is done if a `location_requirements` row exists, OR the
    // manager has been through the step and reached its review. The rule lives in
    // `isRequirementsStepBehindUs` above — this surface must not restate it, or the next
    // surface will restate it differently.
    if (isRequirementsComplete) {
      result['application-requirements'] = true;
    }

    /*
     * Availability is complete when EITHER a real open day exists, OR the manager has been
     * through the step and reached its review.
     *
     * Two ways in, one meaning out — "this step is behind you". A schedule is one way to be
     * done with it; reading the policies and accepting the defaults is another, and it is the
     * one most managers take, because the policies are already filled in and a weekly schedule
     * is real work they may want to do from the dashboard instead.
     *
     * This tick is a PROGRESS GUIDE, not a bookability claim. `hasAvailability` alone still
     * answers "is there anything to book", and that is what the dashboard's Getting Started
     * checklist and the publish readiness gate read — a manager who skips the schedule will
     * still be told, where it matters, that the kitchen has no hours yet.
     *
     * The RULE lives in `isAvailabilityComplete` (declared above), which every surface reads —
     * this line used to be the only place that knew it, so the summary kept the stricter
     * `hasAvailability`-only version and contradicted the rail.
     */
    if (isAvailabilityComplete) {
      result['availability'] = true;
    }

    // Payment is complete if Stripe is connected
    if (isStripeOnboardingComplete) {
      result['payment-setup'] = true;
    }

    /*
     * The summary is a report, not a task — but it is still one of the required
     * rows, and nothing above ever marks it. Without this the counter could
     * never reach its own total: a manager who had done everything saw "6 of 7"
     * forever, and reasonably read the missing step as the licence still being
     * under review. Licence *approval* has never gated onboarding; uploading it
     * does. Completing the summary when everything it summarises is done makes
     * the total reachable and keeps it stable across reloads.
     */
    const TASK_STEP_IDS = [
      // No 'welcome': it is a screen, not a task, and it is trivially true by this point anyway.
      // Keeping it here made the Summary's own completion depend on a non-task.
      'location',
      'create-kitchen',
      'availability',
      'application-requirements',
      'payment-setup',
    ];
    if (TASK_STEP_IDS.every((id) => result[id])) {
      result['completion-summary'] = true;
    }

    return result;
  }, [locations, isLoadingLocations, selectedLocationId, kitchens.length,
    isRequirementsComplete, isAvailabilityComplete, isStripeOnboardingComplete,
    dbCompletedSteps, isAddingLocation]);

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

  /*
   * There used to be a second effect here that skipped Welcome by calling `next()`.
   * It is GONE, deliberately — do not reinstate it.
   *
   * It duplicated the enterprise auto-resume below, which already advances off any
   * completed step, and the two of them raced. `next()` moves the engine one step
   * forward ('welcome' → 'location'), while the resume effect bails out if the step
   * moved since entry — so whichever settled first decided where the manager landed.
   * When the location / kitchen / requirements fetches happened to resolve together
   * with the locations query, the manager was parked on the Business step no matter
   * which step they actually needed. That is the bug where the dashboard banner named
   * one step and the wizard opened another.
   *
   * One owner for the resume decision, and it is the effect below.
   */

  /*
   * The step this entry was asked for, from `?step=` on the URL.
   *
   * The dashboard's "Continue setup" banner knows which step is missing, so it says so
   * on the way in rather than letting the wizard derive it a second time. Two
   * derivations of the same answer is exactly how the banner came to name one step
   * while the wizard opened another. Read once, then removed from the URL so a refresh
   * starts from the manager's real position.
   */
  const [requestedStep] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const target = params.get('step');
    if (!target) return null;
    params.delete('step');
    const remaining = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (remaining ? `?${remaining}` : ''));
    return steps.some((step: any) => step.id === target) ? target : null;
  });

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

  // The phone the manager gave at registration.
  //
  // `users.phone_number` is the only place it lives — no account in this project has
  // ever linked a phone to Firebase — and the auth user already carries it, so this
  // costs no extra request. It fills the field for a brand-new location AND for one
  // whose stored contact phone is blank, because the number describes the MANAGER,
  // not the location.
  //
  // Guarded on emptiness only: once the field holds anything, including something the
  // manager typed, this never overwrites it.
  useEffect(() => {
    if (contactPhone || !firebaseUser?.phoneNumber) return;
    setContactPhone(firebaseUser.phoneNumber);
  }, [firebaseUser?.phoneNumber, contactPhone]);

  // Listen for manual trigger from Help Center or other parts of the app
  useEffect(() => {
    const handleOpenRequest = () => setIsOpen(true);

    window.addEventListener('open-onboarding-from-help', handleOpenRequest);

    return () => {
      window.removeEventListener('open-onboarding-from-help', handleOpenRequest);
    }
  }, [setIsOpen]);

  // Reset multi-location state when dialog CLOSES (transitions from open → closed)
  // [MULTI-LOCATION FIX] Use prev-value ref to only trigger on transition, NOT on mount.
  // On mount isOpen starts as false — the old code would immediately reset isAddingLocation,
  // wiping out the URL-param-based initialization before the auto-select effect could see it.
  const prevIsOpenRef = useRef(isOpen);
  useEffect(() => {
    if (prevIsOpenRef.current && !isOpen) {
      setIsAddingLocation(false);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  // [ENTERPRISE FIX] Reset auto-skip flag on mount and when wizard opens
  // This ensures auto-skip runs fresh each time user enters the wizard (dialog or page)
  useEffect(() => {
    // Reset on mount (handles page-based flow at /manager/setup)
    hasPerformedInitialAutoSkip.current = false;
    logger.info('[Onboarding] Component mounted - reset auto-skip flag');
  }, []); // Empty deps = runs once on mount

  useEffect(() => {
    if (isOpen) {
      hasPerformedInitialAutoSkip.current = false;
      logger.info('[Onboarding] Wizard dialog opened - reset auto-skip flag');
    }
  }, [isOpen]);

  // [MULTI-LOCATION FIX] On mount in new-location mode: skip welcome step, navigate engine
  // to 'location', and clean the URL param so a manual refresh starts fresh.
  const hasNavigatedNewLocationEngine = useRef(false);
  useEffect(() => {
    if (isAddingLocation && engine && !hasNavigatedNewLocationEngine.current) {
      hasNavigatedNewLocationEngine.current = true;
      engine.goToStep('location');
      // Clean URL param to prevent re-trigger on manual page refresh
      const url = new URL(window.location.href);
      if (url.searchParams.has('newLocation')) {
        url.searchParams.delete('newLocation');
        window.history.replaceState(null, '', url.pathname);
      }
      logger.info('[Onboarding] New location mode initialized — navigated engine to location step');
    }
  }, [isAddingLocation, engine]);


  // Auto-select location and initialize form state from existing data
  // [MULTI-LOCATION FIX] Skip when adding a new location — selectedLocationId is intentionally null
  // [MULTI-LOCATION FIX] Respect ?locationId=X URL param so "Continue Setup" opens the correct location
  useEffect(() => {
    if (!isLoadingLocations && hasExistingLocation && !selectedLocationId && locations.length > 0 && !isAddingLocation) {
      // Check URL param for a specific location to select (e.g., from "Continue Setup" or "Help Center")
      let loc: any = null;
      const params = new URLSearchParams(window.location.search);
      const locationIdFromUrl = params.get('locationId');
      if (locationIdFromUrl) {
        const targetId = parseInt(locationIdFromUrl, 10);
        loc = locations.find((l: any) => l.id === targetId) || null;
        // Clean up URL param after use — it's a one-time signal
        params.delete('locationId');
        const remaining = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (remaining ? `?${remaining}` : ''));
      }
      // Fall back to first location if no URL param or location not found
      if (!loc) {
        loc = locations[0] as any;
      }
      setSelectedLocationId(loc.id);
      setLocationName(loc.name || "");
      setLocationAddress(loc.address || "");
      setLocationLogoUrl(loc.logoUrl || loc.logo_url || "");
      /*
       * The ACCOUNT is the fallback when the record is silent — not `""`.
       *
       * The contact email belongs to the account (the field in the step is locked and read-only)
       * and the contact phone describes the MANAGER, so a location whose row never stored them
       * must still open with the values the manager registered with. Writing `""` here CLOBBERED
       * the two prefill effects above: they run earlier in the same commit, so this was the last
       * writer and it won — and the phone effect could not recover, because its own dependency
       * (`contactPhone`) had not changed from its point of view.
       *
       * What that cost: resuming the Business step with a location whose row carries no contact
       * details opened the contact part with a blank READ-ONLY email, so Continue was disabled
       * ("Add a contact email…") with no field to add it in. A dead end.
       *
       * The notification targets follow the contact details everywhere else (see
       * `LocationStep.partFields`), so they take the same fallback rather than seeding a form
       * that would write one value and display another.
       */
      const accountEmail = firebaseUser?.email || "";
      const accountPhone = firebaseUser?.phoneNumber || "";
      setNotificationEmail(loc.notificationEmail || loc.notification_email || accountEmail);
      setNotificationPhone(loc.notificationPhone || loc.notification_phone || accountPhone);
      // Contact fields
      setContactEmail(loc.contactEmail || loc.contact_email || accountEmail);
      setContactPhone(loc.contactPhone || loc.contact_phone || accountPhone);
      setPreferredContactMethod(loc.preferredContactMethod || loc.preferred_contact_method || "email");

      // [ENTERPRISE FIX] Initialize uploaded URLs from existing location data
      // This ensures that when returning to the Business step, files already on location
      // are recognized and won't trigger re-uploads or show as missing
      const existingLicenseUrl = loc.kitchenLicenseUrl || loc.kitchen_license_url;
      const existingTermsUrl = loc.kitchenTermsUrl || loc.kitchen_terms_url;
      const existingLicenseExpiry = loc.kitchenLicenseExpiry || loc.kitchen_license_expiry;
      
      if (existingLicenseUrl) {
        setLicenseUploadedUrl(existingLicenseUrl);
        licenseUploadedUrlRef.current = existingLicenseUrl; // Also set ref
      }
      if (existingTermsUrl) {
        setTermsUploadedUrl(existingTermsUrl);
        termsUploadedUrlRef.current = existingTermsUrl; // Also set ref
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

      logger.info('[Onboarding] Auto-selected location and initialized state:', {
        locationId: loc.id,
        hasLicenseUrl: !!existingLicenseUrl,
        hasTermsUrl: !!existingTermsUrl,
        licenseExpiry: existingLicenseExpiry
      });
    }
  }, [isLoadingLocations, hasExistingLocation, locations, selectedLocationId, isAddingLocation,
    firebaseUser?.email, firebaseUser?.phoneNumber]);

  // [ENTERPRISE FIX] Sync uploaded URLs from selectedLocation whenever location data changes
  // This ensures the form state reflects persisted data when user returns to setup page
  useEffect(() => {
    if (!selectedLocation) return;
    
    const loc = selectedLocation as any;
    const existingLicenseUrl = loc.kitchenLicenseUrl || loc.kitchen_license_url;
    const existingTermsUrl = loc.kitchenTermsUrl || loc.kitchen_terms_url;
    const existingLicenseExpiry = loc.kitchenLicenseExpiry || loc.kitchen_license_expiry;
    
    // Only update if we have URLs from the location and state is empty
    if (existingLicenseUrl && !licenseUploadedUrl) {
      setLicenseUploadedUrl(existingLicenseUrl);
      licenseUploadedUrlRef.current = existingLicenseUrl;
    }
    if (existingTermsUrl && !termsUploadedUrl) {
      setTermsUploadedUrl(existingTermsUrl);
      termsUploadedUrlRef.current = existingTermsUrl;
    }
    if (existingLicenseExpiry && !licenseExpiryDate) {
      const expiryDate = new Date(existingLicenseExpiry);
      if (!isNaN(expiryDate.getTime())) {
        setLicenseExpiryDate(expiryDate.toISOString().split('T')[0]);
      }
    }
  }, [selectedLocation, licenseUploadedUrl, termsUploadedUrl, licenseExpiryDate]);

  /**
   * Set the moment the user takes control of the wizard — Continue, Back, a
   * sidebar jump, a skip, or any successful save.
   *
   * Auto-resume exists to drop a *returning* manager on the first incomplete
   * step. Once they start driving, moving them again is the glitch, not the
   * feature — this flag is what stops it.
   */
  const isManualNavigation = useRef(false);

  /**
   * The step the wizard opened on. Auto-resume only fires while the user is
   * still there: if anything has moved them since, their position is
   * intentional and must not be undone.
   */
  const entryStepIdRef = useRef<string | null>(null);

  // Keep the entry step current until the user takes over. Recording it on every
  // render (rather than only at mount) tolerates the engine hydrating a frame or
  // two after mount, which would otherwise pin this to 'welcome' and silently
  // disable resume for everyone.
  useEffect(() => {
    if (isManualNavigation.current) return;
    if (currentStep?.id) entryStepIdRef.current = String(currentStep.id);
  }, [currentStep?.id]);

  // [ENTERPRISE] Auto-skip to first incomplete required step when returning
  // This provides a seamless UX where users jump directly to what needs attention
  //
  // REQUIRED for bookings: Location, Kitchen Space, Availability, Requirements, Payment
  // OPTIONAL: Equipment, Storage

  // Ref to track if we've already performed the initial auto-skip
  const hasPerformedInitialAutoSkip = useRef(false);

  // [ENTERPRISE FIX] Auto-skip to first incomplete step - runs ONCE when data is ready
  // We include completedSteps in deps but guard with hasPerformedInitialAutoSkip to run only once
  useEffect(() => {
    /*
     * One gate for "is the data this decision needs actually here", extracted so it can be tested —
     * see `resume-gate.ts`, which also records why a manager with NO location must NOT be blocked.
     * That block is what left a first-time manager parked on the welcome step for ever.
     */
    if (!engine) return;

    // [FIX] Only perform auto-skip logic ONCE per session (on initial load)
    // This prevents jarring auto-navigation when a user completes a step actively
    // or navigates between steps manually
    if (hasPerformedInitialAutoSkip.current) {
      return;
    }

    // The user has taken control (Continue, Back, a sidebar jump, a skip, or a
    // save). Auto-resume is a courtesy for a fresh entry, never a correction of
    // a deliberate position — bail and let them drive.
    if (isManualNavigation.current) {
      logger.info('[Onboarding] Auto-resume skipped: user has taken control');
      hasPerformedInitialAutoSkip.current = true;
      return;
    }

    const blockedBy = resumeBlockedBy({
      isLoadingLocations,
      isAddingLocation,
      locationCount: locations.length,
      selectedLocationId,
      kitchensLoaded,
      requirementsLoaded,
      availabilityLoaded,
      kitchenCount: kitchens.length,
    });
    if (blockedBy) {
      logger.info(`[Onboarding] Waiting for the resume decision: ${blockedBy}`);
      return;
    }

    // Get current step ID from engine state
    const currentId = currentStep?.id;
    if (!currentId) return;

    /*
     * An explicit target wins over everything below.
     *
     * The dashboard banner already worked out which step is missing and named it in
     * `?step=`. Re-deriving the same answer here is what let the banner say one thing
     * and the wizard do another, so when the caller has told us where to go we go
     * there and skip the guesswork. Placed before the entry-step check because that
     * check exists to stop the DERIVED resume from overriding a deliberate move —
     * this one IS the deliberate move.
     */
    if (requestedStep) {
      hasPerformedInitialAutoSkip.current = true;
      if (String(currentId) !== requestedStep) {
        logger.info(`[Onboarding] Opening the requested step: ${currentId} → ${requestedStep}`);
        engine.goToStep(requestedStep);
      }
      return;
    }

    // Anything that moved us off the entry step was deliberate. Without this,
    // a save that advanced the flow (e.g. creating the first kitchen) could be
    // followed by this effect firing late and yanking the user to another step.
    if (entryStepIdRef.current !== null && String(currentId) !== entryStepIdRef.current) {
      logger.info(`[Onboarding] Auto-resume skipped: step moved since entry (${entryStepIdRef.current} → ${currentId})`);
      hasPerformedInitialAutoSkip.current = true;
      return;
    }

    // [FIX] Wait for completedSteps to reflect the selected location data
    // This prevents race condition where auto-skip runs before completedSteps memo updates
    // Only wait if the location actually has the required data — the licence. The terms
    // document is collected in the Availability step now, so waiting on it here would stall
    // the auto-skip forever for anyone who has a licence but no terms on file yet.
    if (!completedSteps['location']) {
      const loc = locations.find(l => l.id === selectedLocationId) as any;
      const hasLicense = loc?.kitchenLicenseUrl || loc?.kitchen_license_url;

      // If the licence is on the record but completedSteps hasn't updated yet, wait
      if (hasLicense) {
        logger.info('[Onboarding] Waiting for completedSteps to reflect location data...');
        return;
      }
    }

    // Mark as performed IMMEDIATELY to prevent any re-runs
    hasPerformedInitialAutoSkip.current = true;

    // Use the LIVE completedSteps value (not ref) since we need the latest data
    // The hasPerformedInitialAutoSkip guard ensures this only runs once
    const currentCompletedSteps = completedSteps;

    logger.info(`[Onboarding] Auto-skip check - currentStep: ${currentId}, completedSteps:`, currentCompletedSteps);

    // Check if current step is already completed - if so, auto-navigate to first incomplete
    const isCurrentStepComplete = currentCompletedSteps[String(currentId)];

    // Find first incomplete REQUIRED step in order
    // Required for bookings: location -> kitchen -> availability -> requirements -> payment
    const requiredStepOrder = ['location', 'create-kitchen', 'availability', 'application-requirements', 'payment-setup', 'completion-summary'];

    // If current step is complete, find the first incomplete required step and navigate there
    if (isCurrentStepComplete) {
      for (const stepId of requiredStepOrder) {
        // If this step is incomplete, navigate to it
        if (!currentCompletedSteps[stepId]) {
          logger.info(`[Onboarding] Enterprise auto-skip: ${currentId} → ${stepId}`);
          engine.goToStep(stepId);
          return;
        }
      }

      // All required steps complete - advance to next step in sequence (even if optional)
      const currentIndex = steps.findIndex(s => s.id === currentId);
      if (currentIndex !== -1 && currentIndex < steps.length - 1) {
        const nextStep = steps[currentIndex + 1];
        if (nextStep && nextStep.id) {
          logger.info(`[Onboarding] Advancing from completed required step to: ${nextStep.id}`);
          engine.goToStep(nextStep.id);
          return;
        }
      }
    }

    logger.info(`[Onboarding] User on incomplete step: ${currentId}, staying here`);

  }, [engine, isLoadingLocations, selectedLocationId, isAddingLocation,
    kitchensLoaded, requirementsLoaded, availabilityLoaded, selectedKitchenId, kitchens.length, completedSteps, currentStep?.id, locations, requestedStep]);

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
            // Auto-select first kitchen so availability/listings can be checked
            // Works for 1 kitchen (obvious) and 2+ kitchens (gives a starting point)
            if (kData.length > 0 && !selectedKitchenId) setSelectedKitchenId(kData[0].id);
            if (kData.length === 0) setShowCreateKitchen(true);
          }
        } catch (e) {
          logger.error("Error loading kitchens", e);
        } finally {
          setIsLoadingKitchens(false);
          setKitchensLoaded(true);
        }
      };
      loadKitchens();
    }
  }, [selectedLocationId]);

  /**
   * Load both listing sets as soon as a kitchen is selected.
   *
   * These used to load only when their own step was on screen, which made
   * completion a function of having *visited* the step: a manager whose kitchen
   * already had storage and equipment saw both steps as incomplete until they
   * opened them, at which point the rows appeared and the progress jumped. The
   * completion memo reads these arrays, so they have to be populated up front —
   * two small requests, once per kitchen, instead of on every step change.
   */
  useEffect(() => {
    const loadListings = async () => {
      if (!selectedKitchenId) return;
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      const headers = { 'Authorization': `Bearer ${token}` };
      setIsLoadingStorage(true);
      setIsLoadingEquipment(true);
      try {
        const [storageRes, equipmentRes] = await Promise.all([
          fetch(`/api/manager/kitchens/${selectedKitchenId}/storage-listings`, { headers }),
          fetch(`/api/manager/kitchens/${selectedKitchenId}/equipment-listings`, { headers }),
        ]);
        if (storageRes.ok) setExistingStorageListings(await storageRes.json());
        if (equipmentRes.ok) setExistingEquipmentListings(await equipmentRes.json());
      } finally {
        setIsLoadingStorage(false);
        setIsLoadingEquipment(false);
      }
    };
    loadListings();
  }, [selectedKitchenId]);

  /*
   * Availability is a property of a KITCHEN, but this check belongs to the LOCATION's setup: the
   * question the step answers is "can a chef book something here yet". So it reads the same rule the
   * dashboard's setup checklist reads (`useOnboardingStatus`): true when ANY kitchen at this location
   * has at least one open day.
   *
   * It used to check `selectedKitchenId` alone. The kitchen list arrives in creation order and the
   * first one is auto-selected, so that was equivalent while a location had one kitchen — but the
   * list used to be newest-first, so adding a kitchen made the NEW, empty one the subject of this
   * check and flipped the step from done to not-done. Two definitions of one fact, disagreeing: the
   * dashboard would not have flipped, and the per-kitchen rule that actually matters lives in the
   * publish review, which refuses to list a kitchen with no opening hours.
   */
  const kitchenIds = kitchens.map((kitchen) => kitchen.id).join(",");
  useEffect(() => {
    const checkAvailability = async () => {
      if (kitchens.length === 0) {
        setHasAvailability(false);
        setAvailabilityLoaded(false); // Reset when the location has no kitchens
        return;
      }
      setIsLoadingAvailability(true);
      setAvailabilityLoaded(false); // Reset before loading
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;

        for (const kitchen of kitchens) {
          const res = await fetch(`/api/manager/availability/${kitchen.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (!res.ok) continue;
          const data = await res.json();
          // One open day anywhere is enough — this is the location's bookability, not one kitchen's.
          if (Array.isArray(data) && data.some((day: any) => day.isAvailable || day.is_available)) {
            setHasAvailability(true);
            return;
          }
        }
        setHasAvailability(false);
      } catch (e) {
        logger.error("Failed to check availability", e);
      } finally {
        setIsLoadingAvailability(false);
        setAvailabilityLoaded(true); // [FIX] Mark as loaded when check completes
      }
    };
    checkAvailability();
    // Keyed on the ids, not on `kitchens`: that array is a fresh one on every fetch.
  }, [kitchenIds]);

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
        logger.error("Failed to check requirements", e);
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
    // Completing a step is the clearest signal that the user is driving the
    // wizard — it fires on Continue (via the step-completed listener) and on
    // every save that advances the flow. From here on, auto-resume stands down.
    isManualNavigation.current = true;
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
      logger.error('[Onboarding] Failed to track step completion:', e);
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
      if (!res.ok) throw new Error(tt("uploadFailed"));
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
      if (!res.ok) throw new Error(tt("uploadFailed"));
      const data = await res.json();
      setLicenseUploadedUrl(data.url);
      licenseUploadedUrlRef.current = data.url; // Also set ref
      setLicenseFile(file);
      logger.info('[Onboarding] ✅ License file uploaded successfully:', data.url);
      return data.url;
    } catch (error) {
      setLicenseFile(null);
      setLicenseUploadedUrl(null);
      licenseUploadedUrlRef.current = null;
      throw error;
    } finally {
      setUploadingLicense(false);
    }
  };

  // Immediate upload function for terms file (called from LocationStep)
  const uploadTermsFile = async (file: File): Promise<string | null> => {
    logger.info('[Onboarding] uploadTermsFile called with:', file.name);
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
      if (!res.ok) {
        const errorText = await res.text();
        logger.error('[Onboarding] Terms upload failed:', res.status, errorText);
        throw new Error(tt("uploadFailed"));
      }
      const data = await res.json();
      logger.info('[Onboarding] ✅ Terms file uploaded successfully:', {
        url: data.url,
        fileName: data.fileName,
        size: data.size
      });
      setTermsUploadedUrl(data.url);
      termsUploadedUrlRef.current = data.url; // Also set ref to avoid stale closure
      setTermsFile(file);
      return data.url;
    } catch (error) {
      logger.error('[Onboarding] ❌ Terms upload error:', error);
      setTermsFile(null);
      setTermsUploadedUrl(null);
      termsUploadedUrlRef.current = null; // Also clear ref on error
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
  /**
   * Persist the whole location record. Resolves whether it succeeded, and NEVER advances.
   *
   * Advancing is the caller's job because the Business step's documents part saves through
   * this and then returns to its review screen, where the manager sees what they set before
   * moving on. `updateLocation` below is the advancing wrapper the wizard's own Continue
   * uses — one implementation, two entry points.
   */
  const persistLocation = async (): Promise<boolean> => {
    if (!locationName || !locationAddress) {
      toast({ title: mt("error"), description: mt("missingLocationDetails"), variant: "destructive" });
      return false;
    }

    // [GUARD 1] Prevent concurrent submissions
    if (isSubmitting) {
      logger.info('[Onboarding] ⚠️ Submission already in progress, ignoring duplicate click');
      return false;
    }

    // [GUARD 2] Generate unique submission ID for this request
    const thisSubmissionId = generateSubmissionId();
    submissionIdRef.current = thisSubmissionId;

    setIsSubmitting(true);

    try {
      logger.info('[Onboarding] updateLocation called', { 
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
      // [ENTERPRISE] Read from ref first (avoids stale closure), then fallback to state
      let licenseUrl = licenseUploadedUrlRef.current || licenseUploadedUrl;
      logger.info('[Onboarding] License URL sources:', {
        fromRef: licenseUploadedUrlRef.current,
        fromState: licenseUploadedUrl,
        usingUrl: licenseUrl
      });
      if (!licenseUrl && licenseFile) {
        // Only upload if not already uploaded
        if (!licenseExpiryDate) {
          toast({ title: mt("error"), description: mt("missingLicenseExpiry"), variant: "destructive" });
          setIsSubmitting(false);
          return false;
        }
        licenseUrl = await uploadLicense();
        logger.info('[Onboarding] License uploaded (fresh):', licenseUrl);
      } else if (licenseUrl) {
        logger.info('[Onboarding] Using pre-uploaded license URL:', licenseUrl);
      }

      // [FIX 2] Use already-uploaded terms URL if available
      // [ENTERPRISE] Read from ref first (avoids stale closure), then fallback to state
      let termsUrl = termsUploadedUrlRef.current || termsUploadedUrl;
      logger.info('[Onboarding] Terms URL sources:', {
        fromRef: termsUploadedUrlRef.current,
        fromState: termsUploadedUrl,
        usingUrl: termsUrl
      });
      
      // Also check if selectedLocation has terms (handles returning to step after save)
      if (!termsUrl && selectedLocationId && locations.length > 0) {
        const loc = locations.find(l => l.id === selectedLocationId) as any;
        termsUrl = loc?.kitchenTermsUrl || loc?.kitchen_terms_url || null;
        if (termsUrl) {
          logger.info('[Onboarding] Using terms URL from existing location:', termsUrl);
        }
      }
      
      if (!termsUrl && termsFile) {
        logger.info('[Onboarding] Uploading terms file (fresh):', termsFile.name);
        setUploadingTerms(true);
        const token = await auth.currentUser?.getIdToken();
        const formData = new FormData();
        formData.append("file", termsFile);
        const uploadRes = await fetch("/api/files/upload-file", {
          method: "POST",
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });
        if (!uploadRes.ok) throw new Error(tt("failedToUploadTerms"));
        const uploadResult = await uploadRes.json();
        termsUrl = uploadResult.url;
        setTermsUploadedUrl(termsUrl);
        logger.info('[Onboarding] Terms uploaded (fresh):', termsUrl);
        setUploadingTerms(false);
      } else if (termsUrl) {
        logger.info('[Onboarding] Using pre-uploaded terms URL:', termsUrl);
      }

      // [GUARD 3] Check if submission was superseded
      if (submissionIdRef.current !== thisSubmissionId) {
        logger.info('[Onboarding] ⚠️ Submission superseded, aborting:', thisSubmissionId);
        return false;
      }

      const token = await auth.currentUser?.getIdToken();

      let contactPhoneValidated = contactPhone;
      if (contactPhoneValidated) {
        const cp = optionalPhoneNumberSchema.safeParse(contactPhoneValidated);
        if (!cp.success) throw new Error(tt("invalidContactPhone"));
        contactPhoneValidated = cp.data || "";
      }

      // Notification targets follow the contact details.
      //
      // The Business step stopped asking for them when the Platform Notifications
      // card was removed, and its Preferred Contact Method row now says notifications
      // go to the contact email. Sending the old state instead would leave a location
      // notifying an address the manager can no longer see or change from this step —
      // and, for an existing location, would silently restore a value they had since
      // changed elsewhere.
      //
      // ponytail: `notificationEmail`/`notificationPhone` state survives only because
      // it is still mirrored here and loaded from the location. Delete both when the
      // columns are dropped.
      const body: any = {
        name: locationName,
        address: locationAddress,
        notificationEmail: contactEmail,
        notificationPhone: contactPhoneValidated,
        contactEmail,
        contactPhone: contactPhoneValidated,
        preferredContactMethod,
        logoUrl: locationLogoUrl,
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
      // [ENTERPRISE DEBUG] Log terms URL status for debugging
      logger.info('[Onboarding] Terms URL check:', {
        termsUrl,
        termsUploadedUrl,
        termsFile: termsFile?.name,
        hasTermsUrl: !!termsUrl
      });
      
      if (termsUrl) {
        body.kitchenTermsUrl = termsUrl;
        logger.info('[Onboarding] ✅ Including kitchenTermsUrl in body:', termsUrl);
      } else {
        logger.warn('[Onboarding] ⚠️ No terms URL to include - terms will not be saved!');
      }

      // [FIX 3] Robust POST vs PUT decision - check multiple sources to prevent duplicates
      // Priority: lastSubmittedLocationIdRef > selectedLocationId > first location in array
      // [MULTI-LOCATION FIX] When isAddingLocation is true, do NOT fall through to locations[0].id
      // — that would overwrite the first location instead of creating a new one
      const effectiveLocationId = 
        lastSubmittedLocationIdRef.current || 
        selectedLocationId || 
        (!isAddingLocation && locations.length > 0 ? locations[0].id : null);

      const shouldCreate = !effectiveLocationId;
      const endpoint = shouldCreate
        ? `/api/manager/locations`
        : `/api/manager/locations/${effectiveLocationId}`;
      const method = shouldCreate ? "POST" : "PUT";

      logger.info('[Onboarding] Request:', { 
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
      logger.info('[Onboarding] Response:', res.status, data);

      if (!res.ok) throw new Error(data.error || tt("failedToSaveLocation"));

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
                logoUrl: locationLogoUrl,
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
                logoUrl: locationLogoUrl,
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

      logger.info('[Onboarding] ✅ Cache updated optimistically with URLs:', { licenseUrl, termsUrl, savedLocationId });

      // [ENTERPRISE FIX] Track step completion FIRST - this sets dbCompletedSteps which triggers completedSteps recalculation
      await trackStepCompletion(currentStep?.id || 'location');

      // [ENTERPRISE FIX] Allow React to process state updates before navigation
      // This ensures completedSteps memo recalculates with new dbCompletedSteps value
      await new Promise(resolve => setTimeout(resolve, 50));

      // Now refetch to ensure server data is in sync (but UI already shows complete)
      queryClient.refetchQueries({ queryKey: ["/api/manager/locations"] });

      // [GUARD 4] Final check - ensure this submission wasn't superseded
      if (submissionIdRef.current !== thisSubmissionId) {
        logger.info('[Onboarding] ⚠️ Submission superseded before navigation, aborting:', thisSubmissionId);
        return false;
      }

      toast({ title: mt("success"), description: mt("locationSaved") });
      
      // Clear file state after successful save (files are now persisted to location)
      setLicenseFile(null);
      setTermsFile(null);
      
      return true;

    } catch (e: any) {
      logger.error('[Onboarding] Error in persistLocation:', e);
      toast({ title: mt("error"), description: e.message, variant: "destructive" });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Save the whole record and move the wizard on. The Continue the steps call. */
  const updateLocation = async () => {
    if (await persistLocation()) next();
  };

  /**
   * Persist a *subset* of the location's fields without advancing the wizard.
   *
   * The Business step is split into three parts that save as you go. Each part
   * sends only its own fields — `PUT /manager/locations/:id` applies an
   * `!== undefined` check per field, so anything omitted is left untouched. The
   * first part creates the location (the endpoint requires name + address, which
   * part one owns); later parts update it.
   *
   * Deliberately does NOT call `trackStepCompletion` or `next()`: the step is
   * only complete once the documents part is saved via `updateLocation`.
   */
  const saveLocationDraft = async (fields: Partial<LocationDraftFields>): Promise<boolean> => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return false;

      const effectiveLocationId =
        lastSubmittedLocationIdRef.current ||
        selectedLocationId ||
        (!isAddingLocation && locations.length > 0 ? locations[0].id : null);
      const shouldCreate = !effectiveLocationId;
      const endpoint = shouldCreate
        ? `/api/manager/locations`
        : `/api/manager/locations/${effectiveLocationId}`;

      const res = await fetch(endpoint, {
        method: shouldCreate ? "POST" : "PUT",
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || tt("failedToSaveLocation"));
      }
      const saved = await res.json();
      const savedLocationId = saved?.id || effectiveLocationId;
      if (savedLocationId) {
        lastSubmittedLocationIdRef.current = savedLocationId;
        if (shouldCreate) setSelectedLocationId(savedLocationId);
      }

      // Keep the list in sync so returning to an earlier part shows what was saved.
      queryClient.setQueryData(["/api/manager/locations"], (oldData: any) => {
        if (!Array.isArray(oldData)) return oldData;
        const exists = oldData.some((loc: any) => loc.id === savedLocationId);
        if (!exists) return [...oldData, saved];
        return oldData.map((loc: any) =>
          loc.id === savedLocationId ? { ...loc, ...fields } : loc
        );
      });

      return true;
    } catch (e: any) {
      logger.error('[Onboarding] Error in saveLocationDraft:', e);
      toast({ title: mt("error"), description: e.message, variant: "destructive" });
      return false;
    }
  };

  /**
   * Create the kitchen, and REPORT whether it happened.
   *
   * It used to return nothing and swallow every failure into a toast, which the caller could not
   * tell apart from success — so the step advanced to Equipment either way. With no kitchen, that
   * part renders "No kitchen selected"; and Back from it lands on the step's EMPTY STATE, because
   * the create form had been closed (its flag cleared) while `kitchens` was still empty. The
   * manager was left on a dead end whose only offer was to create the kitchen they had just
   * finished describing, with nothing on screen saying what went wrong.
   *
   * Same shape as `persistLocation`: do the work, return a boolean, and let the CALLER decide
   * whether it may move on. The toast is not a return value.
   */
  const createKitchen = async (): Promise<boolean> => {
    /*
     * Not a silent `return`. Every later step needs a kitchen, so this is a real failure and the
     * manager has to hear about it — the previous bare return looked exactly like success.
     */
    if (!selectedLocationId) {
      toast({
        title: mt("error"),
        description: mt("pleaseCreateALocationFirst"),
        variant: "destructive",
      });
      return false;
    }
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
          imageUrl: kitchenFormData.imageUrl || undefined,
          features: kitchenFormData.features,
          /*
           * A blank hourly rate must go as `undefined`, not as a computed NaN.
           *
           * `parseFloat('')` is NaN, `Math.round(NaN)` is NaN, and `JSON.stringify` turns NaN into
           * `null` — which the endpoint rejects ("Hourly rate must be nonnegative integer cents"),
           * because `null !== undefined`. So a kitchen priced ONLY by the day could not be created
           * at all: the manager set a daily rate, and the request carried a broken hourly one.
           *
           * The listing gate accepts either rate (`listingReq_rate` is "Hourly or daily rate"), so
           * sending no hourly rate is a real answer, not a missing one — exactly how `dailyRate`
           * below already behaves.
           */
          hourlyRate: kitchenFormData.hourlyRate.trim() === ''
            ? undefined
            : Math.round(parseFloat(kitchenFormData.hourlyRate) * 100),
          // Optional: a kitchen can be priced hourly, daily, or both.
          dailyRate: kitchenFormData.dailyRate.trim() === ''
            ? undefined
            : Math.round(parseFloat(kitchenFormData.dailyRate) * 100),
          currency: kitchenFormData.currency,
          // `|| 0` sent a blank field to the database as a REAL zero — a minimum booking of
          // nothing, which is the absence of the setting rather than a value. One hour is
          // the floor everywhere else, so it is the fallback here too.
          minimumBookingHours: Math.max(1, parseInt(kitchenFormData.minimumBookingHours, 10) || 1),
        })
      });
      if (!res.ok) throw new Error(tt("failedToCreateKitchen"));
      const newKitchen = await res.json();

      setKitchens([...kitchens, newKitchen]);
      setSelectedKitchenId(newKitchen.id);
      setShowCreateKitchen(false);
      setKitchenFormData({ name: '', description: '', hourlyRate: '', dailyRate: '', currency: 'CAD', minimumBookingHours: '1', imageUrl: '', features: [] });

      await trackStepCompletion(currentStep?.id || 'create-kitchen');
      toast({ title: mt("success"), description: mt("kitchenCreated2") });
      // next(); // [FIX] Do not auto-advance. Let user click Next to avoid race conditions with checks.
      return true;
    } catch (e: any) {
      toast({ title: mt("error"), description: e.message, variant: "destructive" });
      return false;
    } finally {
      setCreatingKitchen(false);
    }
  };

  /**
   * Save edits to a kitchen created earlier in this flow.
   *
   * Three endpoints own the fields being edited — details (name/description),
   * pricing (rates/minimum) and the cover image — so this fans out and reports
   * the merged kitchen. Editing stays inside onboarding: sending a manager to the
   * dashboard mid-setup loses the wizard's place.
   */
  const updateKitchen = async (
    kitchenId: number,
    data: {
      name: string;
      description: string;
      hourlyRate: string;
      dailyRate: string;
      minimumBookingHours: string;
      imageUrl: string;
    },
  ) => {
    const token = await auth.currentUser?.getIdToken();
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const toCents = (value: string) => {
      const parsed = parseFloat(value);
      return value.trim() === '' || isNaN(parsed) ? null : Math.round(parsed * 100);
    };

    const detailsRes = await fetch(`/api/manager/kitchens/${kitchenId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name: data.name, description: data.description }),
    });
    if (!detailsRes.ok) {
      throw new Error((await detailsRes.json().catch(() => ({}))).error || tt("failedToCreateKitchen"));
    }
    const updated = await detailsRes.json();

    const pricingRes = await fetch(`/api/manager/kitchens/${kitchenId}/pricing`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        hourlyRate: toCents(data.hourlyRate),
        dailyRate: toCents(data.dailyRate),
        currency: 'CAD',
        minimumBookingHours: parseInt(data.minimumBookingHours, 10) || 0,
      }),
    });
    if (!pricingRes.ok) {
      throw new Error((await pricingRes.json().catch(() => ({}))).error || tt("failedToCreateKitchen"));
    }
    const priced = await pricingRes.json();

    if (data.imageUrl !== undefined) {
      const imageRes = await fetch(`/api/manager/kitchens/${kitchenId}/image`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ imageUrl: data.imageUrl || null }),
      });
      if (!imageRes.ok) {
        throw new Error((await imageRes.json().catch(() => ({}))).error || tt("failedToCreateKitchen"));
      }
    }

    const merged = { ...updated, ...priced, imageUrl: data.imageUrl };
    setKitchens((prev) => prev.map((k: any) => (k.id === kitchenId ? { ...k, ...merged } : k)));
    return merged;
  };

  // --- Event Listeners ---
  // --- Event Listeners ---
  useEffect(() => {
    if (!engine) return;

    // Listen for step completion to track progress and auto-save
    const unsubscribeStepCompleted = engine.addStepCompletedListener(async (event: any) => {
      const stepId = event.step?.id;
      logger.info('✅ Step Completed:', stepId);

      // Persist step completion
      if (stepId) {
        await trackStepCompletion(stepId);
      }

      // NOTE: Location save is handled in handleNextAction, NOT here
      // to prevent double next() calls that skip steps
    });

    // Listen for flow completion
    const unsubscribeFlowCompleted = engine.addFlowCompletedListener(async () => {
      logger.info('🎉 Flow Complete');
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
      /*
       * Continue on a Business step that holds nothing new must not write.
       *
       * This used to call `updateLocation()` unconditionally — a full PUT, plus any
       * outstanding file upload — every single time, including when a manager simply
       * stepped back into a finished step and pressed Continue. That round-trip is what
       * made revisiting the step feel like it was setting the location up again. The
       * part-level saves already persist everything as it changes, so a clean step has
       * nothing left to write.
       */
      if (!hasUnsavedChanges) {
        next();
        return;
      }
      await updateLocation();
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
      setIsAddingLocation(false); // [MULTI-LOCATION FIX] Reset flag so auto-select works again
      onboardSkip();
      toast({ title: mt("flowCompleted"), description: mt("allSet") });
    } catch (e) {
      logger.error("Onboarding flow error", e);
    }
  };

  const [currentPath, setLocation] = useLocation();

  // [MULTI-LOCATION FIX] Reset isAddingLocation when navigating away from setup page
  // This catches ALL exit scenarios: CompletionSummary "Go to Dashboard", browser back, direct URL, etc.
  useEffect(() => {
    if (isAddingLocation && !currentPath.startsWith('/manager/setup')) {
      setIsAddingLocation(false);
      logger.info('[Onboarding] Reset isAddingLocation - navigated away from setup page');
    }
  }, [currentPath, isAddingLocation]);

  // --- Unsaved-changes guard -------------------------------------------------
  // One place decides whether a navigation may proceed, so the wizard offers the
  // same three-way choice (keep editing / discard / save) as the dashboard tabs.
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<{ run: () => void } | null>(null);
  const [isSavingBeforeLeave, setIsSavingBeforeLeave] = useState(false);
  const stepSaveRef = useRef<(() => Promise<boolean>) | null>(null);

  const registerStepSave = useCallback((save: (() => Promise<boolean>) | null) => {
    stepSaveRef.current = save;
  }, []);

  /** Intercept a navigation while the current step still holds edits. */
  const guardLeave = useCallback((run: () => void) => {
    if (!hasUnsavedChanges) {
      run();
      return;
    }
    setPendingLeave({ run });
  }, [hasUnsavedChanges]);

  const clearPendingLeave = useCallback(() => setPendingLeave(null), []);

  const discardAndLeave = useCallback(() => {
    const run = pendingLeave?.run;
    setPendingLeave(null);
    setHasUnsavedChanges(false);
    run?.();
  }, [pendingLeave]);

  const saveAndLeave = useCallback(async () => {
    const save = stepSaveRef.current;
    if (!save) {
      // Nothing to persist (the step saves by navigating) — just leave.
      discardAndLeave();
      return;
    }
    setIsSavingBeforeLeave(true);
    try {
      const saved = await save();
      if (!saved) return; // the step reported failure; keep the choice on screen
      const run = pendingLeave?.run;
      setPendingLeave(null);
      setHasUnsavedChanges(false);
      run?.();
    } finally {
      setIsSavingBeforeLeave(false);
    }
  }, [pendingLeave, discardAndLeave]);

  // A step's dirty state belongs to that step alone.
  useEffect(() => {
    setHasUnsavedChanges(false);
    stepSaveRef.current = null;
  }, [currentStep?.id]);

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
      guardLeave(() => {
        isManualNavigation.current = true;
        previous();
      });
    },
    handleSkip: handleSkipAction,
    skipCurrentStep: async () => {
      // Skip to next step without marking current as complete
      guardLeave(() => {
        if (engine) {
          isManualNavigation.current = true;
          logger.info(`[Onboarding] Skipping step: ${currentStep?.id}`);
          next(); // Move to next step without completion tracking
        }
      });
    },
    goToStep: async (stepId: string) => {
      guardLeave(() => {
        if (engine) {
          isManualNavigation.current = true;
          logger.info(`[Onboarding] Navigating directly to step: ${stepId}`);
          void engine.goToStep(stepId);
        }
      });
    },

    // --- Unsaved-changes guard ---
    hasUnsavedChanges,
    setUnsavedChanges: setHasUnsavedChanges,
    registerStepSave,
    pendingLeave,
    clearPendingLeave,
    saveAndLeave,
    discardAndLeave,
    isSavingBeforeLeave,

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
    isStripeConnected,
    hasAvailability,
    isAvailabilityComplete,
    availabilityStepCompleted,
    setAvailabilityStepCompleted,
    trackStepCompletion,
    isRequirementsComplete,
    availabilityLoaded,
    kitchensLoaded,
    refreshAvailability: async () => {
      // The same LOCATION-scoped rule as the check above. A save can therefore only ever turn the
      // step ON — which is the point: finishing a step must not be undone by a later kitchen.
      if (kitchens.length === 0) return;
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        for (const kitchen of kitchens) {
          const res = await fetch(`/api/manager/availability/${kitchen.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (!res.ok) continue;
          const data = await res.json();
          if (Array.isArray(data) && data.some((day: any) => day.isAvailable || day.is_available)) {
            setHasAvailability(true);
            return;
          }
        }
      } catch (e) {
        logger.error("Failed to refresh availability", e);
      }
    },
    refreshLocation: async () => {
      // `selectedLocation` is `locations.find(...)`, and `locations` is the
      // `["/api/manager/locations"]` query — so re-reading that ONE key is what makes every
      // reader of `selectedLocation` (the review's policy rows, the embedded BookingRules-
      // Settings' own `location` prop and its dirty check) agree with the server again.
      await queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
    },
    hasRequirements,
    requirementsLoaded,
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
          // Default payload (no row yet) returns id: -1, so a truthiness check would
          // wrongly mark the step complete. Must match the initial check above.
          setHasRequirements(!!data && Number(data.id) > 0);
        }
      } catch (e) {
        logger.error("Failed to refresh requirements", e);
      }
    },

    locationForm: {
      name: locationName, setName: setLocationName,
      address: locationAddress, setAddress: setLocationAddress,
      notificationEmail, setNotificationEmail,
      notificationPhone, setNotificationPhone,
      contactEmail, setContactEmail,
      contactPhone, setContactPhone,
      preferredContactMethod, setPreferredContactMethod,
      logoUrl: locationLogoUrl, setLogoUrl: setLocationLogoUrl,
    },
    licenseForm: {
      file: licenseFile, setFile: setLicenseFile,
      expiryDate: licenseExpiryDate, setExpiryDate: setLicenseExpiryDate,
      isUploading: uploadingLicense,
      uploadedUrl: licenseUploadedUrl,
      uploadFile: uploadLicenseFile
    },
    // ponytail: the terms upload UI moved to the Availability step (BookingRulesSettings owns
    // it there), so nothing calls `setFile`/`uploadFile` on this surface any more and `termsFile`
    // is always null. It is deliberately left in place because `saveLocationFull` still READS it:
    // it resolves the stored `kitchenTermsUrl` and re-sends it, which is what stops a Business-step
    // save from looking like a deliberate removal of the terms. Collapse this surface (and the
    // now-unreachable fresh-upload branch in `saveLocationFull`) when someone next opens that file.
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
    updateKitchen,
    storageForm: { 
      listings: existingStorageListings, 
      isLoading: isLoadingStorage,
      /*
       * Re-reads storage for a kitchen. Takes the id explicitly rather than closing over
       * `selectedKitchenId`: the onboarding step knows which kitchen it is working on
       * (`selectedKitchenId ?? kitchens[0]?.id`) and can be rendered a frame before the
       * provider's auto-select lands, so a guard on the provider's own state made this a
       * silent no-op exactly when it was needed — the review would then stay stale, which
       * is the bug it exists to fix.
       */
      refresh: async (kitchenId?: number) => {
        const id = kitchenId ?? selectedKitchenId;
        if (!id) return;
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        setIsLoadingStorage(true);
        try {
          const res = await fetch(`/api/manager/kitchens/${id}/storage-listings`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) setExistingStorageListings(await res.json());
        } finally { setIsLoadingStorage(false); }
      }
    },
    equipmentForm: { 
      listings: existingEquipmentListings, 
      isLoading: isLoadingEquipment,
      /** See the note on `storageForm.refresh` — the id is explicit for the same reason. */
      refresh: async (kitchenId?: number) => {
        const id = kitchenId ?? selectedKitchenId;
        if (!id) return;
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        setIsLoadingEquipment(true);
        try {
          const res = await fetch(`/api/manager/kitchens/${id}/equipment-listings`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) setExistingEquipmentListings(await res.json());
        } finally { setIsLoadingEquipment(false); }
      }
    },

    updateLocation, createKitchen, uploadLicense, saveLocationDraft, saveLocationFull: persistLocation,
    
    // [ENTERPRISE] Save and Exit - Persists current step progress and navigates to dashboard
    // This allows users to exit at ANY step (including welcome) and resume later
    saveAndExit: async () => {
      try {
        const token = await auth.currentUser?.getIdToken();

        const stepId = currentStep?.id;
        logger.info('[Onboarding] Save & Exit from step:', stepId);

        /*
         * WRITE THE PART THE MANAGER IS ON, BEFORE LEAVING.
         *
         * This is the button's own promise. `OnboardingNavigationFooter` names it "Save & exit"
         * exactly while `hasUnsavedWork` is true, and this function used to answer that by
         * writing only the step record and navigating — so everything typed into the part was
         * silently dropped. A manager who filled in the contact details, pressed "Save & exit"
         * and came back found an empty form for a step the wizard now called done.
         *
         * The step registers the callback for precisely this (`registerStepSave`), and Back,
         * Skip and jump-to-step already go through it via `guardLeave`. The exit was the one
         * path that did not.
         *
         * A failed save does NOT navigate. The step has already told the manager why, and
         * leaving would discard work they believe was written — the opposite of what the label
         * just offered. The `catch` below still navigates, because a throw here is not the step
         * reporting a problem; it is the exit itself failing, and trapping the manager in the
         * wizard is worse.
         */
        if (hasUnsavedChanges && stepSaveRef.current) {
          setIsSubmitting(true);
          try {
            const saved = await stepSaveRef.current();
            if (!saved) return;
          } finally {
            setIsSubmitting(false);
          }
        }

        /*
         * WHICH KEY TO RECORD — and why it is not simply "the step I am on".
         *
         * One write was answering two different questions:
         *
         *   "Has this manager started onboarding?"  `ManagerProtectedRoute` reads the record's
         *     NON-EMPTINESS and only then lets them reach the dashboard. Skipping the write
         *     entirely therefore TRAPPED a manager on the welcome step: "Maybe later" went to the
         *     dashboard, which redirected straight back to /manager/setup because no step had ever
         *     been recorded — and pressing it again did the same thing, so the welcome screen
         *     appeared twice in a row. That trap is why this write became unconditional, and it
         *     must not come back.
         *
         *   "Is this step finished?"  Every progress surface reads the KEY, and writing it on the
         *     way out answered "I was here" instead. That is a different fact, and it is why
         *     opening Availability or Booking Requirements and leaving ticked them off without the
         *     manager ever reaching their review — the auto-completion that made the dashboard look
         *     like it was making progress on its own. It also split the two readers of the Business
         *     step: the wizard's rail ORs this flag into a licence check the dashboard's banner
         *     cannot see, so the two disagreed about the same manager.
         *
         * So the key is written only when the step IS complete, and `welcome` — which is honestly
         * what "started onboarding" means — is written when the manager has no location yet and so
         * has no step that could be complete. The dashboard still lets them in, and nothing is
         * ticked that was not done.
         *
         * `completedSteps` is the right test for "complete", because it is the one every surface
         * already reads — including the rail and the banner. Using it here is what keeps the three
         * of them from disagreeing.
         *
         * The BUTTON is what must not overpromise, and it does not: its label follows
         * `hasUnsavedChanges`, so a formless step offers "Maybe later" rather than "Save & exit".
         */
        const recordedStepId: string | number | null =
          stepId && completedSteps[stepId]
            ? stepId
            : locations.length === 0 ? 'welcome' : null;

        if (recordedStepId) {
          const response = await fetch("/api/manager/onboarding/step", {
            method: "POST",
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
              stepId: recordedStepId, 
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
                  [recordedStepId]: true
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
                  [recordedStepId]: true
                }
              };
            });

            logger.info('[Onboarding] ✅ Optimistically updated user profile with step:', recordedStepId);
          }
        }

        // 2. Allow React to process cache updates before navigation
        await new Promise(resolve => setTimeout(resolve, 50));

        // 3. Refetch in background to ensure server sync (but UI already updated)
        queryClient.refetchQueries({ queryKey: ["/api/user/profile"] });
        queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });

        toast({ title: mt("progressSaved"), 
          description: mt("youCanContinueSetupAnytimeFromWhereYouLeftOff") 
        });

        // 4. Reset multi-location flag and navigate to dashboard with locationId
        // so the dashboard auto-selects the location we were just working on
        setIsAddingLocation(false);
        const locId = selectedLocationId || lastSubmittedLocationIdRef.current;
        setLocation(locId ? `/manager/dashboard?locationId=${locId}` : '/manager/dashboard');

      } catch (error) {
        logger.error('[Onboarding] Error in saveAndExit:', error);
        // Still navigate even if save fails - don't trap the user
        setIsAddingLocation(false);
        const locId = selectedLocationId || lastSubmittedLocationIdRef.current;
        setLocation(locId ? `/manager/dashboard?locationId=${locId}` : '/manager/dashboard');
      }
    },
    
    startNewLocation: () => {
      // --- 1. Clear ALL form state ---
      setSelectedLocationId(null);
      setLocationName("");
      setLocationAddress("");
      setLocationLogoUrl("");
      const accountEmail = firebaseUser?.email || "";
      setNotificationEmail(accountEmail);
      setNotificationPhone("");
      setContactEmail(accountEmail);
      setContactPhone("");
      setPreferredContactMethod("email");
      setLicenseFile(null);
      setLicenseExpiryDate("");
      setLicenseUploadedUrl(null);
      licenseUploadedUrlRef.current = null;
      setTermsFile(null);
      setTermsUploadedUrl(null);
      termsUploadedUrlRef.current = null;

      // --- 2. Clear ALL domain state (kitchens, listings, availability, requirements) ---
      setKitchens([]);
      setSelectedKitchenId(null);
      setKitchensLoaded(false);
      setShowCreateKitchen(false);
      setKitchenFormData({ name: '', description: '', hourlyRate: '', dailyRate: '', currency: 'CAD', minimumBookingHours: '1', imageUrl: '', features: [] });
      setExistingStorageListings([]);
      setExistingEquipmentListings([]);
      setHasAvailability(false);
      setAvailabilityStepCompleted(false);
      setAvailabilityLoaded(false);
      setHasRequirements(false);
      setRequirementsLoaded(false);

      // --- 3. Clear completion tracking so old location's state doesn't bleed through ---
      setDbCompletedSteps({});

      // --- 4. Reset submission tracking ---
      lastSubmittedLocationIdRef.current = null;
      submissionIdRef.current = null;

      // --- 5. Set multi-location flag BEFORE engine reset ---
      setIsAddingLocation(true);

      // --- 6. Reset auto-skip refs so fresh navigation logic runs ---
      hasPerformedInitialAutoSkip.current = false;

      // --- 7. Reset OnboardJS engine and navigate to 'location' step (skip welcome for secondary locations) ---
      if (engine) {
        engine.reset().then(() => {
          engine.goToStep('location');
        });
      }

      // --- 8. Navigate to setup page with newLocation URL param ---
      // The URL param survives the context unmount/remount that occurs on route change
      // (each route has its own ManagerProtectedRoute → ManagerOnboardingProvider tree)
      setLocation('/manager/setup?newLocation=true');
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
  if (!context) throw new Error(mt("useManagerOnboardingWithinProvider"));
  return context;
};
