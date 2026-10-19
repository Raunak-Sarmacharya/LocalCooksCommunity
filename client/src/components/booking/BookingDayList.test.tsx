import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
import { BookingDayList, currentBookingDays, type BookingDayVisit } from './BookingDayList';
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('chef booking days', () => {
  it('leaves out a day the kitchen declined when it accepted (never booked), keeps a dropped day', () => {
    const day = (id: number, date: string, extra: Partial<BookingDayVisit> = {}): BookingDayVisit => ({ id, visitDate: date, startTime: '09:00', endTime: '12:00', scheduleRevision: 1, scheduleState: 'active', ...extra });
    const visits = [day(1, '2026-11-23'), day(2, '2026-11-25', { scheduleState: 'cancelled', cancellationPlan: { mode: 'declined_at_acceptance' } }),
      day(3, '2026-11-27', { scheduleState: 'cancelled', cancellationPlan: { mode: 'chef' } })];
    expect(currentBookingDays(visits, 1).map(visit => visit.id)).toEqual([1, 3]);
  });
  it('shows done, today, upcoming and cancelled days with a selected visit link only for today', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-01-16T13:00:00Z'));
    const visits: BookingDayVisit[] = [15, 16, 18, 19].map((day, i) => ({ id: i + 1, visitDate: `2030-01-${day}`, startTime: '10:00', endTime: '12:00', scheduleRevision: 2,
      scheduleState: day === 19 ? 'cancelled' : 'active', pricingMode: day === 18 ? 'daily' : 'hourly', checkinStatus: day === 15 ? 'checked_out' : 'not_checked_in' }));
    const days = currentBookingDays([...visits.reverse(), { ...visits[0], id: 99, scheduleRevision: 1 }, { ...visits[0], id: 100, scheduleState: 'superseded' }], 2);
    render(<BookingDayList bookingId={5} visits={days} timezone="America/St_Johns" status="confirmed" />);
    const rows = screen.getAllByRole('listitem'); expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Done'); expect(rows[1]).toHaveTextContent('Today'); expect(rows[2]).toHaveTextContent('Upcoming'); expect(rows[2]).toHaveTextContent('Full day'); expect(rows[3]).toHaveTextContent('Cancelled');
    expect(screen.getByRole('link', { name: 'Check in' })).toHaveAttribute('href', '/booking/5/visit?visitId=2');
    cleanup();
    render(<BookingDayList bookingId={5} visits={days.map(day => day.id === 2 ? { ...day, checkinStatus: 'checked_in' } : day)} timezone="America/St_Johns" status="confirmed" />);
    expect(screen.getByRole('link', { name: 'Check out' })).toHaveAttribute('href', '/booking/5/visit?visitId=2');
    expect(within(rows[0]).queryByRole('link')).toBeNull(); expect(within(rows[3]).queryByRole('link')).toBeNull();
  });
  it('shows what each day cost and any refund on it', () => {
    render(<BookingDayList bookingId={5} visits={[{ id: 1, visitDate: '2030-01-15', startTime: '10:00', endTime: '12:00' }, { id: 2, visitDate: '2030-01-16', startTime: '10:00', endTime: '12:00' }]}
      timezone="America/St_Johns" status="confirmed" money={[{ visitId: 1, allocatedCents: 25010, refundedCents: 0 }, { visitId: 2, allocatedCents: 15250, refundedCents: 5000 }]} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('$250.10'); expect(rows[1]).toHaveTextContent('$152.50'); expect(rows[1]).toHaveTextContent('Refunded $50.00');
  });
  it('uses the kitchen day at the midnight boundary and never opens a cancelled booking', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-01-17T02:00:00Z'));
    render(<BookingDayList bookingId={5} visits={[{ id: 2, visitDate: '2030-01-16', startTime: '22:00', endTime: '23:00' }]} timezone="America/St_Johns" status="cancelled" />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument(); expect(screen.queryByRole('link')).toBeNull();
  });
});
