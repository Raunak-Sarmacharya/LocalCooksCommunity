import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { useChefKitchenApplications } from "@/hooks/use-chef-kitchen-applications";
import ChatPanel from "@/components/chat/ChatPanel";
import UnifiedChatView from "@/components/chat/UnifiedChatView";
import { useSubdomain } from "@/hooks/use-subdomain";
import { getRequiredSubdomainForRole, getSubdomainUrl } from "@shared/subdomain-utils";
import ChefBookingsView from "@/components/booking/ChefBookingsView";
import { PendingStorageExtensions } from "@/components/booking/PendingStorageExtensions";
import { useKitchenBookings } from "@/hooks/use-kitchen-bookings";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
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
import { cn } from "@/lib/utils";
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
import TidioController from "@/components/chat/TidioController";
import { useDocumentVerification } from "@/hooks/use-document-verification";
import DocumentUpload, { DocumentManagementModal } from "@/components/document-verification/DocumentUpload";

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
  
  const [activeTab, setActiveTab] = useState(getInitialTab);
  
  // Application form view mode - 'list' shows applications, 'form' shows the application form, 'documents' shows document verification
  const [applicationViewMode, setApplicationViewMode] = useState<'list' | 'form' | 'documents'>('list');
  
  // Update activeTab and applicationViewMode when URL changes (for notification clicks and deep links)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    const action = params.get('action');
    
    if (view && ['overview', 'applications', 'kitchen-applications', 'discover-kitchens', 'bookings', 'training', 'messages', 'support', 'feedback'].includes(view)) {
      setActiveTab(view);
      
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
  interface PublicKitchen {
    id: number;
    name: string;
    description?: string | null;
    imageUrl?: string | null;
    equipment?: string[];
    hourlyRate?: number | null;
    locationId: number;
    locationName: string;
    address: string;
    storageSummary?: {
      hasDryStorage: boolean;
      hasColdStorage: boolean;
      hasFreezerStorage: boolean;
      totalStorageUnits: number;
    };
  }

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

  // Handle cancel booking
  const handleCancelBooking = (bookingId: number) => {
    cancelBookingMutation.mutate(bookingId, {
      onSuccess: () => {
        toast({
          title: "Booking Cancelled",
          description: "Your booking has been cancelled successfully.",
        });
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
          console.error(error);
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

  const overviewTabContent = (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome back{user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}!
          </h1>
          <p className="text-muted-foreground mt-1">
            Here's an overview of your LocalCooks journey
          </p>
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
              <Store className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Seller Status</p>
              <p className="text-sm font-bold text-foreground">{getApplicationStatus() || "Not Started"}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
              <Building className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kitchen Access</p>
              <p className="text-sm font-bold text-foreground">{kitchenSummary.label}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center border border-green-500/20">
              <BookOpen className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Training</p>
              <p className="text-sm font-bold text-foreground">{microlearningCompletion?.confirmed ? "Completed" : "In Progress"}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
              <Calendar className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bookings</p>
              <p className="text-sm font-bold text-foreground">{enrichedBookings?.length || 0} Active</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two Path Cards - Sell on LocalCooks & Kitchen Access */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Sell on LocalCooks Path */}
        <Card className="border-border/50 shadow-sm overflow-hidden group hover:shadow-lg transition-all">
          <div className="h-2 bg-gradient-to-r from-primary to-primary/60" />
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                  <Store className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">Sell on LocalCooks</CardTitle>
                  <CardDescription>Become a verified seller on our platform</CardDescription>
                </div>
              </div>
              {applications?.length > 0 && (
                <Badge variant={getStatusVariant(getMostRecentApplication()?.status || "")} className="text-[10px]">
                  {formatApplicationStatus(getMostRecentApplication()?.status || "")}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Join our marketplace and sell your homemade food to customers in your area. We handle delivery, payments, and customer support.
            </p>
            
            {applications?.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Application #{getMostRecentApplication()?.id}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {getMostRecentApplication()?.createdAt ? new Date(getMostRecentApplication()!.createdAt).toLocaleDateString() : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Documents</span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{getDocumentStatus()}</Badge>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-primary/5 rounded-lg border border-primary/10 text-center">
                <Utensils className="h-8 w-8 text-primary mx-auto mb-2" />
                <p className="text-sm font-medium">Ready to start selling?</p>
                <p className="text-xs text-muted-foreground">Apply now to become a LocalCooks seller</p>
              </div>
            )}
          </CardContent>
          <CardFooter className="bg-muted/5 border-t border-border/30 pt-4">
            {applications?.length > 0 ? (
              <Button 
                variant="outline" 
                className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                onClick={() => setActiveTab("applications")}
              >
                View Application Details
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button 
                className="w-full"
                onClick={() => {
                  setApplicationViewMode('form');
                  setActiveTab('applications');
                }}
              >
                Apply to Sell
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </CardFooter>
        </Card>

        {/* Kitchen Access Path */}
        <Card className="border-border/50 shadow-sm overflow-hidden group hover:shadow-lg transition-all">
          <div className="h-2 bg-gradient-to-r from-blue-600 to-blue-400" />
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                  <Building className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-xl">Kitchen Access</CardTitle>
                  <CardDescription>Book commercial kitchen spaces</CardDescription>
                </div>
              </div>
              {kitchenApplications.length > 0 && (
                <Badge variant={kitchenSummary.variant} className="text-[10px]">
                  {kitchenSummary.label}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Access our network of commercial kitchens. Apply to kitchens, get approved, and book time slots to prepare your food.
            </p>
            
            {kitchenApplications.length > 0 ? (
              <div className="space-y-3">
                {kitchenApplications.slice(0, 2).map((app) => {
                  // Determine proper status based on Enterprise 3-Tier System:
                  // - Tier 1: Application submitted, pending review (status='inReview')
                  // - Tier 2: Step 1 approved, chef completing Step 2 (status='approved', current_tier < 3)
                  // - Tier 3: Fully approved, ready to book (status='approved', current_tier >= 3)
                  const getKitchenAppStatus = () => {
                    if (app.status === 'inReview') {
                      return { label: 'In Review', variant: 'secondary' as const, color: 'bg-amber-500' };
                    }
                    if (app.status === 'rejected') {
                      return { label: 'Rejected', variant: 'destructive' as const, color: 'bg-red-500' };
                    }
                    if (app.status === 'approved') {
                      const tier = app.current_tier ?? 1;
                      // Tier 3: Fully approved, ready to book
                      if (tier >= 3) {
                        return { label: 'Ready to Book', variant: 'default' as const, color: 'bg-green-600' };
                      }
                      // Tier 2: Step 2 submitted, awaiting manager review
                      if (tier === 2 && app.tier2_completed_at) {
                        return { label: 'Step 2 Review', variant: 'secondary' as const, color: 'bg-orange-500' };
                      }
                      // Tier 2: Step 1 approved, chef needs to submit Step 2
                      if (tier === 2 && !app.tier2_completed_at) {
                        return { label: 'Step 2 Pending', variant: 'secondary' as const, color: 'bg-blue-500' };
                      }
                      // Tier 1: Step 1 approved (default)
                      return { label: 'Step 1 Approved', variant: 'default' as const, color: 'bg-blue-600' };
                    }
                    return { label: 'Unknown', variant: 'outline' as const, color: 'bg-gray-500' };
                  };
                  const status = getKitchenAppStatus();
                  return (
                    <div key={app.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50">
                      <div className="flex items-center gap-2">
                        <Building className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium truncate max-w-[150px]">{app.location?.name || 'Kitchen'}</span>
                      </div>
                      <Badge 
                        variant={status.variant} 
                        className={cn("text-[10px]", status.color, "text-white hover:" + status.color)}
                      >
                        {status.label}
                      </Badge>
                    </div>
                  );
                })}
                {kitchenApplications.length > 2 && (
                  <p className="text-xs text-muted-foreground text-center">
                    +{kitchenApplications.length - 2} more kitchens
                  </p>
                )}
              </div>
            ) : (
              <div className="p-4 bg-blue-500/5 rounded-lg border border-blue-500/10 text-center">
                <Building className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                <p className="text-sm font-medium">Need a commercial kitchen?</p>
                <p className="text-xs text-muted-foreground">Explore our partner kitchens</p>
              </div>
            )}
          </CardContent>
          <CardFooter className="bg-muted/5 border-t border-border/30 pt-4 gap-2">
            {kitchenApplications.length > 0 ? (
              <>
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => setActiveTab("kitchen-applications")}
                >
                  My Kitchens
                </Button>
                <Button 
                  variant="outline"
                  className="flex-1 group-hover:bg-blue-600 group-hover:text-white transition-colors"
                  onClick={() => setActiveTab("discover-kitchens")}
                >
                  Discover More
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button 
                className="w-full bg-blue-600 hover:bg-blue-700"
                onClick={() => setActiveTab("discover-kitchens")}
              >
                Explore Kitchens
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>

      {/* Quick Actions / Next Steps */}
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
              <TrendingUp className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <CardTitle className="text-lg">Recommended Next Steps</CardTitle>
              <CardDescription>Continue your journey with LocalCooks</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {!microlearningCompletion?.confirmed && (
              <Button 
                variant="outline" 
                className="h-auto py-4 px-4 justify-start gap-3 hover:bg-green-50 hover:border-green-200"
                asChild
              >
                <Link href="/microlearning/overview">
                  <BookOpen className="h-5 w-5 text-green-600" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Complete Training</p>
                    <p className="text-xs text-muted-foreground">Food safety certification</p>
                  </div>
                </Link>
              </Button>
            )}
            
            {applications?.length === 0 && (
              <Button 
                variant="outline" 
                className="h-auto py-4 px-4 justify-start gap-3 hover:bg-primary/5 hover:border-primary/20"
                onClick={() => {
                  setApplicationViewMode('form');
                  setActiveTab('applications');
                }}
              >
                <Store className="h-5 w-5 text-primary" />
                <div className="text-left">
                  <p className="font-medium text-sm">Apply to Sell</p>
                  <p className="text-xs text-muted-foreground">Start your seller journey</p>
                </div>
              </Button>
            )}

            {kitchenApplications.length === 0 && (
              <Button 
                variant="outline" 
                className="h-auto py-4 px-4 justify-start gap-3 hover:bg-blue-50 hover:border-blue-200"
                onClick={() => setActiveTab("discover-kitchens")}
              >
                <Building className="h-5 w-5 text-blue-600" />
                <div className="text-left">
                  <p className="font-medium text-sm">Find a Kitchen</p>
                  <p className="text-xs text-muted-foreground">Browse commercial spaces</p>
                </div>
              </Button>
            )}

            {enrichedBookings?.length === 0 && kitchenApplications.some(a => a.status === 'approved') && (
              <Button 
                variant="outline" 
                className="h-auto py-4 px-4 justify-start gap-3 hover:bg-amber-50 hover:border-amber-200"
                onClick={handleBookSessionClick}
              >
                <Calendar className="h-5 w-5 text-amber-600" />
                <div className="text-left">
                  <p className="font-medium text-sm">Book a Session</p>
                  <p className="text-xs text-muted-foreground">Schedule kitchen time</p>
                </div>
              </Button>
            )}

            <Button 
              variant="outline" 
              className="h-auto py-4 px-4 justify-start gap-3 hover:bg-purple-50 hover:border-purple-200"
              onClick={() => setActiveTab("messages")}
            >
              <MessageCircle className="h-5 w-5 text-purple-600" />
              <div className="text-left">
                <p className="font-medium text-sm">Messages</p>
                <p className="text-xs text-muted-foreground">Chat with managers</p>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
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
      bgColor: 'bg-gray-500',
      icon: AlertCircle,
      description: 'Status unknown.'
    };
  };

  // Document Verification View within My Application tab
  // Check if documents are actually uploaded and pending review
  const hasUploadedDocuments = documentVerification?.foodSafetyLicenseUrl || documentVerification?.foodEstablishmentCertUrl;
  const documentsArePending = hasUploadedDocuments && documentVerification?.foodSafetyLicenseStatus === 'pending';

  const documentVerificationView = (
    <div className="space-y-6">
      {/* Header with Back Button - No redundant breadcrumbs since dashboard already has them */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setApplicationViewMode('list')}
            className="rounded-xl"
          >
            <ArrowRight className="h-5 w-5 rotate-180" />
          </Button>
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">Document Verification</h2>
            <p className="text-muted-foreground mt-1">Upload and manage your chef certificates</p>
          </div>
        </div>
      </div>

      {/* Document Verification Status Overview */}
      <Card className="border-0 shadow-lg overflow-hidden">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary via-amber-500 to-green-500" />
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                Verification Status
              </CardTitle>
              <CardDescription>Track your document verification progress</CardDescription>
            </div>
            {documentVerification && (
              <Badge 
                variant={
                  documentVerification.foodSafetyLicenseStatus === 'approved' ? 'default' :
                  documentVerification.foodSafetyLicenseStatus === 'pending' ? 'secondary' :
                  'destructive'
                }
                className="text-xs"
              >
                {documentVerification.foodSafetyLicenseStatus === 'approved' ? 'Verified' :
                 documentVerification.foodSafetyLicenseStatus === 'pending' ? 'Under Review' :
                 documentVerification.foodSafetyLicenseStatus === 'rejected' ? 'Needs Attention' :
                 'Not Started'}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Progress Steps */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex flex-col items-center gap-2 flex-1">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold",
                documentVerification?.foodSafetyLicenseUrl ? "bg-green-500 text-white" : "bg-primary/10 text-primary"
              )}>
                {documentVerification?.foodSafetyLicenseUrl ? <CheckCircle className="h-5 w-5" /> : "1"}
              </div>
              <span className="text-xs text-center text-muted-foreground">Upload</span>
            </div>
            <div className="flex-1 h-0.5 bg-gradient-to-r from-green-500 to-amber-400 mx-2" />
            <div className="flex flex-col items-center gap-2 flex-1">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold",
                documentVerification?.foodSafetyLicenseStatus === 'approved' ? "bg-green-500 text-white" :
                documentVerification?.foodSafetyLicenseStatus === 'pending' ? "bg-amber-100 border-2 border-amber-400 text-amber-600" :
                "bg-gray-100 text-gray-400"
              )}>
                {documentVerification?.foodSafetyLicenseStatus === 'approved' ? <CheckCircle className="h-5 w-5" /> : "2"}
              </div>
              <span className="text-xs text-center text-muted-foreground">Review</span>
            </div>
            <div className={cn(
              "flex-1 h-0.5 mx-2",
              documentVerification?.foodSafetyLicenseStatus === 'approved' ? "bg-gradient-to-r from-amber-400 to-green-500" : "bg-gray-200"
            )} />
            <div className="flex flex-col items-center gap-2 flex-1">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold",
                documentVerification?.foodSafetyLicenseStatus === 'approved' ? "bg-green-500 text-white" : "bg-gray-100 text-gray-400"
              )}>
                {documentVerification?.foodSafetyLicenseStatus === 'approved' ? <CheckCircle className="h-5 w-5" /> : "3"}
              </div>
              <span className="text-xs text-center text-muted-foreground">Verified</span>
            </div>
          </div>

          <p className="text-sm text-muted-foreground text-center">
            Verification typically takes 1-3 business days. You'll receive email notifications at each step.
          </p>
        </CardContent>
      </Card>

      {/* Documents Under Review Notice - Only show when documents are ACTUALLY uploaded and pending */}
      {documentsArePending && (
        <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-3">
          <Clock className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">Documents Under Review</p>
            <p className="text-sm text-amber-700 mt-1">
              We're currently reviewing your submitted documents. You'll receive an email notification once the review is complete.
              Until then, you have full access to your dashboard.
            </p>
            <p className="text-sm text-amber-600 mt-2">
              You can still update or replace your documents below if needed.
            </p>
          </div>
        </div>
      )}

      {/* Documents Not Uploaded Notice - Show when no documents have been uploaded yet */}
      {!hasUploadedDocuments && (
        <div className="p-4 bg-blue-50 rounded-xl border border-blue-200 flex items-start gap-3">
          <FileText className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800">Documents Required</p>
            <p className="text-sm text-blue-700 mt-1">
              Please upload your Food Safety License to complete your verification. This is required before you can start selling on LocalCooks.
            </p>
          </div>
        </div>
      )}

      {/* Document Upload Component */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg">Required Documents</CardTitle>
          <CardDescription>Upload your food safety certifications to complete verification</CardDescription>
        </CardHeader>
        <CardContent>
          <DocumentUpload forceShowForm={true} />
        </CardContent>
      </Card>
    </div>
  );

  const applicationsTabContent = applicationViewMode === 'form' ? (
    <ApplicationFormPanel onBack={() => setApplicationViewMode('list')} />
  ) : applicationViewMode === 'documents' ? (
    documentVerificationView
  ) : (
    <div className="space-y-8">
      {/* ============================================== */}
      {/* SELLER APPLICATION SECTION (TOP) */}
      {/* ============================================== */}
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
              <Store className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-foreground">Sell on LocalCooks</h2>
              <p className="text-muted-foreground mt-1">Your seller application and verification status</p>
            </div>
          </div>
          {!hasActiveSellerApplication && (
            <Button 
              size="lg" 
              onClick={() => setApplicationViewMode('form')}
              className="rounded-xl shadow-lg shadow-primary/10"
            >
              Start New Application
            </Button>
          )}
        </div>

        {/* Stripe Connect Payment Setup - Only visible after chef's seller application is FULLY approved */}
        {isSellerApplicationFullyApproved && (
          <ChefStripeConnectSetup isApproved={true} />
        )}

        {userDisplayInfo.applications && userDisplayInfo.applications.length > 0 ? (
          <div className="grid gap-6">
            {userDisplayInfo.applications.map((app: AnyApplication) => {
              // Get document status badge styling
              const getDocStatusBadge = (status: string | undefined) => {
                if (!status || status === 'N/A') return { variant: 'outline' as const, className: 'bg-gray-100 text-gray-600' };
                if (status === 'approved') return { variant: 'default' as const, className: 'bg-green-100 text-green-800 border-green-200' };
                if (status === 'pending') return { variant: 'secondary' as const, className: 'bg-amber-100 text-amber-800 border-amber-200' };
                if (status === 'rejected') return { variant: 'destructive' as const, className: 'bg-red-100 text-red-800 border-red-200' };
                return { variant: 'outline' as const, className: '' };
              };

              const foodSafetyStatus = ('foodSafetyLicenseStatus' in app ? (app as any).foodSafetyLicenseStatus : undefined);
              const establishmentStatus = ('foodEstablishmentCertStatus' in app ? (app as any).foodEstablishmentCertStatus : undefined);
              const foodSafetyUrl = ('foodSafetyLicenseUrl' in app ? (app as any).foodSafetyLicenseUrl : undefined);
              const establishmentUrl = ('foodEstablishmentCertUrl' in app ? (app as any).foodEstablishmentCertUrl : undefined);

              return (
                <Card key={app.id} className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md">
                  <div className="h-1.5 w-full bg-primary" />
                  <CardHeader className="pb-4">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Store className="h-5 w-5 text-primary" />
                          <CardTitle className="text-xl font-bold">Seller Application #{app.id}</CardTitle>
                        </div>
                        <CardDescription className="flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5" />
                          Submitted on {new Date(app.createdAt || "").toLocaleDateString()}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={getStatusVariant(app.status)} className="px-3 py-1 text-xs uppercase tracking-wider font-bold">
                          {formatApplicationStatus(app.status)}
                        </Badge>
                        {app.status !== 'approved' && app.status !== 'cancelled' && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            onClick={() => handleCancelApplication('chef', app.id)}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6 pt-0">
                    <Separator className="bg-border/50" />
                    
                    {/* Application Status Description */}
                    <div className={cn(
                      "flex items-start gap-3 p-4 rounded-lg border",
                      app.status === 'approved' ? "bg-green-50 border-green-200" :
                      app.status === 'inReview' ? "bg-amber-50 border-amber-200" :
                      app.status === 'rejected' ? "bg-red-50 border-red-200" :
                      "bg-gray-50 border-gray-200"
                    )}>
                      {app.status === 'approved' ? <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" /> :
                       app.status === 'inReview' ? <Clock className="h-5 w-5 text-amber-600 mt-0.5" /> :
                       app.status === 'rejected' ? <XCircle className="h-5 w-5 text-red-600 mt-0.5" /> :
                       <AlertCircle className="h-5 w-5 text-gray-600 mt-0.5" />}
                      <div className="flex-1">
                        <p className="text-sm font-medium">
                          {app.status === 'approved' ? 'Application Approved' :
                           app.status === 'inReview' ? 'Application Under Review' :
                           app.status === 'rejected' ? 'Application Rejected' :
                           app.status === 'cancelled' ? 'Application Cancelled' : 'Application Status'}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {app.status === 'approved' ? 'Your seller application has been approved. Complete document verification to start selling.' :
                           app.status === 'inReview' ? 'Our team is reviewing your application. You will be notified once a decision is made.' :
                           app.status === 'rejected' ? 'Your application was not approved. Please review the feedback and submit a new application.' :
                           app.status === 'cancelled' ? 'This application has been cancelled.' : ''}
                        </p>
                      </div>
                    </div>

                    {/* Submitted Application Details - What the chef submitted */}
                    <div className="space-y-4">
                      <h4 className="text-sm font-bold uppercase text-muted-foreground tracking-wider flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Submitted Information
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="p-3 bg-muted/30 rounded-lg border border-border/40">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Full Name</p>
                          <p className="text-sm font-medium mt-1">{app.fullName || 'Not provided'}</p>
                        </div>
                        <div className="p-3 bg-muted/30 rounded-lg border border-border/40">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Email</p>
                          <p className="text-sm font-medium mt-1">{app.email || 'Not provided'}</p>
                        </div>
                        <div className="p-3 bg-muted/30 rounded-lg border border-border/40">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Phone Number</p>
                          <p className="text-sm font-medium mt-1">{app.phone || 'Not provided'}</p>
                        </div>
                        <div className="p-3 bg-muted/30 rounded-lg border border-border/40">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Kitchen Preference</p>
                          <p className="text-sm font-medium mt-1 capitalize">{app.kitchenPreference || 'Not specified'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Document Verification Section */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold uppercase text-muted-foreground tracking-wider flex items-center gap-2">
                          <Shield className="h-4 w-4" />
                          Document Verification
                        </h4>
                        {app.status !== 'cancelled' && app.status !== 'rejected' && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => setApplicationViewMode('documents')}
                            className="text-xs"
                          >
                            <FileText className="h-3 w-3 mr-1" />
                            Manage Documents
                          </Button>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Food Safety License */}
                        <div className="p-4 rounded-lg border border-border/50 bg-card">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                                <FileText className="h-5 w-5 text-blue-600" />
                              </div>
                              <div>
                                <p className="text-sm font-medium">Food Safety License</p>
                                <p className="text-xs text-muted-foreground">
                                  {foodSafetyUrl ? 'Required document' : 'Not uploaded'}
                                </p>
                              </div>
                            </div>
                            {/* Only show status badge if document is actually uploaded */}
                            {foodSafetyUrl ? (
                              <Badge 
                                variant={getDocStatusBadge(foodSafetyStatus).variant}
                                className={cn("text-[10px] uppercase", getDocStatusBadge(foodSafetyStatus).className)}
                              >
                                {foodSafetyStatus === 'approved' && <CheckCircle className="h-3 w-3 mr-1" />}
                                {foodSafetyStatus === 'pending' && <Clock className="h-3 w-3 mr-1" />}
                                {foodSafetyStatus === 'rejected' && <XCircle className="h-3 w-3 mr-1" />}
                                {foodSafetyStatus || 'Pending'}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] uppercase bg-gray-100 text-gray-600">
                                Not Uploaded
                              </Badge>
                            )}
                          </div>
                          {foodSafetyUrl && (
                            <div className="mt-3 pt-3 border-t border-border/30">
                              <Button variant="ghost" size="sm" className="text-xs h-7 px-2" asChild>
                                <a href={foodSafetyUrl} target="_blank" rel="noopener noreferrer">
                                  <FileText className="h-3 w-3 mr-1" />
                                  View Document
                                </a>
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Food Establishment Certificate */}
                        <div className="p-4 rounded-lg border border-border/50 bg-card">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                                <FileText className="h-5 w-5 text-green-600" />
                              </div>
                              <div>
                                <p className="text-sm font-medium">Food Establishment Cert</p>
                                <p className="text-xs text-muted-foreground">
                                  {establishmentUrl ? 'Document uploaded' : 'Not uploaded'}
                                </p>
                              </div>
                            </div>
                            {/* Only show status badge if document is actually uploaded */}
                            {establishmentUrl ? (
                              <Badge 
                                variant={getDocStatusBadge(establishmentStatus).variant}
                                className={cn("text-[10px] uppercase", getDocStatusBadge(establishmentStatus).className)}
                              >
                                {establishmentStatus === 'approved' && <CheckCircle className="h-3 w-3 mr-1" />}
                                {establishmentStatus === 'pending' && <Clock className="h-3 w-3 mr-1" />}
                                {establishmentStatus === 'rejected' && <XCircle className="h-3 w-3 mr-1" />}
                                {establishmentStatus || 'Pending'}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] uppercase bg-gray-100 text-gray-600">
                                Not Uploaded
                              </Badge>
                            )}
                          </div>
                          {establishmentUrl && (
                            <div className="mt-3 pt-3 border-t border-border/30">
                              <Button variant="ghost" size="sm" className="text-xs h-7 px-2" asChild>
                                <a href={establishmentUrl} target="_blank" rel="noopener noreferrer">
                                  <FileText className="h-3 w-3 mr-1" />
                                  View Document
                                </a>
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Document Update Notice */}
                      {app.status !== 'cancelled' && app.status !== 'rejected' && (
                        <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-blue-800">
                            <strong>Update Documents:</strong> You can update your documents anytime. New uploads will reset your verification status to "pending review" for security.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Reviewer Feedback */}
                    {app.feedback && (
                      <div className="p-4 bg-primary/5 rounded-xl border border-primary/10 flex items-start gap-3">
                        <MessageCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-foreground">Reviewer Feedback</p>
                          <p className="text-sm text-foreground/70 italic leading-relaxed">{app.feedback}</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="bg-muted/5 py-4 border-t border-border/30 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setApplicationViewMode('documents')}>
                      <FileText className="h-4 w-4 mr-2" />
                      Manage Documents
                    </Button>
                    <Button 
                      variant="link" 
                      className="text-primary p-0 h-auto font-medium text-sm"
                      onClick={() => setApplicationViewMode('documents')}
                    >
                      View Document Verification
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
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
                  <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-semibold">
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
                    className="w-full rounded-xl shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/30 transition-all bg-blue-600 hover:bg-blue-700"
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
      </div>

      {/* Document Management Modal */}
      <DocumentManagementModal open={showDocumentModal} onOpenChange={setShowDocumentModal} />
    </div>
  );

  const trainingTabContent = (
    <TrainingOverviewPanel />
  );

  const bookingsTabContent = (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Kitchen Bookings</h2>
          <p className="text-muted-foreground mt-1">View and manage your upcoming kitchen sessions.</p>
        </div>
        <Button onClick={handleBookSessionClick}>
          Book a Session
        </Button>
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
    <div className="space-y-8">
       <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20 shadow-sm">
          <Building className="h-6 w-6 text-blue-600" />
        </div>
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">My Kitchens</h2>
          <p className="text-muted-foreground mt-1">Your approved commercial kitchen spaces.</p>
        </div>
      </div>

      {kitchenApplications.length > 0 ? (
        <div className="space-y-4">
          {kitchenApplications.map((app) => {
            // Find matching public kitchen data for images, equipment, storage
            const kitchenData = publicKitchens?.find(k => k.locationId === app.locationId);
            const hasImage = !!kitchenData?.imageUrl || !!app.location?.brandImageUrl;
            const imageUrl = kitchenData?.imageUrl || app.location?.brandImageUrl;
            const equipment = kitchenData?.equipment || [];
            const displayEquipment = equipment.slice(0, 3);
            const remainingEquipment = equipment.length - 3;
            const storageSummary = kitchenData?.storageSummary;
            const hourlyRate = kitchenData?.hourlyRate;

            // Format price (cents to dollars)
            const formatPrice = (cents: number) => `$${(cents / 100).toFixed(0)}`;
            const priceDisplay = hourlyRate ? formatPrice(hourlyRate) : null;

            // Status badge configuration
            const getStatusConfig = () => {
              if (app.status === 'approved' && (app.current_tier ?? 1) >= 3) {
                return { label: 'Ready to Book', bgColor: 'bg-blue-600 hover:bg-blue-600', icon: CheckCircle };
              }
              if (app.status === 'approved') {
                return { label: 'In Progress', bgColor: 'bg-amber-500 hover:bg-amber-500', icon: Clock };
              }
              if (app.status === 'inReview') {
                return { label: 'In Review', bgColor: 'bg-amber-500 hover:bg-amber-500', icon: Clock };
              }
              return { label: 'Rejected', bgColor: 'bg-red-500 hover:bg-red-500', icon: XCircle };
            };
            const statusConfig = getStatusConfig();

            return (
              <Card
                key={app.id}
                className="overflow-hidden border-border/50 hover:shadow-lg hover:border-border transition-all duration-300 group"
              >
                <div className="flex flex-col md:flex-row">
                  {/* Image Section */}
                  <div className="md:w-72 lg:w-80 flex-shrink-0">
                    <AspectRatio ratio={16 / 10} className="md:h-full">
                      {hasImage ? (
                        <img
                          src={imageUrl!}
                          alt={app.location?.name || 'Kitchen'}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 flex items-center justify-center">
                          <Building className="h-16 w-16 text-white/80" />
                        </div>
                      )}
                    </AspectRatio>
                  </div>

                  {/* Content Section */}
                  <div className="flex-1 p-5 md:p-6 flex flex-col">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="text-xl font-bold text-foreground truncate">
                            {app.location?.name || 'Unknown Location'}
                          </h3>
                          <Badge
                            variant="default"
                            className={cn(
                              "text-[10px] uppercase tracking-wider",
                              statusConfig.bgColor
                            )}
                          >
                            <statusConfig.icon className="h-3 w-3 mr-1" />
                            {statusConfig.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">{app.location?.address || 'Address not available'}</span>
                        </div>
                      </div>

                      {/* Price Badge */}
                      {priceDisplay && (
                        <div className="text-right flex-shrink-0">
                          <div className="flex items-center gap-1 text-lg font-bold text-foreground">
                            <span>{priceDisplay}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">per hour</p>
                        </div>
                      )}
                    </div>

                    {/* Equipment & Storage */}
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      {/* Equipment badges */}
                      {displayEquipment.length > 0 && (
                        <>
                          {displayEquipment.map((item: string, idx: number) => (
                            <Badge
                              key={idx}
                              variant="outline"
                              className="text-xs font-normal bg-muted/30 border-border/50"
                            >
                              <Utensils className="h-3 w-3 mr-1 text-muted-foreground" />
                              {item}
                            </Badge>
                          ))}
                          {remainingEquipment > 0 && (
                            <Badge variant="outline" className="text-xs font-normal bg-muted/30 border-border/50">
                              +{remainingEquipment} more
                            </Badge>
                          )}
                        </>
                      )}

                      {/* Storage indicators */}
                      {storageSummary && storageSummary.totalStorageUnits > 0 && (
                        <div className="flex items-center gap-1 ml-1">
                          {(displayEquipment.length > 0) && <span className="text-muted-foreground/50">|</span>}
                          {storageSummary.hasColdStorage && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <div className="w-6 h-6 rounded bg-blue-100 flex items-center justify-center">
                                    <Thermometer className="h-3.5 w-3.5 text-blue-600" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent><p>Cold Storage Available</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {storageSummary.hasFreezerStorage && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <div className="w-6 h-6 rounded bg-cyan-100 flex items-center justify-center">
                                    <Snowflake className="h-3.5 w-3.5 text-cyan-600" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent><p>Freezer Storage Available</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {storageSummary.hasDryStorage && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <div className="w-6 h-6 rounded bg-amber-100 flex items-center justify-center">
                                    <Package className="h-3.5 w-3.5 text-amber-600" />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent><p>Dry Storage Available</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      )}

                      {/* Show placeholder if no equipment/storage data */}
                      {displayEquipment.length === 0 && (!storageSummary || storageSummary.totalStorageUnits === 0) && (
                        <span className="text-xs text-muted-foreground italic">Kitchen details available after booking</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-3 mt-auto pt-2">
                      {(app.status === 'approved' || app.status === 'inReview') && app.chat_conversation_id && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={async () => {
                            if (!chefId) return;
                            setChatApplication(app);
                            setChatConversationId(app.chat_conversation_id);
                            setShowChatDialog(true);
                          }}
                        >
                          <MessageCircle className="h-4 w-4" />
                          Chat
                        </Button>
                      )}
                      {app.status === 'approved' && (
                        (app.current_tier ?? 1) >= 3 ? (
                          <Button
                            size="sm"
                            className="gap-2 bg-blue-600 hover:bg-blue-700"
                            onClick={() => {
                              setBookingLocation({
                                id: app.locationId,
                                name: app.location?.name || 'Kitchen',
                                address: app.location?.address,
                              });
                              setBookingSheetOpen(true);
                            }}
                          >
                            <Calendar className="h-4 w-4" />
                            Book Now
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            onClick={() => window.location.href = `/kitchen-requirements/${app.locationId}`}
                          >
                            <ArrowRight className="h-4 w-4" />
                            Complete Requirements
                          </Button>
                        )
                      )}
                      {app.status === 'inReview' && (
                        <Badge variant="secondary" className="text-xs">
                          <Clock className="h-3 w-3 mr-1" />
                          Awaiting manager review
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed border-2 py-16 bg-muted/5">
          <CardContent className="text-center flex flex-col items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
              <Building className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-2">
               <CardTitle className="text-xl">No kitchen access yet</CardTitle>
               <CardDescription className="max-w-sm mx-auto">Explore commercial kitchens in your area and apply for access to start booking.</CardDescription>
            </div>
            <Button className="px-8 rounded-xl bg-blue-600 hover:bg-blue-700" onClick={() => setActiveTab("discover-kitchens")}>
              Explore Kitchens
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
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
    
    // Default: just show the current tab
    return undefined; // Let the layout generate default breadcrumbs
  };

  return (
    <ChefDashboardLayout
      activeView={activeTab}
      onViewChange={(view) => {
        setActiveTab(view);
        // Reset application view mode when changing tabs
        if (view !== 'applications') {
          setApplicationViewMode('list');
        }
      }}
      messageBadgeCount={0}
      breadcrumbs={getBreadcrumbs()}
    >
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
      
      {renderContent()}

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
                      <p className="text-[10px] text-muted-foreground">Application #{chatApplication.id}</p>
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
