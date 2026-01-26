import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
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
  FileText,
  MessageCircle,
  AlertCircle,
} from "lucide-react";

import {
  createConversation,
  ensureConversationManagerId,
  getConversationForApplication,
} from '@/services/chat-service';
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import UnifiedChatView from "@/components/chat/UnifiedChatView";
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
  isRejected?: boolean;
  applicationStatus?: string;
  applicationId?: number;
  kitchenLicenseStatus?: string;
  allTiersCompleted?: boolean;
  nextTierToComplete?: string;
  hasChatConversation?: boolean;
  tierProgress?: {
    tier1: boolean;
    tier2: boolean;
    tier3: boolean;
    tier4: boolean;
  };
  managerId?: number;
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
  const [showChatDialog, setShowChatDialog] = useState(false);
  const [chatApplication, setChatApplication] = useState<any | null>(null);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const queryClient = useQueryClient();

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

  // Get chef Neon user ID for chat
  const { data: chefInfo } = useQuery({
    queryKey: ['/api/firebase/user/me'],
    queryFn: async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('Not authenticated');
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/firebase/user/me', {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to get user info');
      return response.json();
    },
    enabled: !!user,
  });

  const chefId = chefInfo?.id || null;


  // Get active application location IDs (inReview or approved only)
  // Allow locations with rejected/cancelled applications so chefs can re-apply
  const appliedLocationIds = new Set(
    applications
      .filter((a) => a.status === "inReview" || a.status === "approved")
      .map((a) => a.locationId)
  );
  const approvedLocationIds = new Set(approvedLocations.map((loc) => loc.id));

  console.log('[KitchenComparisonPage] Approved location IDs:', Array.from(approvedLocationIds));

  // Get pending applications (inReview status)
  const pendingApplications = applications.filter((a) => a.status === "inReview");
  const pendingLocationIds = new Set(pendingApplications.map((a) => a.locationId));

  // Get rejected/cancelled applications (for re-application)
  const rejectedApplications = applications.filter((a) => a.status === "rejected" || a.status === "cancelled");
  const rejectedLocationIds = new Set(rejectedApplications.map((a) => a.locationId));

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

  // Fetch kitchens for rejected application locations
  const { data: rejectedKitchens, isLoading: rejectedKitchensLoading } = useQuery<Kitchen[]>({
    queryKey: ["/api/chef/kitchens", rejectedLocationIds],
    queryFn: async () => {
      if (rejectedLocationIds.size === 0) return [];

      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/kitchens", {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        throw new Error("Failed to fetch kitchens");
      }

      const kitchens = await response.json();
      console.log('[KitchenComparisonPage] Fetched kitchens for rejected locations:', kitchens.length, 'kitchens');

      // Filter to locations with rejected/cancelled applications
      return (Array.isArray(kitchens) ? kitchens : []).filter((k: any) => {
        const locationId = k.locationId ?? k.location_id;
        return rejectedLocationIds.has(locationId);
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
          hourlyRate: k.hourlyRate,
          currency: k.currency || 'CAD',
          minimumBookingHours: k.minimumBookingHours || k.minimum_booking_hours || 1,
          pricingModel: k.pricingModel || k.pricing_model || 'hourly',
        };
      });
    },
    enabled: !!user && rejectedLocationIds.size > 0,
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
    pendingKitchensLoading || rejectedKitchensLoading;

  // Group approved kitchens by location
  const approvedLocationsWithKitchens: LocationWithKitchens[] = approvedLocations.map((location) => {
    const locationKitchens = (approvedKitchensWithPricing || approvedKitchens || []).filter(
      (k) => k.locationId === location.id
    );

    // Find the application for this location to check tier completion
    const application = applications.find((a) => a.locationId === location.id);


    // Enterprise 3-Tier System (using current_tier as source of truth):
    // - Tier 1: Application submitted, pending manager review (current_tier = 1)
    // - Tier 2: Step 1 approved, chef completing Step 2 (current_tier = 2)
    // - Tier 3: Fully approved, ready to book (current_tier >= 3)
    const currentTier = (application as any)?.current_tier ?? 1;
    const allTiersCompleted = currentTier >= 3;

    // Determine next action based on current tier
    let nextTierToComplete = "";
    if (!application) {
      nextTierToComplete = "Submit your application";
    } else if (currentTier === 1) {
      nextTierToComplete = "Complete application submission (Step 1)";
    } else if (currentTier === 2) {
      // Check if Step 2 docs submitted but not yet approved
      if (application.tier2_completed_at) {
        nextTierToComplete = "Awaiting manager approval for Step 2";
      } else {
        nextTierToComplete = "Complete kitchen coordination (Step 2)";
      }
    }
    // currentTier >= 3 means fully approved, no next step needed

    return {
      id: location.id,
      name: location.name,
      address: location.address,
      logoUrl: location.logoUrl || undefined,
      brandImageUrl: location.brandImageUrl || undefined,
      kitchens: locationKitchens,
      isApproved: true,
      allTiersCompleted,
      nextTierToComplete,
      hasChatConversation: !!application?.chat_conversation_id,
      tierProgress: {
        tier1: currentTier >= 1,
        tier2: currentTier >= 2,
        tier3: currentTier >= 3, // Tier 3 = fully approved
        tier4: false, // Reserved for future use
      },
      managerId: location.managerId,
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

  // Group rejected application kitchens by location
  const rejectedApplicationLocations: (LocationWithKitchens & { isApproved: boolean; applicationStatus?: string; isRejected?: boolean })[] =
    (publicLocations || [])
      .filter((loc) => rejectedLocationIds.has(loc.id))
      .map((location) => {
        const locationKitchens = (rejectedKitchens || []).filter(
          (k) => k.locationId === location.id
        );
        const application = rejectedApplications.find((a) => a.locationId === location.id);

        return {
          id: location.id,
          name: location.name,
          address: location.address,
          logoUrl: location.logoUrl || undefined,
          brandImageUrl: location.brandImageUrl || undefined,
          kitchens: locationKitchens,
          isApproved: false,
          isPending: false,
          isRejected: true,
          applicationStatus: application?.status,
          applicationId: application?.id,
        };
      })
      .filter((loc) => loc.kitchens.length > 0);

  // Group available to apply kitchens by location (not yet applied)
  const availableToApplyLocations: (LocationWithKitchens & { isApproved: boolean })[] = (publicLocations || [])
    .filter((loc) => !appliedLocationIds.has(loc.id) && !rejectedLocationIds.has(loc.id))
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

  // Combine all locations into a single list: Approved, Pending, Rejected (for re-apply), Available to Apply
  const allLocationsWithKitchens = [
    ...approvedLocationsWithKitchens,
    ...pendingApplicationLocations,
    ...rejectedApplicationLocations,
    ...availableToApplyLocations,
  ];

  console.log('[KitchenComparisonPage] All locations with kitchens:', {
    approved: approvedLocationsWithKitchens.length,
    pending: pendingApplicationLocations.length,
    rejected: rejectedApplicationLocations.length,
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

  // For fully approved chefs (Tier 3), go directly to booking calendar
  // For others, show requirements page
  const handleBookKitchen = (locationId: number, isFullyApproved: boolean = false) => {
    if (isFullyApproved) {
      // Tier 3: Skip requirements, go directly to booking calendar with location filter
      navigate(`/book-kitchen?location=${locationId}`);
    } else {
      // Tier 1/2: Show requirements page
      navigate(`/kitchen-requirements/${locationId}`);
    }
  };

  const handleViewDetails = (locationId: number) => {
    navigate(`/kitchen-preview/${locationId}`);
  };

  const handleApplyKitchen = (locationId: number) => {
    navigate(`/kitchen-requirements/${locationId}`);
  };

  const handleOpenChat = async (location: any) => {
    // Find the application for this location
    const application = applications.find((a) => a.locationId === location.id);
    if (!application) {
      console.error('No application found for location:', location.id);
      return;
    }

    if (!user) {
      console.error('No user found');
      return;
    }

    // Prepare chat data
    setChatApplication(application);

    try {
      setIsCreatingChat(true);

      // Check if conversation exists via service first (source of truth)
      // This handles cases where local state might be stale
      let conversationId = application.chat_conversation_id;

      if (!conversationId) {
        // Try getting it from Firestore directly
        const existingConv = await getConversationForApplication(application.id);
        if (existingConv) {
          conversationId = existingConv.id;
        }
      }

      // If we have a conversation ID, just open it
      if (conversationId) {
        // Self-healing: Ensure managerId is correct on the conversation document
        const appWithManager = application as any;
        const managerIdVal = appWithManager.location?.managerId || location.managerId;
        const managerId = managerIdVal ? Number(managerIdVal) : 0;

        if (managerId) {
          ensureConversationManagerId(conversationId, managerId);
        }

        setChatConversationId(conversationId);
        setShowChatDialog(true);
        setIsCreatingChat(false);
        return;
      }

      // If no conversation exists, create one
      if (chefId) {
        // We need managerId. The application object usually has included relation location -> managerId
        // Fallback: Use the managerID from the application's location property if available
        const appWithManager = application as any;
        // Ensure managerId is a number
        const managerIdVal = appWithManager.location?.managerId || location.managerId;
        const managerId = managerIdVal ? Number(managerIdVal) : 0;

        if (!managerId) {
          console.error("Manager ID missing from application or location", { appLocation: appWithManager.location, location });
          toast.error("Cannot start chat: Manager information missing");
          setIsCreatingChat(false);
          return;
        }

        // createConversation is now idempotent - safe to call
        const newConvId = await createConversation(
          application.id,
          chefId,
          managerId,
          location.id
        );

        setChatConversationId(newConvId);

        // Invalidate applications query to re-fetch with new conversation ID
        queryClient.invalidateQueries({ queryKey: ["chef-kitchen-applications-status"] });

        setShowChatDialog(true);
      }
    } catch (error) {
      console.error("Failed to open conversation:", error);
      toast.error("Failed to start conversation");
    } finally {
      setIsCreatingChat(false);
    }
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
                      <CardHeader className={`border-b ${location.allTiersCompleted
                        ? "bg-gradient-to-r from-green-50 to-emerald-50"
                        : location.isApproved
                          ? "bg-gradient-to-r from-blue-50 to-indigo-50"
                          : location.isPending
                            ? "bg-gradient-to-r from-yellow-50 to-amber-50"
                            : (location as any).isRejected
                              ? "bg-gradient-to-r from-orange-50 to-red-50"
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
                              <div className={`w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0 ${location.allTiersCompleted
                                ? "bg-gradient-to-br from-green-500 to-green-600"
                                : location.isApproved
                                  ? "bg-gradient-to-br from-blue-500 to-blue-600"
                                  : location.isPending
                                    ? "bg-gradient-to-br from-yellow-500 to-amber-600"
                                    : (location as any).isRejected
                                      ? "bg-gradient-to-br from-orange-500 to-red-600"
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
                          {location.allTiersCompleted ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200">
                              <Check className="h-3 w-3 mr-1" />
                              Ready to Book
                            </Badge>
                          ) : location.isApproved ? (
                            <Badge className="bg-blue-100 text-blue-800 border-blue-200">
                              <Clock className="h-3 w-3 mr-1" />
                              Steps In Progress
                            </Badge>
                          ) : location.isPending ? (
                            <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
                              <Clock className="h-3 w-3 mr-1" />
                              Pending Review
                            </Badge>
                          ) : (location as any).isRejected ? (
                            <Badge className="bg-orange-100 text-orange-800 border-orange-200">
                              <FileText className="h-3 w-3 mr-1" />
                              Rejected
                            </Badge>
                          ) : (
                            <Badge className={`${location.kitchenLicenseStatus === 'pending'
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
                              className={`border-2 rounded-lg p-4 transition-all ${location.allTiersCompleted
                                ? "border-gray-200 hover:border-green-500 hover:shadow-md"
                                : location.isApproved
                                  ? "border-gray-200 hover:border-blue-500 hover:shadow-md"
                                  : location.isPending
                                    ? "border-gray-200 hover:border-yellow-500 hover:shadow-md"
                                    : (location as any).isRejected
                                      ? "border-gray-200 hover:border-orange-500 hover:shadow-md"
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
                                  <>
                                    {location.allTiersCompleted ? (
                                      <div className="flex-1">
                                        <div className="text-xs text-green-700 font-medium mb-1">
                                          All steps completed - ready to book!
                                        </div>
                                        <Button
                                          size="sm"
                                          onClick={() => handleBookKitchen(location.id, true)}
                                          className="w-full bg-green-600 hover:bg-green-700"
                                        >
                                          <Calendar className="mr-2 h-4 w-4" />
                                          Book Now
                                        </Button>
                                      </div>
                                    ) : (
                                      <div className="flex-1 flex flex-col gap-3">
                                        <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm relative overflow-hidden group">
                                          <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
                                          <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                              <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200 gap-1 px-2 py-0.5 h-5">
                                                <Check className="h-3 w-3" />
                                                Step 1 Approved
                                              </Badge>
                                            </div>
                                            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                              50%
                                            </span>
                                          </div>

                                          {/* Progress Bar */}
                                          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mb-2.5">
                                            <div className="h-full bg-blue-500 w-1/2 rounded-full transition-all duration-500 group-hover:w-[52%]" />
                                          </div>

                                          <div className="flex items-center text-[11px] text-slate-600">
                                            <AlertCircle className="h-3 w-3 mr-1 text-blue-500" />
                                            <span>
                                              Next: <span className="font-medium text-slate-900">{location.nextTierToComplete || "Complete requirements"}</span>
                                            </span>
                                          </div>
                                        </div>

                                        <div className="flex gap-2">
                                          <Button
                                            size="sm"
                                            onClick={() => handleApplyKitchen(location.id)}
                                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white shadow-sm font-medium h-9"
                                          >
                                            Continue Application
                                            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                                          </Button>

                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleOpenChat(location)}
                                            disabled={isCreatingChat}
                                            className="px-3 border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 h-9 shrink-0"
                                            title="Message Kitchen"
                                          >
                                            {isCreatingChat ? (
                                              <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                              <MessageCircle className="h-4 w-4" />
                                            )}
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                  </>
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
                                ) : (location as any).isRejected ? (
                                  <Button
                                    size="sm"
                                    onClick={() => handleApplyKitchen(location.id)}
                                    className="flex-1 bg-orange-600 hover:bg-orange-700"
                                  >
                                    <FileText className="mr-2 h-4 w-4" />
                                    Re-apply
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

      {/* Chat Dialog */}
      <Dialog open={showChatDialog} onOpenChange={setShowChatDialog}>
        <DialogContent className="max-w-6xl h-[85vh] flex flex-col p-0 overflow-hidden border-none shadow-2xl">
          {chatConversationId && chefId && (
            <UnifiedChatView
              userId={chefId}
              role="chef"
              initialConversationId={chatConversationId}
            />
          )}
        </DialogContent>
      </Dialog>

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
