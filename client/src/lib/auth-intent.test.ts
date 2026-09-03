import { describe, expect, it } from "vitest";
import {
  coerceTourStepForActor,
  kitchenActor,
  nextTourStepAfterSlot,
  resolvePendingApplyPhase,
  skipKitchenVerify,
} from "./auth-intent";

describe("kitchenActor", () => {
  it("guest → registering → signed_in", () => {
    expect(kitchenActor(false, false)).toBe("guest");
    expect(kitchenActor(true, true)).toBe("registering");
    expect(kitchenActor(true, false)).toBe("signed_in");
  });

  it("only registering must verify", () => {
    expect(skipKitchenVerify("guest")).toBe(false);
    expect(skipKitchenVerify("registering")).toBe(false);
    expect(skipKitchenVerify("signed_in")).toBe(true);
  });
});

describe("resolvePendingApplyPhase", () => {
  it("signed-in chefs skip leftover verify", () => {
    expect(resolvePendingApplyPhase("awaiting_verification", "signed_in", false)).toBe(
      "ready_to_submit"
    );
  });

  it("new registrants stay on verify until the email link", () => {
    expect(resolvePendingApplyPhase("awaiting_verification", "registering", false)).toBe(
      "awaiting_verification"
    );
    expect(resolvePendingApplyPhase("awaiting_verification", "registering", true)).toBe(
      "ready_to_submit"
    );
  });
});

describe("tour steps", () => {
  it("logged-in chefs go date → time → confirm", () => {
    expect(nextTourStepAfterSlot("signed_in")).toBe("confirm");
    expect(coerceTourStepForActor("verify", "signed_in", true)).toBe("confirm");
  });

  it("guests who just registered still verify", () => {
    expect(nextTourStepAfterSlot("guest")).toBe("account");
    expect(nextTourStepAfterSlot("registering")).toBe("verify");
    expect(coerceTourStepForActor("account", "registering", true)).toBe("verify");
    expect(coerceTourStepForActor("confirm", "registering", true)).toBe("confirm");
  });
});
