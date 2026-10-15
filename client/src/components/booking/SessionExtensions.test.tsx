import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("react-i18next", async () => { const { useBookingTranslation } = await import("@/test/booking-i18n"); return { useTranslation: (ns: any) => useBookingTranslation(ns) }; });
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ "Content-Type": "application/json" }) }));
import { SessionExtensionRequest } from "./SessionExtensionRequest";
import { SessionExtensionsCard } from "./SessionExtensionsCard";
import { defaultFreeChoice } from "@/lib/session-extensions";

const END = "2026-10-14T18:30:00.000Z"; // 4:00 p.m. Newfoundland Daylight Time
const item = (extra: Record<string, unknown> = {}) => ({ id: 5, kind: "request", minutes: 60, amountCents: 3000, free: false, kitchenGrossCents: 2875, actualMinutes: null,
  maximumAmountCents: null, status: "requested", authorized: true, paid: false, confirmed: false, originalEndAt: END, endAt: "2026-10-14T19:30:00.000Z",
  expiresAt: "2026-10-14T18:20:00.000Z", note: null, autoApprove: false, createdAt: END, processing: false, escalated: false, ...extra });
const state = (extra: Record<string, unknown> = {}) => ({ enabled: true, autoApprove: false, timezone: "America/St_Johns", kitchenName: "Harbour Kitchen", currency: "CAD",
  options: [{ minutes: 30, endTime: "16:30", endAt: "2026-10-14T19:00:00.000Z", amountCents: 1501, kitchenGrossCents: 1438 },
    { minutes: 60, endTime: "17:00", endAt: "2026-10-14T19:30:00.000Z", amountCents: 3000, kitchenGrossCents: 2875 }],
  earlyOptions: [], extraTime: null, visitId: null, endAt: END, startAt: "2026-10-14T16:30:00.000Z", beforeStart: false, checkoutAt: null, inSession: true, canRequest: true,
  hasSavedCard: true, unavailableReason: null, noTimeFree: false, history: [], serverNow: "2026-10-14T18:05:00.000Z", ...extra });
let responses: Array<{ match: RegExp; method?: string; body: unknown; status?: number }>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  responses = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const found = responses.find(entry => entry.match.test(String(url)) && (!entry.method || entry.method === (init?.method || "GET")));
    return new Response(JSON.stringify(found?.body ?? {}), { status: found?.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) }));

describe("chef: Need more time?", () => {
  const mount = (onMessage = vi.fn(), onExtended = vi.fn()) => render(<SessionExtensionRequest bookingId={10} kitchenName="Harbour Kitchen" timezone="America/St_Johns"
    className="min-h-11" moreTimeDraft="Hi, could I have more time?" onMessage={onMessage} onExtended={onExtended} />);
  it("loads nothing until tapped, then shows priced options with the new end", async () => {
    responses.push({ match: /\/extensions$/, method: "GET", body: state() });
    mount();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Need more time?" }));
    expect(await screen.findByText(/until 4:30\s?p\.m\./)).toBeInTheDocument();
    expect(screen.getByText(/Request until 4:30\s?p\.m\. · up to \$15\.01/)).toBeInTheDocument();
    expect(screen.getByText("You’re only charged if Harbour Kitchen approves with a charge.")).toBeInTheDocument();
    expect(screen.getByText("Extra time can’t be refunded once it’s added.")).toBeInTheDocument();
  });
  it("Choose a time…: any free end in 15-minute steps, with a summary before the chef confirms", async () => {
    const options = [15, 30, 45].map(minutes => ({ minutes, endTime: "", endAt: new Date(Date.parse(END) + minutes * 60_000).toISOString(),
      amountCents: Math.ceil(minutes / 30) * 1500, kitchenGrossCents: 0 }))
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ options }) },
      { match: /\/extensions$/, method: "POST", body: { extension: item({ minutes: 45, amountCents: 3000 }) } })
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Need more time?" }))
    fireEvent.click(await screen.findByRole("button", { name: "Choose a time…" }))
    fireEvent.change(screen.getByLabelText("New end time"), { target: { value: "45" } })
    expect(screen.getByTestId("extension-custom-summary")).toHaveTextContent(/^Until 4:45\s?p\.m\. · \$30\.00$/)
    fireEvent.click(within(screen.getByTestId("extension-custom")).getByRole("button", { name: /Request until 4:45\s?p\.m\. · up to \$30\.00/ }))
    await waitFor(() => expect(posts()[0].body).toMatchObject({ kind: "request", minutes: 45, expectedAmountCents: 3000 }))
  });
  it("one tap asks; it shows the waiting state", async () => {
    responses.push({ match: /\/extensions$/, method: "GET", body: state() }, { match: /\/extensions$/, method: "POST", body: { extension: item() } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Need more time?" }));
    fireEvent.click(await screen.findByRole("button", { name: /1 more hour, until 5:00/ }));
    expect(await screen.findByText("Waiting for Harbour Kitchen · we’ll let you know")).toBeInTheDocument();
    expect(posts()[0].body).toMatchObject({ kind: "request", minutes: 60, expectedEndAt: END, expectedAmountCents: 3000 });
    expect(posts()[0].body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("confirmed (instant mode) says until when and refreshes the visit", async () => {
    const onExtended = vi.fn();
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ autoApprove: true }) },
      { match: /\/extensions$/, method: "POST", body: { extension: item({ status: "approved", confirmed: true, paid: true }) } });
    mount(vi.fn(), onExtended);
    fireEvent.click(screen.getByRole("button", { name: "Need more time?" }));
    expect(await screen.findByText(/confirmed right away/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /1 more hour/ }));
    expect(await screen.findByText(/You have until 5:00\s?p\.m\./)).toBeInTheDocument();
    expect(onExtended).toHaveBeenCalled();
  });
  it("when the kitchen is booked right after, it says so and offers a message", async () => {
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ options: [], noTimeFree: true }) });
    const onMessage = vi.fn();
    mount(onMessage);
    fireEvent.click(screen.getByRole("button", { name: "Need more time?" }));
    expect(await screen.findByText("The kitchen is booked right after you. Message Harbour Kitchen.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Message Harbour Kitchen" }));
    expect(onMessage).toHaveBeenCalled();
  });
  it("outside the last hour (or when unavailable) it opens the conversation with the draft, as before", async () => {
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ canRequest: false }) });
    const onMessage = vi.fn();
    mount(onMessage);
    fireEvent.click(screen.getByRole("button", { name: "Need more time?" }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith("Hi, could I have more time?"));
  });
  it("a declined request says the card wasn't charged", async () => {
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ history: [item({ status: "declined" })] }) });
    responses.push({ match: /\/extensions$/, method: "POST", body: { extension: item({ status: "declined" }) } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Need more time?" }));
    fireEvent.click(await screen.findByRole("button", { name: /1 more hour/ }));
    expect(await screen.findByText("Harbour Kitchen couldn’t extend this time. Your card wasn’t charged.")).toBeInTheDocument();
  });
});

describe("booking page: extra time", () => {
  it("manager sees the request banner and approves with a POST", async () => {
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ history: [item()] }) },
      { match: /\/decision$/, method: "POST", body: { extension: item({ status: "approved", confirmed: true }) } });
    render(<SessionExtensionsCard bookingId={10} manager chefName="Maya Chen" />);
    const banner = await screen.findByTestId("extension-request-banner");
    expect(banner).toHaveTextContent(/Maya Chen asked for 1 more hour \(until 5:00\s?p\.m\.\) · you’d get \$28\.75/);
    expect(within(banner).getByRole("button", { name: "Approve for free" })).toBeInTheDocument();
    expect(within(banner).getByRole("button", { name: "Decline" })).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole("button", { name: "Approve · charge $30.00" }));
    await waitFor(() => expect(posts()[0]).toMatchObject({ url: "/api/bookings/10/extensions/5/decision", body: { action: "approve" } }));
  });
  it("manager approves a chef request for free with a POST", async () => {
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ history: [item()] }) },
      { match: /\/decision$/, method: "POST", body: { extension: item({ status: "approved", confirmed: true, free: true }) } });
    render(<SessionExtensionsCard bookingId={10} manager chefName="Maya Chen" />);
    fireEvent.click(within(await screen.findByTestId("extension-request-banner")).getByRole("button", { name: "Approve for free" }));
    await waitFor(() => expect(posts()[0].body).toEqual({ action: "approve_free" }));
  });
  it("Offer more time: Free is preselected for 30 minutes, Charge for longer, and the manager can switch", async () => {
    responses.push({ match: /\/extensions$/, method: "GET", body: state() }, { match: /\/extensions$/, method: "POST", body: { extension: item({ kind: "offer", free: true }) } });
    render(<SessionExtensionsCard bookingId={10} manager chefName="Maya Chen" />);
    fireEvent.click(await screen.findByRole("button", { name: "Offer more time" }));
    fireEvent.click(screen.getByRole("button", { name: /1 more hour · until/ }));
    expect(screen.getByRole("radio", { name: /Charge for the extra time · \$30\.00/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /30 more minutes · until/ }));
    expect(screen.getByRole("radio", { name: "Free" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Charge for the extra time/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Free" }));
    fireEvent.click(screen.getByRole("button", { name: "Give it free" }));
    await waitFor(() => expect(posts()[0].body).toMatchObject({ kind: "offer", minutes: 30, free: true, expectedAmountCents: 0, expectedEndAt: END }));
    expect([defaultFreeChoice(30), defaultFreeChoice(45)]).toEqual([true, false]);
  });
  it("Let them start early: picks an earlier start and sends a paid offer", async () => {
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ inSession: false, beforeStart: true,
      earlyOptions: [{ minutes: 60, startTime: "13:00", startAt: "2026-10-14T15:30:00.000Z", defaultFree: false, billedMinutes: 60, amountCents: 3000, kitchenGrossCents: 2875 }] }) },
      { match: /\/extensions$/, method: "POST", body: { extension: item({ kind: "early_start", status: "offered" }) } });
    render(<SessionExtensionsCard bookingId={10} manager chefName="Maya Chen" />);
    fireEvent.click(await screen.findByRole("button", { name: "Let them start early" }));
    fireEvent.click(screen.getByRole("button", { name: /Start at 1:00\s?p\.m\. \(1 hour early\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send offer · $30.00" }));
    await waitFor(() => expect(posts()[0].body).toMatchObject({ kind: "early_start", minutes: 60, free: false, expectedAmountCents: 3000, expectedEndAt: "2026-10-14T16:30:00.000Z" }));
  });
  it("chef pays an extra-time charge in one tap, or tells Local Cooks it isn't right", async () => {
    const charge = item({ kind: "extra_time", status: "offered", minutes: 30, actualMinutes: 40, amountCents: 1501, note: "Fryer cleanup" });
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ inSession: false, canRequest: false, history: [charge] }) },
      { match: /\/decision$/, method: "POST", body: { extension: { ...charge, status: "disputed" } } });
    render(<SessionExtensionsCard bookingId={10} manager={false} chefName="" />);
    const card = await screen.findByTestId("extension-charge");
    expect(card).toHaveTextContent("You stayed 40 minutes past your booking at Harbour Kitchen. They’ve asked for $15.01 for the extra time.");
    // D4: a lowered amount is never paired with a length, so it can't read as a rate.
    expect(card).not.toHaveTextContent("30 minutes of extra time");
    expect(within(card).getByRole("button", { name: "Pay $15.01" })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "This isn’t right" }));
    const send = within(card).getByRole("button", { name: "Send to Local Cooks" });
    expect(send).toBeDisabled();
    fireEvent.change(within(card).getByRole("textbox"), { target: { value: "I left at 4" } });
    fireEvent.click(send);
    await waitFor(() => expect(posts()[0].body).toEqual({ action: "dispute", note: "I left at 4" }));
  });
  it("manager charge form is prefilled and can only be lowered", async () => {
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ inSession: false, extraTime: { actualMinutes: 40, minutes: 60, maximumAmountCents: 3000, amountCents: 3000, kitchenGrossCents: 2875 } }) });
    render(<SessionExtensionsCard bookingId={10} manager chefName="Maya Chen" />);
    fireEvent.click(await screen.findByRole("button", { name: "Charge for extra time" }));
    const amount = screen.getByLabelText("Amount (you can lower it)") as HTMLInputElement;
    expect(amount.value).toBe("30.00");
    fireEvent.change(amount, { target: { value: "31" } });
    expect(screen.getByText("The charge can’t be more than $30.00.")).toBeInTheDocument();
    fireEvent.change(amount, { target: { value: "15" } });
    expect(screen.getByRole("button", { name: /Send \$15\.00 to Maya Chen/ })).toBeDisabled(); // note required
  });
  it("shows free grants in history with who gave them", async () => {
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ inSession: false, history: [item({ kind: "early_start", free: true, minutes: 30, status: "approved", confirmed: true, amountCents: 0 })] }) });
    render(<SessionExtensionsCard bookingId={10} manager={false} chefName="" />);
    expect(await screen.findByText("Harbour Kitchen let you start 30 minutes early — no charge")).toBeInTheDocument();
  });
  it("the manager reads their own free grants in the first person; the chef reads the kitchen's name", async () => {
    const history = [item({ id: 6, kind: "early_start", free: true, minutes: 30, status: "approved", confirmed: true, amountCents: 0 }),
      item({ id: 7, kind: "offer", free: true, minutes: 30, status: "approved", confirmed: true, amountCents: 0, endAt: "2026-10-14T19:00:00.000Z" })]
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ inSession: false, history }) })
    const manager = render(<SessionExtensionsCard bookingId={10} manager chefName="Maya Chen" />)
    expect(await screen.findByText("You let Maya Chen start 30 minutes early — no charge")).toBeInTheDocument()
    expect(screen.getByText(/^You gave Maya Chen 30 more minutes \(until 4:30\s?p\.m\.\) — no charge$/)).toBeInTheDocument()
    expect(screen.queryByText(/Harbour Kitchen let/)).not.toBeInTheDocument()
    manager.unmount()
    render(<SessionExtensionsCard bookingId={10} manager={false} chefName="" />)
    expect(await screen.findByText(/^Harbour Kitchen gave you 30 more minutes \(until 4:30\s?p\.m\.\) — no charge$/)).toBeInTheDocument()
  });
  it("Offer more time: quick picks as chips plus Choose a time… for any free end, with a summary and the right free copy", async () => {
    const options = [15, 30, 45, 60, 75].map(minutes => ({ minutes, endTime: "", endAt: new Date(Date.parse(END) + minutes * 60_000).toISOString(),
      amountCents: Math.ceil(minutes / 30) * 1500, kitchenGrossCents: 0 }))
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ options }) }, { match: /\/extensions$/, method: "POST", body: { extension: item({ kind: "offer" }) } })
    render(<SessionExtensionsCard bookingId={10} manager chefName="Maya Chen" />)
    fireEvent.click(await screen.findByRole("button", { name: "Offer more time" }))
    // Only the quick picks are chips; 15/45/75 live in the list.
    expect(screen.getByRole("button", { name: /30 more minutes · until/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /45 min more/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Choose a time…" }))
    const list = screen.getByRole("combobox", { name: "New end time" })
    expect(Array.from((list as HTMLSelectElement).options).map(option => option.value)).toEqual(["", "15", "30", "45", "60", "75"])
    fireEvent.change(list, { target: { value: "75" } })
    expect(screen.getByTestId("extension-pick-summary")).toHaveTextContent(/^Until 5:15\s?p\.m\. · \$45\.00$/)
    fireEvent.click(screen.getByRole("radio", { name: "Free" }))
    expect(screen.getByTestId("extension-pick-summary")).toHaveTextContent(/· Free$/)
    expect(screen.getByText(/^Maya Chen gets until 5:15\s?p\.m\. right away — we’ll let them know\.$/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Give it free" }))
    await waitFor(() => expect(posts()[0].body).toMatchObject({ kind: "offer", minutes: 75, free: true, expectedAmountCents: 0 }))
  });
  it("Let them start early: Start now first, never a past time, and any later step from the list", async () => {
    responses.push({ match: /\/extensions$/, method: "GET", body: state({ inSession: false, beforeStart: true, earlyOptions: [
      { minutes: 60, startTime: "13:00", startAt: "2026-10-14T15:30:00.000Z", defaultFree: false, billedMinutes: 60, amountCents: 3000, kitchenGrossCents: 0, startNow: true },
      { minutes: 15, startTime: "13:45", startAt: "2026-10-14T16:15:00.000Z", defaultFree: true, billedMinutes: 30, amountCents: 1501, kitchenGrossCents: 0, startNow: false },
      { minutes: 45, startTime: "13:15", startAt: "2026-10-14T15:45:00.000Z", defaultFree: false, billedMinutes: 60, amountCents: 3000, kitchenGrossCents: 0, startNow: false }] }) },
      { match: /\/extensions$/, method: "POST", body: { extension: item({ kind: "early_start", status: "approved", free: true, confirmed: true }) } })
    render(<SessionExtensionsCard bookingId={10} manager chefName="Maya Chen" />)
    fireEvent.click(await screen.findByRole("button", { name: "Let them start early" }))
    const chips = within(screen.getByRole("group", { name: "New start time" })).getAllByRole("button").map(button => button.textContent)
    expect(chips[0]).toBe("Start now")
    fireEvent.click(screen.getByRole("button", { name: "Choose a time…" }))
    fireEvent.change(screen.getByRole("combobox", { name: "New start time" }), { target: { value: "15" } })
    expect(screen.getByTestId("extension-pick-summary")).toHaveTextContent(/^Starts at 1:45\s?p\.m\. · Free$/)
    expect(screen.getByText(/^Maya Chen can start at 1:45\s?p\.m\. right away — we’ll let them know\.$/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Start now" }))
    expect(screen.getByTestId("extension-pick-summary")).toHaveTextContent(/^Starts at 1:00\s?p\.m\. · \$30\.00$/)
    fireEvent.click(screen.getByRole("button", { name: "Send offer · $30.00" }))
    await waitFor(() => expect(posts()[0].body).toMatchObject({ kind: "early_start", minutes: 60, free: false, expectedAmountCents: 3000 }))
  });
  it("renders nothing when extra time can't be loaded", async () => {
    responses.push({ match: /\/extensions$/, method: "GET", body: { error: "nope" }, status: 500 });
    const { container } = render(<SessionExtensionsCard bookingId={10} manager chefName="Maya Chen" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
