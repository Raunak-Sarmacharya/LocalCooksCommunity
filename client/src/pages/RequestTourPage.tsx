import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import ScheduleViewingWidget from "@/components/chef/ScheduleViewingWidget";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import KitchenJourneyLayout from "@/components/kitchen-application/KitchenJourneyLayout";
import { useEffect, useMemo } from "react";
import { useChefShellChrome } from "@/layouts/chef-shell-context";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import { Button } from "@/components/ui/button";
import { useTourRequestAccess } from '@/hooks/use-tour-request-access';

export default function RequestTourPage() {
  const { locationId: rawLocationId } = useParams<{ locationId: string }>();
  const locationId = Number(rawLocationId);
  const kitchenId = Number(new URLSearchParams(window.location.search).get("kitchenId"));
  const [, navigate] = useLocation();
  const { user, loading: authLoading } = useFirebaseAuth();
  const tourAccess = useTourRequestAccess(kitchenId, user?.uid);
  const { hasApplication, isLoading: applicationLoading, error: applicationError, refetch: refetchApplication } = useChefKitchenApplicationForLocation(user && locationId ? locationId : null);
  const { data: kitchens = [], isLoading: kitchensLoading } = useQuery<Array<{ id: number; locationId: number; name: string; imageUrl?: string | null }>>({
    queryKey: ["/api/public/kitchens"],
    queryFn: async () => {
      const response = await fetch("/api/public/kitchens");
      if (!response.ok) throw new Error("Could not load the kitchen");
      return response.json();
    },
  });
  const kitchen = kitchens.find((item) => item.id === kitchenId && item.locationId === locationId);
  const back = () => navigate(`/kitchen-preview/${locationId}`);
  const breadcrumbs = useMemo(() => [
    { label: "Discover kitchens", onClick: () => navigate(chefDashboardHref("discover-kitchens")), navId: "discover-kitchens" as const },
    { label: kitchen?.name || "Kitchen", onClick: back },
    { label: "Request a tour" },
  ], [navigate, locationId, kitchen?.name]);
  useChefShellChrome({ activeView: "viewings", breadcrumbs });

  const existingTour = tourAccess.data?.canRequest === false && tourAccess.data.tour?.kind !== 'failed' ? tourAccess.data.tour : null;
  useEffect(() => {
    if (existingTour) navigate(`${chefDashboardHref('viewings')}&viewing=${existingTour.id}`, { replace: true });
  }, [existingTour?.id, navigate]);
  const tourAccessLoading = !!user && !tourAccess.isFetched;
  const accessError = applicationError || tourAccess.error;

  if (!authLoading && !kitchensLoading && !applicationLoading && !tourAccessLoading && !accessError
    && kitchen && !hasApplication && (!user || tourAccess.data?.canRequest)) {
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
      title={loading ? "Preparing your tour" : accessError ? "We couldn’t check your access" : existingTour ? "Opening your tour details" : hasApplication ? "Your access request is underway" : "Kitchen unavailable"}
      description={loading ? "Checking this kitchen and your existing requests." : accessError ? "Please check your kitchen access before requesting a tour." : existingTour ? "Your existing tour shows its current status and next steps." : hasApplication ? "Tours are available before requesting access to a kitchen." : "We could not find this kitchen."}
      imageUrl={kitchen?.imageUrl}
      onBack={back}
      backLabel="Cancel"
      aside={<p className="text-sm text-muted-foreground">{loading ? "Your choices will stay here as the page loads." : "You can return to this kitchen's listing."}</p>}
    >
      <div role={loading ? "status" : undefined} className="space-y-4 text-sm text-muted-foreground">
        <p>{loading ? "Checking your tour options…" : accessError ? "Your request may already be in progress. We won’t ask you to submit another until we can confirm." : existingTour ? "Review the details of your kitchen tour." : hasApplication ? "Check your kitchen application for the next step." : "Return to the kitchen listing to choose an available space."}</p>
        {accessError && <Button variant="outline" onClick={() => { void refetchApplication(); void tourAccess.refetch(); }}>Check again</Button>}
        {existingTour && <Button variant="outline" onClick={() => navigate(`${chefDashboardHref('viewings')}&viewing=${existingTour.id}`)}>View tour details</Button>}
        {hasApplication && <Button variant="outline" onClick={() => navigate(chefDashboardHref("viewings"))}>View My Tours</Button>}
      </div>
    </KitchenJourneyLayout>
  );
}
