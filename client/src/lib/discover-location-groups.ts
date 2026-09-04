/** One Discover card per location, regardless of how many kitchens share it. */

import {
  mergeEquipmentLists,
  mergeStorageSummaries,
  type KitchenGridStorageSummary,
} from "@/lib/kitchen-grid-card";

export type DiscoverKitchenLike = {
  id: number;
  name: string;
  locationId: number;
  locationName: string;
  locationSlug?: string;
  address: string;
  imageUrl?: string | null;
  galleryImages?: string[];
  equipment?: string[];
  hourlyRate?: number | null;
  currency?: string;
  minimumBookingHours?: number | null;
  description?: string | null;
  canAcceptBookings: boolean;
  isLocationApproved?: boolean;
  customOnboardingLink?: string | null;
  storageSummary?: KitchenGridStorageSummary;
};

export type DiscoverLocationCard = {
  locationId: number;
  locationName: string;
  locationSlug?: string;
  address: string;
  kitchens: DiscoverKitchenLike[];
  /** Kitchen used for card image / default rate display. */
  displayKitchen: DiscoverKitchenLike;
  kitchenCount: number;
  canAcceptBookings: boolean;
  /** Lowest positive hourly rate among kitchens, else display kitchen's rate. */
  hourlyRate: number | null;
  /** Aggregated across all kitchens at this location. */
  equipment: string[];
  storageSummary: KitchenGridStorageSummary;
};

function pickDisplayKitchen(kitchens: DiscoverKitchenLike[]): DiscoverKitchenLike {
  return (
    kitchens.find((k) => !!k.imageUrl) ||
    kitchens.find((k) => k.canAcceptBookings) ||
    kitchens[0]
  );
}

/** Group a flat kitchen list into one card model per location (input order preserved). */
export function groupKitchensByLocation(
  kitchens: DiscoverKitchenLike[]
): DiscoverLocationCard[] {
  const order: number[] = [];
  const byLocation = new Map<number, DiscoverKitchenLike[]>();

  for (const kitchen of kitchens) {
    const existing = byLocation.get(kitchen.locationId);
    if (existing) {
      existing.push(kitchen);
    } else {
      byLocation.set(kitchen.locationId, [kitchen]);
      order.push(kitchen.locationId);
    }
  }

  return order.map((locationId) => {
    const group = byLocation.get(locationId)!;
    const displayKitchen = pickDisplayKitchen(group);
    const rates = group
      .map((k) => k.hourlyRate)
      .filter((rate): rate is number => rate != null && rate > 0);
    const hourlyRate =
      rates.length > 0 ? Math.min(...rates) : displayKitchen.hourlyRate ?? null;

    return {
      locationId,
      locationName: displayKitchen.locationName,
      locationSlug: displayKitchen.locationSlug,
      address: displayKitchen.address,
      kitchens: group,
      displayKitchen,
      kitchenCount: group.length,
      canAcceptBookings: group.some((k) => k.canAcceptBookings),
      hourlyRate,
      equipment: mergeEquipmentLists(group.map((k) => k.equipment)),
      storageSummary: mergeStorageSummaries(group.map((k) => k.storageSummary)),
    };
  });
}

/** Preview path for a location (slug preferred). */
export function kitchenPreviewPath(locationId: number, locationSlug?: string | null): string {
  return `/kitchen-preview/${locationSlug || locationId}`;
}
