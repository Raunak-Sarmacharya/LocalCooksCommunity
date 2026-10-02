import { describe, expect, it } from 'vitest';
import { overstayCollectionError } from './overstay-collection';
const now = new Date('2026-10-01T12:00:00Z');
const record = { itemsRemovedAt: new Date('2026-09-29'), chefDisputeDeadline: new Date('2026-10-01T11:00:00Z'),
  chefDisputedAt: null as Date | null, disputeReviewedAt: null as Date | null };
describe('overstay collection eligibility', () => {
  it('blocks collection without verified removal', () => expect(overstayCollectionError({ ...record, itemsRemovedAt: null }, now)).toMatch(/removal/));
  it('blocks collection without a notice deadline', () => expect(overstayCollectionError({ ...record, chefDisputeDeadline: null }, now)).toMatch(/notice/));
  it('protects the full response window', () => expect(overstayCollectionError({ ...record, chefDisputeDeadline: new Date('2026-10-01T13:00:00Z') }, now)).toMatch(/window.*open/));
  it('pauses collection throughout an unresolved dispute', () => expect(overstayCollectionError({ ...record, chefDisputedAt: new Date('2026-10-01T10:00:00Z') }, now)).toMatch(/paused/));
  it('allows collection after the deadline', () => expect(overstayCollectionError(record, now)).toBeUndefined());
  it('allows collection after an admin resolves the dispute', () => expect(overstayCollectionError({ ...record, chefDisputedAt: new Date(), disputeReviewedAt: new Date() }, now)).toBeUndefined());
});
