import { describe, expect, it } from 'vitest';
import { tourActivity } from './tour-activity';

describe('recorded tour activity', () => {
  it('preserves reports and corrections without duplicating the current event or exposing notes', () => {
    const events = tourActivity({ status: 'completed', scheduledAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T12:00:00Z', outcomeHistory: [
      { from: 'confirmed', to: 'no_show', recordedAt: '2026-10-01T11:00:00Z', notes: 'PRIVATE' },
      { from: 'no_show', to: 'completed', recordedAt: '2026-10-01T12:00:00Z', sharedNotes: 'Visitor attended' },
    ] });
    expect(events.map(event => [event.status, event.corrected])).toEqual([['completed', true], ['no_show', false]]);
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
  });
  it('distinguishes disruption and subsequent correction', () => {
    const events = tourActivity({ status: 'cancelled', disruptionReason: 'access_unavailable', scheduledAt: '2026-10-01T10:00:00Z', outcomeHistory: [
      { from: 'confirmed', to: 'cancelled', disruptionReason: 'access_unavailable', recordedAt: '2026-10-01T11:00:00Z' },
    ] });
    expect(events[0]).toMatchObject({ disruptionReason: 'access_unavailable', corrected: false });
  });
  it('does not invent outcome activity from scheduled time or malformed history', () => {
    expect(tourActivity({ status: 'completed', scheduledAt: '2026-10-01T10:00:00Z', outcomeHistory: [null, { to: 'no_show', recordedAt: 'bad' }] })).toEqual([]);
  });
});
