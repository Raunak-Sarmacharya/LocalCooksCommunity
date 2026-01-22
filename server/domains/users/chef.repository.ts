
import { db } from "../../db";
import {
    chefLocationAccess,
    chefLocationProfiles,
    users,
    locations,
    applications
} from "@shared/schema";
import { eq, and, inArray, asc, desc } from "drizzle-orm";

export class ChefRepository {

    // ===== Access Management =====

    async grantLocationAccess(chefId: number, locationId: number, grantedBy: number) {
        const [access] = await db
            .insert(chefLocationAccess)
            .values({
                chefId,
                locationId,
                grantedBy,
            })
            .onConflictDoNothing()
            .returning();
        return access;
    }

    async revokeLocationAccess(chefId: number, locationId: number) {
        await db
            .delete(chefLocationAccess)
            .where(
                and(
                    eq(chefLocationAccess.chefId, chefId),
                    eq(chefLocationAccess.locationId, locationId)
                )
            );
    }

    async getLocationAccess(chefId: number) {
        return db
            .select()
            .from(chefLocationAccess)
            .where(eq(chefLocationAccess.chefId, chefId));
    }

    async hasLocationAccess(chefId: number, locationId: number): Promise<boolean> {
        const access = await db
            .select()
            .from(chefLocationAccess)
            .where(
                and(
                    eq(chefLocationAccess.chefId, chefId),
                    eq(chefLocationAccess.locationId, locationId)
                )
            )
            .limit(1);
        return access.length > 0;
    }

    // ===== Profile Management =====

    async findProfile(chefId: number, locationId: number) {
        const [profile] = await db
            .select()
            .from(chefLocationProfiles)
            .where(
                and(
                    eq(chefLocationProfiles.chefId, chefId),
                    eq(chefLocationProfiles.locationId, locationId)
                )
            );
        return profile || null;
    }

    async getProfilesByChefId(chefId: number) {
        return db
            .select()
            .from(chefLocationProfiles)
            .where(eq(chefLocationProfiles.chefId, chefId));
    }

    async createProfile(chefId: number, locationId: number) {
        const [profile] = await db
            .insert(chefLocationProfiles)
            .values({
                chefId,
                locationId,
                status: 'pending',
            })
            .returning();
        return profile;
    }

    async updateProfile(id: number, updates: Partial<typeof chefLocationProfiles.$inferInsert>) {
        const [updated] = await db
            .update(chefLocationProfiles)
            .set(updates)
            .where(eq(chefLocationProfiles.id, id))
            .returning();
        return updated || null;
    }

    // Complex query for Manager Dashboard
    async getProfilesForManager(locationIds: number[]) {
        if (locationIds.length === 0) return [];

        const profiles = await db
            .select()
            .from(chefLocationProfiles)
            .where(inArray(chefLocationProfiles.locationId, locationIds));

        // Enriching is complex with current Drizzle setup doing N+1 or big joins.
        // I can do a big join here or let Service handle enrichment.
        // The legacy code did manual enrichment. I will return raw profiles here 
        // and let Service generic helpers enrich them, OR I can do a join here.

        // Let's optimize by fetching related data in bulk in the Service, 
        // or just doing the join here if I can import types easily.
        // For now, returning profiles is safer, Service can fetch Users/Locations.
        return profiles;
    }
}
