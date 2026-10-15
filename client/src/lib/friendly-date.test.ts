import { describe, expect, it } from 'vitest';
import { friendlyDate, friendlyDateTime } from './friendly-date';

const tz = 'America/St_Johns';
const now = new Date('2026-10-14T12:00:00Z');

describe('friendly dates', () => {
  it('drops the year in the current year and says "at" in sentences', () => {
    expect(friendlyDateTime('2026-10-15T22:30:00Z', 'en-CA', tz, now)).toBe('Oct 15 at 8:00 p.m.');
    expect(friendlyDate('2026-10-15T22:30:00Z', 'en-CA', tz, now)).toBe('Oct 15');
  });
  it('keeps the year for another year', () => {
    expect(friendlyDate('2027-01-03T15:00:00Z', 'en-CA', tz, now)).toBe('Jan 3, 2027');
    expect(friendlyDateTime('2025-12-31T15:00:00Z', 'en-CA', tz, now)).toMatch(/^Dec 31, 2025 at 11:30\sa\.m\.$/);
  });
  it('uses each language’s own connector', () => {
    expect(friendlyDateTime('2026-10-15T22:30:00Z', 'fr-CA', tz, now)).toMatch(/^15 oct\.? à 20 h 00$/);
    expect(friendlyDateTime('2026-10-15T22:30:00Z', 'uk', tz, now)).toMatch(/ о 20:00$/);
  });
});
