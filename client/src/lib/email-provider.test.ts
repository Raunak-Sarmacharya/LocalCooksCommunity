import { describe, expect, it } from "vitest";
import { emailProviderFor } from "./email-provider";

/**
 * The "open your inbox" button is only useful if it lands somewhere the person
 * can actually sign in. A wrong guess is worse than no button, so the cases that
 * matter most here are the ones that must return `null`.
 */
describe("emailProviderFor", () => {
  it("maps the common consumer providers", () => {
    expect(emailProviderFor("someone@gmail.com")).toMatchObject({
      name: "Gmail",
      brand: "gmail",
    });
    expect(emailProviderFor("someone@googlemail.com")?.name).toBe("Gmail");
    expect(emailProviderFor("someone@outlook.com")).toMatchObject({
      name: "Outlook",
      brand: "outlook",
    });
    expect(emailProviderFor("someone@icloud.com")).toMatchObject({
      name: "iCloud Mail",
      brand: "icloud",
    });
    expect(emailProviderFor("someone@proton.me")?.name).toBe("Proton Mail");
    expect(emailProviderFor("someone@qq.com")).toMatchObject({
      name: "QQ Mail",
      brand: "qq",
    });
  });

  it("resolves country domains by family", () => {
    expect(emailProviderFor("someone@yahoo.ca")?.name).toBe("Yahoo Mail");
    expect(emailProviderFor("someone@yahoo.co.uk")?.name).toBe("Yahoo Mail");
    expect(emailProviderFor("someone@hotmail.ca")?.name).toBe("Outlook");
    expect(emailProviderFor("someone@gmx.de")?.name).toBe("GMX");
  });

  it("returns null for domains it cannot identify", () => {
    // A corporate domain is usually Workspace or M365, but guessing wrong sends
    // the user to a login page for an account they do not have.
    expect(emailProviderFor("owner@acme.com")).toBeNull();
    expect(emailProviderFor("owner@mykitchen.ca")).toBeNull();
    expect(emailProviderFor("owner@localcooks.ca")).toBeNull();
  });

  it("returns null rather than throwing on malformed input", () => {
    expect(emailProviderFor("not-an-email")).toBeNull();
    expect(emailProviderFor("trailing@")).toBeNull();
    expect(emailProviderFor("")).toBeNull();
    expect(emailProviderFor(null)).toBeNull();
    expect(emailProviderFor(undefined)).toBeNull();
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(emailProviderFor("  Someone@GMAIL.com  ")?.name).toBe("Gmail");
  });

  it("uses the last @ so quoted local parts do not confuse it", () => {
    expect(emailProviderFor("odd@name@gmail.com")?.name).toBe("Gmail");
  });
});
