import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import ICU from "i18next-icu";
import { I18nextProvider } from "react-i18next";
import enManager from "@shared/i18n/locales/en-CA/manager.json";
import frManager from "@shared/i18n/locales/fr-CA/manager.json";
import ukManager from "@shared/i18n/locales/uk/manager.json";
import { VisitCodePanel, groupVisitCode } from "./VisitCodePanel";
import { ManagerInSessionBadge, inSessionEnds } from "./ManagerInSessionBadge";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiClient: { get: api.get, post: api.post } }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const resources = { "en-CA": { manager: enManager }, "fr-CA": { manager: frManager }, uk: { manager: ukManager } };
async function i18nFor(lng: "en-CA" | "fr-CA" | "uk" = "en-CA") {
  const i18n = createInstance();
  await i18n.use(ICU).init({ lng, resources, defaultNS: "manager", ns: ["manager"], interpolation: { escapeValue: false } });
  return i18n;
}

const base = { targetKey: "booking:55", visitId: null, mode: "staffed", revision: 1, code: "123456", codeUnavailable: false, locked: false,
  failedAttempts: 0, attemptsLeft: 5, issuedAt: "2026-10-13T12:00:00Z", modeChangedAt: null, modeReason: null, consumed: false,
  consumedMethod: null, consumedAt: null, revoked: false };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let state: { bookingId: number; targets: any[] };
let client: QueryClient;

async function mount(props: Partial<React.ComponentProps<typeof VisitCodePanel>> = {}, lng: "en-CA" | "fr-CA" | "uk" = "en-CA") {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const i18n = await i18nFor(lng);
  return render(<I18nextProvider i18n={i18n}><QueryClientProvider client={client}>
    <VisitCodePanel bookingId={55} customerName="Ada Lovelace" kitchenName="Harbour Kitchen" timezone="America/St_Johns"
      bookingDate="2026-10-13T00:00:00Z" startTime="09:00" endTime="11:00" bookingStatus="confirmed" {...props} />
  </QueryClientProvider></I18nextProvider>);
}

describe("VisitCodePanel", () => {
  beforeEach(() => {
    state = { bookingId: 55, targets: [{ ...base }] };
    api.get.mockReset(); api.post.mockReset(); toasts.success.mockReset(); toasts.error.mockReset();
    api.get.mockImplementation(async () => json(state));
  });
  afterEach(() => { cleanup(); client?.clear(); });

  it("groups the code and shows customer, kitchen, kitchen-local time with a friendly zone and the mode", async () => {
    await mount();
    expect(await screen.findByTestId("visit-code-value")).toHaveTextContent("123 456");
    expect(groupVisitCode("987654")).toBe("987 654");
    const card = screen.getByTestId("visit-code-booking:55");
    expect(within(card).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(card).getByText("Harbour Kitchen")).toBeInTheDocument();
    expect(card).toHaveTextContent(/9:00.*11:00/);
    expect(card.textContent).not.toContain("America/St_Johns");
    expect(card).toHaveTextContent(/Newfoundland/);
    expect(within(card).getByText("Staff gives the code")).toBeInTheDocument();
    expect(within(card).getByText("Wrong attempts: 0 of 5")).toBeInTheDocument();
    for (const button of within(card).getAllByRole("button")) expect(button.className).toContain("min-h-11");
  });

  it("shows the locked state", async () => {
    state.targets = [{ ...base, locked: true, failedAttempts: 5, attemptsLeft: 0 }];
    await mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Locked after too many wrong attempts");
    expect(screen.getByText("Wrong attempts: 5 of 5")).toBeInTheDocument();
  });

  it("asks for confirmation before issuing a new code and updates the displayed code", async () => {
    await mount();
    await screen.findByTestId("visit-code-value");
    api.post.mockResolvedValue(json({ bookingId: 55, targets: [{ ...base, revision: 2, code: "654321" }] }));
    fireEvent.click(screen.getByRole("button", { name: "Issue new code" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/current code stops working immediately/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue new code" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/manager/bookings/55/visit-code/issue", { target: "booking:55" }));
    await waitFor(() => expect(screen.getByTestId("visit-code-value")).toHaveTextContent("654 321"));
    expect(toasts.success).toHaveBeenCalledTimes(1);
    // The toast never carries the code.
    expect(JSON.stringify(toasts.success.mock.calls)).not.toMatch(/654\s?321|123\s?456/);
  });

  it("requires a reason for self check-in and explains what it means", async () => {
    await mount();
    await screen.findByTestId("visit-code-value");
    fireEvent.click(screen.getByRole("button", { name: "Set up self check-in" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/confirm their arrival without staff/)).toBeInTheDocument();
    expect(within(dialog).getByText(/kitchen must provide access instructions/)).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Turn on self check-in" });
    expect(submit).toBeDisabled();
    expect(within(dialog).queryByLabelText("Apply to all visits of this booking")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "too short" } });
    expect(submit).toBeDisabled();
    api.post.mockResolvedValue(json({ bookingId: 55, targets: [{ ...base, mode: "self", code: null, modeReason: "Front desk is closed today" }] }));
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Front desk is closed today" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/manager/bookings/55/visit-code/mode",
      { target: "booking:55", mode: "self", reason: "Front desk is closed today" }));
    expect(await screen.findByText(/customer can confirm arrival without a code/)).toBeInTheDocument();
    expect(screen.queryByTestId("visit-code-value")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch back to staffed" })).toBeInTheDocument();
  });

  it("offers an all-visits option for split bookings and sends all:true", async () => {
    state.targets = [{ ...base, targetKey: "visit:1", visitId: 1 }, { ...base, targetKey: "visit:2", visitId: 2, code: "222333" }];
    await mount({ visits: [{ id: 1, blockIndex: 0, startTime: "09:00", endTime: "10:00" }, { id: 2, blockIndex: 1, startTime: "13:00", endTime: "14:00" }] });
    await screen.findByTestId("visit-code-visit:1");
    expect(screen.getByText("Visit 1")).toBeInTheDocument();
    expect(screen.getByText("Visit 2")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("visit-code-visit:1")).getByRole("button", { name: "Set up self check-in" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Kitchen closed all day" } });
    fireEvent.click(within(dialog).getByLabelText("Apply to all visits of this booking"));
    api.post.mockResolvedValue(json(state));
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn on self check-in" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/manager/bookings/55/visit-code/mode", { all: true, mode: "self", reason: "Kitchen closed all day" }));
  });

  it("switches back to staffed without needing a reason", async () => {
    state.targets = [{ ...base, mode: "self", code: null, modeReason: "Front desk is closed today" }];
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Switch back to staffed" }));
    const dialog = await screen.findByRole("dialog");
    api.post.mockResolvedValue(json({ bookingId: 55, targets: [{ ...base, revision: 3 }] }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Switch to staffed" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/manager/bookings/55/visit-code/mode", { target: "booking:55", mode: "staffed" }));
  });

  it.each([
    ["code", /^Arrived 9:02\s*[ap]\.m\. · code$/],
    ["self", /^Arrived 9:02\s*[ap]\.m\. · self check-in$/],
    ["assisted", /^Arrived 9:02\s*[ap]\.m\. · recorded by manager$/],
  ])("after a %s arrival shows only the method and time, never the code", async (method, pattern) => {
    state.targets = [{ ...base, consumed: true, consumedMethod: method, consumedAt: "2026-10-13T11:32:00Z", code: null }];
    await mount();
    const consumed = await screen.findByTestId("visit-code-consumed");
    expect(consumed.textContent?.replace(/[  ]/g, " ")).toMatch(pattern);
    expect(screen.queryByTestId("visit-code-value")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Issue new code" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/123\s?456/);
  });

  it("renders nothing for legacy bookings with no challenge", async () => {
    state.targets = [];
    const { container } = await mount();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("shows a load error with retry", async () => {
    api.get.mockResolvedValueOnce(json({ error: "Booking not found" }, 404));
    await mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Booking not found");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("surfaces a failed action in the dialog and a toast and keeps the old code", async () => {
    await mount();
    await screen.findByTestId("visit-code-value");
    api.post.mockResolvedValue(json({ error: "This visit code can no longer be changed." }, 400));
    fireEvent.click(screen.getByRole("button", { name: "Issue new code" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Issue new code" }));
    expect(await screen.findByText("This visit code can no longer be changed.")).toBeInTheDocument();
    expect(toasts.error).toHaveBeenCalled();
    expect(screen.getByTestId("visit-code-value")).toHaveTextContent("123 456");
  });

  it.each(["fr-CA", "uk"] as const)("renders translated copy in %s", async lng => {
    await mount({}, lng);
    const copy = (lng === "fr-CA" ? frManager : ukManager) as Record<string, string>;
    expect(await screen.findByRole("button", { name: copy.visitCodeIssueNew })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.visitCodeSelfSetup })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\?\?|visitCode[A-Z]/);
  });
});

describe("ManagerInSessionBadge", () => {
  const NOW = Date.parse("2026-10-13T15:00:00Z");
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const badge = async (endsAt: string) => {
    const i18n = await i18nFor();
    return render(<I18nextProvider i18n={i18n}><ManagerInSessionBadge endsAt={endsAt} timezone="America/St_Johns" /></I18nextProvider>);
  };

  it("shows minutes left and the kitchen-local end time, and ticks without any request", async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    await badge("2026-10-13T15:45:00Z");
    expect(screen.getByTestId("manager-in-session")).toHaveTextContent(/In session · 45 min left · ends 1:15/);
    await advance(10 * 60_000);
    expect(screen.getByTestId("manager-in-session")).toHaveTextContent("In session · 35 min left");
    await advance(35 * 60_000);
    expect(screen.getByTestId("manager-in-session")).toHaveTextContent("booked time ended");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("uses hours for long sessions", async () => {
    await badge("2026-10-13T17:30:00Z");
    expect(screen.getByTestId("manager-in-session")).toHaveTextContent("In session · 2 h 30 min left");
  });

  it("only lists visits that arrived and have not departed", () => {
    const clock = (visitId: number, phase = "in_booked_time") => ({ visitId, scheduledEndAt: `2026-10-13T1${visitId}:00:00Z`, phase });
    const booking = { status: "confirmed", closeout: { visits: [clock(1), clock(2), clock(3, "ended")] },
      visits: [{ id: 1, checkinStatus: "checked_in" }, { id: 2, checkinStatus: "checkout_requested" }, { id: 3, checkinStatus: "checked_in" }] };
    expect(inSessionEnds(booking)).toEqual([{ visitId: 1, endsAt: "2026-10-13T11:00:00Z" }]);
    expect(inSessionEnds({ status: "confirmed", checkinStatus: "checked_in", closeout: { visits: [clock(1)] } })).toHaveLength(1);
    expect(inSessionEnds({ status: "confirmed", checkinStatus: "not_checked_in", closeout: { visits: [clock(1)] } })).toHaveLength(0);
    expect(inSessionEnds({ status: "cancelled", checkinStatus: "checked_in", closeout: { visits: [clock(1)] } })).toHaveLength(0);
    expect(inSessionEnds({ status: "confirmed", checkinStatus: "checked_in" })).toHaveLength(0);
  });
});

describe("VisitCodePanel refresh", () => {
  // 09:00-11:00 Newfoundland on 2026-10-13 is 12:30-14:30Z.
  const at = (iso: string) => vi.setSystemTime(new Date(iso))
  const refresh = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    state = { bookingId: 55, targets: [{ ...base }] }
    api.get.mockReset(); api.get.mockImplementation(async () => json(state))
  })
  afterEach(() => { cleanup(); client?.clear(); vi.useRealTimers() })

  it("polls every 30 s while the window is open and stops once the arrival is consumed", async () => {
    at("2026-10-13T12:45:00Z")
    await mount()
    await screen.findByTestId("visit-code-value")
    const initial = api.get.mock.calls.length
    await refresh(31_000)
    expect(api.get.mock.calls.length).toBeGreaterThan(initial)
    state = { bookingId: 55, targets: [{ ...base, code: null, consumed: true, consumedMethod: "code", consumedAt: "2026-10-13T12:50:00Z" }] }
    await refresh(31_000)
    expect(await screen.findByTestId("visit-code-consumed")).toBeInTheDocument()
    const settled = api.get.mock.calls.length
    await refresh(120_000)
    expect(api.get.mock.calls.length).toBe(settled)
  })

  it("does not poll before the lead window or after the visit ends", async () => {
    at("2026-10-13T08:00:00Z")
    await mount()
    await screen.findByTestId("visit-code-value")
    const before = api.get.mock.calls.length
    await refresh(120_000)
    expect(api.get.mock.calls.length).toBe(before)
  })

  it("refetches when the tab becomes visible during an active visit", async () => {
    at("2026-10-13T12:45:00Z")
    await mount()
    await screen.findByTestId("visit-code-value")
    const before = api.get.mock.calls.length
    state = { bookingId: 55, targets: [{ ...base, locked: true, failedAttempts: 5, attemptsLeft: 0 }] }
    document.dispatchEvent(new Event("visibilitychange"))
    expect(await screen.findByText(/Locked after too many wrong attempts/)).toBeInTheDocument()
    expect(api.get.mock.calls.length).toBeGreaterThan(before)
  })
})
