import { beforeEach, describe, expect, it } from "vitest";
import {
  createMissingProfileError,
  isMissingProfileError,
  mapPasswordSignInError,
  getRememberedAuthMethod,
  rememberAuthMethod,
  resolvePhoneEntryStep,
} from "./login-challenge";
import { EMPTY_AUTH_RESOLUTION, type AuthAccountResolution } from "@shared/auth-resolution";

const resolution = (overrides: Partial<AuthAccountResolution> = {}): AuthAccountResolution => ({
  ...EMPTY_AUTH_RESOLUTION,
  state: "existing",
  phoneVerified: true,
  ...overrides,
});

describe("identifier-first authentication", () => {
  beforeEach(() => window.localStorage.clear());

  describe("phone sign-in is gated before any code is sent", () => {
    it("offers OTP only for a verified number on an account allowed here", () => {
      expect(resolvePhoneEntryStep(resolution())).toBe("phone-otp");
    });

    // The reported bug: a chef's number reached "Finish signing up" because the
    // step was chosen without consulting the resolution at all.
    it("refuses a number no account holds, rather than treating it as a signup", () => {
      expect(resolvePhoneEntryStep(resolution({ state: "new" }))).toBe("phone-unknown");
    });

    it("refuses a number the account has never proved", () => {
      expect(resolvePhoneEntryStep(resolution({ phoneVerified: false }))).toBe("phone-unverified");
    });

    // The deliberate asymmetry with email. There, an unreadable answer falls back
    // to the generic email-link path because that costs nothing. Here it must NOT
    // open the method: an SMS is a real message to a real person and it mints a
    // Firebase identity, so failing open is the expensive mistake.
    it("fails closed when verification could not be read", () => {
      expect(resolvePhoneEntryStep(resolution({ phoneVerified: null }))).toBe("phone-unverified");
      expect(resolvePhoneEntryStep(EMPTY_AUTH_RESOLUTION)).toBe("phone-unverified");
    });

    // Portal authority is settled FIRST, so an account we are about to refuse
    // never receives an SMS even when everything else about it is fine.
    it("refuses the portal before anything else is considered", () => {
      expect(resolvePhoneEntryStep(resolution({ portalAllowed: false }))).toBe("portal-rejected");
      expect(resolvePhoneEntryStep(resolution({ state: "new", portalAllowed: false }))).toBe("portal-rejected");
      expect(resolvePhoneEntryStep(resolution({ phoneVerified: false, portalAllowed: false }))).toBe("portal-rejected");
    });

    it("applies no portal gate when the caller named no portal", () => {
      expect(resolvePhoneEntryStep(resolution({ portalAllowed: null }))).toBe("phone-otp");
    });
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
