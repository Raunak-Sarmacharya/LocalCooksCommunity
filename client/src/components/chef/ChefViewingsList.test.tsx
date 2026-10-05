import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.queryByText('ADMIN PRIVATE')).not.toBeInTheDocument();
    expect(screen.queryByText('PRIVATE HISTORY')).not.toBeInTheDocument();
  });
});
