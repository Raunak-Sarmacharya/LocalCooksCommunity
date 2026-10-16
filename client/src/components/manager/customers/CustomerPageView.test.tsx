import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('@/i18n/manager', async () => ({ mt: (await import('./test-i18n')).createMt() }));
vi.mock('@/i18n', () => ({ default: { language: 'en-CA' } }));
vi.mock('@/services/chat-service', () => ({ getAllConversations: async () => [{ chefId: 7, locationId: 47, unreadManagerCount: 2 }] }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/manager/applications/components/DocumentViewerDialog', () => ({
  DocumentViewerDialog: (props: { open: boolean; title: string; url?: string | null }) => props.open ? <div role="dialog" aria-label={props.title}>{props.url}</div> : null,
}));
vi.mock('@/components/manager/applications/components/RevokeLocationAccessDialog', () => ({
  RevokeLocationAccessDialog: (props: { customer: { fullName: string }; onConfirm: (reason: string) => Promise<void> }) =>
    <div role="dialog" aria-label={`revoke ${props.customer.fullName}`}><button onClick={() => void props.onConfirm('Kitchen rules')}>confirm revoke</button></div>,
}));

import { CustomerPageView } from './CustomerPageView';

const NOTE = { id: 1, body: 'Prefers early slots', authorId: 2, authorName: 'Sam Manager', mine: true, createdAt: '2026-10-12T13:00:00.000Z', updatedAt: '2026-10-12T13:00:00.000Z', edited: false };
const OTHER = { id: 2, body: 'Brings own pans', authorId: 5, authorName: 'Pat Previous', mine: false, createdAt: '2026-09-01T13:00:00.000Z', updatedAt: '2026-09-01T13:00:00.000Z', edited: false };
const next = (overrides: Record<string, unknown> = {}) => ({ code: 'inspection', rank: 3, owner: 'you', deadlineAt: '2026-10-17T02:00:00.000Z', documentDays: null, documentKey: null, target: { kind: 'inspection', id: 61 }, needsAction: true, ...overrides });
const page = (overrides: Record<string, unknown> = {}) => ({
  customer: { chefId: 7, name: 'Priya Sharma', businessName: 'Spice Route Catering', email: 'priya@example.com', phone: '(709) 555-0142', customerSince: '2026-08-15T12:00:00.000Z', firstContactAt: '2026-08-01T12:00:00.000Z' },
  location: { id: 47, name: 'Harbour Kitchens', timezone: 'America/St_Johns' },
  locations: [{ id: 47, name: 'Harbour Kitchens', timezone: 'America/St_Johns', status: 'approved', needsAction: true }],
  status: 'approved', next: next(),
  actions: { applicationId: 70, canInvite: true, canRevoke: true, canReview: false, revokedNote: false },
  upcoming: [
    { bookingId: 61, reference: 'KB-61', kitchenName: 'Main Kitchen', startsAt: '2026-10-21T12:30:00.000Z', endsAt: '2026-10-21T14:30:00.000Z', status: 'confirmed', responseDeadlineAt: null, equipmentCount: 1, storageCount: 1 },
    { bookingId: 62, reference: 'KB-62', kitchenName: 'Pastry Room', startsAt: '2026-10-24T17:30:00.000Z', endsAt: '2026-10-24T20:30:00.000Z', status: 'pending', responseDeadlineAt: '2026-10-23T23:30:00.000Z', equipmentCount: 0, storageCount: 0 },
  ],
  past: [
    { bookingId: 51, reference: 'KB-51', kitchenName: 'Main Kitchen', startsAt: '2026-10-12T20:30:00.000Z', endsAt: '2026-10-12T21:30:00.000Z', status: 'completed', responseDeadlineAt: null, equipmentCount: 0, storageCount: 0, outcome: 'completed_cleared', refundedCents: 0 },
    { bookingId: 50, reference: 'KB-50', kitchenName: 'Main Kitchen', startsAt: '2026-10-08T17:30:00.000Z', endsAt: '2026-10-08T19:30:00.000Z', status: 'cancelled', responseDeadlineAt: null, equipmentCount: 0, storageCount: 0, outcome: 'cancelled_by_customer', refundedCents: 2843 },
    { bookingId: 49, reference: 'KB-49', kitchenName: 'Main Kitchen', startsAt: '2026-10-03T12:30:00.000Z', endsAt: '2026-10-03T13:30:00.000Z', status: 'confirmed', responseDeadlineAt: null, equipmentCount: 0, storageCount: 0, outcome: 'visit_ended', refundedCents: 0 },
  ], pastTotal: 3, pastHasMore: false,
  application: { id: 70, status: 'approved', tier: 3, stages: [
    { key: 'requested', at: '2026-08-01T12:00:00.000Z' }, { key: 'localCooksApproved', at: '2026-08-05T12:00:00.000Z' },
    { key: 'documentsSubmitted', at: '2026-08-10T12:00:00.000Z' }, { key: 'youApproved', at: '2026-08-15T12:00:00.000Z' }],
    documents: [
      { key: 'foodSafetyLicense', required: true, uploaded: true, status: 'approved', expiry: '2026-10-22', daysLeft: 6, stage: '7_day', url: '/api/files/documents/licence.pdf', renewalPending: false },
      { key: 'foodEstablishmentCert', required: true, uploaded: true, status: 'approved', expiry: '2026-11-05', daysLeft: 20, stage: '30_day', url: null, renewalPending: true },
      { key: 'other', required: false, uploaded: true, status: 'approved', expiry: '2020-01-01', daysLeft: -2000, stage: 'expired', url: null, renewalPending: false },
    ] },
  tours: [{ id: 9, scheduledAt: '2026-08-02T14:00:00.000Z', durationMinutes: 30, status: 'completed', kitchenName: 'Main Kitchen', feedbackSubmitted: true }],
  money: { paidCents: 41250, refundedCents: 2843, heldCents: 6100, outstandingCents: 0, currency: 'CAD' },
  claims: [{ id: 3, reference: 'DC-3', title: 'Broken mixer lid', status: 'submitted', amountCents: 8500, nextActor: 'customer', deadlineAt: '2026-10-19T15:00:00.000Z', bookingId: 51 }],
  ...overrides,
});

let notes = [NOTE, OTHER];
let routes: Record<string, (init?: RequestInit) => { status?: number; body: unknown }> = {};
const calls: { url: string; method: string; body?: string }[] = [];
const mount = (chefId = 7, locationParam: number | undefined = 47) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CustomerPageView chefId={chefId} locationParam={locationParam} /></QueryClientProvider>);
};
beforeEach(() => {
  calls.length = 0; notes = [NOTE, OTHER]; h.toast.mockClear();
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('lays out the sections in the agreed order', async () => {
  mount();
  await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' });
  const headings = screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent);
  expect(headings).toEqual(['Next action', 'Upcoming bookings', 'Past bookings', 'Application and documents', 'Money at Harbour Kitchens', 'Claims', 'Messages', 'Tours', 'Private notes']);
});

it('shows the header: name, business, contact, customer-since and the access chip, with no card or Stripe data anywhere', async () => {
  mount();
  await screen.findByRole('heading', { level: 1, name: 'Priya Sharma' });
  expect(screen.getByText('Spice Route Catering')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /priya@example\.com/ })).toHaveAttribute('href', 'mailto:priya@example.com');
  expect(screen.getByText('(709) 555-0142')).toBeInTheDocument();
  expect(screen.getByText('Customer since Aug 15, 2026')).toBeInTheDocument();
  expect(screen.getByText('Approved at Harbour Kitchens')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/stripe|pi_|pm_|ch_|visa|mastercard|last4/i);
  expect(screen.getByRole('link', { name: 'Back to customers' })).toHaveAttribute('href', '/manager/dashboard?view=customers');
});

it('has one canonical next action with whose turn it is, the deadline in kitchen time, and one button to the task page', async () => {
  mount();
  const card = (await screen.findByRole('region', { name: 'Next action' }));
  expect(within(card).getByText('Your turn')).toBeInTheDocument();
  expect(within(card).getByText(/^Inspect the kitchen by Fri, Oct 16, 11:30 p\.m\. · Newfoundland Time$/)).toBeInTheDocument();
  expect(within(card).getByText('Due Fri, Oct 16, 11:30 p.m. · Newfoundland Time')).toBeInTheDocument();
  const buttons = within(card).getAllByRole('link');
  expect(buttons).toHaveLength(1);
  expect(buttons[0]).toHaveAttribute('href', '/manager/booking/61/inspection');
  expect(buttons[0]).toHaveTextContent('Open inspection');
});

it.each([
  [next({ code: 'documents_review', target: { kind: 'application', id: 70 }, deadlineAt: null }), '/manager/dashboard?view=applications&application=70', 'Review application'],
  [next({ code: 'booking_request', target: { kind: 'booking', id: 62 } }), '/manager/booking/62', 'Open booking'],
  [next({ code: 'tour_request', target: { kind: 'tour', id: 9 }, deadlineAt: null }), '/manager/tours/9', 'Open tour'],
])('links the next action to the existing task page: %#', async (action, href, label) => {
  routes['GET /api/manager/customers/7'] = () => ({ body: page({ next: action }) });
  mount();
  const card = await screen.findByRole('region', { name: 'Next action' });
  expect(within(card).getByRole('link', { name: label })).toHaveAttribute('href', href);
});

it('shows no task button when the customer is the one who has to act', async () => {
  routes['GET /api/manager/customers/7'] = () => ({ body: page({ next: next({ code: 'document_expiring', owner: 'customer', rank: 8, deadlineAt: null, documentDays: 6, documentKey: 'foodSafetyLicense', target: { kind: 'application', id: 70 }, needsAction: false }) }) });
  mount();
  const card = await screen.findByRole('region', { name: 'Next action' });
  expect(within(card).getByText('Waiting for Priya Sharma')).toBeInTheDocument();
  expect(within(card).getByText('Food safety certificate expires in 6 days')).toBeInTheDocument();
  expect(within(card).queryByRole('link')).not.toBeInTheDocument();
});

it('lists upcoming bookings with kitchen-local time and zone, deadlines, add-ons and a link to each booking', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Upcoming bookings' });
  const first = within(section).getAllByRole('link')[0];
  expect(first).toHaveAttribute('href', '/manager/booking/61');
  expect(first).toHaveTextContent('Wed, Oct 21 · 10:00 a.m.–12:00 p.m. · Newfoundland Time');
  expect(first).toHaveTextContent('Main Kitchen · Confirmed · 2 add-ons');
  expect(within(section).getAllByRole('link')[1]).toHaveTextContent('Pastry Room · Requested · Respond by Fri, Oct 23, 9:00 p.m. · Newfoundland Time');
});

it('collapses long upcoming lists to ten with Show all', async () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ ...page().upcoming[0], bookingId: 100 + index }));
  routes['GET /api/manager/customers/7'] = () => ({ body: page({ upcoming: many }) });
  mount();
  const section = await screen.findByRole('region', { name: 'Upcoming bookings' });
  expect(within(section).getAllByRole('link')).toHaveLength(10);
  fireEvent.click(within(section).getByRole('button', { name: 'Show all 12' }));
  expect(within(section).getAllByRole('link')).toHaveLength(12);
  expect(within(section).getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
});

it('names past outcomes explicitly and never says no-show for a missing tap', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Past bookings' });
  expect(within(section).getByText(/Completed · cleared by you/)).toBeInTheDocument();
  expect(within(section).getByText(/Cancelled by Priya Sharma · refunded \$28\.43/)).toBeInTheDocument();
  expect(within(section).getByText(/Visit ended · outcome not recorded yet/)).toBeInTheDocument();
  expect(section.textContent).not.toMatch(/no.?show/i);
});

it('shows document expiry with amber at 30 days or fewer and red at 7 days or fewer and when expired', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Application and documents' });
  expect(within(section).getByText('Requested · Aug 1, 2026')).toBeInTheDocument();
  expect(within(section).getByText('You approved · Aug 15, 2026')).toBeInTheDocument();
  const stages = Array.from(section.querySelectorAll('[data-expiry-stage]')).map(node => [node.getAttribute('data-expiry-stage'), node.className.match(/text-(red|amber|muted)/)?.[1], node.textContent]);
  expect(stages).toEqual([
    ['7_day', 'red', 'Expires Oct 22, 2026 · expires in 6 days'],
    ['30_day', 'amber', 'Expires Nov 5, 2026 · expires in 20 days'],
    ['expired', 'red', 'Expired Jan 1, 2020'],
  ]);
  expect(within(section).getByText('A renewed document is waiting for review')).toBeInTheDocument();
  expect(within(section).getAllByRole('button', { name: /View file/ })).toHaveLength(1);
});

it('opens a document only when a file is available', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Application and documents' });
  fireEvent.click(within(section).getByRole('button', { name: 'View file: Food safety certificate' }));
  expect(screen.getByRole('dialog', { name: 'Food safety certificate' })).toHaveTextContent('/api/files/documents/licence.pdf');
});

it('summarizes money for this location in Canadian dollars', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Money at Harbour Kitchens' });
  const read = (label: string) => within(section).getByText(label).nextElementSibling?.textContent;
  expect(read('Paid')).toBe('$412.50');
  expect(read('Refunded')).toBe('$28.43');
  expect(read('Held')).toBe('$61.00');
  expect(read('Outstanding')).toBe('$0.00');
});

it('lists claims with status, amount, next actor and a link', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Claims' });
  expect(within(section).getByText('Broken mixer lid')).toBeInTheDocument();
  expect(within(section).getByText('Waiting for Priya Sharma · $85.00')).toBeInTheDocument();
  expect(within(section).getByText(/^Next: Priya Sharma · Due Mon, Oct 19, 12:30 p\.m\. · Newfoundland Time$/)).toBeInTheDocument();
  expect(within(section).getByRole('link', { name: 'Open claim' })).toHaveAttribute('href', '/manager/dashboard?view=damage-claims&claim=3');
});

it('lists tours with a link and the manager’s own feedback state', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Tours' });
  expect(within(section).getByRole('link')).toHaveAttribute('href', '/manager/tours/9');
  expect(section).toHaveTextContent('Main Kitchen · Completed');
  expect(section).toHaveTextContent('You shared your feedback');
});

it('has Invite to book only for an approved customer, linking to the invitation page with person and location', async () => {
  mount();
  expect(await screen.findByRole('link', { name: 'Invite to book' })).toHaveAttribute('href', '/manager/invitations/new?chefId=7&location=47');
  cleanup();
  routes['GET /api/manager/customers/7'] = () => ({ body: page({ status: 'in_review', actions: { applicationId: 70, canInvite: false, canRevoke: false, canReview: true, revokedNote: false } }) });
  mount();
  expect(await screen.findByRole('link', { name: 'Review application' })).toHaveAttribute('href', '/manager/dashboard?view=applications&application=70');
  expect(screen.queryByRole('link', { name: 'Invite to book' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Revoke access' })).not.toBeInTheDocument();
});

it('explains a revoked customer and how to get access restored', async () => {
  routes['GET /api/manager/customers/7'] = () => ({ body: page({ status: 'revoked', actions: { applicationId: 70, canInvite: false, canRevoke: false, canReview: false, revokedNote: true } }) });
  mount();
  expect(await screen.findByText(/Access to Harbour Kitchens was ended for new bookings/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Contact Local Cooks' }).getAttribute('href')).toMatch(/^mailto:support@localcooks\.ca/);
  expect(screen.queryByRole('link', { name: 'Invite to book' })).not.toBeInTheDocument();
});

it('revokes through the existing atomic route and confirms', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke access' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'revoke Priya Sharma' })).getByRole('button', { name: 'confirm revoke' }));
  await waitFor(() => expect(h.toast).toHaveBeenCalledWith({ title: 'Access to Harbour Kitchens ended for Priya Sharma.' }));
  const call = calls.find(item => item.method === 'DELETE' && item.url === '/api/manager/chef-location-access')!;
  expect(JSON.parse(call.body!)).toEqual({ chefId: 7, locationId: 47, reason: 'Kitchen rules' });
});

it('opens the existing conversation from Message, and says so when messaging is not open yet', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Message' }));
  await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/manager/dashboard?view=messages&conversation=chef-7-location-47&locationId=47'));
  cleanup();
  window.history.replaceState({}, '', '/manager/customers/7?location=47');
  routes['GET /api/firebase/chat/locations/47/chefs/7/conversation'] = () => ({ status: 404, body: { error: 'Eligible conversation not found' } });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Message' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Messaging with Priya Sharma isn’t open yet.');
  expect(window.location.pathname).toBe('/manager/customers/7');
});

it('shows unread messages and a link to the conversation (no inline chat)', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Messages' });
  expect(await within(section).findByText('2 unread messages')).toBeInTheDocument();
  expect(within(section).getByRole('button', { name: 'Open conversation' })).toBeInTheDocument();
  expect(section.querySelector('textarea')).toBeNull();
});

it('switches between locations when the person has more than one', async () => {
  routes['GET /api/manager/customers/7'] = () => ({ body: page({ locations: [
    { id: 47, name: 'Harbour Kitchens', timezone: 'America/St_Johns', status: 'approved', needsAction: true },
    { id: 48, name: 'West End', timezone: 'America/Toronto', status: 'in_review', needsAction: true }] }) });
  mount();
  const group = await screen.findByRole('group', { name: 'Location' });
  expect(within(group).getByRole('button', { name: 'Approved at Harbour Kitchens' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(group).getByRole('button', { name: 'In review at West End' }));
  await waitFor(() => expect(window.location.search).toBe('?location=48'));
});

it('shows not-found for a customer who is not at the manager’s locations, with a way back', async () => {
  routes['GET /api/manager/customers/7'] = () => ({ status: 404, body: { error: 'Customer not found' } });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t find this customer.');
  expect(screen.getByRole('link', { name: 'Back to customers' })).toHaveAttribute('href', '/manager/dashboard?view=customers');
});

it('shows a retry for any other failure', async () => {
  routes['GET /api/manager/customers/7'] = () => ({ status: 400, body: { error: 'bad' } });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load this customer. Try again.');
});

/* ─────────────────────────────── private notes ─────────────────────────────── */

it('warns who can see notes, and lists them with author and time (mine marked "You")', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Private notes' });
  expect(within(section).getByTestId('notes-banner')).toHaveTextContent('Visible to you and Local Cooks support. Never shown to Priya Sharma.');
  expect(await within(section).findByText('Prefers early slots')).toBeInTheDocument();
  expect(within(section).getByText('You · Mon, Oct 12, 10:30 a.m. · Newfoundland Time')).toBeInTheDocument();
  expect(within(section).getByText('Pat Previous · Tue, Sep 1, 10:30 a.m. · Newfoundland Time')).toBeInTheDocument();
});

it('only the author gets edit and delete', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Private notes' });
  await within(section).findByText('Prefers early slots');
  expect(within(section).getAllByRole('button', { name: 'Edit note' })).toHaveLength(1);
  expect(within(section).getAllByRole('button', { name: 'Delete note' })).toHaveLength(1);
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
  expect(JSON.parse(post.body!)).toEqual({ body: 'Allergic to nuts' });
});

it('edits an own note', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Private notes' });
  await within(section).findByText('Prefers early slots');
  fireEvent.click(within(section).getByRole('button', { name: 'Edit note' }));
  const box = within(section).getByRole('textbox', { name: 'Edit note' });
  fireEvent.change(box, { target: { value: 'Prefers late slots' } });
  fireEvent.click(within(section).getByRole('button', { name: 'Save note' }));
  await waitFor(() => expect(within(section).queryByRole('textbox', { name: 'Edit note' })).not.toBeInTheDocument());
  expect(within(section).getByText('Prefers late slots')).toBeInTheDocument();
  expect(within(section).getByText(/· edited$/)).toBeInTheDocument();
});

it('deletes only after a confirmation, and Cancel keeps the note', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Private notes' });
  await within(section).findByText('Prefers early slots');
  fireEvent.click(within(section).getByRole('button', { name: 'Delete note' }));
  fireEvent.click(within(section).getByRole('button', { name: 'Cancel' }));
  expect(calls.some(item => item.method === 'DELETE' && item.url.includes('/notes/'))).toBe(false);
  fireEvent.click(within(section).getByRole('button', { name: 'Delete note' }));
  expect(within(section).getByText('Delete this note? You won’t be able to get it back.')).toBeInTheDocument();
  fireEvent.click(within(section).getAllByRole('button', { name: 'Delete note' }).at(-1)!);
  await waitFor(() => expect(within(section).queryByText('Prefers early slots')).not.toBeInTheDocument());
});

it('reports a failed save without losing what was typed', async () => {
  routes['POST /api/manager/customers/7/notes'] = () => ({ status: 500, body: { error: 'x' } });
  mount();
  const section = await screen.findByRole('region', { name: 'Private notes' });
  await within(section).findByText('Prefers early slots');
  fireEvent.change(within(section).getByLabelText('Add a private note'), { target: { value: 'Keep me' } });
  fireEvent.click(within(section).getByRole('button', { name: 'Add note' }));
  expect(await within(section).findByRole('alert')).toHaveTextContent('We couldn’t save the note. Try again.');
  expect(within(section).getByLabelText('Add a private note')).toHaveValue('Keep me');
});

it('puts notes last on a phone and first in the right rail on a wide screen', async () => {
  mount();
  const section = await screen.findByRole('region', { name: 'Private notes' });
  expect(section.className).toContain('order-last');
  expect(section.className).toContain('lg:order-first');
});
