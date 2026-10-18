import { fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en-CA" } }) }));
vi.mock("wouter", () => ({ Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));

import BookingCalendarWidget, { type CalendarEvent } from "./BookingCalendarWidget";

const events: CalendarEvent[] = [
  { key: "b1", kind: "booking", date: "2026-10-18", start: "20:00", end: "21:00", title: "Morgan", detail: "Day 1 of 2", label: "Confirmed", tone: "green", href: "/manager/booking/90" },
  { key: "b2", kind: "booking", date: "2026-10-19", start: "20:00", end: "21:00", title: "Morgan", detail: "Day 2 of 2", label: "Confirmed", tone: "green", href: "/manager/booking/90" },
  { key: "t1", kind: "tour", date: "2026-10-19", start: "10:00", end: "10:30", title: "Jamie", label: "Tour booked", tone: "blue", onOpen: vi.fn() },
  { key: "c1", kind: "closed", date: "2026-10-20", title: "Kitchen East", detail: "Maintenance", label: "Closed", tone: "grey" },
  { key: "s1", kind: "moveIn", date: "2026-10-21", title: "Sam · Dry shelf", label: "Storage move-in", tone: "purple", href: "/manager/storage/61" },
  { key: "x1", kind: "booking", date: "2026-11-02", start: "09:00", end: "10:00", title: "Later", label: "Confirmed", tone: "green", href: "/manager/booking/91" },
];

const setup = () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  return render(<BookingCalendarWidget events={events} isLoading={false} today="2026-10-18" onNavigateToBookings={vi.fn()} />);
};

describe("BookingCalendarWidget", () => {
  it("shows the week with every kind of event, each opening its own page", () => {
    const screen = setup();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Oct 18 – Oct 24, 2026");
    const links = screen.getAllByRole("link").map(link => link.getAttribute("href"));
    expect(links).toEqual(["/manager/booking/90", "/manager/booking/90", "/manager/storage/61"]);
    // One chip per day of the two-day booking, each in its own day.
    expect(screen.getAllByRole("link", { name: /8:00–9:00 p\.m\. · Morgan · Confirmed/ })).toHaveLength(2);
    expect(within(screen.getByRole("region", { name: /Tuesday, October 20/ })).getByText("Kitchen East")).toBeTruthy();
    expect(screen.queryByText("Later")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /10:00–10:30 a\.m\. · Jamie/ }));
    expect(events[2].onOpen).toHaveBeenCalled();
    screen.unmount();
  });

  it("opens a day as full rows (tour first by time) and steps to the next week", () => {
    const screen = setup();
    fireEvent.click(within(screen.getByRole("region", { name: /Monday, October 19/ })).getAllByRole("button")[0]);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Monday, October 19, 2026");
    const rows = screen.container.querySelectorAll(".divide-y > *");
    expect(Array.from(rows).map(row => row.textContent)).toEqual([expect.stringContaining("Jamie"), expect.stringContaining("Day 2 of 2")]);
    fireEvent.click(screen.getByRole("radio", { name: "weekView" }));
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Oct 25 – Oct 31, 2026");
    screen.unmount();
  });

  it("has a month view whose days open the day view", () => {
    const screen = setup();
    fireEvent.click(screen.getByRole("radio", { name: "monthView" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("October 2026");
    fireEvent.click(screen.getByRole("button", { name: /Tuesday, October 20 · ovrEventCount/ }));
    expect(screen.getByText("Kitchen East")).toBeTruthy();
    screen.unmount();
  });
});
