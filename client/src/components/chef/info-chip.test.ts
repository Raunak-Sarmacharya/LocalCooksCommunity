import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { defaultInfoChipIcon, infoChipIconClass, infoChipIconShellClass, prepareInfoChipIcon, sanitizeInfoChipIconClass, statusVariantToTone } from "@/components/chef/info-chip";

describe("InfoChip tone helpers", () => {
  it("maps badge variants to tones for icon color", () => {
    expect(statusVariantToTone("success")).toBe("success");
    expect(statusVariantToTone("warning")).toBe("warning");
    expect(statusVariantToTone("destructive")).toBe("danger");
    expect(statusVariantToTone("info")).toBe("neutral");
    expect(statusVariantToTone("outline")).toBe("neutral");
  });

  it("uses theme green / yellow / red icon classes", () => {
    expect(infoChipIconClass("success")).toBe("text-success");
    expect(infoChipIconClass("neutral")).toBe("text-success");
    expect(infoChipIconClass("warning")).toBe("text-warning");
    expect(infoChipIconClass("progress")).toBe("text-warning");
    expect(infoChipIconClass("danger")).toBe("text-destructive");
  });

  it("returns a distinct default icon per tone", () => {
    expect(defaultInfoChipIcon("danger")).not.toBe(defaultInfoChipIcon("success"));
    expect(defaultInfoChipIcon("progress")).not.toBe(defaultInfoChipIcon("warning"));
  });
});

describe("InfoChip custom icon enforcement", () => {
  it("strips caller size and color classes", () => {
    expect(sanitizeInfoChipIconClass("h-3 w-3 text-muted-foreground mr-1")).toBe("mr-1");
    expect(sanitizeInfoChipIconClass("size-2.5 text-success animate-spin")).toBe("animate-spin");
    expect(sanitizeInfoChipIconClass("text-[#F51042] h-4")).toBe("");
  });

  it("clones custom icons with tone color, size-3, and size=12", () => {
    const raw = createElement("svg", { className: "h-2.5 w-2.5 text-muted-foreground", "data-x": 1 });
    const prepared = prepareInfoChipIcon(raw, "danger") as {
      props: { className?: string; size?: number; "aria-hidden"?: boolean };
    };
    expect(prepared.props.className).toContain("text-destructive");
    expect(prepared.props.className).toContain("size-3");
    expect(prepared.props.className).not.toContain("text-muted-foreground");
    expect(prepared.props.className).not.toMatch(/\bh-2\.5\b/);
    expect(prepared.props.size).toBe(12);
    expect(prepared.props["aria-hidden"]).toBe(true);
  });

  it("colors stroke only — does not force fill on icons", () => {
    expect(infoChipIconShellClass).toContain("stroke-current");
    expect(infoChipIconShellClass).not.toContain("fill-current");
    expect(infoChipIconShellClass).not.toContain("fill-none");
  });
});
