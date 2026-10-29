import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('react-i18next', async () => { const { useBookingTranslation } = await import('@/test/booking-i18n'); return { useTranslation: (ns: any) => useBookingTranslation(ns) }; });
const api = vi.hoisted(() => ({ calls: [] as string[], fail: '' }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: async (method: string, url: string) => {
  api.calls.push(`${method} ${url}`);
  if (method === 'POST' && api.fail) throw new Error(api.fail);
  return { json: async () => method === 'GET' ? { cards: [
    { id: 'abcDEF123', brand: 'visa', last4: '4242', expMonth: 4, expYear: 2030, lastUsedAt: '2026-10-28T12:00:00Z', wallet: null },
    { id: 'zzz999', brand: 'mastercard', last4: '4444', expMonth: 1, expYear: 2020, lastUsedAt: null, wallet: 'apple_pay' },
    { id: 'held1', brand: 'amex', last4: '0005', expMonth: 2, expYear: 2031, lastUsedAt: null, wallet: null, lockedReason: 'pending_request' }] } : { removed: true } };
} }));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
import { SavedCards } from './SavedCards';
afterEach(() => { cleanup(); api.calls = []; api.fail = ''; });
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SavedCards /></QueryClientProvider>);

it('lists each card with brand, last 4, expiry and expired state; Remove asks first and then removes it', async () => {
  mount();
  expect(await screen.findByText('Visa •••• 4242')).toBeInTheDocument();
  expect(screen.getByText(/Expires 04\/30/)).toBeInTheDocument();
  expect(screen.getByText(/Expired 01\/20/)).toBeInTheDocument();
  expect(screen.getByText(/Apple Pay/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Visa •••• 4242' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('Remove Visa •••• 4242?');
  expect(api.calls.filter(call => call.startsWith('POST'))).toEqual([]);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove card' }));
  await waitFor(() => expect(api.calls).toContain('POST /api/chef/saved-cards/abcDEF123/remove'));
  await waitFor(() => expect(screen.queryByText('Visa •••• 4242')).toBeNull());
  expect(toast).toHaveBeenCalledWith({ title: 'Visa •••• 4242 removed' });
});

it('keeps the dialog open with the reason when the server refuses (a payment with this card is in progress)', async () => {
  api.fail = 'A payment with this card is still finishing. Try again in a few minutes.';
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Remove Visa •••• 4242' }));
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove card' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('still finishing');
  expect(screen.getByText('Visa •••• 4242')).toBeInTheDocument();
});

it('a card holding a request the kitchen has not answered says so and cannot be removed (owner Oct 28)', async () => {
  mount();
  expect(await screen.findByText(/Holding payment for a request the kitchen hasn’t answered yet/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove Amex •••• 0005' })).toBeDisabled();
});
