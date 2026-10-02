import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewingsDashboard } from './ViewingsDashboard';
const mocks = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('@/i18n/manager', () => ({ mt: (key: string) => key }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: mocks.warning, error: mocks.error } }));
vi.mock('@/components/ui/data-table', () => ({ DataTable: ({ data, onRowClick }: any) => <button onClick={() => onRowClick(data[0])}>Open tour</button> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const version = '2026-10-01T10:00:00.000Z';
const record = { viewing: { id: 10, locationId: 33, targetedKitchenId: 40, chefId: 8, status: 'pending',
  scheduledAt: new Date(Date.now() + 86400000).toISOString(), durationMinutes: 30, updatedAt: version, intakeData: {}, requestedRescheduleAt: null }, locationName: 'Fixture kitchen', chefName: 'Fixture chef' };
function mount(overlaps: any[] = [], writeStatus = 200) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['/api/viewings/manager'], [record]);
  const fetcher = vi.fn(async (_url: any, options?: any) => ({ ok: options?.method ? writeStatus === 200 : true,
    status: options?.method ? writeStatus : 200, json: async () => options?.method
      ? writeStatus === 200 ? { ...record.viewing, status: 'confirmed', notificationDeliveryFailed: true } : { error: 'Refresh and review it again' }
      : { updatedAt: version, scheduledAt: record.viewing.scheduledAt, overlapReviewKey: 'review-key', overlaps } }));
  vi.stubGlobal('fetch', fetcher);
  render(<QueryClientProvider client={client}><ViewingsDashboard /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
  fireEvent.click(screen.getByRole('button', { name: 'acceptViewing' }));
  return { client, fetcher };
}
describe('manager acceptance review', () => {
  it('opens a review and requires overlap acknowledgement before saving', async () => {
    const { client, fetcher } = mount([{ bookingId: 7, reference: 'KB-7', status: 'confirmed', start: record.viewing.scheduledAt,
      end: new Date(Date.parse(record.viewing.scheduledAt) + 3600000).toISOString(), timeUncertain: false }]);
    await screen.findByText('KB-7 · tourOverlapConfirmed');
    expect(screen.getByRole('button', { name: 'confirmViewing' })).toBeDisabled();
    expect(fetcher.mock.calls.some(call => call[1]?.method === 'PATCH')).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'tourAcceptBookingOverlap' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'confirmViewing' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'confirmViewing' }));
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledWith('tourSavedDeliveryFailed'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const write = fetcher.mock.calls.find(call => call[1]?.method === 'PATCH')!;
    expect(JSON.parse(write[1].body)).toMatchObject({ status: 'confirmed', expectedUpdatedAt: version, overlapReviewKey: 'review-key', acceptBookingOverlap: true });
    client.clear();
  });
  it('keeps the decision open after a conflict and reports the need to review again', async () => {
    const { client } = mount([], 409);
    await screen.findByText('tourNoOverlappingBookings');
    await waitFor(() => expect(screen.getByRole('button', { name: 'confirmViewing' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'confirmViewing' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Refresh and review it again'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    client.clear();
  });
});

describe('tour attendance and privacy controls', () => {
  function mountPast(status: string, history: any[] = []) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const past = { ...record, viewing: { ...record.viewing, status, scheduledAt: new Date(Date.now() - 86400000).toISOString(),
      managerNotes: 'ADMIN ONLY LEGACY', sharedManagerNotes: null, outcomeHistory: history } };
    client.setQueryData(['/api/viewings/manager'], [past]);
    const fetcher = vi.fn(async (_url: any, options?: any) => ({ ok: true, json: async () => ({ ...past.viewing, status: JSON.parse(options.body).status }) }));
    vi.stubGlobal('fetch', fetcher);
    render(<QueryClientProvider client={client}><ViewingsDashboard /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    return { client, fetcher };
  }
  it('does not offer attendance outcomes for an expired pending request', () => {
    const { client } = mountPast('pending');
    expect(screen.queryByRole('button', { name: 'markCompleted' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'markNoShow' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'tourCloseExpiredRequest' })).toBeInTheDocument();
    client.clear();
  });
  it('requires a shared explanation when correcting a confirmed no-show', async () => {
    const { client, fetcher } = mountPast('no_show', [{ from: 'confirmed', to: 'no_show' }]);
    fireEvent.click(screen.getByRole('button', { name: 'markCompleted' }));
    expect(screen.getByRole('button', { name: 'markCompleted' })).toBeDisabled();
    expect(screen.queryByText('ADMIN ONLY LEGACY')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'You attended late; corrected.' } });
    fireEvent.click(screen.getByRole('button', { name: 'markCompleted' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ status: 'completed', sharedManagerNotes: 'You attended late; corrected.', expectedUpdatedAt: version });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('managerNotes');
    client.clear();
  });
  it('does not infer confirmation evidence from a legacy terminal label', () => {
    const { client } = mountPast('no_show');
    expect(screen.queryByRole('button', { name: 'markCompleted' })).not.toBeInTheDocument();
    client.clear();
  });
});
