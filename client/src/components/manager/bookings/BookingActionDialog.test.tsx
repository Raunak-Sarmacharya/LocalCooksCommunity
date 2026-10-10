import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import copy from '@shared/i18n/locales/en-CA/manager.json';

vi.mock('@/i18n/manager', async () => {
  const { createInstance } = await import('i18next');
  const { default: ICU } = await import('i18next-icu');
  const translations = createInstance();
  await translations.use(ICU).init({ lng: 'en-CA', defaultNS: 'manager', resources: { 'en-CA': { manager: copy } } });
  return { mt: (key: string, values: Record<string, unknown> = {}) => translations.t(key, values) };
});
vi.mock('@/components/common/TruncatedText', () => ({ TruncatedText: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));

import { BookingActionDialog, type BookingForAction } from './BookingActionDialog';

const booking: BookingForAction = {
  id: 112, kitchenName: 'Kitchen North', chefName: 'Alex', locationName: 'Moonlight Kitchens',
  bookingDate: '2026-11-11', startTime: '09:00', endTime: '11:00', totalPrice: 10000,
  paymentStatus: 'authorized', transactionAmount: 18300, serviceFee: 1050, taxRatePercent: 15,
  storageItems: [{ id: 1, storageBookingId: 21, name: 'Cold storage', storageType: 'cold', totalPrice: 2000 }],
  equipmentItems: [{ id: 2, equipmentBookingId: 31, name: 'Mixer', totalPrice: 3000 }],
};

function setup(overrides: Partial<BookingForAction> = {}, isLoading = false) {
  const submit = vi.fn(), change = vi.fn();
  render(<BookingActionDialog open booking={{ ...booking, ...overrides }} isLoading={isLoading} onOpenChange={change} onSubmit={submit} />);
  return { submit, change };
}
function choose(item: string, decision: 'Approve' | 'Decline') {
  fireEvent.click(within(screen.getByRole('group', { name: item })).getByRole('button', { name: decision }));
}

describe('manager booking request review', () => {
  it('submits the existing approval payload and keeps an already-selected choice unchanged', () => {
    const { submit } = setup();
    choose('Kitchen Session', 'Approve');
    choose('Mixer', 'Approve');
    expect(screen.getByText('Charge: $183.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve booking' }));
    expect(submit).toHaveBeenCalledWith({ bookingId: 112, status: 'confirmed',
      storageActions: [{ storageBookingId: 21, action: 'confirmed' }],
      equipmentActions: [{ equipmentBookingId: 31, action: 'confirmed' }] });
  });

  it('shows the actual partial charge and release, and submits individual decisions', () => {
    const { submit } = setup();
    choose('Mixer', 'Decline');
    expect(screen.getByText('Charge: $146.40')).toBeInTheDocument();
    expect(screen.getByText('$36.60')).toBeInTheDocument();
    expect(screen.getByText('$133.45')).toBeInTheDocument();
    expect(screen.queryByText('No charge')).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected items' }));
    expect(submit).toHaveBeenCalledWith({ bookingId: 112, status: 'confirmed',
      storageActions: [{ storageBookingId: 21, action: 'confirmed' }],
      equipmentActions: [{ equipmentBookingId: 31, action: 'cancelled' }] });
  });

  it('declines the entire request with the existing cascade payload and locks addon choices', () => {
    const { submit } = setup();
    choose('Kitchen Session', 'Decline');
    expect(screen.getByText('Charge: $0.00')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Mixer' })).getByRole('button', { name: 'Approve' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Decline request' }));
    expect(submit).toHaveBeenCalledWith({ bookingId: 112, status: 'cancelled' });
  });

  it('restores addon approvals when the manager changes the kitchen choice back to approval', () => {
    setup();
    choose('Mixer', 'Decline');
    choose('Kitchen Session', 'Decline');
    choose('Kitchen Session', 'Approve');
    expect(within(screen.getByRole('group', { name: 'Mixer' })).getByRole('button', { name: 'Approve' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Approve booking' })).toBeInTheDocument();
    expect(screen.getByText('Charge: $183.00')).toBeInTheDocument();
  });

  it('leaves previously rejected items read-only and excludes them from submitted decisions', () => {
    const { submit } = setup({ equipmentItems: [...booking.equipmentItems!, { id: 3, equipmentBookingId: 32, name: 'Unavailable oven', totalPrice: 5000, rejected: true }] });
    expect(screen.getByText('Unavailable oven')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Unavailable oven' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve booking' }));
    expect(submit.mock.calls[0][0].equipmentActions).toEqual([{ equipmentBookingId: 31, action: 'confirmed' }]);
  });

  it('retains the existing captured-payment refund breakdown', () => {
    setup({ paymentStatus: 'paid', managerRevenue: 16689, stripeProcessingFee: 561 });
    choose('Mixer', 'Decline');
    expect(screen.getByText('Refund: $35.48')).toBeInTheDocument();
    expect(screen.getByText('$166.89')).toBeInTheDocument();
    expect(screen.getByText('$36.60')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve selected items' })).toBeInTheDocument();
  });

  it('closes without saving a selection', () => {
    const { submit, change } = setup();
    choose('Mixer', 'Decline');
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    expect(change).toHaveBeenCalledWith(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it('prevents changing decisions or dismissing the dialog while submitting', () => {
    const { change } = setup({}, true);
    expect(within(screen.getByRole('group', { name: 'Mixer' })).getByRole('button', { name: 'Decline' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(change).not.toHaveBeenCalled();
  });
});
