import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefKitchenApplicationsStatus } from "@/hooks/use-chef-kitchen-applications";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  Calendar,
  Check,
  ChefHat,
  Clock,
  MapPin,
  Plus,
  Search,
  DollarSign,
  Utensils,
  AlertCircle,
  Eye,
  FileText,
  Info,
  Snowflake,
  Thermometer,
  Package,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import KitchenBookingSheet from "@/components/booking/KitchenBookingSheet";
import { ScheduleViewingWidget } from "@/components/chef/ScheduleViewingWidget";
import ChefViewingsList from "@/components/chef/ChefViewingsList";
import { DiscoverKitchensButtonTour, consumeDiscoverKitchensWalkthroughRequest, peekDiscoverKitchensWalkthroughRequest } from "@/components/kitchen-application/DiscoverKitchensButtonTour";

import { ChefPageHeader } from "@/components/chef/ui";
import { chefDashboardHref } from "@/lib/chef-dashboard-nav";
import { getKitchenDisplayStatus, kitchenLocationId, isActiveKitchenApplication, toneToBadgeVariant } from "@/components/chef/applications/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SmartImage } from "@/components/ui/smart-image";
import { TruncatedText } from "@/components/common/TruncatedText";

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

// Container animation for staggered children
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

const kitchenCardActionClass = "h-11 min-h-[44px] w-full sm:w-auto box-border";

interface KitchenDiscoveryProps {
  compact?: boolean;
  defaultTab?: string;
  onViewKitchenApplication?: () => void;
}

export default function KitchenDiscovery({
  compact = false,
  defaultTab = "discover",
  onViewKitchenApplication,
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
  
  // Booking sheet state for platform standard booking flow
  const [bookingSheetOpen, setBookingSheetOpen] = useState(false);
  const [bookingLocation, setBookingLocation] = useState<{
    id: number;
    name: string;
    address?: string;
  } | null>(null);

  const handleBookClick = (locationId: number, locationName: string, locationAddress?: string) => {
    setBookingLocation({
      id: locationId,
      name: locationName,
      address: locationAddress,
    });
    setBookingSheetOpen(true);
  };

  const handleViewKitchenApplication = () => {
    if (onViewKitchenApplication) {
      onViewKitchenApplication();
      return;
    }
    navigate(chefDashboardHref("applications"));
  };

  const [tourLocation, setTourLocation] = useState<{
    id: number;
    name: string;
  } | null>(null);
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
    hasAnyPending,
    approvedCount,
    pendingCount,
    isLoading: applicationsLoading,
  } = useChefKitchenApplicationsStatus();

  // Fetch all public kitchens (individual kitchen listings)
  const { data: publicKitchens, isLoading: kitchensLoading } = useQuery<PublicKitchen[]>({
    queryKey: ["/api/public/kitchens"],
    queryFn: async () => {
      const response = await fetch("/api/public/kitchens");
      if (!response.ok) {
        throw new Error("Failed to fetch kitchens");
      }
      return response.json();
    },
    staleTime: 60000, // Cache for 1 minute
  });

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

  const firstTourKitchenId = useMemo(() => {
    const openKitchen = filteredAvailableKitchens.find((kitchen) => {
      const locationId = kitchenLocationId(kitchen);
      const application = locationId != null ? applicationByLocationId.get(locationId) : undefined;
      return kitchen.canAcceptBookings && !isActiveKitchenApplication(application);
    });
    return (openKitchen ?? filteredAvailableKitchens[0])?.id;
  }, [filteredAvailableKitchens, applicationByLocationId]);

  const kitchenStatusVariant = (status: string) =>
    toneToBadgeVariant(getKitchenDisplayStatus({ status }, tChef).tone);

  const kitchenStatusLabel = (status: string) => getKitchenDisplayStatus({ status }, tChef).label;

  const walkthrough = (
    <DiscoverKitchensButtonTour
      enabled={!isLoading && activeTab === "discover" && filteredAvailableKitchens.length > 0}
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

  // Compact view for dashboard sidebar
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
          {/* Stats */}
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

          {/* Quick actions */}
          <div className="space-y-2">
            {hasAnyApproved && (
              <Link href="/compare-kitchens">
                <Button className="w-full" size="sm">
                  <Calendar className="mr-2 h-4 w-4" />
                  {t("applyFlowBookAKitchenButton", "Book a Kitchen")}
                </Button>
              </Link>
            )}

            <Link href="/compare-kitchens">
              <Button variant="outline" className="w-full" size="sm">
                <Plus className="mr-2 h-4 w-4" />
                {t("applyFlowCompareKitchensButton", "Compare Kitchens")}
              </Button>
            </Link>
          </div>

          {/* Recent applications */}
          {applications.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground mb-2">{t("applyFlowRecentApplications", "Recent Applications")}</p>
              <div className="space-y-1">
                {applications.slice(0, 3).map((app) => (
                    <div
                      key={app.id}
                      className="flex items-center justify-between rounded p-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">{app.location?.name || t("location", "Location")}</span>
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

  // Full view
  return (
    <div className="space-y-6">
      <ChefPageHeader
        title={t("applyFlowDiscoverKitchensTitle", "Discover kitchens")}
        description={t("applyFlowDiscoverKitchensDesc", "Apply first. Booking opens after approval.")}
        titleAccessory={
          filteredAvailableKitchens.length > 0 ? (
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
          <div className="flex gap-3">
            <div className="rounded-lg border px-3 py-2 text-center">
              <p className="text-xl font-semibold">{approvedCount}</p>
              <p className="text-xs text-muted-foreground">{t("applyFlowApprovedLabel", "Approved")}</p>
            </div>
            <div className="rounded-lg border px-3 py-2 text-center">
              <p className="text-xl font-semibold">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">{t("applyFlowPendingLabel", "Pending")}</p>
            </div>
          </div>
        }
      />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 h-auto flex-wrap">
            <TabsTrigger value="discover" data-kitchen-tour="tab-discover">
              <Plus className="h-4 w-4 mr-2" />
              {t("applyFlowDiscoverTabLabel", { count: filteredAvailableKitchens.length, defaultValue: "Discover ({count})" })}
            </TabsTrigger>
            <TabsTrigger value="applications" data-kitchen-tour="tab-applications">
              <Clock className="h-4 w-4 mr-2" />
              {t("applyFlowMyApplicationsTabLabel", { count: applications.length, defaultValue: "My Applications ({count})" })}
            </TabsTrigger>
            <TabsTrigger value="approved" data-kitchen-tour="tab-approved">
              <Check className="h-4 w-4 mr-2" />
              {t("applyFlowApprovedTabLabel", { count: approvedCount, defaultValue: "Approved ({count})" })}
            </TabsTrigger>
            <TabsTrigger value="tours" data-kitchen-tour="tab-tours">
              <Eye className="h-4 w-4 mr-2" />
              {t("applyFlowKitchenToursTab", "Kitchen Tours")}
            </TabsTrigger>
          </TabsList>

          {/* Discover Tab */}
          <TabsContent value="discover" className="space-y-6">
            {/* Search */}
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("applyFlowSearchPlaceholder", "Search kitchens by name or location...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-11 bg-muted/30 border-border/50 focus:bg-background"
              />
            </div>

            {filteredAvailableKitchens.length === 0 ? (
              <Card className="border-dashed border-2 bg-muted/5">
                <CardContent className="py-16 text-center">
                  <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                    <ChefHat className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {searchQuery ? t("applyFlowNoKitchensMatchSearch", "No kitchens match your search") : t("applyFlowNoKitchensListedYet", "No kitchens listed yet")}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {searchQuery
                      ? t("applyFlowTryDifferentSearchTerm", "Try a different search term or browse all kitchens")
                      : t("applyFlowNewKitchensComingSoon", "New commercial kitchens will show up here as they join Local Cooks.")}
                  </p>
                  {searchQuery && (
                    <Button variant="outline" className="mt-4" onClick={() => setSearchQuery("")}>
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
                className="space-y-4"
              >
                {filteredAvailableKitchens.map((kitchen) => {
                  const hasImage = !!kitchen.imageUrl;
                  const equipment = kitchen.equipment || [];
                  const displayEquipment = equipment.slice(0, 3);
                  const remainingEquipment = equipment.length - 3;
                  const kitchenLocId = kitchenLocationId(kitchen);
                  const application = kitchenLocId != null ? applicationByLocationId.get(kitchenLocId) : undefined;
                  const display = application ? getKitchenDisplayStatus(application, tChef) : null;
                  const alreadyApplied = isActiveKitchenApplication(application);

                  // Format price (cents to dollars)
                  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;
                  const priceDisplay = kitchen.hourlyRate ? formatPrice(kitchen.hourlyRate) : null;

                  // Always use the internal application URL
                  const applicationUrl = `/kitchen-requirements/${kitchen.locationId}`;
                  const previewHref = `/kitchen-preview/${kitchen.locationSlug || kitchen.locationId}`;
                  const isTourCard = kitchen.id === firstTourKitchenId;

                  return (
                    <motion.div key={kitchen.id} variants={itemVariants}>
                      <Card
                        className="overflow-hidden border-border/50 hover:shadow-lg hover:border-border transition-all duration-300 group cursor-pointer"
                        onClick={() => navigate(previewHref)}
                      >
                        <div className="flex flex-col md:flex-row">
                          {/* Image Section */}
                          <div className="md:w-72 lg:w-80 flex-shrink-0">
                            <AspectRatio ratio={16 / 10} className="md:h-full">
                              {hasImage ? (
                                <SmartImage
                                  src={kitchen.imageUrl!}
                                  alt={kitchen.name}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-muted">
                                  <Building2 className="h-12 w-12 text-muted-foreground" />
                                </div>
                              )}
                            </AspectRatio>
                          </div>

                          {/* Content Section */}
                          <div className="flex-1 p-5 md:p-6 flex flex-col">
                            {/* Header */}
                            <div className="flex items-start justify-between gap-4 mb-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <TruncatedText as="h3" className="text-xl font-bold text-foreground truncate">
                                    {kitchen.name}
                                  </TruncatedText>
                                  {display && alreadyApplied ? (
                                    <Badge variant={toneToBadgeVariant(display.tone)} className="text-xs font-medium">
                                      {display.label}
                                    </Badge>
                                  ) : kitchen.canAcceptBookings ? (
                                    <Badge variant="success" className="text-xs uppercase tracking-wider">
                                      <Check className="h-3 w-3 mr-1" />
                                      {t("applyFlowAcceptingBookings", "Accepting Bookings")}
                                    </Badge>
                                  ) : (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <Badge variant="outline" className="text-xs font-medium">
                                            <Clock className="h-3 w-3 mr-1" />
                                            {t("applyFlowComingSoonBadge", "Coming Soon")}
                                          </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>{t("applyFlowNotAcceptingBookingsTooltip", "This kitchen is not yet accepting bookings")}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                  <span className="font-medium text-foreground">{kitchen.locationName}</span>
                                  <span className="text-muted-foreground/50">•</span>
                                  <span className="flex items-center">
                                    <MapPin className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
                                    {kitchen.address}
                                  </span>
                                </div>
                              </div>

                              {/* Price Badge */}
                              {priceDisplay && (
                                <div className="text-right flex-shrink-0">
                                  <div className="flex items-center gap-1 text-lg font-bold text-foreground">
                                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                                    <span>{priceDisplay.replace('$', '')}</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("applyFlowPerHour", "per hour")}</p>
                                </div>
                              )}
                            </div>

                            {/* Description */}
                            {kitchen.description && (
                              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                                {kitchen.description}
                              </p>
                            )}

                            {/* Equipment & Storage - Minimal Display */}
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                              {/* Equipment badges */}
                              {displayEquipment.length > 0 && (
                                <>
                                  {displayEquipment.map((item: string, idx: number) => (
                                    <Badge
                                      key={idx}
                                      variant="outline"
                                      className="text-xs font-normal bg-muted/30 border-border/50"
                                    >
                                      <Utensils className="h-3 w-3 mr-1 text-muted-foreground" />
                                      {item}
                                    </Badge>
                                  ))}
                                  {remainingEquipment > 0 && (
                                    <Badge variant="outline" className="text-xs font-normal bg-muted/30 border-border/50">
                                      {t("applyFlowMoreEquipmentCount", { count: remainingEquipment, defaultValue: "+{count} more" })}
                                    </Badge>
                                  )}
                                </>
                              )}

                              {/* Storage indicators - compact icons */}
                              {kitchen.storageSummary && kitchen.storageSummary.totalStorageUnits > 0 && (
                                <div className="flex items-center gap-1 ml-1">
                                  <span className="text-muted-foreground/50">|</span>
                                  {kitchen.storageSummary.hasColdStorage && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
                                            <Thermometer className="h-3.5 w-3.5 text-muted-foreground" />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent><p>{t("applyFlowColdStorageAvailable", "Cold Storage Available")}</p></TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                  {kitchen.storageSummary.hasFreezerStorage && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
                                            <Snowflake className="h-3.5 w-3.5 text-muted-foreground" />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent><p>{t("applyFlowFreezerStorageAvailable", "Freezer Storage Available")}</p></TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                  {kitchen.storageSummary.hasDryStorage && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
                                            <Package className="h-3.5 w-3.5 text-muted-foreground" />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent><p>{t("applyFlowDryStorageAvailable", "Dry Storage Available")}</p></TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div
                              className="flex flex-col sm:flex-row sm:flex-wrap items-stretch gap-2 mt-auto pt-2"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Button
                                variant="outline"
                                size="sm"
                                className={kitchenCardActionClass}
                                data-kitchen-tour={isTourCard ? "details" : undefined}
                                onClick={() => navigate(previewHref)}
                              >
                                <Eye />
                                {t("applyFlowViewDetailsButton", "View details")}
                              </Button>
                              {alreadyApplied ? (
                                display?.actionKind === "book" ? (
                                  <Button
                                    size="sm"
                                    className={kitchenCardActionClass}
                                    onClick={() =>
                                      handleBookClick(
                                        kitchen.locationId,
                                        kitchen.locationName,
                                        kitchen.address
                                      )
                                    }
                                  >
                                    <Calendar />
                                    {t("applyFlowBookButton", "Book")}
                                  </Button>
                                ) : display?.actionKind === "complete-step" ? (
                                  <Button
                                    size="sm"
                                    className={kitchenCardActionClass}
                                    onClick={() => navigate(applicationUrl)}
                                  >
                                    {t("applyFlowContinueButton", "Continue")}
                                    <ArrowRight />
                                  </Button>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className={kitchenCardActionClass}
                                    onClick={handleViewKitchenApplication}
                                  >
                                    <FileText />
                                    {t("viewApplicationBtn", "View application")}
                                  </Button>
                                )
                              ) : kitchen.canAcceptBookings ? (
                                <>
                                  <Button
                                    size="sm"
                                    className={kitchenCardActionClass}
                                    data-kitchen-tour={isTourCard ? "tour" : undefined}
                                    onClick={() => setTourLocation({ id: kitchen.locationId, name: kitchen.locationName })}
                                  >
                                    <Calendar />
                                    {t("applyFlowScheduleTourButton", "Schedule tour")}
                                  </Button>
                                  <Button
                                    size="sm"
                                    className={kitchenCardActionClass}
                                    data-kitchen-tour={isTourCard ? "apply" : undefined}
                                    onClick={() => navigate(applicationUrl)}
                                  >
                                    {display?.actionKind === "discover" ? t("applyAgainBtn", "Apply again") : t("applyFlowApplyNowButton", "Apply Now")}
                                    <ArrowRight />
                                  </Button>
                                </>
                              ) : (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled
                                        className={`${kitchenCardActionClass} cursor-not-allowed`}
                                      >
                                        <AlertCircle />
                                        {t("applyFlowNotAvailableBadge", "Not Available")}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>{t("applyFlowNotAcceptingApplicationsTooltip", "This kitchen is not yet accepting applications")}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </TabsContent>

          {/* Applications Tab */}
          <TabsContent value="applications" className="space-y-4">
            {applications.length === 0 ? (
              <div className="text-center py-12 bg-muted/50 rounded-lg">
                <Clock className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">{t("applyFlowNoApplicationsYet", "No applications yet")}</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  {t("applyFlowApplyToGetStarted", "Apply to a kitchen to get started")}
                </p>
                <Button className="mt-4" onClick={() => setActiveTab("discover")}>
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
                                  {app.location?.name || t("applyFlowUnknownLocation", "Unknown Location")}
                                </h3>
                                <Badge variant={kitchenStatusVariant(app.status)} className="font-medium">
                                  {kitchenStatusLabel(app.status)}
                                </Badge>
                              </div>
                              <TruncatedText as="p" className="text-sm text-muted-foreground truncate">
                                {app.location?.address || t("applyFlowAddressNotAvailable", "Address not available")}
                              </TruncatedText>
                              <p className="text-xs text-muted-foreground/70 mt-1">
                                {t("applyFlowAppliedDateLabel", { date: new Date(app.createdAt).toLocaleDateString(i18n.language), defaultValue: "Applied: {date}" })}
                              </p>
                            </div>

                            <div className="flex gap-2">
                              {(app.current_tier ?? 1) >= 3 && (
                                <Button 
                                  size="sm"
                                  onClick={() => handleBookClick(
                                    app.locationId,
                                    app.location?.name || t("applyFlowKitchenFallbackName", "Kitchen"),
                                    app.location?.address
                                  )}
                                >
                                  <Calendar className="mr-2 h-4 w-4" />
                                  {t("applyFlowBookButton", "Book")}
                                </Button>
                              )}
                              {app.status === "approved" && (app.current_tier ?? 1) < 3 && (
                                <Button size="sm" variant="outline" disabled className="cursor-not-allowed">
                                  {t("applyFlowCompleteTiersToBook", "Complete tiers to book")}
                                </Button>
                              )}
                              {(app.status === "rejected" || app.status === "cancelled") && (
                                <Link href={`/kitchen-requirements/${app.locationId}`}>
                                  <Button size="sm" variant="outline">
                                    {t("applyFlowReapplyButton", "Re-apply")}
                                  </Button>
                                </Link>
                              )}
                            </div>
                          </div>

                          {app.feedback && app.status === "rejected" && (
                            <div className="mt-3 rounded-lg border border-destructive/30 px-3 py-2 text-sm">
                              <strong className="font-medium">{t("applyFlowFeedbackLabel", "Feedback:")}</strong>{" "}
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

          {/* Approved Tab */}
          <TabsContent value="approved" className="space-y-4">
            {approvedCount === 0 ? (
              <div className="text-center py-12 bg-muted/50 rounded-lg">
                <Check className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">{t("applyFlowNoApprovedApplicationsYet", "No approved applications yet")}</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  {t("applyFlowApprovedAppsWillAppearHere", "Once your applications are approved, they'll appear here")}
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
                                {app.location?.name || t("applyFlowUnknownLocation", "Unknown Location")}
                              </h3>
                              <p className="text-sm text-muted-foreground truncate">
                                {app.location?.address}
                              </p>

                              <div className="mt-3">
                                {(app.current_tier ?? 1) >= 3 ? (
                                  <Button
                                    size="sm"
                                    onClick={() => handleBookClick(
                                      app.locationId,
                                      app.location?.name || t("applyFlowKitchenFallbackName", "Kitchen"),
                                      app.location?.address
                                    )}
                                  >
                                    <Calendar className="mr-2 h-4 w-4" />
                                    {t("applyFlowBookKitchenButton", "Book Kitchen")}
                                  </Button>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled
                                    className="cursor-not-allowed"
                                  >
                                    {t("applyFlowCompleteAllTiersToBook", "Complete all tiers to book")}
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

      {bookingLocation && (
        <KitchenBookingSheet
          open={bookingSheetOpen}
          onOpenChange={setBookingSheetOpen}
          locationId={bookingLocation.id}
          locationName={bookingLocation.name}
          locationAddress={bookingLocation.address}
        />
      )}

      {/* Schedule tour modal */}
      {tourLocation && (
        <ScheduleViewingWidget
          open={!!tourLocation}
          onClose={() => setTourLocation(null)}
          locationId={tourLocation.id}
          locationName={tourLocation.name}
        />
      )}

      {walkthrough}
    </div>
  );
}

