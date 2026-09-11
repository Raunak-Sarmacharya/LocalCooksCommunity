import { describe, expect, it } from "vitest";
import { coerceTourStepForActor, kitchenActor, nextTourStepAfterSlot, resolvePendingApplyPhase, skipKitchenVerify } from "./auth-intent";

describe("kitchenActor", () => {
  it("guest → registering → signed_in", () => {
    expect(kitchenActor(false, false)).toBe("guest");
    expect(kitchenActor(true, true)).toBe("registering");
    expect(kitchenActor(true, false)).toBe("signed_in");
  });

  it("only registering must verify", () => {
    expect(skipKitchenVerify("guest", false)).toBe(false);
    expect(skipKitchenVerify("registering", false)).toBe(false);
    expect(skipKitchenVerify("signed_in", false)).toBe(false);
    expect(skipKitchenVerify("signed_in", true)).toBe(true);
  });
});

describe("resolvePendingApplyPhase", () => {
  it("signed-in chefs cannot skip leftover verify without verified email", () => {
    expect(resolvePendingApplyPhase("awaiting_verification", "signed_in", false)).toBe(
      "awaiting_verification"
    );
    expect(resolvePendingApplyPhase("awaiting_verification", "signed_in", true)).toBe("ready_to_submit");
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
    expect(nextTourStepAfterSlot("signed_in", true)).toBe("confirm");
    expect(nextTourStepAfterSlot("signed_in", false)).toBe("verify");
    expect(coerceTourStepForActor("verify", "signed_in", true, true)).toBe("confirm");
    expect(coerceTourStepForActor("confirm", "signed_in", true, false)).toBe("verify");
  });

  it("guests who just registered still verify", () => {
    expect(nextTourStepAfterSlot("guest", false)).toBe("account");
    expect(nextTourStepAfterSlot("registering", false)).toBe("verify");
    expect(coerceTourStepForActor("account", "registering", true, false)).toBe("verify");
    expect(coerceTourStepForActor("confirm", "registering", true, false)).toBe("verify");
  });
});
