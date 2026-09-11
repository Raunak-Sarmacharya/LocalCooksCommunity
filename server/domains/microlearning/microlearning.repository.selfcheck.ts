/**
 * Minimal check: microlearning upsert works without unique(user_id, video_id).
 * Run: node --import tsx server/domains/microlearning/microlearning.repository.selfcheck.ts
 * (or via API smoke JI-BE-003)
 */
import { MicrolearningRepository } from "./microlearning.repository.ts";

async function main() {
  const repo = new MicrolearningRepository();
  const userId = Number(process.env.SELFCHECK_USER_ID || 119);
  const videoId = `selfcheck-${Date.now()}`;
  await repo.upsertVideoProgress({
    userId,
    videoId,
    progress: "10",
    watchedPercentage: "10",
    completed: false,
    isRewatching: false,
    updatedAt: new Date(),
    completedAt: null,
  } as any);
  await repo.upsertVideoProgress({
    userId,
    videoId,
    progress: "25",
    watchedPercentage: "25",
    completed: false,
    isRewatching: false,
    updatedAt: new Date(),
    completedAt: null,
  } as any);
  const rows = await repo.getProgress(userId);
  const found = rows.find((r) => r.videoId === videoId);
  if (!found || Number(found.progress) < 25) {
    console.error("FAIL progress not upserted", found);
    process.exit(1);
  }
  console.log("PASS microlearning upsert", { id: found.id, progress: found.progress });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
