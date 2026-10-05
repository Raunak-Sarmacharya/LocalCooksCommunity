import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminBookingTransactionsPath } from '@shared/admin-booking-link';
import { AdminTransactionHistory } from './AdminTransactionHistory';
vi.mock('../BookingPaymentRecovery', () => ({ BookingPaymentRecovery: () => null }));
const transaction = (bookingType: string, bookingId: number, referenceCode: string) => ({
  id: referenceCode.length, bookingId, bookingType, referenceCode, amount: 1220, baseAmount: 1150, serviceFee: 70,
  stripeProcessingFee: 0, managerRevenue: 1150, refundAmount: 0, netAmount: 1220, currency: 'CAD', status: 'succeeded',
  createdAt: '2026-10-03T12:00:00Z', metadata: {}, chefEmail: 'chef@example.test', locationName: 'Fixture location',
});
const mount = (rows: any[]) => {
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('/locations') ? [] : { transactions: rows, total: rows.length } }));
  vi.stubGlobal('fetch', fetcher);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><AdminTransactionHistory getFirebaseToken={async () => 'fixture-token'} /></QueryClientProvider>);
  return fetcher;
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
describe('actual lifecycle admin booking destination', () => {
  it('consumes the producer link, requests an exact kitchen context and excludes colliding resource IDs', async () => {
    window.history.replaceState({}, '', adminBookingTransactionsPath(10));
    const fetcher = mount([transaction('kitchen', 10, 'KB-INTENDED'), transaction('bundle', 10, 'KB-BUNDLE'),
      transaction('storage', 10, 'SB-COLLISION'), transaction('equipment', 10, 'EB-COLLISION'), transaction('kitchen', 11, 'KB-OTHER')]);
    await screen.findByText('Payment history for kitchen booking #10');
    expect(screen.getByText('KB-INTENDED')).toBeVisible();
    expect(screen.getByText('KB-BUNDLE')).toBeVisible();
    expect(screen.queryByText('SB-COLLISION')).toBeNull();
    expect(screen.queryByText('EB-COLLISION')).toBeNull();
    expect(screen.queryByText('KB-OTHER')).toBeNull();
    const url = fetcher.mock.calls.map(call => call[0]).find(url => url.includes('bookingId='))!;
    expect(new URL(url, 'https://local.invalid').searchParams.get('bookingId')).toBe('10');
    fireEvent.click(screen.getByRole('button', { name: 'Show all bookings' }));
    await waitFor(() => expect(window.location.search).not.toContain('bookingId'));
    expect(window.location.search).toContain('section=transactions');
    await screen.findByText('SB-COLLISION');
  });
  it('explains unavailable records and preserves an existing search parameter', async () => {
    window.history.replaceState({}, '', `${adminBookingTransactionsPath(10)}&search=KB-MISSING`);
    const fetcher = mount([]);
    await screen.findByText('No payment record is available for kitchen booking #10 with the current filters.');
    const url = fetcher.mock.calls.map(call => call[0]).find(url => url.includes('bookingId='))!;
    expect(new URL(url, 'https://local.invalid').searchParams.get('search')).toBe('KB-MISSING');
  });
});
