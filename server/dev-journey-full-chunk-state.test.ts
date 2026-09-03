import { describe, expect, it } from "vitest";
import {
  backendBridgeAfterUiChunk,
  chunkBApplicationTarget,
  isCheckinEligibleNow,
  isFullJourneyMarker,
  pickBookingForChunkD,
  prepEndpointForUiChunk,
} from "./dev-journey-full-chunk-state";

describe("journey full chunk state machine", () => {
  it("maps UI chunks to prep endpoints and backend bridges", () => {
    expect(prepEndpointForUiChunk("A")).toBe("/api/dev/journey-full-chunk-a-ready");
    expect(prepEndpointForUiChunk("B")).toBe("/api/dev/journey-full-chunk-b-ready");
    expect(prepEndpointForUiChunk("C")).toBe("/api/dev/journey-full-chunk-c-ready");
    expect(prepEndpointForUiChunk("D")).toBe("/api/dev/journey-full-chunk-d-ready");
    expect(backendBridgeAfterUiChunk("A")).toBe("admin-step1");
    expect(backendBridgeAfterUiChunk("B")).toBe("manager-tier3");
    expect(backendBridgeAfterUiChunk("C")).toBe("manager-booking-approve");
    expect(backendBridgeAfterUiChunk("D")).toBe(null);
  });

  it("recognizes full journey markers only", () => {
    expect(isFullJourneyMarker("testsprite-full-1-abc")).toBe(true);
    expect(isFullJourneyMarker("testsprite-full-chunk-d-9")).toBe(true);
    expect(isFullJourneyMarker("testsprite-jd-1")).toBe(false);
    expect(isFullJourneyMarker(null)).toBe(false);
  });

  it("chunk B unlocks Step 2 without inventing tier≥2", () => {
    expect(chunkBApplicationTarget(null)).toMatchObject({
      status: "approved",
      current_tier: 1,
      needsAdminApprove: true,
      step2AlreadyDone: false,
    });
    expect(
      chunkBApplicationTarget({
        status: "inReview",
        current_tier: 1,
        tier1_completed_at: null,
        tier2_completed_at: null,
      })
    ).toMatchObject({ needsAdminApprove: true, current_tier: 1, step2AlreadyDone: false });
    expect(
      chunkBApplicationTarget({
        status: "approved",
        current_tier: 2,
        tier1_completed_at: new Date(),
        tier2_completed_at: new Date(),
      })
    ).toMatchObject({ needsAdminApprove: false, step2AlreadyDone: true });
  });

  it("chunk D prefers advance → reuse → seed", () => {
    expect(
      pickBookingForChunkD([
        {
          id: 1,
          status: "pending",
          paymentStatus: "authorized",
          specialNotes: "testsprite-full-run-1",
          referenceCode: "KB-AAAAAA",
        },
        {
          id: 2,
          status: "confirmed",
          paymentStatus: "paid",
          specialNotes: "testsprite-full-old",
          referenceCode: "KB-BBBBBB",
        },
      ]).action
    ).toBe("advance");

    expect(
      pickBookingForChunkD([
        {
          id: 2,
          status: "confirmed",
          paymentStatus: "paid",
          specialNotes: "testsprite-full-old",
          referenceCode: "KB-BBBBBB",
        },
      ]).action
    ).toBe("reuse");

    expect(pickBookingForChunkD([]).action).toBe("seed");
    expect(
      pickBookingForChunkD([
        {
          id: 3,
          status: "pending",
          paymentStatus: "pending",
          specialNotes: "testsprite-jd-x",
          referenceCode: null,
        },
      ]).action
    ).toBe("seed");
  });

  it("check-in eligibility uses window before start through end", () => {
    const start = Date.parse("2026-09-02T15:00:00Z");
    const end = Date.parse("2026-09-02T17:00:00Z");
    expect(
      isCheckinEligibleNow({
        nowMs: start - 10 * 60_000,
        startMs: start,
        endMs: end,
        windowMinutesBefore: 15,
      })
    ).toBe(true);
    expect(
      isCheckinEligibleNow({
        nowMs: start - 20 * 60_000,
        startMs: start,
        endMs: end,
        windowMinutesBefore: 15,
      })
    ).toBe(false);
    expect(
      isCheckinEligibleNow({
        nowMs: end + 1,
        startMs: start,
        endMs: end,
        windowMinutesBefore: 15,
      })
    ).toBe(false);
  });
});
