/**
 * Chef Application Service
 * 
 * Business logic layer for chef kitchen applications.
 * Handles application submission, status updates, and retrieval.
 */

import { db } from "../../db";
import { chefKitchenApplications, locations, users, chefLocationAccess, type ChefKitchenApplication, type InsertChefKitchenApplication } from "@shared/schema";
import { eq, and, desc, inArray, getTableColumns } from "drizzle-orm";

export class ChefApplicationService {
    /**
     * Get all applications for a specific location (Manager view)
     */
    async getApplicationsByLocation(locationId: number) {
        try {
            return await db
                .select({
                    ...getTableColumns(chefKitchenApplications),
                    chef: {
                        id: users.id,
                        username: users.username,
                        role: users.role,
                        // Not selecting fullName/email if not guaranteed on users table
                    }
                })
                .from(chefKitchenApplications)
                .leftJoin(users, eq(chefKitchenApplications.chefId, users.id))
                .where(eq(chefKitchenApplications.locationId, locationId))
                .orderBy(desc(chefKitchenApplications.createdAt));
        } catch (error) {
            console.error("[ChefApplicationService] Error fetching applications by location:", error);
            throw error;
        }
    }

    /**
     * Get applications for a specific chef (Chef view)
     */
    async getChefApplications(chefId: number) {
        try {
            const apps = await db
                .select({
                    ...getTableColumns(chefKitchenApplications),
                    location: {
                        id: locations.id,
                        name: locations.name,
                        address: locations.address,
                        managerId: locations.managerId,
                        // city not explicitly in schema snippet I saw, omit to be safe or check if needed
                    }
                })
                .from(chefKitchenApplications)
                .leftJoin(locations, eq(chefKitchenApplications.locationId, locations.id))
                .where(eq(chefKitchenApplications.chefId, chefId))
                .orderBy(desc(chefKitchenApplications.createdAt));

            // Format to match expected frontend structure (flattening location)
            // AND ensure we return the `location` object itself as expected by KitchenApplicationWithLocation
            return apps.map(app => ({
                ...app,
                locationName: app.location?.name,
                locationAddress: app.location?.address,
                location: app.location // Ensure full location object is passed
            }));
        } catch (error) {
            console.error("[ChefApplicationService] Error fetching chef applications:", error);
            throw error;
        }
    }

    /**
     * Update application status
     */
    async updateApplicationStatus(applicationId: number, status: "inReview" | "approved" | "rejected" | "cancelled", feedback?: string, reviewedBy?: number) {
        try {
            const [updatedApp] = await db
                .update(chefKitchenApplications)
                .set({
                    status,
                    feedback,
                    reviewedBy,
                    reviewedAt: new Date(),
                    updatedAt: new Date()
                })
                .where(eq(chefKitchenApplications.id, applicationId))
                .returning();

            return updatedApp;
        } catch (error) {
            console.error("[ChefApplicationService] Error updating application status:", error);
            throw error;
        }
    }

    /**
     * Grant location access to a chef
     */
    async grantLocationAccess(chefId: number, locationId: number, grantedBy: number) {
        try {
            // Check if access already exists
            const existingAccess = await db
                .select()
                .from(chefLocationAccess)
                .where(and(
                    eq(chefLocationAccess.chefId, chefId),
                    eq(chefLocationAccess.locationId, locationId)
                ))
                .limit(1);

            if (existingAccess.length > 0) {
                return existingAccess[0];
            }

            const [newAccess] = await db
                .insert(chefLocationAccess)
                .values({
                    chefId,
                    locationId,
                    grantedBy,
                })
                .returning();

            return newAccess;
        } catch (error) {
            console.error("[ChefApplicationService] Error granting location access:", error);
            // Don't throw if it's just a duplicate key error we missed
            if ((error as any).code === '23505') return null;
            throw error;
        }
    }

    /**
     * Get a specific application for a chef at a location
     */
    async getChefApplication(chefId: number, locationId: number) {
        try {
            const [application] = await db
                .select()
                .from(chefKitchenApplications)
                .where(and(
                    eq(chefKitchenApplications.chefId, chefId),
                    eq(chefKitchenApplications.locationId, locationId)
                ))
                .limit(1);

            return application;
        } catch (error) {
            console.error("[ChefApplicationService] Error fetching chef application:", error);
            throw error;
        }
    }

    /**
     * Get all applications for a manager across their locations
     */
    async getApplicationsForManager(managerId: number) {
        try {
            // First get locations managed by this user
            const managedLocations = await db
                .select({ id: locations.id })
                .from(locations)
                .where(eq(locations.managerId, managerId));

            if (managedLocations.length === 0) return [];

            const locationIds = managedLocations.map(l => l.id);

            return await db
                .select({
                    ...getTableColumns(chefKitchenApplications),
                    chef: {
                        id: users.id,
                        username: users.username,
                        role: users.role,
                        // Using safe fields
                    },
                    location: {
                        id: locations.id,
                        name: locations.name,
                        address: locations.address
                    }
                })
                .from(chefKitchenApplications)
                .leftJoin(users, eq(chefKitchenApplications.chefId, users.id))
                .leftJoin(locations, eq(chefKitchenApplications.locationId, locations.id))
                .where(inArray(chefKitchenApplications.locationId, locationIds))
                .orderBy(desc(chefKitchenApplications.createdAt));
        } catch (error) {
            console.error("[ChefApplicationService] Error fetching manager applications:", error);
            throw error;
        }
    }

    /**
     * Get approved kitchens for a chef
     */
    async getApprovedKitchens(chefId: number) {
        try {
            const approvedApps = await db
                .select({
                    applicationId: chefKitchenApplications.id,
                    locationId: chefKitchenApplications.locationId,
                    approvedAt: chefKitchenApplications.updatedAt,
                    location: {
                        id: locations.id,
                        name: locations.name,
                        address: locations.address,
                        logoUrl: locations.logoUrl,
                        brandImageUrl: locations.brandImageUrl,
                        managerId: locations.managerId
                    }
                })
                .from(chefKitchenApplications)
                .leftJoin(locations, eq(chefKitchenApplications.locationId, locations.id))
                .where(and(
                    eq(chefKitchenApplications.chefId, chefId),
                    eq(chefKitchenApplications.status, 'approved')
                ));

            // Transform to flat structure matching frontend expectations
            return approvedApps
                .filter(app => app.location)
                .map(app => ({
                    id: app.location!.id,
                    name: app.location!.name,
                    address: app.location!.address,
                    logoUrl: app.location!.logoUrl,
                    brandImageUrl: app.location!.brandImageUrl,
                    applicationId: app.applicationId,
                    approvedAt: app.approvedAt,
                    locationId: app.locationId,
                    managerId: app.location!.managerId
                }));
        } catch (error) {
            console.error("[ChefApplicationService] Error fetching approved kitchens:", error);
            throw error;
        }
    }

    /**
     * Get detailed status for kitchen access/application
     */
    async getApplicationStatus(chefId: number, locationId: number) {
        try {
            const application = await this.getChefApplication(chefId, locationId);

            if (!application) {
                return {
                    hasApplication: false,
                    status: null,
                    canBook: false,
                    message: 'You must apply to this kitchen before booking. Please submit an application first.',
                };
            }

            // Enterprise 3-Tier System: canBook = Tier 3 (current_tier >= 3)
            const currentTier = (application as any).current_tier ?? 1;
            const isFullyApproved = currentTier >= 3;

            switch (application.status) {
                case 'approved':
                    return {
                        hasApplication: true,
                        status: isFullyApproved ? 'approved' : 'inReview',
                        canBook: isFullyApproved,
                        message: isFullyApproved
                            ? 'Application completed. You can book kitchens at this location.'
                            : 'Application approved but not fully complete. Please complete all steps to book.',
                    };
                case 'inReview':
                    return {
                        hasApplication: true,
                        status: 'inReview',
                        canBook: false,
                        message: 'Your application is pending manager review. Please wait for approval before booking.',
                    };
                case 'rejected':
                    return {
                        hasApplication: true,
                        status: 'rejected',
                        canBook: false,
                        message: 'Your application was rejected. You can re-apply with updated documents.',
                    };
                case 'cancelled':
                    return {
                        hasApplication: true,
                        status: 'cancelled',
                        canBook: false,
                        message: 'Your application was cancelled. You can submit a new application.',
                    };
                default:
                    return {
                        hasApplication: true,
                        status: application.status,
                        canBook: false,
                        message: 'Unknown application status. Please contact support.',
                    };
            }
        } catch (error) {
            console.error("[ChefApplicationService] Error checking application status:", error);
            return {
                hasApplication: false,
                status: null,
                canBook: false,
                message: 'Error checking application status. Please try again.',
            };
        }
    }

    /**
     * Create or update chef kitchen application (resubmission support)
     */
    async createApplication(data: InsertChefKitchenApplication): Promise<ChefKitchenApplication> {
        try {
            // Check for existing application to handle resubmission
            const [existing] = await db
                .select()
                .from(chefKitchenApplications)
                .where(
                    and(
                        eq(chefKitchenApplications.chefId, data.chefId),
                        eq(chefKitchenApplications.locationId, data.locationId)
                    )
                )
                .limit(1);

            if (existing) {
                // If existing application is rejected or cancelled, allow resubmission
                const [updated] = await db
                    .update(chefKitchenApplications)
                    .set({
                        ...(data as any),
                        status: 'inReview', // Reset status on resubmission
                        feedback: null, // Clear old feedback
                        updatedAt: new Date()
                    })
                    .where(eq(chefKitchenApplications.id, existing.id))
                    .returning();
                return updated as ChefKitchenApplication;
            }

            // Create new application
            const [created] = await db
                .insert(chefKitchenApplications)
                .values({
                    ...(data as any),
                    status: 'inReview',
                    createdAt: new Date(),
                    updatedAt: new Date()
                })
                .returning();
            return created as ChefKitchenApplication;
        } catch (error) {
            console.error("[ChefApplicationService] Error creating/updating application:", error);
            throw error;
        }
    }

    /**
     * Cancel application (Chef side)
     */
    async cancelApplication(applicationId: number, chefId: number): Promise<ChefKitchenApplication> {
        try {
            const [application] = await db
                .select()
                .from(chefKitchenApplications)
                .where(and(
                    eq(chefKitchenApplications.id, applicationId),
                    eq(chefKitchenApplications.chefId, chefId)
                ))
                .limit(1);

            if (!application) {
                throw new Error("Application not found or unauthorized");
            }

            const [cancelled] = await db
                .update(chefKitchenApplications)
                .set({
                    status: 'cancelled',
                    updatedAt: new Date()
                })
                .where(eq(chefKitchenApplications.id, applicationId))
                .returning();

            return cancelled as ChefKitchenApplication;
        } catch (error) {
            console.error("[ChefApplicationService] Error cancelling application:", error);
            throw error;
        }
    }

    /**
     * Update application documents
     */
    async updateApplicationDocuments(data: { id: number, foodSafetyLicenseUrl?: string, foodEstablishmentCertUrl?: string }): Promise<ChefKitchenApplication> {
        try {
            const [updated] = await db
                .update(chefKitchenApplications)
                .set({
                    ...((data.foodSafetyLicenseUrl) && { foodSafetyLicenseUrl: data.foodSafetyLicenseUrl }),
                    ...((data.foodEstablishmentCertUrl) && { foodEstablishmentCertUrl: data.foodEstablishmentCertUrl }),
                    updatedAt: new Date()
                })
                .where(eq(chefKitchenApplications.id, data.id))
                .returning();

            if (!updated) {
                throw new Error("Application not found");
            }

            return updated as ChefKitchenApplication;
        } catch (error) {
            console.error("[ChefApplicationService] Error updating application documents:", error);
            throw error;
        }
    }

    /**
     * Get application by ID
     */
    async getApplicationById(applicationId: number): Promise<ChefKitchenApplication | undefined> {
        try {
            const [application] = await db
                .select()
                .from(chefKitchenApplications)
                .where(eq(chefKitchenApplications.id, applicationId))
                .limit(1);
            return application as ChefKitchenApplication | undefined;
        } catch (error) {
            console.error("[ChefApplicationService] Error getting application by ID:", error);
            throw error;
        }
    }

    /**
     * Update application tier
     */
    async updateApplicationTier(applicationId: number, newTier: number, tierData?: Record<string, any>): Promise<ChefKitchenApplication | undefined> {
        try {
            const current = await this.getApplicationById(applicationId);
            if (!current) {
                throw new Error("Application not found");
            }

            const now = new Date();
            const setData: any = {
                current_tier: newTier,
                updatedAt: now,
            };

            // Set tier completion timestamps (logic from storage-firebase)
            if (newTier >= 2 && !current.tier1_completed_at) {
                setData.tier1_completed_at = now;
            }
            if (newTier >= 3 && !current.tier2_completed_at) {
                setData.tier2_completed_at = now;
            }
            if (newTier === 3 && !current.tier3_submitted_at) {
                setData.tier3_submitted_at = now;
            }
            if (newTier >= 4 && !current.tier4_completed_at) {
                setData.tier4_completed_at = now;
            }

            if (tierData !== undefined) {
                setData.tier_data = tierData;
            }

            const [updated] = await db
                .update(chefKitchenApplications)
                .set(setData)
                .where(eq(chefKitchenApplications.id, applicationId))
                .returning();

            return updated as ChefKitchenApplication | undefined;
        } catch (error) {
            console.error("[ChefApplicationService] Error updating application tier:", error);
            throw error;
        }
    }
}

export const chefApplicationService = new ChefApplicationService();
