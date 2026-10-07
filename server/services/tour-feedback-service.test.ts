import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ tour: {} as any, managerId: 2, people: [] as any[], responses: [] as any[],
  queue: vi.fn(), insert: vi.fn(), locks: [] as string[] }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('./tour-delivery-service', () => ({ queueTourEvent: state.queue }));
import { getTourFeedback, readTourFeedbackStatus, submitTourFeedback } from './tour-feedback-service';
import { tourFeedbackResponses } from '@shared/schema';

const now = new Date('2026-10-07T12:00:00Z');
const viewer = { id: 3, role: 'chef' };
const input = { scheduledAt: '2026-10-07T10:00:00Z', appointmentRevision: 1, happened: true,
  rating: 4, comments: 'Helpful visit', suggestions: 'More storage details' };
function values(condition: any): any[] {
  return condition?.queryChunks ? condition.queryChunks.flatMap(values) : condition && 'value' in condition ? [condition.value] : [];
}
const connection: any = {
  select: (fields?: any) => {
    let table = '', condition: any;
    const rows = () => table === 'kitchen_viewings' ? state.tour ? [state.tour] : []
      : table === 'locations' ? [{ managerId: state.managerId }]
      : table === 'users' ? fields?.id ? state.people : state.people.filter(person => person.id === values(condition).find(value => typeof value === 'number'))
      : table === 'tour_feedback_responses' ? fields || !values(condition).some(value => value === 'chef' || value === 'manager')
        ? state.responses : state.responses.filter(response => response.viewingId === state.tour.id
          && response.appointmentRevision === values(condition).filter(value => typeof value === 'number')[1]
          && response.respondentRole === values(condition).find(value => value === 'chef' || value === 'manager')
          && response.respondentId === values(condition).filter(value => typeof value === 'number')[2]) : [];
    const chain: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return chain; },
      where: (value: any) => { condition = value; return chain; }, limit: () => chain, orderBy: () => chain,
      for: (mode: string) => { state.locks.push(`${table}:${mode}`); return chain; }, then: (resolve: any) => resolve(rows()) };
    return chain;
  },
  insert: (table: any) => { expect(table).toBe(tourFeedbackResponses); return { values: (data: any) => ({ returning: () => state.insert(data) }) }; },
};
const response = (role: 'chef' | 'manager', id = role === 'chef' ? 3 : 2, happened = true, patch = {}) => ({
  id: role === 'chef' ? 1 : id + 10, viewingId: 20, respondentId: id, respondentRole: role,
  scheduledAt: new Date(input.scheduledAt), appointmentRevision: 1, happened, rating: happened ? 4 : null,
  comments: 'Private comments', suggestions: 'Private suggestions', reason: happened ? null : 'The manager was not available', createdAt: now, ...patch,
});
const submit = (payload: any = input, actor: any = viewer) => submitTourFeedback(connection, state.tour, actor, payload, now);

beforeEach(() => {
  vi.clearAllMocks(); state.managerId = 2; state.responses = []; state.locks = [];
  state.people = [{ id: 3, role: 'chef' }, { id: 2, role: 'manager' }, { id: 7, role: 'manager' }, { id: 9, role: 'admin' }];
  state.tour = { id: 20, chefId: 3, locationId: 5, managerId: 2, status: 'confirmed', lifecycleState: 'confirmed',
    visitResult: null, scheduledAt: new Date(input.scheduledAt), appointmentRevision: 1, durationMinutes: 30,
    confirmationVerified: true, visitEvidenceState: 'ready', visitEvidenceMigratedAt: now };
  state.insert.mockImplementation(async (data: any) => { const saved = { id: state.responses.length + 1, ...data }; state.responses.push(saved); return [saved]; });
});

describe('private immutable appointment feedback', () => {
  it('collects one report without changing visit times, lifecycle or the final result', async () => {
    const before = { ...state.tour };
    const result = await submit();
    expect(result).toMatchObject({ changed: true, response: { respondentId: 3, respondentRole: 'chef', happened: true, rating: 4 } });
    expect(state.locks).toEqual(['kitchen_viewings:update', 'users:share']);
    expect(state.tour).toEqual(before); expect(state.queue).not.toHaveBeenCalled();
  });
  it.each(['manager', 'chef'])('alerts admin when the second %s response makes the feedback ready', async role => {
    const actor = role === 'chef' ? viewer : { id: 2, role: 'manager' };
    state.responses = [response(role === 'chef' ? 'manager' : 'chef')];
    await submit(input, actor);
    expect(state.queue).toHaveBeenCalledWith(connection, expect.objectContaining({ kind: 'feedback_submitted',
      feedbackRespondent: { role, id: actor.id }, feedbackStatus: { chef: true, manager: true, conflict: false } }));
  });
  it('alerts admin immediately on disagreement without converting either report into an absence result', async () => {
    state.responses = [response('manager', 2, false)];
    await submit();
    expect(state.queue).toHaveBeenCalledWith(connection, expect.objectContaining({ feedbackStatus: { chef: true, manager: true, conflict: true } }));
    expect(state.tour.visitResult).toBeNull(); expect(state.tour.status).toBe('confirmed');
  });
  it('allows identical lost-response retries after admin closure and does not enqueue again', async () => {
    const first = await submit(); state.tour.status = 'completed'; state.tour.visitResult = 'completed'; state.tour.lifecycleState = 'ended';
    const repeated = await submit({ ...input, comments: ' Helpful visit ' });
    expect(repeated).toMatchObject({ changed: false, response: { id: first.response.id } });
    expect(state.insert).toHaveBeenCalledTimes(1); expect(state.queue).not.toHaveBeenCalled();
  });
  it('rejects an altered retry and keeps the original private answers', async () => {
    await submit(); await expect(submit({ ...input, rating: 5 })).rejects.toMatchObject({ code: 'TOUR_FEEDBACK_ALREADY_SUBMITTED', statusCode: 409 });
    expect(state.responses[0].rating).toBe(4); expect(state.insert).toHaveBeenCalledTimes(1);
  });
  it.each([{ scheduledAt: '2026-10-08T10:00:00Z' }, { appointmentRevision: 2 }])('rejects stale appointment identity %j before insertion', async patch => {
    await expect(submit({ ...input, ...patch })).rejects.toMatchObject({ code: 'STALE_TOUR_FEEDBACK', statusCode: 409 });
    expect(state.insert).not.toHaveBeenCalled();
  });
  it.each([{ status: 'cancelled' }, { status: 'completed' }, { visitResult: 'unrecorded' },
    { confirmationVerified: false }, { scheduledAt: new Date('2026-10-07T13:00:00Z') }])('blocks a new report after closure/unconfirmed/early state %j', async patch => {
    Object.assign(state.tour, patch);
    await expect(submit({ ...input, scheduledAt: state.tour.scheduledAt.toISOString() })).rejects.toMatchObject({ code: 'TOUR_FEEDBACK_UNAVAILABLE' });
    expect(state.insert).not.toHaveBeenCalled();
  });
  it('collects useful reported feedback during legacy evidence review without repairing unknown timestamps', async () => {
    state.tour.visitEvidenceState = 'review'; state.tour.lifecycleState = 'ended'; state.tour.visitEvidenceMigratedAt = null;
    await submit(); expect(state.tour.visitEvidenceState).toBe('review'); expect(state.tour.checkedInAt).toBeUndefined();
  });
  it.each([{ id: 7, role: 'manager' }, { id: 99, role: 'chef' }, { id: 3, role: 'admin' }])('rejects a former/foreign/wrong-role actor %j', async actor => {
    await expect(submit(input, actor)).rejects.toMatchObject({ statusCode: 404 }); expect(state.insert).not.toHaveBeenCalled();
  });
  it('admins can review but cannot submit a participant report', async () => {
    await expect(submit(input, { id: 9, role: 'admin' })).rejects.toMatchObject({ statusCode: 403 }); expect(state.insert).not.toHaveBeenCalled();
  });
  it('accepts a new current manager while retaining the former manager response and attribution', async () => {
    state.responses = [response('chef'), response('manager')]; state.managerId = 7;
    expect(await readTourFeedbackStatus(connection, state.tour)).toMatchObject({ chef: true, manager: false, missing: true });
    await submit(input, { id: 7, role: 'manager' });
    expect(state.responses.filter(value => value.respondentRole === 'manager').map(value => value.respondentId)).toEqual([2, 7]);
    expect(await readTourFeedbackStatus(connection, state.tour)).toMatchObject({ chef: true, manager: true, bothReady: true });
  });
  it('excludes replies from another appointment and accounts whose role changed', async () => {
    state.responses = [response('chef', 3, true, { appointmentRevision: 2 }), response('manager', 2, true, { scheduledAt: new Date('2026-10-06T10:00:00Z') })];
    expect(await readTourFeedbackStatus(connection, state.tour)).toMatchObject({ chef: false, manager: false });
    state.responses = [response('chef'), response('manager')]; state.people.find(value => value.id === 2).role = 'admin';
    expect(await readTourFeedbackStatus(connection, state.tour)).toMatchObject({ chef: true, manager: false });
  });
  it('keeps counterpart answers and conflict inference out of participant snapshots while admin sees preserved reports', async () => {
    state.responses = [response('chef'), response('manager', 2, false), response('manager', 7, true, { appointmentRevision: 2 })];
    const chef = await getTourFeedback(connection, state.tour, viewer, now);
    expect(chef).toMatchObject({ response: { respondentRole: 'chef' }, conflict: false, bothReady: true });
    expect(chef).not.toHaveProperty('responses'); expect(JSON.stringify(chef)).not.toContain('The manager was not available');
    const admin = await getTourFeedback(connection, state.tour, { id: 9, role: 'admin' }, now);
    expect(admin).toMatchObject({ conflict: true, available: false, response: null }); expect(admin.responses).toHaveLength(3);
    expect(admin.responses?.[2]).toMatchObject({ currentAppointment: false, currentRespondent: false });
  });
  it('rejects invalid no-tour feedback and enforces reason/rating limits before persistence', async () => {
    await expect(submit({ ...input, happened: false })).rejects.toMatchObject({ code: 'INVALID_TOUR_FEEDBACK', statusCode: 400 });
    await expect(submit({ ...input, rating: 6 })).rejects.toMatchObject({ code: 'INVALID_TOUR_FEEDBACK', statusCode: 400 });
    expect(state.insert).not.toHaveBeenCalled();
  });
});
