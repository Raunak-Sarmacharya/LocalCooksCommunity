import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import ChefViewingsList from './chef/ChefViewingsList';
import { ViewingsDashboard } from './manager/ViewingsDashboard';
import { tourAttendance } from '@shared/tour-attendance';
import { tourNextAction } from '@/lib/manager-overview-lifecycle';
import OverviewTabContent from './chef/dashboard/OverviewTabContent';
vi.mock('@/components/chef/seller-revenue/hooks/useSellerRevenue', () => ({ useShopStatus: () => ({ data: null }), useStripeDashboardLink: () => ({}), openChefShopHome: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'fixture-chef' } }) }));
vi.mock('@/i18n/manager', () => ({ mt: (key: string) => key }));
vi.mock('react-i18next', async original => ({ ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, fallback?: any) => typeof fallback === 'string' ? fallback : key, i18n: { language: 'en-CA' } }) }));
vi.mock('@/components/ui/data-table', () => ({ DataTable: ({ data, onRowClick }: any) => <div><p>Tour list</p>{data.map((row: any) => <button key={row.id ?? row.viewing.id} onClick={() => onRowClick?.(row)}>View details</button>)}</div> }));
vi.mock('@/components/chat/TourChatButton', () => ({ TourChatButton: () => null }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients.length = 0; vi.useRealTimers();
  vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
function setup(role: 'chef' | 'manager', { arrived = false, status = 'confirmed', early = 20, readFailure = false, locationId = undefined as number | undefined, ended = false, committedConflict = false } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  let tour: any = { id: 42, chefId: 8, locationId: 33, targetedKitchenId: 40, status, scheduledAt: '2026-10-05T12:15:00.000Z',
    durationMinutes: 30, updatedAt: '2026-10-01T12:00:00.000Z', createdAt: '2026-10-01T12:00:00.000Z',
    attendanceHistory: [], outcomeHistory: [{ from: 'confirmed', to: status }], intakeData: {} };
  if (arrived) {
    tour.checkedInAt = '2026-10-05T11:59:00.000Z';
    tour.attendanceHistory = [{ action: 'check_in', actorId: 8, source: 'visitor', actualAt: tour.checkedInAt,
      recordedAt: tour.checkedInAt, scheduledAt: tour.scheduledAt }];
  }
  if (ended) {
    tour.scheduledAt = '2026-10-05T11:00:00.000Z';
    tour.attendanceHistory.forEach((entry: any) => { entry.scheduledAt = tour.scheduledAt; });
  }
  let failSave = false, failRead = readFailure;
  const fetcher = vi.fn(async (url: string, options?: any) => {
    if (options?.method === 'PATCH') return { ok: true, json: async () => ({ ...tour, status: 'completed' }) };
    if (url.endsWith('/attendance') && failRead) return { ok: false, json: async () => ({ error: 'Attendance temporarily unavailable' }) };
    if (options?.method === 'POST') {
      if (failSave) return { ok: false, status: 409, json: async () => ({ error: 'Tour changed; refresh before retry' }) };
      const input = JSON.parse(options.body), arrival = url.endsWith('check-in') || input.action === 'arrival';
      const actualAt = role === 'chef' ? new Date().toISOString() : new Date(input.actualAt).toISOString();
      tour = { ...tour, [arrival ? 'checkedInAt' : 'checkedOutAt']: actualAt, updatedAt: new Date(Date.now() + 1).toISOString(),
        attendanceHistory: [...tour.attendanceHistory, { action: arrival ? 'check_in' : 'check_out', actorId: role === 'chef' ? 8 : 2,
          source: role === 'chef' ? 'visitor' : 'manager_assisted', actualAt, recordedAt: new Date().toISOString(),
          scheduledAt: tour.scheduledAt, ...(role === 'manager' ? { reason: input.reason } : {}) }] };
      return committedConflict ? { ok: false, status: 409, json: async () => ({ error: 'Tour changed; refresh before retry' }) }
        : { ok: true, json: async () => tourAttendance(tour, early) };
    }
    return { ok: true, json: async () => url.endsWith('/attendance') ? tourAttendance(tour, early)
      : url.includes('commitment-problems') ? { problems: [], reportingAvailable: false }
      : url.includes('calendar-availability') ? {} : [{ viewing: { ...tour, attendance: tourAttendance(tour, early) }, locationName: 'Harbour kitchen', chefName: 'Ada' }] };
  });
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false,
    queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json() } } }); clients.push(client);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  window.history.replaceState({}, '', `${role === 'chef' ? '/dashboard' : '/manager/dashboard'}?view=viewings&viewing=42`);
  render(<QueryClientProvider client={client}>{role === 'chef' ? <ChefViewingsList /> : <ViewingsDashboard locationId={locationId} />}</QueryClientProvider>);
  return { fetcher, client, invalidate, tour: () => tour, failSave: (value: boolean) => { failSave = value; }, failRead: (value: boolean) => { failRead = value; } };
}
describe('Tour B actual visitor and manager consumers', () => {
  it.each([false, true])('refreshes the scoped manager parent and next decision after assistance (committed conflict: %s)', async committedConflict => {
    const fixture = setup('manager', { arrived: true, ended: true, locationId: 33, committedConflict });
    const listKey = ['/api/viewings/manager?locationId=33'];
    await screen.findByLabelText('Actual time with UTC offset');
    fireEvent.click(screen.getByText('Record a missed departure'));
    await waitFor(() => expect(fixture.client.getQueryData(listKey)).toBeDefined());
    const readsBefore = fixture.fetcher.mock.calls.filter(([url]) => url === listKey[0]).length;
    fixture.client.setQueryData(['unrelated-cache'], { retained: true });
    fireEvent.change(screen.getByLabelText('Actual time with UTC offset'), { target: { value: '2026-10-05T09:29:30-02:30' } });
    fireEvent.change(screen.getByLabelText('Evidence or missed-action reason (shared with visitor)'), { target: { value: 'Visitor reported departure over the phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record assisted departure' }));
    if (committedConflict) await screen.findByText(/Tour changed; refresh before retry/);
    await waitFor(() => {
      expect(fixture.fetcher.mock.calls.filter(([url]) => url === listKey[0]).length).toBeGreaterThan(readsBefore);
      expect(fixture.client.getQueryData<any[]>(listKey)?.[0].viewing).toMatchObject({
        updatedAt: fixture.tour().updatedAt, checkedOutAt: '2026-10-05T11:59:30.000Z',
        attendanceHistory: fixture.tour().attendanceHistory,
      });
      expect(fixture.client.getQueryState(['tour-attendance', 'manager', 42, fixture.tour().updatedAt])).toBeDefined();
    });
    expect(await screen.findByText(/Reason: Visitor reported departure/)).toBeInTheDocument();
    expect(fixture.client.getQueryState(['unrelated-cache'])?.isInvalidated).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'markCompleted' }));
    fireEvent.click(screen.getByRole('button', { name: 'markCompleted' }));
    await waitFor(() => expect(fixture.fetcher.mock.calls.find(([, options]) => options?.method === 'PATCH')).toBeDefined());
    const decision = fixture.fetcher.mock.calls.find(([, options]) => options?.method === 'PATCH')!;
    expect(JSON.parse(decision[1].body)).toMatchObject({ status: 'completed', expectedUpdatedAt: fixture.tour().updatedAt });
    expect(Date.now()).toBe(Date.parse('2026-10-05T12:00:00Z'));
  });
  it('surfaces exact-tour mandatory departure in the real visitor overview and clears it after save', async () => {
    const fixture = setup('chef', { arrived: true, status: 'completed' });
    const overview = <OverviewTabContent user={null} applications={[]} kitchenApplications={[]} kitchenSummary={{ label: 'None', variant: 'outline' } as any}
      enrichedBookings={[]} getMostRecentApplication={() => null} getApplicationStatus={() => null} getDocumentStatus={() => ''}
      onSetActiveTab={vi.fn()} onSetApplicationViewMode={vi.fn()} />;
    const mounted = render(<QueryClientProvider client={fixture.client}>{overview}</QueryClientProvider>);
    const attention = await screen.findByRole('button', { name: /Tour departure required/ });
    fireEvent.click(attention);
    expect(new URLSearchParams(window.location.search).get('viewing')).toBe('42');
    fireEvent.click(await screen.findByRole('button', { name: 'Record departure' }));
    await waitFor(() => expect(screen.queryAllByText('Tour departure required')).toHaveLength(0));
    mounted.unmount();
  });
  it('reads the shared endpoint contract, arrives, hides time change and departs; attention clears on saved action', async () => {
    const fixture = setup('chef');
    const arrival = await screen.findByRole('button', { name: 'Record arrival' });
    expect(arrival).toBeEnabled(); fireEvent.click(arrival);
    const departure = await screen.findByRole('button', { name: 'Record departure' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record departure' })).toBeEnabled());
    expect(screen.queryByText('Request new time')).not.toBeInTheDocument();
    expect(screen.getAllByText('Departure still required').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Record departure' }));
    await waitFor(() => expect(fixture.fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2));
    await waitFor(() => expect(screen.queryAllByText('Departure still required')).toHaveLength(0));
    expect(fixture.tour().attendanceHistory.map((entry: any) => entry.action)).toEqual(['check_in', 'check_out']);
    expect(fixture.invalidate).toHaveBeenCalled();
    const post = fixture.fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({ expectedUpdatedAt: '2026-10-01T12:00:00.000Z' });
  });
  it('keeps terminal-outcome departure reachable and displays a conflict with usable retry', async () => {
    const fixture = setup('chef', { arrived: true, status: 'completed' }); fixture.failSave(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Record departure' }));
    expect(await screen.findByText(/Tour changed; refresh before retry/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record departure' })).toBeEnabled());
    expect(screen.getAllByText('Departure still required').length).toBeGreaterThan(0);
    fixture.failSave(false); fireEvent.click(screen.getByRole('button', { name: 'Record departure' }));
    await waitFor(() => expect(screen.queryByText('Departure still required')).not.toBeInTheDocument());
    expect(fixture.tour().status).toBe('completed');
  });
  it('allows retrying a failed visit-status read when arrival is due', async () => {
    const fixture = setup('chef', { readFailure: true });
    expect(await screen.findByText('Could not load visit status. Please try again.')).toBeInTheDocument();
    fixture.failRead(false); fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText('Could not load visit status. Please try again.')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record arrival' })).toBeEnabled());
  });
  it('keeps a newly confirmed future tour free of arrival prompts in the list and actual overview', async () => {
    const fixture = setup('chef', { early: 5 });
    await screen.findByRole('region', { name: 'Tour details' });
    window.history.replaceState({}, '', '/dashboard?view=viewings');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Tour details' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Record arrival' })).not.toBeInTheDocument();
    expect(fixture.fetcher.mock.calls.some(([url]) => url.endsWith('/attendance'))).toBe(false);
    render(<QueryClientProvider client={fixture.client}><OverviewTabContent user={null} applications={[]} kitchenApplications={[]} kitchenSummary={{ label: 'None', variant: 'outline' } as any}
      enrichedBookings={[]} getMostRecentApplication={() => null} getApplicationStatus={() => null} getDocumentStatus={() => ''}
      onSetActiveTab={vi.fn()} onSetApplicationViewMode={vi.fn()} /></QueryClientProvider>);
    await waitFor(() => expect(fixture.client.getQueryData(['/api/viewings', 'chef', 'fixture-chef'])).toBeDefined());
    expect(screen.queryByRole('button', { name: /Tour arrival required/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record arrival' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/attendance/i);
  });
  it('opens the actual arrival action from the list only during the allowed window', async () => {
    const fixture = setup('chef');
    await screen.findByRole('region', { name: 'Tour details' });
    window.history.replaceState({}, '', '/dashboard?view=viewings');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Tour details' })).not.toBeInTheDocument());
    fireEvent.click((await screen.findAllByRole('button', { name: 'View details' }))[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record arrival' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Record arrival' }));
    await waitFor(() => expect(fixture.tour().checkedInAt).toBeDefined());
    expect(document.body.textContent).not.toMatch(/attendance/i);
  });
  it.each([false, true])('keeps manager visit status hidden until a saved arrival, even after the tour ends (%s)', async ended => {
    const fixture = setup('manager', { ended });
    await screen.findByRole('region', { name: 'sheetViewingDetails' });
    expect(screen.queryByRole('region', { name: 'Visit status' })).not.toBeInTheDocument();
    expect(fixture.fetcher.mock.calls.some(([url]) => url.endsWith('/attendance'))).toBe(false);
    expect(screen.getByRole('region', { name: 'tourNextStep' })).toHaveTextContent(ended ? 'tourNextOutcome' : 'tourNextPrepare');
    expect(screen.getByText('tourNoChefNotes')).toBeInTheDocument();
  });
  it('keeps pending chef requests free of visit actions', async () => {
    const fixture = setup('chef', { status: 'pending' });
    await screen.findByRole('region', { name: 'Tour details' });
    expect(screen.queryByRole('region', { name: 'Visit status' })).not.toBeInTheDocument();
    expect(fixture.fetcher.mock.calls.some(([url]) => url.endsWith('/attendance'))).toBe(false);
  });
  it('offers help for a missed arrival without a disabled arrival button', async () => {
    setup('chef', { ended: true });
    await screen.findByText('Missed recording your arrival? Contact the kitchen manager for help.');
    expect(screen.queryByRole('button', { name: 'Record arrival' })).not.toBeInTheDocument();
  });
  it('lets the current manager assist departure after no-show, preserves actual/recorded/source/reason and retries failures', async () => {
    const fixture = setup('manager', { arrived: true, status: 'no_show' }); fixture.failSave(true);
    const actual = await screen.findByLabelText('Actual time with UTC offset');
    fireEvent.click(screen.getByText('Record a missed departure'));
    fireEvent.change(actual, { target: { value: '2026-10-05T09:29:30-02:30' } });
    fireEvent.change(screen.getByLabelText('Evidence or missed-action reason (shared with visitor)'), { target: { value: 'Visitor reported departure over the phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record assisted departure' }));
    await screen.findByText(/Tour changed; refresh before retry/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record assisted departure' })).toBeEnabled());
    fixture.failSave(false); fireEvent.click(screen.getByRole('button', { name: 'Record assisted departure' }));
    await waitFor(() => expect(screen.queryByText('Departure still required')).not.toBeInTheDocument());
    expect(await screen.findByText(/Manager assisted/)).toBeInTheDocument();
    if (process.env.TOUR_B_SAVE_SAMPLES === '1') {
      mkdirSync('docs/phase-progress/evidence/tour-b-samples', { recursive: true });
      writeFileSync('docs/phase-progress/evidence/tour-b-samples/manager-saved-assistance.html', document.documentElement.outerHTML);
    }
    expect(screen.getByText(/Reason: Visitor reported departure/)).toBeInTheDocument();
    expect(fixture.tour().attendanceHistory[1]).toMatchObject({ actualAt: '2026-10-05T11:59:30.000Z', recordedAt: '2026-10-05T12:00:00.000Z', actorId: 2, source: 'manager_assisted' });
    expect(tourNextAction(fixture.tour(), Date.parse('2026-10-05T13:00:00Z'))).toBeNull();
    const post = fixture.fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toMatchObject({ action: 'departure', scheduledAt: '2026-10-05T12:15:00.000Z' });
  });
});
