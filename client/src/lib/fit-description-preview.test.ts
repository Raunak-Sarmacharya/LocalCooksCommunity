import { describe, expect, it } from "vitest";
import { fitDescriptionPreview } from "./fit-description-preview";

describe("fitDescriptionPreview", () => {
  const measure = (s: string) => s.length * 10;

  it("returns null when text fits", () => {
    expect(fitDescriptionPreview("short", 200, measure, 80)).toBeNull();
  });

  it("cuts so text + suffix fit", () => {
    const cut = fitDescriptionPreview("abcdefghijklmnop", 100, measure, 40);
    expect(cut).not.toBeNull();
    expect(measure(cut!) + 40).toBeLessThanOrEqual(100);
  });
});
