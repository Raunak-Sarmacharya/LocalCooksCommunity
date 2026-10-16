import { describe, expect, it } from 'vitest';
import { ADMIN_BOOKING_KINDS, adminBookingNotice } from './admin-booking-notice';

const facts = { chef: 'Sam Chef', kitchen: 'PHASE0 Main Kitchen', reference: 'KB-DHP7MC', when: 'Oct 15, 9:45 p.m.',
  message: 'PHASE0 Main Kitchen reported that Sam Chef didn’t come. Note from PHASE0 Main Kitchen: Nobody arrived.' };

describe('admin booking notices', () => {
  // Owner (Oct 15): admins are told about attendance and no-show reports, in Local Cooks wording.
  it('tracks no-show reports with who, where, when and the no-refund rule', () => {
    expect(ADMIN_BOOKING_KINDS.has('report_no_show')).toBe(true);
    expect(adminBookingNotice('report_no_show', facts)).toEqual({
      title: 'No-show reported · Sam Chef',
      message: 'Sam Chef at PHASE0 Main Kitchen · Oct 15, 9:45 p.m. · KB-DHP7MC. PHASE0 Main Kitchen reported that Sam Chef didn’t come. Note from PHASE0 Main Kitchen: Nobody arrived. No-shows aren’t refunded. If the chef says they were there, it comes to support as a problem report.',
    });
  });
  it('ignores routine milestones', () => {
    expect(adminBookingNotice('service_ended', facts)).toBeUndefined();
  });
});
