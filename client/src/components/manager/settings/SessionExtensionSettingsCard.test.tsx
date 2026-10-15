vi.mock('@/lib/manager-bookings-query', () => ({ fetchManagerBookings: async () => [] }));
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionExtensionSettingsCard, SessionExtensionsPlatformSwitch } from './SessionExtensionSettingsCard';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiGet: api.get, apiPutWithMessage: api.put }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue({ kitchenId: 1, kitchenName: 'Harbour', enabled: true, effectiveAutoApprove: false, autoApprove: false }); api.put.mockResolvedValue({}); });
function mount(platform = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); client.setQueryData(['managerBookings'], []);
  render(<QueryClientProvider client={client}>{platform ? <SessionExtensionsPlatformSwitch /> : <SessionExtensionSettingsCard kitchenId={1} />}</QueryClientProvider>);
}
it('previews without saving a toggle and confirms only turning automatic approval on', async () => {
  mount(); const toggle = await screen.findByRole('switch'); await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle); expect(api.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Approve automatically' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep approving by hand' })); expect(api.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Approve automatically' })); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve automatically' }));
  expect(api.put).toHaveBeenCalledWith('/manager/kitchens/1/session-extension-settings', { autoApprove: true });
});
it('keeps the platform reason and requires confirmation before pausing', async () => {
  mount(true); await screen.findByText(/On: chefs/);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Maintenance' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pause extra time' }));
  expect(api.put).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Pause extra time' }));
  expect(api.put).toHaveBeenCalledWith('/admin/session-extensions', { enabled: false, reason: 'Maintenance' });
});
