import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewingsDashboard } from './ViewingsDashboard';
const mocks = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
vi.mock('@/i18n/manager', async () => {
  const { default: locale } = await import('../../../../shared/i18n/locales/en-CA/manager.json');
  return { mt: (key: string, options?: { name?: string }) => key === 'tourNextReview' ? locale.tourNextReview : key === 'tourMessageVisitor' ? `Message ${options?.name}` : key };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: mocks.warning, error: mocks.error } }));
vi.mock('@/components/ui/data-table', () => ({ DataTable: ({ data, onRowClick }: any) => <button onClick={() => onRowClick(data[0])}>Open tour</button> }));
vi.mock('@/components/ui/date-field', () => ({ DateField: ({ id, value, onChange, disabled }: any) => <input id={id} type="date" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); window.history.replaceState({}, '', '/'); });
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
  it.each(['completed', 'no_show', 'cancelled'])('does not ask for new feedback after admin closes a %s tour', status => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['/api/viewings/manager'], [{ ...record, viewing: { ...record.viewing, status,
      scheduledAt: new Date(Date.now() - 86400000).toISOString(), confirmationVerified: true,
      disruptionReason: status === 'cancelled' ? 'outcome_unknown' : null } }]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ events: [], complete: false }) })));
    render(<QueryClientProvider client={client}><ViewingsDashboard /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    expect(screen.queryByText('tourNextFeedback')).not.toBeInTheDocument();
    expect(screen.queryByText('tourNextFeedbackSubmitted')).not.toBeInTheDocument();
    client.clear();
  });
  it('shows pending admin review after the manager submits feedback instead of asking for a second response', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['/api/viewings/manager'], [{ ...record, viewing: { ...record.viewing, status: 'confirmed',
      scheduledAt: new Date(Date.now() - 86400000).toISOString(), confirmationVerified: true, managerFeedbackSubmitted: true } }]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ events: [], complete: false }) })));
    render(<QueryClientProvider client={client}><ViewingsDashboard /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    expect(screen.getByText('tourNextFeedbackSubmitted')).toBeInTheDocument();
    expect(screen.queryByText('tourNextFeedback')).not.toBeInTheDocument();
    client.clear();
  });
  it('adds preparation guidance to the existing confirmed request briefing and keeps silence confirmed', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['/api/viewings/manager'], [{ ...record, viewing: { ...record.viewing, status: 'confirmed', intakeData: { intendedUse: 'meal_prep', targetStartDate: 'not_decided', hasLicense: false, estimatedWeeklyHours: '10-20' } }, reconfirmation: { canReply: true, reply: null, needsStaffAttention: true } }]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ events: [], complete: false, problems: [], reportingAvailable: false }) })));
    render(<QueryClientProvider client={client}><ViewingsDashboard /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    expect(screen.getByRole('heading', { name: 'tourPrepareBriefing' })).toBeInTheDocument();
    expect(screen.getByText('tourPrepareAccess')).toBeInTheDocument();
    expect(screen.getByText('tourVisitorReplyOverdue')).toBeInTheDocument();
    expect(screen.getByText('confirmed')).toBeInTheDocument();
    client.clear();
  });
  it('requires a shared reason for a pending decline while leaving confirmed cancellation optional', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['/api/viewings/manager'], [record]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ events: [], complete: false, problems: [], reportingAvailable: false }) })));
    render(<QueryClientProvider client={client}><ViewingsDashboard /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    fireEvent.click(screen.getByRole('button', { name: 'declineRequest' }));
    const save = screen.getByRole('button', { name: 'cancelViewing' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('tourDeclineReason'), { target: { value: 'The kitchen is unavailable.' } });
    expect(save).toBeEnabled();
    expect(screen.getByText('tourDeclineReasonHelp')).toBeInTheDocument();
    client.clear();
  });
  it('combines visitor contact and compact coordination actions while retaining the notes destination', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['/api/viewings/manager'], [{ ...record, chefName: 'Ada Lovelace', chefEmail: 'ada@example.test', viewing: { ...record.viewing, adminReviewDecision: 'approved' } }]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ events: [], complete: false, problems: [], reportingAvailable: false }) })));
    const configure = vi.fn();
    render(<QueryClientProvider client={client}><ViewingsDashboard onConfigureNotes={configure} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    const card = within(screen.getByRole('region', { name: 'tourVisitorContactTitle' }));
    expect(card.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'ada@example.test' })).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Message Ada' })).toHaveClass('h-9');
    const notes = card.getByRole('button', { name: 'tourVisitNotesButton' });
    expect(notes.parentElement).toHaveClass('grid-cols-2');
    expect(notes).toHaveAttribute('title', 'tourEditVisitNotes');
    expect(card.getByText('tourCoordinationHelp')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'tourHistoryTitle' }).closest('aside')).not.toBeNull();
    expect(screen.getByTestId('manager-tour-help').closest('aside')).toBeNull();
    fireEvent.click(notes);
    expect(configure).toHaveBeenCalledWith(40, 33);
    expect(screen.queryByRole('heading', { name: 'navMessages' })).not.toBeInTheDocument();
    client.clear();
  });
  it('groups all shared chef details and omits attendance instructions while confirmation is pending', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const full = { ...record, chefEmail: 'sam@example.test', chefPhone: '+17095550123', viewing: { ...record.viewing,
      chefNotes: 'I would like to see the ovens.\nI prepare weekly meals.', intakeData: { intendedUse: 'meal_prep', estimatedWeeklyHours: '10-20', hasLicense: false, targetStartDate: '2026-11-01', additionalInfo: 'Need refrigerated storage' } } };
    client.setQueryData(['/api/viewings/manager'], [full]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ problems: [], reportingAvailable: false }) })));
    render(<QueryClientProvider client={client}><ViewingsDashboard /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    const chef = screen.getByRole('region', { name: 'tourVisitorContactTitle' });
    expect(chef).toHaveTextContent('Fixture chef');
    expect(chef).toHaveTextContent('sam@example.test');
    expect(chef).toHaveTextContent('+17095550123');
    const request = screen.getByRole('region', { name: 'tourChefRequestDetails' });
    expect(request).toHaveTextContent('Meal preparation');
    expect(request).toHaveTextContent('10-20');
    expect(request).toHaveTextContent('No');
    expect(request).toHaveTextContent('Need refrigerated storage');
    expect(screen.getByRole('region', { name: 'tourNextStep' })).toHaveTextContent('Review this tour request and confirm or decline the requested time.');
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
    const top = within(screen.getByRole('region', { name: 'tourNextStep' }));
    expect(top.getByRole('button', { name: 'confirmViewing' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'confirmViewing' })).toHaveLength(1);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Meet me at reception' } });
    fireEvent.click(screen.getByRole('button', { name: 'tourVisitNotesButton' }));
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
  it('keeps final outcome correction with Local Cooks and hides manager attendance controls', () => {
    const { client } = mountPast('no_show', [{ from: 'confirmed', to: 'no_show' }]);
    expect(screen.queryByRole('button', { name: 'markCompleted' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'markNoShow' })).not.toBeInTheDocument();
    expect(screen.queryByText('ADMIN ONLY LEGACY')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'tourFeedbackTitle' })).toBeInTheDocument();
    client.clear();
  });
  it('does not infer confirmation evidence from a legacy terminal label', () => {
    const { client } = mountPast('no_show');
    expect(screen.queryByRole('button', { name: 'markCompleted' })).not.toBeInTheDocument();
    client.clear();
  });
});


describe('manager grouped tour actions and email reviews', () => {
  function mountActions(tour = record, action?: string, available = true, slots?: string[]) {
    if (action) window.history.replaceState({}, '', '/?action=' + action);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryDefaults(['/api/viewings/manager'], { queryFn: async () => [tour] });
    client.setQueryData(['/api/viewings/manager'], [tour]);
    const fetcher = vi.fn(async (url: any, options?: any) => ({ ok: true, json: async () => {
      if (String(url) === '/api/viewings/manager') return available ? [tour] : [];
      if (String(url).includes('calendar-availability')) return { settings: {}, availability: [], blackouts: [], fullyBookedDates: [] };
      if (String(url).includes('available-slots') && slots) return slots.map(scheduledAt => ({ scheduledAt }));
      if (String(url).includes('available-slots')) return [1, 2, 3, 4].map(hour => ({ scheduledAt: `${String(url).includes('2099-11-02') ? '2099-11-02' : '2099-11-01'}T${String(hour + 13).padStart(2, '0')}:00:00.000Z` }));
      if (options?.method === 'POST') return { ...tour.viewing, rescheduleProposedSlots: JSON.parse(options.body).proposedSlots };
      if (String(url).includes('decision-context')) return { updatedAt: version, scheduledAt: tour.viewing.scheduledAt, overlapReviewKey: 'key', overlaps: [] };
      return { problems: [], reportingAvailable: false };
    } }));
    vi.stubGlobal('fetch', fetcher);
    render(<QueryClientProvider client={client}><ViewingsDashboard tourId={action ? '10' : undefined} /></QueryClientProvider>);
    if (!action) fireEvent.click(screen.getByRole('button', { name: 'Open tour' }));
    return { client, fetcher };
  }
  it('groups pending decisions in order and queries availability only after opening the modal', async () => {
    const { client, fetcher } = mountActions();
    const actions = within(screen.getByRole('region', { name: 'tourNextStep' }));
    expect(actions.getAllByRole('button').map(button => button.textContent)).toEqual(['acceptViewing', 'tourOfferAlternativeTimes', 'declineRequest']);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('calendar-availability'))).toBe(false);
    const trigger = actions.getByRole('button', { name: 'tourOfferAlternativeTimes' });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'tourOfferAlternativeTimes' });
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes('calendar-availability'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    client.clear();
  });
  it('selects time buttons directly across days, limits to three and sends those exact instants', async () => {
    const { client, fetcher } = mountActions();
    fireEvent.click(screen.getByRole('button', { name: 'tourOfferAlternativeTimes' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'tourOfferAlternativeTimes' }));
    expect(dialog.queryByRole('combobox')).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'tourAddAlternative' })).not.toBeInTheDocument();
    fireEvent.change(dialog.getByLabelText('tourNewDate'), { target: { value: '2099-11-01' } });
    const available = within(await dialog.findByRole('region', { name: 'tourAvailableTime' }));
    await waitFor(() => expect(available.getAllByRole('button')).toHaveLength(4));
    let times = available.getAllByRole('button');
    expect(times[0]).toHaveTextContent('10:30 AM – 11:00 AM');
    expect(times[0]).not.toHaveTextContent('NST');
    fireEvent.click(times[0]);
    expect(times[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(times[1]);
    fireEvent.click(times[2]);
    expect(times[3]).toBeDisabled();
    expect(times[0]).toBeEnabled();
    fireEvent.click(times[1]);
    expect(times[1]).toHaveAttribute('aria-pressed', 'false');
    expect(times[3]).toBeEnabled();
    fireEvent.change(dialog.getByLabelText('tourNewDate'), { target: { value: '2099-11-02' } });
    await waitFor(() => expect(available.getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'false'));
    times = available.getAllByRole('button');
    fireEvent.click(times[0]);
    const summary = within(dialog.getByRole('region', { name: 'tourSelectedTimes' }));
    expect(summary.getAllByRole('listitem')).toHaveLength(3);
    expect(summary.getAllByRole('listitem')[0]).toHaveTextContent('Nov 1');
    expect(summary.getAllByRole('listitem')[2]).toHaveTextContent('Nov 2');
    fireEvent.click(dialog.getByRole('button', { name: 'tourSendProposal' }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true));
    const write = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(JSON.parse(write[1].body).proposedSlots).toEqual(['2099-11-01T14:00:00.000Z', '2099-11-01T16:00:00.000Z', '2099-11-02T14:00:00.000Z']);
    client.clear();
  });
  it('keeps distinct timezone labels for repeated clocks when daylight saving ends', async () => {
    const { client } = mountActions(record, undefined, true, ['2099-11-01T03:30:00.000Z', '2099-11-01T04:30:00.000Z']);
    fireEvent.click(screen.getByRole('button', { name: 'tourOfferAlternativeTimes' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'tourOfferAlternativeTimes' }));
    fireEvent.change(dialog.getByLabelText('tourNewDate'), { target: { value: '2099-11-01' } });
    const available = within(await dialog.findByRole('region', { name: 'tourAvailableTime' }));
    await waitFor(() => expect(available.getAllByRole('button')).toHaveLength(2));
    const labels = available.getAllByRole('button').map(button => button.textContent);
    expect(labels[0]).not.toEqual(labels[1]);
    expect(labels[0]).toContain('1:00 AM – 1:30 AM');
    expect(labels[1]).toContain('1:00 AM – 1:30 AM');
    client.clear();
  });
  it('groups withdrawal with decisions while the original confirmation is blocked', () => {
    const tour = { ...record, viewing: { ...record.viewing, rescheduleProposedSlots: [new Date(Date.now() + 172800000).toISOString()] } };
    const { client } = mountActions(tour);
    const actions = within(screen.getByRole('region', { name: 'tourNextStep' }));
    expect(actions.getByRole('button', { name: 'acceptViewing' })).toBeDisabled();
    expect(actions.getByRole('button', { name: 'tourWithdrawProposal' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'tourOfferAlternativeTimes' })).not.toBeInTheDocument();
    client.clear();
  });
  it('groups confirmed rescheduling with cancellation without a second rescheduling section', () => {
    const tour = { ...record, viewing: { ...record.viewing, status: 'confirmed' } };
    const { client } = mountActions(tour);
    const actions = within(screen.getByRole('region', { name: 'tourNextStep' }));
    expect(actions.getByRole('button', { name: 'tourProposeNewTimes' })).toBeInTheDocument();
    expect(actions.getByRole('button', { name: 'cancelViewing' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'tourProposeNewTimes' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'cancelViewing' })).toHaveLength(1);
    client.clear();
  });
  it.each(['pending', 'confirmed'])('opens an eligible %s reschedule link without a mutation or reopening after close', async status => {
    const tour = { ...record, viewing: { ...record.viewing, status } };
    const { client, fetcher } = mountActions(tour, 'reschedule');
    await screen.findByRole('dialog', { name: status === 'pending' ? 'tourOfferAlternativeTimes' : 'tourProposeNewTimes' });
    expect(fetcher.mock.calls.some(([, options]) => options?.method && options.method !== 'GET')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await client.invalidateQueries({ queryKey: ['/api/viewings/manager', 'exact-tour'] });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    client.clear();
  });
  it('opens the confirm decision review without saving', async () => {
    const { client, fetcher } = mountActions(record, 'confirm');
    await screen.findByText('tourNoOverlappingBookings');
    expect(screen.getByRole('button', { name: 'confirmViewing' })).toBeInTheDocument();
    expect(fetcher.mock.calls.some(([, options]) => options?.method && options.method !== 'GET')).toBe(false);
    client.clear();
  });
  it('rejects an unavailable exact tour action link', async () => {
    const { client, fetcher } = mountActions(record, 'reschedule', false);
    await screen.findByText('This tour is unavailable. Check your location access or try again.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url, options]) => String(url).includes('calendar-availability') || (options?.method && options.method !== 'GET') && options.method !== 'GET')).toBe(false);
    client.clear();
  });
  it('ignores expired action links', async () => {
    const expired = { ...record, viewing: { ...record.viewing, scheduledAt: new Date(Date.now() - 1000).toISOString() } };
    const { client, fetcher } = mountActions(expired, 'reschedule');
    await screen.findByRole('button', { name: 'tourCloseExpiredRequest' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('calendar-availability'))).toBe(false);
    client.clear();
  });
  it.each(['confirm', 'reschedule'])('ignores the %s action while suggested times are awaiting the chef', async action => {
    const tour = { ...record, viewing: { ...record.viewing, rescheduleProposedSlots: [new Date(Date.now() + 172800000).toISOString()] } };
    const { client, fetcher } = mountActions(tour, action);
    await screen.findByRole('button', { name: 'tourWithdrawProposal' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'confirmViewing' })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url, options]) => String(url).includes('calendar-availability') || (options?.method && options.method !== 'GET'))).toBe(false);
    client.clear();
  });
  it('opens a confirmed cancellation review from its link without cancelling', async () => {
    const tour = { ...record, viewing: { ...record.viewing, status: 'confirmed' } };
    const { client, fetcher } = mountActions(tour, 'cancel');
    await screen.findByPlaceholderText('reasonForCancellation');
    expect(screen.getByRole('button', { name: 'cancelViewing' })).toBeInTheDocument();
    expect(fetcher.mock.calls.some(([, options]) => options?.method && options.method !== 'GET')).toBe(false);
    client.clear();
  });
  it('groups the chef requested time review and focuses it from its email link', async () => {
    const tour = { ...record, viewing: { ...record.viewing, status: 'confirmed', requestedRescheduleAt: new Date(Date.now() + 172800000).toISOString() } };
    const { client, fetcher } = mountActions(tour, 'review-reschedule');
    const actions = within(await screen.findByRole('region', { name: 'tourNextStep' }));
    await actions.findByText('tourNoOverlappingBookings');
    expect(actions.getByRole('button', { name: 'tourKeepOriginalTime' })).toBeInTheDocument();
    expect(actions.getByRole('button', { name: 'tourApproveNewTime' })).toBeInTheDocument();
    expect(screen.getByText('tourRescheduleRequest').parentElement).toHaveFocus();
    expect(fetcher.mock.calls.some(([, options]) => options?.method && options.method !== 'GET')).toBe(false);
    client.clear();
  });
});
