vi.mock('@/lib/manager-bookings-query', () => ({ fetchManagerBookings: async () => [] }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CancellationPolicyEditor } from './CancellationPolicyEditor';
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  const { useBookingTranslation } = await import('@/test/booking-i18n');
  return { ...actual, useTranslation: useBookingTranslation };
});
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiGet: api.get, apiPut: api.put }));
const policy = {
  policy: { id: 1, version: 1, noticeHours: 24, lateChargePercent: 100, adminOverrideReason: null as string | null },
  settings: { noticeOptions: [24, 48, 72], chargeOptions: [50, 100] }, timezone: 'America/St_Johns',
  followsLocation: true, locationDefault: { noticeHours: 24, lateChargePercent: 100 }, locationName: 'Harbour',
};
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(policy); api.put.mockResolvedValue({}); });
function mount(admin = false) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); client.setQueryData(['managerBookings'], []); render(<QueryClientProvider client={client}><CancellationPolicyEditor kitchenId={10} admin={admin} /></QueryClientProvider>); }
it('publishes exactly two choices with a live preview and new-bookings-only warning', async () => {
  mount(); await waitFor(() => expect(screen.getByLabelText('Free cancellation until')).toBeEnabled());
  fireEvent.click(screen.getByLabelText('Free cancellation until'));
  fireEvent.click(screen.getByRole('option', { name: '48 hours before' }));
  fireEvent.click(screen.getByLabelText('Late cancellation charge'));
  fireEvent.click(screen.getByRole('option', { name: '50% of the booking' }));
  expect(screen.getAllByText(/Cancel at least 48 hours.*50%/).length).toBeGreaterThan(0); expect(screen.getByText(/Applies to new bookings only/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save cancellation policy' }));
  expect(api.put).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save cancellation policy' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/manager/kitchens/10/cancellation-policy', { noticeHours: 48, lateChargePercent: 50, reason: '' }));
});
it('shows and locks an audited admin override for the manager', async () => {
  api.get.mockResolvedValue({ ...policy, followsLocation: false, policy: { ...policy.policy, adminOverrideReason: 'Pilot agreement' } }); mount();
  expect(await screen.findByText(/Set by Local Cooks: Pilot agreement/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Contact Local Cooks' })).toHaveAttribute('href', 'mailto:support@localcooks.ca');
  expect(screen.getByRole('button', { name: 'Save cancellation policy' })).toBeDisabled();
});

it('re-follows the location policy from a kitchen override', async () => {
  api.get.mockResolvedValue({
    ...policy, followsLocation: false,
    policy: { ...policy.policy, noticeHours: 72, lateChargePercent: 50 },
    locationDefault: { noticeHours: 24, lateChargePercent: 100 },
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: "Use the location’s policy" }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/manager/kitchens/10/cancellation-policy', { followLocation: true }));
});
it('stays quiet until a choice changes, then keeps the current policy when confirmation is cancelled', async () => {
  mount(); await waitFor(() => expect(screen.getByLabelText('Free cancellation until')).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Save cancellation policy' })).toBeDisabled();
  expect(screen.queryByTestId('setting-change-preview')).not.toBeInTheDocument();
  expect(screen.getByText(/Customers see:/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Free cancellation until'));
  fireEvent.click(screen.getByRole('option', { name: '72 hours before' }));
  expect(screen.getByTestId('setting-change-preview')).toHaveTextContent('Applies to new bookings only');
  fireEvent.click(screen.getByRole('button', { name: 'Save cancellation policy' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep current policy' }));
  expect(api.put).not.toHaveBeenCalled();
});
it('says the policy also covers storage rentals only when the kitchen has a storage listing', async () => {
  api.get.mockImplementation((path: string) => Promise.resolve(path.includes('storage-listings') ? [{ id: 1 }] : policy));
  mount();
  expect(await screen.findByText('This policy also applies to storage rentals.')).toBeInTheDocument();
});
it('keeps the storage line hidden when the kitchen has no storage listing', async () => {
  mount(); await waitFor(() => expect(screen.getByLabelText('Free cancellation until')).toBeEnabled());
  expect(screen.queryByText('This policy also applies to storage rentals.')).not.toBeInTheDocument();
});
