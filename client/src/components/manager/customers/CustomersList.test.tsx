import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ unread: [] as { chefId: number; locationId: number; unreadManagerCount: number }[] }));
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('@/i18n/manager', async () => ({ mt: (await import('./test-i18n')).createMt() }));
vi.mock('@/i18n', () => ({ default: { language: 'en-CA' } }));
vi.mock('@/services/chat-service', () => ({ getAllConversations: async () => h.unread }));

import { CustomersList } from './CustomersList';

const NEEDS = { code: 'booking_request', rank: 2, owner: 'you', deadlineAt: '2026-10-17T00:30:00.000Z', documentDays: null, documentKey: null, target: { kind: 'booking', id: 51 }, needsAction: true };
const QUIET = { code: 'none', rank: 11, owner: 'nobody', deadlineAt: null, documentDays: null, documentKey: null, target: null, needsAction: false };
const EXPIRING = { code: 'document_expiring', rank: 8, owner: 'customer', deadlineAt: null, documentDays: 6, documentKey: 'foodSafetyLicense', target: { kind: 'application', id: 3 }, needsAction: false };
const row = (overrides: Record<string, unknown>) => ({
  chefId: 7, name: 'Priya Sharma', businessName: 'Spice Route Catering', status: 'approved', next: NEEDS, needsAction: true, locationId: 47, timezone: 'America/St_Johns',
  locations: [{ locationId: 47, locationName: 'Harbour Kitchens', timezone: 'America/St_Johns', status: 'approved', next: NEEDS }],
  nextBooking: { bookingId: 51, locationId: 47, kitchenName: 'Main Kitchen', startsAt: '2026-10-20T13:30:00.000Z', endsAt: '2026-10-20T15:30:00.000Z', timezone: 'America/St_Johns', status: 'confirmed' },
  openItems: 1, lastActivityAt: '2026-10-15T12:00:00.000Z', ...overrides,
});
const counts = { all: 3, needs_action: 1, applied: 1, in_review: 0, approved: 2, suspended: 0, revoked: 0, former: 0, prospect: 0 };
const pageOne = {
  customers: [row({}), row({ chefId: 8, name: 'Ana Lima', businessName: 'Lima Empanadas', next: EXPIRING, needsAction: false, openItems: 0, nextBooking: null,
    locations: [{ locationId: 47, locationName: 'Harbour Kitchens', timezone: 'America/St_Johns', status: 'approved', next: EXPIRING }] })],
  counts, nextCursor: 'cursor-2', locations: [{ id: 47, name: 'Harbour Kitchens', timezone: 'America/St_Johns' }],
};
const pageTwo = { customers: [row({ chefId: 9, name: 'Sam Chen', businessName: null, status: 'applied', next: QUIET, needsAction: false, openItems: 0, nextBooking: null, locations: [{ locationId: 47, locationName: 'Harbour Kitchens', timezone: 'America/St_Johns', status: 'applied', next: QUIET }] })], counts, nextCursor: null, locations: pageOne.locations };

const calls: string[] = [];
let respond: (url: URL) => unknown | Promise<unknown> = () => pageOne;
const mount = (locations = [{ id: 47, name: 'Harbour Kitchens' }], selected: number | null = 47) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CustomersList locations={locations} selectedLocationId={selected} /></QueryClientProvider>);
};

beforeEach(() => {
  calls.length = 0; h.unread = [];
  window.history.replaceState({}, '', '/manager/dashboard?view=customers');
  respond = () => pageOne;
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    calls.push(input);
    const body = await respond(new URL(input, 'http://localhost'));
    return body instanceof Error ? { ok: false, status: 500, statusText: 'x', json: async () => ({ error: 'boom' }) } : { ok: true, status: 200, json: async () => body };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('lists people with status, whose turn it is, next booking in kitchen time with the zone in words, and links to the customer page', async () => {
  mount();
  const priya = (await screen.findByText('Priya Sharma')).closest('a')!;
  expect(priya).toHaveAttribute('href', '/manager/customers/7?location=47');
  expect(within(priya).getByText('Spice Route Catering')).toBeInTheDocument();
  expect(within(priya).getByText('Approved')).toBeInTheDocument();
  expect(within(priya).getByText(/^Your turn · Respond to a booking request by .*Newfoundland/)).toBeInTheDocument();
  // 13:30Z on 20 Oct is 11:00 in Newfoundland (UTC−2:30), never the browser's zone.
  expect(within(priya).getByText('Tue, Oct 20 · 11:00 a.m.–1:00 p.m. · Newfoundland Time')).toBeInTheDocument();
  expect(within(priya).getByText('Needs your action')).toBeInTheDocument();
  const ana = screen.getByText('Ana Lima').closest('a')!;
  expect(within(ana).getByText('Waiting for Ana Lima · Food safety certificate expires in 6 days')).toBeInTheDocument();
  expect(within(ana).getByText('No upcoming bookings')).toBeInTheDocument();
  expect(within(ana).queryByText('Needs your action')).not.toBeInTheDocument();
  expect(calls[0]).toBe('/api/manager/customers?status=all&sort=needs_action&locationId=47');
});

it('shows filter chips with counts as keyboard-operable toggle buttons, and a chosen filter reaches the server and the URL', async () => {
  mount();
  await screen.findByText('Priya Sharma');
  const group = screen.getByRole('group', { name: 'Filter customers by status' });
  expect(within(group).getByRole('button', { name: 'All 3' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(group).getByRole('button', { name: 'Needs action 1' })).toHaveAttribute('aria-pressed', 'false');
  expect(within(group).queryByRole('button', { name: /Suspended/ })).not.toBeInTheDocument();
  respond = () => ({ ...pageOne, customers: [pageOne.customers[0]], nextCursor: null });
  fireEvent.click(within(group).getByRole('button', { name: 'Applied 1' }));
  await waitFor(() => expect(calls.at(-1)).toContain('status=applied'));
  expect(window.location.search).toContain('status=applied');
  expect(within(group).getByRole('button', { name: 'Applied 1' })).toHaveAttribute('aria-pressed', 'true');
});

it('restores filters, search and sort from the URL (Back from a customer page lands on the same view)', async () => {
  window.history.replaceState({}, '', '/manager/dashboard?view=customers&status=in_review&q=marc&sort=name&location=all');
  mount([{ id: 47, name: 'Harbour Kitchens' }, { id: 48, name: 'West End' }]);
  await screen.findByText('Priya Sharma');
  expect(calls[0]).toBe('/api/manager/customers?status=in_review&sort=name&q=marc');
  expect(screen.getByLabelText('Search customers')).toHaveValue('marc');
});

it('searches on the server after typing pauses and keeps the term in the URL', async () => {
  mount();
  await screen.findByText('Priya Sharma');
  fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'lima' } });
  await waitFor(() => expect(calls.at(-1)).toContain('q=lima'));
  expect(window.location.search).toContain('q=lima');
});

it('loads more with the keyset cursor and keeps the pages together', async () => {
  respond = url => url.searchParams.get('cursor') === 'cursor-2' ? pageTwo : pageOne;
  mount();
  await screen.findByText('Priya Sharma');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Sam Chen')).toBeInTheDocument();
  expect(calls.at(-1)).toContain('cursor=cursor-2');
  expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  expect(window.location.search).toContain('pages=2');
});

it('merges unread messages by person and location into the open-items count', async () => {
  h.unread = [{ chefId: 7, locationId: 47, unreadManagerCount: 3 }, { chefId: 7, locationId: 99, unreadManagerCount: 5 }];
  mount();
  const priya = (await screen.findByText('Priya Sharma')).closest('a')!;
  await waitFor(() => expect(within(priya).getByText('4 open items')).toBeInTheDocument());
});

it.each([
  [{}, 'No customers at Harbour Kitchens yet. People appear here when they request a tour or apply.'],
  [{ status: 'in_review' }, 'No one is in review right now.'],
  [{ q: 'zzz' }, 'No customers match “zzz”.'],
])('shows the right empty state for %j', async (query, message) => {
  const params = new URLSearchParams(query as Record<string, string>);
  window.history.replaceState({}, '', `/manager/dashboard?view=customers&${params}`);
  respond = () => ({ customers: [], counts: { ...counts, all: 0 }, nextCursor: null, locations: pageOne.locations });
  mount();
  expect(await screen.findByText(message)).toBeInTheDocument();
});

it('offers to clear a search that finds no one', async () => {
  window.history.replaceState({}, '', '/manager/dashboard?view=customers&q=zzz');
  respond = () => ({ customers: [], counts: { ...counts, all: 0 }, nextCursor: null, locations: pageOne.locations });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Clear search' }));
  await waitFor(() => expect(screen.getByLabelText('Search customers')).toHaveValue(''));
});

it('says so and lets the manager retry when the list cannot load', async () => {
  respond = () => new Error('down');
  mount();
  expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent('We couldn’t load your customers. Try again.');
  respond = () => pageOne;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Priya Sharma')).toBeInTheDocument();
});

it('with several locations, offers All locations and shows a status chip per location', async () => {
  respond = () => ({ ...pageOne, customers: [row({ locations: [
    { locationId: 47, locationName: 'Harbour Kitchens', timezone: 'America/St_Johns', status: 'approved', next: NEEDS },
    { locationId: 48, locationName: 'West End', timezone: 'America/Toronto', status: 'in_review', next: NEEDS },
  ] })], nextCursor: null });
  window.history.replaceState({}, '', '/manager/dashboard?view=customers&location=all');
  mount([{ id: 47, name: 'Harbour Kitchens' }, { id: 48, name: 'West End' }]);
  expect(await screen.findByText('Approved at Harbour Kitchens')).toBeInTheDocument();
  expect(screen.getByText('In review at West End')).toBeInTheDocument();
  expect(screen.getByLabelText('Location')).toBeInTheDocument();
  expect(calls[0]).not.toContain('locationId');
});

it("a customer the kitchen added reads 'Added', not 'Applied'", async () => {
  respond = () => ({ ...pageTwo, customers: [row({ ...pageTwo.customers[0], locations: [pageTwo.customers[0].locations[0]], addedByKitchen: true })] });
  mount();
  const sam = (await screen.findByText('Sam Chen')).closest('a')!;
  expect(within(sam).getByText('Added')).toBeInTheDocument();
  expect(within(sam).queryByText('Applied')).not.toBeInTheDocument();
});
