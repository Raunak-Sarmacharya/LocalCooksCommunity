import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BookingCancellationChooser } from './BookingCancellationChooser';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }));
const items = [{ id: 22, kind: 'storage' as const, name: 'Cold storage', status: 'confirmed', dates: 'Nov 10 – Nov 12' },
  { id: 31, kind: 'equipment' as const, name: 'Mixer', status: 'confirmed' }];
describe('one parent cancellation chooser', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/booking/10');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ action: 'cancellation_requested', message: 'Manager review pending. Refund is separate.' }) })));
  });
  it('entire booking submits only the parent; includes linked items and does not promise a refund', async () => {
    render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request cancellation' }));
    expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText(/If you are already using storage/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Request cancellation' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Refund is separate');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/chef/bookings/10/cancel');
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Request cancellation' })).not.toBeInTheDocument();
  });
  it('selected add-ons retain the parent and a partial API failure retains the saved result', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Storage cancellation requested.' }) } as any)
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Mixer cutoff passed' }) } as any);
    render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request cancellation' }));
    fireEvent.click(screen.getByLabelText(/Selected add-ons/));
    fireEvent.click(screen.getByLabelText(/Cold storage/)); fireEvent.click(screen.getByLabelText(/Mixer/));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Request cancellation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mixer cutoff passed');
    expect(screen.getByRole('status')).toHaveTextContent('Storage cancellation requested');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Request cancellation' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(['/api/chef/storage-bookings/22/cancel', '/api/chef/equipment-bookings/31/cancel', '/api/chef/equipment-bookings/31/cancel']);
  });
  it('uncaptured requests have an explicit confirm action and Escape exits without submitting', async () => {
    render(<BookingCancellationChooser bookingId={10} status="pending" paymentStatus="authorized" items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel request' })).toBeInTheDocument();
    expect(screen.getByText(/100% refund of any amount paid, including taxes and fees/)).toBeInTheDocument();
    expect(screen.getByText(/hold will be released instead/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalled();
  });
  it('saved paid cutoff blocks entire cancellation while the uncaptured exception stays available', async () => {
    const view = render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" paidCancellationAvailable={false} items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request cancellation' }));
    expect(screen.getByText(/The cancellation deadline for this booking has passed/)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Request cancellation' })).toBeDisabled();
    view.unmount();
    render(<BookingCancellationChooser bookingId={10} status="pending" paymentStatus="authorized" paidCancellationAvailable={false} items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel request' })).toBeEnabled();
  });
  it('preserves saved outcomes and exits busy state when refreshing the booking fails', async () => {
    render(<BookingCancellationChooser bookingId={10} status="pending" paymentStatus="authorized" items={[]} onChanged={async () => { throw Error('Offline'); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not refresh');
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not submit a selected add-on while payment verification is pending', () => {
    render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" decisionPending items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request cancellation' }));
    fireEvent.click(screen.getByLabelText(/Selected add-ons/));
    fireEvent.click(screen.getByLabelText(/Mixer/));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Request cancellation' })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
