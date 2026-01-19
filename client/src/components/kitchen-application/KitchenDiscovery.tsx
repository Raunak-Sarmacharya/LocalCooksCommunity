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
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PublicLocation {
  id: number;
  name: string;
  address: string;
  city?: string;
  logoUrl?: string | null;
  brandImageUrl?: string | null;
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

  const {
    applications,
    hasAnyApproved,
    hasAnyPending,
    approvedCount,
    pendingCount,
    isLoading: applicationsLoading,
  } = useChefKitchenApplicationsStatus();

  const { approvedKitchens, isLoading: approvedLoading } = useChefApprovedKitchens();

  // Fetch all public locations
  const { data: publicLocations, isLoading: locationsLoading } = useQuery<PublicLocation[]>({
    queryKey: ["/api/public/locations"],
    queryFn: async () => {
      const response = await fetch("/api/public/locations");
      if (!response.ok) {
        throw new Error("Failed to fetch locations");
      }
      return response.json();
    },
    staleTime: 60000, // Cache for 1 minute
  });

  const isLoading = applicationsLoading || locationsLoading;

  // Filter out locations the chef has active applications for (inReview or approved)
  // Allow locations with rejected/cancelled applications to show up so chefs can re-apply
  const activeApplicationLocationIds = new Set(
    applications
      .filter((a) => a.status === "inReview" || a.status === "approved")
      .map((a) => a.locationId)
  );

  const availableLocations = (publicLocations || []).filter(
    (loc) => !activeApplicationLocationIds.has(loc.id)
  );

  const filteredAvailableLocations = availableLocations.filter(
    (loc) =>
      loc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loc.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (loc.city && loc.city.toLowerCase().includes(searchQuery.toLowerCase()))
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
              Discover ({filteredAvailableLocations.length})
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
          <TabsContent value="discover" className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search kitchens by name or location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {filteredAvailableLocations.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <ChefHat className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600 font-medium">
                  {searchQuery
                    ? "No kitchens match your search"
                    : "You've applied to all available kitchens!"}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  {searchQuery
                    ? "Try a different search term"
                    : "Check your applications tab for status updates"}
                </p>
              </div>
            ) : (
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid gap-4 md:grid-cols-2"
              >
                {filteredAvailableLocations.map((location) => (
                  <motion.div key={location.id} variants={itemVariants}>
                    <Card className="hover:shadow-md transition-shadow group">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          {location.brandImageUrl ? (
                            <img
                              src={location.brandImageUrl}
                              alt={location.name}
                              className="w-16 h-16 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                              <Building2 className="h-8 w-8 text-white" />
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-lg truncate">
                              {location.name}
                            </h3>
                            <div className="flex items-center text-sm text-gray-600 mt-1">
                              <MapPin className="h-3.5 w-3.5 mr-1 flex-shrink-0" />
                              <span className="truncate">{location.address}</span>
                            </div>

                            <div className="mt-3 flex gap-2">
                              <Link href={`/kitchen-preview/${location.id}`}>
                                <Button variant="outline" size="sm">
                                  View Details
                                </Button>
                              </Link>
                              <Link href={`/kitchen-requirements/${location.id}`}>
                                <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                                  Apply Now
                                  <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                              </Link>
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
                              {app.tier2_completed_at && (
                                <Link href={`/book-kitchen?location=${app.locationId}`}>
                                  <Button size="sm" className="bg-green-600 hover:bg-green-700">
                                    <Calendar className="mr-2 h-4 w-4" />
                                    Book
                                  </Button>
                                </Link>
                              )}
                              {app.status === "approved" && !app.tier2_completed_at && (
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
                  Once your applications are approved, they'll appear here
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
                                {app.tier2_completed_at ? (
                                  <Link href={`/book-kitchen?location=${app.locationId}`}>
                                    <Button className="bg-green-600 hover:bg-green-700" size="sm">
                                      <Calendar className="mr-2 h-4 w-4" />
                                      Book Kitchen
                                    </Button>
                                  </Link>
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
    </Card>
  );
}

