import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { BookingHistoryPanel } from './BookingHistoryPanel';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('react-i18next', async () => {
  const { default: locale } = await import('../../../../shared/i18n/locales/en-CA/booking.json');
  return { useTranslation: () => ({ i18n: { resolvedLanguage: 'en-CA' }, t: (key: string, options?: any) =>
    String(key.split('.').reduce((value: any, part) => value?.[part], locale) || key).replace('{{id}}', String(options?.id)) }) };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(role: 'chef' | 'manager' = 'chef') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (version: string) => <QueryClientProvider client={client}><BookingHistoryPanel id={10} reference="KB-TEST" version={version} role={role} /></QueryClientProvider>;
  const view = render(tree('first'));
  return { client, view, tree };
}
it('shows a dated tour-style trail and refreshes after the booking changes', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ complete: true, events: [
    { key: '1', kind: 'requested', recordedAt: '2026-10-01T12:00:00Z' },
    { key: '2', kind: 'confirmed', recordedAt: '2026-10-02T12:00:00Z' },
  ] }) }));
  vi.stubGlobal('fetch', fetcher);
  const { client, view, tree } = mount();
  expect(await screen.findByText('Booking confirmed')).toBeInTheDocument();
  const region = screen.getByRole('region', { name: 'Recorded booking activity' });
  expect(region).toHaveAttribute('tabindex', '0');
  expect(region).toHaveClass('max-h-80', 'overflow-y-auto');
  expect(screen.getAllByTestId('booking-history-dot')).toHaveLength(2);
  expect(region.querySelector('time')).toHaveAttribute('datetime', '2026-10-01T12:00:00Z');
  expect(region.querySelector('time')?.textContent).toMatch(/9:30/);
  expect(screen.queryByText('Earlier activity may not be available for this booking.')).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledWith('/api/chef/bookings/10/history', { headers: { Authorization: 'Bearer fixture-token' }, cache: 'no-store' });
  view.rerender(tree('second'));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); client.clear();
});
it('offers retry after an unavailable history and labels legacy records honestly', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => ({ complete: false, events: [] }) });
  vi.stubGlobal('fetch', fetcher);
  const { client } = mount('manager');
  expect(await screen.findByRole('alert')).toHaveTextContent('Booking history could not be loaded');
  expect(screen.queryByText('No recorded activity is available for this booking.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No recorded activity is available for this booking.')).toBeInTheDocument();
  expect(screen.getByText('Earlier activity may not be available for this booking.')).toBeInTheDocument(); client.clear();
});
