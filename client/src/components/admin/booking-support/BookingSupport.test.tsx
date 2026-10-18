import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@shared/i18n/locales/en-CA/admin.json";
import { formatAdminDateTime } from "@/lib/admin-time";
import { buildActionRequest, initialForm, zonedLocalToIso } from "./action-form";
import type { ActionResult, SupportCase } from "./types";

vi.mock("react-i18next", () => ({ useTranslation: () => ({
  i18n: { language: "en-CA", resolvedLanguage: "en-CA" },
  t: (key: string, options?: any) => {
    const raw = (en as Record<string, string>)[key] ?? (typeof options === "object" ? options?.defaultValue : undefined) ?? key;
    return Object.entries(typeof options === "object" ? options ?? {} : {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), raw);
  },
}) }));
const toastSuccess = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a) } }));
const postAction = vi.fn();
const loadBookingFeedback = vi.fn();
vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, postAction: (...args: unknown[]) => postAction(...args), loadBookingFeedback: (...args: unknown[]) => loadBookingFeedback(...args) };
});

import { SupportApiError } from "./api";
import { ActionDialog } from "./ActionDialog";
import { ActionPanel, Chronology, CaseHeader, FeedbackCard, MoneyCard, PaymentEvidenceCard, VisitCodesCard } from "./CaseView";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const preview = (over: Partial<SupportCase["availableActions"][number]["moneyPreview"]> = {}) => ({
  currency: "CAD", chefReceivesCents: null, chefPaysCents: 0, managerPaysCents: 0, localCooksPaysCents: null,
  processingFeeCents: 320, maximumCents: 10000, requiresExceptionAboveCents: 2500, providerVerified: true, ...over,
});

const baseCase = (over: Partial<SupportCase> = {}): SupportCase => ({
  bookingId: 149, referenceCode: "KB-EXAMPLE", status: "confirmed", paymentStatus: "paid", checkinStatus: "not_checked_in",
  updatedAt: "2026-10-14T12:00:00.000Z", paymentIntentId: "pi_example",
  parties: { chef: { id: 4, name: "Alex", email: "alex@example.test", phone: "+17095550100" }, manager: { id: 5, name: "Sam", email: "sam@example.test", phone: null } },
  kitchen: { id: 2, name: "Harbour kitchen" }, location: { id: 3, name: "Harbour", address: "1 Harbour Road", timezone: "America/St_Johns" },
  schedule: { timezone: "America/St_Johns", zoneLabel: "Newfoundland Time", blocks: [{ startAt: "2026-10-16T11:30:00.000Z", endAt: "2026-10-16T13:30:00.000Z", localStart: "Oct 16, 2026, 9:00 a.m.", localEnd: "Oct 16, 2026, 11:00 a.m." }] },
  decision: null, deadlines: { responseAt: null, inspectionAt: null, closeoutAt: null },
  visits: [{ id: 9, blockIndex: 0, checkinStatus: "not_checked_in", updatedAt: "2026-10-14T11:00:00.000Z", checkedInAt: null, checkoutRequestedAt: null, checkoutApprovedAt: null }],
  visitCodes: [{ targetKey: "visit:9", visitId: 9, mode: "staffed", codeRequired: true, locked: false, consumed: false, consumedAt: null, consumedMethod: null, revoked: false }],
  items: { storage: [], equipment: [] },
  money: { capturedCents: 10000, refundedCents: 0, platformFeeCents: 0, processingFeeCents: 320, currency: "CAD", providerVerified: false, transfers: [] },
  paymentEvidence: null, evidenceUnavailable: false, cancellationQuote: null, flags: [],
  chronology: [], supportActions: [],
  availableActions: [
    { type: "goodwill_refund", label: "Send a Local Cooks goodwill refund", moneyPreview: preview() },
    { type: "record_assisted_arrival", label: "Add a reported arrival", moneyPreview: preview({ maximumCents: null, requiresExceptionAboveCents: null }) },
    { type: "open_flag", label: "Pause refunds and kitchen payments", moneyPreview: preview() },
  ],
  ...over,
});

const NOTE = "Customer called about an interrupted kitchen visit.";
const result = (status: ActionResult["action"]["status"], c: SupportCase, replayed = false): ActionResult =>
  ({ action: { id: 1, operationKey: "k", status, exception: false }, case: c, replayed });

function mountDialog(type: SupportCase["availableActions"][number]["type"], c = baseCase()) {
  const onClose = vi.fn(), onCaseUpdated = vi.fn(), onDone = vi.fn();
  const action = c.availableActions.find((a) => a.type === type)!;
  render(<ActionDialog action={action} supportCase={c} getFirebaseToken={async () => "t"} onClose={onClose} onCaseUpdated={onCaseUpdated} onDone={onDone} />);
  return { onClose, onCaseUpdated, onDone, c };
}
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => { postAction.mockReset(); toastSuccess.mockReset(); loadBookingFeedback.mockReset(); });
afterEach(cleanup);

describe("action panel", () => {
  it("lists exactly the actions the server offers, with their labels", () => {
    const c = baseCase();
    const onChoose = vi.fn();
    render(<ActionPanel actions={c.availableActions} supportActions={[]} onChoose={onChoose} />);
    const panel = screen.getByTestId("action-panel");
    expect(within(panel).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Send a Local Cooks goodwill refund", "Add a reported arrival", "Pause refunds and kitchen payments",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Add a reported arrival" }));
    expect(onChoose).toHaveBeenCalledWith(c.availableActions[1]);
  });
  it("says so when nothing is available, and warns about an unfinished earlier action", () => {
    render(<ActionPanel actions={[]} supportActions={[{ status: "recovery_required" } as any]} onChoose={() => undefined} />);
    expect(screen.getByText("Nothing can be done on this booking right now.")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("still in progress or needs checking");
  });
});

describe("dialog validation", () => {
  it("requires an internal note of at least 10 characters and does not call the server", async () => {
    mountDialog("open_flag");
    expect(screen.getByText("Internal note (only Local Cooks sees this)")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Do this now" }));
    expect(await screen.findByText("Please write 10 to 2000 characters.")).toBeVisible();
    type(/Internal note/, "too short");
    fireEvent.click(screen.getByRole("button", { name: "Do this now" }));
    expect(await screen.findByText("Please write 10 to 2000 characters.")).toBeVisible();
    expect(postAction).not.toHaveBeenCalled();
  });
  it("requires the per-action details (arrival time) and labels the zone", async () => {
    mountDialog("record_assisted_arrival");
    expect(screen.getByRole("button", { name: /When they arrived \(Newfoundland Time\)/ })).toBeVisible();
    type(/Internal note/, NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Do this now" }));
    expect(await screen.findByText("Enter when they arrived.")).toBeVisible();
    expect(postAction).not.toHaveBeenCalled();
  });
  it("builds the arrival request with real versions and a kitchen-zone instant", () => {
    const c = baseCase();
    const form = { ...initialForm("record_assisted_arrival", c), note: NOTE, actualAt: "2026-10-16T09:05" };
    const built = buildActionRequest("record_assisted_arrival", c, form, "support-149-abcdefgh", false);
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.body.details).toEqual({
      visitId: 9, actualAt: "2026-10-16T11:35:00.000Z", expectedUpdatedAt: "2026-10-14T11:00:00.000Z", expectedBookingUpdatedAt: "2026-10-14T12:00:00.000Z",
    });
  });
  it("uses the quote hash and the server target key unchanged", () => {
    const hash = "a".repeat(64);
    const c = baseCase({ cancellationQuote: { quoteHash: hash, chefReceivesCents: 5000, parentVersion: 1 } });
    const q = buildActionRequest("accept_cancellation_for_manager", c, { ...initialForm("accept_cancellation_for_manager", c), note: NOTE }, "support-149-abcdefgh", false);
    expect(q.ok && q.body.details).toEqual({ quoteHash: hash });
    const t = buildActionRequest("issue_visit_code", c, { ...initialForm("issue_visit_code", c), note: NOTE }, "support-149-abcdefgh", false);
    expect(t.ok && t.body.details).toEqual({ targetKey: "visit:9" });
    const missing = buildActionRequest("accept_cancellation_for_manager", baseCase(), { ...initialForm("accept_cancellation_for_manager", baseCase()), note: NOTE }, "support-149-abcdefgh", false);
    expect(missing.ok).toBe(false);
  });
  it("converts kitchen wall-clock time to UTC", () => {
    expect(zonedLocalToIso("2026-10-16T09:00", "America/St_Johns")).toBe("2026-10-16T11:30:00.000Z");
    expect(zonedLocalToIso("2026-01-16T09:00", "America/St_Johns")).toBe("2026-01-16T12:30:00.000Z");
  });
  it("selects the exact automatic refund for retry or receipt-only reconciliation and still requires a note", () => {
    const refundOperations = [{ transactionId: 8, refundOperationId: "chef-addon-original-31", itemName: "Commercial Oven", amountCents: 2055, status: "recovery_required", acceptedAt: "2026-10-16T12:00:00.000Z", hasReceipt: true }];
    const retry = { type: "retry_refund" as const, label: "Retry refund", moneyPreview: preview() };
    const mark = { type: "mark_refunded" as const, label: "Mark refunded after checking Stripe", moneyPreview: preview() };
    const c = baseCase({ refundOperations, availableActions: [retry, mark] });
    const retryRequest = buildActionRequest("retry_refund", c, { ...initialForm("retry_refund", c), note: NOTE }, "support-149-retry-refund", false);
    expect(retryRequest.ok && retryRequest.body.details).toEqual({ transactionId: 8, refundOperationId: "chef-addon-original-31" });
    const markRequest = buildActionRequest("mark_refunded", c, { ...initialForm("mark_refunded", c), note: "Matched the successful Stripe receipt." }, "support-149-mark-refund", false);
    expect(markRequest.ok && markRequest.body.details).toEqual({ transactionId: 8, refundOperationId: "chef-addon-original-31" });
    mountDialog("mark_refunded", c);
    expect(screen.getByLabelText("Refund to check")).toHaveTextContent(/Commercial Oven · \$20\.55 · Oct 16, 2026/);
    expect(screen.getByText(/does not send money/i)).toBeVisible();
  });
});

describe("kitchen payout after closeout", () => {
  const held = { timing: "after_closeout" as const, status: "on_hold" as const, holdReason: "reported_issue" as const,
    expectedAt: "2026-10-17T13:30:00.000Z", sentAt: null, amountCents: 10942 };
  it("shows the payout block on the money card, and none for a legacy payment", () => {
    render(<MoneyCard c={baseCase({ payout: held })} />);
    expect(screen.getByTestId("kitchen-payout-status")).toHaveAttribute("data-status", "on_hold");
    cleanup();
    render(<MoneyCard c={baseCase()} />);
    expect(screen.queryByTestId("kitchen-payout-status")).not.toBeInTheDocument();
  });
  it("explains Release payout and sends it on behalf of Local Cooks", async () => {
    const c = baseCase({ payout: held, availableActions: [{ type: "release_payout", label: "Release payout", moneyPreview: preview({ maximumCents: null, requiresExceptionAboveCents: null }) }] });
    expect(screen.queryByText("Release the kitchen payout")).toBeNull();
    mountDialog("release_payout", c);
    expect(screen.getAllByText("Release the kitchen payout").length).toBeGreaterThan(0);
    expect(screen.getByText(/once the reported issue is settled/)).toBeVisible();
    const built = buildActionRequest("release_payout", c, { ...initialForm("release_payout", c), note: NOTE }, "support-149-abcdefgh", false);
    expect(built.ok && built.body).toMatchObject({ type: "release_payout", actingFor: "local_cooks" });
  });
});

describe("recorded kitchen refund debt", () => {
  it("shows the item, amount, status and manual-repayment rule without promising payout netting", () => {
    render(<MoneyCard c={baseCase({ kitchenRefundDebts: [{ operationId: "debt-1", itemName: "Commercial Oven", amountCents: 1933, status: "open", recordedAt: "2026-10-16T12:00:00.000Z" }] })} />);
    const debt = screen.getByTestId("kitchen-refund-debts");
    expect(debt).toHaveTextContent("Commercial Oven · $19.33 · Awaiting repayment");
    expect(debt).toHaveTextContent("Future payouts are not reduced automatically");
  });
});

describe("money preview and exception confirmation", () => {
  it("shows plain placeholders for amounts that are not known yet, then follows the goodwill amount", () => {
    mountDialog("goodwill_refund");
    const box = screen.getByTestId("money-preview");
    expect(within(box).getAllByText("Calculated when you enter an amount")).toHaveLength(2);
    expect(within(box).getByText("$3.20")).toBeVisible();
    type(/Goodwill amount/, "10");
    expect(within(box).getAllByText("$10.00")).toHaveLength(2);
    expect(screen.getByText("The chef will be notified. The kitchen isn’t — its payout doesn’t change.")).toBeVisible();
  });
  it("sends an ordinary goodwill refund directly, without an exception", async () => {
    const c = baseCase();
    postAction.mockResolvedValue(result("verified", c));
    const { onClose } = mountDialog("goodwill_refund", c);
    type(/Goodwill amount/, "10");
    type(/Internal note/, NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Do this now" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const body = postAction.mock.calls[0][2];
    expect(body).toMatchObject({ type: "goodwill_refund", actingFor: "local_cooks", amountCents: 1000 });
    expect(body.confirmException).toBeUndefined();
    expect(body.operationKey).toMatch(/^support-149-/);
  });
  it("explains what was already sent when goodwill was sent before", async () => {
    const sent = { id: 1, type: "goodwill_refund", actorUserId: 77, actingFor: "local_cooks" as const, requestSource: "call" as const, sourceRef: null, reasonCode: "service_recovery",
      amountCents: 1000, currency: "CAD", fundedBy: "local_cooks", exception: false, operationKey: "k1", status: "verified" as const,
      createdAt: "2026-10-14T12:00:00.000Z", completedAt: "2026-10-14T12:00:01.000Z", notifiedEventIds: [] };
    const base = baseCase();
    const c = baseCase({ supportActions: [sent], availableActions: base.availableActions.map((a) => a.type === "goodwill_refund" ? { ...a, moneyPreview: preview({ requiresExceptionAboveCents: 1500 }) } : a) });
    mountDialog("goodwill_refund", c);
    type(/Goodwill amount/, "16");
    type(/Internal note/, NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Do this now" }));
    expect(await screen.findByText("Goodwill for this booking is limited to $25. $10.00 was already sent, so $15.00 is left. Record this $16.00 as an exception?")).toBeVisible();
  });
  it("labels the processing fee as the original one and says Local Cooks pays only the refund", () => {
    mountDialog("goodwill_refund");
    type(/Goodwill amount/, "10");
    const box = screen.getByTestId("money-preview");
    expect(box).toHaveTextContent("Original processing fee");
    expect(box).toHaveTextContent("Stripe doesn't return it and charges no fee for this refund.");
    expect(box).toHaveTextContent(/Local Cooks pays \(the refund amount only\)\s*\$10\.00/);
  });
  it("asks a second question above the limit and only then sends confirmException", async () => {
    const c = baseCase();
    postAction.mockResolvedValue(result("verified", c));
    mountDialog("goodwill_refund", c);
    type(/Goodwill amount/, "30");
    type(/Internal note/, NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Do this now" }));
    expect(await screen.findByText("Goodwill for this booking is limited to $25. Record this $30.00 as an exception?")).toBeVisible();
    expect(postAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText(/Goodwill amount/)).toHaveValue("30");
    fireEvent.click(screen.getByRole("button", { name: "Do this now" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, record as exception" }));
    await waitFor(() => expect(postAction).toHaveBeenCalledTimes(1));
    expect(postAction.mock.calls[0][2]).toMatchObject({ amountCents: 3000, confirmException: true });
  });
  it("refuses an amount above the maximum", async () => {
    mountDialog("goodwill_refund");
    type(/Goodwill amount/, "500");
    type(/Internal note/, NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Do this now" }));
    expect(await screen.findByText("That is more than can be refunded on this booking.")).toBeVisible();
    expect(postAction).not.toHaveBeenCalled();
  });
});

describe("what happens after the server answers", () => {
  it("shows a success toast and closes when the action is verified, replacing the case", async () => {
    const next = baseCase({ status: "cancelled" });
    postAction.mockResolvedValue(result("verified", next));
    const { onClose, onCaseUpdated, onDone } = mountDialog("open_flag");
    type(/Internal note/, NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Do this now" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onCaseUpdated).toHaveBeenCalledWith(next);
    expect(toastSuccess).toHaveBeenCalledWith("Done. Pause refunds and kitchen payments");
    // The page keeps the same confirmation visible after the dialog closes.
    expect(onDone).toHaveBeenCalledWith("Pause refunds and kitchen payments");
  });
  it("explains a failed action and still replaces the case, with no success toast", async () => {
    const next = baseCase({ status: "pending" });
    postAction.mockResolvedValue(result("failed", next));
    const { onClose, onCaseUpdated } = mountDialog("open_flag");
    type(/Internal note/, NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Do this now" }));
    expect(await screen.findByText("That didn’t go through")).toBeVisible();
    expect(onCaseUpdated).toHaveBeenCalledWith(next);
    expect(onClose).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
  it("tells the admin not to retry when recovery is required", async () => {
    postAction.mockResolvedValue(result("recovery_required", baseCase(), true));
    mountDialog("open_flag");
    type(/Internal note/, NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Do this now" }));
    expect(await screen.findByText("We couldn’t confirm what happened")).toBeVisible();
    expect(screen.getByTestId("action-result")).toHaveTextContent("Please don’t try again yet");
    expect(screen.getByTestId("action-result")).toHaveTextContent("had already been recorded");
    expect(toastSuccess).not.toHaveBeenCalled();
  });
  it("reuses the same operation key and locks the request after an answer that never arrived", async () => {
    postAction.mockRejectedValueOnce(new SupportApiError(0, "")).mockResolvedValueOnce(result("verified", baseCase()));
    const { onClose } = mountDialog("open_flag");
    type(/Internal note/, NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Do this now" }));
    expect(await screen.findByTestId("server-error")).toHaveTextContent("don’t know whether this went through");
    expect(screen.getByLabelText(/Internal note/)).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(postAction.mock.calls[1][2]).toEqual(postAction.mock.calls[0][2]);
    expect(postAction.mock.calls[1][2].operationKey).toBe(postAction.mock.calls[0][2].operationKey);
  });
  it("shows the server's message for a refused action", async () => {
    postAction.mockRejectedValue(new SupportApiError(409, "This action is unavailable in the booking’s current state."));
    mountDialog("open_flag");
    type(/Internal note/, NOTE);
    fireEvent.click(screen.getByRole("button", { name: "Do this now" }));
    expect(await screen.findByTestId("server-error")).toHaveTextContent("unavailable in the booking’s current state");
    expect(screen.getByLabelText(/Internal note/)).not.toBeDisabled();
  });
});

describe("times and facts", () => {
  it("labels the zone on every admin time", () => {
    expect(formatAdminDateTime("2026-10-16T11:30:00.000Z", { timeZone: "America/St_Johns", zoneLabel: "Newfoundland Time" })).toMatch(/9:00.*Newfoundland Time$/);
    expect(formatAdminDateTime("2026-10-16T11:30:00.000Z")).toMatch(/Newfoundland Time$/);
    const c = baseCase({ chronology: [{ source: "lifecycle", id: 1, kind: "support_updated", title: "Booking updated", createdAt: "2026-10-14T12:00:00.000Z", completedAt: null }] });
    render(<><CaseHeader c={c} onBack={() => undefined} onRefresh={() => undefined} refreshing={false} /><Chronology c={c} /></>);
    expect(screen.getByTestId("schedule")).toHaveTextContent("Fri, Oct 16, 2026 · 9:00–11:00 a.m.");
    expect(screen.getByTestId("schedule")).not.toHaveTextContent("Oct 16, 2026, 9:00 a.m. –");
    expect(screen.getByTestId("schedule")).toHaveTextContent("Newfoundland Time");
    expect(screen.getByTestId("chronology")).toHaveTextContent(/Newfoundland Time/);
  });
  it("shows one status pill, open flags and contact buttons", () => {
    const c = baseCase({ flags: [{ id: 3, kind: "chargeback", providerRef: "dp_1", openedAt: "2026-10-14T12:00:00.000Z" }] });
    render(<CaseHeader c={c} onBack={() => undefined} onRefresh={() => undefined} refreshing={false} />);
    expect(screen.getAllByTestId("status-pill")).toHaveLength(1);
    expect(screen.getByTestId("open-flag")).toHaveTextContent("Chargeback");
    expect(screen.getByRole("link", { name: /alex@example.test/ })).toHaveAttribute("href", "mailto:alex@example.test");
    expect(screen.getByRole("link", { name: /\+17095550100/ })).toHaveAttribute("href", "tel:+17095550100");
  });
  it("filters the chronology by source, newest first", () => {
    const c = baseCase({ chronology: [
      { source: "payment", id: 2, kind: "x", title: "Payment captured", createdAt: "2026-10-14T10:00:00.000Z" },
      { source: "email", id: 3, title: "Booking update", status: "sent", recipientEmail: "a@b.test", trackingId: null, createdAt: "2026-10-14T13:00:00.000Z" },
    ] });
    render(<Chronology c={c} />);
    const items = () => within(screen.getByTestId("chronology")).getAllByRole("listitem").map((li) => li.getAttribute("data-source"));
    expect(items()).toEqual(["email", "payment"]);
    fireEvent.click(screen.getByRole("button", { name: /Payment \(1\)/ }));
    expect(items()).toEqual(["payment"]);
  });
  it("says payment details could not load, and never shows code digits", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
    try {
      const c = baseCase({ evidenceUnavailable: true });
      render(<><PaymentEvidenceCard c={c} /><VisitCodesCard c={c} /></>);
      expect(screen.getByTestId("evidence-unavailable")).toHaveTextContent("couldn’t load payment details");
      expect(screen.getByText("The code digits are never shown here.")).toBeVisible();
      expect(screen.getByText("Waiting to be used")).toBeVisible();
    } finally { vi.useRealTimers(); }
  });
  it("calls an unused code after the visit has ended 'Not used'", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-17T12:00:00.000Z"));
    try {
      render(<VisitCodesCard c={baseCase()} />);
      expect(screen.getByText("Not used")).toBeVisible();
      expect(screen.queryByText("Waiting to be used")).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });
  it("shows a muted 'Name not set' rather than a role word or an email", () => {
    const c = baseCase({ parties: { chef: { id: 4, name: null, email: "alex@example.test", phone: null }, manager: { id: 5, name: "Sam Lee", email: "sam@example.test", phone: null } } });
    render(<CaseHeader c={c} onBack={() => undefined} onRefresh={() => undefined} refreshing={false} />);
    expect(screen.getByText("Name not set")).toHaveClass("text-muted-foreground");
    expect(screen.getByText("Sam Lee")).toBeVisible();
  });
});

describe("private feedback (read-only)", () => {
  const renderFeedback = (c: SupportCase) => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeedbackCard c={c} getFirebaseToken={async () => "t"} />
    </QueryClientProvider>,
  );
  it("shows an answered, flagged response with stars, tags, comment and the kitchen-zone date", async () => {
    loadBookingFeedback.mockResolvedValue({
      bookingId: 149, requestedAt: "2026-10-16T14:00:00.000Z", remindedAt: null, closesAt: "2026-10-17T14:00:00.000Z",
      responses: [{ id: 7, bookingId: 149, respondentId: 4, respondentRole: "chef", rating: 4, tags: ["easy_access", "not_clean"], comment: "Left the sink full.", createdAt: "2026-10-16T15:00:00.000Z", flagged: true }],
    });
    renderFeedback(baseCase());
    expect(screen.getByText("Private feedback")).toBeVisible();
    expect(await screen.findByText("★★★★☆")).toBeVisible();
    expect(screen.getByText("4/5")).toBeVisible();
    expect(screen.getByText("Needs attention")).toBeVisible();
    expect(screen.getByText("privateFeedback.tags.easy_access")).toBeVisible();
    expect(screen.getByText("privateFeedback.tags.not_clean")).toBeVisible();
    expect(screen.getByText("Left the sink full.")).toBeVisible();
    expect(screen.getByText(/Answered Oct 16, 2026, 12:30 p.m. · Newfoundland Time/)).toBeVisible();
    expect(screen.getByTestId("feedback-chef")).not.toHaveTextContent("No answer yet");
    expect(screen.getByTestId("feedback-manager")).toHaveTextContent("No answer yet");
    expect(screen.getByTestId("feedback-manager")).toHaveTextContent("Window closes Oct 17, 2026");
  });
  it("says feedback opens at close when it has not been requested yet", async () => {
    loadBookingFeedback.mockResolvedValue({ bookingId: 149, requestedAt: null, remindedAt: null, closesAt: null, responses: [] });
    renderFeedback(baseCase());
    expect(await screen.findByText("Feedback opens when the booking closes.")).toBeVisible();
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.queryByTestId("feedback-chef")).toBeNull();
  });
});

describe('CP5 daily installments', () => {
  it('shows each day, sent transfer and pending actual fee separately', () => {
    const c = baseCase();
    c.money.dayPayouts = [{ installmentId: 1, sourceId: 8, operatingDate: '2026-10-15', status: 'sent', amountCents: 2200, feePending: false, transferId: 'tr_day_one', retryReason: null },
      { installmentId: 2, sourceId: 8, operatingDate: '2026-10-17', status: 'on_hold', amountCents: 0, feePending: true, transferId: null, retryReason: 'waiting_fee' }];
    render(<MoneyCard c={c} />);
    expect(screen.getByText(/2026-10-15/)).toBeVisible(); expect(screen.getByText('tr_day_one')).toBeVisible();
    expect(screen.getByText(/Waiting for actual processing fee/)).toBeVisible();
  });
});


describe('CP9 outside refund assignment', () => {
  const dated = () => baseCase({ scheduleRevision: 1, outsideRefunds: [{ refundId: 're_outside', amountCents: 2500 }], dayMoney: [{ visitId: 9, allocatedCents: 10000, refundedCents: 0, kitchenRemainingCents: 4000 }] });
  it('sends Local Cooks funding with no day debit', () => {
    const c = dated(), f = { ...initialForm('assign_outside_refund', c), note: 'Reviewed provider refund' };
    const result = buildActionRequest('assign_outside_refund', c, f, 'assign-outside-1', false);
    expect(result.ok && result.body.details).toEqual({ refundId: 're_outside', kitchenDebitCents: 0 });
  });
  it('sends the selected day and exact kitchen cents', () => {
    const c = dated(), f = { ...initialForm('assign_outside_refund', c), note: 'Kitchen agreed to refund', kitchenShare: '12.34' };
    const result = buildActionRequest('assign_outside_refund', c, f, 'assign-outside-2', false);
    expect(result.ok && result.body.details).toEqual({ refundId: 're_outside', kitchenDebitCents: 1234, visitId: 9 });
  });
  it.each(['25.01', '-1', 'abc'])('refuses an invalid kitchen share %s', share => {
    const c = dated(), f = { ...initialForm('assign_outside_refund', c), note: 'Reviewed provider refund', kitchenShare: share };
    expect(buildActionRequest('assign_outside_refund', c, f, 'assign-outside-3', false).ok).toBe(false);
  });
});
