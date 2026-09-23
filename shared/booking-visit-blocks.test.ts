import { describe, expect, it } from 'vitest';
import { bookingVisitBlocks } from './booking-visit-blocks';

describe('booking visit blocks', () => {
  it('keeps contiguous overnight hours in one visit', () => {
    expect(bookingVisitBlocks([
      { startTime: '23:00', endTime: '00:00' },
      { startTime: '00:00', endTime: '01:00' },
    ])).toEqual([{ startTime: '23:00', endTime: '01:00' }]);
  });

  it('splits separated hourly slots into independent visits', () => {
    expect(bookingVisitBlocks([
      { startTime: '09:00', endTime: '10:00' },
      { startTime: '14:00', endTime: '15:00' },
    ])).toEqual([
      { startTime: '09:00', endTime: '10:00' },
      { startTime: '14:00', endTime: '15:00' },
    ]);
  });
});
