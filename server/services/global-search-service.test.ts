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
    expect(queryMock.mock.calls[0][1]).toEqual(["C++ mixer", "manager", 73, 24]);
  });

  it("does not return another locale's resource copy", async () => {
    const results = await searchGlobally({ query: "salubrité", portal: "chef", userId: 1, locale: "en-CA" });
    expect(results).toEqual([]);
  });
});
