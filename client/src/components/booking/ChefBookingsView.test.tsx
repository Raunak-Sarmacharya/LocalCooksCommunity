vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
vi.mock('react-i18next', async importOriginal => ({ ...(await importOriginal<object>()), useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChefBookingsView from './ChefBookingsView';

vi.mock('wouter', () => ({ useLocation: () => ['/', vi.fn()] }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: () => () => undefined }));

// "Now" is Wed Oct 14 2026, 2:00 p.m. NDT (UTC-2:30) = 16:30Z.
const NOW = Date.parse('2026-10-14T16:30:00Z');
const row = (overrides: Record<string, unknown>) => ({
  id: 1, chefId: 1, kitchenId: 1, bookingDate: '2026-10-16T00:00:00.000Z', startTime: '09:30', endTime: '10:30',
  status: 'confirmed', paymentStatus: 'paid', createdAt: '2026-10-12T12:00:00.000Z', kitchenName: 'Harbour Kitchen',
  locationName: 'Harbour', locationTimezone: 'America/St_Johns', checkinStatus: 'not_checked_in', ...overrides,
});
const bookings = [
  row({ id: 152, referenceCode: undefined, bookingDate: '2026-10-14T00:00:00.000Z', status: 'confirmed', checkinStatus: 'checked_out' }),
  row({ id: 147, bookingDate: '2026-10-14T00:00:00.000Z', startTime: '09:30', endTime: '10:30' }),
  row({ id: 200, referenceCode: 'KB-GNEWRD', bookingDate: '2026-10-16T00:00:00.000Z' }),
  row({ id: 201, status: 'pending', paymentStatus: 'authorized', bookingDate: '2026-10-20T00:00:00.000Z', createdAt: '2026-10-14T12:00:00.000Z' }),
];

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const mount = () => render(<QueryClientProvider client={new QueryClient()}><ChefBookingsView bookings={bookings as never} isLoading={false} onCancelBooking={vi.fn()} kitchens={[]} /></QueryClientProvider>);

describe('chef bookings list', () => {
  it('writes each booking on its calendar day, never the day before', () => {
    mount();
    expect(screen.getByText(/Oct 16/)).toBeInTheDocument();
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Oct 15$/)).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Past/ }), { button: 0 });
    expect(screen.getAllByText(/Oct 14/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Oct 13/)).not.toBeInTheDocument();
  });

  it('keeps finished visits out of Upcoming', () => {
    mount();
    const upcoming = screen.getByRole('table');
    expect(within(upcoming).queryByText('#152')).not.toBeInTheDocument();
    expect(within(upcoming).queryByText('#147')).not.toBeInTheDocument();
    expect(within(upcoming).getByText('#KB-GNEWRD')).toBeInTheDocument();
  });

  it('shows when the kitchen has to answer instead of an unexplained age', () => {
    mount();
    expect(screen.getByText(/Responds by Oct 15, 9:30 a\.m\./)).toBeInTheDocument();
    expect(screen.queryByText(/\(\d+[dh]\)/)).not.toBeInTheDocument();
  });

  it('labels an overnight slot with the day it starts on, not the operating day', () => {
    const overnight = [row({ id: 139, bookingDate: '2026-10-14T00:00:00.000Z', startTime: '00:15', endTime: '01:15', operatingWindowStartTime: '06:00' })];
    render(<QueryClientProvider client={new QueryClient()}><ChefBookingsView bookings={overnight as never} isLoading={false} onCancelBooking={vi.fn()} kitchens={[]} /></QueryClientProvider>);
    // The slot is Thu Oct 15 00:15 NDT (still ahead of "now"), so it is Upcoming and carries Thursday's date.
    expect(within(screen.getByRole('table')).getByText(/Oct 15/)).toBeInTheDocument();
    expect(screen.queryByText(/Oct 14/)).not.toBeInTheDocument();
  });

  it('words the confirmed row action like the booking page', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Cancel or change' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request cancellation' })).not.toBeInTheDocument();
  });
});
