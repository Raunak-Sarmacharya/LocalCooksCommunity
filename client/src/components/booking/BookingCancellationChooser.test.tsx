vi.mock('@/i18n/chef-ns', async () => ({ ct: (await import('@/test/booking-i18n')).useBookingTranslation('chef').t }));
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BookingCancellationChooser } from './BookingCancellationChooser';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }));
const items = [{ id: 22, kind: 'storage' as const, name: 'Cold storage', status: 'confirmed', dates: 'Nov 10 – Nov 12' },
  { id: 31, kind: 'equipment' as const, name: 'Mixer', status: 'confirmed' }];
describe('one parent cancellation chooser', () => {
  it('hides cancellation while a visit is checked in or awaiting checkout review', () => {
    render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" visitActive items={items} onChanged={async () => {}} />);
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument();
  });
  beforeEach(() => {
    window.history.replaceState({}, '', '/booking/10');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('cancellation-quote') ? { quoteReady: true, chefRefundCents: 9800, feeRetainedCents: 200, retainedCents: 200 } : { action: 'cancelled', message: 'Your booking is cancelled.' } })));
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
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ quoteReady: true, chefRefundCents: 9800, feeRetainedCents: 200, retainedCents: 200 }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Storage cancellation requested.' }) } as any)
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Mixer cutoff passed' }) } as any);
    render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    await screen.findByTestId('cancel-refund-headline');
    fireEvent.click(screen.getByLabelText(/Selected add-ons/));
    fireEvent.click(screen.getByLabelText(/Cold storage/)); fireEvent.click(screen.getByLabelText(/Mixer/));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mixer cutoff passed');
    expect(screen.getByRole('status')).toHaveTextContent('Storage cancellation requested');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(vi.mocked(fetch).mock.calls.filter(call => !(call[0] as string).endsWith('cancellation-quote')).map(call => call[0])).toEqual(['/api/chef/storage-bookings/22/cancel', '/api/chef/equipment-bookings/31/cancel', '/api/chef/equipment-bookings/31/cancel']);
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
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
