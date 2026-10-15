import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CheckoutCancellationDisclosure } from './CheckoutCancellationDisclosure';
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
const policy = { policy: { id: 1, version: 2, noticeHours: 48, lateChargePercent: 50 }, timezone: 'America/St_Johns', settings: { noticeOptions: [24, 48, 72], chargeOptions: [50, 100], default: { notice: 24, charge: 100 } } };
it('discloses local deadline, short notice and required explicit acceptance before payment', () => {
  const accepted = vi.fn();
  render(<CheckoutCancellationDisclosure policy={policy} startAt={new Date(Date.now() + 3600000).toISOString()} acknowledged={false} onAcknowledged={accepted} />);
  expect(screen.queryByText(/Cancel by/)).not.toBeInTheDocument();
  expect(screen.getByText(/Once the kitchen confirms, you pay 50%/)).toBeInTheDocument();
  const checkbox = screen.getByRole('checkbox'); expect(checkbox).not.toBeChecked(); expect(checkbox).toBeRequired();
  fireEvent.click(checkbox); expect(accepted).toHaveBeenCalledWith(true);
});
it('shows the deadline only while it is still ahead', () => {
  render(<CheckoutCancellationDisclosure policy={policy} startAt={new Date(Date.now() + 5 * 86400000).toISOString()} acknowledged={false} onAcknowledged={vi.fn()} />);
  expect(screen.getByText(/Cancel by.*Newfoundland/)).toBeInTheDocument(); expect(screen.queryByText(/Once the kitchen confirms/)).not.toBeInTheDocument();
});
it('does not accept payment terms before a published policy loads', () => {
  render(<CheckoutCancellationDisclosure acknowledged={false} onAcknowledged={vi.fn()} />);
  expect(screen.getByRole('checkbox')).toBeDisabled(); expect(screen.getByRole('alert')).toBeInTheDocument();
});
it('warns when the kitchen may confirm after free cancellation ends (requested just before the deadline)', () => {
  // 48-hour policy, start in 48h40m: free cancellation ends in 40 minutes — too soon to require the kitchen to answer first.
  render(<CheckoutCancellationDisclosure policy={policy} startAt={new Date(Date.now() + (48 * 60 + 40) * 60000).toISOString()} acknowledged={false} onAcknowledged={vi.fn()} />);
  expect(screen.getByTestId('cancel-near-deadline')).toHaveTextContent(/If the kitchen confirms after it ends, you pay 50% of the booking total/);
  expect(screen.getByText(/Cancel by.*Newfoundland/)).toBeInTheDocument();
});
it('no near-deadline warning when the kitchen must answer before free cancellation ends', () => {
  render(<CheckoutCancellationDisclosure policy={policy} startAt={new Date(Date.now() + 5 * 86400000).toISOString()} acknowledged={false} onAcknowledged={vi.fn()} />);
  expect(screen.queryByTestId('cancel-near-deadline')).not.toBeInTheDocument();
});
