/**
 * REGRESSION HARNESS — the wrapped TabsList
 *
 * Why this file exists.
 *
 * `TabsList` used to be the Radix List and nothing else. It now wraps that List in a positioned
 * container, because the fade + chevron affordance has to sit ON TOP of the horizontal scroller —
 * inside it, the affordance would scroll away with the content it is meant to reveal.
 *
 * Wrapping a Radix primitive is exactly the kind of change that silently breaks it, so these assert
 * the List still behaves after being wrapped. jsdom has no layout engine, so it cannot assert that
 * the arrows APPEAR (scrollWidth and clientWidth are both 0) — that was verified in a real browser,
 * where a genuinely overflowing strip rendered "Scroll right" and clicking it moved scrollLeft from
 * 0 to 192.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function Fixture() {
  return (
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a">Alpha</TabsTrigger>
        <TabsTrigger value="b">Beta</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Panel A</TabsContent>
      <TabsContent value="b">Panel B</TabsContent>
    </Tabs>
  );
}

describe("TabsList", () => {
  it("keeps the Radix tablist inside a positioned container so the fade can overlay it", () => {
    render(<Fixture />);

    const list = screen.getByRole("tablist");
    // The List itself is unchanged: still the scroller, still the base classes.
    expect(list.className).toContain("overflow-x-auto");

    const wrapper = list.parentElement as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.className).toContain("relative");
    expect(wrapper.className).toContain("min-w-0");
  });

  it("still switches panels after the List was wrapped", () => {
    render(<Fixture />);

    expect(screen.getByText("Panel A")).toBeTruthy();

    // Radix activates a tab on mousedown, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Beta" }));

    expect(screen.getByText("Panel B")).toBeTruthy();
  });

  it("still marks the active tab for assistive tech", () => {
    render(<Fixture />);

    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("data-state")).toBe("active");
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("data-state")).toBe("inactive");
  });
});
