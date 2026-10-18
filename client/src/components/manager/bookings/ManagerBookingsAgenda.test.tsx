vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
vi.mock('@/i18n/manager', async () => ({ mt: (await import('@/test/booking-i18n')).useBookingTranslation('manager').t }));
vi.mock('react-i18next', async importOriginal => ({ ...(await importOriginal<object>()), useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagerBookingsAgenda, managerBookingsCSV } from './ManagerBookingsAgenda';
import type { Booking } from './ManagerBookingPayment';
import { bookingReceiveCents } from './ManagerBookingPayment';
vi.mock('@/lib/formatters', async original => ({ ...await original<object>(), downloadCSV: vi.fn() }));
import { downloadCSV } from '@/lib/formatters';
vi.mock('@/components/ui/date-field', () => ({ DateField: (props: any) => <input type="date" aria-label={props['aria-label']} value={props.value} onChange={event => props.onChange(event.target.value)} /> }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: any) => <select aria-label="Status" value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

// "Now" is Wed Oct 14 2026, 2:00 p.m. NDT (16:30Z).
const NOW = Date.parse('2026-10-14T16:30:00Z');
const row = (overrides: Partial<Booking>): Booking => ({
  id: 1, kitchenId: 1, chefId: 2, bookingDate: '2026-10-20T00:00:00.000Z', startTime: '09:30', endTime: '10:30', createdAt: '2026-10-01T00:00:00Z',
  locationTimezone: 'America/St_Johns', status: 'confirmed', paymentStatus: 'paid', checkinStatus: 'not_checked_in', chefName: 'Ada Chef',
  kitchenName: 'Main Kitchen', transactionAmount: 5650, managerRevenue: 4800, totalPrice: 5000, ...overrides,
});
const rows = [
  row({ id: 1, chefName: 'Upcoming Chef' }),
  row({ id: 2, chefName: 'Request Chef', status: 'pending', paymentStatus: 'authorized', bookingDate: '2026-10-22T00:00:00.000Z' }),
  row({ id: 3, chefName: 'Later Today Chef', bookingDate: '2026-10-14T00:00:00.000Z', startTime: '15:00', endTime: '17:00' }),
  row({ id: 4, chefName: 'Checkout Chef', bookingDate: '2026-10-14T00:00:00.000Z', startTime: '09:00', endTime: '11:00', checkinStatus: 'checkout_requested',
    visitStates: [{ id: 77, checkinStatus: 'checkout_requested' }] }),
  row({ id: 5, chefName: 'In Session Chef', bookingDate: '2026-10-14T00:00:00.000Z', startTime: '13:00', endTime: '15:00', checkinStatus: 'checked_in', checkedInAt: '2026-10-14T15:28:00Z' }),
  row({ id: 6, chefName: 'Overstay Chef', bookingDate: '2026-10-14T00:00:00.000Z', startTime: '11:00', endTime: '13:00', checkinStatus: 'checked_in', closeout: { phase: 'booked_time_ended' } }),
  row({ id: 7, chefName: 'Past Chef', bookingDate: '2026-10-10T00:00:00.000Z', status: 'completed', checkinStatus: 'checked_out' }),
];

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const mount = (list = rows, onReviewRequest = vi.fn()) => render(<ManagerBookingsAgenda bookings={list} onReviewRequest={onReviewRequest} />);
const rowFor = (chef: string) => screen.getAllByTestId('manager-booking-row').find(element => within(element).queryByText(chef))!;

describe('manager bookings agenda', () => {
  it('opens on Needs action, then Today, then Upcoming', () => {
    mount();
    const order = (key: string) => within(screen.getByTestId(`manager-group-${key}`)).getAllByTestId('manager-booking-row')
      .map(element => element.querySelectorAll('p')[1].textContent);
    expect(order('needs_action')).toEqual(['Checkout Chef', 'Overstay Chef', 'Request Chef']);
    expect(order('today')).toEqual(['In Session Chef', 'Later Today Chef']);
    expect(order('upcoming')).toEqual(['Upcoming Chef']);
    expect(screen.queryByText('Past Chef')).not.toBeInTheDocument();
  });

  it('uses the booking page pill instead of the raw status', () => {
    mount();
    expect(within(rowFor('In Session Chef')).getByTestId('booking-status-pill')).toHaveTextContent('In session');
    expect(within(rowFor('In Session Chef')).getByText(/Checked in 12:58\s*p\.m\./)).toBeInTheDocument();
    expect(within(rowFor('Checkout Chef')).getByTestId('booking-status-pill')).toHaveTextContent('Checkout to review');
    expect(within(rowFor('Overstay Chef')).getByText('Time ended · still checked in')).toBeInTheDocument();
    expect(within(rowFor('Upcoming Chef')).getByTestId('booking-status-pill')).toHaveTextContent('Confirmed');
    expect(screen.getAllByTestId('booking-status-pill').filter(pill => pill.textContent === 'Confirmed')).toHaveLength(1);
  });

  it('offers one action only where something waits on the manager', () => {
    const review = vi.fn();
    mount(rows, review);
    expect(within(rowFor('Checkout Chef')).getByRole('link', { name: 'Review checkout' })).toHaveAttribute('href', '/manager/booking/4/inspection?visitId=77');
    fireEvent.click(within(rowFor('Request Chef')).getByRole('button', { name: 'Review request' }));
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    expect(within(rowFor('Upcoming Chef')).queryByRole('button')).not.toBeInTheDocument();
    // Time ended with the chef still checked in: the booking page's "Record when they left".
    expect(within(rowFor('Overstay Chef')).getByRole('link', { name: 'Record when they left' })).toHaveAttribute('href', '/manager/booking/6');
    // Every Needs-action row carries exactly one action.
    for (const element of within(screen.getByTestId('manager-group-needs_action')).getAllByTestId('manager-booking-row'))
      // The first link is the row itself (its when-line); the rest are actions.
      expect(element.querySelectorAll('a, button').length - 1).toBe(1);
    expect(within(rowFor('Upcoming Chef')).getAllByRole('link')).toHaveLength(1);
  });

  it('writes friendly 12-hour times without the current year', () => {
    mount();
    expect(within(rowFor('Later Today Chef')).getByText('Today · 3:00–5:00 p.m.')).toBeInTheDocument();
    expect(within(rowFor('Upcoming Chef')).getByText('Tue, Oct 20 · 9:30–10:30 a.m.')).toBeInTheDocument();
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
  });

  it('closed-out bookings: settled (inspection closed) → Past; open inspection → Needs action', () => {
    mount([...rows, row({ id: 132, chefName: 'Closed Chef', bookingDate: '2026-10-13T00:00:00.000Z', startTime: '21:15', endTime: '22:15', status: 'completed',
      checkinStatus: 'checked_in', closeout: { phase: 'ended', visits: [{ inspection: { canRespond: false } }] } }),
    row({ id: 160, chefName: 'Closed Checkout Chef', bookingDate: '2026-10-13T00:00:00.000Z', status: 'completed', checkinStatus: 'checkout_requested',
      closeout: { phase: 'ended', visits: [{ inspection: { canRespond: true } }] } })]);
    // Inspection closed (#132): settled history in Past. Inspection still open (#160): the checkout review needs action.
    expect(screen.queryByText('Closed Chef')).not.toBeInTheDocument();
    const needs = within(screen.getByTestId('manager-group-needs_action'));
    expect(needs.getAllByTestId('manager-booking-row')).toHaveLength(4);
    expect(within(rowFor('Closed Checkout Chef')).getByTestId('booking-status-pill')).toHaveTextContent('Checkout to review');
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Past/ }), { button: 0 });
    expect(within(rowFor('Closed Chef')).getByTestId('booking-status-pill')).toHaveTextContent('Completed');
  });

  it('keeps past bookings in their own tab, most recent first', () => {
    mount([...rows, row({ id: 8, chefName: 'Older Chef', bookingDate: '2026-10-02T00:00:00.000Z', status: 'completed', checkinStatus: 'checked_out' })]);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Past/ }), { button: 0 });
    expect(screen.getAllByTestId('manager-booking-row').map(element => element.querySelectorAll('p')[1].textContent)).toEqual(['Past Chef', 'Older Chef']);
    expect(screen.queryByRole('tab', { name: /Cancelled/ })).not.toBeInTheDocument();
  });

  it('searches by chef, kitchen or reference', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'overstay' } });
    expect(screen.getAllByTestId('manager-booking-row')).toHaveLength(1);
  });
});

it('CP9: a request that began last week shows today’s later day and its inspection target', () => {
 mount([row({ id: 22, chefName: 'Dated Chef', scheduleRevision: 1, bookingDate: '2026-10-07', checkinStatus: 'checked_out', visitStates: [
  { id: 11, visitDate: '2026-10-07', startTime: '13:00', endTime: '15:00', checkinStatus: 'checked_out' },
  { id: 12, visitDate: '2026-10-14', startTime: '15:00', endTime: '17:00', checkinStatus: 'not_checked_in' }] })]);
 expect(within(screen.getByTestId('manager-group-today')).getByText('Dated Chef')).toBeInTheDocument();
 expect(screen.getByText('Day 2 of 2')).toBeInTheDocument();
});

it.each(['confirmed', 'cancelled'])('shows the projected kitchen remainder and refund for %s bookings', status => {
  mount([row({ status, refundAmount: 2000, paymentStatus: 'partially_refunded', payout: {
    timing: 'after_closeout', status: 'scheduled', holdReason: null, expectedAt: null, sentAt: null, amountCents: 3175,
  } })]);
  if (status === 'cancelled') fireEvent.mouseDown(screen.getByRole('tab', { name: /Cancelled/ }), { button: 0 });
  expect(screen.getByText('You receive $31.75')).toBeInTheDocument();
  expect(screen.getByText('Refunded $20.00')).toBeInTheDocument();
});

it('combines reference search, inclusive dates and status, and exports only the shown rows', () => {
  mount([row({ id: 91, referenceCode: 'KB-ABC', chefName: 'Ada, "Chef"', payout: { timing: 'after_closeout', status: 'scheduled', holdReason: null, expectedAt: null, sentAt: null, amountCents: 4800 } }),
    row({ id: 92, referenceCode: 'KB-DEF', chefName: 'Other Chef' }), row({ id: 93, referenceCode: 'KB-GHI', status: 'pending' })]);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'kb-abc' } });
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-20' } });
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-20' } });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'confirmed' } });
  expect(screen.getAllByTestId('manager-booking-row')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  const csv = vi.mocked(downloadCSV).mock.lastCall![0];
  expect(csv.split('\n')).toHaveLength(2);
  expect(csv.split('\n')[0]).toBe('"Date","Day","Chef","Kitchen","Status","Total","Refunded","You receive"');
  expect(csv).toContain('"Ada, ""Chef"""');
  expect(csv).toContain('"56.50","0.00","48.00"');
  expect(csv).not.toContain('Other Chef');
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-21' } });
  expect(screen.queryByTestId('manager-booking-row')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getAllByTestId('manager-booking-row')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'pending' } });
  expect(screen.queryByTestId('manager-booking-row')).not.toBeInTheDocument();
});

it('keeps the day label in CSV and uses only that day’s projected installments', () => {
  const booking = row({ scheduleRevision: 1, visitStates: [
    { id: 11, visitDate: '2026-10-07', startTime: '13:00', endTime: '15:00', checkinStatus: 'checked_out' },
    { id: 12, visitDate: '2026-10-14', startTime: '15:00', endTime: '17:00', checkinStatus: 'not_checked_in' }],
    payout: { timing: 'after_closeout', status: 'scheduled', holdReason: null, expectedAt: null, sentAt: null, amountCents: 7000,
      installments: [11, 12].map((visitId, index) => ({ installmentId: index, sourceId: 1, visitId, operatingDate: null, status: 'scheduled', amountCents: 3500, feePending: false, transferId: null })) } });
  mount([booking]);
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  expect(vi.mocked(downloadCSV).mock.lastCall![0]).toContain('"2026-10-14","Day 2 of 2"');
  expect(vi.mocked(downloadCSV).mock.lastCall![0]).toContain('"35.00"');
  expect(bookingReceiveCents({ ...booking, visitStates: [booking.visitStates![1]] })).toBe(3500);
});

it('exports zero remaining earnings, escapes formulas and omits payment provider IDs', () => {
  const booking = row({ chefName: '=Chef', kitchenName: '@Kitchen', paymentIntentId: 'pi_private', refundAmount: 5650,
    payout: { timing: 'after_closeout', status: 'not_applicable', holdReason: null, expectedAt: null, sentAt: null, amountCents: 0 } });
  const csv = managerBookingsCSV([{ row: booking, phase: 'cancelled', startMs: 0 }], [booking]);
  expect(csv).toContain('"\'=Chef","\'@Kitchen"');
  expect(csv).toContain('"56.50","56.50","0.00"');
  expect(csv).not.toContain('pi_private');
});
