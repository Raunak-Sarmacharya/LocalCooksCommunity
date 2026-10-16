import { describe, expect, it } from 'vitest';
import { ADMIN_BOOKING_KINDS, ADMIN_STORAGE_KINDS, adminBookingNotice, adminStorageNotice } from './admin-booking-notice';

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
  it('tracks a confirmed booking that the chef moved, with the reference in the title and the old and new time in the message', () => {
    expect(ADMIN_BOOKING_KINDS.has('booking_changed')).toBe(true);
    expect(adminBookingNotice('booking_changed', { ...facts, message: 'The chef changed the booking from Mon, Oct 26, 9:00 a.m.-11:00 a.m. to Wed, Oct 28, 9:00 a.m.-12:00 p.m., and the kitchen approved. The chef paid $48.00 more.' })).toEqual({
      title: 'Booking changed · KB-DHP7MC',
      message: 'Sam Chef at PHASE0 Main Kitchen · Oct 15, 9:45 p.m. · KB-DHP7MC. The chef changed the booking from Mon, Oct 26, 9:00 a.m.-11:00 a.m. to Wed, Oct 28, 9:00 a.m.-12:00 p.m., and the kitchen approved. The chef paid $48.00 more.',
    });
  });
  it('ignores routine milestones', () => {
    expect(adminBookingNotice('service_ended', facts)).toBeUndefined();
  });
  // "Change request": the chef sends a new request first; the old one closes after. Local Cooks reads both as one story.
  it('says which earlier request a new request replaces', () => {
    const notice = adminBookingNotice('requested', { ...facts, replacesRef: 'KB-OLD111' });
    expect(notice?.message).toContain('(replaces KB-OLD111)');
    expect(adminBookingNotice('requested', facts)?.message).not.toMatch(/replaces/);
  });
  it('words the earlier request’s closing as replaced, not as a plain withdrawal', () => {
    const notice = adminBookingNotice('cancelled', { ...facts, requestOutcome: 'replaced', replacedByRef: 'KB-NEW222' });
    expect(notice?.title).toBe('Request replaced · Sam Chef');
    expect(notice?.message).toContain('The chef sent a new request (KB-NEW222) in its place; the card hold was released.');
  });
});

describe('admin storage notices', () => {
  const storage = { chef: 'Sam Chef', kitchen: 'Harbour Kitchen', listing: 'Shelf 2', reference: 'SB-X1',
    when: 'Oct 20, 2026–Oct 27, 2026', locale: 'en-CA' };
  it('tracks the storage money and legal events, not the routine milestones', () => {
    expect(ADMIN_STORAGE_KINDS.has('storage_requested')).toBe(true);
    expect(ADMIN_STORAGE_KINDS.has('storage_extension_paid')).toBe(true);
    expect(ADMIN_STORAGE_KINDS.has('storage_kitchen_debt')).toBe(true);
    expect(adminStorageNotice('storage_ending', storage)).toBeUndefined();
  });
  it('summarises a new request with who, where, when and the card hold', () => {
    expect(adminStorageNotice('storage_requested', storage)).toEqual({
      title: 'New storage request · Sam Chef',
      message: "Sam Chef at Harbour Kitchen · Shelf 2 · SB-X1. Oct 20, 2026–Oct 27, 2026. The chef's card is on hold until the kitchen answers.",
    });
  });
  it('reports a raised holdover charge with the amount and dispute deadline', () => {
    const notice = adminStorageNotice('storage_holdover_raised', { ...storage, amountCents: 5000, days: 5, deadline: 'Oct 20, 2026, 3:30 p.m.' })!;
    expect(notice.title).toBe('Holdover charge raised · Sam Chef');
    expect(notice.message).toBe('Sam Chef at Harbour Kitchen · Shelf 2 · SB-X1. $50.00 for 5 days; the chef can dispute by Oct 20, 2026, 3:30 p.m.');
  });
  it('reports a released storage payout and a recorded kitchen debt', () => {
    expect(adminStorageNotice('storage_payout_released', { ...storage, amountCents: 6792 })!.title).toBe('Storage payout sent · Harbour Kitchen · $67.92');
    expect(adminStorageNotice('storage_kitchen_debt', { ...storage, amountCents: 2500 })!.message)
      .toContain("A refund of $25.00 couldn't be recovered from the kitchen's balance; the kitchen owes Local Cooks.");
  });
});
