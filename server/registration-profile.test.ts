import { describe, expect, it } from "vitest";
import { validateNewRegistrationProfile } from "./registration-profile";

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
  });
});
