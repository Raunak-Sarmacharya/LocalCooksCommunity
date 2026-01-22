
import { db } from "../../db";
import {
    videoProgress,
    microlearningCompletions
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { InsertVideoProgress, InsertMicrolearningCompletion } from "./microlearning.types";

export class MicrolearningRepository {
    async getProgress(userId: number) {
        return db
            .select()
            .from(videoProgress)
            .where(eq(videoProgress.userId, userId))
            .orderBy(desc(videoProgress.updatedAt));
    }

    async getCompletion(userId: number) {
        const [completion] = await db
            .select()
            .from(microlearningCompletions)
            .where(eq(microlearningCompletions.userId, userId));
        return completion || null;
    }

    async upsertVideoProgress(data: InsertVideoProgress) {
        // Safe cast for conflict target inference
        return db
            .insert(videoProgress)
            .values(data)
            .onConflictDoUpdate({
                target: [videoProgress.userId, videoProgress.videoId],
                set: {
                    progress: data.progress,
                    completed: data.completed,
                    watchedPercentage: data.watchedPercentage,
                    isRewatching: data.isRewatching,
                    updatedAt: new Date(),
                    // Update completedAt if it's provided in the new data
                    ...(data.completedAt ? { completedAt: data.completedAt } : {})
                },
            });
    }

    async createCompletion(data: InsertMicrolearningCompletion) {
        const [completion] = await db
            .insert(microlearningCompletions)
            .values(data)
            .returning();
        return completion;
    }
}
