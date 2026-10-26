import { useFirebaseAuth } from "@/hooks/use-auth";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import KitchenApplicationForm from "@/components/kitchen-application/KitchenApplicationForm";
import { ApplicationSubmissionSummary } from "@/components/kitchen-application/ApplicationSubmissionSummary";
import { useGlobalMyApplications, useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEffect, useRef, useState, useMemo } from "react";
import { motion } from "framer-motion";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { useChefShellChrome } from "@/layouts/chef-shell-context";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";
import { kt } from "@/i18n/kitchen-ns";
import { saveAuthIntent } from "@/lib/auth-intent";
import { PreferredDaysPicker } from "@/components/kitchen-application/PreferredDaysPicker";
import { useKitchenJourneyEmailVerified } from "@/components/auth/KitchenJourneyAuth";
import { RequestToCookPage } from "@/components/kitchen-application/RequestToCookPage";
import KitchenJourneyLayout from "@/components/kitchen-application/KitchenJourneyLayout";
import { getKitchenDisplayStatus, hasStep2BeenSubmitted } from "@/components/chef/applications/status";
import { apiRequest } from '@/lib/queryClient';
import type { TourApplicationNextStep } from '@shared/tour-application';

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
  const tourParam = new URLSearchParams(window.location.search).get('tourId');
  const tourId = tourParam && /^[1-9]\d*$/.test(tourParam) && Number.isSafeInteger(Number(tourParam)) ? Number(tourParam) : null;
  const { data: tourNextStep, isLoading: tourLoading, isError: tourError, refetch: refetchTour } = useQuery<TourApplicationNextStep | null>({
    queryKey: ['/api/viewings/chef', user?.uid, tourId, locationId, 'application-next-step'],
    queryFn: async () => (await apiRequest('GET', tourId ? `/api/viewings/chef/${tourId}/application-next-step`
      : `/api/viewings/chef/application-reference/${locationId}`)).json(),
    enabled: !!user && !!locationId && emailVerified && (tourParam === null || !!tourId),
    staleTime: 0,
  });
  const progressKey = `kitchen_apply_progress_${kitchenId || locationId}`;
  const onePageMounted = useRef(false);
  // Signed in when the page opened: the request sits inside the app (owner, Oct 26). Someone who signs in mid-request keeps
  // the plain layout, because swapping layouts would remount the form and drop their answers.
  const inAppAtStart = useRef<boolean | null>(null);
  if (inAppAtStart.current === null && !authLoading) inAppAtStart.current = !!user && emailVerified;
  const [activeView, setActiveView] = useState("discover-kitchens");
  const [submittedTier, setSubmittedTier] = useState<number | null>(null);
  const { t } = useTranslation("kitchen");
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
    enabled: !!locationId,
  });
  // Links without ?kitchenId (tours, Compare, My kitchens) still get the days-and-price picker: the toured kitchen, else a location's only kitchen.
  const locationKitchens = publicKitchens.filter((item) => item.locationId === locationId);
  const pickedKitchenId = kitchenId ? Number(kitchenId) : tourNextStep?.kitchenId ?? (locationKitchens.length === 1 ? locationKitchens[0].id : null);
  const selectedKitchen = locationKitchens.find((item) => item.id === pickedKitchenId);

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
  // After Send, and for anyone who already applied, the kitchen page is the one place for this kitchen (owner, Oct 26):
  // it says where the request stands. Only booking requirements still to send keep this page (the step-2 form).
  const goToKitchenPage = (query: string) => navigate(`/dashboard?view=kitchen-requests&location=${locationId}${query}`, { replace: true });
  const alreadyApplied = !!user && emailVerified && submittedTier === null && !!locationApplication && hasKitchenApp
    && !["rejected", "cancelled"].includes(locationApplication.status) && !(applicationProgress?.actionKind === "complete-step" && !applicationProgress.bookingBlocked);
  useEffect(() => { if (alreadyApplied && !locationAppLoading) goToKitchenPage("&notice=applied"); }, [alreadyApplied, locationAppLoading]);
  const onRequirements = applicationProgress?.actionKind === "complete-step" && !applicationProgress.bookingBlocked;
  const isAwaitingReview = applicationProgress?.actionKind === "wait" &&
    (locationApplication?.current_tier ?? 1) < 3;
  const step2Submitted = locationApplication ? hasStep2BeenSubmitted(locationApplication) : false;
  const documentsSubmitted = step2Submitted || (submittedTier !== null && submittedTier >= 2);

  const isLoading = authLoading || locationLoading || kitchensLoading || (!!user && locationAppLoading) || (!!user && emailVerified && tourLoading);

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
      {isAwaitingReview || submittedTier !== null ? (
        <ApplicationSubmissionSummary
          kitchenName={selectedKitchen?.name || location?.name || "Kitchen application"}
          title={documentsSubmitted ? "Documents in review" : "Request in review"}
          description={documentsSubmitted ? "Your booking requirements were submitted." : "Your request to apply was submitted."}
          nextStep="We’ll email you when there’s an update. You can track your application at any time."
          actionLabel="View my applications"
          onAction={() => navigate(`/dashboard?view=kitchen-requests${locationApplication?.id ? `&application=${locationApplication.id}` : ""}`)}
        />
      ) : (
        <>
      {/* Application Form */}
      <KitchenApplicationForm
        location={location!}
        globalApp={globalApp}
        tourReference={tourNextStep?.prefill}
        sourceTourId={tourNextStep?.action === 'apply' ? tourNextStep.sourceTourId : undefined}
        onSuccess={(tier) => {
          try { localStorage.removeItem(progressKey); sessionStorage.removeItem(progressKey); } catch { /* storage unavailable */ }
          setSubmittedTier(tier);
          goToKitchenPage(tier >= 2 ? "&sent=requirements" : "&sent=1");
        }}
        onCancel={() => navigate(`/kitchen-requirements/${locationId}`)}
      />

      {/* Help Section */}
      <div className="text-center text-sm text-muted-foreground py-4">
        <p>
          {t("needHelpContact", { defaultValue: "Need help? Contact us at" })}{" "}
          <a href="mailto:support@localcooks.ca" className="underline underline-offset-2 hover:text-foreground">
            support@localcooks.ca
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
    if (tourError && tourParam === null) return <Alert variant="destructive">
      <AlertTitle>{t('tourApplicationCheckFailed', { defaultValue: 'Could not check your tour information' })}</AlertTitle>
      <AlertDescription><Button variant="outline" onClick={() => void refetchTour()}>{t('tourApplicationRetry', { defaultValue: 'Check again' })}</Button></AlertDescription>
    </Alert>;
    if (tourParam !== null && (!tourId || tourError || !tourNextStep || tourNextStep.action === 'unavailable'
      || tourNextStep.locationId !== locationId || (!!kitchenId && tourNextStep.kitchenId !== Number(kitchenId)))) return (
      <Alert variant="destructive">
        <AlertTitle>{t('tourApplicationUnavailable', { defaultValue: 'This tour’s application next step is unavailable' })}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{t('tourApplicationUnavailableHelp', { defaultValue: 'The visit or kitchen may have changed. Check your tour or try again.' })}</p>
          {tourError && <Button variant="outline" onClick={() => void refetchTour()}>{t('tourApplicationRetry', { defaultValue: 'Check again' })}</Button>}
          <Button variant="outline" onClick={() => navigate(`/dashboard?view=viewings&viewing=${tourId || ''}`)}>{t('tourApplicationBack', { defaultValue: 'View tour' })}</Button>
        </AlertDescription>
      </Alert>
    );
    if (tourNextStep?.action === 'view') return <ApplicationSubmissionSummary kitchenName={location.name}
      title={t('tourApplicationViewTitle', { defaultValue: 'Your kitchen application' })}
      description={t('tourApplicationViewHelp', { defaultValue: 'You already have an application or kitchen access. View its current status and next step.' })}
      nextStep={t('tourApplicationViewNext', { defaultValue: 'Continue through your existing kitchen request.' })}
      actionLabel={t('tourApplicationViewAction', { defaultValue: 'View my applications' })}
      onAction={() => navigate('/dashboard?view=kitchen-requests')} />;
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
      // Same trail as My kitchens and the kitchen page: "Kitchens › {location} › {step}".
      {
        label: t("kitchensCrumb", { defaultValue: "Kitchens" }),
        onClick: () => navigate("/dashboard?view=discover-kitchens"),
        navId: "discover-kitchens" as const,
      },
      {
        label: location?.name || t("applyFlowKitchenFallbackName", { defaultValue: "Kitchen" }),
        onClick: () => navigate(`/kitchen-requirements/${locationId}`),
      },
      { label: onRequirements ? t("bookingRequirementsCrumb", { defaultValue: "Booking requirements" }) : t("requestToApply", { defaultValue: "Request to apply" }) },
    ],
    [t, navigate, location?.name, locationId, onRequirements]
  );

  const inShell = useChefShellChrome({
    activeView,
    onViewChange: applyOnViewChange,
    breadcrumbs: applyBreadcrumbs,
  });

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

  // One page for every new request, signed in or not (owner, Oct 23). It stays mounted while an inline sign-in or the
  // new account settles (both flip the auth phase), so a half-sent request never drops back to a loader.
  const existingRequest = !!user && emailVerified && hasKitchenApp && !!locationApplication
    && locationApplication.status !== 'rejected' && locationApplication.status !== 'cancelled';
  // A tour link that doesn't resolve to "apply here" keeps its own explanation (same checks as getContent below).
  const tourBlocks = !!user && emailVerified && ((tourError && tourParam === null) || (tourParam !== null && (!tourId || tourError || !tourNextStep
    || tourNextStep.action !== 'apply' || tourNextStep.locationId !== locationId || (!!kitchenId && tourNextStep.kitchenId !== Number(kitchenId)))));
  const showOnePage = !!location && submittedTier === null && !existingRequest && !tourBlocks
    && (onePageMounted.current || (!authLoading && !locationLoading && !kitchensLoading && !(user && emailVerified && (locationAppLoading || tourLoading))));
  onePageMounted.current = showOnePage;
  if (showOnePage) {
    const page = <RequestToCookPage location={location as any} kitchen={selectedKitchen} kitchenId={selectedKitchen ? String(selectedKitchen.id) : kitchenId} emailVerified={emailVerified}
      globalApp={globalApp} tourReference={tourNextStep?.prefill}
      sourceTourId={tourNextStep?.action === 'apply' ? tourNextStep.sourceTourId : undefined}
      onCancel={() => navigate(`/kitchen-preview/${locationId}`)}
      onSent={() => { void refetchLocationApp(); setSubmittedTier(1); goToKitchenPage("&sent=1"); }} />;
    if (!inAppAtStart.current || inShell) return page;
    return <ChefDashboardLayout activeView={activeView} onViewChange={applyOnViewChange} breadcrumbs={applyBreadcrumbs}>{page}</ChefDashboardLayout>;
  }

  if (authLoading || locationLoading || kitchensLoading) {
    return <main className="mx-auto w-full max-w-3xl px-4 py-12" role="status">{loadingContent}</main>;
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

  return <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-12" role="status"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-[400px] w-full rounded-xl" /></main>;
}
