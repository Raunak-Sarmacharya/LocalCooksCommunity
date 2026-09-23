import { describe, expect, it } from 'vitest';
import { kitchenCheckinPolicyTimes } from './kitchen-checkin-policy';

describe('kitchenCheckinPolicyTimes', () => {
  it('uses the booked kitchen timezone and operating date for an overnight visit', () => {
    const times = kitchenCheckinPolicyTimes('2026-10-17', '00:00', '09:00', 'America/St_Johns', 20, 30);
    const display = (date: Date) => new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/St_Johns', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(date);
    expect(display(times.opensAt)).toContain('17');
    expect(display(times.opensAt)).toContain('23:40');
    expect(display(times.startsAt)).toContain('18');
    expect(display(times.startsAt)).toContain('00:00');
    expect(display(times.noShowAfter)).toContain('00:30');
  });
});
