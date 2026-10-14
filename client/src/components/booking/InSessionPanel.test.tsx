vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@shared/i18n/locales/en-CA/chef.json";
import { InSessionPanel, sessionPhase } from "./InSessionPanel";

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer fixture", "Content-Type": "application/json" }) }));
vi.mock("@/components/chat/UnifiedChatView", () => ({
  default: (props: any) => <div data-testid="chat" data-conversation={props.initialConversationId}>{props.initialDraft}</div>,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({
  i18n: { language: "en-CA", resolvedLanguage: "en-CA" },
  t: (key: string, options?: any) => {
    let value = (en as Record<string, string>)[key] || (typeof options === "string" ? options : options?.defaultValue) || key;
    for (const [name, replacement] of Object.entries(options || {})) value = value.replaceAll(`{${name}}`, String(replacement));
    return value;
  },
}) }));

const NOW = Date.parse("2026-10-13T15:00:00Z");
const END = "2026-10-13T17:00:00Z"; // 2:30 p.m. Newfoundland Daylight Time
const MIN = 60_000;
let onStartCheckout: ReturnType<typeof vi.fn>;
let onRefresh: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

function mount(props: Partial<React.ComponentProps<typeof InSessionPanel>> = {}) {
  return render(<InSessionPanel bookingId={901} chefId={3} kitchenName="Test kitchen" timezone="America/St_Johns"
    scheduledStartAt="2026-10-13T13:00:00Z" scheduledEndAt={END} canCheckout onStartCheckout={onStartCheckout} onRefresh={onRefresh}
    departureInstructions="Lock the side entrance." requiredTaskCount={2} {...props} />);
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(NOW);
  onStartCheckout = vi.fn(); onRefresh = vi.fn();
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (String(url).endsWith("/conversation")) return new Response(JSON.stringify({ conversationId: "conv-1", path: "/dashboard" }));
    return new Response(JSON.stringify({ id: 1 }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("in-session panel", () => {
  it("classifies the phase from the saved booked end", () => {
    const end = Date.parse(END);
    expect(sessionPhase(end - 16 * MIN, end)).toBe("active");
    expect(sessionPhase(end - 15 * MIN, end)).toBe("ending");
    expect(sessionPhase(end, end)).toBe("ended");
  });

  it("shows kitchen-local end with a friendly zone and a countdown while more than 15 minutes remain", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Test kitchen" })).toBeInTheDocument();
    expect(screen.getByText(/In session · ends 2:30\s?p\.m\. Newfoundland Time/)).toBeInTheDocument();
    expect(screen.queryByText(/St_Johns/)).not.toBeInTheDocument();
    expect(screen.getByText("2 h 0 min left")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("button", { name: "Need more time?" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start check-out" })).not.toBeInTheDocument();
  });

  it("switches to Start check-out in the last 15 minutes and keeps counting locally", async () => {
    mount();
    await advance(105 * MIN);
    expect(screen.getByText("15 min left")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Need more time?" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start check-out" }));
    expect(onStartCheckout).toHaveBeenCalledTimes(1);
    await advance(10 * MIN);
    expect(screen.getByText("5 min left")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled(); // the countdown never polls
  });

  it("says the booked time ended and still offers check-out", async () => {
    mount();
    await advance(121 * MIN);
    expect(screen.getAllByText("Your booked time ended").length).toBeGreaterThan(0);
    expect(screen.getByText("Check out now to close your visit.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start check-out" }));
    expect(onStartCheckout).toHaveBeenCalled();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("announces the countdown at minute granularity only", async () => {
    mount();
    const live = screen.getByRole("status");
    expect(live).toHaveTextContent("2 h 0 min left");
    await advance(30_000);
    expect(live).toHaveTextContent("2 h 0 min left");
    await advance(30_000);
    expect(live).toHaveTextContent("1 h 59 min left");
  });

  it("refreshes visit data on window focus, not on a timer", async () => {
    mount();
    await advance(5 * MIN);
    expect(onRefresh).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("states that leaving early gives no refund and goes to the departure flow", () => {
    mount();
    expect(screen.getByText("Leaving early does not refund unused booked time.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave early / check out now" }));
    expect(onStartCheckout).toHaveBeenCalledTimes(1);
  });

  it("hides check-out actions when the departure flow cannot accept them", () => {
    mount({ canCheckout: false });
    expect(screen.queryByRole("button", { name: "Leave early / check out now" })).not.toBeInTheDocument();
  });

  it("previews departure instructions and required tasks, and lists Local Cooks help", () => {
    mount();
    expect(screen.getByText("Lock the side entrance.")).toBeInTheDocument();
    expect(screen.getByText("Required tasks before check-out: 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /support@localcooks.ca/ })).toHaveAttribute("href", "mailto:support@localcooks.ca");
  });

  it("opens the booking conversation with a prefilled request for more time", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Need more time?" }));
    const chat = await screen.findByTestId("chat");
    expect(fetchMock).toHaveBeenCalledWith("/api/bookings/901/conversation", expect.objectContaining({ method: "POST" }));
    expect(chat).toHaveAttribute("data-conversation", "conv-1");
    expect(chat).toHaveTextContent(/Hi, could I have more time at Test kitchen\? My booking ends at 2:30\s?p\.m\./);
  });

  it("opens the conversation without a draft from Message kitchen", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Message kitchen" }));
    expect(await screen.findByTestId("chat")).toHaveTextContent("");
  });

  it("reports a problem with safety listed first and submits the chosen category", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("radio").map(radio => (radio as HTMLInputElement).value))
      .toEqual(["safety", "access", "equipment", "cleanliness", "other"]);
    const send = within(dialog).getByRole("button", { name: "Send report" });
    expect(send).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Equipment" }));
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "The walk-in cooler is not cooling" } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(screen.getByText(/Report sent/)).toBeInTheDocument());
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/commitment-problems/booking/901"))!;
    expect(post[1].method).toBe("POST");
    expect(JSON.parse(post[1].body)).toMatchObject({ category: "equipment", description: "The walk-in cooler is not cooling" });
    expect(JSON.parse(post[1].body).requestKey).toMatch(/^[a-zA-Z0-9-]{16,80}$/);
  });

  it("keeps the text and shows the error when the report fails", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: "Temporary failure" }), { status: 500 }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Safety" }));
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Someone slipped on the wet floor" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Temporary failure");
    expect(within(dialog).getByRole("textbox")).toHaveValue("Someone slipped on the wet floor");
  });

  it("uses 44px minimum tap targets for its actions", () => {
    mount();
    for (const name of ["Need more time?", "Leave early / check out now", "Message kitchen", "Report a problem"]) {
      expect(screen.getByRole("button", { name }).className).toContain("min-h-11");
    }
  });
});
