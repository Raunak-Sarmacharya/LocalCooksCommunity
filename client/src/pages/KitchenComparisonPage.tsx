import { useFirebaseAuth } from "@/hooks/use-auth";
import { useChefApprovedKitchens, useChefKitchenApplicationsStatus } from "@/hooks/use-chef-kitchen-applications";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Building2,
  MapPin,
  Calendar,
  DollarSign,
  ChefHat,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Check,
  Search,
  Filter,
  Plus,
  Clock,
  Wrench,
  Package,
  Snowflake,
  Info,
} from "lucide-react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import AnimatedBackgroundOrbs from "@/components/ui/AnimatedBackgroundOrbs";
import FadeInSection from "@/components/ui/FadeInSection";

interface EquipmentListing {
  id: number;
  category: string;
  equipmentType: string;
  brand?: string;
  model?: string;
  availabilityType: 'included' | 'rental';
  hourlyRate?: number;
  dailyRate?: number;
  currency?: string;
}

interface StorageListing {
  id: number;
  storageType: string;
  name: string;
  description?: string;
  basePrice?: number;
  pricePerCubicFoot?: number;
  pricingModel: string;
  dimensionsLength?: number;
  dimensionsWidth?: number;
  dimensionsHeight?: number;
  totalVolume?: number;
  climateControl?: boolean;
  currency?: string;
}

interface Kitchen {
  id: number;
  name: string;
  description?: string;
  locationId: number;
  locationName?: string;
  locationAddress?: string;
  location?: {
    id: number;
    name: string;
    address: string;
  };
  imageUrl?: string;
  amenities?: string[];
  hourlyRate?: number;
  currency?: string;
  equipment?: {
    included: EquipmentListing[];
    rental: EquipmentListing[];
  };
  storage?: StorageListing[];
}

interface LocationWithKitchens {
  id: number;
  name: string;
  address: string;
  logoUrl?: string;
  brandImageUrl?: string;
  kitchens: Kitchen[];
  isApproved?: boolean;
  isPending?: boolean;
  applicationStatus?: string;
  applicationId?: number;
  kitchenLicenseStatus?: string;
}

// Helper function to get Firebase auth headers
async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const { auth } = await import("@/lib/firebase");
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        Authorization: `Bearer ${token}`,
      };
    }
  } catch (error) {
    console.error("Error getting Firebase token:", error);
  }
  return {};
}

export default function KitchenComparisonPage() {
  const { user, loading: authLoading } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLocationFilter, setSelectedLocationFilter] = useState<number | null>(null);

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth?redirect=/compare-kitchens");
    }
  }, [user, authLoading, navigate]);

  // Get approved locations and applications
  const { approvedKitchens: approvedLocations, isLoading: locationsLoading } = useChefApprovedKitchens();
  const { applications, isLoading: applicationsLoading } = useChefKitchenApplicationsStatus();
  
  console.log('[KitchenComparisonPage] Approved locations:', approvedLocations);
  console.log('[KitchenComparisonPage] Applications:', applications);
  
  // Get applied location IDs (all applications)
  const appliedLocationIds = new Set(applications.map((a) => a.locationId));
  const approvedLocationIds = new Set(approvedLocations.map((loc) => loc.id));
  
  console.log('[KitchenComparisonPage] Approved location IDs:', Array.from(approvedLocationIds));
  
  // Get pending applications (inReview status)
  const pendingApplications = applications.filter((a) => a.status === "inReview");
  const pendingLocationIds = new Set(pendingApplications.map((a) => a.locationId));

  // Fetch all public locations (for "available to apply" section)
  const { data: publicLocations, isLoading: publicLocationsLoading } = useQuery<PublicLocation[]>({
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

  // Fetch ALL kitchens (for "available to book" section - shows all kitchens, filters by approved locations)
  const { data: approvedKitchens, isLoading: kitchensLoading } = useQuery<Kitchen[]>({
    queryKey: ["/api/chef/kitchens", approvedLocations],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/kitchens", {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to fetch kitchens");
      }

      const kitchens = await response.json();
      console.log('[KitchenComparisonPage] Fetched kitchens:', kitchens.length, 'kitchens');
      
      // Filter kitchens to only include those from approved locations
      const filtered = (Array.isArray(kitchens) ? kitchens : []).filter((k: any) => {
        const locationId = k.locationId ?? k.location_id;
        return approvedLocationIds.has(locationId);
      });
      
      console.log('[KitchenComparisonPage] Filtered to approved locations:', filtered.length, 'kitchens');
      
      return filtered.map((k: any) => {
        const locationId = k.locationId ?? k.location_id;
        const location = approvedLocations.find((loc) => loc.id === locationId);
        
        return {
          id: k.id,
          name: k.name,
          description: k.description,
          locationId,
          locationName: location?.name || k.locationName || k.location_name,
          locationAddress: location?.address || k.locationAddress || k.location_address,
          location: location ? {
            id: location.id,
            name: location.name,
            address: location.address,
          } : k.location,
          imageUrl: k.imageUrl || k.image_url,
          amenities: k.amenities || [],
          hourlyRate: k.hourlyRate, // Should already be in dollars from backend
          currency: k.currency || 'CAD',
          minimumBookingHours: k.minimumBookingHours || k.minimum_booking_hours || 1,
          pricingModel: k.pricingModel || k.pricing_model || 'hourly',
        };
      });
    },
    enabled: !!user && approvedLocations.length > 0, // Only fetch when user is authenticated and has approved locations
    staleTime: 60000, // Cache for 1 minute
  });

  // Fetch kitchens for locations not yet applied to (for "available to apply" section)
  const { data: availableToApplyKitchens, isLoading: availableKitchensLoading } = useQuery<Kitchen[]>({
    queryKey: ["/api/chef/kitchens", publicLocations, appliedLocationIds],
    queryFn: async () => {
      if (!publicLocations || publicLocations.length === 0) return [];

      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/kitchens", {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to fetch kitchens");
      }

      const kitchens = await response.json();
      console.log('[KitchenComparisonPage] Fetched kitchens for available to apply:', kitchens.length, 'kitchens');
      
      // Filter to locations chef hasn't applied to yet
      const notAppliedLocationIds = (publicLocations || [])
        .filter((loc) => !appliedLocationIds.has(loc.id))
        .map((loc) => loc.id);
      
      const filteredKitchens = (Array.isArray(kitchens) ? kitchens : []).filter((k: any) => {
        const locationId = k.locationId ?? k.location_id;
        return notAppliedLocationIds.includes(locationId);
      });

      // Fetch equipment and storage for each kitchen
      const kitchenPromises = filteredKitchens.map(async (k: any) => {
        const locationId = k.locationId ?? k.location_id;
        const location = publicLocations.find((loc) => loc.id === locationId);
        
        const baseKitchen = {
          id: k.id,
          name: k.name,
          description: k.description,
          locationId,
          locationName: location?.name || k.locationName || k.location_name,
          locationAddress: location?.address || k.locationAddress || k.location_address,
          location: location ? {
            id: location.id,
            name: location.name,
            address: location.address,
          } : k.location,
          imageUrl: k.imageUrl || k.image_url,
          amenities: k.amenities || [],
          hourlyRate: k.hourlyRate, // Should already be in dollars from backend
          currency: k.currency || 'CAD',
          minimumBookingHours: k.minimumBookingHours || k.minimum_booking_hours || 1,
          pricingModel: k.pricingModel || k.pricing_model || 'hourly',
        };

        // Fetch equipment listings (public info, no auth needed for preview)
        let equipment = { included: [], rental: [] };
        try {
          const equipmentResponse = await fetch(`/api/chef/kitchens/${k.id}/equipment-listings`, {
            credentials: "include",
            headers,
          });
          if (equipmentResponse.ok) {
            const equipmentData = await equipmentResponse.json();
            equipment = {
              included: (equipmentData.included || []).map((e: any) => ({
                id: e.id,
                category: e.category,
                equipmentType: e.equipmentType,
                brand: e.brand,
                model: e.model,
                availabilityType: e.availabilityType,
                hourlyRate: e.hourlyRate ? (e.hourlyRate > 100 ? e.hourlyRate / 100 : e.hourlyRate) : undefined,
                dailyRate: e.dailyRate ? (e.dailyRate > 100 ? e.dailyRate / 100 : e.dailyRate) : undefined,
                currency: e.currency || "CAD",
              })),
              rental: (equipmentData.rental || []).map((e: any) => ({
                id: e.id,
                category: e.category,
                equipmentType: e.equipmentType,
                brand: e.brand,
                model: e.model,
                availabilityType: e.availabilityType,
                hourlyRate: e.hourlyRate ? (e.hourlyRate > 100 ? e.hourlyRate / 100 : e.hourlyRate) : undefined,
                dailyRate: e.dailyRate ? (e.dailyRate > 100 ? e.dailyRate / 100 : e.dailyRate) : undefined,
                currency: e.currency || "CAD",
              })),
            };
          }
        } catch (error) {
          console.error(`Failed to fetch equipment for kitchen ${k.id}:`, error);
        }

        // Fetch storage listings
        let storage: StorageListing[] = [];
        try {
          const storageResponse = await fetch(`/api/chef/kitchens/${k.id}/storage-listings`, {
            credentials: "include",
            headers,
          });
          if (storageResponse.ok) {
            const storageData = await storageResponse.json();
            storage = (storageData || []).map((s: any) => ({
              id: s.id,
              storageType: s.storageType,
              name: s.name,
              description: s.description,
              basePrice: s.basePrice,
              pricePerCubicFoot: s.pricePerCubicFoot,
              pricingModel: s.pricingModel,
              dimensionsLength: s.dimensionsLength,
              dimensionsWidth: s.dimensionsWidth,
              dimensionsHeight: s.dimensionsHeight,
              totalVolume: s.totalVolume,
              climateControl: s.climateControl,
              currency: s.currency || "CAD",
            }));
          }
        } catch (error) {
          console.error(`Failed to fetch storage for kitchen ${k.id}:`, error);
        }

        return {
          ...baseKitchen,
          hourlyRate: k.hourlyRate, // Should already be in dollars from backend
          currency: k.currency || 'CAD',
          minimumBookingHours: k.minimumBookingHours || k.minimum_booking_hours || 1,
          pricingModel: k.pricingModel || k.pricing_model || 'hourly',
          equipment,
          storage,
        };
      });

      return Promise.all(kitchenPromises);
    },
    enabled: !!user && !!publicLocations && publicLocations.length > 0, // Only fetch when user is authenticated
    staleTime: 60000,
  });

  // Fetch kitchens for pending application locations
  const { data: pendingKitchens, isLoading: pendingKitchensLoading } = useQuery<Kitchen[]>({
    queryKey: ["/api/chef/kitchens", pendingLocationIds],
    queryFn: async () => {
      if (pendingLocationIds.size === 0) return [];

      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/kitchens", {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to fetch kitchens");
      }

      const kitchens = await response.json();
      console.log('[KitchenComparisonPage] Fetched kitchens for pending locations:', kitchens.length, 'kitchens');
      
      // Filter to locations with pending applications
      return (Array.isArray(kitchens) ? kitchens : []).filter((k: any) => {
        const locationId = k.locationId ?? k.location_id;
        return pendingLocationIds.has(locationId);
      }).map((k: any) => {
        const locationId = k.locationId ?? k.location_id;
        const location = publicLocations?.find((loc) => loc.id === locationId);
        
        return {
          id: k.id,
          name: k.name,
          description: k.description,
          locationId,
          locationName: location?.name || k.locationName || k.location_name,
          locationAddress: location?.address || k.locationAddress || k.location_address,
          location: location ? {
            id: location.id,
            name: location.name,
            address: location.address,
          } : k.location,
          imageUrl: k.imageUrl || k.image_url,
          amenities: k.amenities || [],
          hourlyRate: k.hourlyRate, // Should already be in dollars from backend
          currency: k.currency || 'CAD',
          minimumBookingHours: k.minimumBookingHours || k.minimum_booking_hours || 1,
          pricingModel: k.pricingModel || k.pricing_model || 'hourly',
        };
      });
    },
    enabled: !!user && pendingLocationIds.size > 0, // Only fetch when user is authenticated
    staleTime: 60000,
  });

  // Fetch equipment and storage for pending kitchens
  const { data: pendingKitchensWithAddons } = useQuery<Kitchen[]>({
    queryKey: ["/api/chef/kitchens/pending-addons", pendingKitchens],
    queryFn: async () => {
      if (!pendingKitchens || pendingKitchens.length === 0) return [];

      const headers = await getAuthHeaders();
      
      const kitchenPromises = pendingKitchens.map(async (kitchen) => {
        // Fetch equipment
        let equipment = { included: [], rental: [] };
        try {
          const equipmentResponse = await fetch(`/api/chef/kitchens/${kitchen.id}/equipment-listings`, {
            credentials: "include",
            headers,
          });
          if (equipmentResponse.ok) {
            const equipmentData = await equipmentResponse.json();
            equipment = {
              included: (equipmentData.included || []).map((e: any) => ({
                id: e.id,
                category: e.category,
                equipmentType: e.equipmentType,
                brand: e.brand,
                model: e.model,
                availabilityType: e.availabilityType,
                hourlyRate: e.hourlyRate ? (e.hourlyRate > 100 ? e.hourlyRate / 100 : e.hourlyRate) : undefined,
                dailyRate: e.dailyRate ? (e.dailyRate > 100 ? e.dailyRate / 100 : e.dailyRate) : undefined,
                currency: e.currency || "CAD",
              })),
              rental: (equipmentData.rental || []).map((e: any) => ({
                id: e.id,
                category: e.category,
                equipmentType: e.equipmentType,
                brand: e.brand,
                model: e.model,
                availabilityType: e.availabilityType,
                hourlyRate: e.hourlyRate ? (e.hourlyRate > 100 ? e.hourlyRate / 100 : e.hourlyRate) : undefined,
                dailyRate: e.dailyRate ? (e.dailyRate > 100 ? e.dailyRate / 100 : e.dailyRate) : undefined,
                currency: e.currency || "CAD",
              })),
            };
          }
        } catch (error) {
          console.error(`Failed to fetch equipment for kitchen ${kitchen.id}:`, error);
        }

        // Fetch storage
        let storage: StorageListing[] = [];
        try {
          const storageResponse = await fetch(`/api/chef/kitchens/${kitchen.id}/storage-listings`, {
            credentials: "include",
            headers,
          });
          if (storageResponse.ok) {
            const storageData = await storageResponse.json();
            storage = (storageData || []).map((s: any) => ({
              id: s.id,
              storageType: s.storageType,
              name: s.name,
              description: s.description,
              basePrice: s.basePrice,
              pricePerCubicFoot: s.pricePerCubicFoot,
              pricingModel: s.pricingModel,
              dimensionsLength: s.dimensionsLength,
              dimensionsWidth: s.dimensionsWidth,
              dimensionsHeight: s.dimensionsHeight,
              totalVolume: s.totalVolume,
              climateControl: s.climateControl,
              currency: s.currency || "CAD",
            }));
          }
        } catch (error) {
          console.error(`Failed to fetch storage for kitchen ${kitchen.id}:`, error);
        }

        return {
          ...kitchen,
          equipment,
          storage,
        };
      });

      return Promise.all(kitchenPromises);
    },
    enabled: !!pendingKitchens && pendingKitchens.length > 0,
    staleTime: 60000,
  });

  // Fetch pricing, equipment, and storage for approved kitchens
  const { data: approvedKitchensWithPricing, isLoading: pricingLoading } = useQuery<Kitchen[]>({
    queryKey: ["/api/chef/kitchens/pricing-and-addons", approvedKitchens],
    queryFn: async () => {
      if (!approvedKitchens || approvedKitchens.length === 0) return [];

      const headers = await getAuthHeaders();
      
      // Fetch pricing, equipment, and storage for all kitchens in parallel
      const kitchenPromises = approvedKitchens.map(async (kitchen) => {
        try {
          // Fetch pricing
          const pricingResponse = await fetch(`/api/chef/kitchens/${kitchen.id}/pricing`, {
            credentials: "include",
            headers,
          });

          let hourlyRate = kitchen.hourlyRate;
          let currency = kitchen.currency || "CAD";
          
          if (pricingResponse.ok) {
            const pricing = await pricingResponse.json();
            hourlyRate = pricing.hourlyRate > 100 ? pricing.hourlyRate / 100 : pricing.hourlyRate;
            currency = pricing.currency || "CAD";
          }

          // Fetch equipment listings
          let equipment = { included: [], rental: [] };
          try {
            const equipmentResponse = await fetch(`/api/chef/kitchens/${kitchen.id}/equipment-listings`, {
              credentials: "include",
              headers,
            });
            if (equipmentResponse.ok) {
              const equipmentData = await equipmentResponse.json();
              equipment = {
                included: (equipmentData.included || []).map((e: any) => ({
                  id: e.id,
                  category: e.category,
                  equipmentType: e.equipmentType,
                  brand: e.brand,
                  model: e.model,
                  availabilityType: e.availabilityType,
                  hourlyRate: e.hourlyRate ? (e.hourlyRate > 100 ? e.hourlyRate / 100 : e.hourlyRate) : undefined,
                  dailyRate: e.dailyRate ? (e.dailyRate > 100 ? e.dailyRate / 100 : e.dailyRate) : undefined,
                  currency: e.currency || currency,
                })),
                rental: (equipmentData.rental || []).map((e: any) => ({
                  id: e.id,
                  category: e.category,
                  equipmentType: e.equipmentType,
                  brand: e.brand,
                  model: e.model,
                  availabilityType: e.availabilityType,
                  hourlyRate: e.hourlyRate ? (e.hourlyRate > 100 ? e.hourlyRate / 100 : e.hourlyRate) : undefined,
                  dailyRate: e.dailyRate ? (e.dailyRate > 100 ? e.dailyRate / 100 : e.dailyRate) : undefined,
                  currency: e.currency || currency,
                })),
              };
            }
          } catch (error) {
            console.error(`Failed to fetch equipment for kitchen ${kitchen.id}:`, error);
          }

          // Fetch storage listings
          let storage: StorageListing[] = [];
          try {
            const storageResponse = await fetch(`/api/chef/kitchens/${kitchen.id}/storage-listings`, {
              credentials: "include",
              headers,
            });
            if (storageResponse.ok) {
              const storageData = await storageResponse.json();
              storage = (storageData || []).map((s: any) => ({
                id: s.id,
                storageType: s.storageType,
                name: s.name,
                description: s.description,
                basePrice: s.basePrice,
                pricePerCubicFoot: s.pricePerCubicFoot,
                pricingModel: s.pricingModel,
                dimensionsLength: s.dimensionsLength,
                dimensionsWidth: s.dimensionsWidth,
                dimensionsHeight: s.dimensionsHeight,
                totalVolume: s.totalVolume,
                climateControl: s.climateControl,
                currency: s.currency || currency,
              }));
            }
          } catch (error) {
            console.error(`Failed to fetch storage for kitchen ${kitchen.id}:`, error);
          }

          return {
            ...kitchen,
            hourlyRate,
            currency,
            equipment,
            storage,
          };
        } catch (error) {
          console.error(`Failed to fetch data for kitchen ${kitchen.id}:`, error);
          return kitchen;
        }
      });

      return Promise.all(kitchenPromises);
    },
    enabled: !!approvedKitchens && approvedKitchens.length > 0,
    staleTime: 60000,
  });

  const isLoading = locationsLoading || kitchensLoading || pricingLoading || authLoading || 
                    applicationsLoading || publicLocationsLoading || availableKitchensLoading || 
                    pendingKitchensLoading;

  // Group approved kitchens by location
  const approvedLocationsWithKitchens: LocationWithKitchens[] = approvedLocations.map((location) => {
    const locationKitchens = (approvedKitchensWithPricing || approvedKitchens || []).filter(
      (k) => k.locationId === location.id
    );

    console.log(`[KitchenComparisonPage] Location ${location.name} (${location.id}): ${locationKitchens.length} kitchens`);

    return {
      id: location.id,
      name: location.name,
      address: location.address,
      logoUrl: location.logoUrl || undefined,
      brandImageUrl: location.brandImageUrl || undefined,
      kitchens: locationKitchens,
      isApproved: true,
    };
  }).filter((loc) => loc.kitchens.length > 0);
  
  console.log('[KitchenComparisonPage] Approved locations with kitchens:', approvedLocationsWithKitchens.length);

  // Group pending application kitchens by location
  const pendingApplicationLocations: (LocationWithKitchens & { isApproved: boolean; applicationStatus?: string })[] = 
    (publicLocations || [])
      .filter((loc) => pendingLocationIds.has(loc.id))
      .map((location) => {
        const locationKitchens = (pendingKitchensWithAddons || pendingKitchens || []).filter(
          (k) => k.locationId === location.id
        );
        const application = pendingApplications.find((a) => a.locationId === location.id);

        return {
          id: location.id,
          name: location.name,
          address: location.address,
          logoUrl: location.logoUrl || undefined,
          brandImageUrl: location.brandImageUrl || undefined,
          kitchens: locationKitchens,
          isApproved: false,
          isPending: true,
          applicationStatus: application?.status,
          applicationId: application?.id,
        };
      })
      .filter((loc) => loc.kitchens.length > 0);

  // Group available to apply kitchens by location (not yet applied)
  const availableToApplyLocations: (LocationWithKitchens & { isApproved: boolean })[] = (publicLocations || [])
    .filter((loc) => !appliedLocationIds.has(loc.id))
    .map((location) => {
      const locationKitchens = (availableToApplyKitchens || []).filter(
        (k) => k.locationId === location.id
      );

      return {
        id: location.id,
        name: location.name,
        address: location.address,
        logoUrl: location.logoUrl || undefined,
        brandImageUrl: location.brandImageUrl || undefined,
        kitchens: locationKitchens,
        isApproved: false,
        isPending: false,
        kitchenLicenseStatus: location.kitchenLicenseStatus || undefined,
      };
    })
    .filter((loc) => loc.kitchens.length > 0);

  // Combine all locations into a single list: Approved, Pending, Available to Apply
  const allLocationsWithKitchens = [
    ...approvedLocationsWithKitchens,
    ...pendingApplicationLocations,
    ...availableToApplyLocations,
  ];
  
  console.log('[KitchenComparisonPage] All locations with kitchens:', {
    approved: approvedLocationsWithKitchens.length,
    pending: pendingApplicationLocations.length,
    availableToApply: availableToApplyLocations.length,
    total: allLocationsWithKitchens.length
  });

  // Filter all locations
  const filteredLocations = allLocationsWithKitchens
    .filter((loc) => {
      if (selectedLocationFilter && loc.id !== selectedLocationFilter) return false;
      if (!searchQuery) return true;
      
      const query = searchQuery.toLowerCase();
      return (
        loc.name.toLowerCase().includes(query) ||
        loc.address.toLowerCase().includes(query) ||
        loc.kitchens.some(
          (k) =>
            k.name.toLowerCase().includes(query) ||
            (k.description && k.description.toLowerCase().includes(query))
        )
      );
    })
    .map((loc) => ({
      ...loc,
      kitchens: loc.kitchens.filter((k) => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
          k.name.toLowerCase().includes(query) ||
          (k.description && k.description.toLowerCase().includes(query))
        );
      }),
    }))
    .filter((loc) => loc.kitchens.length > 0);

  const handleBookKitchen = (locationId: number) => {
    navigate(`/book-kitchen?location=${locationId}`);
  };

  const handleViewDetails = (locationId: number) => {
    navigate(`/kitchen-preview/${locationId}`);
  };

  const handleApplyKitchen = (locationId: number) => {
    navigate(`/apply-kitchen/${locationId}`);
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Header />
        <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-[#F51042]" />
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!user) {
    return null; // Redirecting
  }

  // Get all unique location IDs for filter dropdown
  const allLocationIds = [
    ...approvedLocations.map((loc) => loc.id),
    ...(publicLocations || [])
      .filter((loc) => !appliedLocationIds.has(loc.id))
      .map((loc) => loc.id),
  ];
  const uniqueLocationIds = Array.from(new Set(allLocationIds));
  const allLocationsForFilter = [
    ...approvedLocations,
    ...(publicLocations || []).filter((loc) => !appliedLocationIds.has(loc.id)),
  ].filter((loc, index, self) => 
    index === self.findIndex((l) => l.id === loc.id)
  );

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-gray-50 via-white to-blue-50 relative overflow-hidden">
      <AnimatedBackgroundOrbs />
      <Header />
      <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12 relative z-10">
        <div className="container mx-auto px-4 max-w-7xl">
          {/* Header Section */}
          <FadeInSection>
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6"
            >
              <Button
                variant="ghost"
                onClick={() => navigate("/dashboard")}
                className="text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Dashboard
              </Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-8"
            >
              <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">
                Compare Available Kitchens
              </h1>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Browse and compare all available kitchens. Approved kitchens can be booked immediately, while others require an application.
              </p>
            </motion.div>
          </FadeInSection>

          {/* Search and Filter */}
          <FadeInSection delay={1}>
            <Card className="mb-6">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search kitchens by name, location, or description..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-gray-400" />
                    <select
                      value={selectedLocationFilter || ""}
                      onChange={(e) =>
                        setSelectedLocationFilter(e.target.value ? parseInt(e.target.value) : null)
                      }
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">All Locations</option>
                      {allLocationsForFilter.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </FadeInSection>

          {/* All Kitchen Listings */}
          <FadeInSection delay={2}>
            {filteredLocations.length === 0 ? (
              <FadeInSection>
                <Card>
                  <CardContent className="text-center py-12">
                    <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600 font-medium">
                      {searchQuery || selectedLocationFilter
                        ? "No kitchens match your search"
                        : "No kitchens available"}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      {searchQuery || selectedLocationFilter
                        ? "Try adjusting your search or filters"
                        : "Check back later for available kitchens"}
                    </p>
                  </CardContent>
                </Card>
              </FadeInSection>
            ) : (
              <div className="space-y-8">
                {filteredLocations.map((location) => (
                  <FadeInSection key={location.id}>
                    <Card className="overflow-hidden">
                      <CardHeader className={`border-b ${
                        location.isApproved 
                          ? "bg-gradient-to-r from-blue-50 to-indigo-50" 
                          : location.isPending
                          ? "bg-gradient-to-r from-yellow-50 to-amber-50"
                          : "bg-gradient-to-r from-gray-50 to-slate-50"
                      }`}>
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-4 flex-1">
                            {location.brandImageUrl ? (
                              <img
                                src={location.brandImageUrl}
                                alt={location.name}
                                className="w-16 h-16 rounded-lg object-cover"
                              />
                            ) : location.logoUrl ? (
                              <img
                                src={location.logoUrl}
                                alt={location.name}
                                className="w-16 h-16 rounded-lg object-cover"
                              />
                            ) : (
                              <div className={`w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                location.isApproved
                                  ? "bg-gradient-to-br from-blue-500 to-blue-600"
                                  : location.isPending
                                  ? "bg-gradient-to-br from-yellow-500 to-amber-600"
                                  : "bg-gradient-to-br from-gray-500 to-slate-600"
                              }`}>
                                <Building2 className="h-8 w-8 text-white" />
                              </div>
                            )}
                            <div className="flex-1">
                              <CardTitle className="text-xl mb-1">{location.name}</CardTitle>
                              <CardDescription className="flex items-center gap-1 mt-1">
                                <MapPin className="h-3.5 w-3.5" />
                                {location.address}
                              </CardDescription>
                            </div>
                          </div>
                          {location.isApproved ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200">
                              <Check className="h-3 w-3 mr-1" />
                              Approved
                            </Badge>
                          ) : location.isPending ? (
                            <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
                              <Clock className="h-3 w-3 mr-1" />
                              Pending Review
                            </Badge>
                          ) : (
                            <Badge className={`${
                              location.kitchenLicenseStatus === 'pending'
                                ? "bg-orange-100 text-orange-800 border-orange-200"
                                : "bg-blue-100 text-blue-800 border-blue-200"
                            }`}>
                              <Plus className="h-3 w-3 mr-1" />
                              {location.kitchenLicenseStatus === 'pending' 
                                ? "Pending Approval" 
                                : "Apply to Book"}
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                    <CardContent className="p-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {location.kitchens.map((kitchen) => (
                          <motion.div
                            key={kitchen.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`border-2 rounded-lg p-4 transition-all ${
                              location.isApproved
                                ? "border-gray-200 hover:border-blue-500 hover:shadow-md"
                                : location.isPending
                                ? "border-gray-200 hover:border-yellow-500 hover:shadow-md"
                                : "border-gray-200 hover:border-gray-400 hover:shadow-md"
                            }`}
                          >
                            {kitchen.imageUrl && (
                              <img
                                src={kitchen.imageUrl}
                                alt={kitchen.name}
                                className="w-full h-32 object-cover rounded-lg mb-3"
                              />
                            )}
                            <h3 className="font-semibold text-lg mb-2">{kitchen.name}</h3>
                            {kitchen.description && (
                              <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                                {kitchen.description}
                              </p>
                            )}
                            {kitchen.hourlyRate && (
                              <div className="flex items-center gap-1 mb-3">
                                <DollarSign className="h-4 w-4 text-green-600" />
                                <span className="font-semibold text-green-600">
                                  ${kitchen.hourlyRate.toFixed(2)} {kitchen.currency || "CAD"}
                                </span>
                                <span className="text-sm text-gray-500">/hour</span>
                              </div>
                            )}
                            {kitchen.amenities && kitchen.amenities.length > 0 && (
                              <div className="mb-3">
                                <p className="text-xs text-gray-500 mb-1">Amenities:</p>
                                <div className="flex flex-wrap gap-1">
                                  {kitchen.amenities.slice(0, 3).map((amenity, idx) => (
                                    <Badge
                                      key={idx}
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      {amenity}
                                    </Badge>
                                  ))}
                                  {kitchen.amenities.length > 3 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{kitchen.amenities.length - 3} more
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Equipment Information */}
                            {kitchen.equipment && (
                              <div className="mb-3 space-y-2">
                                {kitchen.equipment.included && kitchen.equipment.included.length > 0 && (
                                  <div className="bg-green-50 border border-green-200 rounded p-2">
                                    <div className="flex items-center gap-1 mb-1">
                                      <Wrench className="h-3 w-3 text-green-600" />
                                      <p className="text-xs font-medium text-green-800">
                                        Included Equipment ({kitchen.equipment.included.length})
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {kitchen.equipment.included.slice(0, 2).map((eq, idx) => (
                                        <Badge
                                          key={idx}
                                          variant="outline"
                                          className="text-xs bg-white border-green-300 text-green-700"
                                        >
                                          {eq.equipmentType}
                                        </Badge>
                                      ))}
                                      {kitchen.equipment.included.length > 2 && (
                                        <Badge
                                          variant="outline"
                                          className="text-xs bg-white border-green-300 text-green-700"
                                        >
                                          +{kitchen.equipment.included.length - 2} more
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                )}
                                {kitchen.equipment.rental && kitchen.equipment.rental.length > 0 && (
                                  <div className="bg-blue-50 border border-blue-200 rounded p-2">
                                    <div className="flex items-center gap-1 mb-1">
                                      <Wrench className="h-3 w-3 text-blue-600" />
                                      <p className="text-xs font-medium text-blue-800">
                                        Rental Equipment ({kitchen.equipment.rental.length})
                                      </p>
                                    </div>
                                    <div className="space-y-1">
                                      {kitchen.equipment.rental.slice(0, 2).map((eq, idx) => (
                                        <div key={idx} className="text-xs text-blue-700">
                                          <span className="font-medium">{eq.equipmentType}</span>
                                          {eq.hourlyRate && (
                                            <span className="ml-1 text-blue-600">
                                              ${eq.hourlyRate.toFixed(2)}/hr
                                            </span>
                                          )}
                                          {eq.dailyRate && !eq.hourlyRate && (
                                            <span className="ml-1 text-blue-600">
                                              ${eq.dailyRate.toFixed(2)}/day
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                      {kitchen.equipment.rental.length > 2 && (
                                        <p className="text-xs text-blue-600 italic">
                                          +{kitchen.equipment.rental.length - 2} more available
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Storage Information */}
                            {kitchen.storage && kitchen.storage.length > 0 && (
                              <div className="mb-3 bg-purple-50 border border-purple-200 rounded p-2">
                                <div className="flex items-center gap-1 mb-1">
                                  <Package className="h-3 w-3 text-purple-600" />
                                  <p className="text-xs font-medium text-purple-800">
                                    Storage Available ({kitchen.storage.length})
                                  </p>
                                </div>
                                <div className="space-y-1">
                                  {kitchen.storage.slice(0, 2).map((storage, idx) => (
                                    <div key={idx} className="text-xs text-purple-700">
                                      <div className="flex items-center justify-between">
                                        <span className="font-medium">{storage.name || storage.storageType}</span>
                                        {storage.basePrice && (
                                          <span className="text-purple-600">
                                            ${storage.basePrice.toFixed(2)}
                                            {storage.pricingModel === 'per_cubic_foot' && storage.pricePerCubicFoot && (
                                              <span className="text-xs"> + ${storage.pricePerCubicFoot.toFixed(2)}/ft³</span>
                                            )}
                                          </span>
                                        )}
                                      </div>
                                      {storage.climateControl && (
                                        <div className="flex items-center gap-1 mt-0.5">
                                          <Snowflake className="h-2.5 w-2.5 text-purple-500" />
                                          <span className="text-purple-600">Climate Controlled</span>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {kitchen.storage.length > 2 && (
                                    <p className="text-xs text-purple-600 italic">
                                      +{kitchen.storage.length - 2} more storage options
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}

                            <div className="flex gap-2 mt-4">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleViewDetails(location.id)}
                                className="flex-1"
                              >
                                View Details
                              </Button>
                              {location.isApproved ? (
                                <Button
                                  size="sm"
                                  onClick={() => handleBookKitchen(location.id)}
                                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                                >
                                  <Calendar className="mr-2 h-4 w-4" />
                                  Book Now
                                </Button>
                              ) : location.isPending ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled
                                  className="flex-1 bg-yellow-50 border-yellow-300 text-yellow-700 cursor-not-allowed"
                                >
                                  <Clock className="mr-2 h-4 w-4" />
                                  Pending Review
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => handleApplyKitchen(location.id)}
                                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                                >
                                  <Plus className="mr-2 h-4 w-4" />
                                  Apply Now
                                </Button>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </FadeInSection>
              ))}
            </div>
            )}
          </FadeInSection>
        </div>
      </main>
      <Footer />
    </div>
  );
}

interface PublicLocation {
  id: number;
  name: string;
  address: string;
  city?: string;
  logoUrl?: string | null;
  brandImageUrl?: string | null;
  kitchenLicenseStatus?: string | null;
}
