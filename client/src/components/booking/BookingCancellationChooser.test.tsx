vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BookingCancellationChooser } from './BookingCancellationChooser';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }));
const items = [{ id: 22, kind: 'storage' as const, name: 'Cold storage', status: 'confirmed', dates: 'Nov 10 – Nov 12' },
  { id: 31, kind: 'equipment' as const, name: 'Mixer', status: 'confirmed' }];
// Removing one piece of equipment: price + HST + service-fee share, minus its share of the card fee.
const addonQuote = { quoteReady: true, free: false, lateCancel: false, itemName: 'Mixer', chefRefundCents: 2055, feeRetainedCents: 67, retainedCents: 67, alreadyRefundedCents: 0, sources: [{ capturedCents: 2122 }] };
const equipmentOnly = [{ id: 31, kind: 'equipment' as const, name: 'Mixer', status: 'confirmed' }];
const calls = (...endings: string[]) => vi.mocked(fetch).mock.calls.filter(call => endings.some(ending => (call[0] as string).includes(ending)));
const chooseMixer = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
  await screen.findByTestId('cancel-refund-headline');
  fireEvent.click(screen.getByLabelText(/Selected add-ons/)); fireEvent.click(screen.getByLabelText(/Mixer/));
};
describe('one parent cancellation chooser', () => {
  it('hides cancellation while a visit is checked in or awaiting checkout review', () => {
    render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" visitActive items={items} onChanged={async () => {}} />);
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument();
  });
  beforeEach(() => {
    window.history.replaceState({}, '', '/booking/10');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('?scope=equipment:') ? addonQuote
      : url.endsWith('cancellation-quote') ? { quoteReady: true, chefRefundCents: 9800, feeRetainedCents: 200, retainedCents: 200 }
      : url.includes('/equipment-bookings/') ? { success: true, action: 'removed', state: 'removed', itemName: 'Mixer', free: false, lateCancel: false, refundCents: 2055 }
      : { action: 'cancelled', message: 'Your booking is cancelled.' } })));
  });
  it('opens from page entry points without its own button and reports closing', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<BookingCancellationChooser hideTrigger open={false} onOpenChange={onOpenChange} bookingId={10} status="confirmed" paymentStatus="paid" items={items} onChanged={async () => {}} />);
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<BookingCancellationChooser hideTrigger open onOpenChange={onOpenChange} bookingId={10} status="confirmed" paymentStatus="paid" items={items} onChanged={async () => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel booking' })).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it('shows exact dollars then cancels only the parent and linked items', async () => {
    render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText(/Already using storage/)).toBeInTheDocument();
    // Headline first; the card fee is in the breakdown (still shown before the chef confirms).
    expect(await screen.findByTestId('cancel-refund-headline')).toHaveTextContent(/You’ll get .*98\.00 back/);
    expect(screen.getByTestId('cancel-breakdown')).toHaveTextContent(/Card processing fee \(not refundable\)−\$2\.00/);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Your booking is cancelled');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe('/api/chef/bookings/10/cancel');
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toMatchObject({ expectedRefundCents: 9800 });
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument();
  });
  it('selected add-ons retain the parent and a partial API failure retains the saved result', async () => {
    let mixerAttempts = 0;
    vi.mocked(fetch).mockImplementation((async (url: string) => {
      if (url.includes('?scope=equipment:')) return { ok: true, json: async () => addonQuote };
      if (url.endsWith('cancellation-quote')) return { ok: true, json: async () => ({ quoteReady: true, chefRefundCents: 9800, feeRetainedCents: 200, retainedCents: 200 }) };
      if (url.includes('/storage-bookings/')) return { ok: true, json: async () => ({ message: 'Storage cancellation requested.' }) };
      return ++mixerAttempts === 1 ? { ok: false, json: async () => ({ error: 'The visit has already started.' }) } : { ok: true, json: async () => ({ state: 'removed', refundCents: 2055, itemName: 'Mixer' }) };
    }) as any);
    render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    await screen.findByTestId('cancel-refund-headline');
    fireEvent.click(screen.getByLabelText(/Selected add-ons/));
    fireEvent.click(screen.getByLabelText(/Cold storage/)); fireEvent.click(screen.getByLabelText(/Mixer/));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove selected add-ons' })).toBeEnabled());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove selected add-ons' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The visit has already started.');
    expect(screen.getByRole('status')).toHaveTextContent('Storage cancellation requested');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove selected add-ons' }));
    await waitFor(() => expect(mixerAttempts).toBe(2));
    expect(vi.mocked(fetch).mock.calls.filter(call => !(call[0] as string).includes('cancellation-quote')).map(call => call[0])).toEqual(['/api/chef/storage-bookings/22/cancel', '/api/chef/equipment-bookings/31/cancel', '/api/chef/equipment-bookings/31/cancel']);
  });
  it('shows earlier refunds separately so the current refund and retained dollars reconcile', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ quoteReady: true, chefRefundCents: 2000, alreadyRefundedCents: 5000, feeRetainedCents: 200, retainedCents: 3000 }) } as any);
    render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="partially_refunded" items={[]} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(await screen.findByTestId('cancel-refund-headline')).toHaveTextContent(/You’ll get .*20\.00 back/);
    // Paid $100 = already refunded $50 + kept under the policy $28 + card fee $2 + this refund $20.
    const lines = [...screen.getByTestId('cancel-breakdown').querySelectorAll('dl > div')].map(row => row.textContent);
    expect(lines).toEqual(['You paid$100.00', 'Already refunded−$50.00', 'Kept under the cancellation policy−$28.00', 'Card processing fee (not refundable)−$2.00', 'Your refund$20.00']); expect(screen.queryByText(/Amount kept/)).not.toBeInTheDocument(); expect(screen.getByText('Review what happens before you cancel.')).toBeInTheDocument(); expect(screen.queryByText(/Unstarted equipment/)).not.toBeInTheDocument();
  });
  it('uncaptured requests have an explicit confirm action and Escape exits without submitting', async () => {
    render(<BookingCancellationChooser bookingId={10} status="pending" paymentStatus="authorized" items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel request' })).toBeInTheDocument();
    expect(screen.getByText(/your whole card hold is released/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalled();
  });
  it('a saved paid cutoff still allows exact-quote cancellation and uncaptured withdrawal', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ quoteReady: true, chefRefundCents: 0, feeRetainedCents: 200, retainedCents: 10000 }) } as any);
    const view = render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" paidCancellationAvailable={false} items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(await screen.findByText(/this booking isn’t refunded/)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' })).toBeEnabled();
    view.unmount();
    render(<BookingCancellationChooser bookingId={10} status="pending" paymentStatus="authorized" paidCancellationAvailable={false} items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel request' })).toBeEnabled();
  });
  it('preserves saved outcomes and exits busy state when refreshing the booking fails', async () => {
    render(<BookingCancellationChooser bookingId={10} status="pending" paymentStatus="authorized" items={[]} onChanged={async () => { throw Error('Offline'); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes are saved');
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not submit a selected add-on while payment verification is pending', () => {
    render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" decisionPending items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    fireEvent.click(screen.getByLabelText(/Selected add-ons/));
    fireEvent.click(screen.getByLabelText(/Mixer/));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove selected add-ons' })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });
  describe('removing equipment is instant, so the dialog shows the add-on’s own refund and finishes as a removal', () => {
    it('shows the same headline and breakdown for the selected add-on, then says it was removed and the booking stays', async () => {
      render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={equipmentOnly} onChanged={async () => {}} />);
      await chooseMixer();
      await waitFor(() => expect(screen.getByTestId('cancel-refund-headline')).toHaveTextContent(/You’ll get .*20\.55 back/));
      expect(calls('?scope=equipment:31')).toHaveLength(1);
      const lines = [...screen.getByTestId('cancel-breakdown').querySelectorAll('dl > div')].map(row => row.textContent);
      expect(lines).toEqual(['You paid$21.22', 'Card processing fee (not refundable)−$0.67', 'Your refund$20.55']);
      const dialog = screen.getByRole('dialog');
      expect(dialog).not.toHaveTextContent(/kitchen reviews|stays reserved until the kitchen accepts|accepts the cancellation/i);
      expect(within(dialog).getByRole('heading', { name: 'Remove add-ons' })).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove selected add-ons' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Removed. Your $20.55 refund is on its way. Banks usually show it within 5–10 business days.');
      const put = calls('/equipment-bookings/31/cancel')[0];
      expect(put[0]).toBe('/api/chef/equipment-bookings/31/cancel'); expect(JSON.parse(put[1]!.body as string)).toMatchObject({ expectedRefundCents: 2055 });
      expect(within(dialog).getByRole('heading', { name: 'Mixer removed' })).toBeInTheDocument();
      expect(dialog).toHaveTextContent('Your booking and kitchen time stay as they were.');
      expect(dialog).not.toHaveTextContent(/Your booking is cancelled/);
    });
    it('re-quotes when the selection changes', async () => {
      const two = [...equipmentOnly, { id: 32, kind: 'equipment' as const, name: 'Rack', status: 'confirmed' }];
      render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={two} onChanged={async () => {}} />);
      await chooseMixer();
      await waitFor(() => expect(calls('?scope=equipment:31')).toHaveLength(1));
      fireEvent.click(screen.getByLabelText(/Rack/));
      await waitFor(() => expect(calls('?scope=equipment:32')).toHaveLength(1));
      await waitFor(() => expect(screen.getByTestId('cancel-refund-headline')).toHaveTextContent(/41\.10 back/));
    });
    it('an included add-on says nothing was charged, with no refund wording, and finishes with "It wasn’t charged"', async () => {
      vi.mocked(fetch).mockImplementation((async (url: string) => ({ ok: true, json: async () => url.includes('?scope=equipment:') ? { quoteReady: true, free: true, itemName: 'Mixer', chefRefundCents: 0, sources: [] }
        : url.endsWith('cancellation-quote') ? { quoteReady: true, chefRefundCents: 9800, feeRetainedCents: 200, retainedCents: 200 } : { state: 'removed', free: true, refundCents: 0, itemName: 'Mixer' } })) as any);
      render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={equipmentOnly} onChanged={async () => {}} />);
      await chooseMixer();
      expect(await screen.findByTestId('cancel-addon-note')).toHaveTextContent('Nothing was charged for Mixer, so there’s no money to return.');
      expect(screen.getByRole('dialog')).not.toHaveTextContent(/\$0\.00|no refund/i);
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove selected add-ons' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Removed. It wasn’t charged.');
    });
    it('after the refund deadline it says so before confirming and “isn’t refundable” after', async () => {
      vi.mocked(fetch).mockImplementation((async (url: string) => ({ ok: true, json: async () => url.includes('?scope=equipment:') ? { ...addonQuote, lateCancel: true, chefRefundCents: 0, retainedCents: 2122 }
        : url.endsWith('cancellation-quote') ? { quoteReady: true, chefRefundCents: 9800, feeRetainedCents: 200, retainedCents: 200 } : { state: 'removed', lateCancel: true, refundCents: 0, itemName: 'Mixer' } })) as any);
      render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={equipmentOnly} onChanged={async () => {}} />);
      await chooseMixer();
      expect(await screen.findByTestId('cancel-addon-note')).toHaveTextContent('Under this booking’s cancellation policy, Mixer isn’t refundable. Removing it makes it available to others.');
      expect(screen.getByRole('dialog')).not.toHaveTextContent(/no refund|free\b/i);
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove selected add-ons' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Removed. Under the cancellation policy it isn’t refundable.');
    });
    it('shows a 50% late-tier amount, the retained policy share, card fee and frozen date', async () => {
      const snapshot = { policyId: 10, version: 1, noticeHours: 24, lateChargePercent: 50,
        tiers: [{ minHoursBeforeStart: 24, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 50 }], timezone: 'America/St_Johns',
        sessions: [{ startAt: '2026-11-10T12:30:00Z' }], disclosureVersion: 'food-corridor-v3', acceptedAt: '2026-10-01T00:00:00Z' };
      vi.mocked(fetch).mockImplementation((async (url: string) => ({ ok: true, json: async () => url.includes('?scope=equipment:')
        ? { ...addonQuote, lateCancel: true, chefRefundCents: 1027, retainedCents: 1095, snapshot }
        : url.endsWith('cancellation-quote') ? { quoteReady: true, chefRefundCents: 9800, feeRetainedCents: 200, retainedCents: 200 }
        : { state: 'removed', lateCancel: true, refundCents: 1027, itemName: 'Mixer' } })) as any);
      render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={equipmentOnly} onChanged={async () => {}} />);
      await chooseMixer();
      expect(await screen.findByText(/Under your saved policy, \$10\.27 comes back/)).toBeInTheDocument();
      expect(screen.getByTestId('cancel-refund-headline')).toHaveTextContent('$10.27');
      expect(screen.getByTestId('cancel-breakdown')).toHaveTextContent(/Kept under the cancellation policy.*\$10\.28/);
      expect(screen.getByTestId('cancel-breakdown')).toHaveTextContent(/Card processing fee.*\$0\.67/);
      expect(screen.getByRole('dialog')).toHaveTextContent(/Nov 9, 9:00 a\.m\./i);
    });
    it('a refund still being processed and an unknown card fee are each explained', async () => {
      const respond = (removed: Record<string, unknown>, quote: Record<string, unknown> = addonQuote) => vi.mocked(fetch).mockImplementation((async (url: string) => ({ ok: true,
        json: async () => url.includes('?scope=equipment:') ? quote : url.endsWith('cancellation-quote') ? { quoteReady: true, chefRefundCents: 9800, feeRetainedCents: 200, retainedCents: 200 } : removed })) as any);
      respond({ state: 'processing', refundCents: 2055, itemName: 'Mixer' });
      const first = render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={equipmentOnly} onChanged={async () => {}} />);
      await chooseMixer();
      await screen.findByTestId('cancel-refund-headline');
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove selected add-ons' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Removed. Your $20.55 refund is being processed — we’ll confirm when it’s sent.');
      first.unmount();
      respond({ state: 'fee_pending', refundCents: 0, itemName: 'Mixer' }, { quoteReady: false, itemName: 'Mixer' });
      render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={equipmentOnly} onChanged={async () => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
      await screen.findByTestId('cancel-refund-headline');
      fireEvent.click(screen.getByLabelText(/Selected add-ons/)); fireEvent.click(screen.getByLabelText(/Mixer/));
      expect(await screen.findByText('You can remove Mixer now. Local Cooks is confirming the card fee before sending your exact refund.')).toBeInTheDocument();
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove selected add-ons' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Removed. We’re confirming the card fee before sending your exact refund.');
    });
    it('reloads a changed refund and succeeds only after the chef confirms the refreshed amount', async () => {
      let quoteReads = 0, removals = 0;
      vi.mocked(fetch).mockImplementation((async (url: string) => url.endsWith('cancellation-quote') ? { ok: true, json: async () => ({ quoteReady: true, chefRefundCents: 9800, feeRetainedCents: 200, retainedCents: 200 }) }
        : url.includes('?scope=equipment:') ? { ok: true, json: async () => (++quoteReads === 1 ? addonQuote : { ...addonQuote, chefRefundCents: 1028, retainedCents: 1094 }) }
        : ++removals === 1 ? { ok: false, status: 409, json: async () => ({ error: 'The refund changed. Review the new amount.' }) }
        : { ok: true, json: async () => ({ state: 'removed', refundCents: 1028, itemName: 'Mixer' }) }) as any);
      render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={equipmentOnly} onChanged={async () => {}} />);
      await chooseMixer();
      await screen.findByTestId('cancel-refund-headline');
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove selected add-ons' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The refund changed. Review the new amount.');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('cancel-refund-headline')).toHaveTextContent('$10.28'));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove selected add-ons' }));
      expect(await screen.findByRole('status')).toHaveTextContent('$10.28 refund is on its way');
      const requests = calls('/equipment-bookings/31/cancel').map(call => JSON.parse(call[1]!.body as string));
      expect(requests.map(body => body.expectedRefundCents)).toEqual([2055, 1028]);
      expect(requests[0].operationKey).toBe(requests[1].operationKey);
    });
  });
});
