import { describe, expect, it } from "vitest";
import {
  createDuplicateAccountError,
  duplicateAccountErrorFromResponse,
  duplicateAccountKind,
  isDuplicateAccountError,
} from "./registration-error";

describe("duplicateAccountErrorFromResponse", () => {
  it("keeps a phone conflict labelled as a phone conflict", () => {
    // The reported bug, end to end at this seam: the server said PHONE_EXISTS and
    // the client turned it into an email conflict, so a visitor with a brand-new
    // address and a number already in use was told to change their email.
    const error = duplicateAccountErrorFromResponse(409, {
      code: "PHONE_EXISTS",
      message: "That phone number is already linked to a Local Cooks account.",
    });
    expect(error?.code).toBe("PHONE_EXISTS");
    expect(duplicateAccountKind(error)).toBe("phone");
    expect(error?.message).toContain("phone number");
  });

  it("keeps an email conflict labelled as an email conflict", () => {
    const error = duplicateAccountErrorFromResponse(409, { code: "EMAIL_EXISTS" });
    expect(error?.code).toBe("EMAIL_EXISTS");
    expect(duplicateAccountKind(error)).toBe("email");
  });

  it("returns null when the response is not a duplicate", () => {
    expect(duplicateAccountErrorFromResponse(500, { code: "SMTP_FAILED" })).toBeNull();
    expect(duplicateAccountErrorFromResponse(200, null)).toBeNull();
  });

  it("falls back to the email side for a bare 409 with no usable code", () => {
    const error = duplicateAccountErrorFromResponse(409, null);
    expect(error?.code).toBe("EMAIL_EXISTS");
  });
});

describe("duplicateAccountKind", () => {
  it("names which identifier collided, not merely that one did", () => {
    // A single boolean reported every conflict with email wording, so a taken
    // phone number told the visitor to change their email address — the one field
    // that was fine — and they looped.
    expect(duplicateAccountKind({ code: "EMAIL_EXISTS" })).toBe("email");
    expect(duplicateAccountKind({ code: "PHONE_EXISTS" })).toBe("phone");
    expect(duplicateAccountKind({ code: "auth/phone-number-already-exists" })).toBe("phone");
    expect(duplicateAccountKind({ code: "auth/network-request-failed" })).toBeNull();
  });

  it("does not let the server's phone copy fall into the legacy email catch-all", () => {
    expect(
      duplicateAccountKind({
        message: "That phone number is already linked to a Local Cooks account. Sign in with it instead.",
      }),
    ).toBe("phone");
    expect(
      duplicateAccountKind({ message: "An account already exists for this email address." }),
    ).toBe("email");
    expect(duplicateAccountKind({ cause: { code: "PHONE_EXISTS" } })).toBe("phone");
  });

  it("names the collision when Google is used on an address that already has an account", () => {
    // Signing in with Google for an address that already has a password account is refused
    // by Firebase, and the visitor was told to "try again later" — which cannot work.
    expect(
      duplicateAccountKind({ code: "auth/account-exists-with-different-credential" }),
    ).toBe("email");
    // The real SDK message, which the text patterns do not match on their own.
    expect(
      duplicateAccountKind(
        new Error("Firebase: Error (auth/account-exists-with-different-credential)."),
      ),
    ).toBe("email");
  });
});

describe("isDuplicateAccountError", () => {
  it.each([
    { code: "auth/email-already-in-use" },
    { code: "EMAIL_EXISTS" },
    new Error("Firebase: Error (auth/email-already-in-use)."),
    { message: "This email is already registered." },
    { cause: { code: "EMAIL_EXISTS" } },
  ])("recognizes duplicate account failures", (error) => {
    expect(isDuplicateAccountError(error)).toBe(true);
  });

  it.each([
    { code: "PHONE_EXISTS" },
    { message: "Phone number already registered" },
    { code: "auth/phone-number-already-exists" },
    { cause: { code: "PHONE_EXISTS" } },
  ])("recognizes a taken phone number as a duplicate account", (error) => {
    // Not cosmetic: `signup` and `signInWithGoogle` DELETE the Firebase user they
    // just created when this returns true. An unrecognised phone conflict would
    // leave that user behind as an orphan with no LocalCooks profile.
    expect(isDuplicateAccountError(error)).toBe(true);
  });

  it("does not classify unrelated registration failures as duplicates", () => {
    expect(isDuplicateAccountError({ code: "auth/network-request-failed" })).toBe(false);
  });

  it("creates a database conflict error with a stable code", () => {
    const error = createDuplicateAccountError();
    expect(error.code).toBe("EMAIL_EXISTS");
    expect(isDuplicateAccountError(error)).toBe(true);
  });

  it("carries the collided identifier through the error it builds", () => {
    // The bug this guards: `createDuplicateAccountError` hardcoded EMAIL_EXISTS
    // whatever the server had said, so a taken phone number reached the form
    // labelled as a taken email address no matter how well the caller classified
    // it. The code IS the contract — collapsing it here silently undoes the
    // classification upstream.
    const phone = createDuplicateAccountError("That phone number is already linked.", "phone");
    expect(phone.code).toBe("PHONE_EXISTS");
    expect(duplicateAccountKind(phone)).toBe("phone");

    const email = createDuplicateAccountError(undefined, "email");
    expect(email.code).toBe("EMAIL_EXISTS");
    expect(duplicateAccountKind(email)).toBe("email");

    // The default stays on the side it has always been on.
    expect(createDuplicateAccountError().code).toBe("EMAIL_EXISTS");
  });
});
