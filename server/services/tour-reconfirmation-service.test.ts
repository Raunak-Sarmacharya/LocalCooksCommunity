import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ tour: {} as any, managerId: 2, events: [] as any[], askCompletedAt: null as Date | null, queue: vi.fn() }));
vi.mock('../db', () => {
  const db: any = { transaction: (run: any) => run(db), select: (fields?: any) => {
    let table = '';
    const chain: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return chain; }, where: () => chain, orderBy: () => chain, limit: () => chain, for: () => chain,
      then: (resolve: any) => resolve(table === 'locations' ? [{ managerId: state.managerId }] : table === 'tour_delivery_events' ? fields?.completedAt ? [{ completedAt: state.askCompletedAt }] : state.events : fields ? [{ id: 10 }] : [state.tour]) };
    return chain;
  } }; return { db };
});
vi.mock('./tour-delivery-service', () => ({ queueTourEvent: state.queue }));
import { queueTourReconfirmations } from './tour-reconfirmation-service';
beforeEach(() => {
  state.events = []; state.askCompletedAt = null; state.queue.mockReset();
  state.tour = { id: 10, locationId: 1, status: 'confirmed', scheduledAt: new Date(Date.now() + 3600000), confirmedAt: new Date(Date.now() - 1000), appointmentRevision: 1 };
});
it('queues one request and immediate short-notice staff escalation without changing confirmation', async () => {
  await queueTourReconfirmations();
  expect(state.queue.mock.calls.map(call => call[1].kind)).toEqual(['reconfirmation_requested', 'reconfirmation_escalated']);
  expect(state.tour.status).toBe('confirmed');
});
it('suppresses already queued events, current still-coming replies, arrivals and duplicate pending-change escalation', async () => {
  state.events = [{ id: 1 }]; await queueTourReconfirmations(); expect(state.queue).not.toHaveBeenCalled();
  state.events = []; state.tour.reconfirmationReply = 'still_coming'; state.tour.reconfirmationReplyRevision = '1:2';
  await queueTourReconfirmations(); expect(state.queue).not.toHaveBeenCalled();
  state.tour.reconfirmationReply = null; state.tour.checkedInAt = new Date();
  await queueTourReconfirmations(); expect(state.queue).not.toHaveBeenCalled();
  state.tour.checkedInAt = null; state.tour.requestedRescheduleAt = new Date();
  await queueTourReconfirmations(); expect(state.queue).not.toHaveBeenCalled();
  state.tour.requestedRescheduleAt = null; state.tour.rescheduleProposedSlots = ['2030-01-01T12:00:00Z'];
  await queueTourReconfirmations(); expect(state.queue).not.toHaveBeenCalled();
});
it('sends a visitor follow-up when unanswered and overdue, but never immediately beside the first ask', async () => {
  state.tour.scheduledAt = new Date(Date.now() + 10 * 3600000);
  state.tour.appointmentConfirmedAt = new Date(Date.now() - 30 * 3600000);
  await queueTourReconfirmations();
  expect(state.queue.mock.calls.map(call => call[1].kind)).toEqual(['reconfirmation_requested', 'reconfirmation_escalated']);
  state.queue.mockClear(); state.askCompletedAt = new Date(Date.now() - 30 * 60000);
  await queueTourReconfirmations(); expect(state.queue.mock.calls.some(call => call[1].kind === 'reconfirmation_reminder')).toBe(false);
  state.queue.mockClear(); state.askCompletedAt = new Date(Date.now() - 2 * 3600000);
  await queueTourReconfirmations();
  expect(state.queue.mock.calls.map(call => call[1].kind)).toEqual(['reconfirmation_requested', 'reconfirmation_escalated', 'reconfirmation_reminder']);
  state.queue.mockClear(); state.tour.reconfirmationReply = 'reschedule'; state.tour.reconfirmationReplyRevision = '1:2';
  await queueTourReconfirmations(); expect(state.queue.mock.calls.map(call => call[1].kind)).toEqual(['reconfirmation_escalated']);
});
