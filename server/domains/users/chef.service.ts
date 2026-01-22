
import { ChefRepository } from "./chef.repository";
import { userService } from "./user.service";
import { locationService } from "../locations/location.service";
import { applicationService } from "../applications/application.service";
import { db } from "../../db";
import { applications, locations } from "@shared/schema";
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

    async getApplicationStatusForBooking(chefId: number, locationId: number) {
        // Simplified check: if profile is approved, allow booking.
        // TODO: Add refined checks for documents/requirements if needed.
        const profile = await this.getProfile(chefId, locationId);

        if (!profile) {
            return {
                hasApplication: false,
                status: null,
                canBook: false,
                message: 'You must share your profile with this location before booking.',
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
                status: 'pending', // or inReview
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
