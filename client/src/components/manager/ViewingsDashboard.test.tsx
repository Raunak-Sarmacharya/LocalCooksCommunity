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
  client.setQueryData(['managerViewings', 'fixture-manager'], [record]);
  const fetcher = vi.fn(async (_url: any, options?: any) => ({ ok: options?.method ? writeStatus === 200 : true,
    status: options?.method ? writeStatus : 200, json: async () => String(_url).includes('/api/commitment-problems') ? { problems: [], reportingAvailable: false } : options?.method
      ? writeStatus === 200 ? { ...record.viewing, status: 'confirmed', notificationDeliveryFailed: true } : { error: 'Refresh and review it again' }
      : { updatedAt: version, scheduledAt: record.viewing.scheduledAt, overlapReviewKey: 'review-key', overlaps } }));
  vi.stubGlobal('fetch', fetcher);
  render(<QueryClientProvider client={client}><ViewingsDashboard /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
  fireEvent.click(screen.getByRole('button', { name: 'acceptViewing' }));
  return { client, fetcher };
}
describe('manager acceptance review', () => {
  it('groups all shared chef details and omits attendance instructions while confirmation is pending', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const full = { ...record, chefEmail: 'sam@example.test', chefPhone: '+17095550123', viewing: { ...record.viewing,
      chefNotes: 'I would like to see the ovens.\nI prepare weekly meals.', intakeData: { intendedUse: 'meal_prep', estimatedWeeklyHours: '10-20', hasLicense: false, targetStartDate: '2026-11-01', additionalInfo: 'Need refrigerated storage' } } };
    client.setQueryData(['/api/viewings/manager'], [full]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ problems: [], reportingAvailable: false }) })));
    render(<QueryClientProvider client={client}><ViewingsDashboard /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    const chef = screen.getByRole('region', { name: 'tourChefDetailsTitle' });
    expect(chef).toHaveTextContent('Fixture chef');
    expect(chef).toHaveTextContent('sam@example.test');
    expect(chef).toHaveTextContent('+17095550123');
    const request = screen.getByRole('region', { name: 'tourChefRequestDetails' });
    expect(request).toHaveTextContent('meal prep');
    expect(request).toHaveTextContent('10-20');
    expect(request).toHaveTextContent('no');
    expect(request).toHaveTextContent('Need refrigerated storage');
    expect(screen.getByRole('region', { name: 'tourNextStep' })).toHaveTextContent('tourNextReview');
    expect(screen.getByText(/I would like to see the ovens/)).toHaveClass('whitespace-pre-wrap');
    expect(screen.queryByRole('region', { name: 'Visit status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'tourBackToList' })).not.toBeInTheDocument();
    expect(screen.queryByText('Historical confirmation evidence is required')).not.toBeInTheDocument();
    client.clear();
  });
  it('opens a dedicated tour route from the list', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['/api/viewings/manager'], [record]);
    const open = vi.fn();
    render(<QueryClientProvider client={client}><ViewingsDashboard onOpenTour={open} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    expect(open).toHaveBeenCalledWith(10);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    client.clear();
  });
  it('keeps tour decisions on the page and guards the correct kitchen notes destination while editing', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['/api/viewings/manager'], [record]);
    const configure = vi.fn();
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ problems: [], reportingAvailable: false, updatedAt: version, overlaps: [], overlapReviewKey: 'key' }) }));
    vi.stubGlobal('fetch', fetcher);
    render(<QueryClientProvider client={client}><ViewingsDashboard onConfigureNotes={configure} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open tour' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'TOUR-10 · Fixture chef' })).toBeInTheDocument();
    expect(screen.queryByText('submitted')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'acceptViewing' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Meet me at reception' } });
    fireEvent.click(screen.getByRole('button', { name: 'tourEditVisitNotes' }));
    expect(configure).not.toHaveBeenCalled();
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'discardChanges' }));
    expect(configure).toHaveBeenCalledWith(40, 33);
    client.clear();
  });
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
    expect(client.getQueryData<any[]>(['managerViewings', 'fixture-manager'])![0].viewing.status).toBe('confirmed');
    client.clear();
  });
  it('keeps the decision open after a conflict and reports the need to review again', async () => {
    const { client } = mount([], 409);
    await screen.findByText('tourNoOverlappingBookings');
    await waitFor(() => expect(screen.getByRole('button', { name: 'confirmViewing' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'confirmViewing' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Refresh and review it again'));
    expect(screen.getByRole('region', { name: 'sheetViewingDetails' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    client.clear();
  });
});

describe('tour attendance and privacy controls', () => {
  function mountPast(status: string, history: any[] = []) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const past = { ...record, viewing: { ...record.viewing, status, scheduledAt: new Date(Date.now() - 86400000).toISOString(),
      managerNotes: 'ADMIN ONLY LEGACY', sharedManagerNotes: null, outcomeHistory: history } };
    client.setQueryData(['/api/viewings/manager'], [past]);
    const fetcher = vi.fn(async (_url: any, options?: any) => ({ ok: true, json: async () => String(_url).includes('/api/commitment-problems')
      ? { problems: [], reportingAvailable: false } : ({ ...past.viewing, status: JSON.parse(options.body).status }) }));
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
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true));
    const update = fetcher.mock.calls.find(([, options]) => options?.method === 'PATCH')!;
    expect(JSON.parse(update[1].body)).toMatchObject({ status: 'completed', sharedManagerNotes: 'You attended late; corrected.', expectedUpdatedAt: version });
    expect(JSON.parse(update[1].body)).not.toHaveProperty('managerNotes');
    client.clear();
  });
  it('does not infer confirmation evidence from a legacy terminal label', () => {
    const { client } = mountPast('no_show');
    expect(screen.queryByRole('button', { name: 'markCompleted' })).not.toBeInTheDocument();
    client.clear();
  });
});
