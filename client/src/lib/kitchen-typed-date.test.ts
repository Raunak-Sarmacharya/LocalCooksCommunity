import { describe, expect, it } from "vitest";
import { evaluateTypedKitchenDate, parseLocalDateInput } from "./kitchen-typed-date";

describe("typed kitchen dates", () => {
  it("checks dates against loaded availability", () => {
    expect(evaluateTypedKitchenDate("", {}, "2026-09-04")).toBe("empty");
    expect(evaluateTypedKitchenDate("2026-09-03", { "2026-09-03": true }, "2026-09-04")).toBe("past");
    expect(evaluateTypedKitchenDate("2026-09-10", {}, "2026-09-04")).toBe("pending");
    expect(evaluateTypedKitchenDate("2026-09-10", { "2026-09-10": true }, "2026-09-04")).toBe("available");
    expect(evaluateTypedKitchenDate("2026-09-10", { "2026-09-10": false }, "2026-09-04")).toBe("unavailable");
  });

  it("parses ISO and typed day-first dates without rollover", () => {
    expect(parseLocalDateInput("2026-09-15")?.getDate()).toBe(15);
    expect(parseLocalDateInput("15/09/2026")?.getDate()).toBe(15);
    expect(parseLocalDateInput("2026-02-31")).toBeUndefined();
    expect(parseLocalDateInput("31/02/2026")).toBeUndefined();
  });
});
