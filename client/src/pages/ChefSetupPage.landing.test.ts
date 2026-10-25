import { describe, expect, it, vi } from "vitest";

vi.mock("@/pages/welcome-screen", () => ({ default: () => null }));
vi.mock("@/components/chat/TidioController", () => ({ default: () => null, useTidioChat: () => ({ openChat: () => {} }) }));

describe("chef setup landing", () => {
  it("sends each choice straight to the work", async () => {
    const { landingFor } = await import("./ChefSetupPage");
    expect(landingFor(["kitchen"])).toBe("/dashboard?view=discover-kitchens");
    expect(landingFor(["localcooks"])).toBe("/dashboard?view=applications&action=new");
    expect(landingFor(["kitchen", "localcooks"])).toBe("/dashboard");
    expect(landingFor([])).toBe("/dashboard");
  });
});
