import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import { useChefShellChrome } from "@/layouts/chef-shell-context";
import KitchenBookingFlow from "@/components/booking/KitchenBookingFlow";
import { Button } from "@/components/ui/button";
import { chefOutlineCtaClass } from "@/lib/chef-cta";
import type { ChefBreadcrumb } from "@/lib/chef-nav-sections";

export default function KitchenBookingPage() {
  const { t } = useTranslation(["booking", "chef"]);
  const [, navigate] = useLocation();
  const [, params] = useRoute("/book/:locationId");

  const locationId = params?.locationId ? Number(params.locationId) : NaN;
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const kitchenIdParam = searchParams.get("kitchenId");
  const kitchenId = kitchenIdParam != null && kitchenIdParam !== "" ? kitchenIdParam : undefined;

  const { data: locationData, isLoading, isError } = useQuery({
    queryKey: [`/api/public/locations/${locationId}/details`],
    queryFn: async () => {
      const response = await fetch(`/api/public/locations/${locationId}/details`);
      if (!response.ok) throw new Error("Failed to load location");
      return response.json();
    },
    enabled: Number.isFinite(locationId),
  });

  const handleViewChange = (view: string) => {
    if (view === "overview") {
      navigate("/dashboard");
      return;
    }
    navigate(`/dashboard?view=${view}`);
  };

  const handleCancel = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate("/dashboard");
  };

  const handleComplete = (bookingId?: number) => {
    if (bookingId != null) {
      navigate(`/booking/${bookingId}`);
      return;
    }
    navigate("/dashboard?view=bookings");
  };

  const locationName = locationData?.name || t("title", "Book a kitchen");
  const previewPath = Number.isFinite(locationId)
    ? `/kitchen-preview/${locationData?.slug || locationId}`
    : "/dashboard?view=discover-kitchens";

  const breadcrumbs = useMemo((): ChefBreadcrumb[] => {
    const trail: ChefBreadcrumb[] = [
      {
        label: t("shellDashboard", { ns: "chef" }),
        onClick: () => navigate("/dashboard"),
        navId: "overview",
      },
      {
        label: t("shellDiscoverKitchens", { ns: "chef" }),
        onClick: () => navigate("/dashboard?view=discover-kitchens"),
        navId: "discover-kitchens",
      },
    ];
    if (locationData?.name) {
      trail.push({ label: locationName, onClick: () => navigate(previewPath) });
    }
    trail.push({ label: t("title", "Book a kitchen") });
    return trail;
  }, [t, navigate, locationData?.name, locationName, previewPath]);

  const inShell = useChefShellChrome({
    activeView: "discover-kitchens",
    onViewChange: handleViewChange,
    breadcrumbs,
  });

  let body: ReactNode;
  if (!Number.isFinite(locationId)) {
    body = (
      <div className="text-center py-16">
        <p className="text-sm text-muted-foreground mb-4">
          {t("sheetInvalidLocation", "Invalid kitchen location.")}
        </p>
        <Button variant="outline" className={chefOutlineCtaClass()} onClick={() => navigate("/dashboard")}>
          {t("sheetBackToDashboard", "Back to dashboard")}
        </Button>
      </div>
    );
  } else if (isLoading) {
    body = (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
        {t("sheetLoading", "Loading kitchen…")}
      </div>
    );
  } else if (isError || !locationData) {
    body = (
      <div className="text-center py-16">
        <p className="text-sm text-muted-foreground mb-4">
          {t("sheetLoadFailed", "Couldn’t load this kitchen.")}
        </p>
        <Button variant="outline" className={chefOutlineCtaClass()} onClick={() => navigate("/dashboard")}>
          {t("sheetBackToDashboard", "Back to dashboard")}
        </Button>
      </div>
    );
  } else {
    body = (
      <KitchenBookingFlow
        locationId={locationId}
        locationName={locationName}
        locationAddress={locationData.address}
        kitchenId={kitchenId}
        onCancel={handleCancel}
        onComplete={handleComplete}
      />
    );
  }

  if (inShell) return body;

  return (
    <ChefDashboardLayout
      activeView="discover-kitchens"
      onViewChange={handleViewChange}
      breadcrumbs={breadcrumbs}
    >
      {body}
    </ChefDashboardLayout>
  );
}
