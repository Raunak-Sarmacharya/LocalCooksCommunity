import { beforeEach, describe, expect, it, vi } from 'vitest';
const guard = vi.hoisted(() => ({ blockers: vi.fn(), history: vi.fn() }));
vi.mock('../../logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../db', () => ({ db: {} }));
vi.mock('../../services/deletion-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/deletion-guard')>()),
  getDeletionBlockers: guard.blockers, hasDeletionHistory: guard.history,
}));
import { KitchenService } from './kitchen.service';
import { DeletionBlockedError } from '../../services/deletion-guard';

const bucket = (refs: string[]) => ({ total: refs.length, refs: refs.map(ref => ({ ref })) });
const empty = { total: 0, refs: [] as any[] };
const clear = { upcomingBookings: empty, openClaims: empty, pendingMoney: empty, checkoutIncidents: empty, blocked: false };
function service() {
  const repo: any = { findById: vi.fn(async () => ({ id: 5, name: 'Kitchen' })), delete: vi.fn(async () => undefined), archive: vi.fn(async () => undefined) };
  return { repo, service: new KitchenService(repo) };
}

describe('kitchen delete safety', () => {
  beforeEach(() => { guard.blockers.mockReset().mockResolvedValue(clear); guard.history.mockReset().mockResolvedValue(false); });

  it('blocks while bookings are upcoming and names them, deleting and archiving nothing', async () => {
    guard.blockers.mockResolvedValue({ ...clear, blocked: true, upcomingBookings: bucket(['KB-AAA111', 'KB-BBB222', 'KB-CCC333']) });
    const { repo, service: svc } = service();
    const failure = await svc.deleteKitchen(5).catch(e => e);
    expect(failure).toBeInstanceOf(DeletionBlockedError);
    expect(failure.message).toContain('This kitchen has 3 upcoming or unfinished bookings (KB-AAA111; KB-BBB222; KB-CCC333)');
    expect(repo.delete).not.toHaveBeenCalled(); expect(repo.archive).not.toHaveBeenCalled();
  });

  it('archives instead of deleting when only history exists', async () => {
    guard.history.mockResolvedValue(true);
    const { repo, service: svc } = service();
    expect(await svc.deleteKitchen(5)).toEqual({ archived: true });
    expect(repo.archive).toHaveBeenCalledWith(5); expect(repo.delete).not.toHaveBeenCalled();
  });

  it('really deletes a kitchen with no history', async () => {
    const { repo, service: svc } = service();
    expect(await svc.deleteKitchen(5)).toEqual({ archived: false });
    expect(repo.delete).toHaveBeenCalledWith(5); expect(repo.archive).not.toHaveBeenCalled();
  });

  it('a booking that appears mid-delete trips the RESTRICT key and the kitchen is archived, not lost', async () => {
    const { repo, service: svc } = service();
    repo.delete.mockRejectedValue(Object.assign(new Error('fk'), { code: '23503' }));
    expect(await svc.deleteKitchen(5)).toEqual({ archived: true });
    expect(repo.archive).toHaveBeenCalledWith(5);
  });

  it('the same race with a live booking is reported as blocked', async () => {
    const { repo, service: svc } = service();
    repo.delete.mockRejectedValue(Object.assign(new Error('fk'), { code: '23503' }));
    guard.blockers.mockResolvedValueOnce(clear).mockResolvedValueOnce({ ...clear, blocked: true, upcomingBookings: bucket(['KB-NEW']) });
    await expect(svc.deleteKitchen(5)).rejects.toBeInstanceOf(DeletionBlockedError);
    expect(repo.archive).not.toHaveBeenCalled();
  });
});
