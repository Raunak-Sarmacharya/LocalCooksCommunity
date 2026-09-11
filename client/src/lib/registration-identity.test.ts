import { beforeEach, describe, expect, it } from "vitest";
import { clearRegistrationName, getRegistrationName, saveRegistrationName } from "./registration-identity";

describe("registration identity", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps an explicitly entered registration name by email", () => {
    saveRegistrationName(" Chef@Example.com ", "  Registration Name  ");
    expect(getRegistrationName("chef@example.com")).toBe("Registration Name");
  });

  it("can clear the name after the seller form captures it", () => {
    saveRegistrationName("chef@example.com", "Registration Name");
    clearRegistrationName("chef@example.com");
    expect(getRegistrationName("chef@example.com")).toBe("");
  });
});
