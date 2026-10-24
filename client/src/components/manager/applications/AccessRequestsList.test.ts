import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n", () => ({ default: { language: "en-CA" } }));

import { accessRequestTab } from "./AccessRequestsList";
import type { Application } from "./types";

const app = (patch: Partial<Application>) => ({ status: "approved", current_tier: 1, tier2_completed_at: null, documentRenewals: [], ...patch }) as Application;

describe("accessRequestTab", () => {
  it("puts each request where the next move is, and leaves approved customers to Customers", () => {
    expect(accessRequestTab(app({ current_tier: 1 }))).toBe("waiting");
    expect(accessRequestTab(app({ current_tier: 2, tier2_completed_at: "2026-10-23T12:00:00Z" }))).toBe("review");
    expect(accessRequestTab(app({ status: "rejected" }))).toBe("declined");
    expect(accessRequestTab(app({ current_tier: 3 }))).toBeNull();
    // An approved customer's renewal still needs the kitchen.
    expect(accessRequestTab(app({ current_tier: 3, documentRenewals: [{ id: 1, key: "insurance", url: "/x", expiry: "2027-01-01", status: "pending" }] }))).toBe("review");
  });
});
