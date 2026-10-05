import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByText(/Occupied storage stays linked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit cancellation for review' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Refund is separate');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/chef/bookings/10/cancel');
    expect(screen.getByRole('button', { name: 'Submit cancellation for review' })).toBeDisabled();
  });
  it('selected add-ons retain the parent and a partial API failure retains the saved result', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'Storage cancellation requested.' }) } as any)
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Mixer cutoff passed' }) } as any);
    render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request cancellation' }));
    fireEvent.click(screen.getByLabelText(/Selected add-ons/));
    fireEvent.click(screen.getByLabelText(/Cold storage/)); fireEvent.click(screen.getByLabelText(/Mixer/));
    fireEvent.click(screen.getByRole('button', { name: 'Submit cancellation for review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mixer cutoff passed');
    expect(screen.getByRole('status')).toHaveTextContent('Storage cancellation requested');
    fireEvent.click(screen.getByRole('button', { name: 'Submit cancellation for review' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(['/api/chef/storage-bookings/22/cancel', '/api/chef/equipment-bookings/31/cancel', '/api/chef/equipment-bookings/31/cancel']);
  });
  it('uncaptured requests have an explicit confirm action and Escape exits without submitting', async () => {
    render(<BookingCancellationChooser bookingId={10} status="pending" paymentStatus="authorized" items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(screen.getByRole('button', { name: 'Confirm cancel request' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalled();
  });
  it('saved paid cutoff blocks entire cancellation while the uncaptured exception stays available', async () => {
    const view = render(<BookingCancellationChooser bookingId={10} status="confirmed" paymentStatus="paid" paidCancellationAvailable={false} items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request cancellation' }));
    expect(screen.getByText(/Entire-booking cancellation is unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit cancellation for review' })).toBeDisabled();
    view.unmount();
    render(<BookingCancellationChooser bookingId={10} status="pending" paymentStatus="authorized" paidCancellationAvailable={false} items={items} onChanged={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(screen.getByRole('button', { name: 'Confirm cancel request' })).toBeEnabled();
  });
});
