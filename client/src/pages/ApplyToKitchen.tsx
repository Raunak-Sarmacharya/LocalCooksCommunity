import { useFirebaseAuth } from "@/hooks/use-auth";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import KitchenApplicationForm from "@/components/kitchen-application/KitchenApplicationForm";
import { useGlobalMyApplications, useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Building2, Loader2, Calendar, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";
import { kt } from "@/i18n/kitchen-ns";

interface PublicLocation {
  id: number;
  slug?: string;
  name: string;
  address: string;
  city?: string;
  logoUrl?: string | null;
  brandImageUrl?: string | null;
}



export default function ApplyToKitchen() {
  const { user, loading: authLoading } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const params = useParams<{ locationId: string }>();
  const locationId = params.locationId ? parseInt(params.locationId) : null;
  const [activeView, setActiveView] = useState("discover-kitchens");
  const { t } = useTranslation("kitchen");
  const [hasBookingIntent, setHasBookingIntent] = useState(false);
  const [intentDateRange, setIntentDateRange] = useState<{from: string, to?: string} | null>(null);

  // Scroll to top on mount and check intent
  useEffect(() => {
    window.scrollTo(0, 0);
    
    let bestIntent = null;
    let specificIntent = null;
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('kitchen_dates_')) {
          const val = sessionStorage.getItem(key);
          if (val) {
             const parsed = JSON.parse(val);
             if (parsed.from) {
               if (key !== 'kitchen_dates_generic') {
                 specificIntent = parsed;
               } else {
                 bestIntent = parsed;
               }
             }
          }
        }
      }
    } catch(e) {}
    
    const parsedIntent = specificIntent || bestIntent;
    if (parsedIntent) {
      setHasBookingIntent(true);
      setIntentDateRange(parsedIntent);
    }
  }, []);

  const formatDateRange = () => {
    if (!intentDateRange?.from) return '';
    const fromDate = new Date(intentDateRange.from);
    if (isNaN(fromDate.getTime())) return '';
    
    // Revert forcing UTC to fix local time offsets
    const formatter = new Intl.DateTimeFormat('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    
    const fromStr = formatter.format(fromDate);
    
    if (intentDateRange.to && intentDateRange.to !== intentDateRange.from) {
      const toDate = new Date(intentDateRange.to);
      if (!isNaN(toDate.getTime())) {
        return `${fromStr} - ${formatter.format(toDate)}`;
      }
    }
    return fromStr;
  };

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate(`/auth?redirect=/apply-kitchen/${locationId}`);
    }
  }, [user, authLoading, navigate, locationId]);

  // Fetch location details
  const { data: location, isLoading: locationLoading, error: locationError } = useQuery<PublicLocation>({
    queryKey: ["/api/public/locations", locationId, "details"],
    queryFn: async () => {
      if (!locationId) throw new Error(kt("noLocationIdProvided"));

      const response = await fetch(`/api/public/locations/${locationId}/details`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(kt("locationNotFound"));
        }
        throw new Error(kt("failedToFetchLocation"));
      }
      return response.json();
    },
    enabled: !!locationId,
  });

  const { applications: globalApplications, isLoading: globalLoading } = useGlobalMyApplications();
  const globalApp = globalApplications?.[0] || null;
  const globalAppPending = globalApp?.status === 'inReview';

  // Fetch existing per-kitchen application for this location. The kitchen
  // application is independent from the platform/seller application — a chef
  // can apply to a specific kitchen without having completed the platform
  // onboarding. We just check if they already submitted for THIS location.
  const { application: locationApplication, hasApplication: hasKitchenApp } =
    useChefKitchenApplicationForLocation(user && locationId ? locationId : null);

  // Only block the form while Step 1 is awaiting LocalCooks admin review.
  // After approval, chefs must reach KitchenApplicationForm for Step 2 docs.
  const isAwaitingStep1Review =
    hasKitchenApp &&
    !!locationApplication &&
    locationApplication.status === "inReview" &&
    (locationApplication.current_tier ?? 1) < 2;

  const isLoading = authLoading || locationLoading || globalLoading;

  // Loading content
  const loadingContent = (
    <div className="space-y-6">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-[400px] w-full rounded-xl" />
    </div>
  );

  // Not found content
  const notFoundContent = (
    <Card className="shadow-none">
      <CardContent className="p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
          <Building2 className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold mb-2">{t("locationNotFound", { defaultValue: "Location Not Found" })}</h2>
        <p className="text-muted-foreground mb-6">
          {locationError?.message || t("locationNotFoundDesc", { defaultValue: "The kitchen location you're looking for doesn't exist or has been removed." })}
        </p>
        <Button onClick={() => navigate("/dashboard?view=discover-kitchens")}>
          {t("findKitchensBtn", { defaultValue: "Find Kitchens" })}
        </Button>
      </CardContent>
    </Card>
  );

  // Main application form content
  // NOTE: The kitchen application is INDEPENDENT from the platform/seller
  // application. A chef can apply to a specific kitchen without having
  // completed the platform onboarding. The global application is only used
  // opportunistically to pre-fill some fields if it exists.
  const mainContent = (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {isAwaitingStep1Review ? (
        <Card className="shadow-none border-dashed border-2">
          <CardContent className="p-12 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
              <ClipboardList className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              {t("applicationAlreadySubmittedTitle", "Application Already Submitted")}
            </h2>
            <p className="text-muted-foreground max-w-md">
              {t(
                "applicationPendingAdminReviewDesc",
                "Your request to apply is being reviewed by the LocalCooks team. We’ll notify you once a decision is made."
              )}
            </p>
            <div className="mt-6 text-sm text-muted-foreground">
              {t("statusLabel", "Status")}:{" "}
              <span className="font-semibold text-foreground">
                {t("kdInReview", "In review")}
              </span>
            </div>
            <Button
              className="mt-8"
              onClick={() => navigate("/dashboard?view=kitchen-applications")}
            >
              {t("backToDashboard")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
      {hasBookingIntent && (
        <div className="flex items-start sm:items-center gap-4 p-4 bg-muted/40 border border-border/50 rounded-lg">
          <div className="p-2 bg-background rounded-md shadow-sm border border-border/40 shrink-0">
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium leading-none text-foreground">
              {t("bookingDatesSaved", { range: formatDateRange(), defaultValue: `Booking dates saved: ${formatDateRange()}` })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t(
                "completeApplicationSecureTime",
                "Complete your application below to secure your kitchen time."
              )}
            </p>
          </div>
        </div>
      )}

      {/* Application Form */}
      <KitchenApplicationForm
        location={location!}
        globalApp={globalApp}
        onSuccess={() => {
          let hasIntent = false;
          try {
            for (let i = 0; i < sessionStorage.length; i++) {
              const key = sessionStorage.key(i);
              if (key && key.startsWith('kitchen_dates_')) {
                hasIntent = true;
                break;
              }
            }
          } catch(e) {}

          if (hasIntent && locationId) {
            navigate(`/kitchen-preview/${locationId}`);
          } else {
            navigate("/dashboard?view=kitchen-applications");
          }
        }}
        onCancel={() => navigate(`/kitchen-requirements/${locationId}`)}
      />

      {/* Help Section */}
      <div className="text-center text-sm text-muted-foreground py-4">
        <p>
          {t("needHelpContact", { defaultValue: "Need help? Contact us at" })}{" "}
          <a href="mailto:support@localcook.shop" className="underline underline-offset-2 hover:text-foreground">
            support@localcook.shop
          </a>
        </p>
      </div>
      </>
      )}
    </motion.div>
  );

  // Determine what content to show
  const getContent = () => {
    if (isLoading) return loadingContent;
    if (!locationId || locationError || !location) return notFoundContent;
    return mainContent;
  };

  // If not authenticated, redirect (handled by useEffect)
  if (!user && !authLoading) {
    return null;
  }

  // If user is authenticated, wrap in ChefDashboardLayout
  if (user) {
    return (
      <ChefDashboardLayout
        activeView={activeView}
        onViewChange={(view) => {
          setActiveView(view);
          // REPLACE so back button doesn't bounce through this apply-to-kitchen page.
          navigate(chefDashboardHref(view), { replace: true });
        }}
        breadcrumbs={[
          { label: t("dashboard", { defaultValue: "Dashboard" }), onClick: () => navigate('/dashboard') },
          { label: t("discoverKitchens", { defaultValue: "Discover Kitchens" }), onClick: () => navigate('/dashboard?view=discover-kitchens') },
          { label: location?.name || t("applyFlowKitchenFallbackName", { defaultValue: "Kitchen" }), onClick: () => navigate(`/kitchen-requirements/${locationId}`) },
          { label: t("requestToApply", { defaultValue: "Request to apply" }) },
        ]}
      >
        {getContent()}
      </ChefDashboardLayout>
    );
  }

  // Fallback for loading state before auth is determined
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

