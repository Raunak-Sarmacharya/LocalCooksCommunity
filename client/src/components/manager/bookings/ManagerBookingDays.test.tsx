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
  const dialog = screen.getByRole('dialog'); expect(dialog).toHaveTextContent('Jan 18, 2030');
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

it('refreshes a changed cancellation quote and requires the new amount to be reviewed', async () => {
 api.post.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'The refund changed. Review the refreshed amount before cancelling.' }) });
 api.get.mockResolvedValueOnce({ ok: true, json: async () => ({ quoteReady: true, chefRefundCents: 12200, kitchenPaysCents: 11000, localCooksPaysCents: 1200 }) })
   .mockResolvedValue({ ok: true, json: async () => ({ quoteReady: true, chefRefundCents: 10000, kitchenPaysCents: 9000, localCooksPaysCents: 1000 }) });
 render(<ManagerBookingDays {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Cancel this day' }));
 const dialog = screen.getByRole('dialog'); await waitFor(() => expect(within(dialog).getByText('Chef receives $122.00')).toBeInTheDocument());
 fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Kitchen maintenance' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
 await waitFor(() => expect(within(dialog).getByText('Chef receives $100.00')).toBeInTheDocument());
 expect(within(dialog).getByRole('alert')).toHaveTextContent('The refund changed'); expect(api.post).toHaveBeenCalledTimes(1);
});
it('freezes and reuses the original refund after a lost response and a closed dialog', async () => {
 api.post.mockRejectedValueOnce(Error('Network response lost'));
 render(<ManagerBookingDays {...props} />); fireEvent.click(screen.getAllByRole('button', { name: 'Refund more for this day' })[0]);
 let dialog = screen.getByRole('dialog'); fireEvent.change(within(dialog).getByLabelText('Refund amount'), { target: { value: '12.34' } });
 fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Kitchen agreed to return more' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
 await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Network response lost'));
 fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
 fireEvent.click(screen.getAllByRole('button', { name: 'Refund more for this day' })[0]); dialog = screen.getByRole('dialog');
 expect(within(dialog).getByLabelText('Refund amount')).toBeDisabled();
 fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
 await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2)); expect(api.post.mock.calls[0]).toEqual(api.post.mock.calls[1]);
});
it('names each day’s payout as one total across charges and hides zero amounts', () => {
  render(<ManagerBookingDays {...props} payout={{ installments: [{ installmentId: 9, sourceId: 1, visitId: 1, operatingDate: '2030-01-15', status: 'scheduled', amountCents: 11000, feePending: false, transferId: null },
    { installmentId: 10, sourceId: 2, visitId: 1, operatingDate: '2030-01-15', status: 'scheduled', amountCents: 2732, feePending: false, transferId: null },
    { installmentId: 11, sourceId: 2, visitId: 2, operatingDate: '2030-01-18', status: 'scheduled', amountCents: 0, feePending: false, transferId: null }] } as never} />);
  expect(screen.getByText('You receive $137.32 after this day’s inspection')).toBeInTheDocument();
  expect(screen.queryByText('You receive $0.00 after this day’s inspection')).toBeNull();
  expect(screen.getByText('This day: $122.00')).toBeInTheDocument();
});
it('offers the inspection only for a day that has started', () => {
  render(<ManagerBookingDays {...props} visits={[props.visits[0], { ...props.visits[0], id: 3, visitDate: '2020-01-15' }]} />);
  const links = screen.getAllByRole('link', { name: 'Inspection' });
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href', '/manager/booking/42/inspection?visitId=3');
});
