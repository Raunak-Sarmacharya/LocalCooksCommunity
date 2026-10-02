import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({ pool: { query: queryMock } }));

import { searchGlobally } from "./global-search-service";

describe("global search service", () => {
  beforeEach(() => queryMock.mockReset().mockResolvedValue({ rows: [] }));

  it("finds deep resource text and returns its anchored breadcrumb", async () => {
    const results = await searchGlobally({
      query: "cross-contamination",
      portal: "chef",
      userId: 42,
      locale: "en-CA",
    });
    const match = results.find((result) => result.url.includes("#food-safety-certification"));
    expect(match?.snippet.toLowerCase()).toContain("cross-contamination");
    expect(match?.breadcrumb.at(-1)?.label).toBe("Food Safety Certification");
  });

  it("passes portal and user id separately to the parameterized database query", async () => {
    await searchGlobally({ query: "C++ mixer", portal: "manager", userId: 73, locale: "en-CA" });
    expect(queryMock).toHaveBeenCalledOnce();
    expect(queryMock.mock.calls[0][1]).toEqual(["C++ mixer", "manager", 73, 72, "c++ mixer%", "%c++ mixer%"]);
  });

  it("does not return another locale's resource copy", async () => {
    const results = await searchGlobally({ query: "salubrité", portal: "chef", userId: 1, locale: "en-CA" });
    expect(results).toEqual([]);
  });

  it("keeps unpublished and expired kitchens out of chef search", async () => {
    const row = (source_id: number, listing_status: string, kitchen_license_expiry: string) => ({
      type: "kitchen", source_id, title: `Kitchen ${source_id}`, body: "oven",
      view: "discover-kitchens", score: 12, fuzzy: false, location_id: source_id,
      kitchen_id: source_id, kitchen_active: true, listing_status,
      kitchen_license_url: "https://example.com/license.pdf",
      kitchen_license_status: "approved", kitchen_license_expiry,
    });
    queryMock.mockResolvedValue({ rows: [
      row(1, "draft", "2099-01-01"),
      row(2, "active", "2020-01-01"),
      row(3, "active", "2099-01-01"),
    ] });
    const results = await searchGlobally({ query: "oven", portal: "chef", userId: 42, locale: "en-CA" });
    expect(results.filter((result) => result.type === "kitchen").map((result) => result.id)).toEqual(["kitchen:3"]);
    expect(results.find((result) => result.id === "kitchen:3")?.url).toBe("/kitchen-preview/3?kitchenId=3");
  });

  it("takes a manager's location result to Profile > Location", async () => {
    queryMock.mockResolvedValue({ rows: [{
      type: "location", source_id: 9, title: "Main location", body: "Toronto",
      view: "profile", score: 12, fuzzy: false, location_id: 9,
      kitchen_id: null, kitchen_active: null, listing_status: null,
      kitchen_license_url: null, kitchen_license_status: null, kitchen_license_expiry: null,
    }] });
    const results = await searchGlobally({ query: "Main", portal: "manager", userId: 42, locale: "en-CA" });
    expect(results.find((result) => result.id === "location:9")?.url)
      .toBe("/manager/booking-dashboard?view=profile&tab=location&locationId=9");
  });
});
