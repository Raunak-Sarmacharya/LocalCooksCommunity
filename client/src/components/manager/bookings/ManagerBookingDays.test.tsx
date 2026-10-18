import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiClient: api }));
import { ManagerBookingDays } from './ManagerBookingDays';
const props = { bookingId: 42, revision: 1, status: 'confirmed', timezone: 'UTC', onChanged: vi.fn(),
  visits: [{ id: 1, visitDate: '2030-01-15', scheduleRevision: 1, scheduleState: 'active', startTime: '09:00', endTime: '10:00' },
    { id: 2, visitDate: '2030-01-18', scheduleRevision: 1, scheduleState: 'cancelled', startTime: '09:00', endTime: '10:00' }],
  money: [{ visitId: 1, allocatedCents: 12200, refundedCents: 0, kitchenRemainingCents: 11000 }, { visitId: 2, allocatedCents: 12200, refundedCents: 6000, kitchenRemainingCents: 5000 }] };
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue({ ok: true, json: async () => ({ quoteReady: true, chefRefundCents: 12200, kitchenPaysCents: 11000, localCooksPaysCents: 1200 }) }); api.post.mockResolvedValue({ ok: true, json: async () => ({ success: true }) }); });
afterEach(cleanup);
it('previews exact dollar funding and sends only the chosen day with the reviewed amount', async () => {
  render(<ManagerBookingDays {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel this day' }));
  const dialog = screen.getByRole('dialog');
  await waitFor(() => expect(within(dialog).getByText('Chef receives $122.00')).toBeInTheDocument());
  expect(within(dialog).getByText('Your payout decreases by $110.00')).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Kitchen maintenance' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manager/bookings/42/days/cancel', expect.objectContaining({ visitIds: [1], expectedRefundCents: 12200, reason: 'Kitchen maintenance' })));
});
it('allows a kitchen-paid top-up after a day was cancelled and refuses more than its remaining share', () => {
  render(<ManagerBookingDays {...props} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Refund more for this day' })[1]);
  const dialog = screen.getByRole('dialog'); expect(dialog).toHaveTextContent('2030-01-18');
  fireEvent.change(within(dialog).getByLabelText('Refund amount'), { target: { value: '50.01' } });
  fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Kitchen agreed to return more' } });
  expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText('Refund amount'), { target: { value: '50.00' } });
  expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeEnabled();
});
it('never enables a cancellation without a verified quote', async () => {
  api.get.mockResolvedValue({ ok: true, json: async () => ({ quoteReady: false, message: 'Processing fee pending' }) });
  render(<ManagerBookingDays {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Cancel this day' }));
  const dialog = screen.getByRole('dialog'); await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Processing fee pending'));
  fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Kitchen maintenance' } });
  expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeDisabled();
});
