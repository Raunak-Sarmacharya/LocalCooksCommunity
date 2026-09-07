import { describe, expect, it } from "vitest";
import { hasVerifiedEmail } from "./auth-verification";

describe("hasVerifiedEmail", () => {
  it("does not allow onboarding when Firebase has not verified the email", () => {
    expect(
      hasVerifiedEmail(
        { emailVerified: false },
        { is_verified: true }
      )
    ).toBe(false);
  });

  it("does not allow onboarding before the database verification sync", () => {
    expect(
      hasVerifiedEmail(
        { emailVerified: true },
        { is_verified: false }
      )
    ).toBe(false);
  });

  it("allows onboarding only after both verification states agree", () => {
    expect(
      hasVerifiedEmail(
        { emailVerified: true },
        { is_verified: true }
      )
    ).toBe(true);
  });
});
