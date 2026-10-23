import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@shared/i18n/locales/en-CA/manager.json';

const h = vi.hoisted(() => ({ details: null as any, calls: [] as Array<{ method: string; path: string; body?: any }>, navigate: vi.fn(), preview: null as any, hold: null as Promise<void> | null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { resolvedLanguage: 'en-CA' },
  t: (key: string, values: Record<string, string> = {}) => String((en as Record<string, string>)[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '') }) }));
vi.mock('wouter', () => ({ useRoute: () => [true, { id: '216' }], useLocation: () => ['/manager/booking/216/review', h.navigate],
  Link: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ loading: false, user: { role: 'manager' } }) }));
vi.mock('@/layouts/ManagerBookingLayout', () => ({ default: ({ children }: any) => <main>{children}</main> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
const reply = (body: any, ok = true) => ({ ok, json: async () => body });
vi.mock('@/lib/api', () => ({ apiClient: {
  get: async (path: string) => { h.calls.push({ method: 'GET', path }); return reply(h.details); },
  post: async (path: string, body: any) => { h.calls.push({ method: 'POST', path, body }); return reply(h.preview); },
  put: async (path: string, body: any) => { h.calls.push({ method: 'PUT', path, body }); await h.hold; return reply(body.status === 'confirmed' && body.declinedVisitIds?.length ? { proposal: { id: 'p1' } } : { success: true }); },
} }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ManagerRequestReviewPage from './ManagerRequestReviewPage';

const mount = () => render(<QueryClientProvider client={new QueryClient()}><ManagerRequestReviewPage /></QueryClientProvider>);
beforeEach(() => {
  h.calls = []; h.navigate.mockReset(); h.hold = null;
  h.details = { id: 216, referenceCode: 'KB-8XU587', chefId: 380, status: 'pending', paymentStatus: 'authorized', scheduleRevision: 1,
    bookingDate: '2026-11-23', startTime: '09:00', endTime: '12:00', responseDeadlineAt: '2026-10-20T15:25:00Z', partialAcceptanceAvailable: true,
    chef: { id: 380, username: 'chef', fullName: 'Alex', memberSince: '2025-03-14T12:00:00Z', completedBookingsHere: 2 }, kitchen: { name: 'Main Kitchen' }, location: { id: 47, timezone: 'America/St_Johns' },
    visits: [{ id: 1, visitDate: '2026-11-23', startTime: '09:00', endTime: '12:00', scheduleRevision: 1, scheduleState: 'active', priceSnapshot: { kitchenCents: 7500 } },
      { id: 2, visitDate: '2026-11-25', startTime: '09:00', endTime: '12:00', scheduleRevision: 1, scheduleState: 'active', priceSnapshot: { kitchenCents: 7500 } }],
    equipmentBookings: [], paymentTransaction: { amount: 18300, serviceFee: 1050, cardFeeRate: { percent: 0.037, fixedCents: 30 }, estimatedStripeProcessingFee: 707 } };
  h.preview = { oldTotalCents: 18300, newTotalCents: 9150, serviceFeeCents: 525, allowed: true, deadlineAt: '2026-10-20T15:00:00Z' };
});
afterEach(() => cleanup());

describe('kitchen request review page', () => {
  it('names the chef with initials and a profile link instead of an email', async () => {
    mount();
    const card = await screen.findByTestId('rr-chef');
    expect(card).toHaveTextContent('Alex');
    expect(card).not.toHaveTextContent('chef@');
    fireEvent.click(within(card).getByRole('link'));
    expect(h.navigate).toHaveBeenCalledWith('/manager/customers/380');
  });
  it('while the card is charged, Accept says so and both buttons wait', async () => {
    let release = () => {};
    h.hold = new Promise<void>(resolve => { release = resolve; });
    mount();
    const accept = await screen.findByTestId('rr-accept');
    await act(async () => { fireEvent.click(accept); });
    expect(screen.getByTestId('rr-accept')).toHaveTextContent('Charging the customer’s card…');
    expect(screen.getByTestId('rr-accept')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled();
    await act(async () => { release(); });
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/manager/booking/216'));
  });
  it('shows each day, what the chef pays and what the kitchen keeps (held US card: 3.7% + 30¢), and accepts the whole request', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Review request from Alex' })).toBeInTheDocument();
    expect(screen.getAllByTestId('rr-day')).toHaveLength(2);
    const money = screen.getByTestId('rr-money');
    expect(money).toHaveTextContent('The customer pays$183.00');
    expect(money).toHaveTextContent('Your booking amount (with HST)$172.50');
    expect(money).toHaveTextContent('Est. card processing fee−$7.07');
    expect(money).toHaveTextContent('Est. you receive$165.43');
    expect(money).not.toHaveTextContent('Local Cooks service fee−');
    await act(async () => { fireEvent.click(screen.getByTestId('rr-accept')); });
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/manager/booking/216'));
    expect(h.calls.find(call => call.method === 'PUT')?.body).toEqual({ status: 'confirmed', equipmentActions: [], declinedVisitIds: [] });
  });
  it('a day it can’t host: previews the new total, explains the chef approves first, and sends the change', async () => {
    mount();
    await screen.findAllByTestId('rr-day');
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    await waitFor(() => expect(screen.getByTestId('rr-money')).toHaveTextContent('The customer pays$183.00$91.50'));
    expect(h.calls.find(call => call.method === 'POST')?.body).toEqual({ equipmentBookingIds: [], declinedVisitIds: [2] });
    expect(screen.getByTestId('rr-changes-note')).toHaveTextContent('Alex must approve these changes by');
    // The new total is also right by the send button (the payment card is far above it on a phone).
    expect(screen.getByTestId('rr-changes-summary')).toHaveTextContent('Alex will pay $91.50 instead of $183.00 once they approve. Nothing is charged until then.');
    // The last kept day can't be declined too.
    expect(screen.getAllByRole('checkbox')[0]).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send changes to Alex' })); });
    await waitFor(() => expect(h.navigate).toHaveBeenCalled());
    expect(h.calls.find(call => call.method === 'PUT')?.body).toMatchObject({ status: 'confirmed', declinedVisitIds: [2] });
  });
  it('folds included equipment per day; a broken included item can still be marked and is sent like any add-on', async () => {
    const oven = { status: 'confirmed', totalPrice: 2500, equipmentListing: { equipmentType: 'Commercial Oven' } };
    const range = { status: 'confirmed', totalPrice: 0, equipmentListing: { equipmentType: 'Gas Range', brand: 'Garland' } };
    h.details.equipmentBookings = [{ ...oven, id: 101, kitchenBookingVisitId: 1 }, { ...range, id: 102, kitchenBookingVisitId: 1 },
      { ...oven, id: 103, kitchenBookingVisitId: 2 }, { ...range, id: 104, kitchenBookingVisitId: 2 }];
    mount();
    const [day1] = await screen.findAllByTestId('rr-day');
    // The paid rental stays a visible row; the included item sits in the fold.
    expect(day1).toHaveTextContent('Commercial Oven · $25.00');
    const folds = screen.getAllByTestId('rr-included');
    expect(folds).toHaveLength(2);
    expect(folds[0]).toHaveTextContent('Included equipment (1)');
    expect(folds[0]).not.toHaveAttribute('open');
    fireEvent.click(within(folds[0]).getByRole('checkbox'));
    await waitFor(() => expect(h.calls.find(call => call.method === 'POST')?.body).toEqual({ equipmentBookingIds: [102], declinedVisitIds: [] }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Send changes to Alex' })); });
    await waitFor(() => expect(h.navigate).toHaveBeenCalled());
    expect(h.calls.find(call => call.method === 'PUT')?.body).toEqual({ status: 'confirmed', equipmentActions: [{ equipmentBookingId: 102, action: 'cancelled' }], declinedVisitIds: [] });
  });
  it('decline: plain decline with a message, or suggest other times through a pre-filled invitation', async () => {
    mount();
    await screen.findAllByTestId('rr-day');
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.click(screen.getByRole('radio', { name: /Decline and suggest other times/ }));
    // Suggest: declines (with the flag the chef's notice uses), then opens the pre-filled invitation.
    expect(screen.getByRole('button', { name: 'Decline and choose other times' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /^Decline\s*The customer/ }));
    fireEvent.change(screen.getByLabelText('Message to Alex (optional)'), { target: { value: 'Closed for repairs that week.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Decline request' })); });
    await waitFor(() => expect(h.navigate).toHaveBeenCalled());
    expect(h.calls.find(call => call.method === 'PUT')?.body).toEqual({ status: 'cancelled', message: 'Closed for repairs that week.' });
  });
  it('while declining, the button says the hold is being released and Back waits', async () => {
    let release = () => {};
    h.hold = new Promise<void>(resolve => { release = resolve; });
    mount();
    await screen.findAllByTestId('rr-day');
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Decline request' })); });
    expect(screen.getByRole('button', { name: /Releasing the hold…/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.rrBackToReview })).toBeDisabled();
    await act(async () => { release(); });
    await waitFor(() => expect(h.navigate).toHaveBeenCalled());
  });
  it('suggest other times: declines with the flag, then opens the invitation pre-filled from the request', async () => {
    mount();
    await screen.findAllByTestId('rr-day');
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.click(screen.getByRole('radio', { name: /Decline and suggest other times/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Decline and choose other times' })); });
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/manager/invitations/new?chefId=380&location=47&fromBooking=216'));
    expect(h.calls.find(call => call.method === 'PUT')?.body).toEqual({ status: 'cancelled', suggestOtherTimes: true });
  });
});
