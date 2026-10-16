/**
 * WP-T: an open request/offer closes on screen at its deadline, judged on the SERVER's clock (the fixtures' `serverNow`
 * is deliberately far from this device's clock), with no flip-flop back to "Need more time?"/"Waiting".
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("react-i18next", async () => { const { useBookingTranslation } = await import("@/test/booking-i18n"); return { useTranslation: (ns: any) => useBookingTranslation(ns) }; });
const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ "Content-Type": "application/json" }), apiGet: api.apiGet }));
import { SessionExtensionRequest } from "./SessionExtensionRequest";
import { SessionExtensionsCard } from "./SessionExtensionsCard";
import { SessionExtensionRequests } from "@/components/manager/SessionExtensionRequests";

const END = "2026-10-14T18:30:00.000Z";
// The server says it is 6:05 p.m.; this device's clock is elsewhere. Deadlines are server time + a short real wait.
const SERVER_NOW = Date.parse("2026-10-14T18:05:00.000Z");
const WAIT_MS = 250;
const iso = (ms: number) => new Date(ms).toISOString();
const item = (extra: Record<string, unknown> = {}) => ({ id: 5, kind: "request", minutes: 60, amountCents: 3000, free: false, kitchenGrossCents: 2875, actualMinutes: null,
  maximumAmountCents: null, status: "requested", authorized: true, paid: false, confirmed: false, originalEndAt: END, endAt: "2026-10-14T19:30:00.000Z",
  expiresAt: iso(SERVER_NOW + WAIT_MS), note: null, autoApprove: false, createdAt: END, processing: false, escalated: false, ...extra });
const state = (extra: Record<string, unknown> = {}) => ({ enabled: true, autoApprove: false, timezone: "America/St_Johns", kitchenName: "Harbour Kitchen", currency: "CAD",
  options: [{ minutes: 60, endTime: "17:00", endAt: "2026-10-14T19:30:00.000Z", amountCents: 3000, kitchenGrossCents: 2875 }],
  earlyOptions: [], extraTime: null, visitId: null, endAt: END, startAt: "2026-10-14T16:30:00.000Z", beforeStart: false, checkoutAt: null, inSession: true, canRequest: true,
  hasSavedCard: true, unavailableReason: null, noTimeFree: false, history: [], serverNow: iso(SERVER_NOW), ...extra });
let body: unknown;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); api.apiGet.mockReset(); });

describe("chef: the request closes at the deadline", () => {
  const mount = (onMessage = vi.fn()) => render(<SessionExtensionRequest bookingId={10} kitchenName="Harbour Kitchen" timezone="America/St_Johns"
    className="min-h-11" moreTimeDraft="Hi, could I have more time?" onMessage={onMessage} />);
  it("turns the waiting box into 'didn’t answer in time' with the amount, Ask again and Message — never back to Need more time?", async () => {
    body = state({ history: [item()] });
    const onMessage = vi.fn();
    mount(onMessage);
    fireEvent.click(screen.getByRole("button", { name: "Need more time?" }));
    expect(await screen.findByTestId("extension-waiting")).toBeInTheDocument();
    const lapsed = await screen.findByTestId("extension-lapsed", undefined, { timeout: 2000 });
    expect(lapsed).toHaveTextContent("Harbour Kitchen didn’t answer in time. Your $30.00 hold is being released — you won’t be charged.");
    expect(screen.queryByTestId("extension-waiting")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Need more time?" })).not.toBeInTheDocument();
    fireEvent.click(within(lapsed).getByRole("button", { name: "Message Harbour Kitchen" }));
    expect(onMessage).toHaveBeenCalled();
  });
  it("a request already past its deadline when opened shows the same closed state, not 'Waiting'", async () => {
    body = state({ serverNow: iso(SERVER_NOW + 5_000), history: [item()] });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Need more time?" }));
    expect(await screen.findByTestId("extension-lapsed")).toBeInTheDocument();
    expect(screen.queryByTestId("extension-waiting")).not.toBeInTheDocument();
  });
  it("the poll that sees the server's expiry swaps the closed box for the existing expired copy (fake timers, server clock)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    try {
      body = state({ history: [item({ expiresAt: iso(SERVER_NOW + 90_000) })] });
      mount();
      fireEvent.click(screen.getByRole("button", { name: "Need more time?" }));
      await vi.advanceTimersByTimeAsync(100);
      expect(screen.getByTestId("extension-waiting")).toBeInTheDocument();
      // Server time passes the deadline: the box closes on its own, with no request to the server.
      const calls = fetchMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(91_000);
      expect(fetchMock.mock.calls.length).toBeGreaterThan(calls); // the polls ran, still reporting the request as open
      expect(screen.getByTestId("extension-lapsed")).toBeInTheDocument();
      body = state({ serverNow: iso(SERVER_NOW + 100_000), history: [item({ status: "expired", expiresAt: iso(SERVER_NOW + 90_000) })] });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(screen.getByTestId("extension-declined")).toHaveTextContent("Harbour Kitchen couldn’t extend this time. Your card wasn’t charged.");
      expect(screen.queryByRole("button", { name: "Need more time?" })).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });
  it("Ask again re-opens the options even though the server still lists the old request as open", async () => {
    body = state({ serverNow: iso(SERVER_NOW + 5_000), history: [item()] });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Need more time?" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask again" }));
    expect(await screen.findByTestId("extension-options")).toBeInTheDocument();
    expect(screen.queryByTestId("extension-lapsed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("extension-waiting")).not.toBeInTheDocument();
  });
});

describe("booking page: the request and offer close at the deadline", () => {
  it("manager: the request banner disappears at the deadline and history says it was not answered in time", async () => {
    body = state({ history: [item()] });
    render(<SessionExtensionsCard bookingId={10} manager chefName="Maya Chen" />);
    expect(await screen.findByTestId("extension-request-banner")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("extension-request-banner")).not.toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByTestId("extension-closed")).toHaveTextContent("Request closed — not answered in time");
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
  });
  it("manager: an unanswered offer reads 'Offer expired'", async () => {
    body = state({ history: [item({ kind: "offer", status: "offered", expiresAt: iso(SERVER_NOW + WAIT_MS) })] });
    render(<SessionExtensionsCard bookingId={10} manager chefName="Maya Chen" />);
    expect(await screen.findByText(/You offered Maya Chen 1 more hour/)).toBeInTheDocument();
    expect(await screen.findByTestId("extension-closed", undefined, { timeout: 2000 })).toHaveTextContent("Offer expired");
    expect(screen.queryByText(/Waiting for them to accept/)).not.toBeInTheDocument();
  });
  it("chef: 'Accept & pay' disappears when the offer expires", async () => {
    body = state({ history: [item({ kind: "offer", status: "offered", expiresAt: iso(SERVER_NOW + WAIT_MS) })] });
    render(<SessionExtensionsCard bookingId={10} manager={false} chefName="Maya" />);
    const offer = await screen.findByTestId("extension-offer");
    expect(within(offer).getByRole("button", { name: /Accept/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("extension-offer")).not.toBeInTheDocument(), { timeout: 2000 });
    expect(screen.queryByRole("button", { name: /Accept/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("extension-closed")).toHaveTextContent("Harbour Kitchen’s offer expired.");
  });
  it("chef: a waiting request becomes the 'didn’t answer in time' line with the amount, and a Message button", async () => {
    body = state({ history: [item()] });
    render(<SessionExtensionsCard bookingId={10} manager={false} chefName="Maya" />);
    expect(await screen.findByText("Waiting for Harbour Kitchen · we’ll let you know")).toBeInTheDocument();
    const closed = await screen.findByTestId("extension-closed", undefined, { timeout: 2000 });
    expect(closed).toHaveTextContent("Harbour Kitchen didn’t answer in time. Your $30.00 hold is being released — you won’t be charged.");
    expect(screen.queryByText("Waiting for Harbour Kitchen · we’ll let you know")).not.toBeInTheDocument();
    expect(within(closed).getByRole("button", { name: /Message/ })).toBeInTheDocument();
  });
  it("after the server records the expiry the chef line stays (no flicker), reading 'was released'", async () => {
    body = state({ serverNow: iso(SERVER_NOW + 5_000), history: [item({ status: "expired" })] });
    render(<SessionExtensionsCard bookingId={10} manager={false} chefName="Maya" />);
    expect(await screen.findByTestId("extension-closed")).toHaveTextContent("Your $30.00 hold was released — you weren’t charged.");
  });
  it("does not call a withdrawn request 'unanswered' (expired before its deadline)", async () => {
    body = state({ history: [item({ status: "expired", expiresAt: iso(SERVER_NOW + 600_000) })] });
    const { container } = render(<SessionExtensionsCard bookingId={10} manager chefName="Maya Chen" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("extension-closed")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/not answered in time/);
  });
});

describe("manager dashboard: pending requests", () => {
  it("drops a request at its deadline using the server clock the response carries", async () => {
    api.apiGet.mockResolvedValue({ serverNow: iso(SERVER_NOW), requests: [{ ...item(), bookingId: 10, kitchenName: "Harbour Kitchen", timezone: "America/St_Johns", chefName: "Maya Chen" }] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SessionExtensionRequests /></QueryClientProvider>);
    expect(await screen.findByTestId("extension-requests")).toHaveTextContent(/Maya Chen asked for/);
    await waitFor(() => expect(screen.queryByTestId("extension-requests")).not.toBeInTheDocument(), { timeout: 2000 });
  });
});
