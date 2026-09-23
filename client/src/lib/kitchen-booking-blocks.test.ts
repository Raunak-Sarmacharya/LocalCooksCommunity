import { describe, expect, it } from 'vitest';
import { kitchenBookingBlocks } from './kitchen-booking-blocks';

describe('kitchen booking display blocks', () => {
  it('shows separated hours as separate blocks', () => {
    expect(kitchenBookingBlocks({ startTime: '08:00', endTime: '17:00',
      selectedSlots: [{ startTime: '08:00', endTime: '09:00' }, { startTime: '16:00', endTime: '17:00' }],
    })).toEqual([{ startTime: '08:00', endTime: '09:00' }, { startTime: '16:00', endTime: '17:00' }]);
  });

  it('keeps the overnight tail last', () => {
    expect(kitchenBookingBlocks({ startTime: '23:00', endTime: '01:00',
      operatingWindowStartTime: '08:00', selectedSlots: ['00:00', '23:00'],
    })).toEqual([{ startTime: '23:00', endTime: '01:00' }]);
  });
});
