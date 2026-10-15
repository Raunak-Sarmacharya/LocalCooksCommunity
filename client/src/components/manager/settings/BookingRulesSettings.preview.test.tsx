import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BookingRulesSettings from './BookingRulesSettings';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
vi.mock('@/i18n/manager', async () => ({ mt: (await import('@/test/booking-i18n')).testI18n.getFixedT('en-CA', 'manager') }));
vi.mock('@/i18n/common-ns', () => ({ tt: (key: string) => key }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-presigned-document-url', () => ({ usePresignedDocumentUrl: () => ({ url: null }) }));
const data = vi.hoisted(() => ({ bookings: Array.from({ length: 3 }, () => ({ kitchenId: 1, locationId: 7, status: 'confirmed',
  bookingDate: '2099-10-14', startTime: '10:00', timezone: 'UTC' })), arrival: { checkinEnabled: true, checkoutEnabled: true,
  timeWindowSettings: { checkinWindowMinutesBefore: 15, noShowGraceMinutes: 30 }, platformDefaults: { checkinWindowMinutesBefore: 15, noShowGraceMinutes: 30 } } }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }), useQuery: ({ queryKey }: any) => ({
  data: queryKey[0] === 'managerBookings' ? data.bookings : data.arrival,
}) }));
afterEach(cleanup);
it('previews the current and proposed timing and cancelling the confirm step saves nothing', async () => {
  const save = vi.fn(); render(<BookingRulesSettings location={{ id: 7, name: 'Harbour' }} onSave={save} hideTerms />);
  fireEvent.change(document.getElementById('checkin-window')!, { target: { value: '45' } });
  expect(screen.getByText('Check-in opens 45 minutes before the booked start instead of 15.')).toBeInTheDocument();
  expect(screen.getByText(/Affects 3 upcoming bookings/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep as is' }));
  expect(save).not.toHaveBeenCalled();
});
