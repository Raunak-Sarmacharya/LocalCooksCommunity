import { describe, expect, it } from "vitest";
import { resolvePasswordFormMode } from "./password-form-mode";

describe("resolvePasswordFormMode", () => {
  it("waits until provider and sign-in claim are known", () => {
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: null,
        signInProvider: undefined,
        treatPasswordAsKnown: false,
      }),
    ).toBe("loading");
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: true,
        signInProvider: undefined,
        treatPasswordAsKnown: false,
      }),
    ).toBe("loading");
  });

  it("links password for Google-only accounts", () => {
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: false,
        signInProvider: "google.com",
        treatPasswordAsKnown: false,
      }),
    ).toBe("set-link");
  });

  it("updates without current password for email-link sessions", () => {
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: true,
        signInProvider: "emailLink",
        treatPasswordAsKnown: false,
      }),
    ).toBe("set-update");
  });

  it("requires current password after password sign-in", () => {
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: true,
        signInProvider: "password",
        treatPasswordAsKnown: false,
      }),
    ).toBe("change");
  });

  it("switches to change form after a successful set this session", () => {
    expect(
      resolvePasswordFormMode({
        hasPasswordProvider: true,
        signInProvider: "emailLink",
        treatPasswordAsKnown: true,
      }),
    ).toBe("change");
  });
});
