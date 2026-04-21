import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  category: 'general' | 'safety' | 'equipment' | 'smart_lock';
  /**
   * When true, the chef must upload a photo alongside checking this item off.
   * Matched to a PhotoRequirement with the same id in the sibling
   * checkinPhotoRequirements / checkoutPhotoRequirements array.
   */
  photoRequired?: boolean;
}

export interface PhotoRequirement {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  exampleUrl?: string;
}

export interface LocationChecklist {
  locationId: number;
  checkinEnabled: boolean;
  checkinItems: ChecklistItem[];
  checkinPhotoRequirements: PhotoRequirement[];
  checkinInstructions: string | null;
  checkoutEnabled: boolean;
  checkoutItems: ChecklistItem[];
  checkoutPhotoRequirements: PhotoRequirement[];
  checkoutInstructions: string | null;
  storageCheckoutEnabled: boolean;
  storageCheckoutItems: ChecklistItem[];
  storageCheckoutPhotoRequirements: PhotoRequirement[];
  storageCheckoutInstructions: string | null;
  storageCheckinEnabled: boolean;
  storageCheckinItems: ChecklistItem[];
  storageCheckinPhotoRequirements: PhotoRequirement[];
  storageCheckinInstructions: string | null;
  smartLockCheckinInstructions: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Fetches the manager-defined checklist for a location.
 * Used by chef-side check-in/check-out components.
 */
export function useLocationChecklist(locationId: number | null | undefined) {
  return useQuery<LocationChecklist>({
    queryKey: ["location-checklist", locationId],
    queryFn: () => apiGet(`/chef/locations/${locationId}/checklist`),
    enabled: !!locationId && locationId > 0,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes — checklists don't change often
  });
}
