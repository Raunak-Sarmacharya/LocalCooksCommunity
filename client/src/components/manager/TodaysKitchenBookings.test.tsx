import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, expect, it, vi } from 'vitest';
import { TodaysKitchenBookings } from './TodaysKitchenBookings';

vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('@/i18n', async () => ({ default: (await import('@/test/booking-i18n')).testI18n }));
vi.mock('@/i18n/manager', async () => ({ mt: (await import('@/test/booking-i18n')).useBookingTranslation('manager').t }));
vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));

const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.unstubAllGlobals(); });
function mount(failed = false, overnight = false) {
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/upcoming') ? failed ? {} : {
    bookings: [{ id: 10, visitId: 5, visitBlockIndex: 1, bookingDate: overnight ? '2026-10-15' : '2026-10-14', startTime: overnight ? '04:45' : '09:00', endTime: '11:00', operatingWindowStartTime: '06:00',
      status: 'confirmed', checkinStatus: 'checkout_requested', kitchenName: 'Test kitchen', chefName: 'Alex' }],
  } : []), { status: failed && url.includes('/upcoming') ? 503 : 200 }));
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  const navigation = memoryLocation({ path: '/manager/dashboard', record: true });
  render(<QueryClientProvider client={client}><Router hook={navigation.hook}><TodaysKitchenBookings /></Router></QueryClientProvider>);
  return { fetcher, navigation };
}

it('opens the selected visit inspection instead of overlapping checkout and claim dialogs', async () => {
  const { fetcher, navigation } = mount();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Visit inspection' }))[0]);
  expect(navigation.history.at(-1)).toBe('/manager/booking/10/inspection?visitId=5');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'File Claim' })).not.toBeInTheDocument();
  expect(fetcher.mock.calls.every(([, options]: any) => !options || options.method !== 'POST')).toBe(true);
});

it('explains a failed booking load and offers retry', async () => {
  mount(true);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

it('labels an overnight booking with Oct 16 and a localized clock', async () => {
  mount(false, true);
  const dates = await screen.findAllByText(/Oct 16/);
  expect(dates.length).toBeGreaterThan(0);
  expect(screen.getAllByText(/4:45 a\.m\./).length).toBeGreaterThan(0);
  expect(screen.queryByText(/Oct 15/)).not.toBeInTheDocument();
});
