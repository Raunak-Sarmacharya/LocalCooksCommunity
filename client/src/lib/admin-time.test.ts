import { describe, expect, it } from 'vitest';
import { formatAdminRange } from './admin-time';

const zone = { timeZone: 'America/St_Johns', zoneLabel: 'Newfoundland Time' };
describe('formatAdminRange', () => {
  it('collapses a same-day range with one date and one a.m./p.m.', () => {
    // 10:00-11:00 NDT on Oct 14 2026 (UTC-2:30)
    expect(formatAdminRange('2026-10-14T12:30:00.000Z', '2026-10-14T13:30:00.000Z', zone)).toBe('Wed, Oct 14, 2026 · 10:00–11:00 a.m.');
  });
  it('keeps both periods when the range crosses noon', () => {
    expect(formatAdminRange('2026-10-14T13:30:00.000Z', '2026-10-14T16:30:00.000Z', zone)).toBe('Wed, Oct 14, 2026 · 11:00 a.m.–2:00 p.m.');
  });
  it('keeps both dates for a range over midnight', () => {
    expect(formatAdminRange('2026-10-15T01:30:00.000Z', '2026-10-15T04:30:00.000Z', zone)).toBe('Wed, Oct 14, 2026 · 11:00 p.m. – Thu, Oct 15, 2026 · 2:00 a.m.');
  });
  it('returns nothing for a bad instant', () => { expect(formatAdminRange('x', 'y', zone)).toBe(''); });
});
