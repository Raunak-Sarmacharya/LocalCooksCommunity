import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en-CA" } }) }));
vi.mock("wouter", () => ({ Link: ({ href, children }: any) => <a href={href}>{children}</a>, useParams: () => ({ id: "5" }) }));
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer fixture" }) }));

import { StorageRentalDetail } from "./StorageRentalDetail";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

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

function renderDetail() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => rental })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><StorageRentalDetail rentalId={5} /></QueryClientProvider>);
}

it("shows evidence, the paid term's payout and the More menu the DTO allows", async () => {
  renderDetail();
  expect(await screen.findByText("stEvidenceNone")).toBeInTheDocument();
  expect(screen.getByText("stPayoutPaid")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "stMore" }));
  expect(await screen.findByRole("button", { name: "stActionHoldoverCharge" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "stActionWaiveHoldover" })).toBeInTheDocument();
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

  fireEvent.click(await screen.findByRole("button", { name: "stMore" }));
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
  fireEvent.click(await screen.findByRole('button', { name: 'stMore' }));
  fireEvent.click(await screen.findByRole('button', { name: 'stActionRefund' }));
  expect(screen.queryByRole('button', { name: 'stConfirm' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'stPreview' }));
  expect(await screen.findByTestId('action-amount')).toHaveTextContent('$12.34');
  expect(screen.getByRole('spinbutton')).toHaveValue(12.34);
  fireEvent.click(screen.getByRole('button', { name: 'stConfirm' }));
  expect(screen.getByRole('alert')).toHaveTextContent('stReasonRequired');
  fireEvent.change(screen.getByLabelText('stReasonLabel'), { target: { value: 'Courtesy refund' } });
  fireEvent.click(screen.getByRole('button', { name: 'stConfirm' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/refund') && JSON.parse(init?.body || '{}').amountCents === 1234)).toBe(true));
});
