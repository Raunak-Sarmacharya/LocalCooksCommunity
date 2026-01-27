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
import BookingControlPanel from "@/components/booking/BookingControlPanel";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState, useMemo } from "react";
import { Link } from "wouter";
import { useCustomAlerts } from "@/components/ui/custom-alerts";
import ChefStripeConnectSetup from "@/components/chef/ChefStripeConnectSetup";
import { useChefOnboardingStatus } from "@/hooks/use-chef-onboarding-status";

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
  const [activeTab, setActiveTab] = useState("overview");

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

  const getApplicationStatus = () => {
    const mostRecentApp = getMostRecentApplication();
    if (!mostRecentApp) return user?.isChef ? null : "Select Role";
    return formatApplicationStatus(mostRecentApp.status);
  };

  const getDocumentStatus = () => {
    const mostRecentApp = getMostRecentApplication();
    if (!mostRecentApp) return user?.isChef ? "No Documents Uploaded" : "Select Role";

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
              <Button asChild className="w-full">
                <Link href="/apply">
                  Apply to Sell
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
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
                  onClick={() => window.location.href = "/compare-kitchens"}
                >
                  Discover More
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button 
                className="w-full bg-blue-600 hover:bg-blue-700"
                onClick={() => window.location.href = "/compare-kitchens"}
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
                asChild
              >
                <Link href="/apply">
                  <Store className="h-5 w-5 text-primary" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Apply to Sell</p>
                    <p className="text-xs text-muted-foreground">Start your seller journey</p>
                  </div>
                </Link>
              </Button>
            )}

            {kitchenApplications.length === 0 && (
              <Button 
                variant="outline" 
                className="h-auto py-4 px-4 justify-start gap-3 hover:bg-blue-50 hover:border-blue-200"
                onClick={() => window.location.href = "/compare-kitchens"}
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
                onClick={() => setActiveTab("bookings")}
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

  const applicationsTabContent = (
    <div className="space-y-8">
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
        <Button asChild size="lg" variant="outline" className="rounded-xl border-primary text-primary hover:bg-primary/10">
          <Link href="/apply">New Application</Link>
        </Button>
      </div>

      {/* Stripe Connect Payment Setup - Only visible after chef is fully verified (both documents approved) */}
      <ChefStripeConnectSetup 
        isApproved={chefInfo?.isVerified === true} 
      />

      {userDisplayInfo.applications && userDisplayInfo.applications.length > 0 ? (
        <div className="grid gap-6">
          {userDisplayInfo.applications.map((app: AnyApplication) => (
            <Card key={app.id} className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md h-full flex flex-col">
              <div className="h-1.5 w-full bg-primary" />
              <CardHeader className="pb-4">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-1">
                    <CardTitle className="text-xl font-bold">Application #{app.id}</CardTitle>
                    <CardDescription className="flex items-center gap-2">
                       <Calendar className="h-3.5 w-3.5" />
                       Submitted on {new Date(app.createdAt || "").toLocaleDateString()}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={getStatusVariant(app.status)} className="px-3 py-1 text-xs uppercase tracking-wider font-bold">
                       {formatApplicationStatus(app.status)}
                    </Badge>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" asChild>
                        <Link href="/document-verification"><FileText className="h-4 w-4" /></Link>
                      </Button>
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
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-6 pt-0">
                <Separator className="bg-border/50" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                   <div className="space-y-4">
                     <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-[0.2em]">General Info</p>
                     <div className="space-y-3">
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground">Full Name</span>
                          <span className="text-sm font-medium">{app.fullName}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground">Phone Number</span>
                          <span className="text-sm font-medium">{app.phone || "Not provided"}</span>
                        </div>
                     </div>
                   </div>

                   <div className="space-y-4">
                     <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-[0.2em]">Preferences</p>
                     <div className="space-y-3">
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground">Kitchen Preference</span>
                          <span className="text-sm font-medium capitalize">{app.kitchenPreference || "Not specified"}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground">License Info</span>
                          <span className="text-sm font-medium">{app.foodSafetyLicense || "N/A"}</span>
                        </div>
                     </div>
                   </div>

                   <div className="space-y-4">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-[0.2em]">Compliance Checks</p>
                      <div className="space-y-3">
                         <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/40">
                           <span className="text-xs font-medium">Safety License</span>
                           <Badge variant="outline" className="text-[9px] h-4 font-bold tracking-tighter">
                              {('foodSafetyLicenseStatus' in app ? (app as any).foodSafetyLicenseStatus : "N/A")}
                           </Badge>
                         </div>
                         <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/40">
                           <span className="text-xs font-medium">Establishment Cert</span>
                           <Badge variant="outline" className="text-[9px] h-4 font-bold tracking-tighter">
                              {('foodEstablishmentCertStatus' in app ? (app as any).foodEstablishmentCertStatus : "N/A")}
                           </Badge>
                         </div>
                      </div>
                   </div>
                </div>

                {app.feedback && (
                  <div className="p-4 bg-primary/5 rounded-xl border border-primary/10 flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-foreground">Reviewer Feedback</p>
                      <p className="text-sm text-foreground/70 italic leading-relaxed">{app.feedback}</p>
                    </div>
                  </div>
                )}
              </CardContent>
              <CardFooter className="bg-muted/5 py-4 border-t border-border/30">
                 <Button variant="link" className="text-primary p-0 h-auto font-bold uppercase text-[10px] tracking-widest" asChild>
                    <Link href={`/document-verification`}>Manage Verification Documents <ChevronRight className="h-3 w-3 ml-1" /></Link>
                 </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed border-2 py-20 bg-muted/5">
          <CardContent className="text-center flex flex-col items-center gap-6">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center border-4 border-background text-muted-foreground/30">
              <FileText className="h-10 w-10" />
            </div>
            <div className="space-y-2">
              <CardTitle className="text-2xl">No applications found</CardTitle>
              <CardDescription className="max-w-xs mx-auto">
                You haven&apos;t submitted any applications for chef verification yet.
              </CardDescription>
            </div>
            <Button asChild size="lg" className="rounded-xl shadow-lg shadow-primary/10">
              <Link href="/apply">Start New Application</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );

  const trainingTabContent = (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
          <BookOpen className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Training & Certification</h2>
          <p className="text-muted-foreground mt-1">Improve your food safety knowledge and get certified.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-background rounded-2xl p-6 md:p-8 border border-border/50 shadow-sm">
          <div className="flex items-start justify-between mb-8">
            <div className="space-y-2">
              <h3 className="text-xl font-bold">Food Safety Program</h3>
              <p className="text-muted-foreground text-sm max-w-md">Our comprehensive training module covers everything from cross-contamination to proper temperature control.</p>
            </div>
            <Badge className={microlearningCompletion?.confirmed ? "bg-green-600" : "bg-blue-600"}>
              {microlearningCompletion?.confirmed ? "Certificate Earned" : "Available"}
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
             <div className="p-4 bg-muted/30 rounded-xl text-center border border-border/30">
                <p className="text-2xl font-bold">22</p>
                <p className="text-[10px] uppercase text-muted-foreground font-bold">Videos</p>
             </div>
             <div className="p-4 bg-muted/30 rounded-xl text-center border border-border/30">
                <p className="text-2xl font-bold">4.5</p>
                <p className="text-[10px] uppercase text-muted-foreground font-bold">Hours</p>
             </div>
             <div className="p-4 bg-muted/30 rounded-xl text-center border border-border/30">
                <p className="text-2xl font-bold">80%</p>
                <p className="text-[10px] uppercase text-muted-foreground font-bold">Passing</p>
             </div>
             <div className="p-4 bg-muted/30 rounded-xl text-center border border-border/30">
                <p className="text-2xl font-bold">1</p>
                <p className="text-[10px] uppercase text-muted-foreground font-bold">Cert</p>
             </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button asChild className="flex-1 rounded-xl h-11">
              <Link href="/microlearning/overview">
                {microlearningCompletion?.confirmed ? "Review Program" : "Start Learning Now"}
              </Link>
            </Button>
            {microlearningCompletion?.confirmed && (
               <Button variant="outline" className="flex-1 rounded-xl h-11 border-green-200 text-green-700 hover:bg-green-50">
                  Download Certificate
               </Button>
            )}
          </div>
        </div>

        <div className="p-6 bg-primary/5 border border-primary/20 rounded-2xl">
           <h4 className="font-bold mb-4">Why get certified?</h4>
           <ul className="space-y-4">
              <li className="flex gap-3">
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                <p className="text-sm">Trusted by kitchen managers</p>
              </li>
              <li className="flex gap-3">
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                <p className="text-sm">Mandatory for commercial kitchens</p>
              </li>
              <li className="flex gap-3">
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                <p className="text-sm">Professional profile badge</p>
              </li>
              <li className="flex gap-3">
                <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                <p className="text-sm">Latest safety protocols</p>
              </li>
           </ul>
        </div>
      </div>
    </div>
  );

  const bookingsTabContent = (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Kitchen Bookings</h2>
          <p className="text-muted-foreground mt-1">View and manage your upcoming kitchen sessions.</p>
        </div>
        <Button onClick={() => window.location.href = "/compare-kitchens"}>
          Book a Session
        </Button>
      </div>

      <div className="max-w-4xl">
        <BookingControlPanel
          bookings={enrichedBookings}
          isLoading={isLoadingBookings}
          onCancelBooking={handleCancelBooking}
          kitchens={kitchens || []}
        />
      </div>
    </div>
  );

  const kitchenApplicationsTabContent = (
    <div className="space-y-8">
       <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
          <Building className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Kitchen Access</h2>
          <p className="text-muted-foreground mt-1">Applications to specific commercial kitchens.</p>
        </div>
      </div>

      {kitchenApplications.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {kitchenApplications.map((app) => (
            <Card
              key={app.id}
              className="overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md h-full flex flex-col"
            >
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="font-bold text-xl text-foreground">{app.location?.name || 'Unknown Location'}</CardTitle>
                    <CardDescription className="text-xs">{app.location?.address}</CardDescription>
                  </div>
                  <Badge
                    variant={app.status === 'approved' ? 'default' : 'secondary'}
                    className={cn(
                      "px-3 py-1 text-[10px] uppercase font-bold tracking-wider",
                      app.status === 'approved' && (app.current_tier ?? 1) >= 3 ? 'bg-green-600 hover:bg-green-600' : 
                      app.status === 'approved' ? 'bg-blue-600 hover:bg-blue-600' :
                      app.status === 'inReview' ? 'bg-amber-600 hover:bg-amber-600' : 'bg-red-600 hover:bg-red-600'
                    )}
                  >
                    {app.status === 'approved' && (app.current_tier ?? 1) >= 3
                      ? 'Ready to Book'
                      : app.status === 'approved'
                        ? 'In Progress'
                        : app.status === 'inReview'
                          ? 'In Review'
                          : 'Rejected'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <Separator className="mb-4 bg-border/50" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                   {app.status === 'approved' 
                     ? "You have been approved for this kitchen. You can now proceed to book slots or review final requirements."
                     : "Your application is currently being reviewed by the kitchen manager."}
                </p>
              </CardContent>
              <CardFooter className="bg-muted/5 gap-3 border-t border-border/30 pt-4">
                {(app.status === 'approved' || app.status === 'inReview') && app.chat_conversation_id && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 rounded-lg h-9"
                    onClick={async () => {
                      if (!chefId) return;
                      setChatApplication(app);
                      setChatConversationId(app.chat_conversation_id);
                      setShowChatDialog(true);
                    }}
                  >
                    <MessageCircle className="mr-2 h-4 w-4" />
                    Chat
                  </Button>
                )}
                {app.status === 'approved' && (
                  (app.current_tier ?? 1) >= 3 ? (
                    <Button
                      size="sm"
                      className="flex-1 bg-green-600 hover:bg-green-700 rounded-lg h-9"
                      onClick={() => window.location.href = `/book-kitchen?location=${app.locationId}`}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      Book Now
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 rounded-lg h-9"
                      onClick={() => window.location.href = `/kitchen-requirements/${app.locationId}`}
                    >
                      Requirements
                    </Button>
                  )
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed border-2 py-16 bg-muted/5">
          <CardContent className="text-center flex flex-col items-center gap-6">
            <Building className="h-12 w-12 text-muted-foreground/30" />
            <div className="space-y-1">
               <CardTitle className="text-xl">No kitchen access granted</CardTitle>
               <CardDescription>Explore commercial kitchens and apply for access.</CardDescription>
            </div>
            <Button asChild className="px-8 rounded-xl">
              <Link href="/compare-kitchens">Explore Kitchens</Link>
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

  // Render content based on activeTab (sidebar-driven navigation)
  const renderContent = () => {
    switch (activeTab) {
      case "overview":
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{overviewTabContent}</div>;
      case "applications":
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{applicationsTabContent}</div>;
      case "kitchen-applications":
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{kitchenApplicationsTabContent}</div>;
      case "bookings":
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{bookingsTabContent}</div>;
      case "training":
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{trainingTabContent}</div>;
      case "messages":
        return <div className="animate-in fade-in-50 duration-500">{messagesTabContent}</div>;
      default:
        return <div className="space-y-8 animate-in fade-in-50 duration-500">{overviewTabContent}</div>;
    }
  };

  return (
    <ChefDashboardLayout
      activeView={activeTab}
      onViewChange={setActiveTab}
      messageBadgeCount={0}
    >
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
              <Button asChild variant="outline" className="w-full h-12 text-base rounded-xl" onClick={handleCloseVendorPopup}>
                <Link href="/compare-kitchens">Explore Commercial Kitchens</Link>
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
    </ChefDashboardLayout>
  );
}
