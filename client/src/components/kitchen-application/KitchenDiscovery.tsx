import { useChefKitchenApplicationsStatus } from "@/hooks/use-chef-kitchen-applications";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Building2,
  Calendar,
  Check,
  ChefHat,
  Clock,
  Plus,
  Search,
  Eye,
  Info,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import ChefViewingsList from "@/components/chef/ChefViewingsList";
import {
  DiscoverKitchensButtonTour,
  consumeDiscoverKitchensWalkthroughRequest,
  peekDiscoverKitchensWalkthroughRequest,
} from "@/components/kitchen-application/DiscoverKitchensButtonTour";

import { ChefPageHeader } from "@/components/chef/ui";
import {
  getKitchenDisplayStatus,
  kitchenLocationId,
  toneToBadgeVariant,
} from "@/components/chef/applications/status";
import { KitchenGridCard } from "@/components/kitchen/KitchenGridCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TruncatedText } from "@/components/common/TruncatedText";
import {
  countPendingOrUpcomingTours,
  normalizeChefTourRow,
} from "@/lib/chef-viewing-display";
import {
  groupKitchensByLocation,
  kitchenPreviewPath,
} from "@/lib/discover-location-groups";
import { chefOutlineCtaClass, chefPrimaryCtaClass } from "@/lib/chef-cta";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { tt } from "@/i18n/common-ns";

/** Readable on photo overlays — same surface as price / Coming Soon chips. */
const overlayChipClass =
  "inline-flex items-center gap-1 rounded-full bg-background/95 px-3 py-1.5 text-xs font-medium shadow-sm";

interface StorageSummary {
  hasDryStorage: boolean;
  hasColdStorage: boolean;
  hasFreezerStorage: boolean;
  totalStorageUnits: number;
}

interface PublicKitchen {
  id: number;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  galleryImages?: string[];
  equipment?: string[];
  hourlyRate?: number | null;
  currency?: string;
  minimumBookingHours?: number | null;
  locationId: number;
  locationName: string;
  locationSlug?: string;
  address: string;
  canAcceptBookings: boolean;
  isLocationApproved: boolean;
  customOnboardingLink?: string | null;
  storageSummary?: StorageSummary;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 100,
    },
  },
};

const kitchenCardActionClass = "h-11 min-h-[44px] w-full box-border font-semibold";
const kitchenCardBookClass = chefPrimaryCtaClass(kitchenCardActionClass);
const kitchenCardDetailsClass = cn(
  kitchenCardActionClass,
  chefOutlineCtaClass(),
  "border border-gray-200 bg-white text-gray-900 hover:bg-gray-50 hover:text-gray-900"
);

interface KitchenDiscoveryProps {
  compact?: boolean;
  defaultTab?: string;
}

export default function KitchenDiscovery({
  compact = false,
  defaultTab = "discover",
}: KitchenDiscoveryProps) {
  const { t, i18n } = useTranslation("kitchen");
  const { t: tChef } = useTranslation("chef");
  const { user } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState(defaultTab);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  const handleBookClick = (locationId: number, locationSlug?: string | null) => {
    navigate(kitchenPreviewPath(locationId, locationSlug));
  };

  const [tourReplayToken, setTourReplayToken] = useState(() =>
    peekDiscoverKitchensWalkthroughRequest() ? 1 : 0
  );

  useEffect(() => {
    if (!consumeDiscoverKitchensWalkthroughRequest()) return;
    setActiveTab("discover");
    setTourReplayToken((token) => Math.max(token, 1));
  }, []);

  const {
    applications,
    hasAnyApproved,
    approvedCount,
    pendingCount,
    isLoading: applicationsLoading,
  } = useChefKitchenApplicationsStatus();

  const { data: publicKitchens, isLoading: kitchensLoading } = useQuery<PublicKitchen[]>({
    queryKey: ["/api/public/kitchens"],
    queryFn: async () => {
      const response = await fetch("/api/public/kitchens");
      if (!response.ok) {
        throw new Error(tt("failedToFetchKitchens"));
      }
      return response.json();
    },
    staleTime: 60000,
  });

  // Same cache key as ChefViewingsList / overview — pending + upcoming only for header chip
  const { data: rawViewings = [] } = useQuery({
    queryKey: ["/api/viewings", "chef", user?.uid],
    queryFn: async () => {
      if (!user) return [];
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch("/api/viewings/chef", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(tt("failedToFetchViewings"));
        return res.json();
      } catch (error) {
        console.error(error);
        return [];
      }
    },
    enabled: !!user?.uid,
    staleTime: 60_000,
  });

  const activeTourCount = useMemo(() => {
    const rows = (rawViewings as unknown[])
      .map(normalizeChefTourRow)
      .filter((row): row is NonNullable<typeof row> => row != null);
    return countPendingOrUpcomingTours(rows);
  }, [rawViewings]);

  const isLoading = applicationsLoading || kitchensLoading;

  const applicationByLocationId = useMemo(() => {
    const map = new Map<number, (typeof applications)[number]>();
    for (const app of applications) {
      const locationId = kitchenLocationId(app);
      if (locationId == null) continue;
      const existing = map.get(locationId);
      if (
        !existing ||
        new Date(app.createdAt).getTime() > new Date(existing.createdAt).getTime()
      ) {
        map.set(locationId, app);
      }
    }
    return map;
  }, [applications]);

  const filteredAvailableKitchens = (publicKitchens || []).filter(
    (kitchen) =>
      kitchen.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      kitchen.locationName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      kitchen.address.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const discoverLocationCards = useMemo(
    () => groupKitchensByLocation(filteredAvailableKitchens),
    [filteredAvailableKitchens]
  );

  const firstWalkthroughCardId = discoverLocationCards[0]?.locationId;

  const kitchenStatusVariant = (status: string) =>
    toneToBadgeVariant(getKitchenDisplayStatus({ status }, tChef).tone);

  const kitchenStatusLabel = (status: string) => getKitchenDisplayStatus({ status }, tChef).label;

  const walkthrough = (
    <DiscoverKitchensButtonTour
      enabled={!isLoading && activeTab === "discover" && discoverLocationCards.length > 0}
      replayToken={tourReplayToken}
    />
  );

  if (isLoading) {
    return (
      <>
        <Card>
          <CardContent className="p-8">
            <div className="flex items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-foreground" />
            </div>
          </CardContent>
        </Card>
        {walkthrough}
      </>
    );
  }

  if (compact) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            {t("kitchenAccessBadge", "Kitchen Access")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg border p-2">
              <p className="text-2xl font-semibold">{approvedCount}</p>
              <p className="text-xs text-muted-foreground">{t("applyFlowApprovedLabel", "Approved")}</p>
            </div>
            <div className="rounded-lg border p-2">
              <p className="text-2xl font-semibold">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">{t("applyFlowPendingLabel", "Pending")}</p>
            </div>
          </div>

          <div className="space-y-2">
            {hasAnyApproved && (
              <Link href="/compare-kitchens">
                <Button className={chefPrimaryCtaClass("w-full")} size="sm">
                  <Calendar className="mr-2 h-4 w-4" />
                  {t("applyFlowBookAKitchenButton", "Book a Kitchen")}
                </Button>
              </Link>
            )}

            <Link href="/compare-kitchens">
              <Button
                variant="outline"
                className={cn(
                  chefOutlineCtaClass("w-full"),
                  "border border-gray-200 bg-white text-gray-900 hover:bg-gray-50 hover:text-gray-900"
                )}
                size="sm"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("applyFlowCompareKitchensButton", "Compare Kitchens")}
              </Button>
            </Link>
          </div>

          {applications.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                {t("applyFlowRecentApplications", "Recent Applications")}
              </p>
              <div className="space-y-1">
                {applications.slice(0, 3).map((app) => (
                  <div
                    key={app.id}
                    className="flex items-center justify-between rounded p-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {app.location?.name || t("location", "Location")}
                    </span>
                    <Badge variant={kitchenStatusVariant(app.status)} className="text-xs font-medium">
                      {kitchenStatusLabel(app.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <ChefPageHeader
        title={t("applyFlowDiscoverKitchensTitle", "Discover kitchens")}
        description={t("applyFlowDiscoverKitchensDesc", "Apply first. Booking opens after approval.")}
        titleAccessory={
          discoverLocationCards.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 -ml-2 gap-1.5 px-2 font-normal text-muted-foreground"
              onClick={() => {
                setActiveTab("discover");
                setTourReplayToken((token) => token + 1);
              }}
            >
              <Info />
              {t("whatButtonsDo", "What buttons do?")}
            </Button>
          ) : null
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {approvedCount > 0 ? (
              <button
                type="button"
                onClick={() => setActiveTab("approved")}
                className="rounded-lg border px-3 py-2 text-center transition-colors hover:border-[#F51042]/40 hover:bg-[#F51042]/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042]/30"
                aria-label={t("applyFlowApprovedTabLabel", {
                  count: approvedCount,
                  defaultValue: `Approved (${approvedCount})`,
                })}
              >
                <p className="text-xl font-semibold leading-none">{approvedCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("applyFlowApprovedLabel", "Approved")}
                </p>
              </button>
            ) : null}
            {pendingCount > 0 ? (
              <button
                type="button"
                onClick={() => setActiveTab("applications")}
                className="rounded-lg border px-3 py-2 text-center transition-colors hover:border-[#F51042]/40 hover:bg-[#F51042]/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042]/30"
                aria-label={t("applyFlowMyApplicationsTabLabel", {
                  count: pendingCount,
                  defaultValue: `My Applications (${pendingCount})`,
                })}
              >
                <p className="text-xl font-semibold leading-none">{pendingCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("applyFlowPendingLabel", "Pending")}
                </p>
              </button>
            ) : null}
            {activeTourCount > 0 ? (
              <button
                type="button"
                onClick={() => setActiveTab("tours")}
                className="rounded-lg border px-3 py-2 text-center transition-colors hover:border-[#F51042]/40 hover:bg-[#F51042]/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F51042]/30"
                aria-label={t("applyFlowKitchenToursTab", "Kitchen Tours")}
              >
                <p className="text-xl font-semibold leading-none">{activeTourCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("applyFlowKitchenToursTab", "Kitchen Tours")}
                </p>
              </button>
            ) : null}
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 h-auto flex-wrap">
          <TabsTrigger value="discover" data-kitchen-tour="tab-discover">
            <Plus className="h-4 w-4 mr-2" />
            {t("applyFlowDiscoverTabLabel", {
              count: discoverLocationCards.length,
              defaultValue: "Discover ({count})",
            })}
          </TabsTrigger>
          <TabsTrigger value="applications" data-kitchen-tour="tab-applications">
            <Clock className="h-4 w-4 mr-2" />
            {t("applyFlowMyApplicationsTabLabel", {
              count: applications.length,
              defaultValue: "My Applications ({count})",
            })}
          </TabsTrigger>
          <TabsTrigger value="approved" data-kitchen-tour="tab-approved">
            <Check className="h-4 w-4 mr-2" />
            {t("applyFlowApprovedTabLabel", {
              count: approvedCount,
              defaultValue: "Approved ({count})",
            })}
          </TabsTrigger>
          <TabsTrigger value="tours" data-kitchen-tour="tab-tours">
            <Eye className="h-4 w-4 mr-2" />
            {t("applyFlowKitchenToursTab", "Kitchen Tours")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="discover" className="space-y-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("applyFlowSearchPlaceholder", "Search kitchens by name or location...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-11 bg-muted/30 border-border/50 focus:bg-background"
            />
          </div>

          {discoverLocationCards.length === 0 ? (
            <Card className="border-dashed border-2 bg-muted/5">
              <CardContent className="py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                  <ChefHat className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {searchQuery
                    ? t("applyFlowNoKitchensMatchSearch", "No kitchens match your search")
                    : t("applyFlowNoKitchensListedYet", "No kitchens listed yet")}
                </h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  {searchQuery
                    ? t(
                        "applyFlowTryDifferentSearchTerm",
                        "Try a different search term or browse all kitchens"
                      )
                    : t(
                        "applyFlowNewKitchensComingSoon",
                        "New commercial kitchens will show up here as they join Local Cooks."
                      )}
                </p>
                {searchQuery && (
                  <Button
                    variant="outline"
                    className={cn(
                      chefOutlineCtaClass("mt-4"),
                      "border border-gray-200 bg-white text-gray-900 hover:bg-gray-50 hover:text-gray-900"
                    )}
                    onClick={() => setSearchQuery("")}
                  >
                    {t("applyFlowClearSearchButton", "Clear Search")}
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid auto-rows-fr grid-cols-1 items-stretch gap-6 md:grid-cols-2 xl:grid-cols-3"
            >
              {discoverLocationCards.map((card) => {
                const kitchen = card.displayKitchen;
                const application = applicationByLocationId.get(card.locationId);
                const display = application ? getKitchenDisplayStatus(application, tChef) : null;
                const showBook = display?.actionKind === "book";
                const previewHref = kitchenPreviewPath(card.locationId, card.locationSlug);
                const isWalkthroughCard = card.locationId === firstWalkthroughCardId;
                const openPreview = () => navigate(previewHref);

                const overlayChip = display ? (
                  <span className={overlayChipClass}>{display.label}</span>
                ) : card.canAcceptBookings ? (
                  <span className={overlayChipClass}>
                    <Check className="h-3 w-3 text-muted-foreground" />
                    {t("applyFlowAcceptingBookings", "Open")}
                  </span>
                ) : (
                  <span className={overlayChipClass}>
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    {t("applyFlowComingSoonBadge", "Coming Soon")}
                  </span>
                );

                return (
                  <motion.div key={card.locationId} variants={itemVariants} className="h-full">
                    <KitchenGridCard
                      title={card.locationName}
                      address={card.address}
                      imageUrl={kitchen.imageUrl}
                      hourlyRateCents={card.hourlyRate}
                      equipment={card.equipment}
                      storageSummary={card.storageSummary}
                      overlayChip={overlayChip}
                      onCardClick={openPreview}
                      actionRows={1}
                      actions={
                        showBook ? (
                          <Button
                            className={kitchenCardBookClass}
                            data-kitchen-tour={isWalkthroughCard ? "details" : undefined}
                            onClick={() =>
                              handleBookClick(card.locationId, card.locationSlug)
                            }
                          >
                            {t("applyFlowBookButton", "Book")}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            className={kitchenCardDetailsClass}
                            data-kitchen-tour={isWalkthroughCard ? "details" : undefined}
                            onClick={openPreview}
                          >
                            {t("requestToApply", "Request to apply")}
                          </Button>
                        )
                      }
                    />
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </TabsContent>

        <TabsContent value="applications" className="space-y-4">
          {applications.length === 0 ? (
            <div className="text-center py-12 bg-muted/50 rounded-lg">
              <Clock className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">
                {t("applyFlowNoApplicationsYet", "No applications yet")}
              </p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                {t("applyFlowApplyToGetStarted", "Apply to a kitchen to get started")}
              </p>
              <Button className={chefPrimaryCtaClass("mt-4")} onClick={() => setActiveTab("discover")}>
                <Plus className="mr-2 h-4 w-4" />
                {t("applyFlowExploreKitchensButton", "Explore Kitchens")}
              </Button>
            </div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-3"
            >
              {applications.map((app) => {
                return (
                  <motion.div key={app.id} variants={itemVariants}>
                    <Card className="shadow-none">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <Building2 className="h-6 w-6 text-muted-foreground" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold">
                                {app.location?.name ||
                                  t("applyFlowUnknownLocation", "Unknown Location")}
                              </h3>
                              <Badge
                                variant={kitchenStatusVariant(app.status)}
                                className="font-medium"
                              >
                                {kitchenStatusLabel(app.status)}
                              </Badge>
                            </div>
                            <TruncatedText
                              as="p"
                              className="text-sm text-muted-foreground truncate"
                            >
                              {app.location?.address ||
                                t("applyFlowAddressNotAvailable", "Address not available")}
                            </TruncatedText>
                            <p className="text-xs text-muted-foreground/70 mt-1">
                              {t("applyFlowAppliedDateLabel", {
                                date: new Date(app.createdAt).toLocaleDateString(i18n.language),
                                defaultValue: "Applied: {date}",
                              })}
                            </p>
                          </div>

                          <div className="flex gap-2">
                            {(app.current_tier ?? 1) >= 3 && (
                              <Button
                                size="sm"
                                className={chefPrimaryCtaClass()}
                                onClick={() =>
                                  handleBookClick(
                                    app.locationId,
                                    publicKitchens?.find((k) => k.locationId === app.locationId)
                                      ?.locationSlug
                                  )
                                }
                              >
                                <Calendar className="mr-2 h-4 w-4" />
                                {t("applyFlowBookButton", "Book")}
                              </Button>
                            )}
                            {app.status === "approved" && (app.current_tier ?? 1) < 3 && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled
                                className={cn(
                                  chefOutlineCtaClass(),
                                  "cursor-not-allowed border border-gray-200"
                                )}
                              >
                                {t("applyFlowCompleteTiersToBook", "Complete tiers to book")}
                              </Button>
                            )}
                            {(app.status === "rejected" || app.status === "cancelled") && (
                              <Link href={`/kitchen-requirements/${app.locationId}`}>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className={cn(
                                    chefOutlineCtaClass(),
                                    "border border-gray-200 bg-white text-gray-900 hover:bg-gray-50 hover:text-gray-900"
                                  )}
                                >
                                  {t("applyFlowReapplyButton", "Re-apply")}
                                </Button>
                              </Link>
                            )}
                          </div>
                        </div>

                        {app.feedback && app.status === "rejected" && (
                          <div className="mt-3 rounded-lg border border-destructive/30 px-3 py-2 text-sm">
                            <strong className="font-medium">
                              {t("applyFlowFeedbackLabel", "Feedback:")}
                            </strong>{" "}
                            <span className="text-muted-foreground">{app.feedback}</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </TabsContent>

        <TabsContent value="approved" className="space-y-4">
          {approvedCount === 0 ? (
            <div className="text-center py-12 bg-muted/50 rounded-lg">
              <Check className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">
                {t("applyFlowNoApprovedApplicationsYet", "No approved applications yet")}
              </p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                {t(
                  "applyFlowApprovedAppsWillAppearHere",
                  "Once your applications are approved, they'll appear here"
                )}
              </p>
            </div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid gap-4 md:grid-cols-2"
            >
              {applications
                .filter((a) => a.status === "approved")
                .map((app) => (
                  <motion.div key={app.id} variants={itemVariants}>
                    <Card className="shadow-none">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <Check className="h-6 w-6 text-muted-foreground" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold">
                              {app.location?.name ||
                                t("applyFlowUnknownLocation", "Unknown Location")}
                            </h3>
                            <p className="text-sm text-muted-foreground truncate">
                              {app.location?.address}
                            </p>

                            <div className="mt-3">
                              {(app.current_tier ?? 1) >= 3 ? (
                                <Button
                                  size="sm"
                                  className={chefPrimaryCtaClass()}
                                  onClick={() =>
                                    handleBookClick(
                                      app.locationId,
                                      publicKitchens?.find((k) => k.locationId === app.locationId)
                                        ?.locationSlug
                                    )
                                  }
                                >
                                  <Calendar className="mr-2 h-4 w-4" />
                                  {t("applyFlowBookKitchenButton", "Book Kitchen")}
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled
                                  className={cn(
                                    chefOutlineCtaClass(),
                                    "cursor-not-allowed border border-gray-200"
                                  )}
                                >
                                  {t(
                                    "applyFlowCompleteAllTiersToBook",
                                    "Complete all tiers to book"
                                  )}
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
            </motion.div>
          )}
        </TabsContent>

        <TabsContent value="tours" className="space-y-4">
          <ChefViewingsList onExploreKitchens={() => setActiveTab("discover")} />
        </TabsContent>
      </Tabs>

      {walkthrough}
    </div>
  );
}
