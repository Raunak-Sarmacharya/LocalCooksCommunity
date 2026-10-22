import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ toast: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('@/i18n/manager', async () => ({ mt: (await import('./test-i18n')).createMt() }));
vi.mock('@/i18n', () => ({ default: { language: 'en-CA' } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('wouter', async importOriginal => ({ ...(await importOriginal<typeof import('wouter')>()), useLocation: () => ['/manager/customers/7', h.navigate] }));
vi.mock('@/components/manager/applications/components/DocumentViewerDialog', () => ({
  DocumentViewerDialog: (props: { open: boolean; title: string; url?: string | null }) => props.open ? <div role="dialog" aria-label={props.title}>{props.url}</div> : null,
}));
vi.mock('@/components/manager/applications/components/RevokeLocationAccessDialog', () => ({
  RevokeLocationAccessDialog: (props: { customer: { fullName: string }; onConfirm: (reason: string) => Promise<void> }) =>
    <div role="dialog" aria-label={`revoke ${props.customer.fullName}`}><button onClick={() => void props.onConfirm('Kitchen rules')}>confirm revoke</button></div>,
}));

import { CustomerPageView, displayPhone } from './CustomerPageView';

// "Now" is Wed, Oct 21, 9:05 p.m. Newfoundland time.
const NOW = new Date('2026-10-21T23:35:00.000Z');
const NOTE = { id: 1, body: 'Prefers early slots', authorId: 2, authorName: 'Sam Manager', mine: true, createdAt: '2026-10-12T13:00:00.000Z', updatedAt: '2026-10-12T13:00:00.000Z', edited: false };
const OTHER = { id: 2, body: 'Brings own pans', authorId: 5, authorName: 'Pat Previous', mine: false, createdAt: '2026-09-01T13:00:00.000Z', updatedAt: '2026-09-01T13:00:00.000Z', edited: false };
const booking = (bookingId: number, startsAt: string, endsAt: string, extra: Record<string, unknown> = {}) =>
  ({ bookingId, reference: `KB-${bookingId}`, kitchenName: 'Main Kitchen', startsAt, endsAt, status: 'confirmed', responseDeadlineAt: null, rentals: [], ...extra });
const past = (bookingId: number, outcome: string, extra: Record<string, unknown> = {}) =>
  ({ ...booking(bookingId, '2026-10-12T20:30:00.000Z', '2026-10-12T21:30:00.000Z'), status: 'completed', outcome, refundedCents: 0, late: false, noShow: null, ...extra });
const page = (overrides: Record<string, unknown> = {}) => ({
  customer: { chefId: 7, name: 'Priya Sharma', businessName: 'Spice Route Catering', email: 'priya@example.com', phone: '+17095550142', phoneSource: 'application',
    customerSince: '2026-08-15T12:00:00.000Z', firstContactAt: '2026-08-01T12:00:00.000Z', businessType: 'catering', usageFrequency: 'few-times-month', sessionDuration: '2-4' },
  location: { id: 47, name: 'Harbour Kitchens', timezone: 'America/St_Johns' },
  locations: [{ id: 47, name: 'Harbour Kitchens', timezone: 'America/St_Johns', status: 'approved', needsAction: false, bookingCount: 9 }],
  status: 'approved',
  next: { code: 'problem', rank: 1, owner: 'local_cooks', deadlineAt: null, documentDays: null, documentKey: null, target: { kind: 'booking', id: 132 }, needsAction: false },
  actions: { applicationId: 70, canInvite: true, canRevoke: true, canReview: false, revokedNote: false },
  reliability: { visits: 54, hoursInKitchen: 96, lastVisitEndedAt: '2026-10-21T18:30:00.000Z', nextVisit: { bookingId: 61, startsAt: '2026-10-22T12:30:00.000Z', endsAt: '2026-10-22T13:30:00.000Z' },
    cancelledByCustomer: 13, lateCancellations: 2, noShowsCounted: 1, noShowsUnderReview: 1 },
  bookingCounts: { upcoming: 2, past: 3, cancelled: 2 },
  open: [
    { kind: 'storage_move_in', owner: 'you', storageId: 46, name: 'Reach-in Refrigerator', startOn: '2026-10-16', endOn: '2026-10-23' },
    { kind: 'no_show_review', owner: 'local_cooks', bookingId: 184, reference: 'KB-184', startsAt: '2026-10-21T12:30:00.000Z', endsAt: '2026-10-21T13:30:00.000Z' },
    { kind: 'claims', owner: 'local_cooks', count: 2, amountCents: 6000, references: ['DC-P8ASMJ', 'DC-89XE7K'] },
  ],
  upcoming: [
    booking(60, '2026-10-18T19:30:00.000Z', '2026-10-23T20:30:00.000Z'),
    booking(61, '2026-10-22T12:30:00.000Z', '2026-10-22T13:30:00.000Z', { rentals: [{ name: 'Commercial Oven', days: 3 }] }),
  ],
  past: [
    past(51, 'completed_cleared'),
    past(184, 'attendance_reported', { noShow: 'under_review' }),
    past(182, 'attendance_reported', { noShow: 'counted' }),
    past(157, 'cancelled_by_customer', { status: 'cancelled', late: true }),
    past(150, 'cancelled_by_customer', { status: 'cancelled', refundedCents: 2907 }),
  ], pastTotal: 5, pastHasMore: false,
  application: { id: 70, status: 'approved', tier: 3, stages: [
    { key: 'requested', at: '2026-08-01T12:00:00.000Z' }, { key: 'localCooksApproved', at: '2026-08-05T12:00:00.000Z' },
    { key: 'documentsSubmitted', at: '2026-08-10T12:00:00.000Z' }, { key: 'youApproved', at: '2026-08-15T12:00:00.000Z' }],
    documents: [
      { key: 'foodSafetyLicense', required: true, uploaded: true, status: 'approved', expiry: '2027-06-15', daysLeft: 237, stage: null, url: '/api/files/documents/licence.pdf', renewalPending: false },
      { key: 'foodEstablishmentCert', required: true, uploaded: true, status: 'approved', expiry: '2026-10-25', daysLeft: 4, stage: '7_day', url: null, renewalPending: true },
    ] },
  tours: [],
  money: { paidCents: 506194, refundedCents: 143917, heldCents: 3050, outstandingCents: 0, currency: 'CAD', paymentCount: 88, holdCount: 1, claimsCollectedCents: 29500, claimsCollectedCount: 5 },
  payments: [
    { id: 1, bookingId: 61, reference: 'KB-61', startsAt: '2026-10-22T12:30:00.000Z', endsAt: '2026-10-22T13:30:00.000Z', paidAt: '2026-10-21T22:47:00.000Z', status: 'succeeded',
      amountCents: 3050, refundedCents: 0, payoutCents: 2875, payoutStatus: 'scheduled', payoutAt: '2026-10-23T13:30:00.000Z' },
    { id: 2, bookingId: 150, reference: 'KB-150', startsAt: '2026-10-26T10:30:00.000Z', endsAt: '2026-10-26T11:30:00.000Z', paidAt: '2026-10-21T22:44:00.000Z', status: 'refunded',
      amountCents: 3050, refundedCents: 2907, payoutCents: 0, payoutStatus: 'not_applicable', payoutAt: null },
  ],
  storage: [
    { id: 46, reference: 'SB-AW94FH', name: 'Reach-in Refrigerator', state: 'reserved', endReason: null, startOn: '2026-10-16', endOn: '2026-10-23', totalCents: 8400, moveInOverdue: true },
    { id: 43, reference: 'SB-KH3ZBQ', name: 'Dry shelf', state: 'removal_review', endReason: null, startOn: '2026-09-13', endOn: '2026-09-27', totalCents: 1050, moveInOverdue: false },
  ],
  activity: [
    { at: '2026-10-21T23:21:00.000Z', type: 'rental_day_cancelled', category: 'booking', actor: 'you', bookingId: 222, reference: 'KB-BWNUY8', name: 'Commercial Oven', date: '2026-11-05' },
    { at: '2026-10-21T22:50:00.000Z', type: 'cancelled', category: 'money', actor: 'customer', bookingId: 150, reference: 'KB-150', startsAt: '2026-10-26T10:30:00.000Z', endsAt: '2026-10-26T11:30:00.000Z', refundedCents: 2907 },
    { at: '2026-10-21T22:24:00.000Z', type: 'booked', category: 'money', actor: 'customer', bookingId: 222, reference: 'KB-BWNUY8', startsAt: '2026-11-02T13:30:00.000Z', endsAt: '2026-11-05T20:30:00.000Z',
      amountCents: 46360, rentals: [{ name: 'Commercial Oven', days: 3 }] },
    { at: '2026-10-13T20:21:00.000Z', type: 'access_approved', category: 'access', actor: 'you' },
  ],
  claims: [
    { id: 13, reference: 'DC-P8ASMJ', title: 'Damage and cleaning', status: 'in_review', amountCents: 2000, nextActor: 'local_cooks', deadlineAt: null, bookingId: 212 },
    { id: 11, reference: 'DC-79TGYG', title: 'Extra cleaning', status: 'charge_succeeded', amountCents: 4000, nextActor: 'nobody', deadlineAt: null, bookingId: 178 },
  ],
  ...overrides,
});
const empty = () => page({
  customer: { ...page().customer, name: 'Aisha Rahman', businessName: null, businessType: null },
  reliability: { visits: 0, hoursInKitchen: 0, lastVisitEndedAt: null, nextVisit: null, cancelledByCustomer: 0, lateCancellations: 0, noShowsCounted: 0, noShowsUnderReview: 0 },
  bookingCounts: { upcoming: 0, past: 0, cancelled: 0 }, open: [], upcoming: [], past: [], pastTotal: 0, payments: [], storage: [], activity: [], claims: [],
  money: { paidCents: 0, refundedCents: 0, heldCents: 0, outstandingCents: 0, currency: 'CAD', paymentCount: 0, holdCount: 0, claimsCollectedCents: 0, claimsCollectedCount: 0 },
});

let notes = [NOTE, OTHER];
let routes: Record<string, (init?: RequestInit) => { status?: number; body: unknown }> = {};
const calls: { url: string; method: string; body?: string }[] = [];
const mount = (chefId = 7, locationParam: number | undefined = 47) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CustomerPageView chefId={chefId} locationParam={locationParam} /></QueryClientProvider>);
};
const heading = () => screen.findByRole('heading', { level: 1, name: 'Priya Sharma' });
const openMenu = (trigger: HTMLElement) => { fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' }); };
const tab = (name: RegExp) => { const element = screen.getByRole('tab', { name }); fireEvent.mouseDown(element, { button: 0 }); fireEvent.click(element); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  calls.length = 0; notes = [NOTE, OTHER]; h.toast.mockClear(); h.navigate.mockClear();
  window.history.replaceState({}, '', '/manager/customers/7?location=47');
  routes = {
    'GET /api/manager/customers/7': () => ({ body: page() }),
    'GET /api/manager/customers/7/notes': () => ({ body: { notes } }),
    'POST /api/manager/customers/7/notes': init => { const body = JSON.parse(String(init?.body)).body; notes = [{ ...NOTE, id: 3, body }, ...notes]; return { status: 201, body: { notes } }; },
    'PATCH /api/manager/customers/7/notes/1': init => { const body = JSON.parse(String(init?.body)).body; notes = notes.map(n => n.id === 1 ? { ...n, body, edited: true } : n); return { body: { notes } }; },
    'DELETE /api/manager/customers/7/notes/1': () => { notes = notes.filter(n => n.id !== 1); return { body: { notes } }; },
    'GET /api/firebase/chat/locations/47/chefs/7/conversation': () => ({ body: { conversationId: 'chef-7-location-47' } }),
    'DELETE /api/manager/chef-location-access': () => ({ body: { success: true } }),
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const method = init?.method ?? 'GET';
    calls.push({ url: input, method, body: init?.body as string | undefined });
    const route = routes[`${method} ${url.pathname}`];
    if (!route) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'Not found' }) };
    const result = route(init);
    const status = result.status ?? 200;
    return { ok: status < 400, status, statusText: '', json: async () => result.body };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('asks for the full history and leads with the person: name, business, tap-to-call phone, email and location', async () => {
  mount();
  await heading();
  expect(calls[0].url).toBe('/api/manager/customers/7?locationId=47&past=all');
  expect(screen.getAllByText('Spice Route Catering')[0].parentElement).toHaveTextContent('Spice Route Catering · Catering');
  expect(screen.getAllByRole('link', { name: /\(709\) 555-0142/ })[0]).toHaveAttribute('href', 'tel:+17095550142');
  expect(screen.getAllByRole('link', { name: /priya@example\.com/ })[0]).toHaveAttribute('href', 'mailto:priya@example.com');
  expect(screen.getAllByText('Harbour Kitchens', { selector: 'span.truncate' })[0]).toBeInTheDocument();
  const about = screen.getByRole('region', { name: 'About' });
  expect(within(about).getByText('From their application')).toBeInTheDocument();
  expect(within(about).getByText('A few times a month')).toBeInTheDocument();
  expect(within(about).getByText('2–4 h sessions')).toBeInTheDocument();
  expect(screen.getAllByRole('tab').map(item => item.textContent)).toEqual(['Overview', 'Bookings7', 'Storage2', 'Money', 'Access and documents', 'Activity']);
  expect(document.body.textContent).not.toMatch(/stripe|pi_|pm_|visa|last4|insurance|Ask for it/i);
});

it('never uses "chef" as a role word on the kitchen side', async () => {
  mount();
  await heading();
  for (const name of [/Bookings/, /Storage/, /Money/, /Access and documents/, /Activity/]) {
    tab(name);
    expect(document.body.textContent).not.toMatch(/\bchefs?\b/i);
  }
});

it('shows the five figures, with late cancellations apart from early ones', async () => {
  mount();
  await heading();
  const strip = screen.getByRole('region', { name: 'Relationship at Harbour Kitchens' });
  expect(strip).toHaveTextContent('Visits54last visit today');
  expect(strip).toHaveTextContent('Time in your kitchen96habout 1.8 h a visit');
  expect(strip).toHaveTextContent('Net paid$3,622.77after $1,439.17 refunded');
  expect(strip).toHaveTextContent('Next visitTomorrow10:00–11:00 a.m.');
  expect(strip).toHaveTextContent('Late cancellations2of 13 cancelled1 no-show · 1 under review');
});

it('groups what is open into For you and Waiting on others, with a disputed no-show under review', async () => {
  mount();
  await heading();
  const open = screen.getByRole('region', { name: /Open with Priya Sharma/ });
  expect(open).toHaveTextContent('For you1');
  expect(open).toHaveTextContent('Reach-in Refrigerator · move-in not confirmed');
  expect(open).toHaveTextContent('Rental Oct 16–23 · Started 5 days ago');
  expect(within(open).getByRole('link', { name: 'Confirm move-in' })).toHaveAttribute('href', '/manager/storage/46');
  expect(open).toHaveTextContent('Waiting on others2');
  expect(open).toHaveTextContent('No-show disputed · today, 10:00–11:00 a.m.');
  expect(open).toHaveTextContent('Priya Sharma says they were there. Local Cooks is reviewing it; it doesn’t count until then.');
  expect(open).toHaveTextContent('2 damage claims in review · $60.00');
  fireEvent.click(within(open).getByRole('button', { name: 'View claims' }));
  expect(screen.getByRole('tab', { name: 'Money' })).toHaveAttribute('aria-selected', 'true');
});

it('splits Coming up into In progress and Next, counting paid rentals, not every included item', async () => {
  mount();
  await heading();
  const coming = screen.getByRole('region', { name: /Coming up/ });
  expect(coming).toHaveTextContent('In progress1');
  expect(coming).toHaveTextContent('Sun, Oct 18, 5:00 p.m. – Fri, Oct 23, 6:00 p.m.');
  expect(coming).toHaveTextContent('Next1');
  expect(coming).toHaveTextContent('Main Kitchen · 1 rental · KB-61');
  expect(within(coming).getAllByRole('link')[1]).toHaveAttribute('href', '/manager/booking/61');
});

it('marks late cancellations and both no-show states in Bookings, and defines the terms', async () => {
  mount();
  await heading();
  tab(/Bookings/);
  const card = screen.getByRole('region', { name: 'Bookings at Harbour Kitchens' });
  fireEvent.click(within(card).getByRole('button', { name: /Cancelled/ }));
  const late = within(card).getByText('KB-157', { selector: 'td' }).closest('tr')!;
  expect(late).toHaveTextContent('Cancelled by Priya SharmaLateInside the cancellation window · no refund');
  expect(within(card).getByText('KB-150', { selector: 'td' }).closest('tr')).toHaveTextContent('Refunded $29.07');
  fireEvent.click(within(card).getByRole('button', { name: /Past/ }));
  expect(within(card).getByText('KB-182', { selector: 'td' }).closest('tr')).toHaveTextContent('No-showNot disputed, or upheld by Local Cooks');
  expect(within(card).getByText('KB-184', { selector: 'td' }).closest('tr')).toHaveTextContent('No-show disputedLocal Cooks is reviewing; it doesn’t count yet');
  expect(card).toHaveTextContent('Late means cancelled inside that booking’s cancellation window.');
});

it('lists storage with its state, and money with each payout', async () => {
  mount();
  await heading();
  tab(/Storage/);
  const storage = screen.getByRole('region', { name: /Storage rentals/ });
  expect(within(storage).getByText('Reach-in Refrigerator').closest('tr')).toHaveTextContent('Move-in not confirmed');
  expect(within(storage).getByText('Dry shelf').closest('tr')).toHaveTextContent('Past end, not moved out');
  tab(/Money/);
  const summary = screen.getByRole('region', { name: /Money at Harbour Kitchens/ });
  expect(summary).toHaveTextContent('Paid$5,061.9488 payments');
  expect(summary).toHaveTextContent('Claims collected$295.005 claims paid');
  const payments = screen.getByRole('region', { name: 'Payments' });
  expect(payments).toHaveTextContent('$28.75Expected Oct 23, 2026');
  expect(payments).toHaveTextContent('−$29.07');
  const claims = screen.getByRole('region', { name: /Damage claims/ });
  expect(within(claims).getAllByText('Local Cooks is reviewing')[0]).toBeInTheDocument();
  expect(claims).toHaveTextContent('Paid by Priya Sharma');
});

it('filters the activity feed and words the kitchen’s own actions as "You"', async () => {
  mount();
  await heading();
  tab(/Activity/);
  const feed = screen.getByRole('region', { name: 'Activity' });
  expect(feed).toHaveTextContent('You cancelled one rental day');
  expect(feed).toHaveTextContent('Commercial Oven on Thu, Nov 5 · KB-BWNUY8');
  expect(feed).toHaveTextContent('Paid $463.60 · 1 rental: Commercial Oven, 3 days · KB-BWNUY8');
  fireEvent.click(within(feed).getByRole('button', { name: 'Access' }));
  expect(feed).toHaveTextContent('You approved access');
  expect(feed).not.toHaveTextContent('Cancelled a booking');
  expect(feed).toHaveTextContent('Showing 1 of 1');
});

it('keeps revoke inside the ⋯ menu and uses the existing atomic route', async () => {
  mount();
  await heading();
  expect(screen.queryByRole('button', { name: /Revoke/ })).not.toBeInTheDocument();
  openMenu(screen.getByRole('button', { name: 'More actions' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['View access application', 'Copy email address', 'Copy phone number', 'Revoke access…']);
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Revoke access…' }));
  fireEvent.click(await screen.findByRole('button', { name: 'confirm revoke' }));
  await waitFor(() => expect(h.toast).toHaveBeenCalledWith({ title: 'Access to Harbour Kitchens ended for Priya Sharma.' }));
  expect(JSON.parse(calls.find(item => item.method === 'DELETE')!.body!)).toEqual({ chefId: 7, locationId: 47, reason: 'Kitchen rules' });
});

it('has Message as the one primary and Invite to book for an approved customer', async () => {
  mount();
  await heading();
  expect(screen.getByRole('link', { name: 'Invite to book' })).toHaveAttribute('href', '/manager/invitations/new?chefId=7&location=47');
  fireEvent.click(screen.getByRole('button', { name: 'Message' }));
  await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/manager/dashboard?view=messages&conversation=chef-7-location-47&locationId=47'));
});

it('switches location from the chip when the customer has access at two of your locations', async () => {
  routes['GET /api/manager/customers/7'] = () => ({ body: page({ locations: [
    { id: 47, name: 'Harbour Kitchens', timezone: 'America/St_Johns', status: 'approved', needsAction: false, bookingCount: 104 },
    { id: 48, name: 'Water Street Commissary', timezone: 'America/St_Johns', status: 'approved', needsAction: false, bookingCount: 3 }] }) });
  mount();
  await heading();
  openMenu(screen.getByRole('button', { name: 'Location: Harbour Kitchens. Switch location' }));
  const menu = await screen.findByRole('menu');
  expect(menu).toHaveTextContent('Priya Sharma has access at');
  const items = within(menu).getAllByRole('menuitemradio');
  expect(items[0]).toHaveAttribute('aria-checked', 'true');
  expect(items[1]).toHaveTextContent('Water Street CommissaryApproved · 3 bookings');
  fireEvent.click(items[1]);
  expect(h.navigate).toHaveBeenCalledWith('/manager/customers/7?location=48');
});

it('says what will appear for a new customer with nothing booked', async () => {
  routes['GET /api/manager/customers/7'] = () => ({ body: empty() });
  mount();
  await screen.findByRole('heading', { level: 1, name: 'Aisha Rahman' });
  expect(screen.getByRole('region', { name: /Relationship at/ })).toHaveTextContent('Next visitNone bookedInvite them to book');
  expect(screen.getByText('Nothing open')).toBeInTheDocument();
  expect(screen.getByText('No bookings yet')).toBeInTheDocument();
  tab(/Bookings/);
  expect(screen.getByText('No upcoming bookings')).toBeInTheDocument();
  tab(/Money/);
  expect(screen.getByText('No payments yet')).toBeInTheDocument();
});

it('shows a skeleton while loading, then the page', async () => {
  let release: () => void = () => {};
  routes['GET /api/manager/customers/7'] = () => ({ body: page() });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => { if (String(input).startsWith('/api/manager/customers/7?')) await gate; return original(input, init); }));
  mount();
  expect(screen.getByLabelText('Loading customer…')).toHaveAttribute('aria-busy', 'true');
  release();
  await heading();
});

it('shows not-found for a customer who is not at your locations, and a retry for any other failure', async () => {
  routes['GET /api/manager/customers/7'] = () => ({ status: 404, body: { error: 'Customer not found' } });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t find this customer.');
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  cleanup();
  routes['GET /api/manager/customers/7'] = () => ({ status: 500, body: { error: 'boom' } });
  mount();
  // The page retries a server error twice before giving up.
  const alert = await screen.findByRole('alert', {}, { timeout: 6000 });
  expect(alert).toHaveTextContent('We couldn’t load this customer');
  expect(within(alert).getByRole('link', { name: 'Back to customers' })).toHaveAttribute('href', '/manager/dashboard?view=customers');
  routes['GET /api/manager/customers/7'] = () => ({ body: page() });
  fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
  await heading();
});

it('lists the submitted documents with expiry and opens a file only when there is one', async () => {
  mount();
  await heading();
  const access = screen.getByRole('region', { name: 'Access and documents' });
  expect(access).toHaveTextContent('You approved Aug 15, 2026');
  expect(access).toHaveTextContent('Food safety certificateVerified · expires Jun 15, 2027');
  expect(within(access).getByText('expires Oct 25, 2026')).toHaveAttribute('data-expiry-stage', '7_day');
  expect(within(access).getAllByRole('button', { name: /View file/ })).toHaveLength(1);
  fireEvent.click(within(access).getByRole('button', { name: 'View file: Food safety certificate' }));
  expect(screen.getByRole('dialog', { name: 'Food safety certificate' })).toHaveTextContent('/api/files/documents/licence.pdf');
});

it('formats North American numbers for reading and leaves others as entered', () => {
  expect(displayPhone('+17095550100')).toBe('(709) 555-0100');
  expect(displayPhone('7095550143')).toBe('(709) 555-0143');
  expect(displayPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
});

it('warns who can see notes, and lists them with author and date (mine marked "You")', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Private notes' });
  expect(within(section).getByTestId('notes-banner')).toHaveTextContent('Visible to you and Local Cooks support. Never shown to Priya Sharma.');
  expect(await within(section).findByText('Prefers early slots')).toBeInTheDocument();
  expect(within(section).getByText('You · Oct 12, 2026')).toBeInTheDocument();
  expect(within(section).getByText('Pat Previous · Sep 1, 2026')).toBeInTheDocument();
  expect(within(section).getAllByRole('button', { name: 'Edit note' })).toHaveLength(1);
});

it('adds a note, counts characters and clears the box', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Private notes' });
  await within(section).findByText('Prefers early slots');
  const box = within(section).getByLabelText('Add a private note');
  expect(box).toHaveAttribute('maxlength', '2000');
  expect(within(section).getByRole('button', { name: 'Add note' })).toBeDisabled();
  fireEvent.change(box, { target: { value: 'Allergic to nuts' } });
  expect(within(section).getByText('16 / 2,000 characters')).toBeInTheDocument();
  fireEvent.click(within(section).getByRole('button', { name: 'Add note' }));
  expect(await within(section).findByText('Allergic to nuts')).toBeInTheDocument();
  expect(box).toHaveValue('');
  const post = calls.find(item => item.method === 'POST')!;
  expect(post.url).toBe('/api/manager/customers/7/notes?locationId=47');
});

it('edits an own note, and deletes only after a confirmation', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Private notes' });
  await within(section).findByText('Prefers early slots');
  fireEvent.click(within(section).getByRole('button', { name: 'Edit note' }));
  fireEvent.change(within(section).getByRole('textbox', { name: 'Edit note' }), { target: { value: 'Prefers late slots' } });
  fireEvent.click(within(section).getByRole('button', { name: 'Save note' }));
  await waitFor(() => expect(within(section).queryByRole('textbox', { name: 'Edit note' })).not.toBeInTheDocument());
  expect(within(section).getByText('Prefers late slots')).toBeInTheDocument();
  fireEvent.click(within(section).getByRole('button', { name: 'Delete note' }));
  expect(within(section).getByText('Delete this note? You won’t be able to get it back.')).toBeInTheDocument();
  fireEvent.click(within(section).getAllByRole('button', { name: 'Delete note' }).at(-1)!);
  await waitFor(() => expect(within(section).queryByText('Prefers late slots')).not.toBeInTheDocument());
});
