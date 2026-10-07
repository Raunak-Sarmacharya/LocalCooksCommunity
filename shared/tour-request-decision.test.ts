import { expect, it } from 'vitest';
import { tourRequestDecision, tourRequestEscalationDue, tourRequestEscalationKey } from './tour-request-decision';
const created = '2026-10-01T00:00:00Z';
const request = { id: 10, status: 'pending_local_cooks', createdAt: created, scheduledAt: '2026-10-03T00:00:00Z' };
it('has independent12hour stage boundaries unaffected by notes/version edits', () => {
  expect(tourRequestDecision(request, Date.parse('2026-10-01T11:59:59Z'))?.overdue).toBe(false);
  expect(tourRequestDecision(request, Date.parse('2026-10-01T12:00:00Z'))?.overdue).toBe(true);
  const forwarded = { ...request, status: 'pending', adminReviewedAt: '2026-10-01T10:00:00Z' };
  expect(tourRequestDecision(forwarded, Date.parse('2026-10-01T21:59:59Z'))?.canTakeOver).toBe(false);
  expect(tourRequestDecision(forwarded, Date.parse('2026-10-01T22:00:00Z'))?.canTakeOver).toBe(true);
  expect(tourRequestEscalationKey({ ...forwarded, updatedAt: created } as any)).toBe(tourRequestEscalationKey(forwarded));
});
it('uses one decision key for SLA and urgent overlapping notices and permits overnight short notice', () => {
  const short = { ...request, scheduledAt: '2026-10-01T03:00:00Z' };
  expect(tourRequestEscalationDue(short, Date.parse(created))).toBe(true);
  expect(tourRequestEscalationDue(short, Date.parse(short.scheduledAt))).toBe(false);
  expect(tourRequestDecision({ ...request, requestExpiredAt: created })).toBeNull();
});
it('keeps offers chef-owned until original start without inventing a12hour chef SLA', () => {
  const offered = { ...request, status: 'pending', rescheduleProposedAt: created, rescheduleProposedSlots: ['2026-10-04T00:00:00Z'] };
  const decision = tourRequestDecision(offered, Date.parse('2026-10-01T13:00:00Z'));
  expect(decision).toMatchObject({ stage: 'chef_offer', overdue: false, canTakeOver: false, dueAt: '2026-10-03T00:00:00.000Z' });
  expect(tourRequestEscalationDue(offered, Date.parse('2026-10-02T20:00:00Z'))).toBe(true);
});
