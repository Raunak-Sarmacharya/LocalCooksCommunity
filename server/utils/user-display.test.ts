import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("../db", () => ({ db: { select: state.select } }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
import { getUserDisplayName, withChefDisplayNames } from "./user-display";

beforeEach(() => {
  state.select.mockReset();
  state.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ managerProfileData: { displayName: "Morgan Lee" } }] }) }) });
});

describe("chef names in manager responses", () => {
  it("prefers the entered full name over a provider display name", async () => {
    state.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{
      firebaseUid: "google-chef", managerProfileData: { fullName: "Alexandra Chen", displayName: "Google Chef" },
    }] }) }) });
    expect(await getUserDisplayName(5, 'chef')).toBe("Alexandra Chen");
  });
  it('uses the supplied transaction for email name resolution', async () => {
    const select = vi.fn().mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ managerProfileData: { fullName: 'Alex Chen' } }] }) }) });
    expect(await getUserDisplayName(5, 'chef', { select } as any)).toBe('Alex Chen');
    expect(select).toHaveBeenCalledTimes(1); expect(state.select).not.toHaveBeenCalled();
  });
  it("resolves repeated chefs once and preserves record fields", async () => {
    const rows = await withChefDisplayNames([{ chefId: 5, chefName: "morgan@example.com", id: 1 }, { chefId: 5, id: 2 }]);
    expect(rows.map(row => row.chefName)).toEqual(["Morgan Lee", "Morgan Lee"]);
    expect(rows.map(row => row.id)).toEqual([1, 2]);
    expect(state.select).toHaveBeenCalledTimes(1);
  });
  it("preserves genuine names and uses a neutral fallback for email-only records", async () => {
    const rows = await withChefDisplayNames([{ chefId: 7, chefName: "Alex Chen" }, { chefName: "alex@example.com" }, {}]);
    expect(rows.map(row => row.chefName)).toEqual(["Alex Chen", "A chef", "A chef"]);
    expect(state.select).not.toHaveBeenCalled();
  });
});
