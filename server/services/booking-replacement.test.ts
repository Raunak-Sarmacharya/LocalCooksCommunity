import { beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny in-memory database that understands the eq/and/sql(->>) conditions this service writes.
const h = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, next: 1000, decide: vi.fn(), queue: vi.fn(), deliver: vi.fn(async () => ({})) }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: h.queue, deliverBookingLifecycleEvents: h.deliver }));
vi.mock('./booking-payment-decision', () => ({ decideAuthorizedBooking: h.decide }));
vi.mock('./booking-response-deadline', () => ({ getBookingResponseDeadline: async () => new Date('2099-01-01T15:00:00Z') }));
vi.mock('../db', () => {
  const camel = (name: string) => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  const tableName = (table: any) => table[Symbol.for('drizzle:Name')] as string;
  /** Flatten a drizzle condition into (column, optional json key, value) checks. */
  const checks = (condition: any): Array<{ column: string; key?: string; value: unknown }> => {
    const out: Array<{ column: string; key?: string; value: unknown }> = [];
    const walk = (node: any) => {
      const chunks: any[] = node?.queryChunks ?? [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk?.queryChunks) { walk(chunk); continue; }
        if (chunk && typeof chunk === 'object' && 'columnType' in chunk) {
          let key: string | undefined, j = i + 1;
          const text = chunks[j]?.value?.join?.('') as string | undefined;
          const json = text && /->>'(\w+)'/.exec(text);
          if (json) key = json[1];
          while (j < chunks.length && chunks[j]?.constructor?.name !== 'Param') j++;
          if (chunks[j]) out.push({ column: camel(chunk.name), key, value: chunks[j].value });
        }
      }
    };
    walk(condition);
    return out;
  };
  const matches = (row: any, condition: any) => checks(condition).every(check => {
    const actual = check.key ? row[check.column]?.[check.key] : row[check.column];
    return String(actual) === String(check.value);
  });
  const db: any = {
    select: (fields?: Record<string, any>) => {
      let table = '', filter: any, joined: string | undefined, order = false;
      const q: any = {
        from: (value: any) => { table = tableName(value); return q; },
        innerJoin: (value: any) => { joined = tableName(value); return q; },
        where: (condition: any) => { filter = condition; return q; },
        orderBy: () => { order = true; return q; },
        limit: () => q, for: () => q,
        then: (resolve: any, reject: any) => {
          let rows = (h.rows[table] || []).filter(row => !filter || matches(row, filter));
          if (order) rows = [...rows].reverse();
          const extra = joined ? h.rows[joined]?.[0] : undefined;
          const isTable = (value: any) => !!value?.[Symbol.for('drizzle:Name')];
          const shaped = fields ? rows.map(row => Object.fromEntries(Object.entries(fields).map(([key, column]: [string, any]) =>
            [key, isTable(column) ? row : column?.table && tableName(column.table) === table ? row[camel(column.name)] : extra?.[camel(column.name)] ?? row[camel(column.name)]]))) : rows;
          return Promise.resolve(shaped).then(resolve, reject);
        },
      };
      return q;
    },
    insert: (table: any) => ({ values: (data: any) => { (h.rows[tableName(table)] ||= []).push({ id: h.next++, createdAt: new Date(), ...data }); return Promise.resolve(); } }),
    update: (table: any) => ({ set: (values: any) => ({ where: async (condition: any) => {
      for (const row of h.rows[tableName(table)] || []) if (matches(row, condition)) Object.assign(row, values);
    } }) }),
    transaction: async (work: any) => {
      const snapshot = structuredClone(h.rows);
      try { return await work(db); }
      catch (error) { h.rows = snapshot; throw error; }
    },
  };
  return { db };
});

import { assertReplaceableRequest, completeReplacement, completeReplacementSafely, readReplacementOutcome, replacesBookingIdFrom, ReplacementError } from './booking-replacement';

const pendingOld = () => ({ id: 10, chefId: 3, kitchenId: 4, referenceCode: 'KB-OLD', status: 'pending', paymentStatus: 'authorized', paymentDecision: null,
  bookingDate: new Date('2099-01-01T12:00:00Z'), startTime: '10:00', endTime: '11:00' });
const newRequest = () => ({ id: 11, chefId: 3, kitchenId: 4, referenceCode: 'KB-NEW', status: 'pending', paymentStatus: 'authorized', paymentDecision: null,
  bookingDate: new Date('2099-01-01T12:00:00Z'), startTime: '10:00', endTime: '12:00' });
const statusEvents = () => h.rows.booking_lifecycle_events.filter(row => row.kind === 'replacement_status');
const withdrawOk = () => h.decide.mockImplementation(async (id: number, _target: string, _a: unknown, _b: unknown, _actor: number, _expiry: unknown, options: any) => {
  Object.assign(h.rows.kitchen_bookings.find(row => row.id === id), { status: 'cancelled', paymentStatus: 'failed',
    paymentDecision: { target: 'cancelled', state: 'complete', replacedBy: options.replacedBy } });
});

beforeEach(() => {
  vi.clearAllMocks(); h.decide.mockReset(); h.next = 1000;
  h.rows = { kitchen_bookings: [pendingOld(), newRequest()], kitchens: [{ id: 4, name: 'Fixture Kitchen' }], booking_lifecycle_events: [] };
});

describe('checking a request can be changed (before any checkout session exists)', () => {
  it('accepts the chef’s own undecided request for the same kitchen', async () => {
    await expect(assertReplaceableRequest(10, 3, 4)).resolves.toMatchObject({ id: 10 });
  });
  it.each([
    ['another chef’s request', () => 99, 404],
    ['a different kitchen', () => 3, 409],
  ])('refuses %s with a plain message', async (_name, _setup, status) => {
    const [chefId, kitchenId] = status === 404 ? [99, 4] : [3, 7];
    await expect(assertReplaceableRequest(10, chefId, kitchenId)).rejects.toMatchObject({ status, message: expect.any(String) });
  });
  it.each([
    ['accepted', { status: 'confirmed' }],
    ['declined or expired', { status: 'cancelled' }],
    ['being answered right now', { paymentDecision: { target: 'confirmed', state: 'pending' } }],
  ])('refuses a request that is %s, naming the kitchen and what to do', async (_name, patch) => {
    Object.assign(h.rows.kitchen_bookings[0], patch);
    const error = await assertReplaceableRequest(10, 3, 4).catch(e => e);
    expect(error).toBeInstanceOf(ReplacementError);
    expect(error.status).toBe(409);
    expect(error.message).toContain('Fixture Kitchen');
    expect(error.message).toMatch(/Book a new time/);
    expect(error.message).not.toMatch(/pi_|cs_|stripe/i);
  });
  it('reads the replaced request id only from valid session metadata', () => {
    expect(replacesBookingIdFrom({ replaces_booking_id: '10' })).toBe(10);
    for (const value of [undefined, '', '0', '-3', '1.5', 'abc']) expect(replacesBookingIdFrom({ replaces_booking_id: value })).toBeUndefined();
  });
});

describe('finishing a replacement after the new request exists', () => {
  it('withdraws the earlier request through the chef-withdraw path and records both history links once', async () => {
    withdrawOk();
    expect(await completeReplacement(11, 10)).toBe('withdrawn');
    expect(h.decide).toHaveBeenCalledWith(10, 'cancelled', [], [], 3, undefined, { replacedBy: { bookingId: 11, reference: 'KB-NEW', deadlineAt: '2099-01-01T15:00:00.000Z' }, proposalOutcome: 'closed' });
    // The same cancellation fields as the chef's own withdraw, with a stable operation key.
    expect(h.rows.kitchen_bookings[0]).toMatchObject({ status: 'cancelled', cancellationCause: 'chef', cancellationOperationKey: 'chef-withdraw-10-replaced-11' });
    const links = h.rows.booking_lifecycle_events.filter(row => ['replaced_by', 'replaces'].includes(row.kind));
    expect(links).toHaveLength(2);
    expect(links.find(row => row.kind === 'replaced_by')).toMatchObject({ bookingId: 10, metadata: { otherBookingId: 11, otherRef: 'KB-NEW' }, emails: [] });
    expect(links.find(row => row.kind === 'replaces')).toMatchObject({ bookingId: 11, metadata: { otherBookingId: 10, otherRef: 'KB-OLD' }, emails: [] });
    // Link rows are history only: finished at birth so no mail or notice is ever sent from them.
    expect(links.every(row => row.completedAt instanceof Date)).toBe(true);
    // No separate chef or kitchen notice here: the withdrawal notice is queued with the hold release (booking-payment-decision).
    expect(h.queue).not.toHaveBeenCalled();
  });

  it('is idempotent under webhook replay: no second withdrawal, link rows or status', async () => {
    withdrawOk();
    await completeReplacement(11, 10);
    expect(await completeReplacement(11, 10)).toBe('withdrawn');
    expect(await completeReplacementSafely(11, 10)).toBe('withdrawn');
    expect(h.decide).toHaveBeenCalledTimes(1);
    expect(h.rows.booking_lifecycle_events.filter(row => ['replaced_by', 'replaces'].includes(row.kind))).toHaveLength(2);
    expect(statusEvents()).toHaveLength(1);
  });

  it('resumes a replay that crashed after the withdrawal started (decision already recorded for this pair)', async () => {
    // First delivery recorded the decision but the process died before the status was saved.
    Object.assign(h.rows.kitchen_bookings[0], { paymentDecision: { target: 'cancelled', state: 'pending', replacedBy: { bookingId: 11, reference: 'KB-NEW' } } });
    withdrawOk();
    expect(await completeReplacement(11, 10)).toBe('withdrawn');
    expect(h.decide).toHaveBeenCalledTimes(1);
  });

  it('race: the kitchen accepted the original first, so it is never withdrawn and the chef is told plainly', async () => {
    Object.assign(h.rows.kitchen_bookings[0], { status: 'confirmed', paymentStatus: 'paid' });
    expect(await completeReplacement(11, 10)).toBe('two_bookings');
    expect(h.decide).not.toHaveBeenCalled();
    expect(h.rows.kitchen_bookings[0].status).toBe('confirmed');
    expect(h.rows.booking_lifecycle_events.some(row => ['replaced_by', 'replaces'].includes(row.kind))).toBe(false);
    expect(h.queue).toHaveBeenCalledTimes(1);
    const [, bookingId, kind, , message, actor, metadata] = h.queue.mock.calls[0];
    expect([bookingId, kind, actor]).toEqual([11, 'request_replacement_update', 3]);
    expect(metadata).toMatchObject({ recipientPolicy: 'chef', replacementNotice: { variant: 'two_bookings', oldRef: 'KB-OLD', newRef: 'KB-NEW' } });
    expect(message).toMatch(/two bookings/i);
    expect(await readReplacementOutcome(11, 3)).toMatchObject({ outcome: 'two_bookings', oldBookingId: 10, oldReference: 'KB-OLD', newReference: 'KB-NEW', kitchenName: 'Fixture Kitchen' });
  });

  it('race: the kitchen is mid-acceptance (decision recorded) so the earlier request is left alone', async () => {
    Object.assign(h.rows.kitchen_bookings[0], { paymentDecision: { target: 'confirmed', state: 'pending' } });
    expect(await completeReplacement(11, 10)).toBe('two_bookings');
    expect(h.decide).not.toHaveBeenCalled();
  });

  it.each(['decline', 'expiry'])('a %s still releasing its hold is never described as acceptance and is refreshed after it ends', async () => {
    Object.assign(h.rows.kitchen_bookings[0], { paymentDecision: { target: 'cancelled', state: 'pending' } });
    expect(await completeReplacement(11, 10)).toBe('releasing');
    expect(h.decide).not.toHaveBeenCalled();
    expect(h.queue).not.toHaveBeenCalled();
    h.rows.kitchen_bookings[0].status = 'cancelled';
    expect(await completeReplacement(11, 10)).toBe('ended');
    expect(h.queue.mock.calls[0][6].replacementNotice.variant).toBe('ended');
  });

  it.each(['confirmed', 'cancelled'])('rolls back a terminal outcome when its durable notice fails (%s), then retries it', async status => {
    h.rows.kitchen_bookings[0].status = status;
    h.queue.mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(completeReplacement(11, 10)).rejects.toThrow('outbox unavailable');
    expect(statusEvents()).toHaveLength(0);
    expect(await completeReplacement(11, 10)).toBe(status === 'confirmed' ? 'two_bookings' : 'ended');
    expect(statusEvents()).toHaveLength(1);
    expect(h.queue).toHaveBeenCalledTimes(2);
  });

  it('parks a captured-before-release decision for support and makes no further payment attempt', async () => {
    Object.assign(h.rows.kitchen_bookings[0], { paymentStatus: 'paid', paymentDecision: { target: 'cancelled', state: 'pending',
      replacedBy: { bookingId: 11, reference: 'KB-NEW' }, deadEnd: { kind: 'captured_before_release' } } });
    expect(await completeReplacement(11, 10)).toBe('needs_support');
    expect(h.decide).not.toHaveBeenCalled();
    expect(await readReplacementOutcome(11, 3)).toMatchObject({ outcome: 'needs_support' });
  });

  it('uses neutral recovery wording when the earlier request has no public reference', async () => {
    h.rows.kitchen_bookings[0].referenceCode = null;
    h.decide.mockRejectedValueOnce(new Error('database unavailable'));
    expect(await completeReplacement(11, 10)).toBe('releasing');
    expect(h.queue.mock.calls[0][4]).toContain('your earlier request yet');
    expect(h.queue.mock.calls[0][4]).not.toMatch(/#10|booking 10|request 10/);
  });

  it.each([['expired or declined', { status: 'cancelled', paymentStatus: 'failed' }]])('earlier request already %s: nothing to withdraw, new request is normal', async (_name, patch) => {
    Object.assign(h.rows.kitchen_bookings[0], patch);
    expect(await completeReplacement(11, 10)).toBe('ended');
    expect(h.decide).not.toHaveBeenCalled();
    expect(h.queue.mock.calls[0][6]).toMatchObject({ recipientPolicy: 'chef', replacementNotice: { variant: 'ended' } });
    expect(h.rows.booking_lifecycle_events.some(row => ['replaced_by', 'replaces'].includes(row.kind))).toBe(false);
  });

  it('abandoned checkout: with no new request nothing is touched', async () => {
    h.rows.kitchen_bookings = [pendingOld()];
    expect(await completeReplacement(11, 10)).toBeNull();
    expect(h.decide).not.toHaveBeenCalled();
    expect(h.rows.kitchen_bookings[0].status).toBe('pending');
  });

  it('a request that is not the same chef’s or kitchen’s is never withdrawn', async () => {
    h.rows.kitchen_bookings[0].chefId = 99;
    expect(await completeReplacement(11, 10)).toBeNull();
    h.rows.kitchen_bookings[0].chefId = 3; h.rows.kitchen_bookings[0].kitchenId = 8;
    expect(await completeReplacement(11, 10)).toBeNull();
    expect(h.decide).not.toHaveBeenCalled();
  });

  it('Stripe failure: the new request stands, the old stays pending with its recorded decision, and the retry later finishes it', async () => {
    h.decide.mockImplementation(async (_id: number, _t: string, _a: unknown, _b: unknown, _actor: number, _e: unknown, options: any) => {
      // decideAuthorizedBooking persists the decision before Stripe, then Stripe fails (it queues the recovery row itself).
      h.rows.kitchen_bookings[0].paymentDecision = { target: 'cancelled', state: 'pending', replacedBy: options.replacedBy };
      throw new Error('Stripe timeout');
    });
    expect(await completeReplacement(11, 10)).toBe('releasing');
    expect(h.rows.kitchen_bookings[0].status).toBe('pending');
    expect(h.rows.kitchen_bookings[1].status).toBe('pending');
    // The chef sees "we're releasing your earlier hold" and the history already links the pair.
    expect(await readReplacementOutcome(11, 3)).toMatchObject({ outcome: 'releasing' });
    expect(h.rows.booking_lifecycle_events.filter(row => ['replaced_by', 'replaces'].includes(row.kind))).toHaveLength(2);
    // A replay retries the same decision and records the final outcome without duplicating links.
    withdrawOk();
    expect(await completeReplacement(11, 10)).toBe('withdrawn');
    expect(await readReplacementOutcome(11, 3)).toMatchObject({ outcome: 'withdrawn' });
    expect(h.rows.booking_lifecycle_events.filter(row => ['replaced_by', 'replaces'].includes(row.kind))).toHaveLength(2);
  });

  it('failure before any decision is recorded: the new request stands, the chef and Local Cooks are told, and a replay retries', async () => {
    h.decide.mockRejectedValueOnce(new Error('Booking changed; refresh before deciding'));
    expect(await completeReplacement(11, 10)).toBe('releasing');
    expect(h.rows.kitchen_bookings[0].status).toBe('pending');
    expect(h.queue).toHaveBeenCalledTimes(1);
    expect(h.queue.mock.calls[0][1]).toBe(10);
    expect(h.queue.mock.calls[0][6]).toMatchObject({ recipientPolicy: 'chef', supportCase: true, replacementNotice: { variant: 'releasing' } });
    // No history link while the earlier request is still open.
    expect(h.rows.booking_lifecycle_events.some(row => ['replaced_by', 'replaces'].includes(row.kind))).toBe(false);
    withdrawOk();
    expect(await completeReplacement(11, 10)).toBe('withdrawn');
    expect(h.queue).toHaveBeenCalledTimes(1);
  });

  it('never throws into checkout fulfillment', async () => {
    h.decide.mockRejectedValue(new Error('boom'));
    h.queue.mockRejectedValue(new Error('database unavailable'));
    await expect(completeReplacementSafely(11, 10)).resolves.toBeNull();
  });

  it('shows another chef nothing about the pair', async () => {
    withdrawOk(); await completeReplacement(11, 10);
    expect(await readReplacementOutcome(11, 99)).toBeNull();
    expect(await readReplacementOutcome(10, 3)).toBeNull();
  });
});
