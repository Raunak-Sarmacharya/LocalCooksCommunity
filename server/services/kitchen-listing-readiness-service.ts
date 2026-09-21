/**
 * Gathers everything a kitchen's publish review needs, from real data.
 *
 * The decision itself lives in `@shared/kitchen-listing-readiness` — this only collects the inputs and
 * hands back the values the review screen shows, so a manager can see what is already configured and
 * not just what is missing.
 *
 * Deliberately one round trip per concern rather than a clever join: a kitchen has a handful of
 * children, and the licence, the Stripe account and the requirements all hang off the LOCATION, so
 * they are fetched once rather than per kitchen.
 */
import { eq } from "drizzle-orm";

import { db } from "../db";
import {
  equipmentListings,
  kitchens,
  kitchenViewingSettings,
  locationRequirements,
  storageListings,
  users,
} from "@shared/schema";
import { licenseAllowsBookings } from "@shared/kitchen-license";
import {
  buildListingChecklist,
  type ListingChecklist,
  type ListingReadinessInput,
} from "@shared/kitchen-listing-readiness";
import { logger } from "../logger";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { locationService } from "../domains/locations/location.service";
import { getAccountStatus } from "./stripe-connect-service";

/** The raw values behind each checklist row, so the review screen can show what is set. */
export interface KitchenReadinessDetails {
  kitchenName: string;
  locationName: string | null;
  description: string | null;
  hourlyRateCents: number | null;
  dailyRateCents: number | null;
  coverPhotoUrl: string | null;
  galleryImageCount: number;
  /** Whole days of the week with opening hours, e.g. `["Mon", "Tue"]` is not built here — a count. */
  availabilityDayCount: number;
  licenseStatus: string;
  stripeAccountId: string | null;
  hasApplicationRequirements: boolean;
  termsUploadedAt: Date | null;
  toursEnabled: boolean;
  /**
   * The booking rules, shown as VALUES rather than as a pass/fail.
   *
   * They cannot be unset — every column is NOT NULL with a default — so the review row exists to let
   * a manager confirm what a chef is agreeing to, not to report a gap.
   */
  cancellationPolicyHours: number;
  dailyBookingLimit: number;
  minimumBookingWindowHours: number;
  minimumBookingHours: number;
}

export interface KitchenReadinessReview {
  checklist: ListingChecklist;
  details: KitchenReadinessDetails;
  /** The state the kitchen is in right now, independent of readiness. */
  listingStatus: "draft" | "active";
  /** True when the admin has hidden it — publishing will not make it visible. */
  adminHidden: boolean;
}

function isNonEmptyText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function buildKitchenReadiness(
  kitchenId: number,
): Promise<KitchenReadinessReview | null> {
  const kitchen = await kitchenService.getKitchenById(kitchenId);
  if (!kitchen) return null;

  // The location carries the licence, the terms and the manager, so everything below leans on it.
  const location = kitchen.locationId
    ? await locationService.getLocationById(kitchen.locationId).catch(() => null)
    : null;

  const [availability, requirementsRow, viewingSettings, equipmentRows, storageRows] =
    await Promise.all([
    kitchenService.getKitchenAvailability(kitchenId).catch(() => []),
    location
      ? db
          .select({ id: locationRequirements.id })
          .from(locationRequirements)
          .where(eq(locationRequirements.locationId, location.id))
          .limit(1)
      : Promise.resolve([]),
      db
        .select({ isActive: kitchenViewingSettings.isActive })
        .from(kitchenViewingSettings)
        .where(eq(kitchenViewingSettings.kitchenId, kitchenId))
        .limit(1),
      // Add-ons a chef can buy alongside the kitchen. Suggestions only: neither is required.
      db
        .select({ id: equipmentListings.id })
        .from(equipmentListings)
        .where(eq(equipmentListings.kitchenId, kitchenId)),
      db
        .select({ id: storageListings.id })
        .from(storageListings)
        .where(eq(storageListings.kitchenId, kitchenId)),
    ]);

  const availabilityDayCount = (availability ?? []).filter(
    (row: { isAvailable?: boolean }) => row.isAvailable !== false,
  ).length;

  /**
   * Stripe readiness is the manager's, not the kitchen's — one connected account covers every
   * location they run. `getAccountStatus` calls Stripe, so a failure (no key, network, a deleted
   * account) must read as "not connected" rather than breaking the whole review.
   */
  let stripeAccountId: string | null = null;
  let stripeConnected = false;
  if (location?.managerId) {
    const [manager] = await db
      .select({ stripeConnectAccountId: users.stripeConnectAccountId })
      .from(users)
      .where(eq(users.id, location.managerId))
      .limit(1);

    stripeAccountId = manager?.stripeConnectAccountId ?? null;

    if (stripeAccountId) {
      try {
        const status = await getAccountStatus(stripeAccountId);
        stripeConnected = Boolean(status.chargesEnabled && status.payoutsEnabled);
      } catch (error) {
        logger.error("[ListingReadiness] Could not read Stripe account status:", error);
        stripeConnected = false;
      }
    }
  }

  const galleryImages = Array.isArray(kitchen.galleryImages) ? kitchen.galleryImages : [];
  const hourlyRateCents = positiveNumber(kitchen.hourlyRate);
  const dailyRateCents = positiveNumber(kitchen.dailyRate);

  const input: ListingReadinessInput = {
    hasDescription: isNonEmptyText(kitchen.description),
    hasRate: hourlyRateCents !== null || dailyRateCents !== null,
    licenseApproved: location ? licenseAllowsBookings(location) : false,
    hasAvailability: availabilityDayCount > 0,
    hasCoverPhoto: isNonEmptyText(kitchen.imageUrl),
    stripeConnected,
    hasApplicationRequirements: requirementsRow.length > 0,
    hasGalleryImages: galleryImages.length > 0,
    hasTerms: isNonEmptyText(location?.kitchenTermsUrl),
    toursEnabled: Boolean(viewingSettings[0]?.isActive),
    /**
     * Booking rules cannot be unset — `cancellation_policy_hours`, `default_daily_booking_limit` and
     * `minimum_booking_window_hours` are all NOT NULL with defaults, and so is the kitchen's minimum
     * duration. It stays on the list because the review screen should show the manager these values
     * and where to change them; it will simply always read as done.
     */
    hasBookingRules: true,
    hasEquipment: equipmentRows.length > 0,
    hasStorage: storageRows.length > 0,
  };

  return {
    checklist: buildListingChecklist(input),
    details: {
      kitchenName: kitchen.name,
      locationName: location?.name ?? null,
      description: kitchen.description ?? null,
      hourlyRateCents,
      dailyRateCents,
      coverPhotoUrl: kitchen.imageUrl ?? null,
      galleryImageCount: galleryImages.length,
      availabilityDayCount,
      licenseStatus: location?.kitchenLicenseStatus ?? "not_uploaded",
      stripeAccountId,
      hasApplicationRequirements: requirementsRow.length > 0,
      termsUploadedAt: location?.kitchenTermsUploadedAt ?? null,
      toursEnabled: Boolean(viewingSettings[0]?.isActive),
      cancellationPolicyHours: location?.cancellationPolicyHours ?? 24,
      dailyBookingLimit: location?.defaultDailyBookingLimit ?? 2,
      minimumBookingWindowHours: location?.minimumBookingWindowHours ?? 1,
      minimumBookingHours: kitchen.minimumBookingHours ?? 1,
    },
    listingStatus: kitchen.listingStatus === "active" ? "active" : "draft",
    adminHidden: kitchen.isActive === false,
  };
}
