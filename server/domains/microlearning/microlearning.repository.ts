
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
        // DB may lack unique(user_id, video_id) — select then insert/update.
        // Never downgrade completed from true→false.
        const [existing] = await db
            .select()
            .from(videoProgress)
            .where(and(eq(videoProgress.userId, data.userId), eq(videoProgress.videoId, data.videoId)))
            .limit(1);

        if (!existing) {
            return db.insert(videoProgress).values(data).returning();
        }

        const nextProgress = data.completed
            ? data.progress
            : String(Math.max(Number(existing.progress || 0), Number(data.progress || 0)));
        const nextWatched = String(
            Math.max(Number(existing.watchedPercentage || 0), Number(data.watchedPercentage || 0))
        );
        const nextCompleted = data.completed ? true : Boolean(existing.completed);
        const nextCompletedAt = data.completedAt
            ? data.completedAt
            : existing.completedAt;

        return db
            .update(videoProgress)
            .set({
                progress: nextProgress,
                completed: nextCompleted,
                watchedPercentage: nextWatched,
                isRewatching: data.isRewatching,
                updatedAt: new Date(),
                completedAt: nextCompletedAt,
            })
            .where(eq(videoProgress.id, existing.id))
            .returning();
    }

    async createCompletion(data: InsertMicrolearningCompletion) {
        const [completion] = await db
            .insert(microlearningCompletions)
            .values(data)
            .returning();
        return completion;
    }
}
