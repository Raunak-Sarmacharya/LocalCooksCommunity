import { afterEach, describe, expect, it } from "vitest";
import { requestedStepFromUrl } from "./requested-step";

/**
 * `?step=` is read BEFORE the engine is constructed, which is what stops the wizard painting the
 * wrong step and then jumping to the right one — the flash a manager saw after pressing
 * "Continue setup" on the dashboard banner.
 *
 * This covers the DECISION. The wiring — that `ManagerOnboardingProvider` hands the result to
 * `OnboardingProvider` as `initialStepId` — is a one-line prop and is not exercised here.
 *
 * Note what is deliberately NOT here: nothing asserts that the wizard's own `welcome` STEP is
 * skipped. It is not skipped. It is a real screen with a real "Maybe later", and it is a different
 * thing from the standalone welcome screen shown before the terms gate.
 */
describe("requestedStepFromUrl", () => {
  const setSearch = (search: string) =>
    window.history.replaceState(null, "", `/${search}`);

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("returns the step the banner asked for", () => {
    setSearch("?step=availability");
    expect(requestedStepFromUrl()).toBe("availability");
  });

  it("returns undefined when nothing was asked for, so the engine's own default decides", () => {
    setSearch("");
    expect(requestedStepFromUrl()).toBeUndefined();
  });

  it("discards an id that is not a step, rather than sending the engine to a step that does not exist", () => {
    setSearch("?step=not-a-step");
    expect(requestedStepFromUrl()).toBeUndefined();
  });

  it("reads the parameter WITHOUT consuming it — the context strips it, and this must not race that", () => {
    setSearch("?step=create-kitchen");
    expect(requestedStepFromUrl()).toBe("create-kitchen");
    expect(window.location.search).toBe("?step=create-kitchen");
  });
});
