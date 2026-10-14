import { describe, expect, it } from 'vitest';
import { formatVisitWhen } from './visit-when';

const tz = 'America/St_Johns';
describe('formatVisitWhen', () => {
  it('writes a same-day visit in the header format', () => {
    // 9:30 a.m. NDT = 12:00Z
    expect(formatVisitWhen(new Date('2026-10-14T12:00:00Z'), new Date('2026-10-14T13:00:00Z'), tz, 'en-CA')).toBe('Wed, Oct 14 · 9:30–10:30 a.m.');
  });
  it('keeps both days for an overnight visit', () => {
    const text = formatVisitWhen(new Date('2026-10-13T01:30:00Z'), new Date('2026-10-13T03:30:00Z'), tz, 'en-CA');
    expect(text).toContain('Mon, Oct 12');
    expect(text).toContain('Tue, Oct 13');
  });
  it('returns an empty string for a bad zone', () => {
    expect(formatVisitWhen(new Date(), new Date(), 'Nowhere/Land', 'en-CA')).toBe('');
  });
});
