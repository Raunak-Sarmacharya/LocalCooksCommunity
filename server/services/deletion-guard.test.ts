import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DeletionBlockedError, describeDeletionBlockers, getDeletionBlockers, hasDeletionHistory, isForeignKeyViolation } from './deletion-guard';

const bucket = (refs: Array<[string, string?]>, total = refs.length) => ({ total, refs: refs.map(([ref, detail]) => ({ ref, detail })) });
const none = () => ({ total: 0, refs: [] as any[] });

describe('deletion guard messages', () => {
  it('lists every live reference with what to do next', () => {
    const message = describeDeletionBlockers('kitchen', {
      upcomingBookings: bucket([['KB-AAA111', '2026-11-02'], ['KB-BBB222', '2026-11-03'], ['KB-CCC333', '2026-11-04']]),
      openClaims: bucket([['DC-X1']]), pendingMoney: none(), checkoutIncidents: none(), blocked: true,
    });
    expect(message).toContain('This kitchen has 3 upcoming or unfinished bookings (KB-AAA111, 2026-11-02; KB-BBB222, 2026-11-03; KB-CCC333, 2026-11-04)');
    expect(message).toContain('1 open damage claim (DC-X1)');
    expect(message).toContain('Cancel or finish the bookings');
    expect(message).toContain('take the kitchen off the listing instead');
  });

  it('says how many more there are and speaks differently for accounts', () => {
    const message = describeDeletionBlockers('account', {
      upcomingBookings: none(), openClaims: none(), checkoutIncidents: none(), blocked: true,
      pendingMoney: bucket([['KB-1'], ['KB-2']], 11),
    });
    expect(message).toContain('11 payments, refunds or payouts still in progress (KB-1; KB-2; and 9 more)');
    expect(message.startsWith('This account has')).toBe(true);
    expect(message).toContain('Contact Local Cooks');
  });

  it('carries the references on a 409 error', () => {
    const blockers = { upcomingBookings: bucket([['KB-1']]), openClaims: none(), pendingMoney: none(), checkoutIncidents: none(), blocked: true };
    const error = new DeletionBlockedError('location', blockers);
    expect(error.status).toBe(409);
    expect(error.message).toContain('This location has 1 upcoming or unfinished booking (KB-1)');
    expect(error.blockers).toBe(blockers);
  });

  it('recognises a foreign key refusal', () => {
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true);
    expect(isForeignKeyViolation({ cause: { code: '23503' } })).toBe(true);
    expect(isForeignKeyViolation(new Error('x'))).toBe(false);
  });
});

function exec(rowsByCall: any[][]) {
  const statements: string[] = [];
  const params: unknown[][] = [];
  let call = 0;
  return { statements, params, execute: async (query: any) => {
    const compiled = new PgDialect().sqlToQuery(query);
    statements.push(compiled.sql);
    params.push(compiled.params);
    return { rows: rowsByCall[call++] ?? [] };
  } };
}

describe('deletion guard queries', () => {
  it('turns query rows into references and blocks', async () => {
    const db = exec([
      [{ id: 1, reference_code: 'KB-AAA111', booking_date: '2026-11-02T00:00:00Z', total: 4 }],
      [{ id: 9, reference_code: 'DC-9', total: 1 }],
      [{ id: 3, reference_code: 'KB-AAA111', total: 1 }],
      [{ id: 5, reference_code: 'KB-AAA111', total: 1 }],
      [],
    ]);
    const blockers = await getDeletionBlockers(db, { kind: 'kitchens', kitchenIds: [7] });
    expect(blockers.blocked).toBe(true);
    expect(blockers.upcomingBookings).toEqual({ total: 4, refs: [{ ref: 'KB-AAA111', detail: 'Nov 2, 2026' }] });
    expect(blockers.openClaims.refs).toEqual([{ ref: 'DC-9', detail: undefined }].map(r => ({ ref: r.ref })));
    expect(blockers.pendingMoney.refs).toEqual([{ ref: 'KB-AAA111' }].map(r => ({ ref: r.ref, detail: undefined })));
    // Never counts manager blocks, drafts or finished claims.
    expect(db.statements[0]).toContain("kb.booking_type <> 'manager_blocked'");
    expect(db.statements[0]).toContain("kb.status IN ('pending', 'confirmed', 'cancellation_requested')");
    expect(db.statements[1]).toContain('NOT IN');
  });

  it('never shows a payment-provider id or an internal payment id', async () => {
    const db = exec([[], [], [{ id: 110, reference_code: null, kb_id: null, total: 1 }], [], [{ id: 4, operating_date: '2026-10-24', total: 1 }]]);
    const blockers = await getDeletionBlockers(db, { kind: 'user', userId: 380 });
    expect(blockers.pendingMoney.refs).toEqual([{ ref: 'a payment without a booking' }]);
    expect(blockers.checkoutIncidents.refs).toEqual([{ ref: 'Checkout for Oct 24, 2026' }]);
    expect(JSON.stringify(blockers)).not.toMatch(/cs_|payment 110/);
  });

  it('is not blocked when only history is left', async () => {
    const blockers = await getDeletionBlockers(exec([[], [], [], [], []]), { kind: 'location', locationId: 4 });
    expect(blockers.blocked).toBe(false);
  });

  it('a kitchen scope with no kitchens never queries', async () => {
    const db = exec([]);
    expect((await getDeletionBlockers(db, { kind: 'kitchens', kitchenIds: [] })).blocked).toBe(false);
    expect(db.statements).toHaveLength(0);
  });

  it('reports history for a user and uses bound parameters only', async () => {
    const db = exec([[{ has_history: true }]]);
    expect(await hasDeletionHistory(db, { kind: 'user', userId: 4242 })).toBe(true);
    expect(db.statements[0]).not.toContain('4242');
    expect(db.statements[0]).toContain('sb.chef_id');
  });

  it('blocks a chef or kitchen while a storage rental is still open', async () => {
    const db = exec([[], [], [], [], [], [{ id: 4, reference_code: 'SB-RENT1', term_start: '2026-10-20', total: 1 }]]);
    const blockers = await getDeletionBlockers(db, { kind: 'user', userId: 3 });
    expect(blockers.blocked).toBe(true);
    expect(blockers.openRentals).toEqual({ total: 1, refs: [{ ref: 'SB-RENT1', detail: 'Oct 20, 2026' }] });
    expect(db.statements[5]).toContain('sb.rental_state IN ($3, $4, $5, $6, $7)');
    expect(db.statements[5]).toContain('sb.chef_id');
    expect(db.params[5].slice(2, 7)).toEqual(['requested', 'reserved', 'active', 'move_out_requested', 'removal_review']);
    const message = describeDeletionBlockers('account', blockers);
    expect(message).toContain('1 open storage rental (SB-RENT1, Oct 20, 2026)');
    expect(message).toContain('storage rentals');
  });
});

describe('migration 0089', () => {
  const sqlText = readFileSync('migrations/0089_deletion_safety.sql', 'utf8');
  it('switches every payment-history cascade to RESTRICT', () => {
    for (const edge of ["'locations','manager_id','users'", "'kitchens','location_id','locations'", "'kitchen_bookings','kitchen_id','kitchens'",
      "'kitchen_bookings','chef_id','users'", "'kitchen_bookings','created_by','users'", "'storage_bookings','kitchen_booking_id','kitchen_bookings'",
      "'storage_bookings','storage_listing_id','storage_listings'", "'equipment_bookings','kitchen_booking_id','kitchen_bookings'",
      "'damage_claims','location_id','locations'", "'damage_claims','manager_id','users'", "'damage_claims','chef_id','users'",
      "'kitchen_booking_extensions','booking_id','kitchen_bookings'"]) expect(sqlText).toContain(edge);
    expect(sqlText).toContain('ON DELETE RESTRICT');
    expect(sqlText).toContain('pg_constraint');
    expect(sqlText).toContain('ADD COLUMN IF NOT EXISTS archived_at');
  });
});
