import { describe, expect, it, vi } from 'vitest';
import { bookingResponseDeadline } from './email';

describe('request response deadline', () => {
  it('uses stored creation time and the authorization expiry window, never send time', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
      expect(bookingResponseDeadline('2026-10-18T14:00:00Z').toISOString()).toBe('2026-10-19T14:00:00.000Z');
    } finally { vi.useRealTimers(); }
  });
});
