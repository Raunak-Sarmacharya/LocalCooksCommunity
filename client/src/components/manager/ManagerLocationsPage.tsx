import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Building2, Search, Filter, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import LocationCard, { LocationCardSkeleton, type LocationData } from "./LocationCard";
import LocationEditModal from "./LocationEditModal";
import { auth } from "@/lib/firebase";
import { DataTable } from "@/components/ui/data-table";
import { getLocationColumns } from "./locations/columns";

interface ManagerLocationsPageProps {
  locations: LocationData[];
  isLoading: boolean;
  onCreateLocation: () => void;
  onSelectLocation: (location: LocationData) => void;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = localStorage.getItem('firebaseToken');
  const currentFirebaseUser = auth.currentUser;

  if (currentFirebaseUser) {
    try {
      const freshToken = await currentFirebaseUser.getIdToken();
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${freshToken}`,
      };
    } catch (error) {
      console.error('Error getting Firebase token:', error);
    }
  }

  if (token) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }

  return {
    'Content-Type': 'application/json',
  };
}

export default function ManagerLocationsPage({
  locations,
  isLoading,
  onCreateLocation,
  onSelectLocation,
}: ManagerLocationsPageProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedLocation, setSelectedLocation] = useState<LocationData | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isViewDetailsOpen, setIsViewDetailsOpen] = useState(false);

  // Fetch kitchen counts for each location
  const { data: kitchenCounts } = useQuery({
    queryKey: ["/api/manager/kitchen-counts", locations.map(l => l.id)],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const counts: Record<number, number> = {};

      await Promise.all(
        locations.map(async (location) => {
          try {
            const response = await fetch(`/api/manager/kitchens/${location.id}`, {
              credentials: "include",
              headers,
            });
            if (response.ok) {
              const kitchens = await response.json();
              counts[location.id] = Array.isArray(kitchens) ? kitchens.length : 0;
            } else {
              counts[location.id] = 0;
            }
          } catch (error) {
            counts[location.id] = 0;
          }
        })
      );

      return counts;
    },
    enabled: locations.length > 0,
  });

  // Fetch booking counts for each location
  const { data: bookingCounts } = useQuery({
    queryKey: ["/api/manager/booking-counts", locations.map(l => l.id)],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const counts: Record<number, number> = {};

      try {
        const response = await fetch("/api/manager/bookings", {
          credentials: "include",
          headers,
        });

        if (response.ok) {
          const bookings = await response.json();
          // Count active bookings (confirmed or pending) per location
          // We need to match bookings to locations through kitchens
          const kitchenToLocation: Record<number, number> = {};

          // First, build a map of kitchen IDs to location IDs
          await Promise.all(
            locations.map(async (location) => {
              try {
                const kitchensRes = await fetch(`/api/manager/kitchens/${location.id}`, {
                  credentials: "include",
                  headers,
                });
                if (kitchensRes.ok) {
                  const kitchens = await kitchensRes.json();
                  if (Array.isArray(kitchens)) {
                    kitchens.forEach((k: any) => {
                      kitchenToLocation[k.id] = location.id;
                    });
                  }
                }
              } catch (error) {
                // Ignore
              }
            })
          );

          // Initialize counts
          locations.forEach(l => counts[l.id] = 0);

          // Count bookings per location
          if (Array.isArray(bookings)) {
            bookings.forEach((booking: any) => {
              if (booking.status === 'confirmed' || booking.status === 'pending') {
                const locationId = kitchenToLocation[booking.kitchenId];
                if (locationId) {
                  counts[locationId] = (counts[locationId] || 0) + 1;
                }
              }
            });
          }
        }
      } catch (error) {
        locations.forEach(l => counts[l.id] = 0);
      }

      return counts;
    },
    enabled: locations.length > 0,
  });

  // Filter locations based on search and status
  const filteredLocations = locations.filter((location) => {
    const matchesSearch =
      location.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      location.address.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "approved" && location.kitchenLicenseStatus === "approved") ||
      (statusFilter === "pending" && (!location.kitchenLicenseStatus || location.kitchenLicenseStatus === "pending")) ||
      (statusFilter === "rejected" && location.kitchenLicenseStatus === "rejected");

    return matchesSearch && matchesStatus;
  });

  const handleEdit = (location: LocationData) => {
    setSelectedLocation(location);
    setIsEditModalOpen(true);
  };

  const handleViewDetails = (location: LocationData) => {
    setSelectedLocation(location);
    setIsViewDetailsOpen(true);
  };

  const handleManage = (location: LocationData) => {
    onSelectLocation(location);
  };

  const handleEditComplete = () => {
    setIsEditModalOpen(false);
    setSelectedLocation(null);
    queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
  };

  const refreshData = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/manager/locations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/manager/kitchen-counts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/manager/booking-counts"] });
  };

  // Count locations by status for the filter badges
  const statusCounts = {
    all: locations.length,
    approved: locations.filter(l => l.kitchenLicenseStatus === 'approved').length,
    pending: locations.filter(l => !l.kitchenLicenseStatus || l.kitchenLicenseStatus === 'pending').length,
    rejected: locations.filter(l => l.kitchenLicenseStatus === 'rejected').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Locations</h1>
          <p className="text-gray-500 mt-1">
            Manage all your kitchen locations and their approval status
          </p>
        </div>
        <Button
          onClick={onCreateLocation}
          className="bg-[#F51042] hover:bg-[#d10e3a] text-white gap-2"
        >
          <Plus className="w-4 h-4" />
          Add New Location
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search locations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Status Filter */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]">
            <Filter className="w-4 h-4 mr-2 text-gray-400" />
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              All Locations ({statusCounts.all})
            </SelectItem>
            <SelectItem value="approved">
              Approved ({statusCounts.approved})
            </SelectItem>
            <SelectItem value="pending">
              Pending ({statusCounts.pending})
            </SelectItem>
            <SelectItem value="rejected">
              Rejected ({statusCounts.rejected})
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Refresh Button */}
        <Button
          variant="outline"
          size="icon"
          onClick={refreshData}
          className="shrink-0"
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Locations Data Table */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <LocationCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredLocations.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <Building2 className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          {locations.length === 0 ? (
            <>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No Locations Yet
              </h3>
              <p className="text-gray-500 mb-6">
                Create your first location to start managing your kitchens
              </p>
              <Button
                onClick={onCreateLocation}
                className="bg-[#F51042] hover:bg-[#d10e3a] text-white gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Your First Location
              </Button>
            </>
          ) : (
            <>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No Matching Locations
              </h3>
              <p className="text-gray-500">
                Try adjusting your search or filter criteria
              </p>
            </>
          )}
        </div>
      ) : (
        <DataTable
          columns={getLocationColumns({
            onEdit: handleEdit,
            onManage: handleManage,
            onViewDetails: handleViewDetails
          })}
          data={filteredLocations}
          filterColumn="name"
          filterPlaceholder="Filter by name..."
        />
      )}

      {/* Summary Stats */}
      {!isLoading && locations.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-gray-600">
                {statusCounts.approved} Approved
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <span className="text-gray-600">
                {statusCounts.pending} Pending
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-gray-600">
                {statusCounts.rejected} Rejected
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {selectedLocation && (
        <LocationEditModal
          location={selectedLocation}
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setSelectedLocation(null);
          }}
          onSave={handleEditComplete}
        />
      )}

      {/* View Details Modal - Using same modal in view mode */}
      {selectedLocation && isViewDetailsOpen && (
        <LocationEditModal
          location={selectedLocation}
          isOpen={isViewDetailsOpen}
          onClose={() => {
            setIsViewDetailsOpen(false);
            setSelectedLocation(null);
          }}
          onSave={() => {
            setIsViewDetailsOpen(false);
            setSelectedLocation(null);
          }}
          viewOnly={true}
        />
      )}
    </div>
  );
}
