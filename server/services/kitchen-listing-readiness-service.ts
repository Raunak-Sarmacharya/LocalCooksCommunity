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
  storageListings,
  users,
  checkinCheckoutChecklists,
} from "@shared/schema";
import { activeChecklist } from "@shared/active-checklist";
import { resolveKitchenTracking } from "@shared/kitchen-tracking";
import { getCheckinSettings } from "./kitchen-checkout-service";
import { hasTrackingNotes } from '@shared/tracking-setup';
import { licenseAllowsBookings } from "@shared/kitchen-license";
import { hasKitchenRate } from "@shared/kitchen-booking-rate";
import {
  buildListingChecklist,
  hasAnyApplicationRequirement,
  type KitchenReadinessReview,
  type ListingReadinessInput,
} from "@shared/kitchen-listing-readiness";
import { logger } from "../logger";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { locationService } from "../domains/locations/location.service";
import { getAccountStatus } from "./stripe-connect-service";

/*
 * `KitchenReadinessDetails` and `KitchenReadinessReview` are NOT declared here any more.
 *
 * They are the payload of the endpoint this service feeds, so they belong to the payload — and the
 * endpoint's consumers are on the CLIENT, which cannot import a server module. Declaring them here
 * meant three client surfaces each re-declared their own idea of the shape, and one of them got it
 * wrong in a way that crashed the dashboard. One declaration, in
 * `@shared/kitchen-listing-readiness`, next to the checklist it wraps.
 */

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

  const [availability, requirements, viewingSettings, equipmentRows, storageRows, checklistRows, visitWindows] =
    await Promise.all([
    kitchenService.getKitchenAvailability(kitchenId).catch(() => []),
    /*
     * The requirements WITH their defaults, through the service that owns them.
     *
     * This used to be a second, partial query (`select { id }`) whose LENGTH was the answer to
     * "is the application configured" — which made an untouched kitchen look unconfigured and
     * blocked its publishing. Reading it through the service is also what keeps this in step
     * with the chef-facing application, which resolves the same defaults at every entry point.
     * A failure reads as `null`, which the rule below treats as "no asks saved".
     */
    location
      ? locationService
          .getLocationRequirementsWithDefaults(location.id)
          .catch(() => null)
      : Promise.resolve(null),
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
      db.select().from(checkinCheckoutChecklists)
        .where(eq(checkinCheckoutChecklists.locationId, kitchen.locationId)).limit(1),
      getCheckinSettings(kitchen.locationId),
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
  const visitChecklist = checklistRows[0] ? activeChecklist(checklistRows[0]) : null;
  const tracking = resolveKitchenTracking(kitchen.checkinCheckoutEnabled, visitChecklist);
  const requiredCount = (items: unknown, photos: unknown) =>
    [items, photos].flatMap(value => Array.isArray(value) ? value : [])
      .filter(item => item?.required !== false).length;

  const input: ListingReadinessInput = {
    hasDescription: isNonEmptyText(kitchen.description),
    // Read off the ROW rather than off the two normalised locals below, so this is the same test the
    // forms run (`hasKitchenRate`) and not a second opinion that can drift from it.
    hasRate: hasKitchenRate(kitchen.hourlyRate, kitchen.dailyRate),
    licenseApproved: location ? licenseAllowsBookings(location) : false,
    hasAvailability: availabilityDayCount > 0,
    hasCoverPhoto: isNonEmptyText(kitchen.imageUrl),
    stripeConnected,
    /*
     * "At least one ask is ON", not "a row exists" — see the field's note in the shared module.
     * `getLocationRequirementsWithDefaults` fills in the platform defaults when nothing is
     * saved, so an untouched kitchen passes on the defaults; only a row with every ask switched
     * off fails.
     */
    hasApplicationRequirements: hasAnyApplicationRequirement(requirements),
    hasVisitSetup: tracking.checkinEnabled && tracking.checkoutEnabled && hasTrackingNotes(visitChecklist),
    hasStorageVisitSetup: visitChecklist?.storageCheckinEnabled === true
      && visitChecklist?.storageCheckoutEnabled === true && hasTrackingNotes(visitChecklist, true),
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
      storageVisitSetup: {
        listingCount: storageRows.length,
        checkinEnabled: visitChecklist?.storageCheckinEnabled === true,
        checkoutEnabled: visitChecklist?.storageCheckoutEnabled === true,
        arrivalNotesSaved: typeof visitChecklist?.storageCheckinInstructions === 'string' && visitChecklist.storageCheckinInstructions.trim().length > 0,
        departureNotesSaved: typeof visitChecklist?.storageCheckoutInstructions === 'string' && visitChecklist.storageCheckoutInstructions.trim().length > 0,
      },
      visitSetup: {
        trackingEnabled: kitchen.checkinCheckoutEnabled === true,
        checkinEnabled: visitChecklist?.checkinEnabled === true,
        checkoutEnabled: visitChecklist?.checkoutEnabled === true,
        arrivalNotesSaved: typeof visitChecklist?.checkinInstructions === 'string' && visitChecklist.checkinInstructions.trim().length > 0,
        departureNotesSaved: typeof visitChecklist?.checkoutInstructions === 'string' && visitChecklist.checkoutInstructions.trim().length > 0,
        arrivalRequirementCount: tracking.checkinEnabled
          ? requiredCount(visitChecklist?.checkinItems, visitChecklist?.checkinPhotoRequirements) : 0,
        departureRequirementCount: tracking.checkoutEnabled
          ? requiredCount(visitChecklist?.checkoutItems, visitChecklist?.checkoutPhotoRequirements) : 0,
        ...visitWindows,
      },
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
      hasApplicationRequirements: hasAnyApplicationRequirement(requirements),
      /*
       * An ISO STRING, not the `Date` the row holds — the shared type describes the WIRE, and
       * `res.json` would have stringified it anyway. Converting here is what makes the declared type
       * true rather than approximately true, so a client reading it cannot call `getTime()` on a
       * string and discover the difference at runtime.
       */
      termsUploadedAt: location?.kitchenTermsUploadedAt
        ? new Date(location.kitchenTermsUploadedAt).toISOString()
        : null,
      toursEnabled: Boolean(viewingSettings[0]?.isActive),
      cancellationPolicyHours: kitchen.cancellationPolicyHours ?? location?.cancellationPolicyHours ?? 24,
      dailyBookingLimit: kitchen.defaultDailyBookingLimit ?? location?.defaultDailyBookingLimit ?? 2,
      minimumBookingWindowHours: kitchen.minimumBookingWindowHours ?? location?.minimumBookingWindowHours ?? 1,
      minimumBookingHours: kitchen.minimumBookingHours ?? 1,
    },
    listingStatus: kitchen.listingStatus === "active" ? "active" : "draft",
    adminHidden: kitchen.isActive === false,
  };
}
