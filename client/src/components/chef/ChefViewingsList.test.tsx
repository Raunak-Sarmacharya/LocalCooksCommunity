import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChefViewingsList from './ChefViewingsList';
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { uid: 'fixture-chef' } }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('@/components/ui/date-field', () => ({ DateField: ({ id, value, onChange }: any) => <input id={id} value={value} onChange={event => onChange(event.target.value)} /> }));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, fallback?: any) => typeof fallback === 'string' ? fallback : fallback?.defaultValue || key })
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
describe('chef tour notification links', () => {
  it('guides an email visitor, shows saving feedback, and confirms the persisted attendance reply', async () => {
    const tour = { id: 77, status: 'confirmed', scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30 };
    let saved = false;
    let finishReply!: () => void;
    const replyGate = new Promise<void>(resolve => { finishReply = resolve; });
    const fetcher = vi.fn(async (path: string, options?: any) => {
      if (path.endsWith('/reconfirmation')) { await replyGate; saved = true; }
      return {
        ok: true, json: async () => path === '/api/viewings/chef'
          ? [{ viewing: tour, locationName: 'Fixture kitchen', reconfirmation: { revision: '1:12', canReply: true, reply: saved ? 'still_coming' : null } }]
          : { events: [], problems: [] }
      };
    });
    vi.stubGlobal('fetch', fetcher);
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77&action=reconfirm');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    const next = await screen.findByRole('region', { name: 'What to do next' });
    expect(within(next).getByRole('heading', { name: 'Are you still coming to your tour?' })).toBeInTheDocument();
    expect(next).toHaveTextContent('Please confirm below');
    expect(next).not.toHaveTextContent('Arrive on time and bring questions');
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    fireEvent.click(within(next).getByRole('button', { name: 'Yes, I’m still coming' }));
    const saving = within(next).getByRole('button', { name: 'Saving your reply…' });
    expect(saving).toBeDisabled();
    expect(saving).toHaveAttribute('aria-busy', 'true');
    expect(within(next).getByRole('button', { name: 'Change my plans' })).toBeDisabled();
    expect(within(next).getByRole('status')).toHaveTextContent('Saving your reply…');
    fireEvent.click(saving);
    await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => path.endsWith('/reconfirmation'))).toHaveLength(1));
    finishReply();
    expect(await within(next).findByRole('heading', { name: 'Thanks for confirming' })).toBeInTheDocument();
    expect(within(next).getByRole('status')).toHaveTextContent('You confirmed that you’re still coming.');
    expect(within(next).queryByRole('button', { name: 'Yes, I’m still coming' })).not.toBeInTheDocument();
    expect(within(next).getByRole('button', { name: 'Change my plans' })).toBeEnabled();
    expect(JSON.parse(fetcher.mock.calls.find(([path]) => path.endsWith('/reconfirmation'))![1].body)).toEqual({ reply: 'still_coming', appointmentRevision: '1:12', expectedUpdatedAt: tour.updatedAt });
    expect(client.getQueryData<any[]>(['/api/viewings', 'chef', 'fixture-chef'])![0].viewing.status).toBe('confirmed');
    client.clear();
  });
  it('keeps the attendance actions available after a failed save without claiming success', async () => {
    const rows = [{ viewing: { id: 77, status: 'confirmed', scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z' }, locationName: 'Fixture kitchen', reconfirmation: { revision: '1:12', canReply: true, reply: null } }];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: !path.endsWith('/reconfirmation'), json: async () => path === '/api/viewings/chef' ? rows : path.endsWith('/reconfirmation') ? { error: 'Could not save your reply. Please try again.' } : { events: [], problems: [] } })));
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77&action=reconfirm');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, I’m still coming' }));
    const next = screen.getByRole('region', { name: 'What to do next' });
    expect(await within(next).findByRole('alert')).toHaveTextContent('Could not save your reply. Please try again.');
    expect(screen.getByRole('button', { name: 'Yes, I’m still coming' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Thanks for confirming' })).not.toBeInTheDocument();
    client.clear();
  });
  it('offers only attendance choices and opens rescheduling after selecting it inside Can’t make it', async () => {
    const tour = { id: 77, status: 'confirmed', targetedKitchenId: 40, scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30 };
    const rows = [{ viewing: tour, locationName: 'Fixture kitchen', reconfirmation: { revision: '1:12', canReply: true, reply: 'still_coming' } }];
    const fetcher = vi.fn(async (path: string, options?: any) => ({
      ok: true, json: async () => path === '/api/viewings/chef' ? rows
        : path.includes('/reconfirmation') ? { ...tour, updatedAt: '2026-10-04T12:01:00Z' } : { problems: [], reportingAvailable: false }
    }));
    vi.stubGlobal('fetch', fetcher);
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    const next = await screen.findByRole('region', { name: 'What to do next' });
    expect(within(next).getAllByRole('button').map(button => button.textContent)).toEqual(['Change my plans']);
    expect(next).toHaveTextContent('You confirmed that you’re still coming.');
    const change = within(next).getByRole('button', { name: 'Change my plans' });
    fireEvent.click(change);
    expect(change).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.getAllByRole('button', { name: 'Cancel tour' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Reschedule' })).toHaveLength(1);
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }));
    expect(await screen.findByRole('dialog', { name: 'Reschedule tour' })).toBeInTheDocument();
    expect(JSON.parse(fetcher.mock.calls.find(([path]) => path.endsWith('/reconfirmation'))![1].body)).toEqual({ reply: 'reschedule', appointmentRevision: '1:12', expectedUpdatedAt: tour.updatedAt });
    expect(fetcher.mock.calls.some(([path]) => path.endsWith('/reschedule') || path.endsWith('/status'))).toBe(false);
    client.clear();
  });
  it('shows saved feedback and pending admin review instead of asking the chef to submit twice', async () => {
    const rows = [{
      viewing: {
        id: 77, status: 'confirmed', chefFeedbackSubmitted: true, confirmationVerified: true,
        scheduledAt: '2020-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30
      }, locationName: 'Fixture kitchen'
    }];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { events: [], problems: [] } })));
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    expect(await screen.findByText('Thank you for sharing your feedback.')).toBeInTheDocument();
    expect(screen.queryByText('The tour time has ended. Share your feedback; Local Cooks will review both responses and record the final outcome.')).not.toBeInTheDocument();
    client.clear();
  });
  it('uses actual listing names in preparation and opens explicit cancellation after a soft reply without cancelling', async () => {
    const tour = { id: 77, status: 'confirmed', targetedKitchenId: 40, scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30, intakeData: { intendedUse: 'meal_prep' } };
    const rows = [{ viewing: tour, locationName: 'Fixture kitchen', managerEmail: 'current-manager@example.test', reconfirmation: { revision: '1:12', canReply: true, reply: null, needsStaffAttention: false } }];
    const fetcher = vi.fn(async (path: string, options?: any) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : path.includes('equipment-listings') ? { included: [{ equipmentType: 'convection_oven' }], rental: [] } : path.includes('storage-listings') ? [{ name: 'Cold shelf A' }] : path.includes('/reconfirmation') ? { ...tour, updatedAt: '2026-10-04T12:01:00Z' } : { problems: [], reportingAvailable: false } }));
    vi.stubGlobal('fetch', fetcher); window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77&action=reconfirm');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    expect(await screen.findByText(/Listed equipment: convection oven/)).toBeInTheDocument();
    expect(screen.getByText(/Listed storage: Cold shelf A/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Running late' })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Change my plans' }));
    const options = screen.getByRole('dialog', { name: 'Change your plans' });
    expect(within(options).getByRole('button', { name: 'Reschedule' })).toBeEnabled();
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(within(options).getByRole('button', { name: 'Cancel tour' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(fetcher.mock.calls.some(([path]) => path.endsWith('/status'))).toBe(false);
    const reply = fetcher.mock.calls.find(([path]) => path.endsWith('/reconfirmation'))![1];
    expect(JSON.parse(reply.body)).toEqual({ reply: 'cant_make_it', appointmentRevision: '1:12', expectedUpdatedAt: tour.updatedAt });
    client.clear();
  });
  it('shows persisted expiry distinctly and never invents a historical confirmation date', async () => {
    const rows = [{ viewing: { id: 77, status: 'cancelled', requestExpiredAt: '2026-10-05T12:30:00Z', scheduledAt: '2026-10-05T12:30:00Z', updatedAt: '2026-10-05T12:30:00Z', durationMinutes: 30 }, locationName: 'Fixture kitchen' }];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { problems: [], reportingAvailable: false } })));
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    expect(await screen.findByText('Request expired')).toBeInTheDocument();
    expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
    expect(screen.queryByText('No show')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Confirmed on' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Discover Kitchens' })).toBeInTheDocument();
    client.clear();
  });
  it('displays an explicitly recorded confirmation timestamp', async () => {
    const rows = [{ viewing: { id: 77, status: 'confirmed', confirmedAt: '2026-10-04T12:00:00Z', scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30 }, locationName: 'Fixture kitchen' }];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { problems: [], reportingAvailable: false } })));
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Kitchen tour details' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Confirmed on' })).not.toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([path]) => path === '/api/viewings/chef/77/history')).toBe(true));
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
    client.clear();
  });
  it('accepts manager suggested times to confirm a pending tour', async () => {
    const proposedTime = '2099-10-06T12:30:00Z';
    const rows = [{ viewing: { id: 77, status: 'pending', scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30, rescheduleProposedSlots: [proposedTime] }, locationName: 'Fixture kitchen' }];
    const fetcher = vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { problems: [], reportingAvailable: false } }));
    vi.stubGlobal('fetch', fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (window.location.pathname === "/") window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Review invitation' }));
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
  it.each(['pending_local_cooks', 'pending', 'confirmed'])('cancels a %s tour from its dedicated detail page', async status => {
    const rows = [{ viewing: { id: 77, status, scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30 }, locationName: 'Fixture kitchen' }];
    const fetcher = vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { problems: [], reportingAvailable: false } }));
    vi.stubGlobal('fetch', fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (window.location.pathname === "/") window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    const cancel = await screen.findByRole('button', { name: 'Cancel tour' });
    expect(screen.queryByRole('button', { name: /Back/ })).not.toBeInTheDocument();
    fireEvent.click(cancel);
    const dialog = await screen.findByRole('alertdialog');
    expect(fetcher.mock.calls.some(([path]) => path === '/api/viewings/77/status')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel tour' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/viewings/77/status', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'cancelled', cancellationReason: 'Tour cancelled', expectedUpdatedAt: '2026-10-04T12:00:00Z' }) })));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(window.location.search).toContain('viewing=77');
    expect(screen.getByRole('heading', { name: 'Kitchen tour details' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cancel tour' })).toHaveLength(1);
    client.clear();
  });
  it.each(['pending_local_cooks', 'pending'])('shows the same public pending message for %s without routing history', async status => {
    const rows = [{
      viewing: {
        id: 77, status, scheduledAt: '2099-10-05T12:30:00Z', durationMinutes: 30,
        adminReviewedAt: '2026-10-04T12:00:00Z', adminReviewDecision: status === 'pending' ? 'approved' : null,
        adminReviewReason: 'INTERNAL TRIAGE HISTORY'
      }, locationName: 'Fixture kitchen'
    }];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { problems: [], reportingAvailable: false } })));
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (window.location.pathname === "/") window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    expect(await screen.findByText('Your tour request is pending. We’ll notify you when it’s confirmed or declined.')).toBeInTheDocument();
    expect(screen.queryByText(/awaiting Local Cooks|Waiting for the kitchen manager|forwarded|INTERNAL TRIAGE HISTORY/i)).not.toBeInTheDocument();
    client.clear();
  });
  it('shows saved tour arrival and departure guidance in the linked visit details', async () => {
    const rows = [{
      viewing: { id: 77, status: 'confirmed', scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30 },
      locationName: 'Fixture kitchen', arrivalNotes: 'Meet Sam at the side door\nPark in bay 3', departureNotes: 'Return the visitor badge'
    }];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { problems: [], reportingAvailable: false } })));
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (window.location.pathname === "/") window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Arrival notes' })).toBeInTheDocument();
    expect(screen.getByText(/Meet Sam at the side door/)).toHaveClass('whitespace-pre-wrap');
    expect(screen.getByText('Return the visitor badge')).toBeInTheDocument();
    client.clear();
  });
  it('uses the same authenticated current-tour exclusion in calendar and slot consumers', async () => {
    const rows = [{ viewing: { id: 77, targetedKitchenId: 40, status: 'confirmed', scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30, chefId: 3 }, locationName: 'Fixture kitchen' }];
    const fetcher = vi.fn(async (path: string) => ({ ok: true, json: async () => path.includes('/api/viewings/chef') ? rows : path.includes('calendar-availability') ? { settings: { maxAdvanceBookingDays: 30 }, availability: [], blackouts: [], fullyBookedDates: [] } : path.includes('available-slots') ? { slots: [{ scheduledAt: '2099-10-06T12:30:00Z', startTime: '10:00' }] } : { problems: [], reportingAvailable: false } }));
    vi.stubGlobal('fetch', fetcher); window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (window.location.pathname === "/") window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Reschedule tour' }));
    const date = await screen.findByLabelText('New date'); fireEvent.change(date, { target: { value: '2099-10-06' } });
    await waitFor(() => expect(fetcher.mock.calls.some(([path]) => path.includes('available-slots/40?date=2099-10-06&viewingId=77'))).toBe(true));
    const choices = fetcher.mock.calls.filter(([path]) => path.includes('calendar-availability') || path.includes('available-slots')) as any[];
    expect(choices).toHaveLength(2);
    for (const [path, options] of choices) { expect(path).toContain('viewingId=77'); expect(options.headers.Authorization).toBe('Bearer fixture-token'); expect(options.cache).toBe('no-store'); }
    client.clear();
  });
  it('opens the linked past outcome and excludes internal notes', async () => {
    const rows = [{
      viewing: {
        id: 77, status: 'no_show', noShowReason: 'visitor_absent', scheduledAt: '2026-01-01T15:00:00Z', updatedAt: '2026-01-01T16:00:00Z', createdAt: '2025-12-01T12:00:00Z', durationMinutes: 30,
        managerNotes: 'ADMIN PRIVATE', sharedManagerNotes: 'Please contact Support if this is incorrect', outcomeHistory: [{ from: 'confirmed', to: 'no_show', recordedAt: '2026-01-01T16:00:00Z', notes: 'PRIVATE HISTORY' }]
      }, locationName: 'Fixture kitchen'
    }];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => rows })));
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (window.location.pathname === "/") window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    expect(await screen.findByRole('region', { name: 'What to do next' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kitchen tour details' })).toBeInTheDocument();
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
    if (window.location.pathname === "/") window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
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
    if (window.location.pathname === "/") window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading kitchen tours' })).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    client.clear();
  });
  it('separates scheduling, confirmation download and kitchen coordination', async () => {
    const rows = [{ viewing: { id: 77, status: 'confirmed', scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z' }, locationName: 'Fixture kitchen' }];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => rows })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (window.location.pathname === "/") window.history.replaceState({}, "", "/dashboard?view=viewings&viewing=77");
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    await screen.findByRole('button', { name: 'Reschedule tour' });
    const next = screen.getByRole('region', { name: 'What to do next' });
    expect(within(next).getAllByRole('button').map(button => button.textContent)).toEqual(['Reschedule tour', 'Cancel tour']);
    const confirmation = screen.getByRole('region', { name: 'Kitchen tour confirmation' });
    expect(within(confirmation).getByRole('button', { name: 'Download' })).toBeEnabled();
    expect(confirmation.compareDocumentPosition(screen.getByRole('region', { name: 'Arrival notes' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const contact = screen.getByRole('region', { name: 'Coordinate with the kitchen' });
    expect(within(contact).getByRole('button', { name: 'Message manager' })).toBeInTheDocument();
    expect(within(next).queryByRole('button', { name: 'Message manager' })).not.toBeInTheDocument();
    expect(within(next).queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('complementary', { name: 'Tour summary' })).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Arrival notes' })).toHaveTextContent('The kitchen manager hasn’t shared arrival instructions yet.');
    expect(screen.getByRole('region', { name: 'Departure notes' })).toHaveTextContent('The kitchen manager hasn’t shared departure instructions yet.');
    const cancel = screen.getByRole('button', { name: 'Cancel tour' });
    expect(cancel).toHaveClass('rounded-full', 'h-9');
    expect(cancel).not.toHaveClass('rounded-none', 'border-l');
    client.clear();
  });
});


describe('chef table and dedicated tour page', () => {
  const rows = [77, 88].map(id => ({ viewing: { id, status: 'confirmed', scheduledAt: '2099-10-05T12:30:00Z', durationMinutes: 30 }, locationName: `Kitchen ${id}`, arrivalNotes: `Arrival ${id}` }));
  function mountPage() {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : { problems: [], reportingAvailable: false } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return { client, page: render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>) };
  }
  it('opens a keyboard activated row as an addressable page and returns to the table', async () => {
    window.history.replaceState({}, '', '/dashboard?view=viewings');
    const { client, page } = mountPage();
    const table = await screen.findByTestId('data-table-desktop');
    const row = within(table).getByText('Kitchen 77').closest('tr')!;
    expect(row).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: 'Kitchen tour details' })).toBeInTheDocument();
    expect(window.location.search).toBe('?view=viewings&viewing=77');
    expect(screen.queryByTestId('data-table-desktop')).not.toBeInTheDocument();
    expect(screen.queryByText('Kitchen 88')).not.toBeInTheDocument();
    expect(screen.getByText('Arrival 77')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reschedule tour' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel tour' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Message manager' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    page.unmount();
    const reloaded = render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Kitchen tour details' })).toBeInTheDocument();
    window.history.replaceState({}, '', '/dashboard?view=viewings');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByTestId('data-table-desktop')).toBeInTheDocument();
    expect(window.location.search).toBe('?view=viewings');
    reloaded.unmount(); client.clear();
  });
  it('shows an unavailable direct link and provides a safe return to the list', async () => {
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=99');
    const { client } = mountPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('This tour is unavailable');
    expect(screen.queryByRole('heading', { name: 'Kitchen tour details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back/ })).not.toBeInTheDocument();
    window.history.replaceState({}, '', '/dashboard?view=viewings');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByTestId('data-table-desktop')).toBeInTheDocument();
    client.clear();
  });
});


describe('chef next steps and information rail', () => {
  it.each([
    ['pending', '2099-10-05T12:30:00Z', 'Your tour request is pending.', 'Edit tour request'],
    ['confirmed', '2099-10-05T12:30:00Z', 'Tour confirmed. Arrive on time', 'Reschedule tour'],
    ['completed', '2020-10-05T12:30:00Z', 'Your tour is complete.', null],
    ['no_show', '2020-10-05T12:30:00Z', 'Review the tour outcome', null],
    ['pending', '2020-10-05T12:30:00Z', 'The requested time passed before confirmation.', null],
  ])('gives %s an actionable next step and preserves its public information', async (status, scheduledAt, nextStep, action) => {
    const rows = [{ viewing: { id: 77, locationId: 4, status, scheduledAt, durationMinutes: 30, chefNotes: 'Bring equipment questions', intakeData: { purpose: 'Bakery' } }, locationName: 'Fixture kitchen', locationAddress: '123 Water Street', managerName: 'Sam', arrivalNotes: 'Use the side entrance' }];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({
      ok: true, json: async () => path === '/api/viewings/chef' ? rows : path.endsWith('/application-next-step')
        ? { action: 'apply', applicationId: null, sourceTourId: 77, href: '/apply-kitchen/4?tourId=77' } : { problems: [], reportingAvailable: false }
    })));
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    const banner = await screen.findByRole('region', { name: 'What to do next' });
    expect(banner).toHaveTextContent(nextStep!);
    const rail = screen.getByRole('complementary', { name: 'Tour summary' });
    expect(rail).toHaveTextContent('Fixture kitchen');
    expect(within(rail).getByRole('link', { name: '123 Water Street' })).toHaveAttribute('href', expect.stringContaining('123%20Water%20Street'));
    expect(screen.getByText('Use the side entrance')).toBeInTheDocument();
    expect(screen.getByText('Bring equipment questions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back/ })).not.toBeInTheDocument();
    if (action) expect(within(banner).getByRole('button', { name: action })).toBeEnabled();
    else {
      expect(within(banner).queryByRole('button', { name: 'Cancel tour' })).not.toBeInTheDocument();
      expect(within(banner).queryByRole('button', { name: 'Reschedule tour' })).not.toBeInTheDocument();
    }
    if (status === 'pending') expect(screen.getByRole('region', { name: 'Departure notes' })).toHaveTextContent('Departure instructions are available after your tour is confirmed.');
    if (status === 'completed' || status === 'no_show') expect(screen.getByRole('region', { name: 'Departure notes' })).toHaveTextContent('Instructions are unavailable for this tour.');
    if (status === 'completed') expect(await within(banner).findByRole('link', { name: 'Apply when you’re ready' })).toHaveAttribute('href', '/apply-kitchen/4?tourId=77');
    if (status === 'no_show' || (status === 'pending' && !action)) expect(within(banner).getByRole('link', { name: 'Discover Kitchens' })).toHaveAttribute('href', '/dashboard?view=discover-kitchens');
    client.clear();
  });
});

describe('tour inventory previews', () => {
  it.each([
    { count: 1, rental: false },
    { count: 4, rental: false },
    { count: 5, rental: false },
    { count: 4, rental: true },
  ])('always offers equipment and storage details: $count items, rental $rental', async ({ count, rental }) => {
    const rows = [{ viewing: { id: 77, status: 'confirmed', targetedKitchenId: 40, scheduledAt: '2099-10-05T12:30:00Z', updatedAt: '2026-10-04T12:00:00Z', durationMinutes: 30 }, locationName: 'Fixture kitchen' }];
    const items = Array.from({ length: count }, (_, i) => ({ id: i, equipmentType: `Item ${i + 1}` }));
    vi.stubGlobal('fetch', vi.fn(async (path: string) => ({ ok: true, json: async () => path === '/api/viewings/chef' ? rows : path.includes('equipment-listings') ? { included: rental ? items.slice(0, -1) : items, rental: rental ? items.slice(-1) : [] } : path.includes('storage-listings') ? items.map(item => ({ id: item.id, name: item.equipmentType, storageType: 'dry', pricingModel: 'daily', basePrice: 2400 })) : { events: [], problems: [], reportingAvailable: false } })));
    window.history.replaceState({}, '', '/dashboard?view=viewings&viewing=77');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ChefViewingsList /></QueryClientProvider>);
    const preview = items.slice(0, 4).map(item => item.equipmentType).join(', ');
    expect(await screen.findByText(new RegExp(`Listed equipment: ${preview}`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Listed storage: ${preview}`))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all equipment' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Show all storage' })).toBeEnabled();
    expect(screen.queryByText(/Item 5/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all storage' }));
    const storage = screen.getByRole('dialog', { name: 'Storage' });
    expect(within(storage).getAllByText('$24.00')).toHaveLength(count);
    expect(within(storage).getAllByText('/day')).toHaveLength(count);
    client.clear();
  });
});
