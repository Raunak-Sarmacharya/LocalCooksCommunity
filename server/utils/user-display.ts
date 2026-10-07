import { db } from "../db";
import { users, applications, chefKitchenApplications } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../logger";

/** Resolve each chef once per response; never use an email as a display label. */
export async function withChefDisplayNames<T extends { chefId?: number | null; chefName?: string | null }>(records: T[]) {
    const ids = Array.from(new Set(records.flatMap(record => record.chefId && (!record.chefName?.trim() || record.chefName.includes("@")) ? [record.chefId] : [])));
    const names = new Map(await Promise.all(ids.map(async id => [id, await getUserDisplayName(id, 'chef')] as const)));
    return records.map(record => ({ ...record, chefName: record.chefName?.trim() && !record.chefName.includes('@') ? record.chefName.trim() : record.chefId ? names.get(record.chefId) || 'A chef' : 'A chef' }));
}

export async function getUserDisplayName(userId: number, role: 'chef' | 'manager' = 'chef', database: Pick<typeof db, 'select'> = db): Promise<string> {
    if (!userId) return role === 'chef' ? 'A chef' : 'Manager';
    try {
        const [user] = await database
            .select({ 
                username: users.username,
                firebaseUid: users.firebaseUid,
                managerProfileData: users.managerProfileData
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) return role === 'chef' ? 'A chef' : 'Manager';

        const profileData = (user.managerProfileData as any) || {};
        if (profileData.displayName) return profileData.displayName;
        if (profileData.fullName) return profileData.fullName;
        // Dashboard greetings use Firebase displayName. Keep tour names in sync
        // when a person set their name there before updating their SQL profile.
        if (user.firebaseUid) {
            try {
                const { initializeFirebaseAdmin } = await import("../firebase-setup");
                const { getAuth } = await import("firebase-admin/auth");
                const app = initializeFirebaseAdmin();
                const name = app && (await getAuth(app).getUser(user.firebaseUid)).displayName?.trim();
                if (name) return name;
            } catch (error) {
                logger.warn("Firebase display name unavailable; using application name", error);
            }
        }
        
        // For chefs, try their application name
        if (role === 'chef') {
            // Check general applications table
            const [app] = await database
                .select({ fullName: applications.fullName })
                .from(applications)
                .where(and(
                    eq(applications.userId, userId),
                    eq(applications.status, 'approved')
                ))
                .orderBy(desc(applications.createdAt))
                .limit(1);
            if (app && app.fullName) return app.fullName;

            // Check chef kitchen applications table as fallback
            const [kitchenApp] = await database
                .select({ fullName: chefKitchenApplications.fullName })
                .from(chefKitchenApplications)
                .where(eq(chefKitchenApplications.chefId, userId))
                .orderBy(desc(chefKitchenApplications.createdAt))
                .limit(1);
            if (kitchenApp && kitchenApp.fullName) return kitchenApp.fullName;
        }

        return user.username.split("@")[0];
    } catch (e) {
        logger.error('Error fetching user display name:', e);
        return role === 'chef' ? 'A chef' : 'Manager';
    }
}
