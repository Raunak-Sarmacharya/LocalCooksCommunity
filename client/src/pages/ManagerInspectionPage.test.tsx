import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import ManagerInspectionPage, { type ManagerInspectionDetails } from './ManagerInspectionPage';

const state = vi.hoisted(() => ({ role: 'manager' }));
vi.mock('@/hooks/use-auth', () => ({ useFirebaseAuth: () => ({ user: { role: state.role }, loading: false }) }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'mock-token' } } }));
vi.mock('@/layouts/ManagerBookingLayout', () => ({ default: ({ children }: any) => <section aria-label="Manager shell">{children}</section> }));
vi.mock('react-i18next', async () => ({ useTranslation: (await import('@/test/booking-i18n')).useBookingTranslation }));

const section = { enabled: true, instructions: 'Reset the kitchen.', items: [], photos: [] };
function details(): ManagerInspectionDetails {
  return { id: 901, referenceCode: 'MOCK-INSPECTION', updatedAt: '2026-10-12T19:07:23Z', status: 'confirmed',
    bookingDate: '2026-10-12', startTime: '23:00', endTime: '01:00', operatingWindowStartTime: '18:00',
    checkinStatus: 'checkout_requested', checkedInAt: '2026-10-12T19:05:13Z', checkedInMethod: 'self',
    checkoutRequestedAt: '2026-10-12T19:07:23Z', checkinPhotoUrls: [], checkoutPhotoUrls: [],
    checkinChecklistItems: [], checkoutChecklistItems: [], checkinNotes: 'Arrival message', checkoutNotes: 'Departure message',
    visits: [], kitchen: { name: 'Mock kitchen' }, location: { id: 990, name: 'Mock location', timezone: 'America/St_Johns' },
    chef: { username: 'Mock visitor' }, inspection: { dutiesSaved: true,
      checkoutReviewDeadline: '2026-10-13T03:37:23Z', duties: { version: 1, capturedAt: '2026-10-12T10:00:00Z',
        source: 'confirmation', arrival: section, departure: section, checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 90 } } };
}
let booking: ManagerInspectionDetails;
let fetcher: ReturnType<typeof vi.fn>;
let claims: any[] = [];
let postError: string;
let readError: boolean;
let afterPostReadError: boolean;
let onRead: (() => void) | undefined;
let client: QueryClient;
let clients: QueryClient[];
const posts = () => fetcher.mock.calls.filter(([, options]) => options?.method === 'POST');
function mount(path = '/manager/booking/901/inspection') {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  const navigation = memoryLocation({ path, record: true });
  render(<QueryClientProvider client={client}><Router hook={navigation.hook}><Switch>
    <Route path="/manager/booking/:id/inspection" component={ManagerInspectionPage} />
    <Route path="/manager/booking/:id"><h1>Booking details destination</h1></Route>
  </Switch></Router></QueryClientProvider>);
  return navigation;
}
async function confirmClear(button: HTMLElement) { fireEvent.click(button); fireEvent.click(screen.getByRole('button', { name: 'Finish inspection', exact: true })); }
// The page refetches when the window regains focus; there is no Refresh button.
function refreshByFocus() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
}
async function clearButton() { return screen.findByRole('button', { name: 'Finish inspection — all looks good' }); }

describe('manager inspection with isolated API mocks', () => {
  beforeEach(() => {
    booking = details(); claims = []; clients = []; state.role = 'manager'; postError = ''; readError = false; afterPostReadError = false; onRead = undefined;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('filing-context')) return new Response(JSON.stringify({ allowed: true, deadline: '2026-10-15T19:07:23Z', endedAt: '2026-10-12T19:07:23Z', timezone: 'America/St_Johns', kitchenName: 'Mock kitchen', before: [], after: [] }));
      if (url.includes('damage-claims') && options?.method !== 'POST') return new Response(JSON.stringify({ claims }));
      if (url.includes('commitment-problems')) return new Response(JSON.stringify({ problems: [], reportingAvailable: true }));
      if (options?.method === 'POST') {
        if (postError) return new Response(JSON.stringify({ error: postError }), { status: 400 });
        const body = JSON.parse(options.body as string);
        if (url.endsWith('assist-visit')) {
          const target = booking.visits.find(visit => visit.id === body.visitId) || booking;
          target.checkinStatus = 'checkout_requested'; target.checkoutRequestedAt = '2026-10-12T20:00:00Z';
        } else {
          const target = booking.visits.find(visit => visit.id === body.visitId) || booking;
          target.checkinStatus = 'checked_out'; target.checkoutManagerMessage = body.sharedManagerMessage;
          if (!booking.visits.length) booking.status = 'completed';
        }
        readError = afterPostReadError;
        return new Response(JSON.stringify({ success: true }));
      }
      onRead?.();
      return new Response(JSON.stringify(readError ? { error: 'Inspection read unavailable' } : booking), { status: readError ? 503 : 200 });
    });
    vi.stubGlobal('fetch', fetcher);
  });
  afterEach(() => { cleanup(); clients.forEach(value => value.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('uses manager shell, full-page context, saved local deadline and overnight calendar dates', async () => {
    mount(); await clearButton();
    expect(screen.getByRole('region', { name: 'Manager shell' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Visit inspection' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Mock visitor')).toBeInTheDocument();
    expect(screen.getByText(/Kitchen session · Mock kitchen/)).toBeInTheDocument();
    expect(screen.getAllByText(/Newfoundland Time/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/America\/St_Johns/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check-in code' })).not.toBeInTheDocument();
    expect(screen.getByTestId('inspection-sentence')).toHaveTextContent('Mock visitor checked out at 4:37 p.m. Inspect by Oct 13, 1:07');
    expect(document.body.textContent).not.toMatch(/2026/);
    expect(within(screen.getByRole('region', { name: 'About this visit' })).getByText(/Mon, Oct 12 · 11:00\s*p\.m\.\s*[–-]\s*Tue, Oct 13 · 1:00\s*a\.m\./)).toBeInTheDocument();
    expect(screen.getByText('Arrival message')).toBeInTheDocument(); expect(screen.getByText('Departure message')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get help from Local Cooks' })).toHaveAttribute('href', '/manager/dashboard?view=support');
  });

  it.each(['chef', 'admin'])('does not request manager data or grant inspection controls to %s', async role => {
    state.role = role; mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in as the kitchen manager');
    expect(fetcher).not.toHaveBeenCalled(); expect(posts()).toHaveLength(0);
  });

  it('preserves the next calendar day for a legacy after-midnight visit without a window snapshot', async () => {
    booking.operatingWindowStartTime = null;
    booking.visits = [{ ...booking, id: 1002, blockIndex: 1, startTime: '00:00', endTime: '01:00', checkoutReviewDeadline: booking.inspection!.checkoutReviewDeadline }];
    mount('/manager/booking/901/inspection?visitId=1002'); await clearButton();
    expect(within(screen.getByRole('region', { name: 'About this visit' })).getByText(/Tue, Oct 13 · 12:00[–-]1:00\s*a\.m\./)).toBeInTheDocument();
  });

  it('requires a chosen multi-block visit and posts only that visit and supported shared message', async () => {
    booking.visits = [0, 1].map(index => ({ ...booking, id: 1001 + index, blockIndex: index,
      startTime: index ? '00:00' : '19:00', endTime: index ? '01:00' : '20:00',
      checkoutReviewDeadline: index ? '2026-10-13T06:00:00Z' : '2026-10-12T23:00:00Z' }));
    mount(); expect(await screen.findByText(/Choose a visit to see/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish inspection — all looks good' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Choose a visit to inspect'), { target: { value: '1002' } });
    expect(screen.getByTestId('inspection-sentence')).toHaveTextContent('Inspect by Oct 13, 3:30');
    fireEvent.change(screen.getByLabelText(/Note to Mock visitor/), { target: { value: 'Kitchen inspected and reset.' } });
    await confirmClear(await clearButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ visitId: 1002, sharedManagerMessage: 'Kitchen inspected and reset.' });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(booking.visits[0].checkinStatus).toBe('checkout_requested');
    await screen.findByText('Inspection finished');
  });

  it('cancelling the in-app inspection confirmation keeps the note and sends no POST', async () => {
    mount(); const button = await clearButton();
    fireEvent.change(screen.getByLabelText(/Note to Mock visitor/), { target: { value: 'Keep this note' } });
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Finish this inspection?' })).toHaveTextContent('Mock visitor will be notified');
    fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true }));
    expect(posts()).toHaveLength(0); expect(screen.getByLabelText(/Note to Mock visitor/)).toHaveValue('Keep this note');
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('shows request errors, keeps the note after refresh, and refreshes the actual result on retry', async () => {
    postError = 'Booking changed; refresh before reviewing checkout'; mount();
    const button = await clearButton(); fireEvent.change(screen.getByLabelText(/Note to Mock visitor/), { target: { value: 'Retained inspection note' } }); await confirmClear(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(postError);
    expect(screen.getByLabelText(/Note to Mock visitor/)).toHaveValue('Retained inspection note');
    postError = ''; fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true })); refreshByFocus();
    await waitFor(() => expect(button).toBeEnabled()); await confirmClear(button);
    await screen.findByText('Inspection finished');
    expect(screen.getByText('Retained inspection note')).toBeInTheDocument();
    expect(screen.getByText(/You finished this inspection/)).toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/details')).length).toBeGreaterThanOrEqual(5);
  });

  it('revalidates stale state before POST while preserving the note', async () => {
    mount(); const button = await clearButton();
    fireEvent.change(screen.getByLabelText(/Note to Mock visitor/), { target: { value: 'Draft before cancellation' } });
    onRead = () => { booking.status = 'cancelled'; };
    await confirmClear(button); expect(await screen.findByRole('alert')).toHaveTextContent('This visit changed');
    expect(posts()).toHaveLength(0); expect(screen.getByLabelText(/Note to Mock visitor/)).toHaveValue('Draft before cancellation');
    expect(button).toBeDisabled();
  });

  it('blocks a changed evidence revision even while inspection is still pending', async () => {
    mount(); const button = await clearButton();
    fireEvent.change(screen.getByLabelText(/Note to Mock visitor/), { target: { value: 'Review this revision' } });
    onRead = () => { booking.updatedAt = '2026-10-12T20:00:00Z'; booking.checkoutNotes = 'New departure evidence'; };
    await confirmClear(button); expect(await screen.findByRole('alert')).toHaveTextContent('This visit changed');
    expect(posts()).toHaveLength(0); expect(screen.getByText('New departure evidence')).toBeInTheDocument();
    expect(screen.getByLabelText(/Note to Mock visitor/)).toHaveValue('Review this revision');
  });

  it.each(['deadline', 'requirements', 'zone'])('rechecks %s context before POST even with unchanged revisions', async missing => {
    mount(); const button = await clearButton();
    fireEvent.change(screen.getByLabelText(/Note to Mock visitor/), { target: { value: 'Keep this review draft' } });
    onRead = () => {
      if (missing === 'deadline') booking.inspection!.checkoutReviewDeadline = null;
      if (missing === 'requirements') delete booking.inspection;
      if (missing === 'zone') booking.location.timezone = null;
    };
    await confirmClear(button);
    await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('The inspection details changed'))).toBe(true));
    expect(posts()).toHaveLength(0);
    expect(screen.getByLabelText(/Note to Mock visitor/)).toHaveValue('Keep this review draft');
    expect(button).toBeDisabled();
  });

  it('rechecks the selected visit revision independently of the parent revision', async () => {
    booking.visits = [{ ...booking, id: 1002, blockIndex: 1, checkoutReviewDeadline: booking.inspection!.checkoutReviewDeadline }];
    mount('/manager/booking/901/inspection?visitId=1002'); const button = await clearButton();
    fireEvent.change(screen.getByLabelText(/Note to Mock visitor/), { target: { value: 'Selected visit draft' } });
    onRead = () => { booking.visits[0].updatedAt = '2026-10-12T20:00:00Z'; booking.visits[0].checkoutNotes = 'Updated selected departure'; };
    await confirmClear(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('This visit changed');
    expect(posts()).toHaveLength(0);
    expect(screen.getByText('Updated selected departure')).toBeInTheDocument();
    expect(screen.getByLabelText(/Note to Mock visitor/)).toHaveValue('Selected visit draft');
  });

  it('keeps notes separate across URL-selected visits and missing-visit refresh', async () => {
    booking.visits = [0, 1].map(index => ({ ...booking, id: 1001 + index, blockIndex: index, checkoutReviewDeadline: booking.inspection!.checkoutReviewDeadline }));
    mount('/manager/booking/901/inspection?visitId=1001'); await clearButton();
    fireEvent.change(screen.getByLabelText(/Note to Mock visitor/), { target: { value: 'First visit note' } });
    fireEvent.change(screen.getByLabelText('Choose a visit to inspect'), { target: { value: '1002' } });
    expect(screen.getByLabelText(/Note to Mock visitor/)).toHaveValue('');
    fireEvent.change(screen.getByLabelText(/Note to Mock visitor/), { target: { value: 'Second visit note' } });
    const second = booking.visits.pop()!;
    refreshByFocus();
    await screen.findByText(/visit is no longer available/);
    booking.visits.push(second); refreshByFocus();
    await waitFor(() => expect(screen.getByLabelText(/Note to Mock visitor/)).toHaveValue('Second visit note'));
    fireEvent.change(screen.getByLabelText('Choose a visit to inspect'), { target: { value: '1001' } });
    expect(screen.getByLabelText(/Note to Mock visitor/)).toHaveValue('First visit note'); expect(posts()).toHaveLength(0);
  });

  it('has no Refresh button, status line, draft helper or duplicated date range while the inspection is open', async () => {
    mount(); await clearButton();
    expect(screen.queryByRole('button', { name: 'Refresh inspection' })).not.toBeInTheDocument();
    expect(screen.queryByText('Booking confirmed')).not.toBeInTheDocument();
    expect(screen.queryByText(/use Refresh inspection/)).not.toBeInTheDocument();
    expect(screen.queryByText(/saved when this visit was booked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/photos? requested/)).not.toBeInTheDocument();
    expect(screen.getAllByText('No photos were required').length).toBeGreaterThan(0);
    expect(screen.getByText(/Checked out:/)).toBeInTheDocument();
    expect(screen.queryByText(/Checkout review requested/)).not.toBeInTheDocument();
  });

  it('shows a done state, not the live form, once the inspection is finished', async () => {
    booking.checkinStatus = 'checked_out'; booking.checkoutApprovedAt = '2026-10-12T19:29:00Z';
    mount();
    const done = await screen.findByTestId('inspection-done');
    expect(done).toHaveTextContent(/You finished this inspection on Oct 12 at 4:59\s*p\.m\. Mock visitor was notified\./);
    expect(within(done).getByRole('link', { name: 'Back to booking' })).toHaveAttribute('href', '/manager/booking/901');
    for (const gone of ['Finish inspection — all looks good', 'Report a cleaning or damage concern']) {
      expect(screen.queryByRole('button', { name: gone })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/Note to Mock visitor/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Inspect by/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Found a problem later/ })).not.toBeInTheDocument();
  });

  it('keeps reporting open for 72 hours after departure, independent of the shorter inspection window', async () => {
    const closeout = (deadline: string) => ({ phase: 'ended', timezone: 'America/St_Johns', serviceEndedAt: '2026-10-12T19:00:00Z', status: 'confirmed', serverNow: '2026-10-12T20:00:00Z', nextDueAt: null,
      visits: [{ key: 'v', phase: 'ended', arrivalRecorded: true, scheduledStartAt: '2026-10-12T18:00:00Z', scheduledEndAt: '2026-10-12T19:00:00Z',
        inspection: { outcome: 'manager_cleared', dueAt: '2026-10-12T19:00:00Z', deadline, closedAt: '2026-10-12T19:29:00Z', canRespond: false } }] }) as any;
    booking.checkinStatus = 'checked_out'; booking.checkoutApprovedAt = '2026-10-12T19:29:00Z';
    booking.closeout = closeout('2999-01-01T00:00:00Z');
    mount();
    expect(await screen.findByRole('button', { name: 'Found a problem later? Ask Local Cooks to review' })).toBeInTheDocument();
    cleanup(); clients.forEach(value => value.clear());
    booking.closeout = closeout('2020-01-01T00:00:00Z');
    booking.checkoutRequestedAt = '2020-01-01T00:00:00Z';
    mount();
    await screen.findByTestId('inspection-done');
    expect(screen.queryByRole('button', { name: /Found a problem later/ })).not.toBeInTheDocument();
  });

  it('reports an incomplete booking identity contract without exposing actions', async () => {
    booking.id = 999; mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Some visit details are missing');
    expect(screen.queryByRole('button', { name: 'Finish inspection — all looks good' })).not.toBeInTheDocument();
  });

  it('keeps a saved clear locked when the subsequent read fails, retaining the note for recovery', async () => {
    afterPostReadError = true; mount(); const button = await clearButton();
    fireEvent.change(screen.getByLabelText(/Note to Mock visitor/), { target: { value: 'Saved but unread note' } }); await confirmClear(button);
    await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('Your inspection is saved'))).toBe(true));
    // The server accepted it, so the page shows the done state (never the live form) and cannot send it twice.
    expect(screen.getByTestId('inspection-done')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish inspection — all looks good' })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(1);
    readError = false; refreshByFocus();
    await screen.findByText('Inspection finished'); expect(posts()).toHaveLength(1);
  });

  it.each(['zone', 'deadline', 'requirements'])('blocks clear when %s context is missing', async missing => {
    if (missing === 'zone') booking.location.timezone = null;
    if (missing === 'deadline') booking.inspection!.checkoutReviewDeadline = null;
    if (missing === 'requirements') delete booking.inspection;
    mount(); expect(await clearButton()).toBeDisabled(); expect(posts()).toHaveLength(0);
  });

  it('does not fall back to booking-level clearance for an unknown selected visit', async () => {
    mount('/manager/booking/901/inspection?visitId=999');
    expect(await screen.findByText(/visit is no longer available/)).toBeInTheDocument(); expect(posts()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Finish inspection — all looks good' })).not.toBeInTheDocument();
  });

  it('distinguishes missing evidence, submitted empty evidence and required/optional saved photo duties', async () => {
    booking.checkinPhotoUrls = null;
    booking.inspection!.duties = { ...booking.inspection!.duties,
      arrival: { ...section, photos: [{ id: 'before', label: 'Before counter', required: true }, { id: 'extra', label: 'Supplies', required: false }] },
      departure: { ...section, items: [{ id: 'clean', label: 'Clean surfaces', required: true }] } };
    mount(); await clearButton();
    const arrival = screen.getByRole('region', { name: 'Arrival' });
    expect(within(arrival).getByText('Photos couldn’t be loaded.')).toBeInTheDocument();
    expect(within(arrival).getByText('Before counter · Required')).toBeInTheDocument();
    expect(within(arrival).getByText('Supplies · Optional')).toBeInTheDocument();
    const departure = screen.getByRole('region', { name: 'Departure' });
    expect(within(departure).getByText(/No photos were added/)).toBeInTheDocument();
    expect(within(departure).getByText('Clean surfaces · Required · No answer yet')).toBeInTheDocument();
  });

  it('opens the itemized claim sheet without filing until its final review step', async () => {
    mount(); await clearButton(); fireEvent.click(screen.getByRole('button', { name: 'Report damage or extra cleaning' }));
    expect(await screen.findByLabelText('What happened?')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Report damage or extra cleaning' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('reuses assistance with the chosen visit and retains its reason on API failure', async () => {
    booking.visits = [{ ...booking, id: 1002, blockIndex: 1, checkinStatus: 'checked_in' }];
    postError = 'This visit changed; refresh before assisting'; mount('/manager/booking/901/inspection?visitId=1002'); await clearButton();
    fireEvent.click(screen.getByRole('button', { name: 'Add a missed check-in or checkout' }));
    fireEvent.change(screen.getByLabelText(/Departure time/), { target: { value: '2026-10-12T17:00' } });
    fireEvent.change(within(screen.getByRole('region', { name: 'Add an arrival or departure' })).getByLabelText('Note to Mock visitor'), { target: { value: 'Visitor confirmed departure by phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save departure time' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(postError);
    expect(within(screen.getByRole('region', { name: 'Add an arrival or departure' })).getByLabelText('Note to Mock visitor')).toHaveValue('Visitor confirmed departure by phone');
    expect(posts()[0][0]).toBe('/api/manager/bookings/901/assist-visit');
    expect(JSON.parse(posts()[0][1].body)).toMatchObject({ visitId: 1002, action: 'departure', expectedUpdatedAt: booking.updatedAt });
  });

  it('lists each damage claim as one line that links to the booking page, not as a full claim card', async () => {
    claims = [{ id: 7, status: 'in_review', claimedAmountCents: 4500, amountCents: 4500, lines: [], history: [], evidence: [] }];
    mount(); await clearButton();
    const line = (await screen.findByText(/Damage claim · \$45\.00 · Local Cooks review/)).closest('li') as HTMLElement;
    expect(within(line).getByRole('link', { name: 'See the claim on the booking page' })).toHaveAttribute('href', '/manager/booking/901');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('keeps the inspection explainer behind a How this works toggle', async () => {
    mount(); await clearButton();
    const summary = screen.getByText('How this works');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(summary.closest('details')).toHaveTextContent(/Compare arrival and departure photos/);
  });

  it('returns to the booking through the explicit back context', async () => {
    mount(); await clearButton(); fireEvent.click(screen.getByRole('link', { name: 'Back to booking' }));
    expect(await screen.findByRole('heading', { name: 'Booking details destination' })).toBeInTheDocument(); expect(posts()).toHaveLength(0);
  });
});
