import { describe, expect, it } from 'vitest';
import { formatTourSlotRange } from './tour-time';

describe('Newfoundland tour ranges', () => {
  it.each([
    ['2026-10-07T11:30:00Z', '9:00 AM – 9:30 AM'],
    ['2026-01-07T12:30:00Z', '9:00 AM – 9:30 AM'],
    ['2026-10-08T02:15:00Z', '11:45 PM – Oct 8, 2026, 12:15 AM'],
  ])('omits timezone suffixes while preserving local clocks for %s', (start, expected) => {
    expect(formatTourSlotRange(start, 30)).toBe(expected);
  });

  it.each([
    ['2026-11-01T04:15:00Z', '1:45 AM – 1:15 AM'],
    ['2026-03-08T05:15:00Z', '1:45 AM – 3:15 AM'],
  ])('preserves local clocks across DST changes for %s', (start, expected) => {
    expect(formatTourSlotRange(start, 30)).toBe(expected);
  });
});
