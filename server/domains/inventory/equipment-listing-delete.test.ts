import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const h = vi.hoisted(() => ({
  repo: { getEquipmentBookingUsage: vi.fn(), archiveEquipmentListing: vi.fn(), deleteEquipmentListing: vi.fn() },
  service: { getEquipmentListingById: vi.fn(), deleteEquipmentListing: vi.fn(), updateEquipmentListing: vi.fn() },
  kitchen: vi.fn(), locations: vi.fn(),
  captured: { wheres: [] as unknown[], sets: [] as any[], selectedAll: 0 },
}));

vi.mock('../../db', () => {
  const chain: any = {
    from: () => chain, leftJoin: () => chain, where: (condition: unknown) => { h.captured.wheres.push(condition); return chain; }, orderBy: () => chain,
    returning: async () => [{ id: 5, kitchenId: 1, equipmentType: 'oven', isActive: true }],
    then: (resolve: (rows: unknown[]) => void) => resolve([{ id: 5, kitchenId: 1, isActive: true, archivedAt: new Date('2026-10-01') }]),
  };
  return { db: {
    select: () => chain,
    update: () => ({ set: (values: any) => { h.captured.sets.push(values); return chain; } }),
    delete: () => ({ where: async () => undefined }),
  } };
});
vi.mock('../../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: (_q: any, _s: any, next: any) => next(), requireManager: (_q: any, _s: any, next: any) => next() }));
vi.mock('../../routes/middleware', () => ({ requireChef: (_q: any, _s: any, next: any) => next() }));
vi.mock('../kitchens/kitchen.service', () => ({ kitchenService: { getKitchenById: h.kitchen } }));
vi.mock('../locations/location.service', () => ({ locationService: { getLocationsByManagerId: h.locations } }));
vi.mock('./inventory.service', async importOriginal => {
  const actual = await importOriginal<typeof import('./inventory.service')>();
  return { ...actual, inventoryService: h.service };
});

import { InventoryService, EquipmentListingInUseError } from './inventory.service';
import { InventoryRepository } from './inventory.repository';
import router from '../../routes/equipment';

const dialect = new PgDialect();

describe('deleting an equipment listing never destroys booking history', () => {
  const service = () => new InventoryService(h.repo as any);
  beforeEach(() => { vi.clearAllMocks(); });

  it('refuses while a pending, confirmed or cancellation-requested booking exists, and changes nothing', async () => {
    h.repo.getEquipmentBookingUsage.mockResolvedValue({ total: 3, open: 1 });
    await expect(service().deleteEquipmentListing(5)).rejects.toBeInstanceOf(EquipmentListingInUseError);
    await expect(service().deleteEquipmentListing(5)).rejects.toThrow('This equipment has upcoming bookings. Turn it off for new bookings instead.');
    expect(h.repo.archiveEquipmentListing).not.toHaveBeenCalled(); expect(h.repo.deleteEquipmentListing).not.toHaveBeenCalled();
  });
  it('archives, rather than deletes, a listing that only has past bookings', async () => {
    h.repo.getEquipmentBookingUsage.mockResolvedValue({ total: 2, open: 0 });
    await expect(service().deleteEquipmentListing(5)).resolves.toEqual({ archived: true });
    expect(h.repo.archiveEquipmentListing).toHaveBeenCalledWith(5); expect(h.repo.deleteEquipmentListing).not.toHaveBeenCalled();
  });
  it('really deletes a listing that was never booked', async () => {
    h.repo.getEquipmentBookingUsage.mockResolvedValue({ total: 0, open: 0 });
    await expect(service().deleteEquipmentListing(5)).resolves.toEqual({ archived: false });
    expect(h.repo.deleteEquipmentListing).toHaveBeenCalledWith(5); expect(h.repo.archiveEquipmentListing).not.toHaveBeenCalled();
  });
});

describe('equipment repository archive rules', () => {
  const repo = new InventoryRepository();
  beforeEach(() => { vi.clearAllMocks(); h.captured.wheres.length = 0; h.captured.sets.length = 0; });

  it('hides archived listings from the manager list and chef booking list', async () => {
    await repo.getEquipmentListingsByKitchenId(1);
    expect(dialect.sqlToQuery(h.captured.wheres[0] as any).sql).toMatch(/"archived_at" is null/);
  });
  it('still resolves an archived listing by id, so invoices and receipts keep working', async () => {
    const listing = await repo.getEquipmentListingById(5);
    expect(listing).toMatchObject({ id: 5 });
    expect(dialect.sqlToQuery(h.captured.wheres[0] as any).sql).not.toMatch(/archived_at/);
  });
  it('archiving turns the listing off and stamps archived_at', async () => {
    await repo.archiveEquipmentListing(5);
    expect(h.captured.sets[0]).toMatchObject({ isActive: false, archivedAt: expect.any(Date) });
  });
  it('a client edit can neither archive nor restore a listing', async () => {
    await repo.updateEquipmentListing(5, { archivedAt: null, equipmentType: 'oven' } as any);
    expect(h.captured.sets[0]).not.toHaveProperty('archivedAt');
    expect(h.captured.sets[0]).toMatchObject({ equipmentType: 'oven' });
  });
  it('scopes the booking usage count to the one listing', async () => {
    await repo.getEquipmentBookingUsage(5);
    const where = dialect.sqlToQuery(h.captured.wheres[0] as any);
    expect(where.sql).toMatch(/"equipment_listing_id" = \$1/);
  });
  it('counts a booking as open only while its visit is live (equipment rows stay "confirmed" after a completed visit)', async () => {
    const select = vi.spyOn((await import('../../db')).db, 'select');
    await repo.getEquipmentBookingUsage(5);
    const fields = select.mock.calls.at(-1)![0] as Record<string, any>;
    const open = dialect.sqlToQuery(fields.open).sql;
    const text = open.toLowerCase().replace(/\s+/g, ' ');
    expect(text).toContain(`"equipment_bookings"."status" in ('pending', 'confirmed', 'cancellation_requested')`);
    expect(text).toContain(`"kitchen_bookings"."status" in ('pending', 'confirmed', 'cancellation_requested')`);
  });
});

describe('DELETE /manager/equipment-listings/:listingId', () => {
  const route = (router as any).stack.find((layer: any) => layer.route?.path?.includes('/equipment-listings/:listingId') && layer.route.methods.delete);
  const handler = route.route.stack.at(-1).handle;
  const call = async () => {
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await handler({ neonUser: { id: 2 }, params: { listingId: '5' } }, res);
    return res;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    h.service.getEquipmentListingById.mockResolvedValue({ id: 5, kitchenId: 1, archivedAt: null });
    h.kitchen.mockResolvedValue({ id: 1, locationId: 9 });
    h.locations.mockResolvedValue([{ id: 9 }]);
  });

  it('answers 409 with the plain message when upcoming bookings exist', async () => {
    h.service.deleteEquipmentListing.mockRejectedValue(new EquipmentListingInUseError());
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'This equipment has upcoming bookings. Turn it off for new bookings instead.' });
  });
  it('maps a booking that appeared mid-delete (foreign key refusal) to the same message', async () => {
    h.service.deleteEquipmentListing.mockRejectedValue(Object.assign(new Error('wrapped'), { cause: { code: '23503' } }));
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/23503|constraint|foreign key/i);
  });
  it('reports whether the listing was archived', async () => {
    h.service.deleteEquipmentListing.mockResolvedValue({ archived: true });
    const res = await call();
    expect(res.json).toHaveBeenCalledWith({ success: true, archived: true });
  });
  it('treats an already archived listing as gone', async () => {
    h.service.getEquipmentListingById.mockResolvedValue({ id: 5, kitchenId: 1, archivedAt: new Date() });
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(h.service.deleteEquipmentListing).not.toHaveBeenCalled();
  });
  it('still checks the manager owns the listing before anything happens', async () => {
    h.locations.mockResolvedValue([{ id: 100 }]);
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(h.service.deleteEquipmentListing).not.toHaveBeenCalled();
  });
});
