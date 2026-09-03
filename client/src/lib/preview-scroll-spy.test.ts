import { describe, expect, it } from "vitest";
import { pickPreviewActiveSectionId } from "./preview-scroll-spy";

describe("pickPreviewActiveSectionId", () => {
  const sections = [
    { id: "overview", top: -40 },
    { id: "location", top: 80 },
    { id: "things", top: 400 },
  ];

  it("picks the last section that crossed the spy line", () => {
    expect(pickPreviewActiveSectionId(sections, 56, false)).toBe("overview");
  });

  it("starts on overview before later sections cross", () => {
    expect(
      pickPreviewActiveSectionId(
        [
          { id: "overview", top: 120 },
          { id: "location", top: 500 },
        ],
        56,
        false
      )
    ).toBe("overview");
  });

  it("forces the last section near the page bottom", () => {
    expect(pickPreviewActiveSectionId(sections, 56, true)).toBe("things");
  });
});
