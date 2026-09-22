import { logger } from "../../logger";

import { ChefRepository } from "./chef.repository";
import { userService } from "./user.service";
import { locationService } from "../locations/location.service";
import { applicationService } from "../applications/application.service";
import { db } from "../../db";
import { applications, locations, kitchens, chefLocationAccess, chefKitchenApplications } from "@shared/schema";
import { licenseAllowsBookings } from "@shared/kitchen-license";
import { eq, and, asc, desc } from "drizzle-orm";

export class ChefService {
    constructor(private repo: ChefRepository) { }

    // ===== Access Management =====

    async grantLocationAccess(chefId: number, locationId: number, grantedBy: number) {
        return this.repo.grantLocationAccess(chefId, locationId, grantedBy);
    }

    async revokeLocationAccess(chefId: number, locationId: number) {
        return this.repo.revokeLocationAccess(chefId, locationId);
    }

    async getLocationAccess(chefId: number) {
        return this.repo.getLocationAccess(chefId);
    }

    async hasLocationAccess(chefId: number, locationId: number) {
        return this.repo.hasLocationAccess(chefId, locationId);
    }

    // ===== Profile Management =====

    async shareProfileWithLocation(chefId: number, locationId: number) {
        const existing = await this.repo.findProfile(chefId, locationId);

        if (existing) {
            if (existing.status === 'rejected') {
                return this.repo.updateProfile(existing.id, {
                    status: 'pending',
                    sharedAt: new Date(),
                    reviewedBy: null,
                    reviewedAt: null,
                    reviewFeedback: null,
                });
            }
            return existing;
        }

        return this.repo.createProfile(chefId, locationId);
    }

    async getProfile(chefId: number, locationId: number) {
        return this.repo.findProfile(chefId, locationId);
    }

    async getChefProfiles(chefId: number) {
        return this.repo.getProfilesByChefId(chefId);
    }

    async updateProfileStatus(profileId: number, status: 'approved' | 'rejected', reviewedBy: number, feedback?: string) {
        return this.repo.updateProfile(profileId, {
            status,
            reviewedBy,
            reviewedAt: new Date(),
            reviewFeedback: feedback || null,
        });
    }

    /**
     * Whether this chef may create a booking for this kitchen.
     *
     * Three independent things must all hold: the chef's own access, the kitchen still being
     * LISTED by its manager, and the location's kitchen licence still being valid. They are
     * combined here because this is the one choke point both chef booking routes already pass
     * through — a check written separately into each route is exactly how one of them ends up
     * missing it.
     *
     * Airbnb's rule for a lapsed licence is "You cannot host a reservation without valid
     * license(s)", and its rule for an unlisted space is that confirmed reservations are still
     * honoured. Only NEW bookings are refused: bookings that already exist are left alone, so a
     * chef who is already confirmed is never stranded by the manager's paperwork or by a listing
     * the manager has paused.
     *
     * The listing check is why this takes a `kitchenId` rather than only a location: a manager
     * takes a listing down per KITCHEN, and a location with three kitchens can have one paused
     * and two live. It is the server-side half of the UI state — without it, a chef whose booking
     * page was already open when the manager pressed "take off the listing" could still complete
     * checkout, because nothing on the page is re-read at submit time.
     */
    async getApplicationStatusForBooking(chefId: number, locationId: number, kitchenId: number) {
        const status = await this.resolveApplicationAccess(chefId, locationId);
        if (!status.canBook) return status;

        const [kitchen] = await db
            .select({ listingStatus: kitchens.listingStatus })
            .from(kitchens)
            .where(eq(kitchens.id, kitchenId))
            .limit(1);

        if (!kitchen || kitchen.listingStatus !== 'active') {
            logger.info(
                `[Booking] Refused a new booking: chef ${chefId} is approved for location ` +
                    `${locationId}, but kitchen ${kitchenId} is not listed by its manager.`,
            );
            return {
                hasApplication: true,
                status: 'listing_unavailable',
                canBook: false,
                // Same sentence the licence branch uses, deliberately: from the chef's side both
                // are "the kitchen is not taking bookings", and the reassurance that existing
                // bookings survive is the part that actually matters to them.
                message:
                    'This kitchen is not accepting bookings right now. Any bookings you already have are unaffected.',
            };
        }

        const [location] = await db
            .select({
                kitchenLicenseUrl: locations.kitchenLicenseUrl,
                kitchenLicenseStatus: locations.kitchenLicenseStatus,
                kitchenLicenseExpiry: locations.kitchenLicenseExpiry,
                kitchenLicensePendingUrl: locations.kitchenLicensePendingUrl,
                kitchenLicensePendingExpiry: locations.kitchenLicensePendingExpiry,
            })
            .from(locations)
            .where(eq(locations.id, locationId))
            .limit(1);

        if (!location || !licenseAllowsBookings(location)) {
            logger.info(
                `[Booking] Refused a new booking: chef ${chefId} is approved for location ` +
                    `${locationId}, but its kitchen licence is not currently valid.`,
            );
            return {
                hasApplication: true,
                status: 'license_invalid',
                canBook: false,
                message:
                    'This kitchen is not accepting bookings right now. Any bookings you already have are unaffected.',
            };
        }

        return status;
    }

    private async resolveApplicationAccess(chefId: number, locationId: number) {
        // Check multiple sources for booking access:
        // 1. chef_location_access table (new tiered application system - Tier 2+)
        // 2. chef_kitchen_applications table (new tiered application system)
        // 3. chef_location_profiles table (legacy profile sharing system)

        // First, check chef_location_access (most authoritative for new system)
        const [accessRecord] = await db
            .select()
            .from(chefLocationAccess)
            .where(
                and(
                    eq(chefLocationAccess.chefId, chefId),
                    eq(chefLocationAccess.locationId, locationId)
                )
            );

        if (accessRecord) {
            return {
                hasApplication: true,
                status: 'approved',
                canBook: true,
                message: 'Application approved. You can book kitchens at this location.',
            };
        }

        // Check chef_kitchen_applications for approved applications at Tier 2+
        const [kitchenApplication] = await db
            .select()
            .from(chefKitchenApplications)
            .where(
                and(
                    eq(chefKitchenApplications.chefId, chefId),
                    eq(chefKitchenApplications.locationId, locationId)
                )
            );

        if (kitchenApplication) {
            // If application is approved and at Tier 2+, grant access
            const currentTier = (kitchenApplication as any).currentTier ?? (kitchenApplication as any).current_tier ?? 1;
            if (kitchenApplication.status === 'approved' && currentTier >= 2) {
                // Auto-create access record for future checks (self-healing)
                try {
                    await db.insert(chefLocationAccess).values({
                        chefId,
                        locationId,
                        grantedBy: kitchenApplication.reviewedBy || chefId,
                        grantedAt: new Date(),
                    }).onConflictDoNothing();
                    logger.info(`✅ Auto-created chef_location_access for chef ${chefId} at location ${locationId}`);
                } catch (err) {
                    logger.error('Error auto-creating chef_location_access:', err);
                }

                return {
                    hasApplication: true,
                    status: 'approved',
                    canBook: true,
                    message: 'Application approved. You can book kitchens at this location.',
                };
            } else if (kitchenApplication.status === 'rejected') {
                return {
                    hasApplication: true,
                    status: 'rejected',
                    canBook: false,
                    message: 'Your application was rejected by the manager.',
                };
            } else {
                return {
                    hasApplication: true,
                    status: kitchenApplication.status || 'pending',
                    canBook: false,
                    message: 'Your application is pending manager review or requires additional steps.',
                };
            }
        }

        // Fallback: Check legacy chef_location_profiles table
        const profile = await this.getProfile(chefId, locationId);

        if (!profile) {
            return {
                hasApplication: false,
                status: null,
                canBook: false,
                message: 'You must apply to this location before booking.',
            };
        }

        if (profile.status === 'approved') {
            return {
                hasApplication: true,
                status: 'approved',
                canBook: true,
                message: 'Application approved. You can book kitchens at this location.',
            };
        } else if (profile.status === 'rejected') {
            return {
                hasApplication: true,
                status: 'rejected',
                canBook: false,
                message: 'Your profile was rejected by the manager.',
            };
        } else {
            return {
                hasApplication: true,
                status: 'pending',
                canBook: false,
                message: 'Your profile is pending manager review.',
            };
        }
    }

    async getChefProfilesForManager(managerId: number) {
        // 1. Get locations managed by this manager
        // Using locationService directly returns DTOs
        const managerLocations = await locationService.getLocationsByManagerId(managerId);

        if (managerLocations.length === 0) {
            return [];
        }

        const locationIds = managerLocations.map(l => l.id);

        // 2. Get profiles for these locations
        const profiles = await this.repo.getProfilesForManager(locationIds);

        // 3. Enrich data
        const enrichedProfiles = await Promise.all(
            profiles.map(async (profile) => {
                const chef = await userService.getUser(profile.chefId);
                const location = managerLocations.find(l => l.id === profile.locationId);

                // Get application (TODO: Add method to ApplicationService/Repo to get latest approved app efficiently)
                // For now, doing a direct DB query for efficiency or using existing service methods
                // applicationService.getApplicationsByUserId returns array.
                const apps = await applicationService.getApplicationsByUserId(profile.chefId);
                const approvedApps = apps.filter(a => a.status === 'approved').sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                const latestApp = approvedApps.length > 0 ? approvedApps[approvedApps.length - 1] : null;

                return {
                    ...profile,
                    chef: chef ? {
                        id: chef.id,
                        username: chef.username,
                    } : null,
                    location: location ? {
                        id: location.id,
                        name: location.name,
                        address: location.address,
                    } : null,
                    application: latestApp ? {
                        id: latestApp.id,
                        fullName: latestApp.fullName,
                        email: latestApp.email,
                        phone: latestApp.phone,
                        foodSafetyLicenseUrl: latestApp.foodSafetyLicenseUrl,
                        foodEstablishmentCertUrl: latestApp.foodEstablishmentCertUrl,
                    } : null,
                };
            })
        );

        return enrichedProfiles;
    }
}

export const chefService = new ChefService(new ChefRepository());
