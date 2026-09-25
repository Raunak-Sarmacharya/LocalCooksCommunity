import { useFirebaseAuth } from "@/hooks/use-auth";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import KitchenApplicationForm from "@/components/kitchen-application/KitchenApplicationForm";
import { useGlobalMyApplications, useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Building2, Loader2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { useChefShellChrome } from "@/layouts/chef-shell-context";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";
import { kt } from "@/i18n/kitchen-ns";
import { saveAuthIntent } from "@/lib/auth-intent";
import { KitchenBookingPreferencesPanel } from "@/components/kitchen-application/KitchenBookingPreferencesPanel";
import KitchenJourneyAuth, { useKitchenJourneyEmailVerified } from "@/components/auth/KitchenJourneyAuth";
import KitchenJourneyLayout, { KitchenJourneySteps } from "@/components/kitchen-application/KitchenJourneyLayout";
import { getKitchenDisplayStatus, hasStep2BeenSubmitted } from "@/components/chef/applications/status";

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
  const emailVerified = useKitchenJourneyEmailVerified();
  const [, navigate] = useLocation();
  const params = useParams<{ locationId: string }>();
  const locationId = params.locationId ? parseInt(params.locationId) : null;
  const kitchenId = new URLSearchParams(window.location.search).get("kitchenId");
  const progressKey = `kitchen_apply_progress_${kitchenId || locationId}`;
  const [requestStep, setRequestStep] = useState<"plan" | "details">(() => {
    try { return (localStorage.getItem(progressKey) || sessionStorage.getItem(progressKey)) === "details" ? "details" : "plan"; }
    catch { return "plan"; }
  });
  const [activeView, setActiveView] = useState("discover-kitchens");
  const { t } = useTranslation("kitchen");
  // Start at the request form even when arriving with a saved date choice.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Keep registration and verification on this kitchen's request page.
  useEffect(() => {
    if (locationId) {
      saveAuthIntent({
        type: "apply",
        returnPath: `/apply-kitchen/${locationId}${window.location.search}`,
        locationId,
      });
    }
  }, [locationId]);

  useEffect(() => {
    try { localStorage.setItem(progressKey, requestStep); } catch { /* storage unavailable */ }
  }, [progressKey, requestStep]);

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

  const { data: publicKitchens = [], isLoading: kitchensLoading } = useQuery<Array<{ id: number; locationId: number; name: string; imageUrl?: string | null }>>({
    queryKey: ["/api/public/kitchens"],
    queryFn: async () => {
      const response = await fetch("/api/public/kitchens");
      if (!response.ok) throw new Error("Could not load the kitchen");
      return response.json();
    },
    enabled: !!kitchenId,
  });
  const selectedKitchen = publicKitchens.find((item) => item.id === Number(kitchenId) && item.locationId === locationId);

  const { applications: globalApplications } = useGlobalMyApplications();
  const globalApp = globalApplications?.[0] || null;
  const globalAppPending = globalApp?.status === 'inReview';

  // Fetch existing per-kitchen application for this location. The kitchen
  // application is independent from the platform/seller application — a chef
  // can apply to a specific kitchen without having completed the platform
  // onboarding. We just check if they already submitted for THIS location.
  const { application: locationApplication, hasApplication: hasKitchenApp, isLoading: locationAppLoading, error: locationAppError, refetch: refetchLocationApp } =
    useChefKitchenApplicationForLocation(user && locationId ? locationId : null);

  // Only block the form while Step 1 is awaiting Local Cooks review.
  // After approval, chefs must reach KitchenApplicationForm for Step 2 docs.
  const applicationProgress = hasKitchenApp && locationApplication
    ? getKitchenDisplayStatus(locationApplication)
    : null;
  const isAwaitingReview = applicationProgress?.actionKind === "wait" &&
    (locationApplication?.current_tier ?? 1) < 3;
  const step2Submitted = locationApplication ? hasStep2BeenSubmitted(locationApplication) : false;

  const isLoading = authLoading || locationLoading || kitchensLoading || (!!user && locationAppLoading);

  // Loading content
  const loadingContent = (
    <div className="space-y-6" role="status" aria-label="Checking your kitchen application">
      <p className="text-sm text-muted-foreground">Checking your kitchen application…</p>
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
      {isAwaitingReview ? (
        <Card className="shadow-none border-dashed border-2">
          <CardContent className="p-12 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
              <ClipboardList className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              {step2Submitted ? "Kitchen documents under review" : "Your request is in progress"}
            </h2>
            <p className="text-muted-foreground max-w-md">
              {step2Submitted
                ? "Your kitchen documents are being reviewed. We’ll notify you when you can book."
                : "Local Cooks is reviewing your request to apply. You don’t need to submit it again; we’ll notify you when you can continue."}
            </p>
            <div className="mt-6 text-sm text-muted-foreground">
              {t("statusLabel", "Status")}:{" "}
              <span className="font-semibold text-foreground">
                {applicationProgress?.label || t("kdInReview", "In review")}
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
      {/* Application Form */}
      <KitchenApplicationForm
        location={location!}
        globalApp={globalApp}
        onSuccess={() => {
          try { localStorage.removeItem(progressKey); sessionStorage.removeItem(progressKey); } catch { /* storage unavailable */ }
          let hasIntent = false;
          try {
            hasIntent = !!kitchenId && !!(localStorage.getItem(`kitchen_dates_${kitchenId}`) || sessionStorage.getItem(`kitchen_dates_${kitchenId}`));
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
    if (locationAppError) return (
      <Alert variant="destructive">
        <AlertTitle>Couldn’t check your application</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>We couldn’t confirm whether you already have a request for this kitchen. Please try again before submitting.</p>
          <Button variant="outline" onClick={() => void refetchLocationApp()}>Check again</Button>
        </AlertDescription>
      </Alert>
    );
    return mainContent;
  };

  const applyOnViewChange = (view: string) => {
    setActiveView(view);
    navigate(chefDashboardHref(view), { replace: true });
  };

  const applyBreadcrumbs = useMemo(
    () => [
      { label: t("dashboard", { defaultValue: "Dashboard" }), onClick: () => navigate("/dashboard"), navId: "overview" as const },
      {
        label: t("discoverKitchens", { defaultValue: "Discover Kitchens" }),
        onClick: () => navigate("/dashboard?view=discover-kitchens"),
        navId: "discover-kitchens" as const,
      },
      {
        label: location?.name || t("applyFlowKitchenFallbackName", { defaultValue: "Kitchen" }),
        onClick: () => navigate(`/kitchen-requirements/${locationId}`),
      },
      { label: t("requestToApply", { defaultValue: "Request to apply" }) },
    ],
    [t, navigate, location?.name, locationId]
  );

  const inShell = useChefShellChrome({
    activeView,
    onViewChange: applyOnViewChange,
    breadcrumbs: applyBreadcrumbs,
  });

  const requestAside = (
    <div className="space-y-7">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">Your progress</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">{requestStep === "plan" ? "Plan ahead" : !user || !emailVerified ? "Your account" : "Request access"}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{requestStep === "plan" ? "Your preferred date and hours help you plan. You can continue without choosing either." : !user || !emailVerified ? "Your request stays here while you sign in or verify your email." : "Local Cooks reviews your request before the kitchen receives it."}</p>
      </div>
      <KitchenJourneySteps steps={["Booking preferences", "Account", "Access request"]} current={requestStep === "plan" ? 0 : !user || !emailVerified ? 1 : 2} />
      <p className="rounded-2xl bg-muted/50 p-5 text-sm leading-relaxed text-muted-foreground">No payment is due now. Any preferred date and hours are saved for booking after approval; they are not reserved.</p>
    </div>
  );

  if (!locationLoading && (!locationId || locationError || !location || (!!kitchenId && !kitchensLoading && !selectedKitchen))) {
    return (
      <KitchenJourneyLayout
        eyebrow="Request to apply"
        title="Kitchen unavailable"
        description="We could not find this kitchen. Return to its listing and choose an available space."
        onBack={() => navigate(locationId ? `/kitchen-preview/${locationId}` : "/dashboard?view=discover-kitchens")}
        aside={<p className="text-sm text-muted-foreground">Your request has not been sent.</p>}
      >
        {notFoundContent}
      </KitchenJourneyLayout>
    );
  }

  // Keep the journey mounted while a Google popup or email sign-in is pending.
  if (authLoading || locationLoading || kitchensLoading) {
    return <main className="flex min-h-[50vh] items-center justify-center gap-3" role="status"><Loader2 className="h-5 w-5 animate-spin" />{authLoading ? "Restoring your account…" : "Loading this kitchen…"}</main>;
  }

  const requestJourney = !user || !emailVerified;
  if (requestJourney) {
    return (
      <KitchenJourneyLayout
        eyebrow="Request to apply"
        title={`Cook at ${selectedKitchen?.name || location?.name || "this kitchen"}`}
        description="Plan a future booking if you like, then request access. Local Cooks reviews your request before you complete the kitchen's requirements."
        imageUrl={selectedKitchen?.imageUrl}
        onBack={() => navigate(`/kitchen-preview/${locationId}`)}
        aside={requestAside}
      >
        {requestStep === "plan" ? (
          <div className="space-y-6">
            <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Optional</p><h2 className="mt-2 text-2xl font-semibold">Choose a date and hours</h2><p className="mt-2 text-sm text-muted-foreground">These are preferences for a later booking. You can skip them or change them after approval.</p></div>
            {kitchenId && <KitchenBookingPreferencesPanel kitchenId={kitchenId} stage="schedule" wide />}
            <Button size="lg" className="min-w-52" onClick={() => setRequestStep("details")}>Continue {user && emailVerified ? "to request" : "to account"} →</Button>
          </div>
        ) : (
          <div className="space-y-5 [&_.max-w-3xl]:max-w-none">
            <Button variant="ghost" size="sm" className="-ml-3" onClick={() => setRequestStep("plan")}>← Edit booking preferences</Button>
            {!user || !emailVerified ? <KitchenJourneyAuth title="Continue your access request" /> : getContent()}
          </div>
        )}
      </KitchenJourneyLayout>
    );
  }

  // If user is authenticated, use persistent chef shell (or layout fallback)
  if (user) {
    if (inShell) return getContent();
    return (
      <ChefDashboardLayout
        activeView={activeView}
        onViewChange={applyOnViewChange}
        breadcrumbs={applyBreadcrumbs}
      >
        {getContent()}
      </ChefDashboardLayout>
    );
  }

  return <main className="flex min-h-[50vh] items-center justify-center gap-3" role="status"><Loader2 className="h-5 w-5 animate-spin" />Restoring your account…</main>;
}
