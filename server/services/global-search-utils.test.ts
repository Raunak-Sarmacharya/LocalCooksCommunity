import { describe, expect, it } from "vitest";
import {
  createSearchSnippet,
  mergeSearchResults,
  normalizeSearchText,
  scoreStaticDocument,
} from "./global-search-utils";
import type { GlobalSearchResult } from "@shared/search";

describe("global search utilities", () => {
  it("normalizes unicode and whitespace without removing meaningful symbols", () => {
    expect(normalizeSearchText("  C++   MIXER ")).toBe("c++ mixer");
  });

  it("creates an excerpt around a deep match", () => {
    const snippet = createSearchSnippet(`${"start ".repeat(40)}ventilation specifications${" end".repeat(40)}`, "ventilation", 80);
    expect(snippet).toContain("ventilation specifications");
    expect(snippet.startsWith("…")).toBe(true);
  });

  it("ranks exact and prefix title matches above body matches", () => {
    expect(scoreStaticDocument("Bookings", "calendar", "bookings"))
      .toBeGreaterThan(scoreStaticDocument("Dashboard", "manage bookings", "bookings"));
    expect(scoreStaticDocument("Booking rules", "policies", "book"))
      .toBeGreaterThan(scoreStaticDocument("Dashboard", "book reference", "book"));
  });

  it("merges and caps ranked results", () => {
    const result = (id: string, score: number): GlobalSearchResult => ({
      id, score, title: id, snippet: "", url: "/", type: "navigation", breadcrumb: [],
    });
    expect(mergeSearchResults([result("db", 2)], [result("nav", 5)], 1)[0].id).toBe("nav");
  });
});
