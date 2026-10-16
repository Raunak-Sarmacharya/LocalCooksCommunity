import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '@shared/i18n/locales/en-CA/booking.json';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-CA' }, t: (key: string) => (en as Record<string, string>)[key] || key }) }));
import { CheckoutIncidents } from './CheckoutIncidents';
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ incidents: [{ id: 1, sessionId: 'cs_incident', paymentIntentId: 'pi_incident',
    operatingDate: '2099-01-01', outcome: 'needs_support', moneyStatus: 'unverified', amountCents: 2440, currency: 'cad', error: null, lastCheckedAt: null }] }) });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows a checkout without a booking and requires an audit reason to retry the original session', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CheckoutIncidents getToken={async () => 'token'} query="pi_incident" /></QueryClientProvider>);
  expect(await screen.findByText('cs_incident')).toBeInTheDocument(); expect(screen.getByText('$24.40')).toBeInTheDocument();
  const retry = screen.getByRole('button', { name: en.checkoutRetryOriginal }); expect(retry).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: en.checkoutIncidentReason }), { target: { value: 'Checking the original receipt' } });
  fireEvent.click(retry);
  await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => url.endsWith('/cs_incident/retry') && init.method === 'POST')).toBe(true));
  const request = fetcher.mock.calls.find(([url]) => url.endsWith('/cs_incident/retry'))!;
  expect(JSON.parse(request[1].body)).toEqual({ note: 'Checking the original receipt' });
  expect(fetcher.mock.calls[0][0]).toContain('?q=pi_incident');
});
