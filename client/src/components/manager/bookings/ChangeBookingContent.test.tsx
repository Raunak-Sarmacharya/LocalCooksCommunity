import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-i18next', async importOriginal => ({ ...(await importOriginal<object>()), useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
vi.mock('@/i18n/manager', () => ({ mt: (key: string) => key }));
import { BookingManagementDialog } from './BookingManagementDialog';
const booking = { id: 10, bookingDate: '2026-11-10', startTime: '09:00', endTime: '11:00', status: 'confirmed', paymentStatus: 'paid', transactionId: 5,
  transactionAmount: 10000, managerRevenue: 8000, managerRemainingBalance: 8000, stripeProcessingFee: 0, taxRatePercent: 0,
  equipmentItems: [{ id: 1, equipmentBookingId: 31, name: 'Mixer', totalPrice: 2000, status: 'confirmed' }] };
const open = (onSubmit = vi.fn()) => { render(<BookingManagementDialog open mode="change" onOpenChange={() => {}} onSubmit={onSubmit} booking={booking} />); return onSubmit; };
describe('Change booking (confirmed)', () => {
  it('offers add-on cancellation and partial refunds but no whole-booking cancel', () => {
    open();
    expect(screen.getByText('Cancel an add-on')).toBeInTheDocument(); expect(screen.getByText('Send a partial refund')).toBeInTheDocument();
    expect(screen.queryByText(/Cancel booking|Cancel entire|Cancel as the kitchen"?$/)).not.toBeInTheDocument();
  });
  it('cancels an add-on and shows the chef refund and payout change', () => {
    const submit = open();
    fireEvent.click(screen.getByLabelText(/Mixer/));
    expect(screen.getByText(/customer gets \$20\.00 back.*payout.*\$20\.00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel add-on' }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ action: 'partial-cancel-refund', refundAmountCents: 2000, equipmentActions: [{ equipmentBookingId: 31, action: 'cancelled' }] }));
  });
  it('shows the full refund including the card fee share, and a payout drop that excludes it', () => {
    render(<BookingManagementDialog open mode="change" onOpenChange={() => {}} onSubmit={vi.fn()} booking={{ ...booking, serviceFee: 700, stripeProcessingFee: 384, transactionAmount: 12200, managerRevenue: 8000 }} />);
    fireEvent.click(screen.getByLabelText(/Mixer/));
    expect(screen.getByText(/customer gets [$]21[.]22 back in full.*card processing fee.*payout.*[$]19[.]33/)).toBeInTheDocument();
  });
  it('sends a partial refund capped by the payout, with an optional note', () => {
    const submit = open();
    fireEvent.click(screen.getByLabelText('Send a partial refund'));
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '90' } });
    expect(screen.getByRole('alert')).toHaveTextContent('up to $80.00'); expect(screen.getByRole('button', { name: 'Send refund' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '12.50' } });
    fireEvent.change(screen.getByLabelText(/Note to the customer/), { target: { value: 'Sorry about the oven' } });
    expect(screen.getByText('This comes out of your payout for this booking.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send refund' }));
    expect(submit).toHaveBeenCalledWith({ bookingId: 10, action: 'refund-only', refundAmountCents: 1250, note: 'Sorry about the oven' });
  });
});
