import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
// Live test 2026-10-14 found the chef could read Local Cooks' first-review message to the kitchen and the kitchen's reply.
const state = vi.hoisted(() => ({ notices: [] as any[], history: [] as any[], evidence: [] as any[], transaction: vi.fn() }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Sam' }));
vi.mock('../db', () => ({ db: { transaction: state.transaction } }));
vi.mock('./notification.service', () => ({ notificationService: { create: async (value: any) => { state.notices.push(value); } } }));
vi.mock('./admin-email-preferences', () => ({ operationalEmailAllowed: () => false }));
vi.mock('../config', () => ({ getAppBaseUrl: () => 'https://example.invalid' }));
import { queueDamageClaimNotice } from './damage-claim-notices';
import * as claimNotices from './damage-claim-notices';
import { publicClaim, replyToClaimReview } from './damage-claims-v2';
const people = [{ id: 2, role: 'manager', username: 'm@example.invalid' }, { id: 5, role: 'chef', username: 'c@example.invalid' }];
const noticeTx: any = { select: () => ({ from: () => ({ where: async (query: any) => {
  const { params } = new PgDialect().sqlToQuery(query);
  return people.filter(person => params.includes(person.id) || params.includes(person.role));
} }) }) };
// publicClaim reads evidence, then history.
const readTx = (): any => { let call = 0; return { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => call++ === 0 ? state.evidence : state.history }) }) }) }; };
const claim = (status: string) => ({ id: 1, status, claimVersion: 2, chefId: 5, managerId: 2, kitchenBookingId: 7, chefVisibleAt: new Date(),
  claimedAmountCents: 8350, finalAmountCents: 7000, adminDecisionReason: 'KITCHEN-ONLY note', reviewRequest: 'Please upload the invoice',
  kitchenReply: 'Invoice attached', chefResponseDeadline: new Date('2026-10-17T18:00:00Z'),
  visitEvidence: { kitchenName: 'Maya’s kitchen', timezone: 'America/St_Johns' } } as any);
beforeEach(() => { vi.restoreAllMocks(); state.transaction.mockReset(); state.notices = []; state.history = []; state.evidence = []; });
describe('first-review messages stay between Local Cooks and the kitchen', () => {
  it('chef payload hides the send message, the info request and the kitchen reply; the kitchen keeps them', async () => {
    state.history = [{ id: 1, action: 'submitted', actionBy: 'manager' }, { id: 2, action: 'claim_ask_info', actionBy: 'admin' },
      { id: 3, action: 'kitchen_reply', actionBy: 'manager', createdAt: new Date('2026-10-14T10:00:00Z') }, { id: 4, action: 'claim_send', actionBy: 'admin' },
      { id: 5, action: 'chef_disputed', actionBy: 'chef' }];
    const chef = await publicClaim(claim('submitted'), readTx(), 'chef');
    expect(chef.history.map(row => row.action)).toEqual(['claim_send', 'chef_disputed']);
    expect(chef.publicMessage).toBeNull(); expect(chef.reviewRequest).toBeNull(); expect(chef.kitchenReply).toBeNull();
    expect(JSON.stringify(chef)).not.toContain('actionBy');
    const kitchen = await publicClaim(claim('submitted'), readTx());
    expect(kitchen.publicMessage).toBe('KITCHEN-ONLY note'); expect(kitchen.kitchenReply).toBe('Invoice attached');
  });
  it('keeps old reply attachment text private across multiple reviews while sharing the files', async () => {
    const first = new Date('2026-10-14T10:00:00Z'), second = new Date('2026-10-14T11:00:00Z');
    state.history = [{ action: 'kitchen_reply', actionBy: 'manager', createdAt: first },
      { action: 'kitchen_reply', actionBy: 'manager', createdAt: second }, { action: 'claim_send', actionBy: 'admin' }];
    state.evidence = [
      { id: 1, uploadedBy: 2, createdAt: new Date('2026-10-14T09:00:00Z'), description: 'Original invoice', fileUrl: '/original.pdf' },
      { id: 2, uploadedBy: 2, createdAt: first, description: 'PRIVATE first reply', fileUrl: '/reply.pdf' },
      { id: 3, uploadedBy: 2, createdAt: second, description: 'PRIVATE second reply', fileUrl: '/reply.jpg' },
      { id: 4, uploadedBy: 5, createdAt: second, description: 'Chef evidence', fileUrl: '/chef.jpg' },
    ];
    const chef = await publicClaim(claim('submitted'), readTx(), 'chef');
    expect(chef.evidence.map(row => row.description)).toEqual(['Original invoice', null, null, 'Chef evidence']);
    expect(chef.evidence.map(row => row.fileUrl)).toEqual(['/original.pdf', '/reply.pdf', '/reply.jpg', '/chef.jpg']);
    expect(JSON.stringify(chef)).not.toContain('PRIVATE');
    expect(chef.evidence.every(row => !('createdAt' in row))).toBe(true);
    expect((await publicClaim(claim('submitted'), readTx())).evidence[1].description).toBe('PRIVATE first reply');
  });
  it('stores a new reply attachment without copying the private note into its description', async () => {
    const evidence: any[] = [], saved: any[] = [];
    const tx: any = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => ({ for: async () => [claim('awaiting_kitchen')] }) }) }) }),
      update: () => ({ set: (value: any) => ({ where: async () => { saved.push(value); } }) }),
      insert: () => ({ values: (value: any) => { if (Array.isArray(value)) evidence.push(...value);
        return { then: (resolve: any) => resolve(), returning: async () => [{ id: 1 }] }; } }),
    };
    state.transaction.mockImplementation(run => run(tx));
    vi.spyOn(claimNotices, 'queueDamageClaimNotice').mockResolvedValueOnce(undefined);
    await replyToClaimReview(1, 2, { note: 'PRIVATE kitchen reply', files: [{ fileUrl: 'https://example.invalid/reply.pdf', fileName: 'reply.pdf' }] });
    expect(saved[0].kitchenReply).toBe('PRIVATE kitchen reply');
    expect(evidence).toMatchObject([{ fileUrl: 'https://example.invalid/reply.pdf', description: null, uploadedBy: 2 }]);
    expect(JSON.stringify(evidence)).not.toContain('PRIVATE');
  });
  it('a final decision message is shared with the chef, even after a later money retry', async () => {
    state.history = [{ id: 3, action: 'kitchen_reply', actionBy: 'manager', createdAt: new Date('2026-10-14T10:00:00Z') }, { id: 4, action: 'claim_send', actionBy: 'admin' },
      { id: 5, action: 'chef_disputed', actionBy: 'chef' }, { id: 4, action: 'claim_reduce', actionBy: 'admin' },
      { id: 5, action: 'money_recovery_checked', actionBy: 'admin' }];
    expect((await publicClaim(claim('partially_approved'), readTx(), 'chef')).publicMessage).toBe('KITCHEN-ONLY note');
  });
  it('the chef notice for Send to chef omits the kitchen-only message', async () => {
    await queueDamageClaimNotice(noticeTx, claim('submitted'), { id: 9, action: 'claim_send', metadata: { publicMessage: 'KITCHEN-ONLY note' } } as any);
    const byUser = Object.fromEntries(state.notices.map(notice => [notice.userId, notice.message]));
    expect(byUser[5]).not.toContain('KITCHEN-ONLY'); expect(byUser[2]).toContain('KITCHEN-ONLY');
  });
});

it('older visible v2 claims without a send row use the visibility timestamp as the history boundary', async () => {
  const boundary = new Date('2026-10-14T12:00:00Z');
  state.history = [
    { id: 1, action: 'submitted', createdAt: new Date('2026-10-14T10:00:00Z') },
    { id: 2, action: 'sent', createdAt: boundary },
    { id: 3, action: 'chef_disputed', createdAt: new Date('2026-10-14T13:00:00Z') },
  ];
  const chef = await publicClaim({ ...claim('under_review'), chefVisibleAt: boundary }, readTx(), 'chef');
  expect(chef.history.map(row => row.id)).toEqual([2, 3]);
  expect((await publicClaim(claim('under_review'), readTx())).history).toHaveLength(3);
});
