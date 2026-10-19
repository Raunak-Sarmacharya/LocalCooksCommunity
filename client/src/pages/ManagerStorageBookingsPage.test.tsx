import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { afterEach, expect, it, vi } from "vitest";



vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string, values?: any) => values?.total ? `${key}: ${values.total} · ${values.payout}` : values?.amount ? `${key}: ${values.amount}` : key, i18n: { language: "en-CA" } }) }));

vi.mock("wouter", () => ({ Link: ({ href, children }: any) => <a href={href}>{children}</a> }));

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer fixture" }) }));

vi.mock("@/hooks/use-manager-dashboard", () => ({ useManagerDashboard: () => ({ kitchens: [{ id: 1, name: "Harbour" }] }) }));



import ManagerStorageBookingsPage from "./ManagerStorageBookingsPage";



afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });



const term = { id: 1, seq: 1, kind: "first", startsOn: "2026-10-17", endsOn: "2026-10-19", days: 3, dailyPriceCents: 1000,

  subtotalCents: 3000, taxCents: 450, serviceFeeCents: 100, totalCents: 3550, status: "authorized", paidAt: null,

  payoutEligibleAt: null, payoutReleasedAt: null, payoutHoldReason: null };



const request = {

  id: 1, ref: "SB-1", kitchen: { id: 1, name: "Harbour" }, listing: { id: 1, name: "Shelf" }, chef: { id: 3, name: "Morgan Lee" },

  unitLabel: "1", state: "requested", phase: null, timezone: "America/St_Johns", startOn: "2026-10-17", paidThrough: "2026-10-19",

  graceEndsOn: "2026-10-24", holdoverDays: 0, accruedCents: 0, responseDeadline: "2026-10-17T12:00:00Z", declineReason: null,

  estimatedPayoutCents: 3300, needsCleaning: false, releasedOn: null, actions: ["approve", "decline"], rentalTerms: { dailyPriceCents: 1000, taxRatePercent: 15 },

  terms: [term], evidence: { checkinPhotoUrls: null, handoverPhotoUrls: null, checkoutPhotoUrls: null },

};



const listings = [{ id: 1, name: "Shelf", kitchenId: 1, unitCount: 2, isActive: true, status: "approved" }];



function renderBoard() {

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(<QueryClientProvider client={client}><ManagerStorageBookingsPage /></QueryClientProvider>);

}



function mockFetch(rentals = [request]) {

  const fetchMock = vi.fn(async (input: any, init?: any) => {

    const url = String(input);

    if ((init?.method ?? "GET").toUpperCase() === "POST") return { ok: true, json: async () => ({}) };

    if (url.includes("/storage-listings")) return { ok: true, json: async () => listings };

    return { ok: true, json: async () => rentals };

  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;

}



it("approves a request from the board and refetches", async () => {

  const fetchMock = mockFetch();

  renderBoard();

  fireEvent.click(await screen.findByRole("button", { name: "stApprove" }));

  fireEvent.click(await screen.findByRole("button", { name: "stApproveSubmit" }));

  await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/storage-rentals/1/approve") && (call[1] as any)?.method === "POST")).toBe(true));

  await waitFor(() => expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/api/manager/storage-rentals")).length).toBeGreaterThan(1));

});



it('lists ended rentals with dates, net earnings, detail, chef and payout links', async () => {

  mockFetch([{ ...request, id: 9, ref: 'SB-PAST', state: 'ended', releasedOn: '2026-10-19', actions: [],

    terms: [{ ...term, status: 'paid', payoutCents: 2800 }, { ...term, id: 2, status: 'paid', payoutCents: 900 }] } as any]);

  renderBoard();

  expect(await screen.findByRole('link', { name: /SB-PAST/ })).toHaveAttribute('href', '/manager/storage/9');

  expect(screen.getByRole('link', { name: 'Morgan Lee' })).toHaveAttribute('href', '/manager/customers/3');

  expect(screen.getByRole('link', { name: 'stViewPayouts' })).toHaveAttribute('href', '/manager/dashboard?view=revenue');

  expect(screen.getByText(/Oct 17.*Oct 19/)).toBeInTheDocument();

  expect(screen.getByText('stRentalEarnings: $37.00')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'stPastRentals' }));

  expect(screen.queryByRole('heading', { name: 'stUnitsHeading' })).not.toBeInTheDocument();

  expect(screen.getByRole('link', { name: /SB-PAST/ })).toBeInTheDocument();

});



it("refuses to decline without a reason, then sends the reason", async () => {

  const fetchMock = mockFetch();

  renderBoard();

  fireEvent.click(await screen.findByRole("button", { name: "stDecline" }));

  fireEvent.click(await screen.findByRole("button", { name: "stDeclineSubmit" }));

  expect(await screen.findByText("stReasonRequired")).toBeInTheDocument();

  expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/decline"))).toBe(false);



  fireEvent.change(screen.getByLabelText("stReasonLabel"), { target: { value: "No space these dates" } });

  fireEvent.click(screen.getByRole("button", { name: "stDeclineSubmit" }));

  await waitFor(() => {

    const call = fetchMock.mock.calls.find((entry) => String(entry[0]).endsWith("/storage-rentals/1/decline"));

    expect(call).toBeTruthy();

    expect(JSON.parse((call![1] as any).body)).toEqual({ reason: "No space these dates" });

  });

});



it("repeats the server payout estimate in the request and approval confirmation", async () => {

  mockFetch(); renderBoard();

  expect(await screen.findByText("stRequestPayout: $35.50 · $33.00")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "stApprove" }));

  expect(screen.getAllByText("stRequestPayout: $35.50 · $33.00")).toHaveLength(2);

});

it("filters View units links to the selected listing, including its draft units", async () => {

  window.history.replaceState({}, "", "/manager/dashboard?view=storage-bookings&listingId=2");

  vi.stubGlobal("fetch", vi.fn(async (url: any) => ({ ok: true, json: async () => String(url).includes("storage-listings")

    ? [...listings, { id: 2, name: "Draft freezer", kitchenId: 1, unitCount: 1, isActive: false, status: "draft" }] : [request] })));

  renderBoard();

  expect(await screen.findByText(/^stListingUnits/)).toBeInTheDocument();

  expect(screen.queryByText("Morgan Lee")).toBeNull();

  expect(screen.getAllByText("stChipFree")).toHaveLength(1);

  window.history.replaceState({}, "", "/");

});

