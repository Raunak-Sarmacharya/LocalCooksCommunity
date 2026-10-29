import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), attendance: vi.fn() }));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock('@/lib/api', () => ({ apiClient: { post: api.post, get: (path: string) => path.endsWith('/attendance') ? api.attendance(path) : api.get(path) } }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ManagerBookingDays } from './ManagerBookingDays';
const mount = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const props = { bookingId: 42, revision: 1, status: 'confirmed', timezone: 'UTC', onChanged: vi.fn(),
  visits: [{ id: 1, visitDate: '2030-01-15', scheduleRevision: 1, scheduleState: 'active', startTime: '09:00', endTime: '10:00' },
    { id: 2, visitDate: '2030-01-18', scheduleRevision: 1, scheduleState: 'cancelled', startTime: '09:00', endTime: '10:00' }],
  money: [{ visitId: 1, allocatedCents: 12200, refundedCents: 0, kitchenRemainingCents: 11000 }, { visitId: 2, allocatedCents: 12200, refundedCents: 6000, kitchenRemainingCents: 5000 }] };
beforeEach(() => { vi.clearAllMocks(); api.attendance.mockResolvedValue({ ok: true, json: async () => ({ history: [] }) }); api.get.mockResolvedValue({ ok: true, json: async () => ({ quoteReady: true, chefRefundCents: 12200, kitchenPaysCents: 11000, localCooksPaysCents: 1200 }) }); api.post.mockResolvedValue({ ok: true, json: async () => ({ success: true }) }); });
afterEach(cleanup);
it('previews the outcome in words, requires a message and sends only the chosen day with the reviewed amount', async () => {
  mount(<ManagerBookingDays {...props} customerName="Maya Chen" kitchenName="Main Kitchen" reference="KB-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel this day' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: 'Cancel Tue, Jan 15?' })).toBeInTheDocument();
  expect(within(dialog).getByTestId('day-action-summary')).toHaveTextContent('KB-1Maya ChenMain Kitchen · Tue, Jan 15 · ');
  await waitFor(() => expect(within(dialog).getByTestId('day-cancel-outcome')).toHaveTextContent(
    'Maya gets a full refund of $122.00 for this day, including fees. Your payout goes down by $110.00. Their other days stay booked.'));
  expect(within(dialog).getByText('Maya sees this in their booking and email.')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Keep this day' })).toBeEnabled();
  const confirm = within(dialog).getByRole('button', { name: 'Cancel this day' });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText(/Message to Maya/), { target: { value: 'Kitchen maintenance' } });
  fireEvent.click(confirm);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manager/bookings/42/days/cancel', expect.objectContaining({ visitIds: [1], expectedRefundCents: 12200, reason: 'Kitchen maintenance' })));
  await waitFor(() => expect(toastSpy).toHaveBeenCalledWith({ title: 'Tue, Jan 15 cancelled. Maya has been refunded $122.00.' }));
});
it('allows a kitchen-paid top-up after a day was cancelled and refuses more than its remaining share', () => {
  mount(<ManagerBookingDays {...props} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Refund more for this day' })[1]);
  const dialog = screen.getByRole('dialog'); expect(dialog).toHaveTextContent('Fri, Jan 18');
  fireEvent.change(within(dialog).getByLabelText('Refund amount'), { target: { value: '50.01' } });
  fireEvent.change(within(dialog).getByLabelText(/Message to the customer/), { target: { value: 'Kitchen agreed to return more' } });
  expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText('Refund amount'), { target: { value: '50.00' } });
  expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeEnabled();
});
it('never enables a cancellation without a verified quote', async () => {
  api.get.mockResolvedValue({ ok: true, json: async () => ({ quoteReady: false, message: 'Processing fee pending' }) });
  mount(<ManagerBookingDays {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Cancel this day' }));
  const dialog = screen.getByRole('dialog'); await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Processing fee pending'));
  fireEvent.change(within(dialog).getByLabelText(/Message to the customer/), { target: { value: 'Kitchen maintenance' } });
  expect(within(dialog).getByRole('button', { name: 'Cancel this day' })).toBeDisabled();
});

it('refreshes a changed cancellation quote and requires the new amount to be reviewed', async () => {
 api.post.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'The refund changed. Review the refreshed amount before cancelling.' }) });
 api.get.mockResolvedValueOnce({ ok: true, json: async () => ({ quoteReady: true, chefRefundCents: 12200, kitchenPaysCents: 11000, localCooksPaysCents: 1200 }) })
   .mockResolvedValue({ ok: true, json: async () => ({ quoteReady: true, chefRefundCents: 10000, kitchenPaysCents: 9000, localCooksPaysCents: 1000 }) });
 mount(<ManagerBookingDays {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Cancel this day' }));
 const dialog = screen.getByRole('dialog'); await waitFor(() => expect(within(dialog).getByText(/full refund of \$122\.00/)).toBeInTheDocument());
 fireEvent.change(within(dialog).getByLabelText(/Message to the customer/), { target: { value: 'Kitchen maintenance' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel this day' }));
 await waitFor(() => expect(within(dialog).getByText(/full refund of \$100\.00/)).toBeInTheDocument());
 expect(within(dialog).getByRole('alert')).toHaveTextContent('The refund changed'); expect(api.post).toHaveBeenCalledTimes(1);
});
it('freezes and reuses the original refund after a lost response and a closed dialog', async () => {
 api.post.mockRejectedValueOnce(Error('Network response lost'));
 mount(<ManagerBookingDays {...props} />); fireEvent.click(screen.getAllByRole('button', { name: 'Refund more for this day' })[0]);
 let dialog = screen.getByRole('dialog'); fireEvent.change(within(dialog).getByLabelText('Refund amount'), { target: { value: '12.34' } });
 fireEvent.change(within(dialog).getByLabelText(/Message to the customer/), { target: { value: 'Kitchen agreed to return more' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
 await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Network response lost'));
 fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
 fireEvent.click(screen.getAllByRole('button', { name: 'Refund more for this day' })[0]); dialog = screen.getByRole('dialog');
 expect(within(dialog).getByLabelText('Refund amount')).toBeDisabled();
 fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
 await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2)); expect(api.post.mock.calls[0]).toEqual(api.post.mock.calls[1]);
});
it('names each day’s payout as one total across charges and hides zero amounts', () => {
  mount(<ManagerBookingDays {...props} payout={{ installments: [{ installmentId: 9, sourceId: 1, visitId: 1, operatingDate: '2030-01-15', status: 'scheduled', amountCents: 11000, feePending: false, transferId: null },
    { installmentId: 10, sourceId: 2, visitId: 1, operatingDate: '2030-01-15', status: 'scheduled', amountCents: 2732, feePending: false, transferId: null },
    { installmentId: 11, sourceId: 2, visitId: 2, operatingDate: '2030-01-18', status: 'scheduled', amountCents: 0, feePending: false, transferId: null }] } as never} />);
  expect(screen.getByText('You receive $137.32 after this day’s inspection')).toBeInTheDocument();
  expect(screen.queryByText('You receive $0.00 after this day’s inspection')).toBeNull();
  expect(screen.getByText('This day: $122.00')).toBeInTheDocument();
});
it('offers the inspection only for a day that has started', () => {
  mount(<ManagerBookingDays {...props} visits={[props.visits[0], { ...props.visits[0], id: 3, visitDate: '2020-01-15' }]} />);
  const links = screen.getAllByRole('link', { name: 'Inspection' });
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href', '/manager/booking/42/inspection?visitId=3');
});

it('shows a day the kitchen confirmed after a missing check-in as came, not "Not checked in" (QA walk Oct 28)', async () => {
  api.attendance.mockResolvedValue({ ok: true, json: async () => ({ history: [{ visitId: 1, action: 'report_no_show' }, { visitId: 1, action: 'report_attended' }] }) });
  mount(<ManagerBookingDays {...props} status="completed" visits={[{ ...props.visits[0], checkinStatus: 'not_checked_in' }, { ...props.visits[1], scheduleState: 'active', checkinStatus: 'not_checked_in' }]} />);
  expect(await screen.findByText(/Came \(you confirmed\)/)).toBeInTheDocument();
  expect(screen.getByText(/Not checked in/)).toBeInTheDocument();
});
