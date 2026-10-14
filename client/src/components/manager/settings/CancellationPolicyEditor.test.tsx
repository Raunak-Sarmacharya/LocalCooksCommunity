import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CancellationPolicyEditor } from './CancellationPolicyEditor';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiGet: api.get, apiPut: api.put }));
const policy = { policy: { id: 1, version: 1, noticeHours: 24, lateChargePercent: 100, adminOverrideReason: null as string | null }, settings: { noticeOptions: [24, 48, 72], chargeOptions: [50, 100] }, timezone: 'America/St_Johns' };
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(policy); api.put.mockResolvedValue({}); });
function mount(admin = false) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); render(<QueryClientProvider client={client}><CancellationPolicyEditor kitchenId={10} admin={admin} /></QueryClientProvider>); }
it('publishes exactly two choices with a live preview and new-bookings-only warning', async () => {
  mount(); await waitFor(() => expect(screen.getByLabelText('Chefs can cancel for a refund up to')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Chefs can cancel for a refund up to'), { target: { value: '48' } });
  fireEvent.change(screen.getByLabelText('If they cancel later, they pay'), { target: { value: '50' } });
  expect(screen.getByText(/Cancel at least 48 hours.*50%/)).toBeInTheDocument(); expect(screen.getByText(/Applies to new bookings only/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save cancellation policy' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/manager/kitchens/10/cancellation-policy', { noticeHours: 48, lateChargePercent: 50, reason: '' }));
});
it('shows and locks an audited admin override for the manager', async () => {
  api.get.mockResolvedValue({ ...policy, policy: { ...policy.policy, adminOverrideReason: 'Pilot agreement' } }); mount();
  expect(await screen.findByText('Local Cooks override: Pilot agreement')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Save cancellation policy' })).toBeDisabled();
});
