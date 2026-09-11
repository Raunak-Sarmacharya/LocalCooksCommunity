import { describe, expect, it } from "vitest";
import { phaseTransitionEvent } from "./chat-service";
import { generateKitchenCoordinationSubmittedManagerEmail } from "./email";

describe("phaseTransitionEvent", () => {
  it("opens kitchen coordination chat after request-to-apply approval", () => {
    expect(phaseTransitionEvent(1, 2)).toBe("TIER1_APPROVED");
  });

  it("marks ready to book when kitchen coordination is approved", () => {
    expect(phaseTransitionEvent(2, 3)).toBe("TIER2_COMPLETE");
  });

  it("treats legacy jumps to tier 3+ as ready to book", () => {
    expect(phaseTransitionEvent(1, 3)).toBe("TIER2_COMPLETE");
    expect(phaseTransitionEvent(2, 4)).toBe("TIER2_COMPLETE");
  });

  it("ignores non-phase moves", () => {
    expect(phaseTransitionEvent(2, 2)).toBeNull();
    expect(phaseTransitionEvent(1, 1)).toBeNull();
  });
});

describe("generateKitchenCoordinationSubmittedManagerEmail", () => {
  it("directs the kitchen manager to review submitted coordination documents", () => {
    const email = generateKitchenCoordinationSubmittedManagerEmail({
      managerEmail: "manager@example.com",
      chefName: "Test Chef",
      chefEmail: "chef@example.com",
      locationName: "Test Kitchen",
      applicationId: 42,
      submittedAt: new Date("2026-09-09T12:00:00Z"),
    });

    expect(email.to).toBe("manager@example.com");
    expect(email.subject).toContain("Kitchen Coordination Ready for Review");
    expect(email.text).toContain("Test Kitchen");
    expect(email.html).toContain("Review Kitchen Coordination");
  });
});
