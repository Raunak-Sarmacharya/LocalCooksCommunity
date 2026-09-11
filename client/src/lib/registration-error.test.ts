import { describe, expect, it } from "vitest";
import { createDuplicateAccountError, isDuplicateAccountError } from "./registration-error";

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

  it("does not classify unrelated registration failures as duplicates", () => {
    expect(isDuplicateAccountError({ code: "auth/network-request-failed" })).toBe(false);
  });

  it("creates a database conflict error with a stable code", () => {
    const error = createDuplicateAccountError();
    expect(error.code).toBe("EMAIL_EXISTS");
    expect(isDuplicateAccountError(error)).toBe(true);
  });
});
