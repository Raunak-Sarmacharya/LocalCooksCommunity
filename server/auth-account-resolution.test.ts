import { describe, expect, it } from "vitest";
import { maskRecoveryEmail, maskRecoveryPhone, resolveAuthAccountState, resolveAuthMethods, resolveEmailVerified, resolvePhoneAccountState, resolvePortalAllowed } from "./auth-account-resolution";

describe("auth account resolution", () => {
  it("distinguishes new, existing, interrupted, and conflicting identities", () => {
    expect(resolveAuthAccountState(null, null)).toBe("new");
    expect(resolveAuthAccountState("firebase-1", "firebase-1")).toBe("existing");
    expect(resolveAuthAccountState("firebase-1", null)).toBe("profile-incomplete");
    expect(resolveAuthAccountState(null, "firebase-1")).toBe("identity-conflict");
    expect(resolveAuthAccountState("firebase-1", "firebase-2")).toBe("identity-conflict");
  });

  it("requires BOTH stores to agree before calling an email verified", () => {
    const existing = "existing" as const;
    expect(resolveEmailVerified({ state: existing, firebaseEmailVerified: true, neonIsVerified: true })).toBe(true);
    // Firebase says verified, the database has not caught up — the platform gate
    // still blocks, so the resolution must not call it verified.
    expect(resolveEmailVerified({ state: existing, firebaseEmailVerified: true, neonIsVerified: false })).toBe(false);
    expect(resolveEmailVerified({ state: existing, firebaseEmailVerified: false, neonIsVerified: true })).toBe(false);
    expect(resolveEmailVerified({ state: existing, firebaseEmailVerified: false, neonIsVerified: false })).toBe(false);
  });

  it("reports null rather than false wherever the question does not apply", () => {
    // null means "cannot judge". Reading it as "unverified" would divert every
    // returning user into the verification flow whenever the lookup hiccups.
    expect(resolveEmailVerified({ state: "unavailable", firebaseEmailVerified: true, neonIsVerified: true })).toBeNull();
    expect(resolveEmailVerified({ state: "new", firebaseEmailVerified: null, neonIsVerified: null })).toBeNull();
    // A half-finished registration is not an unconfirmed address.
    expect(resolveEmailVerified({ state: "profile-incomplete", firebaseEmailVerified: false, neonIsVerified: null })).toBeNull();
    expect(resolveEmailVerified({ state: "identity-conflict", firebaseEmailVerified: true, neonIsVerified: true })).toBeNull();
    // Missing inputs must not be coerced into `true`.
    expect(resolveEmailVerified({ state: "existing" })).toBe(false);
  });

  it("returns all linked methods, including phone, in stable order", () => {
    expect(resolveAuthMethods({
      email: "satyajit@example.com",
      phoneNumber: "+17096555123",
      providerIds: ["password", "phone", "google.com"],
      passwordSetByUser: true,
    })).toEqual(["email-link", "password", "phone", "google"]);
  });

  it("returns only capabilities actually available to the account", () => {
    expect(resolveAuthMethods({
      email: "google@example.com",
      providerIds: ["google.com"],
      passwordSetByUser: false,
    })).toEqual(["email-link", "google"]);
  });

  it("hides password when the account only has a registration placeholder", () => {
    expect(resolveAuthMethods({
      email: "link@example.com",
      providerIds: ["password"],
      passwordSetByUser: false,
    })).toEqual(["email-link"]);
    expect(resolveAuthMethods({
      email: "link@example.com",
      providerIds: ["password"],
      passwordSetByUser: null,
    })).toEqual(["email-link"]);
  });

  it("never returns full recovery identifiers", () => {
    expect(maskRecoveryEmail("satyajitdebnath.debnath@gmail.com")).toBe("sa***@gmail.com");
    expect(maskRecoveryPhone("+17096555123")).toBe("••• ••• 5123");
  });

  it("decides a phone's account from the database, not from Firebase", () => {
    // The whole bug in one assertion. No phone is a Firebase credential, so a
    // Firebase-first answer called every registered number "new" and sent it to
    // the signup form instead of its own account.
    expect(resolvePhoneAccountState({ databaseAccount: { firebaseUid: "fb-1" }, firebaseUid: null })).toBe("existing");
    // A legacy row with no linked identity still means the number is TAKEN.
    // Passing its null uid through `resolveAuthAccountState` would have said
    // "new" and offered a second registration for a number that has an owner.
    expect(resolvePhoneAccountState({ databaseAccount: { firebaseUid: null }, firebaseUid: null })).toBe("existing");
    expect(resolvePhoneAccountState({ databaseAccount: null, firebaseUid: null })).toBe("new");
    // A Firebase identity holding the number with no profile is an interrupted
    // registration, which has its own recovery route.
    expect(resolvePhoneAccountState({ databaseAccount: null, firebaseUid: "fb-1" })).toBe("profile-incomplete");
    // Genuine conflict: Firebase holds the number for a DIFFERENT account.
    expect(resolvePhoneAccountState({ databaseAccount: { firebaseUid: "fb-2" }, firebaseUid: "fb-1" })).toBe("identity-conflict");
  });

  it("gates the manager portal and leaves other portals to their existing check", () => {
    expect(resolvePortalAllowed({ portal: "manager", account: { role: "manager", isManager: true } })).toBe(true);
    expect(resolvePortalAllowed({ portal: "manager", account: { role: "manager", isManager: false } })).toBe(true);
    expect(resolvePortalAllowed({ portal: "manager", account: { role: "chef", isManager: false } })).toBe(false);
    // An admin is REDIRECTED to /admin by the manager portal, not refused, so
    // treating them as disallowed would refuse a flow that works today.
    expect(resolvePortalAllowed({ portal: "manager", account: { role: "admin", isManager: false } })).toBe(true);
    // No portal named, or no account found: no verdict, so no gate.
    expect(resolvePortalAllowed({ portal: null, account: { role: "chef", isManager: false } })).toBeNull();
    expect(resolvePortalAllowed({ portal: "manager", account: null })).toBeNull();
    // The chef portal has no rule yet, so it keeps its post-auth check unchanged.
    expect(resolvePortalAllowed({ portal: "chef", account: { role: "chef", isManager: false } })).toBeNull();
  });
});
