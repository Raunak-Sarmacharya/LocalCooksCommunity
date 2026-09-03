import { describe, expect, it } from "vitest";
import { getKitchenDisplayStatus, hasStep2BeenSubmitted } from "./status";

describe("getKitchenDisplayStatus", () => {
  it("shows wait while Step 1 is in review at tier 1", () => {
    const display = getKitchenDisplayStatus({ status: "inReview", current_tier: 1 });
    expect(display.actionKind).toBe("wait");
    expect(display.step).toBe(1);
  });

  it("unlocks Step 2 after admin approval (approved + tier 1)", () => {
    const display = getKitchenDisplayStatus({ status: "approved", current_tier: 1 });
    expect(display.actionKind).toBe("complete-step");
    expect(display.step).toBe(2);
  });

  it("unlocks Step 2 for legacy buggy inReview + tier >= 2", () => {
    const display = getKitchenDisplayStatus({ status: "inReview", current_tier: 2 });
    expect(display.actionKind).toBe("complete-step");
    expect(display.step).toBe(2);
  });

  it("waits after Step 2 is submitted", () => {
    const display = getKitchenDisplayStatus({
      status: "approved",
      current_tier: 2,
      tier2_completed_at: new Date().toISOString(),
    });
    expect(display.actionKind).toBe("wait");
    expect(hasStep2BeenSubmitted({
      status: "approved",
      current_tier: 2,
      tier2_completed_at: new Date().toISOString(),
    })).toBe(true);
  });

  it("enables booking when fully approved at tier 3+", () => {
    const display = getKitchenDisplayStatus({ status: "approved", current_tier: 3 });
    expect(display.actionKind).toBe("book");
  });
});
