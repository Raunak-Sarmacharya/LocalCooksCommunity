import { expect, it, vi } from 'vitest';
const rows = vi.hoisted(() => ({ value: [] as object[] }));
vi.mock('../db', () => {
  const chain: any = { select: () => chain, from: () => chain, where: () => chain, orderBy: () => chain, limit: async () => rows.value };
  return { db: chain, pool: null };
});
import chefRouter from './chef';

// The middleware right before the shop-status handler.
const guard = (chefRouter as any).stack.find((entry: any) => entry.route?.path === '/seller/shop-status').route.stack.at(-2).handle;
const run = async (app?: object) => {
  rows.value = app ? [app] : [];
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }; const next = vi.fn();
  await guard({ neonUser: { id: 7 } }, res, next);
  return { res, next };
};

it('an approved seller gets their shop tools with or without approved documents (owner, Oct 27)', async () => {
  expect((await run({ status: 'approved' })).next).toHaveBeenCalled();
});

it('no application, or one not approved, is refused', async () => {
  for (const app of [undefined, { status: 'inReview' }, { status: 'rejected' }, { status: 'cancelled' }]) {
    const { res, next } = await run(app);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  }
});
