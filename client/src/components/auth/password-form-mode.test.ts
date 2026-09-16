import { describe, expect, it } from "vitest";
import { resolvePasswordFormMode } from "./password-form-mode";

describe("resolvePasswordFormMode", () => {
  it("waits until provider, sign-in claim and profile flag are known", () => {
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: null,
        signInProvider: undefined,
        treatPasswordAsKnown: false,
        passwordSetByUser: null,
      }),
    ).toBe("loading");
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: true,
        signInProvider: undefined,
        treatPasswordAsKnown: false,
        passwordSetByUser: false,
      }),
    ).toBe("loading");
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: true,
        signInProvider: "password",
        treatPasswordAsKnown: false,
        passwordSetByUser: null,
      }),
    ).toBe("loading");
  });

  it("links password for Google-only accounts", () => {
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: false,
        signInProvider: "google.com",
        treatPasswordAsKnown: false,
        passwordSetByUser: false,
      }),
    ).toBe("set-link");
  });

  it("updates without current password for email-link sessions", () => {
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: true,
        signInProvider: "emailLink",
        treatPasswordAsKnown: false,
        passwordSetByUser: false,
      }),
    ).toBe("set-update");
  });

  it("requires current password after password sign-in by a user who chose it", () => {
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: true,
        signInProvider: "password",
        treatPasswordAsKnown: false,
        passwordSetByUser: true,
      }),
    ).toBe("change");
  });

  // Regression: email-verification and phone signups both sign in with the
  // server-generated placeholder, so their provider reads "password" and the
  // profile used to demand a current password the account holder never set.
  it("never asks for a current password when a placeholder is still in place", () => {
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: true,
        signInProvider: "password",
        treatPasswordAsKnown: false,
        passwordSetByUser: false,
      }),
    ).toBe("set-update");
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: true,
        signInProvider: "phone",
        treatPasswordAsKnown: false,
        passwordSetByUser: false,
      }),
    ).toBe("set-update");
  });

  it("switches to change form after a successful set this session", () => {
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: true,
        signInProvider: "emailLink",
        treatPasswordAsKnown: true,
        passwordSetByUser: false,
      }),
    ).toBe("change");
  });
});
