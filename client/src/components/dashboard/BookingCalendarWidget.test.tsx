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
  it("shows the week as a timeline with every kind of event, each opening its own page", () => {
    const screen = setup();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("ovrThisWeekOct 18–24");
    const links = screen.getAllByRole("link").map(link => link.getAttribute("href"));
    expect(links).toEqual(["/manager/booking/90", "/manager/booking/90", "/manager/storage/61"]);
    // One bar per day of the two-day booking, each in its own day row, named in full for screen readers.
    expect(screen.getAllByRole("link", { name: /8:00–9:00 p\.m\., Morgan, Confirmed/ })).toHaveLength(2);
    expect(within(screen.getByRole("region", { name: /Tuesday, October 20/ })).getByText("Closed")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Storage move-in · Sam · Dry shelf" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Later/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /10:00–10:30 a\.m\., Jamie/ }));
    expect(events[2].onOpen).toHaveBeenCalled();
    screen.unmount();
  });

  it("opens a day as full rows (tour first by time) and steps to the next week", () => {
    const screen = setup();
    fireEvent.click(within(screen.getByRole("region", { name: /Monday, October 19/ })).getAllByRole("button")[0]);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Monday, October 19, 2026");
    const rows = screen.container.querySelectorAll(".divide-y > *");
    expect(Array.from(rows).map(row => row.textContent)).toEqual([expect.stringContaining("Jamie"), expect.stringContaining("Day 2 of 2")]);
    fireEvent.click(screen.getByRole("button", { name: "weekView" }));
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Oct 25–31");
    screen.unmount();
  });

  it("has a month view whose days open the day view", () => {
    const screen = setup();
    fireEvent.click(screen.getByRole("button", { name: "monthView" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("October 2026");
    fireEvent.click(screen.getByRole("button", { name: /Tuesday, October 20 · ovrEventCount/ }));
    expect(screen.getByText("Kitchen East · Maintenance")).toBeTruthy();
    screen.unmount();
  });

  it("switches views with a segmented control that reports the pressed view", () => {
    const screen = setup();
    const group = screen.getByRole("group", { name: "ovrCalendarView" });
    const pressed = () => within(group).getAllByRole("button").filter(button => button.getAttribute("aria-pressed") === "true").map(button => button.textContent);
    expect(within(group).getAllByRole("button").map(button => button.textContent)).toEqual(["ovrAgendaView", "ovrDayView", "weekView", "monthView"]);
    expect(pressed()).toEqual(["weekView"]);
    fireEvent.click(within(group).getByRole("button", { name: "monthView" }));
    expect(pressed()).toEqual(["monthView"]);
    // Plain buttons: Radix radio items are squashed to 16px by index.css, which overlapped the labels.
    expect(group.querySelector('[role="radio"]')).toBeNull();
    screen.unmount();
  });

  it("hides cancelled bookings until Show cancelled is switched on", () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const withCancelled: CalendarEvent[] = [...events,
      { key: "k1", kind: "booking", date: "2026-10-19", start: "10:00", end: "11:00", title: "Cancelled chef", label: "Cancelled", tone: "grey", muted: true, cancelled: true, href: "/manager/booking/95" },
      { key: "k2", kind: "booking", date: "2026-10-19", start: "11:00", end: "12:00", title: "Done chef", label: "Completed", tone: "grey", muted: true, href: "/manager/booking/96" }];
    const screen = render(<BookingCalendarWidget events={withCancelled} isLoading={false} today="2026-10-18" onNavigateToBookings={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /Cancelled chef/ })).toBeNull();
    // Completed bookings, tours, closures and storage stay on the calendar.
    expect(screen.getByRole("link", { name: /Done chef/ })).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "ovrShowCancelled" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("link", { name: /Cancelled chef/ })).toBeTruthy();
    screen.unmount();
  });

  it("draws each booking state in the legend's colour, and the legend names only what is drawn", () => {
    const states: CalendarEvent[] = [
      { key: "a", kind: "booking", date: "2026-10-18", start: "09:00", end: "10:00", title: "Ana", label: "Answer needed", tone: "amber", state: "answer", href: "/manager/booking/1" },
      { key: "n", kind: "booking", date: "2026-10-19", start: "09:00", end: "10:00", title: "Nik", label: "No check-in recorded", tone: "amber", state: "noCheckin", href: "/manager/booking/2" },
      { key: "b", kind: "booking", date: "2026-10-20", start: "09:00", end: "10:00", title: "Bo", label: "Confirmed", tone: "green", state: "booked", href: "/manager/booking/3" },
    ];
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const screen = render(<BookingCalendarWidget events={states} isLoading={false} today="2026-10-18" onNavigateToBookings={vi.fn()} />);
    const legend = screen.getByTestId("calendar-legend");
    expect(within(legend).getAllByRole("listitem").map(item => item.textContent)).toEqual(["ovrLegendAnswerNeeded", "ovrLegendNoCheckin", "ovrLegendBooked", "ovrLegendNow"]);
    const swatch = (key: string) => within(legend).getByText(key).querySelector("span")!.className.replace("h-2.5 w-3.5 rounded-[3px] ", "");
    expect(screen.getByRole("link", { name: /Ana/ }).className).toContain(swatch("ovrLegendAnswerNeeded"));
    expect(screen.getByRole("link", { name: /Nik/ }).className).toContain(swatch("ovrLegendNoCheckin"));
    expect(screen.getByRole("link", { name: /Bo,/ }).className).toContain(swatch("ovrLegendBooked"));
    expect(swatch("ovrLegendAnswerNeeded")).toContain("amber");
    expect(swatch("ovrLegendNoCheckin")).toContain("dashed");
    screen.unmount();
  });

  describe("several kitchens", () => {
    const kitchens = [{ id: 1, name: "Kitchen East" }, { id: 2, name: "Kitchen West with a long name" }];
    // East and West booked at overlapping hours on Sunday; a tour without a kitchen; West alone on Monday.
    const shared: CalendarEvent[] = [
      { key: "e1", kind: "booking", date: "2026-10-18", start: "10:00", end: "12:00", title: "Ana", kitchenId: 1, kitchen: "Kitchen East", label: "Confirmed", tone: "green", href: "/manager/booking/1" },
      { key: "w1", kind: "booking", date: "2026-10-18", start: "11:00", end: "14:00", title: "Bo", kitchenId: 2, kitchen: "Kitchen West with a long name", label: "Confirmed", tone: "green", href: "/manager/booking/2" },
      { key: "t1", kind: "tour", date: "2026-10-18", start: "15:00", end: "15:30", title: "Jamie", label: "Tour booked", tone: "blue", onOpen: vi.fn() },
      { key: "w2", kind: "booking", date: "2026-10-19", start: "09:00", end: "10:00", title: "Cy", kitchenId: 2, kitchen: "Kitchen West with a long name", label: "Confirmed", tone: "green", href: "/manager/booking/3" },
    ];
    const stats = vi.fn((kitchenId: number | null) => <p data-testid="stats">{kitchenId === null ? "all" : `kitchen ${kitchenId}`}</p>);
    const renderWith = (list = kitchens) => {
      vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
      return render(<BookingCalendarWidget events={shared} kitchens={list} stats={stats} isLoading={false} today="2026-10-18" onNavigateToBookings={vi.fn()} />);
    };

    it("gives each kitchen its own lane on a day, so overlapping bookings never share a row", () => {
      const screen = renderWith();
      const sunday = screen.getByRole("region", { name: /Sunday, October 18/ });
      const lanes = within(sunday).getAllByTestId("timeline-lane");
      expect(lanes.map(lane => lane.firstElementChild!.textContent)).toEqual(["Kitchen East", "Kitchen West with a long name", "kitchenTours"]);
      expect(within(lanes[0]).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["/manager/booking/1"]);
      expect(within(lanes[1]).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["/manager/booking/2"]);
      // The bar names its kitchen in the tooltip and to screen readers.
      expect(within(lanes[1]).getByRole("link")).toHaveAttribute("title", "Bo · Kitchen West with a long name · 11:00 a.m.–2:00 p.m. · Confirmed");
      expect(within(lanes[1]).getByRole("link", { name: /Bo, Kitchen West with a long name, Confirmed/ })).toBeTruthy();
      // A day only lists the kitchens with something on; a day with nothing keeps one empty lane.
      expect(within(screen.getByRole("region", { name: /Monday, October 19/ })).getAllByTestId("timeline-lane").map(lane => lane.firstElementChild!.textContent)).toEqual(["Kitchen West with a long name"]);
      expect(within(screen.getByRole("region", { name: /Tuesday, October 20/ })).getAllByTestId("timeline-lane")).toHaveLength(1);
      expect(screen.getByTestId("stats").textContent).toBe("all");
      screen.unmount();
    });

    it("filters the calendar and the week's numbers to one kitchen, back to the one-kitchen look", () => {
      Object.assign(Element.prototype, { hasPointerCapture: () => false, releasePointerCapture() {}, scrollIntoView() {} });
      const screen = renderWith();
      const filter = screen.getByRole("combobox", { name: "ovrKitchenFilter" });
      expect(filter.textContent).toBe("ovrAllKitchens");
      fireEvent.pointerDown(filter, { button: 0, ctrlKey: false, pointerType: "mouse" });
      fireEvent.click(screen.getByRole("option", { name: "Kitchen West with a long name" }));
      expect(screen.getByTestId("stats").textContent).toBe("kitchen 2");
      expect(screen.queryAllByTestId("timeline-lane")).toHaveLength(0);
      const hrefs = screen.getAllByRole("link").map(link => link.getAttribute("href"));
      expect(hrefs).toEqual(["/manager/booking/2", "/manager/booking/3"]);
      // The location-wide tour stays.
      expect(screen.getByRole("button", { name: /Jamie/ })).toBeTruthy();
      screen.unmount();
    });

    it("draws one kitchen exactly as before: no filter, no lanes", () => {
      const screen = renderWith(kitchens.slice(0, 1));
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.queryAllByTestId("timeline-lane")).toHaveLength(0);
      screen.unmount();
    });
  });

  it("offers no Show cancelled switch when nothing is cancelled", () => {
    const screen = setup();
    expect(screen.queryByRole("switch")).toBeNull();
    screen.unmount();
  });

  it("opens on the Agenda on a phone: today, then only the next days that have something on", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 899px)", media: query, addEventListener() {}, removeEventListener() {} }));
    const screen = setup();
    expect(screen.getByRole("button", { name: "ovrAgendaView" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("ovrThisWeekOct 18–24");
    const days = screen.getAllByRole("region").map(region => region.getAttribute("aria-label")).filter(Boolean);
    // Oct 22–24 have nothing on and are left out; Nov 2 is outside the seven days.
    expect(days).toEqual(["Sunday, October 18", "Monday, October 19", "Tuesday, October 20", "Wednesday, October 21"]);
    const monday = screen.getByRole("region", { name: "Monday, October 19" });
    // Visit rows: the time, its state badge (none for a plain booking), then who; the 10:00 tour before the 8 p.m. booking.
    expect(within(monday).getByRole("button", { name: /Jamie/ }).textContent).toBe("10:00–10:30 a.m.Tour bookedJamie");
    expect(within(monday).getByRole("link").textContent).toBe("8:00–9:00 p.m.Morgan · Day 2 of 2");
    expect(monday.textContent!.indexOf("Jamie")).toBeLessThan(monday.textContent!.indexOf("Morgan"));
    expect(screen.queryByText("Later")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "weekView" }));
    expect(screen.getByRole("button", { name: "weekView" })).toHaveAttribute("aria-pressed", "true");
    screen.unmount();
    vi.unstubAllGlobals();
  });
});
