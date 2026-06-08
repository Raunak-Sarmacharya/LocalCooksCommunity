import { db } from "../db";
import { users, applications, chefKitchenApplications } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../logger";

export async function getUserDisplayName(userId: number, role: 'chef' | 'manager' = 'chef'): Promise<string> {
    if (!userId) return role === 'chef' ? 'A chef' : 'Manager';
    try {
        const [user] = await db
            .select({ 
                username: users.username,
                managerProfileData: users.managerProfileData
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) return role === 'chef' ? 'A chef' : 'Manager';

        const profileData = (user.managerProfileData as any) || {};
        if (profileData.displayName) return profileData.displayName;
        if (profileData.fullName) return profileData.fullName;
        
        // For chefs, try their application name
        if (role === 'chef') {
            // Check general applications table
            const [app] = await db
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
            const [kitchenApp] = await db
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
