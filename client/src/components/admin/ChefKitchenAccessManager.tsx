import { useAdminChefKitchenAccess } from "@/hooks/use-chef-kitchen-access";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Building, User, X, Check, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

interface Kitchen {
  id: number;
  name: string;
  locationName?: string;
}

export default function ChefKitchenAccessManager() {
  const { accessData, isLoading, grantAccess, revokeAccess, refetch } = useAdminChefKitchenAccess();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedChef, setExpandedChef] = useState<number | null>(null);

  // Fetch all kitchens by getting all locations and their kitchens
  const { data: allKitchens = [] } = useQuery<Kitchen[]>({
    queryKey: ["/api/admin/all-kitchens"],
    queryFn: async () => {
      try {
        // Get all locations first
        const locationsRes = await fetch("/api/admin/locations", {
          credentials: "include",
        });
        if (!locationsRes.ok) {
          throw new Error("Failed to fetch locations");
        }
        const locations = await locationsRes.json();

        // Get kitchens for each location
        const allKitchens: Kitchen[] = [];
        for (const location of locations) {
          try {
            const kitchensRes = await fetch(`/api/admin/kitchens/${location.id}`, {
              credentials: "include",
            });
            if (kitchensRes.ok) {
              const locationKitchens = await kitchensRes.json();
              allKitchens.push(
                ...locationKitchens.map((k: any) => ({
                  id: k.id,
                  name: k.name,
                  locationName: location.name,
                }))
              );
            }
          } catch (err) {
            console.error(`Error fetching kitchens for location ${location.id}:`, err);
          }
        }
        return allKitchens;
      } catch (error) {
        console.error("Error fetching all kitchens:", error);
        return [];
      }
    },
  });

  const handleGrantAccess = async (chefId: number, kitchenId: number) => {
    try {
      await grantAccess.mutateAsync({ chefId, kitchenId });
      toast({
        title: "Access Granted",
        description: "Chef now has access to this kitchen.",
      });
      refetch();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to grant access",
        variant: "destructive",
      });
    }
  };

  const handleRevokeAccess = async (chefId: number, kitchenId: number) => {
    try {
      await revokeAccess.mutateAsync({ chefId, kitchenId });
      toast({
        title: "Access Revoked",
        description: "Chef access to this kitchen has been removed.",
      });
      refetch();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to revoke access",
        variant: "destructive",
      });
    }
  };

  const filteredChefs = accessData.filter((chefAccess) =>
    chefAccess.chef.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p className="text-gray-600 mt-4">Loading chef access data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Chef Kitchen Access Management</h2>
          <p className="text-gray-600 mt-1">
            Grant or revoke access for chefs to specific kitchens. Chefs must have access before they can share profiles.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search chefs by username..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Chefs List */}
      <div className="space-y-4">
        {filteredChefs.length === 0 ? (
          <div className="text-center py-12 border rounded-lg bg-gray-50">
            <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No chefs found</p>
          </div>
        ) : (
          filteredChefs.map((chefAccess) => {
            const isExpanded = expandedChef === chefAccess.chef.id;
            const accessibleKitchenIds = chefAccess.accessibleKitchens.map((k) => k.id);

            return (
              <div
                key={chefAccess.chef.id}
                className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                {/* Chef Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                      <User className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{chefAccess.chef.username}</h3>
                      <p className="text-sm text-gray-600">
                        Access to {chefAccess.accessibleKitchens.length} kitchen(s)
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setExpandedChef(isExpanded ? null : chefAccess.chef.id)
                    }
                  >
                    {isExpanded ? "Hide" : "Manage"}
                  </Button>
                </div>

                {/* Expandable Content */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
                    {/* Current Access */}
                    {chefAccess.accessibleKitchens.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-3">Current Access</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {chefAccess.accessibleKitchens.map((kitchen) => (
                            <div
                              key={kitchen.id}
                              className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg"
                            >
                              <div className="flex items-center gap-2">
                                <Building className="h-4 w-4 text-green-600" />
                                <div>
                                  <p className="font-medium text-gray-900">{kitchen.name}</p>
                                  {kitchen.locationName && (
                                    <p className="text-xs text-gray-600">{kitchen.locationName}</p>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  handleRevokeAccess(chefAccess.chef.id, kitchen.id)
                                }
                                disabled={revokeAccess.isPending}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Grant New Access */}
                    <div>
                      <h4 className="font-medium text-gray-900 mb-3">Grant Access to Kitchen</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {allKitchens
                          .filter((kitchen) => !accessibleKitchenIds.includes(kitchen.id))
                          .map((kitchen) => (
                            <div
                              key={kitchen.id}
                              className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg"
                            >
                              <div className="flex items-center gap-2">
                                <Building className="h-4 w-4 text-gray-600" />
                                <div>
                                  <p className="font-medium text-gray-900">{kitchen.name}</p>
                                  {kitchen.locationName && (
                                    <p className="text-xs text-gray-600">{kitchen.locationName}</p>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  handleGrantAccess(chefAccess.chef.id, kitchen.id)
                                }
                                disabled={grantAccess.isPending}
                                className="text-green-600 hover:text-green-700 hover:bg-green-50"
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                      </div>
                      {allKitchens.filter((kitchen) => !accessibleKitchenIds.includes(kitchen.id))
                        .length === 0 && (
                        <p className="text-sm text-gray-500 text-center py-4">
                          Chef has access to all available kitchens
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

