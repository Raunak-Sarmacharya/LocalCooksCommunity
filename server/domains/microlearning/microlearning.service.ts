
import { MicrolearningRepository } from "./microlearning.repository";
import { UpdateVideoProgressDTO, InsertMicrolearningCompletion } from "./microlearning.types";

export class MicrolearningService {
    private repo: MicrolearningRepository;

    constructor(repo?: MicrolearningRepository) {
        this.repo = repo || new MicrolearningRepository();
    }

    async getUserProgress(userId: number) {
        return this.repo.getProgress(userId);
    }

    async getUserCompletion(userId: number) {
        return this.repo.getCompletion(userId);
    }

    async updateVideoProgress(data: UpdateVideoProgressDTO) {
        return this.repo.upsertVideoProgress({
            userId: data.userId,
            videoId: data.videoId,
            progress: String(data.progress),
            completed: data.completed,
            watchedPercentage: String(data.watchedPercentage),
            isRewatching: data.isRewatching ?? false,
            updatedAt: new Date(),
            completedAt: data.completedAt || null
        });
    }

    async completeMicrolearning(data: InsertMicrolearningCompletion) {
        return this.repo.createCompletion(data);
    }
}

export const microlearningService = new MicrolearningService();
