import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation, useParams } from "wouter";
import ScheduleViewingWidget from "@/components/chef/ScheduleViewingWidget";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import KitchenJourneyLayout from "@/components/kitchen-application/KitchenJourneyLayout";
import { useEffect, useMemo, useRef } from "react";
import { useChefShellChrome } from "@/layouts/chef-shell-context";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import { Button } from "@/components/ui/button";
import { useTourRequestAccess } from '@/hooks/use-tour-request-access';

export default function RequestTourPage() {
  const { locationId: rawLocationId } = useParams<{ locationId: string }>();
  const locationId = Number(rawLocationId);
  const requestedKitchenId = Number(new URLSearchParams(window.location.search).get("kitchenId"));
  const [, navigate] = useLocation();
  const { t } = useTranslation("chef");
  const { user, loading: authLoading } = useFirebaseAuth();
  const { data: kitchens = [], isLoading: kitchensLoading } = useQuery<Array<{ id: number; locationId: number; name: string; imageUrl?: string | null }>>({
    queryKey: ["/api/public/kitchens"],
    queryFn: async () => {
      const response = await fetch("/api/public/kitchens");
      if (!response.ok) throw new Error("Could not load the kitchen");
      return response.json();
    },
  });
  // A link without ?kitchenId= (an old link, or typed by hand) uses the location's only kitchen, instead of waiting forever.
  const locationKitchens = kitchens.filter((item) => item.locationId === locationId);
  const kitchenId = requestedKitchenId > 0 ? requestedKitchenId : locationKitchens.length === 1 ? locationKitchens[0].id : NaN;
  // An account without a confirmed email can't be checked yet; the request page confirms it with a code, then these
  // checks run and the booking route enforces them again.
  const checkedUser = user && (user.isVerified || user.is_verified) ? user : null;
  const tourAccess = useTourRequestAccess(kitchenId, checkedUser?.uid);
  const { application, hasApplication, isLoading: applicationLoading, error: applicationError, refetch: refetchApplication } = useChefKitchenApplicationForLocation(checkedUser && locationId ? locationId : null);
  const kitchen = kitchens.find((item) => item.id === kitchenId && item.locationId === locationId);
  const back = () => navigate(`/kitchen-preview/${locationId}`);
  const breadcrumbs = useMemo(() => [
    { label: t("shellDiscoverKitchens"), onClick: () => navigate(chefDashboardHref("discover-kitchens")), navId: "discover-kitchens" as const },
    { label: kitchen?.name || t("apptabKitchenFallback"), onClick: back },
    { label: t("requestATour", { ns: "kitchen" }) },
  ], [navigate, locationId, kitchen?.name, t]);
  useChefShellChrome({ activeView: "viewings", breadcrumbs });

  // Applied (or given access) here: no tour; the application is the next step, even when an older tour exists.
  const applied = !!checkedUser && !applicationLoading && (hasApplication || tourAccess.data?.reason === 'application');
  const existingTour = !applied && tourAccess.data?.canRequest === false && tourAccess.data.tour?.kind !== 'failed' ? tourAccess.data.tour : null;
  const dropHalfFilledRequest = () => {
    localStorage.removeItem(`viewing_booking_${kitchenId}`);
    sessionStorage.removeItem(`viewing_booking_${kitchenId}`);
  };
  useEffect(() => {
    if (!existingTour) return;
    // Signed in mid-request at a kitchen they already toured (or have a tour at): drop the half-filled request.
    dropHalfFilledRequest();
    navigate(`${chefDashboardHref('viewings')}&viewing=${existingTour.id}&notice=already`, { replace: true });
  }, [existingTour?.id, navigate]);
  useEffect(() => {
    if (!applied || !kitchenId) return;
    dropHalfFilledRequest();
    // Access without an application (granted directly) books from the kitchen page.
    navigate(application?.id ? `/dashboard?view=kitchen-requests&application=${application.id}&notice=tour` : `/kitchen-preview/${locationId}`, { replace: true });
  }, [applied, application?.id, navigate]);
  const tourAccessLoading = !!checkedUser && kitchenId > 0 && !tourAccess.isFetched;
  const accessError = applicationError || tourAccess.error;

  const ready = !authLoading && !kitchensLoading && !applicationLoading && !tourAccessLoading && !accessError
    && kitchen && !applied && !hasApplication && (!checkedUser || tourAccess.data?.canRequest);
  // Once shown, the request stays mounted while the checks re-run for a chef who just confirmed their email (code sign-up
  // or sign-in): unmounting it there dropped the send in progress (Oct 26). A block found then still redirects above.
  const shown = useRef(false);
  if (ready) shown.current = true;
  if (kitchen && (ready || (shown.current && !applied && !existingTour && !accessError))) {
    return (
      <ScheduleViewingWidget
        presentation="page"
        locationId={locationId}
        locationName={kitchen.name}
        targetedKitchenId={kitchen.id}
        targetedKitchenName={kitchen.name}
        kitchenImageUrl={kitchen.imageUrl}
        onClose={back}
      />
    );
  }

  const loading = authLoading || kitchensLoading || applicationLoading || tourAccessLoading;
  return (
    <KitchenJourneyLayout
      eyebrow="Request a tour"
      title={loading ? "Preparing your tour" : accessError ? "We couldn’t check your access" : existingTour ? "Opening your tour details" : applied ? "Opening your application" : "Kitchen unavailable"}
      description={loading ? "Checking this kitchen and your existing requests." : accessError ? "Please check your kitchen access before requesting a tour." : existingTour ? "Your existing tour shows its current status and next steps." : applied ? "You’ve already applied to this kitchen, so there’s no tour to request." : "We could not find this kitchen."}
      imageUrl={kitchen?.imageUrl}
      onBack={back}
      backLabel="Cancel"
      aside={<p className="text-sm text-muted-foreground">{loading ? "Your choices will stay here as the page loads." : "You can return to this kitchen's listing."}</p>}
    >
      <div role={loading ? "status" : undefined} className="space-y-4 text-sm text-muted-foreground">
        <p>{loading ? "Checking your tour options…" : accessError ? "Your request may already be in progress. We won’t ask you to submit another until we can confirm." : existingTour ? "Review the details of your kitchen tour." : applied ? "Your application shows the next step." : "Return to the kitchen listing to choose an available space."}</p>
        {accessError && <Button variant="outline" onClick={() => { void refetchApplication(); void tourAccess.refetch(); }}>Check again</Button>}
        {existingTour && <Button variant="outline" onClick={() => navigate(`${chefDashboardHref('viewings')}&viewing=${existingTour.id}`)}>View tour details</Button>}
      </div>
    </KitchenJourneyLayout>
  );
}
