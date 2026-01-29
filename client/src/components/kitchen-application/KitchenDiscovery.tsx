import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefKitchenApplications, useChefApprovedKitchens, useChefKitchenApplicationsStatus } from "@/hooks/use-chef-kitchen-applications";
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
  XCircle,
  DollarSign,
  Utensils,
  AlertCircle,
  Eye,
  Snowflake,
  Thermometer,
  Package,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import KitchenBookingSheet from "@/components/booking/KitchenBookingSheet";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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

interface KitchenDiscoveryProps {
  compact?: boolean;
}

export default function KitchenDiscovery({ compact = false }: KitchenDiscoveryProps) {
  const { user } = useFirebaseAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("discover");
  
  // Booking sheet state for platform standard booking flow
  const [bookingSheetOpen, setBookingSheetOpen] = useState(false);
  const [bookingLocation, setBookingLocation] = useState<{
    id: number;
    name: string;
    address?: string;
  } | null>(null);

  // Handler for Book button clicks - opens KitchenBookingSheet
  const handleBookClick = (locationId: number, locationName: string, locationAddress?: string) => {
    setBookingLocation({
      id: locationId,
      name: locationName,
      address: locationAddress,
    });
    setBookingSheetOpen(true);
  };

  const {
    applications,
    hasAnyApproved,
    hasAnyPending,
    approvedCount,
    pendingCount,
    isLoading: applicationsLoading,
  } = useChefKitchenApplicationsStatus();

  const { approvedKitchens, isLoading: approvedLoading } = useChefApprovedKitchens();

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

  // Filter out kitchens at locations the chef has active applications for (inReview or approved)
  // Allow kitchens at locations with rejected/cancelled applications to show up so chefs can re-apply
  const activeApplicationLocationIds = new Set(
    applications
      .filter((a) => a.status === "inReview" || a.status === "approved")
      .map((a) => a.locationId)
  );

  const availableKitchens = (publicKitchens || []).filter(
    (kitchen) => !activeApplicationLocationIds.has(kitchen.locationId)
  );

  const filteredAvailableKitchens = availableKitchens.filter(
    (kitchen) =>
      kitchen.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      kitchen.locationName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      kitchen.address.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Get status config for badges
  const getStatusConfig = (status: string) => {
    switch (status) {
      case "approved":
        return {
          label: "Approved",
          color: "bg-green-100 text-green-800 border-green-200",
          icon: Check,
        };
      case "inReview":
        return {
          label: "Pending Review",
          color: "bg-yellow-100 text-yellow-800 border-yellow-200",
          icon: Clock,
        };
      case "rejected":
        return {
          label: "Rejected",
          color: "bg-red-100 text-red-800 border-red-200",
          icon: XCircle,
        };
      default:
        return {
          label: status,
          color: "bg-gray-100 text-gray-800 border-gray-200",
          icon: Clock,
        };
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Compact view for dashboard sidebar
  if (compact) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            Kitchen Access
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="p-2 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-600">{approvedCount}</p>
              <p className="text-xs text-gray-600">Approved</p>
            </div>
            <div className="p-2 bg-yellow-50 rounded-lg">
              <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
              <p className="text-xs text-gray-600">Pending</p>
            </div>
          </div>

          {/* Quick actions */}
          <div className="space-y-2">
            {hasAnyApproved && (
              <Link href="/compare-kitchens">
                <Button className="w-full" size="sm">
                  <Calendar className="mr-2 h-4 w-4" />
                  Book a Kitchen
                </Button>
              </Link>
            )}

            <Link href="/compare-kitchens">
              <Button variant="outline" className="w-full" size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Compare Kitchens
              </Button>
            </Link>
          </div>

          {/* Recent applications */}
          {applications.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs font-medium text-gray-600 mb-2">Recent Applications</p>
              <div className="space-y-1">
                {applications.slice(0, 3).map((app) => {
                  const config = getStatusConfig(app.status);
                  return (
                    <div
                      key={app.id}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm"
                    >
                      <span className="truncate flex-1">{app.location?.name || "Location"}</span>
                      <Badge className={`text-xs ${config.color}`}>{config.label}</Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Full view
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-blue-600" />
              Kitchen Discovery
            </CardTitle>
            <CardDescription>
              Apply to kitchens to start booking. Once approved, you can book anytime.
            </CardDescription>
          </div>

          {/* Stats Summary */}
          <div className="flex gap-3">
            <div className="text-center px-3 py-2 bg-green-50 rounded-lg">
              <p className="text-xl font-bold text-green-600">{approvedCount}</p>
              <p className="text-xs text-gray-600">Approved</p>
            </div>
            <div className="text-center px-3 py-2 bg-yellow-50 rounded-lg">
              <p className="text-xl font-bold text-yellow-600">{pendingCount}</p>
              <p className="text-xs text-gray-600">Pending</p>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="discover">
              <Plus className="h-4 w-4 mr-2" />
              Discover ({filteredAvailableKitchens.length})
            </TabsTrigger>
            <TabsTrigger value="applications">
              <Clock className="h-4 w-4 mr-2" />
              My Applications ({applications.length})
            </TabsTrigger>
            <TabsTrigger value="approved">
              <Check className="h-4 w-4 mr-2" />
              Approved ({approvedCount})
            </TabsTrigger>
          </TabsList>

          {/* Discover Tab */}
          <TabsContent value="discover" className="space-y-6">
            {/* Search */}
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search kitchens by name or location..."
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
                    {searchQuery ? "No kitchens match your search" : "You've applied to all available kitchens!"}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {searchQuery
                      ? "Try a different search term or browse all kitchens"
                      : "Check your applications tab for status updates"}
                  </p>
                  {searchQuery && (
                    <Button variant="outline" className="mt-4" onClick={() => setSearchQuery("")}>
                      Clear Search
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

                  // Format price (cents to dollars)
                  const formatPrice = (cents: number) => `$${(cents / 100).toFixed(0)}`;
                  const priceDisplay = kitchen.hourlyRate ? formatPrice(kitchen.hourlyRate) : null;

                  // Determine application URL - use custom onboarding link if available
                  const applicationUrl = kitchen.customOnboardingLink || `/kitchen-requirements/${kitchen.locationId}`;

                  return (
                    <motion.div key={kitchen.id} variants={itemVariants}>
                      <Card className="overflow-hidden border-border/50 hover:shadow-lg hover:border-border transition-all duration-300 group">
                        <div className="flex flex-col md:flex-row">
                          {/* Image Section */}
                          <div className="md:w-72 lg:w-80 flex-shrink-0">
                            <AspectRatio ratio={16 / 10} className="md:h-full">
                              {hasImage ? (
                                <img
                                  src={kitchen.imageUrl!}
                                  alt={kitchen.name}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                />
                              ) : (
                                <div className="w-full h-full bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 flex items-center justify-center">
                                  <Building2 className="h-16 w-16 text-white/80" />
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
                                  <h3 className="text-xl font-bold text-foreground truncate">
                                    {kitchen.name}
                                  </h3>
                                  {kitchen.canAcceptBookings ? (
                                    <Badge variant="default" className="bg-green-600 hover:bg-green-600 text-[10px] uppercase tracking-wider">
                                      <Check className="h-3 w-3 mr-1" />
                                      Accepting Bookings
                                    </Badge>
                                  ) : (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                                            <Clock className="h-3 w-3 mr-1" />
                                            Coming Soon
                                          </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>This kitchen is not yet accepting bookings</p>
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
                                    <DollarSign className="h-4 w-4 text-green-600" />
                                    <span>{priceDisplay.replace('$', '')}</span>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">per hour</p>
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
                                      +{remainingEquipment} more
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
                                          <div className="w-6 h-6 rounded bg-blue-100 flex items-center justify-center">
                                            <Thermometer className="h-3.5 w-3.5 text-blue-600" />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent><p>Cold Storage Available</p></TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                  {kitchen.storageSummary.hasFreezerStorage && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <div className="w-6 h-6 rounded bg-cyan-100 flex items-center justify-center">
                                            <Snowflake className="h-3.5 w-3.5 text-cyan-600" />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent><p>Freezer Storage Available</p></TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                  {kitchen.storageSummary.hasDryStorage && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <div className="w-6 h-6 rounded bg-amber-100 flex items-center justify-center">
                                            <Package className="h-3.5 w-3.5 text-amber-600" />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent><p>Dry Storage Available</p></TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-3 mt-auto pt-2">
                              <Button variant="outline" size="sm" className="gap-2" asChild>
                                <Link href={`/kitchen-preview/${kitchen.locationId}`}>
                                  <Eye className="h-4 w-4" />
                                  View Details
                                </Link>
                              </Button>
                              {kitchen.canAcceptBookings ? (
                                <Button size="sm" className="gap-2 bg-blue-600 hover:bg-blue-700" asChild>
                                  <Link href={applicationUrl}>
                                    Apply Now
                                    <ArrowRight className="h-4 w-4" />
                                  </Link>
                                </Button>
                              ) : (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button size="sm" variant="secondary" disabled className="gap-2 cursor-not-allowed">
                                        <AlertCircle className="h-4 w-4" />
                                        Not Available
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>This kitchen is not yet accepting applications</p>
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
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <Clock className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600 font-medium">No applications yet</p>
                <p className="text-sm text-gray-500 mt-1">
                  Apply to a kitchen to get started
                </p>
                <Button className="mt-4" onClick={() => setActiveTab("discover")}>
                  <Plus className="mr-2 h-4 w-4" />
                  Explore Kitchens
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
                  const config = getStatusConfig(app.status);
                  const StatusIcon = config.icon;

                  return (
                    <motion.div key={app.id} variants={itemVariants}>
                      <Card>
                        <CardContent className="p-4">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                              <Building2 className="h-6 w-6 text-white" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-semibold">
                                  {app.location?.name || "Unknown Location"}
                                </h3>
                                <Badge className={config.color}>
                                  <StatusIcon className="h-3 w-3 mr-1" />
                                  {config.label}
                                </Badge>
                              </div>
                              <p className="text-sm text-gray-600 truncate">
                                {app.location?.address || "Address not available"}
                              </p>
                              <p className="text-xs text-gray-500 mt-1">
                                Applied: {new Date(app.createdAt).toLocaleDateString()}
                              </p>
                            </div>

                            <div className="flex gap-2">
                              {(app.current_tier ?? 1) >= 3 && (
                                <Button 
                                  size="sm" 
                                  className="bg-green-600 hover:bg-green-700"
                                  onClick={() => handleBookClick(
                                    app.locationId,
                                    app.location?.name || 'Kitchen',
                                    app.location?.address
                                  )}
                                >
                                  <Calendar className="mr-2 h-4 w-4" />
                                  Book
                                </Button>
                              )}
                              {app.status === "approved" && (app.current_tier ?? 1) < 3 && (
                                <Button size="sm" variant="outline" disabled className="cursor-not-allowed">
                                  Complete tiers to book
                                </Button>
                              )}
                              {(app.status === "rejected" || app.status === "cancelled") && (
                                <Link href={`/kitchen-requirements/${app.locationId}`}>
                                  <Button size="sm" variant="outline">
                                    Re-apply
                                  </Button>
                                </Link>
                              )}
                            </div>
                          </div>

                          {app.feedback && app.status === "rejected" && (
                            <div className="mt-3 p-3 bg-red-50 rounded-lg text-sm text-red-800">
                              <strong>Feedback:</strong> {app.feedback}
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
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <Check className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600 font-medium">No approved applications yet</p>
                <p className="text-sm text-gray-500 mt-1">
                  Once your applications are approved, they&apos;ll appear here
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
                      <Card className="border-green-200 bg-green-50/30">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-4">
                            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center flex-shrink-0">
                              <Check className="h-6 w-6 text-white" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold">
                                {app.location?.name || "Unknown Location"}
                              </h3>
                              <p className="text-sm text-gray-600 truncate">
                                {app.location?.address}
                              </p>

                              <div className="mt-3">
                                {(app.current_tier ?? 1) >= 3 ? (
                                  <Button 
                                    className="bg-green-600 hover:bg-green-700" 
                                    size="sm"
                                    onClick={() => handleBookClick(
                                      app.locationId,
                                      app.location?.name || 'Kitchen',
                                      app.location?.address
                                    )}
                                  >
                                    <Calendar className="mr-2 h-4 w-4" />
                                    Book Kitchen
                                  </Button>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled
                                    className="cursor-not-allowed"
                                  >
                                    Complete all tiers to book
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
        </Tabs>
      </CardContent>

      {/* Kitchen Booking Sheet - Platform standard booking flow */}
      {bookingLocation && (
        <KitchenBookingSheet
          open={bookingSheetOpen}
          onOpenChange={setBookingSheetOpen}
          locationId={bookingLocation.id}
          locationName={bookingLocation.name}
          locationAddress={bookingLocation.address}
        />
      )}
    </Card>
  );
}

