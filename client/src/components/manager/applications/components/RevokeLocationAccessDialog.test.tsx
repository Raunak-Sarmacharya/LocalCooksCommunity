import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RevokeLocationAccessDialog } from './RevokeLocationAccessDialog';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }));

const customer = { chefId: 8, locationId: 47, fullName: 'Priya Nair', location: { name: 'Harbour Kitchens' } };
const bookings = [{ id: 123, kitchenName: 'Main Kitchen', bookingDate: '2027-01-01T00:00:00.000Z', startTime: '10:00', endTime: '12:00', status: 'confirmed' },
  { id: 124, kitchenName: 'Main Kitchen', bookingDate: '2027-01-02T00:00:00.000Z', startTime: '10:00', endTime: '12:00', status: 'pending' }];
const mount = (onConfirm = vi.fn(async () => {}), onClose = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RevokeLocationAccessDialog customer={customer} pending={false} onClose={onClose} onConfirm={onConfirm} />
  </QueryClientProvider>);
  return { onConfirm, onClose };
};

describe('end location access dialog', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ bookings, timezone: 'America/St_Johns' }) })));
  });

  it('lists future bookings, keeps them by default and links to Local Cooks for cancellations', async () => {
    mount();
    expect(await screen.findByText(/KB-123/)).toBeInTheDocument();
    expect(screen.getByText(/KB-124/)).toBeInTheDocument();
    // Friendly zone label, never the raw IANA id.
    expect(screen.getAllByText(/10:00–12:00 · Newfoundland Time/).length).toBe(2);
    expect(screen.queryByText(/America\/St_Johns/)).toBeNull();
    expect(screen.getByText('Keep these bookings; access ends for new bookings')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Contact Local Cooks for cancellations' });
    expect(link.getAttribute('href')).toContain('mailto:support@localcooks.ca');
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/manager/chef-location-access/bookings?chefId=8&locationId=47');
  });

  it('requires a reason before ending access and sends it trimmed', async () => {
    const { onConfirm } = mount();
    await screen.findByText(/KB-123/);
    const end = screen.getByRole('button', { name: 'End access for new bookings' });
    expect(end).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for ending access (required)'), { target: { value: '  Kitchen rules were broken.  ' } });
    expect(end).toBeEnabled();
    fireEvent.click(end);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Kitchen rules were broken.'));
  });

  it('does not allow ending access until the booking list has loaded', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({}) } as never);
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load upcoming bookings');
    fireEvent.change(screen.getByLabelText('Reason for ending access (required)'), { target: { value: 'Reason' } });
    expect(screen.getByRole('button', { name: 'End access for new bookings' })).toBeDisabled();
  });

  it('shows a failed confirmation and stays open', async () => {
    const { onClose } = mount(vi.fn(async () => { throw new Error('Could not end access.'); }));
    await screen.findByText(/KB-123/);
    fireEvent.change(screen.getByLabelText('Reason for ending access (required)'), { target: { value: 'Reason' } });
    fireEvent.click(screen.getByRole('button', { name: 'End access for new bookings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not end access.');
    expect(onClose).not.toHaveBeenCalled();
  });
});
