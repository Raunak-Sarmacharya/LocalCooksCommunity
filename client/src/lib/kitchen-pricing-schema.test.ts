import { describe, expect, it } from "vitest";
import { kitchens } from "@shared/schema";

describe("kitchen pricing schema", () => {
  it("stores hourly and daily rates independently", () => {
    expect(kitchens.hourlyRate.name).toBe("hourly_rate");
    expect(kitchens.dailyRate.name).toBe("daily_rate");
  });
});
