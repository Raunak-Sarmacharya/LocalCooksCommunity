import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChefViewingsList from './chef/ChefViewingsList';
import { ViewingsDashboard } from './manager/ViewingsDashboard';
import { createBookingDateTime } from '@shared/timezone-utils';
import { tourDateKey } from '@shared/tour-time';

vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'fixture-chef' } }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('@/components/ui/date-field', () => ({ DateField: ({ id, value, onChange, disabled }: any) => <input id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /> }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => <select aria-label="Available time" value={value} onChange={event => onValueChange(event.target.value)} disabled={disabled}><option value="" />{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }: any) => children,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
vi.mock('@/components/ui/data-table', () => ({ DataTable: ({ data, onRowClick }: any) => <button onClick={() => onRowClick(data[0])}>Open tour</button> }));
vi.mock('@/components/support/CommitmentProblems', () => ({ CommitmentProblems: () => null }));
vi.mock('@/components/chat/TourChatButton', () => ({ TourChatButton: () => null }));
vi.mock('@/i18n/manager', () => ({ mt: (key: string) => key }));
vi.mock('react-i18next', async importOriginal => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string, fallback?: any) => typeof fallback === 'string' ? fallback : fallback?.defaultValue || key }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

const version = '2026-10-01T10:00:00.000Z';
const original = '2099-10-05T12:30:00.000Z';
const alternatives = ['2099-10-06T12:30:00.000Z', '2099-10-07T13:00:00.000Z', '2099-10-08T13:00:00.000Z'];
const base = { viewing: { id: 77, locationId: 33, targetedKitchenId: 40, chefId: 8, status: 'confirmed', scheduledAt: original, durationMinutes: 30, updatedAt: version, intakeData: {}, requestedRescheduleAt: null, rescheduleProposedSlots: [] as string[] }, locationName: 'Fixture kitchen', chefName: 'Fixture chef' };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });
function client() { return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }); }

describe('chef tour reschedule proposals', () => {
  it('opens the confirmed reschedule modal from the detail page and restores focus on close', async () => {
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/api/viewings/chef' ? [base] : { settings: { maxAdvanceBookingDays: 30 }, availability: [], blackouts: [], fullyBookedDates: [] } }));
    vi.stubGlobal('fetch', fetcher);
    const queries = client();
    window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={queries}><ChefViewingsList /></QueryClientProvider>);
    const trigger = await screen.findByRole('button', { name: 'Reschedule tour' });
    expect(screen.getByRole('region', { name: 'Tour details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back/ })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/viewings/chef')).toHaveLength(1);
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Reschedule tour' });
    expect(dialog).toHaveTextContent('Fixture kitchen · TOUR-77');
    expect(dialog).toHaveTextContent('Tour time');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('h-11', 'w-full');
    expect(screen.getByRole('button', { name: 'Reschedule tour' })).toHaveClass('h-11', 'w-full');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Tour details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back/ })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([, options]) => options?.method)).toBe(false);
    queries.clear();
  });
  it('holds the modal open and blocks duplicate actions while a proposal decision is saving', async () => {
    let resolveSave!: (value: any) => void;
    const save = new Promise(resolve => { resolveSave = resolve; });
    const row = { ...base, viewing: { ...base.viewing, rescheduleProposedSlots: alternatives.slice(0, 1) } };
    const fetcher = vi.fn(async (_url: string, options?: any) => options?.method ? save : { ok: true, json: async () => [row] });
    vi.stubGlobal('fetch', fetcher);
    const queries = client();
    window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={queries}><ChefViewingsList /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review invitation' }));
    fireEvent.click(screen.getByRole('radio'));
    fireEvent.click(screen.getByRole('button', { name: 'Accept new time' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Keep original time' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Accept new time' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    resolveSave({ ok: true, json: async () => ({ ...base.viewing, rescheduleProposedSlots: [] }) });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetcher.mock.calls.filter(([, options]) => options?.method)).toHaveLength(1);
    queries.clear();
  });
  it('requests a confirmed reschedule without cancelling or replacing the held appointment', async () => {
    let saved = false;
    const fetcher = vi.fn(async (url: string, options?: any) => ({ ok: true, json: async () => {
      if (options?.method) { saved = true; return { ...base.viewing, requestedRescheduleAt: alternatives[0] }; }
      if (url === '/api/viewings/chef') return [{ ...base, viewing: { ...base.viewing, requestedRescheduleAt: saved ? alternatives[0] : null } }];
      if (url.includes('calendar-availability')) return { settings: { maxAdvanceBookingDays: 30 }, availability: [], blackouts: [], fullyBookedDates: [] };
      return { slots: [{ scheduledAt: alternatives[0] }] };
    } }));
    vi.stubGlobal('fetch', fetcher);
    const queries = client();
    window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={queries}><ChefViewingsList /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Reschedule tour' }));
    await waitFor(() => expect(screen.getByLabelText('New date')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('New date'), { target: { value: '2099-10-06' } });
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: alternatives[0] } });
    fireEvent.click(screen.getByRole('button', { name: 'Reschedule tour' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const writes = fetcher.mock.calls.filter(([, options]) => options?.method);
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe('/api/viewings/chef/77/reschedule');
    expect(JSON.parse(writes[0][1].body)).toEqual({ scheduledAt: alternatives[0], expectedUpdatedAt: version });
    expect(screen.queryByRole('button', { name: 'Reschedule tour' })).not.toBeInTheDocument();
    expect(queries.getQueryData<any[]>(['/api/viewings', 'chef', 'fixture-chef'])![0].viewing.scheduledAt).toBe(original);
    queries.clear();
  });
  it.each(['pending_local_cooks', 'pending'])('edits an unconfirmed %s request on its requested day using the same tour', async status => {
    let saved = false;
    const today = createBookingDateTime(tourDateKey(new Date()), '23:59').toISOString();
    const row = { ...base, viewing: { ...base.viewing, status, scheduledAt: today, intakeData: { intendedUse: 'Baking' } } };
    const fetcher = vi.fn(async (url: string, options?: any) => ({ ok: true, json: async () => {
      if (options?.method) { saved = true; return { ...row.viewing, scheduledAt: alternatives[0] }; }
      if (url === '/api/viewings/chef') return [{ ...row, viewing: { ...row.viewing, scheduledAt: saved ? alternatives[0] : today } }];
      if (url.includes('calendar-availability')) return { settings: { maxAdvanceBookingDays: 30 }, availability: [], blackouts: [], fullyBookedDates: [] };
      return { slots: [{ scheduledAt: alternatives[0] }] };
    } }));
    vi.stubGlobal('fetch', fetcher);
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const queries = client();
    window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={queries}><ChefViewingsList /></QueryClientProvider>);
    const trigger = await screen.findByRole('button', { name: 'Edit tour request' });
    expect(screen.getByRole('region', { name: 'Tour details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back/ })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => url.includes('calendar-availability'))).toBe(false);
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Edit tour request' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Choose a different available date and time. Your request will remain pending until it is confirmed.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('New date'), { target: { value: '2099-10-06' } });
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: alternatives[0] } });
    fireEvent.click(screen.getByRole('button', { name: 'Save request' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true));
    const writes = fetcher.mock.calls.filter(([, options]) => options?.method);
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe('/api/viewings/chef/77/reschedule');
    expect(JSON.parse(writes[0][1].body)).toEqual({ scheduledAt: alternatives[0], expectedUpdatedAt: version });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Tour details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back/ })).not.toBeInTheDocument();
    queries.clear();
  });
  it.each(['accept', 'decline'] as const)('reviews a manager proposal through the same tour with %s', async decision => {
    const row = { ...base, viewing: { ...base.viewing, rescheduleProposedSlots: alternatives.slice(0, 2) } };
    const fetcher = vi.fn(async (_url: string, options?: any) => ({ ok: true, json: async () => options?.method ? { ...row.viewing, rescheduleProposedSlots: [] } : [row] }));
    vi.stubGlobal('fetch', fetcher);
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const queries = client();
    window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={queries}><ChefViewingsList /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review invitation' }));
    await screen.findByRole('dialog', { name: 'Reschedule invitation' });
    expect(screen.queryByText('Reschedule tour')).not.toBeInTheDocument();
    expect(screen.getByText(/Your original tour stays confirmed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept new time' })).toBeDisabled();
    if (decision === 'accept') fireEvent.click(screen.getAllByRole('radio')[1]);
    fireEvent.click(screen.getByRole('button', { name: decision === 'accept' ? 'Accept new time' : 'Keep original time' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true));
    const writes = fetcher.mock.calls.filter(([, options]) => options?.method);
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe('/api/viewings/chef/77/reschedule-proposal');
    expect(JSON.parse(writes[0][1].body)).toEqual({ decision, expectedUpdatedAt: version, ...(decision === 'accept' ? { scheduledAt: alternatives[1] } : {}) });
    queries.clear();
  });
  it('closes chef initiation on the Newfoundland tour day while allowing a manager proposal decision', async () => {
    const dayOf = createBookingDateTime(tourDateKey(new Date()), '23:59').toISOString();
    const row = { ...base, viewing: { ...base.viewing, scheduledAt: dayOf } };
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => [row] }));
    vi.stubGlobal('fetch', fetcher);
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const queries = client();
    const page = render(<QueryClientProvider client={queries}><ChefViewingsList /></QueryClientProvider>);
    await screen.findByRole('region', { name: 'Tour details' });
    expect(screen.queryByText('Reschedule tour')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('available-slots'))).toBe(false);
    queries.setQueryData(['/api/viewings', 'chef', 'fixture-chef'], [{ ...row, viewing: { ...row.viewing, rescheduleProposedSlots: alternatives.slice(0, 1) } }]);
    fireEvent.click(await screen.findByRole('button', { name: 'Review invitation' }));
    await screen.findByRole('dialog', { name: 'Reschedule invitation' });
    expect(screen.getByRole('button', { name: 'Keep original time' })).toBeEnabled();
    page.unmount(); queries.clear();
  });
  it('refreshes a conflicting proposal and shows its error beside the tour rather than silently retrying', async () => {
    let reads = 0;
    const proposed = { ...base, viewing: { ...base.viewing, rescheduleProposedSlots: alternatives.slice(0, 1) } };
    const fetcher = vi.fn(async (_url: string, options?: any) => ({ ok: !options?.method, status: options?.method ? 409 : 200,
      json: async () => options?.method ? { error: 'That time is no longer available. Choose another time.' } : [++reads === 1 ? proposed : base] }));
    vi.stubGlobal('fetch', fetcher);
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const queries = client();
    window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={queries}><ChefViewingsList /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review invitation' }));
    fireEvent.click(await screen.findByRole('radio'));
    fireEvent.click(screen.getByRole('button', { name: 'Accept new time' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That time is no longer available. Choose another time.');
    expect(reads).toBeGreaterThan(1);
    expect(screen.queryByRole('region', { name: 'Choose a new tour time' })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([, options]) => options?.method)).toHaveLength(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    queries.clear();
  });
});

describe('manager tour reschedule proposals', () => {
  it.each(['pending', 'confirmed'])('selects up to three live alternatives and posts a versioned %s proposal', async status => {
    const row = { ...base, viewing: { ...base.viewing, status } };
    const queries = client(); queries.setQueryData(['/api/viewings/manager'], [row]);
    const fetcher = vi.fn(async (url: string, options?: any) => ({ ok: true, json: async () => options?.method ? { ...row.viewing, updatedAt: '2026-10-07T12:00:00Z', rescheduleProposedSlots: alternatives }
      : url.includes('calendar-availability') ? { settings: { maxAdvanceBookingDays: 30 }, availability: [], blackouts: [], fullyBookedDates: [] }
      : url.includes('available-slots') ? { slots: [{ scheduledAt: original }, ...[...alternatives, '2099-10-08T14:00:00.000Z'].filter(time => tourDateKey(new Date(time)) === new URL(url, 'http://fixture.test').searchParams.get('date')).map(scheduledAt => ({ scheduledAt })), { scheduledAt: '2000-01-01T12:00:00Z' }] } : [row] }));
    vi.stubGlobal('fetch', fetcher);
    render(<QueryClientProvider client={queries}><ViewingsDashboard /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    fireEvent.click(screen.getByRole('button', { name: status === 'pending' ? 'tourOfferAlternativeTimes' : 'tourProposeNewTimes' }));
    const date = screen.getByLabelText('tourNewDate');
    await waitFor(() => expect(date).toBeEnabled());
    for (const time of alternatives) {
      fireEvent.change(date, { target: { value: tourDateKey(new Date(time)) } });
      const times = within(await screen.findByRole('region', { name: 'tourAvailableTime' }));
      await waitFor(() => expect(times.getAllByRole('button', { pressed: false })[0]).toBeEnabled());
      fireEvent.click(times.getAllByRole('button', { pressed: false })[0]);
    }
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'tourAddAlternative' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'tourAvailableTime' })).getByRole('button', { pressed: false })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /tourRemoveAlternative/ })).toHaveLength(3);
    expect(screen.getByText(status === 'pending' ? 'tourPendingProposalAwaitingHelp' : 'tourProposalOriginalHeld')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'tourSendProposal' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true));
    const write = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(write[0]).toBe('/api/viewings/manager/77/reschedule-proposal');
    expect(JSON.parse(write[1].body)).toEqual({ proposedSlots: alternatives, expectedUpdatedAt: version });
    for (const [url, options] of fetcher.mock.calls.filter(([url]) => url.includes('calendar-availability') || url.includes('available-slots'))) {
      expect(url).toContain('viewingId=77'); expect(options.headers.Authorization).toBe('Bearer fixture-token'); expect(options.cache).toBe('no-store');
      if (url.includes('available-slots')) expect(url).toContain('proposal=true');
    }
    await screen.findByRole('region', { name: 'tourProposalPendingTitle' });
    expect(screen.queryByRole('button', { name: status === 'pending' ? 'tourOfferAlternativeTimes' : 'tourProposeNewTimes' })).not.toBeInTheDocument();
    if (status === 'pending') expect(screen.getByRole('button', { name: 'acceptViewing' })).toBeDisabled();
    queries.clear();
  });
  it('keeps sending disabled when live availability cannot load', async () => {
    const queries = client(); queries.setQueryData(['/api/viewings/manager'], [base]);
    const fetcher = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Unavailable' }) }));
    vi.stubGlobal('fetch', fetcher);
    render(<QueryClientProvider client={queries}><ViewingsDashboard /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    fireEvent.click(screen.getByRole('button', { name: 'tourProposeNewTimes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('tourProposalAvailabilityFailed');
    expect(screen.getByRole('button', { name: 'tourSendProposal' })).toBeDisabled();
    expect(screen.getByLabelText('tourNewDate')).toBeDisabled();
    expect(fetcher.mock.calls.some(([, options]) => options?.method)).toBe(false);
    queries.clear();
  });
  it('withdraws suggested times without cancelling the original tour or opening a support ticket', async () => {
    const proposed = { ...base, viewing: { ...base.viewing, rescheduleProposedSlots: alternatives.slice(0, 2) } };
    const queries = client(); queries.setQueryData(['/api/viewings/manager'], [proposed]);
    const fetcher = vi.fn(async (_url: string, options?: any) => ({ ok: true, json: async () => options?.method ? { ...base.viewing, rescheduleProposedSlots: [] } : [proposed] }));
    vi.stubGlobal('fetch', fetcher);
    render(<QueryClientProvider client={queries}><ViewingsDashboard /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    fireEvent.click(screen.getByRole('button', { name: 'tourWithdrawProposal' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true));
    const writes = fetcher.mock.calls.filter(([, options]) => options?.method);
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe('/api/viewings/manager/77/reschedule-proposal');
    expect(JSON.parse(writes[0][1].body)).toEqual({ decision: 'withdraw', expectedUpdatedAt: version });
    queries.clear();
  });
});
