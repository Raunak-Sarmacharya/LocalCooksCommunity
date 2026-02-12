
import { db } from "../../db";
import {
    videoProgress,
    microlearningCompletions
} from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
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
        // CRITICAL: Never downgrade completed from true→false.
        // Race condition: onProgress fires with completed=false right before/after
        // onComplete fires with completed=true — the last write wins in the DB.
        // Use SQL GREATEST/OR to ensure completed stays true once set.
        return db
            .insert(videoProgress)
            .values(data)
            .onConflictDoUpdate({
                target: [videoProgress.userId, videoProgress.videoId],
                set: {
                    progress: data.completed
                        ? data.progress
                        : sql`GREATEST(${videoProgress.progress}, ${data.progress})`,
                    completed: data.completed
                        ? sql`true`
                        : sql`${videoProgress.completed}`,
                    watchedPercentage: sql`GREATEST(${videoProgress.watchedPercentage}, ${data.watchedPercentage})`,
                    isRewatching: data.isRewatching,
                    updatedAt: new Date(),
                    completedAt: data.completedAt
                        ? data.completedAt
                        : sql`${videoProgress.completedAt}`,
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
