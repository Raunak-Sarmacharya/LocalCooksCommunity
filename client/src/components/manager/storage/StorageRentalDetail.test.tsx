import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

const claimState = vi.hoisted(() => ({ filing: null as null | Record<string, unknown>, claims: [] as unknown[] }));
vi.mock("react-i18next", async () => {
  const { default: en } = await import('@shared/i18n/locales/en-CA/storage.json');
  return { useTranslation: () => ({ t: (key: string, opts?: any) => key.startsWith('stSituation_') || key.startsWith('stNextStep_') || ['stReleaseAvailableOn', 'stMessageChef'].includes(key)
    ? (en as Record<string, string>)[key].replace(/\{(\w+)\}/g, (_, name) => String(opts?.[name] ?? ''))
    : opts?.when ? `${key}:${opts.when}` : key.startsWith('stPayout') && opts?.date ? `${key}:${opts.date}` : key, i18n: { language: "en-CA" } }) };
});
vi.mock("wouter", () => ({ Link: ({ href, children }: any) => <a href={href}>{children}</a>, useParams: () => ({ id: "5" }) }));
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer fixture" }) }));
vi.mock("@/lib/damage-claims", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/damage-claims")>();
  return {
    ...actual,
    claimRequest: async (path: string) => {
      if (path.includes("filing-context")) {
        return claimState.filing ?? { allowed: false, deadline: "", endedAt: "", timezone: "America/St_Johns", kitchenName: "", before: [], after: [] };
      }
      if (path.includes("/claims")) return { claims: claimState.claims };
      return {};
    },
    claimWhen: () => "Oct 20, 12:00 p.m.",
  };
});
vi.mock("@/components/booking/DamageClaimSheet", () => ({
  DamageClaimSheet: ({ open, storageRentalId }: { open?: boolean; storageRentalId?: number }) =>
    open ? <div data-testid="claim-sheet">sheet:{storageRentalId}</div> : null,
}));

import { StorageRentalDetail } from "./StorageRentalDetail";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); claimState.filing = null; claimState.claims = []; });

const rental = {
  id: 5, ref: "SB-5", kitchen: { id: 1, name: "Harbour" }, listing: { id: 1, name: "Shelf" }, chef: { id: 3, name: "Morgan Lee" },
  unitLabel: "2", state: "active", phase: "holdover", timezone: "America/St_Johns", startOn: "2026-10-01", paidThrough: "2026-10-03",
  graceEndsOn: "2026-10-08", holdoverDays: 6, accruedCents: 1150, responseDeadline: null, declineReason: null,
  needsCleaning: false, releasedOn: null, actions: ["holdover-charge", "holdover-waive"],
  rentalTerms: { dailyPriceCents: 1000, taxRatePercent: 15 },
  terms: [{ id: 9, seq: 1, kind: "first", startsOn: "2026-10-01", endsOn: "2026-10-03", days: 3, dailyPriceCents: 1000,
    subtotalCents: 3000, taxCents: 450, serviceFeeCents: 100, totalCents: 3550, status: "paid", paidAt: "2026-10-01T00:00:00Z",
    payoutEligibleAt: "2026-10-04T02:30:00Z", payoutReleasedAt: "2026-10-05T02:30:00Z", payoutHoldReason: null }],
  evidence: { checkinPhotoUrls: null, handoverPhotoUrls: null, checkoutPhotoUrls: null },
};

function renderDetail(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...rental, ...overrides }) })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><StorageRentalDetail rentalId={5} /></QueryClientProvider>);
}

it("shows compact empty evidence, date-only payout and state-relevant actions", async () => {
  renderDetail();
  expect(await screen.findByText("stEvidenceNone")).toBeInTheDocument();
  expect(screen.getByText(/stPayoutPaid:Oct 5/)).not.toHaveTextContent(/a\.m\.|00:00|12:00/);
  expect(screen.queryByText('stEvidenceHeading')).toBeNull();
  expect(await screen.findByRole("button", { name: "stActionHoldoverCharge" })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('button', { name: 'stMoreTitle' }), { key: 'Enter' });
  expect(await screen.findByRole('menuitem', { name: 'stActionWaiveHoldover' })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "stActionApprove" })).toBeNull();
});

it("states the amount on the confirm sheet and posts the WP-ST9 action", async () => {
  const fetchMock = vi.fn(async (input: any, init?: any) => {
    if ((init?.method ?? "GET").toUpperCase() === "POST") return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => rental };
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><StorageRentalDetail rentalId={5} /></QueryClientProvider>);

  fireEvent.click(await screen.findByRole("button", { name: "stActionHoldoverCharge" }));
  expect(await screen.findByTestId("action-amount")).toHaveTextContent("$11.50");
  fireEvent.click(screen.getByRole("button", { name: "stConfirm" }));
  await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/storage-rentals/5/holdover-charge") && (call[1] as any)?.method === "POST")).toBe(true));
});


it("previews the server refund amount before confirmation and retains exact cents", async () => {
  const fetchMock = vi.fn(async (url: any, init?: any) => ({ ok: true, json: async () => String(url).includes('/refund/preview') ? { amountCents: 1234, maxAmountCents: 1234, date: '2026-10-16' } : init?.method === 'POST' ? { success: true } : { ...rental, actions: ['refund'] } }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><StorageRentalDetail rentalId={5} /></QueryClientProvider>);
  fireEvent.keyDown(await screen.findByRole('button', { name: 'stMoreTitle' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'stActionRefund' }));
  expect(screen.queryByRole('button', { name: 'stConfirm' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'stPreview' }));
  expect(await screen.findByTestId('action-amount')).toHaveTextContent('$12.34');
  expect(screen.getByRole('spinbutton')).toHaveValue(12.34);
  fireEvent.click(screen.getByRole('button', { name: 'stConfirm' }));
  expect(screen.getByText('stReasonRequired')).toHaveAttribute('role', 'alert');
  fireEvent.change(screen.getByLabelText('stReasonLabel'), { target: { value: 'Courtesy refund' } });
  fireEvent.click(screen.getByRole('button', { name: 'stConfirm' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/refund') && JSON.parse(init?.body || '{}').amountCents === 1234)).toBe(true));
});

it("shows the report damage button only while the filing context allows it", async () => {
  renderDetail();
  expect(await screen.findByText("stMoneyHeading")).toBeInTheDocument();
  expect(screen.queryByTestId("storage-claim-report")).toBeNull();

  claimState.filing = {
    allowed: true,
    deadline: "2026-10-20T15:00:00.000Z",
    endedAt: "2026-10-17T15:00:00.000Z",
    timezone: "America/St_Johns",
    kitchenName: "Harbour",
    before: [],
    after: [],
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cleanup();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => rental })));
  render(<QueryClientProvider client={client}><StorageRentalDetail rentalId={5} /></QueryClientProvider>);
  expect(await screen.findByTestId("storage-claim-report")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "dcV2Report" })).toBeInTheDocument();
  expect(screen.getByText(/dcV2FileBy/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "dcV2Report" }));
  expect(await screen.findByTestId("claim-sheet")).toHaveTextContent("sheet:5");
});

it("shows the dated timeline with the current step highlighted", async () => {
  renderDetail({ timeline: { requestedAt: "2026-09-29T12:00:00Z", approvedAt: "2026-09-30T12:00:00Z", movedInAt: "2026-10-01T12:00:00Z", movingOutAt: null, endedAt: null } });
  const timeline = await screen.findByRole("region", { name: "stTimeline" });
  expect(within(timeline).getAllByRole("listitem")).toHaveLength(5);
  expect(within(timeline).getByText("stTimelineMovedIn").closest("li")).toHaveAttribute("aria-current", "step");
  expect(within(timeline).getByText(/Sep 29/)).toBeInTheDocument();
  expect(within(timeline).getByText(/Sep 30/)).toBeInTheDocument();
  expect(within(timeline).getByText(/Oct 1/)).toBeInTheDocument();
});
it("labels authorized money as a card hold with an estimated payout", async () => {
  renderDetail({ state: "requested", actions: [], estimatedPayoutCents: 3300, terms: [{ ...rental.terms[0], status: "authorized" }] });
  expect(await screen.findByText("stTermOnHold")).toBeInTheDocument();
  expect(screen.getByText("stPayoutEstimate")).toBeInTheDocument();
  expect(screen.queryByText("stTermCharged")).toBeNull();
});
it("labels each term by its own charge status, including a pending extension", async () => {
  renderDetail({ terms: [rental.terms[0], { ...rental.terms[0], id: 10, seq: 2, status: "authorized" }] });
  expect(await screen.findByText("stTermCharged")).toBeInTheDocument();
  expect(screen.getByText("stTermOnHold")).toBeInTheDocument();
  expect(screen.getAllByText("stTermPayout")).toHaveLength(2);
});

it.each([false, true])('explains overdue move-in and respects release permission (%s)', async release => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  try {
    renderDetail({ state: 'reserved', phase: null, startOn: '2026-10-17', actions: ['handover', 'offer-extension', ...(release ? ['release'] : [])] });
    const banner = await screen.findByTestId('storage-situation');
    expect(within(banner).getByText('Morgan Lee hasn’t moved in yet. The unit is held for them, and you’re still paid.')).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: 'Message Morgan Lee' })).toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: 'stActionHandover' })).toBeInTheDocument();
    expect(within(banner).getByText('Record move-in when they arrive. Add a photo of their items to confirm.')).toBeInTheDocument();
    expect(within(banner).queryByRole('button', { name: 'stActionOfferExtension' })).toBeNull();
    if (release) {
      expect(within(banner).getByRole('button', { name: 'stActionReleaseUnit' })).toBeInTheDocument();
      expect(within(banner).queryByText(/If they don’t move in/)).toBeNull();
    } else {
      expect(within(banner).queryByRole('button', { name: 'stActionReleaseUnit' })).toBeNull();
      expect(within(banner).getByText('If they don’t move in by Oct 24, you can release the unit.')).toBeInTheDocument();
    }
    fireEvent.keyDown(within(banner).getByRole('button', { name: 'stMoreTitle' }), { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: 'stActionOfferExtension' })).toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});

it('shows storage instructions and chef notes as read-only text', async () => {
  renderDetail({ instructions: { moveIn: 'Use the labelled shelf.', moveOut: 'Leave it clean.' }, chefNotes: { moveIn: 'Two labelled boxes.', moveOut: null } });
  expect(await screen.findByText('Use the labelled shelf.')).toBeInTheDocument();
  expect(screen.getByText('Leave it clean.')).toBeInTheDocument();
  expect(screen.getByText('Two labelled boxes.')).toBeInTheDocument();
});
