vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { BookingHistoryPanel } from './BookingHistoryPanel';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('react-i18next', async () => {
  const { default: locale } = await import('../../../../shared/i18n/locales/en-CA/booking.json');
  return { useTranslation: () => ({ i18n: { resolvedLanguage: 'en-CA' }, t: (key: string, options?: any) =>
    String(key.split('.').reduce((value: any, part) => value?.[part], locale) || key).replace('{{id}}', String(options?.id)).replace(/\{(amount|chef)\}/g, (_m, key) => String(options?.[key])) }) };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(role: 'chef' | 'manager' = 'chef', chefName: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (version: string) => <QueryClientProvider client={client}><BookingHistoryPanel timezone="America/St_Johns" id={10} reference="KB-TEST" version={version} role={role} chefName={chefName} /></QueryClientProvider>;
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
  const region = screen.getByRole('region', { name: 'Booking activity' });
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
it('shows only the latest events in the booking sidebar until Show all is pressed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ complete: true, events: [
    { key: '1', kind: 'requested', recordedAt: '2026-10-01T12:00:00Z' },
    { key: '2', kind: 'confirmed', recordedAt: '2026-10-02T12:00:00Z' },
    { key: '3', kind: 'requested', recordedAt: '2026-10-03T12:00:00Z' },
    { key: '4', kind: 'confirmed', recordedAt: '2026-10-04T12:00:00Z' },
  ] }) })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BookingHistoryPanel timezone="America/St_Johns" id={10} version="v" role="chef" limit={3} /></QueryClientProvider>);
  await waitFor(() => expect(screen.getAllByTestId('booking-history-dot')).toHaveLength(3));
  const toggle = screen.getByRole('button', { name: /Show all/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(screen.getAllByTestId('booking-history-dot')).toHaveLength(4);
  expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
  client.clear();
});
it('offers retry after an unavailable history and labels legacy records honestly', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => ({ complete: false, events: [] }) });
  vi.stubGlobal('fetch', fetcher);
  const { client } = mount('manager');
  expect(await screen.findByRole('alert')).toHaveTextContent('Booking history could not be loaded');
  expect(screen.queryByText('No updates to show yet.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No updates to show yet.')).toBeInTheDocument();
  expect(screen.queryByText('Earlier activity may not be available for this booking.')).not.toBeInTheDocument(); client.clear();
});
it('orders events that share a timestamp by lifecycle', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ complete: true, events: [
    { key: 'b', kind: 'confirmed', recordedAt: '2026-10-01T12:00:00Z' },
    { key: 'a', kind: 'requested', recordedAt: '2026-10-01T12:00:00Z' },
  ] }) })));
  const { client } = mount();
  await screen.findByText('Booking confirmed');
  const items = screen.getByRole('region', { name: 'Booking activity' }).querySelectorAll('li');
  expect(items[0].textContent).toMatch(/Booking requested/);
  expect(items[1].textContent).toMatch(/Booking confirmed/); client.clear();
});
it.each([['declined', 'Request declined'], ['expired', 'Request expired'], ['withdrawn', 'Request withdrawn']] as const)('labels the ended request as %s', async (cause, label) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ complete: true, events: [
    { key: '1', kind: 'requested', recordedAt: '2026-10-01T12:00:00Z' },
    { key: '2', kind: 'cancelled', recordedAt: '2026-10-02T12:00:00Z' },
  ] }) })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BookingHistoryPanel timezone="America/St_Johns" id={152} version="v" role="chef" cancelCause={cause} /></QueryClientProvider>);
  expect(await screen.findByText(label)).toBeInTheDocument();
  expect(screen.queryByText('Booking cancelled')).not.toBeInTheDocument();
  expect(screen.getByText('#152')).toBeInTheDocument();
});
it('keeps "Booking cancelled" when the cause is unknown or a post-confirmation cancellation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ complete: true, events: [
    { key: '1', kind: 'requested', recordedAt: '2026-10-01T12:00:00Z' },
    { key: '2', kind: 'cancelled', recordedAt: '2026-10-02T12:00:00Z' },
  ] }) })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><BookingHistoryPanel timezone="America/St_Johns" id={152} version="v" role="chef" cancelCause="cancelled_after_confirmation" /></QueryClientProvider>);
  expect(await screen.findByText('Booking cancelled')).toBeInTheDocument();
});

it.each([
  ['chef', 'Local Cooks refunded $26.00'],
  ['manager', 'Local Cooks sent Alex a $26.00 refund (your payout is unchanged)'],
] as const)('names a Local Cooks goodwill refund for the %s', async (role, line) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ complete: true, events: [
    { key: 'event-1', kind: 'requested', recordedAt: '2026-10-01T12:00:00Z' },
    { key: 'payment-5', kind: 'goodwill_refunded', recordedAt: '2026-10-14T12:00:00Z', amountCents: 2600 },
  ] }) })));
  mount(role, 'Alex');
  expect(await screen.findByText(line)).toBeInTheDocument();
});

it.each(['chef', 'manager'] as const)('checkout history uses the %s voice', async role => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ complete: true, events: [
    { key: 'checkout', kind: 'checkout_requested', recordedAt: '2026-10-15T12:00:00Z' },
  ] }) })));
  const { client } = mount(role);
  expect(await screen.findByText(role === 'chef' ? 'You checked out' : 'Checkout requested')).toBeInTheDocument();
  expect(screen.queryByText(role === 'chef' ? 'Checkout requested' : 'You checked out')).not.toBeInTheDocument();
  client.clear();
});
