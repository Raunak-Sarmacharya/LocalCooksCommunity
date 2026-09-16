import { describe, expect, it } from "vitest";
import {
  hasVerifiedContact,
  hasVerifiedEmail,
  hasVerifiedPhone,
  requiresEmailVerification,
} from "./auth-verification";

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

describe("contact verification policy", () => {
  it("never treats a saved but unverified phone as verified", () => {
    expect(hasVerifiedPhone({ phoneVerified: false }, {})).toBe(false);
  });

  it("allows account entry when either email or phone is verified", () => {
    expect(hasVerifiedContact(
      { emailVerified: false, phoneVerified: true },
      { is_verified: false },
    )).toBe(true);
    expect(hasVerifiedContact(
      { emailVerified: true, phoneVerified: false },
      { is_verified: true },
    )).toBe(true);
  });

});

describe("requiresEmailVerification (the platform gate)", () => {
  it("blocks a phone-first account whose email was never confirmed", () => {
    // The exact case the gate exists for: Firebase owns a phone, the database
    // holds a registration address, but nobody has proven ownership of it.
    expect(
      requiresEmailVerification(
        { emailVerified: false, phoneVerified: true },
        { is_verified: false },
      )
    ).toBe(true);
  });

  it("does not block an email-verified account that has no phone", () => {
    // Phone must never gate an action, so its absence cannot block anything.
    expect(
      requiresEmailVerification(
        { emailVerified: true, phoneVerified: false },
        { is_verified: true },
      )
    ).toBe(false);
  });

  it("still blocks while the database mirror lags Firebase", () => {
    expect(
      requiresEmailVerification(
        { emailVerified: true, phoneVerified: false },
        { is_verified: false },
      )
    ).toBe(true);
  });

  it("blocks a user with no verified contact at all", () => {
    expect(
      requiresEmailVerification(
        { emailVerified: false, phoneVerified: false },
        { is_verified: false },
      )
    ).toBe(true);
  });

  it("is the exact inverse of hasVerifiedEmail", () => {
    const cases: Array<[{ emailVerified: boolean }, { is_verified: boolean }]> = [
      [{ emailVerified: true }, { is_verified: true }],
      [{ emailVerified: true }, { is_verified: false }],
      [{ emailVerified: false }, { is_verified: true }],
      [{ emailVerified: false }, { is_verified: false }],
    ];
    for (const [authUser, profile] of cases) {
      expect(requiresEmailVerification(authUser, profile)).toBe(
        !hasVerifiedEmail(authUser, profile)
      );
    }
  });
});
