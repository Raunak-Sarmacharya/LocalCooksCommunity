import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import copy from '@shared/i18n/locales/en-CA/manager.json';

vi.mock('@/i18n/manager', async () => {
  const { createInstance } = await import('i18next');
  const { default: ICU } = await import('i18next-icu');
  const translations = createInstance();
  await translations.use(ICU).init({ lng: 'en-CA', defaultNS: 'manager', resources: { 'en-CA': { manager: copy } } });
  return { mt: (key: string, values: Record<string, unknown> = {}) => translations.t(key, values) };
});
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({ 'Content-Type': 'application/json' }) }));
// The server preview (same function as the capture). Default fixture: Mixer ($30) declined -> $146.40 with a $8.40 fee.
const previews = vi.hoisted(() => ({ byKey: {} as Record<string, { newTotalCents: number; serviceFeeCents: number }>, calls: [] as number[][] }));
vi.mock('@/components/common/TruncatedText', () => ({ TruncatedText: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));

import { BookingActionDialog, type BookingForAction } from './BookingActionDialog';

beforeEach(() => {
  previews.byKey = { '31': { newTotalCents: 14640, serviceFeeCents: 840 } }; previews.calls = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    const ids = JSON.parse(init.body).equipmentBookingIds as number[]; previews.calls.push(ids);
    const preview = previews.byKey[ids.join(',')];
    return { ok: !!preview, json: async () => preview ?? { error: 'nope' } };
  }));
});
afterEach(() => vi.unstubAllGlobals());

const booking: BookingForAction = {
  id: 112, kitchenName: 'Kitchen North', chefName: 'Alex', locationName: 'Moonlight Kitchens',
  bookingDate: '2026-11-11', startTime: '09:00', endTime: '11:00', totalPrice: 10000,
  paymentStatus: 'authorized', transactionAmount: 18300, serviceFee: 1050, cardFeeRate: { percent: 0.029, fixedCents: 30 }, taxRatePercent: 15,
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
  it.each(['2026-10-16', '2026-10-16T00:00:00.000Z'])('keeps the agreed calendar day for %s', (bookingDate) => {
    setup({ bookingDate });
    expect(screen.getByText('Fri, Oct 16, 2026')).toBeInTheDocument();
    expect(screen.queryByText('Thu, Oct 15, 2026')).not.toBeInTheDocument();
  });

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

  it('declining an item asks the chef: "Accept without {items}", the server’s new total and release, and the same decision payload', async () => {
    const { submit } = setup();
    choose('Mixer', 'Decline');
    expect(await screen.findByText('New total: $146.40')).toBeInTheDocument();
    expect(previews.calls).toEqual([[31]]);
    expect(screen.getByText('We’ll ask the chef to confirm the new total. Nothing is charged until they do.')).toBeInTheDocument();
    // Nothing is charged yet — the money panel labels the new total as conditional on the chef.
    expect(screen.getByText('Charged if the chef accepts')).toBeInTheDocument();
    expect(screen.queryByText('Total charged')).not.toBeInTheDocument();
    expect(screen.getByText('$36.60')).toBeInTheDocument();
    expect(screen.getByText('$133.45')).toBeInTheDocument();
    expect(screen.queryByText('No charge')).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Accept without Mixer' }));
    expect(submit).toHaveBeenCalledWith({ bookingId: 112, status: 'confirmed',
      storageActions: [{ storageBookingId: 21, action: 'confirmed' }],
      equipmentActions: [{ equipmentBookingId: 31, action: 'cancelled' }] });
  });

  it('full accept reads “The chef pays”, then the kitchen’s own amount (nothing is waiting on the chef)', () => {
    setup();
    expect(screen.getByText('The chef pays')).toBeInTheDocument();
    expect(screen.getByText('Your booking amount (with HST)')).toBeInTheDocument();
    expect(screen.queryByText('Local Cooks service fee')).not.toBeInTheDocument();
    expect(screen.queryByText('Charged if the chef accepts')).not.toBeInTheDocument();
  });

  it('dated booking: shows the server’s new total (frozen tax, equipment already in the total), never a client recomputation', async () => {
    // Hold $264.00: kitchen days + $20 oven = $220 subtotal (already in totalPrice), frozen 15% tax, $11 fee. The kitchen's
    // current rate (20%) must not be used. Declining the oven: the server's capture is $252.00 (the old client showed $275.04).
    previews.byKey = { '41': { newTotalCents: 25200, serviceFeeCents: 1000 } };
    setup({ totalPrice: 22000, transactionAmount: 26400, serviceFee: 1100, taxRatePercent: 20, storageItems: [],
      equipmentItems: [{ id: 4, equipmentBookingId: 41, name: 'Oven', totalPrice: 2000, visitDate: '2026-11-12' }] });
    choose('Oven', 'Decline');
    expect(await screen.findByText('New total: $252.00')).toBeInTheDocument();
    expect(screen.getByText('$12.00')).toBeInTheDocument();
    expect(screen.queryByText(/275\.04/)).not.toBeInTheDocument();
  });

  it('names every declined item, with its day on a dated booking', () => {
    setup({ equipmentItems: [{ id: 2, equipmentBookingId: 31, name: 'Mixer', totalPrice: 3000, visitDate: '2026-11-12' },
      { id: 3, equipmentBookingId: 32, name: 'Oven', totalPrice: 1000, visitDate: '2026-11-13' }] });
    choose('Mixer', 'Decline'); choose('Oven', 'Decline');
    expect(screen.getByRole('button', { name: 'Accept without Mixer (Thu, Nov 12, 2026) and Oven (Fri, Nov 13, 2026)' })).toBeInTheDocument();
  });

  it('full acceptance and full decline keep today’s wording (no chef question)', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Approve booking' })).toBeInTheDocument();
    expect(screen.queryByTestId('review-asks-chef')).not.toBeInTheDocument();
    choose('Kitchen Session', 'Decline');
    expect(screen.getByRole('button', { name: 'Decline request' })).toBeInTheDocument();
    expect(screen.queryByTestId('review-asks-chef')).not.toBeInTheDocument();
  });

  it('last minute (under 3 h for the chef to answer): item declines are disabled, with the reason and a way to message the chef', () => {
    const { submit } = setup({ canAskChef: false });
    expect(within(screen.getByRole('group', { name: 'Mixer' })).getByRole('button', { name: 'Decline' })).toBeDisabled();
    expect(within(screen.getByRole('group', { name: 'Mixer' })).getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByText('This booking starts soon, so there isn’t time to ask the chef about a change. Accept the full request, or decline it and message the chef.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Message the chef' })).toHaveAttribute('href', '/manager/booking/112?action=message');
    // Accepting everything and declining the whole request still work.
    fireEvent.click(screen.getByRole('button', { name: 'Approve booking' }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', equipmentActions: [{ equipmentBookingId: 31, action: 'confirmed' }] }));
    choose('Kitchen Session', 'Decline');
    expect(screen.getByRole('button', { name: 'Decline request' })).toBeEnabled();
  });

  it('declines the entire request with the existing cascade payload and locks addon choices', () => {
    const { submit } = setup();
    choose('Kitchen Session', 'Decline');
    expect(screen.getByText('Charge: $0.00')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Mixer' })).getByRole('button', { name: 'Approve' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Decline request' }));
    expect(submit).toHaveBeenCalledWith({ bookingId: 112, status: 'cancelled' });
  });

  it('sends an optional message to the chef with the decline', () => {
    const { submit } = setup({ storageItems: [], equipmentItems: [] });
    choose('Kitchen Session', 'Decline');
    expect(screen.getByText('Decline this request?')).toBeInTheDocument();
    expect(screen.getByText('Alex isn’t charged — their card hold is released.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message to the chef (optional)'), { target: { value: '  Closed that day.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decline request' }));
    expect(submit).toHaveBeenCalledWith({ bookingId: 112, status: 'cancelled', message: 'Closed that day.' });
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
