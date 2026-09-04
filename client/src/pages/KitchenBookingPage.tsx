import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import ChefDashboardLayout from "@/layouts/ChefDashboardLayout";
import KitchenBookingFlow from "@/components/booking/KitchenBookingFlow";
import { Icon } from "@iconify/react";
import "@/lib/kitchen-inventory-icons";
import { Button } from "@/components/ui/button";
import { chefOutlineCtaClass } from "@/lib/chef-cta";

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

  // Continuity with kitchen preview / discover — do not flip sidebar/title to My Bookings
  // until booking completes and redirects to booking details.
  const bookingChrome = {
    activeView: "discover-kitchens" as const,
    onViewChange: handleViewChange,
  };

  const bookingBreadcrumbs = (trailLabel: string) => [
    {
      label: t("shellDashboard", { ns: "chef" }),
      onClick: () => navigate("/dashboard"),
      navId: "overview" as const,
    },
    {
      label: t("shellDiscoverKitchens", { ns: "chef" }),
      onClick: () => navigate("/dashboard?view=discover-kitchens"),
      navId: "discover-kitchens" as const,
    },
    { label: trailLabel },
  ];

  if (!Number.isFinite(locationId)) {
    return (
      <ChefDashboardLayout
        {...bookingChrome}
        breadcrumbs={bookingBreadcrumbs(t("title", "Book a kitchen"))}
      >
        <div className="text-center py-16">
          <p className="text-sm text-muted-foreground mb-4">
            {t("sheetInvalidLocation", "Invalid kitchen location.")}
          </p>
          <Button variant="outline" className={chefOutlineCtaClass()} onClick={() => navigate("/dashboard")}>
            {t("sheetBackToDashboard", "Back to dashboard")}
          </Button>
        </div>
      </ChefDashboardLayout>
    );
  }

  if (isLoading) {
    return (
      <ChefDashboardLayout
        {...bookingChrome}
        breadcrumbs={bookingBreadcrumbs(t("title", "Book a kitchen"))}
      >
        <div className="flex items-center justify-center py-24">
          <Icon icon="mdi:loading" className="h-6 w-6 animate-spin text-primary" aria-hidden />
        </div>
      </ChefDashboardLayout>
    );
  }

  if (isError || !locationData) {
    return (
      <ChefDashboardLayout
        {...bookingChrome}
        breadcrumbs={bookingBreadcrumbs(t("title", "Book a kitchen"))}
      >
        <div className="text-center py-16">
          <p className="text-sm text-muted-foreground mb-4">
            {t("sheetLocationLoadFailed", "Could not load this kitchen location.")}
          </p>
          <Button variant="outline" className={chefOutlineCtaClass()} onClick={() => navigate("/dashboard")}>
            {t("sheetBackToDashboard", "Back to dashboard")}
          </Button>
        </div>
      </ChefDashboardLayout>
    );
  }

  const locationName = locationData.name || t("title", "Book a kitchen");
  const previewPath = `/kitchen-preview/${locationData.slug || locationId}`;

  return (
    <ChefDashboardLayout
      {...bookingChrome}
      breadcrumbs={[
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
        { label: locationName, onClick: () => navigate(previewPath) },
        { label: t("title", "Book a kitchen") },
      ]}
    >
      <KitchenBookingFlow
        locationId={locationId}
        locationName={locationName}
        locationAddress={locationData.address}
        kitchenId={kitchenId}
        onCancel={handleCancel}
        onComplete={handleComplete}
      />
    </ChefDashboardLayout>
  );
}
