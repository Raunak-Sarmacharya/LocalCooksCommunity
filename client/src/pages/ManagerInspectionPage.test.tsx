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
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

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
async function clearButton() { return screen.findByRole('button', { name: 'Clear — No issues' }); }

describe('manager inspection with isolated API mocks', () => {
  beforeEach(() => {
    booking = details(); clients = []; state.role = 'manager'; postError = ''; readError = false; afterPostReadError = false; onRead = undefined;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fetcher = vi.fn(async (url: string, options?: RequestInit) => {
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
    expect(screen.getByText('Mock kitchen')).toBeInTheDocument();
    expect(screen.getByText(/Kitchen timezone: America\/St_Johns/)).toBeInTheDocument();
    expect(screen.getByText(/Response deadline:/)).toHaveTextContent('Oct 13, 2026, 1:07');
    expect(within(screen.getByRole('region', { name: 'Booking and visit context' })).getByText(/Oct 12, 2026, 11:00.*Oct 13, 2026, 1:00/)).toBeInTheDocument();
    expect(screen.getByText('Arrival message')).toBeInTheDocument(); expect(screen.getByText('Departure message')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get help from Local Cooks' })).toHaveAttribute('href', '/manager/dashboard?view=support');
  });

  it.each(['chef', 'admin'])('does not request manager data or grant inspection controls to %s', async role => {
    state.role = role; mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Manager access required');
    expect(fetcher).not.toHaveBeenCalled(); expect(posts()).toHaveLength(0);
  });

  it('preserves the next calendar day for a legacy after-midnight visit without a window snapshot', async () => {
    booking.operatingWindowStartTime = null;
    booking.visits = [{ ...booking, id: 1002, blockIndex: 1, startTime: '00:00', endTime: '01:00', checkoutReviewDeadline: booking.inspection!.checkoutReviewDeadline }];
    mount('/manager/booking/901/inspection?visitId=1002'); await clearButton();
    expect(within(screen.getByRole('region', { name: 'Booking and visit context' })).getByText(/Oct 13, 2026, 12:00.*Oct 13, 2026, 1:00/)).toBeInTheDocument();
  });

  it('requires a chosen multi-block visit and posts only that visit and supported shared message', async () => {
    booking.visits = [0, 1].map(index => ({ ...booking, id: 1001 + index, blockIndex: index,
      startTime: index ? '00:00' : '19:00', endTime: index ? '01:00' : '20:00',
      checkoutReviewDeadline: index ? '2026-10-13T06:00:00Z' : '2026-10-12T23:00:00Z' }));
    mount(); expect(await screen.findByText(/Choose a visit to review/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear — No issues' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Visit to inspect'), { target: { value: '1002' } });
    expect(screen.getByText(/Response deadline:/)).toHaveTextContent('Oct 13, 2026, 3:30');
    fireEvent.change(screen.getByLabelText(/Message shared/), { target: { value: 'Kitchen inspected and reset.' } });
    fireEvent.click(await clearButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ visitId: 1002, sharedManagerMessage: 'Kitchen inspected and reset.' });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('visit 2'));
    expect(booking.visits[0].checkinStatus).toBe('checkout_requested');
    await screen.findByText('Visit record: Checkout closed');
  });

  it('cancelled clear confirmation means zero POST and no lost note', async () => {
    vi.mocked(window.confirm).mockReturnValue(false); mount();
    const button = await clearButton(); fireEvent.change(screen.getByLabelText(/Message shared/), { target: { value: 'Keep this note' } }); fireEvent.click(button);
    expect(posts()).toHaveLength(0); expect(screen.getByLabelText(/Message shared/)).toHaveValue('Keep this note');
  });

  it('shows request errors, keeps the note after refresh, and refreshes the actual result on retry', async () => {
    postError = 'Booking changed; refresh before reviewing checkout'; mount();
    const button = await clearButton(); fireEvent.change(screen.getByLabelText(/Message shared/), { target: { value: 'Retained inspection note' } }); fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(postError);
    expect(screen.getByLabelText(/Message shared/)).toHaveValue('Retained inspection note');
    postError = ''; fireEvent.click(screen.getByRole('button', { name: 'Refresh inspection' }));
    await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
    await screen.findByText('Visit record: Checkout closed');
    expect(screen.getByText('Retained inspection note')).toBeInTheDocument();
    expect(screen.getByText('Booking status: completed')).toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/details')).length).toBeGreaterThanOrEqual(5);
  });

  it('revalidates stale state before POST while preserving the note', async () => {
    mount(); const button = await clearButton();
    fireEvent.change(screen.getByLabelText(/Message shared/), { target: { value: 'Draft before cancellation' } });
    onRead = () => { booking.status = 'cancelled'; };
    fireEvent.click(button); expect(await screen.findByRole('alert')).toHaveTextContent('Visit changed');
    expect(posts()).toHaveLength(0); expect(screen.getByLabelText(/Message shared/)).toHaveValue('Draft before cancellation');
    expect(button).toBeDisabled();
  });

  it('blocks a changed evidence revision even while inspection is still pending', async () => {
    mount(); const button = await clearButton();
    fireEvent.change(screen.getByLabelText(/Message shared/), { target: { value: 'Review this revision' } });
    onRead = () => { booking.updatedAt = '2026-10-12T20:00:00Z'; booking.checkoutNotes = 'New departure evidence'; };
    fireEvent.click(button); expect(await screen.findByRole('alert')).toHaveTextContent('Visit changed');
    expect(posts()).toHaveLength(0); expect(screen.getByText('New departure evidence')).toBeInTheDocument();
    expect(screen.getByLabelText(/Message shared/)).toHaveValue('Review this revision');
  });

  it.each(['deadline', 'requirements', 'zone'])('rechecks %s context before POST even with unchanged revisions', async missing => {
    mount(); const button = await clearButton();
    fireEvent.change(screen.getByLabelText(/Message shared/), { target: { value: 'Keep this review draft' } });
    onRead = () => {
      if (missing === 'deadline') booking.inspection!.checkoutReviewDeadline = null;
      if (missing === 'requirements') delete booking.inspection;
      if (missing === 'zone') booking.location.timezone = null;
    };
    fireEvent.click(button);
    await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('Inspection context changed'))).toBe(true));
    expect(posts()).toHaveLength(0);
    expect(screen.getByLabelText(/Message shared/)).toHaveValue('Keep this review draft');
    expect(button).toBeDisabled();
  });

  it('rechecks the selected visit revision independently of the parent revision', async () => {
    booking.visits = [{ ...booking, id: 1002, blockIndex: 1, checkoutReviewDeadline: booking.inspection!.checkoutReviewDeadline }];
    mount('/manager/booking/901/inspection?visitId=1002'); const button = await clearButton();
    fireEvent.change(screen.getByLabelText(/Message shared/), { target: { value: 'Selected visit draft' } });
    onRead = () => { booking.visits[0].updatedAt = '2026-10-12T20:00:00Z'; booking.visits[0].checkoutNotes = 'Updated selected departure'; };
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Visit changed');
    expect(posts()).toHaveLength(0);
    expect(screen.getByText('Updated selected departure')).toBeInTheDocument();
    expect(screen.getByLabelText(/Message shared/)).toHaveValue('Selected visit draft');
  });

  it('keeps notes separate across URL-selected visits and missing-visit refresh', async () => {
    booking.visits = [0, 1].map(index => ({ ...booking, id: 1001 + index, blockIndex: index, checkoutReviewDeadline: booking.inspection!.checkoutReviewDeadline }));
    mount('/manager/booking/901/inspection?visitId=1001'); await clearButton();
    fireEvent.change(screen.getByLabelText(/Message shared/), { target: { value: 'First visit note' } });
    fireEvent.change(screen.getByLabelText('Visit to inspect'), { target: { value: '1002' } });
    expect(screen.getByLabelText(/Message shared/)).toHaveValue('');
    fireEvent.change(screen.getByLabelText(/Message shared/), { target: { value: 'Second visit note' } });
    const second = booking.visits.pop()!;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh inspection' }));
    await screen.findByText(/selected visit is no longer available/);
    booking.visits.push(second); fireEvent.click(screen.getByRole('button', { name: 'Refresh inspection' }));
    await waitFor(() => expect(screen.getByLabelText(/Message shared/)).toHaveValue('Second visit note'));
    fireEvent.change(screen.getByLabelText('Visit to inspect'), { target: { value: '1001' } });
    expect(screen.getByLabelText(/Message shared/)).toHaveValue('First visit note'); expect(posts()).toHaveLength(0);
  });

  it('reports an incomplete booking identity contract without exposing actions', async () => {
    booking.id = 999; mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Inspection context is incomplete');
    expect(screen.queryByRole('button', { name: 'Clear — No issues' })).not.toBeInTheDocument();
  });

  it('keeps a saved clear locked when the subsequent read fails, retaining the note for recovery', async () => {
    afterPostReadError = true; mount(); const button = await clearButton();
    fireEvent.change(screen.getByLabelText(/Message shared/), { target: { value: 'Saved but unread note' } }); fireEvent.click(button);
    await waitFor(() => expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('Clear was saved'))).toBe(true));
    expect(screen.getByLabelText(/Message shared/)).toHaveValue('Saved but unread note'); expect(button).toBeDisabled();
    fireEvent.click(button); expect(posts()).toHaveLength(1);
    readError = false; fireEvent.click(screen.getByRole('button', { name: 'Refresh inspection' }));
    await screen.findByText('Visit record: Checkout closed'); expect(posts()).toHaveLength(1);
  });

  it.each(['zone', 'deadline', 'requirements'])('blocks clear when %s context is missing', async missing => {
    if (missing === 'zone') booking.location.timezone = null;
    if (missing === 'deadline') booking.inspection!.checkoutReviewDeadline = null;
    if (missing === 'requirements') delete booking.inspection;
    mount(); expect(await clearButton()).toBeDisabled(); expect(posts()).toHaveLength(0);
  });

  it('does not fall back to booking-level clearance for an unknown selected visit', async () => {
    mount('/manager/booking/901/inspection?visitId=999');
    expect(await screen.findByText(/selected visit is no longer available/)).toBeInTheDocument(); expect(posts()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Clear — No issues' })).not.toBeInTheDocument();
  });

  it('distinguishes missing evidence, submitted empty evidence and required/optional saved photo duties', async () => {
    booking.checkinPhotoUrls = null;
    booking.inspection!.duties = { ...booking.inspection!.duties,
      arrival: { ...section, photos: [{ id: 'before', label: 'Before counter', required: true }, { id: 'extra', label: 'Supplies', required: false }] },
      departure: { ...section, items: [{ id: 'clean', label: 'Clean surfaces', required: true }] } };
    mount(); await clearButton();
    const arrival = screen.getByRole('region', { name: 'Arrival evidence' });
    expect(within(arrival).getByText('Photo evidence unavailable.')).toBeInTheDocument();
    expect(within(arrival).getByText('Before counter · Required')).toBeInTheDocument();
    expect(within(arrival).getByText('Supplies · Optional')).toBeInTheDocument();
    const departure = screen.getByRole('region', { name: 'Departure evidence' });
    expect(within(departure).getByText(/No photos submitted. Missing photos do not establish absence/)).toBeInTheDocument();
    expect(within(departure).getByText('Clean surfaces · Required · No answer recorded')).toBeInTheDocument();
  });

  it('keeps claim mutation blocked and exposes the existing booking support report', async () => {
    mount(); await clearButton(); fireEvent.click(screen.getByRole('button', { name: 'Damage or cleaning issue' }));
    expect(screen.getByText(/Claim creation is unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Damage or cleaning issue' })).toHaveFocus();
    expect(await screen.findByRole('button', { name: 'Report a problem' })).toBeInTheDocument();
    expect(posts()).toHaveLength(0); expect(fetcher.mock.calls.some(([url]) => url.includes('damage-claims') || url.includes('kitchen-checkout-claim'))).toBe(false);
  });

  it('reuses assistance with the chosen visit and retains its reason on API failure', async () => {
    booking.visits = [{ ...booking, id: 1002, blockIndex: 1, checkinStatus: 'checked_in' }];
    postError = 'Visit changed; refresh before assisting'; mount('/manager/booking/901/inspection?visitId=1002'); await clearButton();
    fireEvent.click(screen.getByRole('button', { name: 'Record missed arrival or departure' }));
    fireEvent.change(screen.getByLabelText(/Actual reported/), { target: { value: '2026-10-12T17:00' } });
    fireEvent.change(screen.getByLabelText(/Reason and evidence/), { target: { value: 'Visitor confirmed departure by phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record assistance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(postError);
    expect(screen.getByLabelText(/Reason and evidence/)).toHaveValue('Visitor confirmed departure by phone');
    expect(posts()[0][0]).toBe('/api/manager/bookings/901/assist-visit');
    expect(JSON.parse(posts()[0][1].body)).toMatchObject({ visitId: 1002, action: 'departure', expectedUpdatedAt: booking.updatedAt });
  });

  it('returns to the booking through the explicit back context', async () => {
    mount(); await clearButton(); fireEvent.click(screen.getByRole('link', { name: 'Back to booking' }));
    expect(await screen.findByRole('heading', { name: 'Booking details destination' })).toBeInTheDocument(); expect(posts()).toHaveLength(0);
  });
});
