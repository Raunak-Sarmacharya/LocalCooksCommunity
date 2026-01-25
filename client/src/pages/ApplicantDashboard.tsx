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
import { ChefPageLayout } from "@/components/layout/ChefPageLayout";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
  MessageCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState, useMemo } from "react";
import { Link } from "wouter";
import { useCustomAlerts } from "@/components/ui/custom-alerts";

// Type alias for application
type AnyApplication = Application;


export default function ApplicantDashboard() {
  const { user: authUser } = useFirebaseAuth();
  const user = authUser as UserWithFlags | null;
  const [showVendorPortalPopup, setShowVendorPortalPopup] = useState(false);
  const [showChatDialog, setShowChatDialog] = useState(false);
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

  const overviewTabContent = (
    <div className="space-y-8">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Chef Apps</p>
              <p className="text-2xl font-bold text-foreground">{applications?.length || 0}</p>
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
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
              <Shield className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Documents</p>
              <p className="text-sm font-bold text-foreground">{getDocumentStatus()}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
              <Clock className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</p>
              <p className="text-sm font-bold text-foreground truncate">{getApplicationStatus() || "Getting Started"}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {userDisplayInfo.applications && userDisplayInfo.applications.length > 0 ? (
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="space-y-1">
              <CardTitle className="text-xl">Latest Application</CardTitle>
              <CardDescription className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5" />
                Submitted on {getMostRecentApplication()?.createdAt ? new Date(getMostRecentApplication()!.createdAt).toLocaleDateString() : 'N/A'}
              </CardDescription>
            </div>
            <Badge variant={getStatusVariant(getMostRecentApplication()?.status || "")} className="px-3 py-1 text-xs uppercase tracking-wider font-bold">
              {formatApplicationStatus(getMostRecentApplication()?.status || "")}
            </Badge>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-y py-6 border-border/50 mb-6">
               <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Full Name</p>
                    <p className="text-base font-medium">{getMostRecentApplication()?.fullName}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Email Address</p>
                    <p className="text-base font-medium">{getMostRecentApplication()?.email}</p>
                  </div>
               </div>
               <div className="flex flex-col justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Next Step</p>
                    <p className="text-sm text-foreground/80 italic leading-relaxed">
                      {getMostRecentApplication()?.status === 'inReview' 
                        ? "Our team is currently reviewing your documents. Keep an eye on your messages for updates." 
                        : "Continue your onboarding process to unlock access to commercial kitchens."}
                    </p>
                  </div>
               </div>
            </div>
            <Button variant="outline" className="w-full h-11" onClick={() => setActiveTab("applications")}>
              View All Application History
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed border-2 bg-muted/5">
          <CardContent className="p-12 text-center flex flex-col items-center gap-6">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center border-4 border-background shadow-inner">
               <ChefHat className="h-10 w-10 text-primary" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-bold tracking-tight">Start Your Culinary Journey</h3>
              <p className="text-muted-foreground text-base max-w-sm mx-auto">
                Submit your application to become a verified cook and access commercial kitchen spaces.
              </p>
            </div>
            <Button asChild size="lg" className="rounded-xl px-10 shadow-lg shadow-primary/20">
              <Link href="/apply">Apply Now</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );

  const applicationsTabContent = (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">My Applications</h2>
          <p className="text-muted-foreground mt-1">Review and manage your chef verification history.</p>
        </div>
        <Button asChild size="lg" variant="outline" className="rounded-xl border-primary text-primary hover:bg-primary/10">
          <Link href="/apply">New Application</Link>
        </Button>
      </div>

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
                      app.status === 'approved' && app.tier2_completed_at ? 'bg-green-600 hover:bg-green-600' : 
                      app.status === 'approved' ? 'bg-blue-600 hover:bg-blue-600' :
                      app.status === 'inReview' ? 'bg-amber-600 hover:bg-amber-600' : 'bg-red-600 hover:bg-red-600'
                    )}
                  >
                    {app.status === 'approved' && app.tier2_completed_at
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
                  app.tier2_completed_at ? (
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
    <div className="h-[calc(100vh-14rem)] flex flex-col space-y-4">
       <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-sm">
            <MessageCircle className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">Messages</h2>
            <p className="text-muted-foreground mt-1">Communication with managers and support.</p>
          </div>
       </div>
       <Card className="flex-1 overflow-hidden border-border/50 shadow-sm bg-background">
          <UnifiedChatView userId={chefId} role="chef" />
       </Card>
    </div>
  );

  return (
    <ChefPageLayout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      title={user?.displayName ? `Welcome, ${user.displayName.split(' ')[0]}` : "Chef Portal"}
      description="Manage your applications, training, and kitchen bookings"
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-6 h-auto p-1 bg-muted/50 border border-border/50 rounded-xl overflow-auto no-scrollbar">
          <TabsTrigger value="overview" className="rounded-lg py-2.5 transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm">Overview</TabsTrigger>
          <TabsTrigger value="applications" className="rounded-lg py-2.5 transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm">Applications</TabsTrigger>
          <TabsTrigger value="kitchen-applications" className="rounded-lg py-2.5 transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm">Kitchen Access</TabsTrigger>
          <TabsTrigger value="bookings" className="rounded-lg py-2.5 transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm">Bookings</TabsTrigger>
          <TabsTrigger value="training" className="rounded-lg py-2.5 transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm">Training</TabsTrigger>
          <TabsTrigger value="messages" className="rounded-lg py-2.5 transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm">Messages</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-8 animate-in fade-in-50 duration-500">
          {overviewTabContent}
        </TabsContent>

        <TabsContent value="applications" className="space-y-8 animate-in fade-in-50 duration-500">
          {applicationsTabContent}
        </TabsContent>

        <TabsContent value="kitchen-applications" className="space-y-8 animate-in fade-in-50 duration-500">
          {kitchenApplicationsTabContent}
        </TabsContent>

        <TabsContent value="bookings" className="space-y-8 animate-in fade-in-50 duration-500">
          {bookingsTabContent}
        </TabsContent>

        <TabsContent value="training" className="space-y-8 animate-in fade-in-50 duration-500">
          {trainingTabContent}
        </TabsContent>

        <TabsContent value="messages" className="animate-in fade-in-50 duration-500">
          {messagesTabContent}
        </TabsContent>
      </Tabs>

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
    </ChefPageLayout>
  );
}
