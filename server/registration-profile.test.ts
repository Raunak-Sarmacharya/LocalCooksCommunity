import { describe, expect, it } from "vitest";
import { resolveRegistrationEmail, validateNewRegistrationProfile } from "./registration-profile";

describe("new registration profile requirements", () => {
  it("requires a full name and valid phone", () => {
    expect(validateNewRegistrationProfile({ displayName: "", provider: "email" })).toEqual({
      ok: false,
      error: "Full name is required",
    });
  });

  it("uses the Firebase phone claim for phone-first registration", () => {
    expect(validateNewRegistrationProfile({
      displayName: "Ada Lovelace",
      provider: "phone",
      tokenPhone: "+14165550123",
      submittedPhone: "+16045550123",
    })).toEqual({ ok: true, displayName: "Ada Lovelace", phoneNumber: "+14165550123" });
  });

  it("requires the submitted contact phone for Google and email registration", () => {
    expect(validateNewRegistrationProfile({
      displayName: "Grace Hopper",
      provider: "email",
      submittedPhone: "(604) 555-0123",
    })).toEqual({ ok: true, displayName: "Grace Hopper", phoneNumber: "+16045550123" });

    expect(validateNewRegistrationProfile({
      displayName: "Google Chef",
      provider: "google",
      submittedPhone: "(709) 631-8480",
    })).toEqual({ ok: true, displayName: "Google Chef", phoneNumber: "+17096318480" });
  });

  // Google used to be EXEMPT from the phone requirement, and that exemption is how a
  // "Continue with Google" signup produced an account with a name and an address but
  // no number — silently, with no confirmation step.
  it("requires a phone for Google registration too", () => {
    expect(validateNewRegistrationProfile({
      displayName: "Google Chef",
      provider: "google",
    })).toEqual({ ok: false, error: "A valid phone number is required" });

    expect(validateNewRegistrationProfile({
      displayName: "Google Chef",
      provider: "google",
      submittedPhone: "not-a-number",
    })).toEqual({ ok: false, error: "A valid phone number is required" });
  });

  it("accepts a saved email for a phone-verified registration", () => {
    expect(resolveRegistrationEmail({
      provider: "phone",
      submittedEmail: " CHEF@example.com ",
    })).toBe("chef@example.com");
  });

  it("never lets a submitted email replace the Firebase email for email or Google registration", () => {
    expect(resolveRegistrationEmail({
      provider: "email",
      tokenEmail: "verified@example.com",
      submittedEmail: "attacker@example.com",
    })).toBe("verified@example.com");
  });
});
