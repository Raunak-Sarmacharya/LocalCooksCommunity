import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ details: null as any, posts: [] as any[], navigate: vi.fn(), toast: vi.fn(), answer: { ok: true, body: { success: true } as any } }));
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
vi.mock('wouter', () => ({ useRoute: () => [true, { id: '216' }], useLocation: () => ['/booking/216/offer', h.navigate],
  Link: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/layouts/ChefDashboardLayout', () => ({ default: ({ children }: any) => <main>{children}</main> }));
vi.mock('@/layouts/chef-shell-context', () => ({ useChefShellChrome: () => false }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/lib/api', () => ({ apiClient: {
  get: async () => ({ ok: true, json: async () => h.details }),
  post: async (path: string, body: any) => { h.posts.push({ path, body }); return { ok: h.answer.ok, json: async () => h.answer.body }; },
} }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChefOfferPage from './ChefOfferPage';

const mount = () => render(<QueryClientProvider client={new QueryClient()}><ChefOfferPage /></QueryClientProvider>);
beforeEach(() => {
  h.posts = []; h.navigate.mockReset(); h.toast.mockReset(); h.answer = { ok: true, body: { success: true } };
  h.details = { id: 216, status: 'pending', paymentStatus: 'authorized', scheduleRevision: 1, bookingDate: '2026-11-23', startTime: '09:00', endTime: '12:00',
    kitchen: { name: 'Kitchen North' }, location: { timezone: 'America/St_Johns' }, paymentTransaction: { amount: 18300 },
    cancellationPolicySnapshot: { noticeHours: 24, sessions: [{ startAt: '2026-11-23T12:30:00.000Z' }, { startAt: '2026-11-25T12:30:00.000Z' }] },
    visits: [{ id: 1, visitDate: '2026-11-23', startTime: '09:00', endTime: '12:00', scheduleRevision: 1, scheduleState: 'active' },
      { id: 2, visitDate: '2026-11-25', startTime: '09:00', endTime: '12:00', scheduleRevision: 1, scheduleState: 'active' }],
    equipmentBookings: [{ id: 31, kitchenBookingVisitId: 1, totalPrice: 2500, equipmentListing: { equipmentType: 'Mixer' } }],
    partialAcceptance: { id: 'p1', state: 'waiting', intentId: 'pi', proposedAt: '2026-10-20T12:00:00Z', deadlineAt: '2026-10-21T12:00:00Z',
      equipment: [{ id: 31, status: 'cancelled' }], declined: [{ id: 31, name: 'Mixer', cents: 2500, date: '2026-11-23' }],
      declinedVisitIds: [2], declinedDays: [{ visitId: 2, date: '2026-11-25', cents: 7500 }], oldTotalCents: 18300, newTotalCents: 6100 } };
});
afterEach(() => cleanup());

describe('chef offer page', () => {
  it('shows every requested day and add-on as booked or not, both totals, the release and the deadline that would apply', async () => {
    mount();
    const days = await screen.findAllByTestId('offer-day');
    expect(days[0]).toHaveTextContent('Booked');
    expect(within(days[0]).getByText(/Mixer/)).toHaveClass('line-through');
    expect(days[0]).toHaveTextContent('Not provided');
    expect(days[1]).toHaveTextContent('Not available');
    const money = screen.getByTestId('offer-money');
    expect(money).toHaveTextContent('Your request$183.00');
    expect(money).toHaveTextContent('New total$61.00');
    expect(money).toHaveTextContent('You’re charged $61.00 when you accept, and $122.00 of your card hold is released.');
    expect(money).toHaveTextContent('If you accept, you can cancel by');
  });
  it('accepts with the proposal id and returns to the booking', async () => {
    mount();
    await screen.findAllByTestId('offer-day');
    await act(async () => { fireEvent.click(screen.getByTestId('offer-accept')); });
    expect(h.posts).toEqual([{ path: '/chef/bookings/216/partial-acceptance', body: { proposalId: 'p1', answer: 'accept' } }]);
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/booking/216'));
    expect(h.toast).toHaveBeenCalledWith({ title: 'Booking confirmed. You were charged $61.00.' });
  });
  it('declines only after confirming; shows the server’s reason when refused', async () => {
    mount();
    await screen.findAllByTestId('offer-day');
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(h.posts).toHaveLength(0);
    h.answer = { ok: false, body: { error: 'The time to answer has passed, so this request is closed. You weren’t charged.' } };
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, decline' })); });
    expect(h.posts[0].body).toEqual({ proposalId: 'p1', answer: 'decline' });
    expect(await screen.findByRole('alert')).toHaveTextContent('The time to answer has passed');
  });
});
