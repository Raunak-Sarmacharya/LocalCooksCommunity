import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingVisitRecord, VisitTimeline } from "./BookingVisitRecord";

afterEach(cleanup);

describe("Visit details", () => {
  const events = [{ key: "in", label: "Ada checked in with the check-in code", at: "Jan 15, 10:02 a.m." }, { key: "out", label: "Ada checked out", at: "Jan 15, 11:50 a.m." }];
  it("is collapsed by default, keeps its content mounted (hidden) and opens on tap", () => {
    render(<BookingVisitRecord title="Visit details" timelineLabel="What happened" events={events} attendance={<p>Fix dialog host</p>} />);
    const trigger = screen.getByRole("button", { name: "Visit details" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Mounted while collapsed so the page's controlled Fix dialog still opens from the ⋯ menu.
    expect(screen.getByText("Fix dialog host")).not.toBeVisible();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("visit-timeline")).toBeVisible();
  });
  it("says the check-in method once, one line per event, time on the right", () => {
    render(<VisitTimeline events={events} label="What happened" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Ada checked in with the check-in codeJan 15, 10:02 a.m.");
    expect(document.body.textContent!.split("check-in code").length - 1).toBe(1);
  });
  it("renders nothing for an empty timeline, and claim lines and the kitchen's fix link when given", () => {
    const onFix = vi.fn();
    render(<BookingVisitRecord title="Visit details" timelineLabel="What happened" events={[]} defaultOpen claimLines={["Damage claim · $45.00 · paid Jan 16"]} fixLabel="Fix the visit record" onFix={onFix} />);
    expect(screen.queryByTestId("visit-timeline")).not.toBeInTheDocument();
    expect(screen.getByTestId("visit-claim-lines")).toHaveTextContent("Damage claim · $45.00 · paid Jan 16");
    fireEvent.click(screen.getByRole("button", { name: "Fix the visit record" }));
    expect(onFix).toHaveBeenCalled();
  });
});
