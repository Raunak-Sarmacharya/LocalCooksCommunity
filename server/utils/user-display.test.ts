import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("../db", () => ({ db: { select: state.select } }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
import { withChefDisplayNames } from "./user-display";

beforeEach(() => {
  state.select.mockReset();
  state.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ managerProfileData: { displayName: "Morgan Lee" } }] }) }) });
});

describe("chef names in manager responses", () => {
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
