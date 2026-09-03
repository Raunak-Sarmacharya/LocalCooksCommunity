/**
 * Pure helpers for FULL01 chunk continuity (no DB).
 * Chunks: A apply → B Step2 → C book → D confirmed+check-in readiness.
 */

export type FullChunkId = "A" | "B" | "C" | "D";

export const FULL_JOURNEY_MARKER_PREFIX = "testsprite-full-";
export const FULL_CHUNK_D_MARKER_PREFIX = "testsprite-full-chunk-d-";

export function isFullJourneyMarker(notes: string | null | undefined): boolean {
  return typeof notes === "string" && notes.startsWith(FULL_JOURNEY_MARKER_PREFIX);
}

/** Prep endpoint that must run before each UI chunk. */
export function prepEndpointForUiChunk(chunk: FullChunkId): string {
  const map: Record<FullChunkId, string> = {
    A: "/api/dev/journey-full-chunk-a-ready",
    B: "/api/dev/journey-full-chunk-b-ready",
    C: "/api/dev/journey-full-chunk-c-ready",
    D: "/api/dev/journey-full-chunk-d-ready",
  };
  return map[chunk];
}

/**
 * Backend-only steps between UI chunks (not TestSprite).
 * After A UI → admin Step1; after B UI → manager tier3; after C UI → manager booking approve.
 */
export function backendBridgeAfterUiChunk(
  chunk: FullChunkId
): "admin-step1" | "manager-tier3" | "manager-booking-approve" | null {
  if (chunk === "A") return "admin-step1";
  if (chunk === "B") return "manager-tier3";
  if (chunk === "C") return "manager-booking-approve";
  return null;
}

export type AppRow = {
  status: string;
  current_tier: number;
  tier1_completed_at: Date | null;
  tier2_completed_at: Date | null;
};

/** Target row after chunk-B prep (Step 2 unlocked, not necessarily submitted). */
export function chunkBApplicationTarget(existing: AppRow | null): {
  status: "approved";
  current_tier: number;
  needsAdminApprove: boolean;
  step2AlreadyDone: boolean;
} {
  if (!existing) {
    return {
      status: "approved",
      current_tier: 1,
      needsAdminApprove: true,
      step2AlreadyDone: false,
    };
  }
  const tier = Math.max(1, Number(existing.current_tier) || 1);
  const step2AlreadyDone = !!existing.tier2_completed_at || tier >= 2;
  const needsAdminApprove =
    existing.status !== "approved" || !existing.tier1_completed_at;
  return {
    status: "approved",
    current_tier: needsAdminApprove ? Math.min(tier, 1) : tier,
    needsAdminApprove,
    step2AlreadyDone,
  };
}

export type BookingPickRow = {
  id: number;
  status: string;
  paymentStatus: string | null;
  specialNotes: string | null;
  referenceCode: string | null;
};

/**
 * Prefer advancing pending+authorized full marker; else reuse confirmed+paid;
 * else signal seed.
 */
export function pickBookingForChunkD(rows: BookingPickRow[]): {
  action: "advance" | "reuse" | "seed";
  booking: BookingPickRow | null;
} {
  const tagged = rows.filter((r) => isFullJourneyMarker(r.specialNotes));
  const advance = tagged.find(
    (r) => r.status === "pending" && r.paymentStatus === "authorized"
  );
  if (advance) return { action: "advance", booking: advance };
  const reuse = tagged.find(
    (r) => r.status === "confirmed" && r.paymentStatus === "paid"
  );
  if (reuse) return { action: "reuse", booking: reuse };
  return { action: "seed", booking: null };
}

/** Check-in window: opens windowMinutesBefore start, closes at end. */
export function isCheckinEligibleNow(opts: {
  nowMs: number;
  startMs: number;
  endMs: number;
  windowMinutesBefore: number;
}): boolean {
  const opens = opts.startMs - opts.windowMinutesBefore * 60_000;
  return opts.nowMs >= opens && opts.nowMs <= opts.endMs;
}
