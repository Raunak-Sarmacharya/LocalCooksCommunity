import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import ICU from 'i18next-icu';
import { I18nextProvider } from 'react-i18next';
import enBooking from '@shared/i18n/locales/en-CA/booking.json';
import frBooking from '@shared/i18n/locales/fr-CA/booking.json';
import ukBooking from '@shared/i18n/locales/uk/booking.json';
import type { KitchenPayout } from '@shared/kitchen-payout';
import { KitchenPayoutStatus } from './KitchenPayoutStatus';

const resources = { 'en-CA': { booking: enBooking }, 'fr-CA': { booking: frBooking }, uk: { booking: ukBooking } };
const payout = (extra: Partial<KitchenPayout> = {}): KitchenPayout => ({ timing: 'after_closeout', status: 'scheduled', holdReason: null,
  expectedAt: '2026-10-15T13:30:00.000Z', sentAt: null, amountCents: 2732, ...extra });
async function show(value: KitchenPayout, lng = 'en-CA') {
  const i18n = createInstance(); await i18n.use(ICU).init({ lng, resources, defaultNS: 'booking', interpolation: { escapeValue: false } });
  render(<I18nextProvider i18n={i18n}><KitchenPayoutStatus payout={value} timezone="America/St_Johns" /></I18nextProvider>);
  return screen.getByTestId('kitchen-payout-status');
}
afterEach(cleanup);
describe('manager payment card: kitchen payout after closeout', () => {
  it('before release: the amount and when it is sent, in kitchen time', async () => {
    const card = await show(payout());
    expect(card).toHaveTextContent('Your payout $27.32');
    expect(card).toHaveTextContent('Sent after the visit closes (around Oct 15, 2026, 11:00 a.m.)');
  });
  it('on hold for a reported issue or a support review', async () => {
    expect(await show(payout({ status: 'on_hold', holdReason: 'reported_issue' }))).toHaveTextContent('On hold while Local Cooks reviews the reported issue');
    cleanup();
    expect(await show(payout({ status: 'on_hold', holdReason: 'support_flag' }))).toHaveTextContent('On hold while Local Cooks reviews this booking');
  });
  it('sent, and nothing owed', async () => {
    expect(await show(payout({ status: 'sent', sentAt: '2026-10-15T14:00:00.000Z' }))).toHaveTextContent('Sent to your Stripe account on Oct 15, 2026');
    cleanup();
    const none = await show(payout({ status: 'not_applicable', amountCents: 0 }));
    expect(none).toHaveTextContent('No payout is owed for this booking.'); expect(none).not.toHaveTextContent('$');
  });
  it.each(['fr-CA', 'uk'])('is translated in %s without raw keys', async lng => {
    const card = await show(payout(), lng);
    expect(card.textContent).not.toMatch(/payout[A-Z]|\{/);
    expect(card.textContent).toContain('27,32');
  });
});
