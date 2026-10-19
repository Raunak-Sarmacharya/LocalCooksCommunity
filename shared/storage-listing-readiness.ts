export interface StorageListingEssentials {
  status?: string | null;
  name?: string | null;
  storageType?: string | null;
  basePrice?: string | number | null;
  unitCount?: number | null;
  maxTermDays?: number | null;
  isActive?: boolean | null;
}

export interface StorageInstructions {
  storageCheckinInstructions?: string | null;
  storageCheckoutInstructions?: string | null;
}

export type StorageMissingItem = "name" | "type" | "price" | "units" | "maxDays" | "moveIn" | "moveOut";

/** A null term cap uses the platform maximum, just as the listing form does. */
export function storageListingReadiness(listing: StorageListingEssentials, instructions?: StorageInstructions | null) {
  const missing: StorageMissingItem[] = [];
  if (!listing.name?.trim()) missing.push("name");
  if (!listing.storageType?.trim()) missing.push("type");
  if (!Number.isFinite(Number(listing.basePrice)) || Number(listing.basePrice) <= 0) missing.push("price");
  if (!Number.isInteger(listing.unitCount) || Number(listing.unitCount) < 1) missing.push("units");
  if (listing.maxTermDays != null && (!Number.isInteger(listing.maxTermDays) || listing.maxTermDays < 1)) missing.push("maxDays");
  if (!instructions?.storageCheckinInstructions?.trim()) missing.push("moveIn");
  if (!instructions?.storageCheckoutInstructions?.trim()) missing.push("moveOut");
  const ready = missing.length === 0;
  return { ready, missing, visible: listing.isActive === true && ready,
    status: !ready || listing.status === "draft" && listing.isActive !== true ? "draft" as const : listing.isActive === true ? "listed" as const : "paused" as const };
}
