import { describe, expect, it } from "vitest";
import { getKitchenDisplayStatus, hasStep2BeenSubmitted } from "./status";

describe("getKitchenDisplayStatus", () => {
  it("shows wait while Step 1 is in review at tier 1", () => {
    const display = getKitchenDisplayStatus({ status: "inReview", current_tier: 1 });
    expect(display.actionKind).toBe("wait");
    expect(display.step).toBe(1);
    expect(display.label).toBe("Awaiting admin review");
  });

  it.each(["new", "pending"])("keeps an existing %s request in progress", (status) => {
    const display = getKitchenDisplayStatus({ status, current_tier: 1 });
    expect(display.actionKind).toBe("wait");
    expect(display.step).toBe(1);
  });

  it("unlocks Step 2 after admin approval (approved + tier 1)", () => {
    const display = getKitchenDisplayStatus({ status: "approved", current_tier: 1 });
    expect(display.actionKind).toBe("complete-step");
    expect(display.step).toBe(2);
    expect(display.label).toBe("Awaiting kitchen documents");
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
    expect(display.label).toBe("Kitchen documents awaiting review");
    expect(hasStep2BeenSubmitted({
      status: "approved",
      current_tier: 2,
      tier2_completed_at: new Date().toISOString(),
    })).toBe(true);
  });

  it("enables booking when fully approved at tier 3+", () => {
    const display = getKitchenDisplayStatus({ status: "approved", current_tier: 3 });
    expect(display.actionKind).toBe("book");
    expect(display.label).toBe("Approved");
  });
});

/**
 * The manager's listing flag, folded into the one decision point.
 *
 * Seven surfaces render an application and each used to decide for itself whether to offer Book,
 * which is how the chef dashboard kept offering it for a delisted kitchen. These lock the contract:
 * the flag changes exactly ONE thing, and an absent flag changes nothing.
 */
describe("getKitchenDisplayStatus — the manager's listing flag", () => {
  const approvedTier3 = { status: "approved", current_tier: 3 } as const;

  it("replaces Book with a paused state when the manager has taken the listing down", () => {
    const display = getKitchenDisplayStatus({ ...approvedTier3, locationListed: false });
    expect(display.actionKind).toBe("wait");
    expect(display.tone).toBe("warning");
    expect(display.label).toBe("Not taking bookings");
    expect(display.listingPaused).toBe(true);
  });

  // The control. Without this the assertion above would also pass on a function that never books
  // anything — an assertion that cannot fail is worthless.
  it("still offers Book when the kitchen is listed", () => {
    const display = getKitchenDisplayStatus({ ...approvedTier3, locationListed: true });
    expect(display.actionKind).toBe("book");
    expect(display.listingPaused).toBeUndefined();
  });

  // Backward compatibility, and the fail-safe: `undefined` means the server did not say (an older
  // payload, or a read that failed). Reading it as "not listed" would pause every kitchen in the app.
  it("behaves exactly as before when the server did not send the flag", () => {
    const display = getKitchenDisplayStatus({ ...approvedTier3 });
    expect(display.actionKind).toBe("book");
    expect(display.listingPaused).toBeUndefined();
  });

  // THE property the user asked for: a delisted kitchen must not disturb progress. Someone
  // mid-application can still finish it and only meets the wall at the point of booking.
  it("leaves Step 2 untouched for a chef who has not finished applying", () => {
    const display = getKitchenDisplayStatus({
      status: "approved",
      current_tier: 1,
      locationListed: false,
    });
    expect(display.actionKind).toBe("complete-step");
    expect(display.step).toBe(2);
    expect(display.listingPaused).toBeUndefined();
  });

  it("leaves an in-review application untouched", () => {
    const display = getKitchenDisplayStatus({
      status: "inReview",
      current_tier: 1,
      locationListed: false,
    });
    expect(display.actionKind).toBe("wait");
    expect(display.step).toBe(1);
    expect(display.listingPaused).toBeUndefined();
  });
});
