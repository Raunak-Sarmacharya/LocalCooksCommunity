import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { useChefKitchenApplications } from "@/hooks/use-chef-kitchen-applications";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import ChatPanel from "@/components/chat/ChatPanel";
import UnifiedChatView from "@/components/chat/UnifiedChatView";
import { useSubdomain } from "@/hooks/use-subdomain";
import { getRequiredSubdomainForRole, getSubdomainUrl } from "@shared/subdomain-utils";
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
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  formatApplicationStatus
} from "@/lib/applicationSchema";
import { queryClient } from "@/lib/queryClient";
import { Application, UserWithFlags } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronDown,
  BookOpen,
  Building,
  Calendar,
  CheckCircle,
  ChefHat,
  Clock,
  FileText,
  Shield,
  XCircle,
  AlertCircle,
  MessageCircle,
  Store,
  ArrowRight,
  Utensils,
  TrendingUp,
  MapPin,
  Snowflake,
  Thermometer,
  Package,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useCustomAlerts } from "@/components/ui/custom-alerts";
import ChefStripeConnectSetup from "@/components/chef/ChefStripeConnectSetup";
import { useChefOnboardingStatus } from "@/hooks/use-chef-onboarding-status";
import KitchenDiscovery from "@/components/kitchen-application/KitchenDiscovery";
import KitchenBookingSheet from "@/components/booking/KitchenBookingSheet";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import TrainingOverviewPanel from "@/components/training/TrainingOverviewPanel";
import ApplicationFormPanel from "@/components/application/ApplicationFormPanel";
import ChefSupportPage from "@/components/chef/ChefSupportPage";
import { IssuesAndRefunds } from "@/components/chef/IssuesAndRefunds";
import { TransactionHistory } from "@/components/chef/TransactionHistory";
import TidioController from "@/components/chat/TidioController";
import OutstandingDuesBanner from "@/components/chef/OutstandingDuesBanner";
import ChefProfileSettings from "@/components/chef/ChefProfileSettings";
import { useDocumentVerification } from "@/hooks/use-document-verification";
import DocumentUpload, { DocumentManagementModal } from "@/components/document-verification/DocumentUpload";
import { SellerApplicationCard, KitchenApplicationCard } from "@/components/chef/applications";
import {
  OverviewTabContent,
  MyKitchensTabContent,
  EmptyApplicationState,
  DocumentVerificationView,
  type PublicKitchen,
  type KitchenApplicationWithLocation,
  type BookingLocation,
} from "@/components/chef/dashboard";

// Type alias for application
type AnyApplication = Application;


export default function ApplicantDashboard() {
  const { user: authUser } = useFirebaseAuth();
  const user = authUser as UserWithFlags | null;
  const [showVendorPortalPopup, setShowVendorPortalPopup] = useState(false);
  const [showChatDialog, setShowChatDialog] = useState(false);

  // Chef onboarding status for "Continue Setup" banner
  const { showSetupBanner, missingSteps } = useChefOnboardingStatus();
  const [chatApplication, setChatApplication] = useState<any | null>(null);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const subdomain = useSubdomain();
  const [location] = useLocation();

  // Parse view from URL query parameter (e.g., /dashboard?view=messages)
  const getInitialTab = () => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    if (view && ['overview', 'applications', 'kitchen-applications', 'discover-kitchens', 'bookings', 'training', 'messages', 'support', 'feedback'].includes(view)) {
      return view;
    }
    return 'overview';
  };

  const [activeTab, setActiveTabState] = useState(getInitialTab);

  // Sync URL when tab changes (makes tabs bookmarkable)
  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    const url = new URL(window.location.href);
    if (tab === 'overview') {
      url.searchParams.delete('view');
    } else {
      url.searchParams.set('view', tab);
    }
    window.history.replaceState({}, '', url.toString());
  };

  // Application form view mode - 'list' shows applications, 'form' shows the application form, 'documents' shows document verification
  const [applicationViewMode, setApplicationViewMode] = useState<'list' | 'form' | 'documents'>('list');

  // Training view mode - 'overview' shows training overview, 'player' shows the video player
  const [trainingViewMode, setTrainingViewMode] = useState<'overview' | 'player'>('overview');

  // Update activeTab and applicationViewMode when URL changes (for notification clicks and deep links)
  // Use setActiveTabState here since the URL already has the correct ?view= param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    const action = params.get('action');

    if (view && ['overview', 'applications', 'kitchen-applications', 'discover-kitchens', 'bookings', 'training', 'messages', 'support', 'feedback', 'damage-claims', 'profile'].includes(view)) {
      setActiveTabState(view);

      // If navigating to applications with action=new, open the form
      if (view === 'applications' && action === 'new') {
        setApplicationViewMode('form');
      }
      // If navigating to applications with action=documents, open document verification
      if (view === 'applications' && action === 'documents') {
        setApplicationViewMode('documents');
      }
    }
  }, [location]);

  // Booking sheet state
  const [bookingSheetOpen, setBookingSheetOpen] = useState(false);
  const [bookingLocation, setBookingLocation] = useState<{
    id: number;
    name: string;
    address?: string;
  } | null>(null);

  // Document management modal state for seller application
  const [showDocumentModal, setShowDocumentModal] = useState(false);

  // Get document verification status for seller application
  const { verification: documentVerification, loading: docVerificationLoading } = useDocumentVerification();

  // Get chef applications for chat access
  const { applications: kitchenApplications } = useChefKitchenApplications();

  // Get chef Neon user ID
  const { data: chefInfo } = useQuery({
    queryKey: ['/api/firebase/user/me'],
    queryFn: async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/firebase/user/me', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to get user info');
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
        throw new Error("Failed to fetch kitchens");
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
      // Single kitchen ready - open booking sheet directly
      const kitchen = readyToBookKitchens[0];
      setBookingLocation({
        id: kitchen.locationId,
        name: kitchen.location?.name || 'Kitchen',
        address: kitchen.location?.address,
      });
      setBookingSheetOpen(true);
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

    if (requiredSubdomain && subdomain !== requiredSubdomain) {
      const correctUrl = getSubdomainUrl(requiredSubdomain, 'localcooks.ca') + '/dashboard';
      window.location.href = correctUrl;
      return;
    }
  }, [user, subdomain]);

  const { data: applications = [], isLoading, error } = useQuery<Application[]>({
    queryKey: ["/api/firebase/applications/my"],
    queryFn: async ({ queryKey }) => {
      if (!user?.uid) {
        throw new Error("User not authenticated");
      }

      if (user.role === "admin" || !user?.isChef) {
        return [];
      }

      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        throw new Error("Firebase user not available");
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
          throw new Error("Account sync required.");
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
      })) as Application[];
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
  const getMostRecentApplication = () => {
    if (!userDisplayInfo.applications || userDisplayInfo.applications.length === 0) return null;
    return userDisplayInfo.applications.reduce((latest: AnyApplication, current: AnyApplication) => {
      const latestDate = new Date(latest.createdAt || 0);
      const currentDate = new Date(current.createdAt || 0);
      return currentDate > latestDate ? current : latest;
    });
  };

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

    // Application must be approved
    if (app.status !== 'approved') return false;

    // Food Safety License must be approved (required document)
    if (app.foodSafetyLicenseStatus !== 'approved') return false;

    // Food Establishment Cert is optional - only check if URL was provided
    if (app.foodEstablishmentCertUrl && app.foodEstablishmentCertStatus !== 'approved') {
      return false;
    }

    return true;
  }, [userDisplayInfo.applications]);

  const getApplicationStatus = () => {
    const mostRecentApp = getMostRecentApplication();
    // This is the Chef Dashboard - user is always a chef, never show "Select Role"
    if (!mostRecentApp) return null;
    return formatApplicationStatus(mostRecentApp.status);
  };

  const getDocumentStatus = () => {
    const mostRecentApp = getMostRecentApplication();
    // This is the Chef Dashboard - user is always a chef, never show "Select Role"
    if (!mostRecentApp) return "No Documents Uploaded";

    const chefApp = mostRecentApp as Application;
    if (chefApp.status === "approved") {
      const hasValidFoodSafety = chefApp.foodSafetyLicenseStatus === "approved";
      const hasValidEstablishment = !chefApp.foodEstablishmentCertUrl || chefApp.foodEstablishmentCertStatus === "approved";
      return hasValidFoodSafety && hasValidEstablishment ? "Verified" :
        (chefApp.foodSafetyLicenseStatus === "rejected" || chefApp.foodEstablishmentCertStatus === "rejected") ? "Rejected" : "Pending Review";
    } else if (chefApp.status === "inReview") {
      return (chefApp.foodSafetyLicenseUrl && (chefApp.foodEstablishmentCertUrl || !chefApp.foodEstablishmentCert)) ? "Documents Uploaded" : "Documents Needed";
    }
    return "Upload Required";
  };

  const getStatusVariant = (status: string) => {
    switch (status.toLowerCase()) {
      case 'approved': return 'default';
      case 'pending':
      case 'in review': return 'secondary';
      case 'rejected':
      case 'cancelled': return 'destructive';
      default: return 'outline';
    }
  };

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

  // Handle cancel application
  const handleCancelApplication = (_applicationType: 'chef' | 'delivery' = 'chef', applicationId?: number) => {
    showConfirm({
      title: "Cancel Application",
      description: "Are you sure you want to cancel this application? This action cannot be undone.",
      confirmText: "Yes, Cancel",
      cancelText: "Keep Application",
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
            toast({ title: "Application cancelled", variant: "destructive" });
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
    if (total === 0) return { label: "No Applications", variant: "outline" as const };

    // Count by tier status - use current_tier as source of truth
    const readyToBook = kitchenApplications.filter(a =>
      a.status === 'approved' && (a.current_tier ?? 1) >= 3
    ).length;
    const inProgress = kitchenApplications.filter(a =>
      a.status === 'approved' && (a.current_tier ?? 1) < 3
    ).length;
    const pending = kitchenApplications.filter(a => a.status === 'inReview').length;

    if (readyToBook > 0) return { label: `${readyToBook} Ready`, variant: "default" as const };
    if (inProgress > 0) return { label: `${inProgress} In Progress`, variant: "secondary" as const };
    if (pending > 0) return { label: `${pending} Pending`, variant: "secondary" as const };
    return { label: `${total} Total`, variant: "outline" as const };
  };

  const kitchenSummary = getKitchenAccessSummary();

  // Cast kitchen applications to the expected type for components
  const typedKitchenApplications = kitchenApplications as unknown as KitchenApplicationWithLocation[];

  const overviewTabContent = (
    <OverviewTabContent
      user={user}
      applications={userDisplayInfo.applications || []}
      kitchenApplications={typedKitchenApplications}
      kitchenSummary={kitchenSummary}
      microlearningCompletion={microlearningCompletion}
      enrichedBookings={enrichedBookings}
      getMostRecentApplication={getMostRecentApplication}
      getApplicationStatus={getApplicationStatus}
      getDocumentStatus={getDocumentStatus}
      getStatusVariant={getStatusVariant}
      onSetActiveTab={setActiveTab}
      onSetApplicationViewMode={setApplicationViewMode}
      onBookSessionClick={handleBookSessionClick}
    />
  );

  // Helper to check if user has an active application (not cancelled/rejected)
  const hasActiveSellerApplication = useMemo(() => {
    if (!userDisplayInfo.applications || userDisplayInfo.applications.length === 0) return false;
    return userDisplayInfo.applications.some((app: AnyApplication) =>
      app.status !== 'cancelled' && app.status !== 'rejected'
    );
  }, [userDisplayInfo.applications]);

  // Helper to check if user has an active kitchen application (not cancelled/rejected)
  const hasActiveKitchenApplication = useMemo(() => {
    if (!kitchenApplications || kitchenApplications.length === 0) return false;
    return kitchenApplications.some((app) =>
      app.status !== 'cancelled' && app.status !== 'rejected'
    );
  }, [kitchenApplications]);

  // Get the most recent kitchen application for status display
  const getMostRecentKitchenApplication = () => {
    if (!kitchenApplications || kitchenApplications.length === 0) return null;
    return kitchenApplications.reduce((latest, current) => {
      const latestDate = new Date(latest.createdAt || 0);
      const currentDate = new Date(current.createdAt || 0);
      return currentDate > latestDate ? current : latest;
    });
  };

  // Get kitchen application status configuration
  const getKitchenApplicationStatusConfig = (app: typeof kitchenApplications[0]) => {
    if (app.status === 'inReview') {
      return {
        label: 'In Review',
        variant: 'secondary' as const,
        bgColor: 'bg-amber-500',
        icon: Clock,
        description: 'Your application is being reviewed by the kitchen manager.'
      };
    }
    if (app.status === 'rejected') {
      return {
        label: 'Rejected',
        variant: 'destructive' as const,
        bgColor: 'bg-red-500',
        icon: XCircle,
        description: app.feedback || 'Your application was not approved. You may submit a new application.'
      };
    }
    if (app.status === 'cancelled') {
      return {
        label: 'Cancelled',
        variant: 'outline' as const,
        bgColor: 'bg-gray-500',
        icon: AlertCircle,
        description: 'This application was cancelled.'
      };
    }
    if (app.status === 'approved') {
      const tier = app.current_tier ?? 1;
      if (tier >= 3) {
        return {
          label: 'Fully Approved',
          variant: 'default' as const,
          bgColor: 'bg-green-600',
          icon: CheckCircle,
          description: 'Your application is fully approved. You can now book kitchens!'
        };
      }
      if (tier === 2 && app.tier2_completed_at) {
        return {
          label: 'Step 2 Under Review',
          variant: 'secondary' as const,
          bgColor: 'bg-orange-500',
          icon: Clock,
          description: 'Your Step 2 documents are being reviewed.'
        };
      }
      if (tier === 2 && !app.tier2_completed_at) {
        return {
          label: 'Step 2 Required',
          variant: 'secondary' as const,
          bgColor: 'bg-blue-500',
          icon: FileText,
          description: 'Step 1 approved! Please complete Step 2 requirements.'
        };
      }
      return {
        label: 'Step 1 Approved',
        variant: 'default' as const,
        bgColor: 'bg-blue-600',
        icon: CheckCircle,
        description: 'Step 1 approved. Continue to the next step.'
      };
    }
    return {
      label: 'Unknown',
      variant: 'outline' as const,
      bgColor: 'bg-muted-foreground/40',
      icon: AlertCircle,
      description: 'Status unknown.'
    };
  };

  // Check if there are any applications (seller or kitchen)
  const hasAnyApplications = (userDisplayInfo.applications && userDisplayInfo.applications.length > 0) || kitchenApplications.length > 0;

  const applicationsTabContent = applicationViewMode === 'form' ? (
    <ApplicationFormPanel onBack={() => setApplicationViewMode('list')} />
  ) : applicationViewMode === 'documents' ? (
    <DocumentVerificationView
      documentVerification={documentVerification}
      onBack={() => setApplicationViewMode('list')}
    />
  ) : (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">My Applications</h2>
            <p className="text-muted-foreground mt-1">Track all your seller and kitchen applications in one place</p>
          </div>
        </div>
        <div className="flex gap-2">
          {!hasActiveSellerApplication && (
            <Button
              onClick={() => setApplicationViewMode('form')}
              className="rounded-xl shadow-lg shadow-primary/10"
            >
              <Store className="h-4 w-4 mr-2" />
              New Seller Application
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setActiveTab("discover-kitchens")}
            className="rounded-xl"
          >
            <Building className="h-4 w-4 mr-2" />
            Discover Kitchens
          </Button>
        </div>
      </div>

      {/* Stripe Connect Payment Setup - Only visible after chef's seller application is FULLY approved */}
      {isSellerApplicationFullyApproved && (
        <ChefStripeConnectSetup isApproved={true} />
      )}

      {hasAnyApplications ? (
        <div className="space-y-6">
          {/* ============================================== */}
          {/* SELLER APPLICATIONS SECTION */}
          {/* ============================================== */}
          {userDisplayInfo.applications && userDisplayInfo.applications.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Store className="h-4 w-4 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Seller Applications</h3>
                <Badge variant="secondary" className="text-xs">
                  {userDisplayInfo.applications.length}
                </Badge>
              </div>

              <div className="space-y-3">
                {userDisplayInfo.applications.map((app: AnyApplication) => (
                  <SellerApplicationCard
                    key={app.id}
                    application={app}
                    onCancelApplication={handleCancelApplication}
                    onManageDocuments={() => setApplicationViewMode('documents')}
                    getStatusVariant={getStatusVariant}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ============================================== */}
          {/* KITCHEN APPLICATIONS SECTION */}
          {/* ============================================== */}
          {kitchenApplications.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Building className="h-4 w-4 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Kitchen Applications</h3>
                <Badge variant="info" className="text-xs">
                  {kitchenApplications.length}
                </Badge>
              </div>

              <div className="space-y-3">
                {kitchenApplications.map((app) => {
                  const kitchenData = publicKitchens?.find(k => k.locationId === app.locationId);
                  return (
                    <KitchenApplicationCard
                      key={app.id}
                      application={app}
                      kitchenImageUrl={kitchenData?.imageUrl}
                      onBookKitchen={(locationId, locationName, locationAddress) => {
                        setBookingLocation({
                          id: locationId,
                          name: locationName,
                          address: locationAddress,
                        });
                        setBookingSheetOpen(true);
                      }}
                      onDiscoverKitchens={() => setActiveTab("discover-kitchens")}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ============================================== */
        /* EMPTY STATE - NO APPLICATIONS YET */
        /* Award-winning UI/UX design with dual-path CTAs */
        /* ============================================== */
        <div className="space-y-8">
          {/* Hero Welcome Section */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/5 via-primary/10 to-blue-500/5 border border-primary/10 p-8 md:p-12">
            {/* Decorative background elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-primary/10 to-transparent rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-blue-500/10 to-transparent rounded-full blur-2xl translate-y-1/2 -translate-x-1/2" />

            <div className="relative z-10 text-center max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
                <ChefHat className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-primary">Welcome to LocalCooks</span>
              </div>

              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-4">
                Start Your Culinary Journey
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed">
                Whether you want to sell your homemade food or cook in professional kitchens,
                LocalCooks has the perfect path for you. Choose how you'd like to get started.
              </p>
            </div>
          </div>

          {/* Dual Path Cards - Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Path 1: Sell on LocalCooks */}
            <Card className="group relative overflow-hidden border-2 border-primary/20 hover:border-primary/40 transition-all duration-300 hover:shadow-xl hover:shadow-primary/5">
              {/* Top accent bar */}
              <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/60" />

              {/* Floating badge */}
              <div className="absolute top-6 right-6">
                <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 text-xs font-semibold">
                  Recommended
                </Badge>
              </div>

              <CardHeader className="pb-4 pt-8">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Store className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="text-2xl font-bold">Sell on LocalCooks</CardTitle>
                <CardDescription className="text-base">
                  Become a verified seller and share your culinary creations with customers in your area.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6">
                {/* Benefits list */}
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Reach Local Customers</p>
                      <p className="text-xs text-muted-foreground">Connect with food lovers in your community</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Secure Payments</p>
                      <p className="text-xs text-muted-foreground">Get paid directly via Stripe Connect</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Build Your Brand</p>
                      <p className="text-xs text-muted-foreground">Create your own storefront and menu</p>
                    </div>
                  </div>
                </div>

                {/* Process steps */}
                <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
                  <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-3">How it works</p>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">1</div>
                      <span className="text-muted-foreground">Apply</span>
                    </div>
                    <div className="flex-1 h-px bg-border mx-2" />
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">2</div>
                      <span className="text-muted-foreground">Verify</span>
                    </div>
                    <div className="flex-1 h-px bg-border mx-2" />
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">3</div>
                      <span className="text-muted-foreground">Sell</span>
                    </div>
                  </div>
                </div>
              </CardContent>

              <CardFooter className="pt-2 pb-6">
                <Button
                  size="lg"
                  onClick={() => setApplicationViewMode('form')}
                  className="w-full rounded-xl shadow-lg shadow-primary/20 group-hover:shadow-primary/30 transition-all"
                >
                  <Store className="h-5 w-5 mr-2" />
                  Start Seller Application
                  <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </CardFooter>
            </Card>

            {/* Path 2: Cook at Commercial Kitchens */}
            <Card className="group relative overflow-hidden border-2 border-blue-500/20 hover:border-blue-500/40 transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/5">
              {/* Top accent bar */}
              <div className="h-1.5 w-full bg-gradient-to-r from-blue-600 via-blue-500 to-blue-400" />

              {/* Floating badge */}
              <div className="absolute top-6 right-6">
                <Badge variant="info" className="text-xs font-semibold">
                  Popular
                </Badge>
              </div>

              <CardHeader className="pb-4 pt-8">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                  <Building className="h-8 w-8 text-blue-600" />
                </div>
                <CardTitle className="text-2xl font-bold">Cook at Commercial Kitchens</CardTitle>
                <CardDescription className="text-base">
                  Access professional kitchen spaces to prepare your food in a certified environment.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6">
                {/* Benefits list */}
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Professional Equipment</p>
                      <p className="text-xs text-muted-foreground">Access commercial-grade kitchen tools</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Flexible Booking</p>
                      <p className="text-xs text-muted-foreground">Book time slots that fit your schedule</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Certified Spaces</p>
                      <p className="text-xs text-muted-foreground">Meet health & safety requirements</p>
                    </div>
                  </div>
                </div>

                {/* Process steps */}
                <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100">
                  <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-3">How it works</p>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">1</div>
                      <span className="text-muted-foreground">Discover</span>
                    </div>
                    <div className="flex-1 h-px bg-blue-200 mx-2" />
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">2</div>
                      <span className="text-muted-foreground">Apply</span>
                    </div>
                    <div className="flex-1 h-px bg-blue-200 mx-2" />
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">3</div>
                      <span className="text-muted-foreground">Book</span>
                    </div>
                  </div>
                </div>
              </CardContent>

              <CardFooter className="pt-2 pb-6">
                <Button
                  size="lg"
                  onClick={() => setActiveTab("discover-kitchens")}
                  variant="secondary"
                  className="w-full rounded-xl shadow-lg shadow-primary/10 group-hover:shadow-primary/20 transition-all"
                >
                  <Building className="h-5 w-5 mr-2" />
                  Discover Kitchens
                  <ArrowRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </CardFooter>
            </Card>
          </div>

          {/* Bottom info section */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 p-6 bg-muted/30 rounded-2xl border border-border/50">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Shield className="h-5 w-5" />
              <span className="text-sm">Secure & Verified</span>
            </div>
            <div className="hidden sm:block w-px h-4 bg-border" />
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-5 w-5" />
              <span className="text-sm">Quick Approval Process</span>
            </div>
            <div className="hidden sm:block w-px h-4 bg-border" />
            <div className="flex items-center gap-2 text-muted-foreground">
              <MessageCircle className="h-5 w-5" />
              <span className="text-sm">24/7 Support Available</span>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Application Prevention Notice */}
      {hasActiveSellerApplication && (
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">Active Application in Progress</p>
            <p className="text-sm text-amber-700 mt-1">
              You already have an active seller application. You cannot submit another application until the current one is resolved.
            </p>
          </div>
        </div>
      )}

      {/* Document Management Modal */}
      <DocumentManagementModal open={showDocumentModal} onOpenChange={setShowDocumentModal} />
    </div>
  );

  const trainingTabContent = (
    <TrainingOverviewPanel
      viewMode={trainingViewMode}
      onViewModeChange={setTrainingViewMode}
    />
  );

  const bookingsTabContent = (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Kitchen Bookings</h2>
          <p className="text-muted-foreground mt-1">View and manage your upcoming kitchen sessions.</p>
        </div>
      </div>

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
      onOpenBookingSheet={(location: BookingLocation) => {
        setBookingLocation(location);
        setBookingSheetOpen(true);
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
    <KitchenDiscovery />
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
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{discoverKitchensTabContent}</div>;
      case "bookings":
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{bookingsTabContent}</div>;
      case "training":
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{trainingTabContent}</div>;
      case "messages":
        return <div className="animate-in fade-in-50 duration-500">{messagesTabContent}</div>;
      case "support":
        return (
          <div className="space-y-8 animate-in fade-in-50 duration-500">
            <ChefSupportPage
              userEmail={authUser?.email || undefined}
              userName={authUser?.displayName || undefined}
              userId={authUser?.uid}
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
    const baseBreadcrumbs = [{ label: "Chef Portal", href: "#" }];

    // If in applications tab with documents view, add nested breadcrumb
    if (activeTab === 'applications' && applicationViewMode === 'documents') {
      return [
        ...baseBreadcrumbs,
        { label: "My Application", onClick: () => setApplicationViewMode('list') },
        { label: "Document Verification" }
      ];
    }

    // If in applications tab with form view
    if (activeTab === 'applications' && applicationViewMode === 'form') {
      return [
        ...baseBreadcrumbs,
        { label: "My Application", onClick: () => setApplicationViewMode('list') },
        { label: "New Application" }
      ];
    }

    // If in training tab with player view, add nested breadcrumb
    if (activeTab === 'training' && trainingViewMode === 'player') {
      return [
        ...baseBreadcrumbs,
        { label: "Training", onClick: () => setTrainingViewMode('overview') },
        { label: "Video Player" }
      ];
    }

    // Default: just show the current tab
    return undefined; // Let the layout generate default breadcrumbs
  };

  return (
    <ChefDashboardLayout
      activeView={activeTab}
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
    >
      {/* ⌘K Command Palette */}
      <ChefCommandPalette onNavigate={(view) => {
        setActiveTab(view);
        if (view !== 'applications') setApplicationViewMode('list');
        if (view !== 'training') setTrainingViewMode('overview');
      }} />

      {/* Tidio Chat Controller - manages widget visibility based on current view */}
      <TidioController
        userEmail={authUser?.email || undefined}
        userName={authUser?.displayName || undefined}
        userId={authUser?.uid}
      />

      {/* Continue Setup Banner - Like managers have */}
      {showSetupBanner && (
        <div className="bg-blue-600 text-white px-6 py-4 shadow-md mb-6 rounded-lg flex items-center justify-between animate-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-full">
              <ChefHat className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">Complete Your Chef Setup</p>
              <p className="text-sm text-blue-100">
                {missingSteps.length > 0
                  ? `Next: ${missingSteps[0]}`
                  : "Finish setting up your chef profile to start booking kitchens"}
              </p>
            </div>
          </div>
          <Button
            asChild
            variant="secondary"
            className="font-semibold shadow-lg hover:bg-blue-50"
          >
            <Link href="/chef-setup">
              Continue Setup <ChevronRight className="ml-2 h-4 w-4" />
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
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center border-4 border-background shadow-inner text-green-600">
                <CheckCircle className="h-10 w-10" />
              </div>
            </div>
            <DialogTitle className="text-3xl text-center font-bold tracking-tight">
              Fully Verified!
            </DialogTitle>
            <CardDescription className="text-center text-base pt-2">
              Your account documents have been approved. You are ready to start your business.
            </CardDescription>
          </DialogHeader>

          <div className="p-8 pt-0 space-y-6">
            <div className="space-y-3">
              <Button asChild className="w-full h-12 text-base font-semibold shadow-lg shadow-primary/10 rounded-xl" onClick={handleCloseVendorPopup}>
                <a href="https://localcook.shop/app/shop/index.php?redirect=https%3A%2F%2Flocalcook.shop%2Fapp%2Fshop%2Fvendor_onboarding.php" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2">
                  <Shield className="h-5 w-5" />
                  Proceed to Vendor Storefront
                </a>
              </Button>
              <Button variant="outline" className="w-full h-12 text-base rounded-xl" onClick={() => { handleCloseVendorPopup(); setActiveTab("discover-kitchens"); }}>
                Explore Commercial Kitchens
              </Button>
            </div>

            <div className="p-4 bg-muted/50 rounded-xl border border-border/50 flex gap-3 italic">
              <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Next steps: Configure your Stripe payouts in the vendor portal to start accepting payments from customers.
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
                    <h4 className="font-bold text-sm">Chat with {chatApplication.location?.name || "Kitchen Manager"}</h4>
                    <p className="text-xs text-muted-foreground">Application #{chatApplication.id}</p>
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
                  locationName={chatApplication.location?.name || "Unknown Location"}
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

      {/* Kitchen Booking Sheet - Enterprise-grade inline booking */}
      {bookingLocation && (
        <KitchenBookingSheet
          open={bookingSheetOpen}
          onOpenChange={setBookingSheetOpen}
          locationId={bookingLocation.id}
          locationName={bookingLocation.name}
          locationAddress={bookingLocation.address}
        />
      )}
    </ChefDashboardLayout>
  );
}
