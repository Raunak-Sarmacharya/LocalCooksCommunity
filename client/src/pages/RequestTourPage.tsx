import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import ScheduleViewingWidget from "@/components/chef/ScheduleViewingWidget";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefKitchenApplicationForLocation } from "@/hooks/use-chef-kitchen-applications";
import KitchenJourneyLayout from "@/components/kitchen-application/KitchenJourneyLayout";
import { useMemo } from "react";
import { useChefShellChrome } from "@/layouts/chef-shell-context";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import { Button } from "@/components/ui/button";

export default function RequestTourPage() {
  const { locationId: rawLocationId } = useParams<{ locationId: string }>();
  const locationId = Number(rawLocationId);
  const kitchenId = Number(new URLSearchParams(window.location.search).get("kitchenId"));
  const [, navigate] = useLocation();
  const { user } = useFirebaseAuth();
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

  if (!kitchensLoading && !applicationLoading && !applicationError && kitchen && !hasApplication) {
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

  const loading = kitchensLoading || applicationLoading;
  return (
    <KitchenJourneyLayout
      eyebrow="Request a tour"
      title={loading ? "Preparing your tour" : applicationError ? "We couldn’t check your access" : hasApplication ? "Your access request is underway" : "Kitchen unavailable"}
      description={loading ? "Checking this kitchen and your existing requests." : applicationError ? "Please check your kitchen access before requesting a tour." : hasApplication ? "Tours are available before requesting access to a kitchen." : "We could not find this kitchen."}
      imageUrl={kitchen?.imageUrl}
      onBack={back}
      aside={<p className="text-sm text-muted-foreground">{loading ? "Your choices will stay here as the page loads." : "You can return to this kitchen's listing."}</p>}
    >
      <div role={loading ? "status" : undefined} className="space-y-4 text-sm text-muted-foreground">
        <p>{loading ? "Checking your tour options…" : applicationError ? "Your request may already be in progress. We won’t ask you to submit another until we can confirm." : hasApplication ? "Check your kitchen application for the next step." : "Return to the kitchen listing to choose an available space."}</p>
        {applicationError && <Button variant="outline" onClick={() => void refetchApplication()}>Check again</Button>}
        {hasApplication && <Button variant="outline" onClick={() => navigate(chefDashboardHref("viewings"))}>View My Tours</Button>}
      </div>
    </KitchenJourneyLayout>
  );
}
