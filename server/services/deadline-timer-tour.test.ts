import { afterEach, describe, expect, it, vi } from 'vitest';
const sent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../lifecycle-inngest', () => ({ inngest: { send: sent } }));
vi.mock('../db', () => ({ db: {} }));
import { deadlineKinds, scheduleTourTimer, deadlineHorizonMs } from './deadline-timer';

afterEach(() => { vi.unstubAllEnvs(); sent.mockClear(); });
const hour = 3_600_000, now = Date.parse('2026-10-01T12:00:00Z');
const tour = { id: 7, status: 'confirmed', scheduledAt: new Date(now + 3 * hour), durationMinutes: 60, confirmedAt: new Date(now - hour) };

describe('scheduleTourTimer', () => {
  it('registers the tour kind', () => expect(deadlineKinds).toContain('tour'));
  it('sends one timer for the next due instant', async () => {
    vi.stubEnv('INNGEST_EVENT_KEY', 'k');
    scheduleTourTimer(tour, now); await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    // Confirmed 1h ago and starting in 3h: the 6h and 24h marks are past, so the next step is the end of the tour.
    expect(sent.mock.calls[0]).toEqual([expect.objectContaining({ name: 'localcooks/deadline.scheduled', data: { kind: 'tour', id: 7, dueAt: new Date(now + 4 * hour).toISOString() } })]);
  });
  it('re-arms a far-off tour inside the sleep horizon', async () => {
    vi.stubEnv('INNGEST_EVENT_KEY', 'k');
    scheduleTourTimer({ ...tour, scheduledAt: new Date(now + 30 * 24 * hour) }, now); await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    const { dueAt } = (sent.mock.calls[0] as any)[0].data;
    expect(Date.parse(dueAt) - now).toBeLessThan(deadlineHorizonMs);
  });
  it('sends nothing for a closed tour, a missing tour, or without an event key', () => {
    vi.stubEnv('INNGEST_EVENT_KEY', 'k');
    scheduleTourTimer({ ...tour, status: 'completed' }, now); scheduleTourTimer(undefined, now);
    vi.stubEnv('INNGEST_EVENT_KEY', ''); scheduleTourTimer(tour, now);
    expect(sent).not.toHaveBeenCalled();
  });
});
