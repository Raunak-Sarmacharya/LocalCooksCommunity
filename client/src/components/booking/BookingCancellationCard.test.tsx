import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { BookingCancellationCard } from './BookingCancellationCard';

vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
afterEach(cleanup);

it.each([50, 100])('explains a booking made inside the notice window (%s%% charge)', lateChargePercent => {
  const client = new QueryClient();
  client.setQueryData(['chef-cancellation-quote', 138], { snapshot: { sessions: [{ startAt: '2026-10-16T16:30:00Z' }],
    noticeHours: 24, lateChargePercent, timezone: 'America/St_Johns' } });
  render(<QueryClientProvider client={client}><BookingCancellationCard bookingId={138} status="completed" canCancel={false}
    createdAt="2026-10-15T18:00:00Z" onCancel={() => {}} /></QueryClientProvider>);
  expect(screen.getByText(lateChargePercent === 100
    ? "You booked inside the 24-hour window, so cancelling now isn't refunded."
    : 'You booked inside the 24-hour window, so cancelling now refunds 50% of the booking total.')).toBeInTheDocument();
  expect(screen.queryByText(/deadline passed/)).not.toBeInTheDocument();
  client.clear();
});
