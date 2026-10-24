vi.mock('@/lib/manager-bookings-query', () => ({ fetchManagerBookings: async () => [] }));
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionExtensionsPlatformSwitch } from './SessionExtensionsPlatformSwitch';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
vi.mock('@/i18n/manager', () => ({ mt: (key: string) => key }));
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiGet: api.get, apiPutWithMessage: api.put }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue({ enabled: true }); api.put.mockResolvedValue({}); });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); client.setQueryData(['managerBookings'], []);
  render(<QueryClientProvider client={client}><SessionExtensionsPlatformSwitch /></QueryClientProvider>);
}
it('keeps the platform reason and requires confirmation before pausing', async () => {
  mount(); await screen.findByText(/On: customers/);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Maintenance' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pause extra time' }));
  expect(api.put).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Pause extra time' }));
  expect(api.put).toHaveBeenCalledWith('/admin/session-extensions', { enabled: false, reason: 'Maintenance' });
});
