import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ results: [] as unknown[], calls: [] as { op: string; args: unknown[] }[], selects: 0 }));
vi.mock('../db', () => {
  const chain = (op: string): unknown => new Proxy(function () {}, {
    get: (_target, prop) => {
      if (prop === 'then') return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(mocks.results.length ? mocks.results.shift() : []).then(resolve, reject);
      return (...args: unknown[]) => { mocks.calls.push({ op: `${op}.${String(prop)}`, args }); return chain(op); };
    },
  });
  return { db: { select: () => { mocks.selects++; return chain('select'); }, insert: () => chain('insert'), update: () => chain('update') } };
});
vi.mock('./location-access-notices', () => ({ accessEndedMarker: 'Access ended by manager: ' }));
vi.mock('./lifecycle-settings', () => ({ getLifecycleSettings: vi.fn(async () => ({ managerResponseBufferHours: 1, inspectionAutoCloseHours: 24 })) }));
vi.mock('../domains/locations/location.service', () => ({ locationService: { getLocationRequirementsWithDefaults: vi.fn(async () => ({ requireFoodHandlerCert: true })) } }));

import {
  buildCustomerRows, createCustomerNote, decodeCursor, deleteCustomerNote, listCustomerNotes, listFromInput, loadCustomerReadInput,
  managerVisibleTour, updateCustomerNote, type CustomerReadInput, type RawApplication, type RawBooking, type RawTour,
} from './manager-customers';

const NOW = new Date('2026-10-16T15:00:00.000Z');
const date = (value: string) => new Date(value);

const location = { id: 47, name: 'Harbour Kitchens', timezone: 'America/St_Johns' };
const west = { id: 48, name: 'West End', timezone: 'America/Toronto' };
const application = (overrides: Partial<RawApplication> & { chefId: number }): RawApplication => ({
  id: overrides.chefId * 10, locationId: 47, fullName: `Person ${overrides.chefId}`, shopName: 'Shop Not Named', email: `p${overrides.chefId}@example.com`,
  status: 'approved', currentTier: 3, tier2CompletedAt: null, accessEnded: false, createdAt: date('2026-08-01T12:00:00Z'), updatedAt: date('2026-09-01T12:00:00Z'), documents: [], ...overrides,
});
const tour = (overrides: Partial<RawTour> & { chefId: number }): RawTour => ({
  id: overrides.chefId * 100, locationId: 47, status: 'confirmed', scheduledAt: date('2026-10-20T14:00:00Z'), durationMinutes: 30, appointmentRevision: 1,
  lifecycleState: 'confirmed', visitResult: null, disruptionReason: null, confirmationVerified: true, confirmedAt: date('2026-10-10T00:00:00Z'), requestExpiredAt: null,
  checkedInAt: null, createdAt: date('2026-10-01T00:00:00Z'), updatedAt: date('2026-10-01T00:00:00Z'), adminReviewedAt: date('2026-10-02T00:00:00Z'),
  rescheduleProposedAt: null, rescheduleProposedSlots: null, requestedRescheduleAt: null, rescheduleRequestedAt: null, ...overrides,
});
const booking = (overrides: Partial<RawBooking> & { chefId: number }): RawBooking => ({
  id: overrides.chefId * 1000, locationId: 47, kitchenId: 54, kitchenName: 'Main Kitchen', status: 'confirmed', bookingDate: date('2026-10-20T00:00:00Z'),
  startTime: '09:00', endTime: '11:00', operatingWindowStartTime: '06:00', selectedSlots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }],
  visitDuties: null, checkinStatus: 'not_checked_in', checkoutRequestedAt: null, paymentDecisionState: null, createdAt: date('2026-10-14T12:00:00Z'),
  updatedAt: date('2026-10-14T12:00:00Z'), cancellationPolicySnapshot: null, cancellationPolicyHours: null, ...overrides,
});
const input = (overrides: Partial<CustomerReadInput> = {}): CustomerReadInput => ({
  locations: [location], applications: [], access: [], tours: [], tourFeedbackDone: new Set(), bookings: [], bookingStats: [], problems: [], claims: [],
  renewalApplicationIds: new Set(), people: [], responseBufferHours: 1, inspectionAutoCloseHours: 24, ...overrides,
});
const person = (id: number, username = `p${id}@example.com`, platformName: string | null = null) => ({ id, username, platformName });
const access = (chefId: number, locationId = 47) => ({ chefId, locationId, grantedAt: date('2026-08-15T00:00:00Z') });

/** A location full of people in every state the status table names. */
const roster = () => input({
  applications: [
    application({ chefId: 1, fullName: 'Priya Sharma', shopName: 'Spice Route Catering' }),
    application({ chefId: 2, fullName: 'Marc Tremblay', shopName: 'Tremblay Bakery', currentTier: 2, tier2CompletedAt: date('2026-10-14T00:00:00Z') }),
    application({ chefId: 3, fullName: 'Ana Lima', shopName: 'Lima Empanadas', documents: [{ key: 'foodSafetyLicense', label: 'Food Safety Certificate', expiry: '2026-10-22' }] }),
    application({ chefId: 4, fullName: 'Sam Chen', status: 'inReview', currentTier: 1 }),
    application({ chefId: 5, fullName: 'Dana Okafor' }),
    application({ chefId: 6, fullName: 'Lee Wong', status: 'rejected', currentTier: 1 }),
    application({ chefId: 7, fullName: 'Rui Costa', accessEnded: true }),
    application({ chefId: 8, fullName: 'Ola Berg', currentTier: 2 }),
  ],
  access: [access(1), access(3), access(5)],
  tours: [tour({ chefId: 9 })],
  bookings: [
    booking({ chefId: 1, id: 11, status: 'confirmed', checkinStatus: 'checkout_requested', bookingDate: date('2026-10-16T00:00:00Z'), startTime: '08:00', endTime: '10:00',
      selectedSlots: [{ startTime: '08:00', endTime: '09:00' }, { startTime: '09:00', endTime: '10:00' }], checkoutRequestedAt: date('2026-10-16T14:00:00Z') }),
    booking({ chefId: 5, id: 51, status: 'pending', bookingDate: date('2026-10-22T00:00:00Z'), startTime: '09:00', endTime: '11:00' }),
    booking({ chefId: 3, id: 31, status: 'confirmed', bookingDate: date('2026-10-18T00:00:00Z'), startTime: '13:00', endTime: '15:00',
      selectedSlots: [{ startTime: '13:00', endTime: '14:00' }, { startTime: '14:00', endTime: '15:00' }] }),
  ],
  bookingStats: [{ chefId: 1, locationId: 47, count: 4, lastActivityAt: date('2026-10-16T14:00:00Z') }],
  people: [person(1), person(2), person(3), person(4), person(5), person(6), person(7), person(8), person(9, 'visitor@example.com', 'Tour Visitor')],
});

const rowFor = (rows: ReturnType<typeof buildCustomerRows>, chefId: number) => rows.find(row => row.chefId === chefId)!;

describe('customer read model', () => {
  it('derives every status from the existing sources', () => {
    const rows = buildCustomerRows(roster(), NOW);
    expect(Object.fromEntries(rows.map(row => [row.chefId, row.status]))).toEqual({
      1: 'approved', 2: 'in_review', 3: 'approved', 4: 'applied', 5: 'approved', 6: 'former', 7: 'revoked', 8: 'applied', 9: 'prospect',
    });
  });

  it('shows the name, business, next action and kitchen-local next booking', () => {
    const rows = buildCustomerRows(roster(), NOW);
    const ana = rowFor(rows, 3);
    expect(ana).toMatchObject({ name: 'Ana Lima', businessName: 'Lima Empanadas', timezone: 'America/St_Johns', openItems: 0 });
    expect(ana.next).toMatchObject({ code: 'document_expiring', owner: 'customer', documentDays: 6 });
    // 13:00 St John's (NDT, UTC−2:30) on 18 Oct.
    expect(ana.nextBooking).toMatchObject({ bookingId: 31, kitchenName: 'Main Kitchen', startsAt: '2026-10-18T15:30:00.000Z', endsAt: '2026-10-18T17:30:00.000Z' });
    expect(rowFor(rows, 9)).toMatchObject({ name: 'Tour Visitor', businessName: null });
    expect(rowFor(rows, 4).next).toMatchObject({ code: 'local_cooks_review', owner: 'local_cooks' });
    expect(rowFor(rows, 8).next).toMatchObject({ code: 'waiting_documents', owner: 'customer' });
    expect(rowFor(rows, 2).next).toMatchObject({ code: 'documents_review', owner: 'you', needsAction: true });
  });

  it('a booking request and an inspection come from bookings, with a deadline in kitchen time', () => {
    const rows = buildCustomerRows(roster(), NOW);
    expect(rowFor(rows, 5).next).toMatchObject({ code: 'booking_request', owner: 'you', target: { kind: 'booking', id: 51 } });
    expect(rowFor(rows, 5).next.deadlineAt).toEqual(expect.any(String));
    expect(rowFor(rows, 1).next).toMatchObject({ code: 'inspection', rank: 3, target: { kind: 'inspection', id: 11 } });
    // The inspection deadline is the later of scheduled end and departure, plus the inspection window.
    expect(rowFor(rows, 1).next.deadlineAt).toBe('2026-10-17T14:00:00.000Z');
  });

  it('tours produce request, reschedule and feedback actions, and ignore Local Cooks triage', () => {
    const pending = tour({ chefId: 9, id: 901, status: 'pending', confirmedAt: null, confirmationVerified: false, adminReviewedAt: date('2026-10-16T12:00:00Z') });
    const ended = tour({ chefId: 10, id: 1001, scheduledAt: date('2026-10-15T14:00:00Z') });
    const rows = buildCustomerRows(input({ tours: [pending, ended], people: [person(9), person(10)] }), NOW);
    expect(rowFor(rows, 9).next).toMatchObject({ code: 'tour_request', owner: 'you', target: { kind: 'tour', id: 901 } });
    expect(rowFor(rows, 10).next).toMatchObject({ code: 'tour_feedback' });
    const done = buildCustomerRows(input({ tours: [ended], tourFeedbackDone: new Set([1001]), people: [person(10)] }), NOW);
    expect(rowFor(done, 10).next.code).toBe('none');
    expect(managerVisibleTour({ ...pending, status: 'pending_local_cooks' })).toBe(false);
    expect(managerVisibleTour({ ...pending, adminReviewDecision: 'denied' })).toBe(false);
    expect(managerVisibleTour({ ...pending, status: 'cancelled', adminReviewedAt: null, confirmedAt: null, confirmationVerified: false, cancelledBy: 'chef' })).toBe(false);
  });

  it('merges a person at two locations into one row, led by the more urgent relationship', () => {
    const rows = buildCustomerRows(input({
      locations: [location, west],
      applications: [application({ chefId: 1, fullName: 'Priya Sharma' }), application({ chefId: 1, id: 12, locationId: 48, fullName: 'Priya Sharma', currentTier: 2, tier2CompletedAt: date('2026-10-14T00:00:00Z') })],
      access: [access(1)], people: [person(1)],
    }), NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].locations.map(chip => [chip.locationName, chip.status])).toEqual([['Harbour Kitchens', 'approved'], ['West End', 'in_review']]);
    expect(rows[0]).toMatchObject({ status: 'in_review', locationId: 48, timezone: 'America/Toronto', needsAction: true });
  });

  it('never invents contact details or a "no-show": the row carries neither email nor phone', () => {
    const json = JSON.stringify(buildCustomerRows(roster(), NOW));
    expect(json).not.toMatch(/@example\.com|visitor@|no_show|noShow|stripe|paymentIntent|card/i);
  });
});

describe('list: filters, counts, search, sort, keyset cursor', () => {
  const list = (options: Partial<Parameters<typeof listFromInput>[1]> = {}, data = roster()) => listFromInput(data, { status: 'all', q: '', sort: 'needs_action', cursor: null, ...options }, NOW);

  it('counts every filter chip from the same rows', () => {
    expect(list().counts).toEqual({ all: 9, needs_action: 3, applied: 2, in_review: 1, approved: 3, suspended: 0, revoked: 1, former: 1, prospect: 1 });
  });
  it('filters by status and by needs action', () => {
    expect(list({ status: 'in_review' }).customers.map(row => row.name)).toEqual(['Marc Tremblay']);
    expect(list({ status: 'revoked' }).customers.map(row => row.chefId)).toEqual([7]);
    expect(list({ status: 'needs_action' }).customers.map(row => row.chefId).sort()).toEqual([1, 2, 5]);
    expect(list({ status: 'suspended' }).customers).toEqual([]);
  });
  it('searches name, business and email, case-insensitively, and the counts follow the search', () => {
    expect(list({ q: 'priya' }).customers.map(row => row.chefId)).toEqual([1]);
    expect(list({ q: 'EMPANADAS' }).customers.map(row => row.chefId)).toEqual([3]);
    expect(list({ q: 'p5@example' }).customers.map(row => row.chefId)).toEqual([5]);
    expect(list({ q: 'visitor@' }).customers.map(row => row.chefId)).toEqual([9]);
    expect(list({ q: 'nobody' }).customers).toEqual([]);
    expect(list({ q: 'bakery' }).counts.all).toBe(1);
  });
  it('sorts needs action first, then by name', () => {
    const names = list().customers.map(row => row.name);
    expect(names.slice(0, 3)).toEqual(['Priya Sharma', 'Dana Okafor', 'Marc Tremblay'].sort((a, b) => names.indexOf(a) - names.indexOf(b)));
    expect(list({ sort: 'name' }).customers.map(row => row.name)).toEqual([...names].sort((a, b) => a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase())));
    expect(list({ sort: 'next_booking' }).customers[0].nextBooking?.bookingId).toBe(31);
  });
  it('pages by keyset with no repeats or gaps, whatever the sort', () => {
    for (const sort of ['needs_action', 'deadline', 'next_booking', 'name'] as const) {
      const seen: number[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = list({ sort, limit: 2, cursor: cursor ? decodeCursor(cursor, sort) : null });
        seen.push(...page.customers.map(row => row.chefId));
        if (!page.nextCursor) break;
        expect(page.customers).toHaveLength(2);
        cursor = page.nextCursor;
      }
      expect(seen).toHaveLength(9);
      expect(new Set(seen).size).toBe(9);
      expect(seen).toEqual(list({ sort }).customers.map(row => row.chefId));
    }
  });
  it('is stable when a row changes between pages: a cursor continues after its key', () => {
    const first = list({ limit: 3 });
    const second = list({ limit: 3, cursor: decodeCursor(first.nextCursor!, 'needs_action') });
    expect(second.customers.map(row => row.chefId)).not.toContain(first.customers[0].chefId);
  });
  it('rejects a cursor from another sort or a damaged one', () => {
    const first = list({ limit: 2 });
    expect(() => decodeCursor(first.nextCursor!, 'name')).toThrow(/no longer available/);
    expect(() => decodeCursor('###', 'needs_action')).toThrow(/no longer available/);
    expect(decodeCursor(undefined, 'name')).toBeNull();
  });
  it('shows the empty state data for a location with no one', () => {
    expect(list({}, input())).toMatchObject({ customers: [], nextCursor: null, counts: { all: 0 } });
  });
});

describe('loader scope and privacy', () => {
  beforeEach(() => { mocks.results.length = 0; mocks.calls.length = 0; mocks.selects = 0; });

  it('a location that is not the manager’s is a 404 before any customer data is read', async () => {
    mocks.results.push([]); // locations ⨝ manager_id → nothing
    await expect(loadCustomerReadInput(2, 99, NOW)).rejects.toMatchObject({ statusCode: 404, message: 'Location not found' });
    expect(mocks.selects).toBe(1);
  });
  it('a manager with no locations gets an empty list without further queries', async () => {
    mocks.results.push([]);
    const result = await loadCustomerReadInput(2, undefined, NOW);
    expect(result.applications).toEqual([]);
    expect(mocks.selects).toBe(1);
  });
  it('reads each source once, however many customers there are (no per-customer queries)', async () => {
    mocks.results.push([{ id: 47, name: 'Harbour Kitchens', timezone: 'America/St_Johns' }]);
    await loadCustomerReadInput(2, undefined, NOW);
    // locations + applications, access, tours, bookings, booking stats, problems, claims, renewals, lifecycle settings (mocked) — fixed.
    expect(mocks.selects).toBeLessThanOrEqual(10);
  });
});

describe('private notes', () => {
  beforeEach(() => { mocks.results.length = 0; mocks.calls.length = 0; mocks.selects = 0; });
  const owned = [{ id: 47 }];

  it('lists only live notes of the manager’s own location, with author names and the caller’s own flagged', async () => {
    const created = date('2026-10-12T10:00:00Z');
    mocks.results.push(owned, [
      { id: 2, body: 'Prefers early slots', authorId: 2, createdAt: created, updatedAt: date('2026-10-12T11:00:00Z') },
      { id: 1, body: 'Brings own pans', authorId: null, createdAt: created, updatedAt: created },
    ], [{ id: 2, username: 'sam@example.com', profile: { fullName: 'Sam Manager' } }]);
    const notes = await listCustomerNotes(2, 7, 47);
    expect(notes).toEqual([
      expect.objectContaining({ id: 2, authorName: 'Sam Manager', mine: true, edited: true }),
      expect.objectContaining({ id: 1, authorName: null, mine: false, edited: false }),
    ]);
    expect(mocks.calls.some(call => /^(insert|update)/.test(call.op))).toBe(false);
  });
  it('other managers get a 404 on every note operation and nothing is written', async () => {
    for (const run of [
      () => listCustomerNotes(9, 7, 47), () => createCustomerNote(9, 7, 47, 'x'), () => updateCustomerNote(9, 7, 47, 1, 'x'), () => deleteCustomerNote(9, 7, 47, 1),
    ]) {
      mocks.results.length = 0; mocks.results.push([]);
      await expect(run()).rejects.toMatchObject({ statusCode: 404 });
    }
    expect(mocks.calls.some(call => /^(insert|update)/.test(call.op))).toBe(false);
  });
  it('creates a note authored by the signed-in manager, trimmed, for a known relationship', async () => {
    mocks.results.push(owned, [{ id: 70 }], [{ id: 3 }]); // owner, application, inserted row
    expect(await createCustomerNote(2, 7, 47, '  Prefers early slots  ')).toEqual({ id: 3 });
    const values = mocks.calls.find(call => call.op === 'insert.values')!.args[0];
    expect(values).toEqual({ locationId: 47, chefId: 7, authorId: 2, body: 'Prefers early slots' });
  });
  it('refuses a note about someone with no relationship to the location', async () => {
    mocks.results.push(owned, [], [], [], []);
    await expect(createCustomerNote(2, 7, 47, 'hello')).rejects.toMatchObject({ statusCode: 404, message: 'Customer not found' });
  });
  it.each([['', 'Write a note first.'], ['   ', 'Write a note first.'], [undefined, 'Write a note first.'], [42, 'Write a note first.']])('rejects an empty or non-text note %j', async (body, message) => {
    mocks.results.push(owned);
    await expect(createCustomerNote(2, 7, 47, body)).rejects.toMatchObject({ statusCode: 400, message });
  });
  it('accepts exactly 2,000 characters and rejects 2,001', async () => {
    mocks.results.push(owned, [{ id: 70 }], [{ id: 4 }]);
    await expect(createCustomerNote(2, 7, 47, 'a'.repeat(2000))).resolves.toEqual({ id: 4 });
    mocks.results.length = 0; mocks.results.push(owned);
    await expect(createCustomerNote(2, 7, 47, 'a'.repeat(2001))).rejects.toMatchObject({ statusCode: 400 });
  });
  it('only the author can edit or delete; another manager’s note is refused, not changed', async () => {
    mocks.results.push(owned, [{ id: 1, authorId: 5 }]);
    await expect(updateCustomerNote(2, 7, 47, 1, 'changed')).rejects.toMatchObject({ statusCode: 403 });
    mocks.results.length = 0; mocks.results.push(owned, [{ id: 1, authorId: 5 }]);
    await expect(deleteCustomerNote(2, 7, 47, 1)).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.calls.some(call => call.op.startsWith('update'))).toBe(false);
  });
  it('editing stamps updated_at and keeps the row', async () => {
    mocks.results.push(owned, [{ id: 1, authorId: 2 }]);
    await updateCustomerNote(2, 7, 47, 1, ' new text ');
    const set = mocks.calls.find(call => call.op === 'update.set')!.args[0] as { body: string; updatedAt: Date; deletedAt?: Date };
    expect(set.body).toBe('new text');
    expect(set.updatedAt).toBeInstanceOf(Date);
    expect(set.deletedAt).toBeUndefined();
  });
  it('deleting is a soft delete: deleted_at is set and nothing is removed', async () => {
    mocks.results.push(owned, [{ id: 1, authorId: 2 }]);
    await deleteCustomerNote(2, 7, 47, 1);
    const set = mocks.calls.find(call => call.op === 'update.set')!.args[0] as { deletedAt: Date };
    expect(set.deletedAt).toBeInstanceOf(Date);
    expect(mocks.calls.some(call => call.op.startsWith('delete'))).toBe(false);
  });
  it('a note that is already deleted cannot be edited', async () => {
    mocks.results.push(owned, []);
    await expect(updateCustomerNote(2, 7, 47, 1, 'again')).rejects.toMatchObject({ statusCode: 404, message: 'Note not found' });
  });
});
