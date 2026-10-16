import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import en from '@shared/i18n/locales/en-CA/booking.json';
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: vi.fn() }));
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer fixture' }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-CA' }, t: (key: string, values: Record<string, string> = {}) => String((en as Record<string, string>)[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] || '') }) }));
import PaymentSuccessPage from './PaymentSuccessPage';
const result = { sessionId: 'cs_requested', state: 'verifying', bookingId: null, paymentIntentId: 'pi_requested', operatingDate: '2099-01-01', amountCents: 2440, currency: 'cad', moneyStatus: 'unverified', refundId: null, lastCheckedAt: null };
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); window.history.replaceState({}, '', '/payment-success?session_id=cs_requested');
  fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => result }); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const mount = async (patch = {}) => {
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ ...result, ...patch }) });
  render(<PaymentSuccessPage />); await act(async () => {});
};
describe('checkout return states', () => {
  it('opens only the request bound to this session and never redirects by recency', async () => {
    await mount({ state: 'request_created', bookingId: 42 });
    expect(screen.getByRole('heading', { name: en.checkoutRequestCreated })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.checkoutViewRequest })).toHaveAttribute('href', '/booking/42');
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(window.location.pathname).toBe('/payment-success');
  });
  it('shows our booking reference, not the Stripe checkout id, once the request exists (live #181)', async () => {
    await mount({ state: 'request_created', bookingId: 42, referenceCode: 'KB-ABC123' });
    expect(screen.getByText('Booking reference: KB-ABC123')).toBeInTheDocument();
    expect(screen.queryByText(/cs_requested/)).not.toBeInTheDocument();
  });
  it('stops polling in an honest verifying state, with next steps and contextual support', async () => {
    await mount(); await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(screen.getByText(en.checkoutVerifyingDetail)).toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(16);
    for (const [url] of fetcher.mock.calls) expect(url).toBe('/api/chef/bookings/by-session/cs_requested');
    expect(screen.queryByText('Payment confirmed')).not.toBeInTheDocument();
    const href = screen.getByRole('link', { name: en.supportContact }).getAttribute('href')!;
    expect(decodeURIComponent(href)).toContain('cs_requested'); expect(decodeURIComponent(href)).toContain('pi_requested');
  });
  it.each([['hold_released', en.checkoutHoldReleased], ['refunded', en.checkoutRefundSent.replace('{amount}', '$24.40')], ['refund_pending', en.checkoutRefundPending.replace('{amount}', '$24.40')]])('shows the verified %s conflict outcome', async (moneyStatus, text) => {
    await mount({ state: 'slot_taken', moneyStatus });
    expect(screen.getByRole('heading', { name: en.checkoutSlotTaken })).toBeInTheDocument(); expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(/Jan 1, 2099/)).toBeInTheDocument();
  });
  it('surfaces a recovery case with the original checkout reference', async () => {
    await mount({ state: 'needs_support' }); expect(screen.getByText(en.checkoutNeedsSupportDetail)).toBeInTheDocument();
    expect(screen.getByText('Checkout reference: cs_requested')).toBeInTheDocument();
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
    expect(fetcher).toHaveBeenCalledTimes(17);
  });
});
