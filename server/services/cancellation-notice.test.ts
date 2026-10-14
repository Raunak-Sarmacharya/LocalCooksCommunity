import { expect, it } from 'vitest';
import { cancellationNotice } from './cancellation-notice';
it.each(['en-CA', 'fr-CA', 'uk'])('localizes chef, manager, kitchen and fee-pending cancellation notices (%s)', async locale => {
  const chef = await cancellationNotice('chef', locale, { cause: 'chef', refundCents: 11136, feeCents: 364 });
  const manager = await cancellationNotice('manager', locale, { cause: 'chef', kitchenShareRetainedCents: 5000 });
  const kitchen = await cancellationNotice('chef', locale, { cause: 'kitchen', refundCents: 11500, reason: 'Fixture' });
  const pending = await cancellationNotice('chef', locale, { cause: 'chef', feePending: true });
  for (const notice of [chef, manager, kitchen, pending]) { expect(notice.title).not.toMatch(/^cp/); expect(notice.message).not.toMatch(/\{\w+\}/); }
  expect(chef.message).not.toMatch(/free|100% back/i); expect(kitchen.message).toContain('Fixture');
});
