import { expect, it } from 'vitest';
import { cancellationNotice } from './cancellation-notice';
it.each(['en-CA', 'fr-CA', 'uk'])('localizes chef, manager, kitchen and fee-pending cancellation notices (%s)', async locale => {
  const chef = await cancellationNotice('chef', locale, { cause: 'chef', refundCents: 11136, feeCents: 364 });
  const manager = await cancellationNotice('manager', locale, { cause: 'chef', kitchenShareRetainedCents: 5000 });
  const kitchen = await cancellationNotice('chef', locale, { cause: 'kitchen', refundCents: 11500, reason: 'Fixture' });
  const pending = await cancellationNotice('chef', locale, { cause: 'chef', feePending: true });
  for (const notice of [chef, manager, kitchen, pending]) { expect(notice.title).not.toMatch(/^cp/); expect(notice.message).not.toMatch(/\{\w+\}/); }
  const personal = await cancellationNotice('chef', locale, { cause: 'kitchen', refundCents: 2907, reason: 'Power outage.', kitchenName: 'Fixture Kitchen', date: 'Oct 20, 2026' });
  expect(personal.title).toContain('Fixture Kitchen'); expect(personal.message).toContain('Power outage'); expect(personal.message).not.toMatch(/[.!?]\s?[”»]?[”»]\./); expect(personal.actionLabel).toBeTruthy();
  expect(chef.message).not.toMatch(/free|100% back/i); expect(kitchen.message).toContain('Fixture');
});

it.each([0, 5000])('kitchen sees who cancelled, when and only a positive retained payout (%i)', async retained => {
  const notice = await cancellationNotice('manager', 'en-CA', { cause: 'chef', chefName: 'Sam', date: 'Oct 15, 9:00 a.m.', kitchenShareRetainedCents: retained });
  expect(notice.message).toContain('Sam cancelled · Oct 15, 9:00 a.m. — that time is open again.');
  expect(notice.message.includes('You keep $50.00')).toBe(retained > 0);
  expect(notice.message).not.toMatch(/\$0|Your booking is cancelled|refund/i);
});

it.each(['en-CA', 'fr-CA', 'uk'])('the kitchen that cancelled is told what it did, never "the chef cancelled" (live #169) (%s)', async locale => {
  const notice = await cancellationNotice('manager', locale, { cause: 'kitchen', chefName: 'Sam', date: 'Oct 18, 10:00 a.m.', refundCents: 3050, reason: 'Cooler failed' });
  expect(notice.title).toContain('Sam');
  expect(notice.message).toContain('Oct 18, 10:00 a.m.');
  expect(notice.message).not.toMatch(/\{\w+\}/);
  if (locale === 'en-CA') {
    expect(notice.title).toBe('You cancelled Sam’s booking');
    expect(notice.message).toContain('Sam gets a full refund of $30.50');
    expect(notice.message).not.toMatch(/The chef cancelled/);
  }
});
