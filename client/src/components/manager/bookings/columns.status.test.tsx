vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
vi.mock('@/i18n/manager', async () => ({ mt: (await import('@/test/booking-i18n')).useBookingTranslation('manager').t }));
vi.mock('@/i18n/common-ns', async () => ({ tt: (await import('@/test/booking-i18n')).useBookingTranslation('manager').t }));
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBookingColumns, type Booking } from './columns';

const column = (id: string) => getBookingColumns({ onConfirm: vi.fn(), onReject: vi.fn(), onCancel: vi.fn(), hasApprovedLicense: true } as never)
  .find(entry => (entry as { accessorKey?: string }).accessorKey === id) as { cell: (ctx: unknown) => React.ReactNode };
const renderCell = (id: string, booking: Partial<Booking>) => render(<>{column(id).cell({
  row: { original: booking, getValue: (key: string) => (booking as Record<string, unknown>)[key] },
})}</>);
const row = (overrides: Partial<Booking>): Partial<Booking> => ({
  id: 151, kitchenId: 1, chefId: 2, bookingDate: '2026-10-14T00:00:00.000Z', startTime: '09:30', endTime: '10:30',
  locationTimezone: 'America/St_Johns', status: 'confirmed', paymentStatus: 'paid', checkinStatus: 'not_checked_in', ...overrides,
});

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.parse('2026-10-14T20:00:00Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('manager list status', () => {
  it('shows a completed booking as Completed, never Pending, with the arrival and no leftover chips', () => {
    renderCell('status', row({ status: 'completed', checkinStatus: 'checked_out', checkedInAt: '2026-10-14T12:58:00.000Z' }));
    expect(screen.getByTestId('booking-status-pill')).toHaveTextContent('Completed');
    expect(screen.queryByText(/Pending/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Checkout Pending|Not Checked In|Checked Out/)).not.toBeInTheDocument();
    expect(screen.queryByText(/scheduled visit time has ended/)).not.toBeInTheDocument();
    expect(screen.getByText(/Checked in 10:28\s*a\.m\./)).toBeInTheDocument();
  });
  it('uses the same words as the details header for the other phases', () => {
    renderCell('status', row({ status: 'pending', bookingDate: '2026-10-20T00:00:00.000Z' }));
    expect(screen.getByTestId('booking-status-pill')).toHaveTextContent('Request pending');
    cleanup();
    renderCell('status', row({ status: 'confirmed', checkinStatus: 'checkout_requested', checkedInAt: '2026-10-14T12:58:00.000Z' }));
    expect(screen.getByTestId('booking-status-pill')).toHaveTextContent('Checkout to review');
    cleanup();
    renderCell('status', row({ status: 'confirmed' }));
    expect(screen.getByTestId('booking-status-pill')).toHaveTextContent('Visit ended');
  });
  it('shows no arrival line before the chef has arrived', () => {
    renderCell('status', row({ status: 'confirmed', bookingDate: '2026-10-20T00:00:00.000Z' }));
    expect(screen.queryByText(/Checked in/)).not.toBeInTheDocument();
  });
  it('writes the booking date on its calendar day', () => {
    renderCell('bookingDate', row({ bookingDate: '2026-10-14T00:00:00.000Z' }));
    expect(screen.getByText(/Wed, Oct 14, 2026/)).toBeInTheDocument();
  });
});
