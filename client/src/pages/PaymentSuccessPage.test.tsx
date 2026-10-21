import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import en from '@shared/i18n/locales/en-CA/booking.json';
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: vi.fn(() => ({ loading: false })) }));
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer fixture' }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-CA' }, t: (key: string, values: Record<string, string> = {}) => String((en as Record<string, string>)[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] || '') }) }));
import PaymentSuccessPage from './PaymentSuccessPage';
const result = { sessionId: 'cs_requested', state: 'verifying', bookingId: null, paymentIntentId: 'pi_requested', operatingDate: '2099-01-01', amountCents: 2440, currency: 'cad', moneyStatus: 'unverified', refundId: null, lastCheckedAt: null };
let fetcher: ReturnType<typeof vi.fn>;
const sessionCalls = () => fetcher.mock.calls.filter(([url]) => String(url).includes("/by-session/")).length;
beforeEach(() => {
  vi.useFakeTimers(); window.history.replaceState({}, '', '/payment-success?session_id=cs_requested');
  fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => result }); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
// The booking details (kitchen, times, reply deadline) are display only; without them the page falls back to the outcome.
const mount = async (patch = {}, details?: object) => {
  fetcher.mockImplementation(async (url: string) => url.includes("/details") ? { ok: !!details, json: async () => details } : { ok: true, json: async () => ({ ...result, ...patch }) });
  render(<PaymentSuccessPage />); await act(async () => {});
};
describe('checkout return states', () => {
  it('opens only the request bound to this session and never redirects by recency', async () => {
    await mount({ state: 'request_created', bookingId: 42 });
    expect(screen.getByRole('heading', { name: en.checkoutRequestCreated })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.checkoutViewRequest })).toHaveAttribute('href', '/booking/42');
    // The chef sees that the amount is only held until the kitchen accepts.
    expect(screen.getByText('$24.40 held on your card. You haven’t been charged.')).toBeInTheDocument();
    expect(screen.getByText(en.checkoutRequestCreatedDetail)).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(sessionCalls()).toBe(1); expect(window.location.pathname).toBe('/payment-success');
  });
  it('an invitation reads "Confirming" until the booking is confirmed, then "Your booking is confirmed" (live #194)', async () => {
    await mount({ state: 'request_created', bookingId: 194, invitation: true, confirmed: false });
    expect(screen.getByText(en.checkoutConfirmingDetail)).toBeInTheDocument();
    expect(screen.queryByText(en.checkoutRequestCreatedDetail)).not.toBeInTheDocument();
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ ...result, state: 'request_created', bookingId: 194, invitation: true, confirmed: true }) });
    await act(async () => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByRole('heading', { name: en.checkoutConfirmed })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.checkoutViewBooking })).toHaveAttribute('href', '/booking/194');
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(sessionCalls()).toBe(2);
  });
  it('shows our booking reference, not the Stripe checkout id, once the request exists (live #181)', async () => {
    await mount({ state: 'request_created', bookingId: 42, referenceCode: 'KB-ABC123' });
    expect(screen.getByText('Booking reference: KB-ABC123')).toBeInTheDocument();
    expect(screen.queryByText(/cs_requested/)).not.toBeInTheDocument();
  });
  it('starts calm while the checkout is normally landing, and escalates to "Still verifying" only after 20 s', async () => {
    await mount();
    expect(screen.getByRole('heading', { name: en.checkoutSending })).toBeInTheDocument();
    expect(screen.getByText(en.checkoutSendingDetail)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.checkoutCheckAgain })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByRole('heading', { name: en.checkoutVerifying })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.checkoutCheckAgain })).toBeInTheDocument();
  });
  it('shows the kitchen, every day with its times, the reply deadline and what happens next from the booking', async () => {
    const visit = (id: number, visitDate: string) => ({ id, visitDate, startTime: '06:00', endTime: '07:00', scheduleRevision: 1, scheduleState: 'active' });
    await mount({ state: 'request_created', bookingId: 42 }, { status: 'pending', paymentStatus: 'authorized', responseDeadlineAt: '2099-01-01T20:41:00Z',
      bookingDate: '2099-01-05', startTime: '06:00', endTime: '07:00', scheduleRevision: 1, visits: [visit(1, '2099-01-05'), visit(2, '2099-01-06'), visit(3, '2099-01-07')],
      kitchen: { name: 'Harbour Kitchen', photos: [] }, location: { name: 'Harbour Hall', timezone: 'America/St_Johns' } });
    await act(async () => {});
    expect(screen.getByRole('heading', { name: 'Harbour Kitchen' })).toBeInTheDocument();
    expect(screen.getByText('Harbour Hall')).toBeInTheDocument();
    expect(screen.getByTestId('reply-deadline')).toHaveTextContent(/^Harbour Kitchen has until .*Jan 1.*Newfoundland.* to respond.$/);
    expect(screen.getByTestId('request-days').querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByTestId('request-days')).toHaveTextContent(/Jan 5.*6:00.*7:00/);
    for (const key of ['rvStepSend', 'rvStepRespond', 'rvStepArrive'] as const) expect(screen.getByText(en[key])).toBeInTheDocument();
    // The hold explanation still shows, now beside the amount.
    expect(screen.getByText(en.checkoutRequestCreatedDetail)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.checkoutDashboard })).toHaveAttribute('href', '/dashboard');
  });
  it('stops polling in an honest verifying state, with next steps and contextual support', async () => {
    await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(screen.getByText(en.checkoutVerifyingDetail)).toBeInTheDocument(); expect(sessionCalls()).toBe(16);
    for (const [url] of fetcher.mock.calls) expect(url).toBe('/api/chef/bookings/by-session/cs_requested');
    expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument();
    const href = screen.getByRole('link', { name: en.supportContact }).getAttribute('href')!;
    expect(decodeURIComponent(href)).toContain('cs_requested'); expect(decodeURIComponent(href)).toContain('pi_requested');
  });
  it.each([['hold_released', en.checkoutHoldReleased], ['refunded', en.checkoutRefundSent.replace('{amount}', '$24.40')], ['refund_pending', en.checkoutRefundPending.replace('{amount}', '$24.40')]])('shows the verified %s conflict outcome', async (moneyStatus, text) => {
    await mount({ state: 'slot_taken', moneyStatus });
    expect(screen.getByRole('heading', { name: en.checkoutSlotTaken })).toBeInTheDocument(); expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(/Jan 1, 2099/)).toBeInTheDocument();
    // A taken time never touches what the chef already has (e.g. a request they were changing that the kitchen accepted first).
    expect(screen.getByText(en.checkoutOthersUnchanged)).toBeInTheDocument();
  });
  it('surfaces a recovery case; the checkout reference goes to support, never onto the page', async () => {
    await mount({ state: 'needs_support' }); expect(screen.getByText(en.checkoutNeedsSupportDetail)).toBeInTheDocument();
    expect(screen.queryByText(/cs_requested/)).not.toBeInTheDocument();
    expect(decodeURIComponent(screen.getByRole('link', { name: en.supportContact }).getAttribute('href') || '')).toContain('Checkout: cs_requested');
  });
  it('does not invent payment success when the checkout reference is missing', async () => {
    window.history.replaceState({}, '', '/payment-success?bookingId=999'); await mount();
    expect(screen.getByText(en.checkoutNeedsSupportDetail)).toBeInTheDocument(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not show another session or a success assertion after failed verification', async () => {
    await mount({ sessionId: 'cs_other', state: 'request_created', bookingId: 77 });
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(screen.getByRole('heading', { name: en.checkoutNeedsSupport })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: en.checkoutViewRequest })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.checkoutCheckAgain })); await act(async () => {});
    expect(sessionCalls()).toBe(17);
  });
});

describe('checkout return after "Change request"', () => {
  const replacement = (outcome: string, extra = {}) => ({ outcome, oldBookingId: 10, oldReference: 'KB-OLD111', newReference: 'KB-NEW222', kitchenName: 'Harbour Kitchen', ...extra });
  const created = { state: 'request_created', bookingId: 42, referenceCode: 'KB-NEW222' };
  it('says the earlier request was withdrawn and its hold released', async () => {
    await mount({ ...created, replacement: replacement('withdrawn') });
    expect(screen.getByTestId('change-request-result')).toHaveTextContent('Your earlier request KB-OLD111 was withdrawn and its card hold released. Banks can take a few days to show a released hold.');
  });
  it('race: the kitchen accepted the original first, so it says there are two bookings and links to the earlier one', async () => {
    await mount({ ...created, replacement: replacement('two_bookings') });
    const result = screen.getByTestId('change-request-result');
    expect(result).toHaveTextContent('Harbour Kitchen accepted your original request KB-OLD111 before your change was sent. You now have two bookings. Cancel the one you don’t need. The new request KB-NEW222 can be withdrawn at no cost.');
    expect(screen.getByRole('link', { name: en.crViewEarlier })).toHaveAttribute('href', '/booking/10');
    expect(screen.getByRole('link', { name: en.checkoutViewRequest })).toHaveAttribute('href', '/booking/42');
  });
  it('says plainly when the earlier hold is still being released', async () => {
    await mount({ ...created, replacement: replacement('releasing') });
    expect(screen.getByTestId('change-request-result')).toHaveTextContent('We’re releasing the card hold for your earlier request KB-OLD111. Your new request is sent. You don’t need to do anything.');
  });
  it('says there was nothing to withdraw when the earlier request had already ended', async () => {
    await mount({ ...created, replacement: replacement('ended') });
    expect(screen.getByTestId('change-request-result')).toHaveTextContent('Your earlier request KB-OLD111 had already ended, so there was nothing to withdraw.');
  });
  it('shows nothing extra for an ordinary request, or for a checkout that did not create a request', async () => {
    await mount(created);
    expect(screen.queryByTestId('change-request-result')).toBeNull();
    cleanup();
    await mount({ state: 'slot_taken', moneyStatus: 'hold_released', replacement: replacement('withdrawn') });
    expect(screen.queryByTestId('change-request-result')).toBeNull();
  });
  it('never shows a Stripe id for the earlier request', async () => {
    await mount({ ...created, replacement: replacement('two_bookings') });
    expect(document.body.textContent).not.toMatch(/(pi|cs)_[A-Za-z0-9]+/);
  });

  it.each(['pending', 'releasing'])('keeps polling an unresolved %s pair until the two-booking warning is available', async status => {
    await mount({ ...created, replacement: replacement(status) });
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ ...result, ...created, replacement: replacement('two_bookings') }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByTestId('change-request-result')).toHaveTextContent('You now have two bookings.');
    expect(sessionCalls()).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(sessionCalls()).toBe(2);
  });

  it('continues refreshing a release beyond the ordinary verification retry window, with a slower interval', async () => {
    await mount({ ...created, replacement: replacement('releasing') });
    await act(async () => { await vi.advanceTimersByTimeAsync(32_000); });
    expect(sessionCalls()).toBe(16);
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ ...result, ...created, replacement: replacement('withdrawn') }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(sessionCalls()).toBe(17);
    expect(screen.getByTestId('change-request-result')).toHaveTextContent('was withdrawn and its card hold released');
  });

  it('offers support for a parked payment case without claiming the hold was released', async () => {
    await mount({ ...created, replacement: replacement('needs_support') });
    expect(screen.getByTestId('change-request-result')).toHaveTextContent('Local Cooks needs to check the payment');
    expect(screen.getByRole('link', { name: en.supportContact })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.checkoutCheckAgain })).toBeInTheDocument();
  });

  it('uses neutral wording and retains the link when an earlier request has no public reference', async () => {
    await mount({ ...created, replacement: replacement('two_bookings', { oldReference: null }) });
    expect(screen.getByTestId('change-request-result')).toHaveTextContent('your original request');
    expect(screen.getByTestId('change-request-result').textContent).not.toMatch(/#10|request 10/);
    expect(screen.getByRole('link', { name: en.crViewEarlier })).toHaveAttribute('href', '/booking/10');
  });
});
