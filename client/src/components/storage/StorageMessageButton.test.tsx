import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: any) => options?.chef ? `Message ${options.chef}` : key }) }));
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({ Authorization: 'Bearer fixture' }) }));
vi.mock('@/lib/navigate-notification-href', () => ({ navigateNotificationHref: navigate }));
import { StorageMessageButton } from './StorageMessageButton';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it.each([undefined, 'Morgan'])('opens storage chat for chef=%s using the returned dashboard path', async chef => {
  const path = `${chef ? '/manager' : ''}/dashboard?view=messages&conversation=chat`;
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ path }) }));
  vi.stubGlobal('fetch', request);
  render(<StorageMessageButton rentalId={5} chef={chef} />);
  fireEvent.click(screen.getByRole('button', { name: chef ? 'Message Morgan' : 'stMessageKitchen' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(path));
  expect(request).toHaveBeenCalledWith('/api/storage-rentals/5/conversation', { method: 'POST', credentials: 'include', headers: { Authorization: 'Bearer fixture' } });
});
it('keeps the user on the rental and offers retry when opening chat fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  render(<StorageMessageButton rentalId={5} chef="Morgan" />);
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('stMessageFailed');
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole('button')).toBeEnabled();
});
