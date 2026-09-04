import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { useShopStatus } from "@/components/chef/seller-revenue/hooks/useSellerRevenue";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { useChefKitchenApplications } from "@/hooks/use-chef-kitchen-applications";
import ChatPanel from "@/components/chat/ChatPanel";
import UnifiedChatView from "@/components/chat/UnifiedChatView";
import { useSubdomain } from "@/hooks/use-subdomain";
import { getRequiredSubdomainForRole, getSubdomainOriginForEnvironment } from "@shared/subdomain-utils";
import ChefBookingsView from "@/components/booking/ChefBookingsView";
import { PendingStorageExtensions } from "@/components/booking/PendingStorageExtensions";
import { useKitchenBookings } from "@/hooks/use-kitchen-bookings";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import ChefCommandPalette from "@/components/chef/ChefCommandPalette";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  CardDescription,
} from "@/components/ui/card";
import {
  formatApplicationStatus
} from "@/lib/applicationSchema";
import { queryClient } from "@/lib/queryClient";
import { Application, UserWithFlags } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  CheckCircle,
  ChefHat,
  Shield,
  AlertCircle,
  MessageCircle,
  CreditCard,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useMemo, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useCustomAlerts } from "@/components/ui/custom-alerts";
import { useChefOnboardingStatus } from "@/hooks/use-chef-onboarding-status";
import KitchenDiscovery from "@/components/kitchen-application/KitchenDiscovery";
import { requestDiscoverKitchensWalkthrough } from "@/components/kitchen-application/DiscoverKitchensButtonTour";
import TrainingOverviewPanel from "@/components/training/TrainingOverviewPanel";
import ApplicationFormPanel from "@/components/application/ApplicationFormPanel";
import ChefSupportPage from "@/components/chef/ChefSupportPage";
import { IssuesAndRefunds } from "@/components/chef/IssuesAndRefunds";
import { TransactionHistory } from "@/components/chef/TransactionHistory";
import { useChefResolutionCenter } from "@/hooks/use-chef-resolution-center";
import { useChefSidebarHiddenItems } from "@/hooks/use-chef-sidebar-hidden-items";
import TidioController from "@/components/chat/TidioController";
import OutstandingDuesBanner from "@/components/chef/OutstandingDuesBanner";
import ChefProfileSettings from "@/components/chef/ChefProfileSettings";
import ChefSellerRevenue from "@/components/chef/seller-revenue/ChefSellerRevenue";
import ChefSellerAccount from "@/components/chef/ChefSellerAccount";
import { useDocumentVerification } from "@/hooks/use-document-verification";
import { applicationStatusVariant, hasStep2BeenSubmitted } from "@/components/chef/applications/status";
import { ChefPageHeader } from "@/components/chef/ui";
import { useTranslation } from "react-i18next";
import { tt } from "@/i18n/common-ns";
import {
  OverviewTabContent,
  MyKitchensTabContent,
  DocumentVerificationView,
  SellerApplicationTabContent,
  type PublicKitchen,
  type KitchenApplicationWithLocation,
  type BookingLocation,
  getTrainingStatusLabel,
} from "@/components/chef/dashboard";

// Type alias for application
type AnyApplication = Application;


export default function ApplicantDashboard() {
  const { user: authUser } = useFirebaseAuth();
  const { t } = useTranslation("chef");
  const user = authUser as UserWithFlags | null;
  const [showVendorPortalPopup, setShowVendorPortalPopup] = useState(false);
  const [showChatDialog, setShowChatDialog] = useState(false);

  // Chef onboarding status for "Continue Setup" banner
  const { showSetupBanner } = useChefOnboardingStatus();
  const { hasAnyItems: hasResolutionItems, pendingDamageClaims, pendingPenalties } = useChefResolutionCenter();
  const sidebarHiddenItems = useChefSidebarHiddenItems();
  const hasKitchenMessages = !sidebarHiddenItems.includes("messages");
  const [chatApplication, setChatApplication] = useState<any | null>(null);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const subdomain = useSubdomain();
  const [location, navigate] = useLocation();

  // Parse view from URL query parameter (e.g., /dashboard?view=messages)
  const getInitialTab = () => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    if (view && ['overview', 'applications', 'kitchen-applications', 'discover-kitchens', 'viewings', 'bookings', 'training', 'messages', 'support', 'feedback', 'seller-revenue', 'my-account', 'transactions', 'issues-refunds'].includes(view)) {
      return view;
    }
    return 'overview';
  };

  const [activeTab, setActiveTabState] = useState(getInitialTab);

  // Sync URL when tab changes (makes tabs bookmarkable AND adds an entry to
  // browser history so the back button walks through the user's tab journey
  // instead of always returning to whatever tab was last "stuck" on the URL).
  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    const url = new URL(window.location.href);
    if (tab === 'overview') {
      url.searchParams.delete('view');
    } else {
      url.searchParams.set('view', tab);
    }
    const nextUrl = url.toString();
    // Avoid pushing duplicate entries for the same URL
    if (nextUrl !== window.location.href) {
      window.history.pushState({}, '', nextUrl);
    }
  };

  // Application form view mode - 'list' shows applications, 'form' shows the application form, 'documents' shows document verification
  const [applicationViewMode, setApplicationViewMode] = useState<'list' | 'form' | 'documents'>('list');

  // Training view mode - 'overview' shows training overview, 'player' shows the video player
  const [trainingViewMode, setTrainingViewMode] = useState<'overview' | 'player'>('overview');

  // Update activeTab and applicationViewMode when URL changes (for notification clicks and deep links).
  // Note: wouter's `location` only tracks the pathname, so search-param-only
  // changes (e.g. ?view=bookings → ?view=settings via pushState) don't trigger
  // a re-run. We also listen for `popstate` so back/forward correctly walks
  // through tabs we pushed onto history.
  useEffect(() => {
    const VALID_VIEWS = [
      'overview', 'applications', 'kitchen-applications', 'discover-kitchens',
      'viewings', 'bookings', 'training', 'messages', 'support', 'feedback',
      'damage-claims', 'issues-refunds', 'profile', 'seller-revenue', 'my-account', 'transactions'
    ];
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view');
      const action = params.get('action');

      if (view && VALID_VIEWS.includes(view)) {
        setActiveTabState(view === 'damage-claims' ? 'issues-refunds' : view);

        // If navigating to applications with action=new, open the form
        if (view === 'applications' && action === 'new') {
          setApplicationViewMode('form');
        }
        // If navigating to applications with action=documents, open document verification
        if (view === 'applications' && action === 'documents') {
          setApplicationViewMode('documents');
        }
      } else if (!view) {
        // No ?view param — user is on the bare /dashboard URL (e.g. after
        // walking back through the pushed history). Snap back to overview.
        setActiveTabState('overview');
      }
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [location]);

  // Booking navigation helper
  const openBookingPage = (locationId: number) => {
    navigate(`/book/${locationId}`);
  };

  // Get document verification status for seller application
  const { verification: docData, error: docError, forceRefresh: refetchDocs } = useDocumentVerification();

  // Get chef applications for chat access
  const { applications: kitchenApplications } = useChefKitchenApplications();

  // Get chef Neon user ID
  const { data: chefInfo } = useQuery({
    queryKey: ['/api/firebase/user/me'],
    queryFn: async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error(tt("notAuthenticated"));
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/firebase/user/me', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!response.ok) throw new Error(tt("failedToGetUserInfo"));
      return response.json();
    },
    enabled: !!user,
  });

  const chefId = chefInfo?.id || null;

  // Fetch public kitchens for enriching My Kitchens cards with images, equipment, storage
  const { data: publicKitchens } = useQuery<PublicKitchen[]>({
    queryKey: ["/api/public/kitchens"],
    queryFn: async () => {
      const response = await fetch("/api/public/kitchens");
      if (!response.ok) {
        throw new Error(tt("failedToFetchKitchens"));
      }
      return response.json();
    },
    staleTime: 60000,
  });

  // Fetch bookings for chefs with approved kitchen access
  const { bookings, isLoadingBookings, cancelBooking: cancelBookingMutation, kitchens } = useKitchenBookings();

  // Enrich bookings with kitchen and location information
  const enrichedBookings = useMemo(() => {
    if (!bookings || !Array.isArray(bookings)) return [];
    if (bookings.length === 0) return [];

    if (!kitchens || !Array.isArray(kitchens)) {
      return bookings.map((b: any) => ({
        ...b,
        location: b.location ? {
          id: b.location.id,
          name: b.location.name,
          cancellationPolicyHours: b.location.cancellationPolicyHours,
          cancellationPolicyMessage: b.location.cancellationPolicyMessage,
        } : undefined,
      }));
    }

    return bookings.map((booking: any) => {
      if (!booking || typeof booking.kitchenId !== 'number') {
        return {
          ...booking,
          location: booking.location ? {
            id: booking.location.id,
            name: booking.location.name,
            cancellationPolicyHours: booking.location.cancellationPolicyHours,
            cancellationPolicyMessage: booking.location.cancellationPolicyMessage,
          } : undefined,
        };
      }

      const kitchen = kitchens.find((k) => k && k.id === booking.kitchenId) as any;
      return {
        ...booking,
        kitchenName: kitchen?.name || booking.kitchenName,
        locationName: kitchen?.locationName || kitchen?.location?.name || booking.locationName,
        location: booking.location ? {
          id: booking.location.id,
          name: booking.location.name,
          cancellationPolicyHours: booking.location.cancellationPolicyHours,
          cancellationPolicyMessage: booking.location.cancellationPolicyMessage,
        } : (kitchen?.location ? {
          id: kitchen.location.id,
          name: kitchen.location.name,
          cancellationPolicyHours: kitchen.location.cancellationPolicyHours,
          cancellationPolicyMessage: kitchen.location.cancellationPolicyMessage,
        } : undefined),
      };
    });
  }, [bookings, kitchens]);

  // Handle cancel booking (or request cancellation for confirmed+paid)
  const handleCancelBooking = (bookingId: number, reason?: string) => {
    cancelBookingMutation.mutate({ bookingId, reason }, {
      onSuccess: (data: any) => {
        if (data?.action === 'cancellation_requested') {
          toast({
            title: "Cancellation Request Submitted",
            description: "Your cancellation request has been sent to the kitchen manager for review.",
          });
        } else {
          toast({
            title: "Booking Cancelled",
            description: "Your booking has been cancelled successfully.",
          });
        }
      },
      onError: (error: any) => {
        toast({
          title: "Cancellation Failed",
          description: error.message || "Failed to cancel booking. Please try again.",
          variant: "destructive",
        });
      },
    });
  };

  // Handle "Book a Session" button click - use platform standard booking flow
  const handleBookSessionClick = () => {
    // Get approved kitchens that are ready to book (Tier 3)
    const readyToBookKitchens = kitchenApplications.filter(
      (app) => app.status === 'approved' && (app.current_tier ?? 1) >= 3
    );

    if (readyToBookKitchens.length === 0) {
      // No kitchens ready to book - navigate to discover kitchens
      setActiveTab("discover-kitchens");
    } else if (readyToBookKitchens.length === 1) {
      // Single kitchen ready - open booking page directly
      const kitchen = readyToBookKitchens[0];
      openBookingPage(kitchen.locationId);
    } else {
      // Multiple kitchens ready - navigate to My Kitchens tab to select
      setActiveTab("kitchen-applications");
    }
  };

  // Use localStorage to track if vendor portal popup has been shown for this user
  const [hasClosedVendorPopup, setHasClosedVendorPopup] = useState(() => {
    if (typeof window !== 'undefined' && user?.uid) {
      const vendorPopupKey = `vendorPopupShown_${user.uid}`;
      return localStorage.getItem(vendorPopupKey) === 'true';
    }
    return false;
  });

  const { showConfirm } = useCustomAlerts();

  // Validate subdomain-role matching
  useEffect(() => {
    if (!user || !subdomain || subdomain === 'main') return;

    const userRole = user?.role;
    const isChef = user?.isChef || false;
    const isManager = user?.isManager || false;

    let effectiveRole = userRole;
    if (!effectiveRole) {
      if (isManager) {
        effectiveRole = 'manager';
      } else if (isChef) {
        effectiveRole = 'chef';
      }
    }

    const requiredSubdomain = getRequiredSubdomainForRole(effectiveRole);

    if (
      requiredSubdomain &&
      requiredSubdomain !== "main" &&
      subdomain !== requiredSubdomain
    ) {
      const correctUrl =
        getSubdomainOriginForEnvironment(requiredSubdomain, window.location.hostname, {
          port: window.location.port,
          protocol: window.location.protocol,
        }) + '/dashboard';
      window.location.href = correctUrl;
      return;
    }
  }, [user, subdomain]);

  const { data: applications = [], isLoading, error } = useQuery<Application[]>({
    queryKey: ["/api/firebase/applications/my"],
    queryFn: async ({ queryKey }) => {
      if (!user?.uid) {
        throw new Error(tt("userNotAuthenticated"));
      }

      if (user.role === "admin" || !user?.isChef) {
        return [];
      }

      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        throw new Error(tt("firebaseUserNotAvailable"));
      }

      const token = await firebaseUser.getIdToken();
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      };

      const response = await fetch(queryKey[0] as string, {
        credentials: 'include',
        headers
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(tt("accountSyncRequired"));
        }
        try {
          const errorData = await response.json();
          throw new Error(errorData.error || response.statusText);
        } catch {
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }
      }

      const rawData = await response.json();
      return rawData.map((app: any) => ({
        id: app.id,
        userId: app.user_id || app.userId,
        fullName: app.full_name || app.fullName,
        shopName: app.shop_name || app.shopName,
        shopAddress: app.shop_address || app.shopAddress,
        email: app.email,
        phone: app.phone,
        foodSafetyLicense: app.food_safety_license || app.foodSafetyLicense,
        foodEstablishmentCert: app.food_establishment_cert || app.foodEstablishmentCert,
        kitchenPreference: app.kitchen_preference || app.kitchenPreference,
        feedback: app.feedback,
        status: app.status,
        createdAt: app.created_at || app.createdAt,
        foodSafetyLicenseUrl: app.food_safety_license_url || app.foodSafetyLicenseUrl,
        foodEstablishmentCertUrl: app.food_establishment_cert_url || app.foodEstablishmentCertUrl,
        foodSafetyLicenseStatus: app.food_safety_license_status || app.foodSafetyLicenseStatus,
        foodEstablishmentCertStatus: app.food_establishment_cert_status || app.foodEstablishmentCertStatus,
        documentsAdminFeedback: app.documents_admin_feedback || app.documentsAdminFeedback,
        documentsReviewedAt: app.documents_reviewed_at || app.documentsReviewedAt,
        phpShopCreated: app.php_shop_created || app.phpShopCreated || false,
        verificationEmailSentAt: app.verification_email_sent_at || app.verificationEmailSentAt,
      })) as unknown as Application[];
    },
    enabled: !!user && user.role !== "admin" && !!user?.isChef,
  });

  // Helper function to determine user type and appropriate applications to display
  const userDisplayInfo = useMemo(() => {
    const isChef = user?.isChef || user?.role === 'chef' || user?.role === 'admin';
    if (isChef) {
      return {
        primaryRole: 'chef',
        applications: applications as AnyApplication[],
        applicationFormUrl: '/apply',
        roleName: 'Chef',
        icon: ChefHat,
        isLoading,
        error
      };
    } else {
      return {
        primaryRole: 'none',
        applications: [] as AnyApplication[],
        applicationFormUrl: '/apply',
        roleName: 'Get Started',
        icon: ChefHat,
        isLoading: false,
        error: null
      };
    }
  }, [user, applications, isLoading, error]);

  // Helper function to get the most recent application
  const getMostRecentApplication = useCallback(() => {
    if (!applications || applications.length === 0) return null;
    return [...applications].sort((a, b) => 
      new Date(b.createdAt as unknown as string).getTime() - new Date(a.createdAt as unknown as string).getTime()
    )[0];
  }, [applications]);

  /**
   * Enterprise-grade seller application approval check
   * 
   * A chef's seller application is considered "fully approved" when:
   * 1. Application status is 'approved'
   * 2. Food Safety License document status is 'approved'
   * 3. Food Establishment Cert status is 'approved' (if provided)
   * 
   * Only when fully approved can the chef:
   * - Access Stripe Connect setup
   * - Receive login credentials via email
   * - Start selling on the platform
   */
  const isSellerApplicationFullyApproved = useMemo(() => {
    const mostRecentApp = getMostRecentApplication();
    if (!mostRecentApp) return false;

    const app = mostRecentApp as Application;

    const fslApproved = app.foodSafetyLicenseStatus === "approved";
    const fecApproved = !app.foodEstablishmentCertUrl || app.foodEstablishmentCertStatus === "approved";

    return app.status === "approved" && fslApproved && fecApproved;
  }, [getMostRecentApplication]);

  // Shop status to verify if shop is created in case application flag is out of sync
  const { data: shopStatus } = useShopStatus(isSellerApplicationFullyApproved);
  const isShopCreated = !!getMostRecentApplication()?.phpShopCreated || !!shopStatus?.phpShopId;

  const getApplicationStatus = () => {
    const mostRecentApp = getMostRecentApplication();
    // This is the Chef Dashboard - user is always a chef, never show "Select Role"
    if (!mostRecentApp) return null;
    return formatApplicationStatus(mostRecentApp.status, t);
  };

  const getDocumentStatus = () => {
    const mostRecentApp = getMostRecentApplication();
    // This is the Chef Dashboard - user is always a chef, never show "Select Role"
    if (!mostRecentApp) return t("ovDocNone");

    const chefApp = mostRecentApp as Application;
    if (chefApp.status === "approved") {
      const hasValidFoodSafety = chefApp.foodSafetyLicenseStatus === "approved";
      const hasValidEstablishment = !chefApp.foodEstablishmentCertUrl || chefApp.foodEstablishmentCertStatus === "approved";
      return hasValidFoodSafety && hasValidEstablishment ? t("ovDocVerified") :
        (chefApp.foodSafetyLicenseStatus === "rejected" || chefApp.foodEstablishmentCertStatus === "rejected") ? t("ovDocRejected") : t("ovDocPendingReview");
    } else if (chefApp.status === "inReview") {
      return (chefApp.foodSafetyLicenseUrl && (chefApp.foodEstablishmentCertUrl || !chefApp.foodEstablishmentCert)) ? t("ovDocUploaded") : t("ovDocNeeded");
    }
    return t("ovDocUploadRequired");
  };

  const getStatusVariant = (status: string) => applicationStatusVariant(status);

  // Query microlearning completion status (only for chefs)
  const { data: microlearningCompletion } = useQuery({
    queryKey: ["microlearning-completion", user?.uid],
    queryFn: async () => {
      if (!user?.uid || !user?.isChef) return null;
      const currentUser = auth.currentUser;
      if (!currentUser) return null;
      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/firebase/microlearning/completion/${user.uid}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return response.ok ? await response.json() : null;
    },
    enabled: !!user?.uid && !!user?.isChef,
  });

  const { data: trainingAccess } = useQuery({
    queryKey: ["training-access", user?.uid],
    queryFn: async () => {
      if (!user?.uid || !user?.isChef) return null;
      const currentUser = auth.currentUser;
      if (!currentUser) return null;
      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/firebase/microlearning/progress/${user.uid}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return response.ok ? await response.json() : null;
    },
    enabled: !!user?.uid && !!user?.isChef,
  });

  const trainingStatusLabel = getTrainingStatusLabel(
    microlearningCompletion,
    trainingAccess?.progress,
    t
  );

  // Handle cancel application
  const handleCancelApplication = (_applicationType: 'chef' | 'delivery' = 'chef', applicationId?: number) => {
    showConfirm({
      title: t("shellCancelApplication"),
      description: t("shellCancelApplicationDesc"),
      confirmText: t("shellYesCancel"),
      cancelText: t("shellKeepApplication"),
      type: "warning",
      onConfirm: async () => {
        try {
          const token = await auth.currentUser?.getIdToken();
          const response = await fetch(`/api/firebase/applications/${applicationId}/cancel`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (response.ok) {
            queryClient.invalidateQueries({ queryKey: ["/api/firebase/applications/my"] });
            toast({ title: t("shellApplicationCancelled"), variant: "destructive" });
          }
        } catch (error) {
          logger.error("Dashboard error", error);
        }
      }
    });
  };

  const handleCloseVendorPopup = () => {
    setShowVendorPortalPopup(false);
    if (user?.uid) localStorage.setItem(`vendorPopupShown_${user.uid}`, 'true');
  };

  // Helper to get kitchen applications status summary (tier-aware)
  // Enterprise 3-Tier System:
  // - Tier 1: Application submitted, pending review
  // - Tier 2: Step 1 approved, chef completing Step 2 docs
  // - Tier 3: Fully approved (current_tier >= 3), ready to book
  const getKitchenAccessSummary = () => {
    const total = kitchenApplications.length;
    if (total === 0) return { label: t("ksNotStarted"), variant: "outline" as const };

    const readyToBook = kitchenApplications.filter((a) =>
      a.status === "approved" && (a.current_tier ?? 1) >= 3
    ).length;
    const actionNeeded = kitchenApplications.filter((a) =>
      a.status === "approved" && (a.current_tier ?? 1) < 3 && !hasStep2BeenSubmitted(a)
    ).length;
    const pending = kitchenApplications.filter((a) =>
      a.status === "inReview" ||
      (a.status === "approved" && (a.current_tier ?? 1) < 3 && hasStep2BeenSubmitted(a))
    ).length;

    if (actionNeeded > 0) {
      return {
        label: actionNeeded === 1 ? t("ksActionNeeded") : t("ksNeedAction", { count: actionNeeded }),
        variant: "warning" as const,
      };
    }
    if (pending > 0) {
      return {
        label: pending === 1 ? t("ksInReview") : t("ksInReviewCount", { count: pending }),
        variant: "outline" as const,
      };
    }
    if (readyToBook > 0) {
      return {
        label: readyToBook === 1 ? t("ksReadyToBook") : t("ksReadyCount", { count: readyToBook }),
        variant: "success" as const,
      };
    }
    return { label: t("ksTotalCount", { count: total }), variant: "outline" as const };
  };

  const kitchenSummary = getKitchenAccessSummary();

  // Cast kitchen applications to the expected type for components
  const typedKitchenApplications = kitchenApplications as unknown as KitchenApplicationWithLocation[];

  // Deep link: /dashboard?bookLocation=8 → intermediate booking page
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bookLocationRaw = params.get("bookLocation");
    if (!bookLocationRaw) return;
    const bookLocationId = Number(bookLocationRaw);
    if (!Number.isFinite(bookLocationId)) return;

    params.delete("bookLocation");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", next);
    navigate(`/book/${bookLocationId}`);
  }, [navigate]);

  const overviewTabContent = (
    <OverviewTabContent
      user={user}
      applications={userDisplayInfo.applications || []}
      kitchenApplications={typedKitchenApplications}
      kitchenSummary={kitchenSummary}
      trainingStatusLabel={trainingStatusLabel}
      enrichedBookings={enrichedBookings}
      getMostRecentApplication={getMostRecentApplication}
      getApplicationStatus={getApplicationStatus}
      getDocumentStatus={getDocumentStatus}
      onSetActiveTab={setActiveTab}
      onSetApplicationViewMode={setApplicationViewMode}
      isSellerApplicationFullyApproved={isSellerApplicationFullyApproved}
      isShopCreated={isShopCreated}
    />
  );

  const applicationsTabContent = applicationViewMode === "form" ? (
    <ApplicationFormPanel onBack={() => setApplicationViewMode("list")} />
  ) : applicationViewMode === "documents" ? (
    <DocumentVerificationView
      documentVerification={docData || undefined}
      onBack={() => setApplicationViewMode("list")}
    />
  ) : (
    <SellerApplicationTabContent
      applications={userDisplayInfo.applications || []}
      kitchenApplications={typedKitchenApplications}
      publicKitchens={publicKitchens}
      onStartApplication={() => setApplicationViewMode("form")}
      onManageDocuments={() => setApplicationViewMode("documents")}
      onCancelApplication={handleCancelApplication}
      onDiscoverKitchens={() => {
        requestDiscoverKitchensWalkthrough();
        setActiveTab("discover-kitchens");
      }}
      onBookKitchen={(locationId) => {
        openBookingPage(locationId);
      }}
    />
  );

  const trainingTabContent = (
    <TrainingOverviewPanel
      viewMode={trainingViewMode}
      onViewModeChange={setTrainingViewMode}
    />
  );

  const bookingsTabContent = (
    <div className="space-y-6">
      <ChefPageHeader
        title={t("shellKitchenBookings")}
        description={t("shellKitchenBookingsDesc")}
        actions={
          <Button variant="outline" onClick={() => setActiveTab("transactions")}>
            <CreditCard className="h-4 w-4 mr-2" />
            {t("shellTransactions")}
          </Button>
        }
      />

      {/* Pending Storage Extension Requests */}
      <PendingStorageExtensions />

      <ChefBookingsView
        bookings={enrichedBookings}
        isLoading={isLoadingBookings}
        onCancelBooking={handleCancelBooking}
        kitchens={kitchens || []}
      />
    </div>
  );

  const kitchenApplicationsTabContent = (
    <MyKitchensTabContent
      kitchenApplications={typedKitchenApplications}
      publicKitchens={publicKitchens}
      chefId={chefId}
      onSetActiveTab={setActiveTab}
      onOpenBookingSheet={(bookingLoc: BookingLocation) => {
        openBookingPage(bookingLoc.id);
      }}
      onOpenChat={(app) => {
        setChatApplication(app);
        setChatConversationId(app.chat_conversation_id || null);
        setShowChatDialog(true);
      }}
    />
  );

  const messagesTabContent = (
    <div className="h-[calc(100vh-8rem)]">
      <UnifiedChatView userId={chefId} role="chef" />
    </div>
  );

  const discoverKitchensTabContent = (
    <KitchenDiscovery
      defaultTab={activeTab === "viewings" ? "tours" : "discover"}
      onViewKitchenApplication={() => setActiveTab("applications")}
    />
  );

  // Render content based on activeTab (sidebar-driven navigation)
  const renderContent = () => {
    switch (activeTab) {
      case "overview":
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{overviewTabContent}</div>;
      case "applications":
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{applicationsTabContent}</div>;
      case "kitchen-applications":
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{kitchenApplicationsTabContent}</div>;
      case "discover-kitchens":
      case "viewings":
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{discoverKitchensTabContent}</div>;
      case "bookings":
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{bookingsTabContent}</div>;
      case "training":
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{trainingTabContent}</div>;
      case "messages":
        if (!hasKitchenMessages) {
          return <div className="space-y-8 animate-in fade-in-50 duration-500">{overviewTabContent}</div>;
        }
        return <div className="animate-in fade-in-50 duration-500">{messagesTabContent}</div>;
      case "support":
        return (
          <div className="space-y-8 animate-in fade-in-50 duration-500">
            <ChefSupportPage
              userEmail={authUser?.email || undefined}
              userName={authUser?.displayName || undefined}
              userId={authUser?.uid}
              onOpenResolutionCenter={() => setActiveTab("issues-refunds")}
              pendingResolutionCount={pendingDamageClaims + pendingPenalties}
            />
          </div>
        );
      case "feedback":
        return (
          <div className="space-y-8 animate-in fade-in-50 duration-500">
            <ChefSupportPage
              userEmail={authUser?.email || undefined}
              userName={authUser?.displayName || undefined}
              userId={authUser?.uid}
              onOpenResolutionCenter={() => setActiveTab("issues-refunds")}
              pendingResolutionCount={pendingDamageClaims + pendingPenalties}
            />
          </div>
        );
      case "issues-refunds":
        return (
          <div className="space-y-8 animate-in fade-in-50 duration-500">
            <IssuesAndRefunds />
          </div>
        );
      case "transactions":
        return (
          <div className="space-y-8 animate-in fade-in-50 duration-500">
            <TransactionHistory />
          </div>
        );
      case "seller-revenue":
        if (!isSellerApplicationFullyApproved || !isShopCreated) {
          return <div className="space-y-8 animate-in fade-in-50 duration-500">{overviewTabContent}</div>;
        }
        return (
          <div className="space-y-8 animate-in fade-in-50 duration-500">
            <ChefSellerRevenue />
          </div>
        );
      case "my-account":
        if (!isSellerApplicationFullyApproved || !isShopCreated) {
          return <div className="space-y-8 animate-in fade-in-50 duration-500">{overviewTabContent}</div>;
        }
        return (
          <div className="space-y-8 animate-in fade-in-50 duration-500">
            <ChefSellerAccount onOpenApplications={() => setActiveTab("applications")} />
          </div>
        );
      case "profile":
        return (
          <div className="space-y-8 animate-in fade-in-50 duration-500">
            <ChefProfileSettings />
          </div>
        );
      default:
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{overviewTabContent}</div>;
    }
  };

  // Generate dynamic breadcrumbs based on current view and sub-view
  const getBreadcrumbs = () => {
    const baseBreadcrumbs = [{ label: t("shellChefPortal"), href: "#" }];

    // If in applications tab with documents view, add nested breadcrumb
    if (activeTab === 'applications' && applicationViewMode === 'documents') {
      return [
        ...baseBreadcrumbs,
        { label: t("shellMyApplication"), onClick: () => setApplicationViewMode('list') },
        { label: t("shellDocumentVerification") }
      ];
    }

    // If in applications tab with form view
    if (activeTab === 'applications' && applicationViewMode === 'form') {
      return [
        ...baseBreadcrumbs,
        { label: t("shellMyApplication"), onClick: () => setApplicationViewMode('list') },
        { label: t("shellNewApplication") }
      ];
    }

    // If in training tab with player view, add nested breadcrumb
    if (activeTab === 'training' && trainingViewMode === 'player') {
      return [
        ...baseBreadcrumbs,
        { label: t("shellTraining"), onClick: () => setTrainingViewMode('overview') },
        { label: t("shellVideoPlayer") }
      ];
    }

    if (activeTab === 'viewings') {
      return [
        ...baseBreadcrumbs,
        { label: t("shellDiscoverKitchens"), onClick: () => setActiveTab("discover-kitchens") },
        { label: t("shellKitchenTours") }
      ];
    }

    if (activeTab === 'bookings') {
      return [
        ...baseBreadcrumbs,
        { label: t("shellMyBookings") }
      ];
    }

    if (activeTab === 'transactions') {
      return [
        ...baseBreadcrumbs,
        { label: t("shellMyBookings"), onClick: () => setActiveTab("bookings") },
        { label: t("shellTransactions") }
      ];
    }

    if (activeTab === 'issues-refunds') {
      return [
        ...baseBreadcrumbs,
        { label: t("shellSupport"), onClick: () => setActiveTab("support") },
        { label: t("shellResolutionCenter") }
      ];
    }

    // Default: just show the current tab
    return undefined; // Let the layout generate default breadcrumbs
  };

  return (
    <ChefDashboardLayout
      activeView={
        activeTab === "viewings"
          ? "discover-kitchens"
          : activeTab === "transactions"
            ? "bookings"
            : activeTab
      }
      onViewChange={(view) => {
        setActiveTab(view);
        // Reset sub-view modes when switching tabs
        if (view !== 'applications') {
          setApplicationViewMode('list');
        }
        if (view !== 'training') {
          setTrainingViewMode('overview');
        }
      }}
      messageBadgeCount={0}
      breadcrumbs={getBreadcrumbs()}
      hiddenItems={[
        ...(!(isSellerApplicationFullyApproved && isShopCreated) ? ['seller-revenue', 'my-account'] : []),
        ...(!hasResolutionItems ? ['issues-refunds'] : []),
      ]}
    >
      {/* ⌘K Command Palette */}
      <ChefCommandPalette onNavigate={(view) => {
        setActiveTab(view);
        if (view !== 'applications') setApplicationViewMode('list');
        if (view !== 'training') setTrainingViewMode('overview');
      }} />

      {/* Identifies the chef in Tidio; the widget script loads only when chat is opened */}
      <TidioController
        userEmail={authUser?.email || undefined}
        userName={authUser?.displayName || undefined}
        userId={authUser?.uid}
      />

      {/* Continue Setup Banner - Like managers have */}
      {showSetupBanner && (
        <div className="mb-6 flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">{t("shellFinishChefSetup")}</p>
            <p className="text-sm text-muted-foreground">
              {t("shellFinishChefSetupDesc")}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/chef-setup">
              {t("shellContinue")}
              <ChevronRight />
            </Link>
          </Button>
        </div>
      )}

      {/* Outstanding Dues Banner — blocks bookings until resolved */}
      <OutstandingDuesBanner />

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
        >
          {renderContent()}
        </motion.div>
      </AnimatePresence>

      {/* Global Modals */}
      <Dialog open={showVendorPortalPopup} onOpenChange={setShowVendorPortalPopup}>
        <DialogContent className="sm:max-w-[500px] gap-0 p-0 overflow-hidden border-border/50 shadow-2xl">
          <DialogHeader className="p-8 pb-4">
              <div className="mb-6 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <CheckCircle className="h-8 w-8" />
              </div>
            </div>
            <DialogTitle className="text-center text-2xl font-semibold tracking-tight">
              {t("shellFullyVerified")}
            </DialogTitle>
            <CardDescription className="text-center text-base pt-2">
              {t("shellFullyVerifiedDesc")}
            </CardDescription>
          </DialogHeader>

          <div className="p-8 pt-0 space-y-6">
            <div className="space-y-3">
              <Button asChild className="w-full h-12 text-base font-semibold shadow-lg shadow-primary/10 rounded-xl" onClick={handleCloseVendorPopup}>
                <a href="https://stagingwebapp.localcook.shop/app/shop/index.php?redirect=https%3A%2F%2Fstagingwebapp.localcook.shop%2Fapp%2Fshop%2Fvendor_onboarding.php" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2">
                  <Shield className="h-5 w-5" />
                  {t("shellProceedToVendorStorefront")}
                </a>
              </Button>
              <Button variant="outline" className="w-full h-12 text-base rounded-xl" onClick={() => { handleCloseVendorPopup(); setActiveTab("discover-kitchens"); }}>
                {t("shellExploreCommercialKitchens")}
              </Button>
            </div>

            <div className="p-4 bg-muted/50 rounded-xl border border-border/50 flex gap-3 italic">
              <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("shellNextStepsStripe")}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Global Modals for Chat */}
      <Dialog open={showChatDialog} onOpenChange={setShowChatDialog}>
        <DialogContent className="max-w-5xl h-[85vh] p-0 overflow-hidden border-border/50 shadow-2xl">
          {chatApplication && chatConversationId && chefId && (
            <div className="h-full flex flex-col">
              <div className="p-4 border-b flex items-center justify-between bg-muted/5">
                <div className="flex items-center gap-3">
                  <MessageCircle className="h-5 w-5 text-primary" />
                  <div>
                    <h4 className="font-bold text-sm">{t("shellChatWith", { name: chatApplication.location?.name || t("shellKitchenManager") })}</h4>
                    <p className="text-xs text-muted-foreground">{t("shellApplicationNumber", { id: chatApplication.id })}</p>
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                <ChatPanel
                  conversationId={chatConversationId}
                  applicationId={chatApplication.id}
                  chefId={chefId}
                  managerId={chatApplication.location?.managerId || 0}
                  locationId={chatApplication.locationId}
                  locationName={chatApplication.location?.name || t("shellUnknownLocation")}
                  onClose={() => {
                    setShowChatDialog(false);
                    setChatApplication(null);
                    setChatConversationId(null);
                  }}
                  embedded={true}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ChefDashboardLayout>
  );
}
