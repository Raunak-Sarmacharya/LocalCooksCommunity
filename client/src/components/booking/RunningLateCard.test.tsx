import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@shared/i18n/locales/en-CA/chef.json";
import { RunningLateCard } from "./RunningLateCard";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "token" } } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({
  i18n: { language: "en-CA", resolvedLanguage: "en-CA" },
  t: (key: string, options?: any) => {
    let value = (en as Record<string, string>)[key] || key;
    for (const [name, replacement] of Object.entries(options || {})) value = value.replaceAll(`{${name}}`, String(replacement));
    return value;
  },
}) }));

const START = new Date("2026-10-14T13:00:00Z"), END = new Date("2026-10-14T17:00:00Z");
let fetchMock: ReturnType<typeof vi.fn>;
const mount = (props: Partial<React.ComponentProps<typeof RunningLateCard>> = {}) => render(
  <RunningLateCard bookingId={10} kitchenName="Harbour Kitchen" startAt={START} endAt={END} timezone="UTC" checkedIn={false} {...props} />);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-14T13:22:00Z"));
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, runningLate: { minutes: 15, reportedAt: "2026-10-14T13:22:00.000Z", expectedAt: "2026-10-14T13:37:00.000Z", note: null, visitId: null, count: 1 } }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("RunningLateCard", () => {
  it("offers Running late? from 30 minutes before the start until the end, and only before check-in", () => {
    vi.setSystemTime(new Date("2026-10-14T12:29:00Z"));
    expect(mount().container).toBeEmptyDOMElement(); cleanup();
    vi.setSystemTime(new Date("2026-10-14T12:30:00Z"));
    mount(); expect(screen.getByRole("button", { name: "Running late?" })).toBeTruthy(); cleanup();
    vi.setSystemTime(new Date("2026-10-14T17:00:00Z"));
    expect(mount().container).toBeEmptyDOMElement(); cleanup();
    vi.setSystemTime(new Date("2026-10-14T13:22:00Z"));
    expect(mount({ checkedIn: true }).container).toBeEmptyDOMElement();
  });
  it("sends the chosen delay and note, then confirms with the booked end", async () => {
    const onChanged = vi.fn();
    mount({ onChanged });
    fireEvent.click(screen.getByRole("button", { name: "Running late?" }));
    expect((screen.getByRole("button", { name: "Tell Harbour Kitchen" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "About 15 min" }));
    fireEvent.change(screen.getByLabelText("Add a short note (optional)"), { target: { value: "Traffic is slow" } });
    fireEvent.click(screen.getByRole("button", { name: "Tell Harbour Kitchen" }));
    await waitFor(() => expect(screen.getByTestId("running-late-banner")).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chef/bookings/10/running-late");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ minutes: 15, note: "Traffic is slow" });
    expect(screen.getByText("You told the kitchen you’re running late")).toBeTruthy();
    expect(screen.getByText(/We told Harbour Kitchen you’re running about 15 minutes late\. Your booking still ends at 5:00 p\.m\./)).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });
  it("keeps the banner when the page reloads with the saved heads-up, and allows updating it", () => {
    mount({ runningLate: { minutes: 30, reportedAt: "2026-10-14T13:10:00.000Z", expectedAt: "2026-10-14T13:40:00.000Z", note: null, visitId: null, count: 1 } });
    expect(screen.getByText("You told the kitchen you’re running late")).toBeTruthy();
    expect(screen.getByText(/running about 30 minutes late/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
  });
  it("stops offering updates after three heads-ups", () => {
    mount({ runningLate: { minutes: 30, reportedAt: "2026-10-14T13:10:00.000Z", expectedAt: "2026-10-14T13:40:00.000Z", note: null, visitId: null, count: 3 } });
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });
  it("shows a friendly problem and keeps the choice when it cannot be sent", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: "RUNNING_LATE_LIMIT", error: "x" }), { status: 429 }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Running late?" }));
    fireEvent.click(screen.getByRole("button", { name: "About an hour" }));
    fireEvent.click(screen.getByRole("button", { name: "Tell Harbour Kitchen" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("updated the kitchen a few times"));
    expect(screen.getByRole("button", { name: "About an hour" }).getAttribute("aria-pressed")).toBe("true");
  });
});
