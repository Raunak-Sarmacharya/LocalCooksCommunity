import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransactionHistory } from './TransactionHistory';

const rows = [
  { id: 1, bookingId: 210, bookingType: 'kitchen', referenceCode: 'KB-AAA', amount: 10000, refundAmount: 0, status: 'succeeded', metadata: {} },
  { id: 2, bookingId: 210, bookingType: 'kitchen', referenceCode: 'KB-AAA', amount: 6100, refundAmount: 0, status: 'succeeded', metadata: { type: 'kitchen_booking_change' } },
  { id: 3, bookingId: 210, bookingType: 'kitchen', referenceCode: 'KB-AAA', amount: 2000, refundAmount: 0, status: 'succeeded', metadata: { type: 'session_extension' } },
  { id: 4, bookingId: 43, bookingType: 'storage', referenceCode: 'SB-BBB', amount: 3000, refundAmount: 0, status: 'succeeded', metadata: { type: 'overstay_penalty' } },
  { id: 5, bookingId: 43, bookingType: 'storage', referenceCode: 'SB-BBB', amount: 4000, refundAmount: 0, status: 'succeeded', metadata: { type: 'storage_term' } },
  { id: 6, bookingId: 211, bookingType: 'kitchen', referenceCode: 'KB-CCC', amount: 5000, refundAmount: 5000, status: 'refunded', metadata: {} },
].map(r => ({ ...r, baseAmount: 0, serviceFee: 0, netAmount: 0, currency: 'CAD', stripeStatus: null, paymentIntentId: null, chargeId: null,
  refundId: null, refundReason: null, createdAt: '2026-10-10T12:00:00Z', paidAt: '2026-10-10T12:00:00Z', refundedAt: null,
  itemName: 'Main kitchen', locationName: 'Fixture', bookingStart: null, bookingEnd: null }));

vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn(async () => ({ json: async () => ({ transactions: rows, total: rows.length }) })) }));
afterEach(cleanup);

describe('chef transaction history', () => {
  it('names each charge type, links the booking and counts refunded payments in Total paid', async () => {
    render(<QueryClientProvider client={new QueryClient()}><TransactionHistory /></QueryClientProvider>);
    expect((await screen.findAllByText('Booking change')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Extra time').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Storage holdover charge').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Storage extension').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'KB-AAA' })[0].getAttribute('href')).toBe('/booking/210');
    expect(screen.getAllByRole('link', { name: 'SB-BBB' })[0].getAttribute('href')).toBe('/storage/43');
    expect(screen.getByText('$301.00')).toBeTruthy(); // Total paid includes the refunded $50
    expect(screen.getByText('$251.00')).toBeTruthy(); // Net = paid - refunded
  });
});
