import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChefViewingsList from './ChefViewingsList';
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'fixture-chef' } }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('@/components/ui/date-field', () => ({ DateField: ({ id, value, onChange }: any) => <input id={id} value={value} onChange={event => onChange(event.target.value)} /> }));
vi.mock('react-i18next', async importOriginal => ({ ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, fallback?: any) => typeof fallback === 'string' ? fallback : fallback?.defaultValue || key }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
describe('chef tour notification links', () => {
  it('accepts manager suggested times to confirm a pending tour', async () => {
    const proposedTime = '2099-10-06T12:30:00Z';
    const rows = [{ viewing: { id: 77, status: 'pending', scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30, rescheduleProposedSlots: [proposedTime] }, locationName: 'Fixture kitchen' }];
    const fetcher = vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { problems: [], reportingAvailable: false } }));
    vi.stubGlobal('fetch', fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review suggested times' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Requested time')).toBeInTheDocument();
    expect(within(dialog).getByText(/Your manager offered these available times\. Choose one to confirm your tour/)).toHaveTextContent('Respond before your original requested start time');
    expect(within(dialog).queryByText(/original tour stays confirmed/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Keep original request' })).toBeEnabled();
    const accept = within(dialog).getByRole('button', { name: 'Accept and confirm tour' });
    expect(accept).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('radio'));
    fireEvent.click(accept);
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/viewings/chef/77/reschedule-proposal', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ decision: 'accept', scheduledAt: proposedTime, expectedUpdatedAt: '2026-10-04T12:00:00Z' }) })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    client.clear();
  });
  it.each(['pending_local_cooks', 'pending', 'confirmed'])('cancels a collapsed %s tour and keeps one action after expanding', async status => {
    const rows = [{ viewing: { id: 77, status, scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30 }, locationName: 'Fixture kitchen' }];
    const fetcher = vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { problems: [], reportingAvailable: false } }));
    vi.stubGlobal('fetch', fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    const cancel = await screen.findByRole('button', { name: 'Cancel tour' });
    expect(screen.getByRole('button', { name: 'View details' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(cancel);
    const dialog = await screen.findByRole('alertdialog');
    expect(fetcher.mock.calls.some(([path]) => path === '/api/viewings/77/status')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel tour' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/viewings/77/status', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'cancelled', cancellationReason: 'Tour cancelled', expectedUpdatedAt: '2026-10-04T12:00:00Z' }) })));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(screen.getByRole('heading', { name: 'Visit details' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cancel tour' })).toHaveLength(1);
    client.clear();
  });
  it.each(['pending_local_cooks', 'pending'])('shows the same public pending message for %s without routing history', async status => {
    const rows = [{ viewing: { id: 77, status, scheduledAt: '2099-10-05T12:30:00Z', durationMinutes: 30,
      adminReviewedAt: '2026-10-04T12:00:00Z', adminReviewDecision: status === 'pending' ? 'approved' : null,
      adminReviewReason: 'INTERNAL TRIAGE HISTORY' }, locationName: 'Fixture kitchen' }];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { problems: [], reportingAvailable: false } })));
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    expect(await screen.findByText('Your tour request is pending. We’ll notify you when it’s confirmed or declined.')).toBeInTheDocument();
    expect(screen.queryByText(/awaiting Local Cooks|Waiting for the kitchen manager|forwarded|INTERNAL TRIAGE HISTORY/i)).not.toBeInTheDocument();
    client.clear();
  });
  it('shows saved tour arrival and departure guidance in the linked visit details', async () => {
    const rows = [{ viewing: { id: 77, status: 'confirmed', scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30 },
      locationName: 'Fixture kitchen', arrivalNotes: 'Meet Sam at the side door\nPark in bay 3', departureNotes: 'Return the visitor badge' }];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { problems: [], reportingAvailable: false } })));
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Tour arrival and departure notes' })).toBeInTheDocument();
    expect(screen.getByText(/Meet Sam at the side door/)).toHaveClass('whitespace-pre-wrap');
    expect(screen.getByText('Return the visitor badge')).toBeInTheDocument();
    client.clear();
  });
  it('uses the same authenticated current-tour exclusion in calendar and slot consumers', async () => {
    const rows = [{ viewing: { id:77,targetedKitchenId:40,status:'confirmed',scheduledAt:'2099-10-05T12:30:00Z',updatedAt:'2026-10-04T12:00:00Z',durationMinutes:30,chefId:3 },locationName:'Fixture kitchen' }];
    const fetcher=vi.fn(async (path:string)=>({ok:true,json:async()=>path.includes('/api/viewings/chef')?rows:path.includes('calendar-availability')?{settings:{maxAdvanceBookingDays:30},availability:[],blackouts:[],fullyBookedDates:[]}:path.includes('available-slots')?{slots:[{scheduledAt:'2099-10-06T12:30:00Z',startTime:'10:00'}]}:{problems:[],reportingAvailable:false}}));
    vi.stubGlobal('fetch',fetcher);window.history.replaceState({},'', '/dashboard?view=viewings&viewing=77');
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', {name:'Reschedule tour'}));
    const date=await screen.findByLabelText('New date');fireEvent.change(date,{target:{value:'2099-10-06'}});
    await waitFor(()=>expect(fetcher.mock.calls.some(([path])=>path.includes('available-slots/40?date=2099-10-06&viewingId=77'))).toBe(true));
    const choices=fetcher.mock.calls.filter(([path])=>path.includes('calendar-availability')||path.includes('available-slots')) as any[];
    expect(choices).toHaveLength(2);
    for(const [path,options] of choices){expect(path).toContain('viewingId=77');expect(options.headers.Authorization).toBe('Bearer fixture-token');expect(options.cache).toBe('no-store');}
    client.clear();
  });
  it('opens the linked past outcome and excludes internal notes', async () => {
    const rows = [{ viewing: { id: 77, status: 'no_show', noShowReason: 'visitor_absent', scheduledAt: '2026-01-01T15:00:00Z', updatedAt: '2026-01-01T16:00:00Z', createdAt: '2025-12-01T12:00:00Z', durationMinutes: 30,
      managerNotes: 'ADMIN PRIVATE', sharedManagerNotes: 'Please contact Support if this is incorrect', outcomeHistory: [{ from: 'confirmed', to: 'no_show', recordedAt: '2026-01-01T16:00:00Z', notes: 'PRIVATE HISTORY' }] }, locationName: 'Fixture kitchen' }];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => rows })));
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    expect(await screen.findByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Visit details' })).toBeInTheDocument();
    expect(screen.getByText('Please contact Support if this is incorrect')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notes and updates' })).toBeInTheDocument();
    expect(document.querySelector('#tour-details-77 details')).toBeNull();
    expect(screen.queryByText('ADMIN PRIVATE')).not.toBeInTheDocument();
    expect(screen.queryByText('PRIVATE HISTORY')).not.toBeInTheDocument();
  });
});

describe('chef tour action links', () => {
  it.each(['reschedule', 'review-times', 'cancel'])('opens %s for the authenticated tour without submitting it or reopening after close', async action => {
    const rows = [{ viewing: { id: 77, status: 'confirmed', scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30, rescheduleProposedSlots: action === 'review-times' ? ['2099-10-06T12:30:00Z'] : [] }, locationName: 'Fixture kitchen' }];
    const fetcher = vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { problems: [], reportingAvailable: false } }));
    vi.stubGlobal('fetch', fetcher);
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77&action=' + action);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    const role = action === 'cancel' ? 'alertdialog' : 'dialog';
    const dialog = await screen.findByRole(role);
    expect(fetcher.mock.calls.every(([, options]: any) => !options?.method || options.method === 'GET')).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: action === 'cancel' ? 'Keep tour' : 'Close' }));
    await waitFor(() => expect(screen.queryByRole(role)).not.toBeInTheDocument());
    await client.invalidateQueries({ queryKey: ['/api/viewings', 'chef'] });
    expect(screen.queryByRole(role)).not.toBeInTheDocument();
    client.clear();
  });
  it.each([
    ['confirmed', '2000-01-01T12:30:00Z', '/dashboard?view=viewings&viewing=77&action=cancel'],
    ['cancelled', '2099-10-05T12:30:00Z', '/dashboard?view=viewings&viewing=77&action=reschedule'],
    ['confirmed', '2099-10-05T12:30:00Z', '/other?view=viewings&viewing=77&action=cancel'],
    ['confirmed', '2099-10-05T12:30:00Z', '/dashboard?view=viewings&viewing=99&action=cancel'],
    ['confirmed', '2099-10-05T12:30:00Z', '/dashboard?view=viewings&viewing=77&action=review-times'],
  ])('ignores stale or foreign action links (%s, %s, %s)', async (status, scheduledAt, url) => {
    const rows = [{ viewing: { id: 77, status, scheduledAt, updatedAt: '2026-10-04T12:00:00Z' }, locationName: 'Fixture kitchen' }];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { problems: [], reportingAvailable: false } })));
    window.history.replaceState({}, '', url);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading kitchen tours' })).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    client.clear();
  });
  it('groups scheduling actions before messaging and uses the existing rounded cancel button', async () => {
    const rows = [{ viewing: { id: 77, status: 'confirmed', scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z' }, locationName: 'Fixture kitchen' }];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => rows })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    await screen.findByRole('button', { name: 'Reschedule tour' });
    const buttons = within(document.querySelector('article')!).getAllByRole('button').map(button => button.textContent);
    expect(buttons).toEqual(['Reschedule tour', 'Cancel tour', 'Message manager', 'Download confirmation', 'View details']);
    const cancel = screen.getByRole('button', { name: 'Cancel tour' });
    expect(cancel).toHaveClass('rounded-full', 'h-9');
    expect(cancel).not.toHaveClass('rounded-none', 'border-l');
    client.clear();
  });
});
