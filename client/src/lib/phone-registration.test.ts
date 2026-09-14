import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingPhoneRegistration,
  didPhoneAuthCreateNewIdentity,
  getPendingPhoneRegistration,
  isPhoneAuthInProgress,
  markPhoneAuthInProgress,
  savePendingPhoneRegistration,
} from "./phone-registration";

describe("pending phone registration", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists the verified identity and marks onboarding in progress", () => {
    savePendingPhoneRegistration({
      uid: "firebase-uid",
      phoneNumber: "+14165550123",
      email: "chef@example.com",
      displayName: "Test Chef",
      accountType: "chef",
      termsAccepted: true,
      createdAt: Date.now(),
    });

    expect(isPhoneAuthInProgress()).toBe(true);
    expect(getPendingPhoneRegistration()).toMatchObject({
      uid: "firebase-uid",
      phoneNumber: "+14165550123",
      email: "chef@example.com",
    });
  });

  it("rejects expired onboarding state", () => {
    savePendingPhoneRegistration({
      uid: "expired-uid",
      phoneNumber: "+14165550123",
      email: "expired@example.com",
      displayName: "Expired User",
      accountType: "manager",
      termsAccepted: false,
      createdAt: Date.now() - 25 * 60 * 60 * 1000,
    });

    expect(getPendingPhoneRegistration()).toBeNull();
    expect(isPhoneAuthInProgress()).toBe(false);
  });

  it("clears both the draft and in-progress marker", () => {
    markPhoneAuthInProgress(true);
    clearPendingPhoneRegistration();
    expect(isPhoneAuthInProgress()).toBe(false);
  });

  it("remembers whether OTP created a disposable Firebase identity", () => {
    markPhoneAuthInProgress(true, true);
    expect(didPhoneAuthCreateNewIdentity()).toBe(true);

    markPhoneAuthInProgress(true, false);
    expect(didPhoneAuthCreateNewIdentity()).toBe(false);
  });
});
