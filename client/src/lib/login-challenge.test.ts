import { beforeEach, describe, expect, it } from "vitest";
import {
  createMissingProfileError,
  isMissingProfileError,
  mapPasswordSignInError,
  getRememberedAuthMethod,
  rememberAuthMethod,
  resolveIdentifierStep,
} from "./login-challenge";

describe("identifier-first authentication", () => {
  beforeEach(() => window.localStorage.clear());

  it("routes email to a challenge and phone to OTP", () => {
    expect(resolveIdentifierStep("email")).toBe("login");
    expect(resolveIdentifierStep("phone")).toBe("phone-otp");
  });

  it("recognizes only the coded post-auth missing-profile outcome", () => {
    expect(isMissingProfileError(createMissingProfileError())).toBe(true);
    expect(createMissingProfileError("New.Google@Example.com").email).toBe("new.google@example.com");
    expect(isMissingProfileError(new Error("account not found"))).toBe(false);
  });

  it("does not reveal whether password credentials belong to an account", () => {
    expect(mapPasswordSignInError("auth/user-not-found").descKey).toBe("errInvalidCredential");
    expect(mapPasswordSignInError("auth/wrong-password").descKey).toBe("errInvalidCredential");
  });

  it("uses only a successful same-browser sign-in as a provider hint", async () => {
    await rememberAuthMethod("Returning@Example.com", "google");

    expect(await getRememberedAuthMethod("returning@example.com")).toBe("google");
    expect(await getRememberedAuthMethod("someone-else@example.com")).toBeNull();
    expect(window.localStorage.getItem("localcooks-auth-method-hint")).not.toContain("returning@example.com");
  });
});
