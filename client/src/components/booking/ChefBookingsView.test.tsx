vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
vi.mock('@/i18n/booking-ns', async () => ({ bt: (await import('@/test/booking-i18n')).useBookingTranslation('booking').t }));
vi.mock('react-i18next', async importOriginal => ({ ...(await importOriginal<object>()), useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChefBookingsView, { type ChefListBooking } from './ChefBookingsView';

vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: () => () => undefined }));
vi.mock('../chef/PendingOverstayPenalties', () => ({ PendingOverstayPenalties: () => null }));
vi.mock('./ExpiringStorageNotification', () => ({ ExpiringStorageNotification: () => null }));
vi.mock('./ChefStorageBookings', () => ({ ChefStorageBookings: () => null }));

// "Now" is Wed Oct 14 2026, 2:00 p.m. NDT (UTC-2:30) = 16:30Z.
const NOW = Date.parse('2026-10-14T16:30:00Z');
const row = (overrides: Partial<ChefListBooking>): ChefListBooking => ({
  id: 1, chefId: 1, kitchenId: 1, bookingDate: '2026-10-16T00:00:00.000Z', startTime: '09:30', endTime: '10:30',
  status: 'confirmed', paymentStatus: 'paid', createdAt: '2026-10-12T12:00:00.000Z', kitchenName: 'Harbour Kitchen',
  locationName: 'Harbour', locationTimezone: 'America/St_Johns', checkinStatus: 'not_checked_in', chargedAmount: 5650, ...overrides,
});
const bookings = [
  row({ id: 165, kitchenName: 'Done Kitchen', bookingDate: '2026-10-14T00:00:00.000Z', startTime: '09:00', endTime: '11:00',
    checkinStatus: 'checkout_requested', checkoutRequestedAt: '2026-10-14T13:20:00.000Z' }),
  row({ id: 164, kitchenName: 'Main Kitchen', bookingDate: '2026-10-14T00:00:00.000Z', startTime: '13:30', endTime: '16:00', checkinStatus: 'checked_in' }),
  row({ id: 200, kitchenName: 'Later Kitchen', referenceCode: 'KB-GNEWRD', bookingDate: '2026-10-20T00:00:00.000Z' }),
  row({ id: 199, kitchenName: 'Soon Kitchen', bookingDate: '2026-10-16T00:00:00.000Z', refundAmount: 2600 }),
  row({ id: 201, kitchenName: 'Request Kitchen', status: 'pending', paymentStatus: 'authorized', bookingDate: '2026-10-17T00:00:00.000Z', startTime: '01:05', endTime: '02:05',
    createdAt: '2026-10-14T12:00:00.000Z' }),
  row({ id: 150, kitchenName: 'Old Kitchen', bookingDate: '2026-10-10T00:00:00.000Z', status: 'completed', checkinStatus: 'checked_out', refundAmount: 500 }),
  row({ id: 151, kitchenName: 'Claim Kitchen', bookingDate: '2026-10-12T00:00:00.000Z', status: 'completed', checkinStatus: 'checked_out',
    chefDue: { kind: 'claim', amountCents: 4200 } }),
  row({ id: 140, kitchenName: 'Gone Kitchen', bookingDate: '2026-10-18T00:00:00.000Z', status: 'cancelled', refundAmount: 2600 }),
];

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const mount = (list: ChefListBooking[] = bookings, onFindKitchen = vi.fn()) =>
  render(<QueryClientProvider client={new QueryClient()}><ChefBookingsView bookings={list} isLoading={false} onFindKitchen={onFindKitchen} /></QueryClientProvider>);
const cards = () => screen.getAllByTestId('chef-booking-card');
const card = (name: string) => cards().find(element => within(element).queryByText(name))!;
const openTab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });

describe('chef My bookings', () => {
  it('is a list of cards, not a data table, with three tabs and their counts', () => {
    mount();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Upcoming\s*5/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Past\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Cancelled\s*1/ })).toBeInTheDocument();
    expect(screen.queryByText(/Columns|Ready to Check Out|Ref\b/)).not.toBeInTheDocument();
  });

  it('orders Upcoming: happening now, the request, then confirmed soonest first', () => {
    mount();
    expect(cards().map(element => element.querySelector('h3')!.textContent)).toEqual(['Done Kitchen', 'Main Kitchen', 'Request Kitchen', 'Soon Kitchen', 'Later Kitchen']);
  });

  it('uses the booking page pill, never the raw "Confirmed", for a visit in progress or checked out', () => {
    mount();
    expect(within(card('Main Kitchen')).getByTestId('booking-status-pill')).toHaveTextContent('In session');
    expect(within(card('Done Kitchen')).getByTestId('booking-status-pill')).toHaveTextContent('Checkout submitted');
    expect(within(card('Request Kitchen')).getByTestId('booking-status-pill')).toHaveTextContent('Request pending');
    expect(within(card('Soon Kitchen')).getByTestId('booking-status-pill')).toHaveTextContent('Confirmed');
  });

  it('gives each card one short line and at most one action', () => {
    mount();
    const live = card('Main Kitchen');
    expect(within(live).getByText('You’re checked in until 4:00 p.m.')).toBeInTheDocument();
    expect(within(live).getByRole('link', { name: 'Open your visit' })).toHaveAttribute('href', '/booking/164/visit');
    expect(within(card('Request Kitchen')).getByText('The kitchen replies by Oct 15, 9:30 a.m.')).toBeInTheDocument();
    // A partial refund on a booking that still goes ahead says what it is (no bare "Refund: $26.00 —").
    expect(within(card('Soon Kitchen')).getByText('$26.00 refunded to you')).toBeInTheDocument();
    expect(within(card('Later Kitchen')).queryAllByRole('link')).toHaveLength(1);
  });

  it('says the date once, 12-hour, and the kitchen zone once for the page', () => {
    mount();
    expect(within(card('Main Kitchen')).getByText('Today · 1:30–4:00 p.m.')).toBeInTheDocument();
    expect(within(card('Request Kitchen')).getByText('Sat, Oct 17 · 1:05–2:05 a.m.')).toBeInTheDocument();
    expect(screen.getAllByText(/Newfoundland/)).toHaveLength(1);
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
  });

  it('links the whole card to the booking page', () => {
    mount();
    expect(within(card('Later Kitchen')).getByRole('link', { name: 'Later Kitchen' })).toHaveAttribute('href', '/booking/200');
  });

  it('shows Past most recent first with the money outcome and Pay when something is owed', () => {
    mount();
    openTab(/Past/);
    expect(cards().map(element => element.querySelector('h3')!.textContent)).toEqual(['Claim Kitchen', 'Old Kitchen']);
    expect(within(card('Old Kitchen')).getByText('Paid $56.50 · $5.00 refunded')).toBeInTheDocument();
    expect(within(card('Claim Kitchen')).getByText('Damage claim to pay')).toBeInTheDocument();
    expect(within(card('Claim Kitchen')).getByRole('link', { name: 'Pay $42.00' })).toHaveAttribute('href', '/booking/151');
  });

  it('shows the refund outcome on a cancelled booking and hides Cancelled when empty', () => {
    mount();
    openTab(/Cancelled/);
    expect(within(card('Gone Kitchen')).getByText('Refunded $26.00')).toBeInTheDocument();
    cleanup();
    mount(bookings.filter(booking => booking.status !== 'cancelled'));
    expect(screen.queryByRole('tab', { name: /Cancelled/ })).not.toBeInTheDocument();
  });

  it('puts closed-out bookings with a stale check-in column in Past as Completed, with no visit action (lead round 2)', () => {
    const closed = (id: number, kitchenName: string, checkinStatus: string) => row({ id, kitchenName, bookingDate: '2026-10-13T00:00:00.000Z',
      startTime: '21:15', endTime: '22:15', status: 'completed', checkinStatus, closeout: { phase: 'ended', visits: [{ inspection: { canRespond: false } }] } });
    mount([closed(132, 'Stale In Kitchen', 'checked_in'), closed(151, 'Stale Out Kitchen', 'checkout_requested'), row({ id: 200, kitchenName: 'Later Kitchen', bookingDate: '2026-10-20T00:00:00.000Z' })]);
    expect(screen.queryByText('Stale In Kitchen')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open your visit' })).not.toBeInTheDocument();
    openTab(/Past/);
    for (const name of ['Stale In Kitchen', 'Stale Out Kitchen']) {
      expect(within(card(name)).getByTestId('booking-status-pill')).toHaveTextContent('Completed');
      expect(within(card(name)).queryByRole('link', { name: 'Open your visit' })).not.toBeInTheDocument();
    }
  });

  it('shows a search box only for a long tab', () => {
    mount();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    cleanup();
    const many = Array.from({ length: 9 }, (_, index) => row({ id: 300 + index, kitchenName: `Kitchen ${index}`, bookingDate: `2026-10-${20 + index}T00:00:00.000Z` }));
    mount(many);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Kitchen 3' } });
    expect(cards()).toHaveLength(1);
  });

  it('labels an overnight slot with the day it starts on, not the operating day', () => {
    mount([row({ id: 139, bookingDate: '2026-10-14T00:00:00.000Z', startTime: '00:15', endTime: '01:15', operatingWindowStartTime: '06:00' })]);
    expect(screen.getByText('Tomorrow · 12:15–1:15 a.m.')).toBeInTheDocument();
  });

  it('offers one sentence and "Find a kitchen" when there is nothing booked', () => {
    const find = vi.fn();
    mount([], find);
    expect(screen.getByText('You haven’t booked a kitchen yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Find a kitchen' }));
    expect(find).toHaveBeenCalled();
  });
});
