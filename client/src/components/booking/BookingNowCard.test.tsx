import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("react-i18next", async () => { const { useBookingTranslation } = await import("@/test/booking-i18n"); return { useTranslation: (ns: any) => useBookingTranslation(ns) }; });
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ "Content-Type": "application/json" }), apiClient: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/components/ui/smart-image", () => ({ SmartImage: (props: { src: string; className?: string }) => <img src={props.src} className={props.className} alt="" /> }));
vi.mock("./DamageClaimPayment", () => ({ default: () => <div role="dialog">Pay this claim</div> }));
vi.mock("@/hooks/useSessionFileUpload", () => ({ useSessionFileUpload: () => ({ uploadFile: vi.fn(), isUploading: false }) }));
import { BookingNowCard, NowClaimRows, StatusPill } from "./BookingNowCard";
import { SessionExtensionsCard } from "./SessionExtensionsCard";
import type { DamageClaimCardData } from "@/lib/damage-claims";

const claim = (extra: Partial<DamageClaimCardData> = {}): DamageClaimCardData => ({ id: 7, referenceCode: "DC-7", bookingId: 5, visitId: null, chefId: 1, managerId: 2,
  status: "submitted", claimVersion: 2, description: "Burnt pan", amountCents: 4500, claimedAmountCents: 4500, lines: [], visitEvidence: { before: [], after: [], kitchenName: "Harbour Kitchen", timezone: "America/St_Johns" } as never,
  chefResponse: null, deadline: "2030-01-18T15:30:00Z", upheldAt: null, publicMessage: null, kitchenPaid: false, fundedBy: "chef", chefOwes: true, chefVisible: true,
  reviewRequest: null, kitchenReply: null, paymentBusy: false, compensationPending: false, evidence: [], history: [], ...extra });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Now card shell", () => {
  it("one pill, one sentence, the secondary links and the chef's kitchen photo (decorative)", () => {
    render(<BookingNowCard reference="KB-5" bookedOn="Booked Jan 10, 2030" title="Harbour Kitchen" heroImage="/k.jpg" actions={null} whenLine="Tue, Jan 15 · 10:00 a.m.–12:00 p.m. · 2 hrs"
      pill={{ label: "Confirmed", tone: "blue" }} sentence="Your arrival details are ready." labels={{ header: "Booking summary", secondary: "Quick actions" }}
      secondary={[{ key: "a", label: "See arrival details", onSelect: vi.fn() }, { key: "b", label: "Add to calendar", onSelect: vi.fn() }]} />);
    expect(screen.getAllByTestId("booking-status-pill")).toHaveLength(1);
    expect(screen.getByTestId("booking-status-pill")).toHaveAttribute("data-tone", "blue");
    expect(screen.getByTestId("booking-next-step")).toHaveTextContent("Your arrival details are ready.");
    expect(within(screen.getByTestId("now-secondary")).getAllByRole("button")).toHaveLength(2);
    for (const image of Array.from(document.querySelectorAll("img"))) expect(image).toHaveAttribute("alt", "");
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("text-[22px]");
  });
  it("renders no secondary row when there is nothing to offer", () => {
    render(<BookingNowCard reference="KB-5" bookedOn="Booked" title="Ada" actions={null} whenLine="when" pill={{ label: "Completed", tone: "neutral" }}
      sentence="This visit is closed." secondary={[]} labels={{ header: "h", secondary: "s" }} />);
    expect(screen.queryByTestId("now-secondary")).not.toBeInTheDocument();
  });
  it("status pills share one tone set with a leading dot", () => {
    render(<StatusPill tone="green">In session</StatusPill>);
    expect(screen.getByTestId("booking-status-pill").querySelector("span[aria-hidden]")).toHaveClass("bg-emerald-500");
  });
});

describe("claims in the Now card (§1.5)", () => {
  it("an existing claim sheet says Your claim and shows the Local Cooks request once", () => {
    render(<NowClaimRows claims={[claim({ status: "awaiting_kitchen", chefVisible: false, reviewRequest: "Add the invoice", publicMessage: "Add the invoice" })]}
      manager chefName="Ada" timezone="America/St_Johns" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reply to Local Cooks" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Your claim · $45.00" })).toBeInTheDocument();
    expect(within(dialog).getAllByText("Add the invoice")).toHaveLength(1);
  });
  it("chef: a sent claim is an attention row with Pay $ and Dispute; the first Pay may be the page's one primary", () => {
    render(<NowClaimRows claims={[claim()]} manager={false} chefName="Ada" timezone="America/St_Johns" allowPrimary onChanged={vi.fn()} />);
    const row = screen.getByTestId("claim-attention");
    expect(row).toHaveTextContent("Harbour Kitchen reported damage or extra cleaning: $45.00");
    expect(row).toHaveTextContent(/Pay or dispute by Jan 18, 12:00\s?p\.m\./);
    expect(within(row).getByRole("button", { name: "Pay $45.00" })).toHaveAttribute("data-primary-action", "true");
    expect(within(row).getByRole("button", { name: "Dispute" })).not.toHaveAttribute("data-primary-action");
  });
  it("chef: Pay is an outline button when the page already has a primary", () => {
    render(<NowClaimRows claims={[claim()]} manager={false} chefName="Ada" timezone="America/St_Johns" onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Pay $45.00" })).not.toHaveAttribute("data-primary-action");
  });
  it("chef: nothing claim-related while Local Cooks reviews it first, or once it is closed", () => {
    const { container } = render(<NowClaimRows claims={[claim({ status: "in_review", chefVisible: false }), claim({ id: 8, status: "awaiting_kitchen" }), claim({ id: 9, status: "charge_succeeded" })]}
      manager={false} chefName="Ada" timezone="America/St_Johns" onChanged={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("chef: an upheld claim says what happens if it stays unpaid, without a Dispute button", () => {
    render(<NowClaimRows claims={[claim({ status: "approved", upheldAt: "2030-01-19T00:00:00Z" })]} manager={false} chefName="Ada" timezone="America/St_Johns" onChanged={vi.fn()} />);
    expect(screen.getByTestId("claim-attention")).toHaveTextContent("Pay by Jan 25 to keep booking.");
    expect(screen.queryByRole("button", { name: "Dispute" })).not.toBeInTheDocument();
  });
  it("chef: Pay opens the payment step", async () => {
    render(<NowClaimRows claims={[claim()]} manager={false} chefName="Ada" timezone="America/St_Johns" onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pay $45.00" }));
    expect(await screen.findByText("Pay this claim")).toBeInTheDocument();
  });
  it("manager: in review is one line; waiting for the kitchen is an attention row with Reply", () => {
    render(<NowClaimRows claims={[claim({ status: "in_review" }), claim({ id: 8, status: "awaiting_kitchen", reviewRequest: "Please add the receipt." })]} manager chefName="Ada" timezone="America/St_Johns" onChanged={vi.fn()} />);
    expect(screen.getByTestId("claim-line")).toHaveTextContent("Local Cooks is reviewing your claim for $45.00. We’ll update you within 2 business days.");
    const row = screen.getByTestId("claim-attention");
    expect(row).toHaveTextContent("Local Cooks asked for more information about your claim.");
    expect(row).toHaveTextContent("“Please add the receipt.”");
    expect(within(row).getByRole("button", { name: "Reply to Local Cooks" })).toBeInTheDocument();
    expect(document.querySelector("[data-primary-action]")).toBeNull();
  });
  it("manager: a claim sent to the chef says the payout isn't affected", () => {
    render(<NowClaimRows claims={[claim()]} manager chefName="Ada" timezone="America/St_Johns" onChanged={vi.fn()} />);
    expect(screen.getByTestId("claim-line")).toHaveTextContent(/^Sent to Ada\. They have until Jan 18, 12:00\s?p\.m\. to pay or dispute\. Your payout isn’t affected\./);
  });
});

// Extra time in the Now card: answers only, tools reported to the page's secondary row, history elsewhere.
const END = "2026-10-14T18:30:00.000Z";
const item = (extra: Record<string, unknown> = {}) => ({ id: 5, kind: "request", minutes: 60, amountCents: 3000, free: false, kitchenGrossCents: 2875, actualMinutes: null,
  maximumAmountCents: null, status: "requested", authorized: true, paid: false, confirmed: false, originalEndAt: END, endAt: "2026-10-14T19:30:00.000Z",
  expiresAt: "2026-10-14T18:20:00.000Z", note: null, autoApprove: false, createdAt: END, processing: false, escalated: false, ...extra });
const state = (extra: Record<string, unknown> = {}) => ({ enabled: true, autoApprove: false, timezone: "America/St_Johns", kitchenName: "Harbour Kitchen", currency: "CAD",
  options: [{ minutes: 30, endTime: "16:30", endAt: "2026-10-14T19:00:00.000Z", amountCents: 1501, kitchenGrossCents: 1438 }],
  earlyOptions: [], extraTime: null, visitId: null, endAt: END, startAt: "2026-10-14T16:30:00.000Z", beforeStart: false, checkoutAt: null, inSession: true, canRequest: true,
  hasSavedCard: true, unavailableReason: null, noTimeFree: false, history: [], serverNow: "2026-10-14T18:05:00.000Z", ...extra });
let body: unknown;
beforeEach(() => { body = state(); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body)))); });

describe("SessionExtensionsCard variants", () => {
  it("chef, reduced charge: the amount is never paired with a length (D4), and Pay can be the one primary", async () => {
    body = state({ inSession: false, history: [item({ kind: "extra_time", status: "offered", minutes: 90, actualMinutes: 73, amountCents: 1500, note: "Cleaning ran over, no worries." })] });
    render(<SessionExtensionsCard variant="now" bookingId={10} manager={false} chefName="" allowPrimary />);
    const row = await screen.findByTestId("extension-charge");
    expect(row).toHaveTextContent("You stayed 73 minutes past your booking at Harbour Kitchen. They’ve asked for $15.00 for the extra time.");
    expect(row).not.toHaveTextContent("90 minutes of extra time");
    expect(within(row).getByRole("button", { name: "Pay $15.00" })).toHaveAttribute("data-primary-action", "true");
    expect(within(row).getByRole("button", { name: "This isn’t right" })).not.toHaveAttribute("data-primary-action");
  });
  it("manager in session: no tool buttons in the card; the tools are reported for the secondary row and open in a sheet", async () => {
    const onTools = vi.fn();
    const { rerender } = render(<SessionExtensionsCard variant="now" bookingId={10} manager chefName="Maya Chen" onToolsChange={onTools} />);
    await waitFor(() => expect(onTools).toHaveBeenLastCalledWith(["offer"]));
    expect(screen.queryByRole("button", { name: "Offer more time" })).not.toBeInTheDocument();
    rerender(<SessionExtensionsCard variant="now" bookingId={10} manager chefName="Maya Chen" onToolsChange={onTools} tool="offer" />);
    expect(await screen.findByTestId("extension-offer-picker")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("Offer more time");
  });
  it("manager request: an attention row whose Approve is the one primary only when the page has none", async () => {
    body = state({ history: [item()] });
    render(<SessionExtensionsCard variant="now" bookingId={10} manager chefName="Maya Chen" allowPrimary />);
    const banner = await screen.findByTestId("extension-request-banner");
    expect(banner).toHaveAttribute("data-slot", "alert");
    expect(within(banner).getByRole("button", { name: /Approve · charge/ })).toHaveAttribute("data-primary-action", "true");
    expect(within(banner).getByRole("button", { name: "Decline" }).className).toMatch(/border/);
  });
  it("record: only the confirmed history, no heading", async () => {
    body = state({ history: [item({ status: "approved", confirmed: true, free: true })] });
    render(<SessionExtensionsCard variant="record" bookingId={10} manager chefName="Maya Chen" />);
    expect(await screen.findByTestId("extension-history")).toHaveTextContent(/^You gave Maya Chen 1 more hour \(until 5:00\s?p\.m\.\) — no charge$/);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
