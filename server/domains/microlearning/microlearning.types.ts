
import {
    videoProgress,
    microlearningCompletions
} from "@shared/schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export type VideoProgress = typeof videoProgress.$inferSelect;
export type InsertVideoProgress = typeof videoProgress.$inferInsert;

export type MicrolearningCompletion = typeof microlearningCompletions.$inferSelect;
export type InsertMicrolearningCompletion = typeof microlearningCompletions.$inferInsert;

export const createVideoProgressSchema = createInsertSchema(videoProgress);
export const createMicrolearningCompletionSchema = createInsertSchema(microlearningCompletions);

export type UpdateVideoProgressDTO = {
    userId: number;
    videoId: string;
    progress: number;
    completed: boolean;
    watchedPercentage: number;
    isRewatching?: boolean;
    completedAt?: Date | null;
};
