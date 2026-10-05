import { describe, expect, it } from 'vitest';
import { formatInTimezone } from './timezone-utils';
describe('recorded visit and inspection text', () => {
  it('prints Newfoundland summer/winter times independently of the host timezone', () => {
    expect(formatInTimezone(new Date('2026-10-02T19:30:00Z'), 'yyyy-MM-dd HH:mm')).toBe('2026-10-02 17:00');
    expect(formatInTimezone(new Date('2026-12-02T19:30:00Z'), 'yyyy-MM-dd HH:mm')).toBe('2026-12-02 16:00');
    expect(formatInTimezone(new Date('2026-10-02T01:00:00Z'), 'yyyy-MM-dd')).toBe('2026-10-01');
    expect(formatInTimezone(new Date('2026-10-02T19:30:00Z'), 'yyyy-MM-dd HH:mm', 'UTC')).toBe('2026-10-02 19:30');
  });
});
