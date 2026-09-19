import { describe, expect, it, vi } from "vitest";

// The component imports the auth tree and i18n, which need no provider here.
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("@/hooks/use-auth", () => ({ useFirebaseAuth: () => ({ user: null }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

import { resolveWelcomeFirstName } from "./manager-welcome-screen";

describe("resolveWelcomeFirstName", () => {
  it("uses the first word of the display name", () => {
    expect(resolveWelcomeFirstName({ displayName: "Rob Rolly" })).toBe("Rob");
    expect(resolveWelcomeFirstName({ displayName: "  Ada  Lovelace  " })).toBe("Ada");
  });

  it("falls back to fullName when there is no display name", () => {
    expect(resolveWelcomeFirstName({ fullName: "Grace Hopper" })).toBe("Grace");
  });

  // The greeting is about the person, so the display name wins.
  it("prefers the display name over fullName", () => {
    expect(resolveWelcomeFirstName({ displayName: "Rob Rolly", fullName: "Robert Rolly" })).toBe("Rob");
  });

  it("falls back to the local part of an email address", () => {
    expect(resolveWelcomeFirstName({ username: "rob.rolly@example.com" })).toBe("rob.rolly");
  });

  it("uses a non-email username as-is", () => {
    expect(resolveWelcomeFirstName({ username: "robrolly" })).toBe("robrolly");
  });

  // The caller needs a falsy value it can branch on, so the generic greeting is used
  // rather than rendering "Welcome, undefined".
  it("returns an empty string when there is nothing to greet with", () => {
    expect(resolveWelcomeFirstName(null)).toBe("");
    expect(resolveWelcomeFirstName(undefined)).toBe("");
    expect(resolveWelcomeFirstName({})).toBe("");
    expect(resolveWelcomeFirstName({ displayName: "   ", username: "" })).toBe("");
  });

  // A blank display name must not shadow a usable username.
  it("ignores blank values rather than treating them as a name", () => {
    expect(resolveWelcomeFirstName({ displayName: "  ", username: "rob@example.com" })).toBe("rob");
  });
});
