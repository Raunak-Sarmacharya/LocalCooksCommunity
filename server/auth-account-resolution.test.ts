import { describe, expect, it } from "vitest";
import { maskRecoveryEmail, maskRecoveryPhone, resolveAuthAccountState, resolveAuthMethods } from "./auth-account-resolution";

describe("auth account resolution", () => {
  it("distinguishes new, existing, interrupted, and conflicting identities", () => {
    expect(resolveAuthAccountState(null, null)).toBe("new");
    expect(resolveAuthAccountState("firebase-1", "firebase-1")).toBe("existing");
    expect(resolveAuthAccountState("firebase-1", null)).toBe("profile-incomplete");
    expect(resolveAuthAccountState(null, "firebase-1")).toBe("identity-conflict");
    expect(resolveAuthAccountState("firebase-1", "firebase-2")).toBe("identity-conflict");
  });

  it("returns all linked methods, including phone, in stable order", () => {
    expect(resolveAuthMethods({
      email: "satyajit@example.com",
      phoneNumber: "+17096555123",
      providerIds: ["password", "phone", "google.com"],
    })).toEqual(["email-link", "password", "phone", "google"]);
  });

  it("returns only capabilities actually available to the account", () => {
    expect(resolveAuthMethods({ email: "google@example.com", providerIds: ["google.com"] }))
      .toEqual(["email-link", "google"]);
  });

  it("never returns full recovery identifiers", () => {
    expect(maskRecoveryEmail("satyajitdebnath.debnath@gmail.com")).toBe("sa***@gmail.com");
    expect(maskRecoveryPhone("+17096555123")).toBe("••• ••• 5123");
  });
});
