import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementsStepTwo } from "./RequirementsStepTwo";

vi.mock("@/i18n/manager", () => ({
  mt: (key: string) => key,
}));

afterEach(cleanup);

/**
 * The two compliance rows (Food Safety Certificate, Food Establishment License)
 * carry a "Compliance" badge. It belongs on the label line — it qualifies the
 * field name — not in the control cluster on the right, where it reads as part
 * of the value.
 *
 * These assertions pin the badge's ANCESTRY, not just its presence: a badge that
 * is present but back on the right cluster would satisfy a presence-only check,
 * which is precisely the regression worth catching.
 */
describe("RequirementsStepTwo compliance badge placement", () => {
  function renderRows() {
    return render(<RequirementsStepTwo requirements={{}} onRequirementsChange={() => {}} />);
  }

  it("renders one Compliance badge per compliance field, and only for those", () => {
    renderRows();
    // Exactly two: Food Safety Certificate + Food Establishment License. Liability
    // Insurance and Kitchen Experience are NOT compliance fields and get none.
    expect(screen.getAllByText("Compliance")).toHaveLength(2);
  });

  it("orders the label line as label → ⓘ → badge", () => {
    renderRows();

    const label = screen.getByText("Food Safety Certificate");
    const labelLine = label.parentElement!;
    const children = Array.from(labelLine.children);

    const labelIndex = children.indexOf(label);
    // The ⓘ is the RowHelp trigger: a <button> with an aria-label, the only
    // button in the label line.
    const helpIndex = children.findIndex((el) => el.tagName === "BUTTON");
    const badgeIndex = children.findIndex(
      (el) => el.textContent?.trim() === "Compliance",
    );

    expect(labelIndex).toBe(0);
    expect(helpIndex).toBe(1);
    expect(badgeIndex).toBe(2);
    expect(badgeIndex).toBeGreaterThan(helpIndex);
  });

  it("keeps the badge out of the control cluster beside the toggle", () => {
    const { container } = renderRows();

    const switches = container.querySelectorAll('[role="switch"]');
    expect(switches.length).toBeGreaterThan(0);
    switches.forEach((sw) => {
      // The right-hand cluster holds "required"/"optional" and the switch — the
      // compliance badge must no longer be a sibling there.
      expect(sw.parentElement?.textContent ?? "").not.toContain("Compliance");
    });
  });
});
